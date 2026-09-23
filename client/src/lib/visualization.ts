import type { ConstructionPhase, Design, VisualizationSettings } from "../types";

export const DEFAULT_PHASES: ConstructionPhase[] = [
  { id: "site", name: "Site preparation", start: 0, end: 20, color: "#f59e0b" },
  { id: "structure", name: "Structure", start: 20, end: 60, color: "#38bdf8" },
  { id: "envelope", name: "Envelope & infrastructure", start: 60, end: 82, color: "#a78bfa" },
  { id: "fitout", name: "Fit-out & community", start: 82, end: 100, color: "#34d399" },
];

export function visualizationSettings(value: Design["visualization"]): VisualizationSettings {
  const phases = value?.phases?.length ? value.phases : DEFAULT_PHASES;
  return {
    enabled: value?.enabled ?? true,
    time: Math.min(100, Math.max(0, value?.time ?? 100)),
    playing: false,
    walkthrough: value?.walkthrough ?? false,
    renderQuality: value?.renderQuality ?? "balanced",
    cameraPath: value?.cameraPath ?? [],
    phases,
  };
}

export function phaseVisible(phaseId: string | undefined, value: VisualizationSettings): boolean {
  if (!value.enabled || !phaseId) return true;
  const phase = value.phases.find((item) => item.id === phaseId);
  return !phase || phase.start <= value.time;
}

export function auditConstructionSchedule(phases: ConstructionPhase[]): string[] {
  const warnings: string[] = [];
  const ids = new Set(phases.map((phase) => phase.id));
  for (const phase of phases) {
    if (phase.start < 0 || phase.end > 100 || phase.start >= phase.end) warnings.push(`${phase.name}: timeline start/end must form an increasing range from 0 to 100%.`);
    if (phase.durationDays !== undefined && (!Number.isFinite(phase.durationDays) || phase.durationDays <= 0)) warnings.push(`${phase.name}: duration must be greater than zero.`);
    if (phase.crewSize !== undefined && (!Number.isFinite(phase.crewSize) || phase.crewSize < 1)) warnings.push(`${phase.name}: crew size must be at least one.`);
    if (phase.costEstimate !== undefined && (!Number.isFinite(phase.costEstimate) || phase.costEstimate < 0)) warnings.push(`${phase.name}: cost estimate cannot be negative.`);
    for (const dependencyId of phase.dependsOn ?? []) {
      const dependency = phases.find((item) => item.id === dependencyId);
      if (!ids.has(dependencyId)) warnings.push(`${phase.name}: a dependency refers to a missing phase.`);
      else if (dependency && dependency.end > phase.start) warnings.push(`${phase.name}: dependency “${dependency.name}” ends after this phase starts.`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const phase = phases.find((item) => item.id === id);
    for (const dependency of phase?.dependsOn ?? []) if (visit(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (phases.some((phase) => visit(phase.id))) warnings.push("Schedule dependencies contain a cycle.");
  return [...new Set(warnings)];
}
