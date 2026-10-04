import { ENGINEERING_BASIS_PROFILE_VERSION, ENGINEERING_STANDARD_REFERENCES, engineeringBasisFingerprint, parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis } from "./engineeringBasis";
import { engineeringRecord, finiteNumber, identifier, requireFinite } from "./engineeringNumerics";

export interface USSteelBoltStress {
  value: number; unit: "Pa"; source: string; standardId: "us-aisc360"; clause: "Table J3.2"; criterionId?: string;
}
interface USSteelBoltDeclaration {
  id: string; label: string; kind: "us-aisc360-j3-bolt";
  connectionId: string; boltId: string; inputSource: string; loadCase: string; loadSource: string;
  demandAssignment: "single-bolt" | "reviewed-per-bolt-group"; demandAssignmentReviewSource: string;
  connectionType: "bearing-type"; shearPlanes: 1; boltGroup: "120" | "144" | "150";
  boltGrade: string; threadPosition: "N" | "X"; diameterM: number; areaBasis: "gross-shank";
  nominalStressBasis: "table-j3.2"; nominalStressReviewConfirmed: true; nominalStressReviewSource: string;
  nominalTensileStressPa: USSteelBoltStress; nominalShearStressPa: USSteelBoltStress;
  installationCondition: "pretensioned"; installationReviewConfirmed: true; installationReviewSource: string;
  staticLoadingOnly: true; noFillers: true; noPrying: true; applicabilityReviewSource: string;
  endLoadedJoint: boolean; fastenerPatternLengthM: number;
  amendmentScopeConfirmed: true; amendmentReviewSource: string;
  errataApplicabilityReviewed: true; errataReviewSource: string;
  demandTensionN: number; demandShearN: number;
}
export type USSteelBoltCheck = USSteelBoltDeclaration & (
  { designMethod: "LRFD"; loadBasis: "factored" } | { designMethod: "ASD"; loadBasis: "service" }
);
export interface USSteelBoltInput { version: 1; checks: USSteelBoltCheck[] }
export interface USSteelBoltResult {
  id: string; kind: "us-aisc360-j3-bolt"; connectionId: string; boltId: string; designMethod: "LRFD" | "ASD";
  status: "within-implemented-clauses" | "exceeds-implemented-clauses";
  resistanceFactor: number; safetyFactor: number; boltAreaM2: number;
  requiredTensileStressPa: number; requiredShearStressPa: number;
  nominalTensileStressPa: number; nominalShearStressPa: number;
  nominalPureTensionCapacityN: number; availablePureTensionCapacityN: number;
  nominalShearCapacityN: number; availableShearCapacityN: number;
  shearGateSatisfied: boolean; modifiedNominalTensileStressPa: number | null;
  nominalInteractionTensionCapacityN: number | null; availableInteractionTensionCapacityN: number | null;
  demandTensionN: number; demandShearN: number; tensionUtilization: number | null; shearUtilization: number;
  clauseChecks: { clause: string; name: string; satisfied: boolean | null }[];
  details: string[]; excludedChecks: string[];
}
export interface USSteelBoltReport {
  version: 1; implementation: "AISC360-2022-J3-single-plane-bolt-v1";
  verification: "unverified"; compliance: "not-assessed";
  source: USSteelBoltInput; basis: EngineeringDesignBasis;
  status: "assessed-subset" | "unsupported-basis"; basisIssues: string[];
  implementedClauses: string[]; results: USSteelBoltResult[]; warnings: string[];
}

