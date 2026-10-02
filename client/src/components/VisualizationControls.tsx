import { useEffect, useState } from "react";
import { Button, Toggle } from "./ui";
import type { Design } from "../types";
import { cachedConstructionSchedule, latestVisibleConstructionPhase, visualizationSettings } from "../lib/visualization";
import { constructionScheduleDayAtTime } from "../lib/constructionSchedule";
import { ConstructionSchedulePanel } from "./ConstructionSchedulePanel";

export function VisualizationControls({ design, onChange }: { design: Design; onChange: (next: Design) => void }) {
  const value = visualizationSettings(design.visualization);
  const [playing, setPlaying] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  useEffect(() => {
    if (!playing || !value.enabled) return;
    const timer = window.setInterval(() => {
      const current = visualizationSettings(design.visualization);
      const next = current.time >= 100 ? 0 : Math.min(current.time + 1, 100);
      onChange({ ...design, visualization: { ...current, time: next, playing: false } });
    }, 120);
    return () => window.clearInterval(timer);
  }, [playing, value.enabled, design, onChange]);
  const setTime = (time: number) => onChange({ ...design, visualization: { ...value, time, playing: false } });
  const active = latestVisibleConstructionPhase(value);
  const dependencyTimeline = value.schedule?.mode === "dependency";
  const report = dependencyTimeline || scheduleOpen ? cachedConstructionSchedule(value) : null;
  const day = report?.valid ? constructionScheduleDayAtTime(report, value.time) : undefined;
  return (
    <div className="pointer-events-auto max-w-[min(56rem,calc(100vw-1.5rem))] rounded-xl border border-cyan-500/20 bg-slate-950/90 px-3 py-2 text-xs backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold uppercase tracking-wide text-cyan-300">4D planning</span>
        <Toggle checked={value.enabled} onChange={(enabled) => {
          setPlaying(false);
          onChange({ ...design, visualization: { ...value, enabled } });
        }} label="Phase filter" />
        <Button size="sm" variant="secondary" disabled={!value.enabled || (dependencyTimeline && !report?.valid)} onClick={() => setPlaying((current) => !current)}>{playing ? "Pause" : "Play"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setTime(0)}>Start</Button>
        <input aria-label="Visualization timeline" type="range" min="0" max="100" value={value.time} onChange={(event) => setTime(Number(event.target.value))} className="w-28 accent-cyan-400" />
        <span className="w-10 text-right tabular-nums text-slate-300">{Math.round(value.time)}%</span>
        {dependencyTimeline && day !== undefined && <span className="text-cyan-200">Day {day.toFixed(1)}</span>}
        <Toggle checked={value.walkthrough} onChange={(walkthrough) => onChange({ ...design, visualization: { ...value, walkthrough } })} label="Flythrough" />
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">Quality
          <select value={value.renderQuality ?? "balanced"} onChange={(event) => onChange({ ...design, visualization: { ...value, renderQuality: event.target.value as NonNullable<typeof value.renderQuality> } })} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200">
            <option value="performance">Performance</option>
            <option value="balanced">Balanced</option>
            <option value="presentation">Presentation</option>
          </select>
        </label>
        <span className="hidden text-slate-400 sm:inline">{value.enabled ? active?.name ?? "No started phases" : "All phases"}</span>
        <Button size="sm" variant="ghost" onClick={() => setScheduleOpen((open) => !open)}>{scheduleOpen ? "Hide schedule" : `Schedule (${value.phases.length})`}</Button>
      </div>
      {dependencyTimeline && report && !report.valid && <p role="status" className="mt-2 text-amber-300">The dependency schedule has errors. All model phases remain visible; open the schedule to resolve them.</p>}
      {scheduleOpen && <ConstructionSchedulePanel design={design} value={value} onChange={onChange} />}
    </div>
  );
}

