export type CommitEffect = () => void | Promise<void>;

/** Committed records stay committed even if a notification transport is unavailable. */
export async function runCommitEffects(effects: CommitEffect[]): Promise<void> {
  for (const effect of effects) {
    try { await effect(); }
    catch (error) { console.error("[groundwork] Post-commit notification failed", { type: error instanceof Error ? error.name : "UnknownError" }); }
  }
}
