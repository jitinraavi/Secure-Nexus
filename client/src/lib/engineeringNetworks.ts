import { engineeringRecord, identifier, requireFinite, solvePositiveSystem } from "./engineeringNumerics";

export interface FluidNode {
  id: string; elevationM: number; demandM3s: number;
  /** Water: total head m. Air: static pressure Pa. Fixed values define reservoirs/fan boundary conditions. */
  fixedPotential?: number; initialPotential?: number; minimumPressure?: number;
  /** Water emitter Q=C sqrt(pressure head), C in m³/s/√m; added to fixed demand. */
  emitterCoefficient?: number;
}
export interface FluidLink {
  id: string; from: string; to: string; lengthM: number; roughnessM: number; minorLossK: number;
  diameterM?: number; widthM?: number; heightM?: number;
  /** Constant head gain m (water) or static pressure gain Pa (air); not a pump curve. */
  addedPotential?: number; maximumVelocityMps?: number;
}
export interface FluidNetwork {
  version: 1; medium: "water" | "air"; densityKgM3: number; kinematicViscosityM2s: number;
  nodes: FluidNode[]; links: FluidLink[]; options?: { flowToleranceM3s?: number; maxIterations?: number };
}
export interface FluidNetworkReport {
  medium: "water" | "air"; status: "converged" | "not-converged"; verification: "unverified"; iterations: number;
  maxMassResidualM3s: number; globalMassResidualM3s: number; totalSupplyM3s: number; totalDemandM3s: number;
  nodes: { nodeId: string; potential: number; pressure: number; pressureUnit: "m-water" | "Pa"; demandM3s: number; sourceSupplyM3s?: number; residualM3s: number; satisfiesMinimumPressure?: boolean }[];
  links: { linkId: string; flowM3s: number; velocityMps: number; frictionFactor: number; reynolds: number; potentialLoss: number; energyResidual: number; satisfiesMaximumVelocity?: boolean }[];
  warnings: string[];
}

