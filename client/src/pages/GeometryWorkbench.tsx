import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Input } from "../components/ui";
import { StreamingGeometryViewport } from "../components/StreamingGeometryViewport";
import { download, downloadBlob } from "../lib/download";
import { inspectGeometryScene, type GeometryScene } from "../lib/meshGeometry";
import { inspectGeometryManifest, type GeometryManifest } from "../lib/geometryPipeline";
import { DEFAULT_TRACE_SETTINGS, type PathTraceSettings } from "../lib/pathTracer";
import type { GeometryRequest, GeometryResponse } from "../lib/geometry.worker";

export function GeometryWorkbench() {
  const [scene, setScene] = useState<GeometryScene | null>(null), [manifest, setManifest] = useState<GeometryManifest | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [report, setReport] = useState<unknown>(null), [settings, setSettings] = useState<PathTraceSettings>(DEFAULT_TRACE_SETTINGS), [tolerance, setTolerance] = useState(1e-6), [showViewport, setShowViewport] = useState(false), [hasImage, setHasImage] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null), worker = useRef<Worker | null>(null), serial = useRef(0), alive = useRef(true), fileGeneration = useRef(0);
  const cancel = () => { serial.current++; worker.current?.terminate(); worker.current = null; setBusy(false); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; fileGeneration.current++; serial.current++; worker.current?.terminate(); }; }, []);
  const load = async (file: File | undefined) => {
    if (!file) return; const attempt = ++fileGeneration.current; cancel(); setError("");
    try { if (file.size > 32_000_000) throw new Error("File exceeds 32 MB."); const value: unknown = JSON.parse(await file.text()); if (!alive.current || attempt !== fileGeneration.current) return;
      if (value && typeof value === "object" && "chunks" in value) { setManifest(inspectGeometryManifest(value)); setScene(null); } else { setScene(inspectGeometryScene(value)); setManifest(null); }
      setReport(null); setShowViewport(false); setHasImage(false);
    } catch (failure) { if (alive.current && attempt === fileGeneration.current) setError(failure instanceof Error ? failure.message : "Import failed."); }
  };
  const start = (request: GeometryRequest) => {
    cancel(); setError(""); setReport(null); setProgress(0); setBusy(true); const id = serial.current;
    try {
      const task = new Worker(new URL("../lib/geometry.worker.ts", import.meta.url), { type: "module" }); worker.current = task;
      task.onerror = () => { if (serial.current === id) { setError("Geometry worker failed to load or crashed."); cancel(); } };
      task.onmessage = (event: MessageEvent<GeometryResponse>) => {
        if (!alive.current || serial.current !== id || event.data.id !== id) return;
        const message = event.data;
        if (message.kind === "error") { setError(message.message); cancel(); return; }
        if (message.kind === "progress" || message.kind === "image") { const target = canvas.current; if (target) { target.width = message.width; target.height = message.height; const context = target.getContext("2d"); context?.putImageData(new ImageData(new Uint8ClampedArray(message.pixels), message.width, message.height), 0, 0); setHasImage(true); } setProgress(message.kind === "image" ? 1 : message.fraction); }
        else setReport(message.report);
        if (message.kind !== "progress") cancel();
      };
      task.postMessage({ ...request, id });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not start geometry worker."); cancel(); }
  };
  const saveImage = () => canvas.current?.toBlob(blob => { if (blob) downloadBlob("path-traced.png", blob); else setError("Image export failed."); }, "image/png");
  return <div className="space-y-5">
    <h1 className="text-2xl font-semibold">Geometry and rendering</h1>
    <p className="text-sm text-slate-400">Export visible mesh geometry from an editor’s Presentation controls, then import it here for triangle clashes and path tracing. Streaming manifests select chunk levels by screen error.</p>
    <Card className="space-y-3 p-4"><Input label="Geometry scene or streaming manifest (JSON)" type="file" accept=".json,application/json" onChange={e => void load(e.target.files?.[0])} />
      <p className="text-sm">{scene ? `${scene.meshes.length.toLocaleString()} meshes · ${scene.meshes.reduce((sum, m) => sum + m.indices.length / 3, 0).toLocaleString()} triangles` : manifest ? `${manifest.chunks.length.toLocaleString()} streaming chunks` : "No geometry loaded."}</p>
      <Button variant="outline" disabled={!scene && !manifest} onClick={() => setShowViewport(v => !v)}>{showViewport ? "Close viewport" : "Open viewport"}</Button>
      {showViewport && <StreamingGeometryViewport scene={scene} manifest={manifest} />}
      {scene?.warnings.map((warning, i) => <p className="text-xs text-amber-300" key={i}>{warning}</p>)}
    </Card>
    <Card className="space-y-3 p-4"><h2 className="font-semibold">Mesh clashes</h2><Input label="Tolerance (metres)" type="number" min={1e-9} max={0.01} step="any" value={tolerance} onChange={e => setTolerance(Number(e.target.value))} /><Button disabled={!scene || busy} onClick={() => scene && start({ id: 0, operation: "clash", scene, tolerance })}>Check mesh geometry</Button><p className="text-xs text-slate-400">Triangle intersections, coplanar contacts and closed-mesh containment. Partial reports explicitly identify budgets and ambiguous containment.</p></Card>
    <Card className="space-y-3 p-4"><h2 className="font-semibold">Path-traced image</h2><div className="grid grid-cols-2 gap-3 md:grid-cols-5">{(["width", "height", "samples", "bounces", "exposure"] as const).map(key => <Input key={key} label={key} type="number" step={key === "exposure" ? 0.1 : 1} value={settings[key]} onChange={e => setSettings(previous => ({ ...previous, [key]: Number(e.target.value) }))} />)}</div>
      <Button disabled={!scene || busy} onClick={() => { setHasImage(false); if (scene) start({ id: 0, operation: "trace", scene, settings }); }}>Trace image</Button><span className="ml-3 text-sm">{Math.round(progress * 100)}%</span>
      <p className="text-xs text-slate-400">Diffuse indirect illumination, hard sun shadows, mirror and glass materials. Constant linear-RGB materials; texture maps, volumetrics and denoising are outside this renderer.</p>
      <canvas ref={canvas} className={hasImage ? "max-w-full rounded-xl border border-slate-700" : "hidden"} /><Button variant="outline" disabled={!hasImage || busy} onClick={saveImage}>Download PNG</Button>
    </Card>
    <Card className="space-y-3 p-4"><h2 className="font-semibold">Performance measurements</h2><p className="text-xs text-slate-400">Explicitly measure a synthetic triangle BVH in a worker. Full editor performance needs representative project data and device measurements.</p>{([10_000, 100_000] as const).map(components => <Button key={components} className="mr-2" variant="outline" disabled={busy} onClick={() => start({ id: 0, operation: "benchmark", components })}>Measure {components.toLocaleString()}</Button>)}</Card>
    {busy && <Button variant="danger" onClick={cancel}>Cancel job</Button>}{error && <p role="alert" className="text-amber-300">{error}</p>}
    {report !== null && <Card className="p-4"><Button variant="outline" onClick={() => download("geometry-report.json", JSON.stringify(report, null, 2), "application/json")}>Download report</Button><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(report, null, 2).slice(0, 150_000)}</pre></Card>}
    <Link className="text-sm text-emerald-300" to="/dashboard">Return to projects</Link>
  </div>;
}
