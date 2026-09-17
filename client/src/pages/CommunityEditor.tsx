import { useMemo, useState } from "react";
import type {
  AmenityData,
  BuildingBranch,
  CommunityDesign,
  DoorFacing,
  ExteriorPanel,
  TowerData,
  UnitSystem,
} from "../types";
import { Button, Input, Modal, Select, Toggle } from "../components/ui";
import { CommunityScene, type SceneContextTarget } from "../editor/CommunityScene";
import { RoomEditor } from "../editor/RoomEditor";
import { SiteLocator } from "../editor/SiteLocator";
import { type BoundaryMetrics } from "../lib/geo";
import { useToast } from "../components/Toast";
import { cn } from "../lib/cn";
import { uid } from "../lib/modelcore";
import { catalogEntry } from "../lib/catalog";
import { download } from "../lib/download";
import { computeTakeoff } from "../lib/takeoff";
import { buildNotesText, copyToClipboard, notesFilename, shareText } from "../lib/notes";
import { describeObject, furnitureDimMm, parseObjectQuery } from "../lib/objects";
import {
  AMENITIES,
  DOOR_FACING_LABELS,
  FACADES,
  INTERIOR_TYPES,
  UNIT_LABELS,
  amenityKind,
  defaultUnderground,
  interiorLabel,
  landAreaSqYards,
  landMeters,
  makeAmenity,
  makeRoom,
  towerMeters,
} from "../lib/community";

type StepId = "land" | "parking" | "basement" | "amenities" | "towers" | "exterior" | "interiors" | "takeoff";

const STEPS: { id: StepId; label: string }[] = [
  { id: "land", label: "Land" },
  { id: "parking", label: "Parking" },
  { id: "basement", label: "Basement" },
  { id: "amenities", label: "Ground floor amenities" },
  { id: "towers", label: "Towers & floors" },
  { id: "exterior", label: "Exterior" },
  { id: "interiors", label: "Interiors" },
  { id: "takeoff", label: "Takeoff & notes" },
];

interface CommunityEditorProps {
  branch: BuildingBranch;
  community: CommunityDesign;
  onChange: (c: CommunityDesign) => void;
  projectName?: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">{title}</p>
      {children}
    </div>
  );
}

function Num({
  label, value, onChange, min, max, step, unit, disabled,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string; disabled?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-medium text-slate-300">{label}</label>
        <span className="text-xs text-slate-500">{value}{unit}</span>
      </div>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
      />
    </div>
  );
}

function Range({
  label, value, onChange, min, max, step, unit,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; unit: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-medium text-slate-300">{label}</label>
        <span className="text-xs text-slate-400">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : min}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </div>
  );
}

function UndergroundForm({
  park, update,
}: {
  park: CommunityDesign["parking"];
  update: (patch: Partial<CommunityDesign>) => void;
}) {
  const ug = park.underground ?? defaultUnderground();
  const setUg = (patch: Partial<typeof ug>) => update({ parking: { ...park, underground: { ...ug, ...patch } } });
  const total = ug.levels * ug.floorHeight + ug.foundationDepth;
  return (
    <>
      <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-400">
        The site will be excavated below the tower footprint. Choose the number & height of basement levels and the excavation depth. The dig happens after you confirm these numbers.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Num label="Basement floors" value={ug.levels} onChange={(v) => setUg({ levels: Math.max(Math.min(Math.round(v) || 1, 8), 1) })} min={1} max={8} step={1} unit=" lvl" />
        <Num label="Clear height / floor" value={ug.floorHeight} onChange={(v) => setUg({ floorHeight: Math.max(v || 2.4, 2.4) })} min={2.4} max={6} step={0.1} unit=" m" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Num label="Foundation depth" value={ug.foundationDepth} onChange={(v) => setUg({ foundationDepth: Math.max(v || 0.5, 0.5) })} min={0.5} max={8} step={0.1} unit=" m" />
        <Num label="Total dig depth" value={total} onChange={() => {}} disabled unit=" m" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Num label="Ramp width" value={ug.rampWidth} onChange={(v) => setUg({ rampWidth: Math.max(v || 2.5, 2.5) })} min={2.5} max={8} step={0.25} unit=" m" />
        <Num label="Ramp length" value={ug.rampLength} onChange={(v) => setUg({ rampLength: Math.max(v || 8, 8) })} min={8} max={120} step={1} unit=" m" />
      </div>
      <Range label="Ramp slope" value={ug.rampSlope} onChange={(v) => setUg({ rampSlope: v })} min={4} max={20} step={0.5} unit=" %" />
    </>
  );
}

