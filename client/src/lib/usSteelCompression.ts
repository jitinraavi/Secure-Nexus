import { ENGINEERING_BASIS_PROFILE_VERSION, ENGINEERING_STANDARD_REFERENCES, engineeringBasisFingerprint, isEngineeringSourceUrl, parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis } from "./engineeringBasis";
import { engineeringRecord, finiteNumber, identifier, requireFinite } from "./engineeringNumerics";

export interface USSteelCompressionParameter<Unit extends "Pa" | "1"> { value: number; unit: Unit; source: string; criterionId?: string }
interface USSteelCompressionSection {
  id: string; label: string; kind: "us-aisc360-e3";
  inputSource: string; loadCase: string; loadSource: string;
  sectionType: "rolled-i"; prismatic: true; doublySymmetric: true;
  nonslenderCompressionElements: true; classificationReviewSource: string;
  amendmentScopeConfirmed: true; amendmentReviewSource: string;
  errataApplicabilityReviewed: true; errataReviewSource: string;
  areaM2: number; inertiaYM4: number; inertiaZM4: number;
  unbracedLengthYM: number; unbracedLengthZM: number;
  steelYieldPa: USSteelCompressionParameter<"Pa">;
  effectiveLengthFactorY: USSteelCompressionParameter<"1">;
  effectiveLengthFactorZ: USSteelCompressionParameter<"1">;
  demandAxialN: number; momentsYNm: 0; momentsZNm: 0;
}
export type USSteelCompressionCheck = USSteelCompressionSection & (
  { designMethod: "LRFD"; loadBasis: "factored" } | { designMethod: "ASD"; loadBasis: "service" }
);
export interface USSteelCompressionInput { version: 1; checks: USSteelCompressionCheck[] }
export interface USSteelCompressionAxis {
  axis: "y" | "z"; radiusM: number; effectiveLengthM: number; slenderness: number;
  elasticBucklingStressPa: number; yieldToElasticRatio: number; nominalFlexuralStressPa: number;
  curve: "inelastic" | "elastic";
}
export interface USSteelCompressionResult {
  id: string; kind: "us-aisc360-e3"; designMethod: "LRFD" | "ASD";
  status: "within-implemented-clause" | "exceeds-implemented-clause";
  elasticModulusPa: number; resistanceFactor: number; safetyFactor: number;
  axes: USSteelCompressionAxis[]; governingFlexuralAxis: "y" | "z" | "both";
  nominalE3CapacityN: number; availableE3CapacityN: number; demandAxialN: number; utilization: number;
  clauseChecks: { clause: string; name: string; satisfied: boolean }[];
  details: string[]; excludedChecks: string[];
}
export interface USSteelCompressionReport {
  version: 1; implementation: "AISC360-2022-E3-flexural-v1";
  verification: "unverified"; compliance: "not-assessed";
  source: USSteelCompressionInput; basis: EngineeringDesignBasis;
  status: "assessed-subset" | "unsupported-basis"; basisIssues: string[];
  implementedClauses: string[]; results: USSteelCompressionResult[]; warnings: string[];
}

