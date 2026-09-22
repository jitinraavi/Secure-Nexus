import type { Design, DocumentationMetadata } from "../types";

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