export function parseFluidNetwork(value: unknown): FluidNetwork {
  if (!engineeringRecord(value) || value.version !== 1 || (value.medium !== "water" && value.medium !== "air")) throw new Error("Fluid network requires version 1 and medium water or air.");
  requireFinite(value.densityKgM3, "densityKgM3", 0.01, 1e5); requireFinite(value.kinematicViscosityM2s, "kinematicViscosityM2s", 1e-10, 1);
  if (!Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > 80 || !Array.isArray(value.links) || !value.links.length || value.links.length > 200) throw new Error("Fluid network requires 1–80 nodes and 1–200 links.");
  const ids = new Set<string>(), linkIds = new Set<string>();
  for (const node of value.nodes) {
    if (!engineeringRecord(node) || !identifier(node.id) || ids.has(node.id)) throw new Error("Fluid node identifiers must be unique.");
    ids.add(node.id);
    requireFinite(node.elevationM, "elevationM", -1e5, 1e5); requireFinite(node.demandM3s, "demandM3s", 0, 1000);
    for (const key of ["fixedPotential", "initialPotential", "minimumPressure"]) if (node[key] !== undefined) requireFinite(node[key], key, -1e7, 1e7);
    if (node.emitterCoefficient !== undefined) {
      if (value.medium !== "water") throw new Error("Pressure-dependent emitters currently require water.");
      requireFinite(node.emitterCoefficient, "emitterCoefficient", 0, 100);
    }
  }
  if (!value.nodes.some(node => engineeringRecord(node) && node.fixedPotential !== undefined)) throw new Error("Each fluid network needs a fixed pressure/head boundary.");
  for (const link of value.links) {
    if (!engineeringRecord(link) || !identifier(link.id) || linkIds.has(link.id)) throw new Error("Fluid link identifiers must be unique.");
    linkIds.add(link.id);
    if (typeof link.from !== "string" || typeof link.to !== "string" || !ids.has(link.from) || !ids.has(link.to) || link.from === link.to) throw new Error(`${link.id} has invalid end nodes.`);
    requireFinite(link.lengthM, "lengthM", 0.001, 1e6); requireFinite(link.roughnessM, "roughnessM", 0, 1); requireFinite(link.minorLossK, "minorLossK", 0, 1e6);
    if (link.diameterM !== undefined) {
      requireFinite(link.diameterM, "diameterM", 0.001, 20);
      if (link.widthM !== undefined || link.heightM !== undefined) throw new Error("Choose a circular or rectangular link, not both.");
    } else {
      if (value.medium !== "air") throw new Error("Water links require a circular diameter.");
      requireFinite(link.widthM, "widthM", 0.001, 20); requireFinite(link.heightM, "heightM", 0.001, 20);
    }
    if (link.addedPotential !== undefined) requireFinite(link.addedPotential, "addedPotential", -1e7, 1e7);
    if (link.maximumVelocityMps !== undefined) requireFinite(link.maximumVelocityMps, "maximumVelocityMps", 0.001, 1000);
    if (link.pumpCurve || link.checkValve || link.controlValve) throw new Error("Pump curves, directional check valves, and control valves are unsupported in this steady solver.");
  }
  if (value.options !== undefined) {
    if (!engineeringRecord(value.options)) throw new Error("Invalid fluid solver options.");
    if (value.options.flowToleranceM3s !== undefined) requireFinite(value.options.flowToleranceM3s, "flowToleranceM3s", 1e-10, 0.01);
    if (value.options.maxIterations !== undefined) {
      const count = requireFinite(value.options.maxIterations, "maxIterations", 2, 80);
      if (!Number.isInteger(count)) throw new Error("Fluid maxIterations must be an integer.");
    }
  }
  const network = value as unknown as FluidNetwork;
  // Every component must contain a prescribed potential; prevent arbitrary unanchored head solutions.
  const adjacent = new Map(network.nodes.map(node => [node.id, [] as string[]]));
  network.links.forEach(link => { adjacent.get(link.from)!.push(link.to); adjacent.get(link.to)!.push(link.from); });
  const visited = new Set<string>();
  for (const node of network.nodes) {
    if (visited.has(node.id)) continue;
    const queue = [node.id]; visited.add(node.id); let boundary = false;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor]; boundary ||= network.nodes.find(item => item.id === current)!.fixedPotential !== undefined;
      for (const next of adjacent.get(current)!) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
    if (!boundary) throw new Error(`Component containing ${node.id} has no fixed pressure/head boundary.`);
  }
  return network;
}

function linkGeometry(link: FluidLink) {
  if (link.diameterM !== undefined) return { area: Math.PI * link.diameterM ** 2 / 4, diameter: link.diameterM };
  const width = link.widthM!, height = link.heightM!;
  return { area: width * height, diameter: 2 * width * height / (width + height) };
}

function lossForFlow(network: FluidNetwork, link: FluidLink, flowM3s: number) {
  const { area, diameter } = linkGeometry(link), velocity = Math.abs(flowM3s) / area;
  const reynolds = velocity * diameter / network.kinematicViscosityM2s;
  const laminar = reynolds > 0 ? 64 / reynolds : 0;
  const turbulent = (re: number) => 0.25 / Math.log10(link.roughnessM / (3.7 * diameter) + 5.74 / re ** 0.9) ** 2;
  let frictionFactor = reynolds <= 2000 ? laminar : turbulent(reynolds);
  // Smooth transition; deliberately different from EPANET's Dunlop cubic interpolation.
  if (reynolds > 2000 && reynolds < 4000) {
    const t = (reynolds - 2000) / 2000, blend = t * t * (3 - 2 * t);
    frictionFactor = laminar * (1 - blend) + turbulent(reynolds) * blend;
  }
  const pressureFactor = network.medium === "water" ? 1 / (2 * 9.80665) : network.densityKgM3 / 2;
  // At Q=0, calculate the laminar linear term separately instead of multiplying infinity by zero.
  const frictionLoss = reynolds <= 2000 ? 64 * network.kinematicViscosityM2s * link.lengthM * velocity / diameter ** 2 * pressureFactor : frictionFactor * link.lengthM / diameter * velocity ** 2 * pressureFactor;
  const magnitude = frictionLoss + link.minorLossK * velocity ** 2 * pressureFactor;
  return { loss: Math.sign(flowM3s) * magnitude, reynolds, frictionFactor, velocity };
}

