import { useEffect, useId, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Input, Modal, Select } from "./ui";
import { useToast } from "./Toast";
import { download, downloadBlob } from "../lib/download";
import type { Design, DocumentationAnnotation, DocumentationRevision, DocumentationSchedule, DocumentationSheet, DocumentationView } from "../types";
import { documentationFor, documentationIssues } from "../lib/documentation";
import { buildDocumentationSchedule, documentationInventory, documentationScheduleCsv, SCHEDULE_FIELDS, scheduleCellText } from "../lib/documentationSchedule";
import { getCadExchangeStatus } from "../api";
import { dwgExportReadiness, observeCadExportReadiness, type CadExportReadiness } from "../lib/exportReadiness";
import { COMPLIANCE_PROFILES, validateDesign } from "../lib/compliance";
import { buildIfcStep, inspectGroundworkIfcSources, validateIfcProfile, validateIfcRoundTrip, type IfcValidationReport } from "../lib/bim";
import { buildBcfZip } from "../lib/bcf";
import { technicalGraphicsSettings } from "../lib/technicalGraphics";
import { engineeringExchangeProvenance } from "../lib/exchangeProvenance";
import { cadLevels, cadObjects } from "../lib/cadModel";

export function DesignExportMenu({ design, projectName, onChange }: { design: Design; projectName?: string; onChange?: (design: Design) => void }) {
  const { id: projectId } = useParams<{ id: string }>();
  const [open, setOpen] = useState(false);
  const [cadStatus, setCadStatus] = useState<CadExportReadiness>({ status: "loading" });
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  const docs = documentationFor(design);
  const compliance = validateDesign(design);
  const ifcBuild = useMemo(() => {
    if (!open) return { step: "", error: "" };
    try { return { step: buildIfcStep(design), error: "" }; }
    catch (error) { return { step: "", error: error instanceof Error ? error.message : "Could not generate the IFC exchange." }; }
  }, [open, design]);
  const ifcStep = ifcBuild.step;
  const ifcReport = useMemo<IfcValidationReport>(() => ifcBuild.error
    ? { valid: false, parsedEntities: 0, guidCount: 0, normalized: false, issues: [{ code: "ifc-generation", message: ifcBuild.error, severity: "error" }] }
    : open ? validateIfcRoundTrip(design, ifcStep) : { valid: false, parsedEntities: 0, guidCount: 0, normalized: false, issues: [] }, [open, design, ifcStep, ifcBuild.error]);
  const ifcProfile = useMemo(() => open ? validateIfcProfile(ifcStep, "reference-view") : { valid: false, requirements: [], issues: [] }, [open, ifcStep]);
  const [importSummary, setImportSummary] = useState("");
  const graphics = technicalGraphicsSettings(design.technicalGraphics);
  const toast = useToast();
  const stem = (projectName || "design").trim().replace(/[^\w-]+/g, "-").toLowerCase() || "design";
  useEffect(() => {
    if (!open) return;
    return observeCadExportReadiness(getCadExchangeStatus, setCadStatus);
  }, [open, capabilityAttempt]);
  const dwgReadiness = dwgExportReadiness(cadStatus);
  const updateDocs = (patch: Partial<typeof docs>) => onChange?.({ ...design, documentation: { ...docs, ...patch } });
  const updateProfile = (profileId: string) => onChange?.({ ...design, compliance: { profileId } });
  const update = <T extends { id: string }>(key: "views" | "sheets" | "annotations" | "schedules" | "revisions", id: string, patch: Partial<T>) => {
    updateDocs({ [key]: docs[key].map((item) => item.id === id ? { ...item, ...patch } : item) } as Partial<typeof docs>);
  };
  const remove = (key: "views" | "sheets" | "annotations" | "schedules" | "revisions", id: string) => updateDocs({
    [key]: docs[key].filter(item => item.id !== id),
    ...(key === "views" ? { sheets: docs.sheets.map(sheet => ({ ...sheet, viewIds: sheet.viewIds.filter(viewId => viewId !== id) })) } : {}),
    ...(key === "schedules" ? { sheets: docs.sheets.map(sheet => ({ ...sheet, scheduleIds: sheet.scheduleIds?.filter(scheduleId => scheduleId !== id) })) } : {}),
    ...(key === "revisions" ? { sheets: docs.sheets.map(sheet => ({ ...sheet, revisionIds: sheet.revisionIds?.filter(revisionId => revisionId !== id) })) } : {}),
  } as Partial<typeof docs>);
  const add = (key: "views" | "sheets" | "annotations" | "schedules" | "revisions", value: DocumentationView | DocumentationSheet | DocumentationAnnotation | DocumentationSchedule | DocumentationRevision) => updateDocs({ [key]: [...docs[key], value] } as Partial<typeof docs>);
  const exportFile = async (format: "dxf" | "ifc") => {
    try {
    if (format === "dxf") {
      const { buildDxf } = await import("../lib/dxf");
      download(`${stem}.dxf`, buildDxf(design), "application/dxf");
    } else {
      if (!ifcReport.valid) {
        toast.push({ title: "IFC export blocked", description: "Resolve IFC validation errors before downloading the model.", tone: "error" });
        return;
      }
      download(`${stem}.ifc`, ifcStep, "application/x-step");
    }
    toast.push({ title: `${format.toUpperCase()} downloaded`, description: "Planning and coordination geometry is marked as approximate.", tone: "success" });
    setOpen(false);
    } catch (error) {
      toast.push({ title: `${format.toUpperCase()} export failed`, description: error instanceof Error ? error.message : "Could not export this design.", tone: "error" });
    }
  };
  const exportSheets = async () => {
    try {
    const { buildSheetPdf } = await import("../lib/sheets");
    const blob = new Blob([buildSheetPdf(projectName || "Untitled project", design)], { type: "application/pdf" });
    downloadBlob(`${stem}-review-sheets.pdf`, blob);
    toast.push({ title: "Review PDF downloaded", description: "CAD plan/elevation/section pages declare scale or NTS; print at 100% and check the scale bar. Not for construction.", tone: "success" });
    setOpen(false);
    } catch (error) {
      toast.push({ title: "PDF export failed", description: error instanceof Error ? error.message : "Could not export the selected sheets.", tone: "error" });
    }
  };
  const exportBcf = async () => {
    const blob = await buildBcfZip(design, projectName || "Untitled project");
    downloadBlob(`${stem}.bcfzip`, blob);
    toast.push({ title: "BCF coordination package downloaded", description: "Saved review markers and viewpoints were exported for coordination exchange.", tone: "success" });
    setOpen(false);
  };
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label="Open documentation and export options">Docs / exports</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Documentation and exchange exports" wide>
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <p className="font-semibold">Review outputs · each drawing declares its scale · not for construction</p>
          <p className="mt-1">Authored CAD top/elevation projections and explicitly defined vertical section cuts use physical 1:n scale, or explicit NTS. Oversized scaled drawings are blocked instead of shrunk. Paper is US Letter landscape (279.4 × 215.9 mm); print at 100% and check the scale bar. Elevations show projected edges without hidden-line removal; sections show intersected solids at the declared plane. Legacy room/site illustrations remain schematic and not to scale; generated site, furniture and MEP geometry are outside the CAD drawing scope. Verify exchange dimensions and fidelity in your authoring tools.</p>
        </div>
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
        {open && <DocumentationEditor design={design} docs={docs} stem={stem} add={add} update={update} remove={remove} />}
        <section className="mt-3 rounded-xl border border-slate-700 bg-slate-950/30 p-3">
          <p className="gw-kicker">Technical graphics</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Select aria-label="Display mode" value={graphics.displayMode} onChange={(e) => onChange?.({ ...design, technicalGraphics: { ...graphics, displayMode: e.target.value as typeof graphics.displayMode } })}>
              <option value="shaded">Shaded</option><option value="shaded-edges">Shaded + edges</option><option value="hidden-line">Hidden line</option><option value="wireframe">Wireframe</option>
            </Select>
            <Input aria-label="Dimension precision" type="number" min="0" max="6" value={graphics.dimensionStyle.precision} onChange={(e) => onChange?.({ ...design, technicalGraphics: { ...graphics, dimensionStyle: { ...graphics.dimensionStyle, precision: Math.min(6, Math.max(0, Number(e.target.value) || 0)) } } })} />
            <Select aria-label="Dimension units" value={graphics.dimensionStyle.units} onChange={(e) => onChange?.({ ...design, technicalGraphics: { ...graphics, dimensionStyle: { ...graphics.dimensionStyle, units: e.target.value as typeof graphics.dimensionStyle.units } } })}>
              <option value="m">Metres</option><option value="mm">Millimetres</option><option value="ft-in">Feet / inches</option>
            </Select>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">DXF layer lineweights and dimension labels use these project settings.</p>
        </section>
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
            <p role={cadStatus.status === "error" ? "alert" : "status"} className={dwgReadiness.available ? "text-cyan-300" : "text-amber-300"}>{dwgReadiness.label}</p>
            <p className="mt-1">{dwgReadiness.message}</p>
            {cadStatus.status === "error" && <Button className="mt-2" size="sm" variant="outline" onClick={() => setCapabilityAttempt(value => value + 1)}>Retry DWG availability</Button>}
            {dwgReadiness.available && <p className="mt-1">Configuration permits queuing; this check does not verify a completed conversion or downstream drawing fidelity.</p>}
           </div>
           <div className="mt-3 rounded-lg border border-slate-700/70 bg-slate-950/40 p-2 text-xs">
             <div className="flex flex-wrap items-center gap-2"><Badge tone={ifcReport.valid ? "cyan" : "rose"}>{ifcReport.valid ? "Internal IFC checks passed" : "Internal IFC checks blocked"}</Badge><Badge tone={ifcProfile.valid ? "cyan" : "amber"}>{ifcProfile.valid ? "Internal reference preflight passed" : "Internal reference preflight needs work"}</Badge><span className="text-slate-500">{ifcReport.parsedEntities} entities · {ifcReport.guidCount} GUIDs · internal round-trip {ifcReport.normalized ? "stable" : "changed"}</span></div>
             <p className="mt-2 text-slate-400">These are Groundwork's internal checks. Third-party interoperability, complete geometry coverage and construction suitability have not been established by this preflight.</p>
             {ifcReport.issues.length > 0 && <div className="mt-2 max-h-28 space-y-1 overflow-y-auto text-slate-400">{ifcReport.issues.map((issue, index) => <p key={`${issue.code}-${issue.entityId ?? "model"}-${index}`}><span className={issue.severity === "error" ? "text-rose-300" : "text-amber-300"}>{issue.severity}</span> {issue.message}</p>)}</div>}
           </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button onClick={() => void exportFile("dxf")}>Download DXF</Button>
          <Button variant="secondary" onClick={() => download(`${stem}-engineering-declaration.json`, JSON.stringify(engineeringExchangeProvenance(design.engineeringBasis), null, 2), "application/json")}>Engineering declaration JSON</Button>
           <Button variant="secondary" disabled={!ifcReport.valid} title={ifcReport.valid ? "" : "Resolve IFC validation errors first"} onClick={() => void exportFile("ifc")}>Download IFC STEP</Button>
          <Link className="rounded-xl border border-slate-700 p-3 text-center text-sm sm:col-span-2" to={`/exchange${projectId ? `?project=${encodeURIComponent(projectId)}` : ""}`} onClick={() => setOpen(false)}>View DWG availability and jobs</Link>
          <p className="text-xs text-slate-400 sm:col-span-2">Download the current DXF, then submit it in the exchange workbench. LibreDWG conversion preserves the captured source; review the drawing for unsupported entities.</p>
          <Button variant="secondary" onClick={() => void exportBcf()}>Download BCF coordination package</Button>
          <Button variant="outline" onClick={() => download(`${stem}-ifc-validation.json`, JSON.stringify({ scope: "Groundwork internal IFC preflight", thirdPartyInteroperability: "not-verified", constructionSuitability: "not-assessed", roundTrip: ifcReport, profile: ifcProfile }, null, 2), "application/json")}>Download internal IFC check report</Button>
          <p className="text-xs text-slate-500">{ifcReport.sourceRoundTrip?.scope} {ifcReport.sourceRoundTrip?.checkedEntities ?? 0} source entities checked.</p>
          <label className="block text-xs text-slate-400">Inspect a Groundwork IFC metadata export
            <input className="mt-1 block text-xs" type="file" accept=".ifc,.step,.stp" onChange={e => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 10000000) { setImportSummary("Inspect files up to 10 MB."); return; }
              void file.text().then(text => {
                const recovered = inspectGroundworkIfcSources(text);
                setImportSummary(`${recovered.entities.length} Groundwork source records recovered; ${recovered.issues.length} metadata errors. Geometry is not imported.`);
                download(`${stem}-inspected-ifc-sources.json`, JSON.stringify(recovered, null, 2), "application/json");
              }).catch(error => setImportSummary(error instanceof Error ? error.message : "Could not read IFC."));
              e.target.value = "";
            }} />
          </label>
          {importSummary && <p className="text-xs text-slate-400">{importSummary}</p>}
           <Button className="sm:col-span-2" onClick={() => void exportSheets()}>Download review PDF</Button>
        </div>
      </Modal>
    </>
  );
}

