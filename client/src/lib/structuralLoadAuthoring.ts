import { analyzeFrame3D, parseFrameModel3D, type FrameAnalysisReport3D, type FrameCombinationResult3D, type FrameMember3D, type FrameModel3D, type FrameNode3D, type Vector3D } from "./frameAnalysis3D";
import { ENGINEERING_STANDARD_REFERENCES, engineeringBasisFingerprint, parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis } from "./engineeringBasis";
import { engineeringRecord, identifier, requireFinite } from "./engineeringNumerics";

/** A supplied criterion is a project declaration, not a generated national-code rule. */
export type LoadSourceTrace =
  | { kind: "supplied"; source: string; statement: string }
  | { kind: "standard"; source: string; standardId: string; clause: string }
  | { kind: "criterion"; source: string; criterionId: string };
export interface StructuralScalar<U extends string> { value: number; unit: U; trace: LoadSourceTrace }
export interface StructuralVector<U extends string> { value: Vector3D; unit: U; trace: LoadSourceTrace }
export interface StructuralFrameGeometry { version: 1; analysis?: "linear"; nodes: FrameNode3D[]; members: FrameMember3D[] }
export interface StructuralPressureLoad { id: string; nodeId: string; areaM2: number; pressure: StructuralVector<"Pa"> }
export interface StructuralMassLoad { id: string; nodeId: string; massKg: number; acceleration: StructuralVector<"m/s2"> }
export interface StructuralSelfWeight { id: string; memberId: string; density: StructuralScalar<"kg/m3">; acceleration: StructuralVector<"m/s2"> }
export interface StructuralAuthoredCase { id: string; pressures: StructuralPressureLoad[]; masses: StructuralMassLoad[]; selfWeights: StructuralSelfWeight[] }
export interface StructuralAuthoredCombination { id: string; factors: { caseId: string; factor: StructuralScalar<"1"> }[] }
export interface StructuralStoryCriterion {
  id: string; lowerNodeId: string; upperNodeId: string; heightM: number; direction: Vector3D; combinationIds: string[];
  limit: StructuralScalar<"1">; amplification: StructuralScalar<"1">;
}
export interface StructuralLoadInput {
  version: 1; geometry: StructuralFrameGeometry; loadCases: StructuralAuthoredCase[];
  combinations: StructuralAuthoredCombination[]; stories: StructuralStoryCriterion[];
}
export interface StructuralGeneratedLoadTrace {
  sourceId: string; caseId: string; kind: "pressure" | "mass" | "self-weight"; targetId: string;
  unit: "N" | "N/m"; globalVector: Vector3D; localVector: Vector3D | null; traces: LoadSourceTrace[];
}
export interface StructuralFactorTrace { combinationId: string; caseId: string; factor: number; trace: LoadSourceTrace }
export interface StructuralStoryResult {
  storyId: string; combinationId: string; lowerTranslationM: number; upperTranslationM: number; chordTranslationM: number;
  signedProjectedDriftM: number; elasticDriftRatio: number; amplifiedDriftM: number; amplifiedDriftRatio: number;
  allowableDriftRatio: number; utilization: number; satisfiesSuppliedCriteria: boolean;
}
export interface StructuralStoryEnvelope {
  storyId: string; governingCombinationId: string; maximumAmplifiedDriftRatio: number;
  maximumUtilization: number; satisfiesSuppliedCriteria: boolean;
}
export interface StructuralLoadReport {
  version: 1; method: string; verification: "unverified"; compliance: "not-assessed";
  sourceKey: string; designBasis: EngineeringDesignBasis; generatedFrameModel: FrameModel3D;
  loadTrace: StructuralGeneratedLoadTrace[]; factorTrace: StructuralFactorTrace[]; frameReport: FrameAnalysisReport3D;
  drift: StructuralStoryResult[]; driftEnvelopes: StructuralStoryEnvelope[]; warnings: string[];
}

