import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { downloadBlob } from "../lib/download";
import { cancelProjectJob, deleteProjectJob, JobsApiError, listProjectJobs, MAX_NATIVE_INPUT_BYTES, readJobArtifact, submitProjectJob, type NativeJobKind, type NativeJobState, type ProjectJob, type ProjectJobsState } from "../lib/jobsApi";
import { parseNativeFrameResult } from "../lib/nativeResults";
import { uploadWorkspaceArtifact, type WorkspaceArtifact, type WorkspaceKind } from "../lib/workspaceApi";
import { Badge, Button, Card, Input, Select } from "./ui";

interface Props {
  workspaceKind: WorkspaceKind; kinds: NativeJobKind[];
  prepareInput?: (kind: NativeJobKind) => { blob: Blob; name: string };
  preparedInputLabel?: string;
}
interface Context {
  token: number; userId: string; projectId: string; kind: WorkspaceKind;
  controller: AbortController; refreshing: boolean; lastPoll: number; revoked: boolean;
}
interface PendingSubmission {
  kind: NativeJobKind; artifact: WorkspaceArtifact; sourceRevision: number; idempotencyKey: string;
}
const labels: Record<NativeJobKind, string> = { "dwg-to-dxf": "DWG to DXF", "dxf-to-dwg": "DXF to DWG", "opensees-static": "OpenSees static frame" };
const activeState = (state: NativeJobState) => state === "queued" || state === "running";
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Native job operation failed.";
const tone = (state: NativeJobState): "cyan" | "emerald" | "rose" | "slate" => state === "succeeded" ? "emerald" : state === "failed" ? "rose" : activeState(state) ? "cyan" : "slate";

