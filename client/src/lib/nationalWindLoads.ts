import { ENGINEERING_STANDARD_REFERENCES, engineeringBasisFingerprint, parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis } from "./engineeringBasis";
import { engineeringRecord, identifier } from "./engineeringNumerics";

/** Every number is authored in SI units. Sources and reviews are declarations, not verification. */
export interface NationalWindQuantity<U extends string> {
  value: number; unit: U; source: string; standardId?: string; clause?: string; criterionId?: string;
}
export interface NationalWindSurface {
  id: string; label: string; application: "overall-surface" | "local-component";
  area: NationalWindQuantity<"m2">; externalCoefficient: NationalWindQuantity<"1">; internalCoefficient: NationalWindQuantity<"1">;
  inwardNormal: { value: [number, number, number]; unit: "1"; coordinateSystem: "global-XYZ"; source: string };
}
export interface NationalWindPressureInput {
  id: string; label: string; height: NationalWindQuantity<"m">; coefficientUse: "overall" | "local";
  k1: NationalWindQuantity<"1">; k2: NationalWindQuantity<"1">; k3: NationalWindQuantity<"1">; k4: NationalWindQuantity<"1">;
  Kd: NationalWindQuantity<"1">; Ka: NationalWindQuantity<"1">; Kc: NationalWindQuantity<"1">;
  factorSelectionSource: string; factorSelectionConfirmed: boolean; surfaces: NationalWindSurface[];
}
export interface NationalWindInput {
  version: 1; method: "in-is875-3-2015-authored"; site: string; basicSpeed: NationalWindQuantity<"m/s">;
  review: {
    reviewer: string; source: string; confirmed: boolean; amendment1: "2016"; amendment2: "2020";
    additionalAmendmentsReconciled: boolean; amendedMapConfirmed: boolean;
    mapReference: "nbc-2016-part6-section1-figure1" | "is875-amendment2-2020-annexA";
  };
  scope: {
    height: NationalWindQuantity<"m">; minimumLateralDimension: NationalWindQuantity<"m">; firstModeFrequency: NationalWindQuantity<"Hz">;
    ordinaryBuilding: boolean; completedBuilding: boolean; onshore: boolean; specialStructure: boolean;
    unusualGeometryOrEnvironment: boolean; torsionRequiresSeparateAssessment: boolean;
    dynamicRequired: boolean; interferenceRequired: boolean; cycloneRegion: boolean;
    source: string; reviewConfirmed: boolean;
  };
  pressures: NationalWindPressureInput[];
}
export interface NationalWindSurfaceResult {
  id: string; application: "overall-surface" | "local-component"; netCoefficient: number; netPressurePa: number; forceN: number;
  globalPressurePa: [number, number, number]; globalForceN: [number, number, number];
}
export interface NationalWindPressureResult {
  id: string; coefficientUse: "overall" | "local"; factorReferenceHeightM: number; designSpeedMps: number;
  windPressurePa: number; reducedPressurePa: number; minimumPressurePa: number; designPressurePa: number;
  minimumPressureGoverns: boolean; surfaces: NationalWindSurfaceResult[];
}
export interface NationalWindReport {
  version: 1; implementation: "IS875-3-2015-authored-static-pressure-v1"; verification: "unverified"; compliance: "not-assessed";
  source: NationalWindInput; basis: EngineeringDesignBasis; status: "assessed-subset" | "unsupported-basis" | "unsupported-scope";
  basisIssues: string[]; scopeIssues: string[]; implementedClauses: string[]; results: NationalWindPressureResult[]; warnings: string[];
}

