import { ENGINEERING_BASIS_PROFILE_VERSION, ENGINEERING_STANDARD_REFERENCES, engineeringBasisFingerprint, parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis } from "./engineeringBasis";
import { engineeringRecord, finiteNumber, identifier, requireFinite } from "./engineeringNumerics";

export interface NationalSeismicParameter<Unit extends "1" | "s" | "N"> { value: number; unit: Unit; source: string; criterionId?: string }
export interface NationalSeismicFloor { id: string; heightM: number; seismicWeightN: NationalSeismicParameter<"N"> }
export interface NationalSeismicCheck {
  id: string; label: string; kind: "in-is1893-equivalent-static";
  axis: "X" | "Y"; axisSource: string; inputSource: string;
  seismicZone: "II" | "III" | "IV" | "V"; regularity: "regular" | "irregular";
  soilType: "I" | "II" | "III" | "site-specific";
  spectrumKind: "code-equivalent-static-5-percent" | "response-spectrum" | "site-specific";
  buildingHeightM: number; ordinaryBuilding: boolean; baseAtGroundLevel: boolean; basementPresent: boolean;
  energyDissipationDevicesPresent: boolean; baseIsolationPresent: boolean; prestressedMembersPresent: boolean;
  longSpanAmplificationPresent: boolean; largeOverhangsPresent: boolean;
  verticalEffectsRequired: boolean; dynamicAnalysisRequired: boolean; rigidDiaphragmReviewed: boolean;
  methodReviewSource: string; regularityReviewSource: string; siteReviewSource: string;
  coefficientReviewSource: string; periodReviewSource: string; seismicWeightReviewSource: string;
  adopted2016ApplicabilityConfirmed: true; amendmentScopeConfirmed: true; amendmentReviewSource: string;
  zFactor: NationalSeismicParameter<"1">; importanceFactor: NationalSeismicParameter<"1">;
  responseReductionFactor: NationalSeismicParameter<"1">; saOverG: NationalSeismicParameter<"1">;
  approximatePeriodS: NationalSeismicParameter<"s">; floors: NationalSeismicFloor[];
}
export interface NationalSeismicInput { version: 1; checks: NationalSeismicCheck[] }
export interface NationalSeismicMetrics {
  horizontalCoefficient: number; totalSeismicWeightN: number;
  coefficientBaseShearN: number; minimumBaseShearCoefficient: number; minimumBaseShearN: number;
  adoptedBaseShearN: number; governingBaseShear: "coefficient" | "minimum" | "both";
  weightHeightSquaredSumNm2: number; distributedForceSumN: number;
  forceBalanceResidualN: number; relativeForceBalanceResidual: number;
  overturningMomentAtBaseNm: number;
}
export interface NationalSeismicFloorAction {
  id: string; heightM: number; seismicWeightN: number; weightHeightSquaredNm2: number;
  distributionFraction: number; forcePositiveN: number; forceNegativeN: number;
  storeyShearBelowFloorN: number;
}
export interface NationalSeismicResult {
  id: string; kind: "in-is1893-equivalent-static"; axis: "X" | "Y";
  status: "generated-floor-actions" | "unsupported-method"; scopeIssues: string[];
  metrics: NationalSeismicMetrics | null; floors: NationalSeismicFloorAction[];
  clauseChecks: { clause: string; name: string; satisfied: boolean }[];
  details: string[]; excludedChecks: string[];
}
export interface NationalSeismicReport {
  version: 1; implementation: "IS1893-2016-equivalent-static-floor-actions-v1";
  verification: "unverified"; compliance: "not-assessed";
  source: NationalSeismicInput; basis: EngineeringDesignBasis;
  status: "assessed-subset" | "partially-supported-scope" | "unsupported-scope" | "unsupported-basis"; basisIssues: string[];
  implementedClauses: string[]; results: NationalSeismicResult[]; warnings: string[];
}

