import test from "node:test";
import assert from "node:assert/strict";
import { defaultDesign, type CadAnalysisRecord, type Design, type DraftElement } from "../src/types";
import { CAD_MIN_SIZE_M, axisDragParameter, cadGeometryFingerprint, cadKind, cadLevels, cadObjects, cadQuantities, createCadObject, executeCadCommand, localCadAxis, resizeDraft, resolveCadSnap, setCadObjects } from "../src/lib/cadModel";
import { resolveDraft } from "../src/lib/parametric";
import { addCadNetworkElement, cadMep as networkMep } from "../src/lib/cadNetworks";
import { workingPlaneElevation, systemForDiscipline, systemsForDiscipline, starterFrameCommands } from "../src/lib/cadWorkspaceContext";

test("working plane follows nonzero and changed levels without retaining another floor's offset", () => {
  const floor = { id: "first", name: "First floor", elevation: 10, floorHeight: 3 };
  assert.equal(workingPlaneElevation(floor, null), 10);
  assert.equal(workingPlaneElevation(floor, { levelId: "first", offset: 1.2 }), 11.2);
  assert.equal(workingPlaneElevation({ ...floor, elevation: 13 }, { levelId: "first", offset: 1.2 }), 14.2);
  assert.equal(workingPlaneElevation({ ...floor, id: "second", elevation: -3 }, { levelId: "first", offset: 1.2 }), -3);
  assert.equal(workingPlaneElevation(floor, { levelId: "first", offset: NaN }), 10);
});

test("discipline tools cannot silently author a different discipline's system", () => {
  assert.equal(systemForDiscipline("architecture", "cold-water"), undefined);
  assert.equal(systemForDiscipline("structure", "electrical"), undefined);
  assert.equal(systemForDiscipline("electrical", "hot-water"), "electrical");
  assert.equal(systemForDiscipline("plumbing", "electrical"), "cold-water");
  assert.equal(systemForDiscipline("plumbing", "hot-water"), "hot-water");
  assert.equal(systemForDiscipline("coordination", "hvac"), "hvac");
  assert.ok(!systemsForDiscipline("plumbing").includes("electrical"));
});

test("starter frame is an atomic floor-hosted command at the chosen working plane", () => {
  const floor = { id: "upper", name: "Upper floor", elevation: 10, floorHeight: 3 };
  const initial = { ...defaultDesign(), cad: { version: 1 as const, revision: 0, levels: [floor] } };
  const changed = executeCadCommand(initial, { type: "batch", commands: starterFrameCommands(floor, 10.5), expectedRevision: 0 });
  assert.equal(changed.cad?.revision, 1);
  const members = cadObjects(changed);
  assert.equal(members.length, 8);
  assert.equal(cadObjects(initial).length, 0);
  for (const member of members) assert.equal(member.family?.levelId, "upper");
  const column = members.find(item => item.kind === "column")!;
  assert.equal(resolveDraft(column, [floor]).elevation, 10.5);
  const slab = members.find(item => item.kind === "slab")!;
  assert.ok(Math.abs(resolveDraft(slab, [floor]).elevation + resolveDraft(slab, [floor]).height - 10.5) < 1e-9);
  const saved = JSON.parse(JSON.stringify(changed)) as Design;
  assert.deepEqual(cadQuantities(saved), cadQuantities(changed));
});

