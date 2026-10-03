import { ENGINEERING_STANDARD_REFERENCES, engineeringBasisFingerprint, isEngineeringSourceUrl, parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis } from "./engineeringBasis";
import { engineeringRecord, finiteNumber, identifier, requireFinite } from "./engineeringNumerics";

/** Supplied design/material parameter. No country selection supplies these values. */
export interface StructuralParameter {
  value: number; unit: "Pa" | "N" | "1"; source: string;
  criterionId?: string; standardId?: string; clause?: string;
}
interface StructuralCheckBase { id: string; label: string; inputSource: string; loadCase: string }
export interface SteelElasticCheck extends StructuralCheckBase {
  kind: "steel-elastic"; areaM2: number; inertiaYM4: number; inertiaZM4: number;
  sectionModulusYM3: number; sectionModulusZM3: number; lengthYM: number; lengthZM: number;
  /** Axial tension positive; first-order bending moments about centroidal principal axes. */
  axialN: number; momentYNm: number; momentZNm: number;
  elasticModulusPa: StructuralParameter; yieldStrengthPa: StructuralParameter; elasticLimitPa: StructuralParameter;
  effectiveLengthFactorY: StructuralParameter; effectiveLengthFactorZ: StructuralParameter;
  yieldReduction: StructuralParameter; eulerReduction: StructuralParameter;
}
export interface RCRectangularCheck extends StructuralCheckBase {
  kind: "rc-rectangular"; widthM: number; depthM: number; effectiveDepthM: number;
  steelAreaM2: number; demandMomentNm: number;
  concreteStrengthPa: StructuralParameter; steelYieldStrengthPa: StructuralParameter; steelElasticModulusPa: StructuralParameter;
  concreteUltimateStrain: StructuralParameter; stressBlockAlpha: StructuralParameter; stressBlockBeta: StructuralParameter;
  concreteReduction: StructuralParameter; steelReduction: StructuralParameter; momentReduction: StructuralParameter;
  minimumTensileStrain: StructuralParameter;
}
export interface FootingContactCheck extends StructuralCheckBase {
  kind: "footing-contact"; widthXM: number; lengthYM: number;
  /** Compression positive. Generalized moments increase pressure toward +y/+x respectively. */
  verticalN: number; momentXNm: number; momentYNm: number; allowableBearingPa: StructuralParameter;
}
export interface BoltGroupCheck extends StructuralCheckBase {
  kind: "bolt-group"; shearXN: number; shearYN: number;
  /** Positive counterclockwise generalized shear moment about the bolt-group centroid. */
  momentZNm: number;
  bolts: { id: string; xM: number; yM: number; shearCapacityN: StructuralParameter }[];
}
export type StructuralDesignCheck = SteelElasticCheck | RCRectangularCheck | FootingContactCheck | BoltGroupCheck;
export interface StructuralDesignInput { version: 1; checks: StructuralDesignCheck[] }
export interface StructuralCriterionResult {
  id: string; name: string; demand: number; capacity: number; unit: "Pa" | "N" | "Nm" | "1";
  relation: "at-most" | "at-least"; utilization: number; satisfiesUserCriteria: boolean;
}
export interface StructuralBoltDemand {
  id: string; xRelativeM: number; yRelativeM: number; shearXN: number; shearYN: number; resultantN: number; utilization: number;
}
export interface StructuralDesignResult {
  id: string; kind: StructuralDesignCheck["kind"];
  status: "within-user-criteria" | "exceeds-user-criteria" | "unsupported";
  metrics: Record<string, number | null>; criteria: StructuralCriterionResult[];
  details: string[]; assumptions: string[]; excludedChecks: string[]; bolts?: StructuralBoltDemand[];
}
export interface StructuralDesignReport {
  version: 1; method: string; verification: "unverified"; compliance: "not-assessed";
  source: StructuralDesignInput; basis: EngineeringDesignBasis; basisIssues: string[];
  results: StructuralDesignResult[]; warnings: string[];
}

