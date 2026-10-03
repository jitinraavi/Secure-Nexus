import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ProjectDetail } from "../types";
import { Button, Card, Input } from "../components/ui";
import { ProjectWorkspacePanel } from "../components/ProjectWorkspacePanel";
import { StreamingGeometryViewport } from "../components/StreamingGeometryViewport";
import { download, downloadBlob } from "../lib/download";
import { inspectGeometryScene, MAX_SCENE_TRIANGLES, validVec3, type GeometryMesh, type GeometryScene, type Vec3 } from "../lib/meshGeometry";
import { inspectGeometryManifest, type GeometryManifest } from "../lib/geometryPipeline";
import { DEFAULT_TRACE_SETTINGS, type PathTraceSettings } from "../lib/pathTracer";
import { buildIfcStep } from "../lib/bim";
import { importIfcGeometry } from "../lib/ifcGeometry";
import type { MeshClashReport } from "../lib/meshClash";
import type { GeometryBenchmark, GeometryRequest, GeometryResponse } from "../lib/geometry.worker";

interface RenderReport { kind: "path-trace"; verification: "unverified"; settings: PathTraceSettings; camera: GeometryScene["camera"]; meshes: number; triangles: number; elapsedMs: number; note: string }
interface Reports { clashes: MeshClashReport | null; benchmark: GeometryBenchmark | null; render: RenderReport | null }
interface SavedImage { dataUrl: string; width: number; height: number }
interface GeometryWorkspace { version: 1; scene: GeometryScene | null; manifest: GeometryManifest | null; settings: PathTraceSettings; tolerance: number; reports: Reports; image: SavedImage | null }
const emptyReports = (): Reports => ({ clashes: null, benchmark: null, render: null });
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function finite(value: unknown, min: number, max: number, label: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}.`); return value; }
function text(value: unknown, max: number, label: string): string { if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${label}.`); return value; }
function strings(value: unknown, count: number, maximum: number): string[] { if (!Array.isArray(value) || value.length > count) throw new Error("Invalid saved string array."); return value.map(item => text(item, maximum, "report text")); }
function inspectSettings(value: unknown): PathTraceSettings {
  if (!object(value)) throw new Error("Saved trace settings must be an object.");
  const width = finite(value.width, 16, 2048, "image width"), height = finite(value.height, 16, 2048, "image height"), samples = finite(value.samples, 1, 256, "samples"), bounces = finite(value.bounces, 1, 12, "bounces"), seed = finite(value.seed, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "seed"), exposure = finite(value.exposure, Number.MIN_VALUE, 100, "exposure");
  if (![width, height, samples, bounces, seed].every(Number.isSafeInteger) || width * height > 1_048_576 || width * height * samples * bounces > 40_000_000 || !validVec3(value.environment) || !validVec3(value.sunDirection) || !validVec3(value.sunIrradiance) || [...value.environment, ...value.sunIrradiance].some(item => item < 0 || item > 1e4) || Math.hypot(...value.sunDirection) < 1e-15) throw new Error("Saved trace settings exceed the renderer's pixel/ray limits or contain invalid lighting.");
  return { width, height, samples, bounces, seed, exposure, environment: [...value.environment] as Vec3, sunDirection: [...value.sunDirection] as Vec3, sunIrradiance: [...value.sunIrradiance] as Vec3 };
}
function boundedJson(value: unknown): void {
  let entries = 0, characters = 0; const ancestors = new Set<object>();
  const visit = (item: unknown, depth: number): void => {
    if (++entries > 2_000_000 || depth > 24) throw new Error("Saved report exceeds the recovery complexity limit.");
    if (typeof item === "string") { characters += item.length; if (characters > 8_000_000) throw new Error("Saved report text exceeds 8 MB."); return; }
    if (item === null || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) return;
    if (typeof item !== "object" || ancestors.has(item)) throw new Error("Saved report contains invalid non-JSON data.");
    ancestors.add(item); for (const [key, child] of Object.entries(item)) { characters += key.length; visit(child, depth + 1); } ancestors.delete(item);
  };
  visit(value, 0); if (JSON.stringify(value).length > 8_000_000) throw new Error("Saved report JSON exceeds 8 MB.");
}
function inspectReports(value: unknown, scene: GeometryScene | null, settings: PathTraceSettings, tolerance: number): Reports {
  boundedJson(value); if (!object(value)) throw new Error("Saved reports must be an object.");
  const meshIds = new Set(scene?.meshes.map(mesh => mesh.id) ?? []), sourceIds = new Set(scene?.meshes.map(mesh => mesh.sourceId) ?? []);
  let clashes: MeshClashReport | null = null, benchmark: GeometryBenchmark | null = null, render: RenderReport | null = null;
  if (value.clashes !== null) {
    const report = value.clashes;
    if (!scene || !object(report) || typeof report.complete !== "boolean" || !Array.isArray(report.clashes) || report.clashes.length > 200000 || finite(report.toleranceM, 1e-9, 0.01, "report tolerance") !== tolerance) throw new Error("Saved clash report scope is invalid.");
    finite(report.triangleTests, 0, 5_000_001, "triangle tests"); finite(report.candidatePairs, 0, 200001, "candidate pairs"); strings(report.warnings, 400001, 4000);
    if (!Number.isSafeInteger(report.triangleTests) || !Number.isSafeInteger(report.candidatePairs) || !strings(report.openMeshes, 100000, 240).every(id => meshIds.has(id))) throw new Error("Saved clash counts/mesh references are invalid.");
    for (const clash of report.clashes) if (!object(clash) || typeof clash.a !== "string" || !sourceIds.has(clash.a) || typeof clash.b !== "string" || !sourceIds.has(clash.b) || typeof clash.meshA !== "string" || !meshIds.has(clash.meshA) || typeof clash.meshB !== "string" || !meshIds.has(clash.meshB) || !["surface-intersection", "coplanar-contact", "solid-containment"].includes(String(clash.kind)) || !validVec3(clash.point)) throw new Error("Saved clash references/coordinates are invalid.");
    clashes = report as unknown as MeshClashReport;
  }
  if (value.benchmark !== null) {
    const report = value.benchmark;
    if (!object(report) || report.kind !== "synthetic-triangle-bvh" || (report.components !== 10000 && report.components !== 100000) || report.triangles !== report.components || report.rays !== 1000) throw new Error("Saved benchmark has an unsupported scope.");
    finite(report.buildMs, 0, 1e12, "BVH duration"); finite(report.rayQueryMs, 0, 1e12, "ray duration"); finite(report.hits, 0, 1000, "ray hits"); if (!Number.isSafeInteger(report.hits)) throw new Error("Invalid benchmark hits."); text(report.note, 4000, "benchmark note"); benchmark = report as unknown as GeometryBenchmark;
  }
  if (value.render !== null) {
    const report = value.render;
    if (!scene || !object(report) || report.kind !== "path-trace" || report.verification !== "unverified" || !object(report.camera)) throw new Error("Saved render report scope is invalid.");
    const rendered = inspectSettings(report.settings);
    if (JSON.stringify(rendered) !== JSON.stringify(settings) || JSON.stringify(report.camera) !== JSON.stringify(scene.camera) || report.meshes !== scene.meshes.length || report.triangles !== scene.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0)) throw new Error("Saved render report differs from its scene/settings.");
    finite(report.elapsedMs, 0, 1e12, "trace duration"); text(report.note, 4000, "render note"); render = { ...report, settings: rendered } as unknown as RenderReport;
  }
  return { clashes, benchmark, render };
}
function inspectImage(value: unknown): SavedImage | null {
  if (value === null) return null;
  if (!object(value)) throw new Error("Saved image must be an object.");
  const dataUrl = text(value.dataUrl, 16_000_000, "PNG data"), prefix = "data:image/png;base64,", raw = dataUrl.slice(prefix.length);
  const width = finite(value.width, 16, 2048, "PNG width"), height = finite(value.height, 16, 2048, "PNG height");
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width * height > 1_048_576 || !dataUrl.startsWith(prefix) || raw.length < 44 || raw.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new Error("Saved PNG encoding/dimensions are invalid.");
  // Check the signature/IHDR before browser allocation. The browser decoder
  // subsequently validates compressed pixel data and chunk checksums.
  const header = atob(raw.slice(0, 64)), byte = (index: number) => header.charCodeAt(index), uint32 = (index: number) => byte(index) * 16777216 + byte(index + 1) * 65536 + byte(index + 2) * 256 + byte(index + 3);
  if (header.length < 33 || [137, 80, 78, 71, 13, 10, 26, 10].some((item, index) => byte(index) !== item) || uint32(8) !== 13 || header.slice(12, 16) !== "IHDR" || uint32(16) !== width || uint32(20) !== height) throw new Error("Saved image is not a bounded PNG with matching metadata.");
  // Completed canvas exports are static PNGs. Reject animation chunks so a
  // one-frame pixel limit cannot hide an unbounded collection of decoded frames.
  const binary = atob(raw), lengthAt = (index: number) => binary.charCodeAt(index) * 16777216 + binary.charCodeAt(index + 1) * 65536 + binary.charCodeAt(index + 2) * 256 + binary.charCodeAt(index + 3);
  let offset = 8, chunks = 0, ended = false, hasPixels = false;
  while (offset + 12 <= binary.length) {
    const length = lengthAt(offset), kind = binary.slice(offset + 4, offset + 8);
    if (++chunks > 4096 || offset + length + 12 > binary.length || ["acTL", "fcTL", "fdAT"].includes(kind) || (kind === "IHDR" && offset !== 8)) throw new Error("Saved PNG has invalid, excessive or animated chunks.");
    if (kind === "IDAT") hasPixels = true;
    offset += length + 12;
    if (kind === "IEND") { if (length || offset !== binary.length) throw new Error("Saved PNG has invalid trailing data."); ended = true; break; }
  }
  if (!ended || !hasPixels) throw new Error("Saved PNG body is incomplete.");
  return { dataUrl, width, height };
}
function inspectWorkspace(value: unknown): GeometryWorkspace {
  if (!object(value) || value.version !== 1 || (value.scene !== null && value.manifest !== null)) throw new Error("Unsupported geometry workspace version or conflicting scene/manifest.");
  const scene = value.scene === null ? null : inspectGeometryScene(value.scene), manifest = value.manifest === null ? null : inspectGeometryManifest(value.manifest), settings = inspectSettings(value.settings), tolerance = finite(value.tolerance, 1e-9, 0.01, "clash tolerance"), reports = inspectReports(value.reports, scene, settings, tolerance), image = inspectImage(value.image);
  if ((image && (!scene || !reports.render || image.width !== settings.width || image.height !== settings.height)) || (reports.render && !image)) throw new Error("Saved render/image does not match its scene and trace settings.");
  return { version: 1, scene, manifest, settings, tolerance, reports, image };
}
function projectScene(project: ProjectDetail): GeometryScene {
  if (!project.design) throw new Error("The selected project has no saved design geometry.");
  const source = buildIfcStep(project.design), document = importIfcGeometry(source), meshes: GeometryMesh[] = [], warnings: string[] = ["Linked editor import uses approximate IFC planning envelopes, not the editor's original meshes or construction-ready geometry.", "IFC Z-up metres are rotated into right-handed Y-up metres as (X, Z, -Y); triangle winding is retained.", "Constant diffuse material proxies are used. Openings, textures, parametric curves, terrain and unsupported IFC representations may be absent or approximated.", ...document.issues];
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]; let triangles = 0, missing = 0;
  for (const product of document.products) {
    if (!product.meshes.length) missing++;
    for (const [index, mesh] of product.meshes.entries()) {
      triangles += mesh.triangles.length / 3; if (triangles > MAX_SCENE_TRIANGLES) throw new Error("Project proxy exceeds 400,000 triangles; import a smaller subsystem.");
      const positions: number[] = [], indices: number[] = [];
      for (let offset = 0; offset < mesh.vertices.length; offset += 3) {
        const point: Vec3 = [mesh.vertices[offset], mesh.vertices[offset + 2], -mesh.vertices[offset + 1]];
        if (!validVec3(point)) throw new Error("Project proxy contains invalid or oversized coordinates.");
        positions.push(...point); for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
      }
      for (let offset = 0; offset < mesh.triangles.length; offset += 3) indices.push(mesh.triangles[offset], mesh.triangles[offset + 1], mesh.triangles[offset + 2]);
      const authoredId = product.properties["Groundwork Source.SourceId"], sourceId = authoredId && authoredId.length <= 180 ? authoredId : product.globalId;
      meshes.push({ id: `ifc:${product.globalId}:${index}`, sourceId, positions, indices, material: { color: [0.65, 0.7, 0.78], emission: [0, 0, 0], model: "diffuse", ior: 1.5 } });
    }
  }
  if (!meshes.length) throw new Error("No supported proxy solids were available. Export visible geometry from the editor's Presentation controls instead.");
  if (missing) warnings.push(`${missing} IFC products had no supported Body mesh and were excluded from this proxy scene.`);
  const target = min.map((item, axis) => (item + max[axis]) / 2) as Vec3, distance = Math.max(2, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 1.2), position: Vec3 = [target[0] + distance * 0.8, target[1] + distance * 0.6, target[2] + distance * 0.8];
  return inspectGeometryScene({ version: 1, units: "m", meshes, camera: { position, target, up: [0, 1, 0], fov: 50 }, warnings });
}

