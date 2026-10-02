import type { Design, DocumentationMetadata } from "../types";
import { buildDocumentationSchedule, documentationInventory } from "./documentationSchedule";

export const defaultDocumentation = (): DocumentationMetadata => ({
  version: 1,
  projectNumber: "GD-001",
  client: "",
  author: "Groundwork Design Studio",
  status: "draft",
  issueDate: new Date().toISOString().slice(0, 10),
  titleBlock: "Groundwork Design Studio",
  views: [
    { id: "view-plan", name: "Overall plan", kind: "plan", scale: "1:100", orientation: "north", visible: true },
    { id: "view-elevation", name: "Primary elevation", kind: "elevation", scale: "1:100", orientation: "north", visible: true },
    { id: "view-section", name: "Typical section", kind: "section", scale: "1:100", orientation: "custom", visible: true },
  ],
  sheets: [
    { id: "sheet-cover", number: "G-001", name: "Cover / issue index", viewIds: [] },
    { id: "sheet-plan", number: "A-101", name: "Plan / arrangement", viewIds: ["view-plan"] },
    { id: "sheet-elevation", number: "A-201", name: "Elevation / profile", viewIds: ["view-elevation"] },
    { id: "sheet-section", number: "A-301", name: "Section / cross section", viewIds: ["view-section"] },
    { id: "sheet-schedule", number: "S-401", name: "Schedules / annotations", viewIds: [] },
    { id: "sheet-boq", number: "Q-501", name: "Planning BOQ / takeoff", viewIds: [] },
  ],
  annotations: [],
  schedules: [
    { id: "schedule-objects", name: "Coordination schedule", category: "objects", fields: ["Category", "Name", "Quantity"] },
  ],
  revisions: [],
});

export function documentationFor(design: Design): DocumentationMetadata {
  const base = defaultDocumentation();
  const value = design.documentation;
  if (!value) return base;
  return {
    ...base,
    ...value,
    views: value.views ?? base.views,
    sheets: value.sheets ?? base.sheets,
    annotations: value.annotations ?? [],
    schedules: value.schedules ?? base.schedules,
    revisions: value.revisions ?? [],
  };
}

/** Diagnose stale bindings without dropping the user's saved documentation. */
export function documentationIssues(design: Design): string[] {
  const docs = documentationFor(design);
  const issues: string[] = [];
  const inventory = documentationInventory(design);
  const ids = new Set(inventory.map(record => record.id));
  const views = new Set(docs.views.map(view => view.id));
  const schedules = new Set(docs.schedules.map(schedule => schedule.id));
  const revisions = new Set(docs.revisions.map(revision => revision.id));
  const sheetNumbers = new Set<string>();
  for (const sheet of docs.sheets) {
    if (sheetNumbers.has(sheet.number)) issues.push(`Duplicate sheet number: ${sheet.number}.`);
    sheetNumbers.add(sheet.number);
    for (const id of sheet.viewIds) if (!views.has(id)) issues.push(`${sheet.number}: missing view ${id}.`);
    for (const id of sheet.scheduleIds ?? []) if (!schedules.has(id)) issues.push(`${sheet.number}: missing schedule ${id}.`);
    for (const id of sheet.revisionIds ?? []) if (!revisions.has(id)) issues.push(`${sheet.number}: missing revision ${id}.`);
  }
  for (const annotation of docs.annotations) {
    if (annotation.viewId && !views.has(annotation.viewId)) issues.push(`Annotation ${annotation.tag ?? annotation.id}: missing view ${annotation.viewId}.`);
    if (annotation.targetId && !ids.has(annotation.targetId)) issues.push(`Annotation ${annotation.tag ?? annotation.id}: model target ${annotation.targetId} was removed.`);
    if (annotation.targetId && inventory.filter(record => record.id === annotation.targetId).length > 1) issues.push(`Annotation ${annotation.tag ?? annotation.id}: target ID is ambiguous across model scopes.`);
  }
  for (const schedule of docs.schedules) for (const warning of buildDocumentationSchedule(design, schedule, inventory).warnings) issues.push(`${schedule.name}: ${warning}`);
  return [...new Set(issues)];
}