const method = "Explicit SI pressure, mass acceleration and member self-weight loads; signed linear combinations and authored node-pair drift criteria";
const maxSources = 200;
const dot = (a: Vector3D, b: Vector3D): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector3D, b: Vector3D): Vector3D => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scaled = (a: Vector3D, factor: number): Vector3D => [a[0] * factor, a[1] * factor, a[2] * factor];
function record(value: unknown, label: string, allowed: readonly string[]): Record<string, unknown> {
  if (!engineeringRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${label} contains invalid or unsupported fields.`);
  return value;
}
function text(value: unknown, label: string, maximum = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${label} requires non-empty bounded text.`);
  return value;
}
function id(value: unknown, label: string): string {
  if (!identifier(value)) throw new Error(`${label} requires a bounded identifier.`);
  return value;
}
function list(value: unknown, label: string, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error(`${label} requires ${minimum}-${maximum} entries.`);
  return value;
}
function vector(value: unknown, label: string, maximum = 1e8): Vector3D {
  const components = list(value, label, 3, 3).map(component => requireFinite(component, label, -maximum, maximum));
  return [components[0], components[1], components[2]];
}
function parseTrace(value: unknown): LoadSourceTrace {
  if (!engineeringRecord(value)) throw new Error("Load trace requires an object.");
  if (value.kind === "supplied") {
    const raw = record(value, "Supplied criterion trace", ["kind", "source", "statement"]);
    return { kind: "supplied", source: text(raw.source, "Criterion source"), statement: text(raw.statement, "Supplied criterion statement") };
  }
  if (value.kind === "standard") {
    const raw = record(value, "Standard trace", ["kind", "source", "standardId", "clause"]);
    return { kind: "standard", source: text(raw.source, "Standard input source"), standardId: id(raw.standardId, "Standard ID"), clause: text(raw.clause, "Standard clause", 200) };
  }
  const raw = record(value, "Basis criterion trace", ["kind", "source", "criterionId"]);
  if (raw.kind !== "criterion") throw new Error("Unsupported load trace kind.");
  return { kind: "criterion", source: text(raw.source, "Criterion input source"), criterionId: id(raw.criterionId, "Criterion ID") };
}
function scalar<U extends string>(value: unknown, unit: U, label: string, minimum: number, maximum: number): StructuralScalar<U> {
  const raw = record(value, label, ["value", "unit", "trace"]);
  if (raw.unit !== unit) throw new Error(`${label} requires ${unit}; unit conversion is explicit before import.`);
  return { value: requireFinite(raw.value, label, minimum, maximum), unit, trace: parseTrace(raw.trace) };
}
function vectorQuantity<U extends string>(value: unknown, unit: U, label: string): StructuralVector<U> {
  const raw = record(value, label, ["value", "unit", "trace"]);
  if (raw.unit !== unit) throw new Error(`${label} requires ${unit}.`);
  const trace = parseTrace(raw.trace);
  if (trace.kind === "criterion") throw new Error(`${label} is a three-component vector: use a standard clause or an explicit supplied vector criterion, not a scalar basis criterion.`);
  return { value: vector(raw.value, label), unit, trace };
}
function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} identifiers must be unique.`);
}
/** Strict bounded authoring schema. No hazard, importance, response or combination coefficient is inferred. */
export function parseStructuralLoadInput(value: unknown): StructuralLoadInput {
  const raw = record(value, "Structural loads", ["version", "geometry", "loadCases", "combinations", "stories"]);
  if (raw.version !== 1) throw new Error("Structural loads require version 1.");
  const geometryRaw = record(raw.geometry, "Frame geometry", ["version", "analysis", "nodes", "members"]);
  const geometryModel = parseFrameModel3D({ ...geometryRaw, loadCases: [{ id: "geometry-validation", nodal: [], uniform: [] }] });
  const geometry: StructuralFrameGeometry = { version: 1, ...(geometryModel.analysis === undefined ? {} : { analysis: geometryModel.analysis }), nodes: geometryModel.nodes, members: geometryModel.members };
  const nodeIds = new Set(geometry.nodes.map(node => node.id)), memberIds = new Set(geometry.members.map(member => member.id));
  const loadCases = list(raw.loadCases, "Authored load cases", 20, 1).map((value): StructuralAuthoredCase => {
    const item = record(value, "Authored case", ["id", "pressures", "masses", "selfWeights"]);
    const pressures = list(item.pressures, "Pressure loads", maxSources).map((value): StructuralPressureLoad => {
      const load = record(value, "Pressure load", ["id", "nodeId", "areaM2", "pressure"]), nodeId = id(load.nodeId, "Pressure node");
      if (!nodeIds.has(nodeId)) throw new Error("Pressure load references a missing node.");
      return { id: id(load.id, "Pressure source"), nodeId, areaM2: requireFinite(load.areaM2, "Tributary area (m2)", 1e-8, 1e8), pressure: vectorQuantity(load.pressure, "Pa", "Pressure vector") };
    });
    const masses = list(item.masses, "Point mass loads", maxSources).map((value): StructuralMassLoad => {
      const load = record(value, "Point mass", ["id", "nodeId", "massKg", "acceleration"]), nodeId = id(load.nodeId, "Mass node");
      if (!nodeIds.has(nodeId)) throw new Error("Point mass references a missing node.");
      return { id: id(load.id, "Mass source"), nodeId, massKg: requireFinite(load.massKg, "Point mass (kg)", 1e-8, 1e10), acceleration: vectorQuantity(load.acceleration, "m/s2", "Point mass acceleration") };
    });
    const selfWeights = list(item.selfWeights, "Member self-weight", maxSources).map((value): StructuralSelfWeight => {
      const load = record(value, "Member self-weight", ["id", "memberId", "density", "acceleration"]), memberId = id(load.memberId, "Self-weight member");
      if (!memberIds.has(memberId)) throw new Error("Self-weight references a missing member.");
      return { id: id(load.id, "Self-weight source"), memberId, density: scalar(load.density, "kg/m3", "Member mass density", 1e-8, 1e6), acceleration: vectorQuantity(load.acceleration, "m/s2", "Self-weight acceleration") };
    });
    if (!pressures.length && !masses.length && !selfWeights.length) throw new Error("Each authored load case requires at least one source, including an explicitly zero vector if intentional.");
    return { id: id(item.id, "Load case"), pressures, masses, selfWeights };
  });
  unique(loadCases.map(item => item.id), "Load case");
  const sources = loadCases.flatMap(item => [...item.pressures, ...item.masses, ...item.selfWeights]);
  if (sources.length > maxSources) throw new Error(`At most ${maxSources} total authored load sources are supported.`);
  unique(sources.map(item => item.id), "Authored source");
  const caseIds = new Set(loadCases.map(item => item.id));
  const combinations = list(raw.combinations, "Authored combinations", 20, 1).map((value): StructuralAuthoredCombination => {
    const item = record(value, "Authored combination", ["id", "factors"]);
    const factors = list(item.factors, "Signed case factors", 20, 1).map(value => {
      const factor = record(value, "Case factor", ["caseId", "factor"]), caseId = id(factor.caseId, "Factored case");
      if (!caseIds.has(caseId)) throw new Error("Combination references a missing load case.");
      return { caseId, factor: scalar(factor.factor, "1", "Signed combination factor", -100, 100) };
    });
    unique(factors.map(item => item.caseId), "Combination case");
    if (factors.every(item => item.factor.value === 0)) throw new Error("A combination requires at least one nonzero factor.");
    return { id: id(item.id, "Combination"), factors };
  });
  unique(combinations.map(item => item.id), "Combination");
  const combinationIds = new Set(combinations.map(item => item.id));
  const stories = list(raw.stories, "Authored story checks", 40).map((value): StructuralStoryCriterion => {
    const item = record(value, "Story criterion", ["id", "lowerNodeId", "upperNodeId", "heightM", "direction", "combinationIds", "limit", "amplification"]);
    const lowerNodeId = id(item.lowerNodeId, "Lower story node"), upperNodeId = id(item.upperNodeId, "Upper story node");
    if (!nodeIds.has(lowerNodeId) || !nodeIds.has(upperNodeId) || lowerNodeId === upperNodeId) throw new Error("Story checks require two distinct existing nodes.");
    const direction = vector(item.direction, "Drift projection direction", 1);
    if (Math.abs(Math.hypot(...direction) - 1) > 1e-8) throw new Error("Story drift direction must be a supplied unit vector; it is not automatically normalized.");
    const ids = list(item.combinationIds, "Story combinations", 20, 1).map(value => id(value, "Story combination"));
    unique(ids, "Story combination");
    if (ids.some(value => !combinationIds.has(value))) throw new Error("Story check references a missing combination.");
    return { id: id(item.id, "Story check"), lowerNodeId, upperNodeId, heightM: requireFinite(item.heightM, "Supplied story height (m)", 1e-5, 1e6), direction, combinationIds: ids,
      limit: scalar(item.limit, "1", "Supplied allowable drift ratio", 1e-10, 1), amplification: scalar(item.amplification, "1", "Supplied displacement amplification", 1e-8, 1000) };
  });
  unique(stories.map(item => item.id), "Story check");
  return { version: 1, geometry, loadCases, combinations, stories };
}

/** Stable source comparison only; deliberately not a tamper-proof digest. */
function canonical(value: unknown): string {
  const order = (value: unknown): unknown => Array.isArray(value) ? value.map(order) : engineeringRecord(value)
    ? Object.fromEntries(Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => [key, order(value[key])])) : value;
  return JSON.stringify(order(value));
}
function checkTrace(trace: LoadSourceTrace, basis: EngineeringDesignBasis, quantity?: { value: number; unit: string }): void {
  if (trace.kind === "standard") {
    const standards = basis.standards.filter(item => item.id === trace.standardId);
    if (!basis.countryCode || standards.length !== 1 || !standards[0].edition.trim() || !standards[0].adoptionReference.trim()) throw new Error(`Trace ${trace.standardId} must reference one adopted standard with an explicit country, edition and adoption declaration.`);
    const standard = standards[0], reference = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === standard.id);
    if (reference && (reference.countryCode !== basis.countryCode || reference.code !== standard.code || reference.domain !== standard.domain || !reference.editions.includes(standard.edition) || reference.sourceUrl !== standard.sourceUrl)) throw new Error(`Trace ${trace.standardId} does not match its declared country, catalog edition or publisher. Other editions require a custom adopted reference.`);
  }
  if (trace.kind === "criterion") {
    const criteria = basis.criteria.filter(item => item.id === trace.criterionId);
    if (criteria.length !== 1 || criteria[0].module !== "frame" || !quantity || criteria[0].unit !== quantity.unit || criteria[0].value !== quantity.value || !criteria[0].source.trim()) throw new Error(`Trace ${trace.criterionId} must match one frame criterion's scalar value, SI unit and source exactly.`);
    if (criteria[0].standardId) {
      if (!criteria[0].clause?.trim()) throw new Error(`Criterion ${trace.criterionId} requires its adopted standard clause.`);
      checkTrace({ kind: "standard", source: criteria[0].source, standardId: criteria[0].standardId, clause: criteria[0].clause }, basis);
    }
  }
}
function localAxes(geometry: StructuralFrameGeometry, member: FrameMember3D): [Vector3D, Vector3D, Vector3D] {
  const a = geometry.nodes.find(node => node.id === member.start)!, b = geometry.nodes.find(node => node.id === member.end)!;
  const delta: Vector3D = [b.xM - a.xM, b.yM - a.yM, b.zM - a.zM], x = scaled(delta, 1 / Math.hypot(...delta));
  const reference = scaled(member.localYAxis, 1 / Math.hypot(...member.localYAxis)), projection = dot(x, reference);
  const projected: Vector3D = [reference[0] - projection * x[0], reference[1] - projection * x[1], reference[2] - projection * x[2]];
  const y = scaled(projected, 1 / Math.hypot(...projected)), z = cross(x, y);
  return [x, y, scaled(z, 1 / Math.hypot(...z))];
}
function generate(input: StructuralLoadInput, basis: EngineeringDesignBasis) {
  const loadTrace: StructuralGeneratedLoadTrace[] = [], factorTrace: StructuralFactorTrace[] = [];
  const loadCases = input.loadCases.map(loadCase => {
    const nodal = [...loadCase.pressures.map(load => {
      checkTrace(load.pressure.trace, basis);
      const globalVector = scaled(load.pressure.value, load.areaM2);
      loadTrace.push({ sourceId: load.id, caseId: loadCase.id, kind: "pressure", targetId: load.nodeId, unit: "N", globalVector, localVector: null, traces: [load.pressure.trace] });
      return { node: load.nodeId, fxN: globalVector[0], fyN: globalVector[1], fzN: globalVector[2], mxNm: 0, myNm: 0, mzNm: 0 };
    }), ...loadCase.masses.map(load => {
      checkTrace(load.acceleration.trace, basis);
      const globalVector = scaled(load.acceleration.value, load.massKg);
      loadTrace.push({ sourceId: load.id, caseId: loadCase.id, kind: "mass", targetId: load.nodeId, unit: "N", globalVector, localVector: null, traces: [load.acceleration.trace] });
      return { node: load.nodeId, fxN: globalVector[0], fyN: globalVector[1], fzN: globalVector[2], mxNm: 0, myNm: 0, mzNm: 0 };
    })];
    const uniform = loadCase.selfWeights.map(load => {
      checkTrace(load.density.trace, basis, load.density); checkTrace(load.acceleration.trace, basis);
      const member = input.geometry.members.find(item => item.id === load.memberId)!, globalVector = scaled(load.acceleration.value, load.density.value * member.areaM2);
      const axes = localAxes(input.geometry, member), localVector: Vector3D = [dot(globalVector, axes[0]), dot(globalVector, axes[1]), dot(globalVector, axes[2])];
      loadTrace.push({ sourceId: load.id, caseId: loadCase.id, kind: "self-weight", targetId: load.memberId, unit: "N/m", globalVector, localVector, traces: [load.density.trace, load.acceleration.trace] });
      return { member: load.memberId, axialNPerM: localVector[0], yNPerM: localVector[1], zNPerM: localVector[2] };
    });
    return { id: loadCase.id, nodal, uniform };
  });
  const combinations = input.combinations.map(combination => ({ id: combination.id, factors: Object.fromEntries(combination.factors.map(item => {
    checkTrace(item.factor.trace, basis, item.factor);
    factorTrace.push({ combinationId: combination.id, caseId: item.caseId, factor: item.factor.value, trace: item.factor.trace });
    return [item.caseId, item.factor.value];
  })) }));
  input.stories.forEach(story => { checkTrace(story.limit.trace, basis, story.limit); checkTrace(story.amplification.trace, basis, story.amplification); });
  const generatedFrameModel = parseFrameModel3D({ ...input.geometry, loadCases, combinations });
  return { generatedFrameModel, loadTrace, factorTrace };
}
function storyRow(story: StructuralStoryCriterion, result: FrameCombinationResult3D): StructuralStoryResult {
  const lower = result.displacements.find(item => item.nodeId === story.lowerNodeId)!, upper = result.displacements.find(item => item.nodeId === story.upperNodeId)!;
  const chord: Vector3D = [upper.uxM - lower.uxM, upper.uyM - lower.uyM, upper.uzM - lower.uzM], signedProjectedDriftM = dot(chord, story.direction);
  const amplifiedDriftM = Math.abs(signedProjectedDriftM) * story.amplification.value, amplifiedDriftRatio = amplifiedDriftM / story.heightM;
  const utilization = amplifiedDriftRatio / story.limit.value;
  for (const value of [...chord, signedProjectedDriftM, amplifiedDriftM, amplifiedDriftRatio, utilization]) requireFinite(value, "Story drift output", -1e250, 1e250);
  return { storyId: story.id, combinationId: result.combinationId,
    lowerTranslationM: Math.hypot(lower.uxM, lower.uyM, lower.uzM), upperTranslationM: Math.hypot(upper.uxM, upper.uyM, upper.uzM), chordTranslationM: Math.hypot(...chord),
    signedProjectedDriftM, elasticDriftRatio: Math.abs(signedProjectedDriftM) / story.heightM, amplifiedDriftM, amplifiedDriftRatio,
    allowableDriftRatio: story.limit.value, utilization, satisfiesSuppliedCriteria: utilization <= 1 };
}
function storyEnvelope(story: StructuralStoryCriterion, rows: StructuralStoryResult[]): StructuralStoryEnvelope {
  const selected = rows.filter(row => row.storyId === story.id), governing = selected.reduce((maximum, row) => row.utilization > maximum.utilization ? row : maximum);
  return { storyId: story.id, governingCombinationId: governing.combinationId, maximumAmplifiedDriftRatio: governing.amplifiedDriftRatio, maximumUtilization: governing.utilization, satisfiesSuppliedCriteria: governing.utilization <= 1 };
}
/** Called only by an explicit Calculate action. Restore validation below never calls this or the solver. */
export function analyzeStructuralLoads(value: StructuralLoadInput, designBasis: EngineeringDesignBasis): StructuralLoadReport {
  const input = parseStructuralLoadInput(value), basis = parseEngineeringDesignBasis(designBasis), generated = generate(input, basis);
  const frameReport = analyzeFrame3D(generated.generatedFrameModel);
  const drift = input.stories.flatMap(story => story.combinationIds.map(combinationId => storyRow(story, frameReport.results.find(item => item.combinationId === combinationId)!)));
  return { version: 1, method, verification: "unverified", compliance: "not-assessed", sourceKey: canonical(input), designBasis: basis, ...generated, frameReport, drift,
    driftEnvelopes: input.stories.map(story => storyEnvelope(story, drift)), warnings: [
      "Pressure times tributary area and point mass times the supplied acceleration are global nodal forces. No eccentricity, diaphragm distribution or equivalent static seismic pattern is inferred.",
      "Member density times area times supplied acceleration is a global uniform force per length, projected onto the exact 3D frame local axes. Duplicate sources add; check tributary areas, overlapping masses and self-weight for double counting.",
      "Acceleration is the signed equivalent load acceleration in global axes. Supply the desired force direction; support-motion sign, seismic reduction, periods, hazard maps, spectra and response combination are not generated.",
      "Every signed case factor and drift limit/amplification is supplied. Wind/seismic/gravity national load generators, accidental torsion, diaphragm constraints, P-Delta, dynamic analysis and national-code compliance remain unsupported.",
      "Story results use only the authored node pair, supplied height, projection direction and selected combinations. Total nodal translation is separate from relative chord translation and projected drift. No floor or diaphragm averaging is performed.",
      "An adopted-standard or criterion trace records the declared source; it does not verify the supplied number or the applicability of its clause. All calculations and source-only changes remain unverified.",
      ...validateEngineeringDesignBasis(basis).map(issue => `Design basis declaration: ${issue}`), ...frameReport.warnings,
    ] };
}

