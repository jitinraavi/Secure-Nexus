import type { Design, DocumentationOrientation, DocumentationView } from "../types";
import { cadLevels, cadObjects, validateCadObject } from "./cadModel";
import { resolveDraft } from "./parametric";

export interface CadDrawingPoint { x: number; y: number }
export interface CadDrawingBounds { minX: number; minY: number; maxX: number; maxY: number }
export interface CadDrawingPath { objectId: string; points: CadDrawingPoint[]; closed: boolean }
export interface CadDrawingCircle { objectId: string; cx: number; cy: number; radius: number }
export interface CadDocumentationProjection {
  units: "m";
  kind: "plan" | "elevation" | "section";
  orientation: Exclude<DocumentationOrientation, "custom">;
  bounds: CadDrawingBounds | null;
  paths: CadDrawingPath[];
  circles: CadDrawingCircle[];
  includedObjectIds: string[];
  hiddenObjectIds: string[];
  outOfScopeObjectIds: string[];
  notIntersectedObjectIds: string[];
  excludedObjectIds: string[];
  warnings: string[];
}

type Point3 = { x: number; y: number; z: number };
type LocalPoint = { x: number; y: number };
const MAX_OBJECTS = 10_000;
const MAX_POINTS = 200_000;
const MAX_PRIMITIVES = 120_000;
const MAX_WALL_CELLS = 50_000;
const ARC_CHORD_TOLERANCE_M = 0.0001;
const solids = new Set(["wall", "column", "beam", "slab", "roof"]);
const pointKey = (p: CadDrawingPoint) => `${Math.round(p.x * 1e8)},${Math.round(p.y * 1e8)}`;
const edgeKey = (a: CadDrawingPoint, b: CadDrawingPoint) => [pointKey(a), pointKey(b)].sort().join("|");
const finite = (value: number) => Number.isFinite(value) && Math.abs(value) <= 1e8;

/**
 * World-metre orthographic edges, with no paper scaling or model mutation.
 * Local cardinal directions are North=-Z, East=+X, South=+Z and West=-X;
 * they do not assert a survey/true-north relationship. Elevations are viewed
 * from outside the model. Plans are top projections, not horizontal cuts.
 * Top/elevation boundary edges are retained without hidden-line removal.
 * Sections intersect supported solids with an explicitly declared vertical plane.
 */