const close = (actual: number, expected: number, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const project = (...objects: DraftElement[]): Design => ({ ...defaultDesign(), drafts: objects });
const column = () => ({ ...createCadObject("column"), x: 3, z: -2, w: .4, d: .6, h: 3 });
const analysis = (object: DraftElement, revision = 0): CadAnalysisRecord => ({ id: "member-test", sourceObjectIds: [object.id], sourceRevision: revision, status: "current", method: "explicit elastic member", units: "m,N,Pa", inputs: { E: 2e11 }, assumptions: ["Explicit fixed support"], designBasis: "Authored synthetic test" });

test("CAD collections reuse existing project drafts and leave legacy document data intact", () => {
  const object = column(), design = project(object);
  assert.equal(cadObjects(design)[0], object);
  const changed = executeCadCommand(design, { type: "modify", id: object.id, patch: { x: 4 } });
  assert.equal(changed.room, design.room); assert.equal(changed.furniture, design.furniture);
  assert.equal(changed.version, 1); assert.equal(changed.cad?.revision, 1);
  assert.equal(design.drafts?.[0].x, 3);
});

test("height face resize keeps the opposite face and supports symmetric resizing", () => {
  const original = { ...column(), elevationM: 2 };
  const top = resizeDraft(original, "y", 1, 4);
  close(resolveDraft(top).elevation, 2); close(resolveDraft(top).height, 4);
  const bottom = resizeDraft(original, "y", -1, 4);
  close(resolveDraft(bottom).elevation, 1); close(resolveDraft(bottom).elevation + resolveDraft(bottom).height, 5);
  const symmetric = resizeDraft(original, "y", 1, 4, true);
  close(resolveDraft(symmetric).elevation, 1.5);
  assert.equal(original.h, 3); assert.equal(original.elevationM, 2);
});

test("positive and negative width faces anchor correctly on rotated local axes", () => {
  const original = { ...column(), rotationDeg: 37 };
  const axis = localCadAxis(original, "x");
  for (const side of [-1, 1] as const) {
    const result = resizeDraft(original, "x", side, .8);
    close(result.x - axis.x * side * .8 / 2, original.x - axis.x * side * .4 / 2);
    close(result.z - axis.z * side * .8 / 2, original.z - axis.z * side * .4 / 2);
  }
});

test("slab boundary and thickness changes preserve the opposite boundary", () => {
  const slab = { ...createCadObject("slab"), rotationDeg: -45, elevationM: 1 };
  const edge = resizeDraft(slab, "z", -1, 6), axis = localCadAxis(slab, "z");
  close(edge.x + axis.x * 6 / 2, slab.x + axis.x * slab.d / 2);
  close(edge.z + axis.z * 6 / 2, slab.z + axis.z * slab.d / 2);
  const base = resizeDraft(slab, "y", -1, .4);
  close(resolveDraft(base).elevation + resolveDraft(base).height, resolveDraft(slab).elevation + resolveDraft(slab).height);
});

test("circular diameter edits preserve a round section and rotated anchor", () => {
  const original = { ...createCadObject("circular-column"), rotationDeg: 90 };
  const resized = resizeDraft(original, "x", 1, .8);
  assert.equal(cadKind(resized), "circular-column"); close(resized.w, .8); close(resized.d, .8);
  close(resized.x, 0); close(resized.z, -.2);
  const symmetric = resizeDraft(original, "z", -1, 1, true); close(symmetric.x, 0); close(symmetric.z, 0);
});

test("level-hosted height resizing changes base offset without double-moving elevation", () => {
  const level = { id: "L2", name: "Level 2", elevation: 5, floorHeight: 3 };
  const original = createCadObject("wall", level);
  const resized = resizeDraft(original, "y", -1, 4, false, [level]);
  close(resolveDraft(resized, [level]).elevation, 4); close(resolveDraft(resized, [level]).height, 4);
  close(resolveDraft(resized, [level]).elevation + resolveDraft(resized, [level]).height, 8);
});

test("resize rejects zero, inverted, nonfinite and out-of-range geometry", () => {
  for (const invalid of [0, -1, NaN, Infinity, CAD_MIN_SIZE_M / 2, 10001]) assert.throws(() => resizeDraft(column(), "x", 1, invalid));
  assert.doesNotThrow(() => resizeDraft(column(), "x", 1, CAD_MIN_SIZE_M));
});

test("camera ray axis measurement is metric and rejects an end-on ambiguous axis", () => {
  const origin = { x: 2, y: 3, z: 10 }, direction = { x: 0, y: 0, z: -1 };
  close(axisDragParameter(origin, direction, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })!, 2);
  assert.equal(axisDragParameter(origin, direction, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), null);
  close(axisDragParameter({ x: -3, y: 7, z: 20 }, { x: 0, y: -.2, z: -1 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })!, -3);
});

