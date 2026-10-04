import { ENGINEERING_BASIS_PROFILE_VERSION, ENGINEERING_STANDARD_REFERENCES, engineeringBasisFingerprint, isEngineeringSourceUrl, parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis, type EngineeringBasisModule } from "./engineeringBasis";
import { engineeringRecord, finiteNumber, identifier, requireFinite } from "./engineeringNumerics";

export type HvacThermalUnit = "degC" | "W/K" | "W" | "kg-water/kg-dry-air" | "J/(kg-dry-air*K)" | "J/kg-water" | "kg-dry-air/s" | "kg-dry-air/m3" | "m3/s";
export interface HvacThermalParameter<U extends HvacThermalUnit = HvacThermalUnit> {
  value: number; unit: U; source: string; criterionId?: string; standardId?: string; clause?: string;
}
export type HvacThermalFlow =
  { basis: "dry-air-mass"; dryAirMassFlowKgS: HvacThermalParameter<"kg-dry-air/s"> } |
  { basis: "actual-volume-at-outdoor-state"; volumeFlowM3S: HvacThermalParameter<"m3/s">; dryAirDensityKgM3: HvacThermalParameter<"kg-dry-air/m3"> };
export interface HvacThermalAirExchange {
  id: string; boundaryId: string; kind: "outdoor-air" | "infiltration";
  balance: "equal-dry-air-outflow-at-zone-state"; flow: HvacThermalFlow;
}
export interface HvacThermalEquipment {
  id: string; manufacturerSource: string;
  capacityBasis: "net-to-zone-at-exact-design-condition";
  simultaneousCapacitiesReviewed: true; capacityReviewSource: string;
  designConditions: {
    designConditionId: string; mode: "cooling" | "heating";
    indoorDryBulbC: number; outdoorDryBulbC: number;
    indoorHumidityRatio: number; outdoorHumidityRatio: number;
    supplyDryBulbC: number; supplyDryAirMassFlowKgS: number;
  };
  sensibleCapacityW: HvacThermalParameter<"W">;
  latentCapacityW: HvacThermalParameter<"W">;
  availableSupplyDryAirMassFlowKgS: HvacThermalParameter<"kg-dry-air/s">;
}
export interface HvacThermalZone {
  id: string; zoneId: string; label: string; mode: "cooling" | "heating"; designConditionId: string;
  inputSource: string; designConditionReviewSource: string;
  calculationBasis: "steady-state-constant-properties"; psychrometricStatesReviewed: true;
  balancedAirExchangeReviewed: true; airExchangeReviewSource: string;
  noDuplicateAirExchangeReviewed: true; gainsExcludeAirExchangeReviewed: true;
  outdoorAirHandling: "unconditioned-exchange-at-zone-boundary";
  noHeatRecovery: true; noInterzoneTransfer: true;
  systemScope: "single-zone-terminal-duty";
  auxiliaryEffectsIncludedInAuthoredGainsReviewed: true; applicabilityReviewSource: string;
  envelopeUA: HvacThermalParameter<"W/K">;
  indoorDryBulbC: HvacThermalParameter<"degC">; outdoorDryBulbC: HvacThermalParameter<"degC">;
  indoorHumidityRatio: HvacThermalParameter<"kg-water/kg-dry-air">; outdoorHumidityRatio: HvacThermalParameter<"kg-water/kg-dry-air">;
  sensibleSpecificHeat: HvacThermalParameter<"J/(kg-dry-air*K)">;
  latentHeatOfVaporization: HvacThermalParameter<"J/kg-water">;
  solarSensibleGainW: HvacThermalParameter<"W">;
  internalSensibleGainW: HvacThermalParameter<"W">; internalLatentGainW: HvacThermalParameter<"W">;
  airExchange: HvacThermalAirExchange[];
  supplyDryBulbC: HvacThermalParameter<"degC">;
  airflowRequirementId: string; airflowMappingReviewSource: string;
  minimumSupplyDryAirMassFlowKgS: HvacThermalParameter<"kg-dry-air/s">;
  equipment: HvacThermalEquipment | null;
}
export interface HvacThermalInput { version: 1; zones: HvacThermalZone[] }
export interface HvacThermalEquipmentDuty {
  equipmentId: string; authoredSensibleCapacityW: number; flowLimitedSensibleCapacityW: number;
  creditedSensibleCapacityW: number; availableLatentCapacityW: number; availableSupplyDryAirMassFlowKgS: number;
  sensibleSatisfied: boolean; latentSatisfied: boolean; airflowSatisfied: boolean; satisfiesSuppliedDuty: boolean;
  sensibleUtilization: number | null; latentUtilization: number | null; airflowUtilization: number | null;
}
export interface HvacThermalResult {
  id: string; zoneId: string; mode: "cooling" | "heating"; designConditionId: string; airflowRequirementId: string;
  status: "loads-and-airflow-only" | "within-supplied-duty" | "exceeds-supplied-duty" | "unsupported-mixed-duty";
  envelopeSensibleGainW: number; solarSensibleGainW: number; internalSensibleGainW: number; internalLatentGainW: number;
  airExchange: { id: string; boundaryId: string; kind: "outdoor-air" | "infiltration"; dryAirMassFlowKgS: number; sensibleGainW: number; moistureGainKgS: number; latentGainW: number }[];
  airExchangeDryAirMassFlowKgS: number; airExchangeSensibleGainW: number; airExchangeLatentGainW: number;
  netSensibleGainW: number; netLatentGainW: number;
  sensibleCoolingDutyW: number; sensibleHeatingDutyW: number; dehumidificationDutyW: number; humidificationDutyW: number;
  selectedModeScopeSatisfied: boolean; selectedSensibleDutyW: number | null; selectedLatentDutyW: number | null; selectedTotalDutyW: number | null;
  supplyTemperatureDifferenceK: number; requiredThermalSupplyDryAirMassFlowKgS: number | null;
  authoredMinimumSupplyDryAirMassFlowKgS: number; requiredSupplyDryAirMassFlowKgS: number | null;
  equipmentDuty: HvacThermalEquipmentDuty | null; details: string[]; excludedChecks: string[];
}
export interface HvacThermalReport {
  version: 1; implementation: "steady-state-zone-thermal-v1";
  verification: "unverified"; claim: "supplied-criteria-only"; nationalCodeCompliance: "not-assessed";
  source: HvacThermalInput; designBasis: EngineeringDesignBasis;
  status: "assessed-subset" | "partial-subset" | "unsupported-basis"; basisIssues: string[];
  nationalChecks: { countryCode: string; status: "unsupported"; checks: string[] };
  results: HvacThermalResult[]; allSuppliedEquipmentDutiesSatisfied: boolean | null; warnings: string[];
}