function flowForPotential(network: FluidNetwork, link: FluidLink, difference: number) {
  if (difference === 0) return { flow: 0, conductance: laminarConductance(network, link) };
  const target = Math.abs(difference); let low = 0, high = 1e-6;
  for (let step = 0; step < 40 && lossForFlow(network, link, high).loss < target; step++) high *= 2;
  if (high > 1e6 || lossForFlow(network, link, high).loss < target) throw new Error(`Link ${link.id} exceeds supported flow bounds.`);
  for (let step = 0; step < 60; step++) {
    const mid = (low + high) / 2;
    if (lossForFlow(network, link, mid).loss > target) high = mid; else low = mid;
  }
  const magnitude = (low + high) / 2, delta = Math.max(1e-12, magnitude * 1e-5);
  const lower = Math.max(0, magnitude - delta), upper = magnitude + delta;
  const slope = (lossForFlow(network, link, upper).loss - lossForFlow(network, link, lower).loss) / (upper - lower);
  if (!Number.isFinite(slope) || slope <= 0) throw new Error(`Link ${link.id} has an invalid resistance gradient.`);
  return { flow: Math.sign(difference) * magnitude, conductance: 1 / slope };
}

function laminarConductance(network: FluidNetwork, link: FluidLink) {
  const { area, diameter } = linkGeometry(link), factor = network.medium === "water" ? 1 / (2 * 9.80665) : network.densityKgM3 / 2;
  return area * diameter ** 2 / (64 * network.kinematicViscosityM2s * link.lengthM * factor);
}

