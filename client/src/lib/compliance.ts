import type { ComplianceIssue, ComplianceProfile, ComplianceReport, Design, InteriorRoom, MepDesign } from "../types";

export const COMPLIANCE_PROFILES: ComplianceProfile[] = [
  {
    id: "is-style-planning",
    name: "IS-style planning reference",
    jurisdictionStyle: "Indian Standards style",
    edition: "Placeholder metadata · edition not specified",
    scope: "Early planning screening for building dimensions and coordination inputs",
    disclaimer: "Not an IS code check, approval, or certification. Confirm the adopted edition and local authority requirements with a qualified professional.",
    thresholds: { minRoomWidthM: 2.4, minRoomDepthM: 2.4, minDoorWidthM: 0.9, minClearanceM: 0.9, minFloorHeightM: 2.4, maxSiteSlopePct: 10, peoplePerM2: 0.1 },
  },
  {
    id: "eurocode-style-planning",
    name: "Eurocode-style planning reference",
    jurisdictionStyle: "Eurocode style",
    edition: "Placeholder metadata · National Annex not specified",
    scope: "Early planning screening with structural and MEP assumptions",
    disclaimer: "Not a Eurocode design, conformity assessment, or certification. Confirm the adopted Eurocodes, National Annexes, and authority requirements with a qualified professional.",
    thresholds: { minRoomWidthM: 2.4, minRoomDepthM: 2.4, minDoorWidthM: 0.9, minClearanceM: 1, minFloorHeightM: 2.4, maxSiteSlopePct: 10, peoplePerM2: 0.1 },
  },
  {
    id: "ibc-style-planning",
    name: "IBC-style planning reference",
    jurisdictionStyle: "International Building Code style",
    edition: "Placeholder metadata · edition and amendments not specified",
    scope: "Early planning screening for occupancy, egress, and documentation",
    disclaimer: "Not an IBC compliance determination, permit review, or certification. Confirm the adopted edition, amendments, and authority requirements with a qualified professional.",
    thresholds: { minRoomWidthM: 2.4, minRoomDepthM: 2.4, minDoorWidthM: 0.9, minClearanceM: 1, minFloorHeightM: 2.4, maxSiteSlopePct: 8, peoplePerM2: 0.1 },
  },
];

export function complianceProfile(id?: string): ComplianceProfile {
  return COMPLIANCE_PROFILES.find((profile) => profile.id === id) ?? COMPLIANCE_PROFILES[0];
}

function issue(severity: ComplianceIssue["severity"], category: ComplianceIssue["category"], id: string, message: string, basis: string): ComplianceIssue {
  return { severity, category, id, message, basis };
}

function roomsFor(design: Design): InteriorRoom[] {
  return design.community?.interiors ?? [];
}

function mepFor(design: Design): MepDesign | undefined {
  return design.community?.mep ?? design.infra?.mep ?? design.mep;
}