const IMPLEMENTATION = "steady-state-zone-thermal-v1", OUTPUT_LIMIT = 1e24;
const NATIONAL_CHECKS = ["National ventilation and minimum outdoor-air requirements", "National envelope, climate design conditions and energy-efficiency requirements", "National comfort, humidity, equipment sizing and installation requirements", "Complete selected-country mechanical-code compliance"];
const WARNINGS = [
  "Source inspection only: compilation, numerical execution and independent benchmarks remain unverified.",
  "This is a constant-property steady-state balance at one authored condition, using DOE envelope heat-transfer guidance and EnergyPlus 25.1 heat/moisture-balance relationships. It is not an EnergyPlus simulation, coincident peak calculation or national-code sizing method.",
  "Positive gains add sensible energy or moisture to the zone; negative values remove them. Cooling/dehumidification and heating/humidification demands are retained separately; opposite duties are never cancelled to produce an equipment pass.",
  "Outdoor and infiltration rows represent disjoint unconditioned dry-air inflows with equal dry-air exhaust/exfiltration at zone state. Their loads are counted once. Heat recovery, preconditioned outdoor air, interzone transfer and central mixed-air/DOAS systems are unsupported.",
  "All dry-air density, sensible specific heat, latent heat, humidity ratios, UA and gains are authored and sourced. Psychrometric feasibility, property applicability and auxiliary gains remain external reviews; no physical or national coefficient is silently supplied.",
  "The mapped supply airflow is a sensible thermal-flow requirement combined with the independently authored total terminal flow minimum. It does not demonstrate latent air delivery, ventilation compliance or duct/fan pressure performance.",
  "Optional sensible and latent capacities must be simultaneous net-to-zone capacities at the exact captured design condition and supplied flow. Sensible credit is also limited by m*cp*abs(Tzone-Tsupply); latent credit remains an externally reviewed capacity and does not prove a feasible supply humidity or control sequence.",
  "Passing supplied equipment criteria does not verify manufacturer ratings, off-design behavior, whole-system capacity, equipment certification or selected-country compliance.",
];
const EXCLUDED_CHECKS = [
  "National-code tables, ventilation rates, weather/design-day selection, sizing coefficients and compliance",
  "Coincident peaks, schedules, diversity, solar/shading calculation, radiant delay and thermal mass",
  "Envelope layer/film/bridge calculation and transient surface/zone energy balance",
  "Psychrometric saturation, dewpoint/RH conversion, property correlations and full moist-air enthalpy balance",
  "Heat recovery, conditioned outdoor air, interzone exchange, central mixed-air systems and DOAS allocation",
  "Opposite or mixed sensible/latent duties, reheat, economizer control and part-load operation",
  "Latent supply-airflow/control feasibility and humidifier/dehumidifier auxiliary effects beyond authored gains",
  "Manufacturer rating interpolation/extrapolation, seasonal efficiency, electrical power and certification",
  "Duct/fan network pressure, water-side duty, piping, controls and installation design",
  "Combining independent zone conditions into a building or shared-equipment coincident duty",
];
const ZONE_KEYS = ["id", "zoneId", "label", "mode", "designConditionId", "inputSource", "designConditionReviewSource", "calculationBasis", "psychrometricStatesReviewed", "balancedAirExchangeReviewed", "airExchangeReviewSource", "noDuplicateAirExchangeReviewed", "gainsExcludeAirExchangeReviewed", "outdoorAirHandling", "noHeatRecovery", "noInterzoneTransfer", "systemScope", "auxiliaryEffectsIncludedInAuthoredGainsReviewed", "applicabilityReviewSource", "envelopeUA", "indoorDryBulbC", "outdoorDryBulbC", "indoorHumidityRatio", "outdoorHumidityRatio", "sensibleSpecificHeat", "latentHeatOfVaporization", "solarSensibleGainW", "internalSensibleGainW", "internalLatentGainW", "airExchange", "supplyDryBulbC", "airflowRequirementId", "airflowMappingReviewSource", "minimumSupplyDryAirMassFlowKgS", "equipment"];
const RESULT_KEYS = ["id", "zoneId", "mode", "designConditionId", "airflowRequirementId", "status", "envelopeSensibleGainW", "solarSensibleGainW", "internalSensibleGainW", "internalLatentGainW", "airExchange", "airExchangeDryAirMassFlowKgS", "airExchangeSensibleGainW", "airExchangeLatentGainW", "netSensibleGainW", "netLatentGainW", "sensibleCoolingDutyW", "sensibleHeatingDutyW", "dehumidificationDutyW", "humidificationDutyW", "selectedModeScopeSatisfied", "selectedSensibleDutyW", "selectedLatentDutyW", "selectedTotalDutyW", "supplyTemperatureDifferenceK", "requiredThermalSupplyDryAirMassFlowKgS", "authoredMinimumSupplyDryAirMassFlowKgS", "requiredSupplyDryAirMassFlowKgS", "equipmentDuty", "details", "excludedChecks"];
const EQUIPMENT_DUTY_KEYS = ["equipmentId", "authoredSensibleCapacityW", "flowLimitedSensibleCapacityW", "creditedSensibleCapacityW", "availableLatentCapacityW", "availableSupplyDryAirMassFlowKgS", "sensibleSatisfied", "latentSatisfied", "airflowSatisfied", "satisfiesSuppliedDuty", "sensibleUtilization", "latentUtilization", "airflowUtilization"];
function object(value: unknown, allowed: readonly string[], path: string): Record<string, unknown> {
  if (!engineeringRecord(value)) throw new Error(`${path} must be an object.`);
  const unexpected = Object.keys(value).find(key => !allowed.includes(key)); if (unexpected) throw new Error(`${path}.${unexpected} is unsupported.`);
  return value;
}
function text(value: unknown, path: string, maximum = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${path} requires bounded non-empty text.`);
  return value;
}
function id(value: unknown, path: string): string {
  if (!identifier(value) || !value.trim()) throw new Error(`${path} requires an identifier of at most 100 characters.`); return value;
}
function array(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${path} requires a bounded array.`);
  for (let index = 0; index < value.length; index++) if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error(`${path} cannot contain sparse entries.`);
  if (Object.keys(value).some(key => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new Error(`${path} cannot contain extra fields.`);
  return value;
}
function unique(values: string[], path: string): void { if (new Set(values).size !== values.length) throw new Error(`${path} identifiers must be unique.`); }
function parameter<U extends HvacThermalUnit>(value: unknown, unit: U, path: string, minimum: number, maximum: number): HvacThermalParameter<U> {
  const raw = object(value, ["value", "unit", "source", "criterionId", "standardId", "clause"], path);
  if (raw.unit !== unit) throw new Error(`${path}.unit must be ${unit}.`);
  if ((raw.standardId === undefined) !== (raw.clause === undefined)) throw new Error(`${path} requires both an adopted standard and clause.`);
  return { value: requireFinite(raw.value, `${path}.value`, minimum, maximum), unit, source: text(raw.source, `${path}.source`, 2000),
    ...(raw.criterionId === undefined ? {} : { criterionId: id(raw.criterionId, `${path}.criterionId`) }),
    ...(raw.standardId === undefined ? {} : { standardId: id(raw.standardId, `${path}.standardId`), clause: text(raw.clause, `${path}.clause`, 200) }) };
}
function flow(value: unknown, path: string): HvacThermalFlow {
  const raw = object(value, ["basis", "dryAirMassFlowKgS", "volumeFlowM3S", "dryAirDensityKgM3"], path);
  if (raw.basis === "dry-air-mass") {
    object(raw, ["basis", "dryAirMassFlowKgS"], path);
    return { basis: "dry-air-mass", dryAirMassFlowKgS: parameter(raw.dryAirMassFlowKgS, "kg-dry-air/s", `${path}.dryAirMassFlowKgS`, 0, 1000) };
  }
  if (raw.basis !== "actual-volume-at-outdoor-state") throw new Error(`${path} must declare mass flow or actual outdoor-state volume and dry-air density.`);
  object(raw, ["basis", "volumeFlowM3S", "dryAirDensityKgM3"], path);
  return { basis: "actual-volume-at-outdoor-state", volumeFlowM3S: parameter(raw.volumeFlowM3S, "m3/s", `${path}.volumeFlowM3S`, 0, 1000), dryAirDensityKgM3: parameter(raw.dryAirDensityKgM3, "kg-dry-air/m3", `${path}.dryAirDensityKgM3`, 0.01, 10) };
}
function equipment(value: unknown, zone: Omit<HvacThermalZone, "equipment">): HvacThermalEquipment | null {
  if (value === null) return null;
  const raw = object(value, ["id", "manufacturerSource", "capacityBasis", "simultaneousCapacitiesReviewed", "capacityReviewSource", "designConditions", "sensibleCapacityW", "latentCapacityW", "availableSupplyDryAirMassFlowKgS"], "equipment");
  if (raw.capacityBasis !== "net-to-zone-at-exact-design-condition" || raw.simultaneousCapacitiesReviewed !== true) throw new Error("Equipment requires reviewed simultaneous net-to-zone capacities at the exact condition.");
  const conditions = object(raw.designConditions, ["designConditionId", "mode", "indoorDryBulbC", "outdoorDryBulbC", "indoorHumidityRatio", "outdoorHumidityRatio", "supplyDryBulbC", "supplyDryAirMassFlowKgS"], "equipment.designConditions");
  const available = parameter(raw.availableSupplyDryAirMassFlowKgS, "kg-dry-air/s", "equipment.availableSupplyDryAirMassFlowKgS", 0, 1000);
  const sensibleCapacityW = parameter(raw.sensibleCapacityW, "W", "equipment.sensibleCapacityW", 0, 1e10), latentCapacityW = parameter(raw.latentCapacityW, "W", "equipment.latentCapacityW", 0, 1e10);
  if (available.value === 0 && (sensibleCapacityW.value > 0 || latentCapacityW.value > 0)) throw new Error("A terminal's nonzero thermal capacity requires a positive declared capacity airflow; standalone non-air moisture equipment is outside this subset.");
  if (conditions.designConditionId !== zone.designConditionId || conditions.mode !== zone.mode || conditions.indoorDryBulbC !== zone.indoorDryBulbC.value || conditions.outdoorDryBulbC !== zone.outdoorDryBulbC.value || conditions.indoorHumidityRatio !== zone.indoorHumidityRatio.value || conditions.outdoorHumidityRatio !== zone.outdoorHumidityRatio.value || conditions.supplyDryBulbC !== zone.supplyDryBulbC.value || conditions.supplyDryAirMassFlowKgS !== available.value) throw new Error("Equipment design conditions must exactly match the captured zone/mode/supply state and supplied capacity airflow; no off-design adjustment is inferred.");
  return { id: id(raw.id, "equipment.id"), manufacturerSource: text(raw.manufacturerSource, "equipment.manufacturerSource"), capacityBasis: "net-to-zone-at-exact-design-condition", simultaneousCapacitiesReviewed: true, capacityReviewSource: text(raw.capacityReviewSource, "equipment.capacityReviewSource"),
    designConditions: { designConditionId: zone.designConditionId, mode: zone.mode, indoorDryBulbC: zone.indoorDryBulbC.value, outdoorDryBulbC: zone.outdoorDryBulbC.value, indoorHumidityRatio: zone.indoorHumidityRatio.value, outdoorHumidityRatio: zone.outdoorHumidityRatio.value, supplyDryBulbC: zone.supplyDryBulbC.value, supplyDryAirMassFlowKgS: available.value },
    sensibleCapacityW, latentCapacityW, availableSupplyDryAirMassFlowKgS: available };
}

/** Strict source-authored snapshot; no weather, psychrometric state, occupancy or outdoor-air rate is inferred. */
export function parseHvacThermalInput(value: unknown): HvacThermalInput {
  const raw = object(value, ["version", "zones"], "HVAC thermal input"); if (raw.version !== 1) throw new Error("HVAC thermal input requires version 1.");
  const entries = array(raw.zones, "zones", 40); if (!entries.length) throw new Error("Supply 1-40 independently authored zone/design-condition rows.");
  const zones = entries.map((entry, index): HvacThermalZone => {
    const item = object(entry, ZONE_KEYS, `zones[${index}]`);
    const declarations: [string, string | boolean][] = [["calculationBasis", "steady-state-constant-properties"], ["psychrometricStatesReviewed", true], ["balancedAirExchangeReviewed", true], ["noDuplicateAirExchangeReviewed", true], ["gainsExcludeAirExchangeReviewed", true], ["outdoorAirHandling", "unconditioned-exchange-at-zone-boundary"], ["noHeatRecovery", true], ["noInterzoneTransfer", true], ["systemScope", "single-zone-terminal-duty"], ["auxiliaryEffectsIncludedInAuthoredGainsReviewed", true]];
    for (const [key, expected] of declarations) if (item[key] !== expected) throw new Error(`zones[${index}].${key} must explicitly declare ${String(expected)}.`);
    if (item.mode !== "cooling" && item.mode !== "heating") throw new Error("Zone mode must be cooling or heating.");
    const airExchange = array(item.airExchange, "airExchange", 16).map((entryValue): HvacThermalAirExchange => {
      const air = object(entryValue, ["id", "boundaryId", "kind", "balance", "flow"], "airExchange row");
      if ((air.kind !== "outdoor-air" && air.kind !== "infiltration") || air.balance !== "equal-dry-air-outflow-at-zone-state") throw new Error("Air exchange must declare outdoor-air/infiltration and equal dry-air outflow at zone state.");
      return { id: id(air.id, "airExchange.id"), boundaryId: id(air.boundaryId, "airExchange.boundaryId"), kind: air.kind, balance: "equal-dry-air-outflow-at-zone-state", flow: flow(air.flow, "airExchange.flow") };
    });
    unique(airExchange.map(air => air.id), "airExchange rows"); unique(airExchange.map(air => air.boundaryId), "airExchange boundaries");
    const zone: Omit<HvacThermalZone, "equipment"> = {
      id: id(item.id, "zone check.id"), zoneId: id(item.zoneId, "zoneId"), label: text(item.label, "label", 200), mode: item.mode, designConditionId: id(item.designConditionId, "designConditionId"), inputSource: text(item.inputSource, "inputSource"), designConditionReviewSource: text(item.designConditionReviewSource, "designConditionReviewSource"),
      calculationBasis: "steady-state-constant-properties", psychrometricStatesReviewed: true, balancedAirExchangeReviewed: true, airExchangeReviewSource: text(item.airExchangeReviewSource, "airExchangeReviewSource"), noDuplicateAirExchangeReviewed: true, gainsExcludeAirExchangeReviewed: true, outdoorAirHandling: "unconditioned-exchange-at-zone-boundary", noHeatRecovery: true, noInterzoneTransfer: true, systemScope: "single-zone-terminal-duty", auxiliaryEffectsIncludedInAuthoredGainsReviewed: true, applicabilityReviewSource: text(item.applicabilityReviewSource, "applicabilityReviewSource"),
      envelopeUA: parameter(item.envelopeUA, "W/K", "envelopeUA", 0, 1e8), indoorDryBulbC: parameter(item.indoorDryBulbC, "degC", "indoorDryBulbC", -100, 150), outdoorDryBulbC: parameter(item.outdoorDryBulbC, "degC", "outdoorDryBulbC", -100, 150), indoorHumidityRatio: parameter(item.indoorHumidityRatio, "kg-water/kg-dry-air", "indoorHumidityRatio", 0, 0.2), outdoorHumidityRatio: parameter(item.outdoorHumidityRatio, "kg-water/kg-dry-air", "outdoorHumidityRatio", 0, 0.2),
      sensibleSpecificHeat: parameter(item.sensibleSpecificHeat, "J/(kg-dry-air*K)", "sensibleSpecificHeat", 100, 10000), latentHeatOfVaporization: parameter(item.latentHeatOfVaporization, "J/kg-water", "latentHeatOfVaporization", 1e5, 1e7), solarSensibleGainW: parameter(item.solarSensibleGainW, "W", "solarSensibleGainW", 0, 1e10), internalSensibleGainW: parameter(item.internalSensibleGainW, "W", "internalSensibleGainW", -1e10, 1e10), internalLatentGainW: parameter(item.internalLatentGainW, "W", "internalLatentGainW", -1e10, 1e10), airExchange,
      supplyDryBulbC: parameter(item.supplyDryBulbC, "degC", "supplyDryBulbC", -100, 150), airflowRequirementId: id(item.airflowRequirementId, "airflowRequirementId"), airflowMappingReviewSource: text(item.airflowMappingReviewSource, "airflowMappingReviewSource"), minimumSupplyDryAirMassFlowKgS: parameter(item.minimumSupplyDryAirMassFlowKgS, "kg-dry-air/s", "minimumSupplyDryAirMassFlowKgS", 0, 1000),
    };
    const difference = zone.mode === "cooling" ? zone.indoorDryBulbC.value - zone.supplyDryBulbC.value : zone.supplyDryBulbC.value - zone.indoorDryBulbC.value;
    if (difference < 0.01) throw new Error(`${zone.id}: supply temperature must deliver the selected sensible mode with at least 0.01 K difference; this is a numerical bound, not a comfort criterion.`);
    return { ...zone, equipment: equipment(item.equipment, zone) };
  });
  unique(zones.map(zone => zone.id), "zone checks");
  unique(zones.map(zone => JSON.stringify([zone.zoneId, zone.designConditionId, zone.mode])), "zone/design-condition/mode rows");
  unique(zones.map(zone => JSON.stringify([zone.airflowRequirementId, zone.designConditionId, zone.mode])), "terminal-flow/design-condition/mode assignments");
  unique(zones.filter(zone => zone.equipment !== null).map(zone => JSON.stringify([zone.equipment!.id, zone.designConditionId, zone.mode])), "equipment/design-condition/mode assignments");
  return { version: 1, zones };
}

function strictBasis(value: unknown): EngineeringDesignBasis {
  const raw = object(value, ["version", "profileVersion", "countryCode", "region", "authority", "standards", "declaration", "criteria", "confirmed", "reviewer", "reviewNote"], "design basis");
  object(raw.declaration, ["occupancy", "riskCategory", "structuralSystem", "material", "soil", "loads", "hazards"], "basis.declaration");
  for (const entry of array(raw.standards, "basis.standards", 40)) object(entry, ["id", "domain", "code", "edition", "sourceUrl", "adoptionReference", "amendments"], "basis.standard");
  for (const entry of array(raw.criteria, "basis.criteria", 64)) object(entry, ["id", "module", "name", "value", "unit", "source", "standardId", "clause"], "basis.criterion");
  return parseEngineeringDesignBasis(raw);
}
function parameters(zone: HvacThermalZone): { name: string; module: EngineeringBasisModule; supplied: HvacThermalParameter }[] {
  const names = ["envelopeUA", "indoorDryBulbC", "outdoorDryBulbC", "indoorHumidityRatio", "outdoorHumidityRatio", "sensibleSpecificHeat", "latentHeatOfVaporization", "solarSensibleGainW", "internalSensibleGainW", "internalLatentGainW", "supplyDryBulbC", "minimumSupplyDryAirMassFlowKgS"] as const;
  const entries: { name: string; module: EngineeringBasisModule; supplied: HvacThermalParameter }[] = names.map(name => ({ name, module: "air" as const, supplied: zone[name] }));
  for (const air of zone.airExchange) {
    if (air.flow.basis === "dry-air-mass") entries.push({ name: `${air.id}.dryAirMassFlowKgS`, module: "air", supplied: air.flow.dryAirMassFlowKgS });
    else entries.push({ name: `${air.id}.volumeFlowM3S`, module: "air", supplied: air.flow.volumeFlowM3S }, { name: `${air.id}.dryAirDensityKgM3`, module: "air", supplied: air.flow.dryAirDensityKgM3 });
  }
  if (zone.equipment) for (const name of ["sensibleCapacityW", "latentCapacityW", "availableSupplyDryAirMassFlowKgS"] as const) entries.push({ name: `equipment.${name}`, module: "equipment", supplied: zone.equipment[name] });
  return entries;
}
function basisGates(source: HvacThermalInput, basis: EngineeringDesignBasis): string[] {
  const issues = validateEngineeringDesignBasis(basis);
  if (basis.profileVersion !== ENGINEERING_BASIS_PROFILE_VERSION) issues.push("Review the captured country basis against the supported catalog profile version.");
  if (!basis.countryCode || !basis.region.trim() || !basis.authority.trim() || !basis.confirmed || !basis.reviewer.trim()) issues.push("Thermal assessment requires a selected country, project region/authority and named confirmed basis reviewer.");
  const standardIds = basis.standards.map(item => item.id), criterionIds = basis.criteria.map(item => item.id);
  if (standardIds.some(value => !value.trim()) || criterionIds.some(value => !value.trim()) || new Set(standardIds).size !== standardIds.length || new Set(criterionIds).size !== criterionIds.length) issues.push("Captured adopted standard and criterion IDs must be non-empty and unique.");
  for (const criterion of basis.criteria) if ((criterion.standardId === undefined) !== (criterion.clause === undefined) || criterion.standardId !== undefined && (!criterion.standardId.trim() || !criterion.clause?.trim())) issues.push(`${criterion.id}: every declared criterion standard reference requires a paired non-empty adopted standard ID and clause.`);
  for (const zone of source.zones) for (const { name, module, supplied } of parameters(zone)) {
    if (supplied.criterionId !== undefined) {
      const matches = basis.criteria.filter(criterion => criterion.id === supplied.criterionId), criterion = matches[0];
      if (matches.length !== 1 || !criterion || criterion.module !== module || criterion.value !== supplied.value || criterion.unit !== supplied.unit || criterion.source !== supplied.source || criterion.standardId !== supplied.standardId || criterion.clause !== supplied.clause) issues.push(`${zone.id}.${name}: criterion must exactly match one sourced ${module} criterion including value, SI unit and optional standard/clause.`);
    }
    if (supplied.standardId !== undefined) {
      const matches = basis.standards.filter(standard => standard.id === supplied.standardId), standard = matches[0];
      if (matches.length !== 1 || !standard || !supplied.clause?.trim()) issues.push(`${zone.id}.${name}: source must resolve to one adopted standard and a clause.`);
      else {
        if (!standard.code.trim() || !standard.edition.trim() || !standard.adoptionReference.trim() || !standard.amendments.trim() || !isEngineeringSourceUrl(standard.sourceUrl)) issues.push(`${zone.id}.${name}: referenced standard requires complete adoption, edition, amendments and HTTPS source.`);
        const catalog = ENGINEERING_STANDARD_REFERENCES.find(reference => reference.id === standard.id);
        if (catalog && (catalog.countryCode !== basis.countryCode || catalog.domain !== standard.domain || catalog.code !== standard.code || !catalog.editions.includes(standard.edition) || catalog.sourceUrl !== standard.sourceUrl)) issues.push(`${zone.id}.${name}: referenced catalog standard differs from captured country, domain, code, edition or publisher.`);
      }
    }
  }
  return [...new Set(issues)];
}
function bounded(value: number): boolean { return finiteNumber(value) && Math.abs(value) <= OUTPUT_LIMIT; }
function positiveOrZero(value: number): boolean { return bounded(value) && value >= 0; }
function utilization(required: number, available: number): number | null { return available > 0 ? required / available : required === 0 ? 0 : null; }
function details(zone: HvacThermalZone, supported: boolean): string[] {
  return [
    "Envelope gain is UA*(Tout-Tzone). Solar and internal gains are authored heat/moisture effects delivered to this zone at this condition; schedules, radiant delay, thermal mass and peaks are not calculated.",
    "Every outdoor/infiltration row balances incoming dry air with equal outgoing dry air at indoor state. Qs=m_dry*cp*(Tout-Tzone); moisture=m_dry*(wout-wzone); Ql=hfg*moisture. Volume rows use sourced dry-air mass per actual outdoor-state volume, not unspecified total moist-air density.",
    "Positive net sensible/latent gains require cooling/dehumidification; negative gains require heating/humidification. The four non-negative duties are reported separately and are never cancelled across thermal directions.",
    supported ? "Both balance components are compatible with the selected mode. Required sensible supply mass flow is Qs_mode/(cp*abs(Tzone-Tsupply)); mapped total terminal flow is max(thermal flow, independently authored minimum). This is not a latent-airflow or national-ventilation check." : "At least one balance component requires the opposite mode. Selected combined duty, required supply flow and optional equipment comparisons are withheld as null; mixed conditioning/reheat is outside this subset.",
    zone.equipment ? "Authored simultaneous net-to-zone equipment capacities refer to the exact captured indoor/outdoor state, mode, supply temperature and capacity airflow. Sensible credit is the lesser of the authored capacity and m_available*cp*deltaT; latent capacity is externally reviewed. Each capacity and the mapped flow must independently suffice." : "No equipment is authored for this condition. Load and supported sensible airflow results do not establish equipment adequacy.",
  ];
}
function zoneResult(zone: HvacThermalZone): HvacThermalResult {
  const temperatureDifference = zone.outdoorDryBulbC.value - zone.indoorDryBulbC.value, humidityDifference = zone.outdoorHumidityRatio.value - zone.indoorHumidityRatio.value;
  const airExchange = zone.airExchange.map(air => {
    const mass = air.flow.basis === "dry-air-mass" ? air.flow.dryAirMassFlowKgS.value : air.flow.volumeFlowM3S.value * air.flow.dryAirDensityKgM3.value;
    const sensible = mass * zone.sensibleSpecificHeat.value * temperatureDifference, moisture = mass * humidityDifference, latent = zone.latentHeatOfVaporization.value * moisture;
    if (![mass, sensible, moisture, latent].every(bounded) || mass < 0) throw new Error(`${zone.id}: out-of-bound air-exchange balance.`);
    return { id: air.id, boundaryId: air.boundaryId, kind: air.kind, dryAirMassFlowKgS: mass, sensibleGainW: sensible, moistureGainKgS: moisture, latentGainW: latent };
  });
  const envelope = zone.envelopeUA.value * temperatureDifference, mass = airExchange.reduce((sum, air) => sum + air.dryAirMassFlowKgS, 0), airSensible = airExchange.reduce((sum, air) => sum + air.sensibleGainW, 0), airLatent = airExchange.reduce((sum, air) => sum + air.latentGainW, 0);
  const sensible = envelope + zone.solarSensibleGainW.value + zone.internalSensibleGainW.value + airSensible, latent = zone.internalLatentGainW.value + airLatent;
  const cooling = Math.max(0, sensible), heating = Math.max(0, -sensible), dehumidification = Math.max(0, latent), humidification = Math.max(0, -latent);
  const supported = zone.mode === "cooling" ? heating === 0 && humidification === 0 : cooling === 0 && dehumidification === 0;
  const sensibleDuty = supported ? zone.mode === "cooling" ? cooling : heating : null, latentDuty = supported ? zone.mode === "cooling" ? dehumidification : humidification : null, totalDuty = sensibleDuty === null || latentDuty === null ? null : sensibleDuty + latentDuty;
  const supplyDifference = zone.mode === "cooling" ? zone.indoorDryBulbC.value - zone.supplyDryBulbC.value : zone.supplyDryBulbC.value - zone.indoorDryBulbC.value;
  const thermalFlow = sensibleDuty === null ? null : sensibleDuty / (zone.sensibleSpecificHeat.value * supplyDifference), requiredFlow = thermalFlow === null ? null : Math.max(thermalFlow, zone.minimumSupplyDryAirMassFlowKgS.value);
  if (![envelope, mass, airSensible, airLatent, sensible, latent, cooling, heating, dehumidification, humidification, supplyDifference].every(bounded) || [sensibleDuty, latentDuty, totalDuty, thermalFlow, requiredFlow].some(value => value !== null && !positiveOrZero(value))) throw new Error(`${zone.id}: out-of-bound thermal duty or flow.`);
  let equipmentDuty: HvacThermalEquipmentDuty | null = null;
  if (zone.equipment && sensibleDuty !== null && latentDuty !== null && requiredFlow !== null) {
    const item = zone.equipment, availableMass = item.availableSupplyDryAirMassFlowKgS.value, flowCapacity = availableMass * zone.sensibleSpecificHeat.value * supplyDifference, sensibleCapacity = Math.min(item.sensibleCapacityW.value, flowCapacity), latentCapacity = item.latentCapacityW.value;
    const sensibleSatisfied = sensibleDuty <= sensibleCapacity, latentSatisfied = latentDuty <= latentCapacity, airflowSatisfied = requiredFlow <= availableMass;
    const sensibleUtilization = utilization(sensibleDuty, sensibleCapacity), latentUtilization = utilization(latentDuty, latentCapacity), airflowUtilization = utilization(requiredFlow, availableMass);
    if (![flowCapacity, sensibleCapacity, latentCapacity].every(positiveOrZero) || [sensibleUtilization, latentUtilization, airflowUtilization].some(value => value !== null && !positiveOrZero(value))) throw new Error(`${zone.id}: out-of-bound equipment duty.`);
    equipmentDuty = { equipmentId: item.id, authoredSensibleCapacityW: item.sensibleCapacityW.value, flowLimitedSensibleCapacityW: flowCapacity, creditedSensibleCapacityW: sensibleCapacity, availableLatentCapacityW: latentCapacity, availableSupplyDryAirMassFlowKgS: availableMass, sensibleSatisfied, latentSatisfied, airflowSatisfied, satisfiesSuppliedDuty: sensibleSatisfied && latentSatisfied && airflowSatisfied, sensibleUtilization, latentUtilization, airflowUtilization };
  }
  return { id: zone.id, zoneId: zone.zoneId, mode: zone.mode, designConditionId: zone.designConditionId, airflowRequirementId: zone.airflowRequirementId,
    status: !supported ? "unsupported-mixed-duty" : equipmentDuty === null ? "loads-and-airflow-only" : equipmentDuty.satisfiesSuppliedDuty ? "within-supplied-duty" : "exceeds-supplied-duty",
    envelopeSensibleGainW: envelope, solarSensibleGainW: zone.solarSensibleGainW.value, internalSensibleGainW: zone.internalSensibleGainW.value, internalLatentGainW: zone.internalLatentGainW.value, airExchange,
    airExchangeDryAirMassFlowKgS: mass, airExchangeSensibleGainW: airSensible, airExchangeLatentGainW: airLatent, netSensibleGainW: sensible, netLatentGainW: latent, sensibleCoolingDutyW: cooling, sensibleHeatingDutyW: heating, dehumidificationDutyW: dehumidification, humidificationDutyW: humidification,
    selectedModeScopeSatisfied: supported, selectedSensibleDutyW: sensibleDuty, selectedLatentDutyW: latentDuty, selectedTotalDutyW: totalDuty, supplyTemperatureDifferenceK: supplyDifference, requiredThermalSupplyDryAirMassFlowKgS: thermalFlow, authoredMinimumSupplyDryAirMassFlowKgS: zone.minimumSupplyDryAirMassFlowKgS.value, requiredSupplyDryAirMassFlowKgS: requiredFlow, equipmentDuty, details: details(zone, supported), excludedChecks: [...EXCLUDED_CHECKS] };
}

/** Physical balance for any complete selected-country basis; national checks remain explicitly unsupported. */
export function assessHvacThermalLoads(input: HvacThermalInput, basisInput: EngineeringDesignBasis): HvacThermalReport {
  const source = parseHvacThermalInput(input), designBasis = strictBasis(basisInput), basisIssues = basisGates(source, designBasis), results = basisIssues.length ? [] : source.zones.map(zoneResult);
  const duties = results.filter(result => source.zones.find(zone => zone.id === result.id)!.equipment !== null);
  const allSuppliedEquipmentDutiesSatisfied = basisIssues.length || !duties.length || duties.some(result => result.equipmentDuty === null) ? null : duties.every(result => result.equipmentDuty!.satisfiesSuppliedDuty);
  const report: HvacThermalReport = { version: 1, implementation: IMPLEMENTATION, verification: "unverified", claim: "supplied-criteria-only", nationalCodeCompliance: "not-assessed", source, designBasis,
    status: basisIssues.length ? "unsupported-basis" : results.some(result => !result.selectedModeScopeSatisfied) ? "partial-subset" : "assessed-subset", basisIssues, nationalChecks: { countryCode: designBasis.countryCode, status: "unsupported", checks: [...NATIONAL_CHECKS] }, results, allSuppliedEquipmentDutiesSatisfied, warnings: [...WARNINGS] };
  if (!validateHvacThermalReport(report, source, designBasis)) throw new Error("Generated HVAC thermal report failed its source-coherence contract."); return report;
}
function sameTextList(value: unknown, expected: readonly string[], path: string, maximum: number): boolean {
  return JSON.stringify(array(value, path, maximum).map(item => text(item, path))) === JSON.stringify(expected);
}

/** Restoration checks direct scalar/source/basis coherence; no assessor, zone-result routine or solver is invoked. */
export function validateHvacThermalReport(value: unknown, input: HvacThermalInput, basisInput: EngineeringDesignBasis): value is HvacThermalReport {
  try {
    const source = parseHvacThermalInput(input), basis = strictBasis(basisInput), raw = object(value, ["version", "implementation", "verification", "claim", "nationalCodeCompliance", "source", "designBasis", "status", "basisIssues", "nationalChecks", "results", "allSuppliedEquipmentDutiesSatisfied", "warnings"], "HVAC thermal report");
    if (raw.version !== 1 || raw.implementation !== IMPLEMENTATION || raw.verification !== "unverified" || raw.claim !== "supplied-criteria-only" || raw.nationalCodeCompliance !== "not-assessed") return false;
    if (JSON.stringify(parseHvacThermalInput(raw.source)) !== JSON.stringify(source) || engineeringBasisFingerprint(strictBasis(raw.designBasis)) !== engineeringBasisFingerprint(basis)) return false;
    const gates = basisGates(source, basis); if (!sameTextList(raw.basisIssues, gates, "basisIssues", 3000) || !sameTextList(raw.warnings, WARNINGS, "warnings", 20)) return false;
    const national = object(raw.nationalChecks, ["countryCode", "status", "checks"], "nationalChecks"); if (national.countryCode !== basis.countryCode || national.status !== "unsupported" || !sameTextList(national.checks, NATIONAL_CHECKS, "nationalChecks.checks", 10)) return false;
    const results = array(raw.results, "results", 40); if (results.length !== (gates.length ? 0 : source.zones.length)) return false;
    let partial = false, equipmentCount = 0, equipmentUnsupported = false, equipmentSatisfied = true;
    for (let index = 0; index < results.length; index++) {
      const item = object(results[index], RESULT_KEYS, "result"), zone = source.zones[index];
      if (item.id !== zone.id || item.zoneId !== zone.zoneId || item.mode !== zone.mode || item.designConditionId !== zone.designConditionId || item.airflowRequirementId !== zone.airflowRequirementId) return false;
      const deltaT = zone.outdoorDryBulbC.value - zone.indoorDryBulbC.value, deltaW = zone.outdoorHumidityRatio.value - zone.indoorHumidityRatio.value;
      const airRows = array(item.airExchange, "result.airExchange", 16); if (airRows.length !== zone.airExchange.length) return false;
      let mass = 0, airSensible = 0, airLatent = 0;
      for (let airIndex = 0; airIndex < airRows.length; airIndex++) {
        const air = zone.airExchange[airIndex], saved = object(airRows[airIndex], ["id", "boundaryId", "kind", "dryAirMassFlowKgS", "sensibleGainW", "moistureGainKgS", "latentGainW"], "result.airExchange row");
        const rowMass = air.flow.basis === "dry-air-mass" ? air.flow.dryAirMassFlowKgS.value : air.flow.volumeFlowM3S.value * air.flow.dryAirDensityKgM3.value, rowSensible = rowMass * zone.sensibleSpecificHeat.value * deltaT, rowMoisture = rowMass * deltaW, rowLatent = zone.latentHeatOfVaporization.value * rowMoisture;
        if (![rowMass, rowSensible, rowMoisture, rowLatent].every(bounded) || rowMass < 0 || saved.id !== air.id || saved.boundaryId !== air.boundaryId || saved.kind !== air.kind || saved.dryAirMassFlowKgS !== rowMass || saved.sensibleGainW !== rowSensible || saved.moistureGainKgS !== rowMoisture || saved.latentGainW !== rowLatent) return false;
        mass += rowMass; airSensible += rowSensible; airLatent += rowLatent;
      }
      const envelope = zone.envelopeUA.value * deltaT, sensible = envelope + zone.solarSensibleGainW.value + zone.internalSensibleGainW.value + airSensible, latent = zone.internalLatentGainW.value + airLatent;
      const cooling = Math.max(0, sensible), heating = Math.max(0, -sensible), dehumidification = Math.max(0, latent), humidification = Math.max(0, -latent);
      const supported = zone.mode === "cooling" ? heating === 0 && humidification === 0 : cooling === 0 && dehumidification === 0;
      const sensibleDuty = supported ? zone.mode === "cooling" ? cooling : heating : null, latentDuty = supported ? zone.mode === "cooling" ? dehumidification : humidification : null, totalDuty = sensibleDuty === null || latentDuty === null ? null : sensibleDuty + latentDuty;
      const supplyDifference = zone.mode === "cooling" ? zone.indoorDryBulbC.value - zone.supplyDryBulbC.value : zone.supplyDryBulbC.value - zone.indoorDryBulbC.value;
      const thermalFlow = sensibleDuty === null ? null : sensibleDuty / (zone.sensibleSpecificHeat.value * supplyDifference), requiredFlow = thermalFlow === null ? null : Math.max(thermalFlow, zone.minimumSupplyDryAirMassFlowKgS.value);
      const scalars: [string, number | null][] = [["envelopeSensibleGainW", envelope], ["solarSensibleGainW", zone.solarSensibleGainW.value], ["internalSensibleGainW", zone.internalSensibleGainW.value], ["internalLatentGainW", zone.internalLatentGainW.value], ["airExchangeDryAirMassFlowKgS", mass], ["airExchangeSensibleGainW", airSensible], ["airExchangeLatentGainW", airLatent], ["netSensibleGainW", sensible], ["netLatentGainW", latent], ["sensibleCoolingDutyW", cooling], ["sensibleHeatingDutyW", heating], ["dehumidificationDutyW", dehumidification], ["humidificationDutyW", humidification], ["selectedSensibleDutyW", sensibleDuty], ["selectedLatentDutyW", latentDuty], ["selectedTotalDutyW", totalDuty], ["supplyTemperatureDifferenceK", supplyDifference], ["requiredThermalSupplyDryAirMassFlowKgS", thermalFlow], ["authoredMinimumSupplyDryAirMassFlowKgS", zone.minimumSupplyDryAirMassFlowKgS.value], ["requiredSupplyDryAirMassFlowKgS", requiredFlow]];
      if (scalars.some(([key, expected]) => item[key] !== expected || expected !== null && !bounded(expected)) || item.selectedModeScopeSatisfied !== supported) return false;
      partial ||= !supported;
      let dutySatisfied: boolean | null = null;
      if (zone.equipment) equipmentCount++;
      if (!zone.equipment || sensibleDuty === null || latentDuty === null || requiredFlow === null) {
        if (item.equipmentDuty !== null) return false; if (zone.equipment) equipmentUnsupported = true;
      } else {
        const saved = object(item.equipmentDuty, EQUIPMENT_DUTY_KEYS, "equipmentDuty"), equipmentSource = zone.equipment;
        const availableMass = equipmentSource.availableSupplyDryAirMassFlowKgS.value, flowCapacity = availableMass * zone.sensibleSpecificHeat.value * supplyDifference, sensibleCapacity = Math.min(equipmentSource.sensibleCapacityW.value, flowCapacity), latentCapacity = equipmentSource.latentCapacityW.value;
        const sensibleSatisfied = sensibleDuty <= sensibleCapacity, latentSatisfied = latentDuty <= latentCapacity, airflowSatisfied = requiredFlow <= availableMass; dutySatisfied = sensibleSatisfied && latentSatisfied && airflowSatisfied; equipmentSatisfied &&= dutySatisfied;
        const sensibleUtilization = sensibleCapacity > 0 ? sensibleDuty / sensibleCapacity : sensibleDuty === 0 ? 0 : null, latentUtilization = latentCapacity > 0 ? latentDuty / latentCapacity : latentDuty === 0 ? 0 : null, airflowUtilization = availableMass > 0 ? requiredFlow / availableMass : requiredFlow === 0 ? 0 : null;
        const dutyScalars: [string, number | null][] = [["authoredSensibleCapacityW", equipmentSource.sensibleCapacityW.value], ["flowLimitedSensibleCapacityW", flowCapacity], ["creditedSensibleCapacityW", sensibleCapacity], ["availableLatentCapacityW", latentCapacity], ["availableSupplyDryAirMassFlowKgS", availableMass], ["sensibleUtilization", sensibleUtilization], ["latentUtilization", latentUtilization], ["airflowUtilization", airflowUtilization]];
        if (dutyScalars.some(([key, expected]) => saved[key] !== expected || expected !== null && !positiveOrZero(expected)) || saved.equipmentId !== equipmentSource.id || saved.sensibleSatisfied !== sensibleSatisfied || saved.latentSatisfied !== latentSatisfied || saved.airflowSatisfied !== airflowSatisfied || saved.satisfiesSuppliedDuty !== dutySatisfied) return false;
      }
      if (item.status !== (!supported ? "unsupported-mixed-duty" : dutySatisfied === null ? "loads-and-airflow-only" : dutySatisfied ? "within-supplied-duty" : "exceeds-supplied-duty")) return false;
      if (!sameTextList(item.details, details(zone, supported), "details", 10) || !sameTextList(item.excludedChecks, EXCLUDED_CHECKS, "excludedChecks", 15)) return false;
    }
    const aggregate = gates.length || !equipmentCount || equipmentUnsupported ? null : equipmentSatisfied;
    return raw.allSuppliedEquipmentDutiesSatisfied === aggregate && raw.status === (gates.length ? "unsupported-basis" : partial ? "partial-subset" : "assessed-subset");
  } catch { return false; }
}

/** Illustrative snapshot; every source/review must be replaced and the project basis confirmed separately. */
export function hvacThermalExample(): HvacThermalInput {
  return { version: 1, zones: [{ id: "thermal-zone-1-cooling", zoneId: "zone-1", label: "Illustrative steady-state cooling condition", mode: "cooling", designConditionId: "replace-with-project-condition", inputSource: "Illustrative authored thermal snapshot; replace all values and sources with reviewed project data.", designConditionReviewSource: "Example declaration only; replace with reviewed indoor/outdoor design temperature, humidity, pressure and psychrometric feasibility for this one condition.",
    calculationBasis: "steady-state-constant-properties", psychrometricStatesReviewed: true, balancedAirExchangeReviewed: true, airExchangeReviewSource: "Example declaration only; replace with review of balanced dry-air inflow/outflow and disjoint outdoor/infiltration boundary accounting at zone state.", noDuplicateAirExchangeReviewed: true, gainsExcludeAirExchangeReviewed: true, outdoorAirHandling: "unconditioned-exchange-at-zone-boundary", noHeatRecovery: true, noInterzoneTransfer: true, systemScope: "single-zone-terminal-duty", auxiliaryEffectsIncludedInAuthoredGainsReviewed: true, applicabilityReviewSource: "Example declaration only; replace with reviewed constant-property applicability and confirmation that fan/duct/device auxiliary gains are included once in the authored gains.",
    envelopeUA: { value: 300, unit: "W/K", source: "Illustrative aggregate envelope UA excluding solar and air exchange; replace with reviewed envelope calculation." }, indoorDryBulbC: { value: 24, unit: "degC", source: "Illustrative indoor design dry bulb; replace with project criterion." }, outdoorDryBulbC: { value: 34, unit: "degC", source: "Illustrative outdoor design dry bulb; replace with reviewed design condition." }, indoorHumidityRatio: { value: 0.009, unit: "kg-water/kg-dry-air", source: "Illustrative reviewed indoor humidity ratio; replace with sourced psychrometric state." }, outdoorHumidityRatio: { value: 0.015, unit: "kg-water/kg-dry-air", source: "Illustrative reviewed outdoor humidity ratio; replace with sourced psychrometric state." },
    sensibleSpecificHeat: { value: 1020, unit: "J/(kg-dry-air*K)", source: "Illustrative effective constant sensible specific heat on a dry-air basis; replace with reviewed property/source for these states." }, latentHeatOfVaporization: { value: 2440000, unit: "J/kg-water", source: "Illustrative constant water latent heat; replace with reviewed temperature-appropriate property/source." }, solarSensibleGainW: { value: 1500, unit: "W", source: "Illustrative solar heat delivered to the zone at this condition; replace with reviewed solar/shading calculation." }, internalSensibleGainW: { value: 2500, unit: "W", source: "Illustrative signed internal sensible gain including all applicable auxiliary effects; replace with reviewed condition-specific calculation." }, internalLatentGainW: { value: 800, unit: "W", source: "Illustrative signed internal moisture-equivalent latent gain at supplied hfg; replace with reviewed calculation." },
    airExchange: [{ id: "outdoor-1", boundaryId: "outdoor-boundary-1", kind: "outdoor-air", balance: "equal-dry-air-outflow-at-zone-state", flow: { basis: "dry-air-mass", dryAirMassFlowKgS: { value: 0.2, unit: "kg-dry-air/s", source: "Illustrative balanced unconditioned outdoor dry-air flow; replace with reviewed project airflow requirement, not an inferred code rate." } } }], supplyDryBulbC: { value: 14, unit: "degC", source: "Illustrative terminal cooling supply dry bulb; replace with reviewed project supply condition." }, airflowRequirementId: "replace-with-terminal-flow-requirement", airflowMappingReviewSource: "Example declaration only; replace with mapping to the independent total terminal flow requirement and confirmation that it is not counted again as outdoor/infiltration heat gain.", minimumSupplyDryAirMassFlowKgS: { value: 0.5, unit: "kg-dry-air/s", source: "Illustrative independent minimum total terminal dry-air flow; replace with reviewed air-system requirement." }, equipment: null,
  }] };
}
