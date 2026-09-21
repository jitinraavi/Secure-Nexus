import { useEffect, useState } from "react";
import {
  createProjectRevision,
  createProjectShareLink,
  listProjectRevisions,
  listProjectShareLinks,
  restoreProjectRevision,
  revokeProjectShareLink,
} from "../api";
import type { Design, ProjectRevision, ProjectShareLink, ProjectType } from "../types";
import { Badge, Button, Input, Modal } from "./ui";
import { useToast } from "./Toast";
import { timeAgo } from "../lib/format";

export function ProjectHistory({
  projectId,
  currentDesign,
  onRestored,
}: {
  projectId: string;
  currentDesign: Design;
  onRestored: (state: { design: Design | null; projectType: ProjectType; widthMm: number; depthMm: number }) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState<ProjectRevision[]>([]);
  const [links, setLinks] = useState<ProjectShareLink[]>([]);
  const [snapshotName, setSnapshotName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void Promise.all([listProjectRevisions(projectId), listProjectShareLinks(projectId)])
      .then(([nextRevisions, nextLinks]) => { setRevisions(nextRevisions); setLinks(nextLinks); })
      .catch((err) => toast.push({ title: "Could not load project history", description: err instanceof Error ? err.message : undefined, tone: "error" }));
  }, [open, projectId, toast]);

  const snapshot = async () => {
    if (!snapshotName.trim()) return;
    setBusy("snapshot");
    try {
      const created = await createProjectRevision(projectId, snapshotName.trim(), JSON.stringify(currentDesign));
      setRevisions((current) => [created, ...current]);
      setSnapshotName("");
      toast.push({ title: "Snapshot saved", tone: "success" });
    } catch (err) {
      toast.push({ title: "Snapshot failed", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally { setBusy(null); }
  };

  const restore = async (revision: ProjectRevision) => {
    if (!window.confirm(`Restore “${revision.name}”? Current unsnapshotted changes will be replaced.`)) return;
    setBusy(revision.id);
    try {
      const restored = await restoreProjectRevision(projectId, revision.id);
      onRestored({ design: restored.design, projectType: restored.projectType as ProjectType, widthMm: restored.widthMm, depthMm: restored.depthMm });
      toast.push({ title: "Snapshot restored", description: revision.name, tone: "success" });
    } catch (err) {
      toast.push({ title: "Restore failed", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally { setBusy(null); }
  };

  const share = async () => {
    setBusy("share");
    try {
      const created = await createProjectShareLink(projectId);
      const url = `${window.location.origin}${created.url}`;
      setNewUrl(url);
      setLinks(await listProjectShareLinks(projectId));
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      toast.push({ title: "Read-only link created", description: "The link was copied when browser permissions allowed it.", tone: "success" });
    } catch (err) {
      toast.push({ title: "Could not create share link", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally { setBusy(null); }
  };

  const revoke = async (link: ProjectShareLink) => {
    setBusy(link.id);
    try {
      await revokeProjectShareLink(projectId, link.id);
      setLinks((current) => current.map((item) => item.id === link.id ? { ...item, active: false, revokedAt: Date.now() / 1000 } : item));
    } catch (err) {
      toast.push({ title: "Could not revoke link", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally { setBusy(null); }
  };

  return <>
    <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label="Open project history">
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 109-9 9 9 0 00-7 3" /><path d="M3 4v5h5M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      History
    </Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Project history & sharing">
      <div className="space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Save current design</p>
          <div className="mt-2 flex gap-2">
            <Input className="min-w-0" placeholder="e.g. Client review" value={snapshotName} onChange={(e) => setSnapshotName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void snapshot(); }} />
            <Button size="sm" onClick={() => void snapshot()} loading={busy === "snapshot"} disabled={!snapshotName.trim()}>Save</Button>
          </div>
          <p className="mt-1 text-xs text-slate-500">Snapshots are encrypted at rest and owned by this account.</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Snapshots</p>
          {revisions.length === 0 ? <p className="mt-2 text-sm text-slate-500">No named snapshots yet.</p> : <div className="mt-2 space-y-2">
            {revisions.map((revision) => <div key={revision.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-200">{revision.name}</p><p className="text-xs text-slate-500">{timeAgo(revision.createdAt)}</p></div>
              <Button variant="ghost" size="sm" onClick={() => void restore(revision)} loading={busy === revision.id}>Restore</Button>
            </div>)}
          </div>}
        </div>
        <div>
          <div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Read-only links</p><p className="mt-1 text-xs text-slate-500">Links expire after 7 days and never grant edit access.</p></div><Button size="sm" variant="outline" onClick={() => void share()} loading={busy === "share"}>Create link</Button></div>
          {newUrl && <div className="mt-2 break-all rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-300">{newUrl}</div>}
          <div className="mt-2 space-y-2">{links.map((link) => <div key={link.id} className="flex items-center gap-2 text-xs"><Badge tone={link.active ? "emerald" : "slate"}>{link.active ? "Active" : "Inactive"}</Badge><span className="flex-1 text-slate-500">expires {new Date(link.expiresAt * 1000).toLocaleDateString()}</span>{link.active && <Button variant="ghost" size="sm" onClick={() => void revoke(link)} loading={busy === link.id}>Revoke</Button>}</div>)}</div>
        </div>
      </div>
    </Modal>
  </>;
}
