import { ENGINEERING_BASIS_PROFILE_VERSION, ENGINEERING_STANDARD_REFERENCES, engineeringBasisFingerprint, isEngineeringSourceUrl, parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis } from "./engineeringBasis";
import { engineeringRecord, finiteNumber, identifier, requireFinite } from "./engineeringNumerics";

export interface USSteelShearParameter { value: number; unit: "Pa"; source: string; criterionId?: string }
interface USSteelShearSection {
  id: string; label: string; kind: "us-aisc360-g2-stocky-web";
  inputSource: string; loadCase: string; loadSource: string;
  sectionType: "rolled-i"; prismatic: true; doublySymmetric: true;
  sectionUnmodified: true; geometryReviewSource: string;
  webHeightDefinition: "clear-between-flanges-less-fillets";
  classificationBasis: "g2.1a-rolled-web"; classificationReviewSource: string;
  intermediateTransverseStiffeners: "none";
  endAndSupportWebRestraintAdequacyReviewed: true; endRestraintReviewSource: string;
  staticLoadingOnly: true; applicabilityReviewSource: string;
  amendmentScopeConfirmed: true; amendmentReviewSource: string;
  errataApplicabilityReviewed: true; errataReviewSource: string;
  overallDepthM: number; clearWebHeightM: number; webThicknessM: number;
  steelYieldPa: USSteelShearParameter;
  demandMajorShearN: number;
  demandMinorShearN: 0; demandAxialN: 0;
  demandMajorMomentNm: 0; demandMinorMomentNm: 0; demandTorqueNm: 0;
}
export type USSteelShearCheck = USSteelShearSection & (
  { designMethod: "LRFD"; loadBasis: "factored" } | { designMethod: "ASD"; loadBasis: "service" }
);
export interface USSteelShearInput { version: 1; checks: USSteelShearCheck[] }
export interface USSteelShearResult {
  id: string; kind: "us-aisc360-g2-stocky-web"; designMethod: "LRFD" | "ASD";
  status: "within-implemented-clause" | "exceeds-implemented-clause" | "unsupported-web-scope";
  elasticModulusPa: number; webAreaM2: number;
  webSlenderness: number; stockyWebSlendernessLimit: number;
  rolledWebStockyScopeSatisfied: boolean;
  webShearCoefficient: number | null; resistanceFactor: number | null; safetyFactor: number | null;
  nominalG2CapacityN: number | null; availableG2CapacityN: number | null;
  demandMajorShearN: number; utilization: number | null;
  clauseChecks: { clause: string; name: string; satisfied: boolean | null }[];
  details: string[]; excludedChecks: string[];
}
export interface USSteelShearReport {
  version: 1; implementation: "AISC360-2022-G2.1a-stocky-rolled-web-v1";
  verification: "unverified"; compliance: "not-assessed";
  source: USSteelShearInput; basis: EngineeringDesignBasis;
  status: "assessed-subset" | "partial-subset" | "unsupported-basis";
  basisIssues: string[]; implementedClauses: string[]; results: USSteelShearResult[]; warnings: string[];
}

