import { useEffect, useState } from "react";
import { getCsrfToken } from "../api";
import { offlineProjectStore } from "./offlineProjectStore";
import { offlineQueueStore, type OfflineQueueItem } from "./offlineQueue";
import type { Design, Project, ProjectType } from "../types";

export interface SyncManagerStatus {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  conflictedCount: number;
  lastSyncTime: number | null;
  lastError: string | null;
}

type SyncListener = (status: SyncManagerStatus) => void;

class OfflineSyncManager {
  private isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  private isSyncing = false;
  private lastSyncTime: number | null = null;
  private lastError: string | null = null;
  private listeners = new Set<SyncListener>();
  private activeUserId: string | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        this.isOnline = true;
        this.notify();
        if (this.activeUserId) {
          void this.synchronize(this.activeUserId);
        }
      });

      window.addEventListener("offline", () => {
        this.isOnline = false;
        this.notify();
      });
    }
  }

  setActiveUser(userId: string | null): void {
    this.activeUserId = userId;
    if (userId && this.isOnline) {
      void this.synchronize(userId);
    }
  }

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      listener(status);
    }
  }

  getStatus(): SyncManagerStatus {
    return {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      pendingCount: 0,
      conflictedCount: 0,
      lastSyncTime: this.lastSyncTime,
      lastError: this.lastError,
    };
  }

  async getQueueCounts(userId: string): Promise<{ pending: number; conflicted: number }> {
    const pending = (await offlineQueueStore.listQueue(userId, "queued")).length;
    const conflicted = (await offlineQueueStore.listQueue(userId, "conflicted")).length;
    return { pending, conflicted };
  }

  /**
   * Run synchronization process for the given account.
   */
  async synchronize(userId: string): Promise<void> {
    if (!userId || this.isSyncing || !this.isOnline) return;

    this.isSyncing = true;
    this.lastError = null;
    this.notify();

    try {
      // 1. Re-validate authentication and session permissions
      const authRes = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (!authRes.ok) {
        throw new Error("Session expired; please sign in before synchronizing");
      }
      const authData = (await authRes.json()) as { user?: { id: string } };
      if (authData.user?.id !== userId) {
        throw new Error("Account mismatch during synchronization");
      }

      // 2. Fetch pending queue items in FIFO order
      const pendingItems = await offlineQueueStore.getPendingQueue(userId);

      for (const item of pendingItems) {
        await this.processItem(userId, item);
      }

      this.lastSyncTime = Date.now();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : "Sync error";
    } finally {
      this.isSyncing = false;
      this.notify();
    }
  }

  private async processItem(userId: string, item: OfflineQueueItem): Promise<void> {
    await offlineQueueStore.updateStatus(item.id, "syncing");

    try {
      switch (item.type) {
        case "project_save":
          await this.syncProjectSave(userId, item);
          break;
        case "snapshot_create":
          await this.syncSnapshotCreate(item);
          break;
        case "native_job_submit":
          await this.syncNativeJobSubmit(item);
          break;
        default:
          await offlineQueueStore.updateStatus(item.id, "completed");
          break;
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Synchronization failed";
      await offlineQueueStore.updateStatus(item.id, "failed", errorMsg);
    }
  }

  private async syncProjectSave(userId: string, item: OfflineQueueItem): Promise<void> {
    // Permission & Project verification check: inspect server state first
    const getRes = await fetch(`/api/projects/${encodeURIComponent(item.projectId)}`, {
      credentials: "same-origin",
    });

    if (getRes.status === 403 || getRes.status === 404) {
      await offlineQueueStore.updateStatus(
        item.id,
        "failed",
        getRes.status === 403
          ? "Permission revoked on this project while offline"
          : "Project was deleted on server while offline",
      );
      return;
    }

    if (!getRes.ok) {
      throw new Error(`Failed to check project status (${getRes.status})`);
    }

    const { project } = (await getRes.json()) as { project: Project };

    // Revision conflict detection: verify server has not moved ahead
    if (project.revision !== item.expectedRevision) {
      await offlineQueueStore.updateStatus(
        item.id,
        "conflicted",
        "Server revision advanced while offline. Local changes retained to prevent silent overwrite.",
        {
          serverRevision: project.revision,
          localRevision: item.expectedRevision,
          reason: `Server is at revision ${project.revision}, but offline draft was based on revision ${item.expectedRevision}`,
          serverUpdatedAt: project.updatedAt,
        },
      );
      return;
    }

    // Server revision is clean — submit save patch
    const csrfToken = getCsrfToken();
    const patchRes = await fetch(`/api/projects/${encodeURIComponent(item.projectId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      },
      credentials: "same-origin",
      body: JSON.stringify(item.payload),
    });

    if (patchRes.status === 409) {
      const conflictRes = (await patchRes.json()) as { currentRevision?: number };
      await offlineQueueStore.updateStatus(
        item.id,
        "conflicted",
        "Server reported a concurrent conflict during save.",
        {
          serverRevision: conflictRes.currentRevision ?? project.revision + 1,
          localRevision: item.expectedRevision,
          reason: "Concurrent edit conflict reported by server.",
        },
      );
      return;
    }

    if (!patchRes.ok) {
      const errJson = (await patchRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(errJson.error || `Save failed (${patchRes.status})`);
    }

    const savedData = (await patchRes.json()) as { ok: boolean; revision: number };

    // Update offline project cache with new revision and design
    const updatedProject: Project = {
      ...project,
      name: (item.payload.name as string) || project.name,
      projectType: (item.payload.projectType as ProjectType) || project.projectType,
      revision: savedData.revision,
      updatedAt: Date.now(),
    };

    let design = item.payload.design as Design | undefined;
    if (!design && typeof item.payload.designData === "string") {
      try {
        design = JSON.parse(item.payload.designData) as Design;
      } catch {
        /* ignore */
      }
    }

    if (design) {
      await offlineProjectStore.cacheProject(userId, updatedProject, design);
    }

    await offlineQueueStore.updateStatus(item.id, "completed");
  }

  private async syncSnapshotCreate(item: OfflineQueueItem): Promise<void> {
    const csrfToken = getCsrfToken();
    const res = await fetch(`/api/projects/${encodeURIComponent(item.projectId)}/snapshots`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      },
      credentials: "same-origin",
      body: JSON.stringify(item.payload),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || `Snapshot create failed (${res.status})`);
    }

    await offlineQueueStore.updateStatus(item.id, "completed");
  }

  private async syncNativeJobSubmit(item: OfflineQueueItem): Promise<void> {
    const csrfToken = getCsrfToken();
    const res = await fetch(`/api/projects/${encodeURIComponent(item.projectId)}/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      },
      credentials: "same-origin",
      body: JSON.stringify(item.payload),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || `Job submission failed (${res.status})`);
    }

    await offlineQueueStore.updateStatus(item.id, "completed");
  }
}

export const offlineSyncManager = new OfflineSyncManager();

export function useOfflineSync(userId?: string) {
  const [status, setStatus] = useState<SyncManagerStatus>(offlineSyncManager.getStatus());
  const [counts, setCounts] = useState({ pending: 0, conflicted: 0 });

  useEffect(() => {
    offlineSyncManager.setActiveUser(userId || null);
    const unsubscribe = offlineSyncManager.subscribe((newStatus) => {
      setStatus(newStatus);
      if (userId) {
        void offlineSyncManager.getQueueCounts(userId).then(setCounts);
      }
    });

    if (userId) {
      void offlineSyncManager.getQueueCounts(userId).then(setCounts);
    }

    return unsubscribe;
  }, [userId]);

  return {
    ...status,
    pendingCount: counts.pending,
    conflictedCount: counts.conflicted,
    syncNow: () => {
      if (userId) void offlineSyncManager.synchronize(userId);
    },
  };
}