const IMPLEMENTATION = "IS875-3-2015-authored-static-pressure-v1";
const CLAUSES = ["6.3 authored design wind speed", "7.2 pressure and minimum pressure", "7.2 note 2 / 7.2.1 directionality restrictions", "7.3.1 authored signed surface action"];
const WIND_ID = "in-is875-3", NBC_ID = "in-nbc";
const PRESSURE_KEYS = ["id", "label", "height", "coefficientUse", "k1", "k2", "k3", "k4", "Kd", "Ka", "Kc", "factorSelectionSource", "factorSelectionConfirmed", "surfaces"];
const SCOPE_KEYS = ["height", "minimumLateralDimension", "firstModeFrequency", "ordinaryBuilding", "completedBuilding", "onshore", "specialStructure", "unusualGeometryOrEnvironment", "torsionRequiresSeparateAssessment", "dynamicRequired", "interferenceRequired", "cycloneRegion", "source", "reviewConfirmed"];
function record(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (!engineeringRecord(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${name} is not an object or contains unsupported fields.`);
  return value;
}
function text(value: unknown, name: string, maximum = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${name} requires bounded non-empty text.`);
  return value;
}
function id(value: unknown, name: string): string { if (!identifier(value) || !value.trim()) throw new Error(`${name} requires a valid identifier.`); return value; }
function boolean(value: unknown, name: string): boolean { if (typeof value !== "boolean") throw new Error(`${name} must be an explicit boolean.`); return value; }
function number(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${name} must be finite between ${minimum} and ${maximum}.`);
  return value;
}
function list(value: unknown, name: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${name} must contain at most ${maximum} entries.`);
  for (let index = 0; index < value.length; index++) if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error(`${name} cannot contain sparse entries.`);
  return value;
}
function quantity<U extends string>(value: unknown, unit: U, name: string, minimum: number, maximum: number): NationalWindQuantity<U> {
  const raw = record(value, ["value", "unit", "source", "standardId", "clause", "criterionId"], name);
  if (raw.unit !== unit) throw new Error(`${name}.unit must be ${unit}; no implicit unit conversion is performed.`);
  if ((raw.standardId === undefined) !== (raw.clause === undefined)) throw new Error(`${name}: a standard ID and clause must be supplied together.`);
  return { value: number(raw.value, `${name}.value`, minimum, maximum), unit, source: text(raw.source, `${name}.source`),
    ...(raw.standardId === undefined ? {} : { standardId: id(raw.standardId, `${name}.standardId`), clause: text(raw.clause, `${name}.clause`, 200) }),
    ...(raw.criterionId === undefined ? {} : { criterionId: id(raw.criterionId, `${name}.criterionId`) }) };
}
function surface(value: unknown, usedIds: Set<string>, coefficientUse: "overall" | "local"): NationalWindSurface {
  const raw = record(value, ["id", "label", "application", "area", "externalCoefficient", "internalCoefficient", "inwardNormal"], "Surface"), surfaceId = id(raw.id, "surface.id");
  if (usedIds.has(surfaceId)) throw new Error("Pressure and surface identifiers must be unique throughout the input."); usedIds.add(surfaceId);
  const application = coefficientUse === "local" ? "local-component" : "overall-surface";
  if (raw.application !== application) throw new Error("Surface application must agree with local or overall coefficient use; local coefficients cannot represent whole-frame action.");
  const normal = record(raw.inwardNormal, ["value", "unit", "coordinateSystem", "source"], "inwardNormal");
  if (normal.unit !== "1" || normal.coordinateSystem !== "global-XYZ" || !Array.isArray(normal.value) || normal.value.length !== 3) throw new Error("Declare an inward unit normal in global XYZ coordinates.");
  const vector: [number, number, number] = [number(normal.value[0], "normal.x", -1, 1), number(normal.value[1], "normal.y", -1, 1), number(normal.value[2], "normal.z", -1, 1)];
  if (Math.abs(Math.hypot(...vector) - 1) > 1e-10) throw new Error("The surface normal must have unit length; it is not silently normalized.");
  return { id: surfaceId, label: text(raw.label, "surface.label", 200), application, area: quantity(raw.area, "m2", "surface.area", 1e-8, 1e6),
    externalCoefficient: quantity(raw.externalCoefficient, "1", "externalCoefficient", -20, 20), internalCoefficient: quantity(raw.internalCoefficient, "1", "internalCoefficient", -20, 20),
    inwardNormal: { value: vector, unit: "1", coordinateSystem: "global-XYZ", source: text(normal.source, "normal.source") } };
}

