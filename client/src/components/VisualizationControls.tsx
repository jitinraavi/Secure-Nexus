import { useEffect, useState } from "react";
import { Button, Toggle } from "./ui";
import type { Design } from "../types";
import { DEFAULT_PHASES, visualizationSettings } from "../lib/visualization";

export function VisualizationControls({ design, onChange }: { design: Design; onChange: (next: Design) => void }) {
  const value = visualizationSettings(design.visualization);
  const [playing, setPlaying] = useState(false);
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
  const active = phases.filter((phase) => phase.start <= value.time).at(-1);
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-cyan-500/20 bg-slate-950/90 px-3 py-2 text-xs backdrop-blur">
      <span className="font-semibold uppercase tracking-wide text-cyan-300">4D review</span>
      <span className="text-slate-500">Visualization only</span>
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
    </div>
  );
}
