import { useMemo } from "react";
import type { CivilSettings, InfraDesign } from "../types";
import { analyzeCivilAlignment, buildCivilReport, buildLandXml, civilSettings } from "../lib/civil";
import { download } from "../lib/download";
import { Button, Input } from "./ui";

export function CivilControls({ value, onChange }: { value: InfraDesign; onChange: (civil: CivilSettings) => void }) {
  const settings = civilSettings(value);
  const report = useMemo(() => analyzeCivilAlignment(value), [value]);
  const fields: { key: keyof CivilSettings; label: string; min?: number; max?: number; step: number }[] = [
    { key: "stationIntervalM", label: "Station interval (m)", min: 1, max: 1000, step: 1 },
    { key: "corridorWidthM", label: "Corridor width (m)", min: 1, max: 500, step: 1 },
    { key: "startElevationM", label: "Start elevation (m)", step: 0.5 },
    { key: "gradePct", label: "Design grade (%)", min: -30, max: 30, step: 0.1 },
    { key: "crossfallPct", label: "Crown crossfall (%)", min: -20, max: 20, step: 0.1 },
    { key: "rainfallMmPerHour", label: "Rainfall (mm/h)", min: 0, step: 5 },
    { key: "runoffCoefficient", label: "Runoff coefficient", min: 0, max: 1, step: 0.05 },
    { key: "catchmentAreaHa", label: "Catchment (ha)", min: 0, step: 0.1 },
  ];
  return <section className="space-y-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">Civil corridor & drainage study</p>
    <div className="grid grid-cols-2 gap-2">{fields.map(({ key, label, min, max, step }) => <Input key={key} label={label} type="number" value={settings[key]} min={min} max={max} step={step} onChange={e => {
      if (!e.target.value.trim()) return;
      const n = Number(e.target.value);
      if (Number.isFinite(n)) onChange({ ...settings, [key]: Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)) });
    }} />)}</div>
    <p className="text-xs text-slate-300">{report.lengthM.toFixed(1)} m alignment · {report.stations.length} stations · max ground grade {report.maxGradePct.toFixed(1)}%</p>
    <p className="text-xs text-slate-300">Cut {report.cutFill.cutM3.toFixed(0)} m³ · fill {report.cutFill.fillM3.toFixed(0)} m³ · peak runoff {report.peakRunoffM3s.toFixed(3)} m³/s</p>
    <p className="text-[11px] text-slate-500">Fixed-width crowned corridor, constant grade, average end-area volumes and rational-method runoff. Confirm surveyed geometry and detailed drainage design before engineering use.</p>
    {report.warnings.map(w => <p key={w} className="text-[11px] text-amber-300">{w}</p>)}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => download("civil-report.txt", buildCivilReport(value), "text/plain")}>Civil report</Button>
      <Button size="sm" variant="outline" onClick={() => download("civil-landxml.xml", buildLandXml(value), "application/xml")}>LandXML</Button>
      <Button size="sm" variant="outline" onClick={() => download("civil-stations.csv", ["station_m,x_m,z_m,ground_m,design_m,cut_m2,fill_m2", ...report.stations.map(s => [s.stationM, s.x, s.z, s.elevationM, s.designElevationM, s.cutAreaM2, s.fillAreaM2].map(n => n.toFixed(6)).join(","))].join("\n"), "text/csv")}>Station CSV</Button>
    </div>
  </section>;
}
