import { useEffect, useMemo, useRef, useState } from "react";
import type { CommunityDesign } from "../types";
import { buildStructuralSolverExchange, structuralModelFingerprint, type StructuralDesignPackage } from "../lib/structuralEngine";
import { MAX_STRUCTURAL_RESULT_BYTES, parseStructuralResults, reviewStructuralResults, structuralResultTemplate } from "../lib/structuralResults";
import { download } from "../lib/download";
import { Badge, Button } from "./ui";

export function StructuralResultsPanel({ design, model, onChange }: { design: CommunityDesign; model: StructuralDesignPackage; onChange: (design: CommunityDesign) => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const context = useRef({ design, model, onChange });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  context.current = { design, model, onChange };
  const report = useMemo(() => design.structuralResults ? reviewStructuralResults(design.structuralResults, design, model) : null, [design, model]);
  const totalPages = Math.max(1, Math.ceil((report?.comparisons.length ?? 0) / 50));
  const currentPage = Math.min(page, totalPages - 1);
  const importFile = async (file: File) => {
    setBusy(true); setMessage("");
    const fingerprint = structuralModelFingerprint(design, model);
    try {
      if (file.size > MAX_STRUCTURAL_RESULT_BYTES) throw new Error("Import structural results up to 6 MB.");
      const text = await file.text();
      if (!mounted.current) return;
      const current = context.current;
      if (structuralModelFingerprint(current.design, current.model) !== fingerprint) throw new Error("The model changed while reading this file. Import again against the current exchange.");
      const checked = parseStructuralResults(text, current.design, current.model);
      if (!checked.results) { setMessage(checked.errors.join(" ")); return; }
      current.onChange({ ...current.design, structuralResults: checked.results });
      setPage(0); setMessage("External results attached. Engineering verification remains not-verified.");
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "Could not import results."); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
    <div className="flex flex-wrap gap-2"><p className="text-xs font-semibold text-slate-200">External solver result review</p><Badge tone="amber">not-verified</Badge></div>
    <p className="text-[11px] text-slate-500">Import normalized SI JSON for this model/load fingerprint. Result provenance and solver correctness require professional review. Member forces use solver local axes; comparisons are planning screens.</p>
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="outline" onClick={() => download("structural-model.json", buildStructuralSolverExchange(design), "application/json")}>Model exchange</Button>
      <Button size="sm" variant="outline" onClick={() => download("structural-results-template.json", structuralResultTemplate(design, model), "application/json")}>Result template</Button>
      {design.structuralResults && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange({ ...design, structuralResults: undefined })}>Detach results</Button>}
    </div>
    <label className="block text-xs text-slate-400">Import external results (JSON, 6 MB maximum)<input type="file" accept=".json,application/json" disabled={busy} className="mt-1 block max-w-full text-xs" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} /></label>
    {message && <p role="status" className="text-xs text-amber-300">{message}</p>}
    {report && <>
      {report.errors.map((error, index) => <p key={index} className="text-xs text-rose-300">{error}</p>)}
      {report.matchesCurrentModel && <>
        <p className="text-xs text-slate-400">Solver {design.structuralResults?.solver.name} · run {design.structuralResults?.solver.runId} · {design.structuralResults?.solver.solvedAt}</p>
        <p className="text-xs text-slate-400">Node coverage {(report.nodeCoverage * 100).toFixed(1)}% · member coverage {(report.memberCoverage * 100).toFixed(1)}% · maximum imported displacement {(report.maximumDisplacementM * 1000).toFixed(3)} mm</p>
        <Button size="sm" variant="outline" onClick={() => download("structural-result-comparison.json", JSON.stringify({ modelFingerprint: design.structuralResults?.modelFingerprint, ...report }, null, 2), "application/json")}>Comparison JSON</Button>
        <div className="max-h-72 overflow-auto"><table className="w-full text-left text-[10px] text-slate-400"><thead><tr><th>Member / combination / station</th><th>External</th><th>Planning</th><th>Difference</th></tr></thead><tbody>{report.comparisons.slice(currentPage * 50, (currentPage + 1) * 50).map((row, index) => <tr key={index}><td className="break-all py-1" title={row.comparisonScope}>{row.memberId} / {row.combinationId} / {row.location}</td><td>{row.externalDemand?.toFixed(3) ?? "—"} {row.unit}</td><td>{row.screeningDemand?.toFixed(3) ?? "—"}</td><td>{row.differencePct !== undefined ? row.differencePct.toFixed(1) + "%" : "—"}</td></tr>)}</tbody></table></div>
        <div className="flex items-center justify-between"><Button size="sm" variant="ghost" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="text-[10px] text-slate-500">{currentPage + 1}/{totalPages}</span><Button size="sm" variant="ghost" disabled={currentPage + 1 >= totalPages} onClick={() => setPage(currentPage + 1)}>Next</Button></div>
      </>}
      {report.warnings.map((warning, index) => <p key={index} className="text-[11px] text-amber-300">{warning}</p>)}
    </>}
  </div>;
}
