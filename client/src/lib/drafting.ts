import type { CommunityDesign, DraftElement, DraftGrip, DraftingSettings, ParametricConstraintAnchor } from "../types";
import { draftAnchorPoint, draftReferencePoints, normalizeDegrees, planDistanceSquared, projectPointToDraftAxis, type PlanPoint } from "./geometry2d";
import { syncDraftFamilyParameters } from "./parametric";

export const DEFAULT_DRAFTING_SETTINGS: DraftingSettings = {
  gridVisible: true,
  gridSize: 0.5,
  snapEnabled: true,
  orthogonal: true,
  angleIncrement: 15,
  alignment: true,
  endpointSnap: true,
  midpointSnap: true,
  centerSnap: true,
  snapTolerance: 0.35,
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
    endpointSnap: next.endpointSnap !== false,
    midpointSnap: next.midpointSnap !== false,
    centerSnap: next.centerSnap !== false,
    snapTolerance: Math.min(Math.max(Number(next.snapTolerance) || 0.35, 0.05), 5),
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

export interface SnapDraftPointOptions {
  ignoreDraftId?: string;
}

export function snapDraftPoint(
  point: PlanPoint,
  settings: DraftingSettings,
  design: CommunityDesign,
  options: SnapDraftPointOptions = {},
): PlanPoint {
  const normalized = draftingSettings(settings);
  if (!normalized.snapEnabled) return point;

  const tolerance = normalized.snapTolerance ?? Math.min(normalized.gridSize * 0.6, 1.25);
  const references = (design.drafts ?? [])
    .filter((draft) => draft.id !== options.ignoreDraftId)
    .flatMap(draftReferencePoints)
    .filter((reference) => {
      if (reference.kind === "endpoint") return normalized.endpointSnap !== false;
      if (reference.kind === "midpoint") return normalized.midpointSnap !== false;
      return normalized.centerSnap !== false;
    });

  let best: { point: PlanPoint; distance: number; priority: number } | null = null;
  const priority = { endpoint: 0, midpoint: 1, center: 2 } as const;
  for (const reference of references) {
    const distance = Math.sqrt(planDistanceSquared(point, reference.point));
    if (distance > tolerance) continue;
    const candidate = { point: reference.point, distance, priority: priority[reference.kind] };
    if (
      !best ||
      candidate.distance < best.distance - 1e-9 ||
      (Math.abs(candidate.distance - best.distance) <= 1e-9 && candidate.priority < best.priority)
    ) {
      best = candidate;
    }
  }
  if (best) return { ...best.point };

  const grid = (value: number) => Math.round(value / normalized.gridSize) * normalized.gridSize;
  let x = grid(point.x);
  let z = grid(point.z);

  if (normalized.alignment) {
    const xs = [
      ...references.map((reference) => reference.point.x),
      ...design.towers.map((item) => item.x),
      ...design.amenities.map((item) => item.x),
      ...(design.structuralGrid ?? []).filter((item) => item.axis === "x").map((item) => item.position),
    ];
    const zs = [
      ...references.map((reference) => reference.point.z),
      ...design.towers.map((item) => item.z),
      ...design.amenities.map((item) => item.z),
      ...(design.structuralGrid ?? []).filter((item) => item.axis === "z").map((item) => item.position),
    ];
    x = nearest(x, xs, tolerance);
    z = nearest(z, zs, tolerance);
  }

  return { x, z };
}

export function constrainDraftEnd(
  start: PlanPoint,
  end: PlanPoint,
  kind: string,
  settings: DraftingSettings,
  design: CommunityDesign,
): { x: number; z: number; rotationDeg: number } {
  const normalized = draftingSettings(settings);
  let x = end.x;
  let z = end.z;
  let dx = x - start.x;
  let dz = z - start.z;
  const linear = kind === "line" || kind === "dimension";

  if (normalized.orthogonal && linear) {
    if (Math.abs(dx) >= Math.abs(dz)) z = start.z;
    else x = start.x;
  } else if (normalized.angleIncrement > 0 && linear) {
    const angle = Math.atan2(dz, dx);
    const increment = (normalized.angleIncrement * Math.PI) / 180;
    const snappedAngle = Math.round(angle / increment) * increment;
    const length = Math.hypot(dx, dz);
    x = start.x + Math.cos(snappedAngle) * length;
    z = start.z + Math.sin(snappedAngle) * length;
  }

  const snapped = snapDraftPoint({ x, z }, normalized, design);
  x = snapped.x;
  z = snapped.z;

  if (normalized.orthogonal && linear) {
    const rawDx = x - start.x;
    const rawDz = z - start.z;
    if (Math.abs(rawDx) >= Math.abs(rawDz)) z = start.z;
    else x = start.x;
  }

  dx = x - start.x;
  dz = z - start.z;
  return { x, z, rotationDeg: normalizeDegrees((Math.atan2(dz, dx) * 180) / Math.PI) };
}

export function constrainedDraftSize(value: number, settings: DraftingSettings): number {
  if (!settings.snapEnabled) return Math.max(value, 0.1);
  return Math.max(Math.round(value / settings.gridSize) * settings.gridSize, settings.gridSize);
}

/** Applies explicit locked relationships while keeping legacy designs valid. */
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

  const working: DraftElement = { ...draft, ...next };
  const relation = constraintPatchForDraft(working, drafts.map((item) => item.id === draft.id ? working : item));
  return { ...next, ...relation };
}

