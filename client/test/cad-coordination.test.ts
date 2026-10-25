import test from "node:test";
import assert from "node:assert/strict";
import { defaultDesign } from "../src/types";
import { createCadObject, executeCadCommand } from "../src/lib/cadModel";
import { cadCoordinationScene } from "../src/lib/cadCoordination";
import { detectMeshClashes } from "../src/lib/meshClash";
import { addCadNetworkElement, cadHostFingerprint, cadNetworkFingerprint, cadNetworkIssues, cadNetworkState } from "../src/lib/cadNetworks";

test("physical coordination includes hidden geometry and distinguishes a real wall void", () => {
  const wall = { ...createCadObject("wall"), w: 4, d: .2, h: 3, visible: false };
  let design = executeCadCommand(defaultDesign(), { type: "create", object: wall });
  design = addCadNetworkElement(design, "pipe", "cold-water", { x: 0, y: 1, z: -1 }, { end: { x: 0, y: 1, z: 1 }, diameterM: .05 }).design;
  const solid = cadCoordinationScene(design), hits = detectMeshClashes(solid);
  assert.equal(hits.complete, true);
  assert.ok(hits.clashes.some(clash => clash.a === wall.id || clash.b === wall.id));
  design = executeCadCommand(design, { type: "modify", id: wall.id, patch: { openings: [{ id: "door-fixture", kind: "door", offsetM: 0, widthM: 1.2, heightM: 2.2, sillM: 0 }] } });
  const opened = detectMeshClashes(cadCoordinationScene(design));
  assert.equal(opened.clashes.length, 0, "the route passes through the modeled opening, not through a painted rectangle");
});

test("hosting changes flag device review and stale network identity while visibility remains independent", () => {
  const wall = createCadObject("wall");
  let design = executeCadCommand(defaultDesign(), { type: "create", object: wall });
  const device = addCadNetworkElement(design, "socket", "electrical", { x: 0, y: 1, z: .1 }); design = device.design;
  design = { ...design, cadNetworks: { ...cadNetworkState(design), equipment: cadNetworkState(design).equipment.map(item => ({ ...item, hostId: wall.id, hostFingerprint: cadHostFingerprint(design, wall.id) })) } };
  const fingerprint = cadNetworkFingerprint(design);
  const hidden = executeCadCommand(design, { type: "modify", id: wall.id, patch: { visible: false } });
  assert.equal(cadNetworkFingerprint(hidden), fingerprint);
  const moved = executeCadCommand(design, { type: "modify", id: wall.id, patch: { x: 1 } });
  assert.notEqual(cadNetworkFingerprint(moved), fingerprint);
  assert.ok(cadNetworkIssues(moved).some(issue => issue.kind === "broken" && issue.text.includes("Hosting geometry changed")));
  const removed = executeCadCommand(design, { type: "delete", ids: [wall.id] });
  assert.ok(cadNetworkIssues(removed).some(issue => issue.text.includes("Hosted object was removed")));
});

test("CAD and typed network identities survive project JSON persistence without changing metres", () => {
  let design = executeCadCommand(defaultDesign(), { type: "create", object: { ...createCadObject("circular-column"), w: .45, d: .45, h: 3.25, rotationDeg: 37 } });
  design = addCadNetworkElement(design, "pipe", "hot-water", { x: 1, y: 0, z: 1 }, { end: { x: 1, y: 3, z: 1 }, diameterM: .032 }).design;
  const restored = JSON.parse(JSON.stringify(design));
  assert.equal(restored.drafts[0].id, design.drafts![0].id);
  assert.equal(restored.mep.elements[0].id, design.mep!.elements[0].id);
  assert.deepEqual(restored.mep.elements[0].route, design.mep!.elements[0].route);
  assert.deepEqual(restored.cadNetworks, design.cadNetworks);
  assert.equal(cadNetworkFingerprint(restored), cadNetworkFingerprint(design));
  assert.equal(restored.room.widthMm, design.room.widthMm);
  assert.equal(restored.drafts[0].h, 3.25);
  assert.ok(cadCoordinationScene(restored).meshes.every(mesh => mesh.sourceId));
});
