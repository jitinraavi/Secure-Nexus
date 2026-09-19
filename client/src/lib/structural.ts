import type { CommunityDesign, StructuralLoadCombination, StructuralSettings, TowerData } from "../types";
import { towerMeters } from "./community";

export const DEFAULT_STRUCTURAL_SETTINGS: StructuralSettings = {
  enabled: true,
  deadLoadKPa: 5,
  liveLoadKPa: 2,
  concreteStrengthMPa: 25,
  soilBearingKPa: 150,
  columnWidthM: 0.4,
  columnDepthM: 0.4,
  beamWidthM: 0.25,
  beamDepthM: 0.5,
  footingWidthM: 2,
  footingDepthM: 2,
  safetyFactor: 1.5,
  windPressureKPa: 1,
  seismicCoefficient: 0.12,
  loadCombinations: [
    { id: "gravity", label: "1.4D", deadFactor: 1.4, liveFactor: 0, windFactor: 0, seismicFactor: 0 },
    { id: "gravity-live", label: "1.2D + 1.6L", deadFactor: 1.2, liveFactor: 1.6, windFactor: 0, seismicFactor: 0 },
    { id: "wind", label: "1.2D + L + W", deadFactor: 1.2, liveFactor: 1, windFactor: 1, seismicFactor: 0 },
    { id: "seismic", label: "1.2D + L + E", deadFactor: 1.2, liveFactor: 1, windFactor: 0, seismicFactor: 1 },
    { id: "uplift-wind", label: "0.9D + W", deadFactor: 0.9, liveFactor: 0, windFactor: 1, seismicFactor: 0 },
  ],
};

export function defaultLoadCombinations(): StructuralLoadCombination[] {
  return DEFAULT_STRUCTURAL_SETTINGS.loadCombinations!.map((combination) => ({ ...combination }));
}

export function structuralSettings(value?: Partial<StructuralSettings>): StructuralSettings {
  const next = { ...DEFAULT_STRUCTURAL_SETTINGS, ...value };
  return {
    enabled: Boolean(next.enabled),
    deadLoadKPa: Math.max(Number(next.deadLoadKPa) || 5, 0),
    liveLoadKPa: Math.max(Number(next.liveLoadKPa) || 2, 0),
    concreteStrengthMPa: Math.max(Number(next.concreteStrengthMPa) || 25, 10),
    soilBearingKPa: Math.max(Number(next.soilBearingKPa) || 150, 25),
    columnWidthM: Math.max(Number(next.columnWidthM) || 0.4, 0.15),
    columnDepthM: Math.max(Number(next.columnDepthM) || 0.4, 0.15),
    beamWidthM: Math.max(Number(next.beamWidthM) || 0.25, 0.15),
    beamDepthM: Math.max(Number(next.beamDepthM) || 0.5, 0.2),
    footingWidthM: Math.max(Number(next.footingWidthM) || 2, 0.5),
    footingDepthM: Math.max(Number(next.footingDepthM) || 2, 0.5),
    safetyFactor: Math.max(Number(next.safetyFactor) || 1.5, 1),
    windPressureKPa: Math.max(Number.isFinite(Number(next.windPressureKPa)) ? Number(next.windPressureKPa) : 1, 0),
    seismicCoefficient: Math.max(Number.isFinite(Number(next.seismicCoefficient)) ? Number(next.seismicCoefficient) : 0.12, 0),
    loadCombinations: (next.loadCombinations?.length ? next.loadCombinations : defaultLoadCombinations()).map((combination) => ({
      ...combination,
      deadFactor: Number(combination.deadFactor) || 0,
      liveFactor: Number(combination.liveFactor) || 0,
      windFactor: Number(combination.windFactor) || 0,
      seismicFactor: Number(combination.seismicFactor) || 0,
    })),
  };
}

export type StructuralCheck = { status: "pass" | "warning"; text: string };

