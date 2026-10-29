import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFrame2D, type FrameModel2D } from "../src/lib/frameAnalysis";
import { analyzeFrame3D, type FrameModel3D } from "../src/lib/frameAnalysis3D";
import { solveFluidNetwork, type FluidNetwork } from "../src/lib/engineeringNetworks";
import { updateGuidedEngineeringNumber } from "../src/lib/guidedEngineering";

/*
 * Numerical reference acceptance, not independent professional certification.
 * The expectations below come from integrated continuum equations/statics, not
 * this application's element matrices or nonlinear network iteration.
 *
 * Primary references (reviewed 29 October 2026):
 * MIT 2.002, Parks, Euler–Bernoulli Beams, slides 3–9: M=EI v'',
 * cantilever tip v=PL^3/(3EI), rotation=PL^2/(2EI), and equilibrium.
 * https://ocw.mit.edu/courses/2-002-mechanics-and-materials-ii-spring-2004/bc25a56b5a91ad29ca5c7419616686f7_lec2.pdf
 * MIT 16.001, Statically Indeterminate Systems, p.5: axial extension PL/(EA).
 * https://ocw.mit.edu/courses/16-001-unified-engineering-materials-and-structures-fall-2021/mit16_001_f21_lec08.pdf
 * MIT 16.20, Lagace, Unit 10 p.26: twist rate T/(GJ).
 * https://ocw.mit.edu/courses/16-20-structural-mechanics-fall-2002/e888339011c834eb2a02bd365fa25052_unit10.pdf
 * USEPA, EPANET 2.2 User Manual, EPA/600/R-20/133, sections 3.1 and 12.1:
 * laminar Hagen–Poiseuille flow, Darcy–Weisbach energy loss and nodal continuity.
 * https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P10113EM.TXT
 *
 * Structural assumptions: static, small displacement, prismatic linear elastic
 * Euler–Bernoulli members, rigid joints, zero support movement; no shear deformation,
 * yielding, geometric nonlinearity or national-code capacity verification.
 * Fluid assumptions: steady, incompressible, full circular pipes; constant viscosity;
 * Reynolds number <2,000, zero minor loss and no pumps/emitters/valves. The water
 * head datum is total hydraulic head; air potential is pressure in Pa.
 */

const E = 210e9, A = 0.012, I = 8e-5, L = 4;
const gravity = 9.80665;
function close(actual: number, expected: number, label: string, relative = 2e-9, absolute = 1e-11): void {
  assert.ok(Number.isFinite(actual), `${label} must be finite`);
  assert.ok(Math.abs(actual - expected) <= Math.max(absolute, Math.abs(expected) * relative), `${label}: ${actual} versus analytic ${expected}`);
}
function cantilever2D(angle = 0): FrameModel2D {
  return {
    version: 1, analysis: "linear",
    nodes: [{ id: "base", xM: 12, yM: -7, restraints: [true, true, true] }, { id: "tip", xM: 12 + L * Math.cos(angle), yM: -7 + L * Math.sin(angle), restraints: [false, false, false] }],
    members: [{ id: "member", start: "base", end: "tip", elasticModulusPa: E, areaM2: A, inertiaM4: I }],
    loadCases: [{ id: "reference", nodal: [], uniform: [] }],
  };
}
function circularNetwork(): FluidNetwork {
  return {
    version: 1, medium: "water", densityKgM3: 998.2, kinematicViscosityM2s: 1e-6,
    nodes: [{ id: "source", elevationM: 0, fixedPotential: 30, demandM3s: 0 }, { id: "terminal", elevationM: 2, demandM3s: 1e-6 }],
    links: [{ id: "pipe", from: "source", to: "terminal", lengthM: 10, diameterM: .02, roughnessM: 0, minorLossK: 0 }],
    options: { flowToleranceM3s: 1e-10, maxIterations: 30 },
  };
}
// Independent closed-form Hagen–Poiseuille relation, with head converted to pressure.
const laminarHeadResistance = (length: number, diameter: number, viscosity: number) => 128 * viscosity * length / (Math.PI * gravity * diameter ** 4);

