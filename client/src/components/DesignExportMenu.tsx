import { useState } from "react";
import { Button, Modal } from "./ui";
import { useToast } from "./Toast";
import { buildDxf } from "../lib/dxf";
import { buildIfcStep } from "../lib/bim";
import { download } from "../lib/download";
import type { Design } from "../types";

export function DesignExportMenu({ design, projectName }: { design: Design; projectName?: string }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const stem = (projectName || "design").trim().replace(/[^\w-]+/g, "-").toLowerCase() || "design";
  const exportFile = (format: "dxf" | "ifc") => {
    if (format === "dxf") download(`${stem}.dxf`, buildDxf(design), "application/dxf");
    else download(`${stem}.ifc`, buildIfcStep(design), "application/x-step");
    toast.push({ title: `${format.toUpperCase()} downloaded`, description: "Planning and coordination geometry is marked as approximate.", tone: "success" });
    setOpen(false);
  };
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label="Open DXF and IFC export options">Export DXF / IFC</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Formal exchange exports">
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="gw-kicker text-amber-300">Exchange summary</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">{projectName || "Untitled project"} exports a 2D drafting projection and a minimal IFC4 coordination model.</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Proxy geometry, section cuts, and infrastructure forms are approximate planning outputs. Confirm dimensions in authoring software.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button onClick={() => exportFile("dxf")}>Download DXF</Button>
          <Button variant="secondary" onClick={() => exportFile("ifc")}>Download IFC STEP</Button>
        </div>
      </Modal>
    </>
  );
}
