import type { Design, InfraDesign, CommunityDesign, DocumentationMetadata, DocumentationSheet, DocumentationView } from "../types";
import { computeTakeoff, type TakeoffItem } from "./takeoff";
import { computeInfraTakeoff, INFRA_LABELS, type InfraTakeoffItem } from "./infra";
import { landMeters, towerMeters } from "./community";
import { documentationFor, documentationIssues } from "./documentation";
import { buildDocumentationSchedule, documentationInventory, scheduleCellText, type ScheduleResult } from "./documentationSchedule";
import { validateDesign } from "./compliance";

type PdfPage = string[];
const MAX_PAGES = 500;
const MAX_COMMANDS = 10_000;
const MAX_COMMAND_BYTES = 8 * 1024 * 1024;
const pageBudgets = new WeakMap<PdfPage, { bytes: number }>();
function command(page: PdfPage, value: string) {
  const budget = pageBudgets.get(page);
  if (!budget || page.length >= MAX_COMMANDS || value.length > 20_000 || budget.bytes + value.length + 1 > MAX_COMMAND_BYTES) throw new Error("The PDF exceeds the supported export size. Select fewer views, schedule fields or model rows.");
  budget.bytes += value.length + 1;
  page.push(value);
}
const diagramCount = (value: number, maximum: number) => Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.floor(value))) : 0;
const W = 792;
const H = 612;
const margin = 28;
const safe = (value: unknown) => String(value ?? "").replace(/[^\x20-\x7e]/g, "?");
const esc = (value: string) => safe(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const num = (value: number) => {
  if (!Number.isFinite(value) || Math.abs(value) > 1e8) throw new Error("A PDF diagram coordinate is outside the supported numeric range.");
  return value.toFixed(2).replace(/\.00$/, "");
};

function text(page: PdfPage, value: string, x: number, y: number, size = 9, bold = false) {
  command(page, `BT /F${bold ? 2 : 1} ${size} Tf ${num(x)} ${num(y)} Td (${esc(value)}) Tj ET`);
}
function line(page: PdfPage, x1: number, y1: number, x2: number, y2: number, gray = 0.35) {
  command(page, `${gray} G ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
}
function box(page: PdfPage, x: number, y: number, w: number, h: number, gray = 0.35) {
  command(page, `${gray} G ${num(x)} ${num(y)} ${num(w)} ${num(h)} re S`);
}
function fill(page: PdfPage, x: number, y: number, w: number, h: number, gray = 0.96) {
  command(page, `${gray} g ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f 0 G`);
}
function titleBlock(page: PdfPage, projectName: string, definition: DocumentationSheet, docs: DocumentationMetadata, continuation: number, view?: DocumentationView) {
  box(page, margin, margin, W - margin * 2, H - margin * 2, 0.15);
  line(page, margin, 58, W - margin, 58, 0.15);
  text(page, definition.titleBlock || docs.titleBlock || "GROUNDWORK DESIGN STUDIO", margin + 8, 42, 8, true);
  text(page, safe(projectName).toUpperCase(), 250, 42, 8, true);
  text(page, `${definition.number}${continuation > 1 ? ` / ${continuation}` : ""} | ${definition.name}`.slice(0, 40), W - 205, 42, 8, true);
  text(page, `${docs.projectNumber} | ${docs.client || "UNASSIGNED CLIENT"} | ${docs.issueDate} | ${view ? `${view.orientation.toUpperCase()} (schematic)` : ""}`.slice(0, 100), margin + 8, 67, 7, true);
  text(page, docs.status.toUpperCase(), W - 115, 67, 7, true);
}
function heading(page: PdfPage, value: string) {
  text(page, value.toUpperCase(), margin + 18, H - 72, 15, true);
  line(page, margin + 18, H - 82, W - margin - 18, H - 82, 0.15);
}
function rows(page: PdfPage, items: { label: string; value: string; basis?: string }[], x: number, y: number, width: number) {
  fill(page, x, y - 14, width, 17, 0.92);
  text(page, "ITEM", x + 5, y - 9, 7, true);
  text(page, "QTY / VALUE", x + width - 145, y - 9, 7, true);
  items.forEach((item, index) => {
    const rowY = y - 31 - index * 16;
    line(page, x, rowY - 5, x + width, rowY - 5, 0.82);
    text(page, item.label.slice(0, 48), x + 5, rowY, 7);
    text(page, item.value.slice(0, 20), x + width - 145, rowY, 7);
    if (item.basis) text(page, item.basis.slice(0, 58), x + width - 285, rowY, 6);
  });
}

function scheduleTable(page: PdfPage, result: ScheduleResult, fieldStart: number, rowStart: number) {
  const fields = result.fields.slice(fieldStart, fieldStart + 6);
  const width = 650 / Math.max(fields.length, 1);
  fill(page, 70, 437, 650, 22, 0.92);
  fields.forEach((field, index) => text(page, field.slice(0, Math.floor(width / 4)), 75 + index * width, 445, 7, true));
  result.rows.slice(rowStart, rowStart + 19).forEach((row, index) => {
    const y = 420 - index * 16;
    line(page, 70, y - 5, 720, y - 5, 0.82);
    fields.forEach((_, fieldIndex) => text(page, scheduleCellText(row.cells[fieldStart + fieldIndex]).slice(0, Math.floor(width / 4)), 75 + fieldIndex * width, y, 7));
  });
  text(page, `${result.sourceCount} source records | ${result.rows.length} output rows | rows ${result.rows.length ? rowStart + 1 : 0}-${Math.min(rowStart + 19, result.rows.length)} | columns ${fieldStart + 1}-${Math.min(fieldStart + 6, result.fields.length)}`, 70, 102, 7);
  text(page, "Cells are shortened to fit the page. CSV retains complete field values and all rows.", 70, 91, 7);
}
function communityPages(page: PdfPage, design: CommunityDesign, sheet: string) {
  if (sheet === "plan") {
    const land = landMeters(design.land);
    const scale = Math.min(470 / Math.max(land.w, 1), 330 / Math.max(land.d, 1));
    const ox = 90;
    const oy = 145;
    box(page, ox, oy, land.w * scale, land.d * scale, 0.25);
    text(page, `SITE PLAN  ${land.w.toFixed(1)} x ${land.d.toFixed(1)} m`, ox, oy + land.d * scale + 18, 9, true);
    design.towers.forEach((tower, index) => {
      const size = towerMeters(tower);
      const x = ox + (tower.x + land.w / 2 - size.w / 2) * scale;
      const y = oy + (tower.z + land.d / 2 - size.d / 2) * scale;
      fill(page, x, y, size.w * scale, size.d * scale, 0.82);
      box(page, x, y, size.w * scale, size.d * scale, 0.3);
      text(page, `T${index + 1}`, x + 4, y + size.d * scale / 2, 7, true);
    });
    design.amenities.forEach((amenity) => {
      const x = ox + (amenity.x + land.w / 2) * scale;
      const y = oy + (amenity.z + land.d / 2) * scale;
      box(page, x, y, Math.max(amenity.w * scale, 5), Math.max(amenity.d * scale, 5), 0.45);
      text(page, amenity.label || amenity.kind, x + 3, y + 3, 6);
    });
    text(page, "N", 575, 450, 12, true); line(page, 580, 430, 580, 455, 0.2);
    text(page, `${design.towers.length} tower(s) | ${design.amenities.length} amenity object(s)`, 90, 115, 8);
    text(page, "Graphic plan generated from stored parametric objects. Verify survey, setbacks and orientation.", 90, 95, 7);
  } else if (sheet === "elevation") {
    text(page, "NORTH / PRIMARY ELEVATION - SCHEMATIC", 90, 465, 9, true);
    design.towers.forEach((tower, index) => {
      const x = 90 + index * 155;
      const width = Math.max(48, tower.unitWidth * tower.unitsPerFloor * 0.45);
      const height = Math.max(70, tower.floors * tower.floorHeight * 0.45);
      box(page, x, 105, Math.min(width, 125), Math.min(height, 330), 0.25);
      for (let floor = 1; floor < diagramCount(tower.floors, 300); floor += 1) line(page, x, 105 + floor * Math.min(height, 330) / tower.floors, x + Math.min(width, 125), 105 + floor * Math.min(height, 330) / tower.floors, 0.65);
      text(page, tower.label || `Tower ${index + 1}`, x, 88, 8, true);
      text(page, `${tower.floors} floors | ${tower.facadeMaterial}`, x, 76, 7);
    });
    text(page, "Facade details are schematic; floor lines are capped at 300 per tower.", 90, 95, 7);
  } else {
    text(page, "TYPICAL BUILDING SECTION - SCREENING CUT", 90, 465, 9, true);
    const tower = design.towers[0];
    const floors = Math.max(1, diagramCount(tower?.floors ?? 1, 300));
    const floorHeight = tower?.floorHeight ?? 3;
    const height = Math.min(310, floors * floorHeight * 45);
    box(page, 180, 105, 190, height, 0.25);
    for (let floor = 1; floor < floors; floor += 1) line(page, 180, 105 + floor * height / floors, 370, 105 + floor * height / floors, 0.65);
    for (let floor = 0; floor <= floors; floor += 1) text(page, `${floorHeight * floor} m`, 385, 101 + floor * height / floors, 7);
    text(page, `${floors} levels | ${floorHeight} m floor-to-floor`, 180, 88, 8, true);
    text(page, "Section is schematic; floor lines are capped at 300. Confirm assemblies, cores and structure.", 90, 75, 7);
  }
}
function infraPages(page: PdfPage, infra: InfraDesign, sheet: string) {
  if (sheet === "plan") {
    text(page, `${INFRA_LABELS[infra.kind]} - CONCEPT PLAN`, 90, 465, 9, true);
    box(page, 90, 145, 560, 260, 0.25);
    if (infra.kind === "highway" && infra.highway) {
      const h = infra.highway;
      const width = h.lanes * h.laneWidthM + 2 * h.shoulderM + h.medianM;
      fill(page, 135, 220, 470, Math.min(75, width * 8), 0.82);
      text(page, `${h.lanes} lanes | ${h.designSpeedKph} km/h | ${h.surface}`, 145, 205, 8);
    } else if (infra.kind === "airport" && infra.airport) {
      for (let i = 0; i < diagramCount(infra.airport.runways, 64); i += 1) { fill(page, 135, 235 + i * 45, 470, 24, 0.82); text(page, `RWY ${i + 1}  ${infra.airport.runwayLengthM} x ${infra.airport.runwayWidthM} m`, 145, 242 + i * 45, 7); }
      if (infra.airport.runways > 64) text(page, "Runway symbols capped at 64.", 90, 100, 7);
    } else if (infra.kind === "ports" && infra.ports) {
      fill(page, 135, 205, 470, 115, 0.88); text(page, `${infra.ports.berths} berths | quay ${infra.ports.berthLengthM * infra.ports.berths} m`, 150, 260, 8);
    } else if (infra.dams) {
      fill(page, 265, 180, 180, 150, 0.82); text(page, `${infra.dams.damType} dam | crest ${infra.dams.crestLengthM} m`, 220, 160, 8);
    }
    text(page, "Location / route geometry and generated model are shown schematically where stored.", 90, 115, 7);
  } else if (sheet === "elevation") {
    text(page, "PRIMARY INFRASTRUCTURE ELEVATION - SCHEMATIC", 90, 465, 9, true);
    const value = infra.dams?.heightM ?? infra.highway?.embankmentHeightM ?? infra.airport?.elevationM ?? infra.ports?.draftM ?? 10;
    const height = Math.min(310, Math.max(70, value * 8));
    fill(page, 180, 105, 300, height, 0.82); box(page, 180, 105, 300, height, 0.25);
    text(page, `${value} m controlling height / depth input`, 180, 88, 8, true);
    text(page, "Profile is a planning abstraction, not a geotechnical, hydraulic, aviation or marine design.", 90, 75, 7);
  } else {
    text(page, "TYPICAL SECTION / CROSS SECTION", 90, 465, 9, true);
    box(page, 125, 155, 500, 210, 0.25);
    line(page, 125, 230, 625, 230, 0.2);
    text(page, "DATUM / EXISTING GROUND (APPROX.)", 135, 240, 7);
    text(page, "Stored drafting, terrain and section settings are carried into the coordination package.", 90, 115, 7);
  }
}

function buildPages(projectName: string, design: Design): PdfPage[] {
  const docs = documentationFor(design);
  const compliance = validateDesign(design);
  const pages: PdfPage[] = [];
  const budget = { bytes: 0 };
  const inventory = documentationInventory(design);
  const continuation = new Map<string, number>();
  const page = (sheet: DocumentationSheet, label = sheet.name, view?: DocumentationView) => {
    if (pages.length >= MAX_PAGES) throw new Error("The PDF exceeds 500 pages. Select fewer views, schedules or rows.");
    const count = (continuation.get(sheet.id) ?? 0) + 1; continuation.set(sheet.id, count);
    const p: PdfPage = [];
    pageBudgets.set(p, budget);
    titleBlock(p, projectName, sheet, docs, count, view); heading(p, label);
    const revisions = sheet.revisionIds === undefined ? docs.revisions : docs.revisions.filter(revision => sheet.revisionIds!.includes(revision.id));
    const latest = revisions[revisions.length - 1];
    if (latest) text(p, `Revision ${latest.number} | ${latest.date} | ${latest.description}`.slice(0, 120), 70, 82, 7);
    pages.push(p); return p;
  };
  const community = design.community;
  const infra = design.infra;
  const renderPlan = (p: PdfPage) => {
    if (community) communityPages(p, community, "plan"); else if (infra) infraPages(p, infra, "plan"); else {
      const roomW = design.room.widthMm / 1000; const roomD = design.room.depthMm / 1000;
      const scale = Math.min(500 / Math.max(roomW, 1), 300 / Math.max(roomD, 1));
      box(p, 120, 155, roomW * scale, roomD * scale, 0.25); text(p, `ROOM PLAN ${roomW.toFixed(2)} x ${roomD.toFixed(2)} m`, 120, 135, 9, true);
      design.furniture.forEach((item, i) => { const x = 120 + (item.x / 1000 + roomW / 2) * scale; const y = 155 + (item.z / 1000 + roomD / 2) * scale; box(p, x, y, 22, 16, 0.45); text(p, `${i + 1}`, x + 7, y + 5, 7); });
      text(p, "Furniture markers from stored coordinates; catalog sizes are not drawn to scale.", 120, 115, 8);
    }
  };
  const renderElevation = (p: PdfPage) => { if (community) communityPages(p, community, "elevation"); else if (infra) infraPages(p, infra, "elevation"); else { text(p, "INTERIOR WALL ELEVATION - SCHEMATIC", 90, 465, 9, true); box(p, 130, 120, 500, 250, 0.25); text(p, `${design.room.wallHeightMm / 1000} m wall height`, 130, 100, 8); } };
  const renderSection = (p: PdfPage) => { if (community) communityPages(p, community, "section"); else if (infra) infraPages(p, infra, "section"); else { text(p, "INTERIOR ROOM SECTION - SCHEMATIC", 90, 465, 9, true); box(p, 130, 120, 500, Math.min(300, design.room.wallHeightMm / 12), 0.25); text(p, "Room envelope is derived from saved dimensions; assemblies are not specified.", 130, 100, 8); } };
  const review = [...(community?.review?.markers ?? []), ...(infra?.review?.markers ?? [])];
  const listPages = (sheet: DocumentationSheet, label: string, entries: string[], view?: DocumentationView) => {
    const lines: string[] = [];
    const maximumLines = (MAX_PAGES - pages.length) * 20;
    for (const entry of entries) {
      const value = safe(entry);
      const count = Math.max(1, Math.ceil(value.length / 115)) + 1;
      if (lines.length + count > maximumLines) throw new Error("The PDF notes exceed 500 pages. Select fewer or shorter records.");
      for (let start = 0; start < Math.max(value.length, 1); start += 115) lines.push(value.slice(start, start + 115));
      lines.push("");
    }
    if (!lines.length) lines.push("No saved records.");
    for (let start = 0; start < lines.length; start += 20) {
      const p = page(sheet, label, view);
      lines.slice(start, start + 20).forEach((value, index) => text(p, value, 70, 445 - index * 16, 8));
    }
  };
  const notes = (sheet: DocumentationSheet, view?: DocumentationView) => {
    const entries = docs.annotations.filter(annotation => !annotation.viewId || annotation.viewId === view?.id).map(annotation => {
      const matches = annotation.targetId ? inventory.filter(record => record.id === annotation.targetId) : [];
      const target = annotation.targetId ? ` [${matches.length === 1 ? `${matches[0].values.name} (${annotation.targetId})` : matches.length > 1 ? `ambiguous target ${annotation.targetId}` : `missing target ${annotation.targetId}`}]` : "";
      return `${annotation.tag ? `[${annotation.tag}] ` : ""}${annotation.text}${target}`;
    });
    if (entries.length) listPages(sheet, `${view?.name ?? sheet.name} - annotations`, entries, view);
  };
  const liveSchedules = (sheet: DocumentationSheet) => {
    const selected = sheet.scheduleIds === undefined ? docs.schedules : docs.schedules.filter(schedule => sheet.scheduleIds!.includes(schedule.id));
    for (const schedule of selected) {
      const result = buildDocumentationSchedule(design, schedule, inventory);
      if (!result.fields.length) { listPages(sheet, schedule.name, ["No schedule fields selected."]); continue; }
      for (let fieldStart = 0; fieldStart < result.fields.length; fieldStart += 6) for (let rowStart = 0; rowStart < Math.max(result.rows.length, 1); rowStart += 19) {
        const p = page(sheet, `${schedule.name} - live model schedule`); scheduleTable(p, result, fieldStart, rowStart);
      }
      if (result.warnings.length) listPages(sheet, `${schedule.name} - schedule notes`, result.warnings);
    }
  };
  const communityTakeoff = community ? computeTakeoff(community) : undefined;
  const infraTakeoff = infra ? computeInfraTakeoff(infra) : undefined;
  const takeoff: { items: (TakeoffItem | InfraTakeoffItem)[]; summary: string[] } = communityTakeoff
    ? { items: communityTakeoff.items, summary: [`Site ${communityTakeoff.summary.siteAreaM2} m2`, `Built-up ${communityTakeoff.summary.builtUpM2} m2`, `Concrete ${communityTakeoff.summary.concreteM3} m3`, `Steel ${communityTakeoff.summary.steelT} t`] }
    : infraTakeoff ? { items: infraTakeoff.items, summary: infraTakeoff.summary.map(s => `${s.label}: ${s.value}`) }
    : { items: design.furniture.map(f => ({ key: f.id, group: "Furniture", label: f.name, qty: 1, unit: "nos", basis: "Stored catalog item" })), summary: [`Room ${design.room.widthMm / 1000} x ${design.room.depthMm / 1000} m`] };
  const sheets: DocumentationSheet[] = docs.sheets.length ? docs.sheets : [{ id: "empty-sheet-index", number: "G-001", name: "Documentation index", viewIds: [] }];
  for (const sheet of sheets) {
    if (sheet.number === "G-001") {
      const p = page(sheet);
      text(p, safe(projectName).toUpperCase().slice(0, 40), 90, 385, 25, true); text(p, "PRELIMINARY SHEET PRODUCTION SET", 90, 355, 13);
      text(p, `${docs.status.toUpperCase()} | ${docs.views.filter(view => view.visible).length} visible views | ${docs.schedules.length} schedules`, 90, 320, 9);
      text(p, "Geometry pages are fitted schematic studies. Requested scale/orientation are metadata.", 90, 290, 8);
      text(p, "Live schedules include stored occurrences; envelope areas and volumes are approximate.", 90, 272, 8);
      text(p, `SCREENING PROFILE: ${compliance.profile.name}`, 90, 240, 8, true);
      listPages(sheet, "Sheet index", docs.sheets.map(item => `${item.number} ${item.name} | ${item.viewIds.length} bound view(s)`));
      if (docs.revisions.length) listPages(sheet, "Project revision history", docs.revisions.map(revision => `${revision.number} | ${revision.date} | ${revision.author} | ${revision.description}`));
      notes(sheet);
    } else if (sheet.number === "Q-501") {
      for (let start = 0; start < Math.max(takeoff.items.length, 1); start += 18) {
        const p = page(sheet); text(p, takeoff.summary.join(" | ").slice(0, 125), 70, 465, 8, true);
        rows(p, takeoff.items.slice(start, start + 18).map(item => ({ label: item.label, value: `${item.qty} ${item.unit}`, basis: item.basis })), 70, 435, 650);
      }
      notes(sheet);
    } else {
      const views = sheet.viewIds.map(id => docs.views.find(view => view.id === id)).filter((view): view is DocumentationView => Boolean(view));
      if (!views.length && sheet.number !== "S-401") { const p = page(sheet); text(p, "No model view is bound to this sheet.", 90, 430, 9); notes(sheet); }
      for (const view of views) {
        if (view.kind === "schedule") {
          const p = page(sheet, view.name, view);
          if (view.visible) { text(p, "Selected live schedules follow on continuation pages.", 90, 430, 9); notes(sheet, view); }
          else text(p, `VIEW HIDDEN: ${view.name}`, 90, 430, 9);
          continue;
        }
        const p = page(sheet, view.name, view);
        text(p, `Requested ${view.scale} / ${view.orientation} | schematic fit; dimensions shown as stored`.slice(0, 120), 70, 485, 7);
        if (!view.visible) text(p, `VIEW HIDDEN: ${view.name}`, 90, 430, 9);
        else if (view.kind === "plan") renderPlan(p); else if (view.kind === "elevation") renderElevation(p); else if (view.kind === "section") renderSection(p);
        else text(p, "Detail view has no generated detail geometry; annotations follow on continuation pages.", 90, 430, 8);
        if (view.visible) notes(sheet, view);
      }
      if (sheet.number === "S-401") {
        if (!views.length) notes(sheet);
        if (review.length) listPages(sheet, "Saved coordination review", review.map(marker => `${marker.severity.toUpperCase()}: ${marker.text} (${marker.status})`));
        listPages(sheet, "Standards screening", compliance.issues.map(issue => `${issue.severity.toUpperCase()} / ${issue.category}: ${issue.message} | ${issue.basis}`));
        if (design.visualization?.phases.length) listPages(sheet, "Construction phases", design.visualization.phases.map(phase => `${phase.name} | ${phase.durationDays ?? "-"} days | ${phase.crewSize ?? "-"} crew | ${phase.costEstimate ?? "-"} cost | ${phase.dependsOn?.length ?? 0} dependencies`));
      }
    }
    if (sheet.scheduleIds !== undefined || sheet.number === "S-401" || sheet.viewIds.some(id => docs.views.find(view => view.id === id)?.kind === "schedule" && docs.views.find(view => view.id === id)?.visible)) liveSchedules(sheet);
  }
  const issues = documentationIssues(design); if (issues.length) listPages(sheets[0], "Documentation binding warnings", issues);
  return pages;
}

/** Build a self-contained vector PDF in the browser with no server renderer. */
export function buildSheetPdf(projectName: string, design: Design): Uint8Array {
  const pages = buildPages(projectName || "Untitled project", design);
  const objects: string[] = [];
  const add = (value: string) => { objects.push(value); return objects.length; };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds: number[] = [];
  const pageEntries: string[] = [];
  pages.forEach((commands) => {
    const stream = commands.join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent PAGES /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`);
    pageIds.push(pageId);
    pageEntries.push(`${pageId} 0 R`);
  });
  const pagesId = add(`<< /Type /Pages /Kids [${pageEntries.join(" ")}] /Count ${pageIds.length} >>`);
  pageIds.forEach((id) => { objects[id - 1] = objects[id - 1].replace("/Parent PAGES", `/Parent ${pagesId} 0 R`); });
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  // All commands and text are ASCII; character counts therefore equal UTF-8 byte offsets.
  const header = "%PDF-1.4\n%Groundwork ASCII PDF\n";
  let pdf = header;
  const offsets: number[] = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