export interface TowerStructuralResult {
  tower: TowerData;
  areaM2: number;
  heightM: number;
  estimatedLoadKN: number;
  columnCount: number;
  draftedColumnCount: number;
  columnUtilization: number;
  beamSpanM: number;
  beamUtilization: number;
  foundationPressureKPa: number;
  footingAreaM2: number;
  windBaseShearKN: number;
  seismicBaseShearKN: number;
  governingCombination: string;
  governingLoadKN: number;
  lateralUtilization: number;
  reinforcementWarning: string;
  connectionWarnings: string[];
  checks: StructuralCheck[];
}

export interface StructuralAnalysis {
  settings: StructuralSettings;
  totalAreaM2: number;
  totalLoadKN: number;
  totalWindBaseShearKN: number;
  totalSeismicBaseShearKN: number;
  loadCombinations: StructuralLoadCombination[];
  results: TowerStructuralResult[];
  warnings: string[];
}

export function analyzeCommunity(design: CommunityDesign): StructuralAnalysis {
  const settings = structuralSettings(design.structural);
  if (!settings.enabled) {
    return {
      settings,
      totalAreaM2: 0,
      totalLoadKN: 0,
      totalWindBaseShearKN: 0,
      totalSeismicBaseShearKN: 0,
      loadCombinations: settings.loadCombinations ?? [],
      results: [],
      warnings: ["Preliminary screening estimates are disabled.", "Enable screening estimates to calculate planning-level checks."],
    };
  }

  const structuralDrafts = design.drafts ?? [];
  const draftedColumnCount = structuralDrafts.filter((draft) => draft.kind === "column").length;
  const draftedElementCount = structuralDrafts.filter((draft) => draft.kind === "wall" || draft.kind === "slab" || draft.kind === "column" || draft.kind === "roof").length;
  const results = design.towers.map((tower) => {
    const size = towerMeters(tower);
    const areaM2 = size.w * size.d;
    const loadKN = areaM2 * Math.max(tower.floors, 1) * (settings.deadLoadKPa + settings.liveLoadKPa);
    const deadKN = areaM2 * Math.max(tower.floors, 1) * settings.deadLoadKPa;
    const liveKN = areaM2 * Math.max(tower.floors, 1) * settings.liveLoadKPa;
    const gridX = design.structuralGrid?.filter((line) => line.axis === "x").length ?? 0;
    const gridZ = design.structuralGrid?.filter((line) => line.axis === "z").length ?? 0;
    const gridColumnCount = Math.max(4, (gridX + 1) * (gridZ + 1));
    // Drafted columns are explicit coordination geometry; legacy designs use the grid fallback.
    const columnCount = draftedColumnCount > 0 ? draftedColumnCount : gridColumnCount;
    const columnCapacityKN = settings.concreteStrengthMPa * settings.columnWidthM * settings.columnDepthM * 1000 / settings.safetyFactor;
    const columnUtilization = loadKN / columnCount / columnCapacityKN;
    const beamSpanM = Math.max(size.w / Math.max(gridX, 1), size.d / Math.max(gridZ, 1));
    const beamCapacityKNM = settings.concreteStrengthMPa * settings.beamWidthM * settings.beamDepthM * settings.beamDepthM * 1000 / settings.safetyFactor;
    const beamDemandKNM = (settings.deadLoadKPa + settings.liveLoadKPa) * Math.max(size.w, size.d) * beamSpanM * beamSpanM / 8;
    const beamUtilization = beamDemandKNM / Math.max(beamCapacityKNM, 1);
    const footingAreaM2 = settings.footingWidthM * settings.footingDepthM;
    const foundationPressureKPa = loadKN / (footingAreaM2 * columnCount);
    const windBaseShearKN = settings.windPressureKPa! * size.w * size.h;
    const seismicBaseShearKN = settings.seismicCoefficient! * deadKN;
    const combinations = settings.loadCombinations ?? [];
    const combinationLoads = combinations.map((combination) => ({
      combination,
      loadKN: combination.deadFactor * deadKN + combination.liveFactor * liveKN + combination.windFactor * windBaseShearKN + combination.seismicFactor * seismicBaseShearKN,
    }));
    const governing = combinationLoads.reduce((winner, current) => current.loadKN > winner.loadKN ? current : winner, combinationLoads[0] ?? { combination: { id: "screen", label: "Screen", deadFactor: 1, liveFactor: 1, windFactor: 0, seismicFactor: 0 }, loadKN });
    const lateralDemandKN = Math.max(windBaseShearKN, seismicBaseShearKN);
    const lateralCapacityKN = settings.concreteStrengthMPa * settings.columnWidthM * settings.columnDepthM * columnCount * 0.1 * 1000 / settings.safetyFactor;
    const lateralUtilization = lateralDemandKN / Math.max(lateralCapacityKN, 1);
    const connectionWarnings = [
      ...(design.structuralGrid?.length ? [] : ["Structural grid is not defined; collector and diaphragm connections cannot be coordinated."]),
      ...(draftedColumnCount ? [] : ["No drafted columns are available; column-to-beam and foundation connections are not represented."]),
      ...(structuralDrafts.some((draft) => draft.kind === "wall") ? [] : ["No drafted lateral walls are available; verify the selected lateral-force-resisting system."]),
    ];
    const checks: StructuralCheck[] = [
      { status: governing.loadKN / columnCount / columnCapacityKN <= 1 ? "pass" : "warning", text: `${draftedColumnCount > 0 ? "Drafted" : "Fallback"} column screening utilization ${((governing.loadKN / columnCount / columnCapacityKN) * 100).toFixed(0)}% under ${governing.combination.label}` },
      { status: beamUtilization <= 1 ? "pass" : "warning", text: `Beam screening utilization ${(beamUtilization * 100).toFixed(0)}%` },
      { status: foundationPressureKPa <= settings.soilBearingKPa ? "pass" : "warning", text: `Foundation pressure ${foundationPressureKPa.toFixed(0)} kPa vs ${settings.soilBearingKPa.toFixed(0)} kPa soil input` },
      { status: lateralUtilization <= 1 ? "pass" : "warning", text: `Lateral demand screen ${lateralUtilization.toFixed(2)}x (${lateralDemandKN.toFixed(0)} kN demand)` },
    ];
    return { tower, areaM2, heightM: size.h, estimatedLoadKN: loadKN, columnCount, draftedColumnCount, columnUtilization, beamSpanM, beamUtilization, foundationPressureKPa, footingAreaM2, windBaseShearKN, seismicBaseShearKN, governingCombination: governing.combination.label, governingLoadKN: governing.loadKN, lateralUtilization, reinforcementWarning: "Reinforcement quantities, anchorage, development, splice, confinement, and crack control are not designed by this screen.", connectionWarnings, checks };
  });
  return {
    settings,
    totalAreaM2: results.reduce((sum, result) => sum + result.areaM2 * Math.max(result.tower.floors, 1), 0),
    totalLoadKN: results.reduce((sum, result) => sum + result.estimatedLoadKN, 0),
    totalWindBaseShearKN: results.reduce((sum, result) => sum + result.windBaseShearKN, 0),
    totalSeismicBaseShearKN: results.reduce((sum, result) => sum + result.seismicBaseShearKN, 0),
    loadCombinations: settings.loadCombinations ?? [],
    results,
    warnings: [
      "Preliminary screening only: assumptions are simplified and do not represent a structural design.",
      "Wind and seismic results are demand screens, not code-level analysis; confirm hazard, exposure, ductility, irregularity, drift, torsion, and load paths with the engineer of record.",
      ...(design.towers.length === 0 ? ["Add at least one tower or block to produce checks."] : []),
      ...(design.structuralGrid?.length || draftedColumnCount ? [] : ["No structural grid or drafted columns are defined; default column count is used."]),
      ...(draftedElementCount ? [`${draftedElementCount} drafted structural element${draftedElementCount === 1 ? "" : "s"} included as coordination context.`] : ["No drafted structural elements are defined; column checks use the grid fallback."]),
    ],
  };
}
