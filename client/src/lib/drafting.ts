import type { CommunityDesign, DraftElement, DraftGrip, DraftingSettings } from "../types";

export const DEFAULT_DRAFTING_SETTINGS: DraftingSettings = {
  gridVisible: true,
  gridSize: 0.5,
  snapEnabled: true,
  orthogonal: true,
  angleIncrement: 15,
  alignment: true,
};

export function draftingSettings(value?: Partial<DraftingSettings>): DraftingSettings {
  const next = { ...DEFAULT_DRAFTING_SETTINGS, ...value };
  return {
    gridVisible: Boolean(next.gridVisible),
    gridSize: Math.min(Math.max(Number(next.gridSize) || 0.5, 0.1), 10),
    snapEnabled: Boolean(next.snapEnabled),
    orthogonal: Boolean(next.orthogonal),
    angleIncrement: [0, 5, 15, 30, 45, 90].includes(Number(next.angleIncrement)) ? Number(next.angleIncrement) : 15,
    alignment: Boolean(next.alignment),
  };
}

function nearest(value: number, candidates: number[], tolerance: number): number {
  let best = value;
  let distance = tolerance;
  for (const candidate of candidates) {
    const delta = Math.abs(candidate - value);
    if (delta <= distance) {
      best = candidate;
      distance = delta;
    }
  }
  return best;
}

export function snapDraftPoint(
  point: { x: number; z: number },
  settings: DraftingSettings,
  design: CommunityDesign,
): { x: number; z: number } {
  if (!settings.snapEnabled) return point;
  const size = settings.gridSize;
  const tolerance = Math.min(size * 0.6, 1.25);
  const grid = (value: number) => Math.round(value / size) * size;
  let x = grid(point.x);
  let z = grid(point.z);
  if (settings.alignment) {
    const xs = [...(design.drafts ?? []).map((item) => item.x), ...design.towers.map((item) => item.x), ...design.amenities.map((item) => item.x)];
    const zs = [...(design.drafts ?? []).map((item) => item.z), ...design.towers.map((item) => item.z), ...design.amenities.map((item) => item.z)];
    x = nearest(x, xs, tolerance);
    z = nearest(z, zs, tolerance);
  }
  return { x, z };
}

export function constrainDraftEnd(
  start: { x: number; z: number },
  end: { x: number; z: number },
  kind: string,
  settings: DraftingSettings,
  design: CommunityDesign,
): { x: number; z: number; rotationDeg: number } {
  let x = end.x;
  let z = end.z;
  let dx = x - start.x;
  let dz = z - start.z;
  if (settings.orthogonal && (kind === "line" || kind === "dimension")) {
    if (Math.abs(dx) >= Math.abs(dz)) z = start.z;
    else x = start.x;
    dx = x - start.x;
    dz = z - start.z;
  } else if (settings.angleIncrement > 0 && (kind === "line" || kind === "dimension")) {
    const angle = Math.atan2(dz, dx);
    const increment = (settings.angleIncrement * Math.PI) / 180;
    const snapped = Math.round(angle / increment) * increment;
    const length = Math.hypot(dx, dz);
    x = start.x + Math.cos(snapped) * length;
    z = start.z + Math.sin(snapped) * length;
    dx = x - start.x;
    dz = z - start.z;
  }
  const snapped = snapDraftPoint({ x, z }, settings, design);
  return { ...snapped, rotationDeg: (Math.atan2(dz, dx) * 180) / Math.PI };
}

export function constrainedDraftSize(value: number, settings: DraftingSettings): number {
  if (!settings.snapEnabled) return Math.max(value, 0.1);
  return Math.max(Math.round(value / settings.gridSize) * settings.gridSize, settings.gridSize);
}

/** Applies only explicit, locked relationships; absent metadata keeps legacy behavior. */
export function constrainedDraftPatch(
  draft: DraftElement,
  patch: Partial<DraftElement>,
  drafts: DraftElement[],
): Partial<DraftElement> {
  const next = { ...patch };
  const locks = draft.locks ?? {};
  if (locks.x) delete next.x;
  if (locks.z) delete next.z;
  if (locks.width) delete next.w;
  if (locks.depth) delete next.d;
  if (locks.height) delete next.h;
  if (locks.rotation) delete next.rotationDeg;

  for (const constraint of draft.constraints ?? []) {
    if (!constraint.locked || !constraint.targetId) continue;
    const target = drafts.find((item) => item.id === constraint.targetId);
    if (!target) continue;
    if (constraint.kind === "alignment") {
      if (constraint.axis === "x") next.x = target.x;
      else if (constraint.axis === "z") next.z = target.z;
      else { next.x = target.x; next.z = target.z; }
    } else if (constraint.kind === "parallel") {
      next.rotationDeg = target.rotationDeg;
    } else if (constraint.kind === "perpendicular") {
      next.rotationDeg = target.rotationDeg + 90;
    } else if (constraint.kind === "level") {
      next.elevationM = target.elevationM ?? 0;
    } else if (constraint.kind === "equal") {
      next.w = target.w;
      next.d = target.d;
    }
  }
  return next;
}

/** Small, deterministic CAD edits. Missing optional metadata is never changed. */
export function applyDraftOperation(
  draft: DraftElement,
  operation: "trim" | "extend" | "offset" | "rotate" | "mirror",
): Partial<DraftElement> {
  const linear = draft.kind === "line" || draft.kind === "dimension";
  const step = Math.max(Math.min(draft.w || draft.d, 1), 0.1);
  if (operation === "trim") return linear ? { w: Math.max(draft.w - step, 0.1) } : { w: Math.max(draft.w - step, 0.1), d: Math.max(draft.d - step, 0.1) };
  if (operation === "extend") return linear ? { w: draft.w + step } : { w: draft.w + step, d: draft.d + step };
  if (operation === "offset") return linear ? { x: draft.x + step } : { w: draft.w + step * 2, d: draft.d + step * 2 };
  if (operation === "rotate") return { rotationDeg: (draft.rotationDeg + 90) % 360 };
  return { x: -draft.x, rotationDeg: (360 - draft.rotationDeg) % 360 };
}

export function patchDraftGrip(draft: DraftElement, grip: DraftGrip, delta: number): Partial<DraftElement> {
  if (grip === "width-start") return { x: draft.x + delta / 2, w: Math.max(draft.w - delta, 0.1) };
  if (grip === "width-end") return { x: draft.x + delta / 2, w: Math.max(draft.w + delta, 0.1) };
  if (grip === "depth-start") return { z: draft.z + delta / 2, d: Math.max(draft.d - delta, 0.1) };
  return { z: draft.z + delta / 2, d: Math.max(draft.d + delta, 0.1) };
}

export function duplicateDraftArray(draft: DraftElement, count = 3, spacing = 1): DraftElement[] {
  return Array.from({ length: Math.max(2, Math.min(Math.round(count), 20)) }, (_, index) => ({
    ...draft,
    id: `${draft.id}-copy-${Date.now()}-${index}`,
    x: draft.x + index * spacing,
  }));
}