const IMPLEMENTATION = "AISC360-2022-E3-flexural-v1";
const ELASTIC_MODULUS_PA = 200e9, RESISTANCE_FACTOR = 0.9, SAFETY_FACTOR = 1.67;
const CLAUSES = ["E1 resistance/safety factors only", "E3-1 flexural compression strength only", "E3-2 and E3-3 nominal stress curves", "E3-4 elastic flexural buckling stress"];
const WARNINGS = [
  "Source inspection only: compilation, numerical execution and independent benchmarks remain unverified.",
  "The inspected AISC-authored ANSI/AISC 360-22 artifact is revised September 2023. January 2025 and September 2026 errata are listed by AISC, but their contents were not independently inspected or incorporated by this implementation. Supplied review declarations must establish that the implemented factors/equations remain applicable to the adopted project.",
  "Only the E3 flexural buckling subset and E1 resistance/safety factors are evaluated. E1 requires consideration of other applicable compression limit states; this E3 capacity is not a complete governing column capacity or national-code compliance assessment.",
  "B4.1/Table B4.1a nonslender compression-element classification and effective length determination are externally reviewed inputs; this module does not calculate or certify them.",
  "The supplied axial demand and its method-specific load combination are externally established. India, other countries, other editions and other section/load scopes receive no substitute US equations.",
];
const EXCLUDED_CHECKS = [
  "E1 minimum strength over all applicable compression limit states; complete member/code compliance",
  "E4 torsional and flexural-torsional buckling, including modes that may govern a doubly symmetric rolled I section",
  "B4.1/Table B4.1a width-thickness classification calculation and E7 slender-element behavior",
  "Chapter C/Appendix 7 effective length determination, direct analysis, frame stability and second-order effects",
  "Combined bending/axial force, torsion and Chapter H interaction",
  "Built-up, singly symmetric, unsymmetric, HSS, composite and non-prismatic sections",
  "Load combinations, local adoption/errata reconciliation, material qualification, connections, fatigue, fire and serviceability",
];
const INPUT_KEYS = ["id", "label", "kind", "inputSource", "loadCase", "loadSource", "sectionType", "prismatic", "doublySymmetric", "nonslenderCompressionElements", "classificationReviewSource", "amendmentScopeConfirmed", "amendmentReviewSource", "errataApplicabilityReviewed", "errataReviewSource", "areaM2", "inertiaYM4", "inertiaZM4", "unbracedLengthYM", "unbracedLengthZM", "steelYieldPa", "effectiveLengthFactorY", "effectiveLengthFactorZ", "demandAxialN", "momentsYNm", "momentsZNm", "designMethod", "loadBasis"];
const AXIS_KEYS = ["axis", "radiusM", "effectiveLengthM", "slenderness", "elasticBucklingStressPa", "yieldToElasticRatio", "nominalFlexuralStressPa", "curve"];
function record(value: unknown, path: string): Record<string, unknown> {
  if (!engineeringRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
}
function fields(raw: Record<string, unknown>, allowed: string[], path: string): void {
  const unexpected = Object.keys(raw).find(key => !allowed.includes(key));
  if (unexpected) throw new Error(`${path}.${unexpected} is unsupported by this bounded E3 subset.`);
}
function text(value: unknown, path: string, maximum = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${path} requires bounded non-empty text.`);
  return value;
}
function id(value: unknown, path: string): string {
  if (!identifier(value) || !value.trim()) throw new Error(`${path} requires a non-empty identifier of at most 100 characters.`);
  return value;
}
function parameter<Unit extends "Pa" | "1">(value: unknown, unit: Unit, path: string, minimum: number, maximum: number): USSteelCompressionParameter<Unit> {
  const raw = record(value, path); fields(raw, ["value", "unit", "source", "criterionId"], path);
  if (raw.unit !== unit) throw new Error(`${path}.unit must be ${unit}.`);
  return { value: requireFinite(raw.value, `${path}.value`, minimum, maximum), unit, source: text(raw.source, `${path}.source`, 2000), ...(raw.criterionId === undefined ? {} : { criterionId: id(raw.criterionId, `${path}.criterionId`) }) };
}

/** Strictly scoped, source-declared hot-rolled doubly symmetric I-section input. */
export function parseUSSteelCompressionInput(value: unknown): USSteelCompressionInput {
  const raw = record(value, "US steel compression input"); fields(raw, ["version", "checks"], "input");
  if (raw.version !== 1 || !Array.isArray(raw.checks) || !raw.checks.length || raw.checks.length > 100) throw new Error("US E3 input requires version 1 and 1-100 checks.");
  const ids = new Set<string>();
  const checks = raw.checks.map((entry, index): USSteelCompressionCheck => {
    const item = record(entry, `checks[${index}]`); fields(item, INPUT_KEYS, `checks[${index}]`);
    const checkId = id(item.id, "check.id");
    if (ids.has(checkId)) throw new Error("US E3 check IDs must be unique."); ids.add(checkId);
    const declarations: [string, string | number | boolean][] = [["kind", "us-aisc360-e3"], ["sectionType", "rolled-i"], ["prismatic", true], ["doublySymmetric", true], ["nonslenderCompressionElements", true], ["amendmentScopeConfirmed", true], ["errataApplicabilityReviewed", true], ["momentsYNm", 0], ["momentsZNm", 0]];
    for (const [key, expected] of declarations) if (item[key] !== expected) throw new Error(`${checkId}.${key} must explicitly declare ${String(expected)}.`);
    if (item.designMethod !== "LRFD" && item.designMethod !== "ASD") throw new Error(`${checkId}: designMethod must be LRFD or ASD.`);
    const design = item.designMethod === "LRFD" ? { designMethod: "LRFD" as const, loadBasis: "factored" as const } : { designMethod: "ASD" as const, loadBasis: "service" as const };
    if (item.loadBasis !== design.loadBasis) throw new Error(`${checkId}: LRFD requires factored demand; ASD requires service-level demand under the supplied applicable ASD load combination.`);
    return {
      id: checkId, label: text(item.label, "label", 200), kind: "us-aisc360-e3", inputSource: text(item.inputSource, "inputSource"), loadCase: text(item.loadCase, "loadCase", 200), loadSource: text(item.loadSource, "loadSource"),
      sectionType: "rolled-i", prismatic: true, doublySymmetric: true, nonslenderCompressionElements: true, classificationReviewSource: text(item.classificationReviewSource, "classificationReviewSource"),
      amendmentScopeConfirmed: true, amendmentReviewSource: text(item.amendmentReviewSource, "amendmentReviewSource"), errataApplicabilityReviewed: true, errataReviewSource: text(item.errataReviewSource, "errataReviewSource"),
      areaM2: requireFinite(item.areaM2, "areaM2", 1e-10, 100), inertiaYM4: requireFinite(item.inertiaYM4, "inertiaYM4", 1e-16, 1e6), inertiaZM4: requireFinite(item.inertiaZM4, "inertiaZM4", 1e-16, 1e6),
      unbracedLengthYM: requireFinite(item.unbracedLengthYM, "unbracedLengthYM", 0.001, 10000), unbracedLengthZM: requireFinite(item.unbracedLengthZM, "unbracedLengthZM", 0.001, 10000),
      steelYieldPa: parameter(item.steelYieldPa, "Pa", "steelYieldPa", 1e6, 2e9), effectiveLengthFactorY: parameter(item.effectiveLengthFactorY, "1", "effectiveLengthFactorY", 0.001, 100), effectiveLengthFactorZ: parameter(item.effectiveLengthFactorZ, "1", "effectiveLengthFactorZ", 0.001, 100),
      demandAxialN: requireFinite(item.demandAxialN, "demandAxialN", 0, 1e12), momentsYNm: 0, momentsZNm: 0, ...design,
    };
  });
  return { version: 1, checks };
}

/** Adoption and traceability checks only; no member analysis is performed here. */
function basisGates(source: USSteelCompressionInput, basis: EngineeringDesignBasis): string[] {
  const issues: string[] = [];
  if (basis.countryCode !== "US") issues.push(`Country ${basis.countryCode || "not selected"} is unsupported by this US E3 module; no US equations are substituted.`);
  if (basis.profileVersion !== ENGINEERING_BASIS_PROFILE_VERSION) issues.push("The captured basis catalog version requires adoption review against the supported catalog.");
  if (!basis.region.trim() || !basis.authority.trim()) issues.push("Declare the project region and authority having jurisdiction.");
  if (!basis.confirmed || !basis.reviewer.trim()) issues.push("A named reviewer must confirm the project adoption basis.");
  const standardIds = basis.standards.map(item => item.id), criterionIds = basis.criteria.map(item => item.id);
  if (standardIds.some(value => !value.trim()) || criterionIds.some(value => !value.trim()) || new Set(standardIds).size !== standardIds.length || new Set(criterionIds).size !== criterionIds.length) issues.push("Captured adopted standard and criterion IDs must be non-empty and unique.");
  const reference = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === "us-aisc360");
  const candidates = basis.standards.filter(item => item.id === "us-aisc360" || /^(?:ANSI\s*\/\s*)?AISC\s*360(?:[-:]\s*(?:22|2022))?$/i.test(item.code.trim()));
  if (!reference || candidates.length !== 1) issues.push("Adopt exactly one supported ANSI/AISC 360:2022 catalog reference; multiple declarations are ambiguous.");
  else {
    const adopted = candidates[0];
    if (adopted.id !== reference.id || adopted.domain !== reference.domain || adopted.code !== reference.code || adopted.edition !== "2022" || adopted.sourceUrl !== reference.sourceUrl) issues.push("The adopted AISC reference must exactly match the US steel catalog entry, edition 2022 and publisher reference.");
    if (!adopted.adoptionReference.trim() || !adopted.amendments.trim()) issues.push("Declare local AISC adoption and applicable amendments/errata; their reconciliation is externally reviewed.");
  }
  for (const check of source.checks) for (const [name, supplied] of [["steel yield", check.steelYieldPa], ["Y effective-length factor", check.effectiveLengthFactorY], ["Z effective-length factor", check.effectiveLengthFactorZ]] as const) {
    if (!supplied.criterionId) continue;
    const matches = basis.criteria.filter(item => item.id === supplied.criterionId), criterion = matches[0];
    if (matches.length !== 1 || !criterion || criterion.module !== "frame" || criterion.value !== supplied.value || criterion.unit !== supplied.unit || criterion.source !== supplied.source) issues.push(`${check.id}: ${name} must exactly match a unique captured frame criterion.`);
    else if (criterion.standardId) {
      const adoptedMatches = basis.standards.filter(item => item.id === criterion.standardId), adopted = adoptedMatches[0];
      if (adoptedMatches.length !== 1 || !adopted || !criterion.clause?.trim()) issues.push(`${check.id}: ${name} criterion requires a unique adopted standard and clause.`);
      else {
        if (!adopted.code.trim() || !adopted.edition.trim() || !adopted.adoptionReference.trim() || !adopted.amendments.trim() || !isEngineeringSourceUrl(adopted.sourceUrl)) issues.push(`${check.id}: ${name} criterion's standard requires complete edition, adoption, amendments and HTTPS source.`);
        const catalog = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === adopted.id);
        if (catalog && (catalog.countryCode !== basis.countryCode || catalog.code !== adopted.code || catalog.domain !== adopted.domain || !catalog.editions.includes(adopted.edition) || catalog.sourceUrl !== adopted.sourceUrl)) issues.push(`${check.id}: ${name} criterion's catalog reference differs from its country, code, domain, edition or publisher.`);
      }
    }
  }
  return issues;
}