export function projectCadDocumentation(
  design: Design,
  view: Pick<DocumentationView, "kind" | "orientation" | "levelId" | "section">,
): CadDocumentationProjection {
  if (view.kind !== "plan" && view.kind !== "elevation" && view.kind !== "section") throw new Error("Authored CAD PDF geometry supports top projections, elevations and explicit vertical cut sections.");
  if (!["north", "east", "south", "west"].includes(view.orientation)) throw new Error("Choose a cardinal orientation for the CAD projection. A custom orientation has no stored camera basis.");
  const section = view.kind === "section" ? view.section : undefined;
  if (view.kind === "section") {
    if (!section || !["x", "z"].includes(section.axis) || !Number.isFinite(section.offsetM) || Math.abs(section.offsetM) > 1e6) throw new Error("A CAD section requires an explicit vertical cut plane: axis X or Z and a finite offset in metres.");
    if (section.axis === "x" ? !["east", "west"].includes(view.orientation) : !["north", "south"].includes(view.orientation)) throw new Error("The section view orientation must face its cut plane: East/West for X, North/South for Z.");
  }
  const objects = cadObjects(design), levels = cadLevels(design);
  if (objects.length > MAX_OBJECTS) throw new Error("CAD drawing projection supports at most 10,000 authored objects. Select a smaller model.");
  if (view.levelId && !levels.some(level => level.id === view.levelId)) throw new Error("The drawing's selected level does not exist. Choose an existing level before exporting.");
  const result: CadDocumentationProjection = { units: "m", kind: view.kind, orientation: view.orientation as CadDocumentationProjection["orientation"], bounds: null, paths: [], circles: [], includedObjectIds: [], hiddenObjectIds: [], outOfScopeObjectIds: [], notIntersectedObjectIds: [], excludedObjectIds: [], warnings: [] };
  const warnings = new Set<string>(["Authored CAD geometry only: generated site/building forms, room shells, furniture and MEP routes are outside this view.", section ? "Section lines are actual authored-solid/plane intersections. Geometry beyond the cut, assemblies and concealed components are not inferred." : "No hidden-line removal is performed. Top projections are not floor-plan cuts; elevations are not sections."]);
  let pointBudget = 0, wallCells = 0;
  const ids = new Set<string>();
  const expand = (p: CadDrawingPoint) => {
    if (!finite(p.x) || !finite(p.y)) throw new Error("CAD drawing coordinates must be finite and within the supported range.");
    if (!result.bounds) result.bounds = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    else { result.bounds.minX = Math.min(result.bounds.minX, p.x); result.bounds.minY = Math.min(result.bounds.minY, p.y); result.bounds.maxX = Math.max(result.bounds.maxX, p.x); result.bounds.maxY = Math.max(result.bounds.maxY, p.y); }
  };
  const project = (p: Point3): CadDrawingPoint => {
    if (!finite(p.x) || !finite(p.y) || !finite(p.z)) throw new Error("CAD drawing geometry contains invalid coordinates.");
    if (view.kind === "plan") {
      if (view.orientation === "north") return { x: p.x, y: -p.z };
      if (view.orientation === "east") return { x: p.z, y: p.x };
      if (view.orientation === "south") return { x: -p.x, y: p.z };
      return { x: -p.z, y: -p.x };
    }
    const x = view.orientation === "north" ? -p.x : view.orientation === "east" ? -p.z : view.orientation === "south" ? p.x : p.z;
    return { x, y: p.y };
  };
  const guardBudget = () => { if (result.paths.length + result.circles.length > MAX_PRIMITIVES) throw new Error("CAD drawing exceeds its edge budget. Use a level-scoped view or a smaller model."); };
  for (const object of objects) {
    pointBudget += object.points?.length ?? 0;
    if (pointBudget > MAX_POINTS) throw new Error("CAD drawing exceeds its stored-path point budget. Select fewer objects.");
    if ((object.openings?.length ?? 0) > 64) throw new Error("CAD drawing supports at most 64 rectangular openings per wall. Split the authored scope before exporting.");
    validateCadObject(object, levels);
    if (ids.has(object.id)) throw new Error("CAD drawing objects require unique IDs.");
    ids.add(object.id);
    if (object.visible === false) { result.hiddenObjectIds.push(object.id); continue; }
    if (view.levelId && object.family?.levelId !== view.levelId) { result.outOfScopeObjectIds.push(object.id); continue; }
    const r = resolveDraft(object, levels);
    if (!finite(r.slope)) throw new Error("Roof slope must be finite before exporting a CAD drawing.");
    if (object.kind === "spline") {
      result.excludedObjectIds.push(object.id);
      warnings.add("Spline objects are omitted: stored control polygons do not define an evaluated spline curve.");
      continue;
    }
    if (section && !solids.has(object.kind)) {
      result.excludedObjectIds.push(object.id);
      warnings.add("Non-solid drafting paths are omitted from solid cut sections; they have no section area.");
      continue;
    }
    if (object.kind === "roof" && object.points?.length && r.slope !== 0) {
      result.excludedObjectIds.push(object.id);
      warnings.add("Sloped polygon roofs are omitted: their authored footprint does not define the sloped solid surface.");
      continue;
    }
    const angle = object.rotationDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    const pitch = object.kind === "roof" && !object.points?.length ? Math.atan(r.slope / 100) : 0;
    const world = (p: Point3): Point3 => {
      let y = p.y, z = p.z;
      if (pitch) { const dy = y - r.height / 2; y = r.height / 2 + dy * Math.cos(pitch) - z * Math.sin(pitch); z = dy * Math.sin(pitch) + z * Math.cos(pitch); }
      return { x: object.x + p.x * c + z * s, y: r.elevation + y, z: object.z - p.x * s + z * c };
    };
    const edges = new Set<string>();
    const line = (a: Point3, b: Point3) => {
      const first = project(world(a)), second = project(world(b));
      if (Math.hypot(first.x - second.x, first.y - second.y) < 1e-10) return;
      const key = edgeKey(first, second); if (edges.has(key)) return; edges.add(key);
      expand(first); expand(second); result.paths.push({ objectId: object.id, points: [first, second], closed: false }); guardBudget();
    };
    const path = (points: Point3[], closed: boolean) => {
      for (let index = 1; index < points.length; index++) line(points[index - 1], points[index]);
      if (closed && points.length > 2) line(points[points.length - 1], points[0]);
    };
    const extrusion = (footprint: { x: number; z: number }[], height: number) => {
      const bottom = footprint.map(p => ({ x: p.x, y: 0, z: p.z })), top = footprint.map(p => ({ x: p.x, y: height, z: p.z }));
      path(bottom, true); path(top, true); for (let index = 0; index < bottom.length; index++) line(bottom[index], top[index]);
    };
    const rectangle = () => extrusion([{ x: -r.width / 2, z: -r.depth / 2 }, { x: r.width / 2, z: -r.depth / 2 }, { x: r.width / 2, z: r.depth / 2 }, { x: -r.width / 2, z: r.depth / 2 }], r.height);
    const before = result.paths.length + result.circles.length;
    if (section) {
      const epsilon = 1e-8;
      const sectionPolygon = (points: CadDrawingPoint[]) => {
        if (points.length < 3) return;
        const origin = points[0];
        const twiceArea = points.reduce((sum, p, index) => { const q = points[(index + 1) % points.length]; return sum + (p.x - origin.x) * (q.y - origin.y) - (q.x - origin.x) * (p.y - origin.y); }, 0);
        if (Math.abs(twiceArea) < 1e-12) return;
        points.forEach(expand); result.paths.push({ objectId: object.id, points, closed: true }); guardBudget();
      };
      const sectionRectangle = (min: number, max: number, bottom: number, top: number) => sectionPolygon([{ x: min, y: bottom }, { x: max, y: bottom }, { x: max, y: top }, { x: min, y: top }]);
      const footprintIntervals = (footprint: { x: number; z: number }[]): [number, number][] => {
        const polygon = footprint.map(p => world({ x: p.x, y: 0, z: p.z }));
        const crossings: number[] = [];
        for (let index = 0; index < polygon.length; index++) {
          const a = polygon[index], b = polygon[(index + 1) % polygon.length], da = a[section.axis] - section.offsetM, db = b[section.axis] - section.offsetM;
          if (Math.abs(da) <= epsilon) crossings.push(project(a).x);
          if (da * db < 0) { const t = da / (da - db); crossings.push(project({ x: a.x + (b.x - a.x) * t, y: a.y, z: a.z + (b.z - a.z) * t }).x); }
        }
        const cuts = crossings.sort((a, b) => a - b).filter((value, index, list) => !index || Math.abs(value - list[index - 1]) > epsilon);
        const contains = (u: number) => {
          const p = section.axis === "z" ? { x: view.orientation === "north" ? -u : u, z: section.offsetM } : { x: section.offsetM, z: view.orientation === "east" ? -u : u };
          let inside = false;
          for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
            const a = polygon[previous], b = polygon[index], cross = (p.x - a.x) * (b.z - a.z) - (p.z - a.z) * (b.x - a.x);
            if (Math.abs(cross) <= epsilon * Math.max(1, Math.hypot(b.x - a.x, b.z - a.z)) && p.x >= Math.min(a.x, b.x) - epsilon && p.x <= Math.max(a.x, b.x) + epsilon && p.z >= Math.min(a.z, b.z) - epsilon && p.z <= Math.max(a.z, b.z) + epsilon) return true;
            if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
          }
          return inside;
        };
        const intervals: [number, number][] = [];
        for (let index = 1; index < cuts.length; index++) if (contains((cuts[index - 1] + cuts[index]) / 2)) {
          const previous = intervals[intervals.length - 1];
          if (previous && Math.abs(previous[1] - cuts[index - 1]) <= epsilon) previous[1] = cuts[index]; else intervals.push([cuts[index - 1], cuts[index]]);
        }
        return intervals;
      };
      if (object.kind === "column" && object.family?.type === "circular-column") {
        const center = { x: object.x, y: r.elevation, z: object.z }, delta = section.offsetM - center[section.axis], radius = r.width / 2;
        if (Math.abs(delta) < radius) { const half = Math.sqrt(Math.max(0, radius * radius - delta * delta)), u = project(center).x; sectionRectangle(u - half, u + half, r.elevation, r.elevation + r.height); }
      } else if (pitch) {
        // A tilted rectangular roof is a convex box. Its exact cut polygon is
        // the convex hull of all edge/plane intersections, not its elevation.
        const vertices = Array.from({ length: 8 }, (_, index) => world({ x: index & 4 ? r.width / 2 : -r.width / 2, y: index & 2 ? r.height : 0, z: index & 1 ? r.depth / 2 : -r.depth / 2 }));
        const intersections: CadDrawingPoint[] = [];
        for (let index = 0; index < vertices.length; index++) for (const bit of [1, 2, 4]) {
          const other = index ^ bit; if (other < index) continue;
          const a = vertices[index], b = vertices[other], da = a[section.axis] - section.offsetM, db = b[section.axis] - section.offsetM;
          if (Math.abs(da) <= epsilon) intersections.push(project(a));
          if (Math.abs(db) <= epsilon) intersections.push(project(b));
          if (da * db < 0) { const t = da / (da - db); intersections.push(project({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })); }
        }
        const points = [...new Map(intersections.map(p => [pointKey(p), p])).values()].sort((a, b) => a.x - b.x || a.y - b.y);
        const cross = (a: CadDrawingPoint, b: CadDrawingPoint, c: CadDrawingPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const lower: CadDrawingPoint[] = [], upper: CadDrawingPoint[] = [];
        for (const point of points) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-12) lower.pop(); lower.push(point); }
        for (const point of [...points].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-12) upper.pop(); upper.push(point); }
        sectionPolygon([...lower.slice(0, -1), ...upper.slice(0, -1)]);
      } else {
        const footprint = (object.kind === "slab" || object.kind === "roof") && object.points?.length ? object.points : [{ x: -r.width / 2, z: -r.depth / 2 }, { x: r.width / 2, z: -r.depth / 2 }, { x: r.width / 2, z: r.depth / 2 }, { x: -r.width / 2, z: r.depth / 2 }];
        const intervals = footprintIntervals(footprint);
        if (object.kind !== "wall" || !object.openings?.length) for (const [min, max] of intervals) sectionRectangle(min, max, r.elevation, r.elevation + r.height);
        else {
          const voids = object.openings.flatMap(opening => footprintIntervals([{ x: opening.offsetM - opening.widthM / 2, z: -r.depth / 2 }, { x: opening.offsetM + opening.widthM / 2, z: -r.depth / 2 }, { x: opening.offsetM + opening.widthM / 2, z: r.depth / 2 }, { x: opening.offsetM - opening.widthM / 2, z: r.depth / 2 }]).map(([min, max]) => ({ min, max, bottom: r.elevation + opening.sillM, top: r.elevation + opening.sillM + opening.heightM })));
          const us = [...new Set([...intervals.flat(), ...voids.flatMap(voidRect => [voidRect.min, voidRect.max])])].sort((a, b) => a - b), ys = [...new Set([r.elevation, r.elevation + r.height, ...voids.flatMap(voidRect => [voidRect.bottom, voidRect.top])])].sort((a, b) => a - b);
          wallCells += Math.max(0, us.length - 1) * Math.max(0, ys.length - 1);
          if (wallCells > MAX_WALL_CELLS) throw new Error("CAD section exceeds its wall-opening boundary budget. Select fewer walls.");
          const boundary = new Map<string, [CadDrawingPoint, CadDrawingPoint]>();
          const toggle = (a: CadDrawingPoint, b: CadDrawingPoint) => { const key = edgeKey(a, b); if (boundary.has(key)) boundary.delete(key); else boundary.set(key, [a, b]); };
          for (let u = 1; u < us.length; u++) for (let y = 1; y < ys.length; y++) {
            const cx = (us[u - 1] + us[u]) / 2, cy = (ys[y - 1] + ys[y]) / 2;
            if (!intervals.some(([min, max]) => cx > min && cx < max) || voids.some(voidRect => cx > voidRect.min && cx < voidRect.max && cy > voidRect.bottom && cy < voidRect.top)) continue;
            const a = { x: us[u - 1], y: ys[y - 1] }, b = { x: us[u], y: ys[y - 1] }, c = { x: us[u], y: ys[y] }, d = { x: us[u - 1], y: ys[y] };
            toggle(a, b); toggle(b, c); toggle(c, d); toggle(d, a);
          }
          for (const [a, b] of boundary.values()) { expand(a); expand(b); result.paths.push({ objectId: object.id, points: [a, b], closed: false }); guardBudget(); }
        }
      }
      if (result.paths.length + result.circles.length === before) result.notIntersectedObjectIds.push(object.id); else result.includedObjectIds.push(object.id);
      continue;
    }
    if (object.kind === "column" && object.family?.type === "circular-column") {
      const center = project({ x: object.x, y: r.elevation, z: object.z }), radius = r.width / 2;
      if (view.kind === "plan") {
        result.circles.push({ objectId: object.id, cx: center.x, cy: center.y, radius }); guardBudget();
        expand({ x: center.x - radius, y: center.y - radius }); expand({ x: center.x + radius, y: center.y + radius });
      } else {
        // A vertical cylinder's cardinal orthographic silhouette is an exact rectangle.
        const points = [{ x: center.x - radius, y: r.elevation }, { x: center.x + radius, y: r.elevation }, { x: center.x + radius, y: r.elevation + r.height }, { x: center.x - radius, y: r.elevation + r.height }];
        points.forEach(expand); result.paths.push({ objectId: object.id, points, closed: true }); guardBudget();
      }
    } else if (object.kind === "wall" && object.openings?.length) {
      // Find the boundary of a rectangular wall face minus its through-openings.
      // Shared grid edges cancel, so artificial wall-cell seams never enter the drawing.
      const xs = [...new Set([-r.width / 2, r.width / 2, ...object.openings.flatMap(opening => [opening.offsetM - opening.widthM / 2, opening.offsetM + opening.widthM / 2])])].sort((a, b) => a - b);
      const ys = [...new Set([0, r.height, ...object.openings.flatMap(opening => [opening.sillM, opening.sillM + opening.heightM])])].sort((a, b) => a - b);
      wallCells += (xs.length - 1) * (ys.length - 1);
      if (wallCells > MAX_WALL_CELLS) throw new Error("CAD drawing exceeds its wall-opening boundary budget. Select fewer walls.");
      const boundary = new Map<string, [LocalPoint, LocalPoint]>();
      const toggle = (a: LocalPoint, b: LocalPoint) => { const key = edgeKey(a, b); if (boundary.has(key)) boundary.delete(key); else boundary.set(key, [a, b]); };
      for (let x = 1; x < xs.length; x++) for (let y = 1; y < ys.length; y++) {
        const cx = (xs[x - 1] + xs[x]) / 2, cy = (ys[y - 1] + ys[y]) / 2;
        if (xs[x] - xs[x - 1] < 1e-10 || ys[y] - ys[y - 1] < 1e-10 || object.openings.some(opening => Math.abs(cx - opening.offsetM) < opening.widthM / 2 && cy > opening.sillM && cy < opening.sillM + opening.heightM)) continue;
        const a = { x: xs[x - 1], y: ys[y - 1] }, b = { x: xs[x], y: ys[y - 1] }, d = { x: xs[x - 1], y: ys[y] }, e = { x: xs[x], y: ys[y] };
        toggle(a, b); toggle(b, e); toggle(e, d); toggle(d, a);
      }
      const neighbours = new Map<string, { point: LocalPoint; ends: LocalPoint[] }>();
      for (const [a, b] of boundary.values()) {
        for (const z of [-r.depth / 2, r.depth / 2]) line({ ...a, z }, { ...b, z });
        for (const [p, q] of [[a, b], [b, a]]) { const key = pointKey(p), entry = neighbours.get(key) ?? { point: p, ends: [] }; entry.ends.push(q); neighbours.set(key, entry); }
      }
      for (const { point, ends } of neighbours.values()) {
        const [a, b] = ends;
        if (ends.length !== 2 || Math.abs((a.x - point.x) * (b.y - point.y) - (a.y - point.y) * (b.x - point.x)) > 1e-10) line({ ...point, z: -r.depth / 2 }, { ...point, z: r.depth / 2 });
      }
    } else if (solids.has(object.kind)) {
      if ((object.kind === "slab" || object.kind === "roof") && object.points?.length) extrusion(object.points, r.height); else rectangle();
    } else if (object.points?.length) {
      path(object.points.map(p => ({ x: p.x, y: 0, z: p.z })), false);
      if (object.kind === "arc" || object.kind === "circle") warnings.add("Explicit stored curve paths are projected as polylines; their radius/angle parameters do not override those paths.");
    } else if (object.kind === "circle") {
      const radius = object.radiusM ?? r.width / 2;
      if (!Number.isFinite(radius) || radius <= 0 || radius > 10_000) throw new Error("CAD circle radius must be positive, finite and no greater than 10,000 m.");
      const center = project(world({ x: 0, y: 0, z: 0 }));
      if (view.kind === "plan") {
        result.circles.push({ objectId: object.id, cx: center.x, cy: center.y, radius }); guardBudget();
        expand({ x: center.x - radius, y: center.y - radius }); expand({ x: center.x + radius, y: center.y + radius });
      } else {
        expand({ x: center.x - radius, y: center.y }); expand({ x: center.x + radius, y: center.y });
        result.paths.push({ objectId: object.id, points: [{ x: center.x - radius, y: center.y }, { x: center.x + radius, y: center.y }], closed: false }); guardBudget();
      }
    } else if (object.kind === "arc") {
      const radius = object.radiusM ?? r.width / 2, start = (object.startAngleDeg ?? 0) * Math.PI / 180, sweep = ((object.endAngleDeg ?? 360) - (object.startAngleDeg ?? 0)) * Math.PI / 180;
      if (!Number.isFinite(radius) || radius <= 0 || radius > 10_000 || !finite(start) || !finite(sweep) || Math.abs(sweep) <= 1e-12 || Math.abs(sweep) > Math.PI * 2 + 1e-10) throw new Error("CAD arcs require a positive finite radius and a nonzero sweep no greater than 360 degrees.");
      const step = 2 * Math.acos(Math.max(-1, 1 - ARC_CHORD_TOLERANCE_M / radius)), count = Math.max(2, Math.ceil(Math.abs(sweep) / step));
      if (!Number.isFinite(count) || count > 8192) throw new Error("This arc exceeds the 0.1 mm projection-tolerance budget. Use a smaller arc or radius.");
      const parameters = Array.from({ length: count + 1 }, (_, index) => index / count);
      // Include exact world X/Z extrema so bounds do not depend on tessellation phase.
      const quarterStart = Math.floor((Math.min(start, start + sweep) - angle) / (Math.PI / 2));
      const quarterEnd = Math.ceil((Math.max(start, start + sweep) - angle) / (Math.PI / 2));
      for (let quarter = quarterStart; quarter <= quarterEnd; quarter++) { const candidate = (quarter * Math.PI / 2 + angle - start) / sweep; if (candidate > 0 && candidate < 1) parameters.push(candidate); }
      const points = [...new Set(parameters)].sort((a, b) => a - b).map(t => ({ x: radius * Math.cos(start + sweep * t), y: 0, z: radius * Math.sin(start + sweep * t) }));
      path(points, false); warnings.add("Arcs are tessellated with a maximum 0.1 mm chord error in model metres.");
    } else if (object.kind === "rectangle") path([{ x: -r.width / 2, y: 0, z: -r.depth / 2 }, { x: r.width / 2, y: 0, z: -r.depth / 2 }, { x: r.width / 2, y: 0, z: r.depth / 2 }, { x: -r.width / 2, y: 0, z: r.depth / 2 }], true);
    else path([{ x: -r.width / 2, y: 0, z: 0 }, { x: r.width / 2, y: 0, z: 0 }], false);
    result.includedObjectIds.push(object.id);
    if (result.paths.length + result.circles.length === before) warnings.add("Some included drafting paths are edge-on and collapse to a point in this elevation.");
  }
  if (view.levelId) warnings.add("Level scope includes only CAD objects explicitly hosted on the selected level; unhosted and other-level objects are omitted.");
  result.warnings = [...warnings];
  return result;
}
