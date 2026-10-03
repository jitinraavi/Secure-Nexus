import { ENGINEERING_BASIS_PROFILE_VERSION, ENGINEERING_STANDARD_REFERENCES, engineeringBasisFingerprint, parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis } from "./engineeringBasis";
import { engineeringRecord, finiteNumber, identifier, requireFinite } from "./engineeringNumerics";

export interface IS456RectangularCheck {
  id: string; label: string; kind: "in-is456-rectangular-beam";
  inputSource: string; loadCase: string; loadSource: string; materialSource: string;
  loadBasis: "factored"; bendingDirection: "declared-tension-face"; memberType: "beam"; sectionShape: "rectangular";
  bondedTensionSteel: true; sectionsRemainPlane: true; deepBeam: false; axialForceN: 0; compressionSteelAreaM2: 0; momentRedistribution: false;
  amendmentScopeConfirmed: true; amendmentReviewSource: string;
  widthM: number; depthM: number; effectiveDepthM: number; tensionSteelAreaM2: number;
  fckPa: number; steelGradeMPa: 250 | 415 | 500; demandMomentNm: number;
  steelElasticModulusPa: { value: number; unit: "Pa"; source: string; criterionId?: string };
}
export interface NationalStructuralInput { version: 1; checks: IS456RectangularCheck[] }
export interface NationalClauseCheck { clause: string; name: string; satisfied: boolean }
export interface NationalStructuralResult {
  id: string; kind: "in-is456-rectangular-beam";
  status: "within-implemented-clauses" | "exceeds-implemented-clauses" | "unsupported-section";
  metrics: Record<string, number | null>; momentCapacityNm: number | null; momentUtilization: number | null;
  clauseChecks: NationalClauseCheck[]; details: string[]; excludedChecks: string[];
}
export interface NationalStructuralReport {
  version: 1; implementation: "IS456-2000-singly-rectangular-v1"; verification: "unverified"; compliance: "not-assessed";
  source: NationalStructuralInput; basis: EngineeringDesignBasis;
  status: "assessed-subset" | "unsupported-basis"; basisIssues: string[]; implementedClauses: string[];
  results: NationalStructuralResult[]; warnings: string[];
}