const IMPLEMENTATION = "AISC360-2022-G2.1a-stocky-rolled-web-v1";
const ELASTIC_MODULUS_PA = 200e9, RESISTANCE_FACTOR = 1, SAFETY_FACTOR = 1.5;
const OUTPUT_LIMIT = 1e24;
const CLAUSES = ["G2.1 web area Aw=d*tw", "G2.1(a) rolled-I limit h/tw<=2.24*sqrt(E/Fy)", "G2-2 Cv1=1.0 within G2.1(a)", "G2-1 nominal web shear strength Vn=0.6*Fy*Aw*Cv1", "G2.1(a) phi_v=1.00 and Omega_v=1.50, exception to G1(a)"];
const WARNINGS = [
  "Source inspection only: compilation, numerical execution and independent benchmarks remain unverified.",
  "The inspected references are cached extracts of the AISC-authored ANSI/AISC 360-22 artifact revised September 2023 and AISC V16.0 companion examples G.1B/G.2B. AISC lists January 2025 and September 2026 errata, but their contents were not independently inspected or incorporated. Project review declarations must establish applicability of the implemented G2.1(a) equations and factors.",
  "Only major-axis shear in the web plane of an unmodified, prismatic, doubly symmetric hot-rolled I member within the G2.1(a) stocky-web branch is assessed. This is not complete member resistance or national-code compliance.",
  "Rolled-section identity, the G2 definition of h, material qualification, absence of modifications and adequacy of end/support web restraints are sourced external review declarations. This module computes the G2.1(a) slenderness comparison; B4 flexural compactness or an unverified section name cannot substitute for it.",
  "When h/tw exceeds the G2.1(a) limit, no G2.1(b) coefficient, G1(a) factors or tension-field resistance is supplied. Capacity, factors, Cv1, utilization and the strength comparison remain null even at zero shear demand.",
  "Demand is an externally established non-negative magnitude for the supplied LRFD or applicable ASD combination. No load combinations, frame demand, support design or other national equations are inferred.",
];
const EXCLUDED_CHECKS = [
  "Complete member/code resistance and minimum strength over every applicable limit state",
  "G2.1(b) other web branches, shear buckling coefficient kv and reduced Cv1; G1(a) general factors outside the G2.1(a) exception",
  "G2.2/G2.3 interior/end-panel tension field action, transverse stiffener sizing and stiffener connections",
  "Calculated rolled-section/material qualification, reconstruction of h/fillets and end/support web restraint design",
  "G7 web openings; holes, copes, notches, corrosion, damage or other modified-section reductions",
  "Flexure, axial force, minor-axis shear/bending, torsion and combined-force interactions",
  "Chapter J concentrated-force effects, web panel-zone shear, connections and load introduction",
  "Frame stability, second-order effects, deflection, vibration, fatigue, fire and seismic detailing",
  "Channels, built-up, singly symmetric, unsymmetric, HSS, composite, tapered and non-prismatic members",
  "Load combinations, local adoption/errata reconciliation and construction certification",
];
const INPUT_KEYS = ["id", "label", "kind", "inputSource", "loadCase", "loadSource", "sectionType", "prismatic", "doublySymmetric", "sectionUnmodified", "geometryReviewSource", "webHeightDefinition", "classificationBasis", "classificationReviewSource", "intermediateTransverseStiffeners", "endAndSupportWebRestraintAdequacyReviewed", "endRestraintReviewSource", "staticLoadingOnly", "applicabilityReviewSource", "amendmentScopeConfirmed", "amendmentReviewSource", "errataApplicabilityReviewed", "errataReviewSource", "overallDepthM", "clearWebHeightM", "webThicknessM", "steelYieldPa", "demandMajorShearN", "demandMinorShearN", "demandAxialN", "demandMajorMomentNm", "demandMinorMomentNm", "demandTorqueNm", "designMethod", "loadBasis"];
const RESULT_KEYS = ["id", "kind", "designMethod", "status", "elasticModulusPa", "webAreaM2", "webSlenderness", "stockyWebSlendernessLimit", "rolledWebStockyScopeSatisfied", "webShearCoefficient", "resistanceFactor", "safetyFactor", "nominalG2CapacityN", "availableG2CapacityN", "demandMajorShearN", "utilization", "clauseChecks", "details", "excludedChecks"];
function record(value: unknown, path: string): Record<string, unknown> {
  if (!engineeringRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
}
function fields(raw: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(raw).find(key => !allowed.includes(key));
  if (unexpected) throw new Error(`${path}.${unexpected} is unsupported by this bounded G2.1(a) subset.`);
}
function text(value: unknown, path: string, maximum = 4000): string {
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
function parameter(value: unknown, path: string): USSteelShearParameter {
  const raw = record(value, path); fields(raw, ["value", "unit", "source", "criterionId"], path);
  if (raw.unit !== "Pa") throw new Error(`${path}.unit must be Pa.`);
  return { value: requireFinite(raw.value, `${path}.value`, 1e6, 2e9), unit: "Pa", source: text(raw.source, `${path}.source`, 2000), ...(raw.criterionId === undefined ? {} : { criterionId: id(raw.criterionId, `${path}.criterionId`) }) };
}

/** Strict authored rolled-web geometry and pure major-axis shear demand, with no inferred section data. */
export function parseUSSteelShearInput(value: unknown): USSteelShearInput {
  const raw = record(value, "US steel shear input"); fields(raw, ["version", "checks"], "input");
  if (raw.version !== 1) throw new Error("US G2 shear input requires version 1.");
  const entries = list(raw.checks, "checks", 100); if (!entries.length) throw new Error("US G2 shear input requires 1-100 checks.");
  const ids = new Set<string>();
  return { version: 1, checks: entries.map((entry, index): USSteelShearCheck => {
    const item = record(entry, `checks[${index}]`); fields(item, INPUT_KEYS, `checks[${index}]`);
    const checkId = id(item.id, "check.id"); if (ids.has(checkId)) throw new Error("US G2 shear check IDs must be unique."); ids.add(checkId);
    const declarations: [string, string | number | boolean][] = [["kind", "us-aisc360-g2-stocky-web"], ["sectionType", "rolled-i"], ["prismatic", true], ["doublySymmetric", true], ["sectionUnmodified", true], ["webHeightDefinition", "clear-between-flanges-less-fillets"], ["classificationBasis", "g2.1a-rolled-web"], ["intermediateTransverseStiffeners", "none"], ["endAndSupportWebRestraintAdequacyReviewed", true], ["staticLoadingOnly", true], ["amendmentScopeConfirmed", true], ["errataApplicabilityReviewed", true], ["demandMinorShearN", 0], ["demandAxialN", 0], ["demandMajorMomentNm", 0], ["demandMinorMomentNm", 0], ["demandTorqueNm", 0]];
    for (const [key, expected] of declarations) if (item[key] !== expected) throw new Error(`${checkId}.${key} must explicitly declare ${String(expected)}.`);
    if (item.designMethod !== "LRFD" && item.designMethod !== "ASD") throw new Error(`${checkId}: designMethod must be LRFD or ASD.`);
    const design = item.designMethod === "LRFD" ? { designMethod: "LRFD" as const, loadBasis: "factored" as const } : { designMethod: "ASD" as const, loadBasis: "service" as const };
    if (item.loadBasis !== design.loadBasis) throw new Error(`${checkId}: LRFD requires factored shear; ASD requires the service-level effect of the reviewed applicable ASD combination.`);
    const overallDepthM = requireFinite(item.overallDepthM, "overallDepthM", 0.001, 10), clearWebHeightM = requireFinite(item.clearWebHeightM, "clearWebHeightM", 0.0001, 10), webThicknessM = requireFinite(item.webThicknessM, "webThicknessM", 0.00001, 1);
    if (clearWebHeightM >= overallDepthM || webThicknessM >= clearWebHeightM) throw new Error(`${checkId}: require 0<tw<h<d for the authored rolled-I web; h must exclude both flange fillets.`);
    return {
      id: checkId, label: text(item.label, "label", 200), kind: "us-aisc360-g2-stocky-web", inputSource: text(item.inputSource, "inputSource"), loadCase: text(item.loadCase, "loadCase", 200), loadSource: text(item.loadSource, "loadSource"),
      sectionType: "rolled-i", prismatic: true, doublySymmetric: true, sectionUnmodified: true, geometryReviewSource: text(item.geometryReviewSource, "geometryReviewSource"),
      webHeightDefinition: "clear-between-flanges-less-fillets", classificationBasis: "g2.1a-rolled-web", classificationReviewSource: text(item.classificationReviewSource, "classificationReviewSource"), intermediateTransverseStiffeners: "none",
      endAndSupportWebRestraintAdequacyReviewed: true, endRestraintReviewSource: text(item.endRestraintReviewSource, "endRestraintReviewSource"), staticLoadingOnly: true, applicabilityReviewSource: text(item.applicabilityReviewSource, "applicabilityReviewSource"),
      amendmentScopeConfirmed: true, amendmentReviewSource: text(item.amendmentReviewSource, "amendmentReviewSource"), errataApplicabilityReviewed: true, errataReviewSource: text(item.errataReviewSource, "errataReviewSource"),
      overallDepthM, clearWebHeightM, webThicknessM, steelYieldPa: parameter(item.steelYieldPa, "steelYieldPa"), demandMajorShearN: requireFinite(item.demandMajorShearN, "demandMajorShearN", 0, 1e12),
      demandMinorShearN: 0, demandAxialN: 0, demandMajorMomentNm: 0, demandMinorMomentNm: 0, demandTorqueNm: 0, ...design,
    };
  }) };
}

/** General basis parsing omits unknown fields, so close that gap at this module's boundary. */
function strictBasis(value: unknown): EngineeringDesignBasis {
  const raw = record(value, "basis"); fields(raw, ["version", "profileVersion", "countryCode", "region", "authority", "standards", "declaration", "criteria", "confirmed", "reviewer", "reviewNote"], "basis");
  fields(record(raw.declaration, "basis.declaration"), ["occupancy", "riskCategory", "structuralSystem", "material", "soil", "loads", "hazards"], "basis.declaration");
  for (const [key, maximum, allowed] of [["standards", 40, ["id", "domain", "code", "edition", "sourceUrl", "adoptionReference", "amendments"]], ["criteria", 64, ["id", "module", "name", "value", "unit", "source", "standardId", "clause"]]] as const) {
    const entries = list(raw[key], `basis.${key}`, maximum);
    for (const entry of entries) fields(record(entry, `basis.${key}`), allowed, `basis.${key}`);
  }
  return parseEngineeringDesignBasis(raw);
}

/** Complete metadata and material-source gates only; no member/analysis routine is called. */
function basisGates(source: USSteelShearInput, basis: EngineeringDesignBasis): string[] {
  const issues = validateEngineeringDesignBasis(basis);
  if (basis.countryCode !== "US") issues.push(`Country ${basis.countryCode || "not selected"} is unsupported by this US G2 shear module; no US equations are substituted.`);
  if (basis.profileVersion !== ENGINEERING_BASIS_PROFILE_VERSION) issues.push("The captured basis catalog version requires adoption review against the supported catalog.");
  if (!basis.region.trim() || !basis.authority.trim()) issues.push("Declare the project region and authority having jurisdiction.");
  if (!basis.confirmed || !basis.reviewer.trim()) issues.push("A named reviewer must confirm the project adoption basis.");
  const standardIds = basis.standards.map(item => item.id), criterionIds = basis.criteria.map(item => item.id);
  if (standardIds.some(value => !value.trim()) || criterionIds.some(value => !value.trim()) || new Set(standardIds).size !== standardIds.length || new Set(criterionIds).size !== criterionIds.length) issues.push("Captured adopted standard and criterion IDs must be non-empty and unique.");
  if (basis.criteria.some(criterion => criterion.standardId !== undefined && (!criterion.standardId.trim() || !criterion.clause?.trim()))) issues.push("Every declared criterion standard reference requires a non-empty adopted standard ID and clause.");
  const reference = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === "us-aisc360");
  const candidates = basis.standards.filter(item => item.id === "us-aisc360" || /\bAISC\s*360\b/i.test(item.code));
  if (!reference || candidates.length !== 1) issues.push("Adopt exactly one supported ANSI/AISC 360:2022 catalog reference; missing or multiple AISC 360 declarations are unsupported.");
  else {
    const adopted = candidates[0];
    if (adopted.id !== reference.id || adopted.domain !== reference.domain || adopted.code !== reference.code || adopted.edition !== "2022" || adopted.sourceUrl !== reference.sourceUrl) issues.push("The adopted AISC reference must exactly match the US steel catalog entry, edition 2022 and publisher reference.");
    if (!adopted.adoptionReference.trim() || !adopted.amendments.trim()) issues.push("Declare local AISC adoption and applicable amendments/errata; their reconciliation is externally reviewed.");
  }
  for (const check of source.checks) {
    const supplied = check.steelYieldPa; if (!supplied.criterionId) continue;
    const matches = basis.criteria.filter(item => item.id === supplied.criterionId), criterion = matches[0];
    if (matches.length !== 1 || !criterion || criterion.module !== "frame" || criterion.value !== supplied.value || criterion.unit !== supplied.unit || criterion.source !== supplied.source) issues.push(`${check.id}: steel yield must exactly match a unique captured frame criterion.`);
    else if (criterion.standardId !== undefined) {
      const adoptedMatches = basis.standards.filter(item => item.id === criterion.standardId), adopted = adoptedMatches[0];
      if (adoptedMatches.length !== 1 || !adopted || !criterion.clause?.trim()) issues.push(`${check.id}: steel-yield criterion requires a unique adopted standard and clause.`);
      else {
        if (!adopted.code.trim() || !adopted.edition.trim() || !adopted.adoptionReference.trim() || !adopted.amendments.trim() || !isEngineeringSourceUrl(adopted.sourceUrl)) issues.push(`${check.id}: steel-yield criterion's standard requires complete edition, adoption, amendments and HTTPS source.`);
        const catalog = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === adopted.id);
        if (catalog && (catalog.countryCode !== basis.countryCode || catalog.code !== adopted.code || catalog.domain !== adopted.domain || !catalog.editions.includes(adopted.edition) || catalog.sourceUrl !== adopted.sourceUrl)) issues.push(`${check.id}: steel-yield criterion's catalog reference differs from its country, code, domain, edition or publisher.`);
      }
    }
  }
  return [...new Set(issues)];
}
function positive(value: number): boolean { return finiteNumber(value) && value > 0 && value <= OUTPUT_LIMIT; }
function nonnegative(value: number): boolean { return finiteNumber(value) && value >= 0 && value <= OUTPUT_LIMIT; }
function details(check: USSteelShearCheck, stocky: boolean): string[] {
  return [
    "Aw=d*tw uses overall rolled-section depth d, not clear web height h. The authored h is the G2.1(a) clear distance between flanges less the fillet at each flange; geometry and rolled-I identity are externally reviewed.",
    "The branch compares h/tw directly with 2.24*sqrt(E/Fy), using the AISC SI elastic modulus E=200000 MPa and sourced specified minimum Fy. A section name or B4 flexural compactness is not used to infer eligibility.",
    check.designMethod === "LRFD" ? "The supplied maximum absolute shear in the web plane is already factored for the reviewed LRFD combination." : "The supplied maximum absolute shear in the web plane is the service-level effect of the reviewed applicable ASD combination.",
    "No intermediate transverse stiffeners or section modifications are declared. End/support web restraint adequacy, local force introduction and material applicability are external reviews; no stiffness or bearing resistance is calculated.",
    stocky ? "The rolled web satisfies G2.1(a): G2-2 Cv1=1.0; G2-1 Vn=0.6*Fy*Aw*Cv1. The G2.1(a) exception supplies phi_v=1.00 for LRFD and Omega_v=1.50 for ASD." : "The web exceeds the G2.1(a) limit. G2.1(b), G1(a) general factors and tension-field action are outside this implementation, so capacities, factors, Cv1, utilization and the strength comparison are unassessed and null.",
  ];
}
function clauses(check: USSteelShearCheck, stocky: boolean, satisfied: boolean | null): USSteelShearResult["clauseChecks"] {
  return [
    { clause: "G2.1(a), G2-2", name: "Reviewed rolled-I web h/tw within 2.24*sqrt(E/Fy) stocky-web limit", satisfied: stocky },
    { clause: `G2-1 with G2.1(a) ${check.designMethod} factor`, name: "Supplied major-axis shear within available stocky-web strength only", satisfied },
  ];
}
function web(check: USSteelShearCheck): USSteelShearResult {
  const webAreaM2 = check.overallDepthM * check.webThicknessM, webSlenderness = check.clearWebHeightM / check.webThicknessM, stockyWebSlendernessLimit = 2.24 * Math.sqrt(ELASTIC_MODULUS_PA / check.steelYieldPa.value);
  if (![webAreaM2, webSlenderness, stockyWebSlendernessLimit].every(positive)) throw new Error(`${check.id}: invalid or out-of-bound derived G2 geometry.`);
  const stocky = webSlenderness <= stockyWebSlendernessLimit;
  const nominalG2CapacityN = stocky ? 0.6 * check.steelYieldPa.value * webAreaM2 : null;
  const availableG2CapacityN = nominalG2CapacityN === null ? null : check.designMethod === "LRFD" ? RESISTANCE_FACTOR * nominalG2CapacityN : nominalG2CapacityN / SAFETY_FACTOR;
  const utilization = availableG2CapacityN === null ? null : check.demandMajorShearN / availableG2CapacityN;
  if ((nominalG2CapacityN !== null && !positive(nominalG2CapacityN)) || (availableG2CapacityN !== null && !positive(availableG2CapacityN)) || (utilization !== null && !nonnegative(utilization))) throw new Error(`${check.id}: invalid or out-of-bound G2 strength/utilization.`);
  const satisfied = availableG2CapacityN === null ? null : check.demandMajorShearN <= availableG2CapacityN;
  return { id: check.id, kind: check.kind, designMethod: check.designMethod, status: satisfied === null ? "unsupported-web-scope" : satisfied ? "within-implemented-clause" : "exceeds-implemented-clause",
    elasticModulusPa: ELASTIC_MODULUS_PA, webAreaM2, webSlenderness, stockyWebSlendernessLimit, rolledWebStockyScopeSatisfied: stocky,
    webShearCoefficient: stocky ? 1 : null, resistanceFactor: stocky ? RESISTANCE_FACTOR : null, safetyFactor: stocky ? SAFETY_FACTOR : null,
    nominalG2CapacityN, availableG2CapacityN, demandMajorShearN: check.demandMajorShearN, utilization, clauseChecks: clauses(check, stocky, satisfied), details: details(check, stocky), excludedChecks: [...EXCLUDED_CHECKS] };
}