function flexuralAxis(axis: "y" | "z", area: number, inertia: number, length: number, factor: number, yieldPa: number): USSteelCompressionAxis {
  const radiusM = Math.sqrt(inertia / area), effectiveLengthM = factor * length, slenderness = effectiveLengthM / radiusM;
  const elasticBucklingStressPa = Math.PI ** 2 * ELASTIC_MODULUS_PA / slenderness ** 2, yieldToElasticRatio = yieldPa / elasticBucklingStressPa;
  const curve = yieldToElasticRatio <= 2.25 ? "inelastic" : "elastic";
  const nominalFlexuralStressPa = curve === "inelastic" ? 0.658 ** yieldToElasticRatio * yieldPa : 0.877 * elasticBucklingStressPa;
  const result: USSteelCompressionAxis = { axis, radiusM, effectiveLengthM, slenderness, elasticBucklingStressPa, yieldToElasticRatio, nominalFlexuralStressPa, curve };
  if ([radiusM, effectiveLengthM, slenderness, elasticBucklingStressPa, yieldToElasticRatio, nominalFlexuralStressPa].some(value => !Number.isFinite(value) || value <= 0)) throw new Error("US E3 flexural calculation produced a non-finite or non-positive value.");
  return result;
}
function detailText(check: USSteelCompressionCheck, axes: USSteelCompressionAxis[]): string[] {
  return [
    "Gross area and both principal-axis inertias are supplied for the declared prismatic doubly symmetric hot-rolled I section; compression-element nonslender classification is externally reviewed.",
    check.designMethod === "LRFD" ? "The supplied positive compression demand is already factored for the declared LRFD load combination." : "The supplied positive compression demand is the service-level effect of the declared applicable ASD load combination.",
    "The smaller of the two calculated E3 principal-axis flexural strengths is reported. Other buckling modes can govern and are excluded from this subset.",
    "E2 effective length Lc=KL is supplied independently for each axis; the source must establish its applicable frame-analysis method and restraints.",
    ...(axes.some(axis => axis.slenderness > 200) ? ["Computed KL/r exceeds the preferred value 200 in the E2 User Note. This disclosed preference is not treated as a mandatory E3 strength limit."] : []),
  ];
}
function column(check: USSteelCompressionCheck): USSteelCompressionResult {
  const axes = [flexuralAxis("y", check.areaM2, check.inertiaYM4, check.unbracedLengthYM, check.effectiveLengthFactorY.value, check.steelYieldPa.value), flexuralAxis("z", check.areaM2, check.inertiaZM4, check.unbracedLengthZM, check.effectiveLengthFactorZ.value, check.steelYieldPa.value)];
  const nominalE3CapacityN = Math.min(axes[0].nominalFlexuralStressPa, axes[1].nominalFlexuralStressPa) * check.areaM2;
  const availableE3CapacityN = check.designMethod === "LRFD" ? RESISTANCE_FACTOR * nominalE3CapacityN : nominalE3CapacityN / SAFETY_FACTOR;
  const utilization = check.demandAxialN / availableE3CapacityN, satisfied = check.demandAxialN <= availableE3CapacityN;
  if (![nominalE3CapacityN, availableE3CapacityN].every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(utilization) || utilization < 0) throw new Error(`${check.id}: invalid US E3 strength or utilization.`);
  const governingFlexuralAxis = axes[0].nominalFlexuralStressPa === axes[1].nominalFlexuralStressPa ? "both" : axes[0].nominalFlexuralStressPa < axes[1].nominalFlexuralStressPa ? "y" : "z";
  return { id: check.id, kind: check.kind, designMethod: check.designMethod, status: satisfied ? "within-implemented-clause" : "exceeds-implemented-clause", elasticModulusPa: ELASTIC_MODULUS_PA, resistanceFactor: RESISTANCE_FACTOR, safetyFactor: SAFETY_FACTOR,
    axes, governingFlexuralAxis, nominalE3CapacityN, availableE3CapacityN, demandAxialN: check.demandAxialN, utilization,
    clauseChecks: [{ clause: `E3-1 with E1 ${check.designMethod} factor`, name: "Supplied axial compression demand within available E3 flexural strength only", satisfied }], details: detailText(check, axes), excludedChecks: [...EXCLUDED_CHECKS] };
}

