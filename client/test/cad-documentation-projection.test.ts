import assert from "node:assert/strict";
import test from "node:test";
import { defaultDesign, type Design, type DocumentationOrientation, type DraftElement } from "../src/types";
import { createCadObject } from "../src/lib/cadModel";
import { projectCadDocumentation, type CadDocumentationProjection, type CadDrawingBounds } from "../src/lib/cadDocumentationProjection";

const near = (actual: number, expected: number, message?: string) => assert.ok(Math.abs(actual - expected) <= 1e-8, message ?? `${actual} should equal ${expected}`);
function model(...objects: DraftElement[]): Design { return { ...defaultDesign(), drafts: objects }; }
function bounds(actual: CadDrawingBounds | null, expected: CadDrawingBounds) { assert.ok(actual); for (const key of ["minX", "minY", "maxX", "maxY"] as const) near(actual[key], expected[key]); }
function line(projection: CadDocumentationProjection, x: number, y1: number, y2: number) {
  const intervals = projection.paths.filter(path => path.points.length === 2 && path.points.every(point => Math.abs(point.x - x) < 1e-8)).map(path => [Math.min(...path.points.map(point => point.y)), Math.max(...path.points.map(point => point.y))]).sort((a, b) => a[0] - b[0]);
  let covered = y1;
  for (const [start, end] of intervals) { if (start > covered + 1e-8) break; if (end > covered) covered = end; if (covered >= y2 - 1e-8) return true; }
  return false;
}

test("authored dimensions and positive Y rotations project in metres without normalizing model scale", () => {
  const object = { ...createCadObject("beam"), x: 10, z: 20, w: 4, d: 2, h: 3, rotationDeg: 90, elevationM: 5 };
  const design = model(object), before = structuredClone(design);
  const plan = projectCadDocumentation(design, { kind: "plan", orientation: "north" });
  bounds(plan.bounds, { minX: 9, minY: -22, maxX: 11, maxY: -18 });
  assert.equal(plan.paths.length, 4, "coincident upper/lower edges collapse to the true top footprint");
  assert.deepEqual(plan.includedObjectIds, [object.id]);
  bounds(projectCadDocumentation(design, { kind: "elevation", orientation: "north" }).bounds, { minX: -11, minY: 5, maxX: -9, maxY: 8 });
  assert.deepEqual(design, before);
});

test("all cardinal views use explicit local axes and level/base offsets rather than raw elevation", () => {
  const object = { ...createCadObject("beam"), x: 10, z: 20, w: 4, d: 2, h: 3, elevationM: 999,
    family: { family: "fixture", type: "beam", levelId: "first", instanceParameters: { baseOffset: .5 } } };
  const design = model(object); design.cad = { version: 1, revision: 1, levels: [{ id: "first", name: "First", elevation: 2, floorHeight: 3 }] };
  const expected: Record<Exclude<DocumentationOrientation, "custom">, CadDrawingBounds> = {
    north: { minX: -12, minY: 2.5, maxX: -8, maxY: 5.5 },
    east: { minX: -21, minY: 2.5, maxX: -19, maxY: 5.5 },
    south: { minX: 8, minY: 2.5, maxX: 12, maxY: 5.5 },
    west: { minX: 19, minY: 2.5, maxX: 21, maxY: 5.5 },
  };
  for (const orientation of ["north", "east", "south", "west"] as const) bounds(projectCadDocumentation(design, { kind: "elevation", orientation, levelId: "first" }).bounds, expected[orientation]);
  bounds(projectCadDocumentation(design, { kind: "plan", orientation: "east" }).bounds, { minX: 19, minY: 8, maxX: 21, maxY: 12 });
  bounds(projectCadDocumentation(design, { kind: "plan", orientation: "south" }).bounds, { minX: -12, minY: 19, maxX: -8, maxY: 21 });
  bounds(projectCadDocumentation(design, { kind: "plan", orientation: "west" }).bounds, { minX: -21, minY: -12, maxX: -19, maxY: -8 });
});

test("circular columns retain their true diameter in top projections and elevations", () => {
  const object = { ...createCadObject("circular-column"), x: 3, z: -2, w: 1, d: 1, h: 3, elevationM: 5, rotationDeg: 37 };
  const plan = projectCadDocumentation(model(object), { kind: "plan", orientation: "north" });
  assert.deepEqual(plan.circles, [{ objectId: object.id, cx: 3, cy: 2, radius: .5 }]);
  bounds(plan.bounds, { minX: 2.5, minY: 1.5, maxX: 3.5, maxY: 2.5 });
  const elevation = projectCadDocumentation(model(object), { kind: "elevation", orientation: "east" });
  bounds(elevation.bounds, { minX: 1.5, minY: 5, maxX: 2.5, maxY: 8 });
  assert.equal(elevation.circles.length, 0);
  assert.equal(elevation.paths.length, 1);
  assert.equal(elevation.paths[0].closed, true);
});

