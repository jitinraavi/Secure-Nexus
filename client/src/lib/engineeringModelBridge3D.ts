import { engineeringRecord, identifier, requireFinite } from "./engineeringNumerics";
import { parseFrameModel3D, type FrameMember3D, type FrameModel3D, type Vector3D } from "./frameAnalysis3D";

export interface FrameBridgeOptions3D {
  areaM2: number; inertiaYM4: number; inertiaZM4: number; torsionConstantM4: number;
  elasticModulusPa: number; shearModulusPa: number; localYAxis: Vector3D;
  acceptAssumedFixedSupports: boolean;
}

function allowedFields(value: Record<string, unknown>, names: string[], label: string): void {
  const unsupported = Object.keys(value).find(name => !names.includes(name));
  if (unsupported) throw new Error(`${label}.${unsupported} is unsupported by the 3D frame bridge. Remove the unsupported feature from a separately reviewed frame-only source.`);
}

/** Restore the authored import overrides without inferring material or section properties. */
export function parseFrameBridgeOptions3D(value: unknown): FrameBridgeOptions3D {
  if (!engineeringRecord(value)) throw new Error("3D frame import options must be an object.");
  allowedFields(value, ["areaM2", "inertiaYM4", "inertiaZM4", "torsionConstantM4", "elasticModulusPa", "shearModulusPa", "localYAxis", "acceptAssumedFixedSupports"], "importOptions");
  if (typeof value.acceptAssumedFixedSupports !== "boolean") throw new Error("Explicitly choose whether to accept the source's assumed fixed supports.");
  if (!Array.isArray(value.localYAxis) || value.localYAxis.length !== 3) throw new Error("3D import localYAxis requires three global reference components.");
  const localYAxis: Vector3D = [requireFinite(value.localYAxis[0], "localYAxis X", -1e6, 1e6), requireFinite(value.localYAxis[1], "localYAxis Y", -1e6, 1e6), requireFinite(value.localYAxis[2], "localYAxis Z", -1e6, 1e6)];
  if (Math.hypot(...localYAxis) < 1e-12) throw new Error("3D import localYAxis cannot be zero. Supply a reference not parallel to any selected member.");
  return {
    areaM2: requireFinite(value.areaM2, "section area", 1e-8, 1e4), inertiaYM4: requireFinite(value.inertiaYM4, "section Iy", 1e-14, 1e6),
    inertiaZM4: requireFinite(value.inertiaZM4, "section Iz", 1e-14, 1e6), torsionConstantM4: requireFinite(value.torsionConstantM4, "Saint-Venant torsion constant J", 1e-14, 1e6),
    elasticModulusPa: requireFinite(value.elasticModulusPa, "Young's modulus E", 1e3, 1e13), shearModulusPa: requireFinite(value.shearModulusPa, "shear modulus G", 1e3, 1e13),
    localYAxis, acceptAssumedFixedSupports: value.acceptAssumedFixedSupports,
  };
}

