import { frameCombinationFactor, frameLoadCombinations, parseFrameModel, type FrameModel2D } from "./frameAnalysis";
import { parseFluidNetwork, type FluidNetwork } from "./engineeringNetworks";

export interface SolverDeck {
  filename: string; content: string;
  mapping: { nodes: { sourceId: string; solverId: string }[]; members: { sourceId: string; solverId: string }[]; combinationId?: string };
  nativeRunRequired: true; warnings: string[];
}
const numeric = (value: number) => {
  if (!Number.isFinite(value)) throw new Error("Cannot export non-finite solver input.");
  return value.toPrecision(15);
};

function frameContext(input: FrameModel2D, combinationId?: string) {
  const model = parseFrameModel(input), combinations = frameLoadCombinations(model);
  const combination = combinationId === undefined ? combinations[0] : combinations.find(item => item.id === combinationId);
  if (!combination) throw new Error("Selected load combination does not exist.");
  const nodes = new Map(model.nodes.map((node, index) => [node.id, index + 1])), members = new Map(model.members.map((member, index) => [member.id, index + 1]));
  const nodal = new Map(model.nodes.map(node => [node.id, [0, 0, 0]])), uniform = new Map(model.members.map(member => [member.id, [0, 0]]));
  model.loadCases.forEach(loadCase => {
    const factor = frameCombinationFactor(combination, loadCase.id);
    loadCase.nodal.forEach(load => { const values = nodal.get(load.node)!; values[0] += factor * load.fxN; values[1] += factor * load.fyN; values[2] += factor * load.mzNm; });
    loadCase.uniform.forEach(load => { const values = uniform.get(load.member)!; values[0] += factor * load.axialNPerM; values[1] += factor * load.transverseNPerM; });
  });
  const mapping = { nodes: [...nodes].map(([sourceId, solverId]) => ({ sourceId, solverId: String(solverId) })), members: [...members].map(([sourceId, solverId]) => ({ sourceId, solverId: String(solverId) })), combinationId: combination.id };
  return { model, combination, nodes, members, nodal, uniform, mapping };
}

/** Produces a Tcl deck; exporting never executes or launches OpenSees. */
export function exportOpenSees2D(input: FrameModel2D, combinationId?: string): SolverDeck {
  const context = frameContext(input, combinationId), { model, nodes, members, nodal, uniform, mapping } = context;
  const lines = ["# Secure-Nexus 2D elastic frame; SI units N, m, Pa; independently verify before use.", "wipe", "model BasicBuilder -ndm 2 -ndf 3"];
  model.nodes.forEach(node => {
    lines.push(`node ${nodes.get(node.id)} ${numeric(node.xM)} ${numeric(node.yM)}`);
    if (node.restraints.some(Boolean)) lines.push(`fix ${nodes.get(node.id)} ${node.restraints.map(value => value ? 1 : 0).join(" ")}`);
  });
  lines.push(`geomTransf ${model.analysis === "p-delta" ? "PDelta" : "Linear"} 1`);
  model.members.forEach(member => lines.push(`element elasticBeamColumn ${members.get(member.id)} ${nodes.get(member.start)} ${nodes.get(member.end)} ${numeric(member.areaM2)} ${numeric(member.elasticModulusPa)} ${numeric(member.inertiaM4)} 1`));
  lines.push("timeSeries Linear 1", "pattern Plain 1 1 {");
  nodal.forEach((values, id) => { if (values.some(value => value !== 0)) lines.push(`  load ${nodes.get(id)} ${values.map(numeric).join(" ")}`); });
  uniform.forEach((values, id) => { if (values.some(value => value !== 0)) lines.push(`  eleLoad -ele ${members.get(id)} -type -beamUniform ${numeric(values[1])} ${numeric(values[0])}`); });
  lines.push("}", "constraints Plain", "numberer RCM", "system BandGeneral", "test NormDispIncr 1.0e-10 40", `algorithm ${model.analysis === "p-delta" ? "Newton" : "Linear"}`, "integrator LoadControl 0.1", "analysis Static", "set status [analyze 10]", "if {$status != 0} { error {Static analysis did not converge; no accepted result exported.} }", "reactions", "set output [open secure-nexus-node-displacements.txt w]");
  model.nodes.forEach(node => lines.push(`puts $output "${nodes.get(node.id)} [nodeDisp ${nodes.get(node.id)}]"`));
  lines.push("close $output", "set output [open secure-nexus-node-reactions.txt w]");
  model.nodes.forEach(node => lines.push(`puts $output "${nodes.get(node.id)} [nodeReaction ${nodes.get(node.id)}]"`));
  lines.push("close $output", "set output [open secure-nexus-member-global-forces.txt w]");
  model.members.forEach(member => lines.push(`puts $output "${members.get(member.id)} [eleForce ${members.get(member.id)}]"`));
  lines.push("close $output", "puts {Secure-Nexus analysis completed. Keep the mapping manifest with the result files.}");
  return { filename: "secure-nexus-frame.tcl", content: lines.join("\n") + "\n", mapping, nativeRunRequired: true, warnings: ["Deck covers the selected combination only. Nodal displacements/reactions and member global end forces are written with integer solver tags.", "OpenSees PDelta transformation and the browser's consistent initial-stress formulation are different approximations; compare independently and refine the frame mesh.", "OpenSees executable installation, execution, results verification, material nonlinear analysis and certified design remain external engineering tasks."] };
}