export function solveFluidNetwork(input: FluidNetwork): FluidNetworkReport {
  const network = parseFluidNetwork(input), nodeIndex = new Map(network.nodes.map((node, index) => [node.id, index]));
  const free = network.nodes.map((node, index) => node.fixedPotential === undefined ? index : -1).filter(index => index >= 0), freeIndex = new Map(free.map((node, index) => [node, index]));
  const meanBoundary = network.nodes.filter(node => node.fixedPotential !== undefined).reduce((sum, node) => sum + node.fixedPotential!, 0) / network.nodes.filter(node => node.fixedPotential !== undefined).length;
  let potential = network.nodes.map(node => node.fixedPotential ?? node.initialPotential ?? meanBoundary);
  const evaluate = (heads: number[]) => {
    const demand = network.nodes.map((node, i) => node.demandM3s + (node.emitterCoefficient ?? 0) * Math.sqrt(Math.max(heads[i] - node.elevationM, 0)));
    const residual = [...demand], links = network.links.map(link => flowForPotential(network, link, heads[nodeIndex.get(link.from)!] - heads[nodeIndex.get(link.to)!] + (link.addedPotential ?? 0)));
    links.forEach((result, i) => { residual[nodeIndex.get(network.links[i].from)!] += result.flow; residual[nodeIndex.get(network.links[i].to)!] -= result.flow; });
    const norm = Math.max(0, ...free.map(i => Math.abs(residual[i])));
    return { demand, residual, links, norm };
  };
  let state = evaluate(potential), iterations = 0;
  const tolerance = network.options?.flowToleranceM3s ?? 1e-7, maxIterations = network.options?.maxIterations ?? 60;
  for (let iteration = 0; iteration < maxIterations && state.norm > tolerance; iteration++) {
    const matrix = Array.from({ length: free.length }, () => Array<number>(free.length).fill(0));
    network.links.forEach((link, i) => {
      const a = freeIndex.get(nodeIndex.get(link.from)!), b = freeIndex.get(nodeIndex.get(link.to)!), g = state.links[i].conductance;
      if (a !== undefined) matrix[a][a] += g; if (b !== undefined) matrix[b][b] += g;
      if (a !== undefined && b !== undefined) { matrix[a][b] -= g; matrix[b][a] -= g; }
    });
    free.forEach((node, i) => {
      const pressure = potential[node] - network.nodes[node].elevationM;
      if (pressure > 0) matrix[i][i] += (network.nodes[node].emitterCoefficient ?? 0) / (2 * Math.sqrt(pressure));
    });
    const change = solvePositiveSystem(matrix, free.map(i => -state.residual[i]));
    let accepted = false;
    for (let step = 0; step < 16; step++) {
      const scale = 0.5 ** step, next = [...potential];
      free.forEach((node, i) => { next[node] += scale * change[i]; });
      if (next.some(value => !Number.isFinite(value) || Math.abs(value) > 1e8)) continue;
      const candidate = evaluate(next);
      if (candidate.norm < state.norm || candidate.norm <= tolerance) { potential = next; state = candidate; accepted = true; break; }
    }
    iterations = iteration + 1;
    if (!accepted) break;
  }
  const converged = state.norm <= tolerance;
  const nodes = network.nodes.map((node, i) => {
    const pressure = network.medium === "water" ? potential[i] - node.elevationM : potential[i];
    return { nodeId: node.id, potential: potential[i], pressure, pressureUnit: network.medium === "water" ? "m-water" as const : "Pa" as const, demandM3s: state.demand[i], sourceSupplyM3s: node.fixedPotential !== undefined ? state.residual[i] : undefined, residualM3s: node.fixedPotential !== undefined ? 0 : state.residual[i], satisfiesMinimumPressure: node.minimumPressure === undefined ? undefined : converged && pressure >= node.minimumPressure };
  });
  const links = network.links.map((link, i) => {
    const flow = state.links[i].flow, loss = lossForFlow(network, link, flow);
    return { linkId: link.id, flowM3s: flow, velocityMps: Math.sign(flow) * loss.velocity, frictionFactor: loss.frictionFactor, reynolds: loss.reynolds, potentialLoss: loss.loss, energyResidual: potential[nodeIndex.get(link.from)!] - potential[nodeIndex.get(link.to)!] + (link.addedPotential ?? 0) - loss.loss, satisfiesMaximumVelocity: link.maximumVelocityMps === undefined ? undefined : converged && loss.velocity <= link.maximumVelocityMps };
  });
  const totalSupplyM3s = nodes.reduce((sum, node) => sum + (node.sourceSupplyM3s ?? 0), 0), totalDemandM3s = state.demand.reduce((sum, demand) => sum + demand, 0);
  return { medium: network.medium, status: converged ? "converged" : "not-converged", verification: "unverified", iterations, maxMassResidualM3s: state.norm, globalMassResidualM3s: totalSupplyM3s - totalDemandM3s, totalSupplyM3s, totalDemandM3s, nodes, links, warnings: ["Steady incompressible Darcy–Weisbach network with supplied demands, constant fluid properties and fixed source potentials.", "Rectangular air ducts use a hydraulic-diameter approximation, including laminar flow. Transition uses smooth blending rather than EPANET's interpolation.", "No pump-curve coupling, tank transients, compressibility, thermal loads, pressure-dependent consumer demand (except water emitters), or valve control logic.", ...(network.medium === "water" && nodes.some(node => node.pressure < 0) ? ["Negative water pressure head: the fixed-demand solution is physically infeasible for those consumers; use verified pressure-dependent demand modeling."] : []), ...(!converged ? ["Mass-balance iteration did not converge; pressure, flow and criteria results are unusable for design approval."] : [])] };
}

