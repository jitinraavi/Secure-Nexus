import type { Design, InfraDesign, CommunityDesign } from "../types";
import { computeTakeoff, type TakeoffItem } from "./takeoff";
import { computeInfraTakeoff, INFRA_LABELS, type InfraTakeoffItem } from "./infra";
import { landMeters, towerMeters } from "./community";
import { documentationFor } from "./documentation";
import type { DocumentationMetadata } from "../types";
import { validateDesign } from "./compliance";

type PdfPage = string[];
const W = 792;
const H = 612;
const margin = 28;
const safe = (value: unknown) => String(value ?? "").replace(/[^\x20-\x7e]/g, "?");
const esc = (value: string) => safe(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const num = (value: number) => (Number.isFinite(value) ? value : 0).toFixed(2).replace(/\.00$/, "");

function text(page: PdfPage, value: string, x: number, y: number, size = 9, bold = false) {
  page.push(`BT /F${bold ? 2 : 1} ${size} Tf ${num(x)} ${num(y)} Td (${esc(value)}) Tj ET`);
}
function line(page: PdfPage, x1: number, y1: number, x2: number, y2: number, gray = 0.35) {
  page.push(`${gray} G ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
}
function box(page: PdfPage, x: number, y: number, w: number, h: number, gray = 0.35) {
  page.push(`${gray} G ${num(x)} ${num(y)} ${num(w)} ${num(h)} re S`);
}
function fill(page: PdfPage, x: number, y: number, w: number, h: number, gray = 0.96) {
  page.push(`${gray} g ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f 0 G`);
}
function titleBlock(page: PdfPage, projectName: string, sheet: string, number: string, docs: DocumentationMetadata) {
  const definition = docs.sheets.find((item) => item.number === number);
  const view = definition?.viewIds.map((id) => docs.views.find((item) => item.id === id)).find(Boolean);
  box(page, margin, margin, W - margin * 2, H - margin * 2, 0.15);
  line(page, margin, 58, W - margin, 58, 0.15);
  text(page, definition?.titleBlock || docs.titleBlock || "GROUNDWORK DESIGN STUDIO", margin + 8, 42, 8, true);
  text(page, safe(projectName).toUpperCase(), 250, 42, 8, true);
  text(page, `${number}  |  ${sheet}`, W - 205, 42, 8, true);
  text(page, `${docs.projectNumber} | ${docs.client || "UNASSIGNED CLIENT"} | ${docs.issueDate} | ${view ? `${view.scale} ${view.orientation.toUpperCase()}` : ""}`, margin + 8, 67, 7, true);
  text(page, docs.status.toUpperCase(), W - 115, 67, 7, true);
}
function heading(page: PdfPage, value: string) {
  text(page, value.toUpperCase(), margin + 18, H - 72, 15, true);
  line(page, margin + 18, H - 82, W - margin - 18, H - 82, 0.15);
}
function bulletList(page: PdfPage, items: string[], x: number, y: number, width: number) {
  items.forEach((item, index) => {
    const row = y - index * 17;
    text(page, `${index + 1}. ${item.slice(0, Math.floor(width / 5))}`, x, row, 8);
  });
}
function rows(page: PdfPage, items: { label: string; value: string; basis?: string }[], x: number, y: number, width: number, max = 25) {
  fill(page, x, y - 14, width, 17, 0.92);
  text(page, "ITEM", x + 5, y - 9, 7, true);
  text(page, "QTY / VALUE", x + width - 145, y - 9, 7, true);
  items.slice(0, max).forEach((item, index) => {
    const rowY = y - 31 - index * 16;
    line(page, x, rowY - 5, x + width, rowY - 5, 0.82);
    text(page, item.label.slice(0, 48), x + 5, rowY, 7);
    text(page, item.value.slice(0, 20), x + width - 145, rowY, 7);
    if (item.basis) text(page, item.basis.slice(0, 58), x + width - 285, rowY, 6);
  });
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
      for (let floor = 1; floor < tower.floors; floor += 1) line(page, x, 105 + floor * Math.min(height, 330) / tower.floors, x + Math.min(width, 125), 105 + floor * Math.min(height, 330) / tower.floors, 0.65);
      text(page, tower.label || `Tower ${index + 1}`, x, 88, 8, true);
      text(page, `${tower.floors} floors | ${tower.facadeMaterial}`, x, 76, 7);
    });
    text(page, "Facade openings and materials are diagrammatic; no structural or code detailing is implied.", 90, 95, 7);
  } else {
    text(page, "TYPICAL BUILDING SECTION - SCREENING CUT", 90, 465, 9, true);
    const tower = design.towers[0];
    const floors = tower?.floors ?? 1;
    const floorHeight = tower?.floorHeight ?? 3;
    const height = Math.min(310, floors * floorHeight * 45);
    box(page, 180, 105, 190, height, 0.25);
    for (let floor = 1; floor < floors; floor += 1) line(page, 180, 105 + floor * height / floors, 370, 105 + floor * height / floors, 0.65);
    for (let floor = 0; floor <= floors; floor += 1) text(page, `${floorHeight * floor} m`, 385, 101 + floor * height / floors, 7);
    text(page, `${floors} levels | ${floorHeight} m floor-to-floor`, 180, 88, 8, true);
    text(page, "Section cut is a proportional study from persisted levels/tower inputs. Confirm assemblies, cores and structure.", 90, 75, 7);
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
      for (let i = 0; i < infra.airport.runways; i += 1) { fill(page, 135, 235 + i * 45, 470, 24, 0.82); text(page, `RWY ${i + 1}  ${infra.airport.runwayLengthM} x ${infra.airport.runwayWidthM} m`, 145, 242 + i * 45, 7); }
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
  const page = (sheet: DocumentationMetadata["sheets"][number]) => { const p: PdfPage = []; titleBlock(p, projectName, sheet.name, sheet.number, docs); heading(p, sheet.name); pages.push(p); return p; };
  const community = design.community;
  const infra = design.infra;
  const renderPlan = (p: PdfPage) => {
    if (community) communityPages(p, community, "plan"); else if (infra) infraPages(p, infra, "plan"); else {
      const roomW = design.room.widthMm / 1000; const roomD = design.room.depthMm / 1000;
      box(p, 120, 155, roomW * 45, roomD * 45, 0.25); text(p, `ROOM PLAN  ${roomW.toFixed(2)} x ${roomD.toFixed(2)} m`, 120, 135, 9, true);
      design.furniture.forEach((item, i) => { const x = 120 + (item.x / 1000 + roomW / 2) * 45; const y = 155 + (item.z / 1000 + roomD / 2) * 45; box(p, x, y, 22, 16, 0.45); text(p, `${i + 1}`, x + 7, y + 5, 7); });
      text(p, "Furniture plan from stored room and catalog coordinates.", 120, 115, 8);
    }
  };
  const renderElevation = (p: PdfPage) => { if (community) communityPages(p, community, "elevation"); else if (infra) infraPages(p, infra, "elevation"); else { text(p, "INTERIOR WALL ELEVATION - SCHEMATIC", 90, 465, 9, true); box(p, 130, 120, 500, 250, 0.25); text(p, `${design.room.wallHeightMm / 1000} m wall height`, 130, 100, 8); } };
  const renderSection = (p: PdfPage) => { if (community) communityPages(p, community, "section"); else if (infra) infraPages(p, infra, "section"); else { text(p, "INTERIOR ROOM SECTION - SCHEMATIC", 90, 465, 9, true); box(p, 130, 120, 500, design.room.wallHeightMm / 12, 0.25); text(p, "Room envelope is derived from saved dimensions; assemblies are not specified.", 130, 100, 8); } };
  const review = community?.review?.markers ?? infra?.review?.markers ?? [];
  const scheduleItems = community ? [
    { label: "Towers", value: `${community.towers.length}`, basis: "Persisted tower schedule" },
    { label: "Levels", value: `${community.levels?.length ?? 0}`, basis: "Persisted level schedule" },
    { label: "Amenities", value: `${community.amenities.length}`, basis: "Stored site objects" },
    { label: "Structural grid", value: `${community.structuralGrid?.length ?? 0}`, basis: "Stored X/Z grid" },
    { label: "Interior rooms", value: `${community.interiors.length}`, basis: "Stored room plans" },
    { label: "Review markups", value: `${review.length}`, basis: "Open/resolved coordination notes" },
  ] : infra ? [
    { label: "Facilities", value: `${infra.facilities?.length ?? 0}`, basis: "Stored facility schedule" },
    { label: "Draft elements", value: `${infra.drafts?.length ?? 0}`, basis: "Stored CAD annotations" },
    { label: "MEP routes", value: `${infra.mep?.elements.length ?? 0}`, basis: "Preliminary coordination" },
    { label: "Review markups", value: `${review.length}`, basis: "Open/resolved coordination notes" },
  ] : [{ label: "Furniture", value: `${design.furniture.length}`, basis: "Stored catalog objects" }, { label: "MEP routes", value: `${design.mep?.elements.length ?? 0}`, basis: "Preliminary coordination" }];
  const takeoff: { items: (TakeoffItem | InfraTakeoffItem)[]; summary: string[] } = community
    ? { items: computeTakeoff(community).items, summary: [`Site ${computeTakeoff(community).summary.siteAreaM2} m2`, `Built-up ${computeTakeoff(community).summary.builtUpM2} m2`, `Concrete ${computeTakeoff(community).summary.concreteM3} m3`, `Steel ${computeTakeoff(community).summary.steelT} t`] }
    : infra ? { items: computeInfraTakeoff(infra).items, summary: computeInfraTakeoff(infra).summary.map((s) => `${s.label}: ${s.value}`) }
    : { items: design.furniture.map((f) => ({ key: f.id, group: "Furniture", label: f.name, qty: 1, unit: "nos", basis: "Stored catalog item" })), summary: [`Room ${design.room.widthMm / 1000} x ${design.room.depthMm / 1000} m`] };
  docs.sheets.forEach((sheet) => {
    const p = page(sheet);
    if (sheet.number === "G-001") {
       text(p, safe(projectName).toUpperCase(), 90, 385, 25, true); text(p, "PRELIMINARY SHEET PRODUCTION SET", 90, 355, 13); text(p, `Generated ${new Date().toISOString().slice(0, 10)}`, 90, 320, 9);
       bulletList(p, docs.sheets.map((item) => `${item.number} ${item.name}`), 90, 275, 440); text(p, `Status: ${docs.status.toUpperCase()} | ${docs.revisions.length} revision(s)`, 90, 145, 11, true); text(p, `Views: ${docs.views.filter((view) => view.visible).length} | Schedules: ${docs.schedules.length} | Tags: ${docs.annotations.length}`, 90, 128, 8);
       text(p, `SCREENING PROFILE: ${compliance.profile.name}`, 90, 105, 8, true); text(p, `Issues: ${compliance.issues.filter((i) => i.severity === "error").length} errors | ${compliance.issues.filter((i) => i.severity === "warning").length} warnings | ${compliance.issues.filter((i) => i.severity === "review").length} professional-review notes`, 90, 91, 7);
    } else if (sheet.number === "Q-501") {
      text(p, takeoff.summary.join("  |  "), 70, 445, 8, true); rows(p, takeoff.items.map((item) => ({ label: item.label, value: `${item.qty} ${item.unit}`, basis: item.basis })), 70, 415, 650, 20);
    } else {
      const view = sheet.viewIds.map((viewId) => docs.views.find((item) => item.id === viewId)).find(Boolean);
      if (view && !view.visible) { text(p, `VIEW HIDDEN: ${view.name}`, 90, 430, 9); } else if (view?.kind === "plan") renderPlan(p); else if (view?.kind === "elevation") renderElevation(p); else if (view?.kind === "section") renderSection(p); else if (view?.kind === "schedule" || sheet.number === "S-401") {
         const configuredSchedules = docs.schedules.map((schedule) => ({ label: schedule.name, value: schedule.fields.join(", "), basis: `${schedule.category} schedule` }));
         const complianceRows = compliance.issues.map((item) => ({ label: `${item.severity.toUpperCase()} · ${item.category}`, value: item.message, basis: item.basis }));
         rows(p, [...configuredSchedules, ...scheduleItems, ...complianceRows], 70, 445, 650); text(p, "ANNOTATIONS / REVIEW MARKUPS", 70, 210, 9, true);
         const annotations = docs.annotations.map((a) => `${a.tag ? `[${a.tag}] ` : ""}${a.text}`); bulletList(p, [...review.map((m) => `${m.severity.toUpperCase()}: ${m.text} (${m.status})`), ...annotations, ...(review.length || annotations.length ? [] : ["No saved annotations."])], 70, 185, 620);
      } else { text(p, "DOCUMENTATION VIEW", 90, 465, 9, true); text(p, `${view?.name ?? sheet.name} | ${view?.scale ?? ""} ${view?.orientation ?? ""}`, 90, 430, 9); }
    }
    if (docs.revisions.length) text(p, `Latest revision ${docs.revisions[docs.revisions.length - 1].number}: ${docs.revisions[docs.revisions.length - 1].description}`, 70, 82, 7);
  });
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
  const header = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  let pdf = header;
  const offsets: number[] = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
