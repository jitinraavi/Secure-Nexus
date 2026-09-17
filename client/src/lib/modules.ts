import type { ProjectType } from "../types";

/**
 * Project-type routing.
 *
 * The product is now the guided wizards: house/interiors, the residential &
 * commercial community builder, and the infrastructure wizards (highway,
 * airport, ports, dams). Legacy studio & infrastructure types resolve to the
 * closest guided wizard so old saved rows still open something sensible.
 */

/** Guided infrastructure wizards backed by lib/infra.ts. */
export const INFRA_TYPES: ProjectType[] = ["highway", "airport", "ports", "dams"];

export function isInfraType(t: ProjectType | string | undefined | null): t is ProjectType {
  return typeof t === "string" && (INFRA_TYPES as string[]).includes(t);
}

/** Legacy project types that fold into their merged guided wizard. */
const LEGACY_MODEL_MAP: Record<string, ProjectType> = {
  roadways: "highway",
  spillways: "dams",
};

/** Types the UI still understands (everything else falls back to the house editor). */
const KEPT_TYPES: ProjectType[] = ["house", "residential", "villa-community", "townhouse", "commercial", ...INFRA_TYPES];

export function resolveModelType(t: ProjectType | string | undefined | null): ProjectType {
  if (!t) return "house";
  const mapped = LEGACY_MODEL_MAP[t] ?? t;
  return (KEPT_TYPES as string[]).includes(mapped) ? (mapped as ProjectType) : "house";
}