const IMPLEMENTATION = "IS456-2000-singly-rectangular-v1";
const CLAUSES = ["5.6.3 steel elastic modulus", "38.1(b),(c),(d),(e),(f) and neutral-axis-limit note", "Annex G-1.1(a)-(d)", "26.5.1.1(a),(b)"];
const SOURCE_ARTIFACT = "https://law.resource.org/pub/in/bis/S03/is.456.2000.pdf";
const resultMetricKeys = ["steelYieldPa", "neutralAxisDepthM", "neutralAxisRatio", "tabulatedLimitRatio", "strainLimitRatio", "governingLimitRatio", "tensileStrain", "minimumTensileStrain", "minimumSteelAreaM2", "maximumSteelAreaM2", "compressionResultantN", "steelTensionResultantN", "leverArmM"];
const inputKeys = ["id", "label", "kind", "inputSource", "loadCase", "loadSource", "materialSource", "loadBasis", "bendingDirection", "memberType", "sectionShape", "bondedTensionSteel", "sectionsRemainPlane", "deepBeam", "axialForceN", "compressionSteelAreaM2", "momentRedistribution", "amendmentScopeConfirmed", "amendmentReviewSource", "widthM", "depthM", "effectiveDepthM", "tensionSteelAreaM2", "fckPa", "steelGradeMPa", "demandMomentNm", "steelElasticModulusPa"];
function record(value: unknown, path: string): Record<string, unknown> {
  if (!engineeringRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
}
function fields(raw: Record<string, unknown>, allowed: string[], path: string): void {
  const unexpected = Object.keys(raw).find(key => !allowed.includes(key));
  if (unexpected) throw new Error(`${path}.${unexpected} is unsupported by this bounded national subset.`);
}
function text(value: unknown, path: string, maximum = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${path} requires bounded non-empty text.`);
  return value;
}
function id(value: unknown, path: string): string {
  if (!identifier(value) || !value.trim()) throw new Error(`${path} requires an identifier of 1-100 characters.`);
  return value;
}
function equal(value: unknown, expected: string | number | boolean, path: string): void {
  if (value !== expected) throw new Error(`${path} must explicitly declare ${String(expected)} for the supported section subset.`);
}

/** Only declared ordinary rectangular singly reinforced beam sections enter this schema. */
export function parseNationalStructuralInput(value: unknown): NationalStructuralInput {
  const raw = record(value, "National structural input"); fields(raw, ["version", "checks"], "input");
  if (raw.version !== 1 || !Array.isArray(raw.checks) || !raw.checks.length || raw.checks.length > 100) throw new Error("National structural input requires version 1 and 1-100 checks.");
  const ids = new Set<string>();
  const checks = raw.checks.map((entry, index): IS456RectangularCheck => {
    const item = record(entry, `checks[${index}]`); fields(item, inputKeys, `checks[${index}]`);
    const checkId = id(item.id, "check.id");
    if (ids.has(checkId)) throw new Error("National structural check identifiers must be unique."); ids.add(checkId);
    const declarations: [string, string | number | boolean][] = [["kind", "in-is456-rectangular-beam"], ["loadBasis", "factored"], ["bendingDirection", "declared-tension-face"], ["memberType", "beam"], ["sectionShape", "rectangular"], ["bondedTensionSteel", true], ["sectionsRemainPlane", true], ["deepBeam", false], ["axialForceN", 0], ["compressionSteelAreaM2", 0], ["momentRedistribution", false], ["amendmentScopeConfirmed", true]];
    for (const [key, expected] of declarations) equal(item[key], expected, `${checkId}.${key}`);
    if (item.steelGradeMPa !== 250 && item.steelGradeMPa !== 415 && item.steelGradeMPa !== 500) throw new Error(`${checkId}: supported steel grades are exactly 250, 415 or 500 MPa.`);
    const elastic = record(item.steelElasticModulusPa, `${checkId}.steelElasticModulusPa`); fields(elastic, ["value", "unit", "source", "criterionId"], "steelElasticModulusPa");
    equal(elastic.unit, "Pa", "steelElasticModulusPa.unit");
    equal(elastic.value, 200e9, "IS 456 5.6.3 steelElasticModulusPa.value (Pa)");
    const elasticModulus = { value: 200e9, unit: "Pa" as const, source: text(elastic.source, "steelElasticModulusPa.source"), ...(elastic.criterionId === undefined ? {} : { criterionId: id(elastic.criterionId, "steelElasticModulusPa.criterionId") }) };
    const check: IS456RectangularCheck = {
      id: checkId, label: text(item.label, "check.label", 200), kind: "in-is456-rectangular-beam", inputSource: text(item.inputSource, "inputSource", 4000), loadCase: text(item.loadCase, "loadCase", 200), loadSource: text(item.loadSource, "loadSource", 4000), materialSource: text(item.materialSource, "materialSource", 4000),
      loadBasis: "factored", bendingDirection: "declared-tension-face", memberType: "beam", sectionShape: "rectangular", bondedTensionSteel: true, sectionsRemainPlane: true, deepBeam: false, axialForceN: 0, compressionSteelAreaM2: 0, momentRedistribution: false, amendmentScopeConfirmed: true, amendmentReviewSource: text(item.amendmentReviewSource, "amendmentReviewSource", 4000),
      widthM: requireFinite(item.widthM, "widthM", 0.01, 100), depthM: requireFinite(item.depthM, "depthM", 0.01, 100), effectiveDepthM: requireFinite(item.effectiveDepthM, "effectiveDepthM", 0.005, 100), tensionSteelAreaM2: requireFinite(item.tensionSteelAreaM2, "tensionSteelAreaM2", 1e-10, 100),
      fckPa: requireFinite(item.fckPa, "fckPa", 20e6, 50e6), steelGradeMPa: item.steelGradeMPa, demandMomentNm: requireFinite(item.demandMomentNm, "demandMomentNm", 0, 1e12), steelElasticModulusPa: elasticModulus,
    };
    if (check.effectiveDepthM >= check.depthM || check.tensionSteelAreaM2 >= check.widthM * check.depthM) throw new Error(`${checkId}: effective depth must be less than section depth and tension steel area less than gross section area.`);
    return check;
  });
  return { version: 1, checks };
}

/** Metadata/adoption gates only; this routine does not calculate structural results. */
function basisGates(source: NationalStructuralInput, basis: EngineeringDesignBasis): string[] {
  const issues: string[] = [];
  if (basis.countryCode !== "IN") issues.push(`Country ${basis.countryCode || "not selected"} has no implemented national structural clause set in this version. Indian coefficients are not applied.`);
  if (basis.profileVersion !== ENGINEERING_BASIS_PROFILE_VERSION) issues.push("The captured basis reference-catalog version is unsupported; review it against the current project catalog.");
  if (!basis.region.trim() || !basis.authority.trim()) issues.push("The project region and authority having jurisdiction must be declared.");
  if (!basis.confirmed || !basis.reviewer.trim()) issues.push("A named reviewer must confirm the project adoption basis.");
  const standardIds = basis.standards.map(standard => standard.id), criterionIds = basis.criteria.map(criterion => criterion.id);
  if (new Set(standardIds).size !== standardIds.length || new Set(criterionIds).size !== criterionIds.length) issues.push("Adopted standard and criterion IDs must be unique.");
  const reference = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === "in-is456");
  const candidates = basis.standards.filter(item => item.id === "in-is456" || /^IS\s*456$/i.test(item.code.trim()));
  if (!reference || candidates.length !== 1) issues.push("Adopt exactly one supported IS 456:2000 reference; multiple declarations are ambiguous.");
  else {
    const adopted = candidates[0];
    if (adopted.id !== reference.id || adopted.domain !== reference.domain || adopted.code !== reference.code || adopted.edition !== "2000" || adopted.sourceUrl !== reference.sourceUrl) issues.push("The adopted IS 456 reference must match the Indian concrete catalog entry, edition 2000 and publisher source.");
    if (!adopted.adoptionReference.trim() || !adopted.amendments.trim()) issues.push("IS 456 adoption and applicable amendments must be explicitly declared.");
  }
  for (const check of source.checks) if (check.steelElasticModulusPa.criterionId) {
    const matching = basis.criteria.filter(criterion => criterion.id === check.steelElasticModulusPa.criterionId), criterion = matching[0];
    if (matching.length !== 1 || !criterion || criterion.module !== "frame" || criterion.unit !== "Pa" || criterion.value !== check.steelElasticModulusPa.value || criterion.source !== check.steelElasticModulusPa.source) issues.push(`${check.id}: the steel modulus must exactly match a unique captured frame criterion.`);
    else if (criterion.standardId && (!standardIds.includes(criterion.standardId) || !criterion.clause?.trim())) issues.push(`${check.id}: the referenced modulus criterion must identify an adopted standard and clause.`);
  }
  return issues;
}
function section(check: IS456RectangularCheck): NationalStructuralResult {
  const steelYieldPa = check.steelGradeMPa * 1e6;
  const steelTensionResultantN = 0.87 * steelYieldPa * check.tensionSteelAreaM2;
  const neutralAxisDepthM = steelTensionResultantN / (0.36 * check.fckPa * check.widthM), neutralAxisRatio = neutralAxisDepthM / check.effectiveDepthM;
  const tabulatedLimitRatio = check.steelGradeMPa === 250 ? 0.53 : check.steelGradeMPa === 415 ? 0.48 : 0.46;
  const minimumTensileStrain = steelYieldPa / (1.15 * check.steelElasticModulusPa.value) + 0.002;
  const strainLimitRatio = 0.0035 / (0.0035 + minimumTensileStrain), governingLimitRatio = Math.min(tabulatedLimitRatio, strainLimitRatio);
  const tensileStrain = neutralAxisDepthM < check.effectiveDepthM ? 0.0035 * (check.effectiveDepthM - neutralAxisDepthM) / neutralAxisDepthM : null;
  const minimumSteelAreaM2 = 0.85e6 * check.widthM * check.effectiveDepthM / steelYieldPa, maximumSteelAreaM2 = 0.04 * check.widthM * check.depthM;
  const compressionResultantN = 0.36 * check.fckPa * check.widthM * neutralAxisDepthM;
  const ductileScope = neutralAxisRatio <= tabulatedLimitRatio && tensileStrain !== null && tensileStrain >= minimumTensileStrain;
  const leverArmM = ductileScope ? check.effectiveDepthM - 0.42 * neutralAxisDepthM : null;
  const momentCapacityNm = leverArmM === null ? null : compressionResultantN * leverArmM;
  const momentUtilization = momentCapacityNm === null ? null : check.demandMomentNm / momentCapacityNm;
  const clauseChecks: NationalClauseCheck[] = [
    { clause: "38.1 neutral-axis-limit note", name: "Neutral-axis ratio within the steel-grade table limit", satisfied: neutralAxisRatio <= tabulatedLimitRatio },
    { clause: "38.1(f)", name: "Tension strain meets the explicit minimum", satisfied: tensileStrain !== null && tensileStrain >= minimumTensileStrain },
    { clause: "26.5.1.1(a)", name: "Minimum tension reinforcement", satisfied: check.tensionSteelAreaM2 >= minimumSteelAreaM2 },
    { clause: "26.5.1.1(b)", name: "Maximum tension reinforcement", satisfied: check.tensionSteelAreaM2 <= maximumSteelAreaM2 },
  ];
  if (momentCapacityNm !== null) clauseChecks.push({ clause: "Annex G-1.1", name: "Supplied factored moment within section resistance", satisfied: check.demandMomentNm <= momentCapacityNm });
  const metrics = { steelYieldPa, neutralAxisDepthM, neutralAxisRatio, tabulatedLimitRatio, strainLimitRatio, governingLimitRatio, tensileStrain, minimumTensileStrain, minimumSteelAreaM2, maximumSteelAreaM2, compressionResultantN, steelTensionResultantN, leverArmM };
  if (Object.values(metrics).some(value => value !== null && !Number.isFinite(value)) || (momentCapacityNm !== null && (!Number.isFinite(momentCapacityNm) || momentCapacityNm <= 0)) || (momentUtilization !== null && !Number.isFinite(momentUtilization))) throw new Error(`${check.id}: national section result is non-finite or invalid.`);
  return { id: check.id, kind: check.kind, status: !ductileScope ? "unsupported-section" : clauseChecks.every(item => item.satisfied) ? "within-implemented-clauses" : "exceeds-implemented-clauses", metrics, momentCapacityNm, momentUtilization, clauseChecks,
    details: ["Both the published grade table and the explicit strain condition are enforced; the stricter neutral-axis limit governs.", ...(ductileScope ? ["Yielded tension-steel equilibrium is inside the supported flexural subset."] : ["Overreinforced or non-yielding-strain scope: no flexural capacity is issued. Redesign or a separately validated section method is required."]), "The supplied moment is already factored; this module does not generate or verify its load combination."],
    excludedChecks: ["Complete IS 456 member design and locally applicable amendments", "Seismic/ductile detailing and moment redistribution", "Shear, torsion, axial interaction, anchorage, bond, spacing, cover and side-face reinforcement", "Cracking, deflection, durability, fatigue, construction stages and fire resistance", "Compression steel, prestressed, flanged and deep-beam section behavior"] };
}

/** Verified published clause coefficients; outputs still require executable benchmark acceptance. */
export function assessNationalStructure(input: NationalStructuralInput, designBasis: EngineeringDesignBasis): NationalStructuralReport {
  const source = parseNationalStructuralInput(input), basis = parseEngineeringDesignBasis(designBasis), gates = basisGates(source, basis);
  return { version: 1, implementation: IMPLEMENTATION, verification: "unverified", compliance: "not-assessed", source, basis, status: gates.length ? "unsupported-basis" : "assessed-subset",
    basisIssues: [...gates, ...validateEngineeringDesignBasis(basis)], implementedClauses: gates.length ? [] : [...CLAUSES], results: gates.length ? [] : source.checks.map(section),
    warnings: ["Source was inspected only; TypeScript compilation, numerical behavior and independent benchmarks have not been executed.", `The inspected BIS-authored artifact is the April 2007 reprint including Amendments 1 and 2: ${SOURCE_ARTIFACT}. Later amendments and local adoption applicability are not automatically implemented.`, "The named IS 456 subset requires the explicit steel modulus declaration to be exactly 200e9 Pa under clause 5.6.3; arbitrary project moduli belong in a separate supplied-criteria calculation.", "Only the reported clauses and section assumptions are evaluated. No complete national-code compliance, safe construction or professional approval is asserted.", "USA and other country code sets remain explicitly unsupported in this version; country selection never falls back to Indian coefficients."] };
}

function textList(value: unknown, path: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${path} requires a bounded array.`);
  return value.map(entry => text(entry, path, 4000));
}
/** Source algebra only: no numerical analysis, iteration or capacity solver runs on restore. */
function restoredSectionMatches(item: Record<string, unknown>, check: IS456RectangularCheck): boolean {
  const metrics = record(item.metrics, "metrics");
  const fy = check.steelGradeMPa * 1e6, tension = 0.87 * fy * check.tensionSteelAreaM2;
  const xu = tension / (0.36 * check.fckPa * check.widthM), ratio = xu / check.effectiveDepthM;
  const tableLimit = check.steelGradeMPa === 250 ? 0.53 : check.steelGradeMPa === 415 ? 0.48 : 0.46;
  const minimumStrain = fy / (1.15 * check.steelElasticModulusPa.value) + 0.002;
  const strainLimit = 0.0035 / (0.0035 + minimumStrain);
  const strain = xu < check.effectiveDepthM ? 0.0035 * (check.effectiveDepthM - xu) / xu : null;
  const minimumSteel = 0.85e6 * check.widthM * check.effectiveDepthM / fy;
  const maximumSteel = 0.04 * check.widthM * check.depthM;
  const compression = 0.36 * check.fckPa * check.widthM * xu;
  const withinTable = ratio <= tableLimit, withinStrain = strain !== null && strain >= minimumStrain;
  const ductile = withinTable && withinStrain;
  const lever = ductile ? check.effectiveDepthM - 0.42 * xu : null;
  const capacity = lever === null ? null : compression * lever;
  const utilization = capacity === null ? null : check.demandMomentNm / capacity;
  const expectedMetrics: Record<string, number | null> = {
    steelYieldPa: fy, neutralAxisDepthM: xu, neutralAxisRatio: ratio, tabulatedLimitRatio: tableLimit,
    strainLimitRatio: strainLimit, governingLimitRatio: Math.min(tableLimit, strainLimit), tensileStrain: strain,
    minimumTensileStrain: minimumStrain, minimumSteelAreaM2: minimumSteel, maximumSteelAreaM2: maximumSteel,
    compressionResultantN: compression, steelTensionResultantN: tension, leverArmM: lever,
  };
  // Stored JSON preserves each IEEE-754 number. Exact equality prevents accepting edited
  // capacities/strains near a clause boundary, including a forged pass within tolerance.
  if (resultMetricKeys.some(key => expectedMetrics[key] !== null && !finiteNumber(expectedMetrics[key]) || metrics[key] !== expectedMetrics[key])) return false;
  if (capacity !== null && (!finiteNumber(capacity) || capacity <= 0) || utilization !== null && (!finiteNumber(utilization) || utilization < 0)) return false;
  if (item.momentCapacityNm !== capacity || item.momentUtilization !== utilization) return false;
  const flags = [withinTable, withinStrain, check.tensionSteelAreaM2 >= minimumSteel, check.tensionSteelAreaM2 <= maximumSteel, ...(capacity === null ? [] : [check.demandMomentNm <= capacity])];
  const names = ["Neutral-axis ratio within the steel-grade table limit", "Tension strain meets the explicit minimum", "Minimum tension reinforcement", "Maximum tension reinforcement", ...(capacity === null ? [] : ["Supplied factored moment within section resistance"])];
  if (!Array.isArray(item.clauseChecks) || item.clauseChecks.length !== flags.length) return false;
  if (item.clauseChecks.some((entry, index) => !engineeringRecord(entry) || entry.satisfied !== flags[index] || entry.name !== names[index])) return false;
  const status = !ductile ? "unsupported-section" : flags.every(Boolean) ? "within-implemented-clauses" : "exceeds-implemented-clauses";
  return item.status === status;
}