function exactRows(value: unknown, label: string, key: string, expected: string[]): Record<string, unknown>[] {
  const rows = list(value, label, expected.length, expected.length);
  const seen = new Set<string>();
  return rows.map(value => {
    if (!engineeringRecord(value) || typeof value[key] !== "string" || !expected.includes(value[key] as string) || seen.has(value[key] as string)) throw new Error(`${label} has missing, duplicate or foreign identifiers.`);
    seen.add(value[key] as string); return value;
  });
}
function numericFields(row: Record<string, unknown>, keys: readonly string[], minimum = -1e250, maximum = 1e250): void { keys.forEach(key => requireFinite(row[key], key, minimum, maximum)); }
function warningList(value: unknown): void { list(value, "Warnings", 512).forEach(value => text(value, "Warning", 4000)); }
function parseGeneratedTrace(value: unknown): StructuralGeneratedLoadTrace {
  const row = record(value, "Generated load trace", ["sourceId", "caseId", "kind", "targetId", "unit", "globalVector", "localVector", "traces"]);
  if (row.kind !== "pressure" && row.kind !== "mass" && row.kind !== "self-weight") throw new Error("Unknown generated load kind.");
  if (row.unit !== (row.kind === "self-weight" ? "N/m" : "N")) throw new Error("Generated load units differ from the load kind.");
  const localVector = row.localVector === null ? null : vector(row.localVector, "Generated local load", 1e12);
  if ((row.kind === "self-weight") !== (localVector !== null)) throw new Error("Only uniform self-weight loads have local load vectors.");
  return { sourceId: id(row.sourceId, "Generated source"), caseId: id(row.caseId, "Generated case"), kind: row.kind, targetId: id(row.targetId, "Generated target"), unit: row.unit as "N" | "N/m",
    globalVector: vector(row.globalVector, "Generated global load", 1e18), localVector, traces: list(row.traces, "Generated source traces", 2, 1).map(parseTrace) };
}
function parseFactorTrace(value: unknown): StructuralFactorTrace {
  const row = record(value, "Generated factor trace", ["combinationId", "caseId", "factor", "trace"]);
  return { combinationId: id(row.combinationId, "Generated combination"), caseId: id(row.caseId, "Generated factored case"), factor: requireFinite(row.factor, "Generated factor", -100, 100), trace: parseTrace(row.trace) };
}
function validateFrameReport(value: unknown, model: FrameModel3D): FrameAnalysisReport3D {
  const report = record(value, "Generated frame report", ["version", "method", "verification", "results", "envelopes", "warnings"]);
  if (report.version !== 1 || report.verification !== "unverified") throw new Error("Unsupported generated frame report scope.");
  if (report.method !== "3D linear elastic Euler-Bernoulli direct stiffness; axial, Saint-Venant torsion and biaxial bending") throw new Error("Unsupported generated frame analysis method.");
  warningList(report.warnings);
  const combinationIds = model.combinations!.map(item => item.id), nodeIds = model.nodes.map(item => item.id), memberIds = model.members.map(item => item.id);
  const reactionIds = model.nodes.filter(item => item.restraints.some(Boolean)).map(item => item.id);
  const displacementKeys = ["uxM", "uyM", "uzM", "rxRad", "ryRad", "rzRad"], forceKeys = ["fxN", "fyN", "fzN", "mxNm", "myNm", "mzNm"];
  const peaks = ["maxAxialTensionN", "maxAxialCompressionN", "maxShearYN", "maxShearZN", "maxTorsionNm", "maxMomentYNm", "maxMomentZNm", "maxChordDeflectionM", "chordDeflectionUpperBoundM"];
  for (const row of exactRows(report.results, "Frame combinations", "combinationId", combinationIds)) {
    record(row, "Frame combination", ["combinationId", "status", "maxFreeForceResidualN", "maxFreeMomentResidualNm", "equilibrium", "displacements", "reactions", "members"]);
    if (row.status !== "converged") throw new Error("Only converged source-bound frame reports are supported.");
    numericFields(row, ["maxFreeForceResidualN", "maxFreeMomentResidualNm"], 0);
    const equilibrium = record(row.equilibrium, "Equilibrium", ["originM", ...forceKeys, "relativeForceResidual", "relativeMomentResidual"]);
    numericFields(equilibrium, forceKeys); numericFields(equilibrium, ["relativeForceResidual", "relativeMomentResidual"], 0, 1e-7);
    if (canonical(vector(equilibrium.originM, "Equilibrium origin", 1e6)) !== canonical([model.nodes[0].xM, model.nodes[0].yM, model.nodes[0].zM])) throw new Error("Equilibrium origin differs from source.");
    for (const displacement of exactRows(row.displacements, "Displacements", "nodeId", nodeIds)) {
      record(displacement, "Displacement", ["nodeId", ...displacementKeys]); numericFields(displacement, displacementKeys);
      const node = model.nodes.find(item => item.id === displacement.nodeId)!;
      if (displacementKeys.some((key, index) => node.restraints[index] && displacement[key] !== 0)) throw new Error("A restrained degree of freedom has a nonzero saved displacement.");
    }
    for (const reaction of exactRows(row.reactions, "Reactions", "nodeId", reactionIds)) {
      record(reaction, "Reaction", ["nodeId", ...forceKeys]); numericFields(reaction, forceKeys);
      const node = model.nodes.find(item => item.id === reaction.nodeId)!;
      if (forceKeys.some((key, index) => !node.restraints[index] && reaction[key] !== 0)) throw new Error("A free degree of freedom has a nonzero saved support reaction.");
    }
    for (const member of exactRows(row.members, "Member results", "memberId", memberIds)) {
      record(member, "Member result", ["memberId", "localEndForces", ...peaks, "design"]); numericFields(member, peaks, 0);
      list(member.localEndForces, "Member end forces", 12, 12).forEach(value => requireFinite(value, "Member end force", -1e250, 1e250));
      if (Number(member.chordDeflectionUpperBoundM) < Number(member.maxChordDeflectionM)) throw new Error("Saved chord bound is below its sampled deflection.");
      const original = model.members.find(item => item.id === member.memberId)!;
      if ((original.design === undefined) !== (member.design === undefined)) throw new Error("Saved member criteria differ from source.");
      if (member.design !== undefined) {
        const keys = ["axialBendingUtilization", "shearYUtilization", "shearZUtilization", "torsionUtilization", "deflectionUtilization"];
        const design = record(member.design, "Member criteria", [...keys, "satisfiesUserCriteria", "basis"]); numericFields(design, keys, 0); text(design.basis, "Member criteria basis", 4000);
        if (design.satisfiesUserCriteria !== (Math.max(...keys.map(key => Number(design[key]))) <= 1)) throw new Error("Saved member criterion status is inconsistent.");
      }
    }
  }
  const envelopes = record(report.envelopes, "Frame envelopes", ["nodes", "members"]);
  const checkPeaks = (row: Record<string, unknown>, key: string, keys: string[]) => {
    record(row, "Frame envelope", [key, ...keys]);
    for (const field of keys) {
      const peak = record(row[field], "Envelope peak", ["value", "combinationId"]); numericFields(peak, ["value"], 0);
      if (typeof peak.combinationId !== "string" || !combinationIds.includes(peak.combinationId)) throw new Error("Envelope references a foreign combination.");
    }
  };
  exactRows(envelopes.nodes, "Node envelopes", "nodeId", nodeIds).forEach(row => checkPeaks(row, "nodeId", ["maxTranslationM", "maxRotationRad"]));
  exactRows(envelopes.members, "Member envelopes", "memberId", memberIds).forEach(row => checkPeaks(row, "memberId", peaks));
  const normalized = report as unknown as FrameAnalysisReport3D;
  const peak = (read: (result: FrameCombinationResult3D) => number) => {
    const orderedResults = combinationIds.map(combinationId => normalized.results.find(item => item.combinationId === combinationId)!);
    return orderedResults.reduce((maximum, result) => read(result) > maximum.value ? { value: read(result), combinationId: result.combinationId } : maximum, { value: -1, combinationId: "" });
  };
  for (const row of normalized.envelopes.nodes) {
    const expectedTranslation = peak(result => { const node = result.displacements.find(item => item.nodeId === row.nodeId)!; return Math.hypot(node.uxM, node.uyM, node.uzM); });
    const expectedRotation = peak(result => { const node = result.displacements.find(item => item.nodeId === row.nodeId)!; return Math.hypot(node.rxRad, node.ryRad, node.rzRad); });
    if (canonical(row.maxTranslationM) !== canonical(expectedTranslation) || canonical(row.maxRotationRad) !== canonical(expectedRotation)) throw new Error("Saved node envelopes disagree with saved combination results.");
  }
  for (const row of normalized.envelopes.members) for (const field of peaks) {
    const expected = peak(result => Number((result.members.find(item => item.memberId === row.memberId)! as unknown as Record<string, unknown>)[field]));
    if (canonical((row as unknown as Record<string, unknown>)[field]) !== canonical(expected)) throw new Error("Saved member envelopes disagree with saved combination results.");
  }
  return normalized;
}
/** Restore-only validation. Checks bounded structure/source bindings and saved arithmetic; never assembles or solves a frame. */
export function validateStructuralLoadReport(value: unknown, source: StructuralLoadInput, designBasis: EngineeringDesignBasis): value is StructuralLoadReport {
  try {
    const input = parseStructuralLoadInput(source), basis = parseEngineeringDesignBasis(designBasis);
    const report = record(value, "Structural load report", ["version", "method", "verification", "compliance", "sourceKey", "designBasis", "generatedFrameModel", "loadTrace", "factorTrace", "frameReport", "drift", "driftEnvelopes", "warnings"]);
    if (report.version !== 1 || report.method !== method || report.verification !== "unverified" || report.compliance !== "not-assessed" || report.sourceKey !== canonical(input)) return false;
    const capturedBasis = parseEngineeringDesignBasis(report.designBasis);
    if (canonical(report.designBasis) !== canonical(capturedBasis) || engineeringBasisFingerprint(capturedBasis) !== engineeringBasisFingerprint(basis)) return false;
    warningList(report.warnings);
    // Deterministic load/source arithmetic is checked; no analysis is recalculated on restore.
    const expected = generate(input, basis), generatedModel = parseFrameModel3D(report.generatedFrameModel);
    const loadTrace = list(report.loadTrace, "Saved generated loads", expected.loadTrace.length, expected.loadTrace.length).map(parseGeneratedTrace);
    const factorTrace = list(report.factorTrace, "Saved generated factors", expected.factorTrace.length, expected.factorTrace.length).map(parseFactorTrace);
    if (canonical(generatedModel) !== canonical(expected.generatedFrameModel) || canonical(loadTrace) !== canonical(expected.loadTrace) || canonical(factorTrace) !== canonical(expected.factorTrace)) return false;
    const frameReport = validateFrameReport(report.frameReport, generatedModel);
    const rows = list(report.drift, "Story results", 800, input.stories.reduce((total, story) => total + story.combinationIds.length, 0));
    if (rows.length !== input.stories.reduce((total, story) => total + story.combinationIds.length, 0)) return false;
    const expectedRows = input.stories.flatMap(story => story.combinationIds.map(combinationId => storyRow(story, frameReport.results.find(item => item.combinationId === combinationId)!)));
    for (const value of rows) {
      const row = record(value, "Saved story result", ["storyId", "combinationId", "lowerTranslationM", "upperTranslationM", "chordTranslationM", "signedProjectedDriftM", "elasticDriftRatio", "amplifiedDriftM", "amplifiedDriftRatio", "allowableDriftRatio", "utilization", "satisfiesSuppliedCriteria"]);
      id(row.storyId, "Saved story"); id(row.combinationId, "Saved story combination");
      numericFields(row, ["lowerTranslationM", "upperTranslationM", "chordTranslationM", "elasticDriftRatio", "amplifiedDriftM", "amplifiedDriftRatio", "allowableDriftRatio", "utilization"], 0); numericFields(row, ["signedProjectedDriftM"]);
      if (typeof row.satisfiesSuppliedCriteria !== "boolean") return false;
    }
    if (canonical(rows) !== canonical(expectedRows)) return false;
    const expectedEnvelopes = input.stories.map(story => storyEnvelope(story, expectedRows));
    const savedEnvelopes = list(report.driftEnvelopes, "Saved drift envelopes", input.stories.length, input.stories.length);
    for (const value of savedEnvelopes) {
      const row = record(value, "Saved drift envelope", ["storyId", "governingCombinationId", "maximumAmplifiedDriftRatio", "maximumUtilization", "satisfiesSuppliedCriteria"]);
      id(row.storyId, "Saved drift story"); id(row.governingCombinationId, "Saved governing combination"); numericFields(row, ["maximumAmplifiedDriftRatio", "maximumUtilization"], 0);
      if (typeof row.satisfiesSuppliedCriteria !== "boolean") return false;
    }
    return canonical(savedEnvelopes) === canonical(expectedEnvelopes);
  } catch { return false; }
}

