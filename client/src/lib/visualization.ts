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