test("nonrectangular slab footprints retain concave vertices and extruded level elevations", () => {
  const object = { ...createCadObject("slab"), x: 10, z: -4, w: 4, d: 3, h: .2, rotationDeg: 90, elevationM: 2,
    points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 3 }, { x: 0, z: 3 }] };
  const plan = projectCadDocumentation(model(object), { kind: "plan", orientation: "north" });
  bounds(plan.bounds, { minX: 10, minY: 4, maxX: 13, maxY: 8 });
  assert.equal(plan.paths.length, 6);
  assert.ok(plan.paths.some(path => path.points.some(point => Math.abs(point.x - 11) < 1e-8 && Math.abs(point.y - 5) < 1e-8)), "retain the re-entrant corner instead of drawing the bounding rectangle");
  bounds(projectCadDocumentation(model(object), { kind: "elevation", orientation: "east" }).bounds, { minX: 4, minY: 2, maxX: 8, maxY: 2.2 });
});

test("wall through-openings retain jambs and voids without false wall-cell seams or door-bottom lines", () => {
  const object = { ...createCadObject("wall"), w: 4, d: .2, h: 3,
    openings: [{ id: "door", kind: "door" as const, offsetM: 0, widthM: 1, heightM: 2, sillM: 0 }, { id: "window", kind: "window" as const, offsetM: 1.25, widthM: 1, heightM: 1, sillM: 1 }] };
  const projection = projectCadDocumentation(model(object), { kind: "elevation", orientation: "north" });
  bounds(projection.bounds, { minX: -2, minY: 0, maxX: 2, maxY: 3 });
  assert.ok(line(projection, -.5, 0, 2)); assert.ok(line(projection, .5, 0, 2));
  assert.ok(line(projection, -1.75, 1, 2)); assert.ok(line(projection, -.75, 1, 2));
  assert.ok(!line(projection, -.5, 2, 3), "partition boundaries above openings are not physical edges");
  assert.ok(!projection.paths.some(path => path.points.every(point => Math.abs(point.y) < 1e-8) && Math.min(...path.points.map(point => point.x)) < .49 && Math.max(...path.points.map(point => point.x)) > -.49), "no bottom edge crosses the door void");
});

test("pitched rectangular roof projection matches the actual tilted solid", () => {
  const object = { ...createCadObject("roof"), w: 4, d: 2, h: .2, elevationM: 5, family: { family: "fixture", type: "roof", typeParameters: { slope: 100 } } };
  const projection = projectCadDocumentation(model(object), { kind: "elevation", orientation: "north" });
  const halfHeight = 1 * Math.SQRT1_2 + .1 * Math.SQRT1_2;
  bounds(projection.bounds, { minX: -2, minY: 5.1 - halfHeight, maxX: 2, maxY: 5.1 + halfHeight });
});

test("arc projection bounds include cardinal extrema and tessellation has a stated metric error bound", () => {
  const object = { ...createCadObject("arc"), radiusM: 10, startAngleDeg: 10, endAngleDeg: 170, rotationDeg: 7230 };
  const projection = projectCadDocumentation(model(object), { kind: "plan", orientation: "north" });
  bounds(projection.bounds, { minX: 10 * Math.cos(140 * Math.PI / 180), minY: -10, maxX: 10, maxY: 10 * Math.sin(20 * Math.PI / 180) });
  for (const path of projection.paths) {
    const [a, b] = path.points;
    const midpointRadius = Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2);
    assert.ok(10 - midpointRadius <= .000100001, "the chord lies within 0.1 mm of the mathematical arc");
  }
  assert.ok(projection.warnings.some(warning => warning.includes("0.1 mm")));
});

test("sections without cut planes, custom cameras and malformed geometry fail instead of drawing substitutes", () => {
  const object = createCadObject("wall");
  assert.throws(() => projectCadDocumentation(model(object), { kind: "section", orientation: "north" }), /cut plane/);
  assert.throws(() => projectCadDocumentation(model(object), { kind: "plan", orientation: "custom" }), /stored camera basis/);
  assert.throws(() => projectCadDocumentation(model({ ...object, x: NaN }), { kind: "plan", orientation: "north" }), /finite/);
  assert.throws(() => projectCadDocumentation(model(object, object), { kind: "plan", orientation: "north" }), /unique IDs/);
  assert.throws(() => projectCadDocumentation(model(object), { kind: "plan", orientation: "north", levelId: "missing" }), /does not exist/);
});