export function GeometryWorkbench() {
  const [scene, setScene] = useState<GeometryScene | null>(null), [manifest, setManifest] = useState<GeometryManifest | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [reports, setReports] = useState<Reports>(emptyReports), [settings, setSettings] = useState<PathTraceSettings>({ ...DEFAULT_TRACE_SETTINGS }), [tolerance, setTolerance] = useState(1e-6), [showViewport, setShowViewport] = useState(false), [hasImage, setHasImage] = useState(false), [image, setImage] = useState<SavedImage | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null), worker = useRef<Worker | null>(null), serial = useRef(0), alive = useRef(true), fileGeneration = useRef(0);
  // Progress previews are transient; only completed output changes saved state.
  const payload = useMemo<GeometryWorkspace>(() => ({ version: 1, scene, manifest, settings, tolerance, reports, image }), [scene, manifest, settings, tolerance, reports, image]);
  const report = reports.render ?? reports.clashes ?? reports.benchmark;
  const cancel = () => { serial.current++; worker.current?.terminate(); worker.current = null; setBusy(false); };
  const invalidateOutput = () => { setReports(emptyReports()); setImage(null); setHasImage(false); setProgress(0); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; fileGeneration.current++; serial.current++; worker.current?.terminate(); }; }, []);
  const restoreWorkspace = (value: unknown) => {
    const restored = inspectWorkspace(value); // Validate everything before mutation.
    fileGeneration.current++; cancel(); const generation = fileGeneration.current, job = serial.current;
    setScene(restored.scene); setManifest(restored.manifest); setSettings(restored.settings); setTolerance(restored.tolerance); setReports(restored.reports); setImage(restored.image); setShowViewport(false); setHasImage(false); setProgress(restored.image ? 1 : 0); setError("");
    if (restored.image) {
      const saved = restored.image, decoded = new Image();
      decoded.onload = () => {
        if (!alive.current || fileGeneration.current !== generation || serial.current !== job) return;
        const target = canvas.current;
        if (!target || decoded.naturalWidth !== saved.width || decoded.naturalHeight !== saved.height) { setError("Saved PNG decoded to unexpected dimensions."); setImage(null); setReports(current => ({ ...current, render: null })); return; }
        const context = target.getContext("2d");
        if (!context) { setError("Canvas drawing is unavailable; saved PNG data remains retained."); return; }
        target.width = saved.width; target.height = saved.height; context.drawImage(decoded, 0, 0); setHasImage(true);
      };
      decoded.onerror = () => { if (alive.current && fileGeneration.current === generation && serial.current === job) { setError("Saved PNG could not be decoded; scene/settings remain available."); setImage(null); setReports(current => ({ ...current, render: null })); } };
      decoded.src = saved.dataUrl;
    }
  };
  const importProject = (project: ProjectDetail) => {
    const imported = projectScene(project); fileGeneration.current++; cancel(); setScene(imported); setManifest(null); invalidateOutput(); setShowViewport(false); setError("");
  };
  const load = async (file: File | undefined) => {
    if (!file) return; const attempt = ++fileGeneration.current; cancel(); invalidateOutput(); setError("");
    try { if (file.size > 32_000_000) throw new Error("File exceeds 32 MB."); const value: unknown = JSON.parse(await file.text()); if (!alive.current || attempt !== fileGeneration.current) return;
      if (value && typeof value === "object" && "chunks" in value) { setManifest(inspectGeometryManifest(value)); setScene(null); } else { setScene(inspectGeometryScene(value)); setManifest(null); }
      setShowViewport(false);
    } catch (failure) { if (alive.current && attempt === fileGeneration.current) setError(failure instanceof Error ? failure.message : "Import failed."); }
  };
  const start = (request: GeometryRequest) => {
    fileGeneration.current++; cancel(); invalidateOutput(); setError(""); setBusy(true); const id = serial.current, started = performance.now();
    try {
      if (request.operation === "trace") inspectSettings(request.settings);
      const task = new Worker(new URL("../lib/geometry.worker.ts", import.meta.url), { type: "module" }); worker.current = task;
      task.onerror = () => { if (serial.current === id) { setError("Geometry worker failed to load or crashed."); setHasImage(false); cancel(); } };
      task.onmessage = (event: MessageEvent<GeometryResponse>) => {
        if (!alive.current || serial.current !== id || event.data.id !== id) return;
        const message = event.data;
        try {
          if (message.kind === "error") { setError(message.message); setHasImage(false); cancel(); return; }
          if (message.kind === "progress" || message.kind === "image") {
            if (request.operation !== "trace" || message.width !== request.settings.width || message.height !== request.settings.height || message.pixels.length !== message.width * message.height * 4) throw new Error("Invalid geometry image response.");
            const target = canvas.current, context = target?.getContext("2d"); if (!target || !context) throw new Error("Canvas drawing is unavailable.");
            target.width = message.width; target.height = message.height; context.putImageData(new ImageData(new Uint8ClampedArray(message.pixels), message.width, message.height), 0, 0); setHasImage(true); setProgress(message.kind === "image" ? 1 : message.fraction);
            if (message.kind === "image") {
              const finalImage = inspectImage({ dataUrl: target.toDataURL("image/png"), width: message.width, height: message.height })!;
              const render: RenderReport = { kind: "path-trace", verification: "unverified", settings: inspectSettings(request.settings), camera: request.scene.camera, meshes: request.scene.meshes.length, triangles: request.scene.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0), elapsedMs: performance.now() - started, note: "Completed CPU Monte Carlo image on this device. Constant material proxies; no texture maps, volumetrics, denoising or external validation." };
              setImage(finalImage); setReports({ ...emptyReports(), render });
            }
          } else if (message.kind === "clashes") { const saved = { ...emptyReports(), clashes: message.report }; inspectReports(saved, request.operation === "clash" ? request.scene : scene, settings, tolerance); setReports(saved); }
          else { const saved = { ...emptyReports(), benchmark: message.report }; inspectReports(saved, scene, settings, tolerance); setReports(saved); }
          if (message.kind !== "progress") cancel();
        } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not retain geometry output."); setHasImage(false); cancel(); }
      };
      task.postMessage({ ...request, id });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not start geometry worker."); cancel(); }
  };
  const saveImage = () => { if (image && hasImage) canvas.current?.toBlob(blob => { if (blob) downloadBlob("path-traced.png", blob); else setError("Image export failed."); }, "image/png"); };
  const changeSettings = (key: "width" | "height" | "samples" | "bounces" | "exposure", value: number) => { fileGeneration.current++; cancel(); invalidateOutput(); setSettings(previous => ({ ...previous, [key]: value })); };
  return <div className="space-y-5">
    <h1 className="text-2xl font-semibold">Geometry and rendering</h1>
    <p className="text-sm text-slate-400">Import visible editor meshes for triangle clashes and path tracing, or convert the linked editor model to declared IFC proxy envelopes. Streaming manifests select chunk levels by screen error.</p>
    <ProjectWorkspacePanel kind="geometry" payload={payload} onRestore={restoreWorkspace} onImportProject={importProject} />
    <Card className="space-y-3 p-4"><Input label="Geometry scene or streaming manifest (JSON)" type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void load(file); }} />
      <p className="text-sm">{scene ? `${scene.meshes.length.toLocaleString()} meshes · ${scene.meshes.reduce((sum, m) => sum + m.indices.length / 3, 0).toLocaleString()} triangles` : manifest ? `${manifest.chunks.length.toLocaleString()} streaming chunks` : "No geometry loaded."}</p>
      <Button variant="outline" disabled={!scene && !manifest} onClick={() => setShowViewport(v => !v)}>{showViewport ? "Close viewport" : "Open viewport"}</Button>
      {showViewport && <StreamingGeometryViewport scene={scene} manifest={manifest} />}
      {scene?.warnings.map((warning, i) => <p className="text-xs text-amber-300" key={i}>{warning}</p>)}
    </Card>
    <Card className="space-y-3 p-4"><h2 className="font-semibold">Mesh clashes</h2><Input label="Tolerance (metres)" type="number" min={1e-9} max={0.01} step="any" value={tolerance} onChange={event => { fileGeneration.current++; cancel(); invalidateOutput(); setTolerance(Number(event.target.value)); }} /><Button disabled={!scene || busy} onClick={() => scene && start({ id: 0, operation: "clash", scene, tolerance })}>Check mesh geometry</Button><p className="text-xs text-slate-400">Triangle intersections, coplanar contacts and closed-mesh containment. Partial reports explicitly identify budgets and ambiguous containment.</p></Card>
    <Card className="space-y-3 p-4"><h2 className="font-semibold">Path-traced image</h2><div className="grid grid-cols-2 gap-3 md:grid-cols-5">{(["width", "height", "samples", "bounces", "exposure"] as const).map(key => <Input key={key} label={key} type="number" step={key === "exposure" ? 0.1 : 1} value={settings[key]} onChange={event => changeSettings(key, Number(event.target.value))} />)}</div>
      <Button disabled={!scene || busy} onClick={() => scene && start({ id: 0, operation: "trace", scene, settings })}>Trace image</Button><span className="ml-3 text-sm">{Math.round(progress * 100)}%</span>
      <p className="text-xs text-slate-400">Diffuse indirect illumination, hard sun shadows, mirror and glass materials. Constant linear-RGB materials; texture maps, volumetrics and denoising are outside this renderer. Only a completed PNG is saved with its render report.</p>
      <canvas ref={canvas} className={hasImage ? "max-w-full rounded-xl border border-slate-700" : "hidden"} /><Button variant="outline" disabled={!image || !hasImage || busy} onClick={saveImage}>Download PNG</Button>
    </Card>
    <Card className="space-y-3 p-4"><h2 className="font-semibold">Performance measurements</h2><p className="text-xs text-slate-400">Explicitly measure a synthetic triangle BVH in a worker. Full editor performance needs representative project data and device measurements.</p>{([10_000, 100_000] as const).map(components => <Button key={components} className="mr-2" variant="outline" disabled={busy} onClick={() => start({ id: 0, operation: "benchmark", components })}>Measure {components.toLocaleString()}</Button>)}</Card>
    {busy && <Button variant="danger" onClick={() => { cancel(); setHasImage(false); setProgress(0); }}>Cancel job</Button>}{error && <p role="alert" className="text-amber-300">{error}</p>}
    {report !== null && <Card className="p-4"><Button variant="outline" onClick={() => download("geometry-report.json", JSON.stringify(report, null, 2), "application/json")}>Download report</Button><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(report, null, 2).slice(0, 150_000)}</pre></Card>}
    <Link className="text-sm text-emerald-300" to="/dashboard">Return to projects</Link>
  </div>;
}