export interface EquipmentCandidate { id: string; kind: "pump" | "fan"; curve: { flowM3s: number; potential: number }[]; efficiency: number; motorPowerW: number }
export function selectEquipment(candidates: EquipmentCandidate[], duty: { kind: "pump" | "fan"; flowM3s: number; requiredPotential: number; densityKgM3: number; reserveFraction: number }) {
  if (!Array.isArray(candidates) || candidates.length > 200) throw new Error("Equipment catalog must contain at most 200 candidates.");
  if (duty.kind !== "pump" && duty.kind !== "fan") throw new Error("Equipment kind must be pump or fan.");
  requireFinite(duty.flowM3s, "duty flow", 1e-12, 1000); requireFinite(duty.requiredPotential, "duty potential", 0, 1e8); requireFinite(duty.densityKgM3, "duty density", 0.01, 1e5); requireFinite(duty.reserveFraction, "reserveFraction", 0, 2);
  const ids = new Set<string>();
  return candidates.map(candidate => {
    if (!engineeringRecord(candidate) || !identifier(candidate.id) || ids.has(candidate.id) || (candidate.kind !== "pump" && candidate.kind !== "fan")) throw new Error("Equipment identifiers and kinds must be valid and unique.");
    ids.add(candidate.id);
    requireFinite(candidate.efficiency, "efficiency", 0.01, 1); requireFinite(candidate.motorPowerW, "motorPowerW", 1, 1e10);
    if (!Array.isArray(candidate.curve) || candidate.curve.length < 2 || candidate.curve.length > 100) throw new Error("Equipment curve requires 2–100 points.");
    candidate.curve.forEach(point => {
      if (!engineeringRecord(point)) throw new Error("Equipment curve points must be objects.");
      requireFinite(point.flowM3s, "curve flow", 0, 1000); requireFinite(point.potential, "curve potential", 0, 1e8);
    });
    const curve = [...candidate.curve].sort((a, b) => a.flowM3s - b.flowM3s);
    curve.forEach((point, index) => {
      if (index && (point.flowM3s <= curve[index - 1].flowM3s || point.potential > curve[index - 1].potential)) throw new Error("Equipment curves require unique flows and non-increasing potential.");
    });
    const pointIndex = curve.findIndex(point => point.flowM3s >= duty.flowM3s);
    const inRange = pointIndex > 0 || (pointIndex === 0 && curve[0].flowM3s === duty.flowM3s);
    const a = curve[Math.max(0, pointIndex - 1)], b = curve[Math.max(0, pointIndex)];
    const availablePotential = inRange ? (a.flowM3s === b.flowM3s ? a.potential : a.potential + (b.potential - a.potential) * (duty.flowM3s - a.flowM3s) / (b.flowM3s - a.flowM3s)) : 0;
    const powerFactor = duty.flowM3s * (duty.kind === "pump" ? duty.densityKgM3 * 9.80665 : 1) / candidate.efficiency;
    const dutyShaftPowerW = powerFactor * duty.requiredPotential, requiredShaftPowerW = powerFactor * availablePotential;
    return { id: candidate.id, availablePotential, dutyShaftPowerW, requiredShaftPowerW, meetsDuty: candidate.kind === duty.kind && inRange && availablePotential >= duty.requiredPotential * (1 + duty.reserveFraction) && candidate.motorPowerW >= requiredShaftPowerW * (1 + duty.reserveFraction) };
  }).sort((a, b) => Number(b.meetsDuty) - Number(a.meetsDuty) || a.requiredShaftPowerW - b.requiredShaftPowerW);
}