test("a rotated box section uses its plane intersection rather than the whole elevation envelope", () => {
  const object = { ...createCadObject("beam"), w: 4, d: 2, h: 3, rotationDeg: 45 };
  const section = projectCadDocumentation(model(object), { kind: "section", orientation: "north", section: { axis: "z", offsetM: 0 } });
  bounds(section.bounds, { minX: -Math.SQRT2, minY: 0, maxX: Math.SQRT2, maxY: 3 });
  assert.equal(section.paths.length, 1); assert.equal(section.paths[0].closed, true);
  assert.deepEqual(section.includedObjectIds, [object.id]);
  const empty = projectCadDocumentation(model(object), { kind: "section", orientation: "north", section: { axis: "z", offsetM: 4 } });
  assert.equal(empty.bounds, null); assert.equal(empty.paths.length, 0); assert.deepEqual(empty.notIntersectedObjectIds, [object.id]);
});

test("cylinder cut sections use the analytical chord and distinguish tangency from finite cut area", () => {
  const object = { ...createCadObject("circular-column"), w: 2, d: 2, h: 3, elevationM: 5 };
  const section = projectCadDocumentation(model(object), { kind: "section", orientation: "north", section: { axis: "z", offsetM: .6 } });
  bounds(section.bounds, { minX: -.8, minY: 5, maxX: .8, maxY: 8 });
  const tangent = projectCadDocumentation(model(object), { kind: "section", orientation: "east", section: { axis: "x", offsetM: 1 } });
  assert.equal(tangent.bounds, null); assert.deepEqual(tangent.notIntersectedObjectIds, [object.id]);
});

test("concave extrusion sections preserve disconnected arms and rotated cut planes", () => {
  const object = { ...createCadObject("slab"), w: 6, d: 6, h: .2, points: [{ x: -3, z: -3 }, { x: 3, z: -3 }, { x: 3, z: 3 }, { x: 1, z: 3 }, { x: 1, z: -1 }, { x: -1, z: -1 }, { x: -1, z: 3 }, { x: -3, z: 3 }] };
  const sections = [projectCadDocumentation(model(object), { kind: "section", orientation: "north", section: { axis: "z", offsetM: 1 } }), projectCadDocumentation(model({ ...object, rotationDeg: 90 }), { kind: "section", orientation: "east", section: { axis: "x", offsetM: 1 } })];
  for (const section of sections) {
    bounds(section.bounds, { minX: -3, minY: 0, maxX: 3, maxY: .2 });
    assert.equal(section.paths.length, 2, "the central void stays empty rather than becoming a convex hull");
    const intervals = section.paths.map(path => [Math.min(...path.points.map(point => point.x)), Math.max(...path.points.map(point => point.x))]).sort((a, b) => a[0] - b[0]);
    near(intervals[0][0], -3); near(intervals[0][1], -1); near(intervals[1][0], 1); near(intervals[1][1], 3);
  }
});

test("wall cut sections subtract doors and windows, including a perpendicular cut through the void", () => {
  const object = { ...createCadObject("wall"), w: 4, d: .2, h: 3, openings: [{ id: "door", kind: "door" as const, offsetM: 0, widthM: 1, heightM: 2, sillM: 0 }] };
  const acrossDoor = projectCadDocumentation(model(object), { kind: "section", orientation: "east", section: { axis: "x", offsetM: 0 } });
  bounds(acrossDoor.bounds, { minX: -.1, minY: 2, maxX: .1, maxY: 3 });
  assert.ok(!acrossDoor.paths.some(path => path.points.some(point => point.y < 2 - 1e-8)), "only the header intersects this plane above the door");
  const throughFace = projectCadDocumentation(model(object), { kind: "section", orientation: "north", section: { axis: "z", offsetM: 0 } });
  assert.ok(line(throughFace, -.5, 0, 2)); assert.ok(line(throughFace, .5, 0, 2));
  assert.ok(!throughFace.paths.some(path => path.points.every(point => Math.abs(point.y) < 1e-8) && Math.min(...path.points.map(point => point.x)) < .49 && Math.max(...path.points.map(point => point.x)) > -.49));
  const window = { ...object, openings: [{ id: "window", kind: "window" as const, offsetM: 0, widthM: 1, heightM: 1, sillM: 1 }] };
  const acrossWindow = projectCadDocumentation(model(window), { kind: "section", orientation: "east", section: { axis: "x", offsetM: 0 } });
  assert.ok(line(acrossWindow, -.1, 0, 1)); assert.ok(line(acrossWindow, -.1, 2, 3)); assert.ok(!line(acrossWindow, -.1, 1, 2));
});

