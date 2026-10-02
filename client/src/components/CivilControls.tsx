import { useEffect, useMemo, useState } from "react";
import type { CivilSettings, InfraDesign } from "../types";
import { analyzeCivilAlignment, buildCivilReport, buildLandXml, civilSettings, inspectCivilProfile, parseCivilProfile } from "../lib/civil";
import { download } from "../lib/download";
import { Button, Input, Toggle } from "./ui";

export function CivilControls({ value, onChange }: { value: InfraDesign; onChange: (civil: CivilSettings) => void }) {
  const settings = civilSettings(value);
  const report = useMemo(() => analyzeCivilAlignment(value), [value]);
  const [profileText, setProfileText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setProfileText((inspectCivilProfile(value.civil?.profile).profile ?? []).map(point => point.stationM + "," + point.elevationM).join("\n")); }, [value.civil?.profile]);
  type NumericField = Exclude<keyof CivilSettings, "profile" | "showCorridor">;
  const fields: { key: NumericField; label: string; min?: number; max?: number; step: number }[] = [
    { key: "stationIntervalM", label: "Station interval (m)", min: 1, max: 1000, step: 1 },
    { key: "corridorWidthM", label: "Corridor width (m)", min: 1, max: 500, step: 1 },
    { key: "startElevationM", label: "Start elevation (m)", min: -100000, max: 100000, step: 0.5 },
    { key: "gradePct", label: "Constant grade (%)", min: -30, max: 30, step: 0.1 },
    { key: "crossfallPct", label: "Crown crossfall (%)", min: -20, max: 20, step: 0.1 },
    { key: "rainfallMmPerHour", label: "Rainfall (mm/h)", min: 0, max: 1000000, step: 5 },
    { key: "runoffCoefficient", label: "Runoff coefficient", min: 0, max: 1, step: 0.05 },
    { key: "catchmentAreaHa", label: "Catchment (ha)", min: 0, max: 1000000, step: 0.1 },
  ];
  const elevations = report.stations.flatMap(station => [station.elevationM, station.designElevationM]);
  const low = elevations.reduce((a, b) => Math.min(a, b), Infinity), high = elevations.reduce((a, b) => Math.max(a, b), -Infinity);
  const chartValid = elevations.every(Number.isFinite) && Number.isFinite(low) && Number.isFinite(high);
  const points = (design: boolean) => report.stations.map(station => (20 + station.stationM / Math.max(report.lengthM, 1) * 520).toFixed(2) + "," + (140 - ((design ? station.designElevationM : station.elevationM) - low) / Math.max(high - low, 1) * 120).toFixed(2)).join(" ");
  const exportFile = (work: () => void) => { try { setError(""); work(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not export this civil study."); } };
  return <section className="space-y-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">Civil corridor & drainage study</p>
    <div className="grid grid-cols-2 gap-2">{fields.map(({ key, label, min, max, step }) => <Input key={key} label={label} type="number" value={settings[key]} min={min} max={max} step={step} onChange={event => {
      if (!event.target.value.trim()) return;
      const number = Number(event.target.value);
      if (Number.isFinite(number)) onChange({ ...settings, [key]: Math.max(min ?? -Infinity, Math.min(max ?? Infinity, number)) });
    }} />)}</div>
    <label className="block text-xs text-slate-400">Vertical profile: station m, elevation m<textarea aria-label="Civil vertical profile" maxLength={20000} value={profileText} onChange={event => setProfileText(event.target.value)} placeholder={"0,100\n250,102\n500,101"} className="mt-1 min-h-20 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs" /></label>
    <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => { const checked = parseCivilProfile(profileText); if (checked.error) setError(checked.error); else { setError(""); onChange({ ...settings, profile: checked.profile }); } }}>Apply profile</Button><Button size="sm" variant="ghost" onClick={() => { setProfileText(""); setError(""); onChange({ ...settings, profile: undefined }); }}>Use constant grade</Button></div>
    <p className="text-[11px] text-slate-500">Use 2–100 increasing stations starting at zero. Profile points override constant-grade settings. Elevations interpolate linearly; the final elevation is held after the last profile station.</p>
    <Toggle label="Show corridor study surface" checked={settings.showCorridor ?? false} onChange={showCorridor => onChange({ ...settings, showCorridor })} />
    {chartValid && <div><svg viewBox="0 0 560 160" className="w-full rounded border border-slate-800 bg-slate-950" role="img" aria-label="Ground and design elevation by alignment station"><line x1="20" y1="140" x2="540" y2="140" stroke="#475569" /><polyline points={points(false)} fill="none" stroke="#a3e635" strokeWidth="2" /><polyline points={points(true)} fill="none" stroke="#22d3ee" strokeWidth="2" /></svg><p className="text-[10px] text-slate-500">Green: ground · cyan: design · station 0–{report.lengthM.toFixed(1)} m · elevation {low.toFixed(2)}–{high.toFixed(2)} m</p></div>}
    <p className="text-xs text-slate-300">{report.lengthM.toFixed(1)} m alignment · {report.stations.length} stations · max ground grade {report.maxGradePct.toFixed(1)}%</p>
    <p className="text-xs text-slate-300">Cut {report.cutFill.cutM3.toFixed(0)} m³ · fill {report.cutFill.fillM3.toFixed(0)} m³ · peak runoff {report.peakRunoffM3s.toFixed(3)} m³/s</p>
    <p className="text-[11px] text-slate-500">The surface is a corridor study overlay with crown crossfall. Quantities use average end areas; runoff uses the rational method. The road BOQ uses highway inputs. Confirm survey and detailed road/drainage design before engineering use.</p>
    {report.warnings.map(warning => <p key={warning} className="text-[11px] text-amber-300">{warning}</p>)}
    {error && <p role="status" className="text-xs text-rose-300">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => exportFile(() => download("civil-report.txt", buildCivilReport(value), "text/plain"))}>Civil report</Button>
      <Button size="sm" variant="outline" onClick={() => exportFile(() => download("civil-landxml.xml", buildLandXml(value), "application/xml"))}>LandXML</Button>
      <Button size="sm" variant="outline" onClick={() => exportFile(() => download("civil-stations.csv", ["station_m,x_m,z_m,ground_m,design_m,left_m,right_m,cut_m2,fill_m2", ...report.stations.map(station => [station.stationM, station.x, station.z, station.elevationM, station.designElevationM, station.leftElevationM, station.rightElevationM, station.cutAreaM2, station.fillAreaM2].map(number => number.toFixed(6)).join(","))].join("\n"), "text/csv"))}>Station CSV</Button>
      <Button size="sm" variant="outline" onClick={() => exportFile(() => download("civil-profile.json", JSON.stringify({ units: "metres", profile: settings.profile ?? null, settings, report }, null, 2), "application/json"))}>Profile JSON</Button>
    </div>
  </section>;
}