const IMPLEMENTATION = "IS1893-2016-equivalent-static-floor-actions-v1";
const ZONE_II_FACTOR = 0.1, SHORT_PERIOD_SA_OVER_G = 2.5, ZONE_II_MINIMUM_COEFFICIENT = 0.007;
const FORCE_BALANCE_TOLERANCE = 1e-12;
const CLAUSES = ["6.4.2 horizontal coefficient with authored parameters", "6.4.3 and 7.6/7.7.1 static applicability bounds", "7.2.2/Table 7 Zone II minimum force", "7.6.1 base shear", "7.6.3(a) floor-height distribution", "7.6.3(b) storey shear summation only"];
const WARNINGS = [
  "Source inspection only: TypeScript compilation, numerical execution and independent benchmarks remain unverified.",
  "The inspected BIS-authored IS 1893 Part 1:2016 artifact includes Amendment 1 (September 2017) and Amendment 2 (November 2020). Later amendments and the separately listed 2025 edition are not implemented; the supplied reviewer declaration must establish the applicability of the adopted 2016 project basis.",
  "Only floor-centre-of-mass horizontal actions are generated for the declared principal plan axis. Generated actions are not complete seismic design, member demand, capacity, safety or national-code compliance results.",
  "Torsion, accidental eccentricity and in-plan distribution remain required external considerations even for a regular building. No generated floor action states that these effects are unnecessary.",
  "The site zone, soil classification, approximate period, importance/response factors, regularity, seismic weights and static-method eligibility are externally reviewed author declarations. No location/hazard lookup, material/system table selection or automatic mass conversion is performed.",
  "Gravity/seismic combinations, simultaneous directional effects, vertical effects, structural analysis, modal response and node/element mapping remain outside this increment.",
];
const EXCLUDED_CHECKS = [
  "Full IS 1893/IS 13920 seismic design, local adoption and later amendments/editions",
  "Site hazard lookup, Tables 4/5/6/8/9 classification and importance/response-factor selection",
  "7.6.2 approximate period calculation, including Amendment 2 bounds and foundation/infill effects",
  "7.3/7.4 seismic-weight derivation, imposed-load fractions, partitions and wall/column apportionment",
  "7.7 response spectrum, modal participation, modal combinations, time history and dynamic base-shear scaling",
  "7.8 torsion/accidental eccentricity and 7.6.3(b) in-plan stiffness/diaphragm distribution",
  "Vertical/three-direction effects, soil-structure interaction and below-ground reduction procedures",
  "Gravity/seismic combinations, frame/member analysis, drift, stability, detailing, anchorage and foundations",
];
const BOOLEAN_KEYS = ["ordinaryBuilding", "baseAtGroundLevel", "basementPresent", "energyDissipationDevicesPresent", "baseIsolationPresent", "prestressedMembersPresent", "longSpanAmplificationPresent", "largeOverhangsPresent", "verticalEffectsRequired", "dynamicAnalysisRequired", "rigidDiaphragmReviewed"] as const;
const REVIEW_KEYS = ["methodReviewSource", "regularityReviewSource", "siteReviewSource", "coefficientReviewSource", "periodReviewSource", "seismicWeightReviewSource"] as const;
const INPUT_KEYS = ["id", "label", "kind", "axis", "axisSource", "inputSource", "seismicZone", "regularity", "soilType", "spectrumKind", "buildingHeightM", ...BOOLEAN_KEYS, ...REVIEW_KEYS, "adopted2016ApplicabilityConfirmed", "amendmentScopeConfirmed", "amendmentReviewSource", "zFactor", "importanceFactor", "responseReductionFactor", "saOverG", "approximatePeriodS", "floors"];
const METRIC_KEYS = ["horizontalCoefficient", "totalSeismicWeightN", "coefficientBaseShearN", "minimumBaseShearCoefficient", "minimumBaseShearN", "adoptedBaseShearN", "governingBaseShear", "weightHeightSquaredSumNm2", "distributedForceSumN", "forceBalanceResidualN", "relativeForceBalanceResidual", "overturningMomentAtBaseNm"];
const FLOOR_KEYS = ["id", "heightM", "seismicWeightN", "weightHeightSquaredNm2", "distributionFraction", "forcePositiveN", "forceNegativeN", "storeyShearBelowFloorN"];
function record(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  if (!engineeringRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${path} contains invalid or unsupported fields.`);
  return value;
}
function text(value: unknown, path: string, maximum = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${path} requires bounded non-empty text.`);
  return value;
}
function id(value: unknown, path: string): string {
  if (!identifier(value) || !value.trim()) throw new Error(`${path} requires a non-empty identifier of at most 100 characters.`);
  return value;
}
function choice<Choice extends string>(value: unknown, choices: readonly Choice[], path: string): Choice {
  if (typeof value !== "string" || !choices.includes(value as Choice)) throw new Error(`${path} is unsupported.`);
  return value as Choice;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} requires an explicit boolean declaration.`);
  return value;
}
function list(value: unknown, path: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error(`${path} requires ${minimum}-${maximum} entries.`);
  for (let i = 0; i < value.length; i++) if (!Object.prototype.hasOwnProperty.call(value, i)) throw new Error(`${path} requires dense arrays without missing entries.`);
  return value;
}
function parameter<Unit extends "1" | "s" | "N">(value: unknown, unit: Unit, path: string, minimum: number, maximum: number): NationalSeismicParameter<Unit> {
  const raw = record(value, path, ["value", "unit", "source", "criterionId"]);
  if (raw.unit !== unit) throw new Error(`${path}.unit must be ${unit}.`);
  return { value: requireFinite(raw.value, `${path}.value`, minimum, maximum), unit, source: text(raw.source, `${path}.source`), ...(raw.criterionId === undefined ? {} : { criterionId: id(raw.criterionId, `${path}.criterionId`) }) };
}

/** Bounded author declarations; valid but ineligible static-method scopes are reported explicitly. */
export function parseNationalSeismicInput(value: unknown): NationalSeismicInput {
  const raw = record(value, "National seismic input", ["version", "checks"]);
  if (raw.version !== 1) throw new Error("National seismic input requires version 1.");
  const ids = new Set<string>(); let floorCount = 0;
  const checks = list(raw.checks, "Seismic checks", 1, 20).map((entry): NationalSeismicCheck => {
    const item = record(entry, "Seismic check", INPUT_KEYS), checkId = id(item.id, "check.id");
    if (ids.has(checkId)) throw new Error("Seismic check IDs must be unique."); ids.add(checkId);
    if (item.kind !== "in-is1893-equivalent-static" || item.adopted2016ApplicabilityConfirmed !== true || item.amendmentScopeConfirmed !== true) throw new Error(`${checkId}: explicitly declare this named 2016 method and reviewed edition/amendment applicability.`);
    const declarations = Object.fromEntries(BOOLEAN_KEYS.map(key => [key, boolean(item[key], key)])) as Record<typeof BOOLEAN_KEYS[number], boolean>;
    const reviews = Object.fromEntries(REVIEW_KEYS.map(key => [key, text(item[key], key, 4000)])) as Record<typeof REVIEW_KEYS[number], string>;
    const buildingHeightM = requireFinite(item.buildingHeightM, "buildingHeightM", 0.001, 1000), floorIds = new Set<string>();
    let precedingHeight = 0;
    const floors = list(item.floors, "Floors", 1, 40).map((entry): NationalSeismicFloor => {
      const floor = record(entry, "Floor", ["id", "heightM", "seismicWeightN"]), floorId = id(floor.id, "floor.id"), heightM = requireFinite(floor.heightM, "floor.heightM", 0.001, 1000);
      if (floorIds.has(floorId) || heightM <= precedingHeight || heightM > buildingHeightM) throw new Error(`${checkId}: floors need unique IDs and strictly increasing positive heights from the declared base, no higher than the building height.`);
      floorIds.add(floorId); precedingHeight = heightM;
      return { id: floorId, heightM, seismicWeightN: parameter(floor.seismicWeightN, "N", "floor.seismicWeightN", 1e-6, 1e12) };
    });
    if (floors[floors.length - 1].heightM !== buildingHeightM) throw new Error(`${checkId}: the last mass level must exactly match the declared building height for this product scope.`);
    floorCount += floors.length;
    return { id: checkId, label: text(item.label, "label", 200), kind: "in-is1893-equivalent-static", axis: choice(item.axis, ["X", "Y"] as const, "axis"), axisSource: text(item.axisSource, "axisSource"), inputSource: text(item.inputSource, "inputSource", 4000),
      seismicZone: choice(item.seismicZone, ["II", "III", "IV", "V"] as const, "seismicZone"), regularity: choice(item.regularity, ["regular", "irregular"] as const, "regularity"), soilType: choice(item.soilType, ["I", "II", "III", "site-specific"] as const, "soilType"), spectrumKind: choice(item.spectrumKind, ["code-equivalent-static-5-percent", "response-spectrum", "site-specific"] as const, "spectrumKind"), buildingHeightM, ...declarations, ...reviews,
      adopted2016ApplicabilityConfirmed: true, amendmentScopeConfirmed: true, amendmentReviewSource: text(item.amendmentReviewSource, "amendmentReviewSource", 4000),
      zFactor: parameter(item.zFactor, "1", "zFactor", 1e-6, 1), importanceFactor: parameter(item.importanceFactor, "1", "importanceFactor", 1, 10), responseReductionFactor: parameter(item.responseReductionFactor, "1", "responseReductionFactor", 1, 100), saOverG: parameter(item.saOverG, "1", "saOverG", 1e-6, 100), approximatePeriodS: parameter(item.approximatePeriodS, "s", "approximatePeriodS", 1e-6, 100), floors,
    };
  });
  if (floorCount > 200) throw new Error("At most 200 total floor mass levels are supported per seismic input.");
  return { version: 1, checks };
}

function sourcedParameters(check: NationalSeismicCheck): { name: string; quantity: NationalSeismicParameter<"1" | "s" | "N"> }[] {
  return [{ name: "Z", quantity: check.zFactor }, { name: "I", quantity: check.importanceFactor }, { name: "R", quantity: check.responseReductionFactor }, { name: "Sa/g", quantity: check.saOverG }, { name: "approximate period", quantity: check.approximatePeriodS }, ...check.floors.map(floor => ({ name: `${floor.id} seismic weight`, quantity: floor.seismicWeightN }))];
}
/** This national module captures the complete known metadata shape, never ignored extra basis fields. */
function capturedBasis(value: unknown): EngineeringDesignBasis {
  const raw = record(value, "Design basis", ["version", "profileVersion", "countryCode", "region", "authority", "standards", "declaration", "criteria", "confirmed", "reviewer", "reviewNote"]);
  record(raw.declaration, "Design basis declaration", ["occupancy", "riskCategory", "structuralSystem", "material", "soil", "loads", "hazards"]);
  for (const standard of list(raw.standards, "Basis standards", 0, 40)) record(standard, "Adopted standard", ["id", "domain", "code", "edition", "sourceUrl", "adoptionReference", "amendments"]);
  for (const criterion of list(raw.criteria, "Basis criteria", 0, 64)) record(criterion, "Basis criterion", ["id", "module", "name", "value", "unit", "source", "standardId", "clause"]);
  return parseEngineeringDesignBasis(raw);
}
/** Metadata and source-link gates only. */
function basisGates(source: NationalSeismicInput, basis: EngineeringDesignBasis): string[] {
  const issues = validateEngineeringDesignBasis(basis);
  if (basis.countryCode !== "IN") issues.push(`Country ${basis.countryCode || "not selected"} is unsupported by this Indian 2016 seismic subset; no Indian coefficients are substituted.`);
  if (basis.profileVersion !== ENGINEERING_BASIS_PROFILE_VERSION) issues.push("The captured design-basis catalog version requires review against the supported catalog.");
  if (!basis.region.trim() || !basis.authority.trim()) issues.push("Declare the project region and authority having jurisdiction.");
  if (!basis.confirmed || !basis.reviewer.trim()) issues.push("A named reviewer must confirm the project adoption basis.");
  const standardIds = basis.standards.map(item => item.id), criterionIds = basis.criteria.map(item => item.id);
  if (standardIds.some(value => !value.trim()) || criterionIds.some(value => !value.trim()) || new Set(standardIds).size !== standardIds.length || new Set(criterionIds).size !== criterionIds.length) issues.push("Captured standard and criterion IDs must be non-empty and unique.");
  const reference = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === "in-is1893-1"), candidates = basis.standards.filter(item => item.id === "in-is1893-1" || /^IS\s*1893\s*[-:/]?\s*\(?\s*(?:Part\s*)?1\s*\)?(?:\s*[-:/]\s*(?:2016|2025))?$/i.test(item.code.trim()));
  if (!reference || candidates.length !== 1) issues.push("Adopt exactly one supported IS 1893 Part 1:2016 reference; multiple declarations are ambiguous.");
  else {
    const adopted = candidates[0];
    if (adopted.id !== reference.id || adopted.domain !== reference.domain || adopted.code !== reference.code || adopted.edition !== "2016" || adopted.sourceUrl !== reference.sourceUrl) issues.push("The adopted seismic reference must exactly match the Indian IS 1893 Part 1 catalog entry, edition 2016 and publisher reference.");
    if (!adopted.adoptionReference.trim() || !adopted.amendments.trim()) issues.push("Declare local 2016 adoption and amendment applicability, including the inspected 2017/2020 amendments and review of subsequent changes.");
  }
  for (const check of source.checks) for (const { name, quantity } of sourcedParameters(check)) {
    if (!quantity.criterionId) continue;
    const matches = basis.criteria.filter(item => item.id === quantity.criterionId), criterion = matches[0];
    if (matches.length !== 1 || !criterion || criterion.module !== "frame" || criterion.value !== quantity.value || criterion.unit !== quantity.unit || criterion.source !== quantity.source) issues.push(`${check.id}: ${name} must exactly match a unique captured frame criterion's value, unit and source.`);
    else if (criterion.standardId) {
      const standards = basis.standards.filter(item => item.id === criterion.standardId), adopted = standards[0], catalog = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === criterion.standardId);
      if (standards.length !== 1 || !adopted || !catalog || catalog.countryCode !== basis.countryCode || adopted.domain !== catalog.domain || adopted.code !== catalog.code || !catalog.editions.includes(adopted.edition) || adopted.sourceUrl !== catalog.sourceUrl || !criterion.clause?.trim()) issues.push(`${check.id}: ${name} criterion requires one matching country/catalog adopted reference and its clause; custom or mismatched standard links are unsupported by this national subset.`);
    }
  }
  return [...new Set(issues)];
}
function scopeIssues(check: NationalSeismicCheck): string[] {
  const issues: string[] = [];
  if (check.seismicZone !== "II") issues.push("7.6/7.7.1: the implemented equivalent-static building exception is confined to Seismic Zone II; required dynamic analysis is unsupported.");
  if (check.regularity !== "regular") issues.push("7.6/7.7.1: an externally reviewed regular building is required; irregular-building procedures are unsupported.");
  if (check.buildingHeightM >= 15) issues.push("7.6/7.7.1: building height must be strictly less than 15 m; taller buildings require an unsupported dynamic method.");
  if (check.approximatePeriodS.value >= 0.4) issues.push("6.4.3: approximate natural period must be strictly less than 0.4 s. This module conservatively enforces that condition together with the building-specific static exception.");
  if (!check.ordinaryBuilding || check.energyDissipationDevicesPresent || check.baseIsolationPresent) issues.push("Only an ordinary building without special energy-dissipation/isolation systems is within this product's static floor-action scope.");
  if (!check.baseAtGroundLevel || check.basementPresent) issues.push("Below-ground bases/basements and their period, mass and depth-reduction procedures are outside this product scope.");
  if (!check.rigidDiaphragmReviewed) issues.push("This product requires an external rigid-diaphragm applicability review; flexible-diaphragm procedures are not implemented.");
  if (check.soilType !== "I" && check.soilType !== "II") issues.push("Soft or site-specific soil response, vertical-effect triggers and special site investigations are outside this increment.");
  if (check.verticalEffectsRequired || check.prestressedMembersPresent || check.longSpanAmplificationPresent || check.largeOverhangsPresent) issues.push("Amendment 2 to 6.3.3.1: declared vertical effects, prestress, long-span amplification or large overhangs require effects outside this horizontal-only subset.");
  if (check.dynamicAnalysisRequired) issues.push("The project review requires dynamic analysis; equivalent-static floor actions are not issued as a substitute.");
  if (check.spectrumKind !== "code-equivalent-static-5-percent") issues.push("Only the authored 5-percent-damped code equivalent-static spectrum is supported; modal/site-specific spectra are not substituted.");
  if (check.zFactor.value !== ZONE_II_FACTOR) issues.push("The supplied Z must exactly match the inspected Table 3 Zone II factor 0.10; the site zone remains externally reviewed.");
  if (check.saOverG.value !== SHORT_PERIOD_SA_OVER_G) issues.push("For this Ta<0.4 s, soil I/II, equivalent-static code-spectrum scope, the authored Sa/g must exactly match the inspected 6.4.2(a) plateau 2.5.");
  return issues;
}
function detailText(): string[] {
  return [
    "The supplied approximate period must be reviewed under 7.6.2 and its applicable amendments; the period formula, soil classification, site zone, I/R selection and seismic-weight derivation are not calculated here.",
    "The product conservatively intersects the regular-building Zone II h<15 m exception with Ta<0.4 s. Additional base/diaphragm/soil/structure restrictions bound the product and are not asserted to be universal BIS rules.",
    "Positive/negative forces represent two separate reversals along the declared principal plan axis. The plan X/Y labels are not mapped to the application's global coordinate axes or model nodes.",
    "Floor forces act at externally established floor centres of mass. Story shear is the sum of forces at and above that floor, acting immediately below its level; in-plan element distribution and torsion remain external.",
    "The Table 7 minimum horizontal force is disclosed separately; when it exceeds AhW, the larger force is distributed using the same height-squared pattern as a conservative authored design action.",
  ];
}
function floorActions(check: NationalSeismicCheck): NationalSeismicResult {
  const issues = scopeIssues(check);
  if (issues.length) return { id: check.id, kind: check.kind, axis: check.axis, status: "unsupported-method", scopeIssues: issues, metrics: null, floors: [], clauseChecks: [], details: detailText(), excludedChecks: [...EXCLUDED_CHECKS] };
  const horizontalCoefficient = (check.zFactor.value / 2) * (check.importanceFactor.value / check.responseReductionFactor.value) * check.saOverG.value;
  const totalSeismicWeightN = check.floors.reduce((sum, floor) => sum + floor.seismicWeightN.value, 0), coefficientBaseShearN = horizontalCoefficient * totalSeismicWeightN;
  const minimumBaseShearN = ZONE_II_MINIMUM_COEFFICIENT * totalSeismicWeightN, adoptedBaseShearN = Math.max(coefficientBaseShearN, minimumBaseShearN);
  const weightHeightSquaredSumNm2 = check.floors.reduce((sum, floor) => sum + floor.seismicWeightN.value * floor.heightM ** 2, 0);
  const floors: NationalSeismicFloorAction[] = check.floors.map(floor => {
    const weightHeightSquaredNm2 = floor.seismicWeightN.value * floor.heightM ** 2, distributionFraction = weightHeightSquaredNm2 / weightHeightSquaredSumNm2, forcePositiveN = distributionFraction * adoptedBaseShearN;
    return { id: floor.id, heightM: floor.heightM, seismicWeightN: floor.seismicWeightN.value, weightHeightSquaredNm2, distributionFraction, forcePositiveN, forceNegativeN: -forcePositiveN, storeyShearBelowFloorN: 0 };
  });
  let runningShear = 0;
  for (let i = floors.length - 1; i >= 0; i--) { runningShear += floors[i].forcePositiveN; floors[i].storeyShearBelowFloorN = runningShear; }
  const distributedForceSumN = floors.reduce((sum, floor) => sum + floor.forcePositiveN, 0), forceBalanceResidualN = distributedForceSumN - adoptedBaseShearN;
  const relativeForceBalanceResidual = Math.abs(forceBalanceResidualN) / adoptedBaseShearN, overturningMomentAtBaseNm = floors.reduce((sum, floor) => sum + floor.forcePositiveN * floor.heightM, 0);
  const governingBaseShear = coefficientBaseShearN === minimumBaseShearN ? "both" : coefficientBaseShearN > minimumBaseShearN ? "coefficient" : "minimum";
  const metrics: NationalSeismicMetrics = { horizontalCoefficient, totalSeismicWeightN, coefficientBaseShearN, minimumBaseShearCoefficient: ZONE_II_MINIMUM_COEFFICIENT, minimumBaseShearN, adoptedBaseShearN, governingBaseShear, weightHeightSquaredSumNm2, distributedForceSumN, forceBalanceResidualN, relativeForceBalanceResidual, overturningMomentAtBaseNm };
  if (Object.values(metrics).some(value => typeof value === "number" && !Number.isFinite(value)) || floors.some(floor => Object.values(floor).some(value => typeof value === "number" && !Number.isFinite(value))) || adoptedBaseShearN <= 0 || weightHeightSquaredSumNm2 <= 0 || relativeForceBalanceResidual > FORCE_BALANCE_TOLERANCE) throw new Error(`${check.id}: non-finite seismic actions or invalid force balance; results rejected.`);
  return { id: check.id, kind: check.kind, axis: check.axis, status: "generated-floor-actions", scopeIssues: [], metrics, floors,
    clauseChecks: [{ clause: "7.2.2/Table 7", name: "Adopted horizontal action meets the Zone II minimum force", satisfied: adoptedBaseShearN >= minimumBaseShearN }, { clause: "7.6.3(a)", name: "Height-squared floor action pattern conserves adopted base force within the disclosed numerical tolerance", satisfied: relativeForceBalanceResidual <= FORCE_BALANCE_TOLERANCE }], details: detailText(), excludedChecks: [...EXCLUDED_CHECKS] };
}