const IMPLEMENTATION = "AISC360-2022-J3-single-plane-bolt-v1";
const RESISTANCE_FACTOR = 0.75, SAFETY_FACTOR = 2, OUTPUT_LIMIT = 1e24;
const CLAUSES = ["J3-1 nominal bolt tension/shear rupture and design factors", "J3-2 modified nominal tension strength under simultaneous shear", "J3.8 / J3-3a LRFD and J3-3b ASD tension/shear interaction"];
const WARNINGS = [
  "Source inspection only: compilation, numerical behavior and independent benchmarks remain unverified.",
  "The inspected AISC references are ANSI/AISC 360-22 revised September 2023 and V16.0 companion examples. January 2025 and September 2026 errata contents were not independently inspected or incorporated. Project reviews must establish applicability of the implemented J3 factors/equations to the adopted amendments.",
  "Only tension/shear rupture and their J3.8 interaction for authored individual high-strength bolts in one shear plane are assessed. Passing these checks does not establish complete connection resistance or national-code compliance.",
  "Table J3.2 nominal stresses are explicitly supplied with grade, thread position and sourced review; no nominal strength or material selection is inferred. The reviewer must establish the exact adopted row and applicability of its notes to the supplied gross shank area.",
  "Per-bolt demand assignment, pretension/installation and absence of fillers/prying are external review declarations. No bolt-group stiffness, eccentric distribution or force redistribution is calculated.",
  "The interaction tensile capacity is withheld when the independently required shear strength fails. A zero tensile demand does not pass an over-capacity shear demand, and a negative interaction expression is never accepted as resistance.",
];
const EXCLUDED_CHECKS = [
  "Complete connection/member/code resistance and minimum strength over every applicable limit state",
  "Slip-critical resistance, slip/tension interaction, faying-surface classification and pretension amount/installation verification",
  "Hole bearing, tearout, edge/spacing geometry, connected-material yielding/rupture and block shear",
  "Prying, fillers/packing reductions, long end-loaded fastener patterns over 950 mm and other Table J3.2 note adjustments",
  "Bolt-group stiffness, eccentric-force distribution, load redistribution, multiple shear planes and mixed plane/thread conditions",
  "Common A307 bolts, Group 200, threaded rods, anchor bolts, alternative tensile-stress-area methods and manufacturer overrides",
  "Fatigue, cyclic/vibratory effects, seismic detailing, fire, local adoption/errata reconciliation and material/assembly certification",
];
const INPUT_KEYS = ["id", "label", "kind", "connectionId", "boltId", "inputSource", "loadCase", "loadSource", "demandAssignment", "demandAssignmentReviewSource", "connectionType", "shearPlanes", "boltGroup", "boltGrade", "threadPosition", "diameterM", "areaBasis", "nominalStressBasis", "nominalStressReviewConfirmed", "nominalStressReviewSource", "nominalTensileStressPa", "nominalShearStressPa", "installationCondition", "installationReviewConfirmed", "installationReviewSource", "staticLoadingOnly", "noFillers", "noPrying", "applicabilityReviewSource", "endLoadedJoint", "fastenerPatternLengthM", "amendmentScopeConfirmed", "amendmentReviewSource", "errataApplicabilityReviewed", "errataReviewSource", "demandTensionN", "demandShearN", "designMethod", "loadBasis"];
const RESULT_KEYS = ["id", "kind", "connectionId", "boltId", "designMethod", "status", "resistanceFactor", "safetyFactor", "boltAreaM2", "requiredTensileStressPa", "requiredShearStressPa", "nominalTensileStressPa", "nominalShearStressPa", "nominalPureTensionCapacityN", "availablePureTensionCapacityN", "nominalShearCapacityN", "availableShearCapacityN", "shearGateSatisfied", "modifiedNominalTensileStressPa", "nominalInteractionTensionCapacityN", "availableInteractionTensionCapacityN", "demandTensionN", "demandShearN", "tensionUtilization", "shearUtilization", "clauseChecks", "details", "excludedChecks"];
function record(value: unknown, path: string): Record<string, unknown> {
  if (!engineeringRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
}
function fields(raw: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(raw).find(key => !allowed.includes(key));
  if (unexpected) throw new Error(`${path}.${unexpected} is unsupported by this bounded J3 subset.`);
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
  return value;
}
function stress(value: unknown, path: string): USSteelBoltStress {
  const raw = record(value, path); fields(raw, ["value", "unit", "source", "standardId", "clause", "criterionId"], path);
  if (raw.unit !== "Pa" || raw.standardId !== "us-aisc360" || raw.clause !== "Table J3.2") throw new Error(`${path} must explicitly cite the adopted us-aisc360 Table J3.2 in Pa.`);
  return { value: requireFinite(raw.value, `${path}.value`, 1e6, 2e9), unit: "Pa", source: text(raw.source, `${path}.source`, 2000), standardId: "us-aisc360", clause: "Table J3.2", ...(raw.criterionId === undefined ? {} : { criterionId: id(raw.criterionId, `${path}.criterionId`) }) };
}

/** One authored bolt and one reviewed shear plane; no group demand is divided implicitly. */
export function parseUSSteelBoltInput(value: unknown): USSteelBoltInput {
  const raw = record(value, "US bolt input"); fields(raw, ["version", "checks"], "input");
  if (raw.version !== 1) throw new Error("US bolt input requires version 1.");
  const entries = list(raw.checks, "checks", 200); if (!entries.length) throw new Error("Supply 1-200 individual bolt/load-case checks.");
  const ids = new Set<string>();
  return { version: 1, checks: entries.map((entry): USSteelBoltCheck => {
    const item = record(entry, "bolt check"); fields(item, INPUT_KEYS, "bolt check"); const checkId = id(item.id, "check.id");
    if (ids.has(checkId)) throw new Error("US bolt check IDs must be unique."); ids.add(checkId);
    const declarations: [string, string | number | boolean][] = [["kind", "us-aisc360-j3-bolt"], ["connectionType", "bearing-type"], ["shearPlanes", 1], ["areaBasis", "gross-shank"], ["nominalStressBasis", "table-j3.2"], ["nominalStressReviewConfirmed", true], ["installationCondition", "pretensioned"], ["installationReviewConfirmed", true], ["staticLoadingOnly", true], ["noFillers", true], ["noPrying", true], ["amendmentScopeConfirmed", true], ["errataApplicabilityReviewed", true]];
    for (const [key, expected] of declarations) if (item[key] !== expected) throw new Error(`${checkId}.${key} must explicitly declare ${String(expected)}.`);
    if (item.boltGroup !== "120" && item.boltGroup !== "144" && item.boltGroup !== "150") throw new Error(`${checkId}: only sourced/reviewed high-strength Group 120, 144 and 150 Table J3.2 inputs are supported.`);
    if (item.threadPosition !== "N" && item.threadPosition !== "X") throw new Error(`${checkId}: N means threads not excluded; X means threads excluded from the one reviewed shear plane.`);
    if (item.demandAssignment !== "single-bolt" && item.demandAssignment !== "reviewed-per-bolt-group") throw new Error(`${checkId}: explicitly identify single-bolt or externally reviewed per-bolt group demand.`);
    if (typeof item.endLoadedJoint !== "boolean") throw new Error(`${checkId}: endLoadedJoint must be explicit.`);
    const fastenerPatternLengthM = requireFinite(item.fastenerPatternLengthM, "fastenerPatternLengthM", 0, 10000);
    if (item.demandAssignment === "single-bolt" && fastenerPatternLengthM !== 0) throw new Error(`${checkId}: a single-bolt fastener pattern has zero bolt-to-bolt length.`);
    if (item.endLoadedJoint && fastenerPatternLengthM > 0.95) throw new Error(`${checkId}: end-loaded patterns over 950 mm require an unimplemented Table J3.2 note reduction.`);
    if (item.designMethod !== "LRFD" && item.designMethod !== "ASD") throw new Error(`${checkId}: designMethod must be LRFD or ASD.`);
    const design = item.designMethod === "LRFD" ? { designMethod: "LRFD" as const, loadBasis: "factored" as const } : { designMethod: "ASD" as const, loadBasis: "service" as const };
    if (item.loadBasis !== design.loadBasis) throw new Error(`${checkId}: LRFD requires factored demand; ASD requires service-level effects of the reviewed applicable ASD combination.`);
    return { id: checkId, label: text(item.label, "label", 200), kind: "us-aisc360-j3-bolt", connectionId: id(item.connectionId, "connectionId"), boltId: id(item.boltId, "boltId"), inputSource: text(item.inputSource, "inputSource"), loadCase: text(item.loadCase, "loadCase", 200), loadSource: text(item.loadSource, "loadSource"),
      demandAssignment: item.demandAssignment, demandAssignmentReviewSource: text(item.demandAssignmentReviewSource, "demandAssignmentReviewSource"), connectionType: "bearing-type", shearPlanes: 1, boltGroup: item.boltGroup, boltGrade: text(item.boltGrade, "boltGrade", 200), threadPosition: item.threadPosition, diameterM: requireFinite(item.diameterM, "diameterM", 0.003, 0.1), areaBasis: "gross-shank",
      nominalStressBasis: "table-j3.2", nominalStressReviewConfirmed: true, nominalStressReviewSource: text(item.nominalStressReviewSource, "nominalStressReviewSource"), nominalTensileStressPa: stress(item.nominalTensileStressPa, "nominalTensileStressPa"), nominalShearStressPa: stress(item.nominalShearStressPa, "nominalShearStressPa"),
      installationCondition: "pretensioned", installationReviewConfirmed: true, installationReviewSource: text(item.installationReviewSource, "installationReviewSource"), staticLoadingOnly: true, noFillers: true, noPrying: true, applicabilityReviewSource: text(item.applicabilityReviewSource, "applicabilityReviewSource"), endLoadedJoint: item.endLoadedJoint, fastenerPatternLengthM,
      amendmentScopeConfirmed: true, amendmentReviewSource: text(item.amendmentReviewSource, "amendmentReviewSource"), errataApplicabilityReviewed: true, errataReviewSource: text(item.errataReviewSource, "errataReviewSource"), demandTensionN: requireFinite(item.demandTensionN, "demandTensionN", 0, 1e12), demandShearN: requireFinite(item.demandShearN, "demandShearN", 0, 1e12), ...design };
  }) };
}

/** Complete captured-basis validation plus the one supported national adoption and stress traces. */
function basisGates(source: USSteelBoltInput, basis: EngineeringDesignBasis): string[] {
  const issues = validateEngineeringDesignBasis(basis);
  if (basis.countryCode !== "US") issues.push(`Country ${basis.countryCode || "not selected"} is unsupported by this US J3 module; no US equations are substituted.`);
  if (basis.profileVersion !== ENGINEERING_BASIS_PROFILE_VERSION) issues.push("Review the captured basis catalog against the supported version.");
  const reference = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === "us-aisc360");
  const candidates = basis.standards.filter(item => item.id === "us-aisc360" || /^(?:ANSI\s*\/\s*)?AISC\s*360(?:[-:]\s*(?:22|2022))?$/i.test(item.code.trim()));
  if (!reference || candidates.length !== 1) issues.push("Adopt exactly one supported ANSI/AISC 360:2022 catalog reference; missing or multiple declarations are unsupported.");
  else {
    const adopted = candidates[0];
    if (adopted.id !== reference.id || adopted.domain !== reference.domain || adopted.code !== reference.code || adopted.edition !== "2022" || adopted.sourceUrl !== reference.sourceUrl) issues.push("The AISC adoption must exactly match the US steel catalog entry, edition 2022 and publisher.");
  }
  for (const check of source.checks) for (const [name, supplied] of [["nominal tensile stress", check.nominalTensileStressPa], ["nominal shear stress", check.nominalShearStressPa]] as const) {
    if (!supplied.criterionId) continue;
    const matches = basis.criteria.filter(item => item.id === supplied.criterionId), criterion = matches[0];
    if (matches.length !== 1 || !criterion || criterion.module !== "frame" || criterion.value !== supplied.value || criterion.unit !== supplied.unit || criterion.source !== supplied.source || criterion.standardId !== supplied.standardId || criterion.clause !== supplied.clause) issues.push(`${check.id}: ${name} must exactly match a unique captured frame criterion including the adopted Table J3.2 reference.`);
  }
  return [...new Set(issues)];
}
function nonnegative(value: number): boolean { return finiteNumber(value) && value >= 0 && value <= OUTPUT_LIMIT; }
function positive(value: number): boolean { return nonnegative(value) && value > 0; }
function details(check: USSteelBoltCheck, shearSatisfied: boolean): string[] {
  return [
    "Gross nominal bolt shank area Ab=pi*d^2/4 is derived from the authored nominal diameter. Table J3.2 nominal stresses already include their tabulated tension/thread treatment; no second tensile-area reduction is applied.",
    check.designMethod === "LRFD" ? "The supplied tensile force and one-plane shear resultant are already factored per-bolt effects of the reviewed LRFD combination." : "The supplied tensile force and one-plane shear resultant are per-bolt service-level effects of the reviewed applicable ASD combination.",
    check.demandAssignment === "single-bolt" ? "This check represents one authored individual bolt, with no bolt-group distribution." : "Each bolt's group-derived tension and shear are separately authored from the identified external demand-assignment review; neither bolt counts nor stiffness sharing are inferred.",
    "The authored grade, N/X thread location and nominal stresses require review against the adopted Table J3.2 row and notes. Pretension, static applicability and absence of prying/fillers are reviewed declarations only.",
    shearSatisfied ? "J3.8 independently satisfies shear strength before comparing tensile demand with the shear-modified tensile resistance. The modified nominal stress is capped at supplied Fnt." : "The independently required shear strength is exceeded. J3.8 combined tensile resistance, its utilization and tensile comparison are withheld; the bolt result fails regardless of tensile demand.",
  ];
}
function clauses(check: USSteelBoltCheck, shearSatisfied: boolean, tensionSatisfied: boolean | null): USSteelBoltResult["clauseChecks"] {
  return [{ clause: "J3-1 shear rupture", name: "Supplied one-plane shear demand within available bolt shear strength", satisfied: shearSatisfied },
    { clause: `J3-2 / ${check.designMethod === "LRFD" ? "J3-3a" : "J3-3b"}`, name: "Supplied bolt tension within shear-modified available tensile strength", satisfied: tensionSatisfied }];
}
function bolt(check: USSteelBoltCheck): USSteelBoltResult {
  const boltAreaM2 = Math.PI * check.diameterM ** 2 / 4;
  const requiredTensileStressPa = check.demandTensionN / boltAreaM2, requiredShearStressPa = check.demandShearN / boltAreaM2;
  const nominalTensileStressPa = check.nominalTensileStressPa.value, nominalShearStressPa = check.nominalShearStressPa.value;
  const nominalPureTensionCapacityN = nominalTensileStressPa * boltAreaM2, nominalShearCapacityN = nominalShearStressPa * boltAreaM2;
  const availablePureTensionCapacityN = check.designMethod === "LRFD" ? RESISTANCE_FACTOR * nominalPureTensionCapacityN : nominalPureTensionCapacityN / SAFETY_FACTOR;
  const availableShearCapacityN = check.designMethod === "LRFD" ? RESISTANCE_FACTOR * nominalShearCapacityN : nominalShearCapacityN / SAFETY_FACTOR;
  const shearGateSatisfied = check.demandShearN <= availableShearCapacityN, shearUtilization = check.demandShearN / availableShearCapacityN;
  const interactionReduction = check.designMethod === "LRFD" ? nominalTensileStressPa / (RESISTANCE_FACTOR * nominalShearStressPa) : SAFETY_FACTOR * nominalTensileStressPa / nominalShearStressPa;
  const modifiedNominalTensileStressPa = shearGateSatisfied ? Math.min(nominalTensileStressPa, 1.3 * nominalTensileStressPa - interactionReduction * requiredShearStressPa) : null;
  const nominalInteractionTensionCapacityN = modifiedNominalTensileStressPa === null ? null : modifiedNominalTensileStressPa * boltAreaM2;
  const availableInteractionTensionCapacityN = nominalInteractionTensionCapacityN === null ? null : check.designMethod === "LRFD" ? RESISTANCE_FACTOR * nominalInteractionTensionCapacityN : nominalInteractionTensionCapacityN / SAFETY_FACTOR;
  const tensionUtilization = availableInteractionTensionCapacityN === null ? null : check.demandTensionN / availableInteractionTensionCapacityN;
  if (![boltAreaM2, nominalPureTensionCapacityN, nominalShearCapacityN, availablePureTensionCapacityN, availableShearCapacityN].every(positive) || ![requiredTensileStressPa, requiredShearStressPa, shearUtilization].every(nonnegative) || (modifiedNominalTensileStressPa !== null && !positive(modifiedNominalTensileStressPa)) || (nominalInteractionTensionCapacityN !== null && !positive(nominalInteractionTensionCapacityN)) || (availableInteractionTensionCapacityN !== null && !positive(availableInteractionTensionCapacityN)) || (tensionUtilization !== null && !nonnegative(tensionUtilization))) throw new Error(`${check.id}: derived J3 output exceeds its finite numerical scope.`);
  const tensionSatisfied = availableInteractionTensionCapacityN === null ? null : check.demandTensionN <= availableInteractionTensionCapacityN;
  return { id: check.id, kind: check.kind, connectionId: check.connectionId, boltId: check.boltId, designMethod: check.designMethod, status: shearGateSatisfied && tensionSatisfied === true ? "within-implemented-clauses" : "exceeds-implemented-clauses", resistanceFactor: RESISTANCE_FACTOR, safetyFactor: SAFETY_FACTOR, boltAreaM2, requiredTensileStressPa, requiredShearStressPa, nominalTensileStressPa, nominalShearStressPa,
    nominalPureTensionCapacityN, availablePureTensionCapacityN, nominalShearCapacityN, availableShearCapacityN, shearGateSatisfied, modifiedNominalTensileStressPa, nominalInteractionTensionCapacityN, availableInteractionTensionCapacityN, demandTensionN: check.demandTensionN, demandShearN: check.demandShearN, tensionUtilization, shearUtilization, clauseChecks: clauses(check, shearGateSatisfied, tensionSatisfied), details: details(check, shearGateSatisfied), excludedChecks: [...EXCLUDED_CHECKS] };
}

