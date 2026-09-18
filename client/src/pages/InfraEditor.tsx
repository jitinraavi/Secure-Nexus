import { useEffect, useMemo, useState } from "react";
import type { AirportDesign, DamDesign, HighwayDesign, InfraDesign, InfraFacility, InfraKind, PortDesign } from "../types";
import { Button, Select, Toggle } from "../components/ui";
import { InfraScene } from "../editor/InfraScene";
import { SiteLocator, type LocatorMode } from "../editor/SiteLocator";
import { useToast } from "../components/Toast";
import { cn } from "../lib/cn";
import { download } from "../lib/download";
import { copyToClipboard, notesFilename, shareText } from "../lib/notes";
import {
  INFRA_LABELS,
  buildInfraNotesText,
  computeInfraTakeoff,
  infraSummary,
} from "../lib/infra";

type StepId = "location" | "design" | "takeoff";

const STEPS: { id: StepId; label: string }[] = [
  { id: "location", label: "Site & alignment" },
  { id: "design", label: "Design" },
  { id: "takeoff", label: "Takeoff & notes" },
];

const FACILITY_OPTIONS: Record<InfraKind, { kind: string; label: string }[]> = {
  highway: [
    { kind: "rest-area", label: "Rest area" },
    { kind: "toll-plaza", label: "Toll plaza" },
    { kind: "service-station", label: "Service station" },
    { kind: "pedestrian-overpass", label: "Pedestrian overpass" },
    { kind: "bus-bay", label: "Bus bay" },
  ],
  airport: [
    { kind: "passenger-lounge", label: "Passenger lounge" },
    { kind: "terminal", label: "Terminal" },
    { kind: "runway", label: "Runway" },
    { kind: "taxiway", label: "Taxiway" },
    { kind: "aircraft-stand", label: "Aircraft stand" },
    { kind: "cargo-terminal", label: "Cargo terminal" },
    { kind: "fuel-farm", label: "Fuel farm" },
  ],
  ports: [
    { kind: "berth", label: "Berth" },
    { kind: "warehouse", label: "Storage warehouse" },
    { kind: "container-yard", label: "Container yard" },
    { kind: "crane", label: "Quay crane" },
    { kind: "customs-terminal", label: "Customs terminal" },
    { kind: "cold-storage", label: "Cold storage" },
    { kind: "breakwater", label: "Breakwater" },
  ],
  dams: [
    { kind: "spillway", label: "Spillway" },
    { kind: "radial-gate", label: "Radial gate" },
    { kind: "powerhouse", label: "Powerhouse" },
    { kind: "fish-ladder", label: "Fish ladder" },
    { kind: "visitor-center", label: "Visitor center" },
    { kind: "stilling-basin", label: "Stilling basin" },
  ],
};

const LOCATOR_MODE: Record<InfraKind, LocatorMode> = {
  highway: "route",
  airport: "area",
  ports: "area",
  dams: "route",
};

const clamp = (n: number, lo: number, _hi: number) => { void _hi; return Math.max(n, lo); };