/** Named 2016 floor-action subset; no structural/modal/element analysis is called. */
export function assessNationalSeismic(input: NationalSeismicInput, designBasis: EngineeringDesignBasis): NationalSeismicReport {
  const source = parseNationalSeismicInput(input), basis = capturedBasis(designBasis), gates = basisGates(source, basis), results = gates.length ? [] : source.checks.map(floorActions);
  const generated = results.filter(result => result.status === "generated-floor-actions").length;
  const status: NationalSeismicReport["status"] = gates.length ? "unsupported-basis" : generated === results.length ? "assessed-subset" : generated ? "partially-supported-scope" : "unsupported-scope";
  return { version: 1, implementation: IMPLEMENTATION, verification: "unverified", compliance: "not-assessed", source, basis,
    status, basisIssues: gates, implementedClauses: generated ? [...CLAUSES] : [], results, warnings: [...WARNINGS] };
}

function sameTextList(value: unknown, expected: string[], path: string, maximum: number): boolean {
  const parsed = list(value, path, 0, maximum).map(entry => text(entry, path, 4000));
  return JSON.stringify(parsed) === JSON.stringify(expected);
}
/** Direct source arithmetic verifies saved values; it never calls assessment, floorActions or a solver. */
function restoredActionsMatch(item: Record<string, unknown>, check: NationalSeismicCheck): boolean {
  const rawMetrics = record(item.metrics, "metrics", METRIC_KEYS);
  if (Object.keys(rawMetrics).length !== METRIC_KEYS.length) return false;
  const horizontalCoefficient = (check.zFactor.value / 2) * (check.importanceFactor.value / check.responseReductionFactor.value) * check.saOverG.value;
  const totalSeismicWeightN = check.floors.reduce((sum, floor) => sum + floor.seismicWeightN.value, 0), coefficientBaseShearN = horizontalCoefficient * totalSeismicWeightN, minimumBaseShearN = ZONE_II_MINIMUM_COEFFICIENT * totalSeismicWeightN, adoptedBaseShearN = Math.max(coefficientBaseShearN, minimumBaseShearN);
  const weightHeightSquaredSumNm2 = check.floors.reduce((sum, floor) => sum + floor.seismicWeightN.value * floor.heightM ** 2, 0);
  const savedFloors = list(item.floors, "result.floors", check.floors.length, check.floors.length), forces: number[] = [];
  for (let i = 0; i < check.floors.length; i++) {
    const source = check.floors[i], saved = record(savedFloors[i], "floorAction", FLOOR_KEYS);
    if (Object.keys(saved).length !== FLOOR_KEYS.length) return false;
    const weightHeightSquaredNm2 = source.seismicWeightN.value * source.heightM ** 2, distributionFraction = weightHeightSquaredNm2 / weightHeightSquaredSumNm2, forcePositiveN = distributionFraction * adoptedBaseShearN;
    const expected: Record<string, number | string> = { id: source.id, heightM: source.heightM, seismicWeightN: source.seismicWeightN.value, weightHeightSquaredNm2, distributionFraction, forcePositiveN, forceNegativeN: -forcePositiveN };
    if (Object.entries(expected).some(([key, value]) => saved[key] !== value || typeof value === "number" && !finiteNumber(value))) return false;
    forces.push(forcePositiveN);
  }
  let runningShear = 0;
  for (let i = savedFloors.length - 1; i >= 0; i--) {
    runningShear += forces[i];
    if ((savedFloors[i] as Record<string, unknown>).storeyShearBelowFloorN !== runningShear || !finiteNumber(runningShear)) return false;
  }
  const distributedForceSumN = forces.reduce((sum, force) => sum + force, 0), forceBalanceResidualN = distributedForceSumN - adoptedBaseShearN, relativeForceBalanceResidual = Math.abs(forceBalanceResidualN) / adoptedBaseShearN;
  const overturningMomentAtBaseNm = forces.reduce((sum, force, index) => sum + force * check.floors[index].heightM, 0), governingBaseShear = coefficientBaseShearN === minimumBaseShearN ? "both" : coefficientBaseShearN > minimumBaseShearN ? "coefficient" : "minimum";
  const expectedMetrics: Record<string, number | string> = { horizontalCoefficient, totalSeismicWeightN, coefficientBaseShearN, minimumBaseShearCoefficient: ZONE_II_MINIMUM_COEFFICIENT, minimumBaseShearN, adoptedBaseShearN, governingBaseShear, weightHeightSquaredSumNm2, distributedForceSumN, forceBalanceResidualN, relativeForceBalanceResidual, overturningMomentAtBaseNm };
  if (Object.entries(expectedMetrics).some(([key, value]) => rawMetrics[key] !== value || typeof value === "number" && !finiteNumber(value)) || adoptedBaseShearN <= 0 || weightHeightSquaredSumNm2 <= 0 || relativeForceBalanceResidual > FORCE_BALANCE_TOLERANCE) return false;
  const clauses = list(item.clauseChecks, "clauseChecks", 2, 2), names = ["Adopted horizontal action meets the Zone II minimum force", "Height-squared floor action pattern conserves adopted base force within the disclosed numerical tolerance"], clauseIds = ["7.2.2/Table 7", "7.6.3(a)"], flags = [adoptedBaseShearN >= minimumBaseShearN, relativeForceBalanceResidual <= FORCE_BALANCE_TOLERANCE];
  return clauses.every((value, index) => { const clause = record(value, "clauseCheck", ["clause", "name", "satisfied"]); return clause.clause === clauseIds[index] && clause.name === names[index] && clause.satisfied === flags[index]; });
}

