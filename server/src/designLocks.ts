import { db, now } from "./db.js";

function objectsById(value: unknown): Map<string, unknown> {
  const result = new Map<string, unknown>();
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) { for (const child of current) pending.push(child); continue; }
    const object = current as Record<string, unknown>;
    if (typeof object.id === "string") {
      // Duplicate IDs are ambiguous; retain all occurrences for lock comparisons.
      const existing = result.get(object.id);
      result.set(object.id, existing === undefined ? [object] : [...existing as unknown[], object]);
    }
    for (const child of Object.values(object)) if (child && typeof child === "object") pending.push(child);
  }
  return result;
}

/** Compare locked entities for both operation writes and whole-design saves. */
export function conflictingDesignLock(projectId: string, actorId: string, before: unknown, after: unknown): string | null {
  const locks = db.prepare("SELECT object_id FROM project_locks WHERE project_id = ? AND user_id != ? AND expires_at > ?")
    .all(projectId, actorId, now()) as { object_id: string }[];
  if (!locks.length) return null;
  const oldObjects = objectsById(before), newObjects = objectsById(after);
  for (const lock of locks) {
    const previous = oldObjects.get(lock.object_id), next = newObjects.get(lock.object_id);
    // A project lock, or an unresolved object, conservatively protects the whole design.
    if (lock.object_id === "__project__" || (previous === undefined && next === undefined)) {
      if (JSON.stringify(before) !== JSON.stringify(after)) return lock.object_id;
    } else if (JSON.stringify(previous) !== JSON.stringify(next)) return lock.object_id;
  }
  return null;
}
