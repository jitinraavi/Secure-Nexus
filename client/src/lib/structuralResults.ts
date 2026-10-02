import type { CommunityDesign } from "../types";
import { screenStructuralDesign, structuralModelFingerprint, type StructuralDesignPackage } from "./structuralEngine";

export interface StructuralVector { x: number; y: number; z: number; }
export interface StructuralNodeResult {
  nodeId: string;
  combinationId: string;
  displacementM: StructuralVector;
  rotationRad?: StructuralVector;
}
export interface StructuralMemberResult {
  memberId: string;
  combinationId: string;
  location?: "start" | "end" | "envelope";
  axialKN: number;
  shearYKN: number;
  shearZKN: number;
  torsionKNm: number;
  momentYKNm: number;
  momentZKNm: number;
}
export interface StructuralExternalResults {
  format: "groundwork-structural-results";
  version: 1;
  modelFingerprint: string;
  units: { length: "m"; force: "kN"; moment: "kN*m"; rotation: "rad" };
  axes: "global-y-up";
  forceConvention: "compression-positive";
  solver: { name: string; version?: string; runId: string; solvedAt: string; notes?: string };
  nodeResults: StructuralNodeResult[];
  memberResults: StructuralMemberResult[];
}
export interface StructuralResultImport { results?: StructuralExternalResults; errors: string[]; warnings: string[]; }
export interface StructuralResultComparison {
  memberId: string;
  combinationId: string;
  location: "start" | "end" | "envelope";
  metric: "axial" | "flexure" | "uncompared";
  unit: "kN" | "kN*m" | "";
  externalDemand?: number;
  screeningDemand?: number;
  difference?: number;
  differencePct?: number;
  comparisonScope: string;
}
export interface StructuralResultReview {
  matchesCurrentModel: boolean;
  errors: string[];
  warnings: string[];
  comparisons: StructuralResultComparison[];
  maximumDisplacementM: number;
  nodeCoverage: number;
  memberCoverage: number;
  verification: "not-verified";
}

export const MAX_STRUCTURAL_RESULT_BYTES = 6000000;
export const MAX_STRUCTURAL_RESULT_ROWS = 20000;
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const boundedText = (value: unknown, max: number, required = true): value is string => typeof value === "string" && value.length <= max && (!required || Boolean(value.trim()));
const vector = (value: unknown): value is StructuralVector => plain(value) && [value.x, value.y, value.z].every(item => typeof item === "number" && Number.isFinite(item)) && Number.isFinite(Math.hypot(Number(value.x), Number(value.y), Number(value.z)));
const copyVector = (value: StructuralVector): StructuralVector => ({ x: value.x, y: value.y, z: value.z });
const numericFields = ["axialKN", "shearYKN", "shearZKN", "torsionKNm", "momentYKNm", "momentZKNm"] as const;
const siUnits = { length: "m", force: "kN", moment: "kN*m", rotation: "rad" } as const;

