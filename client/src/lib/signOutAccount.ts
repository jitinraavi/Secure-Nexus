import { confirmLocalSignOut, fenceLocalAccount, flushLocalDrafts, localAccountFence, resumeAuthenticatedLocalAccount, resumeLocalAccount } from "./localDataFence";
import { finishAccountDraftWrites } from "./workspaceDraft";
import { removeLocalAccountData } from "./accountLocalData";

export type LocalDataChoice = "preserve" | "remove";
/** A rejected request never counts as sign-out; destructive local cleanup is explicit. */
export async function signOutAccount(userId: string, choice: LocalDataChoice, request: () => Promise<unknown>): Promise<void> {
  await flushLocalDrafts(userId);
  await finishAccountDraftWrites(userId);
  const fence = fenceLocalAccount(userId, choice === "remove");
  let removed = false;
  try {
    if (choice === "remove") { await removeLocalAccountData(userId, fence); removed = true; }
    await request();
    confirmLocalSignOut(userId, fence);
  } catch (cause) {
    resumeLocalAccount(userId, fence);
    const reason = cause instanceof Error ? cause.message : "The request failed.";
    throw new Error(`${removed ? "Local copies were removed. " : ""}Sign-out was not confirmed; you are still signed in. ${reason}`);
  }
}

/** A fresh verified sign-in replaces abandoned work; it completes a consented purge before allowing writes. */
export async function recoverLocalAccountAfterSignIn(userId: string, started: ReadonlyMap<string, string>): Promise<boolean> {
  const previous = localAccountFence(userId);
  if (previous.token !== (started.get(userId) ?? "initial")) return false;
  if (!previous.blocked || previous.signedOut) return resumeAuthenticatedLocalAccount(userId, started);
  // Rotate first: any older live purge must abort before it can touch post-recovery data.
  const replacement = fenceLocalAccount(userId, previous.remove);
  if (previous.remove) await removeLocalAccountData(userId, replacement);
  return resumeLocalAccount(userId, replacement);
}
