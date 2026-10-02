import { useEffect, useMemo, useRef, useState } from "react";
import type { ReviewMarker, ReviewSeverity } from "../types";
import type { ReviewFinding } from "../lib/review";
import type { PresentationApi } from "../lib/presentation";
import { bcfTopicsToReviewMarkers, buildBcfRegisterZip, parseBcfZip } from "../lib/bcf";
import { MAX_REVIEW_COMMENTS, MAX_REVIEW_MARKERS, mergeImportedReviewMarkers, normalizeReviewViewpoint, promoteReviewFindings, reviewRegisterCsv, reviewRegisterJson, reviewWorkflow, validReviewDate, type ReviewWorkflow } from "../lib/coordination";
import { download, downloadBlob } from "../lib/download";
import { Badge, Button, Input, Select } from "./ui";

interface CoordinationPanelProps {
  markers: ReviewMarker[];
  findings: ReviewFinding[];
  onChange: (markers: ReviewMarker[]) => void;
  modelIds: string[];
  gridIds?: string[];
  selectedId?: string | null;
  selectedPosition?: { x: number; z: number };
  onSelect: (id: string) => void;
  presentationApi?: PresentationApi | null;
  projectName?: string;
}

export function CoordinationPanel({ markers, findings, onChange, modelIds, gridIds = [], selectedId, selectedPosition, onSelect, presentationApi, projectName }: CoordinationPanelProps) {
  const [text, setText] = useState("");
  const [severity, setSeverity] = useState<ReviewSeverity>("note");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [groupBy, setGroupBy] = useState<"category" | "targets">("category");
  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const [commentAuthor, setCommentAuthor] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const generation = useRef(0);
  const latestMarkers = useRef(markers);
  latestMarkers.current = markers;
  const latestContext = useRef({ modelIds, gridIds, onChange });
  latestContext.current = { modelIds, gridIds, onChange };
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { setPage(0); }, [search, statusFilter, categoryFilter, severityFilter, assigneeFilter, groupBy]);
  const categories = [...new Set(markers.map(marker => marker.category || "manual"))].sort();
  const filtered = useMemo(() => markers.filter(marker => {
    const query = search.trim().toLowerCase();
    return (!query || [marker.text, marker.id, ...(marker.targetIds ?? [])].join(" ").toLowerCase().includes(query))
      && (statusFilter === "all" || reviewWorkflow(marker) === statusFilter)
      && (categoryFilter === "all" || (marker.category || "manual") === categoryFilter)
      && (severityFilter === "all" || marker.severity === severityFilter)
      && (!assigneeFilter.trim() || (marker.assignee ?? "").toLowerCase().includes(assigneeFilter.trim().toLowerCase()));
  }).sort((a, b) => {
    const group = (marker: ReviewMarker) => groupBy === "category" ? marker.category || "manual" : (marker.targetIds ?? []).slice().sort().join(", ") || "Unlinked";
    return group(a).localeCompare(group(b)) || a.id.localeCompare(b.id);
  }), [markers, search, statusFilter, categoryFilter, severityFilter, assigneeFilter, groupBy]);
  const pages = Math.max(1, Math.ceil(filtered.length / 25)), currentPage = Math.min(page, pages - 1), shown = filtered.slice(currentPage * 25, (currentPage + 1) * 25);
  const update = (id: string, patch: Partial<ReviewMarker>) => onChange(markers.map(marker => marker.id === id ? { ...marker, ...patch, updatedAt: new Date().toISOString() } : marker));
  const promote = () => {
    const result = promoteReviewFindings(markers, findings);
    if (result.added) onChange(result.markers);
    setNotice(`${result.added} issues added; ${result.existing} already tracked; ${result.skipped} skipped.`);
  };
  const capture = (marker: ReviewMarker) => {
    if (!presentationApi) return;
    try {
      const point = presentationApi.captureCameraWaypoint(marker.text);
      const direction = point.target.map((number, index) => number - point.position[index]) as [number, number, number];
      const vertical = Math.abs(direction[1]) / (Math.hypot(...direction) || 1) > 0.99;
      const viewpoint = normalizeReviewViewpoint({ position: point.position, direction, up: vertical ? [0, 0, -1] : [0, 1, 0], cameraType: "perspective", fieldOfView: 60, componentGuids: marker.viewpoint?.componentGuids });
      if (!viewpoint) throw new Error("The current camera cannot form a valid issue viewpoint.");
      update(marker.id, { viewpoint }); setNotice("Current camera position and direction saved with the issue.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not capture the issue viewpoint."); }
  };
  const show = (marker: ReviewMarker) => {
    if (!presentationApi || !marker.viewpoint) return;
    try {
      const view = marker.viewpoint;
      presentationApi.showCameraWaypoint({ id: marker.id, label: marker.text, position: view.position, target: view.position.map((number, index) => number + view.direction[index] * 10) as [number, number, number] });
      setNotice("Camera position and direction shown. The viewport retains its current perspective/FOV settings.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not show the issue viewpoint."); }
  };
  const importFile = async (file: File) => {
    const operation = ++generation.current;
    setBusy(true); setNotice("Reading bounded BCF topics and viewpoints…");
    try {
      const topics = await parseBcfZip(file);
      if (operation !== generation.current) return;
      const context = latestContext.current;
      const imported = bcfTopicsToReviewMarkers(topics, context.modelIds, context.gridIds), result = mergeImportedReviewMarkers(latestMarkers.current, imported);
      if (result.added) context.onChange(result.markers);
      setNotice(`${result.added} BCF issues imported; ${result.existing} already tracked; ${result.skipped} skipped. Existing issue edits were preserved.`);
    } catch (error) { if (operation === generation.current) setNotice(error instanceof Error ? error.message : "Could not import BCF."); }
    finally { if (operation === generation.current) setBusy(false); }
  };
  const exportBcf = async () => {
    const operation = ++generation.current;
    setBusy(true);
    try {
      const blob = await buildBcfRegisterZip(filtered, projectName, gridIds);
      if (operation === generation.current) { downloadBlob("coordination-issues.bcfzip", blob); setNotice(`${filtered.length} filtered issues exported to BCF.`); }
    } catch (error) { if (operation === generation.current) setNotice(error instanceof Error ? error.message : "Could not export BCF."); }
    finally { if (operation === generation.current) setBusy(false); }
  };
  const today = (() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; })();
  return <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
    <div className="flex flex-wrap items-center gap-2"><p className="text-xs font-semibold text-slate-200">Coordination issue register</p><Badge tone="cyan">{markers.length}/{MAX_REVIEW_MARKERS}</Badge><Button size="sm" variant="secondary" onClick={promote} disabled={busy || !findings.length || markers.length >= MAX_REVIEW_MARKERS}>Track current findings</Button></div>
    <p className="text-[11px] text-slate-500">Findings are grouped by category and linked object pair. Existing and resolved issues stay intact when checks change. Assignee names are saved locally with this design; they do not send notifications.</p>
    <textarea aria-label="New coordination issue" value={text} maxLength={4000} onChange={event => setText(event.target.value)} placeholder={selectedId ? "Add an issue for the selected object" : "Add a site coordination issue"} className="min-h-16 w-full rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-200" />
    <div className="flex gap-2"><Select aria-label="New issue severity" value={severity} onChange={event => setSeverity(event.target.value as ReviewSeverity)}><option value="note">Note</option><option value="warning">Warning</option><option value="blocker">Blocker</option></Select><Button size="sm" disabled={!text.trim() || markers.length >= MAX_REVIEW_MARKERS || busy} onClick={() => {
      const now = new Date().toISOString();
      onChange([...markers, { id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, text: text.trim(), severity, status: "open", workflowStatus: "open", category: "manual", x: selectedPosition?.x ?? 0, z: selectedPosition?.z ?? 0, targetIds: selectedId ? [selectedId] : [], createdAt: now, updatedAt: now, comments: [] }]); setText("");
    }}>Add issue</Button></div>
    <div className="grid gap-2 sm:grid-cols-2">
      <Input aria-label="Search coordination issues" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search issue or object ID" />
      <Input aria-label="Filter issue assignees" value={assigneeFilter} onChange={event => setAssigneeFilter(event.target.value)} placeholder="Filter assignee" />
      <Select aria-label="Filter issue workflow" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All workflow states</option><option value="open">Open</option><option value="in-progress">In progress</option><option value="resolved">Resolved</option></Select>
      <Select aria-label="Filter issue category" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{categories.map(category => <option key={category} value={category}>{category}</option>)}</Select>
      <Select aria-label="Filter issue severity" value={severityFilter} onChange={event => setSeverityFilter(event.target.value)}><option value="all">All severities</option><option value="note">Note</option><option value="warning">Warning</option><option value="blocker">Blocker</option></Select>
      <Select aria-label="Group coordination issues" value={groupBy} onChange={event => setGroupBy(event.target.value as typeof groupBy)}><option value="category">Group by category</option><option value="targets">Group by linked objects</option></Select>
    </div>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => download("coordination-issues.csv", reviewRegisterCsv(filtered), "text/csv")}>Filtered CSV</Button><Button size="sm" variant="outline" onClick={() => download("coordination-issues.json", reviewRegisterJson(filtered), "application/json")}>Filtered JSON</Button><Button size="sm" variant="outline" disabled={busy || !filtered.length} onClick={() => void exportBcf()}>Filtered BCF</Button></div>
    <label className="block text-xs text-slate-400">Import BCF issues (10 MB maximum)<input type="file" accept=".bcf,.bcfzip,.zip" disabled={busy} className="mt-1 block max-w-full text-xs" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} /></label>
    {notice && <p role="status" className="text-xs text-amber-200">{notice}</p>}
    <p className="text-xs text-slate-500">{filtered.length} matching issues · page {currentPage + 1}/{pages}</p>
    {shown.map((marker, index) => {
      const group = (item: ReviewMarker) => groupBy === "category" ? item.category || "manual" : (item.targetIds ?? []).slice().sort().join(", ") || "Unlinked";
      const workflow = reviewWorkflow(marker), overdue = workflow !== "resolved" && validReviewDate(marker.dueDate) && marker.dueDate < today;
      return <div key={marker.id} className="space-y-2 rounded-lg border border-slate-800 p-2">
        {(index === 0 || group(shown[index - 1]) !== group(marker)) && <p className="break-all text-[10px] font-semibold uppercase text-cyan-300">{group(marker)}</p>}
        <textarea aria-label="Issue text" value={marker.text} maxLength={4000} disabled={busy} onChange={event => update(marker.id, { text: event.target.value })} className="min-h-12 w-full rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-200" />
        <div className="grid gap-2 sm:grid-cols-2">
          <Select aria-label="Issue workflow" value={workflow} disabled={busy} onChange={event => { const next = event.target.value as ReviewWorkflow; update(marker.id, { workflowStatus: next, status: next === "resolved" ? "resolved" : "open" }); }}><option value="open">Open</option><option value="in-progress">In progress</option><option value="resolved">Resolved</option></Select>
          <Select aria-label="Issue severity" value={marker.severity} disabled={busy} onChange={event => update(marker.id, { severity: event.target.value as ReviewSeverity })}><option value="note">Note</option><option value="warning">Warning</option><option value="blocker">Blocker</option></Select>
          <Input aria-label="Issue assignee" placeholder="Assignee" value={marker.assignee ?? ""} maxLength={120} disabled={busy} onChange={event => update(marker.id, { assignee: event.target.value || undefined })} />
          <Input aria-label="Issue due date" type="date" value={marker.dueDate ?? ""} disabled={busy} onChange={event => update(marker.id, { dueDate: validReviewDate(event.target.value) ? event.target.value : undefined })} />
        </div>
        {overdue && <p className="text-[11px] text-rose-300">Overdue</p>}
        <p className="break-all text-[10px] text-slate-500">{marker.id} · {(marker.targetIds ?? []).join(", ") || "No local object links"}</p>
        <div className="flex flex-wrap gap-1">{(marker.targetIds ?? []).filter(id => modelIds.includes(id)).slice(0, 10).map(id => <Button key={id} size="sm" variant="ghost" onClick={() => onSelect(id)}>Select {id.slice(0, 14)}</Button>)}<Button size="sm" variant="ghost" disabled={!presentationApi || busy} onClick={() => capture(marker)}>Save camera</Button><Button size="sm" variant="ghost" disabled={!presentationApi || !marker.viewpoint || busy} onClick={() => show(marker)}>Show camera position</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => onChange(markers.filter(other => other.id !== marker.id))}>Remove</Button></div>
        {marker.viewpoint && <p className="text-[10px] text-slate-500">Saved {marker.viewpoint.cameraType ?? "perspective"} camera · {marker.viewpoint.componentGuids?.length ?? 0} retained IFC references. FOV/up vectors are preserved in BCF export.</p>}
        <details><summary className="cursor-pointer text-xs text-slate-400">Comments ({marker.comments?.length ?? 0}/{MAX_REVIEW_COMMENTS})</summary><div className="mt-2 space-y-2">{(marker.comments ?? []).map(comment => <div key={comment.id} className="rounded border border-slate-800 p-2 text-xs"><p className="whitespace-pre-wrap text-slate-300">{comment.text}</p><p className="mt-1 text-[10px] text-slate-500">{comment.author || "Reviewer"} · {comment.createdAt}</p></div>)}<Input aria-label="Comment author" value={commentAuthor} maxLength={120} placeholder="Author (optional)" disabled={busy} onChange={event => setCommentAuthor(event.target.value)} /><textarea aria-label="Add issue comment" value={commentText[marker.id] ?? ""} maxLength={4000} disabled={busy} onChange={event => setCommentText(value => ({ ...value, [marker.id]: event.target.value }))} className="min-h-12 w-full rounded border border-slate-700 bg-slate-900 p-2 text-xs" /><Button size="sm" variant="secondary" disabled={busy || !(commentText[marker.id] ?? "").trim() || (marker.comments?.length ?? 0) >= MAX_REVIEW_COMMENTS} onClick={() => {
          update(marker.id, { comments: [...(marker.comments ?? []), { id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: commentText[marker.id].trim(), author: commentAuthor.trim() || undefined, createdAt: new Date().toISOString() }] }); setCommentText(value => ({ ...value, [marker.id]: "" }));
        }}>Add comment</Button></div></details>
      </div>;
    })}
    <div className="flex justify-between"><Button size="sm" variant="ghost" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous 25</Button><Button size="sm" variant="ghost" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next 25</Button></div>
  </div>;
}