/** Named G2.1(a) rolled-web subset; outside that branch no alternative resistance is inferred. */
export function assessUSSteelShear(input: USSteelShearInput, designBasis: EngineeringDesignBasis): USSteelShearReport {
  const source = parseUSSteelShearInput(input), basis = strictBasis(designBasis), gates = basisGates(source, basis);
  const results = gates.length ? [] : source.checks.map(web);
  const report: USSteelShearReport = { version: 1, implementation: IMPLEMENTATION, verification: "unverified", compliance: "not-assessed", source, basis,
    status: gates.length ? "unsupported-basis" : results.some(item => item.status === "unsupported-web-scope") ? "partial-subset" : "assessed-subset", basisIssues: gates, implementedClauses: gates.length ? [] : [...CLAUSES], results, warnings: [...WARNINGS] };
  if (!validateUSSteelShearReport(report, source, basis)) throw new Error("Generated US G2 shear report failed its bounded source-coherence contract.");
  return report;
}
function sameTextList(value: unknown, expected: readonly string[], path: string, maximum: number): boolean {
  const entries = list(value, path, maximum);
  return JSON.stringify(entries.map(item => text(item, path))) === JSON.stringify(expected);
}

/** Restore-only scalar algebra and metadata coherence; never calls assessor, web routine or solver. */
export function validateUSSteelShearReport(value: unknown, input: USSteelShearInput, designBasis: EngineeringDesignBasis): value is USSteelShearReport {
  try {
    const source = parseUSSteelShearInput(input), basis = strictBasis(designBasis), raw = record(value, "US G2 shear report");
    fields(raw, ["version", "implementation", "verification", "compliance", "source", "basis", "status", "basisIssues", "implementedClauses", "results", "warnings"], "report");
    if (raw.version !== 1 || raw.implementation !== IMPLEMENTATION || raw.verification !== "unverified" || raw.compliance !== "not-assessed") return false;
    if (JSON.stringify(parseUSSteelShearInput(raw.source)) !== JSON.stringify(source) || engineeringBasisFingerprint(strictBasis(raw.basis)) !== engineeringBasisFingerprint(basis)) return false;
    const gates = basisGates(source, basis), supported = gates.length === 0;
    if (!sameTextList(raw.basisIssues, gates, "basisIssues", 1000) || !sameTextList(raw.implementedClauses, supported ? CLAUSES : [], "implementedClauses", 10) || !sameTextList(raw.warnings, WARNINGS, "warnings", 20)) return false;
    const results = list(raw.results, "results", 100); if (results.length !== (supported ? source.checks.length : 0)) return false;
    let partial = false;
    for (let index = 0; index < results.length; index++) {
      const item = record(results[index], "result"), check = source.checks[index]; fields(item, RESULT_KEYS, "result");
      if (item.id !== check.id || item.kind !== check.kind || item.designMethod !== check.designMethod || item.elasticModulusPa !== ELASTIC_MODULUS_PA) return false;
      const area = check.overallDepthM * check.webThicknessM, slenderness = check.clearWebHeightM / check.webThicknessM, limit = 2.24 * Math.sqrt(ELASTIC_MODULUS_PA / check.steelYieldPa.value);
      if (![area, slenderness, limit].every(positive) || item.webAreaM2 !== area || item.webSlenderness !== slenderness || item.stockyWebSlendernessLimit !== limit) return false;
      const stocky = slenderness <= limit, nominal = stocky ? 0.6 * check.steelYieldPa.value * area : null;
      const available = nominal === null ? null : check.designMethod === "LRFD" ? RESISTANCE_FACTOR * nominal : nominal / SAFETY_FACTOR;
      const utilization = available === null ? null : check.demandMajorShearN / available;
      if ((nominal !== null && !positive(nominal)) || (available !== null && !positive(available)) || (utilization !== null && !nonnegative(utilization))) return false;
      const satisfied = available === null ? null : check.demandMajorShearN <= available;
      if (item.rolledWebStockyScopeSatisfied !== stocky || item.webShearCoefficient !== (stocky ? 1 : null) || item.resistanceFactor !== (stocky ? RESISTANCE_FACTOR : null) || item.safetyFactor !== (stocky ? SAFETY_FACTOR : null)) return false;
      if (item.nominalG2CapacityN !== nominal || item.availableG2CapacityN !== available || item.demandMajorShearN !== check.demandMajorShearN || item.utilization !== utilization || item.status !== (satisfied === null ? "unsupported-web-scope" : satisfied ? "within-implemented-clause" : "exceeds-implemented-clause")) return false;
      partial ||= !stocky;
      const expectedClauses = clauses(check, stocky, satisfied), clauseChecks = list(item.clauseChecks, "clauseChecks", 2); if (clauseChecks.length !== expectedClauses.length) return false;
      for (let clauseIndex = 0; clauseIndex < expectedClauses.length; clauseIndex++) {
        const clause = record(clauseChecks[clauseIndex], "clauseCheck"), expected = expectedClauses[clauseIndex]; fields(clause, ["clause", "name", "satisfied"], "clauseCheck");
        if (clause.clause !== expected.clause || clause.name !== expected.name || clause.satisfied !== expected.satisfied) return false;
      }
      if (!sameTextList(item.details, details(check, stocky), "details", 10) || !sameTextList(item.excludedChecks, EXCLUDED_CHECKS, "excludedChecks", 15)) return false;
    }
    return raw.status === (!supported ? "unsupported-basis" : partial ? "partial-subset" : "assessed-subset");
  } catch { return false; }
}

