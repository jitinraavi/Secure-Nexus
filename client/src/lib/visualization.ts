import type { ConstructionPhase, Design, VisualizationSettings } from "../types";
import { calculateConstructionSchedule, constructionPhaseStartPercent, type ConstructionScheduleReport } from "./constructionSchedule";

export const DEFAULT_PHASES: ConstructionPhase[] = [
  { id: "site", name: "Site preparation", start: 0, end: 20, durationDays: 40, color: "#f59e0b" },
  { id: "structure", name: "Structure", start: 20, end: 60, durationDays: 80, dependsOn: ["site"], color: "#38bdf8" },
  { id: "envelope", name: "Envelope & infrastructure", start: 60, end: 82, durationDays: 44, dependsOn: ["structure"], color: "#a78bfa" },
  { id: "fitout", name: "Fit-out & community", start: 82, end: 100, durationDays: 36, dependsOn: ["envelope"], color: "#34d399" },
];

const normalizedPhaseCache = new WeakMap<object, ConstructionPhase[]>();
const scheduleInputs = new WeakMap<ConstructionPhase[], unknown>();

function phaseRecord(value: unknown): value is ConstructionPhase {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const phase = value as Partial<ConstructionPhase>;
  const numericFields = [phase.start, phase.end];
  const optionalNumbers = [phase.durationDays, phase.earliestStartDay, phase.crewSize, phase.costEstimate, phase.progressPercent, phase.actualCost];
  return typeof phase.id === "string" && typeof phase.name === "string"
    && numericFields.every((number) => typeof number === "number" && Number.isFinite(number))
    && optionalNumbers.every((number) => number === undefined || (typeof number === "number" && Number.isFinite(number)))
    && (phase.dependsOn === undefined || (Array.isArray(phase.dependsOn) && phase.dependsOn.every((id) => typeof id === "string")))
    && (phase.color === undefined || typeof phase.color === "string");
}

function safePhases(raw: unknown): ConstructionPhase[] {
  if (raw && typeof raw === "object") {
    const cached = normalizedPhaseCache.get(raw);
    if (cached) return cached;
  }
  if (Array.isArray(raw) && raw.every(phaseRecord)) {
    if (!scheduleInputs.has(raw)) {
      normalizedPhaseCache.set(raw, raw);
      return raw;
    }
    // After an explicit save uses the safe array, stop reporting discarded rows.
    const recovered = normalizedPhaseCache.get(raw) ?? raw.slice();
    normalizedPhaseCache.set(raw, recovered);
    return recovered;
  }
  const phases = Array.isArray(raw) ? raw.filter(phaseRecord) : [];
  scheduleInputs.set(phases, raw);
  if (raw && typeof raw === "object") normalizedPhaseCache.set(raw, phases);
  return phases;
}

export function visualizationSettings(value: Design["visualization"]): VisualizationSettings {
  const phases = value?.phases === undefined ? DEFAULT_PHASES : safePhases(value.phases);
  return {
    enabled: value?.enabled ?? true,
    time: Number.isFinite(value?.time) ? Math.min(100, Math.max(0, value!.time)) : 100,
    playing: false,
    walkthrough: value?.walkthrough ?? false,
    renderQuality: value?.renderQuality ?? "balanced",
    cameraPath: value?.cameraPath ?? [],
    phases,
    schedule: value?.schedule,
  };
}

export function phaseVisible(phaseId: string | undefined, value: VisualizationSettings): boolean {
  if (!value.enabled || !phaseId) return true;
  const phase = value.phases.find((item) => item.id === phaseId);
  if (!phase) return true;
  if (value.schedule?.mode === "dependency") {
    const report = cachedConstructionSchedule(value);
    // An invalid plan must not hide model objects using a partial calculation.
    if (!report.valid) return true;
    return (constructionPhaseStartPercent(report, phaseId) ?? 0) <= value.time;
  }
  return phase.start <= value.time;
}

const scheduleCache = new WeakMap<ConstructionPhase[], { settings: VisualizationSettings["schedule"]; report: ConstructionScheduleReport }>();

export function cachedConstructionSchedule(value: VisualizationSettings): ConstructionScheduleReport {
  const cached = scheduleCache.get(value.phases);
  if (cached && cached.settings === value.schedule) return cached.report;
  const raw = scheduleInputs.has(value.phases) ? scheduleInputs.get(value.phases) : value.phases;
  const report = calculateConstructionSchedule(raw as ConstructionPhase[], value.schedule);
  if (raw !== value.phases) {
    report.valid = false;
    report.phases = [];
    report.resources = [];
    report.durationDays = 0;
    report.totals = { plannedCost: 0, actualCost: 0, earnedValue: 0, costVariance: 0, progressPercent: 0, crewDays: 0, peakCrew: 0 };
    report.baseline = undefined;
    report.errors.push("Malformed saved phase records were excluded from the phase controls. Saving visualization or phase changes removes these malformed records.");
  }
  scheduleCache.set(value.phases, { settings: value.schedule, report });
  return report;
}

export function auditConstructionSchedule(phases: ConstructionPhase[]): string[] {
  const report = calculateConstructionSchedule(phases);
  const warnings: string[] = [...report.errors, ...report.warnings];
  if (phases.length > 1000) return warnings;
  const byId = new Map(phases.map((phase) => [phase.id, phase]));
  for (const phase of phases) {
    if (!Number.isFinite(phase.start) || !Number.isFinite(phase.end) || phase.start < 0 || phase.end > 100 || phase.start >= phase.end) {
      warnings.push(`${phase.name}: manual timeline must form an increasing range from 0 to 100%.`);
    }
    for (const dependencyId of phase.dependsOn ?? []) {
      const dependency = byId.get(dependencyId);
      if (dependency && dependency.end > phase.start) {
        warnings.push(`${phase.name}: manual timeline starts before predecessor “${dependency.name}” finishes.`);
      }
    }
  }
  return [...new Set(warnings)];
}

export function latestVisibleConstructionPhase(value: VisualizationSettings): ConstructionPhase | undefined {
  if (!value.enabled) return undefined;
  const report = value.schedule?.mode === "dependency" ? cachedConstructionSchedule(value) : undefined;
  if (report && !report.valid) return undefined;
  let latest: ConstructionPhase | undefined;
  let latestStart = -Infinity;
  for (const phase of value.phases) {
    const start = report ? constructionPhaseStartPercent(report, phase.id) : phase.start;
    if (start !== undefined && start <= value.time && start >= latestStart) {
      latest = phase;
      latestStart = start;
    }
  }
  return latest;
}

