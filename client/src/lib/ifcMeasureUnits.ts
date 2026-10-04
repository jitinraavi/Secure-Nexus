import { IFC_SUPPORTED_SCHEMAS, type IfcDocument, type IfcPropertyValue, type StepEntity, type StepValue } from "./ifcGeometry";

const MEASURES = {
  IFCLENGTHMEASURE: { unitType: "LENGTHUNIT", name: "METRE", power: 1, siUnit: "m", domain: "signed" },
  IFCPOSITIVELENGTHMEASURE: { unitType: "LENGTHUNIT", name: "METRE", power: 1, siUnit: "m", domain: "positive" },
  IFCNONNEGATIVELENGTHMEASURE: { unitType: "LENGTHUNIT", name: "METRE", power: 1, siUnit: "m", domain: "nonnegative" },
  IFCAREAMEASURE: { unitType: "AREAUNIT", name: "SQUARE_METRE", power: 2, siUnit: "m2", domain: "signed" },
  IFCVOLUMEMEASURE: { unitType: "VOLUMEUNIT", name: "CUBIC_METRE", power: 3, siUnit: "m3", domain: "signed" },
  IFCMASSMEASURE: { unitType: "MASSUNIT", name: "GRAM", power: 1, siUnit: "kg", domain: "signed" },
  IFCTIMEMEASURE: { unitType: "TIMEUNIT", name: "SECOND", power: 1, siUnit: "s", domain: "signed" },
  IFCPLANEANGLEMEASURE: { unitType: "PLANEANGLEUNIT", name: "RADIAN", power: 1, siUnit: "rad", domain: "signed" },
  IFCPOSITIVEPLANEANGLEMEASURE: { unitType: "PLANEANGLEUNIT", name: "RADIAN", power: 1, siUnit: "rad", domain: "positive" },
} as const;
export type IfcSIMeasureType = keyof typeof MEASURES;
export const IFC_SI_MEASURE_TYPES: readonly IfcSIMeasureType[] = Object.keys(MEASURES) as IfcSIMeasureType[];
const PREFIX_EXPONENTS: Readonly<Record<string, number>> = { EXA: 18, PETA: 15, TERA: 12, GIGA: 9, MEGA: 6, KILO: 3, HECTO: 2, DECA: 1, DECI: -1, CENTI: -2, MILLI: -3, MICRO: -6, NANO: -9, PICO: -12, FEMTO: -15, ATTO: -18 };
const VALUE_LIMIT = 1e30;
export type IfcMeasureNormalization = { supported: true; dataType: IfcSIMeasureType; siValue: number; siUnit: string; factor: number; unitSource: "explicit" | "project" } | { supported: false; message: string };
export type IfcMeasureNormalizer = (property: IfcPropertyValue) => IfcMeasureNormalization;
export function isIfcMeasureType(value: string): value is IfcSIMeasureType { return Object.prototype.hasOwnProperty.call(MEASURES, value); }
export function supportsIfcMeasureType(value: string, schema: string): value is IfcSIMeasureType {
  const version = schema.toUpperCase();
  return isIfcMeasureType(value) && (IFC_SUPPORTED_SCHEMAS as readonly string[]).includes(version) && !(version === "IFC2X3" && value === "IFCNONNEGATIVELENGTHMEASURE");
}
function bounded(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= VALUE_LIMIT; }
function domain(value: number, dataType: IfcSIMeasureType): void {
  const kind = MEASURES[dataType].domain;
  if (kind === "positive" && value <= 0 || kind === "nonnegative" && value < 0) throw new Error(`${dataType} violates its positive/nonnegative IFC type constraint.`);
}
export function parseIdsFloatLiteral(value: string): number {
  if (value.length > 2000 || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) throw new Error("IDS numeric literals require a finite decimal/scientific value.");
  const number = Number(value);
  if (!bounded(number) || number === 0 && /[1-9]/.test(value.split(/[eE]/)[0])) throw new Error("IDS numeric literal overflows, underflows or exceeds magnitude 1e30.");
  return number;
}
export function parseIdsMeasureLiteral(value: string, dataType: string, schema: string): number {
  if (!supportsIfcMeasureType(dataType, schema)) throw new Error(`IDS measure dataType ${dataType} is outside the supported schema/type subset.`);
  const number = parseIdsFloatLiteral(value); domain(number, dataType); return number;
}
/** Published IDS fixed rounding tolerance, strict bounds around the expected value; never a range tolerance. */
export function idsFloatEquivalent(actual: number, expected: number): boolean {
  if (!bounded(actual) || !bounded(expected)) throw new Error("IDS float comparison requires finite bounded numbers.");
  const epsilon = 1e-6, lower = expected - Math.abs(expected) * epsilon - epsilon, upper = expected + Math.abs(expected) * epsilon + epsilon;
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper) throw new Error("IDS tolerance interval is unresolved.");
  return actual > lower && actual < upper;
}
function ref(value: StepValue | undefined): number | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) && "ref" in value ? value.ref : undefined; }
function token(value: StepValue | undefined): string | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) && "enumeration" in value && /^\.[A-Z][A-Z0-9_]*\.$/.test(value.enumeration) ? value.enumeration.slice(1, -1) : undefined; }
function dense(value: StepValue | undefined, maximum: number): StepValue[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error("Unit assignment aggregate is malformed or exceeds its bound.");
  for (let index = 0; index < value.length; index++) if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error("Unit assignment aggregate is sparse.");
  return value;
}
function retainedRecord(document: IfcDocument, entity: StepEntity, maximum: number): string {
  if (!Number.isSafeInteger(entity.start) || !Number.isSafeInteger(entity.end) || entity.start < 0 || entity.end > document.source.length || entity.end <= entity.start || entity.end - entity.start > maximum) throw new Error("Unit/property source span is outside its bounded retained STEP record.");
  const raw = document.source.slice(entity.start, entity.end); let clean = "", quoted = false;
  for (let index = 0; index < raw.length; index++) {
    if (!quoted && raw.startsWith("/*", index)) { const end = raw.indexOf("*/", index + 2); if (end < 0) throw new Error("Unclosed comment in retained unit/property record."); clean += " "; index = end + 1; continue; }
    if (raw[index] === "'") { if (quoted && raw[index + 1] === "'") { clean += "''"; index++; continue; } quoted = !quoted; }
    clean += raw[index];
  }
  if (quoted) throw new Error("Unclosed string in retained unit/property record.");
  return clean;
}

