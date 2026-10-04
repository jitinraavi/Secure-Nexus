import { ENGINEERING_BASIS_PROFILE_VERSION, ENGINEERING_STANDARD_REFERENCES, engineeringBasisFingerprint, parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis } from "./engineeringBasis";
import { engineeringRecord, finiteNumber, identifier } from "./engineeringNumerics";
import { parseFrameModel3D, type FrameCombination3D, type FrameModel3D } from "./frameAnalysis3D";

export interface USGravityLoadRecipeInput {
  version: 1; method: "LRFD" | "ASD"; model: FrameModel3D; modelSource: string;
  deadCaseId: string; imposedCaseId: string; deadLoadSource: string; imposedLoadSource: string;
  nominalActionsConfirmed: true; gravityScopeReviewed: true; scopeReviewSource: string;
  roofLiveSnowRainAbsent: true; otherActionsExcludedAcknowledged: true; omittedActionReviewSource: string;
  amendmentScopeConfirmed: true; amendmentReviewSource: string; errataApplicabilityReviewed: true; errataReviewSource: string;
}
export interface USGravityCombinationTrace {
  combinationId: string; method: "LRFD" | "ASD"; clause: string; purpose: string;
  factors: Record<string, number>; primarySource: string;
}
export interface USGravityLoadRecipeReport {
  version: 1; implementation: "ASCE7-2022-basic-DL-gravity-v1"; verification: "unverified"; compliance: "not-assessed";
  source: USGravityLoadRecipeInput; basis: EngineeringDesignBasis; status: "generated-subset" | "unsupported-basis";
  basisIssues: string[]; implementedClauses: string[]; generatedFrameModel: FrameModel3D | null;
  combinations: USGravityCombinationTrace[]; warnings: string[];
}
const IMPLEMENTATION = "ASCE7-2022-basic-DL-gravity-v1";
const PRIMARY_SOURCE = "https://amplify.asce.org/content/standard/9780784415788/part/provisions/standard-chapter/s2";
const INPUT_KEYS = ["version", "method", "model", "modelSource", "deadCaseId", "imposedCaseId", "deadLoadSource", "imposedLoadSource", "nominalActionsConfirmed", "gravityScopeReviewed", "scopeReviewSource", "roofLiveSnowRainAbsent", "otherActionsExcludedAcknowledged", "omittedActionReviewSource", "amendmentScopeConfirmed", "amendmentReviewSource", "errataApplicabilityReviewed", "errataReviewSource"];
const WARNINGS = [
  "Two identified basic D/L gravity rows only; this is not complete ASCE/SEI 7-22 combination coverage or a governing-load assessment.",
  "Roof live, snow and rain are explicitly declared absent from the reviewed gravity subsystem. Wind, tornado, seismic, fluid, soil/water, ice, self-straining, extraordinary, integrity and other actions are excluded from this recipe and require separate applicability review and combinations.",
  "D and occupancy L are explicit authored nominal actions. No loads, self-weight, hazards, live-load reductions, occupancy exceptions, impact, spatial patterns, absent-action cases, favorable/adverse effects or minimum dead action are inferred.",
  "Generated factors replace the source model's combinations in an editable draft. The captured source retains those original combinations as provenance; no solver, resistance check or engineering compliance assessment is performed.",
  "ASD rows are allowable-stress load combinations, not a general serviceability recipe. No allowable-stress increase, serviceability limit or material resistance factor is supplied.",
  "Adoption, local amendments, publisher supplements/errata and compatibility with the chosen material design method are externally reviewed declarations. Source inspection only; execution and independent engineering validation remain outstanding.",
] as const;