interface InfraEditorProps {
  kind: InfraKind;
  infra: InfraDesign;
  onChange: (infra: InfraDesign) => void;
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
  label, value, onChange, min, max, step, unit,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
}) {
  const [draft, setDraft] = useState(() => (Number.isFinite(value) ? String(value) : ""));

  useEffect(() => {
    setDraft(Number.isFinite(value) ? String(value) : "");
  }, [value]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-medium text-slate-300">{label}</label>
        <span className="text-xs text-slate-500">{draft ? `${draft}${unit ?? ""}` : "Enter a value"}</span>
      </div>
      <input
        type="number"
        min={min}
        max={max}
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

export function InfraEditor({ kind, infra, onChange, projectName }: InfraEditorProps) {
  const toast = useToast();
  const [step, setStep] = useState<StepId>("location");
  const [facilityKind, setFacilityKind] = useState(FACILITY_OPTIONS[kind][0].kind);

  useEffect(() => {
    setFacilityKind(FACILITY_OPTIONS[kind][0].kind);
  }, [kind]);

  const update = (patch: Partial<InfraDesign>) => onChange({ ...infra, ...patch });

  const takeoff = useMemo(() => computeInfraTakeoff(infra), [infra]);

  const patchHighway = (patch: Partial<HighwayDesign>) =>
    update({ highway: { ...infra.highway!, ...patch } });
  const patchAirport = (patch: Partial<AirportDesign>) =>
    update({ airport: { ...infra.airport!, ...patch } });
  const patchPort = (patch: Partial<PortDesign>) =>
    update({ ports: { ...infra.ports!, ...patch } });
  const patchDam = (patch: Partial<DamDesign>) =>
    update({ dams: { ...infra.dams!, ...patch } });

  const addFacility = () => {
    const facility: InfraFacility = {
      id: `facility-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: facilityKind,
      count: 1,
      lengthM: kind === "airport" && facilityKind === "runway" ? 1200 : 30,
      widthM: kind === "airport" && facilityKind === "runway" ? 45 : 15,
      heightM: kind === "dams" ? 8 : 4,
    };
    update({ facilities: [...(infra.facilities ?? []), facility] });
  };

  const patchFacility = (id: string, patch: Partial<InfraFacility>) =>
    update({ facilities: (infra.facilities ?? []).map((f) => (f.id === id ? { ...f, ...patch } : f)) });

  const facilitiesPanel = (
    <Section title={`${INFRA_LABELS[kind]} facilities`}>
      <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-400">
        Add only the facilities required by this design. Nothing is placed automatically.
      </p>
      <div className="flex gap-2">
        <Select label="Facility" value={facilityKind} onChange={(e) => setFacilityKind(e.target.value)}>
          {FACILITY_OPTIONS[kind].map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}
        </Select>
        <Button size="sm" onClick={addFacility} className="mt-6 shrink-0">Add</Button>
      </div>
      <div className="space-y-2">
        {(infra.facilities ?? []).length === 0 && <p className="text-xs text-slate-600">No facilities added yet.</p>}
        {(infra.facilities ?? []).map((facility) => (
          <div key={facility.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <Select label="Type" value={facility.kind} onChange={(e) => patchFacility(facility.id, { kind: e.target.value })}>
                {FACILITY_OPTIONS[kind].map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}
              </Select>
              <button onClick={() => update({ facilities: (infra.facilities ?? []).filter((f) => f.id !== facility.id) })} className="mt-5 text-xs font-semibold text-rose-400 hover:text-rose-300">Remove</button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Num label="Count" value={facility.count} onChange={(v) => patchFacility(facility.id, { count: Math.max(Math.round(v) || 0, 0) })} min={0} step={1} unit=" nos" />
              <Num label="Length" value={facility.lengthM} onChange={(v) => patchFacility(facility.id, { lengthM: Math.max(v || 0.5, 0.5) })} min={0.5} step={1} unit=" m" />
              <Num label="Width" value={facility.widthM} onChange={(v) => patchFacility(facility.id, { widthM: Math.max(v || 0.5, 0.5) })} min={0.5} step={1} unit=" m" />
              <Num label="Height" value={facility.heightM} onChange={(v) => patchFacility(facility.id, { heightM: Math.max(v || 0.2, 0.2) })} min={0.2} step={0.5} unit=" m" />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );

  /* ------------------------------ Location step ----------------------------- */
  const applyFromLocation = () => {
    const loc = infra.location;
    if (!loc) return;
    if (kind === "airport") {
      const span = Math.max(loc.boundaryWidthM ?? 0, loc.boundaryDepthM ?? 0);
      if (span > 200) {
        patchAirport({
          runwayLengthM: clamp(Math.round(span / 50) * 50, 1200, 4500),
          runwayHeadingDeg: Math.round((loc.boundaryRotationDeg ?? 90) % 180),
        });
        toast.push({ title: "Runway fitted to site", description: `${clamp(Math.round(span / 50) * 50, 1200, 4500)} m runway · heading ${Math.round((loc.boundaryRotationDeg ?? 90) % 180)}°`, tone: "success" });
      } else {
        toast.push({ title: "Trace a boundary first", tone: "info" });
      }
    } else if (kind === "ports") {
      const area = (loc.boundaryWidthM ?? 0) * (loc.boundaryDepthM ?? 0);
      if (area > 5000) {
        const berthLength = infra.ports!.berthLengthM || 250;
        patchPort({
          containerYardM2: clamp(Math.round(area * 0.45), 20000, 800000),
          berths: clamp(Math.round((loc.boundaryWidthM ?? 0) / berthLength), 1, 12),
        });
        toast.push({ title: "Yard & berths fitted", description: `${clamp(Math.round(area * 0.45), 20000, 800000).toLocaleString()} m² yard`, tone: "success" });
      } else {
        toast.push({ title: "Trace a boundary first", tone: "info" });
      }
    } else if (kind === "dams") {
      const route = loc.routeLengthM ?? 0;
      if (route > 40) {
        patchDam({ crestLengthM: clamp(Math.round(route), 60, 2000) });
        toast.push({ title: "Crest length applied", description: `${clamp(Math.round(route), 60, 2000)} m from the traced axis`, tone: "success" });
      } else {
        toast.push({ title: "Trace the dam axis first", tone: "info" });
      }
    } else {
      toast.push({ title: "Route drives the model", description: loc.routeLengthM ? `${Math.round(loc.routeLengthM)} m captured` : "Trace the alignment", tone: "info" });
    }
  };

  const applyLabel =
    kind === "airport" ? "Fit runway to boundary"
      : kind === "ports" ? "Fit yard & berths"
        : kind === "dams" ? "Use axis as crest length"
          : "Route length in use";

  const locationPanel = (
    <Section title="Where will it be built?">
      <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-400">
        {kind === "highway"
          ? "Search the corridor and trace the road alignment on the satellite map. The captured length and bearing set the model and the takeoff."
          : kind === "dams"
            ? "Find the valley on the map and trace the dam axis. The axis length becomes the crest length."
            : "Find the site on the map and trace its boundary. The best-fit rectangle sizes the works."}
      </p>
      <SiteLocator
        location={infra.location}
        mode={LOCATOR_MODE[kind]}
        onChange={(loc) => update({ location: loc })}
      />
      <Button size="sm" variant="secondary" onClick={applyFromLocation} disabled={!infra.location}>
        {applyLabel}
      </Button>
    </Section>
  );

  /* ------------------------------- Design step ------------------------------ */
  const h = infra.highway!;
  const a = infra.airport!;
  const p = infra.ports!;
  const d = infra.dams!;

  const designPanel =
    kind === "highway" ? (
      <Section title="Highway & roadways">
        <div className="grid grid-cols-2 gap-3">
          <Num label="Lanes" value={h.lanes} onChange={(v) => patchHighway({ lanes: clamp(Math.round(v) || 2, 2, 12) })} min={2} max={12} step={2} unit=" no" />
          <Num label="Lane width" value={h.laneWidthM} onChange={(v) => patchHighway({ laneWidthM: clamp(v || 3.5, 2.5, 4.5) })} min={2.5} max={4.5} step={0.1} unit=" m" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Median" value={h.medianM} onChange={(v) => patchHighway({ medianM: clamp(v || 0, 0, 20) })} min={0} max={20} step={0.5} unit=" m" />
          <Num label="Shoulder" value={h.shoulderM} onChange={(v) => patchHighway({ shoulderM: clamp(v || 0, 0, 5) })} min={0} max={5} step={0.25} unit=" m" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Design speed" value={h.designSpeedKph} onChange={(v) => patchHighway({ designSpeedKph: clamp(Math.round(v) || 60, 40, 140) })} min={40} max={140} step={10} unit=" km/h" />
          <Num label="Cross slope" value={h.crossSlopePct} onChange={(v) => patchHighway({ crossSlopePct: clamp(v || 2, 1, 4) })} min={1} max={4} step={0.5} unit=" %" />
        </div>
        <Select label="Surface" value={h.surface} onChange={(e) => patchHighway({ surface: e.target.value as HighwayDesign["surface"] })}>
          <option value="bituminous">Bituminous (flexible)</option>
          <option value="concrete">Concrete (rigid)</option>
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Pavement thickness" value={h.pavementThicknessMm} onChange={(v) => patchHighway({ pavementThicknessMm: clamp(Math.round(v) || 550, 300, 900) })} min={300} max={900} step={25} unit=" mm" />
          <Num label="Embankment height" value={h.embankmentHeightM} onChange={(v) => patchHighway({ embankmentHeightM: clamp(v || 0, 0, 20) })} min={0} max={20} step={0.5} unit=" m" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Culverts" value={h.culverts} onChange={(v) => patchHighway({ culverts: clamp(Math.round(v) || 0, 0, 40) })} min={0} max={40} step={1} unit=" nos" />
          <Num label="Interchanges" value={h.interchanges} onChange={(v) => patchHighway({ interchanges: clamp(Math.round(v) || 0, 0, 10) })} min={0} max={10} step={1} unit=" nos" />
        </div>
        <Num label="Terrain roughness" value={h.terrainRoughnessM} onChange={(v) => patchHighway({ terrainRoughnessM: clamp(v || 0, 0, 8) })} min={0} max={8} step={0.5} unit=" m" />
        <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">{infraSummary(infra)}</p>
      </Section>
    ) : kind === "airport" ? (
      <Section title="Airport">
        <div className="grid grid-cols-2 gap-3">
          <Num label="Runways" value={a.runways} onChange={(v) => patchAirport({ runways: clamp(Math.round(v) || 1, 1, 4) })} min={1} max={4} step={1} unit=" no" />
          <Select label="Aerodrome code" value={a.aerodromeCode} onChange={(e) => patchAirport({ aerodromeCode: e.target.value as AirportDesign["aerodromeCode"] })}>
            <option value="4F">4F — A380 / B747-8</option>
            <option value="4E">4E — B747 / A340</option>
            <option value="4C">4C — A320 / B737</option>
            <option value="3C">3C — regional</option>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Runway length" value={a.runwayLengthM} onChange={(v) => patchAirport({ runwayLengthM: clamp(Math.round(v) || 1200, 800, 5000) })} min={800} max={5000} step={50} unit=" m" />
          <Num label="Runway width" value={a.runwayWidthM} onChange={(v) => patchAirport({ runwayWidthM: clamp(Math.round(v) || 45, 23, 60) })} min={23} max={60} step={1} unit=" m" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Heading" value={a.runwayHeadingDeg} onChange={(v) => patchAirport({ runwayHeadingDeg: clamp(Math.round(v) || 0, 0, 179) })} min={0} max={179} step={1} unit=" °" />
          <Num label="Taxiways" value={a.taxiways} onChange={(v) => patchAirport({ taxiways: clamp(Math.round(v) || 1, 1, 8) })} min={1} max={8} step={1} unit=" no" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Apron depth" value={a.apronDepthM} onChange={(v) => patchAirport({ apronDepthM: clamp(Math.round(v) || 120, 60, 500) })} min={60} max={500} step={10} unit=" m" />
          <Num label="Stands" value={a.stands} onChange={(v) => patchAirport({ stands: clamp(Math.round(v) || 0, 0, 80) })} min={0} max={80} step={1} unit=" nos" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Terminal area" value={a.terminalAreaM2} onChange={(v) => patchAirport({ terminalAreaM2: clamp(Math.round(v) || 2000, 1000, 200000) })} min={1000} max={200000} step={500} unit=" m²" />
          <Num label="Elevation" value={a.elevationM} onChange={(v) => patchAirport({ elevationM: clamp(Math.round(v) || 0, 0, 4000) })} min={0} max={4000} step={10} unit=" m" />
        </div>
        <Toggle checked={a.fuelFarm} onChange={(v) => patchAirport({ fuelFarm: v })} label="Aviation fuel farm" />
        <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">{infraSummary(infra)}</p>
      </Section>
    ) : kind === "ports" ? (
      <Section title="Ports & harbours">
        <div className="grid grid-cols-2 gap-3">
          <Num label="Berths" value={p.berths} onChange={(v) => patchPort({ berths: clamp(Math.round(v) || 1, 1, 16) })} min={1} max={16} step={1} unit=" no" />
          <Num label="Berth length" value={p.berthLengthM} onChange={(v) => patchPort({ berthLengthM: clamp(Math.round(v) || 100, 80, 500) })} min={80} max={500} step={10} unit=" m" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Design draft" value={p.draftM} onChange={(v) => patchPort({ draftM: clamp(v || 8, 4, 25) })} min={4} max={25} step={0.5} unit=" m" />
          <Num label="Channel depth" value={p.channelDepthM} onChange={(v) => patchPort({ channelDepthM: clamp(v || 10, 5, 28) })} min={5} max={28} step={0.5} unit=" m" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Quay width" value={p.quayWidthM} onChange={(v) => patchPort({ quayWidthM: clamp(Math.round(v) || 30, 15, 120) })} min={15} max={120} step={5} unit=" m" />
          <Num label="Breakwater" value={p.breakwaterLengthM} onChange={(v) => patchPort({ breakwaterLengthM: clamp(Math.round(v) || 0, 0, 3000) })} min={0} max={3000} step={50} unit=" m" />
        </div>
        <Select label="Quay type" value={p.quayType} onChange={(e) => patchPort({ quayType: e.target.value as PortDesign["quayType"] })}>
          <option value="open-piled">Open-piled deck</option>
          <option value="solid">Solid quay wall</option>
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Container yard" value={p.containerYardM2} onChange={(v) => patchPort({ containerYardM2: clamp(Math.round(v) || 10000, 5000, 1500000) })} min={5000} max={1500000} step={5000} unit=" m²" />
          <Num label="STS cranes" value={p.cranes} onChange={(v) => patchPort({ cranes: clamp(Math.round(v) || 0, 0, 16) })} min={0} max={16} step={1} unit=" nos" />
        </div>
        <Num label="Warehouses" value={p.warehouses} onChange={(v) => patchPort({ warehouses: clamp(Math.round(v) || 0, 0, 12) })} min={0} max={12} step={1} unit=" nos" />
        <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">{infraSummary(infra)}</p>
      </Section>
    ) : (
      <Section title="Dams & spillways">
        <Select label="Dam type" value={d.damType} onChange={(e) => patchDam({ damType: e.target.value as DamDesign["damType"] })}>
          <option value="gravity">Concrete gravity</option>
          <option value="earthen">Earthen embankment</option>
          <option value="rockfill">Rockfill</option>
          <option value="arch">Arch</option>
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Height" value={d.heightM} onChange={(v) => patchDam({ heightM: clamp(v || 5, 5, 300) })} min={5} max={300} step={5} unit=" m" />
          <Num label="Crest length" value={d.crestLengthM} onChange={(v) => patchDam({ crestLengthM: clamp(Math.round(v) || 40, 40, 3000) })} min={40} max={3000} step={10} unit=" m" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Crest width" value={d.crestWidthM} onChange={(v) => patchDam({ crestWidthM: clamp(v || 3, 3, 30) })} min={3} max={30} step={0.5} unit=" m" />
          <Num label="Freeboard" value={d.freeboardM} onChange={(v) => patchDam({ freeboardM: clamp(v || 0, 0, 10) })} min={0} max={10} step={0.5} unit=" m" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Upstream slope" value={d.upstreamSlope} onChange={(v) => patchDam({ upstreamSlope: clamp(v || 0, 0, 3) })} min={0} max={3} step={0.05} unit=" H:1V" />
          <Num label="Downstream slope" value={d.downstreamSlope} onChange={(v) => patchDam({ downstreamSlope: clamp(v || 0, 0, 3) })} min={0} max={3} step={0.05} unit=" H:1V" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Reservoir area" value={d.reservoirAreaM2} onChange={(v) => patchDam({ reservoirAreaM2: clamp(Math.round(v) || 10000, 10000, 60000000) })} min={10000} max={60000000} step={10000} unit=" m²" />
          <Num label="Grout curtain" value={d.groutCurtainDepthM} onChange={(v) => patchDam({ groutCurtainDepthM: clamp(Math.round(v) || 0, 0, 120) })} min={0} max={120} step={5} unit=" m" />
        </div>
        <Select label="Spillway type" value={d.spillwayType} onChange={(e) => patchDam({ spillwayType: e.target.value as DamDesign["spillwayType"] })}>
          <option value="ogee">Ogee / overflow</option>
          <option value="chute">Chute</option>
          <option value="siphon">Siphon</option>
          <option value="morning-glory">Morning glory</option>
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Spillway capacity" value={d.spillwayCapacityCumec} onChange={(v) => patchDam({ spillwayCapacityCumec: clamp(Math.round(v) || 100, 100, 50000) })} min={100} max={50000} step={100} unit=" cumec" />
          <Num label="Radial gates" value={d.spillwayGates} onChange={(v) => patchDam({ spillwayGates: clamp(Math.round(v) || 1, 1, 12) })} min={1} max={12} step={1} unit=" nos" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Gate width" value={d.gateWidthM} onChange={(v) => patchDam({ gateWidthM: clamp(v || 1, 1, 30) })} min={1} max={30} step={0.5} unit=" m" />
          <Num label="Gate height" value={d.gateHeightM} onChange={(v) => patchDam({ gateHeightM: clamp(v || 1, 1, 25) })} min={1} max={25} step={0.5} unit=" m" />
        </div>
        <Toggle checked={d.stillingBasin} onChange={(v) => patchDam({ stillingBasin: v })} label="Stilling basin" />
        <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">{infraSummary(infra)}</p>
      </Section>
    );

  /* ------------------------------ Takeoff step ------------------------------ */
  const exportNotes = async (how: "download" | "copy" | "share") => {
    const text = buildInfraNotesText({ projectName: projectName || "Untitled project", infra });
    if (how === "download") {
      download(notesFilename(projectName || "project"), text, "text/plain;charset=utf-8");
      toast.push({ title: "Brief downloaded", description: "Open in Notepad, Notes or any editor.", tone: "success" });
      return;
    }
    if (how === "copy") {
      const ok = await copyToClipboard(text);
      toast.push({ title: ok ? "Copied to clipboard" : "Copy failed", tone: ok ? "success" : "error" });
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
        {takeoff.summary.map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
            <p className="text-[11px] text-slate-500">{s.label}</p>
            <p className="text-sm font-semibold text-slate-200">{s.value}</p>
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
        Quantities follow conventional practice and standard work-item norms — verify against detailed design
        drawings and a certified BOQ before procurement.
      </p>
    </Section>
  );

  const panels: Record<StepId, React.ReactNode> = {
    location: locationPanel,
    design: <>{designPanel}{facilitiesPanel}</>,
    takeoff: takeoffPanel,
  };

  const activeIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
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

        <div className="relative min-h-[420px] flex-1">
          <InfraScene infra={infra} />
          <div className="pointer-events-none absolute left-3 top-3 rounded-xl bg-slate-950/80 px-3 py-2 text-xs text-slate-300 backdrop-blur">
            {INFRA_LABELS[kind]}
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[70%] rounded-xl bg-slate-950/85 px-3 py-2 text-xs text-emerald-300 backdrop-blur">
            {infraSummary(infra)}
          </div>
        </div>
      </div>
    </div>
  );
}
