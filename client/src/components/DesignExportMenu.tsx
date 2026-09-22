import { useEffect, useState } from "react";
import { Button, Input, Modal, Select } from "./ui";
import { useToast } from "./Toast";
import { buildDxf } from "../lib/dxf";
import { buildIfcStep } from "../lib/bim";
import { download, downloadBlob } from "../lib/download";
import { buildSheetPdf } from "../lib/sheets";
import type { Design } from "../types";
import { documentationFor } from "../lib/documentation";
import { getCadExchangeStatus, type CadExchangeStatusResponse } from "../api";

export function DesignExportMenu({ design, projectName, onChange }: { design: Design; projectName?: string; onChange?: (design: Design) => void }) {
  const [open, setOpen] = useState(false);
  const [cadStatus, setCadStatus] = useState<CadExchangeStatusResponse | null>(null);
  const docs = documentationFor(design);
  const toast = useToast();
  const stem = (projectName || "design").trim().replace(/[^\w-]+/g, "-").toLowerCase() || "design";
  useEffect(() => { getCadExchangeStatus().then(setCadStatus).catch(() => setCadStatus(null)); }, []);
  const dwgProvider = cadStatus?.providers[0];
  const exportFile = (format: "dxf" | "ifc") => {
    if (format === "dxf") download(`${stem}.dxf`, buildDxf(design), "application/dxf");
    else download(`${stem}.ifc`, buildIfcStep(design), "application/x-step");
    toast.push({ title: `${format.toUpperCase()} downloaded`, description: "Planning and coordination geometry is marked as approximate.", tone: "success" });
    setOpen(false);
  };
  const exportSheets = () => {
    const blob = new Blob([buildSheetPdf(projectName || "Untitled project", design)], { type: "application/pdf" });
    downloadBlob(`${stem}-sheets.pdf`, blob);
    toast.push({ title: "PDF sheet set downloaded", description: "Documentation metadata, views, annotations, schedules, and planning geometry included.", tone: "success" });
    setOpen(false);
  };
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label="Open documentation and export options">Docs / exports</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Documentation and exchange exports">
        <div className="mb-4 rounded-xl border border-slate-700 bg-slate-950/40 p-3">
          <p className="gw-kicker">Sheet set metadata</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Input aria-label="Project number" value={docs.projectNumber} placeholder="Project number" onChange={(e) => onChange?.({ ...design, documentation: { ...docs, projectNumber: e.target.value } })} />
            <Input aria-label="Client" value={docs.client} placeholder="Client" onChange={(e) => onChange?.({ ...design, documentation: { ...docs, client: e.target.value } })} />
            <Input aria-label="Author" value={docs.author} placeholder="Author" onChange={(e) => onChange?.({ ...design, documentation: { ...docs, author: e.target.value } })} />
            <Select aria-label="Issue status" value={docs.status} onChange={(e) => onChange?.({ ...design, documentation: { ...docs, status: e.target.value as typeof docs.status } })}>
              <option value="draft">Draft</option><option value="review">For review</option><option value="issued">Issued</option>
            </Select>
          </div>
          <div className="mt-3 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
            {docs.views.filter((view) => view.visible).map((view) => <span key={view.id}>{view.name} · {view.kind} · {view.scale} · {view.orientation}</span>)}
          </div>
          <p className="mt-2 text-xs text-slate-500">Persisted with the design and carried into title blocks, sheet indexes, views, tags, schedules, and revisions.</p>
        </div>
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="gw-kicker text-amber-300">Exchange summary</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">{projectName || "Untitled project"} exports a 2D drafting projection and a minimal IFC4 coordination model.</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Proxy geometry, section cuts, infrastructure forms, and BOQ quantities are approximate planning outputs. Confirm dimensions in authoring software.</p>
          <div className="mt-3 rounded-lg border border-slate-700/70 bg-slate-950/40 p-2 text-xs text-slate-400">
            <span className={dwgProvider?.available ? "text-emerald-300" : "text-amber-300"}>DWG: {dwgProvider?.available ? "licensed provider ready" : "unavailable"}</span>
            <span className="ml-2">{dwgProvider?.message || "Provider status is loading."}</span>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button onClick={() => exportFile("dxf")}>Download DXF</Button>
          <Button variant="secondary" onClick={() => exportFile("ifc")}>Download IFC STEP</Button>
          <Button className="sm:col-span-2" variant="outline" disabled={!dwgProvider?.available} title={dwgProvider?.message || "Licensed DWG provider unavailable"}>Download DWG (licensed provider)</Button>
          <Button className="sm:col-span-2" onClick={exportSheets}>Download multipage PDF sheet set</Button>
        </div>
      </Modal>
    </>
  );
}
