import { ENGINEERING_BASIS_PROFILE_VERSION, ENGINEERING_STANDARD_REFERENCES, engineeringBasisFingerprint, isEngineeringSourceUrl, parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis } from "./engineeringBasis";
import { engineeringRecord, finiteNumber, identifier, requireFinite } from "./engineeringNumerics";

export interface USSteelFlexureParameter { value: number; unit: "Pa"; source: string; criterionId?: string }
interface USSteelFlexureSection {
  id: string; label: string; kind: "us-aisc360-f2";
  inputSource: string; loadCase: string; loadSource: string;
  sectionType: "rolled-i"; prismatic: true; doublySymmetric: true;
  compactFlanges: true; compactWeb: true; classificationReviewSource: string;
  sectionUnmodified: true; geometryReviewSource: string;
  supportsRestrainedAgainstTwist: true; bracingStrengthStiffnessReviewed: true;
  bracingDirectionsReviewed: true; bracingReviewSource: string;
  restraintType: "compression-flange" | "twist";
  amendmentScopeConfirmed: true; amendmentReviewSource: string;
  errataApplicabilityReviewed: true; errataReviewSource: string;
  areaM2: number; minorAxisInertiaM4: number; majorAxisPlasticSectionModulusM3: number;
  steelYieldPa: USSteelFlexureParameter;
  demandMajorMomentNm: number; demandAxialN: 0; demandMinorMomentNm: 0; demandTorqueNm: 0;
}
export type USSteelFlexureCheck = USSteelFlexureSection & (
  { designMethod: "LRFD"; loadBasis: "factored" } | { designMethod: "ASD"; loadBasis: "service" }
) & (
  { bracingMode: "continuous"; maximumUnbracedLengthM: 0 } | { bracingMode: "discrete"; maximumUnbracedLengthM: number }
);
export interface USSteelFlexureInput { version: 1; checks: USSteelFlexureCheck[] }
export interface USSteelFlexureResult {
  id: string; kind: "us-aisc360-f2"; designMethod: "LRFD" | "ASD";
  status: "within-implemented-clause" | "exceeds-implemented-clause" | "unsupported-unbraced-scope";
  elasticModulusPa: number; resistanceFactor: number; safetyFactor: number;
  minorAxisRadiusM: number; yieldingLimitUnbracedLengthM: number; maximumUnbracedLengthM: number;
  bracedYieldingScopeSatisfied: boolean;
  nominalF2CapacityNm: number | null; availableF2CapacityNm: number | null;
  demandMajorMomentNm: number; utilization: number | null;
  clauseChecks: { clause: string; name: string; satisfied: boolean | null }[];
  details: string[]; excludedChecks: string[];
}
export interface USSteelFlexureReport {
  version: 1; implementation: "AISC360-2022-F2-braced-yielding-v1";
  verification: "unverified"; compliance: "not-assessed";
  source: USSteelFlexureInput; basis: EngineeringDesignBasis;
  status: "assessed-subset" | "partial-subset" | "unsupported-basis";
  basisIssues: string[]; implementedClauses: string[]; results: USSteelFlexureResult[]; warnings: string[];
}