/** Job outputs remain bound to their immutable uploaded input, never to current page edits. */
export function ProjectJobsPanel({ workspaceKind, kinds, prepareInput, preparedInputLabel }: Props) {
  const { user } = useAuth(), [params] = useSearchParams(), projectId = params.get("project") || "";
  const [state, setState] = useState<ProjectJobsState | null>(null), [kind, setKind] = useState<NativeJobKind>(kinds[0] ?? "opensees-static");
  const [file, setFile] = useState<File | null>(null), [pending, setPending] = useState<PendingSubmission | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [nativeReport, setNativeReport] = useState<{ jobId: string; data: Awaited<ReturnType<typeof parseNativeFrameResult>> } | null>(null);
  const context = useRef<Context | null>(null), generation = useRef(0), alive = useRef(true);
  const identity = useRef({ userId: user?.id, projectId, workspaceKind }); identity.current = { userId: user?.id, projectId, workspaceKind };
  const latest = useRef({ state, pending, file, kind, kinds, prepareInput }); latest.current = { state, pending, file, kind, kinds, prepareInput };
  const active = (ctx: Context) => alive.current && context.current === ctx && generation.current === ctx.token && identity.current.userId === ctx.userId && identity.current.projectId === ctx.projectId && identity.current.workspaceKind === ctx.kind && !ctx.controller.signal.aborted;
  const writable = state?.project.role === "owner" || state?.project.role === "editor";
  const capability = state?.capabilities.find(item => item.kind === kind);
  const visibleJobs = state?.jobs.filter(job => kinds.includes(job.kind)) ?? [];

  async function refresh(ctx: Context): Promise<void> {
    if (!active(ctx) || ctx.refreshing) return; ctx.refreshing = true;
    try {
      const loaded = await listProjectJobs(ctx.projectId, ctx.controller.signal);
      if (active(ctx)) { ctx.revoked = false; ctx.lastPoll = Date.now(); setState(loaded); }
    } catch (cause) {
      if (active(ctx)) {
        if (cause instanceof JobsApiError && [401, 403, 404].includes(cause.status)) { ctx.revoked = true; setState(null); setNativeReport(null); }
        setError(message(cause));
      }
    } finally { ctx.refreshing = false; }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => {
    const token = ++generation.current;
    setState(null); setFile(null); setPending(null); setNativeReport(null); setError(""); setNotice(""); setBusy(Boolean(user && projectId));
    if (!user || !projectId) { context.current = null; return; }
    const ctx: Context = { token, userId: user.id, projectId, kind: workspaceKind, controller: new AbortController(), refreshing: false, lastPoll: 0, revoked: false };
    context.current = ctx;
    void refresh(ctx).finally(() => { if (active(ctx)) setBusy(false); });
    const timer = window.setInterval(() => {
      if (!active(ctx) || ctx.revoked) return;
      const running = latest.current.state?.jobs.some(job => activeState(job.state));
      if (running || Date.now() - ctx.lastPoll >= 15000) void refresh(ctx);
    }, 4000);
    return () => { window.clearInterval(timer); ctx.controller.abort(); };
  }, [projectId, user?.id, workspaceKind]);

  async function submit(): Promise<void> {
    const ctx = context.current, values = latest.current;
    if (!ctx || !active(ctx) || ctx.revoked || busy || !writable || !values.state || !values.kinds.includes(values.kind) || (!values.pending && !values.state.capabilities.some(item => item.kind === values.kind && item.available))) return;
    setBusy(true); setError(""); setNotice("");
    let attempt = values.pending;
    try {
      if (!attempt) {
        const source = values.prepareInput ? values.prepareInput(values.kind) : values.file ? { blob: values.file, name: values.file.name } : null;
        if (!source) throw new Error("Choose an input file before queuing a conversion.");
        if (source.blob.size === 0 || source.blob.size > MAX_NATIVE_INPUT_BYTES) throw new Error("Native job input must be non-empty and at most 32 MiB.");
        if (values.kind !== "opensees-static" && !source.name.toLowerCase().endsWith(values.kind === "dwg-to-dxf" ? ".dwg" : ".dxf")) throw new Error("Choose a file matching the selected conversion's source format.");
        const sourceRevision = values.state.project.revision;
        const artifact = await uploadWorkspaceArtifact(ctx.projectId, ctx.kind, source.blob, source.name);
        if (!active(ctx)) return;
        attempt = { kind: values.kind, artifact, sourceRevision, idempotencyKey: crypto.randomUUID().replace(/-/g, "") };
        setPending(attempt);
      }
      if (!active(ctx)) return;
      const result = await submitProjectJob(ctx.projectId, { kind: attempt.kind, sourceArtifactId: attempt.artifact.id, sourceRevision: attempt.sourceRevision, idempotencyKey: attempt.idempotencyKey }, ctx.controller.signal);
      if (!active(ctx)) return;
      setPending(null); setNotice(`Job ${result.job.id} accepted from the captured input. Page edits made after capture are excluded.`);
      setState(current => current ? { ...current, jobs: [result.job, ...current.jobs.filter(job => job.id !== result.job.id)] } : current);
      await refresh(ctx);
    } catch (cause) { if (active(ctx)) setError(`${message(cause)}${attempt ? " The captured input is retained for a safe retry. A changed project revision requires a new attempt after refreshing metadata." : ""}`); }
    finally { if (active(ctx)) setBusy(false); }
  }
  async function changeJob(job: ProjectJob, action: "cancel" | "delete"): Promise<void> {
    const ctx = context.current; if (!ctx || !active(ctx) || ctx.revoked || busy || !writable) return;
    setBusy(true); setError("");
    try {
      if (action === "cancel") {
        const result = await cancelProjectJob(ctx.projectId, job.id, ctx.controller.signal);
        if (active(ctx)) setState(current => current ? { ...current, jobs: current.jobs.map(item => item.id === job.id ? result.job : item) } : current);
      } else {
        await deleteProjectJob(ctx.projectId, job.id, ctx.controller.signal);
        if (active(ctx)) { setState(current => current ? { ...current, jobs: current.jobs.filter(item => item.id !== job.id) } : current); setNativeReport(current => current?.jobId === job.id ? null : current); }
      }
      await refresh(ctx);
    } catch (cause) { if (active(ctx)) setError(message(cause)); }
    finally { if (active(ctx)) setBusy(false); }
  }
  async function downloadOutput(job: ProjectJob, artifact: Pick<WorkspaceArtifact, "id" | "name">): Promise<void> {
    const ctx = context.current; if (!ctx || !active(ctx) || ctx.revoked || busy) return;
    setBusy(true); setError("");
    try { const blob = await readJobArtifact(ctx.projectId, job.id, artifact.id, ctx.controller.signal); if (active(ctx)) downloadBlob(artifact.name, blob); }
    catch (cause) { if (active(ctx)) setError(message(cause)); }
    finally { if (active(ctx)) setBusy(false); }
  }
  async function readNativeReport(job: ProjectJob): Promise<void> {
    const ctx = context.current; if (!ctx || !active(ctx) || ctx.revoked || busy || job.kind !== "opensees-static" || job.state !== "succeeded") return;
    setBusy(true); setError("");
    try {
      const manifest = job.artifacts.find(artifact => artifact.name === "secure-nexus-native-result.json");
      if (!manifest) throw new Error("Native result manifest is missing.");
      if (job.artifacts.reduce((total, artifact) => total + artifact.size, 0) > 64 * 1024 * 1024) throw new Error("Native report outputs exceed the 64 MiB browser inspection limit; download files individually.");
      const sourceBytes = new Uint8Array(await (await readJobArtifact(ctx.projectId, job.id, job.sourceArtifactId, ctx.controller.signal)).arrayBuffer());
      if (!active(ctx)) return;
      const files: { filename: string; bytes: Uint8Array }[] = [];
      let manifestBytes: Uint8Array | null = null;
      for (const artifact of job.artifacts) {
        const bytes = new Uint8Array(await (await readJobArtifact(ctx.projectId, job.id, artifact.id, ctx.controller.signal)).arrayBuffer());
        if (!active(ctx)) return;
        if (artifact.id === manifest.id) manifestBytes = bytes; else files.push({ filename: artifact.name, bytes });
      }
      if (!manifestBytes) throw new Error("Native result manifest could not be read.");
      const data = await parseNativeFrameResult(sourceBytes, manifestBytes, files, { artifactId: job.sourceArtifactId, sha256: job.sourceSha256, manifestSha256: manifest.sha256 });
      if (active(ctx)) { setNativeReport({ jobId: job.id, data }); setNotice("Native file hashes and source mapping checked. Engineering correctness still requires independent review."); }
    } catch (cause) { if (active(ctx)) setError(message(cause)); }
    finally { if (active(ctx)) setBusy(false); }
  }

  return <Card className="space-y-4 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Native project jobs</h2>{projectId && <Button size="sm" variant="outline" disabled={busy} onClick={() => { const ctx = context.current; if (ctx) void refresh(ctx); }}>Refresh jobs</Button>}</div>
    <p className="text-xs text-slate-400">Queue a captured source for a configured server worker, follow its status, and download outputs with their provenance. Jobs preserve the editor model and saved workspace inputs.</p>
    {!projectId && <p className="text-sm text-slate-400">Select a project above to use native conversion or analysis.</p>}
    {projectId && !state && busy && <p role="status" className="text-sm text-slate-400">Loading project jobs and worker configuration…</p>}
    {state && <>
      <p className="text-xs text-slate-400">{state.project.name} · {state.project.role} access · current project revision {state.project.revision}.</p>
      {state.capabilities.filter(item => kinds.includes(item.kind)).map(item => <div key={item.kind} className="space-y-1 rounded-xl border border-slate-700 p-3 text-xs"><div className="flex flex-wrap items-center gap-2"><span>{labels[item.kind]} · {item.adapter} {item.supportedVersion}</span><Badge tone={item.available ? "cyan" : "amber"}>{item.available ? "Can queue" : "Unavailable"}</Badge></div><p className="text-slate-400">{item.reason}</p><p className="text-slate-500">Native runtime behavior has not been verified for this source release.</p></div>)}
      {writable ? <div className="space-y-3">
        <Select label="Native operation" value={kind} disabled={busy || !!pending} onChange={event => { setKind(event.target.value as NativeJobKind); setFile(null); setError(""); }}>{kinds.map(value => <option key={value} value={value}>{labels[value]}</option>)}</Select>
        {prepareInput ? <p className="text-xs text-slate-400">{preparedInputLabel || "Current page input is captured when you queue the job."}</p> : <Input label="Source file (32 MiB maximum)" type="file" accept={kind === "dwg-to-dxf" ? ".dwg" : ".dxf"} disabled={busy || !!pending} onChange={event => { const selected = event.target.files?.[0] ?? null; event.target.value = ""; if (selected && (selected.size === 0 || selected.size > MAX_NATIVE_INPUT_BYTES)) { setError("Choose a non-empty source file at most 32 MiB."); return; } setFile(selected); setError(""); }} />}
        {file && !pending && <p className="text-xs text-slate-400">Selected: {file.name} · {(file.size / 1048576).toFixed(2)} MiB.</p>}
        {pending && <p className="break-all text-xs text-amber-200">Retry source: {pending.artifact.name} · project revision {pending.sourceRevision} · SHA-256 {pending.artifact.sha256}. Retry reuses this captured source and request ID.</p>}
        <div className="flex flex-wrap gap-2"><Button loading={busy} disabled={(!pending && !capability?.available) || (!prepareInput && !file && !pending)} onClick={() => { void submit(); }}>{pending ? "Retry captured submission" : "Queue native job"}</Button>{pending && <Button variant="ghost" disabled={busy} onClick={() => { setPending(null); setNotice("Previous uploaded source is retained. Inspect the jobs list before creating another attempt."); }}>Start another attempt</Button>}</div>
      </div> : <p className="text-xs text-slate-400">Viewers can read job status and download results. Editor access is required to submit, cancel or remove jobs.</p>}
      <p className="text-xs text-slate-400">{workspaceKind === "exchange" ? "DWG support depends on LibreDWG and the source entities/version. Converted DXF is a downloadable exchange file; it does not automatically become an editable website model." : "OpenSees jobs support one explicit planar 2D elastic frame combination. The server generates a fixed solver deck from JSON; supplied scripts are excluded."}</p>
      <div className="max-h-[36rem] space-y-3 overflow-auto">{visibleJobs.map(job => <article key={job.id} className="space-y-2 rounded-xl border border-slate-700 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{labels[job.kind]}</span><Badge tone={tone(job.state)}>{job.state}</Badge></div>
        <p className="break-all text-xs text-slate-400">Job {job.id} · {new Date(job.createdAt * 1000).toLocaleString()} · attempts {job.attempts}.</p>
        <p className="text-xs text-slate-400">Captured project revision {job.sourceRevision}{job.sourceWorkspaceRevision === null ? " · uploaded input" : ` · saved workspace revision ${job.sourceWorkspaceRevision}`}{job.sourceRevision !== state.project.revision ? " · project changed since capture" : ""}.</p>
        <details className="text-xs text-slate-400"><summary className="cursor-pointer">Source fingerprint</summary><p className="mt-1 break-all">Artifact {job.sourceArtifactId}<br />SHA-256 {job.sourceSha256}</p></details>
        {job.error && <p className="text-xs text-rose-300">{job.error.code}: {job.error.message}</p>}
        {job.summary && <><p className="text-xs text-slate-400">{job.summary.adapter} {job.summary.declaredVersion}{job.summary.combinationId ? ` · combination ${job.summary.combinationId}` : ""} · computed, independently unvalidated.</p><ul className="list-disc space-y-1 pl-5 text-xs text-amber-200">{job.summary.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></>}
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => { void downloadOutput(job, { id: job.sourceArtifactId, name: `${job.id}-source.${job.kind === "opensees-static" ? "json" : job.kind === "dwg-to-dxf" ? "dwg" : "dxf"}` }); }}>Captured source</Button>{job.artifacts.map(artifact => <Button key={artifact.id} size="sm" variant="outline" disabled={busy} onClick={() => { void downloadOutput(job, artifact); }}>{artifact.name} · {(artifact.size / 1048576).toFixed(2)} MiB</Button>)}{job.kind === "opensees-static" && job.state === "succeeded" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void readNativeReport(job); }}>Inspect mapped native report</Button>}{writable && (activeState(job.state) ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void changeJob(job, "cancel"); }}>Cancel job</Button> : <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void changeJob(job, "delete"); }}>Remove finished job</Button>)}</div>
      </article>)}</div>
      {!visibleJobs.length && <p className="text-sm text-slate-400">No jobs recorded for these operations.</p>}
      {nativeReport && <details open className="space-y-2"><summary className="cursor-pointer text-sm">Mapped native report · job {nativeReport.jobId}</summary><p className="text-xs text-slate-400">This report refers to the immutable job source. It is kept separate from the editable browser analysis report.</p><pre className="max-h-96 overflow-auto rounded-xl bg-slate-950 p-3 text-xs">{JSON.stringify(nativeReport.data, null, 2)}</pre></details>}
    </>}
    {notice && <p role="status" className="text-xs text-slate-400">{notice}</p>}{error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
  </Card>;
}
