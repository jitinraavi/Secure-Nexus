export interface CapacityProject { projectId: string; sizeBytes: number; lastAccessedAt: number }
export interface CapacitySnapshot { projectId: string; snapshotId: string; sizeBytes: number; createdAt: number }
export interface CacheBudget { maxBytes: number; maxProjects: number; maxSnapshots: number }
export class CacheCapacityError extends Error {
  constructor() { super("Browser cache is full. Pending changes and protected recovery copies were kept; this item could not be cached."); this.name = "CacheCapacityError"; }
}

/** Plan the entire write before evicting anything. Replacements consume no new slot. */
export function planCacheWrite(
  projects: readonly CapacityProject[], snapshots: readonly CapacitySnapshot[],
  incoming: { project?: CapacityProject; snapshot?: CapacitySnapshot },
  protectedIds: ReadonlySet<string>, budget: CacheBudget,
) {
  const project = incoming.project, snapshot = incoming.snapshot;
  const bytes = (size: number) => Number.isSafeInteger(size) && size >= 0 ? size : budget.maxBytes + 1;
  const oldProject = project && projects.find(item => item.projectId === project.projectId);
  const oldSnapshot = snapshot && snapshots.find(item => item.projectId === snapshot.projectId && item.snapshotId === snapshot.snapshotId);
  let projectedCount = projects.length + (project && !oldProject ? 1 : 0);
  let projectedBytes = projects.reduce((sum, item) => sum + bytes(item.sizeBytes), 0)
    + snapshots.reduce((sum, item) => sum + bytes(item.sizeBytes), 0)
    - (oldProject ? bytes(oldProject.sizeBytes) : 0) - (oldSnapshot ? bytes(oldSnapshot.sizeBytes) : 0)
    + (project ? bytes(project.sizeBytes) : 0) + (snapshot ? bytes(snapshot.sizeBytes) : 0);
  const removeProjects: string[] = [], removeSnapshots: CapacitySnapshot[] = [];
  if (snapshot) {
    const existing = snapshots.filter(item => item.projectId === snapshot.projectId && item.snapshotId !== snapshot.snapshotId)
      .sort((a, b) => a.createdAt - b.createdAt || a.snapshotId.localeCompare(b.snapshotId));
    const excess = Math.max(0, existing.length + 1 - budget.maxSnapshots);
    if (excess && protectedIds.has(snapshot.projectId)) throw new CacheCapacityError();
    for (const item of existing.slice(0, excess)) { removeSnapshots.push(item); projectedBytes -= bytes(item.sizeBytes); }
  }
  const fits = () => projectedCount <= budget.maxProjects && projectedBytes <= budget.maxBytes;
  const candidates = projects.filter(item => !protectedIds.has(item.projectId)
    && item.projectId !== project?.projectId && item.projectId !== snapshot?.projectId)
    .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt || a.projectId.localeCompare(b.projectId));
  for (const candidate of candidates) {
    if (fits()) break;
    removeProjects.push(candidate.projectId); projectedCount--; projectedBytes -= bytes(candidate.sizeBytes);
    for (const item of snapshots.filter(item => item.projectId === candidate.projectId)) {
      removeSnapshots.push(item); projectedBytes -= bytes(item.sizeBytes);
    }
  }
  if (!fits()) throw new CacheCapacityError();
  return { removeProjects, removeSnapshots, projectedCount, projectedBytes };
}
