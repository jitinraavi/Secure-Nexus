import { useMemo, useState } from "react";
import type { Design } from "../types";
import { benchmarkDesign } from "../lib/performance";
import { Badge, Button, Modal } from "./ui";

export function PerformancePanel({ design }: { design: Design }) {
  const [open, setOpen] = useState(false);
  const report = useMemo(() => benchmarkDesign(design), [design]);
  return <>
    <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Performance</Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Model performance budget">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={report.tier === "small" ? "emerald" : report.tier === "medium" ? "cyan" : "amber"}>{report.tier}</Badge><span className="text-sm text-slate-300">{report.estimatedComponents.toLocaleString()} estimated components</span></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["JSON size", `${(report.jsonBytes / 1024).toFixed(1)} KiB`],
            ["Serialize", `${report.serializationMs.toFixed(2)} ms`],
            ["Est. draw calls", report.estimatedDrawCalls.toLocaleString()],
            ["Est. triangles", report.estimatedTriangles.toLocaleString()],
          ].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-800 bg-slate-950/50 p-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-200">{value}</p></div>)}
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">
          <p className="font-semibold text-slate-200">Budget for this tier</p>
          <p className="mt-1">Target ≥ {report.budgets.targetFps} FPS · load ≤ {report.budgets.targetLoadMs} ms · draw calls ≤ {report.budgets.targetDrawCalls} · memory ≤ {report.budgets.targetMemoryMb} MB.</p>
        </div>
        <div className="space-y-1 text-xs text-slate-400">
          {report.recommendations.length ? report.recommendations.map((item) => <p key={item}>• {item}</p>) : <p>Current model is within the small-model budget. Continue measuring on representative devices.</p>}
        </div>
      </div>
    </Modal>
  </>;
}
