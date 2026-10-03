import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getProject, listProjects } from "../api";
import { useAuth } from "../auth";
import type { Project, ProjectDetail } from "../types";
import { download, downloadBlob, zipFiles } from "../lib/download";
import { deleteWorkspaceArtifact, getWorkspace, listWorkspaceArtifacts, MAX_WORKSPACE_BYTES, pruneWorkspaceHistory, readWorkspaceArtifact, saveWorkspace, uploadWorkspaceArtifact, WorkspaceApiError, type WorkspaceArtifact, type WorkspaceKind, type WorkspaceSnapshot, type WorkspaceState } from "../lib/workspaceApi";
import { listWorkspaceDrafts, removeWorkspaceDraft, workspaceDraftKey, writeWorkspaceDraft, type WorkspaceDraft } from "../lib/workspaceDraft";
import { Badge, Button, Card, Input, Select } from "./ui";

interface Props { kind: WorkspaceKind; payload: unknown; onRestore: (value: unknown) => void; onImportProject?: (project: ProjectDetail) => void }
interface Context {
  token: number; userId: string; projectId: string; kind: WorkspaceKind; key: string;
  ready: boolean; writable: boolean; blocked: boolean; autoDraft: boolean; baseRevision: number;
  text: string; initialText: string; source: number; references: string[]; draft: WorkspaceDraft | null;
  restoredDraft: WorkspaceDraft | null; acknowledged: Set<number>; timer?: number;
}
const message = (error: unknown) => error instanceof Error ? error.message : "Workspace operation failed.";
const MAX_DRAFT_BYTES = 256 * 1024 * 1024;
function serialize(payload: unknown): string {
  const text = JSON.stringify(payload);
  if (typeof text !== "string" || new Blob([text]).size > MAX_WORKSPACE_BYTES) throw new Error("Workspace JSON must be serializable and at most 64 MiB.");
  return text;
}
const sameReferences = (left: string[], right: string[]) => left.length === right.length && left.every(id => right.includes(id));
const sameFiles = (left: WorkspaceDraft["files"], right: WorkspaceDraft["files"]) => left.length === right.length && left.every((file, index) => file.name === right[index].name && file.type === right[index].type && file.blob === right[index].blob);
const sameDraftInputs = (left: WorkspaceDraft, right: WorkspaceDraft) => left.content === right.content && left.sourceRevision === right.sourceRevision && sameReferences(left.referencedArtifactIds, right.referencedArtifactIds) && sameFiles(left.files, right.files);
const matchesBaseline = (draft: WorkspaceDraft, context: Context) => draft.content === context.text && draft.sourceRevision === context.source && sameReferences(draft.referencedArtifactIds, context.references) && draft.files.length === 0;