test("completed multi-object batches are one revision and a rejected child leaves the original unchanged", () => {
  const first = column(), design = project(first), before = JSON.stringify(design);
  const second = createCadObject("beam");
  const changed = executeCadCommand(design, { type: "batch", expectedRevision: 0, commands: [{ type: "modify", id: first.id, patch: { x: 8 } }, { type: "create", object: second }] });
  assert.equal(changed.cad?.revision, 1); assert.equal(cadObjects(changed).length, 2);
  assert.throws(() => executeCadCommand(design, { type: "batch", commands: [{ type: "modify", id: first.id, patch: { x: 8 } }, { type: "modify", id: first.id, patch: { w: -1 } }] }));
  assert.equal(JSON.stringify(design), before);
});

test("stale revisions and read-only access cannot apply commands", () => {
  const object = column(), design = project(object);
  assert.throws(() => executeCadCommand(design, { type: "modify", id: object.id, patch: { x: 1 }, expectedRevision: 2 }), /revision conflict/);
  assert.throws(() => executeCadCommand(design, { type: "delete", ids: [object.id] }, false), /permission/);
});

test("cancelled previews preserve geometry, relationships and calculation validity", () => {
  const object = column(), original = { ...project(object), cad: { version: 1 as const, revision: 0, analyses: [analysis(object)] } };
  const before = JSON.stringify(original), preview = setCadObjects(original, [resizeDraft(object, "x", 1, .8)]);
  assert.notEqual(preview.drafts?.[0].w, original.drafts?.[0].w);
  assert.equal(JSON.stringify(original), before); assert.equal(original.cad.analyses[0].status, "current");
});

test("analysis recording requires current revision and geometry changes invalidate affected results", () => {
  const object = column(), design = project(object);
  const analyzed = executeCadCommand(design, { type: "record-analysis", record: analysis(object) });
  assert.equal(analyzed.cad?.revision, 0); assert.equal(analyzed.cad?.analyses?.[0].status, "current");
  const modified = executeCadCommand(analyzed, { type: "modify", id: object.id, patch: { h: 4 } });
  assert.equal(modified.cad?.analyses?.[0].status, "needs-recalculation"); assert.equal(modified.cad?.analyses?.[0].sourceRevision, 0);
  assert.throws(() => executeCadCommand(modified, { type: "record-analysis", record: analysis(object) }), /stale/);
});

test("visibility, labels and colour do not alter geometry revision or engineering totals", () => {
  const object = column(); let design = executeCadCommand(project(object), { type: "record-analysis", record: analysis(object) });
  const fingerprint = cadGeometryFingerprint(design), quantity = cadQuantities(design);
  design = executeCadCommand(design, { type: "modify", id: object.id, patch: { visible: false, label: "Renamed", color: "#ffffff" } });
  assert.equal(design.cad?.revision, 0); assert.equal(design.cad?.analyses?.[0].status, "current"); assert.deepEqual(cadQuantities(design), quantity); assert.equal(cadGeometryFingerprint(design), fingerprint);
});

test("replacements cannot bypass object or dimensional locks by removing a family override", () => {
  const original = { ...column(), family: { type: "column", typeParameters: { width: 2 } }, locks: { width: true } };
  const design = project(original), replaced = { ...original, family: undefined };
  assert.throws(() => executeCadCommand(design, { type: "replace", next: setCadObjects(design, [replaced]) }), /locked/);
  const locked = { ...original, locked: true };
  const lockedDesign = project(locked);
  assert.throws(() => executeCadCommand(lockedDesign, { type: "batch", commands: [{ type: "replace", next: project({ ...locked, x: 10 }) }] }), /locked/);
  assert.doesNotThrow(() => executeCadCommand(lockedDesign, { type: "modify", id: locked.id, patch: { locked: false } }));
});