const IMPLEMENTATION = "AISC360-2022-F2-braced-yielding-v1";
const ELASTIC_MODULUS_PA = 200e9, RESISTANCE_FACTOR = 0.9, SAFETY_FACTOR = 1.67;
const OUTPUT_LIMIT = 1e24;
const CLAUSES = ["F1 resistance/safety factors only", "F2-1 major-axis yielding strength only", "F2.2(a) exclusion of lateral-torsional buckling for Lb<=Lp", "F2-5 limiting unbraced length Lp"];
const WARNINGS = [
  "Source inspection only: compilation, numerical execution and independent benchmarks remain unverified.",
  "The inspected references are the AISC-authored ANSI/AISC 360-22 artifact revised September 2023 and V16.0 companion design examples. January 2025 and September 2026 errata are listed by AISC, but their contents were not independently inspected or incorporated. Project review declarations must establish that the implemented equations/factors remain applicable.",
  "Only the F2 major-axis yielding subset for externally classified compact, doubly symmetric, prismatic hot-rolled I sections with Lb<=Lp is assessed. This is not a complete beam capacity or national-code compliance assessment.",
  "B4.1/Table B4.1b compact flexural-element classification, F1 support restraint, and Appendix 6 brace strength/stiffness and compression-flange reversal review are external authored declarations, not calculated or certified here.",
  "Lb>Lp receives no capacity or utilization because inelastic/elastic lateral-torsional buckling is not implemented. Neither a zero demand nor a yielding moment comparison can turn that unsupported result into a pass.",
  "Moment demand is an externally established non-negative magnitude under the supplied LRFD or ASD combination. This module does not construct load combinations or transfer its US equations to other countries/editions.",
];
const EXCLUDED_CHECKS = [
  "Complete beam/member/code compliance and minimum strength over every applicable limit state",
  "F2-2 through F2-4/F2-6 inelastic and elastic lateral-torsional buckling for Lb>Lp; moment-gradient Cb determination",
  "B4.1/Table B4.1b calculated flange/web compactness and noncompact/slender sections",
  "F1 support-restraint and Appendix 6 brace strength/stiffness, load-direction/reversal and brace connection calculations",
  "F13 holes, copes, notches and other local geometry reductions; modified section properties",
  "Chapter G shear, Chapter H axial/biaxial/torsional interactions, Chapter J concentrated-force and connection effects",
  "Frame stability, second-order effects, deflection, vibration, fatigue, fire and seismic detailing",
  "Channels, built-up, singly symmetric, unsymmetric, HSS, composite and non-prismatic sections",
  "Load combinations, local adoption/errata reconciliation, material qualification and construction certification",
];
const INPUT_KEYS = ["id", "label", "kind", "inputSource", "loadCase", "loadSource", "sectionType", "prismatic", "doublySymmetric", "compactFlanges", "compactWeb", "classificationReviewSource", "sectionUnmodified", "geometryReviewSource", "supportsRestrainedAgainstTwist", "bracingStrengthStiffnessReviewed", "bracingDirectionsReviewed", "bracingReviewSource", "restraintType", "bracingMode", "maximumUnbracedLengthM", "amendmentScopeConfirmed", "amendmentReviewSource", "errataApplicabilityReviewed", "errataReviewSource", "areaM2", "minorAxisInertiaM4", "majorAxisPlasticSectionModulusM3", "steelYieldPa", "demandMajorMomentNm", "demandAxialN", "demandMinorMomentNm", "demandTorqueNm", "designMethod", "loadBasis"];
const RESULT_KEYS = ["id", "kind", "designMethod", "status", "elasticModulusPa", "resistanceFactor", "safetyFactor", "minorAxisRadiusM", "yieldingLimitUnbracedLengthM", "maximumUnbracedLengthM", "bracedYieldingScopeSatisfied", "nominalF2CapacityNm", "availableF2CapacityNm", "demandMajorMomentNm", "utilization", "clauseChecks", "details", "excludedChecks"];
function record(value: unknown, path: string): Record<string, unknown> {
  if (!engineeringRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
}
function fields(raw: Record<string, unknown>, allowed: string[], path: string): void {
  const unexpected = Object.keys(raw).find(key => !allowed.includes(key));
  if (unexpected) throw new Error(`${path}.${unexpected} is unsupported by this bounded F2 subset.`);
}
function text(value: unknown, path: string, maximum = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${path} requires bounded non-empty text.`);
  return value;
}
function id(value: unknown, path: string): string {
  if (!identifier(value) || !value.trim()) throw new Error(`${path} requires a non-empty identifier of at most 100 characters.`);
  return value;
}
function parameter(value: unknown, path: string): USSteelFlexureParameter {
  const raw = record(value, path); fields(raw, ["value", "unit", "source", "criterionId"], path);
  if (raw.unit !== "Pa") throw new Error(`${path}.unit must be Pa.`);
  return { value: requireFinite(raw.value, `${path}.value`, 1e6, 2e9), unit: "Pa", source: text(raw.source, `${path}.source`, 2000), ...(raw.criterionId === undefined ? {} : { criterionId: id(raw.criterionId, `${path}.criterionId`) }) };
}

/** Strict authored geometry, compactness, bracing and method-specific load scope. */
export function parseUSSteelFlexureInput(value: unknown): USSteelFlexureInput {
  const raw = record(value, "US steel flexure input"); fields(raw, ["version", "checks"], "input");
  if (raw.version !== 1 || !Array.isArray(raw.checks) || !raw.checks.length || raw.checks.length > 100) throw new Error("US F2 input requires version 1 and 1-100 checks.");
  for (let index = 0; index < raw.checks.length; index++) if (!Object.prototype.hasOwnProperty.call(raw.checks, index)) throw new Error("US F2 checks cannot contain sparse entries.");
  const ids = new Set<string>();
  const checks = raw.checks.map((entry, index): USSteelFlexureCheck => {
    const item = record(entry, `checks[${index}]`); fields(item, INPUT_KEYS, `checks[${index}]`);
    const checkId = id(item.id, "check.id");
    if (ids.has(checkId)) throw new Error("US F2 check IDs must be unique."); ids.add(checkId);
    const declarations: [string, string | number | boolean][] = [["kind", "us-aisc360-f2"], ["sectionType", "rolled-i"], ["prismatic", true], ["doublySymmetric", true], ["compactFlanges", true], ["compactWeb", true], ["sectionUnmodified", true], ["supportsRestrainedAgainstTwist", true], ["bracingStrengthStiffnessReviewed", true], ["bracingDirectionsReviewed", true], ["amendmentScopeConfirmed", true], ["errataApplicabilityReviewed", true], ["demandAxialN", 0], ["demandMinorMomentNm", 0], ["demandTorqueNm", 0]];
    for (const [key, expected] of declarations) if (item[key] !== expected) throw new Error(`${checkId}.${key} must explicitly declare ${String(expected)}.`);
    if (item.designMethod !== "LRFD" && item.designMethod !== "ASD") throw new Error(`${checkId}: designMethod must be LRFD or ASD.`);
    const design = item.designMethod === "LRFD" ? { designMethod: "LRFD" as const, loadBasis: "factored" as const } : { designMethod: "ASD" as const, loadBasis: "service" as const };
    if (item.loadBasis !== design.loadBasis) throw new Error(`${checkId}: LRFD requires factored moment; ASD requires the service-level effect of the supplied applicable ASD combination.`);
    if (item.bracingMode !== "continuous" && item.bracingMode !== "discrete") throw new Error(`${checkId}: declare continuous or discrete bracing.`);
    const length = requireFinite(item.maximumUnbracedLengthM, "maximumUnbracedLengthM", 0, 10000);
    if (item.bracingMode === "continuous" && length !== 0) throw new Error(`${checkId}: continuous bracing requires Lb=0; discrete bracing requires a positive maximum segment length.`);
    if (item.bracingMode === "discrete" && length <= 0) throw new Error(`${checkId}: discrete bracing cannot imply a zero unbraced segment length.`);
    const bracing = item.bracingMode === "continuous" ? { bracingMode: "continuous" as const, maximumUnbracedLengthM: 0 as const } : { bracingMode: "discrete" as const, maximumUnbracedLengthM: length };
    if (item.restraintType !== "compression-flange" && item.restraintType !== "twist") throw new Error(`${checkId}: restraintType must identify compression-flange displacement or section twist restraint.`);
    return {
      id: checkId, label: text(item.label, "label", 200), kind: "us-aisc360-f2", inputSource: text(item.inputSource, "inputSource"), loadCase: text(item.loadCase, "loadCase", 200), loadSource: text(item.loadSource, "loadSource"),
      sectionType: "rolled-i", prismatic: true, doublySymmetric: true, compactFlanges: true, compactWeb: true, classificationReviewSource: text(item.classificationReviewSource, "classificationReviewSource"),
      sectionUnmodified: true, geometryReviewSource: text(item.geometryReviewSource, "geometryReviewSource"), supportsRestrainedAgainstTwist: true, bracingStrengthStiffnessReviewed: true, bracingDirectionsReviewed: true, bracingReviewSource: text(item.bracingReviewSource, "bracingReviewSource"), restraintType: item.restraintType,
      amendmentScopeConfirmed: true, amendmentReviewSource: text(item.amendmentReviewSource, "amendmentReviewSource"), errataApplicabilityReviewed: true, errataReviewSource: text(item.errataReviewSource, "errataReviewSource"),
      areaM2: requireFinite(item.areaM2, "areaM2", 1e-10, 100), minorAxisInertiaM4: requireFinite(item.minorAxisInertiaM4, "minorAxisInertiaM4", 1e-16, 1e6), majorAxisPlasticSectionModulusM3: requireFinite(item.majorAxisPlasticSectionModulusM3, "majorAxisPlasticSectionModulusM3", 1e-15, 1e4), steelYieldPa: parameter(item.steelYieldPa, "steelYieldPa"),
      demandMajorMomentNm: requireFinite(item.demandMajorMomentNm, "demandMajorMomentNm", 0, 1e12), demandAxialN: 0, demandMinorMomentNm: 0, demandTorqueNm: 0, ...design, ...bracing,
    };
  });
  return { version: 1, checks };
}

/** Traceability/adoption gates only; no beam/analysis routine is called. */
function basisGates(source: USSteelFlexureInput, basis: EngineeringDesignBasis): string[] {
  const issues = validateEngineeringDesignBasis(basis);
  if (basis.countryCode !== "US") issues.push(`Country ${basis.countryCode || "not selected"} is unsupported by this US F2 module; no US equations are substituted.`);
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
  for (const check of source.checks) {
    const supplied = check.steelYieldPa;
    if (!supplied.criterionId) continue;
    const matches = basis.criteria.filter(item => item.id === supplied.criterionId), criterion = matches[0];
    if (matches.length !== 1 || !criterion || criterion.module !== "frame" || criterion.value !== supplied.value || criterion.unit !== supplied.unit || criterion.source !== supplied.source) issues.push(`${check.id}: steel yield must exactly match a unique captured frame criterion.`);
    else if (criterion.standardId) {
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

function boundedPositive(value: number): boolean { return finiteNumber(value) && value > 0 && value <= OUTPUT_LIMIT; }
function detailText(check: USSteelFlexureCheck, braced: boolean): string[] {
  return [
    "The supplied gross SI properties describe one unmodified prismatic doubly symmetric hot-rolled I section; compact flange and web classification is externally reviewed under B4.1/Table B4.1b.",
    check.designMethod === "LRFD" ? "The supplied maximum absolute major-axis moment is already factored for the declared LRFD combination." : "The supplied maximum absolute major-axis moment is the service-level effect of the declared applicable ASD combination.",
    check.bracingMode === "continuous" ? "Continuous reviewed restraint is declared throughout the member, Lb=0; support twist restraint and brace adequacy still require the external review." : "Lb is the largest reviewed compression-flange/twist-braced segment for all moment signs in this load case; support twist restraint and brace strength/stiffness remain external review inputs.",
    "The minor-axis radius is derived from sqrt(Iminor/Ag); F2-5 gives Lp=1.76*rminor*sqrt(E/Fy) using the specified SI elastic modulus 200000 MPa.",
    braced ? "Lb<=Lp lies in the implemented F2 yielding region. F2-1 Mn=Fy*Zmajor is compared with the method-specific supplied demand using F1 factors." : "Lb>Lp requires lateral-torsional buckling equations that are outside this implementation. Capacity, utilization and the strength comparison are unassessed and remain null.",
  ];
}
function clauseChecks(check: USSteelFlexureCheck, braced: boolean, satisfied: boolean | null): USSteelFlexureResult["clauseChecks"] {
  return [
    { clause: "F2.2(a), F2-5", name: "Reviewed maximum unbraced length Lb within limiting yielding length Lp", satisfied: braced },
    { clause: `F2-1 with F1 ${check.designMethod} factor`, name: "Supplied major-axis moment within available F2 yielding strength only", satisfied },
  ];
}
function beam(check: USSteelFlexureCheck): USSteelFlexureResult {
  const minorAxisRadiusM = Math.sqrt(check.minorAxisInertiaM4 / check.areaM2), yieldingLimitUnbracedLengthM = 1.76 * minorAxisRadiusM * Math.sqrt(ELASTIC_MODULUS_PA / check.steelYieldPa.value);
  if (![minorAxisRadiusM, yieldingLimitUnbracedLengthM].every(boundedPositive)) throw new Error(`${check.id}: F2 geometry produced an invalid or out-of-bound derived quantity.`);
  const braced = check.maximumUnbracedLengthM <= yieldingLimitUnbracedLengthM;
  const nominalF2CapacityNm = braced ? check.steelYieldPa.value * check.majorAxisPlasticSectionModulusM3 : null;
  const availableF2CapacityNm = nominalF2CapacityNm === null ? null : check.designMethod === "LRFD" ? RESISTANCE_FACTOR * nominalF2CapacityNm : nominalF2CapacityNm / SAFETY_FACTOR;
  const utilization = availableF2CapacityNm === null ? null : check.demandMajorMomentNm / availableF2CapacityNm;
  if ((nominalF2CapacityNm !== null && !boundedPositive(nominalF2CapacityNm)) || (availableF2CapacityNm !== null && !boundedPositive(availableF2CapacityNm)) || (utilization !== null && (!finiteNumber(utilization) || utilization < 0 || utilization > OUTPUT_LIMIT))) throw new Error(`${check.id}: invalid or out-of-bound F2 strength/utilization.`);
  const satisfied = availableF2CapacityNm === null ? null : check.demandMajorMomentNm <= availableF2CapacityNm;
  return { id: check.id, kind: check.kind, designMethod: check.designMethod, status: satisfied === null ? "unsupported-unbraced-scope" : satisfied ? "within-implemented-clause" : "exceeds-implemented-clause",
    elasticModulusPa: ELASTIC_MODULUS_PA, resistanceFactor: RESISTANCE_FACTOR, safetyFactor: SAFETY_FACTOR, minorAxisRadiusM, yieldingLimitUnbracedLengthM, maximumUnbracedLengthM: check.maximumUnbracedLengthM,
    bracedYieldingScopeSatisfied: braced, nominalF2CapacityNm, availableF2CapacityNm, demandMajorMomentNm: check.demandMajorMomentNm, utilization,
    clauseChecks: clauseChecks(check, braced, satisfied), details: detailText(check, braced), excludedChecks: [...EXCLUDED_CHECKS] };
}

/** Named braced-yielding subset; unsupported LTB regions never receive yielding capacity. */
export function assessUSSteelFlexure(input: USSteelFlexureInput, designBasis: EngineeringDesignBasis): USSteelFlexureReport {
  const source = parseUSSteelFlexureInput(input), basis = parseEngineeringDesignBasis(designBasis), gates = basisGates(source, basis);
  const results = gates.length ? [] : source.checks.map(beam);
  const report: USSteelFlexureReport = { version: 1, implementation: IMPLEMENTATION, verification: "unverified", compliance: "not-assessed", source, basis,
    status: gates.length ? "unsupported-basis" : results.some(item => item.status === "unsupported-unbraced-scope") ? "partial-subset" : "assessed-subset", basisIssues: gates, implementedClauses: gates.length ? [] : [...CLAUSES], results, warnings: [...WARNINGS] };
  if (!validateUSSteelFlexureReport(report, source, basis)) throw new Error("Generated US F2 report failed its bounded source-coherence contract.");
  return report;
}

function sameTextList(value: unknown, expected: string[], path: string, maximum: number): boolean {
  if (!Array.isArray(value) || value.length > maximum) return false;
  return JSON.stringify(value.map(item => text(item, path))) === JSON.stringify(expected);
}
function strictSavedBasis(value: unknown): EngineeringDesignBasis {
  const raw = record(value, "saved basis"); fields(raw, ["version", "profileVersion", "countryCode", "region", "authority", "standards", "declaration", "criteria", "confirmed", "reviewer", "reviewNote"], "saved basis");
  fields(record(raw.declaration, "saved declaration"), ["occupancy", "riskCategory", "structuralSystem", "material", "soil", "loads", "hazards"], "saved declaration");
  for (const [key, maximum, allowed] of [["standards", 40, ["id", "domain", "code", "edition", "sourceUrl", "adoptionReference", "amendments"]], ["criteria", 64, ["id", "module", "name", "value", "unit", "source", "standardId", "clause"]]] as const) {
    const entries = raw[key];
    if (!Array.isArray(entries) || entries.length > maximum) throw new Error(`saved basis.${key} requires a bounded array.`);
    for (let index = 0; index < entries.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(entries, index)) throw new Error(`saved basis.${key} cannot contain sparse entries.`);
      fields(record(entries[index], `saved basis.${key}`), [...allowed], `saved basis.${key}`);
    }
  }
  return parseEngineeringDesignBasis(raw);
}

/** Exact closed-form persisted algebra only; never calls the assessor/beam routine or a solver. */
export function validateUSSteelFlexureReport(value: unknown, input: USSteelFlexureInput, designBasis: EngineeringDesignBasis): value is USSteelFlexureReport {
  try {
    const source = parseUSSteelFlexureInput(input), basis = parseEngineeringDesignBasis(designBasis), raw = record(value, "US F2 report");
    fields(raw, ["version", "implementation", "verification", "compliance", "source", "basis", "status", "basisIssues", "implementedClauses", "results", "warnings"], "report");
    if (raw.version !== 1 || raw.implementation !== IMPLEMENTATION || raw.verification !== "unverified" || raw.compliance !== "not-assessed") return false;
    if (JSON.stringify(parseUSSteelFlexureInput(raw.source)) !== JSON.stringify(source) || engineeringBasisFingerprint(strictSavedBasis(raw.basis)) !== engineeringBasisFingerprint(basis)) return false;
    const gates = basisGates(source, basis), supported = gates.length === 0;
    if (!sameTextList(raw.basisIssues, gates, "basisIssues", 1000) || !sameTextList(raw.implementedClauses, supported ? CLAUSES : [], "implementedClauses", 10) || !sameTextList(raw.warnings, WARNINGS, "warnings", 20)) return false;
    if (!Array.isArray(raw.results) || raw.results.length !== (supported ? source.checks.length : 0)) return false;
    let partial = false;
    for (let i = 0; i < raw.results.length; i++) {
      const item = record(raw.results[i], "result"), check = source.checks[i]; fields(item, RESULT_KEYS, "result");
      if (item.id !== check.id || item.kind !== check.kind || item.designMethod !== check.designMethod || item.elasticModulusPa !== ELASTIC_MODULUS_PA || item.resistanceFactor !== RESISTANCE_FACTOR || item.safetyFactor !== SAFETY_FACTOR) return false;
      const radius = Math.sqrt(check.minorAxisInertiaM4 / check.areaM2), limit = 1.76 * radius * Math.sqrt(ELASTIC_MODULUS_PA / check.steelYieldPa.value);
      if (![radius, limit].every(boundedPositive) || item.minorAxisRadiusM !== radius || item.yieldingLimitUnbracedLengthM !== limit || item.maximumUnbracedLengthM !== check.maximumUnbracedLengthM) return false;
      const braced = check.maximumUnbracedLengthM <= limit;
      const nominal = braced ? check.steelYieldPa.value * check.majorAxisPlasticSectionModulusM3 : null;
      const available = nominal === null ? null : check.designMethod === "LRFD" ? RESISTANCE_FACTOR * nominal : nominal / SAFETY_FACTOR;
      const utilization = available === null ? null : check.demandMajorMomentNm / available;
      if ((nominal !== null && !boundedPositive(nominal)) || (available !== null && !boundedPositive(available)) || (utilization !== null && (!finiteNumber(utilization) || utilization < 0 || utilization > OUTPUT_LIMIT))) return false;
      const satisfied = available === null ? null : check.demandMajorMomentNm <= available;
      if (item.bracedYieldingScopeSatisfied !== braced || item.nominalF2CapacityNm !== nominal || item.availableF2CapacityNm !== available || item.demandMajorMomentNm !== check.demandMajorMomentNm || item.utilization !== utilization || item.status !== (satisfied === null ? "unsupported-unbraced-scope" : satisfied ? "within-implemented-clause" : "exceeds-implemented-clause")) return false;
      partial ||= !braced;
      if (!Array.isArray(item.clauseChecks) || item.clauseChecks.length !== 2) return false;
      const expectedClauses = clauseChecks(check, braced, satisfied);
      for (let j = 0; j < expectedClauses.length; j++) {
        const clause = record(item.clauseChecks[j], "clauseCheck"), expected = expectedClauses[j]; fields(clause, ["clause", "name", "satisfied"], "clauseCheck");
        if (clause.clause !== expected.clause || clause.name !== expected.name || clause.satisfied !== expected.satisfied) return false;
      }
      if (!sameTextList(item.details, detailText(check, braced), "details", 10) || !sameTextList(item.excludedChecks, EXCLUDED_CHECKS, "excludedChecks", 15)) return false;
    }
    return raw.status === (!supported ? "unsupported-basis" : partial ? "partial-subset" : "assessed-subset");
  } catch { return false; }
}

/** Illustrative declarations only; replace each review and adopt a confirmed matching US basis. */
export function usSteelFlexureExample(): USSteelFlexureInput {
  return { version: 1, checks: [{ id: "aisc-f2-beam-1", label: "US F2 braced major-axis yielding subset", kind: "us-aisc360-f2",
    inputSource: "Illustrative gross SI section properties; replace with checked unmodified rolled-I project properties.", loadCase: "replace-with-LRFD-project-combination", loadSource: "Illustrative maximum absolute factored major-axis moment; replace with reviewed applicable LRFD load combination and analysis reference.",
    sectionType: "rolled-i", prismatic: true, doublySymmetric: true, compactFlanges: true, compactWeb: true, classificationReviewSource: "Example declaration only; replace with B4.1/Table B4.1b flexural compactness review of both flanges and the web at the specified material grade.",
    sectionUnmodified: true, geometryReviewSource: "Example declaration only; replace with checked confirmation of no holes, copes, notches or section modifications requiring F13/local reductions.",
    supportsRestrainedAgainstTwist: true, bracingStrengthStiffnessReviewed: true, bracingDirectionsReviewed: true, bracingReviewSource: "Example declaration only; replace with F1 support twist restraint, Appendix 6 brace strength/stiffness and connection review for every compression-flange direction and moment reversal in this combination.",
    restraintType: "compression-flange", bracingMode: "discrete", maximumUnbracedLengthM: 2,
    amendmentScopeConfirmed: true, amendmentReviewSource: "Example declaration only; replace with reviewed local adoption and amendment applicability against the inspected AISC 360-22/V16.0 artifacts.", errataApplicabilityReviewed: true, errataReviewSource: "Example declaration only; replace with reviewed January 2025 and September 2026 errata confirming applicability of the implemented F1 factors and F2 equations.",
    areaM2: 0.01, minorAxisInertiaM4: 0.00004, majorAxisPlasticSectionModulusM3: 0.0012, steelYieldPa: { value: 345e6, unit: "Pa", source: "Illustrative specified minimum steel yield strength; replace with reviewed project material specification." },
    demandMajorMomentNm: 250000, demandAxialN: 0, demandMinorMomentNm: 0, demandTorqueNm: 0, designMethod: "LRFD", loadBasis: "factored",
  }] };
}