/** Convert only the exchange's supported line geometry into an editable 3D analysis template. */
export function importStructuralExchange3D(value: unknown, options: FrameBridgeOptions3D): { model: FrameModel3D; warnings: string[] } {
  const overrides = parseFrameBridgeOptions3D(options);
  if (!engineeringRecord(value) || value.format !== "groundwork-structural-analysis-model" || value.version !== 1 || value.units !== "SI") throw new Error("Import the Community Editor's structural Solver model JSON (SI version 1), not a raw visual CAD design.");
  allowedFields(value, ["format", "version", "units", "modelFingerprint", "resultsSchema", "nodes", "members", "supportNodes", "memberScreens", "foundationScreens", "warnings", "formatScope", "loadCombinations", "assumptions", "verification"], "structuralExchange");
  if (!Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > 20000 || !Array.isArray(value.members) || !value.members.length || value.members.length > 20000) throw new Error("Structural exchange needs nonempty bounded nodes/members arrays (at most 20,000 source records each).");
  const points = new Map<string, { id: string; xM: number; yM: number; zM: number }>();
  for (const node of value.nodes) {
    if (!engineeringRecord(node) || !identifier(node.id) || points.has(node.id)) throw new Error("Source nodes require unique valid identifiers.");
    allowedFields(node, ["id", "x", "y", "z", "kind"], node.id);
    if (node.kind !== undefined && !["grid-intersection", "column-base", "column-top"].includes(String(node.kind))) throw new Error(`${node.id} has an unsupported source node kind.`);
    points.set(node.id, { id: node.id, xM: requireFinite(node.x, `${node.id}.X`, -1e6, 1e6), yM: requireFinite(node.y, `${node.id}.Y`, -1e6, 1e6), zM: requireFinite(node.z, `${node.id}.Z`, -1e6, 1e6) });
  }
  const sourceMemberIds = new Set<string>(), selected: FrameMember3D[] = []; let omittedSurfaces = 0;
  for (const member of value.members) {
    if (!engineeringRecord(member) || !identifier(member.id) || sourceMemberIds.has(member.id)) throw new Error("Source members require unique valid identifiers.");
    allowedFields(member, ["id", "kind", "startNodeId", "endNodeId", "levelId", "widthM", "depthM", "lengthM", "sourceId", "tributaryWidthM"], member.id);
    sourceMemberIds.add(member.id);
    if (typeof member.kind !== "string" || !["beam", "column", "brace", "wall", "slab"].includes(member.kind)) throw new Error(`${member.id} has an unsupported member kind. Only beam, column and brace line members can enter the 3D solver.`);
    if (typeof member.startNodeId !== "string" || !points.has(member.startNodeId)) throw new Error(`${member.id} references a missing start node.`);
    if (member.endNodeId !== undefined && (typeof member.endNodeId !== "string" || !points.has(member.endNodeId))) throw new Error(`${member.id} references a missing end node.`);
    for (const key of ["widthM", "depthM", "lengthM", "tributaryWidthM"]) if (member[key] !== undefined) requireFinite(member[key], `${member.id}.${key}`, 0, 1e7);
    for (const key of ["levelId", "sourceId"]) if (member[key] !== undefined && !identifier(member[key])) throw new Error(`${member.id}.${key} must be a valid identifier.`);
    // Known surface representatives are omitted explicitly, never treated as beams.
    if (member.kind === "wall" || member.kind === "slab") { omittedSurfaces++; continue; }
    if (typeof member.endNodeId !== "string" || member.startNodeId === member.endNodeId) throw new Error(`${member.id} needs two distinct referenced end nodes.`);
    if (selected.length >= 60) throw new Error("3D frame import exceeds 60 supported members. Export a smaller frame-only subset.");
    selected.push({ id: member.id, start: member.startNodeId, end: member.endNodeId,
      areaM2: overrides.areaM2, inertiaYM4: overrides.inertiaYM4, inertiaZM4: overrides.inertiaZM4,
      torsionConstantM4: overrides.torsionConstantM4, elasticModulusPa: overrides.elasticModulusPa, shearModulusPa: overrides.shearModulusPa,
      localYAxis: [...overrides.localYAxis] as Vector3D });
  }
  if (!selected.length) throw new Error("No supported beam, column or brace line members were found. Walls and slabs cannot be converted into this beam-frame model.");
  const usedNodes = new Set(selected.flatMap(member => [member.start, member.end]));
  if (usedNodes.size > 30) throw new Error("3D frame import exceeds 30 connected source nodes. Export a smaller frame-only subset; distinct source IDs are not automatically merged.");
  const assumedSupports = new Set<string>();
  if (value.supportNodes !== undefined) {
    if (!Array.isArray(value.supportNodes) || value.supportNodes.length > 20000) throw new Error("Structural support records are missing or oversized.");
    for (const support of value.supportNodes) {
      if (!engineeringRecord(support) || !identifier(support.nodeId) || !points.has(support.nodeId) || assumedSupports.has(support.nodeId)) throw new Error("Source support records need unique existing node IDs.");
      allowedFields(support, ["nodeId", "assumedRestraint", "requiresVerification"], "sourceSupport");
      if (support.assumedRestraint !== "fixed" || support.requiresVerification !== undefined && typeof support.requiresVerification !== "boolean") throw new Error(`${support.nodeId}: only the exchange's declared assumed fixed supports are understood. Author other support behavior in the 3D analysis JSON.`);
      assumedSupports.add(support.nodeId);
    }
  }
  const nodes = [...points.values()].filter(node => usedNodes.has(node.id)).map(node => {
    const fixed = overrides.acceptAssumedFixedSupports && assumedSupports.has(node.id);
    return { ...node, restraints: [fixed, fixed, fixed, fixed, fixed, fixed] };
  });
  let model: FrameModel3D;
  try { model = parseFrameModel3D({ version: 1, analysis: "linear", nodes, members: selected, loadCases: [{ id: "user-loads", nodal: [], uniform: [] }] }); }
  catch (error) {
    if (error instanceof Error && error.message.includes("localYAxis")) throw new Error(`${error.message} Change the global localYAxis import reference, or author per-member references in a separate FrameModel3D JSON. No fallback orientation was assigned.`);
    throw error;
  }
  const omittedSupportCount = [...assumedSupports].filter(id => !usedNodes.has(id)).length;
  return { model, warnings: [
    `Imported ${model.members.length} line members and ${model.nodes.length} nodes in 3D. Omitted ${omittedSurfaces} wall/slab representatives and ${points.size - usedNodes.size} unused source nodes${omittedSupportCount ? `, including ${omittedSupportCount} assumed-support nodes` : ""}.`,
    "Visual CAD elements outside the structural exchange, including wall/slab shell action, foundations, equipment, nonstructural objects and diaphragm behavior, are not represented by this beam model.",
    "All line members use the entered A, Iy, Iz, J, E and G overrides and the entered global local-y reference. These replace source dimensions; assign actual per-member sections, materials and principal orientations before analysis.",
    "Source node and member IDs are preserved. Distinct coincident node IDs are not welded; crossing members do not connect without a shared authored node. Independently review topology and rigid-joint assumptions.",
    "No loads or load combinations are inferred from demand screens or source assumptions. Populate user-loads with independently established nodal/member loads and combinations; no self-weight is generated.",
    overrides.acceptAssumedFixedSupports ? "Source assumed fixed supports were accepted explicitly for imported nodes; establish actual support restraints independently. If none were supplied, every node remains free." : "Every imported support remains unrestrained. Author actual [UX, UY, UZ, RX, RY, RZ] restraints before calculation.",
    "Conversion does not establish stability, engineering acceptance, country-code compliance or source-result certification. Original source metadata and screens are not solver results.",
  ] };
}
