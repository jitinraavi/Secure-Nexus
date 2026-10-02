import { useState } from "react";
import type { ConstructionPhase, ConstructionScheduleSettings, Design, VisualizationSettings } from "../types";
import { Button } from "./ui";
import { auditConstructionSchedule, cachedConstructionSchedule } from "../lib/visualization";
import { captureConstructionBaseline, constructionScheduleCsv, constructionScheduleDayAtTime, constructionScheduleJson, constructionScheduleProgressAtDay } from "../lib/constructionSchedule";
import { download } from "../lib/download";

type NumericPhaseField = "start" | "end" | "durationDays" | "earliestStartDay" | "crewSize" | "costEstimate" | "progressPercent" | "actualCost";
const inputClass = "mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100";
const format = (number: number) => number.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function ConstructionSchedulePanel({ design, value, onChange }: { design: Design; value: VisualizationSettings; onChange: (next: Design) => void }) {
  const phases = value.phases;
  const [editedPhaseId, setEditedPhaseId] = useState<string | null>(null);
  const phaseOptions = phases.slice(0, 1000);
  const phaseOptionIds = new Set(phaseOptions.map((phase) => phase.id));
  const editedPhase = phaseOptions.find((phase) => phase.id === editedPhaseId) ?? phaseOptions[0];
  const schedule: ConstructionScheduleSettings = { ...value.schedule, mode: value.schedule?.mode ?? "manual" };
  const report = cachedConstructionSchedule(value);
  const day = constructionScheduleDayAtTime(report, value.time);
  const progress = constructionScheduleProgressAtDay(report, day);
  const manualWarnings = schedule.mode === "manual" ? auditConstructionSchedule(phases) : [];
  const messages = [...new Set([...report.errors, ...report.warnings, ...manualWarnings])];
  const savePhases = (next: ConstructionPhase[]) => onChange({ ...design, visualization: { ...value, phases: next } });
  const updatePhase = (id: string, patch: Partial<ConstructionPhase>) => savePhases(phases.map((phase) => phase.id === id ? { ...phase, ...patch } : phase));
  const updateSchedule = (patch: Partial<ConstructionScheduleSettings>) => onChange({ ...design, visualization: { ...value, schedule: { ...schedule, ...patch } } });
  const addPhase = () => {
    let id = `phase-${Date.now()}`;
    let suffix = 1;
    const ids = new Set(phases.map((phase) => phase.id));
    while (ids.has(id)) id = `phase-${Date.now()}-${suffix++}`;
    savePhases([...phases, { id, name: `Phase ${phases.length + 1}`, start: 0, end: 100, durationDays: 30, dependsOn: [], crewSize: 1, costEstimate: 0, progressPercent: 0, actualCost: 0, color: "#d6a84a" }]);
    setEditedPhaseId(id);
  };
  const numberField = (phase: ConstructionPhase, field: NumericPhaseField, label: string, fallback: number, min: number, max?: number, step = 1) => <label className="text-[10px] text-slate-400" key={field}>{label}<input type="number" min={min} max={max} step={step} value={phase[field] ?? fallback} className={inputClass} onChange={(event) => {
    if (!event.target.value.trim()) return;
    const number = Number(event.target.value);
    if (!Number.isFinite(number)) return;
    const wholeNumber = field === "crewSize" || field === "durationDays" || field === "earliestStartDay";
    const next = Math.max(min, Math.min(max ?? Number.MAX_SAFE_INTEGER, wholeNumber ? Math.round(number) : number));
    updatePhase(phase.id, { [field]: next });
  }} /></label>;
  const currentResources = report.resources.find((interval) => interval.startDay <= day && day < interval.endDay);
  return <section aria-label="Construction planning schedule" className="mt-3 max-h-[60vh] space-y-3 overflow-y-auto border-t border-slate-800 pt-3">
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-[10px] text-slate-400">4D timing<select value={schedule.mode} className={inputClass} onChange={(event) => updateSchedule({ mode: event.target.value === "dependency" ? "dependency" : "manual" })}><option value="manual">Manual phase percentages</option><option value="dependency">Calculated dependency dates</option></select></label>
      <label className="text-[10px] text-slate-400">Project start date<input type="date" value={schedule.startDate ?? ""} className={inputClass} onChange={(event) => updateSchedule({ startDate: event.target.value || undefined })} /></label>
      <Button size="sm" variant="secondary" onClick={addPhase} disabled={phases.length >= 1000}>Add phase</Button>
      <Button size="sm" variant="outline" disabled={!report.valid || !phases.length} onClick={() => {
        const baseline = captureConstructionBaseline(report, new Date().toISOString());
        if (baseline) updateSchedule({ baseline });
      }}>{schedule.baseline ? "Replace baseline" : "Capture baseline"}</Button>
      {schedule.baseline && <Button size="sm" variant="ghost" onClick={() => updateSchedule({ baseline: undefined })}>Clear baseline</Button>}
      <Button size="sm" variant="outline" disabled={!report.valid || !phases.length} onClick={() => download("construction-schedule.csv", constructionScheduleCsv(report), "text/csv;charset=utf-8")}>Schedule CSV</Button>
      <Button size="sm" variant="outline" onClick={() => download("construction-schedule.json", constructionScheduleJson(report), "application/json")}>Schedule JSON</Button>
    </div>
    <p className="text-[11px] text-slate-400">Finish-to-start dependencies use calendar days, including weekends. Activities begin after every predecessor finishes and after their earliest start offset. Unassigned or deleted-phase model objects remain visible.</p>
    {report.valid && phases.length > 0 && <>
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 sm:grid-cols-4">
        <p>Plan duration <strong className="block text-cyan-200">{format(report.durationDays)} days</strong></p>
        <p>Reported progress <strong className="block text-cyan-200">{format(report.totals.progressPercent)}%</strong></p>
        <p>Budget / actual cost <strong className="block text-cyan-200">{format(report.totals.plannedCost)} / {format(report.totals.actualCost)}</strong></p>
        <p>Peak crew / crew-days <strong className="block text-cyan-200">{format(report.totals.peakCrew)} / {format(report.totals.crewDays)}</strong></p>
      </div>
      <p className="text-[11px] text-slate-300">Calculated plan review at day {format(day)}: planned progress {format(progress.plannedProgressPercent)}%, assigned crew {format(currentResources?.crew ?? 0)}, earned value {format(progress.earnedValue)}, schedule variance {format(progress.scheduleVariance)}, cost variance {format(progress.costVariance)}.</p>
      <p className="text-[10px] text-slate-500">Progress and actual costs are manually reported totals. Planned value assumes uniform spending within each activity; cost fields share your project currency. Crew demand is aggregated without resource leveling.{schedule.mode === "manual" ? " The viewer currently follows manual percentages rather than these calculated dates." : " Model objects appear when their calculated phase starts and remain visible."}</p>
      {report.baseline && <p className="rounded border border-slate-800 p-2 text-[11px] text-slate-300">Baseline finish variance: {format(report.baseline.finishVarianceDays)} days · budget variance: {format(report.baseline.costVariance)}. Positive values indicate later completion or higher estimates.</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left text-[11px]">
          <caption className="mb-2 text-left text-slate-400">Calculated activity schedule · red bars indicate zero total float</caption>
          <thead className="text-slate-500"><tr><th className="p-1">Activity</th><th className="p-1">Start / finish day</th><th className="p-1">Start / finish date</th><th className="p-1">Float days</th><th className="p-1">Baseline Δ finish</th><th className="w-36 p-1">Calendar span</th></tr></thead>
          <tbody>{report.phases.map((phase) => <tr key={phase.phaseId} className="border-t border-slate-800 text-slate-300">
            <th scope="row" className="p-1 font-medium">{phase.name}{phase.critical ? " · Critical" : ""}</th>
            <td className="p-1 tabular-nums">{format(phase.startDay)} / {format(phase.endDay)}</td>
            <td className="p-1">{phase.startDate ?? "—"} / {phase.finishDate ?? "—"}</td>
            <td className="p-1 tabular-nums">{format(phase.totalFloatDays)}</td>
            <td className="p-1 tabular-nums">{phase.finishVarianceDays === undefined ? "—" : format(phase.finishVarianceDays)}</td>
            <td className="p-1"><div className="relative h-3 rounded bg-slate-800" aria-label={`${phase.name}: day ${phase.startDay} to ${phase.endDay}`}><div className={`absolute h-3 rounded ${phase.critical ? "bg-rose-400" : "bg-cyan-500"}`} style={{ left: `${100 * phase.startDay / report.durationDays}%`, width: `${100 * phase.durationDays / report.durationDays}%` }} /></div></td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-500">Durations and offsets use whole calendar days. Finish dates are exclusive boundaries. The red path reflects dependencies and start offsets, without crew limits or holidays.</p>
    </>}
    {messages.length > 0 && <div role="status" className="space-y-1 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2 text-[11px] text-amber-200">{messages.map((message) => <p key={message}>{message}</p>)}</div>}
    {phases.length === 0 && <p className="text-slate-400">No phases. Add an activity to create a plan.</p>}
    {phaseOptions.length > 0 && <label className="block text-[11px] text-slate-400">Edit activity<select className={inputClass} value={editedPhase?.id ?? ""} onChange={(event) => setEditedPhaseId(event.target.value)}>{phaseOptions.map((phase, index) => <option key={`${phase.id}-${index}`} value={phase.id}>{phase.name || phase.id}</option>)}</select></label>}
    {phases.length > phaseOptions.length && <p className="text-[11px] text-amber-300">Activity controls show the first 1,000 phases. The oversized stored plan is preserved; reduce its activity count before calculating a schedule.</p>}
    {(editedPhase ? [editedPhase] : []).map((phase) => <fieldset key={phase.id} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 sm:grid-cols-4">
      <legend className="px-1 text-[11px] font-semibold text-slate-300">{phase.name || "Unnamed phase"}</legend>
      <label className="text-[10px] text-slate-400">Name<input value={phase.name} onChange={(event) => updatePhase(phase.id, { name: event.target.value })} className={inputClass} /></label>
      {numberField(phase, "durationDays", "Duration days", Math.max(1, Math.round((phase.end - phase.start) * 2)), 1, 36500)}
      {numberField(phase, "earliestStartDay", "Earliest start day", 0, 0, 365000)}
      {numberField(phase, "crewSize", "Crew size", 1, 1, 100000)}
      {numberField(phase, "costEstimate", "Budget estimate", 0, 0, 1e15, 0.01)}
      {numberField(phase, "progressPercent", "Reported progress %", 0, 0, 100, 1)}
      {numberField(phase, "actualCost", "Actual cost", 0, 0, 1e15, 0.01)}
      {schedule.mode === "manual" && numberField(phase, "start", "4D start %", 0, 0, 100)}
      {schedule.mode === "manual" && numberField(phase, "end", "4D finish %", 100, 0, 100)}
      <label className="text-[10px] text-slate-400 sm:col-span-2">Predecessors (finish-to-start)<select multiple value={(phase.dependsOn ?? []).slice(0, 1000)} onChange={(event) => updatePhase(phase.id, { dependsOn: Array.from(event.target.selectedOptions, (option) => option.value) })} className={`${inputClass} h-16`}>
        {phaseOptions.filter((other) => other.id !== phase.id).map((other, index) => <option key={`${other.id}-${index}`} value={other.id}>{other.name}</option>)}
        {(phase.dependsOn ?? []).slice(0, 1000).filter((id) => !phaseOptionIds.has(id)).map((id, index) => <option key={`${id}-${index}`} value={id}>Missing or outside selection limit: {id}</option>)}
      </select></label>
      <Button size="sm" variant="ghost" className="self-end text-rose-300" onClick={() => savePhases(phases.filter((item) => item.id !== phase.id).map((item) => ({ ...item, dependsOn: (item.dependsOn ?? []).filter((id) => id !== phase.id) })))}>Remove phase</Button>
    </fieldset>)}
  </section>;
}
