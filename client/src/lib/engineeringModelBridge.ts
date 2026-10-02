import { engineeringRecord, identifier, requireFinite } from "./engineeringNumerics";
import { parseFrameModel, type FrameModel2D } from "./frameAnalysis";
import type { FluidLink, FluidNetwork, FluidNode } from "./engineeringNetworks";

export interface FrameBridgeOptions {
  plane: "xy" | "zy"; sliceCoordinateM: number; sliceToleranceM: number;
  areaM2: number; inertiaM4: number; elasticModulusPa: number; acceptAssumedFixedSupports: boolean;
}
export function importStructuralExchange2D(value: unknown, options: FrameBridgeOptions): { model: FrameModel2D; warnings: string[] } {
  if (!engineeringRecord(value) || value.format !== "groundwork-structural-analysis-model" || value.version !== 1 || value.units !== "SI") throw new Error("Import the Community Editor's structural Solver model JSON (SI version 1).");
  if (!Array.isArray(value.nodes) || value.nodes.length > 20000 || !Array.isArray(value.members) || value.members.length > 20000) throw new Error("Structural exchange nodes/members are missing or oversized.");
  if (options.plane !== "xy" && options.plane !== "zy") throw new Error("Choose XY or ZY frame plane.");
  requireFinite(options.sliceCoordinateM, "slice coordinate", -1e6, 1e6); requireFinite(options.sliceToleranceM, "slice tolerance", 1e-6, 1);
  requireFinite(options.areaM2, "section area", 1e-8, 1e4); requireFinite(options.inertiaM4, "section inertia", 1e-14, 1e6); requireFinite(options.elasticModulusPa, "elastic modulus", 1e3, 1e13);
  const points = new Map<string, { id: string; x: number; y: number; z: number }>();
  value.nodes.forEach(node => {
    if (!engineeringRecord(node) || !identifier(node.id) || points.has(node.id)) throw new Error("Source nodes require unique identifiers.");
    const x = requireFinite(node.x, "node X", -1e6, 1e6), y = requireFinite(node.y, "node Y", -1e6, 1e6), z = requireFinite(node.z, "node Z", -1e6, 1e6);
    points.set(node.id, { id: node.id, x, y, z });
  });
  const selectedIds = new Set([...points.values()].filter(node => Math.abs((options.plane === "xy" ? node.z : node.x) - options.sliceCoordinateM) <= options.sliceToleranceM).map(node => node.id));
  const memberIds = new Set<string>();
  const selectedMembers = value.members.flatMap(member => {
    if (!engineeringRecord(member) || !identifier(member.id) || memberIds.has(member.id)) throw new Error("Source members require unique identifiers.");
    memberIds.add(member.id);
    if (!["beam", "column", "brace"].includes(String(member.kind)) || typeof member.startNodeId !== "string" || typeof member.endNodeId !== "string" || !selectedIds.has(member.startNodeId) || !selectedIds.has(member.endNodeId)) return [];
    return [{ id: member.id, start: member.startNodeId, end: member.endNodeId, areaM2: options.areaM2, inertiaM4: options.inertiaM4, elasticModulusPa: options.elasticModulusPa }];
  });
  const usedNodes = new Set(selectedMembers.flatMap(member => [member.start, member.end]));
  const supports = new Set<string>();
  if (options.acceptAssumedFixedSupports && Array.isArray(value.supportNodes)) for (const support of value.supportNodes) {
    if (engineeringRecord(support) && typeof support.nodeId === "string" && support.assumedRestraint === "fixed") supports.add(support.nodeId);
  }
  const model = parseFrameModel({
    version: 1, analysis: "linear",
    nodes: [...points.values()].filter(node => usedNodes.has(node.id)).map(node => ({ id: node.id, xM: options.plane === "xy" ? node.x : node.z, yM: node.y, restraints: [supports.has(node.id), supports.has(node.id), supports.has(node.id)] })),
    members: selectedMembers, loadCases: [{ id: "user-loads", nodal: [], uniform: [] }],
  });
  return { model, warnings: [
    `Selected ${model.members.length} line members and ${model.nodes.length} nodes in the ${options.plane.toUpperCase()} slice. Walls/slabs and members outside the slice were excluded.`,
    "All imported members use the section area/inertia/modulus entered in the import controls. Assign actual per-member sections before analysis.",
    "No loads were inferred from demand screens. Populate user-loads with independently established nodal/member loads and load combinations.",
    options.acceptAssumedFixedSupports ? "Imported fixed supports are the editor's assumptions, accepted by your import choice; independently establish actual support behavior." : "Supports were left unrestrained. Set actual restraints in the JSON before analysis.",
    "A 2D slice omits out-of-plane stiffness/load transfer. Source model fingerprint/result certification is not transferred.",
  ] };
}

