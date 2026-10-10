import type { SectionSettings } from "../types";
import { Select, Toggle } from "./ui";

const DEFAULT_SECTION: SectionSettings = { enabled: false, axis: "y", offset: 0, depth: 10 };

export function SectionControls({ value, onChange }: { value?: SectionSettings; onChange: (next: SectionSettings) => void }) {
  const section = value ?? DEFAULT_SECTION;
  const patch = (next: Partial<SectionSettings>) => onChange({ ...section, ...next });
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">Section / cutaway</p>
          <p className="mt-1 text-xs text-slate-500">{section.enabled ? `Active · ${section.axis.toUpperCase()} axis · ${section.depth} m depth` : "Off · showing the full model"}</p>
        </div>
        <Toggle checked={section.enabled} onChange={(enabled) => patch({ enabled })} label="On" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select label="Axis" value={section.axis} onChange={(e) => patch({ axis: e.target.value as SectionSettings["axis"] })}>
          <option value="x">X / east-west</option>
          <option value="y">Y / vertical</option>
          <option value="z">Z / north-south</option>
        </Select>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-300">Start offset (m)</span>
          <input type="number" step="0.5" value={section.offset} onChange={(e) => patch({ offset: Number(e.target.value) || 0 })} className="w-full rounded-xl border border-slate-700/80 bg-slate-950/55 px-3.5 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-300" />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-slate-300">Visible depth / height (m)</span>
        <input type="number" min="0.1" step="0.5" value={section.depth} onChange={(e) => patch({ depth: Math.max(Number(e.target.value) || 0.1, 0.1) })} className="w-full rounded-xl border border-slate-700/80 bg-slate-950/55 px-3.5 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-300" />
      </label>
      {section.axis !== "y" && <label className="block space-y-1.5">
        <span className="text-sm font-medium text-slate-300">Cut angle (degrees)</span>
        <input type="number" step="5" value={section.rotationDeg ?? 0} onChange={(e) => patch({ rotationDeg: Number(e.target.value) || 0 })} className="w-full rounded-xl border border-slate-700/80 bg-slate-950/55 px-3.5 py-2.5 text-sm text-slate-100 outline-none focus:border-amber-300" />
      </label>}
    </div>
  );
}