/** Illustrative declarations only; replace every review and adopt a confirmed matching US basis. */
export function usSteelShearExample(): USSteelShearInput {
  return { version: 1, checks: [{ id: "aisc-g2-web-1", label: "US G2.1(a) stocky rolled-web shear subset", kind: "us-aisc360-g2-stocky-web",
    inputSource: "Illustrative SI rolled-web dimensions; replace with checked unmodified project section geometry.", loadCase: "replace-with-LRFD-project-combination", loadSource: "Illustrative maximum absolute factored pure web-plane shear; replace with reviewed applicable LRFD combination and analysis reference.",
    sectionType: "rolled-i", prismatic: true, doublySymmetric: true, sectionUnmodified: true, geometryReviewSource: "Example declaration only; replace with review of prismatic rolled-I identity and no holes, copes, notches, corrosion, damage or other section modifications.",
    webHeightDefinition: "clear-between-flanges-less-fillets", classificationBasis: "g2.1a-rolled-web", classificationReviewSource: "Example declaration only; replace with reviewed G2.1(a) rolled-web identity, clear h excluding both flange fillets, overall depth d, tw and material grade; B4 flexural compactness is not shear classification.", intermediateTransverseStiffeners: "none",
    endAndSupportWebRestraintAdequacyReviewed: true, endRestraintReviewSource: "Example declaration only; replace with reviewed adequacy of end/support web out-of-plane restraints and any required end bearing stiffeners or equivalent restraint, considering AISC Commentary G2 and Chapter J local force introduction.",
    staticLoadingOnly: true, applicabilityReviewSource: "Example declaration only; replace with sourced material qualification and confirmation of pure static web-plane shear applicability; all other force components are explicitly zero.",
    amendmentScopeConfirmed: true, amendmentReviewSource: "Example declaration only; replace with reviewed local adoption/amendment applicability against the inspected AISC 360-22 subset.", errataApplicabilityReviewed: true, errataReviewSource: "Example declaration only; replace with reviewed January 2025 and September 2026 errata confirming applicability of implemented G2.1(a) equations/factors.",
    overallDepthM: 0.6, clearWebHeightM: 0.55, webThicknessM: 0.012, steelYieldPa: { value: 345e6, unit: "Pa", source: "Illustrative specified minimum steel yield strength; replace with reviewed project material specification." },
    demandMajorShearN: 400000, demandMinorShearN: 0, demandAxialN: 0, demandMajorMomentNm: 0, demandMinorMomentNm: 0, demandTorqueNm: 0, designMethod: "LRFD", loadBasis: "factored",
  }] };
}