test("reference: rotated 2D cantilever satisfies integrated bending/axial equations and global statics", () => {
  const angle = Math.PI / 6, c = Math.cos(angle), s = Math.sin(angle);
  const axial = 22000, transverse = -8000, moment = 3200;
  const fx = axial * c - transverse * s, fy = axial * s + transverse * c;
  const input = cantilever2D(angle);
  input.loadCases[0].nodal = [{ node: "tip", fxN: fx, fyN: fy, mzNm: moment }];
  const before = structuredClone(input), report = analyzeFrame2D(input), result = report.results[0];
  const tip = result.displacements.find(node => node.nodeId === "tip")!, base = result.reactions[0];
  const u = axial * L / (E * A);
  const v = transverse * L ** 3 / (3 * E * I) + moment * L ** 2 / (2 * E * I);
  const rotation = transverse * L ** 2 / (2 * E * I) + moment * L / (E * I);
  close(tip.uxM, u * c - v * s, "global X translation");
  close(tip.uyM, u * s + v * c, "global Y translation");
  close(tip.rotationRad, rotation, "tip rotation");
  close(base.fxN + fx, 0, "horizontal balance", 0, 1e-7);
  close(base.fyN + fy, 0, "vertical balance", 0, 1e-7);
  close(base.mzNm + transverse * L + moment, 0, "moment balance about base", 0, 1e-7);
  assert.equal(result.status, "converged");
  assert.equal(report.verification, "unverified");
  assert.deepEqual(input, before);
});

test("reference: uniform cantilever load integrates to qL^4/8EI and qL^3/6EI", () => {
  const q = -1200, input = cantilever2D();
  input.loadCases[0].uniform = [{ member: "member", axialNPerM: 0, transverseNPerM: q }];
  const result = analyzeFrame2D(input).results[0], tip = result.displacements[1], base = result.reactions[0];
  close(tip.uyM, q * L ** 4 / (8 * E * I), "uniform-load tip deflection");
  close(tip.rotationRad, q * L ** 3 / (6 * E * I), "uniform-load tip rotation");
  close(base.fyN, -q * L, "uniform-load vertical reaction");
  close(base.mzNm, -q * L ** 2 / 2, "uniform-load reaction moment");
});

test("reference: simply supported two-element span matches central-load deflection and reactions", () => {
  const load = -16000;
  const input: FrameModel2D = {
    version: 1, analysis: "linear",
    nodes: [{ id: "left", xM: 0, yM: 0, restraints: [true, true, false] }, { id: "mid", xM: L / 2, yM: 0, restraints: [false, false, false] }, { id: "right", xM: L, yM: 0, restraints: [false, true, false] }],
    members: [{ id: "a", start: "left", end: "mid", areaM2: A, inertiaM4: I, elasticModulusPa: E }, { id: "b", start: "mid", end: "right", areaM2: A, inertiaM4: I, elasticModulusPa: E }],
    loadCases: [{ id: "central", nodal: [{ node: "mid", fxN: 0, fyN: load, mzNm: 0 }], uniform: [] }],
  };
  const result = analyzeFrame2D(input).results[0];
  close(result.displacements[1].uyM, load * L ** 3 / (48 * E * I), "central deflection from integrated moment/curvature");
  close(result.displacements[1].rotationRad, 0, "symmetric midspan rotation");
  for (const support of result.reactions) {
    close(support.fyN, -load / 2, `${support.nodeId} vertical reaction`);
    close(support.mzNm, 0, `${support.nodeId} pin/roller moment`);
  }
});