const METHOD = "Explicit-user-criteria structural screening v1";
const commonFields = ["id", "kind", "label", "inputSource", "loadCase"];
const steelNumbers = ["areaM2", "inertiaYM4", "inertiaZM4", "sectionModulusYM3", "sectionModulusZM3", "lengthYM", "lengthZM", "axialN", "momentYNm", "momentZNm"];
const steelParameters = ["elasticModulusPa", "yieldStrengthPa", "elasticLimitPa", "effectiveLengthFactorY", "effectiveLengthFactorZ", "yieldReduction", "eulerReduction"];
const rcNumbers = ["widthM", "depthM", "effectiveDepthM", "steelAreaM2", "demandMomentNm"];
const rcParameters = ["concreteStrengthPa", "steelYieldStrengthPa", "steelElasticModulusPa", "concreteUltimateStrain", "stressBlockAlpha", "stressBlockBeta", "concreteReduction", "steelReduction", "momentReduction", "minimumTensileStrain"];
const metricKeys: Record<StructuralDesignCheck["kind"], string[]> = {
  "steel-elastic": ["axialStressPa", "biaxialStressUpperBoundPa", "yieldAllowableStressPa", "radiusYM", "radiusZM", "slendernessY", "slendernessZ", "eulerLoadYN", "eulerLoadZN", "eulerCriticalStressPa", "eulerScreeningCapacityN", "compressionDemandN"],
  "rc-rectangular": ["neutralAxisDepthM", "stressBlockDepthM", "steelTensileStrain", "steelStressPa", "compressionForceN", "tensionForceN", "relativeForceResidual", "sectionMomentNm", "reducedMomentCapacityNm"],
  "footing-contact": ["areaM2", "eccentricityXM", "eccentricityYM", "kernInteraction", "footprintInteractionX", "footprintInteractionY", "pressureNegativeXNegativeYPa", "pressureNegativeXPositiveYPa", "pressurePositiveXNegativeYPa", "pressurePositiveXPositiveYPa", "minimumPressurePa", "maximumPressurePa"],
  "bolt-group": ["centroidXM", "centroidYM", "polarSumM2", "maximumBoltShearN", "maximumUtilization", "forceResidualXN", "forceResidualYN", "momentResidualNm"],
};
function fields(raw: Record<string, unknown>, allowed: string[], path: string): void {
  const unknown = Object.keys(raw).find(key => !allowed.includes(key));
  if (unknown) throw new Error(`${path}.${unknown} is unsupported.`);
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (!engineeringRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
}
function text(value: unknown, path: string, maximum: number, empty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${path} requires bounded text.`);
  return value;
}
function id(value: unknown, path: string): string {
  if (!identifier(value) || !value.trim()) throw new Error(`${path} requires an identifier of 1-100 characters.`);
  return value;
}
function parameter(value: unknown, unit: StructuralParameter["unit"], path: string, min = 1e-12, max = 1e13): StructuralParameter {
  const raw = record(value, path);
  fields(raw, ["value", "unit", "source", "criterionId", "standardId", "clause"], path);
  if (raw.unit !== unit) throw new Error(`${path}.unit must be ${unit}.`);
  const result: StructuralParameter = { value: requireFinite(raw.value, `${path}.value`, min, max), unit, source: text(raw.source, `${path}.source`, 2000) };
  if (raw.criterionId !== undefined) result.criterionId = id(raw.criterionId, `${path}.criterionId`);
  if (raw.standardId !== undefined) result.standardId = id(raw.standardId, `${path}.standardId`);
  if (raw.clause !== undefined) result.clause = text(raw.clause, `${path}.clause`, 200);
  if (Boolean(result.standardId) !== Boolean(result.clause)) throw new Error(`${path} must supply both standardId and clause.`);
  return result;
}
function base(raw: Record<string, unknown>): StructuralCheckBase {
  return { id: id(raw.id, "check.id"), label: text(raw.label, "check.label", 200), inputSource: text(raw.inputSource, "check.inputSource", 4000), loadCase: text(raw.loadCase, "check.loadCase", 200) };
}

/** Strict SI parser. Values are copied into allowlisted records; unsupported checks are rejected. */
export function parseStructuralDesignInput(value: unknown): StructuralDesignInput {
  const raw = record(value, "Structural input");
  fields(raw, ["version", "checks"], "input");
  if (raw.version !== 1 || !Array.isArray(raw.checks) || !raw.checks.length || raw.checks.length > 100) throw new Error("Structural input requires version 1 and 1-100 checks.");
  const ids = new Set<string>();
  const checks = raw.checks.map((entry, index): StructuralDesignCheck => {
    const item = record(entry, `checks[${index}]`), common = base(item);
    if (ids.has(common.id)) throw new Error("Structural check identifiers must be unique.");
    ids.add(common.id);
    const number = (key: string, min: number, max: number) => requireFinite(item[key], `${common.id}.${key}`, min, max);
    const p = (key: string, unit: StructuralParameter["unit"], min = 1e-12, max = 1e13) => parameter(item[key], unit, `${common.id}.${key}`, min, max);
    if (item.kind === "steel-elastic") {
      fields(item, [...commonFields, ...steelNumbers, ...steelParameters], common.id);
      const check: SteelElasticCheck = {
        ...common, kind: "steel-elastic", areaM2: number("areaM2", 1e-8, 1e4), inertiaYM4: number("inertiaYM4", 1e-14, 1e6), inertiaZM4: number("inertiaZM4", 1e-14, 1e6),
        sectionModulusYM3: number("sectionModulusYM3", 1e-12, 1e6), sectionModulusZM3: number("sectionModulusZM3", 1e-12, 1e6), lengthYM: number("lengthYM", 1e-4, 1e5), lengthZM: number("lengthZM", 1e-4, 1e5),
        axialN: number("axialN", -1e12, 1e12), momentYNm: number("momentYNm", -1e12, 1e12), momentZNm: number("momentZNm", -1e12, 1e12),
        elasticModulusPa: p("elasticModulusPa", "Pa", 1e3), yieldStrengthPa: p("yieldStrengthPa", "Pa", 1e3), elasticLimitPa: p("elasticLimitPa", "Pa", 1e3),
        effectiveLengthFactorY: p("effectiveLengthFactorY", "1", 1e-3, 100), effectiveLengthFactorZ: p("effectiveLengthFactorZ", "1", 1e-3, 100), yieldReduction: p("yieldReduction", "1", 1e-6, 1), eulerReduction: p("eulerReduction", "1", 1e-6, 1),
      };
      if (check.elasticLimitPa.value > check.yieldStrengthPa.value || check.yieldStrengthPa.value > check.elasticModulusPa.value) throw new Error(`${common.id}: require elastic limit <= yield strength <= elastic modulus.`);
      return check;
    }
    if (item.kind === "rc-rectangular") {
      fields(item, [...commonFields, ...rcNumbers, ...rcParameters], common.id);
      const check: RCRectangularCheck = {
        ...common, kind: "rc-rectangular", widthM: number("widthM", 1e-3, 1e3), depthM: number("depthM", 1e-3, 1e3), effectiveDepthM: number("effectiveDepthM", 1e-3, 1e3), steelAreaM2: number("steelAreaM2", 1e-10, 1e4), demandMomentNm: number("demandMomentNm", 0, 1e12),
        concreteStrengthPa: p("concreteStrengthPa", "Pa", 1e3), steelYieldStrengthPa: p("steelYieldStrengthPa", "Pa", 1e3), steelElasticModulusPa: p("steelElasticModulusPa", "Pa", 1e3),
        concreteUltimateStrain: p("concreteUltimateStrain", "1", 1e-6, 0.05), stressBlockAlpha: p("stressBlockAlpha", "1", 1e-6, 1), stressBlockBeta: p("stressBlockBeta", "1", 1e-6, 1),
        concreteReduction: p("concreteReduction", "1", 1e-6, 1), steelReduction: p("steelReduction", "1", 1e-6, 1), momentReduction: p("momentReduction", "1", 1e-6, 1), minimumTensileStrain: p("minimumTensileStrain", "1", 1e-6, 0.1),
      };
      if (check.effectiveDepthM >= check.depthM || check.steelAreaM2 >= check.widthM * check.depthM) throw new Error(`${common.id}: effective depth must be less than section depth and reinforcement area less than gross area.`);
      if (check.steelYieldStrengthPa.value > check.steelElasticModulusPa.value) throw new Error(`${common.id}: steel yield strength must not exceed elastic modulus.`);
      return check;
    }
    if (item.kind === "footing-contact") {
      fields(item, [...commonFields, "widthXM", "lengthYM", "verticalN", "momentXNm", "momentYNm", "allowableBearingPa"], common.id);
      return { ...common, kind: "footing-contact", widthXM: number("widthXM", 1e-3, 1e4), lengthYM: number("lengthYM", 1e-3, 1e4), verticalN: number("verticalN", -1e12, 1e12), momentXNm: number("momentXNm", -1e12, 1e12), momentYNm: number("momentYNm", -1e12, 1e12), allowableBearingPa: p("allowableBearingPa", "Pa", 1e-3) };
    }
    if (item.kind === "bolt-group") {
      fields(item, [...commonFields, "shearXN", "shearYN", "momentZNm", "bolts"], common.id);
      if (!Array.isArray(item.bolts) || !item.bolts.length || item.bolts.length > 100) throw new Error(`${common.id}: bolt group requires 1-100 bolts.`);
      const boltIds = new Set<string>(), positions = new Set<string>();
      const bolts = item.bolts.map((entry, i) => {
        const bolt = record(entry, `${common.id}.bolts[${i}]`);
        fields(bolt, ["id", "xM", "yM", "shearCapacityN"], "bolt");
        const boltId = id(bolt.id, "bolt.id"), xM = requireFinite(bolt.xM, "bolt.xM", -1e4, 1e4), yM = requireFinite(bolt.yM, "bolt.yM", -1e4, 1e4), position = `${xM},${yM}`;
        if (boltIds.has(boltId) || positions.has(position)) throw new Error(`${common.id}: bolt IDs and positions must be unique.`);
        boltIds.add(boltId); positions.add(position);
        return { id: boltId, xM, yM, shearCapacityN: parameter(bolt.shearCapacityN, "N", `${common.id}.${boltId}.shearCapacityN`, 1e-6, 1e12) };
      });
      return { ...common, kind: "bolt-group", shearXN: number("shearXN", -1e12, 1e12), shearYN: number("shearYN", -1e12, 1e12), momentZNm: number("momentZNm", -1e12, 1e12), bolts };
    }
    throw new Error(`${common.id}: structural check kind is unsupported.`);
  });
  return { version: 1, checks };
}

function parameters(check: StructuralDesignCheck): [string, StructuralParameter][] {
  if (check.kind === "steel-elastic") return steelParameters.map((key): [string, StructuralParameter] => [key, check[key as keyof SteelElasticCheck] as StructuralParameter]);
  if (check.kind === "rc-rectangular") return rcParameters.map((key): [string, StructuralParameter] => [key, check[key as keyof RCRectangularCheck] as StructuralParameter]);
  if (check.kind === "footing-contact") return [["allowableBearingPa", check.allowableBearingPa]];
  return check.bolts.map((bolt): [string, StructuralParameter] => [`${bolt.id}.shearCapacityN`, bolt.shearCapacityN]);
}
function checkTraceability(source: StructuralDesignInput, basis: EngineeringDesignBasis): void {
  const standardIds = new Set(basis.standards.map(standard => standard.id)), criterionIds = new Set<string>();
  for (const criterion of basis.criteria) {
    if (criterionIds.has(criterion.id)) throw new Error("Basis criterion IDs must be unique before calculation.");
    criterionIds.add(criterion.id);
  }
  if (standardIds.size !== basis.standards.length) throw new Error("Basis standard IDs must be unique before calculation.");
  for (const check of source.checks) for (const [name, supplied] of parameters(check)) {
    if (supplied.standardId) {
      const standard = basis.standards.find(item => item.id === supplied.standardId);
      if (!standard || !basis.countryCode || !standard.code.trim() || !standard.edition.trim() || !standard.adoptionReference.trim() || !standard.amendments.trim() || !isEngineeringSourceUrl(standard.sourceUrl)) throw new Error(`${check.id}.${name}: referenced standard requires an adopted country, code, edition, local adoption, amendments declaration and publisher source.`);
      const reference = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === standard.id);
      if (reference && (reference.countryCode !== basis.countryCode || reference.code !== standard.code || reference.domain !== standard.domain || !reference.editions.includes(standard.edition) || reference.sourceUrl !== standard.sourceUrl)) throw new Error(`${check.id}.${name}: referenced catalog standard does not match the selected country, edition or publisher; other editions require a custom adopted reference.`);
    }
    if (supplied.criterionId) {
      const criterion = basis.criteria.find(item => item.id === supplied.criterionId);
      if (!criterion || criterion.module !== "frame" || criterion.value !== supplied.value || criterion.unit !== supplied.unit || criterion.source !== supplied.source || criterion.standardId !== supplied.standardId || criterion.clause !== supplied.clause) throw new Error(`${check.id}.${name}: supplied parameter does not exactly match the referenced frame criterion.`);
    }
  }
}
function criterion(id: string, name: string, demand: number, capacity: number, unit: StructuralCriterionResult["unit"], relation: StructuralCriterionResult["relation"] = "at-most"): StructuralCriterionResult {
  if (!Number.isFinite(demand) || !Number.isFinite(capacity) || demand < 0 || capacity <= 0) throw new Error("Structural criterion is non-finite or has invalid demand/capacity.");
  const utilization = relation === "at-most" ? demand / capacity : capacity / demand;
  if (!Number.isFinite(utilization)) throw new Error("Structural utilization overflowed.");
  return { id, name, demand, capacity, unit, relation, utilization, satisfiesUserCriteria: utilization <= 1 };
}
function result(check: StructuralDesignCheck, metrics: StructuralDesignResult["metrics"], criteria: StructuralCriterionResult[], details: string[], assumptions: string[], excludedChecks: string[], unsupported = false): StructuralDesignResult {
  if (Object.values(metrics).some(value => value !== null && !Number.isFinite(value))) throw new Error(`${check.id}: structural calculation overflowed.`);
  return { id: check.id, kind: check.kind, status: unsupported ? "unsupported" : criteria.every(item => item.satisfiesUserCriteria) ? "within-user-criteria" : "exceeds-user-criteria", metrics, criteria, details, assumptions, excludedChecks };
}
function steel(check: SteelElasticCheck): StructuralDesignResult {
  const p = (key: keyof SteelElasticCheck) => (check[key] as StructuralParameter).value;
  const axialStressPa = check.axialN / check.areaM2;
  // Conservative bound valid even where the separate extreme-fiber maxima are not coincident.
  const biaxialStressUpperBoundPa = Math.abs(axialStressPa) + Math.abs(check.momentYNm) / check.sectionModulusYM3 + Math.abs(check.momentZNm) / check.sectionModulusZM3;
  const yieldAllowableStressPa = p("yieldStrengthPa") * p("yieldReduction"), radiusYM = Math.sqrt(check.inertiaYM4 / check.areaM2), radiusZM = Math.sqrt(check.inertiaZM4 / check.areaM2);
  const slendernessY = p("effectiveLengthFactorY") * check.lengthYM / radiusYM, slendernessZ = p("effectiveLengthFactorZ") * check.lengthZM / radiusZM;
  const eulerLoadYN = Math.PI ** 2 * p("elasticModulusPa") * check.inertiaYM4 / (p("effectiveLengthFactorY") * check.lengthYM) ** 2;
  const eulerLoadZN = Math.PI ** 2 * p("elasticModulusPa") * check.inertiaZM4 / (p("effectiveLengthFactorZ") * check.lengthZM) ** 2;
  const eulerCriticalStressPa = Math.min(eulerLoadYN, eulerLoadZN) / check.areaM2, eulerScreeningCapacityN = Math.min(eulerLoadYN, eulerLoadZN) * p("eulerReduction"), compressionDemandN = Math.max(0, -check.axialN);
  const elasticApplicable = eulerCriticalStressPa <= p("elasticLimitPa");
  const criteria = [criterion("gross-yield", "First-order gross elastic normal-stress bound", biaxialStressUpperBoundPa, yieldAllowableStressPa, "Pa")];
  if (compressionDemandN > 0 && elasticApplicable) criteria.push(criterion("euler-screen", "Reduced ideal elastic flexural-buckling screen", compressionDemandN, eulerScreeningCapacityN, "N"));
  const details = ["Euler capacity is an ideal elastic screening quantity, not a national-code column resistance."];
  if (compressionDemandN > 0 && !elasticApplicable) details.push("Governing ideal Euler stress exceeds the supplied elastic/proportional limit; inelastic buckling is unsupported and the compression check cannot pass.");
  if (compressionDemandN > 0 && (check.momentYNm !== 0 || check.momentZNm !== 0)) details.push("Compression with bending requires a separate validated beam-column interaction and second-order analysis; this result remains unsupported for member acceptance.");
  return result(check, { axialStressPa, biaxialStressUpperBoundPa, yieldAllowableStressPa, radiusYM, radiusZM, slendernessY, slendernessZ, eulerLoadYN, eulerLoadZN, eulerCriticalStressPa, eulerScreeningCapacityN, compressionDemandN }, criteria, details,
    ["Homogeneous gross section with supplied centroidal principal-axis section properties.", "Lengths, effective-length factors and reductions are supplied project criteria.", "First-order force/moment demands are supplied with their load-case provenance."],
    ["Inelastic, local, torsional and flexural-torsional buckling", "Lateral-torsional buckling", "Second-order moments and code beam-column interaction", "Shear, torsion, net-section rupture, fatigue, connections and serviceability"], compressionDemandN > 0 && (!elasticApplicable || check.momentYNm !== 0 || check.momentZNm !== 0));
}
function reinforcedConcrete(check: RCRectangularCheck): StructuralDesignResult {
  const p = (key: keyof RCRectangularCheck) => (check[key] as StructuralParameter).value;
  const concreteStress = p("stressBlockAlpha") * p("concreteStrengthPa") * p("concreteReduction"), steelLimit = p("steelYieldStrengthPa") * p("steelReduction");
  const force = (c: number) => {
    const strain = p("concreteUltimateStrain") * (check.effectiveDepthM - c) / c;
    const steelStress = Math.min(steelLimit, p("steelElasticModulusPa") * strain);
    const compression = concreteStress * check.widthM * p("stressBlockBeta") * c, tension = check.steelAreaM2 * steelStress;
    return { strain, steelStress, compression, tension, residual: compression - tension };
  };
  let low = check.effectiveDepthM * 1e-12, high = check.effectiveDepthM;
  if (force(low).residual >= 0 || force(high).residual <= 0) throw new Error(`${check.id}: RC neutral axis is outside the supported singly reinforced equilibrium range.`);
  for (let iteration = 0; iteration < 100; iteration++) { const mid = (low + high) / 2; if (force(mid).residual > 0) high = mid; else low = mid; }
  const neutralAxisDepthM = (low + high) / 2, equilibrium = force(neutralAxisDepthM), stressBlockDepthM = p("stressBlockBeta") * neutralAxisDepthM;
  const relativeForceResidual = Math.abs(equilibrium.residual) / Math.max(1, equilibrium.compression, equilibrium.tension);
  if (relativeForceResidual > 1e-9 || stressBlockDepthM > check.depthM) throw new Error(`${check.id}: RC force equilibrium failed or stress block exceeds the section.`);
  const sectionMomentNm = equilibrium.compression * (check.effectiveDepthM - stressBlockDepthM / 2), reducedMomentCapacityNm = sectionMomentNm * p("momentReduction");
  return result(check, { neutralAxisDepthM, stressBlockDepthM, steelTensileStrain: equilibrium.strain, steelStressPa: equilibrium.steelStress, compressionForceN: equilibrium.compression, tensionForceN: equilibrium.tension, relativeForceResidual, sectionMomentNm, reducedMomentCapacityNm },
    [criterion("section-flexure", "Reduced section moment resistance", check.demandMomentNm, reducedMomentCapacityNm, "Nm"), criterion("tensile-strain", "Supplied minimum tensile-strain screen", equilibrium.strain, p("minimumTensileStrain"), "1", "at-least")],
    ["Rectangular-block coefficients, compression strain and all material/moment reductions come from the supplied references; no ductility-dependent national factor is selected automatically."],
    ["Single bonded tension reinforcement layer, rectangular section, zero axial force and the declared bending direction.", "Plane sections remain plane; concrete tension is neglected.", "Steel is elastic-perfectly-plastic with the supplied reduced yield limit; concrete uses the supplied equivalent rectangular block."],
    ["Axial force, compression reinforcement, prestress and non-rectangular sections", "Minimum/maximum reinforcement and national ductility classifications", "Shear, torsion, anchorage, development, bond, detailing, cracking, deflection, fatigue and fire"]);
}
function footing(check: FootingContactCheck): StructuralDesignResult {
  const areaM2 = check.widthXM * check.lengthYM;
  const empty: StructuralDesignResult["metrics"] = { areaM2, eccentricityXM: null, eccentricityYM: null, kernInteraction: null, footprintInteractionX: null, footprintInteractionY: null, pressureNegativeXNegativeYPa: null, pressureNegativeXPositiveYPa: null, pressurePositiveXNegativeYPa: null, pressurePositiveXPositiveYPa: null, minimumPressurePa: null, maximumPressurePa: null };
  const assumptions = ["Rigid rectangular footing and a linear full-contact bearing-pressure distribution.", "Vertical load includes all supplied permanent weights and signed vertical actions; compression is positive.", "Generalized positive Mx increases pressure at +y and positive My at +x. Translate global reaction signs explicitly before input.", "Allowable bearing pressure is a supplied gross-pressure limit consistent with the declared load case; no soil resistance is inferred."];
  const excluded = ["Compression-only partial-contact redistribution and soil nonlinear response", "Sliding and a prescribed overturning safety factor", "Soil bearing-capacity derivation, settlement, liquefaction and global stability", "Footing reinforcement, flexure, punching and one-way shear"];
  if (check.verticalN <= 0) return result(check, empty, [], ["No positive net compressive resultant: uplift or zero-load contact cannot be assessed by the full-contact method."], assumptions, excluded, true);
  const eccentricityXM = check.momentYNm / check.verticalN, eccentricityYM = check.momentXNm / check.verticalN;
  const kernInteraction = 6 * Math.abs(eccentricityXM) / check.widthXM + 6 * Math.abs(eccentricityYM) / check.lengthYM;
  const footprintInteractionX = 2 * Math.abs(eccentricityXM) / check.widthXM, footprintInteractionY = 2 * Math.abs(eccentricityYM) / check.lengthYM;
  const average = check.verticalN / areaM2, xIncrement = 6 * check.momentYNm / (areaM2 * check.widthXM), yIncrement = 6 * check.momentXNm / (areaM2 * check.lengthYM);
  const pressures = [average - xIncrement - yIncrement, average - xIncrement + yIncrement, average + xIncrement - yIncrement, average + xIncrement + yIncrement];
  const minimumPressurePa = Math.min(...pressures), maximumPressurePa = Math.max(...pressures), fullContact = minimumPressurePa >= 0;
  const metrics = { areaM2, eccentricityXM, eccentricityYM, kernInteraction, footprintInteractionX, footprintInteractionY, pressureNegativeXNegativeYPa: pressures[0], pressureNegativeXPositiveYPa: pressures[1], pressurePositiveXNegativeYPa: pressures[2], pressurePositiveXPositiveYPa: pressures[3], minimumPressurePa, maximumPressurePa };
  const details = fullContact ? ["All four linear corner pressures are nonnegative; the full-contact bearing comparison is applicable."] : ["The hypothetical full-contact distribution contains tension. Corner pressures are diagnostic only; compression-only redistribution is required and no bearing acceptance is issued."];
  if (footprintInteractionX >= 1 || footprintInteractionY >= 1) details.push("The resultant is on or outside a footprint edge: overturning/static compression-only equilibrium is unsupported.");
  return result(check, metrics, fullContact ? [criterion("gross-bearing", "Maximum gross full-contact bearing pressure", maximumPressurePa, check.allowableBearingPa.value, "Pa")] : [], details, assumptions, excluded, !fullContact);
}
function boltGroup(check: BoltGroupCheck): StructuralDesignResult {
  const n = check.bolts.length, centroidXM = check.bolts.reduce((sum, bolt) => sum + bolt.xM, 0) / n, centroidYM = check.bolts.reduce((sum, bolt) => sum + bolt.yM, 0) / n;
  const positions = check.bolts.map(bolt => ({ x: bolt.xM - centroidXM, y: bolt.yM - centroidYM })), polarSumM2 = positions.reduce((sum, point) => sum + point.x ** 2 + point.y ** 2, 0);
  const assumptions = ["Rigid plate with identical bolt shear stiffness; all bolts participate elastically without slip.", "Shear moment is supplied about the geometric centroid, positive counterclockwise; eccentric force moment must be included by the author.", "Supplied per-bolt shear capacities already include the intended project reductions; capacity differences do not imply unequal stiffness."];
  const excluded = ["Bolt tension, prying, out-of-plane moments and shear/tension interaction", "Slip resistance, plate bearing, tearout, block shear and welds", "Unequal bolt stiffness, plastic redistribution, fatigue, detailing and installation"];
  if (check.momentZNm !== 0 && polarSumM2 < 1e-16) return result(check, { centroidXM, centroidYM, polarSumM2, maximumBoltShearN: null, maximumUtilization: null, forceResidualXN: null, forceResidualYN: null, momentResidualNm: null }, [], ["The bolt pattern cannot develop the supplied moment about its centroid."], assumptions, excluded, true);
  const bolts = check.bolts.map((bolt, i): StructuralBoltDemand => {
    const arm = positions[i], twist = check.momentZNm === 0 ? 0 : check.momentZNm / polarSumM2;
    const shearXN = check.shearXN / n - twist * arm.y, shearYN = check.shearYN / n + twist * arm.x, resultantN = Math.hypot(shearXN, shearYN);
    return { id: bolt.id, xRelativeM: arm.x, yRelativeM: arm.y, shearXN, shearYN, resultantN, utilization: resultantN / bolt.shearCapacityN.value };
  });
  const criteria = bolts.map((bolt, i) => criterion(check.bolts[i].id, `Bolt ${bolt.id}: supplied shear capacity`, bolt.resultantN, check.bolts[i].shearCapacityN.value, "N"));
  const forceResidualXN = bolts.reduce((sum, bolt) => sum + bolt.shearXN, 0) - check.shearXN, forceResidualYN = bolts.reduce((sum, bolt) => sum + bolt.shearYN, 0) - check.shearYN;
  const momentResidualNm = bolts.reduce((sum, bolt) => sum + bolt.xRelativeM * bolt.shearYN - bolt.yRelativeM * bolt.shearXN, 0) - check.momentZNm;
  const forceScale = Math.max(1, Math.abs(check.shearXN), Math.abs(check.shearYN), ...bolts.map(bolt => bolt.resultantN));
  const momentScale = Math.max(1, Math.abs(check.momentZNm), ...bolts.map(bolt => Math.hypot(bolt.xRelativeM, bolt.yRelativeM) * bolt.resultantN));
  if (Math.max(Math.abs(forceResidualXN), Math.abs(forceResidualYN)) / forceScale > 1e-8 || Math.abs(momentResidualNm) / momentScale > 1e-8) throw new Error(`${check.id}: bolt-group equilibrium residual exceeds tolerance.`);
  return { ...result(check, { centroidXM, centroidYM, polarSumM2, maximumBoltShearN: Math.max(...bolts.map(bolt => bolt.resultantN)), maximumUtilization: Math.max(...bolts.map(bolt => bolt.utilization)), forceResidualXN, forceResidualYN, momentResidualNm }, criteria, ["Direct shear and tangential moment shear are added as vectors for each bolt."], assumptions, excluded), bolts };
}

/** Calculations assess only explicitly supplied criteria, never whole-code compliance. */
export function analyzeStructuralDesign(input: StructuralDesignInput, designBasis: EngineeringDesignBasis): StructuralDesignReport {
  const source = parseStructuralDesignInput(input), basis = parseEngineeringDesignBasis(designBasis);
  checkTraceability(source, basis);
  const results = source.checks.map(check => check.kind === "steel-elastic" ? steel(check) : check.kind === "rc-rectangular" ? reinforcedConcrete(check) : check.kind === "footing-contact" ? footing(check) : boltGroup(check));
  return { version: 1, method: METHOD, verification: "unverified", compliance: "not-assessed", source, basis, basisIssues: validateEngineeringDesignBasis(basis), results,
    warnings: ["Source was inspected only; numerical behavior, TypeScript compilation and independent benchmark acceptance remain unverified.", "Country, adopted editions and clause references are captured metadata. No national-code rule set, load combinations or design coefficients are inferred.", "A within-user-criteria result covers only the listed checks and assumptions; it does not approve a complete member, foundation or connection."] };
}

function textList(value: unknown, path: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${path} must be a bounded text array.`);
  return value.map((entry, i) => text(entry, `${path}[${i}]`, 4000));
}
/** Checks source algebra and stored RC equilibrium at its saved neutral axis; never solves an equilibrium or runs an analyzer. */
function validateSavedAlgebra(check: StructuralDesignCheck, item: Record<string, unknown>, metrics: Record<string, unknown>): void {
  const metric = (key: string, expected: number | null) => {
    if (metrics[key] !== expected || (expected !== null && !Number.isFinite(expected))) throw new Error(`Saved ${check.id}.${key} differs from source or saved-result algebra.`);
  };
  const tie = (criterionId: string, demand: number, capacity: number) => {
    const assessed = (item.criteria as Record<string, unknown>[]).find(entry => entry.id === criterionId);
    if (!assessed || assessed.demand !== demand || assessed.capacity !== capacity) throw new Error(`Saved ${check.id}.${criterionId} differs from its supplied demand or recorded capacity.`);
    const utilization = assessed.relation === "at-most" ? demand / capacity : capacity / demand;
    if (!Number.isFinite(utilization) || assessed.utilization !== utilization || assessed.satisfiesUserCriteria !== (utilization <= 1)) throw new Error(`Saved ${check.id}.${criterionId} has an inconsistent utilization or status.`);
  };
  if (check.kind === "steel-elastic") {
    const axialStressPa = check.axialN / check.areaM2;
    const stress = Math.abs(axialStressPa) + Math.abs(check.momentYNm) / check.sectionModulusYM3 + Math.abs(check.momentZNm) / check.sectionModulusZM3;
    const allowable = check.yieldStrengthPa.value * check.yieldReduction.value;
    const radiusY = Math.sqrt(check.inertiaYM4 / check.areaM2), radiusZ = Math.sqrt(check.inertiaZM4 / check.areaM2);
    const slenderY = check.effectiveLengthFactorY.value * check.lengthYM / radiusY, slenderZ = check.effectiveLengthFactorZ.value * check.lengthZM / radiusZ;
    const eulerY = Math.PI ** 2 * check.elasticModulusPa.value * check.inertiaYM4 / (check.effectiveLengthFactorY.value * check.lengthYM) ** 2;
    const eulerZ = Math.PI ** 2 * check.elasticModulusPa.value * check.inertiaZM4 / (check.effectiveLengthFactorZ.value * check.lengthZM) ** 2;
    const critical = Math.min(eulerY, eulerZ) / check.areaM2, eulerCapacity = Math.min(eulerY, eulerZ) * check.eulerReduction.value, compression = Math.max(0, -check.axialN);
    const expected = { axialStressPa, biaxialStressUpperBoundPa: stress, yieldAllowableStressPa: allowable, radiusYM: radiusY, radiusZM: radiusZ,
      slendernessY: slenderY, slendernessZ: slenderZ, eulerLoadYN: eulerY, eulerLoadZN: eulerZ, eulerCriticalStressPa: critical, eulerScreeningCapacityN: eulerCapacity, compressionDemandN: compression };
    for (const [key, value] of Object.entries(expected)) metric(key, value);
    tie("gross-yield", stress, allowable);
    if (compression > 0 && critical <= check.elasticLimitPa.value) tie("euler-screen", compression, eulerCapacity);
    return;
  }
  if (check.kind === "rc-rectangular") {
    const c = requireFinite(metrics.neutralAxisDepthM, "Saved RC neutral axis", Number.MIN_VALUE, check.effectiveDepthM);
    if (c >= check.effectiveDepthM) throw new Error("Saved RC neutral axis must be strictly above the tension reinforcement.");
    const strain = check.concreteUltimateStrain.value * (check.effectiveDepthM - c) / c;
    const steelStress = Math.min(check.steelYieldStrengthPa.value * check.steelReduction.value, check.steelElasticModulusPa.value * strain);
    const blockDepth = check.stressBlockBeta.value * c;
    const concreteStress = check.stressBlockAlpha.value * check.concreteStrengthPa.value * check.concreteReduction.value;
    const compression = concreteStress * check.widthM * check.stressBlockBeta.value * c, tension = check.steelAreaM2 * steelStress;
    const residual = Math.abs(compression - tension) / Math.max(1, compression, tension);
    const sectionMoment = compression * (check.effectiveDepthM - blockDepth / 2), capacity = sectionMoment * check.momentReduction.value;
    if (residual > 1e-9 || blockDepth > check.depthM || !Number.isFinite(residual)) throw new Error("Saved RC force equilibrium or block geometry is inconsistent.");
    const expected = { stressBlockDepthM: blockDepth, steelTensileStrain: strain, steelStressPa: steelStress, compressionForceN: compression, tensionForceN: tension,
      relativeForceResidual: residual, sectionMomentNm: sectionMoment, reducedMomentCapacityNm: capacity };
    for (const [key, value] of Object.entries(expected)) metric(key, value);
    tie("section-flexure", check.demandMomentNm, capacity); tie("tensile-strain", strain, check.minimumTensileStrain.value);
    return;
  }
  if (check.kind === "footing-contact") {
    const area = check.widthXM * check.lengthYM;
    metric("areaM2", area);
    if (check.verticalN <= 0) {
      for (const key of metricKeys[check.kind]) if (key !== "areaM2") metric(key, null);
      return;
    }
    const ex = check.momentYNm / check.verticalN, ey = check.momentXNm / check.verticalN;
    const average = check.verticalN / area, xIncrement = 6 * check.momentYNm / (area * check.widthXM), yIncrement = 6 * check.momentXNm / (area * check.lengthYM);
    const pressures = [average - xIncrement - yIncrement, average - xIncrement + yIncrement, average + xIncrement - yIncrement, average + xIncrement + yIncrement];
    const minimum = Math.min(...pressures), maximum = Math.max(...pressures);
    const expected = { eccentricityXM: ex, eccentricityYM: ey, kernInteraction: 6 * Math.abs(ex) / check.widthXM + 6 * Math.abs(ey) / check.lengthYM,
      footprintInteractionX: 2 * Math.abs(ex) / check.widthXM, footprintInteractionY: 2 * Math.abs(ey) / check.lengthYM,
      pressureNegativeXNegativeYPa: pressures[0], pressureNegativeXPositiveYPa: pressures[1], pressurePositiveXNegativeYPa: pressures[2], pressurePositiveXPositiveYPa: pressures[3], minimumPressurePa: minimum, maximumPressurePa: maximum };
    for (const [key, value] of Object.entries(expected)) metric(key, value);
    if (minimum >= 0) tie("gross-bearing", maximum, check.allowableBearingPa.value);
    return;
  }
  const count = check.bolts.length, centroidX = check.bolts.reduce((sum, bolt) => sum + bolt.xM, 0) / count, centroidY = check.bolts.reduce((sum, bolt) => sum + bolt.yM, 0) / count;
  const positions = check.bolts.map(bolt => ({ x: bolt.xM - centroidX, y: bolt.yM - centroidY })), polar = positions.reduce((sum, point) => sum + point.x ** 2 + point.y ** 2, 0);
  metric("centroidXM", centroidX); metric("centroidYM", centroidY); metric("polarSumM2", polar);
  if (check.momentZNm !== 0 && polar < 1e-16) {
    for (const key of metricKeys[check.kind]) if (!["centroidXM", "centroidYM", "polarSumM2"].includes(key)) metric(key, null);
    return;
  }
  const bolts = item.bolts as Record<string, unknown>[], expectedBolts = check.bolts.map((bolt, index) => {
    const position = positions[index], twist = check.momentZNm === 0 ? 0 : check.momentZNm / polar;
    const fx = check.shearXN / count - twist * position.y, fy = check.shearYN / count + twist * position.x, resultant = Math.hypot(fx, fy), utilization = resultant / bolt.shearCapacityN.value;
    const expected = { xRelativeM: position.x, yRelativeM: position.y, shearXN: fx, shearYN: fy, resultantN: resultant, utilization };
    for (const [key, value] of Object.entries(expected)) if (bolts[index][key] !== value || !Number.isFinite(value)) throw new Error("Saved bolt demand differs from its supplied geometry and centroidal shear actions.");
    tie(bolt.id, resultant, bolt.shearCapacityN.value);
    return expected;
  });
  const residualX = expectedBolts.reduce((sum, bolt) => sum + bolt.shearXN, 0) - check.shearXN, residualY = expectedBolts.reduce((sum, bolt) => sum + bolt.shearYN, 0) - check.shearYN;
  const momentResidual = expectedBolts.reduce((sum, bolt) => sum + bolt.xRelativeM * bolt.shearYN - bolt.yRelativeM * bolt.shearXN, 0) - check.momentZNm;
  const forceScale = Math.max(1, Math.abs(check.shearXN), Math.abs(check.shearYN), ...expectedBolts.map(bolt => bolt.resultantN));
  const momentScale = Math.max(1, Math.abs(check.momentZNm), ...expectedBolts.map(bolt => Math.hypot(bolt.xRelativeM, bolt.yRelativeM) * bolt.resultantN));
  if (Math.max(Math.abs(residualX), Math.abs(residualY)) / forceScale > 1e-8 || Math.abs(momentResidual) / momentScale > 1e-8) throw new Error("Saved bolt-group equilibrium differs from supplied actions.");
  metric("maximumBoltShearN", Math.max(...expectedBolts.map(bolt => bolt.resultantN))); metric("maximumUtilization", Math.max(...expectedBolts.map(bolt => bolt.utilization)));
  metric("forceResidualXN", residualX); metric("forceResidualYN", residualY); metric("momentResidualNm", momentResidual);
}
/** Restore-only validation: checks shape, references, captured inputs and saved arithmetic without invoking an analyzer or neutral-axis solve. */
export function validateStructuralDesignReport(value: unknown, input: StructuralDesignInput, designBasis: EngineeringDesignBasis): value is StructuralDesignReport {
  try {
    const raw = record(value, "Structural report"), source = parseStructuralDesignInput(input), basis = parseEngineeringDesignBasis(designBasis);
    fields(raw, ["version", "method", "verification", "compliance", "source", "basis", "basisIssues", "results", "warnings"], "report");
    if (raw.version !== 1 || raw.method !== METHOD || raw.verification !== "unverified" || raw.compliance !== "not-assessed") return false;
    if (JSON.stringify(parseStructuralDesignInput(raw.source)) !== JSON.stringify(source) || engineeringBasisFingerprint(parseEngineeringDesignBasis(raw.basis)) !== engineeringBasisFingerprint(basis)) return false;
    checkTraceability(source, basis); textList(raw.basisIssues, "basisIssues", 512); textList(raw.warnings, "warnings", 100);
    if (!Array.isArray(raw.results) || raw.results.length !== source.checks.length) return false;
    for (let i = 0; i < source.checks.length; i++) {
      const check = source.checks[i], item = record(raw.results[i], "result");
      fields(item, ["id", "kind", "status", "metrics", "criteria", "details", "assumptions", "excludedChecks", "bolts"], "result");
      if (item.id !== check.id || item.kind !== check.kind || !["within-user-criteria", "exceeds-user-criteria", "unsupported"].includes(String(item.status))) return false;
      const metrics = record(item.metrics, "metrics"), keys = metricKeys[check.kind];
      fields(metrics, keys, "metrics");
      if (Object.keys(metrics).length !== keys.length || keys.some(key => metrics[key] !== null && !finiteNumber(metrics[key]))) return false;
      textList(item.details, "details", 30); textList(item.assumptions, "assumptions", 30); textList(item.excludedChecks, "excludedChecks", 40);
      if (!Array.isArray(item.criteria) || item.criteria.length > 100) return false;
      const criterionIds = new Set<string>();
      for (const entry of item.criteria) {
        const assessed = record(entry, "criterionResult"); fields(assessed, ["id", "name", "demand", "capacity", "unit", "relation", "utilization", "satisfiesUserCriteria"], "criterionResult");
        const criterionId = id(assessed.id, "criterionResult.id");
        if (criterionIds.has(criterionId)) return false; criterionIds.add(criterionId);
        text(assessed.name, "criterionResult.name", 400);
        requireFinite(assessed.demand, "demand", 0); requireFinite(assessed.capacity, "capacity", Number.MIN_VALUE); requireFinite(assessed.utilization, "utilization", 0);
        if (!["Pa", "N", "Nm", "1"].includes(String(assessed.unit)) || !["at-most", "at-least"].includes(String(assessed.relation)) || typeof assessed.satisfiesUserCriteria !== "boolean") return false;
        const expectedUtilization = assessed.relation === "at-most" ? Number(assessed.demand) / Number(assessed.capacity) : Number(assessed.capacity) / Number(assessed.demand);
        if (!Number.isFinite(expectedUtilization) || assessed.utilization !== expectedUtilization || assessed.satisfiesUserCriteria !== (expectedUtilization <= 1)) return false;
      }
      const elasticScreenApplicable = check.kind === "steel-elastic" && finiteNumber(metrics.eulerCriticalStressPa) && metrics.eulerCriticalStressPa <= check.elasticLimitPa.value;
      const expectedIds = check.kind === "steel-elastic" ? ["gross-yield", ...(check.axialN < 0 && elasticScreenApplicable ? ["euler-screen"] : [])] : check.kind === "rc-rectangular" ? ["section-flexure", "tensile-strain"] : check.kind === "footing-contact" ? item.status === "unsupported" ? [] : ["gross-bearing"] : item.status === "unsupported" ? [] : check.bolts.map(bolt => bolt.id);
      if (criterionIds.size !== expectedIds.length || expectedIds.some(expected => !criterionIds.has(expected))) return false;
      for (const entry of item.criteria) {
        const assessed = entry as Record<string, unknown>;
        const expectedUnit = check.kind === "steel-elastic" ? assessed.id === "gross-yield" ? "Pa" : "N" : check.kind === "rc-rectangular" ? assessed.id === "section-flexure" ? "Nm" : "1" : check.kind === "footing-contact" ? "Pa" : "N";
        if (assessed.unit !== expectedUnit || assessed.relation !== (assessed.id === "tensile-strain" && check.kind === "rc-rectangular" ? "at-least" : "at-most")) return false;
      }
      if (item.status === "within-user-criteria" && (!item.criteria.length || item.criteria.some(entry => !(entry as Record<string, unknown>).satisfiesUserCriteria))) return false;
      if (item.status === "exceeds-user-criteria" && !item.criteria.some(entry => !(entry as Record<string, unknown>).satisfiesUserCriteria)) return false;
      if (item.status !== "unsupported" && Object.values(metrics).some(entry => entry === null)) return false;
      if (check.kind === "rc-rectangular" && item.status === "unsupported") return false;
      if (check.kind === "steel-elastic") {
        const unsupported = check.axialN < 0 && (!elasticScreenApplicable || check.momentYNm !== 0 || check.momentZNm !== 0);
        if ((item.status === "unsupported") !== unsupported || Object.entries(metrics).some(([key, entry]) => key !== "axialStressPa" && (!finiteNumber(entry) || entry < 0))) return false;
      }
      if (check.kind === "rc-rectangular" && (Object.values(metrics).some(entry => !finiteNumber(entry) || entry < 0) || !finiteNumber(metrics.relativeForceResidual) || metrics.relativeForceResidual > 1e-9)) return false;
      if (check.kind === "footing-contact") {
        if (check.verticalN <= 0 && (item.status !== "unsupported" || Object.entries(metrics).some(([key, entry]) => key !== "areaM2" && entry !== null))) return false;
        if (check.verticalN > 0 && (!finiteNumber(metrics.minimumPressurePa) || !finiteNumber(metrics.maximumPressurePa) || (item.status === "unsupported") !== (metrics.minimumPressurePa < 0))) return false;
      }
      if (check.kind === "bolt-group" && (item.status === "unsupported") !== (check.momentZNm !== 0 && finiteNumber(metrics.polarSumM2) && metrics.polarSumM2 < 1e-16)) return false;
      if (item.bolts !== undefined) {
        if (check.kind !== "bolt-group" || item.status === "unsupported" || !Array.isArray(item.bolts) || item.bolts.length !== check.bolts.length) return false;
        for (let j = 0; j < check.bolts.length; j++) {
          const bolt = record(item.bolts[j], "boltDemand"); fields(bolt, ["id", "xRelativeM", "yRelativeM", "shearXN", "shearYN", "resultantN", "utilization"], "boltDemand");
          if (bolt.id !== check.bolts[j].id) return false;
          for (const key of ["xRelativeM", "yRelativeM", "shearXN", "shearYN"]) requireFinite(bolt[key], key);
          for (const key of ["resultantN", "utilization"]) requireFinite(bolt[key], key, 0);
        }
      } else if (check.kind === "bolt-group" && item.status !== "unsupported") return false;
      validateSavedAlgebra(check, item, metrics);
    }
    return true;
  } catch { return false; }
}

