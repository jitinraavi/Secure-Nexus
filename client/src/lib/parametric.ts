import type { BuildingLevel, DraftElement, ParametricFamilyMetadata, RoomOpening, TowerOpening } from "../types";

const numberParameter = (family: ParametricFamilyMetadata | undefined, scope: "typeParameters" | "instanceParameters", key: string): number | undefined => {
  const value = family?.[scope]?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

export interface ResolvedDraft {
  width: number;
  depth: number;
  height: number;
  elevation: number;
  slope: number;
  overhang: number;
  thickness: number;
}

/** Lowers family/type/instance intent to the legacy DraftElement envelope. */
export function resolveDraft(draft: DraftElement, levels: BuildingLevel[] = []): ResolvedDraft {
  const family = draft.family;
  const type = (key: string) => numberParameter(family, "typeParameters", key);
  const instance = (key: string) => numberParameter(family, "instanceParameters", key);
  const level = family?.levelId ? levels.find((item) => item.id === family.levelId) : undefined;
  const thickness = type("thickness") ?? (draft.kind === "wall" ? draft.d : draft.kind === "slab" || draft.kind === "roof" ? draft.h ?? 0.2 : draft.d);
  const overhang = instance("overhang") ?? 0;
  const topOffset = instance("topOffset") ?? 0;
  const width = Math.max(type("width") ?? draft.w, 0.01) + (draft.kind === "roof" ? overhang * 2 : 0);
  const depth = Math.max(type("depth") ?? (draft.kind === "wall" ? thickness : draft.d), 0.01) + (draft.kind === "roof" ? overhang * 2 : 0);
  const defaultHeight = draft.kind === "column" ? 3 : draft.kind === "wall" ? (level?.floorHeight ?? 2.7) : draft.kind === "slab" || draft.kind === "roof" ? thickness : 0.25;
  const height = Math.max(type("height") ?? (draft.kind === "wall" && level ? level.floorHeight + topOffset : draft.h ?? defaultHeight), 0.01);
  const elevation = (level?.elevation ?? draft.elevationM ?? 0) + (instance("baseOffset") ?? 0);
  return {
    width,
    depth,
    height,
    elevation,
    slope: instance("slope") ?? type("slope") ?? 0,
    overhang,
    thickness: Math.max(thickness, 0.01),
  };
}

export function resolveRoomOpening(opening: RoomOpening, hostSpan?: number): { width: number; height: number; sill: number; offset: number } {
  const family = opening.family;
  const width = numberParameter(family, "typeParameters", "width") ?? opening.widthM;
  const height = numberParameter(family, "typeParameters", "height") ?? opening.heightM;
  const sill = numberParameter(family, "instanceParameters", "sill") ?? opening.sillM;
  const safeWidth = Math.max(width, 0.05);
  return { width: safeWidth, height: Math.max(height, 0.05), sill: Math.max(sill, 0), offset: hostSpan ? Math.max(Math.min(opening.offsetM, hostSpan / 2 - safeWidth / 2), -hostSpan / 2 + safeWidth / 2) : opening.offsetM };
}

export function resolveTowerOpening(opening: TowerOpening, hostSpan?: number): { width: number; height: number; sill: number; offset: number } {
  const family = opening.family;
  const width = numberParameter(family, "typeParameters", "width") ?? opening.width;
  const height = numberParameter(family, "typeParameters", "height") ?? opening.height;
  const sill = numberParameter(family, "instanceParameters", "sill") ?? opening.sill;
  const safeWidth = Math.max(width, 0.05);
  return { width: safeWidth, height: Math.max(height, 0.05), sill: Math.max(sill, 0), offset: hostSpan ? Math.max(Math.min(opening.offset, hostSpan / 2 - safeWidth / 2), -hostSpan / 2 + safeWidth / 2) : opening.offset };
}

export function parametricIssues(draft: DraftElement, levels: BuildingLevel[] = []): string[] {
  const issues: string[] = [];
  const resolved = resolveDraft(draft, levels);
  if (resolved.width <= 0 || resolved.depth <= 0 || resolved.height <= 0) issues.push("Resolved family dimensions must be positive.");
  if (draft.family?.levelId && !levels.some((level) => level.id === draft.family?.levelId)) issues.push("Family level reference does not exist.");
  if (draft.family?.hostId && !draft.family.hostId.trim()) issues.push("Host reference cannot be empty.");
  return issues;
}

/** Keeps the existing dimension fields useful when a typed family is present. */
export function syncDraftFamilyParameters(draft: DraftElement, patch: Partial<DraftElement>): Partial<DraftElement> {
  if (!draft.family) return patch;
  const family = { ...draft.family, typeParameters: { ...(draft.family.typeParameters ?? {}) } };
  if (typeof patch.w === "number" && "width" in family.typeParameters) family.typeParameters.width = patch.w;
  if (typeof patch.d === "number") {
    if ("depth" in family.typeParameters) family.typeParameters.depth = patch.d;
    else if (draft.kind === "wall" || draft.kind === "slab" || draft.kind === "roof") family.typeParameters.thickness = patch.d;
  }
  if (typeof patch.h === "number" && "height" in family.typeParameters) family.typeParameters.height = patch.h;
  return { ...patch, family };
}
