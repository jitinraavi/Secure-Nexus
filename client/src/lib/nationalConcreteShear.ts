import { ENGINEERING_BASIS_PROFILE_VERSION, ENGINEERING_STANDARD_REFERENCES, engineeringBasisFingerprint, parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis } from "./engineeringBasis";
import { engineeringRecord, finiteNumber, identifier, requireFinite } from "./engineeringNumerics";

export interface NationalConcreteShearParameter { value: number; unit: "Pa"; source: string; criterionId?: string }
export interface NationalConcreteShearTableReview {
  gradeColumn: "M20" | "M25" | "M30" | "M35" | "M40-and-above";
  selection: "tabulated-row" | "reviewed-interpolation" | "lower-boundary-row" | "upper-boundary-row";
  lowerRowPercent: number; upperRowPercent: number; reviewSource: string;
}
export interface NationalConcreteShearCheck {
  id: string; label: string; kind: "in-is456-rectangular-beam-shear";
  inputSource: string; loadCase: string; loadSource: string; materialSource: string;
  flexureReviewSource: string; reinforcementReviewSource: string; criticalSectionReviewSource: string;
  loadBasis: "factored"; shearDemandConvention: "reviewed-absolute-demand-for-declared-tension-face";
  memberType: "beam"; sectionShape: "rectangular"; shearReinforcement: "vertical-stirrups";
  uniformDepth: boolean; flexureReviewed: boolean; tensionReinforcementContinuesBeyondD: boolean;
  stirrupAnchorageAndLegsReviewed: boolean; ordinaryNonseismicBeam: boolean;
  deepBeam: boolean; prestressed: boolean; bentUpBarsPresent: boolean; inclinedStirrupsPresent: boolean;
  seismicOrCyclicDemand: boolean; couplingBeam: boolean; nearSupportEnhancementUsed: boolean;
  axialForceN: number; torsionNm: number; demandShearN: number;
  widthM: number; overallDepthM: number; effectiveDepthM: number; tensionSteelAreaM2: number;
  stirrupEffectiveLegAreaM2: number; stirrupSpacingM: number;
  concreteGradeMPa: 20 | 25 | 30 | 35 | 40 | 45 | 50;
  stirrupYieldPa: NationalConcreteShearParameter; concreteShearStrengthPa: NationalConcreteShearParameter;
  table19Review: NationalConcreteShearTableReview;
  adopted2000ApplicabilityConfirmed: true; amendmentScopeConfirmed: true; amendmentReviewSource: string;
}
export interface NationalConcreteShearInput { version: 1; checks: NationalConcreteShearCheck[] }
export interface NationalConcreteShearMetrics {
  nominalShearStressPa: number; authoredConcreteShearStrengthPa: number; maximumConcreteShearStressPa: number;
  tensionReinforcementPercent: number; effectiveStirrupYieldPa: number;
  concreteContributionN: number; requiredStirrupContributionN: number; providedStirrupContributionN: number;
  minimumEffectiveStirrupAreaM2: number; maximumStirrupSpacingM: number;
  maximumStressShearLimitN: number; concreteAndStirrupResistanceN: number;
}
export interface NationalConcreteShearResult {
  id: string; kind: "in-is456-rectangular-beam-shear";
  status: "within-implemented-clauses" | "exceeds-implemented-clauses" | "unsupported-section";
  scopeIssues: string[]; metrics: NationalConcreteShearMetrics | null;
  subsetShearResistanceN: number | null; shearUtilization: number | null;
  clauseChecks: { clause: string; name: string; satisfied: boolean }[];
  details: string[]; excludedChecks: string[];
}
export interface NationalConcreteShearReport {
  version: 1; implementation: "IS456-2000-vertical-stirrup-shear-v1";
  verification: "unverified"; compliance: "not-assessed";
  source: NationalConcreteShearInput; basis: EngineeringDesignBasis;
  status: "assessed-subset" | "partially-supported-scope" | "unsupported-scope" | "unsupported-basis";
  basisIssues: string[]; implementedClauses: string[]; results: NationalConcreteShearResult[]; warnings: string[];
}