export function ProjectWorkspacePanel({ kind, payload, onRestore, onImportProject }: Props) {
  const { user } = useAuth(), [params, setParams] = useSearchParams(), projectId = params.get("project") || "";
  const [projects, setProjects] = useState<Project[]>([]), [state, setState] = useState<WorkspaceState | null>(null);
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>([]), [references, setReferences] = useState<string[]>([]), [files, setFiles] = useState<File[]>([]);
  const [sourceRevision, setSourceRevision] = useState(0), [historyRevision, setHistoryRevision] = useState(0);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [dirty, setDirty] = useState(false);
  const [recoveries, setRecoveries] = useState<WorkspaceDraft[]>([]), [recoveryKey, setRecoveryKey] = useState(""), [durable, setDurable] = useState(true);
  const context = useRef<Context | null>(null), generation = useRef(0), alive = useRef(true), lastTimestamp = useRef(0);
  const identity = useRef({ userId: user?.id, projectId, kind }); identity.current = { userId: user?.id, projectId, kind };
  const latest = useRef({ payload, sourceRevision, references, files, state, onRestore, onImportProject });
  latest.current = { payload, sourceRevision, references, files, state, onRestore, onImportProject };
  const active = (ctx: Context) => alive.current && context.current === ctx && generation.current === ctx.token && identity.current.userId === ctx.userId && identity.current.projectId === ctx.projectId && identity.current.kind === ctx.kind;
  const canEdit = state?.project.role === "owner" || state?.project.role === "editor";
  const recovery = recoveries.find(item => item.key === recoveryKey) ?? recoveries[0];

  function draftFor(ctx: Context): WorkspaceDraft {
    const values = latest.current;
    const candidate: WorkspaceDraft = {
      key: ctx.key, version: 1, userId: ctx.userId, projectId: ctx.projectId, kind: ctx.kind,
      baseRevision: ctx.baseRevision, sourceRevision: values.sourceRevision, content: serialize(values.payload),
      referencedArtifactIds: [...values.references], files: values.files.map(file => ({ name: file.name, type: file.type, blob: file })), updatedAt: 0,
    };
    if (new Blob([candidate.content]).size + candidate.files.reduce((total, file) => total + file.blob.size, 0) > MAX_DRAFT_BYTES) throw new Error("Inputs and pending source files exceed the 256 MiB recovery limit.");
    if (ctx.draft && ctx.draft.baseRevision === candidate.baseRevision && sameDraftInputs(ctx.draft, candidate)) return ctx.draft;
    candidate.updatedAt = Math.max(Date.now(), lastTimestamp.current + 1); lastTimestamp.current = candidate.updatedAt;
    return candidate;
  }
  function storageFailure(ctx: Context, cause: unknown): void {
    if (active(ctx)) { setDurable(false); setNotice(`${message(cause)} Keep this page open or export the recovery bundle.`); }
  }
  async function persist(ctx: Context, draft: WorkspaceDraft): Promise<void> {
    if (ctx.blocked || ctx.acknowledged.has(draft.updatedAt)) return;
    await writeWorkspaceDraft(draft);
  }
  async function refreshArtifacts(ctx: Context): Promise<void> {
    const result = await listWorkspaceArtifacts(ctx.projectId, ctx.kind);
    if (active(ctx)) setArtifacts(result.artifacts);
  }
  async function refreshRecoveries(ctx: Context): Promise<void> {
    const drafts = await listWorkspaceDrafts(ctx.userId, ctx.projectId, ctx.kind);
    if (active(ctx)) {
      // Matching copies remain visible for export/removal; another tab may still own them.
      const pending = drafts;
      setRecoveries(pending); setRecoveryKey(current => pending.some(draft => draft.key === current) ? current : pending[0]?.key ?? "");
    }
  }
  async function preserveBeforeReplacement(ctx: Context): Promise<void> {
    const draft = draftFor(ctx);
    if (matchesBaseline(draft, ctx)) return;
    if (ctx.blocked) throw new Error("Browser recovery storage is blocked. Export your inputs and attachments before replacing them.");
    const copy = { ...draft, key: workspaceDraftKey(ctx.userId, ctx.projectId, ctx.kind, crypto.randomUUID()) };
    await writeWorkspaceDraft(copy);
    if (active(ctx)) {
      setRecoveries(current => [copy, ...current.filter(item => item.key !== copy.key)]); setRecoveryKey(copy.key);
      if (!sameDraftInputs(draftFor(ctx), draft)) throw new Error("Inputs changed while their recovery copy was being saved. Replacement was stopped; retry when ready.");
    }
  }
  async function applySnapshot(ctx: Context, snapshot: WorkspaceSnapshot, baseline: boolean, protect = false): Promise<boolean> {
    const text = await (await readWorkspaceArtifact(ctx.projectId, snapshot.payloadArtifactId)).text();
    if (!active(ctx)) return false;
    if (protect) { await preserveBeforeReplacement(ctx); if (!active(ctx)) return false; }
    else if (serialize(latest.current.payload) !== ctx.initialText) throw new Error("Page inputs changed while saved inputs were loading. Local inputs were retained; choose reload or an explicit replacement save.");
    const value: unknown = JSON.parse(text); latest.current.onRestore(value);
    if (ctx.timer !== undefined) window.clearTimeout(ctx.timer);
    if (baseline) { ctx.text = serialize(value); ctx.source = snapshot.sourceRevision; ctx.references = [...snapshot.referencedArtifactIds]; }
    ctx.restoredDraft = null; ctx.draft = null; ctx.autoDraft = true;
    setSourceRevision(snapshot.sourceRevision); setReferences([...snapshot.referencedArtifactIds]); setHistoryRevision(snapshot.revision); setFiles([]);
    setDirty(!baseline); return true;
  }

  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => {
    let live = true;
    void listProjects().then(items => { if (live) setProjects(items); }).catch(cause => { if (live) setError(message(cause)); });
    return () => { live = false; };
  }, [user?.id]);
  useEffect(() => {
    const token = ++generation.current;
    setReady(false); setBusy(Boolean(user && projectId)); setState(null); setArtifacts([]); setReferences([]); setFiles([]); setRecoveries([]); setRecoveryKey(""); setDurable(true); setError(""); setNotice(""); setDirty(false);
    if (!user || !projectId) { context.current = null; setBusy(false); return; }
    let initialText = ""; try { initialText = serialize(latest.current.payload); } catch { /* explicit saves report nonserializable inputs */ }
    const ctx: Context = { token, userId: user.id, projectId, kind, key: workspaceDraftKey(user.id, projectId, kind, crypto.randomUUID()), ready: false, writable: false, blocked: false, autoDraft: true, baseRevision: 0, text: "", initialText, source: 0, references: [], draft: null, restoredDraft: null, acknowledged: new Set() };
    context.current = ctx;
    void (async () => {
      try {
        const loaded = await getWorkspace(ctx.projectId, ctx.kind); if (!active(ctx)) return;
        ctx.baseRevision = loaded.workspace?.revision ?? 0; ctx.writable = loaded.project.role !== "viewer";
        setState(loaded);
        if (loaded.workspace) {
          try { if (!await applySnapshot(ctx, loaded.workspace, true)) return; }
          catch (cause) {
            if (!active(ctx)) return;
            ctx.autoDraft = false; ctx.source = loaded.workspace.sourceRevision; ctx.references = [...loaded.workspace.referencedArtifactIds];
            setSourceRevision(ctx.source); setReferences(ctx.references); setHistoryRevision(loaded.workspace.revision);
            setError(`${message(cause)} Saved metadata and history are retained. Restore a browser copy, export local inputs, or explicitly save a replacement revision. Automatic drafts are paused until recovery or save.`);
          }
        }
        else { ctx.source = loaded.project.revision; setSourceRevision(loaded.project.revision); setHistoryRevision(0); setNotice("No saved workspace yet. Save the current inputs to create its first revision."); }
        try { await refreshRecoveries(ctx); }
        catch (cause) { if (active(ctx)) { ctx.blocked = true; setDurable(false); setNotice(`${message(cause)} Existing browser data is preserved; new draft writes are blocked.`); } }
        if (!active(ctx)) return;
        ctx.ready = true; setReady(true);
        await refreshArtifacts(ctx);
      } catch (cause) { if (active(ctx)) { ctx.ready = false; setReady(false); setError(message(cause)); } }
      finally { if (active(ctx)) setBusy(false); }
    })();
    return () => {
      ctx.ready = false;
      if (ctx.timer !== undefined) window.clearTimeout(ctx.timer);
      const captured = ctx.draft;
      if (captured && !matchesBaseline(captured, ctx) && !ctx.acknowledged.has(captured.updatedAt) && !ctx.blocked) {
        // Queue the old project before the next load resets page state.
        void persist(ctx, captured).catch(cause => storageFailure(ctx, cause));
      }
    };
  }, [projectId, kind, user?.id]);
  useEffect(() => {
    const ctx = context.current;
    if (!ctx || !ctx.ready || !ready || !active(ctx) || !ctx.autoDraft || ctx.projectId !== projectId || !ctx.writable) return;
    let draft: WorkspaceDraft;
    try { draft = draftFor(ctx); } catch (cause) { setError(message(cause)); return; }
    const changed = !matchesBaseline(draft, ctx); setDirty(changed);
    if (ctx.timer !== undefined) window.clearTimeout(ctx.timer);
    if (!changed) { ctx.draft = null; return; }
    ctx.draft = draft;
    if (!ctx.blocked) ctx.timer = window.setTimeout(() => { void persist(ctx, draft).catch(cause => storageFailure(ctx, cause)); }, 700);
    return () => { if (ctx.timer !== undefined) window.clearTimeout(ctx.timer); };
  }, [payload, sourceRevision, references, files, ready, projectId, state?.workspace?.revision, canEdit]);
  useEffect(() => {
    const ctx = context.current; if (!ctx || !ready) return;
    const timer = window.setInterval(() => {
      void getWorkspace(ctx.projectId, ctx.kind).then(current => {
        if (active(ctx)) { ctx.writable = current.project.role !== "viewer"; setState(prior => prior ? { ...prior, project: current.project } : prior); }
      }).catch(cause => {
        if (active(ctx) && cause instanceof WorkspaceApiError && [401, 403, 404].includes(cause.status)) {
          ctx.ready = false; setReady(false); setError("Workspace access changed. Local inputs and recovery copies remain available for export.");
        }
      });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [ready, projectId, kind]);

  async function save(): Promise<void> {
    const ctx = context.current, current = latest.current.state;
    if (!ctx || !current || !active(ctx) || !ctx.ready || !ctx.writable || busy) return;
    const uploaded: string[] = []; setBusy(true); setError(""); setNotice("");
    try {
      const draft = draftFor(ctx), originalRecovery = ctx.restoredDraft; ctx.draft = draft;
      try { await persist(ctx, draft); } catch (cause) { storageFailure(ctx, cause); }
      const nextReferences = [...draft.referencedArtifactIds];
      if (nextReferences.length + draft.files.length > 16) throw new Error("A workspace revision can reference at most 16 source files.");
      for (const file of draft.files) { const artifact = await uploadWorkspaceArtifact(ctx.projectId, ctx.kind, file.blob, file.name); uploaded.push(artifact.id); nextReferences.push(artifact.id); }
      const artifact = await uploadWorkspaceArtifact(ctx.projectId, ctx.kind, new Blob([draft.content], { type: "application/json" }), `${ctx.kind}-workspace.json`); uploaded.push(artifact.id);
      if (!active(ctx)) throw new Error("Project changed before save; its browser draft is retained.");
      const saved = await saveWorkspace(ctx.projectId, ctx.kind, { baseWorkspaceRevision: draft.baseRevision, sourceRevision: draft.sourceRevision, payloadArtifactId: artifact.id, referencedArtifactIds: nextReferences });
      uploaded.length = 0;
      // Suppress scheduled/cleanup writes for this acknowledged snapshot, even after navigation.
      ctx.acknowledged.add(draft.updatedAt);
      const pending = ctx.draft;
      if (pending && sameDraftInputs(pending, draft)) { ctx.acknowledged.add(pending.updatedAt); ctx.draft = null; if (ctx.timer !== undefined) window.clearTimeout(ctx.timer); }
      ctx.text = draft.content; ctx.source = draft.sourceRevision; ctx.references = nextReferences; ctx.baseRevision = saved.workspace?.revision ?? draft.baseRevision; ctx.autoDraft = true;
      await removeWorkspaceDraft(draft.key, draft.updatedAt).catch(cause => storageFailure(ctx, cause));
      if (pending && pending.updatedAt !== draft.updatedAt && ctx.acknowledged.has(pending.updatedAt)) await removeWorkspaceDraft(pending.key, pending.updatedAt).catch(cause => storageFailure(ctx, cause));
      if (originalRecovery && sameDraftInputs(originalRecovery, draft)) {
        await removeWorkspaceDraft(originalRecovery.key, originalRecovery.updatedAt).catch(cause => storageFailure(ctx, cause));
      }
      if (!active(ctx)) return;
      const values = latest.current;
      setState(saved); setReferences(nextReferences); setFiles([]); setHistoryRevision(saved.workspace?.revision ?? 0); setNotice("Workspace revision saved."); ctx.restoredDraft = null;
      setDirty(serialize(values.payload) !== draft.content || values.sourceRevision !== draft.sourceRevision);
      await Promise.all([refreshArtifacts(ctx), refreshRecoveries(ctx)]);
    } catch (cause) {
      // A response lost after commit cannot delete artifacts protected by server references.
      for (const id of uploaded) await deleteWorkspaceArtifact(ctx.projectId, id).catch(() => undefined);
      if (active(ctx)) setError(cause instanceof WorkspaceApiError && cause.status === 409 ? `${message(cause)} Your edits remain here. Refresh server metadata to save another revision, or reload saved inputs.` : message(cause));
    } finally { if (active(ctx)) setBusy(false); }
  }
  async function refresh(restore: boolean): Promise<void> {
    const ctx = context.current; if (!ctx || !active(ctx) || busy) return; setBusy(true); setError("");
    try {
      const loaded = await getWorkspace(ctx.projectId, ctx.kind); if (!active(ctx)) return;
      ctx.baseRevision = loaded.workspace?.revision ?? 0; ctx.writable = loaded.project.role !== "viewer"; ctx.ready = true; setState(loaded); setReady(true);
      if (restore && loaded.workspace) {
        try { if (!await applySnapshot(ctx, loaded.workspace, true, true)) return; }
        catch (cause) { if (!active(ctx)) return; ctx.autoDraft = false; setError(`${message(cause)} Saved metadata remains available; local inputs were retained.`); await Promise.all([refreshArtifacts(ctx), refreshRecoveries(ctx)]); return; }
      }
      await Promise.all([refreshArtifacts(ctx), refreshRecoveries(ctx)]);
      if (active(ctx)) setNotice(restore ? "Saved inputs loaded. Previous local edits remain in browser recovery copies." : "Server metadata refreshed. Local inputs and source-file choices remain intact.");
    } catch (cause) { if (active(ctx)) setError(message(cause)); } finally { if (active(ctx)) setBusy(false); }
  }
  async function restoreHistory(): Promise<void> {
    const ctx = context.current, selected = state?.history.find(item => item.revision === historyRevision);
    if (!ctx || !selected || !active(ctx) || busy) return; setBusy(true); setError("");
    try { if (await applySnapshot(ctx, selected, selected.revision === state?.workspace?.revision, true)) setNotice("Revision inputs loaded. Saving creates another immutable revision; previous local edits remain recoverable."); }
    catch (cause) { if (active(ctx)) setError(message(cause)); } finally { if (active(ctx)) setBusy(false); }
  }
  function exportPage(): void { try { download(`${kind}-workspace-inputs.json`, serialize(latest.current.payload), "application/json"); } catch (cause) { setError(message(cause)); } }
  async function exportRecovery(draft: WorkspaceDraft): Promise<void> {
    const ctx = context.current, token = generation.current;
    try {
      const entries = draft.files.map((file, index) => ({ name: `sources/${index + 1}-${file.name.replace(/[\\/\u0000-\u001f\u007f]/g, "_") || "source.bin"}`, content: file.blob }));
      const metadata = { ...draft, content: undefined, files: draft.files.map((file, index) => ({ name: file.name, type: file.type, size: file.blob.size, archivePath: entries[index].name })) };
      const bundle = await zipFiles([{ name: "workspace-inputs.json", content: draft.content }, { name: "draft-metadata.json", content: JSON.stringify(metadata, null, 2) }, ...entries]);
      if (alive.current && generation.current === token && (!ctx || active(ctx))) downloadBlob(`${draft.kind}-workspace-recovery.zip`, bundle);
    } catch (cause) { if (alive.current && generation.current === token && (!ctx || active(ctx))) setError(message(cause)); }
  }
  async function recoverDraft(draft: WorkspaceDraft): Promise<void> {
    const ctx = context.current; if (!ctx || !active(ctx) || busy) return; setBusy(true); setError("");
    try {
      if (draft.userId !== ctx.userId || draft.projectId !== ctx.projectId || draft.kind !== ctx.kind) throw new Error("Draft belongs to another workspace.");
      await preserveBeforeReplacement(ctx); if (!active(ctx)) return;
      const value: unknown = JSON.parse(draft.content), restoredFiles = draft.files.map(file => new File([file.blob], file.name, { type: file.type }));
      latest.current.onRestore(value); ctx.restoredDraft = { ...draft, files: restoredFiles.map(file => ({ name: file.name, type: file.type, blob: file })) }; ctx.draft = null; ctx.autoDraft = true;
      setSourceRevision(draft.sourceRevision); setReferences([...draft.referencedArtifactIds]); setFiles(restoredFiles); setDirty(true); setNotice("Browser inputs and source files restored locally. Saving uses the displayed server revision and preserves conflicts.");
    } catch (cause) { if (active(ctx)) setError(message(cause)); } finally { if (active(ctx)) setBusy(false); }
  }
  async function discardRecovery(draft: WorkspaceDraft): Promise<void> {
    const ctx = context.current; if (!ctx || !active(ctx) || busy) return; setBusy(true); setError("");
    try { await removeWorkspaceDraft(draft.key, draft.updatedAt); if (active(ctx)) await refreshRecoveries(ctx); }
    catch (cause) { if (active(ctx)) setError(message(cause)); } finally { if (active(ctx)) setBusy(false); }
  }
  async function attachProjectModel(): Promise<void> {
    const ctx = context.current, importModel = latest.current.onImportProject;
    if (!ctx || !importModel || !active(ctx) || !ready || busy) return; setBusy(true); setError("");
    try { const project = await getProject(ctx.projectId); if (!active(ctx)) return; await preserveBeforeReplacement(ctx); if (!active(ctx)) return; importModel(project); setSourceRevision(project.revision); setDirty(true); setNotice("Editor model imported. Review its inputs and assumptions before calculation or saving."); }
    catch (cause) { if (active(ctx)) setError(message(cause)); } finally { if (active(ctx)) setBusy(false); }
  }
  async function pruneHistory(): Promise<void> {
    const ctx = context.current; if (!ctx || !active(ctx) || busy || !ctx.writable) return; setBusy(true); setError("");
    try { await pruneWorkspaceHistory(ctx.projectId, ctx.kind, historyRevision); const loaded = await getWorkspace(ctx.projectId, ctx.kind); if (active(ctx)) { setState(loaded); ctx.baseRevision = loaded.workspace?.revision ?? 0; setNotice("Earlier history pruned. Unreferenced artifacts can now be removed."); } }
    catch (cause) { if (active(ctx)) setError(message(cause)); } finally { if (active(ctx)) setBusy(false); }
  }
  async function downloadArtifact(artifact: WorkspaceArtifact): Promise<void> {
    const ctx = context.current; if (!ctx || !active(ctx)) return;
    try { const blob = await readWorkspaceArtifact(ctx.projectId, artifact.id); if (active(ctx)) downloadBlob(artifact.name, blob); }
    catch (cause) { if (active(ctx)) setError(message(cause)); }
  }
  async function removeArtifact(artifact: WorkspaceArtifact): Promise<void> {
    const ctx = context.current; if (!ctx || !active(ctx) || busy || !ctx.writable) return; setBusy(true); setError("");
    try { await deleteWorkspaceArtifact(ctx.projectId, artifact.id); if (active(ctx)) await refreshArtifacts(ctx); }
    catch (cause) { if (active(ctx)) setError(message(cause)); } finally { if (active(ctx)) setBusy(false); }
  }
  function selectSources(selected: File[]): void {
    try {
      if (selected.some(file => file.size === 0 || file.size > MAX_WORKSPACE_BYTES || !file.name || file.name.length > 240 || file.type.length > 256) || references.length + selected.length > 16) throw new Error("Source files exceed workspace limits, have oversized metadata, or are empty.");
      if (new Blob([serialize(latest.current.payload)]).size + selected.reduce((total, file) => total + file.size, 0) > MAX_DRAFT_BYTES) throw new Error("Inputs and source files exceed the 256 MiB browser recovery limit.");
      setFiles(selected); setError("");
    } catch (cause) { setError(message(cause)); }
  }

  return <Card className="space-y-3 p-4">
    <div className="flex flex-wrap items-center gap-3"><h2 className="font-semibold">Saved project workspace</h2>{state && <Badge tone={sourceRevision === state.project.revision ? "emerald" : "amber"}>{sourceRevision === state.project.revision ? "Source revision current" : `Stale source: ${sourceRevision}; project: ${state.project.revision}`}</Badge>}{dirty && <Badge tone="amber">Unsaved inputs</Badge>}</div>
    <Select label="Project" value={projectId} disabled={busy} onChange={event => { const next = new URLSearchParams(params); if (event.target.value) next.set("project", event.target.value); else next.delete("project"); setParams(next); }}><option value="">Standalone workspace</option>{projectId && !projects.some(project => project.id === projectId) && <option value={projectId}>{state?.project.name || projectId}</option>}{projects.map(project => <option key={project.id} value={project.id}>{project.name} · {project.role}</option>)}</Select>
    {!projectId && <p className="text-xs text-slate-400">Select a project to save inputs, reports and source files. Standalone calculations remain available.</p>}
    {state && <><p className="text-xs text-slate-400">{state.project.role} access · workspace revision {state.workspace?.revision ?? 0} · source project revision {sourceRevision}. Workspace saves preserve CAD geometry and its revision.</p>
      <div className="flex flex-wrap gap-2"><Button disabled={!ready || !canEdit || busy} loading={busy} onClick={() => { void save(); }}>Save as new revision</Button><Button variant="secondary" disabled={busy} onClick={() => { void refresh(true); }}>Reload saved workspace</Button><Button variant="outline" disabled={busy} onClick={() => { void refresh(false); }}>Refresh server metadata</Button><Button variant="outline" onClick={exportPage}>Export page inputs</Button>{context.current?.draft && <Button variant="outline" onClick={() => { const draft = context.current?.draft; if (draft) void exportRecovery(draft); }}>Export current recovery bundle</Button>}{onImportProject && <Button variant="secondary" disabled={!ready || busy} onClick={() => { void attachProjectModel(); }}>Import linked editor model</Button>}<Link className="self-center text-sm text-cyan-300" to={`/editor/${encodeURIComponent(projectId)}`}>Open project editor</Link></div>
      {state.history.length > 0 && <div className="flex flex-wrap items-end gap-2"><Select label="Saved revisions" value={historyRevision} disabled={busy} onChange={event => setHistoryRevision(Number(event.target.value))}>{state.history.map(item => <option key={item.revision} value={item.revision}>Revision {item.revision} · source {item.sourceRevision} · {new Date(item.updatedAt * 1000).toLocaleString()}</option>)}</Select><Button variant="outline" disabled={busy} onClick={() => { void restoreHistory(); }}>Load revision</Button>{canEdit && <Button variant="ghost" disabled={busy || historyRevision < 2} onClick={() => { void pruneHistory(); }}>Prune revisions older than selected</Button>}</div>}
      {canEdit && <Input label="Attach original source files (64 MiB each, at most 16 references)" type="file" multiple disabled={busy} onChange={event => { const selected = Array.from(event.target.files || []); event.target.value = ""; selectSources(selected); }} />}
      {files.map((file, index) => <div className="flex items-center gap-2 text-xs text-slate-400" key={`${file.name}:${index}`}><span>Pending source: {file.name} · {(file.size / 1048576).toFixed(1)} MiB</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => setFiles(current => current.filter((_, position) => position !== index))}>Remove pending</Button></div>)}
      {references.filter(id => !artifacts.some(artifact => artifact.id === id)).map(id => <div className="flex items-center gap-2 text-xs text-amber-300" key={id}><span>Referenced source unavailable: {id}</span>{canEdit && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReferences(current => current.filter(value => value !== id))}>Detach from next revision</Button>}</div>)}
      <details><summary className="cursor-pointer text-sm">Stored sources and workspace payloads ({artifacts.length})</summary><div className="mt-2 max-h-60 space-y-2 overflow-auto">{artifacts.map(artifact => <div key={artifact.id} className="flex flex-wrap items-center gap-2 text-xs"><span>{artifact.name} · {(artifact.size / 1048576).toFixed(1)} MiB</span><Button size="sm" variant="ghost" onClick={() => { void downloadArtifact(artifact); }}>Download</Button>{references.includes(artifact.id) && canEdit && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReferences(current => current.filter(id => id !== artifact.id))}>Detach from next revision</Button>}{canEdit && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void removeArtifact(artifact); }}>Remove unreferenced</Button>}</div>)}</div></details>
    </>}
    {recovery && <div className="space-y-2 rounded border border-amber-700 p-3"><Select label="Browser recovery copies" value={recovery.key} disabled={busy} onChange={event => setRecoveryKey(event.target.value)}>{recoveries.map(draft => <option key={draft.key} value={draft.key}>{new Date(draft.updatedAt).toLocaleString()} · workspace {draft.baseRevision} · {draft.files.length} pending sources</option>)}</Select><p className="text-xs">Source revision {recovery.sourceRevision}. Recovery includes inputs, references and pending source files; saved server history remains intact.</p><div className="flex flex-wrap gap-2"><Button disabled={busy || !ready} onClick={() => { void recoverDraft(recovery); }}>Restore recovery copy</Button><Button variant="outline" onClick={() => { void exportRecovery(recovery); }}>Export recovery ZIP</Button><Button variant="ghost" disabled={busy} onClick={() => { void discardRecovery(recovery); }}>Remove recovery copy</Button></div></div>}
    {!durable && <p className="text-xs text-amber-300">Browser storage is unavailable or blocked. Keep this page open or export inputs and source files.</p>}
    {notice && <p role="status" className="text-xs text-slate-400">{notice}</p>}{error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
  </Card>;
}