/** Scoped per-bolt rupture checks, never a complete connection approval. */
export function assessUSSteelBolts(input: USSteelBoltInput, designBasis: EngineeringDesignBasis): USSteelBoltReport {
  const source = parseUSSteelBoltInput(input), basis = parseEngineeringDesignBasis(designBasis), gates = basisGates(source, basis);
  const report: USSteelBoltReport = { version: 1, implementation: IMPLEMENTATION, verification: "unverified", compliance: "not-assessed", source, basis, status: gates.length ? "unsupported-basis" : "assessed-subset", basisIssues: gates, implementedClauses: gates.length ? [] : [...CLAUSES], results: gates.length ? [] : source.checks.map(bolt), warnings: [...WARNINGS] };
  if (!validateUSSteelBoltReport(report, source, basis)) throw new Error("Generated US J3 bolt report failed its finite source-coherence contract.");
  return report;
}
function sameTextList(value: unknown, expected: string[], path: string, maximum: number): boolean {
  return JSON.stringify(list(value, path, maximum).map(item => text(item, path))) === JSON.stringify(expected);
}
function strictSavedBasis(value: unknown): EngineeringDesignBasis {
  const raw = record(value, "saved basis"); fields(raw, ["version", "profileVersion", "countryCode", "region", "authority", "standards", "declaration", "criteria", "confirmed", "reviewer", "reviewNote"], "saved basis");
  fields(record(raw.declaration, "saved declaration"), ["occupancy", "riskCategory", "structuralSystem", "material", "soil", "loads", "hazards"], "saved declaration");
  list(raw.standards, "saved standards", 40).forEach(item => fields(record(item, "saved standard"), ["id", "domain", "code", "edition", "sourceUrl", "adoptionReference", "amendments"], "saved standard"));
  list(raw.criteria, "saved criteria", 64).forEach(item => fields(record(item, "saved criterion"), ["id", "module", "name", "value", "unit", "source", "standardId", "clause"], "saved criterion"));
  return parseEngineeringDesignBasis(raw);
}

