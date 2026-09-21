import type { EngineeringCodeProfile, StructuralSettings } from "../types";

export const DEFAULT_ENGINEERING_PROFILE: EngineeringCodeProfile = {
  id: "planning-si",
  name: "Planning SI profile",
  unitSystem: "SI",
  loadFactors: { dead: 1.2, live: 1.6, wind: 1, seismic: 1 },
  wind: { pressureKPa: 1, importanceFactor: 1, exposureFactor: 1 },
  seismic: { coefficient: 0.12, importanceFactor: 1, responseFactor: 1 },
  materials: { concreteMPa: 25, steelMPa: 500, masonryMPa: 5, soilBearingKPa: 150 },
  occupancy: { category: "unknown", liveLoadKPa: 2, peoplePerM2: 0.1 },
  assumptions: { driftLimitRatio: 1 / 500, safetyFactor: 1.5, designAirVelocityMps: 5, pipeVelocityMps: 1.5, electricalDemandFactor: 0.8 },
};

const finite = (value: unknown, fallback: number, minimum = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(number, minimum) : fallback;
};

export function engineeringProfile(value?: Partial<EngineeringCodeProfile>): EngineeringCodeProfile {
  const next = value ?? {};
  return {
    ...DEFAULT_ENGINEERING_PROFILE,
    ...next,
    loadFactors: { ...DEFAULT_ENGINEERING_PROFILE.loadFactors, ...next.loadFactors },
    wind: { ...DEFAULT_ENGINEERING_PROFILE.wind, ...next.wind },
    seismic: { ...DEFAULT_ENGINEERING_PROFILE.seismic, ...next.seismic },
    materials: { ...DEFAULT_ENGINEERING_PROFILE.materials, ...next.materials },
    occupancy: { ...DEFAULT_ENGINEERING_PROFILE.occupancy, ...next.occupancy },
    assumptions: { ...DEFAULT_ENGINEERING_PROFILE.assumptions, ...next.assumptions },
  };
}

export function profileFromStructuralSettings(settings: StructuralSettings): EngineeringCodeProfile {
  const base = engineeringProfile();
  return engineeringProfile({
    id: settings.codeProfileId ?? base.id,
    materials: { ...base.materials, concreteMPa: settings.concreteStrengthMPa, soilBearingKPa: settings.soilBearingKPa },
    occupancy: { ...base.occupancy, category: settings.occupancyCategory, liveLoadKPa: settings.liveLoadKPa },
    wind: { ...base.wind, pressureKPa: settings.windPressureKPa ?? base.wind.pressureKPa },
    seismic: { ...base.seismic, coefficient: settings.seismicCoefficient ?? base.seismic.coefficient },
    assumptions: { ...base.assumptions, driftLimitRatio: settings.driftLimitRatio ?? base.assumptions.driftLimitRatio, safetyFactor: settings.safetyFactor },
  });
}

export function validateEngineeringProfile(profile: Partial<EngineeringCodeProfile>): string[] {
  const errors: string[] = [];
  if (!profile.id?.trim()) errors.push("Profile id is required.");
  if (!profile.name?.trim()) errors.push("Profile name is required.");
  if (profile.unitSystem !== undefined && !["SI", "imperial"].includes(profile.unitSystem)) errors.push("Unit system must be SI or imperial.");
  const numericPaths: [string, unknown, number][] = [
    ["wind.pressureKPa", profile.wind?.pressureKPa, 0], ["seismic.coefficient", profile.seismic?.coefficient, 0],
    ["materials.concreteMPa", profile.materials?.concreteMPa, 0], ["materials.soilBearingKPa", profile.materials?.soilBearingKPa, 0],
    ["assumptions.driftLimitRatio", profile.assumptions?.driftLimitRatio, 0], ["assumptions.safetyFactor", profile.assumptions?.safetyFactor, 1],
  ];
  for (const [path, value, minimum] of numericPaths) if (value !== undefined && finite(value, NaN, minimum) !== Number(value)) errors.push(`${path} must be a finite number >= ${minimum}.`);
  return errors;
}
