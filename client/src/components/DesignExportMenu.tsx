import { useEffect, useState } from "react";
import { Badge, Button, Input, Modal, Select } from "./ui";
import { useToast } from "./Toast";
import { download, downloadBlob } from "../lib/download";
import type { Design, DocumentationAnnotation, DocumentationRevision, DocumentationSchedule, DocumentationSheet, DocumentationView } from "../types";
import { documentationFor } from "../lib/documentation";
import { getCadExchangeStatus, type CadExchangeStatusResponse } from "../api";
import { COMPLIANCE_PROFILES, validateDesign } from "../lib/compliance";
import { buildIfcStep, validateIfcRoundTrip } from "../lib/bim";

export function DesignExportMenu({ design, projectName, onChange }: { design: Design; projectName?: string; onChange?: (design: Design) => void }) {
  const [open, setOpen] = useState(false);
  const [cadStatus, setCadStatus] = useState<CadExchangeStatusResponse | null>(null);
  const docs = documentationFor(design);
  const compliance = validateDesign(design);
  const ifcReport = validateIfcRoundTrip(design);
  const toast = useToast();
  const stem = (projectName || "design").trim().replace(/[^\w-]+/g, "-").toLowerCase() || "design";
  useEffect(() => { getCadExchangeStatus().then(setCadStatus).catch(() => setCadStatus(null)); }, []);
  const dwgProvider = cadStatus?.providers[0];
  const updateDocs = (patch: Partial<typeof docs>) => onChange?.({ ...design, documentation: { ...docs, ...patch } });
  const updateProfile = (profileId: string) => onChange?.({ ...design, compliance: { profileId } });
  const update = <T extends { id: string }>(key: "views" | "sheets" | "annotations" | "schedules" | "revisions", id: string, patch: Partial<T>) => {
    updateDocs({ [key]: docs[key].map((item) => item.id === id ? { ...item, ...patch } : item) } as Partial<typeof docs>);
  };
  const remove = (key: "views" | "sheets" | "annotations" | "schedules" | "revisions", id: string) => updateDocs({
    [key]: docs[key].filter((item) => item.id !== id).map((item) => key === "sheets" ? { ...item, viewIds: (item as DocumentationSheet).viewIds.filter((viewId) => viewId !== id) } : item),
    ...(key === "views" ? { sheets: docs.sheets.map((sheet) => ({ ...sheet, viewIds: sheet.viewIds.filter((viewId) => viewId !== id) })) } : {}),
  } as Partial<typeof docs>);
  const add = (key: "views" | "sheets" | "annotations" | "schedules" | "revisions", value: DocumentationView | DocumentationSheet | DocumentationAnnotation | DocumentationSchedule | DocumentationRevision) => updateDocs({ [key]: [...docs[key], value] } as Partial<typeof docs>);
  const exportFile = async (format: "dxf" | "ifc") => {
    if (format === "dxf") {
      const { buildDxf } = await import("../lib/dxf");
      download(`${stem}.dxf`, buildDxf(design), "application/dxf");
    } else {
      if (!ifcReport.valid) {
        toast.push({ title: "IFC export blocked", description: "Resolve IFC validation errors before downloading the model.", tone: "error" });
        return;
      }
      download(`${stem}.ifc`, buildIfcStep(design), "application/x-step");
    }
    toast.push({ title: `${format.toUpperCase()} downloaded`, description: "Planning and coordination geometry is marked as approximate.", tone: "success" });
    setOpen(false);
  };
  const exportSheets = async () => {
    const { buildSheetPdf } = await import("../lib/sheets");
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
            <Input aria-label="Author" value={docs.author} placeholder="Author" onChange={(e) => updateDocs({ author: e.target.value })} />
            <Input aria-label="Issue date" type="date" value={docs.issueDate} onChange={(e) => updateDocs({ issueDate: e.target.value })} />
            <Input aria-label="Title block" value={docs.titleBlock} placeholder="Title-block name" onChange={(e) => updateDocs({ titleBlock: e.target.value })} />
            <Select aria-label="Issue status" value={docs.status} onChange={(e) => updateDocs({ status: e.target.value as typeof docs.status })}>
              <option value="draft">Draft</option><option value="review">For review</option><option value="issued">Issued</option>
            </Select>
          </div>
          <p className="mt-2 text-xs text-slate-500">Changes are saved with the design and are used by the PDF sheet set.</p>
        </div>
        <DocumentationEditor docs={docs} add={add} update={update} remove={remove} />
        <section className="mt-3 rounded-xl border border-slate-700 bg-slate-950/30 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="gw-kicker">Standards screening</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">Transparent planning checks only. Results are not a code determination or certification.</p>
            </div>
            <Select aria-label="Compliance profile" value={design.compliance?.profileId ?? COMPLIANCE_PROFILES[0].id} onChange={(e) => updateProfile(e.target.value)}>
              {COMPLIANCE_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </Select>
          </div>
          <p className="mt-2 text-xs text-slate-500">{compliance.profile.jurisdictionStyle} · {compliance.profile.edition}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {(["error", "warning", "review"] as const).map((severity) => {
              const count = compliance.issues.filter((item) => item.severity === severity).length;
              return <Badge key={severity} tone={severity === "error" ? "rose" : severity === "warning" ? "amber" : "cyan"}>{count} {severity}</Badge>;
            })}
          </div>
          <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
            {compliance.issues.map((item) => <div key={item.id} className="rounded-lg border border-slate-800 p-2">
              <div className="flex items-center gap-2"><Badge tone={item.severity === "error" ? "rose" : item.severity === "warning" ? "amber" : "cyan"}>{item.severity}</Badge><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.category}</span></div>
              <p className="mt-1 text-xs text-slate-300">{item.message}</p><p className="mt-1 text-[11px] text-slate-500">Basis: {item.basis}</p>
            </div>)}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-amber-300/80">{compliance.profile.disclaimer}</p>
        </section>
         <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="gw-kicker text-amber-300">Exchange summary</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">{projectName || "Untitled project"} exports a 2D drafting projection and a minimal IFC4 coordination model.</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Proxy geometry, section cuts, infrastructure forms, and BOQ quantities are approximate planning outputs. Confirm dimensions in authoring software.</p>
          <div className="mt-3 rounded-lg border border-slate-700/70 bg-slate-950/40 p-2 text-xs text-slate-400">
            <span className={dwgProvider?.available ? "text-emerald-300" : "text-amber-300"}>DWG: {dwgProvider?.available ? "licensed provider ready" : "unavailable"}</span>
            <span className="ml-2">{dwgProvider?.message || "Provider status is loading."}</span>
           </div>
           <div className="mt-3 rounded-lg border border-slate-700/70 bg-slate-950/40 p-2 text-xs">
             <div className="flex flex-wrap items-center gap-2"><Badge tone={ifcReport.valid ? "emerald" : "rose"}>{ifcReport.valid ? "IFC validation passed" : "IFC validation blocked"}</Badge><span className="text-slate-500">{ifcReport.parsedEntities} entities · {ifcReport.guidCount} GUIDs · round-trip {ifcReport.normalized ? "stable" : "changed"}</span></div>
             {ifcReport.issues.length > 0 && <div className="mt-2 max-h-28 space-y-1 overflow-y-auto text-slate-400">{ifcReport.issues.map((issue, index) => <p key={`${issue.code}-${issue.entityId ?? "model"}-${index}`}><span className={issue.severity === "error" ? "text-rose-300" : "text-amber-300"}>{issue.severity}</span> {issue.message}</p>)}</div>}
           </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button onClick={() => void exportFile("dxf")}>Download DXF</Button>
           <Button variant="secondary" disabled={!ifcReport.valid} title={ifcReport.valid ? "" : "Resolve IFC validation errors first"} onClick={() => void exportFile("ifc")}>Download IFC STEP</Button>
          <Button className="sm:col-span-2" variant="outline" disabled={!dwgProvider?.available} title={dwgProvider?.message || "Licensed DWG provider unavailable"}>Download DWG (licensed provider)</Button>
           <Button className="sm:col-span-2" onClick={() => void exportSheets()}>Download sheet set with screening report</Button>
        </div>
      </Modal>
    </>
  );
}