function DocumentationEditor({
  design,
  docs,
  stem,
  add,
  update,
  remove,
}: {
  design: Design;
  docs: ReturnType<typeof documentationFor>;
  stem: string;
  add: (key: "views" | "sheets" | "annotations" | "schedules" | "revisions", value: DocumentationView | DocumentationSheet | DocumentationAnnotation | DocumentationSchedule | DocumentationRevision) => void;
  update: <T extends { id: string }>(key: "views" | "sheets" | "annotations" | "schedules" | "revisions", id: string, patch: Partial<T>) => void;
  remove: (key: "views" | "sheets" | "annotations" | "schedules" | "revisions", id: string) => void;
}) {
  const inventory = useMemo(() => documentationInventory(design), [design]);
  const warnings = useMemo(() => documentationIssues(design), [design]);
  const hasCad = cadObjects(design).length > 0;
  const bindings = (values: string[], target: string, selected: boolean) => selected ? [...new Set([...values, target])] : values.filter(value => value !== target);
  const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const addView = () => add("views", { id: id(), name: "New view", kind: "plan", scale: hasCad ? "1:100" : "NTS", orientation: "north", visible: true });
  const addSheet = () => add("sheets", { id: id(), number: "A-000", name: "New sheet", viewIds: [] });
  const addAnnotation = () => add("annotations", { id: id(), text: "New annotation", tag: "NOTE" });
  const addSchedule = () => add("schedules", { id: id(), name: "New schedule", category: "objects", fields: ["Category", "Name", "Quantity"], filters: [], sortDirection: "asc" });
  const addRevision = () => add("revisions", { id: id(), number: String(docs.revisions.length + 1), date: new Date().toISOString().slice(0, 10), description: "Revision description", author: docs.author });
  return (
    <div className="space-y-3">
      {warnings.length > 0 && <div className="max-h-32 overflow-auto rounded-lg border border-amber-500/30 p-2 text-xs text-amber-200">{warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
      <p className="text-xs text-slate-400">Schedules refresh from saved model occurrences. Authored CAD plan/elevation views and defined vertical section cuts support physical scales such as 1:100; NTS fits geometry and is marked unscaled. Other illustrations retain scale/orientation as read-only metadata. Define a section plane explicitly before a CAD section can be drawn. Directions follow local model axes; they do not establish survey north.</p>
      <DocSection title="Sheets" addLabel="Add sheet" onAdd={addSheet}>
        {docs.sheets.map((sheet) => <div key={sheet.id} className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/30 p-2"><div className="grid gap-2 sm:grid-cols-[.7fr_1fr_1fr_auto]">
          <Input aria-label="Sheet number" value={sheet.number} onChange={(e) => update<DocumentationSheet>("sheets", sheet.id, { number: e.target.value })} />
          <Input aria-label="Sheet name" value={sheet.name} onChange={(e) => update<DocumentationSheet>("sheets", sheet.id, { name: e.target.value })} />
          <Input aria-label="Sheet title block" value={sheet.titleBlock ?? ""} placeholder="Title block override" onChange={(e) => update<DocumentationSheet>("sheets", sheet.id, { titleBlock: e.target.value })} />
          <Button variant="danger" size="sm" onClick={() => remove("sheets", sheet.id)}>Delete</Button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-400"><span>Views:</span>{docs.views.map(view => <label key={view.id} className="flex items-center gap-1"><input type="checkbox" checked={sheet.viewIds.includes(view.id)} onChange={event => update<DocumentationSheet>("sheets", sheet.id, { viewIds: bindings(sheet.viewIds, view.id, event.target.checked) })} />{view.name}</label>)}</div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-400"><span>Schedules:</span><label className="flex items-center gap-1"><input type="checkbox" checked={sheet.scheduleIds === undefined} onChange={event => update<DocumentationSheet>("sheets", sheet.id, { scheduleIds: event.target.checked ? undefined : [] })} />Default on schedule sheets</label>{sheet.scheduleIds !== undefined && docs.schedules.map(schedule => <label key={schedule.id} className="flex items-center gap-1"><input type="checkbox" checked={sheet.scheduleIds!.includes(schedule.id)} onChange={event => update<DocumentationSheet>("sheets", sheet.id, { scheduleIds: bindings(sheet.scheduleIds ?? [], schedule.id, event.target.checked) })} />{schedule.name}</label>)}</div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-400"><span>Revisions:</span><label className="flex items-center gap-1"><input type="checkbox" checked={sheet.revisionIds === undefined} onChange={event => update<DocumentationSheet>("sheets", sheet.id, { revisionIds: event.target.checked ? undefined : [] })} />All project revisions</label>{sheet.revisionIds !== undefined && docs.revisions.map(revision => <label key={revision.id} className="flex items-center gap-1"><input type="checkbox" checked={sheet.revisionIds!.includes(revision.id)} onChange={event => update<DocumentationSheet>("sheets", sheet.id, { revisionIds: bindings(sheet.revisionIds ?? [], revision.id, event.target.checked) })} />{revision.number}</label>)}</div>
        </div>)}
      </DocSection>
      <DocSection title="Drawing views and recorded metadata" addLabel="Add view" onAdd={addView}>
        {docs.views.map((view) => <div key={view.id} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/30 p-2 sm:grid-cols-2">
          <Input aria-label="View name" value={view.name} onChange={(e) => update<DocumentationView>("views", view.id, { name: e.target.value })} />
          <Select aria-label="View kind" value={view.kind} onChange={(e) => {
            const kind = e.target.value as DocumentationView["kind"];
            const compatible = view.section?.axis === "x" ? view.orientation === "east" || view.orientation === "west" : view.orientation === "north" || view.orientation === "south";
            update<DocumentationView>("views", view.id, { kind, ...(kind === "section" && view.section && !compatible ? { orientation: view.section.axis === "x" ? "east" : "north" } : {}) });
          }}><option value="plan">Plan</option><option value="elevation">Elevation</option><option value="section">Section</option><option value="detail">Detail</option><option value="schedule">Schedule</option></Select>
          {hasCad && (view.kind === "plan" || view.kind === "elevation" || view.kind === "section" && view.section) ? <>
            <Input label="Drawing scale (1:n or NTS)" value={view.scale} onChange={e => update<DocumentationView>("views", view.id, { scale: e.target.value })} />
            <Select label={view.kind === "section" ? "Section look direction" : "Drawing orientation"} value={view.orientation} onChange={e => update<DocumentationView>("views", view.id, { orientation: e.target.value as DocumentationView["orientation"] })}>{(view.kind !== "section" || view.section?.axis === "z") && <><option value="north">North</option><option value="south">South</option></>}{(view.kind !== "section" || view.section?.axis === "x") && <><option value="east">East</option><option value="west">West</option></>}{view.orientation === "custom" && <option value="custom" disabled>Custom (unsupported)</option>}</Select>
          </> : <><Input label="Recorded scale (metadata only)" value={view.scale} readOnly /><Input label="Recorded orientation (metadata only)" value={view.orientation} readOnly /></>}
          <label className="flex items-center gap-1 px-2 text-xs text-slate-400"><input type="checkbox" checked={view.visible} onChange={(e) => update<DocumentationView>("views", view.id, { visible: e.target.checked })} /> Visible</label>
          <Button variant="danger" size="sm" onClick={() => remove("views", view.id)}>Delete</Button>
          {hasCad && (view.kind === "plan" || view.kind === "elevation" || view.kind === "section") && <div className="space-y-1 sm:col-span-2"><Select label="Drawing level scope" value={view.levelId ?? ""} onChange={event => update<DocumentationView>("views", view.id, { levelId: event.target.value || undefined })}><option value="">All authored CAD objects</option>{view.levelId && !cadLevels(design).some(level => level.id === view.levelId) && <option value={view.levelId}>Missing level ({view.levelId})</option>}{cadLevels(design).map(level => <option key={level.id} value={level.id}>{level.name}</option>)}</Select><p className="text-xs text-slate-400">A selected level includes only objects explicitly hosted on it. Other levels and unhosted objects are omitted and counted in the PDF coverage notes.</p></div>}
          {hasCad && view.kind === "section" && <div className="sm:col-span-2"><SectionPlaneEditor view={view} update={patch => update<DocumentationView>("views", view.id, patch)} /></div>}
        </div>)}
      </DocSection>
      <DocSection title="Annotations and tags" addLabel="Add annotation" onAdd={addAnnotation}>
        <datalist id="documentation-targets">{inventory.slice(0, 200).map(record => <option key={`${record.scope}:${record.id}`} value={record.id}>{String(record.values.name)} / {record.scope}</option>)}</datalist>
        {docs.annotations.map((annotation) => <div key={annotation.id} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/30 p-2 sm:grid-cols-[auto_1fr_auto]">
          <Input aria-label="Annotation tag" value={annotation.tag ?? ""} placeholder="TAG" onChange={(e) => update<DocumentationAnnotation>("annotations", annotation.id, { tag: e.target.value })} className="w-24" />
          <Input aria-label="Annotation text" value={annotation.text} onChange={(e) => update<DocumentationAnnotation>("annotations", annotation.id, { text: e.target.value })} />
          <Button variant="danger" size="sm" onClick={() => remove("annotations", annotation.id)}>Delete</Button>
          <Select aria-label="Annotation view" value={annotation.viewId ?? ""} onChange={event => update<DocumentationAnnotation>("annotations", annotation.id, { viewId: event.target.value || undefined })}><option value="">All views</option>{docs.views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}</Select>
          <Input aria-label="Annotation model target" list="documentation-targets" placeholder="Optional model target ID" value={annotation.targetId ?? ""} onChange={event => update<DocumentationAnnotation>("annotations", annotation.id, { targetId: event.target.value || undefined })} />
        </div>)}
      </DocSection>
      <DocSection title="Schedules" addLabel="Add schedule" onAdd={addSchedule}>
        <p className="text-[11px] text-slate-500">Fields: {SCHEDULE_FIELDS.join(", ")}. Family values also accept TypeParameter:key and InstanceParameter:key. Quantities, lengths, areas, volumes and rated power sum when grouping; other differing values show “varies”.</p>
        {docs.schedules.map(schedule => <LiveScheduleEditor key={schedule.id} design={design} schedule={schedule} inventory={inventory} stem={stem} update={patch => update<DocumentationSchedule>("schedules", schedule.id, patch)} remove={() => remove("schedules", schedule.id)} />)}
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

function SectionPlaneEditor({ view, update }: { view: DocumentationView; update: (patch: Partial<DocumentationView>) => void }) {
  const [offset, setOffset] = useState(String(view.section?.offsetM ?? 0));
  const [error, setError] = useState("");
  const id = useId();
  useEffect(() => { setOffset(String(view.section?.offsetM ?? 0)); setError(""); }, [view.section?.offsetM]);
  if (!view.section) return <div className="space-y-2 border-t border-slate-700 pt-2 text-xs text-slate-400"><p>No cut plane is defined. The PDF will show a section-unavailable notice until you explicitly define one.</p><Button size="sm" variant="secondary" onClick={() => update({ section: { axis: "z", offsetM: 0 }, orientation: "north" })}>Define vertical section plane</Button></div>;
  const commit = () => {
    const value = Number(offset);
    if (!offset.trim() || !Number.isFinite(value) || Math.abs(value) > 1_000_000) { setError("Enter a finite model coordinate between -1000000 and 1000000 metres."); return; }
    update({ section: { axis: view.section!.axis, offsetM: value } }); setError("");
  };
  return <div className="space-y-2 border-t border-slate-700 pt-2"><div className="grid gap-2 sm:grid-cols-2">
    <Select label="Section plane axis" value={view.section.axis} onChange={event => {
      const axis = event.target.value as "x" | "z";
      const compatible = axis === "x" ? view.orientation === "east" || view.orientation === "west" : view.orientation === "north" || view.orientation === "south";
      update({ section: { ...view.section!, axis }, orientation: compatible ? view.orientation : axis === "x" ? "east" : "north" });
    }}><option value="z">Constant Z plane</option><option value="x">Constant X plane</option></Select>
    <Input label="Section plane coordinate (m)" type="number" step="any" value={offset} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={event => { setOffset(event.target.value); setError(""); }} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") { event.preventDefault(); setOffset(String(view.section!.offsetM)); setError(""); } }} />
    <Button variant="outline" size="sm" onClick={() => update({ section: undefined })}>Remove cut plane</Button>
  </div><p className="text-xs text-slate-400">The cut intersects supported authored CAD solids at {view.section.axis.toUpperCase()} = {view.section.offsetM} m in local model coordinates. It does not display geometry beyond the plane. Top/elevation wireframes, generated site forms and MEP are separate scopes.</p>{error && <p id={`${id}-error`} role="alert" className="text-xs text-rose-300">{error}</p>}</div>;
}

function LiveScheduleEditor({ design, schedule, inventory, stem, update, remove }: {
  design: Design;
  schedule: DocumentationSchedule;
  inventory: ReturnType<typeof documentationInventory>;
  stem: string;
  update: (patch: Partial<DocumentationSchedule>) => void;
  remove: () => void;
}) {
  const [fieldText, setFieldText] = useState(schedule.fields.join(", "));
  useEffect(() => setFieldText(schedule.fields.join(", ")), [schedule.fields]);
  const result = useMemo(() => buildDocumentationSchedule(design, schedule, inventory), [design, schedule, inventory]);
  const filters = schedule.filters ?? [];
  const filterPatch = (index: number, patch: Partial<NonNullable<DocumentationSchedule["filters"]>[number]>) => update({ filters: filters.map((filter, position) => position === index ? { ...filter, ...patch } : filter) });
  const fileName = `${stem}-${schedule.name.replace(/[^\w-]+/g, "-").toLowerCase() || "schedule"}`;
  return <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/30 p-2">
    <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
      <Input aria-label="Schedule name" value={schedule.name} onChange={event => update({ name: event.target.value })} />
      <Select aria-label="Schedule category" value={schedule.category} onChange={event => update({ category: event.target.value as DocumentationSchedule["category"] })}><option value="objects">All objects</option><option value="rooms">Rooms</option><option value="furniture">Furniture</option><option value="levels">Levels</option><option value="mep">MEP</option></Select>
      <Input aria-label="Schedule fields" value={fieldText} placeholder="Name, Quantity" onChange={event => setFieldText(event.target.value)} onBlur={() => update({ fields: fieldText.split(",").map(field => field.trim()).filter(Boolean) })} />
      <Button variant="danger" size="sm" onClick={remove}>Delete</Button>
    </div>
    <div className="grid gap-2 sm:grid-cols-3">
      <Input label="Sort field" value={schedule.sortField ?? ""} placeholder="Name" onChange={event => update({ sortField: event.target.value || undefined })} />
      <Select label="Sort direction" value={schedule.sortDirection ?? "asc"} onChange={event => update({ sortDirection: event.target.value as "asc" | "desc" })}><option value="asc">Ascending</option><option value="desc">Descending</option></Select>
      <Input label="Group by field" value={schedule.groupBy ?? ""} placeholder="No grouping" onChange={event => update({ groupBy: event.target.value || undefined })} />
    </div>
    {filters.map((filter, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
      <Input aria-label={`Filter ${index + 1} field`} value={filter.field} placeholder="Category" onChange={event => filterPatch(index, { field: event.target.value })} />
      <Select aria-label={`Filter ${index + 1} operator`} value={filter.operator} onChange={event => filterPatch(index, { operator: event.target.value as NonNullable<DocumentationSchedule["filters"]>[number]["operator"] })}><option value="contains">Contains</option><option value="equals">Equals</option><option value="greater-than">Greater than</option><option value="less-than">Less than</option></Select>
      <Input aria-label={`Filter ${index + 1} value`} value={filter.value} onChange={event => filterPatch(index, { value: event.target.value })} />
      <Button size="sm" variant="danger" onClick={() => update({ filters: filters.filter((_, position) => position !== index) })}>Remove</Button>
    </div>)}
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => update({ filters: [...filters, { field: "Name", operator: "contains", value: "" }] })}>Add filter</Button>
      <Button size="sm" variant="secondary" disabled={!result.fields.length} onClick={() => download(`${fileName}.csv`, documentationScheduleCsv(result), "text/csv;charset=utf-8")}>Download CSV</Button>
      <Button size="sm" variant="outline" onClick={() => download(`${fileName}.json`, JSON.stringify({ schedule, result }, null, 2), "application/json")}>Download JSON</Button>
      <span className="text-xs text-slate-500">{result.sourceCount} source records / {result.rows.length} rows</span>
    </div>
    {result.warnings.map(warning => <p key={warning} className="text-xs text-amber-300">{warning}</p>)}
    <div className="max-h-52 overflow-auto"><table className="w-full text-left text-xs"><thead><tr>{result.fields.map((field, index) => <th key={`${field}:${index}`} className="whitespace-nowrap p-1 text-slate-400">{field}</th>)}</tr></thead><tbody>{result.rows.slice(0, 12).map(row => <tr key={row.id}>{row.cells.map((cell, index) => <td key={index} className="max-w-48 truncate border-t border-slate-800 p-1 text-slate-300" title={scheduleCellText(cell)}>{scheduleCellText(cell) || "—"}</td>)}</tr>)}</tbody></table></div>
    {result.rows.length > 12 && <p className="text-[11px] text-slate-500">First 12 rows shown. CSV and JSON include all rows.</p>}
  </div>;
}

function DocSection({ title, addLabel, onAdd, children }: { title: string; addLabel: string; onAdd: () => void; children: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-700 bg-slate-950/30 p-3"><div className="mb-2 flex items-center justify-between"><p className="gw-kicker">{title}</p><Button variant="outline" size="sm" onClick={onAdd}>{addLabel}</Button></div><div className="space-y-2">{children}</div></section>;
}