/** Validate unknown JSON and copy only supported fields before adding results to the design. */
export function inspectStructuralResults(value: unknown, design: CommunityDesign, pkg = screenStructuralDesign(design)): StructuralResultImport {
  const errors: string[] = [], warnings: string[] = [];
  const error = (message: string) => { if (errors.length < 100) errors.push(message); };
  if (!plain(value)) return { errors: ["The result file must contain a JSON object."], warnings };
  if (value.format !== "groundwork-structural-results" || value.version !== 1) error("Unsupported structural result format/version.");
  if (value.modelFingerprint !== structuralModelFingerprint(design, pkg)) error("Model/load fingerprint differs from the current structural exchange. Results are stale or belong to another model.");
  if (!plain(value.units) || Object.entries(siUnits).some(([field, unit]) => (value.units as Record<string, unknown>)[field] !== unit)) error("Units must be length=m, force=kN, moment=kN*m and rotation=rad. Convert results before importing.");
  if (value.axes !== "global-y-up" || value.forceConvention !== "compression-positive") error("Results require global Y-up node axes and compression-positive axial forces. Member transverse axes remain solver-local.");
  if (!plain(value.solver) || !boundedText(value.solver.name, 80) || !boundedText(value.solver.runId, 160) || !boundedText(value.solver.solvedAt, 40) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(String(value.solver.solvedAt)) || !Number.isFinite(Date.parse(String(value.solver.solvedAt))) || (value.solver.version !== undefined && !boundedText(value.solver.version, 80, false)) || (value.solver.notes !== undefined && !boundedText(value.solver.notes, 2000, false))) error("Provide bounded solver name, run ID, ISO solved-at timestamp and optional version/notes.");
  if (!Array.isArray(value.nodeResults) || !Array.isArray(value.memberResults)) return { errors: [...errors, "nodeResults and memberResults must be arrays."], warnings };
  if (value.nodeResults.length + value.memberResults.length > MAX_STRUCTURAL_RESULT_ROWS) return { errors: [...errors, `Import at most ${MAX_STRUCTURAL_RESULT_ROWS} node/member result rows.`], warnings };
  const nodes = new Set(pkg.frame.nodes.map(node => node.id));
  const members = new Set(pkg.frame.members.map(member => member.id));
  const combinations = new Set(pkg.combinations.map(combination => combination.id));
  if (nodes.size !== pkg.frame.nodes.length || members.size !== pkg.frame.members.length || combinations.size !== pkg.combinations.length) error("Current structural model contains duplicate node/member/combination IDs; resolve them before importing.");
  if (pkg.frame.nodes.some(node => ![node.x, node.y, node.z].every(Number.isFinite)) || pkg.frame.members.some(member => ![member.widthM, member.depthM, member.lengthM].every(number => Number.isFinite(number) && number > 0)) || pkg.combinations.some(combination => ![combination.deadFactor, combination.liveFactor, combination.windFactor, combination.seismicFactor].every(Number.isFinite))) error("Current model geometry/load factors contain invalid numeric values.");
  if (pkg.members.some(member => ![member.demandKN, member.capacityKN, member.utilization, member.demandKNm ?? 0, member.capacityKNm ?? 0].every(Number.isFinite)) || pkg.foundations.some(foundation => ![foundation.demandKN, foundation.requiredAreaM2, foundation.providedAreaM2, foundation.bearingUtilization].every(Number.isFinite))) error("Current planning screens contain invalid numeric values; review model inputs before comparing results.");
  const nodeResults: StructuralNodeResult[] = [], memberResults: StructuralMemberResult[] = [];
  const seenNodes = new Set<string>(), seenMembers = new Set<string>();
  for (const [index, item] of value.nodeResults.entries()) {
    if (!plain(item) || !boundedText(item.nodeId, 200) || !boundedText(item.combinationId, 200) || !vector(item.displacementM) || (item.rotationRad !== undefined && !vector(item.rotationRad))) { error(`Node result ${index + 1}: IDs and finite displacement/rotation vectors are required.`); continue; }
    if (!nodes.has(item.nodeId)) error(`Node result ${index + 1}: unknown node ${item.nodeId}.`);
    if (!combinations.has(item.combinationId)) error(`Node result ${index + 1}: unknown combination ${item.combinationId}. Use exchange IDs, not labels.`);
    const id = JSON.stringify([item.nodeId, item.combinationId]);
    if (seenNodes.has(id)) error(`Duplicate node/combination result: ${item.nodeId} / ${item.combinationId}.`);
    seenNodes.add(id);
    nodeResults.push({ nodeId: item.nodeId, combinationId: item.combinationId, displacementM: copyVector(item.displacementM), ...(item.rotationRad && vector(item.rotationRad) ? { rotationRad: copyVector(item.rotationRad) } : {}) });
  }
  for (const [index, item] of value.memberResults.entries()) {
    if (!plain(item) || !boundedText(item.memberId, 200) || !boundedText(item.combinationId, 200) || numericFields.some(field => typeof item[field] !== "number" || !Number.isFinite(item[field])) || (item.location !== undefined && !["start", "end", "envelope"].includes(String(item.location)))) { error(`Member result ${index + 1}: IDs, finite forces/moments and a supported location are required.`); continue; }
    if (!members.has(item.memberId)) error(`Member result ${index + 1}: unknown member ${item.memberId}.`);
    if (!combinations.has(item.combinationId)) error(`Member result ${index + 1}: unknown combination ${item.combinationId}. Use exchange IDs, not labels.`);
    const location = (item.location ?? "envelope") as "start" | "end" | "envelope";
    const id = JSON.stringify([item.memberId, item.combinationId, location]);
    if (seenMembers.has(id)) error(`Duplicate member/combination/location result: ${item.memberId} / ${item.combinationId} / ${location}.`);
    seenMembers.add(id);
    memberResults.push({ memberId: item.memberId, combinationId: item.combinationId, location, axialKN: item.axialKN as number, shearYKN: item.shearYKN as number, shearZKN: item.shearZKN as number, torsionKNm: item.torsionKNm as number, momentYKNm: item.momentYKNm as number, momentZKNm: item.momentZKNm as number });
  }
  if (!nodeResults.length && !memberResults.length) error("The result file has no node or member results. The request template is not a solved result.");
  warnings.push("Imported results are external observations. Solver authenticity, boundary conditions, member local axes and professional review are not verified.");
  warnings.push("Coverage can be partial. Values do not certify strength, drift, connections, foundation design or regulatory compliance.");
  if (errors.length) return { errors, warnings };
  const solver = value.solver as Record<string, unknown>;
  return { results: { format: "groundwork-structural-results", version: 1, modelFingerprint: String(value.modelFingerprint), units: { ...siUnits }, axes: "global-y-up", forceConvention: "compression-positive", solver: { name: String(solver.name), runId: String(solver.runId), solvedAt: String(solver.solvedAt), ...(solver.version !== undefined ? { version: String(solver.version) } : {}), ...(solver.notes !== undefined ? { notes: String(solver.notes) } : {}) }, nodeResults, memberResults }, errors, warnings };
}

