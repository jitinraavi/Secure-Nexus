import { useEffect, useMemo, useState } from "react";
import {
  addProjectMember,
  acquireProjectLock,
  releaseProjectLock,
  subscribeToProject,
  createCollaborationItem,
  listCollaborationItems,
  listProjectLocks,
  listProjectMembers,
  removeProjectMember,
  updateCollaborationItem,
  updateProjectMember,
} from "../api";
import type { CollaborationItem, ProjectMember, ProjectObjectLock } from "../types";
import { Badge, Button, Input, Modal, Select } from "./ui";
import { useToast } from "./Toast";

export function TeamCollaborationPanel({ projectId }: { projectId: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [currentRole, setCurrentRole] = useState<ProjectMember["role"]>("viewer");
  const [items, setItems] = useState<CollaborationItem[]>([]);
  const [locks, setLocks] = useState<ProjectObjectLock[]>([]);
  const [identifier, setIdentifier] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [kind, setKind] = useState<"comment" | "issue">("comment");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [objectId, setObjectId] = useState("__project__");
  const [presenceCount, setPresenceCount] = useState(0);

  const load = async () => {
    const [memberResult, nextItems, nextLocks] = await Promise.all([
      listProjectMembers(projectId),
      listCollaborationItems(projectId),
      listProjectLocks(projectId),
    ]);
    setMembers(memberResult.members);
    setCurrentRole(memberResult.currentRole);
    setItems(nextItems);
    setLocks(nextLocks);
  };

  useEffect(() => {
    if (!open) return;
    void load().catch((error) => toast.push({ title: "Could not load collaboration", description: error instanceof Error ? error.message : undefined, tone: "error" }));
    const unsubscribe = subscribeToProject(projectId, () => {
      void load().catch(() => {});
    }, () => {}, presence => setPresenceCount(presence.count));
    const timer = window.setInterval(() => void load().catch(() => {}), 15000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [open, projectId]);

  const activeLocks = useMemo(() => locks.filter((lock) => lock.expiresAt * 1000 > Date.now()), [locks]);

  const invite = async () => {
    if (!identifier.trim()) return;
    setBusy("invite");
    try {
      await addProjectMember(projectId, identifier.trim(), inviteRole);
      setIdentifier("");
      await load();
      toast.push({ title: "Project access updated", tone: "success" });
    } catch (error) {
      toast.push({ title: "Could not add member", description: error instanceof Error ? error.message : undefined, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const post = async () => {
    if (!body.trim()) return;
    setBusy("post");
    try {
      const created = await createCollaborationItem(projectId, kind, body.trim());
      setItems((current) => [created, ...current]);
      setBody("");
    } catch (error) {
      toast.push({ title: "Could not post collaboration item", description: error instanceof Error ? error.message : undefined, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return <>
    <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Team</Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Team collaboration">
      <div className="space-y-5">
        <section>
          <div className="flex items-center justify-between"><p className="gw-kicker">Members</p><Badge tone={currentRole === "owner" ? "emerald" : currentRole === "editor" ? "cyan" : "slate"}>{currentRole}</Badge></div>
          {currentRole === "owner" && <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Email or username" />
            <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}><option value="editor">Editor</option><option value="viewer">Viewer</option></Select>
            <Button size="sm" onClick={() => void invite()} loading={busy === "invite"} disabled={!identifier.trim()}>Add</Button>
          </div>}
          <div className="mt-3 space-y-2">
            {members.map((member) => <div key={member.userId} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-xs">
              <div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-200">{member.username || member.email}</p><p className="truncate text-slate-500">{member.email}</p></div>
              {member.role === "owner" || currentRole !== "owner" ? <Badge tone={member.role === "owner" ? "emerald" : member.role === "editor" ? "cyan" : "slate"}>{member.role}</Badge> : <>
                <Select value={member.role} onChange={(e) => void updateProjectMember(projectId, member.userId, e.target.value as "editor" | "viewer").then(load).catch((error) => toast.push({ title: "Role update failed", description: error instanceof Error ? error.message : undefined, tone: "error" }))}>
                  <option value="editor">Editor</option><option value="viewer">Viewer</option>
                </Select>
                <Button size="sm" variant="danger" onClick={() => void removeProjectMember(projectId, member.userId).then(load).catch((error) => toast.push({ title: "Remove failed", description: error instanceof Error ? error.message : undefined, tone: "error" }))}>Remove</Button>
              </>}
            </div>)}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between"><p className="gw-kicker">Presence & object locks</p><Badge tone={activeLocks.length ? "amber" : "slate"}>{activeLocks.length} active locks</Badge></div>
          <p className="mt-2 text-xs text-slate-400">{presenceCount} connected collaborator(s)</p>
          {currentRole !== "viewer" && <div className="mt-2 flex flex-wrap gap-2">
            <Input label="Object ID (or __project__)" value={objectId} maxLength={200} onChange={e => setObjectId(e.target.value)} />
            <Button size="sm" disabled={!objectId.trim()} onClick={() => void acquireProjectLock(projectId, objectId.trim(), 90).then(load).catch(error => toast.push({ title: "Lock failed", description: error instanceof Error ? error.message : undefined, tone: "error" }))}>Lock / renew for 90s</Button>
            <Button size="sm" variant="ghost" disabled={!objectId.trim()} onClick={() => void releaseProjectLock(projectId, objectId.trim()).then(load).catch(error => toast.push({ title: "Unlock failed", description: error instanceof Error ? error.message : undefined, tone: "error" }))}>Release</Button>
          </div>}
          <div className="mt-2 space-y-1 text-xs text-slate-400">
            {activeLocks.length === 0 ? <p>No active object locks.</p> : activeLocks.map((lock) => <p key={lock.objectId}>{lock.objectId} · user {lock.userId.slice(0, 8)} · expires {new Date(lock.expiresAt * 1000).toLocaleTimeString()}</p>)}
          </div>
        </section>

        <section>
          <p className="gw-kicker">Comments & issues</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr_auto]">
            <Select value={kind} onChange={(e) => setKind(e.target.value as "comment" | "issue")}><option value="comment">Comment</option><option value="issue">Issue</option></Select>
            <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a coordination note" onKeyDown={(e) => { if (e.key === "Enter") void post(); }} />
            <Button size="sm" onClick={() => void post()} loading={busy === "post"} disabled={!body.trim()}>Post</Button>
          </div>
          <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
            {items.map((item) => <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
              <div className="flex items-center gap-2"><Badge tone={item.kind === "issue" ? "amber" : "cyan"}>{item.kind}</Badge><Badge tone={item.status === "resolved" ? "emerald" : "slate"}>{item.status}</Badge></div>
              <p className="mt-1 text-sm text-slate-200">{item.body || "Encrypted collaboration item"}</p>
              {item.kind === "issue" && currentRole !== "viewer" && <Button className="mt-2" size="sm" variant="ghost" onClick={() => void updateCollaborationItem(projectId, item.id, item.status === "resolved" ? "open" : "resolved").then(load).catch(error => toast.push({ title: "Issue update failed", description: error instanceof Error ? error.message : undefined, tone: "error" }))}>{item.status === "resolved" ? "Reopen" : "Resolve"}</Button>}
            </div>)}
          </div>
        </section>
      </div>
    </Modal>
  </>;
}

