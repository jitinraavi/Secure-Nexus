import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useParams } from "react-router-dom";
import {
  getProject,
  patchProject,
  recordExport,
  uploadProjectPhoto,
  type CollaborationEvent,
} from "../api";
import { useToast } from "../components/Toast";
import { Badge, Button, Modal, Select, Spinner, Toggle } from "../components/ui";
import { Canvas3D, type EditorApi } from "../editor/Canvas3D";
import { CATALOG, catalogEntry, furnitureMount } from "../lib/catalog";
import { download, downloadBlob, zipFiles } from "../lib/download";
import type { Design, FurnitureItem, InfraKind, ProjectType } from "../types";
import { defaultDesign, PROJECT_TYPE_LABELS } from "../types";
import { cn } from "../lib/cn";
import { isInfraType, resolveModelType } from "../lib/modules";
import { defaultCommunity } from "../lib/community";
import { ensureInfraDesign, INFRA_LABELS } from "../lib/infra";
import { CommunityEditor } from "./CommunityEditor";
import { InfraEditor } from "./InfraEditor";
import { CollaborationStatus } from "../components/CollaborationStatus";
import { MepPanel } from "../components/MepPanel";
import { SheetHeader } from "../components/SheetHeader";
import { DesignExportMenu } from "../components/DesignExportMenu";
import { ProjectHistory } from "../components/ProjectHistory";
import { validateIfcRoundTrip } from "../lib/bim";
import { VisualizationControls } from "../components/VisualizationControls";

const SWATCHES = [
  "#7c8a99", "#a4714f", "#8a6a45", "#5d7b8a", "#6b5542", "#4c7a9c",
  "#b45f5f", "#96a5b0", "#4f5b66", "#2f4050", "#3a3a3a", "#e8dec8",
];

const CATEGORIES = [...new Set(CATALOG.map((c) => c.category))];

type PanelTab = "items" | "room" | "curtains" | "mep";
type MobilePanel = PanelTab | "catalog";

const wallKey = (w: "north" | "south" | "east" | "west") =>
  ({ north: "North wall", south: "South wall", east: "East wall", west: "West wall" })[w];

function landDimensionText(c: NonNullable<Design["community"]>): string {
  const unit = c.land.unit === "m" ? "m" : c.land.unit === "yd" ? " yd" : " ft";
  return `${c.land.width} × ${c.land.depth} ${unit} · ${c.towers.length} tower(s)`;
}

