import type { DraftElement, ParametricConstraintAnchor } from "../types";

export interface PlanPoint {
  x: number;
  z: number;
}

export type DraftReferenceKind = "endpoint" | "midpoint" | "center";

export interface DraftReferencePoint {
  point: PlanPoint;
  kind: DraftReferenceKind;
  sourceId: string;
  anchor: ParametricConstraintAnchor;
}

const toRad = (degrees: number) => (degrees * Math.PI) / 180;

export function normalizeDegrees(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function rotatePlanPoint(point: PlanPoint, degrees: number): PlanPoint {
  const angle = toRad(degrees);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.z * sin,
    z: point.x * sin + point.z * cos,
  };
}

export function translatePlanPoint(point: PlanPoint, origin: PlanPoint): PlanPoint {
  return { x: point.x + origin.x, z: point.z + origin.z };
}

export function draftDirection(draft: DraftElement): PlanPoint {
  const angle = toRad(draft.rotationDeg);
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

function localToWorld(draft: DraftElement, point: PlanPoint): PlanPoint {
  return translatePlanPoint(rotatePlanPoint(point, draft.rotationDeg), { x: draft.x, z: draft.z });
}

export function draftAnchorPoint(
  draft: DraftElement,
  anchor: ParametricConstraintAnchor = "center",
): PlanPoint {
  if (anchor === "center" || anchor === "midpoint") return { x: draft.x, z: draft.z };

  if (draft.kind === "line" || draft.kind === "dimension") {
    const direction = draftDirection(draft);
    const sign = anchor === "start" ? -1 : 1;
    return {
      x: draft.x + direction.x * (draft.w / 2) * sign,
      z: draft.z + direction.z * (draft.w / 2) * sign,
    };
  }

  const sign = anchor === "start" ? -1 : 1;
  return localToWorld(draft, { x: (draft.w / 2) * sign, z: (draft.d / 2) * sign });
}

export function draftReferencePoints(draft: DraftElement): DraftReferencePoint[] {
  const references: DraftReferencePoint[] = [
    { point: { x: draft.x, z: draft.z }, kind: "center", sourceId: draft.id, anchor: "center" },
  ];

  if (draft.kind === "line" || draft.kind === "dimension") {
    references.push(
      { point: draftAnchorPoint(draft, "start"), kind: "endpoint", sourceId: draft.id, anchor: "start" },
      { point: draftAnchorPoint(draft, "end"), kind: "endpoint", sourceId: draft.id, anchor: "end" },
      { point: draftAnchorPoint(draft, "midpoint"), kind: "midpoint", sourceId: draft.id, anchor: "midpoint" },
    );
    return references;
  }

  if (draft.kind === "circle") {
    const radius = Math.max(Math.min(draft.w, draft.d) / 2, 0.01);
    for (const point of [
      { x: radius, z: 0 },
      { x: -radius, z: 0 },
      { x: 0, z: radius },
      { x: 0, z: -radius },
    ]) {
      references.push({
        point: localToWorld(draft, point),
        kind: "endpoint",
        sourceId: draft.id,
        anchor: "end",
      });
    }
    return references;
  }

  const corners = [
    { x: -draft.w / 2, z: -draft.d / 2 },
    { x: draft.w / 2, z: -draft.d / 2 },
    { x: draft.w / 2, z: draft.d / 2 },
    { x: -draft.w / 2, z: draft.d / 2 },
  ];
  for (const corner of corners) {
    references.push({
      point: localToWorld(draft, corner),
      kind: "endpoint",
      sourceId: draft.id,
      anchor: "end",
    });
  }

  const mids = [
    { x: -draft.w / 2, z: 0 },
    { x: draft.w / 2, z: 0 },
    { x: 0, z: -draft.d / 2 },
    { x: 0, z: draft.d / 2 },
  ];
  for (const midpoint of mids) {
    references.push({
      point: localToWorld(draft, midpoint),
      kind: "midpoint",
      sourceId: draft.id,
      anchor: "midpoint",
    });
  }
  return references;
}

export function planDistanceSquared(a: PlanPoint, b: PlanPoint): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function projectPointToDraftAxis(point: PlanPoint, target: DraftElement): PlanPoint {
  const origin = { x: target.x, z: target.z };
  const direction = draftDirection(target);
  const dx = point.x - origin.x;
  const dz = point.z - origin.z;
  const distance = dx * direction.x + dz * direction.z;
  return {
    x: origin.x + direction.x * distance,
    z: origin.z + direction.z * distance,
  };
}