function anchor(value?: ParametricConstraintAnchor): ParametricConstraintAnchor {
  return value ?? "center";
}

function constraintPatchForDraft(draft: DraftElement, drafts: DraftElement[]): Partial<DraftElement> {
  let working = draft;
  const accumulated: Partial<DraftElement> = {};

  const apply = (patch: Partial<DraftElement>) => {
    Object.assign(accumulated, patch);
    working = { ...working, ...patch };
  };

  for (const constraint of working.constraints ?? []) {
    if (!constraint.locked || !constraint.targetId || constraint.targetId === working.id) continue;
    const target = drafts.find((item) => item.id === constraint.targetId);
    if (!target) continue;

    if (constraint.kind === "alignment") {
      if (constraint.axis === "x") apply({ x: target.x });
      else if (constraint.axis === "z") apply({ z: target.z });
      else apply({ x: target.x, z: target.z });
      continue;
    }

    if (constraint.kind === "coincident") {
      const sourcePoint = draftAnchorPoint(working, anchor(constraint.anchor));
      const targetPoint = draftAnchorPoint(target, anchor(constraint.targetAnchor));
      const dx = targetPoint.x - sourcePoint.x;
      const dz = targetPoint.z - sourcePoint.z;
      if (constraint.axis === "x") apply({ x: working.x + dx });
      else if (constraint.axis === "z") apply({ z: working.z + dz });
      else apply({ x: working.x + dx, z: working.z + dz });
      continue;
    }

    if (constraint.kind === "collinear") {
      const projected = projectPointToDraftAxis({ x: working.x, z: working.z }, target);
      const patch: Partial<DraftElement> = { rotationDeg: normalizeDegrees(target.rotationDeg) };
      if (constraint.axis !== "z") patch.x = projected.x;
      if (constraint.axis !== "x") patch.z = projected.z;
      apply(patch);
      continue;
    }

    if (constraint.kind === "parallel") {
      apply({ rotationDeg: normalizeDegrees(target.rotationDeg) });
      continue;
    }

    if (constraint.kind === "perpendicular") {
      apply({ rotationDeg: normalizeDegrees(target.rotationDeg + 90) });
      continue;
    }

    if (constraint.kind === "level") {
      apply({ elevationM: target.elevationM ?? 0 });
      continue;
    }

    if (constraint.kind === "equal") {
      const equalPatch: Partial<DraftElement> = { w: target.w, d: target.d };
      if (typeof target.h === "number") equalPatch.h = target.h;
      apply(equalPatch);
    }
  }

  return accumulated;
}

function applyDraftPatch(draft: DraftElement, patch: Partial<DraftElement>): DraftElement {
  if (Object.keys(patch).length === 0) return draft;
  return { ...draft, ...syncDraftFamilyParameters(draft, patch) };
}

function draftChanged(a: DraftElement, b: DraftElement): boolean {
  return (
    Math.abs(a.x - b.x) > 1e-8 ||
    Math.abs(a.z - b.z) > 1e-8 ||
    Math.abs(a.w - b.w) > 1e-8 ||
    Math.abs(a.d - b.d) > 1e-8 ||
    Math.abs((a.h ?? 0) - (b.h ?? 0)) > 1e-8 ||
    Math.abs(normalizeDegrees(a.rotationDeg) - normalizeDegrees(b.rotationDeg)) > 1e-8 ||
    Math.abs((a.elevationM ?? 0) - (b.elevationM ?? 0)) > 1e-8
  );
}

/**
 * Resolves the edited element and all downstream locked relationships.
 * The capped fixed-point loop makes dependency chains deterministic while
 * preventing malformed circular constraints from hanging the editor.
 */