export interface MepBridgeOptions {
  medium: "water" | "air"; endpointToleranceM: number; sourceElementId?: string; sourcePotential: number;
  terminalDemandM3s: number; roughnessM: number; minorLossKPerSegment: number;
}
export function importRoutedMepNetwork(value: unknown, options: MepBridgeOptions): { model: FluidNetwork; warnings: string[] } {
  if (!engineeringRecord(value)) throw new Error("MEP import requires a design object.");
  const community = engineeringRecord(value.community) ? value.community : undefined, infra = engineeringRecord(value.infra) ? value.infra : undefined;
  const candidate = engineeringRecord(value.mep) ? value.mep : community && engineeringRecord(community.mep) ? community.mep : infra && engineeringRecord(infra.mep) ? infra.mep : value;
  if (!Array.isArray(candidate.elements) || candidate.elements.length > 5000) throw new Error("Import room/community/infrastructure design JSON containing mep.elements.");
  if (options.medium !== "water" && options.medium !== "air") throw new Error("MEP medium must be water or air.");
  requireFinite(options.endpointToleranceM, "endpoint tolerance", 1e-6, 0.5); requireFinite(options.sourcePotential, "source potential", -1e7, 1e7);
  requireFinite(options.terminalDemandM3s, "terminal demand", 0, 1000); requireFinite(options.roughnessM, "roughness", 0, 1); requireFinite(options.minorLossKPerSegment, "minor loss", 0, 1e6);
  const selected = candidate.elements.filter(element => engineeringRecord(element) && element.kind === (options.medium === "water" ? "pipe" : "duct"));
  if (!selected.length) throw new Error(`No routed ${options.medium === "water" ? "pipes" : "ducts"} were found.`);
  const systems = new Set(selected.filter(engineeringRecord).map(element => typeof element.system === "string" ? element.system : "legacy-unassigned"));
  if (systems.size > 1) throw new Error("MEP import contains multiple pipe/duct systems. Export/select one system's elements before importing to avoid cross-system connections.");
  const coordinates: { x: number; y: number; z: number }[] = [], nodes: FluidNode[] = [], links: FluidLink[] = [], sourceStarts = new Map<string, string>(), sourceIds = new Set<string>();
  const getNode = (point: { x: number; y: number; z: number }) => {
    const existing = coordinates.findIndex(next => Math.hypot(point.x - next.x, point.y - next.y, point.z - next.z) <= options.endpointToleranceM);
    if (existing >= 0) return nodes[existing].id;
    if (nodes.length >= 80) throw new Error("Routed MEP import exceeds 80 solver nodes. Import a smaller system subset.");
    const id = `route-node-${nodes.length + 1}`;
    coordinates.push(point); nodes.push({ id, elevationM: point.y, demandM3s: 0 }); return id;
  };
  for (const element of selected) {
    if (!engineeringRecord(element) || !identifier(element.id) || sourceIds.has(element.id) || !Array.isArray(element.route) || element.route.length < 2 || element.route.length > 1000) throw new Error("Each selected MEP route needs a unique id and 2–1000 points.");
    sourceIds.add(element.id);
    const route = element.route.map(point => {
      if (!engineeringRecord(point)) throw new Error("MEP route points must be objects.");
      return { x: requireFinite(point.x, "route X", -1e6, 1e6), y: requireFinite(point.y, "route Y", -1e5, 1e5), z: requireFinite(point.z, "route Z", -1e6, 1e6) };
    });
    const dimensions = options.medium === "water" ? { diameterM: requireFinite(element.diameter, "pipe diameter", 0.001, 20) } : { widthM: requireFinite(element.width, "duct width", 0.001, 20), heightM: requireFinite(element.height, "duct height", 0.001, 20) };
    sourceStarts.set(element.id, getNode(route[0]));
    for (let index = 1; index < route.length; index++) {
      const from = getNode(route[index - 1]), to = getNode(route[index]); if (from === to) continue;
      if (links.length >= 200) throw new Error("Routed MEP import exceeds 200 links. Import a smaller system subset.");
      links.push({ id: `${element.id.slice(0, 70)}:segment-${links.length + 1}`, from, to, lengthM: Math.hypot(route[index].x - route[index - 1].x, route[index].y - route[index - 1].y, route[index].z - route[index - 1].z), ...dimensions, roughnessM: options.roughnessM, minorLossK: options.minorLossKPerSegment });
    }
  }
  if (!links.length) throw new Error("No nonzero MEP route segments were found.");
  const sourceNode = options.sourceElementId ? sourceStarts.get(options.sourceElementId) : nodes[0].id;
  if (!sourceNode) throw new Error("Source element id was not found in the selected routed system.");
  const degree = new Map(nodes.map(node => [node.id, 0])); links.forEach(link => { degree.set(link.from, degree.get(link.from)! + 1); degree.set(link.to, degree.get(link.to)! + 1); });
  nodes.forEach(node => { if (node.id === sourceNode) node.fixedPotential = options.sourcePotential; else if (degree.get(node.id) === 1) node.demandM3s = options.terminalDemandM3s; });
  // Preserve an editable disconnected template; parseFluidNetwork rejects missing component boundaries at calculation time.
  const model: FluidNetwork = { version: 1, medium: options.medium, densityKgM3: options.medium === "water" ? 998.2 : 1.2, kinematicViscosityM2s: options.medium === "water" ? 1e-6 : 1.5e-5, nodes, links };
  return { model, warnings: [
    `Converted ${selected.length} routed elements into ${nodes.length} nodes and ${links.length} segments. Coincident route vertices were merged within the entered tolerance.`,
    `Fixed source ${sourceNode} uses the entered potential. Each other degree-one route endpoint uses the entered terminal demand; review every source, demand, fluid property and node elevation.`,
    "Equipment, fixtures and connectedTo labels do not establish physical ports; only coincident route vertices connect. Intersections without explicit vertices remain disconnected.",
    "Disconnected components need independently supplied fixed head/pressure boundaries before calculation. No topology, pressure or flow acceptance is inferred during conversion.",
    "Entered roughness and minor-loss coefficient are copied to each segment; replace with verified material/fitting losses and actual minimum pressure/velocity criteria.",
  ] };
}