/** Strict persisted-record validation, with source/basis identity and no reassessment/analysis execution. */
export function validateNationalSeismicReport(value: unknown, input: NationalSeismicInput, designBasis: EngineeringDesignBasis): value is NationalSeismicReport {
  try {
    const source = parseNationalSeismicInput(input), basis = capturedBasis(designBasis), raw = record(value, "National seismic report", ["version", "implementation", "verification", "compliance", "source", "basis", "status", "basisIssues", "implementedClauses", "results", "warnings"]);
    if (raw.version !== 1 || raw.implementation !== IMPLEMENTATION || raw.verification !== "unverified" || raw.compliance !== "not-assessed" || JSON.stringify(parseNationalSeismicInput(raw.source)) !== JSON.stringify(source) || engineeringBasisFingerprint(capturedBasis(raw.basis)) !== engineeringBasisFingerprint(basis)) return false;
    const gates = basisGates(source, basis), supported = gates.length === 0, generated = supported ? source.checks.filter(check => !scopeIssues(check).length).length : 0, expectedClauses = generated ? CLAUSES : [];
    const status = !supported ? "unsupported-basis" : generated === source.checks.length ? "assessed-subset" : generated ? "partially-supported-scope" : "unsupported-scope";
    if (raw.status !== status || !sameTextList(raw.basisIssues, gates, "basisIssues", 1000) || !sameTextList(raw.implementedClauses, expectedClauses, "implementedClauses", 20) || !sameTextList(raw.warnings, WARNINGS, "warnings", 20)) return false;
    const results = list(raw.results, "results", supported ? source.checks.length : 0, supported ? source.checks.length : 0);
    for (let i = 0; i < results.length; i++) {
      const check = source.checks[i], issues = scopeIssues(check), item = record(results[i], "Seismic result", ["id", "kind", "axis", "status", "scopeIssues", "metrics", "floors", "clauseChecks", "details", "excludedChecks"]);
      if (item.id !== check.id || item.kind !== check.kind || item.axis !== check.axis || item.status !== (issues.length ? "unsupported-method" : "generated-floor-actions") || !sameTextList(item.scopeIssues, issues, "scopeIssues", 30) || !sameTextList(item.details, detailText(), "details", 10) || !sameTextList(item.excludedChecks, EXCLUDED_CHECKS, "excludedChecks", 20)) return false;
      if (issues.length) { if (item.metrics !== null || list(item.floors, "unsupported.floors", 0, 0).length || list(item.clauseChecks, "unsupported.clauseChecks", 0, 0).length) return false; }
      else if (!restoredActionsMatch(item, check)) return false;
    }
    return true;
  } catch { return false; }
}