/** A named national clause subset, not the full E1 governing compression capacity. */
export function assessUSSteelCompression(input: USSteelCompressionInput, designBasis: EngineeringDesignBasis): USSteelCompressionReport {
  const source = parseUSSteelCompressionInput(input), basis = parseEngineeringDesignBasis(designBasis), gates = basisGates(source, basis);
  return { version: 1, implementation: IMPLEMENTATION, verification: "unverified", compliance: "not-assessed", source, basis,
    status: gates.length ? "unsupported-basis" : "assessed-subset", basisIssues: [...gates, ...validateEngineeringDesignBasis(basis)], implementedClauses: gates.length ? [] : [...CLAUSES], results: gates.length ? [] : source.checks.map(column), warnings: [...WARNINGS] };
}

function textList(value: unknown, path: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${path} requires a bounded array.`);
  return value.map(item => text(item, path));
}
function sameTextList(value: unknown, expected: string[], path: string, maximum: number): boolean {
  return JSON.stringify(textList(value, path, maximum)) === JSON.stringify(expected);
}
/** Exact closed-form source algebra validates persisted values; no analysis routine is called. */
function restoredAxisMatches(value: unknown, axis: "y" | "z", check: USSteelCompressionCheck): value is USSteelCompressionAxis {
  const raw = record(value, "axis"); fields(raw, AXIS_KEYS, "axis");
  if (Object.keys(raw).length !== AXIS_KEYS.length || raw.axis !== axis) return false;
  const inertia = axis === "y" ? check.inertiaYM4 : check.inertiaZM4, length = axis === "y" ? check.unbracedLengthYM : check.unbracedLengthZM, factor = axis === "y" ? check.effectiveLengthFactorY.value : check.effectiveLengthFactorZ.value;
  const radiusM = Math.sqrt(inertia / check.areaM2), effectiveLengthM = factor * length, slenderness = effectiveLengthM / radiusM;
  const elasticBucklingStressPa = Math.PI ** 2 * ELASTIC_MODULUS_PA / slenderness ** 2, yieldToElasticRatio = check.steelYieldPa.value / elasticBucklingStressPa;
  const curve = yieldToElasticRatio <= 2.25 ? "inelastic" : "elastic", nominalFlexuralStressPa = curve === "inelastic" ? 0.658 ** yieldToElasticRatio * check.steelYieldPa.value : 0.877 * elasticBucklingStressPa;
  const expected: Record<string, number> = { radiusM, effectiveLengthM, slenderness, elasticBucklingStressPa, yieldToElasticRatio, nominalFlexuralStressPa };
  return raw.curve === curve && Object.entries(expected).every(([key, number]) => finiteNumber(number) && number > 0 && raw[key] === number);
}

/** Strict restore-only validation: malformed or stale records return false without reassessment/solving. */
export function validateUSSteelCompressionReport(value: unknown, input: USSteelCompressionInput, designBasis: EngineeringDesignBasis): value is USSteelCompressionReport {
  try {
    const source = parseUSSteelCompressionInput(input), basis = parseEngineeringDesignBasis(designBasis), raw = record(value, "US E3 report");
    fields(raw, ["version", "implementation", "verification", "compliance", "source", "basis", "status", "basisIssues", "implementedClauses", "results", "warnings"], "report");
    if (raw.version !== 1 || raw.implementation !== IMPLEMENTATION || raw.verification !== "unverified" || raw.compliance !== "not-assessed") return false;
    if (JSON.stringify(parseUSSteelCompressionInput(raw.source)) !== JSON.stringify(source) || engineeringBasisFingerprint(parseEngineeringDesignBasis(raw.basis)) !== engineeringBasisFingerprint(basis)) return false;
    const gates = basisGates(source, basis), supported = gates.length === 0;
    if (raw.status !== (supported ? "assessed-subset" : "unsupported-basis") || !sameTextList(raw.basisIssues, [...gates, ...validateEngineeringDesignBasis(basis)], "basisIssues", 1000) || !sameTextList(raw.implementedClauses, supported ? CLAUSES : [], "implementedClauses", 10) || !sameTextList(raw.warnings, WARNINGS, "warnings", 20)) return false;
    if (!Array.isArray(raw.results) || raw.results.length !== (supported ? source.checks.length : 0)) return false;
    for (let i = 0; i < raw.results.length; i++) {
      const item = record(raw.results[i], "result"), check = source.checks[i];
      fields(item, ["id", "kind", "designMethod", "status", "elasticModulusPa", "resistanceFactor", "safetyFactor", "axes", "governingFlexuralAxis", "nominalE3CapacityN", "availableE3CapacityN", "demandAxialN", "utilization", "clauseChecks", "details", "excludedChecks"], "result");
      if (item.id !== check.id || item.kind !== check.kind || item.designMethod !== check.designMethod || item.elasticModulusPa !== ELASTIC_MODULUS_PA || item.resistanceFactor !== RESISTANCE_FACTOR || item.safetyFactor !== SAFETY_FACTOR) return false;
      const axes = item.axes;
      if (!Array.isArray(axes) || axes.length !== 2) return false;
      const axisY = axes[0], axisZ = axes[1];
      if (!restoredAxisMatches(axisY, "y", check) || !restoredAxisMatches(axisZ, "z", check)) return false;
      const nominal = Math.min(axisY.nominalFlexuralStressPa, axisZ.nominalFlexuralStressPa) * check.areaM2, available = check.designMethod === "LRFD" ? RESISTANCE_FACTOR * nominal : nominal / SAFETY_FACTOR, utilization = check.demandAxialN / available;
      if (![nominal, available].every(number => finiteNumber(number) && number > 0) || !finiteNumber(utilization) || utilization < 0) return false;
      if (item.nominalE3CapacityN !== nominal || item.availableE3CapacityN !== available || item.demandAxialN !== check.demandAxialN || item.utilization !== utilization) return false;
      const governing = axisY.nominalFlexuralStressPa === axisZ.nominalFlexuralStressPa ? "both" : axisY.nominalFlexuralStressPa < axisZ.nominalFlexuralStressPa ? "y" : "z";
      const satisfied = check.demandAxialN <= available;
      if (item.governingFlexuralAxis !== governing || item.status !== (satisfied ? "within-implemented-clause" : "exceeds-implemented-clause")) return false;
      if (!Array.isArray(item.clauseChecks) || item.clauseChecks.length !== 1) return false;
      const clause = record(item.clauseChecks[0], "clauseCheck"); fields(clause, ["clause", "name", "satisfied"], "clauseCheck");
      if (clause.clause !== `E3-1 with E1 ${check.designMethod} factor` || clause.name !== "Supplied axial compression demand within available E3 flexural strength only" || clause.satisfied !== satisfied) return false;
      if (!sameTextList(item.details, detailText(check, [axisY, axisZ]), "details", 10) || !sameTextList(item.excludedChecks, EXCLUDED_CHECKS, "excludedChecks", 15)) return false;
    }
    return true;
  } catch { return false; }
}

/** Illustrative input only; project review and a matching confirmed US adoption basis are required. */
export function usSteelCompressionExample(): USSteelCompressionInput {
  return { version: 1, checks: [{ id: "aisc-e3-column-1", label: "US E3 flexural compression subset", kind: "us-aisc360-e3", inputSource: "Illustrative gross SI section properties and restraint lengths; replace with checked rolled-I project data.", loadCase: "replace-with-LRFD-project-combination", loadSource: "Illustrative positive factored compression; replace with the reviewed applicable LRFD load combination and analysis reference.",
    sectionType: "rolled-i", prismatic: true, doublySymmetric: true, nonslenderCompressionElements: true, classificationReviewSource: "Example declaration only; replace with the reviewed B4.1/Table B4.1a classification of every compression element.",
    amendmentScopeConfirmed: true, amendmentReviewSource: "Example declaration only; replace with reviewed local adoption and amendment applicability against the inspected revised September 2023 AISC artifact.", errataApplicabilityReviewed: true, errataReviewSource: "Example declaration only; replace with a review of the January 2025 and September 2026 errata confirming the applicability of the implemented E1 factors and E3 equations.",
    areaM2: 0.012, inertiaYM4: 0.0002, inertiaZM4: 0.00006, unbracedLengthYM: 4, unbracedLengthZM: 4, steelYieldPa: { value: 345e6, unit: "Pa", source: "Illustrative specified steel yield; replace with the reviewed project material specification." }, effectiveLengthFactorY: { value: 1, unit: "1", source: "Illustrative Y-axis K; replace with the reviewed applicable frame stability/restraint analysis." }, effectiveLengthFactorZ: { value: 1, unit: "1", source: "Illustrative Z-axis K; replace with the reviewed applicable frame stability/restraint analysis." }, demandAxialN: 1200000, momentsYNm: 0, momentsZNm: 0, designMethod: "LRFD", loadBasis: "factored",
  }] };
}
