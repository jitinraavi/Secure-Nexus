import { useEffect, useRef, useState } from "react";
import type { Design } from "../types";
import type { PresentationApi } from "../lib/presentation";
import { validCameraWaypoint } from "../lib/presentation";
import { visualizationSettings } from "../lib/visualization";
import { download, downloadBlob } from "../lib/download";
import { produceGeometryChunks } from "../lib/geometryChunkProducer";
import { Button } from "./ui";

export function PresentationControls({ api, design, onChange }: { api: PresentationApi | null; design: Design; onChange: (next: Design) => void }) {
  const value = visualizationSettings(design.visualization);
  const storedPath = Array.isArray(value.cameraPath) ? value.cameraPath : [];
  const path = storedPath.slice(0, 100).filter(validCameraWaypoint);
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(15);
  const [scale, setScale] = useState(2);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const currentApi = useRef(api);
  const generation = useRef(0);
  const chunkController = useRef<AbortController | null>(null);
  if (currentApi.current !== api) { currentApi.current = api; generation.current += 1; }
  useEffect(() => {
    mounted.current = true; setBusy(false); setRecording(false); setError(null);
    return () => { mounted.current = false; generation.current += 1; chunkController.current?.abort(); api?.cancelVideo(); };
  }, [api]);
  const savePath = (next: typeof path) => onChange({ ...design, visualization: { ...value, cameraPath: next } });
  const pauseFlythrough = () => { if (value.walkthrough) onChange({ ...design, visualization: { ...value, walkthrough: false } }); };
  const run = async (work: (current: () => boolean) => void | Promise<void>) => {
    const attempt = ++generation.current;
    const current = () => mounted.current && currentApi.current === api && generation.current === attempt;
    setError(null); setBusy(true);
    try { await work(current); } catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : "Presentation action failed."); }
    finally { if (current()) { setBusy(false); setRecording(false); } }
  };
  return <div className="mt-2 border-t border-slate-800 pt-2">
    <Button size="sm" variant="ghost" onClick={() => setOpen((current) => !current)}>{open ? "Hide presentation" : `Presentation (${path.length} views)`}</Button>
    {open && <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
      <div className="flex flex-wrap items-end gap-2">
        <Button size="sm" variant="secondary" disabled={!api || busy || path.length >= 100} onClick={() => void run(() => { if (api) savePath([...path, api.captureCameraWaypoint(`View ${path.length + 1}`)]); })}>Save view</Button>
        <label className="text-[10px] text-slate-400">Duration (seconds)<input aria-label="Presentation duration" type="number" min={1} max={60} value={duration} onChange={(event) => setDuration(Math.max(1, Math.min(60, Math.round(Number(event.target.value) || 1))))} className="ml-2 w-14 rounded border border-slate-700 bg-slate-950 p-1" /></label>
        <Button size="sm" variant="outline" disabled={!api || busy || path.length < 2} onClick={() => void run(() => { pauseFlythrough(); api?.playCameraPath(path, duration); })}>Play path</Button>
        <Button size="sm" variant="ghost" disabled={!api} onClick={() => { api?.stopCameraPath(); api?.cancelVideo(); chunkController.current?.abort(); }}>Stop</Button>
        <label className="text-[10px] text-slate-400">PNG scale<select aria-label="PNG capture scale" value={scale} onChange={(event) => setScale(Number(event.target.value))} className="ml-2 rounded border border-slate-700 bg-slate-950 p-1"><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
        <Button size="sm" variant="outline" disabled={!api || busy} onClick={() => void run(async (current) => { if (api) { const blob = await api.capturePng(scale); if (current()) downloadBlob("presentation.png", blob); } })}>PNG</Button>
        <Button size="sm" variant="outline" disabled={!api || busy} onClick={() => void run(async (current) => {
          if (!api) return;
          pauseFlythrough();
          setRecording(true);
          const video = await api.recordVideo(duration, 30, path.length >= 2 ? path : undefined);
          if (current()) downloadBlob(`presentation.${video.extension}`, video.blob);
        })}>{recording ? "Recording…" : "Record video"}</Button>
        <Button size="sm" variant="ghost" disabled={busy || !path.length} onClick={() => download("camera-path.json", JSON.stringify({ version: 1, units: "metres", durationSeconds: duration, waypoints: path }, null, 2), "application/json")}>Path JSON</Button>
        <Button size="sm" variant="outline" disabled={!api || busy} onClick={() => void run(() => { if (api) download("geometry-scene.json", JSON.stringify(api.exportGeometry()), "application/json"); })}>Mesh geometry</Button>
        <Button size="sm" variant="outline" disabled={!api || busy} onClick={() => void run(async current => {
          if (!api) return;
          const controller = new AbortController(); chunkController.current = controller;
          try { const captured = await produceGeometryChunks(api.exportGeometry(), { signal: controller.signal, context: { label: "Visible editor meshes", projectId: null, sourceRevision: null } }); if (current()) downloadBlob(captured.source.name, captured.source.blob); }
          finally { if (chunkController.current === controller) chunkController.current = null; }
        })}>Exact chunk source</Button>
      </div>
      <p className="text-[10px] text-slate-500">The path uses saved camera positions in metres. Video records this viewport for up to 60 seconds; keep the tab visible. PNG export is capped at 16 megapixels. Device codecs and frame rate vary.</p>
      <p className="text-[10px] text-slate-500">Exact chunk source captures visible meshes and verifies partition budgets without simplification. Import its JSON in Geometry and rendering, prepare chunks and save to a selected project. Hidden geometry and unsupported material features remain outside the viewport export.</p>
      {path.map((point, index) => <div className="flex items-center gap-1" key={point.id}>
        <input aria-label={`View ${index + 1} name`} value={point.label} maxLength={120} onChange={(event) => savePath(path.map((other) => other.id === point.id ? { ...other, label: event.target.value } : other))} className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs" />
        <Button size="sm" variant="ghost" disabled={!api || busy} onClick={() => void run(() => { pauseFlythrough(); api?.showCameraWaypoint(point); })}>Show</Button>
        <Button size="sm" variant="ghost" disabled={index === 0 || busy} onClick={() => { const next = [...path]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; savePath(next); }}>Up</Button>
        <Button size="sm" variant="ghost" disabled={index === path.length - 1 || busy} onClick={() => { const next = [...path]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; savePath(next); }}>Down</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => savePath(path.filter((other) => other.id !== point.id))}>Remove</Button>
      </div>)}
      {error && <p role="status" className="text-xs text-amber-300">{error}</p>}
    </div>}
  </div>;
}