/** STAAD PLANE subset with prismatic elastic members; nonlinear export is rejected. */
export function exportStaadPlane(input: FrameModel2D, combinationId?: string): SolverDeck {
  const { model, nodes, members, nodal, uniform, mapping } = frameContext(input, combinationId);
  if (model.analysis === "p-delta") throw new Error("STAAD export currently supports linear analysis only. Use the OpenSees PDelta deck for geometric analysis.");
  const lines = ["STAAD PLANE", "* Secure-Nexus elastic plane frame; selected combination only", "UNIT METER NEWTON", "JOINT COORDINATES"];
  model.nodes.forEach(node => lines.push(`${nodes.get(node.id)} ${numeric(node.xM)} ${numeric(node.yM)} 0`));
  lines.push("MEMBER INCIDENCES");
  model.members.forEach(member => lines.push(`${members.get(member.id)} ${nodes.get(member.start)} ${nodes.get(member.end)}`));
  lines.push("MEMBER PROPERTY");
  model.members.forEach(member => lines.push(`${members.get(member.id)} PRIS AX ${numeric(member.areaM2)} IZ ${numeric(member.inertiaM4)}`));
  lines.push("CONSTANTS");
  model.members.forEach(member => lines.push(`E ${numeric(member.elasticModulusPa)} MEMB ${members.get(member.id)}`));
  lines.push("SUPPORTS");
  model.nodes.forEach(node => {
    if (!node.restraints.some(Boolean)) return;
    const free = ["FX", "FY", "MZ"].filter((_, i) => !node.restraints[i]);
    lines.push(`${nodes.get(node.id)} FIXED${free.length ? ` BUT ${free.join(" ")}` : ""}`);
  });
  lines.push("LOAD 1 TITLE USER_FACTORED_COMBINATION");
  if ([...nodal.values()].some(values => values.some(value => value !== 0))) {
    lines.push("JOINT LOAD");
    nodal.forEach((values, id) => { if (values.some(value => value !== 0)) lines.push(`${nodes.get(id)} FX ${numeric(values[0])} FY ${numeric(values[1])} MZ ${numeric(values[2])}`); });
  }
  if ([...uniform.values()].some(values => values.some(value => value !== 0))) {
    lines.push("MEMBER LOAD");
    uniform.forEach((values, id) => { if (values[0] !== 0) lines.push(`${members.get(id)} UNI X ${numeric(values[0])}`); if (values[1] !== 0) lines.push(`${members.get(id)} UNI Y ${numeric(values[1])}`); });
  }
  lines.push("PERFORM ANALYSIS", "PRINT JOINT DISPLACEMENTS ALL", "PRINT SUPPORT REACTION ALL", "PRINT MEMBER FORCES ALL", "FINISH");
  return { filename: "secure-nexus-frame.std", content: lines.join("\n") + "\n", mapping, nativeRunRequired: true, warnings: ["Linear elastic XY-plane subset only. Section AX/IZ properties do not provide code-design classification.", "STAAD syntax, member local axes, reported signs and unit fidelity have not been validated by executing STAAD. Retain the mapping manifest."] };
}

