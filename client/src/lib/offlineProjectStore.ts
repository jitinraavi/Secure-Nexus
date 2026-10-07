import type { Design, Project, ProjectType } from "../types";

export interface CachedProjectRecord {
  userId: string;
  projectId: string;
  name: string;
  projectType: ProjectType;
  revision: number;
  design: Design;
  hasPhoto: boolean;
  role: "owner" | "editor" | "viewer";
  cachedAt: number;
  lastAccessedAt: number;
  sizeBytes: number;
}

export interface CachedSnapshotRecord {
  userId: string;
  projectId: string;
  snapshotId: string;
  revision: number;
  description: string;
  snapshotData: string;
  createdAt: number;
  sizeBytes: number;
}

export interface StorageQuotaInfo {
  totalBytes: number;
  maxBytes: number;
  projectCount: number;
  maxProjects: number;
  usagePercent: number;
}

const DB_NAME = "groundwork_offline_projects_v2";
const DB_VERSION = 1;
const STORE_PROJECTS = "cached_projects";
const STORE_SNAPSHOTS = "cached_snapshots";

export const MAX_USER_STORAGE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_PROJECTS_PER_USER = 50;
export const MAX_SNAPSHOTS_PER_PROJECT = 10;

class OfflineProjectStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private memoryCache = new Map<string, CachedProjectRecord>();

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof window === "undefined" || !("indexedDB" in window)) {
        reject(new Error("IndexedDB is not supported in this environment"));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          const projectStore = db.createObjectStore(STORE_PROJECTS, {
            keyPath: ["userId", "projectId"],
          });
          projectStore.createIndex("by_user", "userId", { unique: false });
          projectStore.createIndex("by_user_accessed", ["userId", "lastAccessedAt"], { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
          const snapshotStore = db.createObjectStore(STORE_SNAPSHOTS, {
            keyPath: ["userId", "projectId", "snapshotId"],
          });
          snapshotStore.createIndex("by_user_project", ["userId", "projectId"], { unique: false });
          snapshotStore.createIndex("by_created", "createdAt", { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  private estimateSize(obj: unknown): number {
    try {
      return new TextEncoder().encode(JSON.stringify(obj)).length;
    } catch {
      return 1024;
    }
  }

  /**
   * Account-scoped project caching with LRU eviction and storage limits.
   */
  async cacheProject(
    userId: string,
    project: Project,
    design: Design,
    protectedProjectIds: Set<string> = new Set(),
  ): Promise<void> {
    if (!userId || !project.id) return;

    const sizeBytes = this.estimateSize({ project, design });
    await this.ensureStorageCapacity(userId, sizeBytes, protectedProjectIds);

    const now = Date.now();
    const record: CachedProjectRecord = {
      userId,
      projectId: project.id,
      name: project.name,
      projectType: (project.projectType || "house") as ProjectType,
      revision: project.revision ?? 0,
      design,
      hasPhoto: Boolean(project.hasPhoto),
      role: (project.role || "owner") as "owner" | "editor" | "viewer",
      cachedAt: now,
      lastAccessedAt: now,
      sizeBytes,
    };

    const cacheKey = `${userId}:${project.id}`;
    this.memoryCache.set(cacheKey, record);

    try {
      const db = await this.getDB();
      const tx = db.transaction(STORE_PROJECTS, "readwrite");
      tx.objectStore(STORE_PROJECTS).put(record);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      if (typeof window !== "undefined" && "indexedDB" in window) {
        console.warn("[OfflineProjectStore] Could not persist project to IndexedDB:", err);
      }
    }
  }

  /**
   * Retrieve cached project strictly scoped to the active account.
   */
  async getCachedProject(userId: string, projectId: string): Promise<CachedProjectRecord | null> {
    if (!userId || !projectId) return null;

    const cacheKey = `${userId}:${projectId}`;
    const inMem = this.memoryCache.get(cacheKey);
    if (inMem && inMem.userId === userId) {
      inMem.lastAccessedAt = Date.now();
      return inMem;
    }

    try {
      const db = await this.getDB();
      const tx = db.transaction(STORE_PROJECTS, "readwrite");
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.get([userId, projectId]);

      const record = await new Promise<CachedProjectRecord | null>((resolve, reject) => {
        req.onsuccess = () => resolve((req.result as CachedProjectRecord) || null);
        req.onerror = () => reject(req.error);
      });

      if (record && record.userId === userId) {
        record.lastAccessedAt = Date.now();
        store.put(record);
        this.memoryCache.set(cacheKey, record);
        return record;
      }
    } catch (err) {
      if (typeof window !== "undefined" && "indexedDB" in window) {
        console.warn("[OfflineProjectStore] Could not read cached project:", err);
      }
    }

    return null;
  }

  /**
   * List all projects cached for the given user ID.
   */
  async listCachedProjects(userId: string): Promise<CachedProjectRecord[]> {
    if (!userId) return [];

    try {
      const db = await this.getDB();
      const tx = db.transaction(STORE_PROJECTS, "readonly");
      const store = tx.objectStore(STORE_PROJECTS);
      const index = store.index("by_user");
      const req = index.getAll(userId);

      const records = await new Promise<CachedProjectRecord[]>((resolve, reject) => {
        req.onsuccess = () => resolve((req.result as CachedProjectRecord[]) || []);
        req.onerror = () => reject(req.error);
      });

      return records.filter((r) => r.userId === userId);
    } catch {
      return Array.from(this.memoryCache.values()).filter((r) => r.userId === userId);
    }
  }

  /**
   * Cache a snapshot for a project, bounded by max snapshots per project.
   */
  async cacheSnapshot(
    userId: string,
    projectId: string,
    snapshot: { id: string; revision: number; description?: string; snapshotData: string },
  ): Promise<void> {
    if (!userId || !projectId || !snapshot.id) return;

    const sizeBytes = this.estimateSize(snapshot);
    const now = Date.now();
    const record: CachedSnapshotRecord = {
      userId,
      projectId,
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      description: snapshot.description || "",
      snapshotData: snapshot.snapshotData,
      createdAt: now,
      sizeBytes,
    };

    try {
      const db = await this.getDB();
      const tx = db.transaction(STORE_SNAPSHOTS, "readwrite");
      const store = tx.objectStore(STORE_SNAPSHOTS);

      // Check existing snapshots count for this project
      const index = store.index("by_user_project");
      const existingReq = index.getAll([userId, projectId]);
      const existing = await new Promise<CachedSnapshotRecord[]>((resolve, reject) => {
        existingReq.onsuccess = () => resolve((existingReq.result as CachedSnapshotRecord[]) || []);
        existingReq.onerror = () => reject(existingReq.error);
      });

      // Evict oldest if exceeding limit
      if (existing.length >= MAX_SNAPSHOTS_PER_PROJECT) {
        existing.sort((a, b) => a.createdAt - b.createdAt);
        const toDelete = existing.slice(0, existing.length - MAX_SNAPSHOTS_PER_PROJECT + 1);
        for (const item of toDelete) {
          store.delete([item.userId, item.projectId, item.snapshotId]);
        }
      }

      store.put(record);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      if (typeof window !== "undefined" && "indexedDB" in window) {
        console.warn("[OfflineProjectStore] Could not cache snapshot:", err);
      }
    }
  }

  /**
   * List cached snapshots for a project.
   */
  async listCachedSnapshots(userId: string, projectId: string): Promise<CachedSnapshotRecord[]> {
    if (!userId || !projectId) return [];

    try {
      const db = await this.getDB();
      const tx = db.transaction(STORE_SNAPSHOTS, "readonly");
      const store = tx.objectStore(STORE_SNAPSHOTS);
      const index = store.index("by_user_project");
      const req = index.getAll([userId, projectId]);

      const items = await new Promise<CachedSnapshotRecord[]>((resolve, reject) => {
        req.onsuccess = () => resolve((req.result as CachedSnapshotRecord[]) || []);
        req.onerror = () => reject(req.error);
      });

      return items.filter((item) => item.userId === userId && item.projectId === projectId);
    } catch {
      return [];
    }
  }

  /**
   * Calculate storage quota and usage for the user.
   */
  async getStorageUsage(userId: string): Promise<StorageQuotaInfo> {
    const projects = await this.listCachedProjects(userId);
    let totalBytes = 0;
    for (const p of projects) {
      totalBytes += p.sizeBytes || 0;
    }

    try {
      const db = await this.getDB();
      const tx = db.transaction(STORE_SNAPSHOTS, "readonly");
      const store = tx.objectStore(STORE_SNAPSHOTS);
      const cursorReq = store.openCursor();
      await new Promise<void>((resolve) => {
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            const row = cursor.value as CachedSnapshotRecord;
            if (row.userId === userId) totalBytes += row.sizeBytes || 0;
            cursor.continue();
          } else {
            resolve();
          }
        };
        cursorReq.onerror = () => resolve();
      });
    } catch {
      /* ignore */
    }

    const usagePercent = Math.min(100, Math.round((totalBytes / MAX_USER_STORAGE_BYTES) * 100));
    return {
      totalBytes,
      maxBytes: MAX_USER_STORAGE_BYTES,
      projectCount: projects.length,
      maxProjects: MAX_PROJECTS_PER_USER,
      usagePercent,
    };
  }

  /**
   * Ensure user's cached storage stays within bounded limits using LRU eviction.
   * Never evicts projects that have pending offline queue items (`protectedProjectIds`).
   */
  private async ensureStorageCapacity(
    userId: string,
    incomingBytes: number,
    protectedProjectIds: Set<string>,
  ): Promise<void> {
    const projects = await this.listCachedProjects(userId);
    let totalBytes = projects.reduce((acc, p) => acc + (p.sizeBytes || 0), 0);

    if (totalBytes + incomingBytes <= MAX_USER_STORAGE_BYTES && projects.length < MAX_PROJECTS_PER_USER) {
      return;
    }

    // Sort projects from least recently accessed to most recently accessed
    const candidates = projects
      .filter((p) => !protectedProjectIds.has(p.projectId))
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    try {
      const db = await this.getDB();
      const tx = db.transaction([STORE_PROJECTS, STORE_SNAPSHOTS], "readwrite");
      const pStore = tx.objectStore(STORE_PROJECTS);
      const sStore = tx.objectStore(STORE_SNAPSHOTS);

      for (const candidate of candidates) {
        if (totalBytes + incomingBytes <= MAX_USER_STORAGE_BYTES && projects.length <= MAX_PROJECTS_PER_USER) {
          break;
        }

        // Delete project and remove from memory cache
        pStore.delete([candidate.userId, candidate.projectId]);
        this.memoryCache.delete(`${candidate.userId}:${candidate.projectId}`);
        totalBytes -= candidate.sizeBytes;

        // Delete associated snapshots
        const sIndex = sStore.index("by_user_project");
        const sReq = sIndex.getAllKeys([candidate.userId, candidate.projectId]);
        sReq.onsuccess = () => {
          for (const key of sReq.result) {
            sStore.delete(key);
          }
        };
      }

      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      /* ignore */
    }
  }

  /**
   * Isolate and clear user memory cache on logout.
   */
  clearActiveUserSession(userId: string): void {
    for (const [key, record] of this.memoryCache.entries()) {
      if (record.userId === userId || key.startsWith(`${userId}:`)) {
        this.memoryCache.delete(key);
      }
    }
  }

  /**
   * Purge all cached data for a user (e.g., explicit privacy cleanup).
   */
  async deleteUserCache(userId: string): Promise<void> {
    this.clearActiveUserSession(userId);

    try {
      const db = await this.getDB();
      const tx = db.transaction([STORE_PROJECTS, STORE_SNAPSHOTS], "readwrite");
      const pStore = tx.objectStore(STORE_PROJECTS);
      const sStore = tx.objectStore(STORE_SNAPSHOTS);

      const pReq = pStore.index("by_user").getAllKeys(userId);
      pReq.onsuccess = () => {
        for (const k of pReq.result) pStore.delete(k);
      };

      const sCursor = sStore.openCursor();
      sCursor.onsuccess = () => {
        const cursor = sCursor.result;
        if (cursor) {
          const row = cursor.value as CachedSnapshotRecord;
          if (row.userId === userId) cursor.delete();
          cursor.continue();
        }
      };

      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (err) {
      if (typeof window !== "undefined" && "indexedDB" in window) {
        console.warn("[OfflineProjectStore] Could not delete user cache:", err);
      }
    }
  }
}

export const offlineProjectStore = new OfflineProjectStore();