export function Editor() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();

  const [name, setName] = useState("");
  const [design, setDesign] = useState<Design>(defaultDesign);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [api, setApi] = useState<EditorApi | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [remoteRevision, setRemoteRevision] = useState<number | null>(null);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(true);
  const [photoOpacity, setPhotoOpacity] = useState(0.65);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [projectType, setProjectType] = useState<ProjectType>("house");
  const model = resolveModelType(projectType);

  const [panelTab, setPanelTab] = useState<PanelTab>("items");
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(null);

  const saveTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const project = await getProject(id!);
      setName(project.name);
      setRevision(project.revision ?? 0);
      const pt = (project as { projectType?: ProjectType }).projectType ?? "house";
      setProjectType(pt);
      const base = project.design
        ? (project.design as Design)
        : {
            ...defaultDesign(),
            room: {
              ...defaultDesign().room,
              widthMm: project.widthMm,
              depthMm: project.depthMm,
            },
          };
      const type = resolveModelType(pt);
      let seeded = base;
      if ((pt === "residential" || pt === "villa-community" || pt === "townhouse") && !seeded.community) {
        seeded = {
          ...seeded,
          community: {
            ...defaultCommunity("residential"),
            residentialStyle: pt === "villa-community" ? "villa-community" : pt === "townhouse" ? "townhouse" : "high-rise",
          },
        };
      } else if (pt === "commercial" && !seeded.community) {
        seeded = { ...seeded, community: defaultCommunity("commercial") };
      }
      if (isInfraType(type)) seeded = ensureInfraDesign(seeded, type as InfraKind);
      setDesign(seeded);
      if (project.hasPhoto) setPhotoUrl(`/api/projects/${id}/photo?v=${project.updatedAt}`);
      setLoaded(true);
    } catch (err) {
      toast.push({ title: "Could not open project", description: err instanceof Error ? err.message : undefined, tone: "error" });
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [load]);

  const scheduleSave = useCallback(
    (d: Design) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        try {
          setSaving(true);
          const saved = await patchProject(id!, {
            name,
            projectType,
            widthMm: d.room.widthMm,
            depthMm: d.room.depthMm,
            designData: JSON.stringify(d),
            baseRevision: revision,
          });
          setRevision(saved.revision);
          setLastSaved(Date.now());
        } catch (err) {
          toast.push({ title: "Could not save design", description: err instanceof Error ? err.message : undefined, tone: "error" });
        } finally {
          setSaving(false);
        }
      }, 1200);
    },
    [id, name, revision, toast, projectType],
  );

  const onCollaborationEvent = useCallback((event: CollaborationEvent) => {
    if (event.type === "design.updated" && event.revision > revision) setRemoteRevision(event.revision);
  }, [revision]);

  const changeDesign = useCallback(
    (d: Design) => {
      setDesign(d);
      scheduleSave(d);
    },
    [scheduleSave],
  );

  const mutateFurniture = useCallback(
    (fn: (items: FurnitureItem[]) => FurnitureItem[]) => {
      changeDesign({ ...design, furniture: fn(design.furniture) });
    },
    [changeDesign, design],
  );

  const addItem = (type: string) => {
    const entry = catalogEntry(type);
    if (!entry) return;
    const count = design.furniture.filter((f) => f.type === type).length;
    const item: FurnitureItem = {
      id: crypto.randomUUID(),
      type,
      name: count === 0 ? entry.name : `${entry.name} ${count + 1}`,
      x: 300 * (design.furniture.length % 4) - 450,
      z: 200 * (design.furniture.length % 3) - 200,
      rotationDeg: 0,
        scale: 1,
        color: entry.defaultColor,
        mount: furnitureMount(type),
        mountWall: "north",
    };
    mutateFurniture((items) => [...items, item]);
    setSelectedId(item.id);
  };

  const selected = design.furniture.find((f) => f.id === selectedId) ?? null;
  const selectedEntry = selected ? catalogEntry(selected.type) : null;

  const updateSelected = (patch: Partial<FurnitureItem>) => {
    if (!selectedId) return;
    mutateFurniture((items) => items.map((f) => (f.id === selectedId ? { ...f, ...patch } : f)));
  };

  const removeSelected = () => {
    if (!selectedId) return;
    mutateFurniture((items) => items.filter((f) => f.id !== selectedId));
    setSelectedId(null);
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      await uploadProjectPhoto(id!, file);
      setPhotoUrl(`/api/projects/${id}/photo?v=${Date.now()}`);
      setShowPhoto(true);
      toast.push({ title: "Room photo uploaded", description: file.name, tone: "success" });
    } catch (err) {
      toast.push({ title: "Upload failed", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            void uploadFile(file);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [uploadFile]);

  const onCanvasDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
    if (file) void uploadFile(file);
  };

  const exportTo = async (format: string) => {
    if (!api) return;
    setExporting(format);
    try {
      const stem = name.trim().replace(/[^\w-]+/g, "-").toLowerCase() || "design";
      if (format === "dxf") {
        const { buildDxf } = await import("../lib/dxf");
        download(`${stem}.dxf`, buildDxf(design), "application/dxf");
      } else if (format === "obj") {
        const { buildObjMtl } = await import("../lib/obj");
        const { obj, mtl } = buildObjMtl(design);
        const blob = await zipFiles([{ name: `${stem}.obj`, content: obj }, { name: `${stem}.mtl`, content: mtl }]);
        downloadBlob(`${stem}-blender.zip`, blob);
      } else if (format === "glb") {
        const blob = await api.exportGlb();
        downloadBlob(`${stem}.glb`, blob);
      } else if (format === "csv") {
        const { buildBillOfMaterials } = await import("../lib/obj");
        download(`${stem}-bom.csv`, buildBillOfMaterials(design), "text/csv");
      } else if (format === "bim") {
        const [{ buildObjMtl }, { buildBimExchange, buildBimScheduleCsv, buildIfcStep }, { buildDxf }] = await Promise.all([
          import("../lib/obj"),
          import("../lib/bim"),
          import("../lib/dxf"),
        ]);
        const ifcReport = validateIfcRoundTrip(design);
        if (!ifcReport.valid) throw new Error("IFC validation failed; resolve the reported errors before exporting the coordination package.");
        const { obj, mtl } = buildObjMtl(design);
        const entries: { name: string; content: string | Blob }[] = [
          { name: `${stem}.ifc`, content: buildIfcStep(design) },
          { name: `${stem}.ifc.json`, content: buildBimExchange(design) },
          { name: `${stem}.ifc.validation.json`, content: JSON.stringify(ifcReport, null, 2) + "\n" },
          { name: `${stem}-coordination.csv`, content: buildBimScheduleCsv(design) },
          { name: `${stem}.dxf`, content: buildDxf(design) },
          { name: `${stem}.obj`, content: obj },
          { name: `${stem}.mtl`, content: mtl },
        ];
        try {
          entries.push({ name: `${stem}.glb`, content: await api.exportGlb() });
        } catch {
          /* The structured package remains useful when the optional GLB scene is unavailable. */
        }
        downloadBlob(`${stem}-coordination.zip`, await zipFiles(entries));
      } else if (format === "png") {
        const blob = await api.capturePng();
        downloadBlob(`${stem}-presentation.png`, blob);
      } else if (format === "ifc") {
        const [{ buildIfcStep }, ifcReport] = await Promise.all([import("../lib/bim"), Promise.resolve(validateIfcRoundTrip(design))]);
        if (!ifcReport.valid) throw new Error("IFC validation failed; resolve the reported errors before downloading the model.");
        download(`${stem}.ifc`, buildIfcStep(design), "application/x-step");
      }
      await recordExport(id!, format);
      toast.push({ title: `Exported ${format.toUpperCase()}`, description: `${stem}.${format === "blender" ? "zip" : format}`, tone: "success" });
    } catch (err) {
      toast.push({ title: "Export failed", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setExporting(null);
    }
  };

  const canUseCamera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const onHistoryRestore = (state: { design: Design | null; projectType: ProjectType; widthMm: number; depthMm: number }) => {
    const restored = state.design ?? defaultDesign();
    setDesign({ ...restored, room: { ...restored.room, widthMm: state.widthMm, depthMm: state.depthMm } });
    setProjectType(state.projectType);
    setLastSaved(Date.now());
  };

  const catalogContent = (
    <>
      <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Furniture library</p>
      {CATEGORIES.map((cat) => (
        <div key={cat} className="mb-2">
          <p className="px-1 py-1 text-xs font-medium text-slate-400">{cat}</p>
          {CATALOG.filter((c) => c.category === cat).map((entry) => (
            <button
              key={entry.id}
              onClick={() => { addItem(entry.id); setMobilePanel(null); }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm text-slate-300 transition hover:bg-slate-800"
            >
              <span className="h-5 w-5 shrink-0 rounded-md border border-slate-700" style={{ backgroundColor: entry.defaultColor }} />
              {entry.name}
            </button>
          ))}
        </div>
      ))}
    </>
  );

  const panelContent = (
    <>
      <div className="mb-3 flex gap-1 rounded-xl bg-slate-950 p-1">
        {([["items", "Place"], ["room", "Room"], ["curtains", "Curtains"], ["mep", "MEP"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPanelTab(key)}
            className={cn("flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition", panelTab === key ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300")}
          >
            {label}
          </button>
        ))}
      </div>

      {panelTab === "items" && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-100">{selected.name}</p>
                  <p className="text-xs text-slate-500">{selectedEntry?.w} × {selectedEntry?.d} × {selectedEntry?.h} mm</p>
                </div>
                <Badge tone="cyan">{Math.round(selected.rotationDeg)}°</Badge>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Finish colour</p>
                <div className="flex items-center gap-2">
                  <input type="color" value={selected.color} onChange={(e) => updateSelected({ color: e.target.value })} className="h-9 w-12 cursor-pointer rounded-lg border border-slate-700 bg-transparent" />
                  <div className="flex flex-wrap gap-1.5">
                    {SWATCHES.map((s) => (
                      <button key={s} onClick={() => updateSelected({ color: s })} className={cn("h-6 w-6 rounded-md border transition", selected.color === s ? "border-emerald-400 ring-2 ring-emerald-400/40" : "border-slate-700")} style={{ backgroundColor: s }} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scale</p><p className="text-xs text-slate-400">{Math.round(selected.scale * 100)}%</p></div>
                <input type="range" min={0.5} max={1.5} step={0.05} value={selected.scale} onChange={(e) => updateSelected({ scale: Number(e.target.value) })} className="w-full accent-emerald-500" />
              </div>
              <Select label="Mounting" value={selected.mount ?? furnitureMount(selected.type)} onChange={(e) => updateSelected({ mount: e.target.value as FurnitureItem["mount"] })}>
                <option value="unassigned">Choose placement</option>
                <option value="floor">Floor</option>
                <option value="wall">Wall</option>
                <option value="ceiling">Ceiling</option>
              </Select>
              {(selected.mount ?? furnitureMount(selected.type)) === "wall" && (
                <Select label="Wall" value={selected.mountWall ?? "north"} onChange={(e) => updateSelected({ mountWall: e.target.value as FurnitureItem["mountWall"] })}>
                  <option value="north">North wall</option>
                  <option value="east">East wall</option>
                  <option value="south">South wall</option>
                  <option value="west">West wall</option>
                </Select>
              )}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rotate</p>
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => updateSelected({ rotationDeg: (selected.rotationDeg - 45 + 360) % 360 })}>⟲ 45°</Button>
                  <Button variant="secondary" size="sm" onClick={() => updateSelected({ rotationDeg: (selected.rotationDeg + 45) % 360 })}>45° ⟳</Button>
                  <Button variant="secondary" size="sm" onClick={() => updateSelected({ rotationDeg: 0 })}>Reset</Button>
                </div>
              </div>
              <Button variant="danger" size="sm" className="w-full" onClick={removeSelected}>Remove from design</Button>
            </div>
          ) : design.furniture.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              <p>Click a piece in the library to add it.</p>
              <p className="mt-1 text-xs text-slate-600">Drag items around the room to position them.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {design.furniture.map((f) => (
                <button key={f.id} onClick={() => setSelectedId(f.id)} className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition", selectedId === f.id ? "bg-emerald-500/10 text-emerald-300" : "text-slate-300 hover:bg-slate-800")}>
                  <span className="h-4 w-4 rounded border border-slate-700" style={{ backgroundColor: f.color }} />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {panelTab === "room" && (
        <div className="flex-1 space-y-4 overflow-y-auto">
          <RoomNum label="Width" value={design.room.widthMm} unit=" mm" step={100} min={100} onChange={(v) => changeDesign({ ...design, room: { ...design.room, widthMm: Math.max(Number.isFinite(v) ? v : 0, 100) } })} />
          <RoomNum label="Depth" value={design.room.depthMm} unit=" mm" step={100} min={100} onChange={(v) => changeDesign({ ...design, room: { ...design.room, depthMm: Math.max(Number.isFinite(v) ? v : 0, 100) } })} />
          <RoomNum label="Ceiling height" value={design.room.wallHeightMm} unit=" mm" step={100} min={100} onChange={(v) => changeDesign({ ...design, room: { ...design.room, wallHeightMm: Math.max(Number.isFinite(v) ? v : 0, 100) } })} />
          <ColorField label="Wall colour" value={design.room.wallColor} onChange={(c) => changeDesign({ ...design, room: { ...design.room, wallColor: c } })} />
          <ColorField label="Floor colour" value={design.room.floorColor} onChange={(c) => changeDesign({ ...design, room: { ...design.room, floorColor: c } })} />
        </div>
      )}

      {panelTab === "curtains" && (
        <div className="flex-1 space-y-4 overflow-y-auto">
          <Toggle checked={Boolean(design.curtains?.enabled)} onChange={(v) => changeDesign({ ...design, curtains: v ? { enabled: true, style: "panel", color: "#e8e4da", wall: "north", heightPercent: 1, widthPercentPerPanel: 0.2 } : null })} label="Enable curtains" />
          {design.curtains?.enabled && (
            <>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Style</p>
                <div className="grid grid-cols-2 gap-2">
                  {(["sheer", "blackout", "roman", "panel"] as const).map((s) => (
                    <button key={s} onClick={() => changeDesign({ ...design, curtains: { ...design.curtains!, style: s } })} className={cn("rounded-lg border px-2 py-1.5 text-xs font-semibold capitalize", design.curtains!.style === s ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-slate-700 text-slate-400")}>{s}</button>
                  ))}
                </div>
              </div>
              <Select label="Wall" value={design.curtains.wall} onChange={(e) => changeDesign({ ...design, curtains: { ...design.curtains!, wall: e.target.value as "north" | "south" | "east" | "west" } })}>
                {(["north", "south", "east", "west"] as const).map((w) => <option key={w} value={w}>{wallKey(w)}</option>)}
              </Select>
              <ColorField label="Curtain colour" value={design.curtains.color} onChange={(c) => changeDesign({ ...design, curtains: { ...design.curtains!, color: c } })} />
              <SliderField label="Length" value={Math.round(design.curtains.heightPercent * 100)} display={`${Math.round(design.curtains.heightPercent * 100)}%`} min={60} max={100} step={5} onChange={(v) => changeDesign({ ...design, curtains: { ...design.curtains!, heightPercent: v / 100 } })} />
              <SliderField label="Panel width" value={Math.round(design.curtains.widthPercentPerPanel * 100)} display={`${Math.round(design.curtains.widthPercentPerPanel * 100)}%`} min={10} max={40} step={5} onChange={(v) => changeDesign({ ...design, curtains: { ...design.curtains!, widthPercentPerPanel: v / 100 } })} />
            </>
          )}
        </div>
      )}

      {panelTab === "mep" && <div className="flex-1 space-y-4 overflow-y-auto"><MepPanel value={design.mep} onChange={(mep) => changeDesign({ ...design, mep })} /></div>}
    </>
  );

  const community = design.community;
  const residentialProject = projectType === "residential" || projectType === "villa-community" || projectType === "townhouse";
  const communityActive = loaded && (residentialProject || projectType === "commercial") && community != null;

  const infraKind = isInfraType(model) ? (model as InfraKind) : null;
  const infraActive = loaded && infraKind && design.infra?.kind === infraKind;

  if (communityActive && community) {
    return (
      <div className="relative flex h-[calc(100vh-6rem)] flex-col lg:h-[calc(100vh-3rem)]">
        <SheetHeader
          eyebrow="Project sheet"
          title={<input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => scheduleSave(design)} className="w-full max-w-xs rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold text-slate-100 outline-none hover:border-slate-700 focus:border-emerald-500" aria-label="Project title" />}
          meta={<>{PROJECT_TYPE_LABELS[projectType] ?? projectType} · {saving ? "Saving" : lastSaved ? "Saved" : "Draft"} · <CollaborationStatus projectId={id!} onRemoteEvent={onCollaborationEvent} />{remoteRevision ? " · Remote update available" : ""}</>}
        />
        <div className="gw-sheet-toolbar mb-3 mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
          <p className="text-xs text-slate-500">
            {landDimensionText(community)}
            {saving ? " · saving…" : lastSaved ? " · saved" : ""}
          </p>
           <div className="flex-1" />
           <ProjectHistory projectId={id!} currentDesign={design} onRestored={onHistoryRestore} />
           <Badge tone={residentialProject ? "emerald" : "cyan"}>
            {PROJECT_TYPE_LABELS[projectType] ?? projectType}
          </Badge>
        </div>
        <CommunityEditor
           branch={residentialProject ? "residential" : "commercial"}
          community={community}
           projectName={name}
           design={design}
           onVisualizationChange={changeDesign}
          onChange={(c) => {
            const next = { ...design, community: c };
            setDesign(next);
            scheduleSave(next);
          }}
        />
      </div>
    );
  }

  if (infraActive && infraKind && design.infra) {
    return (
      <div className="relative flex h-[calc(100vh-6rem)] flex-col lg:h-[calc(100vh-3rem)]">
         <SheetHeader eyebrow="Project sheet" title={<input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => scheduleSave(design)} className="w-full max-w-xs rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold text-slate-100 outline-none hover:border-slate-700 focus:border-emerald-500" aria-label="Project title" />} meta={<>{INFRA_LABELS[infraKind]} · {saving ? "Saving" : lastSaved ? "Saved" : "Draft"} · <CollaborationStatus projectId={id!} onRemoteEvent={onCollaborationEvent} />{remoteRevision ? " · Remote update available" : ""}</>} tone="amber" />
        <div className="gw-sheet-toolbar mb-3 mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => scheduleSave(design)}
            className="w-full max-w-xs rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-slate-100 outline-none hover:border-slate-700 focus:border-emerald-500"
            aria-label="Project name"
          />
          <p className="text-xs text-slate-500">
            {design.infra.location
              ? `${design.infra.location.lat.toFixed(4)}, ${design.infra.location.lng.toFixed(4)}`
              : "No site located yet"}
            {saving ? " · saving…" : lastSaved ? " · saved" : ""}
          </p>
           <div className="flex-1" />
           <ProjectHistory projectId={id!} currentDesign={design} onRestored={onHistoryRestore} />
           <Badge tone="amber">{INFRA_LABELS[infraKind]}</Badge>
        </div>
        <InfraEditor
          kind={infraKind}
          infra={design.infra}
          projectName={name}
           design={design}
           onVisualizationChange={changeDesign}
          onChange={(next) => {
            const updated = { ...design, infra: next };
            setDesign(updated);
            scheduleSave(updated);
          }}
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-[calc(100vh-6rem)] flex-col lg:h-[calc(100vh-3rem)]">
        <SheetHeader eyebrow="Interior sheet" title={<input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => scheduleSave(design)} className="w-full max-w-xs rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold text-slate-100 outline-none hover:border-slate-700 focus:border-emerald-500" aria-label="Project title" />} meta={<>{PROJECT_TYPE_LABELS[projectType] ?? projectType} · {saving ? "Saving" : lastSaved ? "Saved" : "Draft"} · <CollaborationStatus projectId={id!} onRemoteEvent={onCollaborationEvent} />{remoteRevision ? " · Remote update available" : ""}</>} />
       <div className="gw-sheet-toolbar mb-3 mt-2 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
         <div className="min-w-0 flex-1">
          <p className="mt-0.5 text-xs text-slate-500">
            {design.room.widthMm / 1000} × {design.room.depthMm / 1000} m · {design.furniture.length} item(s)
            {saving ? " · saving…" : lastSaved ? " · saved" : ""}
          </p>
        </div>

          <ProjectHistory projectId={id!} currentDesign={design} onRestored={onHistoryRestore} />
          <Badge tone="slate">{design.room.widthMm / 1000} × {design.room.depthMm / 1000} m · {design.furniture.length} items</Badge>

        <Button variant="secondary" size="sm" onClick={() => setCameraOpen(true)} disabled={!canUseCamera}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3L7.3 5H4a2 2 0 00-2 2v11a2 2 0 002 2h16a2 2 0 002-2V7a2 2 0 00-2-2h-3.3L15 3H9zm3 14a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z" /></svg>
          Camera
        </Button>
        <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17v3h18v-3M7 8l5-5 5 5M12 3v11" /></svg>
          Upload photo
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadFile(f);
            e.target.value = "";
          }}
        />

         <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
           <Button variant="ghost" size="sm" onClick={() => api?.topView()} title="Top view">Top</Button>
           <Button variant="ghost" size="sm" onClick={() => api?.frontView()} title="Front view">Front</Button>
           <Button variant="ghost" size="sm" onClick={() => api?.detailView()} title="Presentation detail view">Detail</Button>
           <Button variant="ghost" size="sm" onClick={() => api?.toggleSection()} title="Toggle cutaway section">Cutaway</Button>
           <Button variant="ghost" size="sm" onClick={() => api?.resetView()} title="Reset view">Home</Button>
         </div>

        <Button size="sm" onClick={() => setExportOpen(true)}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17v3h18v-3M7 8l5-5 5 5M12 3v11" /></svg>
          Export / ship to CAD
        </Button>
        <DesignExportMenu design={design} projectName={name} onChange={changeDesign} />
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Catalog sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-3 lg:flex">
          {catalogContent}
        </aside>

        {/* 3D canvas */}
        <div
          className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-slate-800 bg-[#10141c]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onCanvasDrop}
        >
          {loaded && (
            <Canvas3D
              design={design}
              photoUrl={photoUrl}
              showPhoto={showPhoto && Boolean(photoUrl)}
              photoOpacity={photoOpacity}
              selectedId={selectedId}
              onChange={changeDesign}
              onSelect={setSelectedId}
              onApiReady={setApi}
            />
          )}
           {!photoUrl && !uploading && (
            <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1 text-[11px] text-slate-400 backdrop-blur">
              Drop a photo here or paste (Ctrl/Cmd+V) to trace the site
            </div>
           )}
           <div className="pointer-events-auto absolute bottom-3 right-3 z-10 max-w-full">
             <VisualizationControls design={design} onChange={changeDesign} />
           </div>
          {uploading && (
            <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full border border-emerald-500/40 bg-slate-950/90 px-3 py-1.5 text-[11px] text-emerald-300 backdrop-blur">
              <Spinner className="h-3 w-3" /> Uploading photo…
            </div>
          )}
          {photoUrl && (
            <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2 backdrop-blur">
              <Toggle checked={showPhoto} onChange={setShowPhoto} label="Trace photo" />
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={photoOpacity}
                onChange={(e) => setPhotoOpacity(Number(e.target.value))}
                className="w-24 accent-emerald-500"
                aria-label="Photo opacity"
              />
            </div>
          )}
        </div>

        {/* Right panel */}
        <aside className="hidden w-72 shrink-0 flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-3 lg:flex">
          {panelContent}
        </aside>
      </div>

      {/* Mobile bottom bar (visible on small screens) */}
      <div className="flex lg:hidden shrink-0 border-t border-slate-800 bg-slate-950">
        {([["catalog", "Library"], ["items", "Place"], ["room", "Room"], ["curtains", "Curtains"], ["mep", "MEP"]] as const).map(([p, label]) => (
          <button
            key={p}
            onClick={() => {
              if (p !== "catalog") setPanelTab(p);
              setMobilePanel(mobilePanel === p ? null : p);
            }}
            className={cn(
              "flex-1 py-3 text-[11px] font-semibold capitalize border-t border-transparent transition",
              mobilePanel === p
                ? "text-emerald-400 border-t-emerald-500/60 bg-slate-900/80"
                : "text-slate-500",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Mobile panel drawer */}
      {mobilePanel && (
        <div className="absolute inset-0 z-40 flex flex-col bg-slate-950/98 backdrop-blur-sm lg:hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-3">
            <p className="text-sm font-semibold text-slate-100">
              {mobilePanel === "catalog" ? "Furniture library"
                : mobilePanel === "items" ? "Place & edit items"
                : mobilePanel === "room" ? "Room settings"
                 : mobilePanel === "curtains" ? "Curtains" : "MEP coordination"}
            </p>
            <button onClick={() => setMobilePanel(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18L18 6" strokeLinecap="round" /></svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 pb-20">
            {mobilePanel === "catalog" ? catalogContent : panelContent}
          </div>
        </div>
      )}

      {/* Export / connectors modal */}
      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title="Export & CAD connectors" wide>
        <p className="mb-4 text-sm text-slate-400">
          Download your design for AutoCAD and other 3D software. Every export is recorded in your audit log.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ConnectorCard
            name="AutoCAD"
            detail="Floor plan with layers per item (furniture, walls, curtains) · mm units"
            format="DXF"
            icon="M12 3l9 5-9 5-9-5 9-5zm0 10v8 0m-9-5h18"
            busy={exporting === "dxf"}
            onClick={() => void exportTo("dxf")}
          />
          <ConnectorCard
            name="Blender / 3ds Max"
            detail="3D scene as OBJ + MTL materials (zipped)"
            format="OBJ+MTL"
            icon="M12 3l6 3.5v7L12 17l-6-3.5v-7L12 3z"
            busy={exporting === "obj"}
            onClick={() => void exportTo("obj")}
          />
           <ConnectorCard
             name="Universal 3D"
            detail="glTF Binary scene, works in most viewers and engines"
            format="GLB"
            icon="M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2zm0 2.3L6 7.5v7l6 3.4 6-3.4v-7l-6-3.2z"
            busy={exporting === "glb"}
             onClick={() => void exportTo("glb")}
           />
           <ConnectorCard
             name="Presentation capture"
             detail="Viewport PNG with ACES color management, lighting and technical edges"
             format="PNG"
             icon="M4 5h16v14H4V5zm3 10l2.5-3 2 2 2.5-3 3 4H7z"
             busy={exporting === "png"}
             onClick={() => void exportTo("png")}
           />
          <ConnectorCard
            name="Bill of Materials"
            detail="Furniture quantities, sizes and colours as CSV for quoting"
            format="CSV"
            icon="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM8 17h8v2H8v-2zm0-4h8v2H8v-2zm0-4h5v2H8V9z"
            busy={exporting === "csv"}
            onClick={() => void exportTo("csv")}
          />
           <ConnectorCard
             name="IFC STEP"
             detail="Minimal IFC4 coordination model with building, storey and proxy elements"
             format="IFC"
             icon="M12 3l8 4v10l-8 4-8-4V7l8-4zm0 3L7 8.5v7l5 2.5 5-2.5v-7L12 6z"
             busy={exporting === "ifc"}
             onClick={() => void exportTo("ifc")}
           />
           <ConnectorCard
             name="BIM coordination package"
            detail="IFC-like JSON, normalized entity CSV, plus DXF/OBJ/GLB where available"
            format="ZIP"
            icon="M4 5h16M4 12h16M4 19h16"
            busy={exporting === "bim"}
            onClick={() => void exportTo("bim")}
          />
         </div>
         <div className="mt-4 grid gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs text-slate-400 sm:grid-cols-2">
           <div><p className="font-semibold text-cyan-200">WebXR / AR handoff boundary</p><p className="mt-1">GLB export preserves scene hierarchy and PBR-ready materials for a WebXR or native viewer.</p></div>
           <div className="sm:text-right"><Badge tone="emerald">Scene export ready</Badge><p className="mt-1">Runtime headset tracking is intentionally outside the editor.</p></div>
         </div>
        <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" /></svg>
           DXF is open-format and opens directly in AutoCAD. IFC is a minimal IFC4 coordination export with proxy/approximate geometry. DWG/SKP are proprietary — use Autodesk Platform Services or a converter for those.
        </p>
      </Modal>

      {/* Camera capture modal */}
      <CameraModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={uploadFile}
      />
    </div>
  );
}

function RoomNum({
  label,
  value,
  unit,
  step,
  min,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  step: number;
  min: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(() => (Number.isFinite(value) ? String(value) : ""));

  useEffect(() => {
    if (Number.isFinite(value) && draft !== "") setDraft(String(value));
  }, [value]);

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-xs text-slate-400">{draft ? `${Number(draft).toLocaleString()}${unit}` : "Enter a value"}</p>
      </div>
      <input
        type="number"
        min={min}
        step={step}
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          if (raw !== "") onChange(Number(raw));
        }}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500"
      />
    </div>
  );
}

function SliderField({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-xs text-slate-400">{display}</p>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-lg border border-slate-700 bg-transparent"
        />
        <span className="font-mono text-xs text-slate-500">{value}</span>
      </div>
    </div>
  );
}

function ConnectorCard({
  name,
  detail,
  format,
  icon,
  busy,
  onClick,
}: {
  name: string;
  detail: string;
  format: string;
  icon: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      className="h-auto items-start justify-start gap-3 p-4 text-left"
      onClick={onClick}
      loading={busy}
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d={icon} /></svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          {name} <Badge tone="cyan">{format}</Badge>
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-slate-400">{detail}</span>
      </span>
    </Button>
  );
}

function CameraModal({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReady(false);
    setError("");
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("Camera not available on this device. Use 'Upload photo' instead.");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch {
        setError("Could not access the camera. Check permissions or upload a photo instead.");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("Camera not ready yet.");
      return;
    }
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob) throw new Error("Could not capture image");
      const file = new File([blob], `room-${Date.now()}.jpg`, { type: "image/jpeg" });
      await onCapture(file);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Capture your room">
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-black">
          <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
          {error && <p className="px-4 py-3 text-sm text-rose-400">{error}</p>}
        </div>
        {!error && (
          <Button className="w-full" onClick={() => void capture()} loading={busy} disabled={!ready}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 15a3 3 0 100-6 3 3 0 000 6zm9-9h-3.6l-1.8-2H8.4L6.6 6H3a1 1 0 00-1 1v13a1 1 0 001 1h18a1 1 0 001-1V7a1 1 0 00-1-1zM12 17a5 5 0 110-10 5 5 0 010 10z" />
            </svg>
            Capture photo
          </Button>
        )}
        <p className="text-center text-xs text-slate-500">
          Point your device toward the room, then capture. On desktop without a camera, use "Upload photo".
        </p>
      </div>
    </Modal>
  );
}