export function exportEpanetNetwork(input: FluidNetwork): SolverDeck {
  const network = parseFluidNetwork(input);
  if (network.medium !== "water") throw new Error("EPANET export requires a water network.");
  if (network.links.some(link => (link.addedPotential ?? 0) !== 0)) throw new Error("EPANET pipe export cannot represent constant pump-head gains. Model a reservoir boundary or supply a native pump curve externally.");
  if (network.nodes.some(node => node.fixedPotential !== undefined && (node.demandM3s !== 0 || (node.emitterCoefficient ?? 0) !== 0))) throw new Error("EPANET reservoirs cannot carry local demand or emitters in this export.");
  const nodes = new Map(network.nodes.map((node, i) => [node.id, `N${i + 1}`])), members = new Map(network.links.map((link, i) => [link.id, `P${i + 1}`]));
  const lines = ["[TITLE]", "Secure-Nexus steady water network; SI inputs exported with LPS units", "", "[JUNCTIONS]", ";ID Elevation_m Demand_LPS"];
  network.nodes.filter(node => node.fixedPotential === undefined).forEach(node => lines.push(`${nodes.get(node.id)} ${numeric(node.elevationM)} ${numeric(node.demandM3s * 1000)}`));
  lines.push("", "[RESERVOIRS]", ";ID Total_head_m");
  network.nodes.filter(node => node.fixedPotential !== undefined).forEach(node => lines.push(`${nodes.get(node.id)} ${numeric(node.fixedPotential!)}`));
  lines.push("", "[PIPES]", ";ID Node1 Node2 Length_m Diameter_mm Roughness_mm MinorLoss Status");
  network.links.forEach(link => lines.push(`${members.get(link.id)} ${nodes.get(link.from)} ${nodes.get(link.to)} ${numeric(link.lengthM)} ${numeric(link.diameterM! * 1000)} ${numeric(link.roughnessM * 1000)} ${numeric(link.minorLossK)} Open`));
  lines.push("", "[EMITTERS]", ";ID Coefficient_LPS_per_sqrt_m");
  network.nodes.filter(node => (node.emitterCoefficient ?? 0) > 0).forEach(node => lines.push(`${nodes.get(node.id)} ${numeric(node.emitterCoefficient! * 1000)}`));
  lines.push("", "[OPTIONS]", "UNITS LPS", "HEADLOSS D-W", `SPECIFIC GRAVITY ${numeric(network.densityKgM3 / 998.2)}`, `VISCOSITY ${numeric(network.kinematicViscosityM2s / 1e-6)}`, "EMITTER EXPONENT 0.5", "DEMAND MODEL DDA", "TRIALS 80", "ACCURACY 0.0001", "UNBALANCED STOP", "", "[TIMES]", "DURATION 0", "", "[REPORT]", "STATUS YES", "NODES ALL", "LINKS ALL", "", "[END]");
  return { filename: "secure-nexus-water.inp", content: lines.join("\n") + "\n", mapping: { nodes: [...nodes].map(([sourceId, solverId]) => ({ sourceId, solverId })), members: [...members].map(([sourceId, solverId]) => ({ sourceId, solverId })) }, nativeRunRequired: true, warnings: ["EPANET uses a different transitional-flow friction interpolation; compare energy and mass balance rather than expecting identical outputs.", "Water pipes/reservoirs/junctions/emitters only. Air systems, pressure gains, pump curves, native valve controls, temporal scenarios and coordinates are excluded.", "EPANET interoperability remains unverified until an independent native run is authorized."] };
}
