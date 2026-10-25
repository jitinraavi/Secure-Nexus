import type { BuildingLevel, CadAnalysisRecord, Design, DraftElement, DraftElementKind, MepDesign } from "../types";
import { resolveDraft } from "./parametric";
import { solveDraftConstraintGraph } from "./drafting";
import { removeCadNetworkElement, validateCadNetworks } from "./cadNetworks";

export interface CadVec3 { x: number; y: number; z: number; }
export type CadKind = DraftElementKind | "circular-column";
export const CAD_MIN_SIZE_M = 0.01;
export const CAD_MAX_SIZE_M = 10000;
const KINDS: DraftElementKind[] = ["line", "polyline", "arc", "spline", "rectangle", "circle", "dimension", "wall", "slab", "column", "beam", "roof"];
const SOLIDS = new Set(["wall", "slab", "column", "beam", "roof"]);
const DEFAULT_LEVELS: BuildingLevel[] = [{ id: "cad-ground", name: "Ground", elevation: 0, floorHeight: 3 }];
const clone = <T>(value: T): T => structuredClone(value);
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const finite = (value: number, label: string, min = -1e6, max = 1e6) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be finite and between ${min} and ${max}.`);
  return value;
};
const idValid = (id: string) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id);
type FootprintPoint = { x: number; z: number };
const polygonFootprint = (object: DraftElement) => (object.kind === "slab" || object.kind === "roof") && object.points?.length ? object.points : undefined;
/** Signed shoelace area is evaluated in local metres, independently of visibility. */
export function cadFootprintArea(object: DraftElement, levels: BuildingLevel[] = []): number {
  const points = polygonFootprint(object);
  if (points) return Math.abs(points.reduce((sum, point, i) => { const next = points[(i + 1) % points.length]; return sum + point.x * next.z - next.x * point.z; }, 0)) / 2;
  const resolved = resolveDraft(object, levels);
  return cadKind(object) === "circular-column" ? Math.PI * resolved.width ** 2 / 4 : resolved.width * resolved.depth;
}
function validateFootprint(points: FootprintPoint[]): void {
  const vertices = points.length > 1 && points[0].x === points[points.length - 1].x && points[0].z === points[points.length - 1].z ? points.slice(0, -1) : points;
  if (vertices.length < 3) throw new Error("A slab or roof footprint requires at least three distinct vertices.");
  if (vertices.length > 1024) throw new Error("Editable solid footprints support up to 1,024 boundary vertices.");
  let twiceArea = 0;
  const orientation = (a: FootprintPoint, b: FootprintPoint, c: FootprintPoint) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const onSegment = (a: FootprintPoint, b: FootprintPoint, p: FootprintPoint) => Math.abs(orientation(a, b, p)) < 1e-10 && p.x >= Math.min(a.x, b.x) - 1e-10 && p.x <= Math.max(a.x, b.x) + 1e-10 && p.z >= Math.min(a.z, b.z) - 1e-10 && p.z <= Math.max(a.z, b.z) + 1e-10;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 1e-8) throw new Error("Footprint edges must have nonzero length.");
    const after = vertices[(i + 2) % vertices.length];
    if (Math.abs(orientation(a, b, after)) < 1e-10 && (b.x - a.x) * (after.x - b.x) + (b.z - a.z) * (after.z - b.z) < 0) throw new Error("Footprint boundary edges cannot reverse over one another.");
    twiceArea += a.x * b.z - b.x * a.z;
    for (let j = i + 2; j < vertices.length; j++) {
      if (i === 0 && j === vertices.length - 1) continue;
      const c = vertices[j], d = vertices[(j + 1) % vertices.length];
      if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x) || Math.max(a.z, b.z) < Math.min(c.z, d.z) || Math.max(c.z, d.z) < Math.min(a.z, b.z)) continue;
      const ac = orientation(a, b, c), ad = orientation(a, b, d), ca = orientation(c, d, a), cb = orientation(c, d, b);
      if ((ac * ad < 0 && ca * cb < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) throw new Error("Footprint boundaries cannot self-intersect or overlap.");
    }
  }
  if (Math.abs(twiceArea) < 2e-8) throw new Error("Footprint area must be positive.");
}

/** Legacy project collections remain the sole persistent geometry source. */
export function cadObjects(design: Design): DraftElement[] { return design.community ? design.community.drafts ?? [] : design.infra ? design.infra.drafts ?? [] : design.drafts ?? []; }
export function setCadObjects(design: Design, objects: DraftElement[]): Design {
  return design.community ? { ...design, community: { ...design.community, drafts: objects } }
    : design.infra ? { ...design, infra: { ...design.infra, drafts: objects } } : { ...design, drafts: objects };
}
export function cadLevels(design: Design): BuildingLevel[] { return design.community?.levels?.length ? design.community.levels : design.cad?.levels?.length ? design.cad.levels : DEFAULT_LEVELS; }
export function cadMep(design: Design): MepDesign | undefined { return design.community ? design.community.mep : design.infra ? design.infra.mep : design.mep; }
export function setCadMep(design: Design, mep: MepDesign): Design {
  return design.community ? { ...design, community: { ...design.community, mep } } : design.infra ? { ...design, infra: { ...design.infra, mep } } : { ...design, mep };
}
export function cadKind(object: DraftElement): CadKind { return object.kind === "column" && object.family?.type === "circular-column" ? "circular-column" : object.kind; }
export function resolvedCadObject(object: DraftElement, levels: BuildingLevel[] = []) { return { id: object.id, kind: cadKind(object), x: object.x, z: object.z, rotationDeg: object.rotationDeg, ...resolveDraft(object, levels) }; }
export function createCadObject(kind: CadKind, level?: BuildingLevel): DraftElement {
  const actual = kind === "circular-column" ? "column" : kind;
  if (!KINDS.includes(actual)) throw new Error("Unsupported architectural object type.");
  const size = actual === "wall" ? [4, .2, 3] : actual === "beam" ? [4, .3, .45] : actual === "slab" ? [6, 4, .2] : actual === "roof" ? [6, 4, .18] : actual === "column" ? [.4, .4, 3] : [2, 1, .02];
  return { id: crypto.randomUUID(), kind: actual, x: 0, z: 0, w: size[0], d: size[1], h: size[2], elevationM: level?.elevation ?? 0, rotationDeg: 0, color: actual === "column" || actual === "beam" ? "#adb7c0" : actual === "slab" ? "#637784" : actual === "roof" ? "#8a7e6b" : "#d3d0c5", label: kind === "circular-column" ? "Circular column" : `${actual[0].toUpperCase()}${actual.slice(1)}`, family: { family: "groundwork-cad", type: kind, ...(level ? { levelId: level.id, instanceParameters: { baseOffset: 0 } } : {}) }, visible: true, locked: false };
}

function updateFamilyDimensions(original: DraftElement, next: DraftElement, changed: Partial<DraftElement>): DraftElement {
  if (!original.family && !next.family) return next;
  if (changed.w === undefined && changed.d === undefined && changed.h === undefined) return next;
  const family = { ...(next.family ?? original.family), typeParameters: { ...original.family?.typeParameters, ...next.family?.typeParameters }, instanceParameters: { ...original.family?.instanceParameters, ...next.family?.instanceParameters } };
  const params = family.typeParameters;
  if (changed.w !== undefined) params.width = next.w;
  if (changed.d !== undefined) { params.depth = next.d; if (next.kind === "wall") params.thickness = next.d; }
  if (changed.h !== undefined) { params.height = next.h!; if (next.kind === "slab" || next.kind === "roof") params.thickness = next.h!; }
  return { ...next, family };
}

/** Local axes follow Three.js' positive Y rotation, never screen-pixel scaling. */
export function localCadAxis(object: DraftElement, axis: "x" | "y" | "z"): CadVec3 {
  const angle = object.rotationDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return axis === "x" ? { x: c, y: 0, z: -s } : axis === "z" ? { x: s, y: 0, z: c } : { x: 0, y: 1, z: 0 };
}

/** Returns a new object; the original stays usable as an Escape/cancel snapshot. */
export function resizeDraft(original: DraftElement, axis: "x" | "y" | "z", side: -1 | 1, nextSizeM: number, symmetric = false, levels: BuildingLevel[] = []): DraftElement {
  finite(nextSizeM, "Dimension", CAD_MIN_SIZE_M, CAD_MAX_SIZE_M);
  if (side !== -1 && side !== 1) throw new Error("Resize grip requires a negative or positive face.");
  if (original.locked || original.locks?.[axis === "x" ? "width" : axis === "z" ? "depth" : "height"]) throw new Error("That object dimension is locked.");
  const r = resolveDraft(original, levels), points = polygonFootprint(original);
  const footprintBounds = points && axis !== "y" ? { min: Math.min(...points.map(point => point[axis])), max: Math.max(...points.map(point => point[axis])) } : undefined;
  const current = footprintBounds ? footprintBounds.max - footprintBounds.min : axis === "x" ? r.width : axis === "z" ? r.depth : r.height;
  const difference = nextSizeM - current;
  const overhang = original.kind === "roof" ? r.overhang * 2 : 0;
  const rawSize = axis === "y" ? nextSizeM : nextSizeM - overhang;
  finite(rawSize, "Dimension inside roof overhang", CAD_MIN_SIZE_M, CAD_MAX_SIZE_M);
  const patch: Partial<DraftElement> = axis === "x" ? { w: rawSize } : axis === "z" ? { d: rawSize } : { h: rawSize };
  if (cadKind(original) === "circular-column" && axis !== "y") { patch.w = nextSizeM; patch.d = nextSizeM; }
  let next = updateFamilyDimensions(original, { ...clone(original), ...patch }, patch);
  if (points && footprintBounds && axis !== "y") {
    if (current < CAD_MIN_SIZE_M) throw new Error("Footprint extent is too small to resize.");
    const center = (footprintBounds.min + footprintBounds.max) / 2, ratio = nextSizeM / current;
    next.points = points.map(point => ({ ...point, [axis]: center + (point[axis] - center) * ratio }));
  }
  if (axis === "y") {
    // Top is base + height; a bottom-face drag moves the base to keep the top fixed.
    const shift = symmetric ? -difference / 2 : side === -1 ? -difference : 0;
    if (shift) {
      next.elevationM = (original.elevationM ?? 0) + shift;
      const family = next.family;
      if (family?.levelId) next.family = { ...family, instanceParameters: { ...family.instanceParameters, baseOffset: Number(original.family?.instanceParameters?.baseOffset ?? 0) + shift } };
      // For an unhosted legacy baseOffset, keep the existing offset and move raw elevation.
    }
  } else if (!symmetric) {
    const direction = localCadAxis(original, axis);
    next.x = original.x + direction.x * side * difference / 2;
    next.z = original.z + direction.z * side * difference / 2;
  }
  validateCadObject(next, levels);
  return next;
}

/** Closest point parameter on a model-space axis to a camera ray. */
export function axisDragParameter(rayOrigin: CadVec3, rayDirection: CadVec3, axisOrigin: CadVec3, axisDirection: CadVec3): number | null {
  const dot = (a: CadVec3, b: CadVec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const normRay = Math.sqrt(dot(rayDirection, rayDirection)), normAxis = Math.sqrt(dot(axisDirection, axisDirection));
  if (![normRay, normAxis].every(value => Number.isFinite(value) && value > 1e-12)) return null;
  const ray = { x: rayDirection.x / normRay, y: rayDirection.y / normRay, z: rayDirection.z / normRay };
  const axis = { x: axisDirection.x / normAxis, y: axisDirection.y / normAxis, z: axisDirection.z / normAxis };
  const w = { x: rayOrigin.x - axisOrigin.x, y: rayOrigin.y - axisOrigin.y, z: rayOrigin.z - axisOrigin.z };
  const b = dot(ray, axis), denominator = 1 - b * b;
  if (denominator < 1e-5) return null;
  const parameter = (dot(w, axis) - b * dot(w, ray)) / denominator;
  return Number.isFinite(parameter) ? parameter : null;
}

export function validateCadObject(object: DraftElement, levels: BuildingLevel[] = []): void {
  if (!object || !idValid(object.id) || !KINDS.includes(object.kind)) throw new Error("CAD objects require a stable valid ID and a supported type.");
  finite(object.x, "X"); finite(object.z, "Z"); finite(object.rotationDeg, "Rotation", -360000, 360000);
  if (object.elevationM !== undefined) finite(object.elevationM, "Elevation");
  const minimum = SOLIDS.has(object.kind) ? CAD_MIN_SIZE_M : 0;
  finite(object.w, "Width / span", minimum, CAD_MAX_SIZE_M); finite(object.d, "Depth", minimum, CAD_MAX_SIZE_M);
  if (object.h !== undefined) finite(object.h, "Height / thickness", CAD_MIN_SIZE_M, CAD_MAX_SIZE_M);
  if (!/^#[a-fA-F0-9]{6}$/.test(object.color)) throw new Error("CAD colour must be a six-digit hex value.");
  const r = resolveDraft(object, levels);
  if (SOLIDS.has(object.kind)) for (const [name, value] of Object.entries({ width: r.width, depth: r.depth, height: r.height })) finite(value, name, CAD_MIN_SIZE_M, CAD_MAX_SIZE_M);
  finite(r.elevation, "Resolved elevation");
  if (cadKind(object) === "circular-column" && Math.abs(r.width - r.depth) > 1e-8) throw new Error("Circular columns require matching diameter dimensions.");
  if (object.family?.levelId && !levels.some(level => level.id === object.family?.levelId)) throw new Error("The object's level reference is missing.");
  if (object.points) {
    if (object.points.length > 10000) throw new Error("Draft point count exceeds the supported limit.");
    for (const point of object.points) { finite(point.x, "Point X"); finite(point.z, "Point Z"); }
    if (polygonFootprint(object)) validateFootprint(object.points);
  }
  const openingIds = new Set<string>();
  for (const opening of object.openings ?? []) {
    if (object.kind !== "wall" || !idValid(opening.id) || openingIds.has(opening.id) || !["door", "window", "void"].includes(opening.kind)) throw new Error("Openings require unique IDs on a wall host.");
    openingIds.add(opening.id); finite(opening.widthM, "Opening width", .01, r.width); finite(opening.heightM, "Opening height", .01, r.height); finite(opening.sillM, "Opening sill", 0, r.height); finite(opening.offsetM, "Opening offset");
    if (Math.abs(opening.offsetM) + opening.widthM / 2 > r.width / 2 + 1e-8 || opening.sillM + opening.heightM > r.height + 1e-8) throw new Error("Opening lies outside the wall. Edit its dimensions before shrinking the host.");
    for (const other of object.openings ?? []) {
      if (other === opening || !openingIds.has(other.id)) continue;
      const horizontalOverlap = Math.min(opening.offsetM + opening.widthM / 2, other.offsetM + other.widthM / 2) - Math.max(opening.offsetM - opening.widthM / 2, other.offsetM - other.widthM / 2);
      const verticalOverlap = Math.min(opening.sillM + opening.heightM, other.sillM + other.heightM) - Math.max(opening.sillM, other.sillM);
      if (horizontalOverlap > 1e-8 && verticalOverlap > 1e-8) throw new Error("Wall openings cannot overlap; edit or merge the openings explicitly.");
    }
  }
}

function validateDocument(next: Design): void {
  if (!next || next.version !== 1 || !next.room || !Array.isArray(next.furniture)) throw new Error("Invalid project document; existing room and furniture data must be preserved.");
  const levels = cadLevels(next), levelIds = new Set<string>();
  for (const level of levels) {
    if (!idValid(level.id) || levelIds.has(level.id)) throw new Error("Levels require unique stable IDs.");
    levelIds.add(level.id); finite(level.elevation, "Level elevation"); finite(level.floorHeight, "Level height", .01, CAD_MAX_SIZE_M);
  }
  const ids = new Set<string>();
  if (cadObjects(next).length > 10000) throw new Error("This CAD workspace supports at most 10,000 authored objects.");
  for (const object of cadObjects(next)) { validateCadObject(object, levels); if (ids.has(object.id)) throw new Error("Duplicate CAD object ID."); ids.add(object.id); }
  const mep = cadMep(next);
  for (const element of mep?.elements ?? []) {
    if (!idValid(element.id) || ids.has(element.id)) throw new Error("MEP and CAD objects require globally unique IDs in the active model.");
    ids.add(element.id);
    if (!Array.isArray(element.route) || element.route.length > 10000) throw new Error("Invalid MEP route.");
    for (const point of element.route) { finite(point.x, "Route X"); finite(point.y, "Route elevation"); finite(point.z, "Route Z"); }
    finite(element.width, "Route width", 0, CAD_MAX_SIZE_M); finite(element.height, "Route height", 0, CAD_MAX_SIZE_M); finite(element.diameter, "Route diameter", 0, CAD_MAX_SIZE_M);
  }
  if (next.cadNetworks) validateCadNetworks(next);
}

const geometryFields = (object: DraftElement) => ({ ...object, label: undefined, color: undefined, visible: undefined, locked: undefined, locks: undefined, phaseId: undefined });
export function cadGeometryFingerprint(design: Design): string {
  // Stable deterministic identity, not a cryptographic signature or authorization token.
  const networks = design.cadNetworks ? { ...design.cadNetworks, calculations: undefined } : undefined;
  return JSON.stringify({ objects: cadObjects(design).map(geometryFields), levels: cadLevels(design), mep: cadMep(design)?.elements.map(item => ({ ...item, visible: undefined, color: undefined, name: undefined })), networks, engineeringBasis: design.engineeringBasis });
}
function ensureMutable(original: DraftElement, patch?: Partial<DraftElement>) {
  if (original.locked && (!patch || Object.keys(patch).some(key => !["id", "locked", "visible", "label", "color"].includes(key)))) throw new Error("The selected object is locked. Unlock it before editing.");
  if (!patch) return;
  const pairs: [keyof NonNullable<DraftElement["locks"]>, keyof DraftElement][] = [["x", "x"], ["z", "z"], ["width", "w"], ["depth", "d"], ["height", "h"], ["rotation", "rotationDeg"]];
  for (const [lock, field] of pairs) if (original.locks?.[lock] && patch[field] !== undefined && !eq(patch[field], original[field])) throw new Error(`${field} is constrained/locked.`);
  const changed = { ...original, ...patch }, before = resolveDraft(original), after = resolveDraft(changed);
  for (const [lock, key] of [["width", "width"], ["depth", "depth"], ["height", "height"]] as const) if (original.locks?.[lock] && before[key] !== after[key]) throw new Error(`${key} is constrained/locked.`);
  if (original.locks?.level && patch.family?.levelId !== undefined && patch.family.levelId !== original.family?.levelId) throw new Error("The object's level is locked.");
}

interface Revisioned { expectedRevision?: number; }
export type CadCommand = Revisioned & (
  | { type: "create"; object: DraftElement }
  | { type: "modify"; id: string; patch: Partial<DraftElement> }
  | { type: "delete"; ids: string[] }
  | { type: "duplicate"; ids: string[]; offset?: CadVec3 }
  | { type: "batch"; commands: CadCommand[] }
  | { type: "replace"; next: Design }
  | { type: "record-analysis"; record: CadAnalysisRecord }
);

function applyRaw(design: Design, command: CadCommand, depth = 0): Design {
  if (depth > 20) throw new Error("Nested command depth exceeds the supported limit.");
  if (command.expectedRevision !== undefined && command.expectedRevision !== (design.cad?.revision ?? 0)) throw new Error("CAD revision conflict inside command batch.");
  const objects = cadObjects(design);
  if (command.type === "batch") {
    if (command.commands.length > 1000) throw new Error("Command batch is too large.");
    return command.commands.reduce((next, child) => applyRaw(next, child, depth + 1), design);
  }
  if (command.type === "replace") return clone(command.next);
  if (command.type === "create") { if (objects.some(item => item.id === command.object.id)) throw new Error("An object with that ID already exists."); return setCadObjects(design, [...objects, clone(command.object)]); }
  if (command.type === "modify") {
    const original = objects.find(item => item.id === command.id); if (!original) throw new Error("Selected object no longer exists.");
    if (command.patch.id !== undefined && command.patch.id !== command.id) throw new Error("Object IDs cannot be modified.");
    if (command.patch.kind !== undefined && command.patch.kind !== original.kind) throw new Error("Use a new typed object to change its architectural type.");
    ensureMutable(original, command.patch);
    const patch = clone(command.patch), next = updateFamilyDimensions(original, { ...original, ...patch, id: original.id }, patch);
    if (polygonFootprint(original) && patch.points === undefined && (patch.w !== undefined || patch.d !== undefined)) {
      // A property/automation command must change the actual boundary too. Face drags
      // supply their already-anchored points explicitly; a bare size patch is symmetric.
      const resolved = resolveDraft(next, cadLevels(design));
      next.points = original.points!.map(point => ({ ...point }));
      for (const [axis, dimension, changed] of [["x", resolved.width, patch.w], ["z", resolved.depth, patch.d]] as const) {
        if (changed === undefined) continue;
        const values = original.points!.map(point => point[axis]), min = Math.min(...values), max = Math.max(...values), center = (min + max) / 2;
        if (max - min < CAD_MIN_SIZE_M) throw new Error("Footprint extent is too small to resize.");
        next.points = next.points.map(point => ({ ...point, [axis]: center + (point[axis] - center) * dimension / (max - min) }));
      }
    }
    const linked = objects.some(item => item.constraints?.some(constraint => constraint.targetId === original.id)) || original.constraints?.length;
    return setCadObjects(design, linked ? solveDraftConstraintGraph(objects, original.id, next) : objects.map(item => item.id === original.id ? next : item));
  }
  if (command.type === "delete" || command.type === "duplicate") {
    const chosen = new Set(command.ids);
    const mepIds = new Set(cadMep(design)?.elements.map(item => item.id) ?? []);
    if (!chosen.size || command.ids.some(id => !objects.some(item => item.id === id) && !mepIds.has(id))) throw new Error("Command references a missing model object.");
    objects.filter(item => chosen.has(item.id)).forEach(item => ensureMutable(item));
    if (command.type === "delete") {
      // Hosted devices keep explicit missing-host references so the review can flag them.
      let result = setCadObjects(design, objects.filter(item => !chosen.has(item.id)).map(item => ({ ...item, constraints: item.constraints?.filter(constraint => !constraint.targetId || !chosen.has(constraint.targetId)) })));
      for (const id of chosen) if (mepIds.has(id)) result = removeCadNetworkElement(result, id);
      return result;
    }
    if ([...chosen].some(id => mepIds.has(id))) throw new Error("Duplicate architectural elements here. Add MEP devices through typed system placement so connector and circuit identities stay explicit.");
    const offset = command.offset ?? { x: 1, y: 0, z: 1 };
    finite(offset.x, "Duplicate X"); finite(offset.y, "Duplicate Y"); finite(offset.z, "Duplicate Z");
    const mapping = new Map([...chosen].map(id => [id, crypto.randomUUID()]));
    const duplicates = objects.filter(item => chosen.has(item.id)).map(item => {
      const copy = clone(item); copy.id = mapping.get(item.id)!; copy.x += offset.x; copy.z += offset.z; copy.elevationM = (copy.elevationM ?? 0) + offset.y; copy.label = `${copy.label ?? copy.kind} copy`;
      if (copy.family?.levelId) copy.family.instanceParameters = { ...copy.family.instanceParameters, baseOffset: Number(copy.family.instanceParameters?.baseOffset ?? 0) + offset.y };
      if (copy.family?.hostId && mapping.has(copy.family.hostId)) copy.family.hostId = mapping.get(copy.family.hostId);
      copy.openings = copy.openings?.map(opening => ({ ...opening, id: crypto.randomUUID() }));
      copy.constraints = copy.constraints?.map(constraint => ({ ...constraint, id: crypto.randomUUID(), ...(constraint.targetId && mapping.has(constraint.targetId) ? { targetId: mapping.get(constraint.targetId) } : {}) }));
      return copy;
    });
    return setCadObjects(design, [...objects, ...duplicates]);
  }
  throw new Error("Analysis recording cannot be nested in a geometry command batch.");
}

/** Pure atomic command boundary shared by properties, grips, routing and automation. */
export function executeCadCommand(design: Design, command: CadCommand, writable = true): Design {
  if (!writable) throw new Error("Project editing permission is required.");
  const revision = design.cad?.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER - 1) throw new Error("Invalid CAD model revision.");
  if (command.expectedRevision !== undefined && command.expectedRevision !== revision) throw new Error("CAD revision conflict. Rebase the command on the current model.");
  if (command.type === "record-analysis") {
    const record = clone(command.record);
    const ids = new Set([...cadObjects(design).map(object => object.id), ...(cadMep(design)?.elements.map(object => object.id) ?? [])]);
    if (!idValid(record.id) || record.sourceRevision !== revision || !record.sourceObjectIds.length || record.sourceObjectIds.some(id => !ids.has(id))) throw new Error("Analysis refers to a missing object or stale model revision.");
    if (!record.method || !record.units || !record.designBasis || !Array.isArray(record.assumptions)) throw new Error("Analysis requires method, units, authored basis and assumptions.");
    return { ...design, cad: { ...design.cad, version: 1, revision, analyses: [...(design.cad?.analyses ?? []).filter(item => item.id !== record.id), record] } };
  }
  let next = applyRaw(design, command);
  validateDocument(next);
  // A replacement cannot bypass locks or change stable IDs through an implicit rename.
  {
    const byId = new Map(cadObjects(next).map(item => [item.id, item]));
    for (const original of cadObjects(design)) {
      const current = byId.get(original.id);
      if (!current) ensureMutable(original);
      else if (!eq(original, current)) {
        const patch: Partial<DraftElement> = {};
        for (const field of new Set([...Object.keys(original), ...Object.keys(current)]) as Set<keyof DraftElement>) if (!eq(original[field], current[field])) Object.assign(patch, { [field]: current[field] });
        ensureMutable(original, patch);
      }
    }
  }
  if (eq(design, next)) return design;
  const changed = cadGeometryFingerprint(design) !== cadGeometryFingerprint(next);
  const nextRevision = changed ? revision + 1 : revision;
  const previous = new Map(cadObjects(design).map(item => [item.id, geometryFields(item)]));
  const after = new Map(cadObjects(next).map(item => [item.id, geometryFields(item)]));
  const affected = new Set([...previous.keys(), ...after.keys()].filter(id => !eq(previous.get(id), after.get(id))));
  const nonObjectChange = !eq(cadLevels(design), cadLevels(next)) || !eq(cadMep(design), cadMep(next)) || !eq(design.cadNetworks && { ...design.cadNetworks, calculations: undefined }, next.cadNetworks && { ...next.cadNetworks, calculations: undefined }) || !eq(design.engineeringBasis, next.engineeringBasis);
  next = { ...next, cad: { ...next.cad, version: 1, revision: nextRevision, analyses: (next.cad?.analyses ?? design.cad?.analyses)?.map(record => changed && record.status === "current" && (nonObjectChange || record.sourceObjectIds.some(id => affected.has(id))) ? { ...record, status: "needs-recalculation" } : record) } };
  return next;
}

export type CadSnapKind = "grid" | "endpoint" | "midpoint" | "center" | "edge" | "face" | "axis";
export interface CadSnap { point: CadVec3; kind: CadSnapKind; objectId?: string; distanceM: number; }
export function resolveCadSnap(point: CadVec3, design: Design, options: { enabled?: boolean; gridM?: number; toleranceM?: number; ignoreId?: string; kinds?: CadSnapKind[] } = {}): CadSnap | null {
  if (options.enabled === false) return null;
  const grid = options.gridM ?? .1, tolerance = options.toleranceM ?? Math.max(.01, grid * .6);
  if (!Number.isFinite(grid) || grid <= 0 || !Number.isFinite(tolerance) || tolerance <= 0) return null;
  const enabled = new Set(options.kinds ?? ["grid", "endpoint", "midpoint", "center", "edge", "face", "axis"]);
  const candidates: CadSnap[] = [];
  const add = (p: CadVec3, kind: CadSnapKind, objectId?: string) => { if (!enabled.has(kind)) return; const distanceM = Math.hypot(point.x - p.x, point.y - p.y, point.z - p.z); if (distanceM <= tolerance) candidates.push({ point: p, kind, objectId, distanceM }); };
  for (const object of cadObjects(design)) {
    if (object.id === options.ignoreId || object.visible === false) continue;
    const r = resolveDraft(object, cadLevels(design)), a = object.rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const world = (x: number, y: number, z: number): CadVec3 => ({ x: object.x + x * c + z * s, y: r.elevation + y, z: object.z - x * s + z * c });
    const wx = point.x - object.x, wz = point.z - object.z;
    const local = { x: wx * c - wz * s, y: point.y - r.elevation, z: wx * s + wz * c };
    const halfW = r.width / 2, halfD = r.depth / 2;
    const closestOnSegment = (a: FootprintPoint, b: FootprintPoint) => {
      const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
      const t = length2 > 1e-12 ? Math.max(0, Math.min(1, ((local.x - a.x) * dx + (local.z - a.z) * dz) / length2)) : 0;
      return { x: a.x + dx * t, z: a.z + dz * t };
    };
    const footprint = polygonFootprint(object);
    if (footprint) {
      let inside = false;
      for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
        const a = footprint[j], b = footprint[i], nearest = closestOnSegment(a, b);
        if ((a.z > local.z) !== (b.z > local.z) && local.x < (b.x - a.x) * (local.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
        for (const y of [0, r.height]) {
          add(world(a.x, y, a.z), "endpoint", object.id);
          add(world((a.x + b.x) / 2, y, (a.z + b.z) / 2), "midpoint", object.id);
          add(world(nearest.x, y, nearest.z), "edge", object.id);
        }
        add(world(a.x, Math.max(0, Math.min(r.height, local.y)), a.z), "edge", object.id);
        add(world(nearest.x, Math.max(0, Math.min(r.height, local.y)), nearest.z), "face", object.id);
      }
      if (inside) for (const y of [0, r.height]) add(world(local.x, y, local.z), "face", object.id);
      continue;
    }
    if (!SOLIDS.has(object.kind)) {
      if (object.kind === "circle" || object.kind === "arc") {
        const radius = object.radiusM ?? r.width / 2;
        const start = (object.startAngleDeg ?? 0) * Math.PI / 180, end = (object.endAngleDeg ?? (object.kind === "circle" ? 360 : 180)) * Math.PI / 180;
        const full = object.kind === "circle" || Math.abs(end - start) >= Math.PI * 2;
        const angle = Math.atan2(local.z, local.x), turn = Math.PI * 2;
        const wrap = (value: number) => ((value % turn) + turn) % turn;
        const within = full || (end >= start ? wrap(angle - start) <= wrap(end - start) : wrap(start - angle) <= wrap(start - end));
        add(world(0, .01, 0), "center", object.id);
        if (within) add(world(Math.cos(angle) * radius, .01, Math.sin(angle) * radius), "edge", object.id);
        if (!full) for (const a of [start, end]) add(world(Math.cos(a) * radius, .01, Math.sin(a) * radius), "endpoint", object.id);
      } else {
        const points = object.points?.length ? object.points : object.kind === "rectangle" ? [{ x: -halfW, z: -halfD }, { x: halfW, z: -halfD }, { x: halfW, z: halfD }, { x: -halfW, z: halfD }, { x: -halfW, z: -halfD }] : [{ x: -halfW, z: 0 }, { x: halfW, z: 0 }];
        for (let index = 0; index < points.length; index++) {
          const a = points[index]; add(world(a.x, .01, a.z), "endpoint", object.id);
          if (!index) continue;
          const b = points[index - 1], nearest = closestOnSegment(a, b);
          add(world((a.x + b.x) / 2, .01, (a.z + b.z) / 2), "midpoint", object.id);
          add(world(nearest.x, .01, nearest.z), "edge", object.id);
        }
      }
      continue;
    }
    add(world(0, r.height / 2, 0), "center", object.id);
    if (cadKind(object) === "circular-column") {
      const radius = r.width / 2, radial = Math.hypot(local.x, local.z);
      const ux = radial > 1e-12 ? local.x / radial : 1, uz = radial > 1e-12 ? local.z / radial : 0;
      for (const y of [0, r.height]) {
        add(world(0, y, 0), "center", object.id);
        add(world(ux * radius, y, uz * radius), "edge", object.id);
        const clipped = Math.min(radius, radial);
        add(world(ux * clipped, y, uz * clipped), "face", object.id);
        for (const [x, z] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) add(world(x, y, z), "midpoint", object.id);
      }
      add(world(ux * radius, Math.max(0, Math.min(r.height, local.y)), uz * radius), "face", object.id);
      continue;
    }
    for (const y of [0, r.height]) {
      for (const x of [-halfW, halfW]) for (const z of [-halfD, halfD]) add(world(x, y, z), "endpoint", object.id);
      for (const [x, z] of [[-halfW, 0], [halfW, 0], [0, -halfD], [0, halfD]]) add(world(x, y, z), "midpoint", object.id);
    }
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    for (const x of [-halfW, halfW]) add(world(x, clamp(local.y, 0, r.height), clamp(local.z, -halfD, halfD)), "face", object.id);
    const wallVoid = object.kind === "wall" && object.openings?.some(opening => Math.abs(local.x - opening.offsetM) < opening.widthM / 2 - 1e-8 && local.y > opening.sillM + 1e-8 && local.y < opening.sillM + opening.heightM - 1e-8);
    if (!wallVoid) for (const z of [-halfD, halfD]) add(world(clamp(local.x, -halfW, halfW), clamp(local.y, 0, r.height), z), "face", object.id);
    for (const y of [0, r.height]) add(world(clamp(local.x, -halfW, halfW), y, clamp(local.z, -halfD, halfD)), "face", object.id);
    for (const x of [-halfW, halfW]) for (const z of [-halfD, halfD]) add(world(x, clamp(local.y, 0, r.height), z), "edge", object.id);
    for (const y of [0, r.height]) for (const z of [-halfD, halfD]) add(world(clamp(local.x, -halfW, halfW), y, z), "edge", object.id);
    for (const y of [0, r.height]) for (const x of [-halfW, halfW]) add(world(x, y, clamp(local.z, -halfD, halfD)), "edge", object.id);
  }
  add({ x: Math.round(point.x / grid) * grid, y: Math.round(point.y / grid) * grid, z: Math.round(point.z / grid) * grid }, "grid");
  add({ x: point.x, y: 0, z: 0 }, "axis"); add({ x: 0, y: point.y, z: 0 }, "axis"); add({ x: 0, y: 0, z: point.z }, "axis");
  const priority: Record<CadSnapKind, number> = { endpoint: 0, midpoint: 1, center: 2, edge: 3, face: 4, axis: 5, grid: 6 };
  candidates.sort((a, b) => a.distanceM - b.distanceM || priority[a.kind] - priority[b.kind]);
  return candidates[0] ?? null;
}

/** Net solid quantities respect explicit openings, visibility is purely a viewport setting. */
export function cadQuantities(design: Design) {
  return cadObjects(design).map(object => {
    const r = resolveDraft(object, cadLevels(design));
    const areaM2 = cadFootprintArea(object, cadLevels(design));
    const openingVolumeM3 = (object.openings ?? []).reduce((sum, opening) => sum + opening.widthM * opening.heightM * r.depth, 0);
    return { id: object.id, kind: cadKind(object), lengthM: object.kind === "column" ? r.height : r.width, areaM2, volumeM3: Math.max(0, areaM2 * r.height - openingVolumeM3), units: "m" as const };
  });
}