test("pitched rectangular roof cuts preserve the tilted cross-section and its true thickness", () => {
  const object = { ...createCadObject("roof"), w: 4, d: 2, h: .2, elevationM: 5, family: { family: "fixture", type: "roof", typeParameters: { slope: 100 } } };
  const acrossSlope = projectCadDocumentation(model(object), { kind: "section", orientation: "east", section: { axis: "x", offsetM: 0 } });
  assert.equal(acrossSlope.paths.length, 1);
  const points = acrossSlope.paths[0].points;
  const area = Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point.x * next.y - next.x * point.y; }, 0)) / 2;
  near(area, .4, "the tilted cut area remains depth multiplied by thickness");
  const alongSlope = projectCadDocumentation(model(object), { kind: "section", orientation: "north", section: { axis: "z", offsetM: 0 } });
  bounds(alongSlope.bounds, { minX: -2, minY: 5.1 - .1 / Math.SQRT1_2, maxX: 2, maxY: 5.1 + .1 / Math.SQRT1_2 });
});

test("section plane orientation and finite coordinates are required and non-solid scope is explicit", () => {
  const object = createCadObject("line"), design = model(object), before = structuredClone(design);
  assert.throws(() => projectCadDocumentation(design, { kind: "section", orientation: "north", section: { axis: "x", offsetM: 0 } }), /face its cut plane/);
  assert.throws(() => projectCadDocumentation(design, { kind: "section", orientation: "north", section: { axis: "z", offsetM: NaN } }), /finite offset/);
  const section = projectCadDocumentation(design, { kind: "section", orientation: "north", section: { axis: "z", offsetM: 0 } });
  assert.deepEqual(section.excludedObjectIds, [object.id]); assert.equal(section.bounds, null); assert.ok(section.warnings.some(warning => warning.includes("Non-solid")));
  assert.deepEqual(design, before);
});

test("visibility, explicit level scope and unsupported curve coverage are returned without changing the document", () => {
  const level = { id: "ground", name: "Ground", elevation: 0, floorHeight: 3 }, otherLevel = { ...level, id: "upper", elevation: 3 };
  const shown = createCadObject("wall", level), hidden = { ...createCadObject("beam", level), visible: false }, other = createCadObject("slab", otherLevel), unhosted = createCadObject("column"), spline = { ...createCadObject("spline", level), points: [{ x: 0, z: 0 }, { x: 2, z: 3 }, { x: 4, z: 0 }] };
  const design = model(shown, hidden, other, unhosted, spline); design.cad = { version: 1, revision: 1, levels: [level, otherLevel] };
  const before = structuredClone(design), projection = projectCadDocumentation(design, { kind: "plan", orientation: "north", levelId: level.id });
  assert.deepEqual(projection.includedObjectIds, [shown.id]); assert.deepEqual(projection.hiddenObjectIds, [hidden.id]);
  assert.deepEqual(projection.outOfScopeObjectIds, [other.id, unhosted.id]); assert.deepEqual(projection.excludedObjectIds, [spline.id]);
  assert.ok(projection.warnings.some(warning => warning.includes("control polygons")));
  assert.ok(projection.warnings.some(warning => warning.includes("unhosted")));
  assert.deepEqual(design, before);
});

test("the object budget is bounded and a 10,000-object top projection remains supported", () => {
  const base = createCadObject("column"), objects = Array.from({ length: 10_000 }, (_, index) => ({ ...base, id: `column-${index}`, x: index % 100, z: Math.floor(index / 100) }));
  const projection = projectCadDocumentation(model(...objects), { kind: "plan", orientation: "north" });
  assert.equal(projection.includedObjectIds.length, 10_000);
  assert.equal(projection.paths.length, 40_000);
  assert.throws(() => projectCadDocumentation(model(...objects, { ...base, id: "extra" }), { kind: "plan", orientation: "north" }), /10,000/);
  const excessiveArc = { ...createCadObject("arc"), radiusM: 10_000, startAngleDeg: 0, endAngleDeg: 359 };
  assert.throws(() => projectCadDocumentation(model(excessiveArc), { kind: "plan", orientation: "north" }), /tolerance budget/);
});
