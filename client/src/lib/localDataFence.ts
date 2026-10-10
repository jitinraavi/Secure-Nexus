export interface LocalDataFence { token: string; blocked: boolean; remove: boolean; signedOut: boolean; lastRemoval?: string; /** Notification only; never persisted. */ localOnly?: boolean; }
const PREFIX = "groundwork:local-data-fence:v1:";
const memory = new Map<string, LocalDataFence>();
const undurable = new Set<string>();
const seenRemovals = new Map<string, string>();
const staleTabs = new Set<string>();
const listeners = new Set<(userId: string, fence: LocalDataFence) => void>();
const flushers = new Map<string, Set<() => Promise<void>>>();
const storageKey = (userId: string) => PREFIX + encodeURIComponent(userId);
function observeRemoval(userId: string, fence: LocalDataFence): LocalDataFence {
  if (fence.lastRemoval && seenRemovals.get(userId) !== fence.lastRemoval) {
    seenRemovals.set(userId, fence.lastRemoval); staleTabs.add(userId);
    // Delayed notifications can arrive after another tab has already signed back in.
    // Clear only this tab's stale copies, preserving newly written shared records.
    for (const listener of listeners) listener(userId, { ...fence, blocked: true, remove: true, signedOut: false, localOnly: true });
  }
  return fence;
}
function read(userId: string): LocalDataFence {
  if (undurable.has(userId) && memory.has(userId)) return observeRemoval(userId, memory.get(userId)!);
  try {
    const text = localStorage.getItem(storageKey(userId));
    if (text) {
      const value = JSON.parse(text) as LocalDataFence;
      if (typeof value.token === "string" && typeof value.blocked === "boolean" && typeof value.remove === "boolean" && typeof value.signedOut === "boolean") return observeRemoval(userId, {
        token: value.token, blocked: value.blocked, remove: value.remove, signedOut: value.signedOut,
        lastRemoval: typeof value.lastRemoval === "string" ? value.lastRemoval : value.remove ? value.token : undefined,
      });
    }
  } catch { /* In-memory fencing remains available when storage is disabled. */ }
  return observeRemoval(userId, memory.get(userId) ?? { token: "initial", blocked: false, remove: false, signedOut: false });
}
function publish(userId: string, fence: LocalDataFence, requireDurable = false): void {
  if (typeof localStorage !== "undefined") {
    try { localStorage.setItem(storageKey(userId), JSON.stringify(fence)); undurable.delete(userId); }
    catch {
      if (requireDurable) throw new Error("Browser storage is unavailable. Local data cannot safely be removed across tabs; retain it or export it before signing out.");
      undurable.add(userId);
    }
  } else if (requireDurable && typeof window !== "undefined") {
    throw new Error("Browser storage is unavailable. Local data cannot safely be removed across tabs.");
  }
  memory.set(userId, fence);
  if (fence.lastRemoval) seenRemovals.set(userId, fence.lastRemoval);
  for (const listener of listeners) listener(userId, fence);
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", event => {
    if (!event.key?.startsWith(PREFIX) || !event.newValue) return;
    try {
      const userId = decodeURIComponent(event.key.slice(PREFIX.length));
      undurable.delete(userId);
      synchronizeLocalAccountFence(userId);
    } catch { /* Ignore unrelated or malformed browser storage notifications. */ }
  });
}
export function synchronizeLocalAccountFence(userId: string): void {
  const fence = read(userId);
  memory.set(userId, fence);
  for (const listener of listeners) listener(userId, fence);
}
export function subscribeLocalDataFence(listener: (userId: string, fence: LocalDataFence) => void, replayRemoval = false): () => void {
  listeners.add(listener);
  if (replayRemoval) for (const userId of seenRemovals.keys()) listener(userId, { ...read(userId), blocked: true, remove: true, signedOut: false, localOnly: true });
  return () => { listeners.delete(listener); };
}
export function registerLocalDraftFlush(userId: string, flush: () => Promise<void>): () => void {
  const account = flushers.get(userId) ?? new Set<() => Promise<void>>();
  account.add(flush); flushers.set(userId, account);
  return () => { account.delete(flush); if (!account.size) flushers.delete(userId); };
}
export async function flushLocalDrafts(userId: string): Promise<void> {
  await Promise.all([...(flushers.get(userId) ?? [])].map(flush => flush()));
}
export function captureLocalWrite(userId: string): string | null {
  const fence = read(userId); return fence.blocked || staleTabs.has(userId) ? null : fence.token;
}
export function localWriteAllowed(userId: string, token: string | null): boolean {
  const fence = read(userId); return token !== null && !fence.blocked && !staleTabs.has(userId) && fence.token === token;
}
export function localAccountFence(userId: string): Readonly<LocalDataFence> { return { ...read(userId) }; }
export function localCleanupAllowed(userId: string, token: string | null): boolean {
  const fence = read(userId); return token !== null && fence.blocked && fence.remove && fence.token === token;
}
/** Capture before an authentication request: an older response cannot reopen a newer fence. */
export function captureAuthenticationFences(): ReadonlyMap<string, string> {
  const tokens = new Map([...memory].map(([userId, fence]) => [userId, fence.token]));
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(PREFIX)) {
        const userId = decodeURIComponent(key.slice(PREFIX.length));
        tokens.set(userId, read(userId).token);
      }
    }
  } catch { /* In-memory snapshots still protect this tab when storage is disabled. */ }
  return tokens;
}
export function resumeAuthenticatedLocalAccount(userId: string, started: ReadonlyMap<string, string>): boolean {
  const fence = read(userId);
  if (fence.token !== (started.get(userId) ?? "initial") || fence.blocked && !fence.signedOut) return false;
  return resumeLocalAccount(userId);
}
export function fenceLocalAccount(userId: string, remove: boolean): string {
  const previous = read(userId);
  const token = crypto.randomUUID();
  publish(userId, { token, blocked: true, remove, signedOut: false, lastRemoval: remove ? token : previous.lastRemoval }, remove);
  return token;
}
export function confirmLocalSignOut(userId: string, expectedToken?: string): void {
  const previous = read(userId);
  if (expectedToken !== undefined && previous.token !== expectedToken) return;
  publish(userId, { ...previous, blocked: true, signedOut: true });
}
export function resumeLocalAccount(userId: string, expectedToken?: string): boolean {
  const previous = read(userId);
  if (expectedToken !== undefined && (previous.token !== expectedToken || previous.signedOut)) return false;
  staleTabs.delete(userId);
  if (!previous.blocked && !previous.remove && !previous.signedOut) return true;
  // Clear a restored tab's stale session recovery before enabling new account writes.
  if (previous.remove) for (const listener of listeners) listener(userId, previous);
  publish(userId, { token: crypto.randomUUID(), blocked: false, remove: false, signedOut: false, lastRemoval: previous.lastRemoval });
  return true;
}
