import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { getSharedProject } from "../api";
import { Logo } from "../components/Logo";
import { Spinner } from "../components/ui";
import { download } from "../lib/download";
import { resolveModelType } from "../lib/modules";
import type { PresentationApi } from "../lib/presentation";
import type { CameraWaypoint, CommunityDesign, Design, InfraDesign, InfraKind, SharedProject as SharedProjectData } from "../types";
import { PROJECT_TYPE_LABELS } from "../types";
import "./shared-project.css";

const Canvas3D = lazy(() => import("../editor/Canvas3D").then((module) => ({ default: module.Canvas3D })));
const CommunityScene = lazy(() => import("../editor/CommunityScene").then((module) => ({ default: module.CommunityScene })));
const InfraScene = lazy(() => import("../editor/InfraScene").then((module) => ({ default: module.InfraScene })));
const noop = () => undefined;
type Preview = { kind: "house"; design: Design } | { kind: "community"; design: CommunityDesign } | { kind: "infra"; design: InfraDesign } | { kind: "empty"; message: string } | { kind: "unavailable"; message: string };
type SharedState = { token: string; project: SharedProjectData | null; error: string };
type Detail = { label: string; value: string };
const infraTypes: InfraKind[] = ["highway", "airport", "ports", "dams"];
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const hasNumbers = (value: unknown, keys: string[]) => record(value) && keys.every((key) => finite(value[key]));
const numericItems = (value: unknown, keys: string[]) => Array.isArray(value) && value.every((item) => record(item) && typeof item.id === "string" && hasNumbers(item, keys));
const optionalArray = (value: unknown) => value === undefined || Array.isArray(value);
const formatNumber = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const formatDate = (seconds: number) => finite(seconds) && !Number.isNaN(new Date(seconds * 1000).getTime()) ? new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Unavailable";

/** Validate the saved payload without seeding a replacement model. */
function previewFor(project: SharedProjectData): Preview {
  const design: unknown = project.design;
  if (design === null || design === undefined) return { kind: "empty", message: "The owner has not saved a design for this project yet." };
  const unavailable = (message = "The saved design is incomplete. Its original data is available below."): Preview => ({ kind: "unavailable", message });
  if (!record(design)) return unavailable();
  const modelType = resolveModelType(project.projectType);
  if (infraTypes.includes(modelType as InfraKind)) {
    const infra = design.infra;
    if (!record(infra) || infra.kind !== modelType) return unavailable("This project does not contain a saved infrastructure model for its project type.");
    const required: Record<InfraKind, string[]> = {
      highway: ["lanes", "laneWidthM", "medianM", "shoulderM", "pavementThicknessMm", "embankmentHeightM", "culverts", "interchanges", "terrainRoughnessM"],
      airport: ["runways", "runwayLengthM", "runwayWidthM", "runwayHeadingDeg", "taxiways", "apronDepthM", "terminalAreaM2", "stands"],
      ports: ["berths", "berthLengthM", "draftM", "quayWidthM", "breakwaterLengthM", "containerYardM2", "cranes", "warehouses", "channelDepthM"],
      dams: ["heightM", "crestLengthM", "crestWidthM", "upstreamSlope", "downstreamSlope", "freeboardM", "reservoirAreaM2", "spillwayCapacityCumec", "spillwayGates", "gateWidthM", "gateHeightM", "groutCurtainDepthM"],
    };
    const kind = modelType as InfraKind;
    if (!hasNumbers(infra[kind], required[kind]) || !optionalArray(infra.facilities) || !optionalArray(infra.drafts)) return unavailable();
    return { kind: "infra", design: infra as unknown as InfraDesign };
  }
  if (modelType !== "house") {
    const community = design.community;
    if (!record(community) || !record(community.land) || !positive(community.land.width) || !positive(community.land.depth)
      || !["m", "ft", "yd"].includes(String(community.land.unit)) || !record(community.parking)
      || !["none", "surface", "underground"].includes(String(community.parking.mode))
      || !numericItems(community.towers, ["x", "z", "floors", "unitsPerFloor", "unitWidth", "unitDepth", "floorHeight"])
      || !numericItems(community.amenities, ["x", "z", "rotY", "w", "d", "h"])
      || !numericItems(community.exteriors, ["x", "y", "w", "h"])
      || !numericItems(community.interiors, ["floor", "x", "z", "w", "d"])) return unavailable();
    if (community.parking.mode === "underground" && !hasNumbers(community.parking.underground, ["levels", "floorHeight", "foundationDepth", "rampWidth", "rampLength"])) return unavailable();
    return { kind: "community", design: community as unknown as CommunityDesign };
  }
  const room = design.room;
  if (!record(room) || !positive(room.widthMm) || !positive(room.depthMm) || !positive(room.wallHeightMm)
    || typeof room.floorColor !== "string" || typeof room.wallColor !== "string"
    || !numericItems(design.furniture, ["x", "z", "rotationDeg", "scale"])
    || !(design.furniture as Record<string, unknown>[]).every((item) => typeof item.type === "string" && typeof item.color === "string")) return unavailable();
  if (design.curtains != null && (!record(design.curtains) || !hasNumbers(design.curtains, ["heightPercent", "widthPercentPerPanel"]))) return unavailable();
  return { kind: "house", design: design as unknown as Design };
}