/** Illustrative values are user criteria for this example only, never a national-code preset. */
export function structuralDesignExample(): StructuralDesignInput {
  const supplied = (value: number, unit: StructuralParameter["unit"], note: string): StructuralParameter => ({ value, unit, source: `Educational example only: ${note}; replace with reviewed project criterion.` });
  const common = { inputSource: "Illustrative SI geometry and first-order demand; replace with project geometry and a declared load combination.", loadCase: "illustrative-user-case" };
  return { version: 1, checks: [
    { ...common, id: "steel-1", label: "Gross steel stress and ideal column screen", kind: "steel-elastic", areaM2: 0.01, inertiaYM4: 0.00008, inertiaZM4: 0.00004, sectionModulusYM3: 0.0008, sectionModulusZM3: 0.0004, lengthYM: 6, lengthZM: 6, axialN: -200000, momentYNm: 0, momentZNm: 0,
      elasticModulusPa: supplied(2e11, "Pa", "elastic modulus"), yieldStrengthPa: supplied(2.5e8, "Pa", "yield strength"), elasticLimitPa: supplied(1.5e8, "Pa", "elastic limit"), effectiveLengthFactorY: supplied(1, "1", "declared effective length factor"), effectiveLengthFactorZ: supplied(1, "1", "declared effective length factor"), yieldReduction: supplied(0.6, "1", "explicit stress reduction"), eulerReduction: supplied(0.5, "1", "explicit Euler screening reduction") },
    { ...common, id: "rc-1", label: "Singly reinforced rectangular section", kind: "rc-rectangular", widthM: 0.3, depthM: 0.6, effectiveDepthM: 0.54, steelAreaM2: 0.0015, demandMomentNm: 180000,
      concreteStrengthPa: supplied(3e7, "Pa", "concrete strength"), steelYieldStrengthPa: supplied(5e8, "Pa", "reinforcement yield strength"), steelElasticModulusPa: supplied(2e11, "Pa", "reinforcement modulus"), concreteUltimateStrain: supplied(0.003, "1", "declared extreme compression strain"), stressBlockAlpha: supplied(0.8, "1", "declared rectangular block intensity"), stressBlockBeta: supplied(0.8, "1", "declared block depth coefficient"), concreteReduction: supplied(0.7, "1", "explicit concrete reduction"), steelReduction: supplied(0.85, "1", "explicit steel reduction"), momentReduction: supplied(0.9, "1", "explicit moment reduction"), minimumTensileStrain: supplied(0.004, "1", "declared minimum tensile strain") },
    { ...common, id: "footing-1", label: "Rigid full-contact bearing pressure", kind: "footing-contact", widthXM: 3, lengthYM: 4, verticalN: 1200000, momentXNm: 120000, momentYNm: 100000, allowableBearingPa: supplied(2e5, "Pa", "gross bearing pressure limit") },
    { ...common, id: "bolts-1", label: "Equal-stiffness planar bolt group", kind: "bolt-group", shearXN: 10000, shearYN: 60000, momentZNm: 6000, bolts: [
      { id: "b1", xM: -0.1, yM: -0.1, shearCapacityN: supplied(40000, "N", "per-bolt shear capacity") }, { id: "b2", xM: 0.1, yM: -0.1, shearCapacityN: supplied(40000, "N", "per-bolt shear capacity") },
      { id: "b3", xM: -0.1, yM: 0.1, shearCapacityN: supplied(40000, "N", "per-bolt shear capacity") }, { id: "b4", xM: 0.1, yM: 0.1, shearCapacityN: supplied(40000, "N", "per-bolt shear capacity") },
    ] },
  ] };
}
