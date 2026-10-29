type Path = readonly (string | number)[];
export interface GuidedEngineeringField {
  path: Path; label: string; unit: string; value: number; multiplier: number; positive?: boolean; nonnegative?: boolean;
}
interface FieldDefinition { key: string; label: string; unit: string; multiplier?: number; positive?: boolean; nonnegative?: boolean }
const definitions: Record<string, FieldDefinition> = {
  xM: { key: "xM", label: "X coordinate", unit: "m" }, yM: { key: "yM", label: "Y coordinate", unit: "m" },
  areaM2: { key: "areaM2", label: "Section area", unit: "m²", positive: true },
  inertiaM4: { key: "inertiaM4", label: "Second moment of area", unit: "m⁴", positive: true },
  elasticModulusPa: { key: "elasticModulusPa", label: "Young’s modulus", unit: "GPa", multiplier: 1e-9, positive: true },
  fxN: { key: "fxN", label: "X force", unit: "N" }, fyN: { key: "fyN", label: "Y force", unit: "N" }, mzNm: { key: "mzNm", label: "Moment", unit: "N·m" },
  densityKgM3: { key: "densityKgM3", label: "Water density", unit: "kg/m³", positive: true },
  kinematicViscosityM2s: { key: "kinematicViscosityM2s", label: "Kinematic viscosity", unit: "mm²/s", multiplier: 1e6, positive: true },
  elevationM: { key: "elevationM", label: "Elevation", unit: "m" },
  demandM3s: { key: "demandM3s", label: "Demand", unit: "L/s", multiplier: 1000, nonnegative: true },
  fixedPotential: { key: "fixedPotential", label: "Fixed total head", unit: "m water" },
  minimumPressure: { key: "minimumPressure", label: "Minimum pressure head", unit: "m water" },
  lengthM: { key: "lengthM", label: "Length", unit: "m", positive: true },
  diameterM: { key: "diameterM", label: "Internal diameter", unit: "mm", multiplier: 1000, positive: true },
  roughnessM: { key: "roughnessM", label: "Roughness", unit: "mm", multiplier: 1000, nonnegative: true },
  minorLossK: { key: "minorLossK", label: "Minor loss coefficient K", unit: "dimensionless", nonnegative: true },
  maximumVelocityMps: { key: "maximumVelocityMps", label: "Maximum velocity", unit: "m/s", positive: true },
};
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const maxFields = 240;
function parse(text: string): Record<string, unknown> {
  if (text.length > 1_000_000) throw new Error("Input exceeds the 1 MB text limit.");
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error("Engineering input must be a JSON object.");
  return value;
}

/** A bounded view of existing numeric values only. No topology, criteria or inputs are inferred. */
export function guidedEngineeringFields(text: string, module: string): { fields: GuidedEngineeringField[]; problem: string | null; limited: boolean } {
  if (module !== "frame" && module !== "water") return { fields: [], problem: null, limited: false };
  try {
    const input = parse(text), fields: GuidedEngineeringField[] = [];
    let limited = false;
    const add = (record: unknown, path: Path, name: string, keys: string[]) => {
      if (!isRecord(record)) return;
      for (const key of keys) {
        const value = record[key], definition = definitions[key];
        if (typeof value !== "number" || !Number.isFinite(value) || !definition) continue;
        if (fields.length >= maxFields) { limited = true; continue; }
        fields.push({ ...definition, path: [...path, key], label: name ? `${name} · ${definition.label}` : definition.label, value, multiplier: definition.multiplier ?? 1 });
      }
    };
    const rows = (value: unknown, path: Path, name: string, keys: string[]) => {
      if (!Array.isArray(value)) return;
      if (value.length > 30) limited = true;
      value.slice(0, 30).forEach((row, index) => add(row, [...path, index], `${name} ${isRecord(row) && typeof row.id === "string" ? row.id : index + 1}`, keys));
    };
    if (module === "frame") {
      rows(input.nodes, ["nodes"], "Node", ["xM", "yM"]);
      rows(input.members, ["members"], "Member", ["areaM2", "inertiaM4", "elasticModulusPa"]);
      if (Array.isArray(input.loadCases)) {
        if (input.loadCases.length > 30) limited = true;
        input.loadCases.slice(0, 30).forEach((loadCase, index) => {
          if (isRecord(loadCase)) rows(loadCase.nodal, ["loadCases", index, "nodal"], `Load case ${typeof loadCase.id === "string" ? loadCase.id : index + 1}, nodal load`, ["fxN", "fyN", "mzNm"]);
        });
      }
    } else {
      // A mismatched medium remains available for correction in JSON; never reinterpret air pressure as water head.
      if (input.medium !== "water") throw new Error("Choose a water network before using the guided hydraulic fields.");
      add(input, [], "", ["densityKgM3", "kinematicViscosityM2s"]);
      rows(input.nodes, ["nodes"], "Node", ["elevationM", "demandM3s", "fixedPotential", "minimumPressure"]);
      rows(input.links, ["links"], "Pipe", ["lengthM", "diameterM", "roughnessM", "minorLossK", "maximumVelocityMps"]);
    }
    return { fields, problem: null, limited };
  } catch (cause) { return { fields: [], problem: cause instanceof Error ? cause.message : "Input could not be read.", limited: false }; }
}