function record(value: unknown, path: string): Record<string, unknown> {
  if (!engineeringRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
}
function fields(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${path} contains unsupported fields.`);
}
function text(value: unknown, path: string, maximum = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${path} requires bounded non-empty text.`);
  return value;
}
function id(value: unknown, path: string): string {
  if (!identifier(value) || !value.trim()) throw new Error(`${path} requires a non-empty identifier of at most 100 characters.`);
  return value;
}
function list(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${path} requires a bounded array.`);
  for (let index = 0; index < value.length; index++) if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error(`${path} cannot contain sparse entries.`);
  if (Object.keys(value).some(key => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new Error(`${path} cannot contain extra fields.`);
  return value;
}
/** Reject values JSON serialization would omit/coerce before detaching any authored model. */
function finiteJSON(value: unknown): void {
  let count = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++count > 40000 || depth > 12) throw new Error("Recipe data exceeds the bounded JSON scope.");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "number") { if (!finiteNumber(item) || Math.abs(item) > 1e18) throw new Error("Recipe numbers must be finite and bounded."); return; }
    if (typeof item === "string") { if (item.length > 4000) throw new Error("Recipe text exceeds its JSON bound."); return; }
    if (Array.isArray(item)) { for (const child of list(item, "recipe array", 1000)) visit(child, depth + 1); return; }
    if (!engineeringRecord(item) || (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) throw new Error("Recipe data must contain plain JSON values only.");
    const keys = Object.keys(item); if (keys.length > 1000) throw new Error("Recipe object exceeds its field bound.");
    for (const key of keys) visit(item[key], depth + 1);
  };
  visit(value, 0);
}
function detachedModel(value: unknown): FrameModel3D {
  finiteJSON(value);
  const checked = parseFrameModel3D(value);
  return parseFrameModel3D(JSON.parse(JSON.stringify(checked)) as unknown);
}

/** Authored nominal D/L mapping only. No frame analysis is called. */
export function parseUSGravityLoadRecipeInput(value: unknown): USGravityLoadRecipeInput {
  const raw = record(value, "US gravity recipe input"); fields(raw, INPUT_KEYS, "input");
  if (raw.version !== 1 || (raw.method !== "LRFD" && raw.method !== "ASD")) throw new Error("US gravity recipes require version 1 and method LRFD or ASD.");
  for (const key of ["nominalActionsConfirmed", "gravityScopeReviewed", "roofLiveSnowRainAbsent", "otherActionsExcludedAcknowledged", "amendmentScopeConfirmed", "errataApplicabilityReviewed"]) if (raw[key] !== true) throw new Error(`${key} must be explicitly confirmed for this D/L-only subset.`);
  const model = detachedModel(raw.model), deadCaseId = id(raw.deadCaseId, "deadCaseId"), imposedCaseId = id(raw.imposedCaseId, "imposedCaseId");
  if (deadCaseId === imposedCaseId || model.loadCases.length !== 2 || model.loadCases.some(loadCase => loadCase.id !== deadCaseId && loadCase.id !== imposedCaseId)) throw new Error("Map exactly two source load cases once each: nominal dead D and occupancy live L. Roof live and other actions cannot be mapped to occupancy L.");
  return { version: 1, method: raw.method, model, modelSource: text(raw.modelSource, "modelSource"), deadCaseId, imposedCaseId,
    deadLoadSource: text(raw.deadLoadSource, "deadLoadSource"), imposedLoadSource: text(raw.imposedLoadSource, "imposedLoadSource"),
    nominalActionsConfirmed: true, gravityScopeReviewed: true, scopeReviewSource: text(raw.scopeReviewSource, "scopeReviewSource"),
    roofLiveSnowRainAbsent: true, otherActionsExcludedAcknowledged: true, omittedActionReviewSource: text(raw.omittedActionReviewSource, "omittedActionReviewSource"),
    amendmentScopeConfirmed: true, amendmentReviewSource: text(raw.amendmentReviewSource, "amendmentReviewSource"), errataApplicabilityReviewed: true, errataReviewSource: text(raw.errataReviewSource, "errataReviewSource") };
}
function strictBasis(value: unknown): EngineeringDesignBasis {
  const raw = record(value, "basis"); fields(raw, ["version", "profileVersion", "countryCode", "region", "authority", "standards", "declaration", "criteria", "confirmed", "reviewer", "reviewNote"], "basis");
  fields(record(raw.declaration, "basis.declaration"), ["occupancy", "riskCategory", "structuralSystem", "material", "soil", "loads", "hazards"], "basis.declaration");
  for (const [key, maximum, allowed] of [["standards", 40, ["id", "domain", "code", "edition", "sourceUrl", "adoptionReference", "amendments"]], ["criteria", 64, ["id", "module", "name", "value", "unit", "source", "standardId", "clause"]]] as const) for (const entry of list(raw[key], `basis.${key}`, maximum)) fields(record(entry, `basis.${key}`), allowed, `basis.${key}`);
  return parseEngineeringDesignBasis(raw);
}
function basisGates(basis: EngineeringDesignBasis): string[] {
  const issues = validateEngineeringDesignBasis(basis);
  if (basis.countryCode !== "US") issues.push("This recipe supports a reviewed US ASCE/SEI 7-22 basis only; no US factors are substituted for another country.");
  if (basis.profileVersion !== ENGINEERING_BASIS_PROFILE_VERSION) issues.push("Review the captured basis against the supported country catalog version.");
  const reference = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === "us-asce7");
  const adopted = basis.standards.filter(item => item.id === "us-asce7" || /ASCE\s*\/\s*SEI\s*7|ASCE\s*7\b/i.test(item.code));
  if (!reference || adopted.length !== 1) issues.push("Adopt exactly one supported ASCE/SEI 7:2022 catalog reference.");
  else {
    const standard = adopted[0];
    if (standard.id !== reference.id || standard.domain !== reference.domain || standard.code !== reference.code || standard.edition !== "2022" || standard.sourceUrl !== reference.sourceUrl) issues.push("ASCE adoption must exactly match catalog ID, loads domain, code, 2022 edition and publisher URL.");
    if (!standard.adoptionReference.trim() || !standard.amendments.trim()) issues.push("Declare local ASCE adoption and the reviewed amendment/supplement/errata scope.");
  }
  if (!basis.confirmed || !basis.reviewer.trim()) issues.push("A named reviewer must confirm the adopted project basis.");
  if (basis.criteria.some(item => (item.standardId === undefined) !== (item.clause === undefined) || (item.standardId !== undefined && (!item.standardId.trim() || !item.clause?.trim())))) issues.push("Every criterion standard reference requires a paired non-empty adopted standard ID and clause.");
  return [...new Set(issues)];
}
function clauseIds(method: USGravityLoadRecipeInput["method"]): string[] { return method === "LRFD" ? ["2.3.1, 1a", "2.3.1, 2a (Lr/S/R absent)"] : ["2.4.1, 1a", "2.4.1, 2a"]; }
function recipes(source: USGravityLoadRecipeInput): USGravityCombinationTrace[] {
  const strength = source.method === "LRFD", prefix = strength ? "asce7-lrfd" : "asce7-asd", clauses = clauseIds(source.method);
  return [
    { combinationId: `${prefix}-1a-dead`, method: source.method, clause: clauses[0], purpose: "Identified basic dead-only row", factors: { [source.deadCaseId]: strength ? 1.4 : 1 }, primarySource: PRIMARY_SOURCE },
    { combinationId: `${prefix}-2a-dead-live`, method: source.method, clause: clauses[1], purpose: "Identified basic dead and occupancy-live row; declared roof/snow/rain absence", factors: { [source.deadCaseId]: strength ? 1.2 : 1, [source.imposedCaseId]: strength ? 1.6 : 1 }, primarySource: PRIMARY_SOURCE },
  ];
}

export function generateUSGravityLoadRecipes(input: USGravityLoadRecipeInput, designBasis: EngineeringDesignBasis): USGravityLoadRecipeReport {
  const source = parseUSGravityLoadRecipeInput(input), basis = strictBasis(designBasis), basisIssues = basisGates(basis), combinations = basisIssues.length ? [] : recipes(source);
  const generatedFrameModel = basisIssues.length ? null : detachedModel({ ...source.model, combinations: combinations.map(row => ({ id: row.combinationId, factors: { ...row.factors } })) });
  const report: USGravityLoadRecipeReport = { version: 1, implementation: IMPLEMENTATION, verification: "unverified", compliance: "not-assessed", source, basis,
    status: basisIssues.length ? "unsupported-basis" : "generated-subset", basisIssues, implementedClauses: basisIssues.length ? [] : clauseIds(source.method), generatedFrameModel, combinations, warnings: [...WARNINGS] };
  if (!validateUSGravityLoadRecipeReport(report, source, basis)) throw new Error("Generated US gravity recipe failed its source-coherence contract.");
  return report;
}
function sameJSON(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : engineeringRecord(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
function sameTextList(value: unknown, expected: readonly string[], path: string, maximum: number): boolean {
  return sameJSON(list(value, path, maximum).map(item => text(item, path)), expected);
}

/** Restore metadata, exact factors and the authored frame directly; never calls generator or solver. */
export function validateUSGravityLoadRecipeReport(value: unknown, input: USGravityLoadRecipeInput, designBasis: EngineeringDesignBasis): value is USGravityLoadRecipeReport {
  try {
    const source = parseUSGravityLoadRecipeInput(input), basis = strictBasis(designBasis), raw = record(value, "US gravity report");
    fields(raw, ["version", "implementation", "verification", "compliance", "source", "basis", "status", "basisIssues", "implementedClauses", "generatedFrameModel", "combinations", "warnings"], "report");
    if (raw.version !== 1 || raw.implementation !== IMPLEMENTATION || raw.verification !== "unverified" || raw.compliance !== "not-assessed") return false;
    if (!sameJSON(parseUSGravityLoadRecipeInput(raw.source), source) || engineeringBasisFingerprint(strictBasis(raw.basis)) !== engineeringBasisFingerprint(basis)) return false;
    const issues = basisGates(basis), supported = issues.length === 0;
    if (raw.status !== (supported ? "generated-subset" : "unsupported-basis") || !sameTextList(raw.basisIssues, issues, "basisIssues", 1000) || !sameTextList(raw.implementedClauses, supported ? clauseIds(source.method) : [], "implementedClauses", 2) || !sameTextList(raw.warnings, WARNINGS, "warnings", 10)) return false;
    const rows = list(raw.combinations, "combinations", 2); if (rows.length !== (supported ? 2 : 0)) return false;
    if (!supported) return raw.generatedFrameModel === null;
    const strength = source.method === "LRFD", prefix = strength ? "asce7-lrfd" : "asce7-asd", clauses = clauseIds(source.method), expected: FrameCombination3D[] = [];
    for (let index = 0; index < rows.length; index++) {
      const row = record(rows[index], "combination trace"); fields(row, ["combinationId", "method", "clause", "purpose", "factors", "primarySource"], "trace");
      const combinationId = index === 0 ? `${prefix}-1a-dead` : `${prefix}-2a-dead-live`, factors = record(row.factors, "trace factors"), keys = Object.keys(factors);
      const deadFactor = strength ? index === 0 ? 1.4 : 1.2 : 1, liveFactor = strength ? 1.6 : 1;
      if (row.combinationId !== combinationId || row.method !== source.method || row.clause !== clauses[index] || row.primarySource !== PRIMARY_SOURCE || row.purpose !== (index === 0 ? "Identified basic dead-only row" : "Identified basic dead and occupancy-live row; declared roof/snow/rain absence")) return false;
      if (keys.length !== (index === 0 ? 1 : 2) || !keys.includes(source.deadCaseId) || (index === 1 && !keys.includes(source.imposedCaseId)) || factors[source.deadCaseId] !== deadFactor || (index === 1 && factors[source.imposedCaseId] !== liveFactor) || !Object.values(factors).every(factor => finiteNumber(factor) && factor >= 0 && factor <= 100)) return false;
      expected.push({ id: combinationId, factors: index === 0 ? { [source.deadCaseId]: deadFactor } : { [source.deadCaseId]: deadFactor, [source.imposedCaseId]: liveFactor } });
    }
    const restored = detachedModel(raw.generatedFrameModel);
    if (!sameJSON(restored.combinations, expected)) return false;
    const original = { ...source.model }; delete original.combinations;
    const generated = { ...restored }; delete generated.combinations;
    return sameJSON(generated, original);
  } catch { return false; }
}

/** Authored shape example only; its review text must be replaced with actual project evidence. */
export function usGravityLoadRecipeExample(): USGravityLoadRecipeInput {
  return { version: 1, method: "LRFD", modelSource: "Example authored SI frame; replace with reviewed project source", deadCaseId: "dead", imposedCaseId: "imposed",
    deadLoadSource: "Example nominal D; replace with sourced dead-load schedule", imposedLoadSource: "Example nominal occupancy L; replace with sourced live-load schedule",
    nominalActionsConfirmed: true, gravityScopeReviewed: true, scopeReviewSource: "Example declaration; review method, material compatibility, pattern and unfavorable/absent-action effects externally",
    roofLiveSnowRainAbsent: true, otherActionsExcludedAcknowledged: true, omittedActionReviewSource: "Example subsystem excludes roof live/snow/rain; assess all other actions separately",
    amendmentScopeConfirmed: true, amendmentReviewSource: "Replace with local ASCE 7-22 adoption and supplement/amendment review", errataApplicabilityReviewed: true, errataReviewSource: "Replace with publisher errata applicability review",
    model: { version: 1, analysis: "linear", nodes: [{ id: "base", xM: 0, yM: 0, zM: 0, restraints: [true, true, true, true, true, true] }, { id: "tip", xM: 3, yM: 0, zM: 0, restraints: [false, false, false, false, false, false] }],
      members: [{ id: "beam", start: "base", end: "tip", areaM2: 0.01, inertiaYM4: 0.0001, inertiaZM4: 0.0001, torsionConstantM4: 0.00001, elasticModulusPa: 2e11, shearModulusPa: 7.7e10, localYAxis: [0, 1, 0] }],
      loadCases: [{ id: "dead", nodal: [{ node: "tip", fxN: 0, fyN: 0, fzN: -10000, mxNm: 0, myNm: 0, mzNm: 0 }], uniform: [] }, { id: "imposed", nodal: [{ node: "tip", fxN: 0, fyN: 0, fzN: -5000, mxNm: 0, myNm: 0, mzNm: 0 }], uniform: [] }] } };
}