/** Restores captured evidence by structure, identity and closed-form source coherence. */
export function validateNationalStructuralReport(value: unknown, input: NationalStructuralInput, designBasis: EngineeringDesignBasis): value is NationalStructuralReport {
  try {
    const raw = record(value, "National structural report"), source = parseNationalStructuralInput(input), basis = parseEngineeringDesignBasis(designBasis);
    fields(raw, ["version", "implementation", "verification", "compliance", "source", "basis", "status", "basisIssues", "implementedClauses", "results", "warnings"], "report");
    if (raw.version !== 1 || raw.implementation !== IMPLEMENTATION || raw.verification !== "unverified" || raw.compliance !== "not-assessed") return false;
    if (JSON.stringify(parseNationalStructuralInput(raw.source)) !== JSON.stringify(source) || engineeringBasisFingerprint(parseEngineeringDesignBasis(raw.basis)) !== engineeringBasisFingerprint(basis)) return false;
    const gates = basisGates(source, basis), supported = gates.length === 0;
    if (raw.status !== (supported ? "assessed-subset" : "unsupported-basis")) return false;
    const clauses = textList(raw.implementedClauses, "implementedClauses", 10), basisIssues = textList(raw.basisIssues, "basisIssues", 500); textList(raw.warnings, "warnings", 30);
    if (JSON.stringify(basisIssues) !== JSON.stringify([...gates, ...validateEngineeringDesignBasis(basis)])) return false;
    if (JSON.stringify(clauses) !== JSON.stringify(supported ? CLAUSES : []) || !Array.isArray(raw.results) || raw.results.length !== (supported ? source.checks.length : 0)) return false;
    for (let i = 0; i < raw.results.length; i++) {
      const item = record(raw.results[i], "nationalResult"), check = source.checks[i];
      fields(item, ["id", "kind", "status", "metrics", "momentCapacityNm", "momentUtilization", "clauseChecks", "details", "excludedChecks"], "nationalResult");
      if (item.id !== check.id || item.kind !== check.kind || !["within-implemented-clauses", "exceeds-implemented-clauses", "unsupported-section"].includes(String(item.status))) return false;
      const metrics = record(item.metrics, "metrics"); fields(metrics, resultMetricKeys, "metrics");
      if (Object.keys(metrics).length !== resultMetricKeys.length || resultMetricKeys.some(key => metrics[key] !== null && (!finiteNumber(metrics[key]) || (metrics[key] as number) < 0))) return false;
      if (resultMetricKeys.some(key => key !== "tensileStrain" && key !== "leverArmM" && metrics[key] === null)) return false;
      textList(item.details, "details", 30); textList(item.excludedChecks, "excludedChecks", 30);
      if (!Array.isArray(item.clauseChecks) || item.clauseChecks.length !== (item.status === "unsupported-section" ? 4 : 5)) return false;
      const clauseIds = ["38.1 neutral-axis-limit note", "38.1(f)", "26.5.1.1(a)", "26.5.1.1(b)", ...(item.status === "unsupported-section" ? [] : ["Annex G-1.1"])];
      for (let j = 0; j < item.clauseChecks.length; j++) {
        const assessed = record(item.clauseChecks[j], "clauseCheck"); fields(assessed, ["clause", "name", "satisfied"], "clauseCheck");
        if (assessed.clause !== clauseIds[j] || typeof assessed.satisfied !== "boolean") return false;
        text(assessed.name, "clauseCheck.name", 400);
      }
      const ductileFlags = (item.clauseChecks[0] as Record<string, unknown>).satisfied && (item.clauseChecks[1] as Record<string, unknown>).satisfied;
      if ((item.status === "unsupported-section") === Boolean(ductileFlags)) return false;
      if (item.status === "unsupported-section") {
        if (item.momentCapacityNm !== null || item.momentUtilization !== null || metrics.leverArmM !== null) return false;
      } else {
        requireFinite(item.momentCapacityNm, "momentCapacityNm", Number.MIN_VALUE); requireFinite(item.momentUtilization, "momentUtilization", 0);
        if (!finiteNumber(metrics.leverArmM) || metrics.leverArmM <= 0 || !finiteNumber(metrics.tensileStrain)) return false;
        const allSatisfied = item.clauseChecks.every(entry => (entry as Record<string, unknown>).satisfied === true);
        if ((item.status === "within-implemented-clauses") !== allSatisfied) return false;
        if ((item.clauseChecks[4] as Record<string, unknown>).satisfied !== ((item.momentUtilization as number) <= 1)) return false;
      }
      if (!restoredSectionMatches(item, check)) return false;
    }
    return true;
  } catch { return false; }
}

