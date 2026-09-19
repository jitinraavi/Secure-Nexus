import type { TerrainSettings } from "../types";
import { Toggle, Select } from "./ui";
import { terrainProfile } from "../lib/terrain";

export function TerrainControls({ value, width, depth, onChange }: { value?: TerrainSettings; width: number; depth: number; onChange: (value: TerrainSettings) => void }) {
  const settings: TerrainSettings = {
    enabled: true, baseElevationM: 0, reliefM: 3, contourIntervalM: 1, contoursVisible: true, profileAxis: "x", profileOffsetM: 0, ...value,
  };
  const patch = (next: Partial<TerrainSettings>) => onChange({ ...settings, ...next });
  const profile = terrainProfile(width, depth, settings);
  return (
    <section className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Terrain study</p><p className="mt-1 text-[11px] leading-relaxed text-slate-400">Deterministic local surface for early coordination. No external DEM is attached.</p></div>
      <Toggle checked={settings.enabled} onChange={(enabled) => patch({ enabled })} label="Show terrain surface" />
      <div className="grid grid-cols-2 gap-2">
        <NumericField label="Base elevation" value={settings.baseElevationM} onChange={(baseElevationM) => patch({ baseElevationM })} unit=" m" />
        <NumericField label="Relief" value={settings.reliefM} min={0} max={50} onChange={(reliefM) => patch({ reliefM: Math.min(Math.max(reliefM, 0), 50) })} unit=" m" />
        <NumericField label="Contour interval" value={settings.contourIntervalM} min={0.25} max={20} onChange={(contourIntervalM) => patch({ contourIntervalM: Math.min(Math.max(contourIntervalM, 0.25), 20) })} unit=" m" />
        <NumericField label="Profile offset" value={settings.profileOffsetM} onChange={(profileOffsetM) => patch({ profileOffsetM })} unit=" m" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select label="Profile axis" value={settings.profileAxis} onChange={(e) => patch({ profileAxis: e.target.value as TerrainSettings["profileAxis"] })}><option value="x">X / east-west</option><option value="z">Z / north-south</option></Select>
        <Toggle checked={settings.contoursVisible} onChange={(contoursVisible) => patch({ contoursVisible })} label="Show contours" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-400">
        <Metric label="Low" value={`${profile.minM.toFixed(1)} m`} /><Metric label="High" value={`${profile.maxM.toFixed(1)} m`} /><Metric label="Max grade" value={`${profile.maxGradePct.toFixed(1)}%`} />
      </div>
    </section>
  );
}

function NumericField({ label, value, onChange, min, max, unit }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; unit: string }) {
  return <label className="block text-[11px] font-medium text-slate-400">{label}<span className="ml-1 text-slate-600">{value.toFixed(1)}{unit}</span><input type="number" value={value} min={min} max={max} step={0.5} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500" /></label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-2 py-1.5"><span className="block text-slate-600">{label}</span><strong className="text-emerald-300">{value}</strong></div>;
}