/** Strict shape and numerical bounds only. Unconfirmed/out-of-scope declarations receive no result. */
export function parseNationalWindInput(value: unknown): NationalWindInput {
  const raw = record(value, ["version", "method", "site", "basicSpeed", "review", "scope", "pressures"], "Wind input");
  if (raw.version !== 1 || raw.method !== "in-is875-3-2015-authored") throw new Error("Only version 1 authored IS 875 (Part 3):2015 wind pressure inputs are supported.");
  const review = record(raw.review, ["reviewer", "source", "confirmed", "amendment1", "amendment2", "additionalAmendmentsReconciled", "amendedMapConfirmed", "mapReference"], "review");
  if (review.amendment1 !== "2016" || review.amendment2 !== "2020") throw new Error("Declare the inspected 2016 and 2020 amendment scope explicitly.");
  if (review.mapReference !== "nbc-2016-part6-section1-figure1" && review.mapReference !== "is875-amendment2-2020-annexA") throw new Error("Use the amended NBC 2016 Figure 1 reference or Amendment 2:2020 Annex A, not the deleted original map.");
  const scope = record(raw.scope, SCOPE_KEYS, "scope");
  const usedIds = new Set<string>();
  const pressures = list(raw.pressures, "pressures", 40).map((value): NationalWindPressureInput => {
    const item = record(value, PRESSURE_KEYS, "Pressure"), pressureId = id(item.id, "pressure.id");
    if (usedIds.has(pressureId)) throw new Error("Pressure and surface identifiers must be unique throughout the input."); usedIds.add(pressureId);
    if (item.coefficientUse !== "overall" && item.coefficientUse !== "local") throw new Error("coefficientUse must explicitly be overall or local.");
    const coefficientUse = item.coefficientUse;
    return { id: pressureId, label: text(item.label, "pressure.label", 200), coefficientUse, height: quantity(item.height, "m", "pressure.height", 0, 1e4),
      k1: quantity(item.k1, "1", "k1", 0.01, 10), k2: quantity(item.k2, "1", "k2", 0.01, 10), k3: quantity(item.k3, "1", "k3", 1, 1.36), k4: quantity(item.k4, "1", "k4", 1, 10),
      Kd: quantity(item.Kd, "1", "Kd", 0.9, 1), Ka: quantity(item.Ka, "1", "Ka", 0.8, 1), Kc: quantity(item.Kc, "1", "Kc", 1, 1),
      factorSelectionSource: text(item.factorSelectionSource, "factorSelectionSource", 4000), factorSelectionConfirmed: boolean(item.factorSelectionConfirmed, "factorSelectionConfirmed"),
      surfaces: list(item.surfaces, "surfaces", 40).map(entry => surface(entry, usedIds, coefficientUse)) };
  });
  if (!pressures.length || pressures.reduce((sum, item) => sum + item.surfaces.length, 0) > 200) throw new Error("Supply 1-40 pressure rows and at most 200 surfaces in total.");
  return { version: 1, method: "in-is875-3-2015-authored", site: text(raw.site, "site", 500), basicSpeed: quantity(raw.basicSpeed, "m/s", "basicSpeed", 0.01, 200),
    review: { reviewer: text(review.reviewer, "review.reviewer", 500), source: text(review.source, "review.source", 4000), confirmed: boolean(review.confirmed, "review.confirmed"), amendment1: "2016", amendment2: "2020",
      additionalAmendmentsReconciled: boolean(review.additionalAmendmentsReconciled, "additionalAmendmentsReconciled"), amendedMapConfirmed: boolean(review.amendedMapConfirmed, "amendedMapConfirmed"), mapReference: review.mapReference },
    scope: { height: quantity(scope.height, "m", "scope.height", 0.01, 1e4), minimumLateralDimension: quantity(scope.minimumLateralDimension, "m", "minimumLateralDimension", 0.01, 1e4), firstModeFrequency: quantity(scope.firstModeFrequency, "Hz", "firstModeFrequency", 1e-6, 1e4),
      ordinaryBuilding: boolean(scope.ordinaryBuilding, "ordinaryBuilding"), completedBuilding: boolean(scope.completedBuilding, "completedBuilding"), onshore: boolean(scope.onshore, "onshore"), specialStructure: boolean(scope.specialStructure, "specialStructure"),
      unusualGeometryOrEnvironment: boolean(scope.unusualGeometryOrEnvironment, "unusualGeometryOrEnvironment"), torsionRequiresSeparateAssessment: boolean(scope.torsionRequiresSeparateAssessment, "torsionRequiresSeparateAssessment"),
      dynamicRequired: boolean(scope.dynamicRequired, "dynamicRequired"), interferenceRequired: boolean(scope.interferenceRequired, "interferenceRequired"), cycloneRegion: boolean(scope.cycloneRegion, "cycloneRegion"), source: text(scope.source, "scope.source", 4000), reviewConfirmed: boolean(scope.reviewConfirmed, "scope.reviewConfirmed") }, pressures };
}