export function parseStructuralResults(text: string, design: CommunityDesign, pkg = screenStructuralDesign(design)): StructuralResultImport {
  if (new TextEncoder().encode(text).byteLength > MAX_STRUCTURAL_RESULT_BYTES) return { errors: ["Import structural results up to 6 MB."], warnings: [] };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { errors: ["The structural result file is not valid JSON."], warnings: [] }; }
  return inspectStructuralResults(value, design, pkg);
}

export function structuralResultTemplate(design: CommunityDesign, pkg = screenStructuralDesign(design)): string {
  return JSON.stringify({ format: "groundwork-structural-results", version: 1, modelFingerprint: structuralModelFingerprint(design, pkg), units: siUnits, axes: "global-y-up", forceConvention: "compression-positive", solver: { name: "", version: "", runId: "", solvedAt: "", notes: "Convert external solver output to this schema; use IDs from the matching structural model exchange." }, nodeResults: [], memberResults: [] }, null, 2);
}

export function reviewStructuralResults(results: StructuralExternalResults, design: CommunityDesign, pkg: StructuralDesignPackage = screenStructuralDesign(design)): StructuralResultReview {
  const checked = inspectStructuralResults(results, design, pkg);
  const valid = checked.results;
  if (!valid) return { matchesCurrentModel: false, errors: checked.errors, warnings: checked.warnings, comparisons: [], maximumDisplacementM: 0, nodeCoverage: 0, memberCoverage: 0, verification: "not-verified" };
  const screenById = new Map(pkg.members.map(member => [member.memberId, member]));
  const comparisons = valid.memberResults.map((result): StructuralResultComparison => {
    const screen = screenById.get(result.memberId);
    const metric = screen?.kind === "column" ? "axial" : screen?.kind === "beam" || screen?.kind === "slab" ? "flexure" : "uncompared";
    const externalDemand = metric === "axial" ? Math.abs(result.axialKN) : metric === "flexure" ? Math.max(Math.abs(result.momentYKNm), Math.abs(result.momentZKNm)) : undefined;
    const screeningDemand = metric === "axial" ? screen?.demandKN : metric === "flexure" ? screen?.demandKNm : undefined;
    const difference = externalDemand !== undefined && screeningDemand !== undefined ? externalDemand - screeningDemand : undefined;
    const percentage = difference !== undefined && screeningDemand !== undefined && screeningDemand > 1e-9 ? difference / screeningDemand * 100 : undefined;
    const differencePct = percentage !== undefined && Number.isFinite(percentage) ? percentage : undefined;
    return { memberId: result.memberId, combinationId: result.combinationId, location: result.location ?? "envelope", metric, unit: metric === "axial" ? "kN" : metric === "flexure" ? "kN*m" : "", externalDemand, screeningDemand, difference, differencePct, comparisonScope: metric === "uncompared" ? "No comparable member screening metric." : "External combination/station demand vs planning gravity screen. Screen is not a per-combination solver result; transverse local axes and envelope conventions require review." };
  });
  let maximumDisplacementM = 0;
  for (const result of valid.nodeResults) maximumDisplacementM = Math.max(maximumDisplacementM, Math.hypot(result.displacementM.x, result.displacementM.y, result.displacementM.z));
  return { matchesCurrentModel: true, errors: [], warnings: checked.warnings, comparisons, maximumDisplacementM, nodeCoverage: new Set(valid.nodeResults.map(result => result.nodeId)).size / Math.max(pkg.frame.nodes.length, 1), memberCoverage: new Set(valid.memberResults.map(result => result.memberId)).size / Math.max(pkg.frame.members.length, 1), verification: "not-verified" };
}