test("reference: 3D cantilever superposes axial, biaxial bending and torsion without cross-axis contamination", () => {
  const iy = 6e-5, iz = 9e-5, j = 1.2e-4, g = 80e9;
  const force = { fxN: 13000, fyN: -4800, fzN: 2700, mxNm: 1800, myNm: -900, mzNm: 600 };
  const input: FrameModel3D = {
    version: 1, analysis: "linear",
    nodes: [{ id: "base", xM: 3, yM: -2, zM: 5, restraints: [true, true, true, true, true, true] }, { id: "tip", xM: 3 + L, yM: -2, zM: 5, restraints: [false, false, false, false, false, false] }],
    members: [{ id: "member", start: "base", end: "tip", areaM2: A, inertiaYM4: iy, inertiaZM4: iz, torsionConstantM4: j, elasticModulusPa: E, shearModulusPa: g, localYAxis: [0, 1, 0] }],
    loadCases: [{ id: "combined", nodal: [{ node: "tip", ...force }], uniform: [] }],
  };
  const report = analyzeFrame3D(input), result = report.results[0], tip = result.displacements[1], base = result.reactions[0];
  close(tip.uxM, force.fxN * L / (E * A), "3D axial extension");
  close(tip.uyM, force.fyN * L ** 3 / (3 * E * iz) + force.mzNm * L ** 2 / (2 * E * iz), "3D Y bending displacement");
  close(tip.uzM, force.fzN * L ** 3 / (3 * E * iy) - force.myNm * L ** 2 / (2 * E * iy), "3D Z bending displacement");
  close(tip.rxRad, force.mxNm * L / (g * j), "3D torsional twist");
  close(tip.ryRad, -force.fzN * L ** 2 / (2 * E * iy) + force.myNm * L / (E * iy), "3D Y rotation");
  close(tip.rzRad, force.fyN * L ** 2 / (2 * E * iz) + force.mzNm * L / (E * iz), "3D Z rotation");
  close(base.fxN + force.fxN, 0, "3D X balance", 0, 1e-7);
  close(base.fyN + force.fyN, 0, "3D Y balance", 0, 1e-7);
  close(base.fzN + force.fzN, 0, "3D Z balance", 0, 1e-7);
  close(base.mxNm + force.mxNm, 0, "3D torsion balance", 0, 1e-7);
  close(base.myNm + force.myNm - L * force.fzN, 0, "3D Y moment balance", 0, 1e-7);
  close(base.mzNm + force.mzNm + L * force.fyN, 0, "3D Z moment balance", 0, 1e-7);
  assert.equal(report.verification, "unverified");
});

test("reference: serial laminar water pipes match Hagen–Poiseuille head loss and conservation", () => {
  const input = circularNetwork(), q = 1e-6;
  input.nodes.splice(1, 0, { id: "junction", elevationM: 1, demandM3s: 0 });
  input.links = [input.links[0], { ...input.links[0], id: "tail", from: "junction", to: "terminal", diameterM: .015, lengthM: 7 }];
  input.links[0].to = "junction";
  const result = solveFluidNetwork(input);
  const firstHeadLoss = laminarHeadResistance(10, .02, input.kinematicViscosityM2s) * q;
  const secondHeadLoss = laminarHeadResistance(7, .015, input.kinematicViscosityM2s) * q;
  close(result.nodes[1].potential, 30 - firstHeadLoss, "junction total head", 1e-10);
  close(result.nodes[2].pressure, 30 - firstHeadLoss - secondHeadLoss - 2, "terminal pressure head", 1e-10);
  for (const link of result.links) {
    close(link.flowM3s, q, `${link.linkId} flow`, 1e-7, 1e-13);
    assert.ok(link.reynolds > 0 && link.reynolds < 2000, "fixture stays in the declared laminar regime");
    close(link.frictionFactor, 64 / link.reynolds, `${link.linkId} Darcy friction factor`);
    close(link.energyResidual, 0, `${link.linkId} energy balance`, 0, 1e-10);
  }
  close(result.totalSupplyM3s, q, "reservoir supply", 1e-7, 1e-13);
  close(result.globalMassResidualM3s, 0, "global mass balance", 0, 1e-12);
  assert.equal(result.status, "converged");
  assert.equal(result.verification, "unverified");
});