export function validateDesign(design: Design, profileId?: string): ComplianceReport {
  const profile = complianceProfile(profileId ?? design.compliance?.profileId);
  const t = profile.thresholds;
  const issues: ComplianceIssue[] = [];
  const add = (severity: ComplianceIssue["severity"], category: ComplianceIssue["category"], id: string, message: string, basis: string) => issues.push(issue(severity, category, id, message, basis));
  const rooms = roomsFor(design);
  const levels = design.community?.levels ?? [];

  if (design.room.widthMm / 1000 < t.minRoomWidthM || design.room.depthMm / 1000 < t.minRoomDepthM) add("error", "dimensions", "room-minimum", "Primary room envelope is below the profile screening minimum.", `${t.minRoomWidthM} m width and depth minimum`);
  if (design.room.wallHeightMm / 1000 < t.minFloorHeightM) add("error", "floor-heights", "room-height", "Primary room clear height is below the profile screening minimum.", `${t.minFloorHeightM} m minimum clear height`);
  if (!design.community && !design.infra && !design.room) add("error", "dimensions", "missing-envelope", "No primary model envelope is available.", "A model envelope is required for screening");

  const checkOpening = (opening: { kind: string; width?: number; height?: number; widthM?: number; heightM?: number }, label: string) => {
    const width = opening.width ?? opening.widthM ?? 0;
    const height = opening.height ?? opening.heightM ?? 0;
    if (opening.kind === "door" && width < t.minDoorWidthM) add("error", "life-safety", `${label}-door-width`, `${label} door opening is narrower than the screening minimum.`, `${t.minDoorWidthM} m minimum door width`);
    if (width <= 0 || height <= 0) add("error", "dimensions", `${label}-opening-size`, `${label} opening has a non-positive dimension.`, "Opening width and height must be greater than zero");
  };
  rooms.forEach((room) => {
    if (room.w < t.minRoomWidthM || room.d < t.minRoomDepthM) add("error", "dimensions", `${room.id}-size`, `Room ${room.name || room.id} is below the screening minimum dimensions.`, `${t.minRoomWidthM} m width and depth minimum`);
    const doors = (room.openings ?? []).filter((opening) => opening.kind === "door");
    if (!doors.length) add("warning", "life-safety", `${room.id}-door`, `Room ${room.name || room.id} has no explicit door opening.`, "Provide and review an accessible egress path");
    (room.openings ?? []).forEach((opening) => checkOpening(opening, `${room.name || room.id} ${opening.kind}`));
    if (room.mep?.planning && room.mep.planning.minimumClearanceM < t.minClearanceM) add("warning", "mep", `${room.id}-clearance`, `Room ${room.name || room.id} MEP clearance is below the screening minimum.`, `${t.minClearanceM} m minimum coordination clearance`);
  });
  design.community?.towers.forEach((tower) => {
    if (tower.floorHeight < t.minFloorHeightM) add("error", "floor-heights", `${tower.id}-floor-height`, `${tower.label} floor-to-floor height is below the screening minimum.`, `${t.minFloorHeightM} m minimum`);
    const doors = (tower.openings ?? []).filter((opening) => opening.kind === "door");
    if (tower.openings && !doors.length) add("warning", "life-safety", `${tower.id}-doors`, `${tower.label} has explicit openings but no explicit door.`, "Review egress and exit access with the authority having jurisdiction");
    (tower.openings ?? []).forEach((opening) => checkOpening(opening, `${tower.label} ${opening.kind}`));
  });
  levels.forEach((level) => { if (level.floorHeight < t.minFloorHeightM) add("error", "floor-heights", `${level.id}-height`, `${level.name} floor height is below the screening minimum.`, `${t.minFloorHeightM} m minimum`); });

  const occupancy = design.community?.structural?.occupancyCategory ?? mepFor(design)?.planning?.occupancy;
  if (design.community && !occupancy) add("warning", "occupancy", "occupancy-missing", "Occupancy category or occupant count has not been defined.", "Set occupancy before professional review");
  const mep = mepFor(design);
  if (mep?.planning) {
    if (mep.planning.occupancy > 0 && mep.planning.areaM2 > 0 && mep.planning.occupancy / mep.planning.areaM2 > 1 / t.peoplePerM2) add("warning", "occupancy", "occupancy-density", "MEP planning occupancy exceeds the profile screening density.", `${t.peoplePerM2} m2 per person screening basis`);
    if (mep.planning.minimumClearanceM < t.minClearanceM) add("warning", "mep", "mep-clearance", "MEP planning clearance is below the profile screening minimum.", `${t.minClearanceM} m minimum coordination clearance`);
  } else if (design.community || design.infra) add("review", "mep", "mep-inputs", "MEP planning inputs are not present for professional coordination review.", "Air, plumbing, electrical, fire, and access assumptions are not inferred");
  const structural = design.community?.structural;
  if (design.community && !structural) add("review", "structural", "structural-inputs", "Structural screening inputs are not present.", "Loads, materials, soil, wind, seismic, and combinations require professional design");
  else if (structural && (structural.soilType === "unknown" || !structural.material)) add("warning", "structural", "structural-assumptions", "Structural material or soil assumptions are incomplete.", "Confirm basis, load paths, geotechnical data, and design actions");

  const terrain = design.community?.terrain ?? design.infra?.terrain;
  if (terrain?.enabled && terrain.reliefM > 0) {
    const siteWidth = design.community?.land.width ?? design.room.widthMm / 1000;
    const slope = terrain.reliefM / Math.max(siteWidth, 1) * 100;
    if (slope > t.maxSiteSlopePct) add("warning", "site", "site-slope", `Indicative site relief implies a slope above the profile screening threshold (${slope.toFixed(1)}%).`, `${t.maxSiteSlopePct}% maximum screening slope; survey required`);
  } else if (design.community || design.infra) add("review", "site", "site-slope-input", "Site slope has not been established from survey or terrain data.", "Confirm topographic survey, drainage, access, and retaining conditions");

  const docs = design.documentation;
  if (!docs?.author || !docs.client || !docs.titleBlock) add("warning", "documentation", "doc-metadata", "Documentation metadata is incomplete.", "Author, client, and title block are required for a professional review package");
  if (!docs?.views?.length || !docs.sheets?.length) add("warning", "documentation", "doc-package", "Documentation views or sheets are missing.", "Provide coordinated plans, elevations, sections, and schedules");
  add("review", "documentation", "professional-review", "Professional review remains required for code interpretation, life safety, structure, MEP, accessibility, fire protection, site, and permits.", profile.disclaimer);
  return { profile, issues, generatedAt: new Date().toISOString() };
}
