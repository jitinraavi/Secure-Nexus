import { useEffect, useState } from "react";
import { getCsrfToken } from "../api";
import { offlineProjectStore } from "./offlineProjectStore";
import { offlineQueueStore, type OfflineQueueItem } from "./offlineQueue";
import { captureLocalWrite, localWriteAllowed, subscribeLocalDataFence } from "./localDataFence";
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
  private isOnline = typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" ? navigator.onLine : true;
  private isSyncing = false;
  private lastSyncTime: number | null = null;
  private lastError: string | null = null;
  private listeners = new Set<SyncListener>();
  private activeUserId: string | null = null;
  private syncController: AbortController | null = null;

  constructor() {
    subscribeLocalDataFence((userId, fence) => {
      if (userId !== this.activeUserId) return;
      if (fence.blocked) this.syncController?.abort();
      else if (this.isOnline) void this.synchronize(userId);
    });
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
    if (userId !== this.activeUserId) this.syncController?.abort();
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
    if (!userId || userId !== this.activeUserId || this.isSyncing || !this.isOnline || captureLocalWrite(userId) === null) return;

    const performSync = async () => {
      const write = captureLocalWrite(userId);
      if (!localWriteAllowed(userId, write) || userId !== this.activeUserId || this.isSyncing) return;
      const controller = new AbortController();
      this.syncController = controller;
      const assertCurrent = () => {
        if (controller.signal.aborted || userId !== this.activeUserId || !localWriteAllowed(userId, write)) throw new DOMException("Synchronization paused during account sign-out.", "AbortError");
      };
      this.isSyncing = true;
      this.lastError = null;
      this.notify();

      try {
        // 1. Re-validate authentication and session permissions
        const authRes = await fetch("/api/auth/me", { credentials: "same-origin", signal: controller.signal });
        assertCurrent();
        if (!authRes.ok) {
          throw new Error("Session expired; please sign in before synchronizing");
        }
        const authData = (await authRes.json()) as { user?: { id: string } };
        assertCurrent();
        if (authData.user?.id !== userId) {
          throw new Error("Account mismatch during synchronization");
        }

        // 2. Fetch pending queue items in FIFO order
        const pendingItems = await offlineQueueStore.getPendingQueue(userId);
        assertCurrent();

        for (const item of pendingItems) {
          assertCurrent();
          if (item.userId !== userId) break;
          await this.processItem(userId, item, controller.signal, assertCurrent);
        }

        this.lastSyncTime = Date.now();
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : "Sync error";
      } finally {
        if (this.syncController === controller) this.syncController = null;
        this.isSyncing = false;
        this.notify();
        if (controller.signal.aborted && this.activeUserId === userId && captureLocalWrite(userId) !== null && this.isOnline) void this.synchronize(userId);
      }
    };

    if (typeof navigator !== "undefined" && navigator.locks) {
      await navigator.locks.request("offline-sync-lock", { ifAvailable: true }, async (lock) => {
        // If lock is null, another tab is already syncing. We simply return and let it finish.
        if (lock) await performSync();
      });
    } else {
      await performSync();
    }
  }

  private async processItem(userId: string, item: OfflineQueueItem, signal: AbortSignal, assertCurrent: () => void): Promise<void> {
    assertCurrent();
    await offlineQueueStore.updateStatus(item.id, "syncing");

    try {
      switch (item.type) {
        case "project_save":
          await this.syncProjectSave(userId, item, signal, assertCurrent);
          break;
        default:
          throw new Error("This legacy queue operation has no verified dispatcher. Export it for recovery; artifact, snapshot and job queues require the new durable contract.");
      }
    } catch (err: unknown) {
      if (signal.aborted || err instanceof DOMException && err.name === "AbortError") throw err;
      assertCurrent();
      const errorMsg = err instanceof Error ? err.message : "Synchronization failed";
      await offlineQueueStore.updateStatus(item.id, "failed", errorMsg);
    }
  }

  private async syncProjectSave(userId: string, item: OfflineQueueItem, signal: AbortSignal, assertCurrent: () => void): Promise<void> {
    assertCurrent();
    // Permission & Project verification check: inspect server state first
    const getRes = await fetch(`/api/projects/${encodeURIComponent(item.projectId)}`, {
      credentials: "same-origin",
      signal,
    });
    assertCurrent();

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
    assertCurrent();

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
      signal,
      body: JSON.stringify({ ...item.payload, baseRevision: item.expectedRevision, expectedAccountId: userId }),
    });
    assertCurrent();

    if (patchRes.status === 409) {
      const conflictRes = (await patchRes.json()) as { currentRevision?: number; code?: string };
      assertCurrent();
      if (conflictRes.code === "ACCOUNT_CHANGED") throw new Error("The signed-in account changed during synchronization. The queued body remains retained for its original account.");
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
      assertCurrent();
      throw new Error(errJson.error || `Save failed (${patchRes.status})`);
    }

    const savedData = (await patchRes.json()) as { ok: boolean; revision: number };
    assertCurrent();

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

}

export const offlineSyncManager = new OfflineSyncManager();

export function useOfflineSync(userId?: string) {
  const [status, setStatus] = useState<SyncManagerStatus>(offlineSyncManager.getStatus());
  const [counts, setCounts] = useState({ pending: 0, conflicted: 0 });

  useEffect(() => {
    let active = true;
    setCounts({ pending: 0, conflicted: 0 });
    offlineSyncManager.setActiveUser(userId || null);
    const unsubscribe = offlineSyncManager.subscribe((newStatus) => {
      setStatus(newStatus);
      if (userId) {
        void offlineSyncManager.getQueueCounts(userId).then(value => { if (active) setCounts(value); });
      }
    });

    if (userId) {
      void offlineSyncManager.getQueueCounts(userId).then(value => { if (active) setCounts(value); });
    }

    return () => { active = false; unsubscribe(); };
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
