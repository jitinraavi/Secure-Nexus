import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { exportLocalAccountData } from "../lib/accountLocalData";
import { downloadBlob } from "../lib/download";
import type { LocalDataChoice } from "../lib/signOutAccount";
import { Button, Modal } from "./ui";

export function SignOutDialog({ open, onClose, onSignedOut }: { open: boolean; onClose: () => void; onSignedOut: () => void }) {
  const { user, logout, signingOut, logoutError } = useAuth();
  const [choice, setChoice] = useState<LocalDataChoice>("preserve");
  const [acknowledged, setAcknowledged] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [localError, setLocalError] = useState("");
  const busy = useRef(false), generation = useRef(0);
  useEffect(() => {
    generation.current++;
    if (open) { setChoice("preserve"); setAcknowledged(false); setExportMessage(""); setLocalError(""); }
    return () => { generation.current++; };
  }, [open, user?.id]);
  const blocked = signingOut || exporting;
  const exportBackup = async () => {
    if (!user || busy.current) return;
    const userId = user.id, request = generation.current;
    busy.current = true; setExporting(true); setLocalError(""); setExportMessage("");
    try {
      const backup = await exportLocalAccountData(userId);
      if (request !== generation.current) return;
      downloadBlob(`groundwork-local-backup-${new Date().toISOString().slice(0, 10)}.zip`, backup);
      setExportMessage("Backup download started. Verify it is saved before removing local copies.");
    } catch (error) {
      if (request === generation.current) setLocalError(error instanceof Error ? error.message : "Local data could not be exported. Existing copies were retained.");
    } finally { busy.current = false; if (request === generation.current) setExporting(false); }
  };
  const submit = async () => {
    if (!user || busy.current || choice === "remove" && !acknowledged) return;
    busy.current = true; setLocalError("");
    try { await logout(choice); onSignedOut(); }
    catch (error) { setLocalError(error instanceof Error ? error.message : "Sign-out was not confirmed; you are still signed in."); }
    finally { busy.current = false; }
  };
  return <Modal open={open} onClose={() => { if (!blocked && !busy.current) onClose(); }} title="Sign out of Groundwork">
    <p className="text-sm leading-relaxed text-slate-400">Choose what happens to this account’s retained designs, recovery drafts, queued changes and source files on this browser. Saved server projects stay in your account.</p>
    <fieldset disabled={blocked} className="mt-5 space-y-3">
      <legend className="mb-2 text-sm font-semibold text-slate-200">Local account data</legend>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700 p-4"><input className="mt-1 accent-emerald-400" type="radio" name="logout-data" value="preserve" checked={choice === "preserve"} onChange={() => { setChoice("preserve"); setAcknowledged(false); }} /><span><strong className="block text-sm text-slate-100">Keep local copies</strong><span className="mt-1 block text-xs leading-relaxed text-slate-400">Retain unsynchronized work for this account’s next sign-in. Local copies are plaintext and remain accessible to someone using this browser profile.</span></span></label>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700 p-4"><input className="mt-1 accent-emerald-400" type="radio" name="logout-data" value="remove" checked={choice === "remove"} onChange={() => setChoice("remove")} /><span><strong className="block text-sm text-slate-100">Remove local copies</strong><span className="mt-1 block text-xs leading-relaxed text-slate-400">Delete this account’s retained copies from browser storage, including unsynchronized work. Close other Groundwork tabs first.</span></span></label>
      {choice === "remove" && <label className="flex items-start gap-3 text-sm text-amber-200"><input className="mt-1 accent-emerald-400" type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>I have saved a backup or accept losing this account’s unsynchronized local changes.</span></label>}
    </fieldset>
    <div className="mt-4 rounded-xl border border-slate-700 p-4"><Button type="button" variant="outline" size="sm" disabled={signingOut} loading={exporting} onClick={() => void exportBackup()}>Export local backup</Button><p className="mt-2 text-xs leading-relaxed text-slate-400">The ZIP contains plaintext designs and source files. Store it privately. Browser downloads require you to verify the file was saved.</p>{exportMessage && <p role="status" className="mt-2 text-xs text-emerald-300">{exportMessage}</p>}</div>
    {(localError || logoutError) && <p role="alert" className="mt-4 text-sm leading-relaxed text-rose-300">{localError || logoutError}</p>}
    <div className="mt-6 flex flex-wrap justify-end gap-3"><Button type="button" variant="ghost" disabled={blocked} onClick={onClose}>Stay signed in</Button><Button type="button" variant={choice === "remove" ? "danger" : "primary"} loading={signingOut} disabled={exporting || choice === "remove" && !acknowledged} onClick={() => void submit()}>{choice === "remove" ? "Remove local data & sign out" : logoutError ? "Retry sign-out" : "Keep local data & sign out"}</Button></div>
  </Modal>;
}
