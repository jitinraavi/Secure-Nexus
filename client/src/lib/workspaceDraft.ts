import { MAX_WORKSPACE_BYTES, type WorkspaceKind } from "./workspaceApi";

export interface WorkspaceDraft {
  key: string; version: 1; userId: string; projectId: string; kind: WorkspaceKind;
  baseRevision: number; sourceRevision: number; content: string; updatedAt: number;
  referencedArtifactIds: string[]; files: { name: string; type: string; blob: Blob }[];
}
// A second tab cannot overwrite another document's inputs.
export const workspaceDraftClientId = crypto.randomUUID();
export const workspaceDraftKey = (userId: string, projectId: string, kind: WorkspaceKind, clientId = workspaceDraftClientId) => `${userId}:${projectId}:${kind}:${clientId}`;
const maximumDraftBytes = 256 * 1024 * 1024, maximumDrafts = 16;
const pending = new Map<string, Promise<unknown>>();
const prefix = (userId: string, projectId: string, kind: WorkspaceKind) => `${userId}:${projectId}:${kind}`;
const belongs = (key: string, scope: string) => key === scope || key.startsWith(`${scope}:`);
function queued<T>(key: string, work: () => Promise<T>): Promise<T> {
  const operation = (pending.get(key) || Promise.resolve()).catch(() => undefined).then(work);
  pending.set(key, operation);
  void operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => undefined);
  return operation;
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error) => { if (!settled) { settled = true; window.clearTimeout(timer); reject(error); } };
    const timer = window.setTimeout(() => finish(new Error("Browser draft storage did not respond.")), 10000);
    const request = indexedDB.open("groundwork-workspaces", 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("drafts")) request.result.createObjectStore("drafts", { keyPath: "key" }); };
    request.onsuccess = () => { if (settled) request.result.close(); else { settled = true; window.clearTimeout(timer); request.result.onversionchange = () => request.result.close(); resolve(request.result); } };
    request.onerror = () => finish(request.error || new Error("Draft storage is unavailable."));
    request.onblocked = () => finish(new Error("Another tab is blocking draft storage."));
  });
}
async function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
  const database = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction("drafts", mode); let value: T, failure: unknown;
    const fail = (error: unknown) => { failure = error; try { tx.abort(); } catch { database.close(); reject(error); } };
    tx.oncomplete = () => { database.close(); resolve(value); };
    tx.onerror = tx.onabort = () => { database.close(); reject(failure || tx.error || new Error("Draft storage operation failed.")); };
    try { work(tx.objectStore("drafts"), result => { value = result; }, fail); } catch (error) { fail(error); }
  });
}
function validate(value: unknown, scope: string): WorkspaceDraft {
  if (!value || typeof value !== "object") throw new Error("Browser draft is unreadable; its stored data has been preserved.");
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || typeof row.key !== "string" || !belongs(row.key, scope) || typeof row.userId !== "string" || typeof row.projectId !== "string" || !["engineering", "exchange", "geometry"].includes(String(row.kind)) || prefix(row.userId, row.projectId, row.kind as WorkspaceKind) !== scope || typeof row.content !== "string" || new Blob([row.content]).size > MAX_WORKSPACE_BYTES || typeof row.updatedAt !== "number" || !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0 || typeof row.baseRevision !== "number" || !Number.isSafeInteger(row.baseRevision) || row.baseRevision < 0 || typeof row.sourceRevision !== "number" || !Number.isSafeInteger(row.sourceRevision) || row.sourceRevision < 0) throw new Error("Browser draft is invalid; its stored data has been preserved.");
  // Older version 1 drafts are migrated in memory only.
  const references = row.referencedArtifactIds ?? [], files = row.files ?? [];
  if (!Array.isArray(references) || !Array.isArray(files) || references.length + files.length > 16 || references.some(id => typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) || new Set(references).size !== references.length) throw new Error("Browser draft source references are invalid; data has been preserved.");
  for (const file of files) {
    if (!file || typeof file !== "object") throw new Error("Browser draft attachment is invalid; data has been preserved.");
    const item = file as Record<string, unknown>;
    if (typeof item.name !== "string" || item.name.length > 240 || !item.name || typeof item.type !== "string" || item.type.length > 256 || !(item.blob instanceof Blob) || item.blob.size > MAX_WORKSPACE_BYTES) throw new Error("Browser draft attachment is invalid; data has been preserved.");
  }
  const draft = { ...row, referencedArtifactIds: references, files } as unknown as WorkspaceDraft;
  if (size(draft) > maximumDraftBytes) throw new Error("Browser draft exceeds 256 MiB; data has been preserved.");
  return draft;
}
const size = (draft: WorkspaceDraft) => new Blob([draft.content]).size + draft.files.reduce((total, file) => total + file.blob.size, 0);
export async function listWorkspaceDrafts(userId: string, projectId: string, kind: WorkspaceKind): Promise<WorkspaceDraft[]> {
  const scope = prefix(userId, projectId, kind);
  await Promise.allSettled([...pending.entries()].filter(([key]) => belongs(key, scope)).map(([, operation]) => operation));
  return transaction("readonly", (store, done, fail) => {
    const items: WorkspaceDraft[] = []; let bytes = 0;
    const request = store.openCursor(IDBKeyRange.bound(scope, `${scope}\uffff`));
    request.onsuccess = () => {
      try {
        const cursor = request.result; if (!cursor) { done(items.sort((a, b) => b.updatedAt - a.updatedAt)); return; }
        if (typeof cursor.key === "string" && belongs(cursor.key, scope)) { const draft = validate(cursor.value, scope); items.push(draft); bytes += size(draft); if (items.length > maximumDrafts || bytes > maximumDraftBytes) throw new Error("Browser recovery capacity exceeded. Existing drafts are preserved; export or discard them before creating another draft."); }
        cursor.continue();
      } catch (error) { fail(error); }
    };
  });
}
export async function writeWorkspaceDraft(draft: WorkspaceDraft): Promise<void> {
  const scope = prefix(draft.userId, draft.projectId, draft.kind); validate(draft, scope);
  return queued(draft.key, () => transaction("readwrite", (store, done, fail) => {
    let count = 1, bytes = size(draft);
    const request = store.openCursor(IDBKeyRange.bound(scope, `${scope}\uffff`));
    request.onsuccess = () => {
      try {
        const cursor = request.result;
        if (!cursor) { store.put(draft); done(undefined); return; }
        if (typeof cursor.key === "string" && belongs(cursor.key, scope)) {
          const stored = validate(cursor.value, scope);
          if (cursor.key !== draft.key) { count++; bytes += size(stored); }
        }
        if (count > maximumDrafts || bytes > maximumDraftBytes) throw new Error("Browser recovery capacity exceeded. Export or discard an older draft; existing drafts are preserved.");
        cursor.continue();
      } catch (error) { fail(error); }
    };
  }));
}
export async function removeWorkspaceDraft(key: string, expectedUpdatedAt?: number): Promise<void> {
  return queued(key, () => transaction("readwrite", (store, done) => {
    const request = store.get(key);
    request.onsuccess = () => { const value: unknown = request.result; if (expectedUpdatedAt === undefined || (value && typeof value === "object" && (value as Record<string, unknown>).updatedAt === expectedUpdatedAt)) store.delete(key); done(undefined); };
  }));
}