/** Strict restored scalar source algebra only; no assessor, bolt routine or solver is called. */
export function validateUSSteelBoltReport(value: unknown, input: USSteelBoltInput, designBasis: EngineeringDesignBasis): value is USSteelBoltReport {
  try {
    const source = parseUSSteelBoltInput(input), basis = parseEngineeringDesignBasis(designBasis), raw = record(value, "US bolt report");
    fields(raw, ["version", "implementation", "verification", "compliance", "source", "basis", "status", "basisIssues", "implementedClauses", "results", "warnings"], "report");
    if (raw.version !== 1 || raw.implementation !== IMPLEMENTATION || raw.verification !== "unverified" || raw.compliance !== "not-assessed") return false;
    if (JSON.stringify(parseUSSteelBoltInput(raw.source)) !== JSON.stringify(source) || engineeringBasisFingerprint(strictSavedBasis(raw.basis)) !== engineeringBasisFingerprint(basis)) return false;
    const gates = basisGates(source, basis), supported = gates.length === 0;
    if (raw.status !== (supported ? "assessed-subset" : "unsupported-basis") || !sameTextList(raw.basisIssues, gates, "basisIssues", 1000) || !sameTextList(raw.implementedClauses, supported ? CLAUSES : [], "implementedClauses", 10) || !sameTextList(raw.warnings, WARNINGS, "warnings", 20)) return false;
    const results = list(raw.results, "results", 200); if (results.length !== (supported ? source.checks.length : 0)) return false;
    for (let index = 0; index < results.length; index++) {
      const item = record(results[index], "result"), check = source.checks[index]; fields(item, RESULT_KEYS, "result");
      if (item.id !== check.id || item.kind !== check.kind || item.connectionId !== check.connectionId || item.boltId !== check.boltId || item.designMethod !== check.designMethod || item.resistanceFactor !== RESISTANCE_FACTOR || item.safetyFactor !== SAFETY_FACTOR) return false;
      const area = Math.PI * check.diameterM ** 2 / 4, tensileStress = check.demandTensionN / area, shearStress = check.demandShearN / area;
      const fnt = check.nominalTensileStressPa.value, fnv = check.nominalShearStressPa.value, nominalTension = fnt * area, nominalShear = fnv * area;
      const availableTension = check.designMethod === "LRFD" ? RESISTANCE_FACTOR * nominalTension : nominalTension / SAFETY_FACTOR, availableShear = check.designMethod === "LRFD" ? RESISTANCE_FACTOR * nominalShear : nominalShear / SAFETY_FACTOR;
      const shearSatisfied = check.demandShearN <= availableShear, shearUtilization = check.demandShearN / availableShear;
      const reduction = check.designMethod === "LRFD" ? fnt / (RESISTANCE_FACTOR * fnv) : SAFETY_FACTOR * fnt / fnv;
      const modified = shearSatisfied ? Math.min(fnt, 1.3 * fnt - reduction * shearStress) : null, nominalInteraction = modified === null ? null : modified * area;
      const availableInteraction = nominalInteraction === null ? null : check.designMethod === "LRFD" ? RESISTANCE_FACTOR * nominalInteraction : nominalInteraction / SAFETY_FACTOR;
      const tensionUtilization = availableInteraction === null ? null : check.demandTensionN / availableInteraction;
      if (![area, nominalTension, nominalShear, availableTension, availableShear].every(positive) || ![tensileStress, shearStress, shearUtilization].every(nonnegative) || (modified !== null && !positive(modified)) || (nominalInteraction !== null && !positive(nominalInteraction)) || (availableInteraction !== null && !positive(availableInteraction)) || (tensionUtilization !== null && !nonnegative(tensionUtilization))) return false;
      const expected: Record<string, number | null | boolean> = { boltAreaM2: area, requiredTensileStressPa: tensileStress, requiredShearStressPa: shearStress, nominalTensileStressPa: fnt, nominalShearStressPa: fnv, nominalPureTensionCapacityN: nominalTension, availablePureTensionCapacityN: availableTension, nominalShearCapacityN: nominalShear, availableShearCapacityN: availableShear, shearGateSatisfied: shearSatisfied, modifiedNominalTensileStressPa: modified, nominalInteractionTensionCapacityN: nominalInteraction, availableInteractionTensionCapacityN: availableInteraction, demandTensionN: check.demandTensionN, demandShearN: check.demandShearN, tensionUtilization, shearUtilization };
      if (Object.entries(expected).some(([key, number]) => item[key] !== number)) return false;
      const tensionSatisfied = availableInteraction === null ? null : check.demandTensionN <= availableInteraction;
      if (item.status !== (shearSatisfied && tensionSatisfied === true ? "within-implemented-clauses" : "exceeds-implemented-clauses")) return false;
      const savedClauses = list(item.clauseChecks, "clauseChecks", 2), expectedClauses = clauses(check, shearSatisfied, tensionSatisfied); if (savedClauses.length !== 2) return false;
      for (let i = 0; i < savedClauses.length; i++) {
        const clause = record(savedClauses[i], "clauseCheck"), expectedClause = expectedClauses[i]; fields(clause, ["clause", "name", "satisfied"], "clauseCheck");
        if (clause.clause !== expectedClause.clause || clause.name !== expectedClause.name || clause.satisfied !== expectedClause.satisfied) return false;
      }
      if (!sameTextList(item.details, details(check, shearSatisfied), "details", 10) || !sameTextList(item.excludedChecks, EXCLUDED_CHECKS, "excludedChecks", 15)) return false;
    }
    return true;
  } catch { return false; }
}