export interface ElectricalCircuitInput {
  voltageV: number; phases: 1 | 3; connectedPowerW: number; demandFactor: number; powerFactor: number;
  /** Per-phase positive-sequence source impedance and one-way conductor impedance, ohms. */
  sourceResistanceOhm: number; sourceReactanceOhm: number; conductorResistanceOhm: number; conductorReactanceOhm: number;
  /** Independently supplied phase-to-earth loop impedance at minimum fault conditions. */
  earthLoopResistanceOhm: number; earthLoopReactanceOhm: number; minimumVoltageFactor: number; maximumVoltageFactor: number;
  cableAmpacityA: number; cableDeratingFactor: number; breakerRatingA: number; breakerBreakingCapacityA: number;
  instantaneousPickupA: number; requiredDisconnectSeconds: number; suppliedTripSecondsAtMinimumFault: number;
  suppliedLetThroughA2sAtMaximumFault: number;
  conductorAreaMm2: number; adiabaticK: number; maximumVoltageDropPct: number;
}
export function analyzeElectricalCircuit(input: ElectricalCircuitInput) {
  if (!engineeringRecord(input) || (input.phases !== 1 && input.phases !== 3)) throw new Error("Electrical input requires one or three phases.");
  const limits: [keyof ElectricalCircuitInput, number, number][] = [
    ["voltageV", 1, 1e5], ["connectedPowerW", 0, 1e10], ["demandFactor", 0, 1], ["powerFactor", 0.01, 1],
    ["sourceResistanceOhm", 0, 1e6], ["sourceReactanceOhm", 0, 1e6], ["conductorResistanceOhm", 0, 1e6], ["conductorReactanceOhm", 0, 1e6], ["earthLoopResistanceOhm", 0, 1e6], ["earthLoopReactanceOhm", 0, 1e6],
    ["minimumVoltageFactor", 0.1, 1], ["maximumVoltageFactor", 1, 2], ["cableAmpacityA", 0.001, 1e6], ["cableDeratingFactor", 0.001, 1], ["breakerRatingA", 0.001, 1e6], ["breakerBreakingCapacityA", 0.001, 1e9], ["instantaneousPickupA", 0.001, 1e9],
    ["requiredDisconnectSeconds", 0.001, 1e4], ["suppliedTripSecondsAtMinimumFault", 0.001, 1e4], ["suppliedLetThroughA2sAtMaximumFault", 0, 1e20], ["conductorAreaMm2", 0.01, 1e5], ["adiabaticK", 1, 1000], ["maximumVoltageDropPct", 0, 100],
  ];
  limits.forEach(([key, min, max]) => requireFinite(input[key], key, min, max));
  const multiplier = input.phases === 3 ? Math.sqrt(3) : 1, currentA = input.connectedPowerW * input.demandFactor / (multiplier * input.voltageV * input.powerFactor);
  const r = input.sourceResistanceOhm + input.conductorResistanceOhm, x = input.sourceReactanceOhm + input.conductorReactanceOhm;
  const impedance = Math.hypot(r, x), earthLoop = Math.hypot(input.earthLoopResistanceOhm, input.earthLoopReactanceOhm);
  if (impedance <= 0 || earthLoop <= 0) throw new Error("Source/circuit and earth-loop impedances must be positive.");
  // For single phase, supplied conductor impedance must already include outgoing and return paths.
  const maximumFaultA = input.maximumVoltageFactor * input.voltageV / multiplier / impedance;
  const phaseVoltage = input.phases === 3 ? input.voltageV / Math.sqrt(3) : input.voltageV;
  const minimumEarthFaultA = input.minimumVoltageFactor * phaseVoltage / earthLoop;
  const voltageDropV = multiplier * currentA * (input.conductorResistanceOhm * input.powerFactor + input.conductorReactanceOhm * Math.sqrt(1 - input.powerFactor ** 2));
  const voltageDropPct = voltageDropV / input.voltageV * 100, deratedAmpacityA = input.cableAmpacityA * input.cableDeratingFactor;
  const thermalWithstandA2s = (input.adiabaticK * input.conductorAreaMm2) ** 2;
  const checks = {
    loadProtection: currentA <= input.breakerRatingA && input.breakerRatingA <= deratedAmpacityA,
    breakingCapacity: input.breakerBreakingCapacityA >= maximumFaultA,
    earthFaultPickup: minimumEarthFaultA >= input.instantaneousPickupA,
    disconnectionTime: input.suppliedTripSecondsAtMinimumFault <= input.requiredDisconnectSeconds,
    thermalWithstand: input.suppliedLetThroughA2sAtMaximumFault <= thermalWithstandA2s,
    voltageDrop: voltageDropPct <= input.maximumVoltageDropPct,
  };
  return { verification: "unverified" as const, currentA, voltageDropV, voltageDropPct, maximumFaultA, minimumEarthFaultA, deratedAmpacityA, thermalWithstandA2s, maximumAdiabaticFaultSeconds: thermalWithstandA2s / maximumFaultA ** 2, checks, satisfiesSuppliedCriteria: Object.values(checks).every(Boolean), warnings: ["Simple impedance-based symmetrical fault calculation; no IEC 60909 network, motors, generators, DC offset, arc flash or selectivity study.", "Adiabatic withstand time is reported separately. Verify the manufacturer's actual maximum-fault let-through I²t and the permitted applicability of the adiabatic equation.", "Trip time and conductor ampacity/derating are supplied engineering inputs; this module does not infer a trip curve or national wiring rules."] };
}