function detailsFor(preview: Preview): Detail[] {
  if (preview.kind === "house") return [
    { label: "Room dimensions", value: `${formatNumber(preview.design.room.widthMm / 1000)} × ${formatNumber(preview.design.room.depthMm / 1000)} m` },
    { label: "Wall height", value: `${formatNumber(preview.design.room.wallHeightMm / 1000)} m` },
    { label: "Furniture & fixtures", value: formatNumber(preview.design.furniture.length) },
    { label: "Curtains", value: preview.design.curtains?.enabled ? "Included" : "None" },
  ];
  if (preview.kind === "community") return [
    { label: "Site dimensions", value: `${formatNumber(preview.design.land.width)} × ${formatNumber(preview.design.land.depth)} ${preview.design.land.unit}` },
    { label: "Buildings", value: formatNumber(preview.design.towers.length) },
    { label: "Interior rooms", value: formatNumber(preview.design.interiors.length) },
    { label: "Amenities", value: formatNumber(preview.design.amenities.length) },
    { label: "Parking", value: preview.design.parking.mode === "none" ? "None" : preview.design.parking.mode === "surface" ? "Surface" : "Underground" },
  ];
  if (preview.kind === "infra") {
    const { design } = preview;
    const details: Detail[] = [{ label: "Model status", value: design.modelReady === false ? "Site only · not generated" : "Generated" }];
    if (design.kind === "highway" && design.highway) details.push({ label: "Traffic lanes", value: formatNumber(design.highway.lanes) }, { label: "Lane width", value: `${formatNumber(design.highway.laneWidthM)} m` });
    if (design.kind === "airport" && design.airport) details.push({ label: "Runways", value: formatNumber(design.airport.runways) }, { label: "Runway dimensions", value: `${formatNumber(design.airport.runwayLengthM)} × ${formatNumber(design.airport.runwayWidthM)} m` });
    if (design.kind === "ports" && design.ports) details.push({ label: "Berths", value: formatNumber(design.ports.berths) }, { label: "Berth length", value: `${formatNumber(design.ports.berthLengthM)} m` });
    if (design.kind === "dams" && design.dams) details.push({ label: "Dam height", value: `${formatNumber(design.dams.heightM)} m` }, { label: "Crest length", value: `${formatNumber(design.dams.crestLengthM)} m` });
    details.push({ label: "Facility groups", value: formatNumber(design.facilities?.length ?? 0) });
    return details;
  }
  return [];
}

class SharedViewportBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="shared-project__empty" role="status"><ModelIcon /><h3>3D preview unavailable</h3><p>Your browser could not display this model. You can still review its details and saved design data below.</p></div> : this.props.children; }
}

function ModelIcon() {
  return <svg viewBox="0 0 48 48" width="48" height="48" fill="none" aria-hidden="true"><path d="m24 4 17 10v20L24 44 7 34V14L24 4Zm0 0v20m17-10L24 24 7 14m17 10v20" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
}

