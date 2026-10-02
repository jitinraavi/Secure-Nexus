import { useMemo, useState } from "react";
import type { TerrainSettings } from "../types";
import { Button, Input, Toggle, Select } from "./ui";
import { buildSurveyTin, MAX_SURVEY_POINTS, parseTerrainCsv, terrainProfile, terrainSettings, terrainSlopeSummary } from "../lib/terrain";

export function TerrainControls({ value, width, depth, onChange }: { value?: TerrainSettings; width: number; depth: number; onChange: (value: TerrainSettings) => void }) {
  const settings = terrainSettings(value);
  const [csv, setCsv] = useState("");
  const [error, setError] = useState("");
  const [absolute, setAbsolute] = useState(false);
  const patch = (next: Partial<TerrainSettings>) => onChange({ ...settings, ...next });
  const profile = useMemo(() => terrainProfile(width, depth, value), [width, depth, value]);
  const slope = useMemo(() => {
    try { return terrainSlopeSummary(value?.source === "survey" ? buildSurveyTin(value) : []); }
    catch { return null; }
  }, [value]);
  const importSurvey = () => {
    try {
      const parsed = parseTerrainCsv(csv);
      const samples = absolute ? parsed.map(p => ({ ...p, x: p.x - (settings.localOriginEasting ?? 0), z: p.z - (settings.localOriginNorthing ?? 0) })) : parsed;
      onChange({ ...settings, samples, source: "survey" });
      setCsv(""); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Survey import failed."); }
  };
  return <section className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
    <div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Terrain study</p><p className="mt-1 text-[11px] leading-relaxed text-slate-400">{settings.source === "survey" ? `${settings.samples?.length ?? 0} survey points. Delaunay TIN within the convex hull; IDW outside it. No breaklines or holes.` : "Deterministic local planning surface. Import a surveyed surface below."}</p></div>
    <Toggle checked={settings.enabled} onChange={enabled => patch({ enabled })} label="Show terrain surface" />
    <Select label="Surface source" value={settings.source ?? "procedural"} onChange={e => patch({ source: e.target.value as TerrainSettings["source"] })}>
      <option value="procedural">Procedural study</option><option value="survey" disabled={!settings.samples?.length}>Survey TIN</option>
    </Select>
    <div className="grid grid-cols-2 gap-2">
      <NumericField label="Base elevation" value={settings.baseElevationM} onChange={baseElevationM => patch({ baseElevationM })} unit=" m" />
      <NumericField label="Relief" value={settings.reliefM} min={0} max={50} onChange={reliefM => patch({ reliefM })} unit=" m" />
      <NumericField label="Contour interval" value={settings.contourIntervalM} min={0.25} max={20} onChange={contourIntervalM => patch({ contourIntervalM })} unit=" m" />
      <NumericField label="Profile offset" value={settings.profileOffsetM} onChange={profileOffsetM => patch({ profileOffsetM })} unit=" m" />
      <NumericField label="Origin easting" value={settings.localOriginEasting ?? 0} onChange={localOriginEasting => patch({ localOriginEasting })} unit=" m" />
      <NumericField label="Origin northing" value={settings.localOriginNorthing ?? 0} onChange={localOriginNorthing => patch({ localOriginNorthing })} unit=" m" />
    </div>
    <Input label="Project CRS (metadata)" value={settings.projectCrs ?? "LOCAL"} onChange={e => patch({ projectCrs: e.target.value.slice(0, 100) })} placeholder="LOCAL or EPSG identifier" />
    <p className="text-[11px] text-slate-500">CRS is recorded for exchange. Coordinates must already be in metres in the same local axes as the model; no reprojection is performed. Changing the origin does not move stored local samples.</p>
    <div className="grid grid-cols-2 gap-2">
      <Select label="Profile axis" value={settings.profileAxis} onChange={e => patch({ profileAxis: e.target.value as TerrainSettings["profileAxis"] })}><option value="x">X / east-west</option><option value="z">Z / north-south</option></Select>
      <Toggle checked={settings.contoursVisible} onChange={contoursVisible => patch({ contoursVisible })} label="Show contours" />
    </div>
    <details className="text-xs text-slate-400"><summary className="cursor-pointer">Import survey CSV</summary>
      <p className="my-2">Three columns: x,z,elevation or easting,northing,elevation. Metres, up to {MAX_SURVEY_POINTS.toLocaleString()} points.</p>
      <Toggle checked={absolute} onChange={setAbsolute} label="Subtract survey origin from imported coordinates" />
      <textarea aria-label="Survey CSV" value={csv} onChange={e => setCsv(e.target.value)} rows={5} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 p-2" placeholder={"x,z,elevation\n0,0,10\n20,0,11\n0,20,9"} />
      {error && <p role="alert" className="text-amber-300">{error}</p>}
      <div className="mt-2 flex gap-2"><Button size="sm" disabled={!csv.trim()} onClick={importSurvey}>Import</Button><Button size="sm" variant="ghost" disabled={!settings.samples?.length} onClick={() => { patch({ samples: [], source: "procedural" }); setError(""); }}>Clear survey</Button></div>
    </details>
    <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-400">
      <Metric label="Profile low" value={`${profile.minM.toFixed(1)} m`} /><Metric label="Profile high" value={`${profile.maxM.toFixed(1)} m`} /><Metric label="Max profile grade" value={`${profile.maxGradePct.toFixed(1)}%`} />
      {settings.source === "survey" && slope && <><Metric label="TIN area" value={`${slope.areaM2.toFixed(0)} m²`} /><Metric label="Mean slope" value={`${slope.meanSlopePct.toFixed(1)}%`} /><Metric label="Max slope" value={`${slope.maxSlopePct.toFixed(1)}%`} /></>}
    </div>
  </section>;
}
function NumericField({ label, value, onChange, min, max, unit }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; unit: string }) {
  return <label className="block text-[11px] font-medium text-slate-400">{label}<span className="ml-1 text-slate-600">{value.toFixed(1)}{unit}</span><input type="number" value={value} min={min} max={max} step={0.5} onChange={e => { if (!e.target.value.trim()) return; const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n))); }} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500" /></label>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-2 py-1.5"><span className="block text-slate-600">{label}</span><strong className="text-emerald-300">{value}</strong></div>;
}