/** Illustrative SI fields, never a selected bolt or accepted project/installation review. */
export function usSteelBoltExample(): USSteelBoltInput {
  const materialSource = "Illustrative declared SI Table J3.2 Group 120 row only; replace with reviewed adopted material/grade/thread-position data.";
  return { version: 1, checks: [{ id: "aisc-j3-bolt-1", label: "US J3 individual bolt rupture/interaction subset", kind: "us-aisc360-j3-bolt", connectionId: "illustrative-connection", boltId: "bolt-1", inputSource: "Illustrative nominal bolt diameter and connection declarations; replace with checked project records.", loadCase: "replace-with-LRFD-combination", loadSource: "Illustrative per-bolt factored forces only; replace with reviewed applicable LRFD load combination and analysis reference.",
    demandAssignment: "single-bolt", demandAssignmentReviewSource: "Example declaration only; replace with independently reviewed applied tensile force and one-plane shear resultant for this bolt.", connectionType: "bearing-type", shearPlanes: 1, boltGroup: "120", boltGrade: "Replace with project ASTM grade and assembly", threadPosition: "N", diameterM: 0.02, areaBasis: "gross-shank", nominalStressBasis: "table-j3.2", nominalStressReviewConfirmed: true, nominalStressReviewSource: "Example declaration only; replace with the adopted Table J3.2 grade/group/N-thread row, units and every applicable note review.",
    nominalTensileStressPa: { value: 620e6, unit: "Pa", source: materialSource, standardId: "us-aisc360", clause: "Table J3.2" }, nominalShearStressPa: { value: 370e6, unit: "Pa", source: materialSource, standardId: "us-aisc360", clause: "Table J3.2" }, installationCondition: "pretensioned", installationReviewConfirmed: true, installationReviewSource: "Example declaration only; replace with applicable J3.2/RCSC assembly/installation and pretension review. Pretension is not calculated or verified here.",
    staticLoadingOnly: true, noFillers: true, noPrying: true, applicabilityReviewSource: "Example declaration only; replace with review confirming static bearing-type scope, no slip-critical requirement, no fillers/packing and no prying effects.", endLoadedJoint: true, fastenerPatternLengthM: 0, amendmentScopeConfirmed: true, amendmentReviewSource: "Example declaration only; replace with locally adopted AISC 360-22 and amendment applicability review.", errataApplicabilityReviewed: true, errataReviewSource: "Example declaration only; replace with January 2025/September 2026 errata review confirming implemented J3 applicability.", demandTensionN: 40000, demandShearN: 30000, designMethod: "LRFD", loadBasis: "factored",
  }] };
}
