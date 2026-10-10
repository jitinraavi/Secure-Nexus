import type { EngineeringCodeProfile } from "../types";

export interface StructuralLoadInput { areaM2: number; floors: number; deadLoadKPa: number; liveLoadKPa: number; heightM: number; widthM: number; depthM: number; columnCount: number; }
export interface StructuralCalculationReport {
  kind: "structural-screening"; inputs: StructuralLoadInput; profile: EngineeringCodeProfile;
  gravity: { deadKN: number; liveKN: number; totalKN: number };
  combinations: { id: string; label: string; loadKN: number }[];
  lateral: { windBaseShearKN: number; seismicBaseShearKN: number; governingBaseShearKN: number; driftRatio: number };
  capacity: { columnUtilization: number; beamUtilization: number; foundationPressureKPa: number; foundationUtilization: number };
  reinforcementWarnings: string[]; connectionWarnings: string[]; warnings: string[]; validation: { valid: boolean; errors: string[] };
}

const n = (value: number, fallback = 0) => Number.isFinite(value) ? Math.max(value, 0) : fallback;
export function validateStructuralInputs(input: Partial<StructuralLoadInput>): string[] {
  const errors: string[] = [];
  for (const key of ["areaM2", "floors", "deadLoadKPa", "liveLoadKPa", "heightM", "widthM", "depthM", "columnCount"] as const) if (!Number.isFinite(Number(input[key])) || Number(input[key]) < 0) errors.push(`${key} must be a finite non-negative number.`);
  if (n(input.columnCount ?? 0) < 1) errors.push("columnCount must be at least 1.");
  return errors;
}

export function calculateStructuralScreen(input: StructuralLoadInput, profile: EngineeringCodeProfile): StructuralCalculationReport {
  const errors = validateStructuralInputs(input);
  const area = n(input.areaM2), floors = Math.max(n(input.floors), 1), columns = Math.max(n(input.columnCount), 1);
  const deadKN = area * floors * n(input.deadLoadKPa), liveKN = area * floors * n(input.liveLoadKPa);
  const wind = profile.wind.pressureKPa * profile.wind.importanceFactor * profile.wind.exposureFactor * n(input.widthM) * n(input.heightM);
  const seismic = profile.seismic.coefficient * profile.seismic.importanceFactor * deadKN / Math.max(profile.seismic.responseFactor, 0.01);
  const combinations = [
    { id: "gravity", label: "1.4D", loadKN: 1.4 * deadKN },
    { id: "gravity-live", label: "1.2D + 1.6L", loadKN: 1.2 * deadKN + 1.6 * liveKN },
    { id: "wind", label: "1.2D + L + W", loadKN: 1.2 * deadKN + liveKN + wind },
    { id: "seismic", label: "1.2D + L + E", loadKN: 1.2 * deadKN + liveKN + seismic },
  ];
  const governing = Math.max(...combinations.map((item) => item.loadKN));
  const columnCapacity = profile.materials.concreteMPa * 0.4 * 0.4 * 1000 / Math.max(profile.assumptions.safetyFactor, 1);
  const beamCapacity = profile.materials.concreteMPa * 0.25 * 0.5 * 0.5 * 1000 / Math.max(profile.assumptions.safetyFactor, 1);
  const beamDemand = (n(input.deadLoadKPa) + n(input.liveLoadKPa)) * Math.max(n(input.widthM), n(input.depthM)) * Math.max(n(input.widthM, 1), n(input.depthM, 1)) ** 2 / 8;
  const foundationPressure = governing / columns / 4;
  const driftRatio = Math.max(wind, seismic) * Math.max(n(input.heightM), 1) / Math.max(columnCapacity * columns * 100, 1);
  const warnings = ["Preliminary planning screen only; not a code compliance check, design, certification, or sealed deliverable.", "Confirm load paths, torsion, irregularity, ductility, serviceability, detailing, geotechnical parameters, and connection design with the engineer of record."];
  if (foundationPressure > profile.materials.soilBearingKPa) warnings.push("Foundation pressure exceeds the profile soil-bearing input.");
  return { kind: "structural-screening", inputs: input, profile, gravity: { deadKN, liveKN, totalKN: deadKN + liveKN }, combinations, lateral: { windBaseShearKN: wind, seismicBaseShearKN: seismic, governingBaseShearKN: Math.max(wind, seismic), driftRatio }, capacity: { columnUtilization: governing / columns / Math.max(columnCapacity, 1), beamUtilization: beamDemand / Math.max(beamCapacity, 1), foundationPressureKPa: foundationPressure, foundationUtilization: foundationPressure / Math.max(profile.materials.soilBearingKPa, 1) }, reinforcementWarnings: ["Rebar size, spacing, anchorage, development, splice, confinement, crack control, and durability are not designed by this screen."], connectionWarnings: ["Beam-column, diaphragm, collector, base plate, anchor, and foundation connections are not modeled by this screen."], warnings, validation: { valid: errors.length === 0, errors } };
}
