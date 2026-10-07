import type { WorkspaceKind } from "./workspaceApi";

export interface WorkspaceSavePreparationContext {
  projectId: string;
  userId: string;
  kind: WorkspaceKind;
  sourceRevision: number;
  baseWorkspaceRevision: number;
  referencedArtifactIds: string[];
  pendingFileCount: number;
  pendingFileBytes: number;
  signal: AbortSignal;
  /** Throws if cancelled, context changed, or any captured inputs/source/files changed. */
  assertActive: () => void;
}

export interface PreparedWorkspaceSave {
  payload: unknown;
  /** Additional managed references, unioned with manual and required references by the panel. */
  referencedArtifactIds: string[];
  /** Only artifacts newly uploaded by this invocation; each must be retained by the references. */
  uploadedArtifactIds: string[];
}

/**
 * Work only on the captured structured clone of bounded JSON inputs, preserving -0.
 * Check assertActive before/after awaited work; exact signed-zero positions are guarded.
 * Upload responses must be awaited and their IDs recorded even when cancellation arrives.
 * Before returning, the preparer owns cleanup on every thrown error/cancellation. After
 * returning, the panel owns cleanup if validation, later uploads, or revision commit fail.
 * Referenced artifacts must belong to this project/module. Historical sources remain
 * saveable without preparation; preparation requires the current project source revision.
 */
export type PrepareWorkspaceSave = (
  context: WorkspaceSavePreparationContext,
  payload: unknown,
) => Promise<PreparedWorkspaceSave>;