const IMPLEMENTATION = "IS456-2000-vertical-stirrup-shear-v1";
const STIRRUP_YIELD_LIMIT_PA = 415e6, STIRRUP_STRESS_FACTOR = 0.87, MINIMUM_REINFORCEMENT_STRESS_PA = 0.4e6;
const TABLE19_ROWS = [0.15, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
const CLAUSES = ["40.1 uniform-depth nominal shear stress", "40.2.1/Table 19 externally reviewed concrete strength", "40.2.3/Table 20 maximum shear stress", "40.4(a) vertical stirrup contribution", "26.5.1.5 maximum vertical stirrup spacing", "26.5.1.6 minimum effective stirrup area"];
const CLAUSE_IDS = ["40.2.3/Table 20", "40.4(a)", "26.5.1.6", "26.5.1.5"];
const CLAUSE_NAMES = ["Nominal shear stress within the Table 20 maximum", "Vertical stirrups resist the required shear beyond the authored concrete contribution", "Effective stirrup area meets the minimum", "Vertical stirrup spacing meets both maximum limits"];
const WARNINGS = [
  "Source inspection only: TypeScript compilation, numerical execution and independent benchmarks remain unverified.",
  "The inspected BIS-authored artifacts are the April 2007 reprint with Amendments 1/2, and the August 2014 reprint with Amendments 1-4 plus the appended July 2019 Amendment 5. Subsequent amendments/editions are not implemented; a supplied reviewer must establish applicability to the adopted project basis.",
  "Concrete resistance is supplied from an external Table 19 review. This module checks the concrete grade column and reinforcement row/bracket trace, but does not look up or authenticate the tabulated resistance or prescribe an interpolation rule.",
  "Only the listed ordinary rectangular beam shear clauses are assessed. A reported subset resistance is not the complete governing beam resistance, detailing approval, safety determination or national-code compliance.",
  "Factored absolute shear demand, tension face, effective depth, continuing longitudinal reinforcement, stirrup effective legs/anchorage and section location require external review. No analysis, load-combination generation, force reversal or automatic bar-layout interpretation is performed.",
  "The minor-importance exception to minimum shear reinforcement and near-support enhancement are excluded; the module always requires the stated minimum and unenhanced concrete contribution within its supported scope.",
];
const EXCLUDED_CHECKS = [
  "Complete IS 456 adoption/amendment review, material conformity and national-code compliance",
  "Automatic Table 19 resistance lookup, row values, interpolation rule and source authentication",
  "Load combinations, member analysis, demand-envelope/tension-face determination and critical-section selection",
  "Flexure, longitudinal reinforcement limits/curtailment, bond, development length, cover, stirrup hooks and leg geometry",
  "Axial-force effects, variable-depth/flanged sections, deep beams, corbels, slabs, punching and prestressed concrete",
  "Bent-up/inclined reinforcement, torsion, seismic/cyclic/coupling-beam design and IS 13920 detailing",
  "40.5 near-support enhancement/simplified section selection and minor-importance minimum-reinforcement exceptions",
  "Side-face reinforcement, serviceability, fatigue, fire, durability, deflection, construction and whole-member governing resistance",
];
const BOOLEAN_KEYS = ["uniformDepth", "flexureReviewed", "tensionReinforcementContinuesBeyondD", "stirrupAnchorageAndLegsReviewed", "ordinaryNonseismicBeam", "deepBeam", "prestressed", "bentUpBarsPresent", "inclinedStirrupsPresent", "seismicOrCyclicDemand", "couplingBeam", "nearSupportEnhancementUsed"] as const;
const REVIEW_KEYS = ["inputSource", "loadCase", "loadSource", "materialSource", "flexureReviewSource", "reinforcementReviewSource", "criticalSectionReviewSource"] as const;
const INPUT_KEYS = ["id", "label", "kind", ...REVIEW_KEYS, "loadBasis", "shearDemandConvention", "memberType", "sectionShape", "shearReinforcement", ...BOOLEAN_KEYS, "axialForceN", "torsionNm", "demandShearN", "widthM", "overallDepthM", "effectiveDepthM", "tensionSteelAreaM2", "stirrupEffectiveLegAreaM2", "stirrupSpacingM", "concreteGradeMPa", "stirrupYieldPa", "concreteShearStrengthPa", "table19Review", "adopted2000ApplicabilityConfirmed", "amendmentScopeConfirmed", "amendmentReviewSource"];
const METRIC_KEYS = ["nominalShearStressPa", "authoredConcreteShearStrengthPa", "maximumConcreteShearStressPa", "tensionReinforcementPercent", "effectiveStirrupYieldPa", "concreteContributionN", "requiredStirrupContributionN", "providedStirrupContributionN", "minimumEffectiveStirrupAreaM2", "maximumStirrupSpacingM", "maximumStressShearLimitN", "concreteAndStirrupResistanceN"];
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
function list(value: unknown, path: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error(`${path} requires ${minimum}-${maximum} entries.`);
  for (let i = 0; i < value.length; i++) if (!Object.prototype.hasOwnProperty.call(value, i)) throw new Error(`${path} requires dense arrays without missing entries.`);
  return value;
}
function parameter(value: unknown, path: string, minimum: number, maximum: number): NationalConcreteShearParameter {
  const raw = record(value, path, ["value", "unit", "source", "criterionId"]);
  if (raw.unit !== "Pa") throw new Error(`${path}.unit must be Pa; MPa values must be explicitly converted.`);
  return { value: requireFinite(raw.value, `${path}.value`, minimum, maximum), unit: "Pa", source: text(raw.source, `${path}.source`), ...(raw.criterionId === undefined ? {} : { criterionId: id(raw.criterionId, `${path}.criterionId`) }) };
}
function maximumShearStressPa(grade: NationalConcreteShearCheck["concreteGradeMPa"]): number {
  // Table 20: M20/M25/M30/M35/M40-and-above; this product bounds concrete to M20-M50.
  return (grade >= 40 ? 4 : grade === 35 ? 3.7 : grade === 30 ? 3.5 : grade === 25 ? 3.1 : 2.8) * 1e6;
}
function table19GradeColumn(grade: NationalConcreteShearCheck["concreteGradeMPa"]): NationalConcreteShearTableReview["gradeColumn"] {
  return grade >= 40 ? "M40-and-above" : grade === 35 ? "M35" : grade === 30 ? "M30" : grade === 25 ? "M25" : "M20";
}

/** Strict author contract; declared unsupported member effects remain visible in the scope result. */
export function parseNationalConcreteShearInput(value: unknown): NationalConcreteShearInput {
  const raw = record(value, "Concrete shear input", ["version", "checks"]);
  if (raw.version !== 1) throw new Error("Concrete shear input requires version 1.");
  const ids = new Set<string>();
  const checks = list(raw.checks, "Concrete shear checks", 1, 100).map((entry): NationalConcreteShearCheck => {
    const item = record(entry, "Concrete shear check", INPUT_KEYS), checkId = id(item.id, "check.id");
    if (ids.has(checkId)) throw new Error("Concrete shear check IDs must be unique."); ids.add(checkId);
    if (item.kind !== "in-is456-rectangular-beam-shear" || item.loadBasis !== "factored" || item.shearDemandConvention !== "reviewed-absolute-demand-for-declared-tension-face" || item.memberType !== "beam" || item.sectionShape !== "rectangular" || item.shearReinforcement !== "vertical-stirrups") throw new Error(`${checkId}: declare the named factored rectangular beam and vertical stirrup method, including the reviewed absolute demand/tension-face convention.`);
    if (item.adopted2000ApplicabilityConfirmed !== true || item.amendmentScopeConfirmed !== true) throw new Error(`${checkId}: explicitly confirm reviewed 2000 edition/amendment applicability.`);
    const declarations = Object.fromEntries(BOOLEAN_KEYS.map(key => { if (typeof item[key] !== "boolean") throw new Error(`${key} requires an explicit boolean declaration.`); return [key, item[key]]; })) as Record<typeof BOOLEAN_KEYS[number], boolean>;
    const reviews = Object.fromEntries(REVIEW_KEYS.map(key => [key, text(item[key], key, key === "loadCase" ? 200 : 4000)])) as Record<typeof REVIEW_KEYS[number], string>;
    const widthM = requireFinite(item.widthM, "widthM", 0.01, 20), overallDepthM = requireFinite(item.overallDepthM, "overallDepthM", 0.02, 20), effectiveDepthM = requireFinite(item.effectiveDepthM, "effectiveDepthM", 0.01, 20);
    const tensionSteelAreaM2 = requireFinite(item.tensionSteelAreaM2, "tensionSteelAreaM2", 1e-9, 10), stirrupEffectiveLegAreaM2 = requireFinite(item.stirrupEffectiveLegAreaM2, "stirrupEffectiveLegAreaM2", 1e-9, 10);
    if (effectiveDepthM >= overallDepthM || tensionSteelAreaM2 >= widthM * effectiveDepthM || stirrupEffectiveLegAreaM2 >= widthM * effectiveDepthM) throw new Error(`${checkId}: effective depth must be smaller than overall depth and reinforcement areas smaller than the effective concrete section area.`);
    const concreteGradeMPa = requireFinite(item.concreteGradeMPa, "concreteGradeMPa", 20, 50);
    if (![20, 25, 30, 35, 40, 45, 50].includes(concreteGradeMPa)) throw new Error("Only declared M20/M25/M30/M35/M40/M45/M50 concrete grades are supported.");
    const table = record(item.table19Review, "table19Review", ["gradeColumn", "selection", "lowerRowPercent", "upperRowPercent", "reviewSource"]);
    const lowerRowPercent = requireFinite(table.lowerRowPercent, "lowerRowPercent", 0.15, 3), upperRowPercent = requireFinite(table.upperRowPercent, "upperRowPercent", 0.15, 3);
    if (!TABLE19_ROWS.includes(lowerRowPercent) || !TABLE19_ROWS.includes(upperRowPercent) || lowerRowPercent > upperRowPercent) throw new Error("Table 19 trace requires actual ordered published row percentages.");
    return { id: checkId, label: text(item.label, "label", 200), kind: "in-is456-rectangular-beam-shear", ...reviews, loadBasis: "factored", shearDemandConvention: "reviewed-absolute-demand-for-declared-tension-face", memberType: "beam", sectionShape: "rectangular", shearReinforcement: "vertical-stirrups", ...declarations,
      axialForceN: requireFinite(item.axialForceN, "axialForceN", -1e12, 1e12), torsionNm: requireFinite(item.torsionNm, "torsionNm", -1e12, 1e12), demandShearN: requireFinite(item.demandShearN, "demandShearN", 0, 1e12), widthM, overallDepthM, effectiveDepthM, tensionSteelAreaM2, stirrupEffectiveLegAreaM2, stirrupSpacingM: requireFinite(item.stirrupSpacingM, "stirrupSpacingM", 1e-4, 20), concreteGradeMPa: concreteGradeMPa as NationalConcreteShearCheck["concreteGradeMPa"],
      stirrupYieldPa: parameter(item.stirrupYieldPa, "stirrupYieldPa", 1e6, 1e9), concreteShearStrengthPa: parameter(item.concreteShearStrengthPa, "concreteShearStrengthPa", 1e-6, 4e6),
      table19Review: { gradeColumn: choice(table.gradeColumn, ["M20", "M25", "M30", "M35", "M40-and-above"] as const, "gradeColumn"), selection: choice(table.selection, ["tabulated-row", "reviewed-interpolation", "lower-boundary-row", "upper-boundary-row"] as const, "selection"), lowerRowPercent, upperRowPercent, reviewSource: text(table.reviewSource, "table19Review.reviewSource", 4000) },
      adopted2000ApplicabilityConfirmed: true, amendmentScopeConfirmed: true, amendmentReviewSource: text(item.amendmentReviewSource, "amendmentReviewSource", 4000),
    };
  });
  return { version: 1, checks };
}

/** Keep complete, closed captured metadata; parsing must not silently discard persisted fields. */
function capturedBasis(value: unknown): EngineeringDesignBasis {
  const raw = record(value, "Design basis", ["version", "profileVersion", "countryCode", "region", "authority", "standards", "declaration", "criteria", "confirmed", "reviewer", "reviewNote"]);
  record(raw.declaration, "Design basis declaration", ["occupancy", "riskCategory", "structuralSystem", "material", "soil", "loads", "hazards"]);
  for (const standard of list(raw.standards, "Basis standards", 0, 40)) record(standard, "Adopted standard", ["id", "domain", "code", "edition", "sourceUrl", "adoptionReference", "amendments"]);
  for (const criterion of list(raw.criteria, "Basis criteria", 0, 64)) record(criterion, "Basis criterion", ["id", "module", "name", "value", "unit", "source", "standardId", "clause"]);
  return parseEngineeringDesignBasis(raw);
}
function basisGates(source: NationalConcreteShearInput, basis: EngineeringDesignBasis): string[] {
  const issues = validateEngineeringDesignBasis(basis);
  if (basis.countryCode !== "IN") issues.push(`Country ${basis.countryCode || "not selected"} is unsupported by this Indian concrete shear subset; no Indian coefficients are substituted.`);
  if (basis.profileVersion !== ENGINEERING_BASIS_PROFILE_VERSION) issues.push("The captured design-basis catalog version requires review against the supported catalog.");
  const reference = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === "in-is456"), candidates = basis.standards.filter(item => item.id === "in-is456" || /^IS\s*456(?:\s*[:/-]\s*2000)?$/i.test(item.code.trim()));
  if (!reference || candidates.length !== 1) issues.push("Adopt exactly one supported IS 456:2000 reference; multiple declarations are ambiguous.");
  else {
    const adopted = candidates[0];
    if (adopted.id !== reference.id || adopted.domain !== reference.domain || adopted.code !== reference.code || adopted.edition !== "2000" || adopted.sourceUrl !== reference.sourceUrl) issues.push("The adopted concrete reference must exactly match the Indian IS 456 catalog entry, edition 2000 and publisher reference.");
    if (!adopted.adoptionReference.trim() || !adopted.amendments.trim()) issues.push("Declare local 2000 adoption and amendment applicability, including review against the inspected reprint and appended Amendment 5.");
  }
  for (const check of source.checks) for (const [name, quantity] of [["stirrup yield", check.stirrupYieldPa], ["Table 19 concrete resistance", check.concreteShearStrengthPa]] as const) {
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
function scopeIssues(check: NationalConcreteShearCheck): string[] {
  const issues: string[] = [];
  if (!check.uniformDepth) issues.push("40.1: only uniform-depth beams are implemented; the variable-depth expression is excluded.");
  if (!check.flexureReviewed) issues.push("External flexure and longitudinal tension-face reinforcement review is a prerequisite.");
  if (!check.tensionReinforcementContinuesBeyondD) issues.push("Table 19 note: supplied tension steel must continue at least one effective depth beyond the assessed section; the special support-detailing exception is excluded.");
  if (!check.stirrupAnchorageAndLegsReviewed) issues.push("External review must confirm the effective stirrup legs, anchorage and wrapping of outermost longitudinal bars.");
  if (!check.ordinaryNonseismicBeam || check.seismicOrCyclicDemand || check.couplingBeam) issues.push("Seismic/cyclic/coupling-beam checks and ductile detailing are excluded; declare an ordinary nonseismic beam and load case.");
  if (check.deepBeam || check.prestressed) issues.push("Deep beams and prestressed members require different procedures and are unsupported.");
  if (check.bentUpBarsPresent || check.inclinedStirrupsPresent) issues.push("Only vertical stirrups are implemented; mixed, bent-up or inclined reinforcement is unsupported.");
  if (check.axialForceN !== 0 || check.torsionNm !== 0) issues.push("Axial-force/concrete-strength enhancements and torsion interaction are excluded; both actions must be explicitly zero.");
  if (check.nearSupportEnhancementUsed) issues.push("40.5 near-support enhancement is excluded; supply the externally reviewed unenhanced critical-section demand.");
  const trace = check.table19Review, percent = 100 * check.tensionSteelAreaM2 / (check.widthM * check.effectiveDepthM), lower = TABLE19_ROWS.indexOf(trace.lowerRowPercent), upper = TABLE19_ROWS.indexOf(trace.upperRowPercent);
  if (trace.gradeColumn !== table19GradeColumn(check.concreteGradeMPa)) issues.push("The Table 19 reviewed grade column must match the supplied concrete grade.");
  const rowMatch = trace.selection === "tabulated-row" ? lower === upper && percent === trace.lowerRowPercent
    : trace.selection === "lower-boundary-row" ? lower === 0 && upper === 0 && percent <= 0.15
    : trace.selection === "upper-boundary-row" ? lower === TABLE19_ROWS.length - 1 && upper === lower && percent >= 3
    : upper === lower + 1 && percent > trace.lowerRowPercent && percent < trace.upperRowPercent;
  if (!rowMatch) issues.push("The Table 19 authored selection requires the exact row, correct boundary row or adjacent bounding rows for the calculated 100As/(bd); externally reviewed interpolation is not a software-prescribed BIS rule.");
  if (check.concreteShearStrengthPa.value > maximumShearStressPa(check.concreteGradeMPa)) issues.push("The authored Table 19 concrete resistance cannot exceed the independently enforced Table 20 maximum.");
  return issues;
}
function detailText(): string[] {
  return [
    "All source geometry uses metres/metres squared, actions use N/Nm and strengths use Pa; the concrete grade is explicitly MPa. No implicit unit conversion or demand sign/face change is performed.",
    "40.1: tau_v = Vu/(b*d). Table 19 strength is externally authored with grade/row trace; concrete contribution = tau_c*b*d, without axial or near-support enhancement.",
    "40.4(a): required vertical stirrup contribution = max(0, Vu - tau_c*b*d); provided = 0.87*min(fy, 415 MPa)*Asv*d/s. Asv is the externally reviewed total effective leg area, not a single bar area.",
    "26.5.1.6 minimum effective leg area = (0.4 MPa)*b*s/(0.87*min(fy, 415 MPa)). The minor-importance exception is excluded. 26.5.1.5 maximum spacing = min(0.75*d, 0.300 m).",
    "The displayed subset resistance is min(tau_c*b*d + vertical stirrup contribution, Table 20 maximum*b*d). Its utilization does not account for failed minimum-area/spacing checks; all four clause flags govern the reported subset status.",
  ];
}
function assessSection(check: NationalConcreteShearCheck): NationalConcreteShearResult {
  const issues = scopeIssues(check);
  if (issues.length) return { id: check.id, kind: check.kind, status: "unsupported-section", scopeIssues: issues, metrics: null, subsetShearResistanceN: null, shearUtilization: null, clauseChecks: [], details: detailText(), excludedChecks: [...EXCLUDED_CHECKS] };
  const area = check.widthM * check.effectiveDepthM, fy = Math.min(check.stirrupYieldPa.value, STIRRUP_YIELD_LIMIT_PA), maximumStress = maximumShearStressPa(check.concreteGradeMPa);
  const concreteContributionN = check.concreteShearStrengthPa.value * area, requiredStirrupContributionN = Math.max(0, check.demandShearN - concreteContributionN), providedStirrupContributionN = STIRRUP_STRESS_FACTOR * fy * check.stirrupEffectiveLegAreaM2 * check.effectiveDepthM / check.stirrupSpacingM;
  const minimumEffectiveStirrupAreaM2 = MINIMUM_REINFORCEMENT_STRESS_PA * check.widthM * check.stirrupSpacingM / (STIRRUP_STRESS_FACTOR * fy), maximumStirrupSpacingM = Math.min(0.75 * check.effectiveDepthM, 0.3);
  const maximumStressShearLimitN = maximumStress * area, concreteAndStirrupResistanceN = concreteContributionN + providedStirrupContributionN, subsetShearResistanceN = Math.min(concreteAndStirrupResistanceN, maximumStressShearLimitN), shearUtilization = check.demandShearN / subsetShearResistanceN;
  const metrics: NationalConcreteShearMetrics = { nominalShearStressPa: check.demandShearN / area, authoredConcreteShearStrengthPa: check.concreteShearStrengthPa.value, maximumConcreteShearStressPa: maximumStress, tensionReinforcementPercent: 100 * check.tensionSteelAreaM2 / area, effectiveStirrupYieldPa: fy, concreteContributionN, requiredStirrupContributionN, providedStirrupContributionN, minimumEffectiveStirrupAreaM2, maximumStirrupSpacingM, maximumStressShearLimitN, concreteAndStirrupResistanceN };
  if (Object.values(metrics).some(value => !finiteNumber(value) || value < 0) || !finiteNumber(subsetShearResistanceN) || subsetShearResistanceN <= 0 || !finiteNumber(shearUtilization) || shearUtilization < 0) throw new Error(`${check.id}: non-finite concrete shear result; assessment rejected.`);
  const flags = [metrics.nominalShearStressPa <= maximumStress, providedStirrupContributionN >= requiredStirrupContributionN, check.stirrupEffectiveLegAreaM2 >= minimumEffectiveStirrupAreaM2, check.stirrupSpacingM <= maximumStirrupSpacingM];
  return { id: check.id, kind: check.kind, status: flags.every(Boolean) ? "within-implemented-clauses" : "exceeds-implemented-clauses", scopeIssues: [], metrics, subsetShearResistanceN, shearUtilization,
    clauseChecks: flags.map((satisfied, index) => ({ clause: CLAUSE_IDS[index], name: CLAUSE_NAMES[index], satisfied })), details: detailText(), excludedChecks: [...EXCLUDED_CHECKS] };
}

/** Named ordinary-beam shear subset with an immutable parsed source and adoption basis. */
export function assessNationalConcreteShear(input: NationalConcreteShearInput, designBasis: EngineeringDesignBasis): NationalConcreteShearReport {
  const source = parseNationalConcreteShearInput(input), basis = capturedBasis(designBasis), gates = basisGates(source, basis), results = gates.length ? [] : source.checks.map(assessSection), supported = results.filter(result => result.status !== "unsupported-section").length;
  const status: NationalConcreteShearReport["status"] = gates.length ? "unsupported-basis" : supported === results.length ? "assessed-subset" : supported ? "partially-supported-scope" : "unsupported-scope";
  return { version: 1, implementation: IMPLEMENTATION, verification: "unverified", compliance: "not-assessed", source, basis, status, basisIssues: gates, implementedClauses: supported ? [...CLAUSES] : [], results, warnings: [...WARNINGS] };
}
function sameTextList(value: unknown, expected: string[], path: string, maximum: number): boolean {
  return JSON.stringify(list(value, path, 0, maximum).map(entry => text(entry, path, 4000))) === JSON.stringify(expected);
}
/** Direct saved-value/source algebra only; no section assessor or solver is called while restoring. */
function restoredSectionMatches(item: Record<string, unknown>, check: NationalConcreteShearCheck): boolean {
  const metrics = record(item.metrics, "metrics", METRIC_KEYS);
  if (Object.keys(metrics).length !== METRIC_KEYS.length) return false;
  const area = check.widthM * check.effectiveDepthM, fy = Math.min(check.stirrupYieldPa.value, STIRRUP_YIELD_LIMIT_PA), maximumStress = maximumShearStressPa(check.concreteGradeMPa);
  const concreteContributionN = check.concreteShearStrengthPa.value * area, requiredStirrupContributionN = Math.max(0, check.demandShearN - concreteContributionN), providedStirrupContributionN = STIRRUP_STRESS_FACTOR * fy * check.stirrupEffectiveLegAreaM2 * check.effectiveDepthM / check.stirrupSpacingM;
  const minimumEffectiveStirrupAreaM2 = MINIMUM_REINFORCEMENT_STRESS_PA * check.widthM * check.stirrupSpacingM / (STIRRUP_STRESS_FACTOR * fy), maximumStirrupSpacingM = Math.min(0.75 * check.effectiveDepthM, 0.3);
  const maximumStressShearLimitN = maximumStress * area, concreteAndStirrupResistanceN = concreteContributionN + providedStirrupContributionN, subsetShearResistanceN = Math.min(concreteAndStirrupResistanceN, maximumStressShearLimitN), shearUtilization = check.demandShearN / subsetShearResistanceN;
  const expected: Record<string, number> = { nominalShearStressPa: check.demandShearN / area, authoredConcreteShearStrengthPa: check.concreteShearStrengthPa.value, maximumConcreteShearStressPa: maximumStress, tensionReinforcementPercent: 100 * check.tensionSteelAreaM2 / area, effectiveStirrupYieldPa: fy, concreteContributionN, requiredStirrupContributionN, providedStirrupContributionN, minimumEffectiveStirrupAreaM2, maximumStirrupSpacingM, maximumStressShearLimitN, concreteAndStirrupResistanceN };
  if (Object.entries(expected).some(([key, value]) => !finiteNumber(value) || value < 0 || metrics[key] !== value) || !finiteNumber(subsetShearResistanceN) || subsetShearResistanceN <= 0 || !finiteNumber(shearUtilization) || shearUtilization < 0 || item.subsetShearResistanceN !== subsetShearResistanceN || item.shearUtilization !== shearUtilization) return false;
  const flags = [expected.nominalShearStressPa <= maximumStress, providedStirrupContributionN >= requiredStirrupContributionN, check.stirrupEffectiveLegAreaM2 >= minimumEffectiveStirrupAreaM2, check.stirrupSpacingM <= maximumStirrupSpacingM], clauses = list(item.clauseChecks, "clauseChecks", 4, 4);
  if (item.status !== (flags.every(Boolean) ? "within-implemented-clauses" : "exceeds-implemented-clauses")) return false;
  return clauses.every((value, index) => { const clause = record(value, "clauseCheck", ["clause", "name", "satisfied"]); return clause.clause === CLAUSE_IDS[index] && clause.name === CLAUSE_NAMES[index] && clause.satisfied === flags[index]; });
}

/** Strict restoration ties every saved number/flag to the captured input and basis, without reassessment. */
export function validateNationalConcreteShearReport(value: unknown, input: NationalConcreteShearInput, designBasis: EngineeringDesignBasis): value is NationalConcreteShearReport {
  try {
    const source = parseNationalConcreteShearInput(input), basis = capturedBasis(designBasis), raw = record(value, "Concrete shear report", ["version", "implementation", "verification", "compliance", "source", "basis", "status", "basisIssues", "implementedClauses", "results", "warnings"]);
    if (raw.version !== 1 || raw.implementation !== IMPLEMENTATION || raw.verification !== "unverified" || raw.compliance !== "not-assessed" || JSON.stringify(parseNationalConcreteShearInput(raw.source)) !== JSON.stringify(source) || engineeringBasisFingerprint(capturedBasis(raw.basis)) !== engineeringBasisFingerprint(basis)) return false;
    const gates = basisGates(source, basis), supported = gates.length ? 0 : source.checks.filter(check => !scopeIssues(check).length).length;
    const status = gates.length ? "unsupported-basis" : supported === source.checks.length ? "assessed-subset" : supported ? "partially-supported-scope" : "unsupported-scope";
    if (raw.status !== status || !sameTextList(raw.basisIssues, gates, "basisIssues", 1000) || !sameTextList(raw.implementedClauses, supported ? CLAUSES : [], "implementedClauses", 20) || !sameTextList(raw.warnings, WARNINGS, "warnings", 20)) return false;
    const results = list(raw.results, "results", gates.length ? 0 : source.checks.length, gates.length ? 0 : source.checks.length);
    for (let i = 0; i < results.length; i++) {
      const check = source.checks[i], issues = scopeIssues(check), item = record(results[i], "Concrete shear result", ["id", "kind", "status", "scopeIssues", "metrics", "subsetShearResistanceN", "shearUtilization", "clauseChecks", "details", "excludedChecks"]);
      if (item.id !== check.id || item.kind !== check.kind || !sameTextList(item.scopeIssues, issues, "scopeIssues", 30) || !sameTextList(item.details, detailText(), "details", 10) || !sameTextList(item.excludedChecks, EXCLUDED_CHECKS, "excludedChecks", 20)) return false;
      if (issues.length) { if (item.status !== "unsupported-section" || item.metrics !== null || item.subsetShearResistanceN !== null || item.shearUtilization !== null || list(item.clauseChecks, "unsupported.clauseChecks", 0, 0).length) return false; }
      else if (!restoredSectionMatches(item, check)) return false;
    }
    return true;
  } catch { return false; }
}

/** Illustrative inputs only; external reviews and the captured project basis must be replaced/confirmed. */
export function nationalConcreteShearExample(): NationalConcreteShearInput {
  return { version: 1, checks: [{ id: "is456-shear-1", label: "IS 456 ordinary rectangular beam shear subset", kind: "in-is456-rectangular-beam-shear",
    inputSource: "Illustrative SI rectangular section; replace with checked project geometry and declared tension-face reinforcement.", loadCase: "replace-with-factored-project-combination", loadSource: "Illustrative absolute factored shear; replace with externally reviewed analysis, envelope/tension face and combination reference.", materialSource: "Illustrative M30 concrete and Fe415 stirrup steel; replace with verified material specifications.", flexureReviewSource: "Example declaration only; replace with external longitudinal reinforcement and flexural design review.", reinforcementReviewSource: "Example declaration only; replace with effective leg area, hook/anchorage, outermost bar enclosure and continuing tension steel review.", criticalSectionReviewSource: "Example declaration only; replace with critical-section location and unenhanced demand review, including support/concentrated load regions.",
    loadBasis: "factored", shearDemandConvention: "reviewed-absolute-demand-for-declared-tension-face", memberType: "beam", sectionShape: "rectangular", shearReinforcement: "vertical-stirrups", uniformDepth: true, flexureReviewed: true, tensionReinforcementContinuesBeyondD: true, stirrupAnchorageAndLegsReviewed: true, ordinaryNonseismicBeam: true, deepBeam: false, prestressed: false, bentUpBarsPresent: false, inclinedStirrupsPresent: false, seismicOrCyclicDemand: false, couplingBeam: false, nearSupportEnhancementUsed: false,
    axialForceN: 0, torsionNm: 0, demandShearN: 150000, widthM: 0.25, overallDepthM: 0.55, effectiveDepthM: 0.5, tensionSteelAreaM2: 0.001953125, stirrupEffectiveLegAreaM2: 0.000157, stirrupSpacingM: 0.2, concreteGradeMPa: 30,
    stirrupYieldPa: { value: 415e6, unit: "Pa", source: "Illustrative Fe415 stirrup strength; replace with the checked material specification and criterion reference." }, concreteShearStrengthPa: { value: 0.77e6, unit: "Pa", source: "Illustrative author-reviewed M30 resistance between the Table 19 1.50/1.75-percent rows; this supplied value does not establish a normative interpolation rule." },
    table19Review: { gradeColumn: "M30", selection: "reviewed-interpolation", lowerRowPercent: 1.5, upperRowPercent: 1.75, reviewSource: "Example only; replace with the externally reviewed selection/value for the calculated 1.5625-percent tension reinforcement and continuing steel basis." }, adopted2000ApplicabilityConfirmed: true, amendmentScopeConfirmed: true, amendmentReviewSource: "Example declaration only; replace with confirmed local adoption and review against the inspected April 2007/August 2014 artifacts, appended July 2019 Amendment 5 and any subsequent applicable changes.",
  }] };
}