/** Illustrative authored inputs; example declarations do not constitute a reviewed project basis. */
export function nationalSeismicExample(): NationalSeismicInput {
  return { version: 1, checks: [{ id: "is1893-static-x", label: "Indian 2016 static floor-action subset", kind: "in-is1893-equivalent-static", axis: "X", axisSource: "Illustrative principal plan X axis; replace with the reviewed project direction and centre-of-mass geometry.", inputSource: "Illustrative SI low-rise ordinary-building geometry; replace with checked project source data.", seismicZone: "II", regularity: "regular", soilType: "I", spectrumKind: "code-equivalent-static-5-percent", buildingHeightM: 6,
    ordinaryBuilding: true, baseAtGroundLevel: true, basementPresent: false, energyDissipationDevicesPresent: false, baseIsolationPresent: false, prestressedMembersPresent: false, longSpanAmplificationPresent: false, largeOverhangsPresent: false, verticalEffectsRequired: false, dynamicAnalysisRequired: false, rigidDiaphragmReviewed: true,
    methodReviewSource: "Example only; replace with reviewed applicability of 6.4.3, 7.6/7.7.1 and all project-specific analysis requirements.", regularityReviewSource: "Example only; replace with the full amended Tables 5/6 regularity review, including modal/torsional considerations.", siteReviewSource: "Example only; replace with reviewed site zoning, soil/foundation and amended vertical-effect applicability.", coefficientReviewSource: "Example only; replace with reviewed Z, I, R and equivalent-static 5-percent spectrum selections for the actual system/occupancy/site.", periodReviewSource: "Example only; replace with the applicable reviewed 7.6.2 approximate-period calculation and amended bounds.", seismicWeightReviewSource: "Example only; replace with reviewed 7.3/7.4 floor seismic weights, load fractions and vertical-member apportionment.",
    adopted2016ApplicabilityConfirmed: true, amendmentScopeConfirmed: true, amendmentReviewSource: "Example only; replace with confirmed local 2016 adoption, review of Amendments 1/2 and applicability of subsequent editions/amendments.", zFactor: { value: 0.1, unit: "1", source: "Illustrative reviewed Zone II Table 3 factor; the actual site zoning must be supplied." }, importanceFactor: { value: 1, unit: "1", source: "Illustrative I; replace with the reviewed actual occupancy/importance selection." }, responseReductionFactor: { value: 5, unit: "1", source: "Illustrative R; replace with the reviewed actual lateral-system and ductile-detailing eligibility." }, saOverG: { value: 2.5, unit: "1", source: "Illustrative short-period equivalent-static 6.4.2(a) plateau; replace with project review." }, approximatePeriodS: { value: 0.075 * 6 ** 0.75, unit: "s", source: "Illustrative bare RC MRF 7.6.2(a) period; replace with the applicable reviewed project period and amended bounds." }, floors: [{ id: "floor-1", heightM: 3, seismicWeightN: { value: 500000, unit: "N", source: "Illustrative first-floor final seismic weight; replace with the reviewed project weight calculation." } }, { id: "roof", heightM: 6, seismicWeightN: { value: 400000, unit: "N", source: "Illustrative roof final seismic weight; replace with the reviewed project weight calculation." } }],
  }] };
}