function quantities(source: NationalWindInput): NationalWindQuantity<string>[] {
  return [source.basicSpeed, source.scope.height, source.scope.minimumLateralDimension, source.scope.firstModeFrequency,
    ...source.pressures.flatMap(item => [item.height, item.k1, item.k2, item.k3, item.k4, item.Kd, item.Ka, item.Kc, ...item.surfaces.flatMap(entry => [entry.area, entry.externalCoefficient, entry.internalCoefficient])])];
}
/** Metadata gates; duplicate references never resolve by taking the first candidate. */
function basisIssues(source: NationalWindInput, basis: EngineeringDesignBasis): string[] {
  const issues = validateEngineeringDesignBasis(basis);
  if (basis.countryCode !== "IN") issues.push("Only the explicitly adopted Indian wind subset is implemented. Other countries never receive Indian coefficients.");
  for (const [standardId, edition] of [[WIND_ID, "2015"], [NBC_ID, "2016"]] as const) {
    const catalog = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === standardId);
    const matches = basis.standards.filter(item => item.id === standardId || item.code === catalog?.code);
    if (!catalog || matches.length !== 1) { issues.push(`Adopt exactly one ${standardId} catalog reference; ambiguous or missing adoption is unsupported.`); continue; }
    const adopted = matches[0];
    if (adopted.id !== catalog.id || adopted.code !== catalog.code || adopted.domain !== catalog.domain || adopted.edition !== edition || adopted.sourceUrl !== catalog.sourceUrl) issues.push(`${standardId}: code, domain, edition and publisher must match the supported Indian catalog entry.`);
    if (standardId === WIND_ID && (!adopted.amendments.includes("2016") || !adopted.amendments.includes("2020"))) issues.push("The adopted wind reference must declare review of Amendments 1:2016 and 2:2020.");
  }
  if (!source.review.confirmed || source.review.reviewer !== basis.reviewer) issues.push("The basis reviewer must explicitly confirm the authored wind inputs and amendment/map review.");
  if (!source.review.additionalAmendmentsReconciled || !source.review.amendedMapConfirmed) issues.push("Review the amended hazard reference and reconcile all locally applicable amendments against this implemented formula subset.");
  const expectedBasicStandard = source.review.mapReference === "nbc-2016-part6-section1-figure1" ? NBC_ID : WIND_ID;
  if (source.basicSpeed.standardId !== expectedBasicStandard || !source.basicSpeed.clause) issues.push("The basic wind speed must identify the adopted amended NBC map or 2020 Annex A reference and its exact clause/location.");
  for (const item of quantities(source)) {
    if (item.standardId) {
      const adopted = basis.standards.filter(entry => entry.id === item.standardId);
      if (adopted.length !== 1) issues.push(`Quantity source references ${item.standardId} ambiguously or outside the adopted basis.`);
    }
    if (item.criterionId) {
      const candidates = basis.criteria.filter(entry => entry.id === item.criterionId), criterion = candidates[0];
      if (candidates.length !== 1 || !criterion || criterion.module !== "frame" || criterion.value !== item.value || criterion.unit !== item.unit || criterion.source !== item.source || criterion.standardId !== item.standardId || criterion.clause !== item.clause) issues.push(`Quantity criterion ${item.criterionId} must match one captured frame criterion, including value, unit and source/reference.`);
    }
  }
  for (const row of source.pressures) {
    if (!row.factorSelectionConfirmed) issues.push(`${row.id}: a reviewed source must confirm factor and surface-coefficient selection for this height, area, direction and intended application.`);
    for (const item of [row.k1, row.k2, row.k3, row.k4, row.Kd, row.Ka, row.Kc, ...row.surfaces.flatMap(entry => [entry.externalCoefficient, entry.internalCoefficient])]) {
      if (item.standardId !== WIND_ID || !item.clause) issues.push(`${row.id}: every authored wind factor/coefficient must cite the adopted wind reference and an exact clause/table/row selection.`);
    }
  }
  const unique = [...new Set(issues)];
  return unique.length <= 512 ? unique : [...unique.slice(0, 511), "Additional adoption/input-reference issues were omitted after the bounded 511-detail limit. Correct these declarations and reassess to reveal the remaining issues."];
}
function scopeIssues(source: NationalWindInput): string[] {
  const issues: string[] = [], scope = source.scope;
  if (!scope.reviewConfirmed) issues.push("Record an explicit sourced review of static applicability, dynamic effects, interference, cyclone status and torsion.");
  if (!scope.ordinaryBuilding || !scope.completedBuilding || !scope.onshore || scope.specialStructure || scope.unusualGeometryOrEnvironment || scope.torsionRequiresSeparateAssessment) issues.push("This subset supports completed, ordinary onshore buildings only, without special/unusual geometry, environment or unresolved torsional assessment.");
  if (scope.height.value >= 20) issues.push("This implementation is deliberately limited to buildings below 20 m. This is a product scope bound, not a general BIS static-method height limit.");
  if (scope.height.value / scope.minimumLateralDimension.value > 5 || scope.firstModeFrequency.value < 1 || scope.dynamicRequired) issues.push("Dynamic wind investigation is required or declared; gust, modal and across-wind procedures are outside this static-pressure subset.");
  if (scope.interferenceRequired) issues.push("Interference treatment is required; no shielding or interference factor is automatically generated or accepted by this subset.");
  for (const row of source.pressures) {
    if (row.height.value > scope.height.value) issues.push(`${row.id}: pressure height exceeds the declared building height above mean ground level.`);
    if ((scope.cycloneRegion || row.coefficientUse === "local") && row.Kd.value !== 1) issues.push(`${row.id}: cyclone regions and local-pressure coefficients require Kd=1.`);
  }
  return issues;
}
const WARNINGS = [
  "Source inspection only: compilation, numerical behavior and independent wind benchmarks have not been executed. Verification remains unverified and national-code compliance is not assessed.",
  "Only authored IS 875 (Part 3):2015 speed/pressure and signed surface-action arithmetic is implemented. Factor and coefficient selection, site hazard lookup, terrain interpolation, area interpolation, internal pressure/enclosure classification and local adoption are reviewed external inputs.",
  "Amendment 2:2020 deletes the original wind map and references NBC 2016 Part 6/Section 1 Figure 1; the amended Annex A is the other declared hazard reference. No city speed or map value is embedded.",
  "Kc is restricted to exactly 1. The narrowly conditioned Kc=0.90 envelope reduction in clause 7.3.3.13 and the optional sub-10 m framing-pressure reduction are not implemented.",
  "For authored heights below 10 m, the k2 input must reflect the reviewed 10 m reference under clause 6.3. The factorReferenceHeightM output states this reference; k2 is never interpolated or selected by the application.",
  "Positive (Cpe-Cpi) acts along the supplied inward normal; negative values act outward. Local coefficients describe local-component action only. Surface areas and normals are separately authored; no opposite-direction case, whole-frame distribution, resultant application point or structural response is inferred.",
  "Dynamic/gust and across-wind response, interference/shielding, offshore structures, special structures, construction/icing, unusual environments, automatic torsion, full wind-code design, structural resistance and combinations remain unsupported. Reviewed low-rise screening does not prove absence of dynamic effects.",
];
function pressure(row: NationalWindPressureInput, basicSpeed: number): NationalWindPressureResult {
  const designSpeedMps = basicSpeed * row.k1.value * row.k2.value * row.k3.value * row.k4.value;
  const windPressurePa = 0.6 * designSpeedMps * designSpeedMps, reducedPressurePa = row.Kd.value * row.Ka.value * row.Kc.value * windPressurePa;
  const minimumPressurePa = 0.7 * windPressurePa, designPressurePa = Math.max(reducedPressurePa, minimumPressurePa);
  const surfaces = row.surfaces.map((entry): NationalWindSurfaceResult => {
    const netCoefficient = entry.externalCoefficient.value - entry.internalCoefficient.value, netPressurePa = netCoefficient * designPressurePa, forceN = netPressurePa * entry.area.value;
    const normal = entry.inwardNormal.value;
    return { id: entry.id, application: entry.application, netCoefficient, netPressurePa, forceN,
      globalPressurePa: [netPressurePa * normal[0], netPressurePa * normal[1], netPressurePa * normal[2]], globalForceN: [forceN * normal[0], forceN * normal[1], forceN * normal[2]] };
  });
  if (![designSpeedMps, windPressurePa, reducedPressurePa, minimumPressurePa, designPressurePa, ...surfaces.flatMap(entry => [entry.netCoefficient, entry.netPressurePa, entry.forceN, ...entry.globalPressurePa, ...entry.globalForceN])].every(Number.isFinite)) throw new Error(`${row.id}: wind arithmetic is non-finite.`);
  return { id: row.id, coefficientUse: row.coefficientUse, factorReferenceHeightM: Math.max(row.height.value, 10), designSpeedMps, windPressurePa, reducedPressurePa, minimumPressurePa, designPressurePa, minimumPressureGoverns: minimumPressurePa > reducedPressurePa, surfaces };
}
/** This calculates authored pressure arithmetic only; it never invokes a structural solver. */
export function assessNationalWind(input: NationalWindInput, designBasis: EngineeringDesignBasis): NationalWindReport {
  const source = parseNationalWindInput(input), basis = parseEngineeringDesignBasis(designBasis), adoption = basisIssues(source, basis), scope = scopeIssues(source);
  const supported = !adoption.length && !scope.length;
  return { version: 1, implementation: IMPLEMENTATION, verification: "unverified", compliance: "not-assessed", source, basis,
    status: adoption.length ? "unsupported-basis" : scope.length ? "unsupported-scope" : "assessed-subset", basisIssues: adoption, scopeIssues: scope,
    implementedClauses: supported ? [...CLAUSES] : [], results: supported ? source.pressures.map(row => pressure(row, source.basicSpeed.value)) : [], warnings: [...WARNINGS] };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (engineeringRecord(value)) return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function savedTextList(value: unknown, expected: readonly string[], name: string): boolean {
  const entries = list(value, name, 512).map(entry => text(entry, name, 4000));
  return canonical(entries) === canonical(expected);
}
function strictSavedBasis(value: unknown): EngineeringDesignBasis {
  const raw = record(value, ["version", "profileVersion", "countryCode", "region", "authority", "standards", "declaration", "criteria", "confirmed", "reviewer", "reviewNote"], "Saved basis");
  record(raw.declaration, ["occupancy", "riskCategory", "structuralSystem", "material", "soil", "loads", "hazards"], "Saved basis declaration");
  list(raw.standards, "Saved standards", 40).forEach(entry => record(entry, ["id", "domain", "code", "edition", "sourceUrl", "adoptionReference", "amendments"], "Saved standard"));
  list(raw.criteria, "Saved criteria", 64).forEach(entry => record(entry, ["id", "module", "name", "value", "unit", "source", "standardId", "clause"], "Saved criterion"));
  return parseEngineeringDesignBasis(raw);
}
function vectorMatches(value: unknown, expected: readonly number[]): boolean {
  return Array.isArray(value) && value.length === 3 && [0, 1, 2].every(index => Object.prototype.hasOwnProperty.call(value, index) && typeof value[index] === "number" && Number.isFinite(value[index]) && value[index] === expected[index]);
}
/** Exact source algebra on restore: no assessment routine, factor generator or solver is called. */
function restoredPressureMatches(value: unknown, source: NationalWindPressureInput, basicSpeed: number): boolean {
  const raw = record(value, ["id", "coefficientUse", "factorReferenceHeightM", "designSpeedMps", "windPressurePa", "reducedPressurePa", "minimumPressurePa", "designPressurePa", "minimumPressureGoverns", "surfaces"], "Saved pressure");
  const speed = basicSpeed * source.k1.value * source.k2.value * source.k3.value * source.k4.value;
  const pz = 0.6 * speed * speed, reduced = source.Kd.value * source.Ka.value * source.Kc.value * pz, minimum = 0.7 * pz, pd = Math.max(reduced, minimum);
  if (raw.id !== source.id || raw.coefficientUse !== source.coefficientUse || raw.factorReferenceHeightM !== Math.max(source.height.value, 10) || raw.minimumPressureGoverns !== (minimum > reduced)) return false;
  const expected: Record<string, number> = { designSpeedMps: speed, windPressurePa: pz, reducedPressurePa: reduced, minimumPressurePa: minimum, designPressurePa: pd };
  for (const [key, value] of Object.entries(expected)) if (!Number.isFinite(value) || raw[key] !== value) return false;
  const surfaces = list(raw.surfaces, "Saved surfaces", 40);
  return surfaces.length === source.surfaces.length && surfaces.every((entry, index) => {
    const item = record(entry, ["id", "application", "netCoefficient", "netPressurePa", "forceN", "globalPressurePa", "globalForceN"], "Saved surface"), supplied = source.surfaces[index];
    const coefficient = supplied.externalCoefficient.value - supplied.internalCoefficient.value, net = coefficient * pd, force = net * supplied.area.value, normal = supplied.inwardNormal.value;
    return [coefficient, net, force].every(Number.isFinite) && item.id === supplied.id && item.application === supplied.application && item.netCoefficient === coefficient && item.netPressurePa === net && item.forceN === force
      && vectorMatches(item.globalPressurePa, normal.map(component => net * component)) && vectorMatches(item.globalForceN, normal.map(component => force * component));
  });
}
export function validateNationalWindReport(value: unknown, input: NationalWindInput, declaredBasis: EngineeringDesignBasis): value is NationalWindReport {
  try {
    const raw = record(value, ["version", "implementation", "verification", "compliance", "source", "basis", "status", "basisIssues", "scopeIssues", "implementedClauses", "results", "warnings"], "Wind report");
    if (raw.version !== 1 || raw.implementation !== IMPLEMENTATION || raw.verification !== "unverified" || raw.compliance !== "not-assessed") return false;
    const source = parseNationalWindInput(input), savedSource = parseNationalWindInput(raw.source), basis = parseEngineeringDesignBasis(declaredBasis), savedBasis = strictSavedBasis(raw.basis);
    if (canonical(source) !== canonical(savedSource) || engineeringBasisFingerprint(basis) !== engineeringBasisFingerprint(savedBasis)) return false;
    const adoption = basisIssues(source, basis), scope = scopeIssues(source), supported = !adoption.length && !scope.length;
    if (raw.status !== (adoption.length ? "unsupported-basis" : scope.length ? "unsupported-scope" : "assessed-subset") || !savedTextList(raw.basisIssues, adoption, "basisIssues") || !savedTextList(raw.scopeIssues, scope, "scopeIssues") || !savedTextList(raw.implementedClauses, supported ? CLAUSES : [], "implementedClauses") || !savedTextList(raw.warnings, WARNINGS, "warnings")) return false;
    const results = list(raw.results, "results", 40);
    return supported ? results.length === source.pressures.length && results.every((entry, index) => restoredPressureMatches(entry, source.pressures[index], source.basicSpeed.value)) : results.length === 0;
  } catch { return false; }
}

/** Illustrative numbers only. Confirmation deliberately remains false until project review. */
export function nationalWindExample(): NationalWindInput {
  const authored = <U extends string>(value: number, unit: U, source: string, clause?: string, standardId = WIND_ID): NationalWindQuantity<U> => ({ value, unit, source, ...(clause ? { standardId, clause } : {}) });
  const illustration = "Illustrative value only; replace with a sourced, reviewed project value. No site hazard or code coefficient selection is supplied.";
  return { version: 1, method: "in-is875-3-2015-authored", site: "Replace with the project site and amended hazard reference.",
    basicSpeed: authored(40, "m/s", illustration, "Part 6/Section 1 Figure 1; replace with the actual site location", NBC_ID),
    review: { reviewer: "Replace with the basis reviewer", source: "Replace with review of the 2015 edition, Amendments 1:2016 / 2:2020, NBC adoption and any additional applicable amendments.", confirmed: false, amendment1: "2016", amendment2: "2020", additionalAmendmentsReconciled: false, amendedMapConfirmed: false, mapReference: "nbc-2016-part6-section1-figure1" },
    scope: { height: authored(12, "m", illustration), minimumLateralDimension: authored(8, "m", illustration), firstModeFrequency: authored(2, "Hz", illustration), ordinaryBuilding: true, completedBuilding: true, onshore: true, specialStructure: false, unusualGeometryOrEnvironment: false, torsionRequiresSeparateAssessment: false, dynamicRequired: false, interferenceRequired: false, cycloneRegion: false, source: "Replace with the sourced geometry, modal frequency and applicability/dynamic/interference/cyclone/torsion review.", reviewConfirmed: false },
    pressures: [{ id: "wind-face", label: "Illustrative authored surface", height: authored(12, "m", illustration), coefficientUse: "overall",
      k1: authored(1, "1", illustration, "6.3.1 / Table 1; supply selected row"), k2: authored(1, "1", illustration, "6.3.2.2 / Table 2; supply reviewed height/terrain selection"), k3: authored(1, "1", illustration, "6.3.3; supply reviewed topography"), k4: authored(1, "1", illustration, "6.3.4; supply reviewed cyclone/importance selection"), Kd: authored(1, "1", illustration, "7.2.1"), Ka: authored(1, "1", illustration, "7.2.2 / Table 4; supply reviewed tributary area"), Kc: authored(1, "1", illustration, "7.3.3.13 reduction deliberately not used"), factorSelectionSource: "Replace with confirmation of each selected factor, coefficient sign/enclosure case, application and amended table row.", factorSelectionConfirmed: false,
      surfaces: [{ id: "surface-1", label: "Illustrative wall portion", application: "overall-surface", area: authored(10, "m2", illustration), externalCoefficient: authored(0.8, "1", illustration, "7.3.3.1 / amended Table 5; supply actual selected row"), internalCoefficient: authored(-0.2, "1", illustration, "7.3.2; supply actual enclosure/pressure case"), inwardNormal: { value: [1, 0, 0], unit: "1", coordinateSystem: "global-XYZ", source: "Illustrative inward direction only; replace with the project's global surface normal." } }] }] };
}