test("wall openings remain within their host and reduce net quantities", () => {
  const wall = { ...createCadObject("wall"), openings: [{ id: "opening-a", kind: "door" as const, offsetM: 0, widthM: 1, heightM: 2, sillM: 0 }] };
  close(cadQuantities(project(wall))[0].volumeM3, 4 * .2 * 3 - 1 * 2 * .2);
  assert.throws(() => resizeDraft(wall, "x", 1, .5), /Opening/);
  assert.throws(() => resizeDraft(wall, "y", 1, 1), /Opening/);
});

test("true snapping returns no fake indicator and round targets lie on circular geometry", () => {
  const circular = createCadObject("circular-column"), design = project(circular);
  const falseCorner = resolveCadSnap({ x: .2, y: 1, z: .2 }, design, { kinds: ["endpoint", "face", "edge"], toleranceM: .01 });
  assert.equal(falseCorner, null);
  const point = { x: .1415, y: 1, z: .1415 }, snap = resolveCadSnap(point, design, { kinds: ["face"], toleranceM: .01 });
  assert.ok(snap); close(Math.hypot(snap.point.x, snap.point.z), .2);
  assert.equal(resolveCadSnap({ x: 15.023, y: 8.111, z: -13.032 }, design, { kinds: ["grid"], gridM: 1, toleranceM: .001 }), null);
  const grid = resolveCadSnap({ x: 2.002, y: 0, z: 4.001 }, design, { kinds: ["grid"], gridM: .1, toleranceM: .01 });
  assert.deepEqual(grid?.point, { x: 2, y: 0, z: 4 });
});

test("metre geometry stays physical while display metadata changes", () => {
  const object = column(), design = project(object);
  const next = executeCadCommand(design, { type: "replace", next: { ...design, cad: { version: 1, revision: 0, displayUnits: "mm" } } });
  assert.equal(next.drafts?.[0].w, .4); assert.equal(next.room.widthMm, design.room.widthMm); assert.equal(next.cad?.revision, 0);
});

test("stable duplicate identities and delete semantics preserve unrelated legacy records", () => {
  const object = column(), design = project(object);
  const duplicated = executeCadCommand(design, { type: "duplicate", ids: [object.id], offset: { x: 2, y: 1, z: 0 } });
  assert.notEqual(cadObjects(duplicated)[1].id, object.id); close(cadObjects(duplicated)[1].x, 5); close(cadObjects(duplicated)[1].elevationM!, 1);
  const deleted = executeCadCommand(duplicated, { type: "delete", ids: [object.id] });
  assert.equal(cadObjects(deleted).length, 1); assert.equal(deleted.room, design.room);
});

test("MEP delete cleans typed ports and metadata through the shared command pipeline", () => {
  const created = addCadNetworkElement(project(), "source", "cold-water", { x: 1, y: 1, z: 1 });
  const deleted = executeCadCommand(created.design, { type: "delete", ids: [created.element.id] });
  assert.equal(networkMep(deleted).elements.length, 0); assert.equal(deleted.cadNetworks?.equipment.length, 0);
});

test("CAD levels remain additive and can be used for root room projects", () => {
  const design = project(); assert.equal(cadLevels(design)[0].elevation, 0);
  const level = { id: "upper", name: "Upper", elevation: 3, floorHeight: 3 };
  const changed = executeCadCommand(design, { type: "replace", next: { ...design, cad: { version: 1, revision: 0, levels: [level] } } });
  assert.equal(cadLevels(changed)[0].id, "upper"); assert.equal(changed.cad?.revision, 1);
});

test("recording MEP calculation evidence does not mutate geometry identity or revision", () => {
  const created = addCadNetworkElement(project(), "source", "cold-water", { x: 1, y: 1, z: 1 });
  const design = created.design, state = design.cadNetworks!;
  const next: Design = { ...design, cadNetworks: { ...state, calculations: [{ id: "water-test", scope: "water", targetId: "cold-water", sourceRevision: 0, fingerprint: "synthetic", method: "synthetic-test", units: "m", basis: "Authored test", inputs: {}, result: {}, warnings: [] }] } };
  const recorded = executeCadCommand(design, { type: "replace", next });
  assert.equal(recorded.cad?.revision, 0); assert.equal(cadGeometryFingerprint(design), cadGeometryFingerprint(recorded));
});
