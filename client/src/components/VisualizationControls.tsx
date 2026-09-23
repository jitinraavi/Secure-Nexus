import { useEffect, useState } from "react";
import { Button, Toggle } from "./ui";
import type { Design } from "../types";
import { auditConstructionSchedule, DEFAULT_PHASES, visualizationSettings } from "../lib/visualization";

export function VisualizationControls({ design, onChange }: { design: Design; onChange: (next: Design) => void }) {
  const value = visualizationSettings(design.visualization);
  const [playing, setPlaying] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const current = visualizationSettings(design.visualization);
      const next = current.time >= 100 ? 0 : Math.min(current.time + 1, 100);
      onChange({ ...design, visualization: { ...current, time: next, playing: false } });
    }, 120);
    return () => window.clearInterval(timer);
  }, [playing, design, onChange]);
  const setTime = (time: number) => onChange({ ...design, visualization: { ...value, time, playing: false } });
  const phases = value.phases.length ? value.phases : DEFAULT_PHASES;
  const scheduleWarnings = auditConstructionSchedule(phases);
  const active = phases.filter((phase) => phase.start <= value.time).at(-1);
  const updatePhase = (id: string, patch: Partial<(typeof phases)[number]>) => onChange({ ...design, visualization: { ...value, phases: phases.map((phase) => phase.id === id ? { ...phase, ...patch } : phase) } });
  const addPhase = () => onChange({ ...design, visualization: { ...value, phases: [...phases, { id: `phase-${Date.now()}`, name: `Phase ${phases.length + 1}`, start: 0, end: 100, durationDays: 30, dependsOn: [], crewSize: 1, costEstimate: 0, color: "#d6a84a" }] } });
  return (
    <div className="pointer-events-auto max-w-[min(56rem,calc(100vw-1.5rem))] rounded-xl border border-cyan-500/20 bg-slate-950/90 px-3 py-2 text-xs backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold uppercase tracking-wide text-cyan-300">4D review</span>
      <span className="text-slate-500">Planning schedule · not construction simulation</span>
      <Button size="sm" variant="secondary" onClick={() => setPlaying((v) => !v)}>{playing ? "Pause" : "Play"}</Button>
      <Button size="sm" variant="ghost" onClick={() => setTime(0)}>Start</Button>
      <input aria-label="Visualization timeline" type="range" min="0" max="100" value={value.time} onChange={(e) => setTime(Number(e.target.value))} className="w-28 accent-cyan-400" />
      <span className="w-10 text-right tabular-nums text-slate-300">{Math.round(value.time)}%</span>
      <Toggle checked={value.walkthrough} onChange={(walkthrough) => onChange({ ...design, visualization: { ...value, walkthrough } })} label="Flythrough" />
      <label className="flex items-center gap-1.5 text-[11px] text-slate-400">Quality
        <select value={value.renderQuality ?? "balanced"} onChange={(event) => onChange({ ...design, visualization: { ...value, renderQuality: event.target.value as NonNullable<typeof value.renderQuality> } })} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200">
          <option value="performance">Performance</option>
          <option value="balanced">Balanced</option>
          <option value="presentation">Presentation</option>
        </select>
      </label>
      <span className="hidden text-slate-400 sm:inline">{active?.name ?? "All phases"}</span>
      <Button size="sm" variant="ghost" onClick={() => setScheduleOpen((open) => !open)}>{scheduleOpen ? "Hide schedule" : `Schedule (${phases.length})`}</Button>
      </div>
      {scheduleOpen && <div className="mt-3 max-h-72 space-y-2 overflow-y-auto border-t border-slate-800 pt-3">
        <div className="flex items-center justify-between"><p className="font-semibold text-slate-300">Phase schedule</p><Button size="sm" variant="secondary" onClick={addPhase}>Add phase</Button></div>
        {phases.map((phase) => <div key={phase.id} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 sm:grid-cols-4">
          <label className="text-[10px] text-slate-500">Name<input value={phase.name} onChange={(e) => updatePhase(phase.id, { name: e.target.value })} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100" /></label>
          <label className="text-[10px] text-slate-500">Start %<input type="number" min="0" max="100" value={phase.start} onChange={(e) => updatePhase(phase.id, { start: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100" /></label>
          <label className="text-[10px] text-slate-500">End %<input type="number" min="0" max="100" value={phase.end} onChange={(e) => updatePhase(phase.id, { end: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100" /></label>
          <label className="text-[10px] text-slate-500">Duration days<input type="number" min="1" value={phase.durationDays ?? Math.max(1, Math.round((phase.end - phase.start) * 2))} onChange={(e) => updatePhase(phase.id, { durationDays: Math.max(1, Number(e.target.value) || 1) })} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100" /></label>
          <label className="text-[10px] text-slate-500">Crew size<input type="number" min="1" value={phase.crewSize ?? 1} onChange={(e) => updatePhase(phase.id, { crewSize: Math.max(1, Number(e.target.value) || 1) })} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100" /></label>
          <label className="text-[10px] text-slate-500">Cost estimate<input type="number" min="0" value={phase.costEstimate ?? 0} onChange={(e) => updatePhase(phase.id, { costEstimate: Math.max(0, Number(e.target.value) || 0) })} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100" /></label>
          <label className="text-[10px] text-slate-500 sm:col-span-2">Depends on<select multiple value={phase.dependsOn ?? []} onChange={(e) => updatePhase(phase.id, { dependsOn: Array.from(e.target.selectedOptions, (option) => option.value) })} className="mt-1 h-12 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100">{phases.filter((other) => other.id !== phase.id).map((other) => <option key={other.id} value={other.id}>{other.name}</option>)}</select></label>
          <button onClick={() => onChange({ ...design, visualization: { ...value, phases: phases.filter((item) => item.id !== phase.id).map((item) => ({ ...item, dependsOn: (item.dependsOn ?? []).filter((id) => id !== phase.id) })) } })} className="self-end rounded px-2 py-2 text-left text-xs text-rose-300 hover:bg-rose-500/10">Remove phase</button>
        </div>)}
        {scheduleWarnings.length > 0 && <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2 text-[11px] text-amber-200">{scheduleWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
        <p className="text-[10px] text-slate-500">Schedule fields are planning estimates. Dependencies and costs are not construction-validated.</p>
      </div>}
    </div>
  );
}
