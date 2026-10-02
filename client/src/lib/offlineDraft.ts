import type { Design, ProjectType } from "../types";

export interface PendingDraft {
  design: Design;
  name: string;
  projectType: ProjectType;
  baseRevision: number;
  savedAt: number;
}
const key = (userId: string, projectId: string) => `groundwork:draft:${userId}:${projectId}`;

/** Per-user, per-tab recovery. Never rebase a failed save onto a newer server revision. */
export function readPendingDraft(userId: string, projectId: string): PendingDraft | null {
  try {
    const text = sessionStorage.getItem(key(userId, projectId));
    if (!text) return null;
    const v = JSON.parse(text) as PendingDraft;
    if (!v.design?.room || !Array.isArray(v.design.furniture) || !Number.isInteger(v.baseRevision) || v.baseRevision < 0 || typeof v.name !== "string" || !Number.isFinite(v.savedAt)) return null;
    return v;
  } catch { return null; }
}
export function storePendingDraft(userId: string, projectId: string, draft: PendingDraft): boolean {
  try { sessionStorage.setItem(key(userId, projectId), JSON.stringify(draft)); return true; }
  catch { return false; }
}
export function clearPendingDraft(userId: string, projectId: string) {
  try { sessionStorage.removeItem(key(userId, projectId)); } catch { /* Storage can be disabled. */ }
}