test("reference: parallel laminar branches split flow by conductance and respect reversed link orientation", () => {
  const input = circularNetwork(), total = 3e-6;
  input.nodes[1].demandM3s = total;
  input.links.push({ ...input.links[0], id: "reversed", from: "terminal", to: "source", lengthM: 20 });
  const result = solveFluidNetwork(input);
  close(result.links[0].flowM3s, total * 2 / 3, "short branch flow", 1e-7, 1e-13);
  close(result.links[1].flowM3s, -total / 3, "reversed long branch flow", 1e-7, 1e-13);
  close(result.nodes[1].potential, 30 - laminarHeadResistance(10, .02, input.kinematicViscosityM2s) * total * 2 / 3, "parallel terminal head", 1e-10);
  close(result.links[0].flowM3s - result.links[1].flowM3s, total, "junction continuity", 1e-7, 1e-13);
  close(result.globalMassResidualM3s, 0, "parallel global mass balance", 0, 1e-12);
  assert.equal(result.status, "converged");
});

test("reference: water-head and air-pressure boundary solves reproduce circular laminar pressure-flow units", () => {
  for (const medium of ["water", "air"] as const) {
    const input = circularNetwork();
    input.medium = medium;
    input.densityKgM3 = medium === "water" ? 998.2 : 1.2;
    input.kinematicViscosityM2s = medium === "water" ? 1e-6 : 1.5e-5;
    const difference = medium === "water" ? .001 : 1;
    input.nodes = [{ id: "source", elevationM: 0, demandM3s: 0, fixedPotential: difference }, { id: "terminal", elevationM: 0, demandM3s: 0, fixedPotential: 0 }];
    input.links[0].lengthM = 20;
    const pressureDifference = medium === "water" ? difference * input.densityKgM3 * gravity : difference;
    const dynamicViscosity = input.densityKgM3 * input.kinematicViscosityM2s;
    const analyticFlow = Math.PI * .02 ** 4 * pressureDifference / (128 * dynamicViscosity * 20);
    assert.ok(4 * analyticFlow / (Math.PI * .02 * input.kinematicViscosityM2s) < 2000, "analytic fixture must remain laminar");
    const result = solveFluidNetwork(input), link = result.links[0];
    close(link.flowM3s, analyticFlow, `${medium} pressure-flow relation`, 1e-8, 1e-13);
    close(link.potentialLoss, difference, `${medium} potential drop`, 1e-8);
    assert.ok(link.reynolds < 2000);
    assert.equal(result.nodes[0].pressureUnit, medium === "water" ? "m-water" : "Pa");
  }
});

test("reference: guided modulus/diameter conversions give the same physical response as direct SI inputs", () => {
  const structural = cantilever2D();
  structural.loadCases[0].nodal = [{ node: "tip", fxN: 0, fyN: -8000, mzNm: 0 }];
  const changed = JSON.parse(updateGuidedEngineeringNumber(JSON.stringify(structural), "frame", ["members", 0, "elasticModulusPa"], 200)) as FrameModel2D;
  close(analyzeFrame2D(changed).results[0].displacements[1].uyM, -8000 * L ** 3 / (3 * 200e9 * I), "200 GPa interpreted as Pa");
  const hydraulic = circularNetwork();
  const converted = JSON.parse(updateGuidedEngineeringNumber(JSON.stringify(hydraulic), "water", ["links", 0, "diameterM"], 25)) as FluidNetwork;
  const result = solveFluidNetwork(converted);
  close(result.nodes[1].potential, 30 - laminarHeadResistance(10, .025, 1e-6) * 1e-6, "25 mm interpreted as metres", 1e-10);
});

test("reference: unsupported structural mechanisms and unanchored hydraulic components reject results", () => {
  const mechanism = cantilever2D();
  mechanism.nodes[0].restraints = [true, true, false];
  mechanism.loadCases[0].nodal = [{ node: "tip", fxN: 0, fyN: -1000, mzNm: 0 }];
  assert.throws(() => analyzeFrame2D(mechanism), /singular|unstable|mechanism|positive stiffness/);
  const missingNode = cantilever2D(); missingNode.members[0].end = "absent";
  assert.throws(() => analyzeFrame2D(missingNode), /invalid end nodes/);
  const unanchored = circularNetwork();
  unanchored.nodes.push({ id: "isolated", elevationM: 0, demandM3s: 1e-6 });
  assert.throws(() => solveFluidNetwork(unanchored), /no fixed pressure\/head boundary/);
});