export function CommunityEditor({ branch, community, onChange, projectName }: CommunityEditorProps) {
  const toast = useToast();
  const [step, setStep] = useState<StepId>("land");
  const [pickKind, setPickKind] = useState(AMENITIES[0].kind);
  const [newRoomType, setNewRoomType] = useState("living");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [context, setContext] = useState<SceneContextTarget | null>(null);
  const [gen, setGen] = useState<{ mode: "site" | "room"; roomId?: string; x: number; z: number; text: string } | null>(null);
  const [furnishRoomId, setFurnishRoomId] = useState<string | null>(null);
  const c = community;

  const takeoff = useMemo(() => computeTakeoff(c), [c]);

  const update = (patch: Partial<CommunityDesign>) => onChange({ ...c, ...patch });

  const selectedTower = c.towers.find((t) => t.id === selectedId);
  const selectedAmenity = c.amenities.find((a) => a.id === selectedId);

  const addSiteObject = (recipe: ReturnType<typeof parseObjectQuery>, x: number, z: number) => {
    if (!recipe) return;
    const r = recipe.recipe;
    const count = recipe.qty;
    const added: AmenityData[] = [];
    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) / 2) * 1.6;
      if (r.kind === "furniture") {
        const dim = furnitureDimMm(r.catalogId);
        added.push({
          id: uid("am"),
          kind: r.catalogId,
          label: r.name,
          color: catalogEntry(r.catalogId)?.defaultColor ?? "#90a4ae",
          shape: "box",
          x: Math.round((x + spread) * 10) / 10,
          z: Math.round(z * 10) / 10,
          rotY: 0,
          w: dim.w / 1000,
          d: dim.d / 1000,
          h: dim.h / 1000,
        });
      } else {
        added.push({
          id: uid("am"),
          kind: r.key,
          label: r.name,
          color: r.color,
          shape: r.shape,
          x: Math.round((x + spread) * 10) / 10,
          z: Math.round(z * 10) / 10,
          rotY: 0,
          w: r.w,
          d: r.d,
          h: r.h,
        });
      }
    }
    update({ amenities: [...c.amenities, ...added] });
    toast.push({ title: "Object added", description: describeObject(recipe), tone: "success" });
  };

  const runGenerator = () => {
    if (!gen) return;
    const parsed = parseObjectQuery(gen.text);
    if (!parsed) {
      toast.push({ title: "Not recognised", description: "Try words like sofa, tree, car, bench, fountain.", tone: "error" });
      return;
    }
    if (gen.mode === "room" && gen.roomId) {
      const room = c.interiors.find((r) => r.id === gen.roomId);
      if (!room) return;
      if (parsed.recipe.kind === "outdoor") {
        toast.push({ title: "Furniture only", description: "That looks like an outdoor object.", tone: "error" });
        return;
      }
      const catalogId = parsed.recipe.catalogId;
      const name = parsed.recipe.name;
      const color = catalogEntry(catalogId)?.defaultColor ?? "#90a4ae";
      const items = Array.from({ length: parsed.qty }).map((_, i) => ({
        id: uid("fu"),
        type: catalogId,
        name: parsed.qty > 1 ? `${name} ${i + 1}` : name,
        x: Math.round((gen.x + i * 0.5) * 10) / 10,
        z: Math.round(gen.z * 10) / 10,
        rotationDeg: 0,
        scale: 1,
        color,
      }));
      update({
        interiors: c.interiors.map((r) => (r.id === room.id ? { ...r, furniture: [...(r.furniture ?? []), ...items] } : r)),
      });
      toast.push({ title: "Furniture added", description: `${describeObject(parsed)} → ${room.name}`, tone: "success" });
    } else {
      addSiteObject(parsed, gen.x, gen.z);
    }
    setGen(null);
  };

  const applyFacadeToTower = (id: string, key: string) => {
    const opt = FACADES.find((f) => f.key === key);
    update({ towers: c.towers.map((t) => (t.id === id ? { ...t, facadeMaterial: key, facadeColor: opt?.color ?? t.facadeColor } : t)) });
  };

  const duplicateAmenity = (id: string) => {
    const a = c.amenities.find((x) => x.id === id);
    if (!a) return;
    update({ amenities: [...c.amenities, { ...a, id: uid("am"), x: a.x + 4, z: a.z + 4 }] });
  };

  const duplicateTower = (id: string) => {
    const t = c.towers.find((x) => x.id === id);
    if (!t) return;
    update({ towers: [...c.towers, { ...t, id: uid("tw"), label: `${t.label} (copy)`, x: t.x + 12, z: t.z }] });
  };

  /* ------------------------------- Land step ------------------------------- */
  const land = c.land;
  const landPanel = (
    <Section title="Plot size">
      <SiteLocator
        location={c.location}
        onChange={(loc) => update({ location: loc })}
        onApplyBoundary={(m: BoundaryMetrics) => {
          const factor = land.unit === "m" ? 1 : land.unit === "yd" ? 1 / 0.9144 : 1 / 0.3048;
          const round1 = (n: number) => Math.max(Math.round(n * factor * 10) / 10, 1);
          update({ land: { ...land, width: round1(m.widthM), depth: round1(m.depthM) } });
          toast.push({ title: "Plot size applied", description: `${m.widthM} × ${m.depthM} m from boundary`, tone: "success" });
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <Select label="Unit" value={land.unit} onChange={(e) => update({ land: { ...land, unit: e.target.value as UnitSystem } })}>
          {(Object.keys(UNIT_LABELS) as UnitSystem[]).map((u) => (
            <option key={u} value={u}>{UNIT_LABELS[u]}</option>
          ))}
        </Select>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
          <p className="text-slate-500">Plot area</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-200">
            {Math.round(landAreaSqYards(land)).toLocaleString()} sq yd
          </p>
          <p className="text-[11px] text-slate-500">
            ≈ {Math.round(landMeters(land).w * landMeters(land).d).toLocaleString()} m²
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Num label="Width" value={land.width} onChange={(v) => update({ land: { ...land, width: Math.max(v > 0 ? v : 1, 1) } })} min={1} max={1000} step={0.5} unit={` ${UNIT_LABELS[land.unit]}`} />
        <Num label="Depth" value={land.depth} onChange={(v) => update({ land: { ...land, depth: Math.max(v > 0 ? v : 1, 1) } })} min={1} max={1000} step={0.5} unit={` ${UNIT_LABELS[land.unit]}`} />
      </div>
    </Section>
  );

  /* ------------------------------ Parking step ----------------------------- */
  const park = c.parking;
  const parkPanel = (
    <Section title="Vehicle parking">
      <Select label="Parking type" value={park.mode} onChange={(e) => {
        const mode = e.target.value as typeof park.mode;
        update({ parking: { ...park, mode, underground: mode === "underground" && !park.underground ? defaultUnderground() : park.underground } });
      }}>
        <option value="none">No parking</option>
        <option value="surface">Surface parking</option>
        <option value="underground">Underground parking</option>
      </Select>
      {park.mode === "surface" && (
        <Range label="Surface bays" value={park.surfaceBays} onChange={(v) => update({ parking: { ...park, surfaceBays: v } })} min={0} max={80} step={1} unit=" bays" />
      )}
      {park.mode === "underground" && (
        <UndergroundForm park={park} update={update} />
      )}
    </Section>
  );

  /* ----------------------------- Basement step ------------------------------ */
  const ug = park.underground;
  const basementPanel = park.mode !== "underground" || !ug ? (
    <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-500">
      Select <span className="text-emerald-300">Underground parking</span> in the previous step to build the basement structure.
    </p>
  ) : (
    <Section title="Basement structure (below grade)">
      <div className="grid grid-cols-2 gap-3">
        <Num label="Pillar spacing X" value={ug.pillarSpacingX} onChange={(v) => update({ parking: { ...park, underground: { ...ug, pillarSpacingX: Math.max(v || 4, 4) } } })} min={4} max={12} step={0.5} unit=" m" />
        <Num label="Pillar spacing Z" value={ug.pillarSpacingZ} onChange={(v) => update({ parking: { ...park, underground: { ...ug, pillarSpacingZ: Math.max(v || 4, 4) } } })} min={4} max={12} step={0.5} unit=" m" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Num label="Car bay width" value={ug.bayWidth} onChange={(v) => update({ parking: { ...park, underground: { ...ug, bayWidth: Math.max(v || 2.3, 2.3) } } })} min={2.3} max={4} step={0.05} unit=" m" />
        <Num label="Car bay length" value={ug.bayLength} onChange={(v) => update({ parking: { ...park, underground: { ...ug, bayLength: Math.max(v || 4.8, 4.8) } } })} min={4.8} max={6.5} step={0.05} unit=" m" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Num label="Bay columns" value={ug.bayCols} onChange={(v) => update({ parking: { ...park, underground: { ...ug, bayCols: Math.max(Math.min(Math.round(v) || 1, 20), 1) } } })} min={1} max={20} step={1} unit="" />
        <Num label="Bay rows" value={ug.bayRows} onChange={(v) => update({ parking: { ...park, underground: { ...ug, bayRows: Math.max(Math.min(Math.round(v) || 1, 20), 1) } } })} min={1} max={20} step={1} unit="" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Toggle checked={ug.liftLobby} onChange={(v) => update({ parking: { ...park, underground: { ...ug, liftLobby: v } } })} label="Lift lobby" />
        <Toggle checked={ug.stairLobby} onChange={(v) => update({ parking: { ...park, underground: { ...ug, stairLobby: v } } })} label="Staircase lobby" />
      </div>
      <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
        Capacity: up to <span className="text-emerald-300">{ug.bayCols * ug.bayRows * ug.levels}</span> cars across {ug.levels} level{ug.levels > 1 ? "s" : ""}.
      </p>
    </Section>
  );

  /* ----------------------------- Amenities step ----------------------------- */
  const nextSpot = (): { x: number; z: number } => {
    const { w: W, d: D } = landMeters(land);
    const n = c.amenities.length;
    const rowW = 12;
    const col = n % Math.max(1, Math.floor(Math.max(1, (W - 16)) / rowW));
    const rowNum = Math.floor(n / Math.max(1, Math.floor(Math.max(1, (W - 16)) / rowW)));
    return { x: -W / 2 + 10 + col * rowW, z: D / 2 - 8 - rowNum * 12 };
  };

  const addAmenity = () => {
    const spot = nextSpot();
    const a = makeAmenity(pickKind, spot.x, spot.z);
    update({ amenities: [...c.amenities, a] });
    toast.push({ title: "Amenity added", description: amenityKind(pickKind)?.label ?? pickKind, tone: "info" });
  };

  const patchAmenity = (id: string, patch: Partial<AmenityData>) =>
    update({ amenities: c.amenities.map((a) => (a.id === id ? { ...a, ...patch } : a)) });

  const amenitiesPanel = (
    <Section title="Ground-floor community amenities">
      <div className="flex gap-2">
        <div className="flex-1">
          <Select value={pickKind} onChange={(e) => setPickKind(e.target.value)}>
            {AMENITIES.map((a) => (
              <option key={a.kind} value={a.kind}>{a.label}</option>
            ))}
          </Select>
        </div>
        <Button size="sm" onClick={addAmenity} className="shrink-0">Add</Button>
      </div>
      <div className="space-y-2">
        {c.amenities.length === 0 && <p className="text-xs text-slate-600">No amenities yet — add some above.</p>}
        {c.amenities.map((a) => (
          <div key={a.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-200">{amenityKind(a.kind)?.label ?? a.kind}</p>
              <button onClick={() => update({ amenities: c.amenities.filter((x) => x.id !== a.id) })} className="text-xs font-semibold text-rose-400 hover:text-rose-300">
                Remove
              </button>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              <Num label="X" value={a.x} onChange={(v) => patchAmenity(a.id, { x: v })} step={1} unit=" m" />
              <Num label="Z" value={a.z} onChange={(v) => patchAmenity(a.id, { z: v })} step={1} unit=" m" />
              <Num label="W" value={a.w} onChange={(v) => patchAmenity(a.id, { w: Math.max(v || 1, 1) })} step={0.5} unit=" m" />
              <Num label="D" value={a.d} onChange={(v) => patchAmenity(a.id, { d: Math.max(v || 1, 1) })} step={0.5} unit=" m" />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );

  /* ------------------------------ Towers step ------------------------------ */
  const towerSpot = (index: number): { x: number; z: number } => {
    const { w: W, d: D } = landMeters(land);
    const count = Math.max(c.towers.length, index + 1);
    const gap = Math.min(10, (W - 12) / Math.max(count, 1));
    const offset = ((count - 1) * gap) / 2;
    return { x: -offset + index * gap, z: -D / 2 + 14 };
  };

  const addTower = () => {
    const next = c.towers.length;
    const spot = towerSpot(next);
    const names = branch === "residential"
      ? ["Tower A", "Tower B", "Tower C", "Tower D", "Tower E", "Tower F", "Tower G", "Tower H"]
      : ["Block A", "Block B", "Block C", "Block D", "Block E", "Block F", "Block G", "Block H"];
    update({ towers: [...c.towers, { ...defaultTowerFor(branch, names[next % names.length], spot), id: uid("tw") }] });
  };

  const patchTower = (id: string, patch: Partial<TowerData>) =>
    update({ towers: c.towers.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  const towersPanel = (
    <Section title={branch === "residential" ? "Apartment towers" : "Office blocks"}>
      <Button size="sm" onClick={addTower} className="mb-2">+ {branch === "residential" ? "Add tower" : "Add block"}</Button>
      <div className="space-y-2">
        {c.towers.length === 0 && <p className="text-xs text-slate-600">No towers yet.</p>}
        {c.towers.map((t, i) => (
          <div key={t.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <Input label={`${branch === "residential" ? "Tower" : "Block"} name`} value={t.label} onChange={(e) => patchTower(t.id, { label: e.target.value })} />
              <button onClick={() => update({ towers: c.towers.filter((x) => x.id !== t.id) })} className="mt-4 text-xs font-semibold text-rose-400 hover:text-rose-300">Remove</button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Num label="Floors" value={t.floors} onChange={(v) => patchTower(t.id, { floors: Math.max(Math.min(Math.round(v) || 1, 100), 1) })} step={1} />
              <Num label="Units / floor" value={t.unitsPerFloor} onChange={(v) => patchTower(t.id, { unitsPerFloor: Math.max(Math.min(Math.round(v) || 1, 24), 1) })} step={1} />
              <Num label="Unit width" value={t.unitWidth} onChange={(v) => patchTower(t.id, { unitWidth: Math.max(v || 3, 3) })} step={0.5} unit=" m" />
              <Num label="Unit depth" value={t.unitDepth} onChange={(v) => patchTower(t.id, { unitDepth: Math.max(v || 3, 3) })} step={0.5} unit=" m" />
              <Num label="Floor height" value={t.floorHeight} onChange={(v) => patchTower(t.id, { floorHeight: Math.max(v || 2.4, 2.4) })} step={0.1} unit=" m" />
              <Select label="Main door facing" value={t.doorFacing} onChange={(e) => patchTower(t.id, { doorFacing: e.target.value as DoorFacing })}>
                {(Object.keys(DOOR_FACING_LABELS) as DoorFacing[]).map((f) => <option key={f} value={f}>{DOOR_FACING_LABELS[f]}</option>)}
              </Select>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Num label="Common area / floor" value={t.commonAreaPerFloor} onChange={(v) => patchTower(t.id, { commonAreaPerFloor: Math.max(v || 0, 0) })} step={1} unit=" m²" />
              <Num label="Open space / floor" value={t.openAreaPerFloor} onChange={(v) => patchTower(t.id, { openAreaPerFloor: Math.max(v || 0, 0) })} step={1} unit=" m²" />
            </div>
            <p className="mt-2 text-xs text-slate-500">Footprint: {towerMeters(t).w.toFixed(1)} × {towerMeters(t).d.toFixed(1)} m, height {towerMeters(t).h.toFixed(1)} m ({i > 0 ? "auto-placed" : "placed on site"})</p>
          </div>
        ))}
      </div>
    </Section>
  );

  /* ----------------------------- Exterior step ----------------------------- */
  const exteriorsPanel = (
    <Section title="Building exterior">
      <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-400">
        Pick the facade material for every {branch === "residential" ? "tower" : "block"}. Panels let you place a second material (e.g. glass) on specific bands — the scene updates live.
      </p>
      {c.towers.map((t) => (
        <div key={t.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <p className="mb-2 text-sm font-semibold text-slate-200">{t.label}</p>
          <Select label="Facade material" value={t.facadeMaterial} onChange={(e) => {
            const opt = FACADES.find((f) => f.key === e.target.value);
            patchTower(t.id, { facadeMaterial: e.target.value, facadeColor: opt?.color ?? t.facadeColor });
          }}>
            {FACADES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </Select>
        </div>
      ))}
      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-medium text-slate-300">Material placement panels</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (c.towers.length === 0) return;
              const panel: ExteriorPanel = {
                id: uid("px"),
                towerId: c.towers[0].id,
                face: "front",
                x: 0, y: 0, w: Math.min(c.towers[0].unitWidth * 2, 12), h: 2.4,
                material: "glass",
                color: FACADES[0].color,
              };
              update({ exteriors: [...c.exteriors, panel] });
            }}
          >
            + Panel
          </Button>
        </div>
        {c.exteriors.length === 0 && <p className="text-xs text-slate-600">No panels — whole facades use their material.</p>}
        {c.exteriors.map((p) => (
          <div key={p.id} className="mb-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-300">{FACADES.find((f) => f.key === p.material)?.label ?? p.material}</p>
              <button onClick={() => update({ exteriors: c.exteriors.filter((x) => x.id !== p.id) })} className="text-xs font-semibold text-rose-400 hover:text-rose-300">Remove</button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Select label="Block" value={p.towerId} onChange={(e) => update({ exteriors: c.exteriors.map((x) => x.id === p.id ? { ...x, towerId: e.target.value } : x) })}>
                {c.towers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
              <Select label="Face" value={p.face} onChange={(e) => update({ exteriors: c.exteriors.map((x) => x.id === p.id ? { ...x, face: e.target.value as ExteriorPanel["face"] } : x) })}>
                <option value="front">Front</option><option value="back">Back</option>
                <option value="left">Left</option><option value="right">Right</option>
              </Select>
              <Num label="Offset (x)" value={p.x} onChange={(v) => update({ exteriors: c.exteriors.map((x) => x.id === p.id ? { ...x, x: v } : x) })} step={0.5} unit=" m" />
              <Num label="Height above ground" value={p.y} onChange={(v) => update({ exteriors: c.exteriors.map((x) => x.id === p.id ? { ...x, y: v } : x) })} step={0.5} unit=" m" />
              <Num label="Width" value={p.w} onChange={(v) => update({ exteriors: c.exteriors.map((x) => x.id === p.id ? { ...x, w: Math.max(v || 1, 1) } : x) })} step={0.5} unit=" m" />
              <Num label="Height" value={p.h} onChange={(v) => update({ exteriors: c.exteriors.map((x) => x.id === p.id ? { ...x, h: Math.max(v || 1, 1) } : x) })} step={0.5} unit=" m" />
              <Select label="Material" value={p.material} onChange={(e) => {
                const opt = FACADES.find((f) => f.key === e.target.value);
                update({ exteriors: c.exteriors.map((x) => x.id === p.id ? { ...x, material: e.target.value, color: opt?.color ?? x.color } : x) });
              }}>
                {FACADES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </Select>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );

  /* ----------------------------- Interiors step ---------------------------- */
  const interiorsPanel = (
    <Section title="Interiors">
      <div className="flex gap-2">
        <div className="flex-1">
          <Select value={newRoomType} onChange={(e) => setNewRoomType(e.target.value)}>
            {INTERIOR_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </Select>
        </div>
        <Button size="sm" onClick={() => {
          if (c.towers.length === 0) {
            toast.push({ title: "Add a tower first", tone: "info" });
            return;
          }
          const tower = c.towers[0];
          const room = makeRoom(tower.id, 0, interiorLabel(newRoomType), newRoomType);
          update({ interiors: [...c.interiors, room] });
        }}>+ Room</Button>
      </div>
      <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-400">
        Name and size the rooms inside each {branch === "residential" ? "apartment" : "office"} unit. Room furniture, drag-and-drop and right-click object placement arrive in Phase 2.
      </p>
      {c.interiors.length === 0 && <p className="text-xs text-slate-600">No rooms yet.</p>}
      {c.interiors.map((r) => (
        <div key={r.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <Input label="Room name" value={r.name} onChange={(e) => update({ interiors: c.interiors.map((x) => x.id === r.id ? { ...x, name: e.target.value } : x) })} />
            <button onClick={() => update({ interiors: c.interiors.filter((x) => x.id !== r.id) })} className="mt-4 text-xs font-semibold text-rose-400 hover:text-rose-300">Remove</button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Select label="Type" value={r.type} onChange={(e) => update({ interiors: c.interiors.map((x) => x.id === r.id ? { ...x, type: e.target.value } : x) })}>
              {INTERIOR_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
            <Num label="Width" value={r.w} onChange={(v) => update({ interiors: c.interiors.map((x) => x.id === r.id ? { ...x, w: Math.max(v || 1, 1) } : x) })} step={0.5} unit=" m" />
            <Num label="Depth" value={r.d} onChange={(v) => update({ interiors: c.interiors.map((x) => x.id === r.id ? { ...x, d: Math.max(v || 1, 1) } : x) })} step={0.5} unit=" m" />
            <Select label="Door facing" value={r.doorFacing} onChange={(e) => update({ interiors: c.interiors.map((x) => x.id === r.id ? { ...x, doorFacing: e.target.value as DoorFacing } : x) })}>
              {(Object.keys(DOOR_FACING_LABELS) as DoorFacing[]).map((f) => <option key={f} value={f}>{DOOR_FACING_LABELS[f]}</option>)}
            </Select>
          </div>

          {/* Furniture */}
          <div className="mt-2 rounded-lg border border-slate-800/70 bg-slate-950/40 p-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Furniture · {r.furniture?.length ?? 0}
              </p>
              <button
                onClick={() => setGen({ mode: "room", roomId: r.id, x: 0, z: 0, text: "" })}
                className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300"
              >
                + Add / generate
              </button>
            </div>
            <button
              onClick={() => setFurnishRoomId(r.id)}
              className="mt-2 w-full rounded-lg border border-slate-700 px-2 py-1.5 text-[11px] font-semibold text-slate-300 hover:border-emerald-500 hover:text-emerald-300"
            >
              Open room editor · drag furniture
            </button>
            {(r.furniture ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(r.furniture ?? []).map((f) => (
                  <span key={f.id} className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
                    {f.name}
                    <button
                      onClick={() => update({ interiors: c.interiors.map((x) => x.id === r.id ? { ...x, furniture: (x.furniture ?? []).filter((y) => y.id !== f.id) } : x) })}
                      className="text-slate-500 hover:text-rose-300"
                      aria-label={`Remove ${f.name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </Section>
  );

  /* ----------------------------- Takeoff step ------------------------------ */
  const notesText = () => buildNotesText({ projectName: projectName || "Untitled project", design: c, takeoff });

  const exportNotes = async (how: "download" | "copy" | "share") => {
    const text = notesText();
    if (how === "download") {
      download(notesFilename(projectName || "project"), text, "text/plain;charset=utf-8");
      toast.push({ title: "Brief downloaded", description: "Open in Notepad, Notes or any editor.", tone: "success" });
      return;
    }
    if (how === "copy") {
      const ok = await copyToClipboard(text);
      toast.push({ title: ok ? "Copied to clipboard" : "Copy failed", description: ok ? "Paste into Notepad, Samsung Notes or Apple Notes." : undefined, tone: ok ? "success" : "error" });
      return;
    }
    const ok = await shareText(projectName || "Project brief", text);
    if (!ok) {
      const copied = await copyToClipboard(text);
      toast.push({ title: copied ? "Copied instead" : "Sharing unavailable", tone: "info" });
    }
  };

  const takeoffPanel = (
    <Section title="Material takeoff & notes">
      <div className="grid grid-cols-2 gap-2">
        {[
          ["Site area", `${takeoff.summary.siteAreaM2.toLocaleString()} m²`],
          ["Built-up", `${takeoff.summary.builtUpM2.toLocaleString()} m²`],
          ["FAR / FSI", `${takeoff.summary.far}`],
          ["Floors", `${takeoff.summary.floors}`],
          ["Parking", `${takeoff.summary.parkingBays} bays`],
          ["Open area", `${takeoff.summary.openAreaM2.toLocaleString()} m²`],
          ["Excavation", `${takeoff.summary.excavationM3.toLocaleString()} m³`],
          ["Concrete", `${takeoff.summary.concreteM3.toLocaleString()} m³`],
          ["Steel", `${takeoff.summary.steelT} t`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
            <p className="text-[11px] text-slate-500">{k}</p>
            <p className="text-sm font-semibold text-slate-200">{v}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void exportNotes("download")}>Download .txt</Button>
        <Button size="sm" variant="secondary" onClick={() => void exportNotes("copy")}>Copy for notes</Button>
        <Button size="sm" variant="secondary" onClick={() => void exportNotes("share")}>Share</Button>
      </div>

      <div className="space-y-3">
        {takeoff.groups.map((grp) => (
          <div key={grp.group}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{grp.group}</p>
            <div className="space-y-1">
              {grp.items.map((item) => (
                <div key={item.key} className="flex items-baseline justify-between gap-2 rounded-lg border border-slate-800/70 bg-slate-950/40 px-3 py-1.5">
                  <span className="text-xs text-slate-300">{item.label}</span>
                  <span className="shrink-0 text-xs font-semibold text-emerald-300">
                    {item.qty.toLocaleString()} {item.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[11px] leading-relaxed text-slate-500">
        Quantities follow conventional RCC practice and standard work-item norms — verify against structural
        drawings and a certified BOQ before procurement.
      </p>
    </Section>
  );

  const panels: Record<StepId, React.ReactNode> = {
    land: landPanel,
    parking: parkPanel,
    basement: basementPanel,
    amenities: amenitiesPanel,
    towers: towersPanel,
    exterior: exteriorsPanel,
    interiors: interiorsPanel,
    takeoff: takeoffPanel,
  };

  const activeIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left: stepper + params */}
        <div className="flex w-full shrink-0 flex-col border-r border-slate-800 bg-slate-900/40 lg:w-96">
          <div className="flex gap-1 overflow-x-auto border-b border-slate-800 px-3 py-2">
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setStep(s.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                  step === s.id ? "bg-emerald-500/15 text-emerald-300" : "text-slate-500 hover:bg-slate-800",
                )}
              >
                <span className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
                  i < activeIndex ? "bg-emerald-500/30 text-emerald-300" : i === activeIndex ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-400",
                )}>{i + 1}</span>
                {s.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">{panels[step]}</div>
        </div>

        {/* Right: 3D scene */}
        <div className="relative min-h-[420px] flex-1">
          <CommunityScene
            design={c}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={onChange}
            onContextTarget={(t) => {
              setSelectedId(t.id ?? null);
              setContext(t);
            }}
          />
          <div className="pointer-events-none absolute left-3 top-3 rounded-xl bg-slate-950/80 px-3 py-2 text-xs text-slate-300 backdrop-blur">
            {branch === "residential" ? "Residential community" : "Commercial complex"} · drag objects to move · right-click for actions
          </div>
          {selectedTower && (
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-xl bg-slate-950/85 px-3 py-2 text-xs text-emerald-300 backdrop-blur">
              {selectedTower.label} · {towerMeters(selectedTower).w.toFixed(1)} × {towerMeters(selectedTower).d.toFixed(1)} m
            </div>
          )}
          {selectedAmenity && (
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-xl bg-slate-950/85 px-3 py-2 text-xs text-emerald-300 backdrop-blur">
              {selectedAmenity.label ?? amenityKind(selectedAmenity.kind)?.label ?? selectedAmenity.kind} · {selectedAmenity.w} × {selectedAmenity.d} m
            </div>
          )}
        </div>
      </div>

      {/* Right-click context menu */}
      {context && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContext(null)} onContextMenu={(e) => { e.preventDefault(); setContext(null); }} />
          <div
            className="fixed z-50 w-52 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 py-1 text-sm shadow-2xl"
            style={{ left: Math.min(context.clientX, window.innerWidth - 220), top: Math.min(context.clientY, window.innerHeight - 260) }}
          >
            {context.kind === "ground" && (
              <>
                <ContextItem onClick={() => { setGen({ mode: "site", x: context.x, z: context.z, text: "" }); setContext(null); }}>Add object…</ContextItem>
                <ContextItem onClick={() => { addTower(); setStep("towers"); setContext(null); }}>Add {branch === "residential" ? "tower" : "block"}</ContextItem>
                <ContextItem onClick={() => { setStep("amenities"); setContext(null); }}>Open amenities</ContextItem>
              </>
            )}
            {context.kind === "tower" && context.id && (
              <>
                <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {c.towers.find((t) => t.id === context.id)?.label ?? "Tower"}
                </p>
                <p className="px-3 pb-1 pt-1 text-[11px] text-slate-500">Apply facade material</p>
                <div className="flex flex-wrap gap-1 px-3 pb-2">
                  {FACADES.map((f) => (
                    <button
                      key={f.key}
                      onClick={() => { applyFacadeToTower(context.id!, f.key); setContext(null); }}
                      className="rounded-md border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300 hover:border-emerald-500 hover:text-emerald-300"
                      style={{ borderLeftColor: f.color, borderLeftWidth: 3 }}
                    >
                      {f.label.split(" ")[0]}
                    </button>
                  ))}
                </div>
                <ContextItem onClick={() => { duplicateTower(context.id!); setContext(null); }}>Duplicate</ContextItem>
                <ContextItem danger onClick={() => { update({ towers: c.towers.filter((t) => t.id !== context.id), exteriors: c.exteriors.filter((p) => p.towerId !== context.id) }); setContext(null); }}>Delete</ContextItem>
              </>
            )}
            {context.kind === "amenity" && context.id && (
              <>
                <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {c.amenities.find((a) => a.id === context.id)?.label ?? amenityKind(c.amenities.find((a) => a.id === context.id)?.kind ?? "")?.label ?? "Object"}
                </p>
                <ContextItem onClick={() => { update({ amenities: c.amenities.map((a) => (a.id === context.id ? { ...a, rotY: (a.rotY + 90) % 360 } : a)) }); setContext(null); }}>Rotate 90°</ContextItem>
                <ContextItem onClick={() => { duplicateAmenity(context.id!); setContext(null); }}>Duplicate</ContextItem>
                <ContextItem danger onClick={() => { update({ amenities: c.amenities.filter((a) => a.id !== context.id) }); setContext(null); }}>Delete</ContextItem>
              </>
            )}
          </div>
        </>
      )}

      {/* Offline object generator */}
      <Modal open={Boolean(gen)} onClose={() => setGen(null)} title={gen?.mode === "room" ? "Add furniture" : "Add object"}>
        <div className="space-y-4">
          <Input
            label="What should I add?"
            placeholder={gen?.mode === "room" ? "e.g. two sofas, a queen bed, coffee table" : "e.g. 3 trees, a car, fountain, bench"}
            value={gen?.text ?? ""}
            autoFocus
            onChange={(e) => setGen((g) => (g ? { ...g, text: e.target.value } : g))}
          />
          {(() => {
            const parsed = gen ? parseObjectQuery(gen.text) : null;
            if (!gen?.text.trim()) return <p className="text-xs text-slate-500">Understands plain words — “sofa”, “tree”, “car”, “fountain”, “bench”, “2 chairs”.</p>;
            if (!parsed) return <p className="text-xs text-rose-400">Not recognised. Try sofa, bed, table, chair, rug, plant, tv, tree, car, bench, statue, fountain, shed, fence.</p>;
            const dims = parsed.recipe.kind === "furniture" ? "furniture" : `${parsed.recipe.w} × ${parsed.recipe.d} m`;
            return (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-200">
                {describeObject(parsed)}
                <span className="ml-2 text-xs text-emerald-400/80">{dims}</span>
              </div>
            );
          })()}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setGen(null)}>Cancel</Button>
            <Button onClick={runGenerator} disabled={!gen?.text.trim()}>Add</Button>
          </div>
        </div>
      </Modal>

      {furnishRoomId && (() => {
        const room = c.interiors.find((r) => r.id === furnishRoomId);
        if (!room) return null;
        const tower = c.towers.find((t) => t.id === room.towerId)?.label ?? "Building";
        return (
          <RoomEditor
            room={room}
            title={`${room.name} · ${tower} · floor ${room.floor}`}
            onClose={() => setFurnishRoomId(null)}
            onChange={(next) => update({ interiors: c.interiors.map((r) => (r.id === next.id ? next : r)) })}
          />
        );
      })()}
    </div>
  );
}

function ContextItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "block w-full px-3 py-1.5 text-left text-sm transition hover:bg-slate-800",
        danger ? "text-rose-300 hover:text-rose-200" : "text-slate-200",
      )}
    >
      {children}
    </button>
  );
}

function defaultTowerFor(branch: BuildingBranch, label: string, spot: { x: number; z: number }): TowerData {
  return {
    id: uid("tw"),
    label,
    x: spot.x,
    z: spot.z,
    floors: branch === "residential" ? 12 : 8,
    unitsPerFloor: branch === "residential" ? 4 : 8,
    unitWidth: branch === "residential" ? 7 : 6,
    unitDepth: branch === "residential" ? 9 : 8,
    floorHeight: 3.2,
    commonAreaPerFloor: 60,
    openAreaPerFloor: 30,
    doorFacing: "south",
    facadeMaterial: "glass",
    facadeColor: FACADES[0].color,
  };
}