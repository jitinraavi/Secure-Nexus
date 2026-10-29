import { strict as assert } from "node:assert";
import { test } from "node:test";
import { civilInputErrorMessage, engineeringResultSummary, guidedEngineeringFields, updateGuidedEngineeringNumber } from "../src/lib/guidedEngineering.ts";

const water = JSON.stringify({ version: 1, medium: "water", densityKgM3: 998.2, kinematicViscosityM2s: 1e-6, sourceNotes: { reviewedBy: "test reviewer", keep: true }, nodes: [{ id: "source", elevationM: 2, fixedPotential: 45, demandM3s: 0 }, { id: "terminal", elevationM: 5, demandM3s: 0.002, minimumPressure: 15 }], links: [{ id: "pipe", from: "source", to: "terminal", lengthM: 80, diameterM: .05, roughnessM: .0001, minorLossK: 3 }], unsupportedForGuide: [1, 2, 3] });
const frame = JSON.stringify({ version: 1, analysis: "p-delta", nodes: [{ id: "base", xM: 0, yM: 0, restraints: [true, true, true] }, { id: "top", xM: 0, yM: 3, restraints: [false, false, false] }], members: [{ id: "column", start: "base", end: "top", areaM2: .02, inertiaM4: .00008, elasticModulusPa: 200e9, design: { effectiveLengthFactor: 2 } }], loadCases: [{ id: "lateral", nodal: [{ node: "top", fxN: 10000, fyN: 0, mzNm: -500 }], uniform: [] }], combinations: [{ id: "service", factors: { lateral: 1 } }], customMetadata: { note: "preserve exactly" } });

test("hydraulic display units translate mm, L/s and viscosity back into SI", () => {
  const guide = guidedEngineeringFields(water, "water");
  const diameter = guide.fields.find(field => field.path.join(".") === "links.0.diameterM")!;
  const demand = guide.fields.find(field => field.path.join(".") === "nodes.1.demandM3s")!;
  const viscosity = guide.fields.find(field => field.path.join(".") === "kinematicViscosityM2s")!;
  assert.equal(diameter.unit, "mm"); assert.equal(diameter.value * diameter.multiplier, 50);
  assert.equal(demand.unit, "L/s"); assert.equal(demand.value * demand.multiplier, 2);
  assert.equal(viscosity.value * viscosity.multiplier, 1);
  const changed = JSON.parse(updateGuidedEngineeringNumber(water, "water", diameter.path, 75));
  assert.equal(changed.links[0].diameterM, .075);
  assert.deepEqual(changed.nodes, JSON.parse(water).nodes);
  assert.deepEqual(changed.sourceNotes, JSON.parse(water).sourceNotes);
  assert.deepEqual(changed.unsupportedForGuide, [1, 2, 3]);
});
test("structural modulus and signed loads update without inferring topology or criteria", () => {
  const changed = JSON.parse(updateGuidedEngineeringNumber(frame, "frame", ["members", 0, "elasticModulusPa"], 210));
  assert.equal(changed.members[0].elasticModulusPa, 210e9);
  assert.deepEqual(changed.nodes, JSON.parse(frame).nodes);
  assert.deepEqual(changed.members[0].design, { effectiveLengthFactor: 2 });
  assert.deepEqual(changed.combinations, JSON.parse(frame).combinations);
  const signed = JSON.parse(updateGuidedEngineeringNumber(frame, "frame", ["loadCases", 0, "nodal", 0, "fxN"], -20000));
  assert.equal(signed.loadCases[0].nodal[0].fxN, -20000);
});
test("invalid JSON is retained and never converted into a default example", () => {
  const source = '{"nodes": [';
  const guide = guidedEngineeringFields(source, "frame");
  assert.equal(guide.fields.length, 0); assert.ok(guide.problem);
  assert.throws(() => updateGuidedEngineeringNumber(source, "frame", ["nodes", 0, "xM"], 1), /not available/);
  assert.equal(source, '{"nodes": [');
});
test("guided fields reject non-finite, overflow, nonphysical and unlisted edits", () => {
  for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => updateGuidedEngineeringNumber(water, "water", ["nodes", 0, "elevationM"], value), /finite/);
  assert.throws(() => updateGuidedEngineeringNumber(frame, "frame", ["members", 0, "elasticModulusPa"], Number.MAX_VALUE), /finite/);
  assert.throws(() => updateGuidedEngineeringNumber(water, "water", ["links", 0, "diameterM"], 0), /greater than zero/);
  assert.throws(() => updateGuidedEngineeringNumber(water, "water", ["links", 0, "roughnessM"], -1), /zero or a positive/);
  assert.throws(() => updateGuidedEngineeringNumber(frame, "frame", ["nodes", 0, "restraints", 0], 1), /not available/);
  assert.throws(() => updateGuidedEngineeringNumber(frame, "frame", ["__proto__", "xM"], 1), /not available/);
});
test("guide limits rendering and never reinterprets air pressure as water head", () => {
  const large = JSON.parse(water); large.nodes = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, elevationM: i, demandM3s: .001 }));
  const guide = guidedEngineeringFields(JSON.stringify(large), "water");
  assert.equal(guide.limited, true); assert.ok(guide.fields.length <= 240);
  assert.equal(guide.fields.some(field => field.path.join(".") === "nodes.30.elevationM"), false);
  assert.match(guidedEngineeringFields(water.replace('"water"', '"air"'), "water").problem ?? "", /water network/);
  assert.deepEqual(guidedEngineeringFields(frame, "electrical"), { fields: [], problem: null, limited: false });
});
test("result summaries show diagnostics without manufacturing successful verification", () => {
  const result = engineeringResultSummary("water", { status: "converged", iterations: 5, totalSupplyM3s: .002, totalDemandM3s: .002, maxMassResidualM3s: 1e-8 });
  assert.equal(result.find(row => row.label === "Total supply (L/s)")?.value, "2");
  assert.equal(result.some(row => /pass|verified|compliant/i.test(row.value)), false);
  const structural = engineeringResultSummary("frame", { results: [{ status: "converged", displacements: [{ uxM: .003, uyM: .004 }] }] });
  assert.equal(structural.find(row => row.label === "Maximum nodal translation (mm)")?.value, "5");
  assert.deepEqual(engineeringResultSummary("unknown", {}), []);
});
test("civil datum validation names the field and next action while preserving other errors", () => {
  assert.match(civilInputErrorMessage(new Error("Invalid bounded unchanged vertical datum.")), /Enter the unchanged vertical datum.*coordinate reference declaration/);
  assert.equal(civilInputErrorMessage(new Error("Triangle budget exceeded")), "Triangle budget exceeded");
});