export function updateGuidedEngineeringNumber(text: string, module: string, path: Path, displayValue: number): string {
  const field = guidedEngineeringFields(text, module).fields.find(item => JSON.stringify(item.path) === JSON.stringify(path));
  if (!field) throw new Error("This field is not available for guided editing. Keep the original JSON and review its schema.");
  const value = displayValue / field.multiplier;
  if (!Number.isFinite(displayValue) || !Number.isFinite(value)) throw new Error("Enter a finite number.");
  if (field.positive && value <= 0) throw new Error("Enter a value greater than zero.");
  if (field.nonnegative && value < 0) throw new Error("Enter zero or a positive value.");
  const input = parse(text);
  let target: unknown = input;
  for (const segment of path.slice(0, -1)) target = (target as Record<string | number, unknown>)[segment];
  (target as Record<string | number, unknown>)[path[path.length - 1]] = value;
  return JSON.stringify(input, null, 2);
}

export function engineeringResultSummary(module: string, value: unknown): { label: string; value: string }[] {
  if (!isRecord(value)) return [];
  const number = (value: unknown, multiplier = 1) => typeof value === "number" && Number.isFinite(value) ? (value * multiplier).toLocaleString(undefined, { maximumSignificantDigits: 7 }) : "Not reported";
  if (module === "water") return [
    { label: "Calculation status", value: typeof value.status === "string" ? value.status : "Not reported" },
    { label: "Iterations", value: number(value.iterations) },
    { label: "Total supply (L/s)", value: number(value.totalSupplyM3s, 1000) },
    { label: "Total demand (L/s)", value: number(value.totalDemandM3s, 1000) },
    { label: "Maximum mass residual (L/s)", value: number(value.maxMassResidualM3s, 1000) },
  ];
  if (module === "frame" && Array.isArray(value.results)) {
    const results = value.results.filter(isRecord);
    const translations = results.flatMap(result => Array.isArray(result.displacements) ? result.displacements.filter(isRecord).flatMap(node => typeof node.uxM === "number" && typeof node.uyM === "number" && Number.isFinite(node.uxM) && Number.isFinite(node.uyM) ? [Math.hypot(node.uxM, node.uyM)] : []) : []);
    return [{ label: "Load combinations", value: String(results.length) }, { label: "Converged combinations", value: String(results.filter(result => result.status === "converged").length) }, { label: "Maximum nodal translation (mm)", value: translations.length ? number(Math.max(...translations), 1000) : "Not reported" }];
  }
  return [];
}

export function civilInputErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Operation failed.";
  if (/Invalid bounded unchanged vertical datum/i.test(message)) return "Enter the unchanged vertical datum in the coordinate reference declaration (for example, the datum name from your survey), then retry. Groundwork does not transform vertical datums.";
  return message;
}