/** Demonstration inputs only; no national coefficients or suggested project limits. */
export function structuralLoadExample(): StructuralLoadInput {
  const supplied = (statement: string): LoadSourceTrace => ({ kind: "supplied", source: "Demonstration only; replace with reviewed project input", statement });
  return {
    version: 1, geometry: { version: 1, analysis: "linear",
      nodes: [{ id: "base", xM: 0, yM: 0, zM: 0, restraints: [true, true, true, true, true, true] }, { id: "top", xM: 0, yM: 0, zM: 3, restraints: [false, false, false, false, false, false] }],
      members: [{ id: "column", start: "base", end: "top", areaM2: 0.02, inertiaYM4: 0.0001, inertiaZM4: 0.0001, torsionConstantM4: 0.0002, elasticModulusPa: 200e9, shearModulusPa: 80e9, localYAxis: [0, 1, 0] }] },
    loadCases: [
      { id: "gravity", pressures: [], masses: [], selfWeights: [{ id: "column-mass", memberId: "column", density: { value: 7800, unit: "kg/m3", trace: supplied("Illustrative mass density 7800 kg/m3") }, acceleration: { value: [0, 0, -9.81], unit: "m/s2", trace: supplied("Illustrative signed gravity load acceleration [0,0,-9.81] m/s2") } }] },
      { id: "pressure", pressures: [{ id: "facade", nodeId: "top", areaM2: 4, pressure: { value: [500, 0, 0], unit: "Pa", trace: supplied("Illustrative project pressure vector [500,0,0] Pa; no wind generator") } }], masses: [], selfWeights: [] },
      { id: "equivalent-acceleration", pressures: [], masses: [{ id: "roof-mass", nodeId: "top", massKg: 1000, acceleration: { value: [0.5, 0, 0], unit: "m/s2", trace: supplied("Illustrative equivalent load acceleration [0.5,0,0] m/s2; no seismic generator") } }], selfWeights: [] },
    ],
    combinations: [
      { id: "pressure-positive", factors: [{ caseId: "gravity", factor: { value: 1, unit: "1", trace: supplied("Illustrative gravity factor +1") } }, { caseId: "pressure", factor: { value: 1, unit: "1", trace: supplied("Illustrative pressure factor +1") } }] },
      { id: "acceleration-negative", factors: [{ caseId: "gravity", factor: { value: 1, unit: "1", trace: supplied("Illustrative gravity factor +1") } }, { caseId: "equivalent-acceleration", factor: { value: -1, unit: "1", trace: supplied("Illustrative reversed acceleration factor -1") } }] },
    ],
    stories: [{ id: "story-x", lowerNodeId: "base", upperNodeId: "top", heightM: 3, direction: [1, 0, 0], combinationIds: ["pressure-positive", "acceleration-negative"],
      limit: { value: 0.01, unit: "1", trace: supplied("Illustrative ratio criterion 0.01, not a national-code limit") }, amplification: { value: 1, unit: "1", trace: supplied("Illustrative amplification 1; no code factor inferred") } }],
  };
}