/** Example inputs only; a confirmed matching project adoption basis is still required. */
export function nationalStructuralExample(): NationalStructuralInput {
  return { version: 1, checks: [{ id: "is456-beam-1", label: "IS 456 rectangular singly reinforced beam subset", kind: "in-is456-rectangular-beam",
    inputSource: "Illustrative SI dimensions; replace with checked project geometry and tension-face reinforcement arrangement.", loadCase: "replace-with-factored-project-combination", loadSource: "Illustrative moment only; replace with reviewed factored analysis and load-combination reference.", materialSource: "Illustrative M30 and Fe415 material values; replace with project material specifications and verification.",
    loadBasis: "factored", bendingDirection: "declared-tension-face", memberType: "beam", sectionShape: "rectangular", bondedTensionSteel: true, sectionsRemainPlane: true, deepBeam: false, axialForceN: 0, compressionSteelAreaM2: 0, momentRedistribution: false,
    amendmentScopeConfirmed: true, amendmentReviewSource: "Example declaration only; replace after reviewing locally adopted amendments against the implementation's inspected April 2007 reprint.",
    widthM: 0.3, depthM: 0.6, effectiveDepthM: 0.54, tensionSteelAreaM2: 0.0015, fckPa: 30e6, steelGradeMPa: 415, demandMomentNm: 180000,
    steelElasticModulusPa: { value: 200e9, unit: "Pa", source: "Illustrative supplied steel modulus; replace with a reviewed material-source declaration." },
  }] };
}