function DocumentationEditor({
  docs,
  add,
  update,
  remove,
}: {
  docs: ReturnType<typeof documentationFor>;
  add: (key: "views" | "sheets" | "annotations" | "schedules" | "revisions", value: DocumentationView | DocumentationSheet | DocumentationAnnotation | DocumentationSchedule | DocumentationRevision) => void;
  update: <T extends { id: string }>(key: "views" | "sheets" | "annotations" | "schedules" | "revisions", id: string, patch: Partial<T>) => void;
  remove: (key: "views" | "sheets" | "annotations" | "schedules" | "revisions", id: string) => void;
}) {
  const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const addView = () => add("views", { id: id(), name: "New view", kind: "plan", scale: "1:100", orientation: "north", visible: true });
  const addSheet = () => add("sheets", { id: id(), number: "A-000", name: "New sheet", viewIds: [] });
  const addAnnotation = () => add("annotations", { id: id(), text: "New annotation", tag: "NOTE" });
  const addSchedule = () => add("schedules", { id: id(), name: "New schedule", category: "objects", fields: ["Name", "Quantity"] });
  const addRevision = () => add("revisions", { id: id(), number: String(docs.revisions.length + 1), date: new Date().toISOString().slice(0, 10), description: "Revision description", author: docs.author });
  return (
    <div className="space-y-3">
      <DocSection title="Sheets" addLabel="Add sheet" onAdd={addSheet}>
        {docs.sheets.map((sheet) => <div key={sheet.id} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/30 p-2 sm:grid-cols-[.7fr_1fr_1fr_1fr_auto]">
          <Input aria-label="Sheet number" value={sheet.number} onChange={(e) => update<DocumentationSheet>("sheets", sheet.id, { number: e.target.value })} />
          <Input aria-label="Sheet name" value={sheet.name} onChange={(e) => update<DocumentationSheet>("sheets", sheet.id, { name: e.target.value })} />
          <Input aria-label="Sheet title block" value={sheet.titleBlock ?? ""} placeholder="Title block override" onChange={(e) => update<DocumentationSheet>("sheets", sheet.id, { titleBlock: e.target.value })} />
          <Select aria-label="Sheet views" value={sheet.viewIds[0] ?? ""} onChange={(e) => update<DocumentationSheet>("sheets", sheet.id, { viewIds: e.target.value ? [e.target.value] : [] })}><option value="">No view</option>{docs.views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</Select>
          <Button variant="danger" size="sm" onClick={() => remove("sheets", sheet.id)}>Delete</Button>
        </div>)}
      </DocSection>
      <DocSection title="Views, scales and orientation" addLabel="Add view" onAdd={addView}>
        {docs.views.map((view) => <div key={view.id} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/30 p-2 sm:grid-cols-[1fr_auto_auto_auto_auto_auto]">
          <Input aria-label="View name" value={view.name} onChange={(e) => update<DocumentationView>("views", view.id, { name: e.target.value })} />
          <Select aria-label="View kind" value={view.kind} onChange={(e) => update<DocumentationView>("views", view.id, { kind: e.target.value as DocumentationView["kind"] })}><option value="plan">Plan</option><option value="elevation">Elevation</option><option value="section">Section</option><option value="detail">Detail</option><option value="schedule">Schedule</option></Select>
          <Input aria-label="View scale" value={view.scale} onChange={(e) => update<DocumentationView>("views", view.id, { scale: e.target.value })} className="w-24" />
          <Select aria-label="View orientation" value={view.orientation} onChange={(e) => update<DocumentationView>("views", view.id, { orientation: e.target.value as DocumentationView["orientation"] })}><option value="north">North</option><option value="east">East</option><option value="south">South</option><option value="west">West</option><option value="custom">Custom</option></Select>
          <label className="flex items-center gap-1 px-2 text-xs text-slate-400"><input type="checkbox" checked={view.visible} onChange={(e) => update<DocumentationView>("views", view.id, { visible: e.target.checked })} /> Visible</label>
          <Button variant="danger" size="sm" onClick={() => remove("views", view.id)}>Delete</Button>
        </div>)}
      </DocSection>
      <DocSection title="Annotations and tags" addLabel="Add annotation" onAdd={addAnnotation}>
        {docs.annotations.map((annotation) => <div key={annotation.id} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/30 p-2 sm:grid-cols-[auto_1fr_auto]">
          <Input aria-label="Annotation tag" value={annotation.tag ?? ""} placeholder="TAG" onChange={(e) => update<DocumentationAnnotation>("annotations", annotation.id, { tag: e.target.value })} className="w-24" />
          <Input aria-label="Annotation text" value={annotation.text} onChange={(e) => update<DocumentationAnnotation>("annotations", annotation.id, { text: e.target.value })} />
          <Button variant="danger" size="sm" onClick={() => remove("annotations", annotation.id)}>Delete</Button>
        </div>)}
      </DocSection>
      <DocSection title="Schedules" addLabel="Add schedule" onAdd={addSchedule}>
        {docs.schedules.map((schedule) => <div key={schedule.id} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/30 p-2 sm:grid-cols-[1fr_auto_1fr_auto]">
          <Input aria-label="Schedule name" value={schedule.name} onChange={(e) => update<DocumentationSchedule>("schedules", schedule.id, { name: e.target.value })} />
          <Select aria-label="Schedule category" value={schedule.category} onChange={(e) => update<DocumentationSchedule>("schedules", schedule.id, { category: e.target.value as DocumentationSchedule["category"] })}><option value="objects">Objects</option><option value="rooms">Rooms</option><option value="furniture">Furniture</option><option value="levels">Levels</option><option value="mep">MEP</option></Select>
          <Input aria-label="Schedule fields" value={schedule.fields.join(", ")} onChange={(e) => update<DocumentationSchedule>("schedules", schedule.id, { fields: e.target.value.split(",").map((field) => field.trim()).filter(Boolean) })} />
          <Button variant="danger" size="sm" onClick={() => remove("schedules", schedule.id)}>Delete</Button>
        </div>)}
      </DocSection>
      <DocSection title="Revisions" addLabel="Add revision" onAdd={addRevision}>
        {docs.revisions.map((revision) => <div key={revision.id} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/30 p-2 sm:grid-cols-[auto_auto_1fr_auto_auto]">
          <Input aria-label="Revision number" value={revision.number} onChange={(e) => update<DocumentationRevision>("revisions", revision.id, { number: e.target.value })} className="w-16" />
          <Input aria-label="Revision date" type="date" value={revision.date} onChange={(e) => update<DocumentationRevision>("revisions", revision.id, { date: e.target.value })} />
          <Input aria-label="Revision description" value={revision.description} onChange={(e) => update<DocumentationRevision>("revisions", revision.id, { description: e.target.value })} />
          <Input aria-label="Revision author" value={revision.author} onChange={(e) => update<DocumentationRevision>("revisions", revision.id, { author: e.target.value })} />
          <Button variant="danger" size="sm" onClick={() => remove("revisions", revision.id)}>Delete</Button>
        </div>)}
      </DocSection>
    </div>
  );
}

function DocSection({ title, addLabel, onAdd, children }: { title: string; addLabel: string; onAdd: () => void; children: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-700 bg-slate-950/30 p-3"><div className="mb-2 flex items-center justify-between"><p className="gw-kicker">{title}</p><Button variant="outline" size="sm" onClick={onAdd}>{addLabel}</Button></div><div className="space-y-2">{children}</div></section>;
}