export interface FireFlowCriteria { basis: string; requiredTotalFlowM3s: number; requiredDurationMinutes: number; usableStorageM3: number; terminals: { nodeId: string; minimumFlowM3s: number; minimumPressureHeadM: number }[] }
export function assessFireFlow(input: FluidNetwork, criteria: FireFlowCriteria) {
  const network = parseFluidNetwork(input);
  if (network.medium !== "water" || !engineeringRecord(criteria) || typeof criteria.basis !== "string" || !criteria.basis.trim() || criteria.basis.length > 500) throw new Error("Fire flow requires a water network and an explicit design-criteria basis.");
  requireFinite(criteria.requiredTotalFlowM3s, "requiredTotalFlowM3s", 1e-12, 1000); requireFinite(criteria.requiredDurationMinutes, "requiredDurationMinutes", 0.01, 1e5); requireFinite(criteria.usableStorageM3, "usableStorageM3", 0, 1e10);
  if (!Array.isArray(criteria.terminals) || !criteria.terminals.length || criteria.terminals.length > 80) throw new Error("Fire criteria require 1–80 terminal checks.");
  const ids = new Set<string>();
  criteria.terminals.forEach(terminal => {
    if (!engineeringRecord(terminal) || !identifier(terminal.nodeId) || ids.has(terminal.nodeId) || !network.nodes.some(node => node.id === terminal.nodeId && node.fixedPotential === undefined)) throw new Error("Fire terminal ids must identify unique consumer nodes.");
    ids.add(terminal.nodeId); requireFinite(terminal.minimumFlowM3s, "minimumFlowM3s", 0, 1000); requireFinite(terminal.minimumPressureHeadM, "minimumPressureHeadM", 0, 1e6);
  });
  const hydraulic = solveFluidNetwork(network), converged = hydraulic.status === "converged";
  const terminals = criteria.terminals.map(terminal => {
    const node = hydraulic.nodes.find(item => item.nodeId === terminal.nodeId)!;
    return { ...terminal, deliveredFlowM3s: node.demandM3s, pressureHeadM: node.pressure, satisfiesCriteria: converged && node.demandM3s >= terminal.minimumFlowM3s && node.pressure >= terminal.minimumPressureHeadM };
  });
  const deliveredTerminalFlowM3s = terminals.reduce((sum, terminal) => sum + terminal.deliveredFlowM3s, 0), requiredStorageM3 = Math.max(criteria.requiredTotalFlowM3s, hydraulic.totalDemandM3s) * criteria.requiredDurationMinutes * 60;
  const suppliedTerminalMinimum = criteria.terminals.reduce((sum, terminal) => sum + terminal.minimumFlowM3s, 0);
  return { verification: "unverified" as const, basis: criteria.basis, hydraulic, terminals, deliveredTerminalFlowM3s, requiredStorageM3, storageSatisfiesCriteria: criteria.usableStorageM3 >= requiredStorageM3, satisfiesSuppliedCriteria: converged && terminals.every(terminal => terminal.satisfiesCriteria) && deliveredTerminalFlowM3s >= criteria.requiredTotalFlowM3s && criteria.usableStorageM3 >= requiredStorageM3, warnings: ["User-supplied fire criteria, steady simultaneous terminal demand, no automatic NFPA/EN/local hazard classification, remote-area selection, sprinkler spacing or regulatory approval.", ...(suppliedTerminalMinimum < criteria.requiredTotalFlowM3s ? ["Sum of terminal minimum flows is below the required total; verify simultaneous hose/sprinkler demands in the network."] : [])] };
}
