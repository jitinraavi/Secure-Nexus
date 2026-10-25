import { useState } from "react";
import type { CadAnalysisRecord, Design, DraftElement } from "../types";
import { analyzeFrame2D, type FrameModel2D } from "../lib/frameAnalysis";
import { resolveDraft } from "../lib/parametric";
import { download } from "../lib/download";

interface Props { design: Design; selected: DraftElement | undefined; readOnly: boolean; onRecord: (record: CadAnalysisRecord) => void; }
/** The local member template deliberately requires authored restraints and loads. */
export function CadAnalysisPanel({ design, selected, readOnly, onRecord }: Props) {
  const [elastic, setElastic] = useState("");
  const [forceX, setForceX] = useState("");
  const [forceY, setForceY] = useState("");
  const [basis, setBasis] = useState("");
  const [support, setSupport] = useState(false);
  const [error, setError] = useState("");
  const record = design.cad?.analyses?.find(item => item.id === `member-${selected?.id}`);
  const supported = selected && ["beam", "column"].includes(selected.kind);
  const run = () => {
    try {
      if (!selected || !supported) throw new Error("Select a beam or column. Surface and connection analysis is unavailable in this member template.");
      if (!support || !basis.trim() || [elastic, forceX, forceY].some(value => value.trim() === "" || !Number.isFinite(Number(value)))) throw new Error("Enter E, both loads (including explicit zero), a design basis and confirm the fixed support.");
      const r = resolveDraft(selected, design.community?.levels);
      const column = selected.kind === "column", round = selected.family?.type === "circular-column";
      const length = column ? r.height : r.width;
      const area = round ? Math.PI * r.width ** 2 / 4 : column ? r.width * r.depth : r.depth * r.height;
      const inertia = round ? Math.PI * r.width ** 4 / 64 : column ? r.depth * r.width ** 3 / 12 : r.depth * r.height ** 3 / 12;
      const model: FrameModel2D = { version: 1, analysis: "linear", nodes: [
        { id: `${selected.id}-a`, xM: 0, yM: 0, restraints: [true, true, true] },
        { id: `${selected.id}-b`, xM: column ? 0 : length, yM: column ? length : 0, restraints: [false, false, false] },
      ], members: [{ id: selected.id, start: `${selected.id}-a`, end: `${selected.id}-b`, areaM2: area, inertiaM4: inertia, elasticModulusPa: Number(elastic) * 1e9 }], loadCases: [{ id: "authored-load", nodal: [{ node: `${selected.id}-b`, fxN: Number(forceX) * 1000, fyN: Number(forceY) * 1000, mzNm: 0 }], uniform: [] }] };
      const result = analyzeFrame2D(model);
      onRecord({ id: `member-${selected.id}`, sourceObjectIds: [selected.id], sourceRevision: design.cad?.revision ?? 0, status: "current", method: result.method, units: "m, N, Pa", inputs: { model }, assumptions: ["Single elastic prismatic member in its local vertical plane", "Authored fixed support at start; free end", "No releases, connections, self-weight, out-of-plane effects or code capacities inferred"], designBasis: basis.trim(), result: result as unknown as Record<string, unknown> });
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Calculation failed"); }
  };
  const report = record?.result as unknown as ReturnType<typeof analyzeFrame2D> | undefined;
  const result = report?.results?.[0];
  return <section className="cad-analysis cad-group">
    <div className="cad-section-title"><h3>Geometry → analysis</h3><span className={`cad-validity ${record?.status ?? "incomplete"}`}>{record?.status === "needs-recalculation" ? "Needs recalculation" : record?.status ?? "Inputs required"}</span></div>
    <p className="cad-muted">Selected beam / column → existing elastic frame solver. Other member relationships and national-code compliance require a separately authored model.</p>
    {supported ? <>
      <label className="cad-field">Elastic modulus E <span>GPa</span><input aria-label="Elastic modulus GPa" type="number" min="0.001" value={elastic} onChange={e => setElastic(e.target.value)} disabled={readOnly} placeholder="Required material input" /></label>
      <div className="cad-field-pair"><label className="cad-field">End load local X <span>kN</span><input type="number" value={forceX} onChange={e => setForceX(e.target.value)} disabled={readOnly} placeholder="Explicit zero or load" /></label><label className="cad-field">End load local Y <span>kN</span><input type="number" value={forceY} onChange={e => setForceY(e.target.value)} disabled={readOnly} placeholder="Negative = downward" /></label></div>
      <label className="cad-field">Design basis<input value={basis} onChange={e => setBasis(e.target.value)} disabled={readOnly} placeholder="Material source and load case" /></label>
      <label className="cad-check"><input type="checkbox" checked={support} onChange={e => setSupport(e.target.checked)} disabled={readOnly} />I specify a fixed start and free end</label>
      <button className="cad-button cad-primary" disabled={readOnly} onClick={run}>Calculate selected member</button>
    </> : <p className="cad-issue">Select a beam or column for this supported local-member calculation. Slab, wall and roof structural analysis is unavailable here.</p>}
    {error && <p className="cad-issue" role="alert">{error}</p>}
    {record && <div className="cad-result"><p><strong>{record.status === "current" ? "Current" : "Historical"} result</strong> · model r{record.sourceRevision}</p><p>{record.designBasis}</p>
      {result && <dl><dt>End displacement X</dt><dd>{((result.displacements[1]?.uxM ?? 0) * 1000).toPrecision(5)} mm</dd><dt>End displacement Y</dt><dd>{((result.displacements[1]?.uyM ?? 0) * 1000).toPrecision(5)} mm</dd><dt>Maximum moment</dt><dd>{((result.members[0]?.maxMomentNm ?? 0) / 1000).toPrecision(5)} kNm</dd></dl>}
      <p className="cad-muted">{record.method} · {record.units}. Results remain unverified engineering outputs. {record.assumptions.join(". ")}.</p>
      <button className="cad-button" onClick={() => download(`groundwork-${record.id}-analysis.json`, JSON.stringify(record, null, 2), "application/json")}>Export inputs and provenance</button>
    </div>}
  </section>;
}