export function solveDraftConstraintGraph(
  drafts: DraftElement[],
  changedId: string,
  patch: Partial<DraftElement>,
  maxPasses = 12,
): DraftElement[] {
  if (!drafts.some((draft) => draft.id === changedId)) return drafts;

  let next = drafts.map((draft) => {
    if (draft.id !== changedId) return draft;
    return applyDraftPatch(draft, constrainedDraftPatch(draft, patch, drafts));
  });

  for (let pass = 0; pass < Math.max(1, maxPasses); pass += 1) {
    const snapshot = next;
    let changed = false;
    next = snapshot.map((draft) => {
      const relationPatch = constraintPatchForDraft(draft, snapshot);
      const resolved = applyDraftPatch(draft, relationPatch);
      if (draftChanged(draft, resolved)) changed = true;
      return resolved;
    });
    if (!changed) break;
  }

  return next;
}

export interface DraftConstraintIssue {
  draftId: string;
  constraintId: string;
  code: "missing-target" | "self-target";
  message: string;
}

export function draftConstraintIssues(drafts: DraftElement[]): DraftConstraintIssue[] {
  const ids = new Set(drafts.map((draft) => draft.id));
  const issues: DraftConstraintIssue[] = [];
  for (const draft of drafts) {
    for (const constraint of draft.constraints ?? []) {
      if (!constraint.locked || !constraint.targetId) continue;
      if (constraint.targetId === draft.id) {
        issues.push({
          draftId: draft.id,
          constraintId: constraint.id,
          code: "self-target",
          message: "A parametric constraint cannot target the same element.",
        });
      } else if (!ids.has(constraint.targetId)) {
        issues.push({
          draftId: draft.id,
          constraintId: constraint.id,
          code: "missing-target",
          message: "The parametric constraint target no longer exists.",
        });
      }
    }
  }
  return issues;
}

/** Small, deterministic CAD edits./** Small, deterministic CAD edits. Missing optional metadata is never changed. */
export function applyDraftOperation(
  draft: DraftElement,
  operation: "trim" | "extend" | "offset" | "rotate" | "mirror" | "fillet" | "chamfer",
): Partial<DraftElement> {
  const linear = draft.kind === "line" || draft.kind === "dimension" || draft.kind === "polyline" || draft.kind === "spline";
  const step = Math.max(Math.min(draft.w || draft.d, 1), 0.1);
  const path = draft.points?.map((point) => ({ ...point }));

  if (operation === "trim") {
    if (path && path.length > 2) return { points: path.slice(0, -1) };
    return linear ? { w: Math.max(draft.w - step, 0.1) } : { w: Math.max(draft.w - step, 0.1), d: Math.max(draft.d - step, 0.1) };
  }
  if (operation === "extend") {
    if (path && path.length >= 2) {
      const a = path[path.length - 2];
      const b = path[path.length - 1];
      const length = Math.max(Math.hypot(b.x - a.x, b.z - a.z), 0.001);
      path.push({ x: b.x + ((b.x - a.x) / length) * step, z: b.z + ((b.z - a.z) / length) * step });
      return { points: path };
    }
    return linear ? { w: draft.w + step } : { w: draft.w + step, d: draft.d + step };
  }
  if (operation === "offset") {
    if (path && path.length >= 2) {
      const a = path[0];
      const b = path[path.length - 1];
      const length = Math.max(Math.hypot(b.x - a.x, b.z - a.z), 0.001);
      const nx = -(b.z - a.z) / length;
      const nz = (b.x - a.x) / length;
      return { points: path.map((point) => ({ x: point.x + nx * step, z: point.z + nz * step })) };
    }
    return linear ? { x: draft.x + step } : { w: draft.w + step * 2, d: draft.d + step * 2 };
  }
  if (operation === "rotate") return { rotationDeg: normalizeDegrees(draft.rotationDeg + 90) };
  if (operation === "mirror") {
    return {
      x: -draft.x,
      rotationDeg: normalizeDegrees(360 - draft.rotationDeg),
      ...(path ? { points: path.map((point) => ({ x: -point.x, z: point.z })) } : {}),
    };
  }
  if (operation === "fillet") {
    const radius = Math.max(Math.min(draft.radiusM ?? step * 0.5, Math.max(draft.w, draft.d) / 2), 0.05);
    return { radiusM: radius };
  }
  const bevel = Math.max(Math.min(step * 0.35, Math.max(draft.w, draft.d) / 3), 0.05);
  if (path && path.length >= 2) {
    const next = path.slice();
    const first = next[0];
    const last = next[next.length - 1];
    next[0] = { x: first.x + bevel, z: first.z + bevel };
    next[next.length - 1] = { x: last.x - bevel, z: last.z - bevel };
    return { points: next, radiusM: 0 };
  }
  return { w: Math.max(draft.w - bevel, 0.1), d: Math.max(draft.d - bevel, 0.1), radiusM: 0 };
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