/** Direct IfcSIUnit subset only. Conversion/derived/context/offset graphs are not traversed or guessed. */
export function createIfcMeasureNormalizer(document: IfcDocument): IfcMeasureNormalizer {
  const cache = new WeakMap<IfcPropertyValue, IfcMeasureNormalization>();
  let resolutions = 0, defaults: StepEntity[] = [], defaultIssue = "";
  if (!(document.entities instanceof Map) || document.entities.size > 100000 || typeof document.source !== "string" || document.source.length > 20000000) return () => ({ supported: false, message: "IFC SI resolver document exceeds its retained-source/entity bound." });
  try {
    const projects = [...document.entities.values()].filter(entity => entity.type === "IFCPROJECT");
    if (projects.length !== 1 || projects[0].args.length !== 9) throw new Error("Exactly one well-formed project is required for default measure units.");
    const assignment = document.entities.get(ref(projects[0].args[8]) ?? -1);
    if (assignment?.type !== "IFCUNITASSIGNMENT" || assignment.args.length !== 1) throw new Error("Project measure unit assignment is missing or malformed.");
    const entries = dense(assignment.args[0], 64), ids = new Set<number>();
    if (!entries.length) throw new Error("Project measure unit assignment is empty.");
    for (const entry of entries) {
      const unitId = ref(entry), unit = document.entities.get(unitId ?? -1);
      if (unitId === undefined || !unit || ids.has(unitId) || !["IFCSIUNIT", "IFCCONVERSIONBASEDUNIT", "IFCCONVERSIONBASEDUNITWITHOFFSET", "IFCCONTEXTDEPENDENTUNIT", "IFCDERIVEDUNIT", "IFCMONETARYUNIT"].includes(unit.type)) throw new Error("Project unit assignment contains unresolved, duplicate or unsupported unit records.");
      ids.add(unitId);
      if (unit.type !== "IFCMONETARYUNIT" && token(unit.args[1]) === undefined) throw new Error("Project unit types require unquoted STEP enumerations.");
      defaults.push(unit);
    }
  } catch (error) { defaultIssue = error instanceof Error ? error.message : "Project unit assignment is unresolved."; defaults = []; }
  return property => {
    const previous = cache.get(property); if (previous) return previous;
    let result: IfcMeasureNormalization;
    try {
      if (++resolutions > 200000) throw new Error("IFC SI normalization budget exceeded.");
      if (!property.supported || property.issues.length || !supportsIfcMeasureType(property.dataType, document.schema) || !bounded(property.value)) throw new Error("Measure nominal value/type is unresolved, unsupported or outside the finite 1e30 bound.");
      const dataType = property.dataType, definition = MEASURES[dataType], nominal = property.value;
      domain(nominal, dataType);
      const source = document.entities.get(property.propertyStepId), authored = source?.args[2];
      if (source?.type !== "IFCPROPERTYSINGLEVALUE" || source.args.length !== 4 || authored === null || typeof authored !== "object" || Array.isArray(authored) || !("type" in authored) || authored.type !== dataType || authored.values.length !== 1 || authored.values[0] !== nominal) throw new Error("Measure metadata does not match its retained typed single-value STEP property.");
      const metadata = property.unit;
      if (!metadata || metadata.entityType !== "IFCSIUNIT" || metadata.conversionFactor !== undefined || metadata.baseUnitStepId !== undefined) throw new Error("Only a resolved direct IfcSIUnit is supported; conversion, offset, derived and custom units are unsupported.");
      const explicit = ref(source.args[3]);
      const authoredRecord = /^#(\d+)\s*=\s*IFCPROPERTYSINGLEVALUE\s*\(\s*'(?:[^']|'')*'\s*,\s*(?:\$|'(?:[^']|'')*')\s*,\s*([A-Z][A-Z0-9_]*)\s*\(\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*\)\s*,\s*(\$|#\d+)\s*\)\s*;\s*$/i.exec(retainedRecord(document, source, 20000));
      if (!authoredRecord || Number(authoredRecord[1]) !== source.id || authoredRecord[2].toUpperCase() !== dataType || parseIdsFloatLiteral(authoredRecord[3]) !== nominal || (source.args[3] === null ? authoredRecord[4] !== "$" : explicit === undefined || Number(authoredRecord[4].slice(1)) !== explicit)) throw new Error("Measure nominal literal or optional Unit marker differs from its retained STEP property.");
      if (source.args[3] === null) {
        if (metadata.source !== "project" || defaultIssue) throw new Error(defaultIssue || "Measure default-unit provenance is inconsistent.");
        const candidates = defaults.filter(unit => token(unit.args[1]) === definition.unitType);
        if (candidates.length !== 1 || candidates[0].id !== metadata.stepId) throw new Error("Measure project unit is missing, ambiguous or inconsistent with retained metadata.");
      } else if (explicit === undefined || metadata.source !== "explicit" || explicit !== metadata.stepId) throw new Error("Explicit property unit is unresolved or inconsistent; no project fallback is allowed.");
      const unit = document.entities.get(metadata.stepId), unitType = token(unit?.args[1]), name = token(unit?.args[3]), prefix = unit?.args[2] === null ? "" : token(unit?.args[2]);
      if (unit?.type !== "IFCSIUNIT" || unit.args.length !== 4 || unit.args[0] !== null || unitType !== definition.unitType || name !== definition.name || prefix === undefined || prefix && !Object.prototype.hasOwnProperty.call(PREFIX_EXPONENTS, prefix)) throw new Error("SI unit arguments, enums, name, prefix or measure dimensions are inconsistent.");
      if (metadata.unitType !== unitType || metadata.name !== `.${name}.` || metadata.prefix !== prefix) throw new Error("Retained SI unit metadata differs from its authored STEP enums.");
      // The STEP parser collapses '$' and '*' to null; verify both marker roles in the complete record.
      const unitRecord = /^#(\d+)\s*=\s*IFCSIUNIT\s*\(\s*\*\s*,\s*\.([A-Z][A-Z0-9_]*)\.\s*,\s*(\$|\.[A-Z][A-Z0-9_]*\.)\s*,\s*\.([A-Z][A-Z0-9_]*)\.\s*\)\s*;\s*$/i.exec(retainedRecord(document, unit, 2000));
      if (!unitRecord || Number(unitRecord[1]) !== unit.id || unitRecord[2].toUpperCase() !== unitType || unitRecord[3].toUpperCase() !== (prefix ? `.${prefix}.` : "$") || unitRecord[4].toUpperCase() !== name) throw new Error("SI unit source requires derived '*' dimensions, an optional '$'/enum prefix and matching unquoted unit/name enums.");
      const exponent = (prefix ? PREFIX_EXPONENTS[prefix] : 0) * definition.power - (dataType === "IFCMASSMEASURE" ? 3 : 0), factor = 10 ** exponent, siValue = nominal * factor;
      if (!Number.isFinite(factor) || factor <= 0 || factor < 1e-60 || factor > 1e60 || !bounded(siValue) || nominal !== 0 && siValue === 0) throw new Error("SI normalization overflows, underflows or exceeds its finite bounds.");
      domain(siValue, dataType);
      result = { supported: true, dataType, siValue, siUnit: definition.siUnit, factor, unitSource: metadata.source };
    } catch (error) { result = { supported: false, message: error instanceof Error ? error.message : "Unsupported IFC SI measure metadata." }; }
    cache.set(property, result); return result;
  };
}