export function SharedProject() {
  const { token = "" } = useParams<{ token: string }>();
  const [state, setState] = useState<SharedState>({ token: "", project: null, error: "" });
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const viewerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<PresentationApi | null>(null);
  const homeRef = useRef<CameraWaypoint | null>(null);
  const project = state.token === token ? state.project : null;
  const error = state.token === token ? state.error : "";
  const preview = useMemo(() => project ? previewFor(project) : null, [project]);
  const details = useMemo(() => preview ? detailsFor(preview) : [], [preview]);

  useEffect(() => {
    let active = true;
    apiRef.current = null;
    homeRef.current = null;
    setCameraReady(false);
    setCameraError("");
    setState({ token, project: null, error: "" });
    if (!token) { setState({ token, project: null, error: "This share link is missing its access token." }); return; }
    void getSharedProject(token).then((next) => {
      if (!active) return;
      if (!finite(next.expiresAt) || next.expiresAt * 1000 <= Date.now()) setState({ token, project: null, error: "This share link has expired. Ask the project owner for a new link." });
      else setState({ token, project: next, error: "" });
    }).catch((err: unknown) => {
      if (active) setState({ token, project: null, error: err instanceof Error ? err.message : "This share link is unavailable." });
    });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!project) return;
    let timer = 0;
    const checkExpiry = () => {
      const remaining = project.expiresAt * 1000 - Date.now();
      if (remaining <= 0) setState({ token, project: null, error: "This share link has expired. Ask the project owner for a new link." });
      else timer = window.setTimeout(checkExpiry, Math.min(remaining, 2_147_483_647));
    };
    checkExpiry();
    return () => window.clearTimeout(timer);
  }, [project, token]);

  const onPresentationReady = useCallback((api: PresentationApi | null) => {
    apiRef.current = api;
    homeRef.current = api ? api.captureCameraWaypoint("Shared project overview") : null;
    setCameraReady(Boolean(api));
    // Editor pointer interactions are disabled; the shared viewer exposes camera controls only.
    viewerRef.current?.querySelectorAll("canvas, button").forEach((element) => {
      element.setAttribute("tabindex", "-1");
      if (element.tagName === "CANVAS") element.setAttribute("aria-label", "Read-only shared project model. Use the viewer controls to change the camera.");
    });
  }, []);

  const moveCamera = (action: "left" | "right" | "in" | "out" | "top" | "reset") => {
    const api = apiRef.current;
    if (!api) return;
    try {
      if (action === "reset" && homeRef.current) { api.showCameraWaypoint(homeRef.current); setCameraError(""); return; }
      const current = api.captureCameraWaypoint("Shared view");
      const [tx, ty, tz] = current.target;
      let dx = current.position[0] - tx, dy = current.position[1] - ty, dz = current.position[2] - tz;
      if (action === "left" || action === "right") {
        const angle = action === "left" ? -Math.PI / 8 : Math.PI / 8;
        const rotatedX = dx * Math.cos(angle) + dz * Math.sin(angle);
        dz = dz * Math.cos(angle) - dx * Math.sin(angle);
        dx = rotatedX;
      } else if (action === "top") { dy = Math.hypot(dx, dy, dz); dx = 0; dz = Math.max(dy * 0.005, 0.01); }
      else {
        const factor = action === "in" ? 0.82 : 1.22, distance = Math.hypot(dx, dy, dz);
        if ((action === "in" && distance < 0.5) || (action === "out" && distance > 1_000_000)) return;
        dx *= factor; dy *= factor; dz *= factor;
      }
      api.showCameraWaypoint({ ...current, position: [tx + dx, ty + dy, tz + dz] });
      setCameraError("");
    } catch { setCameraError("The camera controls are unavailable. Reload the page to reopen the model."); }
  };

  const exportDesign = () => {
    if (!project?.design) return;
    const filename = project.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "shared-project";
    download(`${filename}.json`, JSON.stringify(project.design, null, 2), "application/json");
  };

  return <div className="shared-project">
    <a href="#shared-project-content" className="gw-skip-link">Skip to project</a>
    <header className="shared-project__header"><Link to="/" aria-label="Groundwork home"><Logo /></Link><Link to="/" className="shared-project__home-link">Back to home <span aria-hidden="true">↗</span></Link></header>
    {!project && !error ? <main id="shared-project-content" className="shared-project__status" aria-busy="true"><div><Spinner className="h-7 w-7" /><p className="gw-kicker">Opening shared project</p><h1>A closer look, together.</h1><p>Loading the project and its saved model.</p></div></main>
      : error ? <main id="shared-project-content" className="shared-project__status"><div><ModelIcon /><p className="gw-kicker">Shared project</p><h1>Share link unavailable</h1><p role="alert">{error}</p><Link to="/" className="gw-link-button gw-button-primary">Return to Groundwork <span aria-hidden="true">↗</span></Link></div></main>
      : project && preview ? <main id="shared-project-content" className="shared-project__main">
        <div className="shared-project__intro"><div><p className="gw-kicker">Groundwork / shared project</p><h1>{project.name}</h1><p>{PROJECT_TYPE_LABELS[project.projectType] ?? project.projectType}<span aria-hidden="true"> · </span>Shared for your perspective.</p></div><span className="shared-project__readonly"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M5 7V5a3 3 0 0 1 6 0v2M4 7h8v7H4V7Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg> Read only</span></div>
        <div className="shared-project__layout">
          <section className="shared-project__model-panel" aria-labelledby="shared-model-title"><div className="shared-project__model-heading"><div><span className="shared-project__live-dot" /><h2 id="shared-model-title">Project model</h2></div><span>3D VIEW</span></div>
            <div className="shared-project__viewport" ref={viewerRef} role="group" aria-label={`${project.name}, read-only 3D model`} aria-describedby={preview.kind === "empty" || preview.kind === "unavailable" ? undefined : "shared-viewer-help"} key={token}>
              {preview.kind === "empty" || preview.kind === "unavailable" ? <div className="shared-project__empty"><ModelIcon /><h3>{preview.kind === "empty" ? "A design is still taking shape" : "Preview unavailable"}</h3><p>{preview.message}</p></div>
                : <SharedViewportBoundary key={`${token}-${project.id}`}><Suspense fallback={<div className="shared-project__empty" aria-busy="true"><Spinner className="h-6 w-6" /><p>Preparing the 3D model…</p></div>}>
                  {preview.kind === "house" ? <Canvas3D design={preview.design} photoUrl={null} showPhoto={false} photoOpacity={0} selectedId={null} onSelect={noop} onChange={noop} onApiReady={onPresentationReady} />
                    : preview.kind === "community" ? <CommunityScene design={preview.design} selectedId={null} activeTool="select" onSelect={noop} onPresentationReady={onPresentationReady} visualization={project.design?.visualization} />
                      : <InfraScene infra={preview.design} activeTool="select" onSelect={noop} onPresentationReady={onPresentationReady} visualization={project.design?.visualization} />}
                </Suspense></SharedViewportBoundary>}
            </div>
            {(preview.kind === "house" || preview.kind === "community" || preview.kind === "infra") && <div className="shared-project__camera-toolbar" aria-label="Read-only camera controls">
              <div className="shared-project__camera-buttons"><button type="button" disabled={!cameraReady} onClick={() => moveCamera("left")} aria-label="Orbit camera left" title="Orbit left">↶</button><button type="button" disabled={!cameraReady} onClick={() => moveCamera("right")} aria-label="Orbit camera right" title="Orbit right">↷</button><span /><button type="button" disabled={!cameraReady} onClick={() => moveCamera("in")} aria-label="Zoom in" title="Zoom in">+</button><button type="button" disabled={!cameraReady} onClick={() => moveCamera("out")} aria-label="Zoom out" title="Zoom out">−</button><span /><button type="button" disabled={!cameraReady} onClick={() => moveCamera("top")} aria-label="Show top view" title="Top view"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10v10H3V3Zm0 5h10M8 3v10" /></svg></button><button type="button" disabled={!cameraReady} onClick={() => moveCamera("reset")} aria-label="Reset camera view" title="Reset view"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 7a5 5 0 1 1 .6 4M3 3v4h4" /></svg></button></div>
              <p id="shared-viewer-help">Use the controls to explore the model.</p>
            </div>}
            {cameraError && <p className="shared-project__camera-error" role="status">{cameraError}</p>}
          </section>
          <aside className="shared-project__details" aria-label="Project details"><section className="shared-project__detail-card"><p className="gw-kicker">The project at a glance</p><h2>Design overview</h2><dl><div><dt>Project type</dt><dd>{PROJECT_TYPE_LABELS[project.projectType] ?? project.projectType}</dd></div><div><dt>Project dimensions</dt><dd>{finite(project.widthMm) && finite(project.depthMm) ? `${formatNumber(project.widthMm / 1000)} × ${formatNumber(project.depthMm / 1000)} m` : "Unavailable"}</dd></div>{finite(project.widthMm) && finite(project.depthMm) && <div><dt>Project area</dt><dd>{formatNumber(project.widthMm * project.depthMm / 1_000_000)} m²</dd></div>}<div><dt>Last updated</dt><dd>{formatDate(project.updatedAt)}</dd></div></dl></section>
            {details.length > 0 && <section className="shared-project__detail-card"><p className="gw-kicker">Saved model</p><h2>In the details</h2><dl>{details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl></section>}
            <div className="shared-project__access-note"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" aria-hidden="true"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-3 9 2 2 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg><div><h3>Made for viewing</h3><p>Explore the saved design and its details. Project editing is available to the owner and their team.</p><p>Access expires {formatDate(project.expiresAt)}.</p></div></div>
          </aside>
        </div>
        {project.design && <details className="shared-project__raw"><summary><span>Saved design data</span><span className="shared-project__raw-label">JSON <span aria-hidden="true">+</span></span></summary><div className="shared-project__raw-content"><div><p>The original saved design, for a closer technical review.</p><button type="button" className="gw-button gw-button-secondary" onClick={exportDesign}>Download JSON <span aria-hidden="true">↓</span></button></div><pre>{JSON.stringify(project.design, null, 2)}</pre></div></details>}
        <footer className="shared-project__footer"><span>Groundwork Design Studio</span><span>Spaces worth shaping.</span></footer>
      </main> : null}
  </div>;
}
