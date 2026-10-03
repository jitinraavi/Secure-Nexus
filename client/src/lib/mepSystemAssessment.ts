import { ENGINEERING_STANDARD_REFERENCES, engineeringBasisFingerprint, isEngineeringSourceUrl, parseEngineeringDesignBasis, validateEngineeringDesignBasis, type EngineeringDesignBasis } from "./engineeringBasis";
import { analyzeElectricalCircuit, parseFluidNetwork, solveFluidNetwork, type ElectricalCircuitInput, type EquipmentCandidate, type FireFlowCriteria, type FluidNetwork, type FluidNetworkReport } from "./engineeringNetworks";

/** References identify authored criteria; selecting a standard does not implement it. */
export interface MepCriterionTrace { source: string; criterionIds: string[]; standardId?: string; clause?: string }
export interface MepSystemDefinition {
  id: string; name: string; network: FluidNetwork; source: string;
  terminals: { nodeId: string; minimumFlowM3s: number; minimumPressure: number; trace: MepCriterionTrace }[];
  fire?: { criteria: FireFlowCriteria; trace: MepCriterionTrace };
}
export interface MepEquipmentDefinition {
  id: string; systemId: string; driveLinkId: string; sourceNodeId: string; criticalTerminalNodeId: string;
  /** Contiguous source-to-terminal path; direction is relative to the stored link orientation. */
  path: { linkId: string; direction: 1 | -1 }[];
  /** Additional terminal/device loss not already included in network links, m-water or Pa. */
  extraLossPotential: number; reserveFraction: number; potentialTolerance: number; flowToleranceM3s: number;
  candidate: EquipmentCandidate; manufacturerSource: string;
  /** Curve efficiency is hydraulic/static efficiency; motorPowerW is rated shaft output. */
  motorEfficiency: number; electricalCircuitId: string; trace: MepCriterionTrace;
}
export interface MepCircuitDefinition {
  id: string; input: ElectricalCircuitInput; equipmentIds: string[];
  otherConnectedPowerW: number; powerToleranceW: number; maximumFaultClearingSeconds: number;
  protectionSource: string; ampacitySource: string; trace: MepCriterionTrace;
}
export interface MepSystemInput { version: 1; systems: MepSystemDefinition[]; equipment: MepEquipmentDefinition[]; circuits: MepCircuitDefinition[] }
export interface MepSystemCheck {
  id: string; status: "pass" | "fail"; message: string; trace?: MepCriterionTrace;
  actual?: number; required?: number; unit?: string;
}
export interface MepEquipmentResult {
  equipmentId: string; systemId: string; potentialUnit: "m-water" | "Pa"; status: "pass" | "fail";
  flowM3s: number | null; requiredPotential: number | null; modeledPotential: number;
  availablePotential: number | null; shaftPowerW: number | null; motorInputPowerW: number | null;
  nameplateInputPowerW: number; expectedRunningCurrentA: number | null;
}
type CircuitReport = ReturnType<typeof analyzeElectricalCircuit>;
export interface MepSystemReport {
  version: 1; verification: "unverified"; claim: "supplied-criteria-only"; nationalCodeCompliance: "not-assessed";
  source: MepSystemInput; designBasis: EngineeringDesignBasis; basisIssues: string[];
  systems: { systemId: string; hydraulic: FluidNetworkReport }[];
  equipment: MepEquipmentResult[]; circuits: { circuitId: string; electrical: CircuitReport }[];
  checks: MepSystemCheck[]; satisfiesSuppliedCriteria: boolean; warnings: string[];
}

const LIMIT = 1e18;
const ELECTRICAL_LIMITS: [keyof ElectricalCircuitInput, number, number][] = [
  ["voltageV", 1, 1e5], ["connectedPowerW", 0, 1e10], ["demandFactor", 0, 1], ["powerFactor", 0.01, 1],
  ["sourceResistanceOhm", 0, 1e6], ["sourceReactanceOhm", 0, 1e6], ["conductorResistanceOhm", 0, 1e6], ["conductorReactanceOhm", 0, 1e6], ["earthLoopResistanceOhm", 0, 1e6], ["earthLoopReactanceOhm", 0, 1e6],
  ["minimumVoltageFactor", 0.1, 1], ["maximumVoltageFactor", 1, 2], ["cableAmpacityA", 0.001, 1e6], ["cableDeratingFactor", 0.001, 1], ["breakerRatingA", 0.001, 1e6], ["breakerBreakingCapacityA", 0.001, 1e9], ["instantaneousPickupA", 0.001, 1e9],
  ["requiredDisconnectSeconds", 0.001, 1e4], ["suppliedTripSecondsAtMinimumFault", 0.001, 1e4], ["suppliedLetThroughA2sAtMaximumFault", 0, 1e20], ["conductorAreaMm2", 0.01, 1e5], ["adiabaticK", 1, 1000], ["maximumVoltageDropPct", 0, 100],
];
const ELECTRICAL_CHECKS = ["loadProtection", "breakingCapacity", "earthFaultPickup", "disconnectionTime", "thermalWithstand", "voltageDrop"] as const;
function object(value: unknown, keys: readonly string[], at: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${at} must be an object.`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw new Error(`${at}.${key} is unsupported.`);
  return record;
}
function array(value: unknown, at: string, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error(`${at} needs ${minimum}–${maximum} entries.`);
  return value;
}
function text(value: unknown, at: string, maximum = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${at} requires non-empty text of at most ${maximum} characters.`);
  return value;
}
function id(value: unknown, at: string): string {
  const result = text(value, at, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(result)) throw new Error(`${at} has an invalid identifier.`);
  return result;
}
function number(value: unknown, at: string, minimum = -LIMIT, maximum = LIMIT): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${at} must be finite and in ${minimum}–${maximum}.`);
  return value;
}
function unique(values: string[], at: string): void { if (new Set(values).size !== values.length) throw new Error(`${at} contains duplicate identifiers.`); }
function trace(value: unknown, at: string): MepCriterionTrace {
  const raw = object(value, ["source", "criterionIds", "standardId", "clause"], at);
  const criterionIds = array(raw.criterionIds, `${at}.criterionIds`, 16).map(item => text(item, `${at}.criterionId`, 100));
  unique(criterionIds, `${at}.criterionIds`);
  if ((raw.standardId === undefined) !== (raw.clause === undefined)) throw new Error(`${at} requires both an adopted standard and its clause.`);
  return { source: text(raw.source, `${at}.source`), criterionIds, ...(raw.standardId === undefined ? {} : { standardId: text(raw.standardId, `${at}.standardId`, 100), clause: text(raw.clause, `${at}.clause`, 200) }) };
}
function network(value: unknown): FluidNetwork {
  const raw = object(value, ["version", "medium", "densityKgM3", "kinematicViscosityM2s", "nodes", "links", "options"], "network");
  const nodes = array(raw.nodes, "network.nodes", 40, 1).map(entry => ({ ...object(entry, ["id", "elevationM", "demandM3s", "fixedPotential", "initialPotential", "minimumPressure", "emitterCoefficient"], "network.node") }));
  const links = array(raw.links, "network.links", 100, 1).map(entry => ({ ...object(entry, ["id", "from", "to", "lengthM", "roughnessM", "minorLossK", "diameterM", "widthM", "heightM", "addedPotential", "maximumVelocityMps"], "network.link") }));
  nodes.forEach(node => id(node.id, "network.node.id")); links.forEach(link => { id(link.id, "network.link.id"); id(link.from, "network.link.from"); id(link.to, "network.link.to"); });
  const options = raw.options === undefined ? undefined : { ...object(raw.options, ["flowToleranceM3s", "maxIterations"], "network.options") };
  // The existing parser checks geometry, fluid properties, bounds and anchored components.
  return parseFluidNetwork({ ...raw, nodes, links, ...(options === undefined ? {} : { options }) });
}
function electrical(value: unknown): ElectricalCircuitInput {
  const raw = object(value, ["phases", ...ELECTRICAL_LIMITS.map(([key]) => key)], "circuit.input");
  if (raw.phases !== 1 && raw.phases !== 3) throw new Error("Circuit phases must be 1 or 3.");
  ELECTRICAL_LIMITS.forEach(([key, minimum, maximum]) => number(raw[key], `circuit.${key}`, minimum, maximum));
  if (Math.hypot(number(raw.sourceResistanceOhm, "sourceResistanceOhm") + number(raw.conductorResistanceOhm, "conductorResistanceOhm"), number(raw.sourceReactanceOhm, "sourceReactanceOhm") + number(raw.conductorReactanceOhm, "conductorReactanceOhm")) <= 0 || Math.hypot(number(raw.earthLoopResistanceOhm, "earthLoopResistanceOhm"), number(raw.earthLoopReactanceOhm, "earthLoopReactanceOhm")) <= 0) throw new Error("Circuit and earth-loop impedances must be positive.");
  return { ...raw } as unknown as ElectricalCircuitInput;
}
function equipmentCurve(value: unknown): EquipmentCandidate {
  const raw = object(value, ["id", "kind", "curve", "efficiency", "motorPowerW"], "equipment.candidate");
  if (raw.kind !== "pump" && raw.kind !== "fan") throw new Error("Candidate must be pump or fan.");
  const curve = array(raw.curve, "equipment.curve", 100, 2).map(entry => {
    const point = object(entry, ["flowM3s", "potential"], "equipment.curve.point");
    return { flowM3s: number(point.flowM3s, "curve.flowM3s", 0, 1000), potential: number(point.potential, "curve.potential", 0, 1e8) };
  });
  curve.forEach((point, index) => { if (index && (point.flowM3s <= curve[index - 1].flowM3s || point.potential > curve[index - 1].potential)) throw new Error("Curve points must have increasing flows and non-increasing potential."); });
  return { id: id(raw.id, "candidate.id"), kind: raw.kind, curve, efficiency: number(raw.efficiency, "candidate.efficiency", 0.01, 1), motorPowerW: number(raw.motorPowerW, "candidate.motorPowerW", 1, 1e10) };
}
function fireCriteria(value: unknown, system: Pick<MepSystemDefinition, "network" | "terminals">): FireFlowCriteria {
  const raw = object(value, ["basis", "requiredTotalFlowM3s", "requiredDurationMinutes", "usableStorageM3", "terminals"], "fire.criteria");
  if (system.network.medium !== "water") throw new Error("Fire assessments require a water network.");
  const terminals = array(raw.terminals, "fire.terminals", 40, 1).map(entry => {
    const terminal = object(entry, ["nodeId", "minimumFlowM3s", "minimumPressureHeadM"], "fire.terminal");
    const result = { nodeId: id(terminal.nodeId, "fire.nodeId"), minimumFlowM3s: number(terminal.minimumFlowM3s, "fire.minimumFlowM3s", 0, 1000), minimumPressureHeadM: number(terminal.minimumPressureHeadM, "fire.minimumPressureHeadM", 0, 1e6) };
    const mapped = system.terminals.find(item => item.nodeId === result.nodeId);
    if (!mapped || mapped.minimumFlowM3s !== result.minimumFlowM3s || mapped.minimumPressure !== result.minimumPressureHeadM) throw new Error("Fire terminal criteria must match their explicit system terminal mappings.");
    return result;
  });
  unique(terminals.map(item => item.nodeId), "fire.terminals");
  return { basis: text(raw.basis, "fire.basis", 500), requiredTotalFlowM3s: number(raw.requiredTotalFlowM3s, "fire.requiredTotalFlowM3s", 1e-12, 1000), requiredDurationMinutes: number(raw.requiredDurationMinutes, "fire.requiredDurationMinutes", 0.01, 1e5), usableStorageM3: number(raw.usableStorageM3, "fire.usableStorageM3", 0, 1e10), terminals };
}

export function parseMepSystemInput(value: unknown): MepSystemInput {
  const raw = object(value, ["version", "systems", "equipment", "circuits"], "MEP input");
  if (raw.version !== 1) throw new Error("MEP system assessment requires version 1.");
  const systems = array(raw.systems, "systems", 8, 1).map((entry): MepSystemDefinition => {
    const item = object(entry, ["id", "name", "network", "source", "terminals", "fire"], "system"), fluid = network(item.network);
    const terminals = array(item.terminals, "system.terminals", 40, 1).map(terminalValue => {
      const terminal = object(terminalValue, ["nodeId", "minimumFlowM3s", "minimumPressure", "trace"], "terminal");
      const nodeId = id(terminal.nodeId, "terminal.nodeId");
      if (!fluid.nodes.some(node => node.id === nodeId && node.fixedPotential === undefined)) throw new Error("Terminals must map to consumer nodes without fixed potential.");
      return { nodeId, minimumFlowM3s: number(terminal.minimumFlowM3s, "terminal.minimumFlowM3s", 0, 1000), minimumPressure: number(terminal.minimumPressure, "terminal.minimumPressure", 0, 1e7), trace: trace(terminal.trace, "terminal.trace") };
    });
    unique(terminals.map(terminal => terminal.nodeId), "system.terminals");
    const result: MepSystemDefinition = { id: id(item.id, "system.id"), name: text(item.name, "system.name", 200), network: fluid, source: text(item.source, "system.source"), terminals };
    if (item.fire !== undefined) { const fire = object(item.fire, ["criteria", "trace"], "system.fire"); result.fire = { criteria: fireCriteria(fire.criteria, result), trace: trace(fire.trace, "fire.trace") }; }
    return result;
  });
  unique(systems.map(item => item.id), "systems");
  if (systems.reduce((sum, item) => sum + item.network.nodes.length, 0) > 120 || systems.reduce((sum, item) => sum + item.network.links.length, 0) > 300) throw new Error("Combined MEP assessment exceeds 120 nodes or 300 links.");
  const equipment = array(raw.equipment, "equipment", 24).map((entry): MepEquipmentDefinition => {
    const item = object(entry, ["id", "systemId", "driveLinkId", "sourceNodeId", "criticalTerminalNodeId", "path", "extraLossPotential", "reserveFraction", "potentialTolerance", "flowToleranceM3s", "candidate", "manufacturerSource", "motorEfficiency", "electricalCircuitId", "trace"], "equipment");
    const systemId = id(item.systemId, "equipment.systemId"), system = systems.find(candidate => candidate.id === systemId);
    if (!system) throw new Error("Equipment references an unknown system.");
    const driveLinkId = id(item.driveLinkId, "equipment.driveLinkId"), sourceNodeId = id(item.sourceNodeId, "equipment.sourceNodeId"), criticalTerminalNodeId = id(item.criticalTerminalNodeId, "equipment.criticalTerminalNodeId");
    if (!system.network.nodes.some(node => node.id === sourceNodeId && node.fixedPotential !== undefined) || !system.terminals.some(terminal => terminal.nodeId === criticalTerminalNodeId)) throw new Error("Equipment needs a fixed source and an explicitly assessed critical consumer terminal.");
    const path = array(item.path, "equipment.path", 100, 1).map(entryValue => {
      const step = object(entryValue, ["linkId", "direction"], "equipment.path.step");
      if (step.direction !== 1 && step.direction !== -1) throw new Error("Path direction must be 1 or -1.");
      return { linkId: id(step.linkId, "path.linkId"), direction: step.direction as 1 | -1 };
    });
    unique(path.map(step => step.linkId), "equipment.path");
    let current = sourceNodeId; const visited = new Set([current]); let driveCount = 0;
    for (const step of path) {
      const link = system.network.links.find(candidate => candidate.id === step.linkId);
      if (!link || current !== (step.direction === 1 ? link.from : link.to)) throw new Error("Equipment path must be contiguous in the declared direction.");
      current = step.direction === 1 ? link.to : link.from;
      if (visited.has(current)) throw new Error("Equipment paths cannot contain cycles.");
      visited.add(current);
      if (link.id === driveLinkId) { driveCount++; if (step.direction !== 1 || !(link.addedPotential !== undefined && link.addedPotential > 0)) throw new Error("The driver needs a positive modeled gain in the source-to-terminal direction."); }
      else if ((link.addedPotential ?? 0) !== 0) throw new Error("A duty path supports exactly one pump/fan gain.");
      if (current !== criticalTerminalNodeId && system.network.nodes.find(node => node.id === current)?.fixedPotential !== undefined) throw new Error("The duty path cannot cross another prescribed source potential.");
    }
    if (current !== criticalTerminalNodeId || driveCount !== 1) throw new Error("The duty path must contain its driver once and terminate at the critical terminal.");
    const candidate = equipmentCurve(item.candidate);
    if (candidate.kind !== (system.network.medium === "water" ? "pump" : "fan")) throw new Error("Candidate type does not match its fluid system.");
    return { id: id(item.id, "equipment.id"), systemId, driveLinkId, sourceNodeId, criticalTerminalNodeId, path,
      extraLossPotential: number(item.extraLossPotential, "extraLossPotential", 0, 1e7), reserveFraction: number(item.reserveFraction, "reserveFraction", 0, 2), potentialTolerance: number(item.potentialTolerance, "potentialTolerance", 0, 1e7), flowToleranceM3s: number(item.flowToleranceM3s, "flowToleranceM3s", 0, 0.01), candidate, manufacturerSource: text(item.manufacturerSource, "manufacturerSource"), motorEfficiency: number(item.motorEfficiency, "motorEfficiency", 0.01, 1), electricalCircuitId: id(item.electricalCircuitId, "electricalCircuitId"), trace: trace(item.trace, "equipment.trace") };
  });
  unique(equipment.map(item => item.id), "equipment"); unique(equipment.map(item => `${item.systemId}/${item.driveLinkId}`), "equipment drivers");
  const circuits = array(raw.circuits, "circuits", 24).map((entry): MepCircuitDefinition => {
    const item = object(entry, ["id", "input", "equipmentIds", "otherConnectedPowerW", "powerToleranceW", "maximumFaultClearingSeconds", "protectionSource", "ampacitySource", "trace"], "circuit");
    const circuitId = id(item.id, "circuit.id"), equipmentIds = array(item.equipmentIds, "circuit.equipmentIds", 24).map(entryValue => id(entryValue, "circuit.equipmentId"));
    unique(equipmentIds, "circuit.equipmentIds");
    for (const equipmentId of equipmentIds) if (!equipment.some(item => item.id === equipmentId && item.electricalCircuitId === circuitId)) throw new Error("Circuit equipment mappings must match the equipment's declared circuit.");
    return { id: circuitId, input: electrical(item.input), equipmentIds, otherConnectedPowerW: number(item.otherConnectedPowerW, "otherConnectedPowerW", 0, 1e10), powerToleranceW: number(item.powerToleranceW, "powerToleranceW", 0, 1e10), maximumFaultClearingSeconds: number(item.maximumFaultClearingSeconds, "maximumFaultClearingSeconds", 0.001, 1e4), protectionSource: text(item.protectionSource, "protectionSource"), ampacitySource: text(item.ampacitySource, "ampacitySource"), trace: trace(item.trace, "circuit.trace") };
  });
  unique(circuits.map(item => item.id), "circuits");
  for (const item of equipment) if (!circuits.some(circuit => circuit.id === item.electricalCircuitId && circuit.equipmentIds.includes(item.id))) throw new Error("Every equipment motor must be included exactly once in its declared electrical circuit.");
  for (const system of systems) for (const link of system.network.links) if ((link.addedPotential ?? 0) !== 0 && !equipment.some(item => item.systemId === system.id && item.driveLinkId === link.id)) throw new Error("Every nonzero network gain must map to assessed equipment.");
  return { version: 1, systems, equipment, circuits };
}

function checkTraceReferences(source: MepSystemInput, basis: EngineeringDesignBasis): void {
  const adopted = (standardId: string) => {
    const standards = basis.standards.filter(standard => standard.id === standardId);
    if (!basis.countryCode || standards.length !== 1 || !standards[0].code.trim() || !standards[0].edition.trim() || !standards[0].adoptionReference.trim() || !isEngineeringSourceUrl(standards[0].sourceUrl)) throw new Error(`MEP trace ${standardId} requires exactly one adopted standard with explicit country, code, edition, adoption and HTTPS source.`);
    const standard = standards[0], reference = ENGINEERING_STANDARD_REFERENCES.find(item => item.id === standard.id);
    if (reference && (reference.countryCode !== basis.countryCode || reference.code !== standard.code || reference.domain !== standard.domain || !reference.editions.includes(standard.edition) || reference.sourceUrl !== standard.sourceUrl)) throw new Error(`MEP trace ${standardId} does not match its declared country, catalog edition or publisher. Other editions need a custom adopted reference.`);
  };
  const entries: { trace: MepCriterionTrace; module: "water" | "air" | "fire" | "equipment" | "electrical" }[] = [];
  source.systems.forEach(system => { system.terminals.forEach(terminal => entries.push({ trace: terminal.trace, module: system.network.medium })); if (system.fire) entries.push({ trace: system.fire.trace, module: "fire" }); });
  source.equipment.forEach(item => entries.push({ trace: item.trace, module: "equipment" })); source.circuits.forEach(item => entries.push({ trace: item.trace, module: "electrical" }));
  for (const entry of entries) {
    if (entry.trace.standardId) adopted(entry.trace.standardId);
    for (const criterionId of entry.trace.criterionIds) {
      const criteria = basis.criteria.filter(criterion => criterion.id === criterionId);
      if (criteria.length !== 1 || criteria[0].module !== entry.module || !criteria[0].name.trim() || !criteria[0].unit.trim() || !criteria[0].source.trim()) throw new Error(`MEP criterion ${criterionId} must resolve to exactly one sourced criterion in the captured basis for module ${entry.module}.`);
      if (criteria[0].standardId !== undefined) {
        if (!criteria[0].standardId.trim() || !criteria[0].clause?.trim()) throw new Error(`MEP criterion ${criterionId} requires its adopted standard and clause.`);
        adopted(criteria[0].standardId);
      }
    }
  }
}
function curvePotential(candidate: EquipmentCandidate, flow: number): number | null {
  if (flow < candidate.curve[0].flowM3s || flow > candidate.curve[candidate.curve.length - 1].flowM3s) return null;
  const index = candidate.curve.findIndex(point => point.flowM3s >= flow);
  if (index === 0) return candidate.curve[0].potential;
  const a = candidate.curve[index - 1], b = candidate.curve[index];
  return a.potential + (b.potential - a.potential) * (flow - a.flowM3s) / (b.flowM3s - a.flowM3s);
}

export function assessMepSystems(input: MepSystemInput, capturedBasis: EngineeringDesignBasis): MepSystemReport {
  const source = parseMepSystemInput(input), designBasis = parseEngineeringDesignBasis(capturedBasis);
  checkTraceReferences(source, designBasis);
  const systems = source.systems.map(system => ({ systemId: system.id, hydraulic: solveFluidNetwork(system.network) }));
  const circuits = source.circuits.map(circuit => ({ circuitId: circuit.id, electrical: analyzeElectricalCircuit(circuit.input) }));
  const checks: MepSystemCheck[] = [];
  const check = (id: string, passed: boolean, message: string, trace?: MepCriterionTrace, actual?: number, required?: number, unit?: string) => checks.push({ id, status: passed ? "pass" : "fail", message, ...(trace ? { trace } : {}), ...(actual === undefined ? {} : { actual }), ...(required === undefined ? {} : { required }), ...(unit === undefined ? {} : { unit }) });
  for (const system of source.systems) {
    const hydraulic = systems.find(item => item.systemId === system.id)!.hydraulic, converged = hydraulic.status === "converged";
    check(`system/${system.id}/convergence`, converged, "Fluid iteration must converge before any system criteria can pass.", undefined, hydraulic.maxMassResidualM3s, system.network.options?.flowToleranceM3s ?? 1e-7, "m3/s");
    for (const terminal of system.terminals) {
      const node = hydraulic.nodes.find(item => item.nodeId === terminal.nodeId)!;
      check(`system/${system.id}/terminal/${terminal.nodeId}/flow`, converged && node.demandM3s >= terminal.minimumFlowM3s, "Simultaneous terminal flow meets the authored minimum.", terminal.trace, node.demandM3s, terminal.minimumFlowM3s, "m3/s");
      check(`system/${system.id}/terminal/${terminal.nodeId}/pressure`, converged && node.pressure >= terminal.minimumPressure, "Terminal residual pressure meets the authored minimum.", terminal.trace, node.pressure, terminal.minimumPressure, node.pressureUnit);
    }
    for (const node of system.network.nodes) if (node.minimumPressure !== undefined) check(`system/${system.id}/node/${node.id}/pressure`, hydraulic.nodes.find(item => item.nodeId === node.id)!.satisfiesMinimumPressure === true, "Network node meets its authored minimum pressure.");
    for (const link of system.network.links) if (link.maximumVelocityMps !== undefined) check(`system/${system.id}/link/${link.id}/velocity`, hydraulic.links.find(item => item.linkId === link.id)!.satisfiesMaximumVelocity === true, "Network link meets its authored maximum velocity.");
    if (system.network.medium === "water") check(`system/${system.id}/nonnegative-pressure`, converged && hydraulic.nodes.every(node => node.pressure >= 0), "Negative pressure head is excluded from an acceptable fixed-demand water assessment.");
    if (system.fire) {
      const fire = system.fire, totalFlow = fire.criteria.terminals.reduce((sum, terminal) => sum + hydraulic.nodes.find(node => node.nodeId === terminal.nodeId)!.demandM3s, 0);
      const requiredStorage = Math.max(fire.criteria.requiredTotalFlowM3s, hydraulic.totalDemandM3s) * fire.criteria.requiredDurationMinutes * 60;
      check(`system/${system.id}/fire/flow`, converged && totalFlow >= fire.criteria.requiredTotalFlowM3s, "Assessed simultaneous fire terminals meet the authored total flow.", fire.trace, totalFlow, fire.criteria.requiredTotalFlowM3s, "m3/s");
      check(`system/${system.id}/fire/storage`, converged && fire.criteria.usableStorageM3 >= requiredStorage, "Usable storage meets flow × duration, using the greater of specified total and modeled total demand.", fire.trace, fire.criteria.usableStorageM3, requiredStorage, "m3");
    }
  }
  const equipment = source.equipment.map((item): MepEquipmentResult => {
    const system = source.systems.find(candidate => candidate.id === item.systemId)!, hydraulic = systems.find(candidate => candidate.systemId === item.systemId)!.hydraulic;
    const drive = system.network.links.find(link => link.id === item.driveLinkId)!, flow = hydraulic.links.find(link => link.linkId === item.driveLinkId)!.flowM3s;
    const pathForward = item.path.every(step => hydraulic.links.find(link => link.linkId === step.linkId)!.flowM3s * step.direction > item.flowToleranceM3s);
    const usable = hydraulic.status === "converged" && flow > Math.max(1e-12, item.flowToleranceM3s) && pathForward;
    check(`equipment/${item.id}/usable-duty`, usable, "The network must converge and every declared duty-path flow must run forward above its stated tolerance.", item.trace);
    const terminal = system.terminals.find(candidate => candidate.nodeId === item.criticalTerminalNodeId)!, terminalNode = system.network.nodes.find(node => node.id === terminal.nodeId)!;
    // Sum each link's ordinary loss once, including driver-link friction, but never its gain.
    const passiveLoss = item.path.reduce((sum, step) => sum + hydraulic.links.find(link => link.linkId === step.linkId)!.potentialLoss * step.direction, 0);
    const requiredPotential = usable ? Math.max(0, (system.network.medium === "water" ? terminalNode.elevationM : 0) + terminal.minimumPressure - system.network.nodes.find(node => node.id === item.sourceNodeId)!.fixedPotential! + passiveLoss + item.extraLossPotential) : null;
    const availablePotential = usable ? curvePotential(item.candidate, flow) : null;
    check(`equipment/${item.id}/curve-range`, usable && availablePotential !== null, "The solved driver flow lies inside the explicitly supplied manufacturer curve; extrapolation is excluded.", item.trace);
    check(`equipment/${item.id}/head`, usable && availablePotential !== null && requiredPotential !== null && availablePotential >= requiredPotential * (1 + item.reserveFraction), "Available curve potential covers the critical path and the authored potential reserve.", item.trace, availablePotential ?? undefined, requiredPotential === null ? undefined : requiredPotential * (1 + item.reserveFraction), system.network.medium === "water" ? "m-water" : "Pa");
    check(`equipment/${item.id}/modeled-curve-consistency`, usable && availablePotential !== null && Math.abs(availablePotential - drive.addedPotential!) <= item.potentialTolerance, "The fixed modeled gain agrees with the curve at solved flow within the declared potential tolerance.", item.trace, availablePotential === null ? undefined : Math.abs(availablePotential - drive.addedPotential!), item.potentialTolerance, system.network.medium === "water" ? "m-water" : "Pa");
    const shaftPowerW = availablePotential === null ? null : flow * availablePotential * (system.network.medium === "water" ? system.network.densityKgM3 * 9.80665 : 1) / item.candidate.efficiency;
    const motorInputPowerW = shaftPowerW === null ? null : shaftPowerW / item.motorEfficiency;
    check(`equipment/${item.id}/motor`, usable && shaftPowerW !== null && item.candidate.motorPowerW >= shaftPowerW * (1 + item.reserveFraction), "Rated motor shaft output covers the curve-point shaft demand and authored power reserve.", item.trace, item.candidate.motorPowerW, shaftPowerW === null ? undefined : shaftPowerW * (1 + item.reserveFraction), "W-shaft");
    const circuit = source.circuits.find(candidate => candidate.id === item.electricalCircuitId)!, multiplier = circuit.input.phases === 3 ? Math.sqrt(3) : 1;
    const result: MepEquipmentResult = { equipmentId: item.id, systemId: item.systemId, potentialUnit: system.network.medium === "water" ? "m-water" : "Pa", status: checks.filter(check => check.id.startsWith(`equipment/${item.id}/`)).every(check => check.status === "pass") ? "pass" : "fail", flowM3s: usable ? flow : null, requiredPotential, modeledPotential: drive.addedPotential!, availablePotential, shaftPowerW, motorInputPowerW, nameplateInputPowerW: item.candidate.motorPowerW / item.motorEfficiency, expectedRunningCurrentA: motorInputPowerW === null ? null : motorInputPowerW / (multiplier * circuit.input.voltageV * circuit.input.powerFactor) };
    return result;
  });
  for (const circuit of source.circuits) {
    const results = equipment.filter(item => circuit.equipmentIds.includes(item.equipmentId));
    const expectedConnectedPower = circuit.otherConnectedPowerW + results.reduce((sum, item) => sum + item.nameplateInputPowerW, 0);
    check(`circuit/${circuit.id}/connected-power`, Math.abs(circuit.input.connectedPowerW - expectedConnectedPower) <= circuit.powerToleranceW, "Connected electrical input includes mapped motor nameplate input plus explicitly supplied other loads, within the authored power tolerance.", circuit.trace, circuit.input.connectedPowerW, expectedConnectedPower, "W-input");
    const runningKnown = results.every(item => item.motorInputPowerW !== null), runningPower = circuit.otherConnectedPowerW + results.reduce((sum, item) => sum + (item.motorInputPowerW ?? 0), 0);
    check(`circuit/${circuit.id}/simultaneous-duty`, runningKnown && circuit.input.connectedPowerW * circuit.input.demandFactor + circuit.powerToleranceW >= runningPower, "Demand allowance covers all simultaneously operating mapped duties plus other connected loads; no diversity is inferred for running equipment.", circuit.trace, circuit.input.connectedPowerW * circuit.input.demandFactor, runningKnown ? runningPower : undefined, "W-input");
    const report = circuits.find(item => item.circuitId === circuit.id)!.electrical;
    for (const name of ELECTRICAL_CHECKS) check(`circuit/${circuit.id}/${name}`, report.checks[name], `Supplied circuit criteria: ${name}.`, circuit.trace);
    check(`circuit/${circuit.id}/adiabatic-applicability`, circuit.maximumFaultClearingSeconds <= 5 && circuit.input.suppliedTripSecondsAtMinimumFault <= 5, "The supplied maximum-fault clearing time and minimum-earth-fault trip time stay within the five-second adiabatic approximation scope.", circuit.trace);
    const minimumEarthFaultEnergy = report.minimumEarthFaultA ** 2 * circuit.input.suppliedTripSecondsAtMinimumFault;
    check(`circuit/${circuit.id}/minimum-earth-fault-thermal`, circuit.input.suppliedTripSecondsAtMinimumFault <= 5 && minimumEarthFaultEnergy <= report.thermalWithstandA2s, "The supplied minimum-earth-fault point RMS current squared × trip time is within the authored conductor adiabatic withstand.", circuit.trace, minimumEarthFaultEnergy, report.thermalWithstandA2s, "A2s");
  }
  const report: MepSystemReport = { version: 1, verification: "unverified", claim: "supplied-criteria-only", nationalCodeCompliance: "not-assessed", source, designBasis, basisIssues: validateEngineeringDesignBasis(designBasis), systems, equipment, circuits, checks, satisfiesSuppliedCriteria: checks.every(item => item.status === "pass"), warnings: [
    "Every numerical result is unverified. Passing these authored checks is not national-code approval or equipment certification.",
    "Fixed-gain network duty is assessed at one operating point. Curve/system intersection, valve controls, NPSH/cavitation, variable speed and transient behavior are excluded.",
    "Air paths use static pressure and the declared static efficiency, without automatic density, speed or installation-effect corrections. Thermal loads and ventilation-code sizing are excluded.",
    "Motor electrical input equals shaft power divided by declared motor efficiency. Starting current, protection selectivity, motor overload settings, intermediate-fault thermal checks, arc flash and national wiring tables are excluded.",
    "Fire checks use the authored simultaneous terminals, total demand and usable storage. Hazard classification, remote-area selection, fire-pump listing and authority approval are excluded.",
    "Criterion IDs and adopted clauses are trace references; threshold values are explicitly authored in the system input and are not derived from those references.",
  ] };
  // Bounds on inputs do not prevent ill-conditioned derived values (e.g. tiny fault impedance).
  // Reject these before JSON could turn Infinity/NaN into null or storage could accept a claim.
  if (!validateMepSystemReport(report, source, designBasis)) throw new Error("MEP results exceed supported finite bounds or contain inconsistent result metadata; no assessment was retained.");
  return report;
}

/** Canonical equality of stored declarations, not a security digest or numerical proof. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function boolean(value: unknown, at: string): boolean { if (typeof value !== "boolean") throw new Error(`${at} must be boolean.`); return value; }
function warningList(value: unknown, at: string, maximum = 100): void { array(value, at, maximum).forEach(item => text(item, at, 4000)); }
function resultNumber(value: unknown, at: string, nullable = false, minimum = -LIMIT): void { if (nullable && value === null) return; number(value, at, minimum); }
function validateHydraulicReport(value: unknown, source: FluidNetwork): void {
  const raw = object(value, ["medium", "status", "verification", "iterations", "maxMassResidualM3s", "globalMassResidualM3s", "totalSupplyM3s", "totalDemandM3s", "nodes", "links", "warnings"], "hydraulic report");
  if (raw.medium !== source.medium || raw.verification !== "unverified" || (raw.status !== "converged" && raw.status !== "not-converged")) throw new Error("Stored hydraulic report has invalid medium or status.");
  const iterations = number(raw.iterations, "iterations", 0, source.options?.maxIterations ?? 60);
  if (!Number.isInteger(iterations)) throw new Error("Stored iteration count must be an integer.");
  number(raw.maxMassResidualM3s, "maxMassResidualM3s", 0); number(raw.globalMassResidualM3s, "globalMassResidualM3s"); number(raw.totalSupplyM3s, "totalSupplyM3s"); number(raw.totalDemandM3s, "totalDemandM3s", 0);
  if ((raw.status === "converged") !== (number(raw.maxMassResidualM3s, "maxMassResidualM3s") <= (source.options?.flowToleranceM3s ?? 1e-7))) throw new Error("Stored hydraulic convergence contradicts its residual.");
  const nodes = array(raw.nodes, "hydraulic.nodes", source.nodes.length, source.nodes.length);
  nodes.forEach((entry, index) => {
    const node = object(entry, ["nodeId", "potential", "pressure", "pressureUnit", "demandM3s", "sourceSupplyM3s", "residualM3s", "satisfiesMinimumPressure"], "hydraulic.node"), input = source.nodes[index];
    if (node.nodeId !== input.id || node.pressureUnit !== (source.medium === "water" ? "m-water" : "Pa")) throw new Error("Stored hydraulic node mapping or units are invalid.");
    number(node.potential, "node.potential"); number(node.pressure, "node.pressure"); number(node.demandM3s, "node.demandM3s", 0); number(node.residualM3s, "node.residualM3s");
    if (input.fixedPotential !== undefined) { number(node.sourceSupplyM3s, "node.sourceSupplyM3s"); if (node.potential !== input.fixedPotential || node.residualM3s !== 0) throw new Error("Stored fixed boundary does not match its source."); }
    else if (node.sourceSupplyM3s !== undefined) throw new Error("Consumer node cannot acquire a source-supply result.");
    if (input.minimumPressure !== undefined) {
      if (boolean(node.satisfiesMinimumPressure, "node.satisfiesMinimumPressure") !== (raw.status === "converged" && number(node.pressure, "node.pressure") >= input.minimumPressure)) throw new Error("Stored minimum-pressure status contradicts the node result.");
    } else if (node.satisfiesMinimumPressure !== undefined) throw new Error("Stored node contains an undeclared minimum-pressure check.");
  });
  const links = array(raw.links, "hydraulic.links", source.links.length, source.links.length);
  links.forEach((entry, index) => {
    const link = object(entry, ["linkId", "flowM3s", "velocityMps", "frictionFactor", "reynolds", "potentialLoss", "energyResidual", "satisfiesMaximumVelocity"], "hydraulic.link"), input = source.links[index];
    if (link.linkId !== input.id) throw new Error("Stored hydraulic link mapping is invalid.");
    for (const field of ["flowM3s", "velocityMps", "potentialLoss", "energyResidual"]) number(link[field], `link.${field}`);
    number(link.frictionFactor, "link.frictionFactor", 0); number(link.reynolds, "link.reynolds", 0);
    if (input.maximumVelocityMps !== undefined) {
      if (boolean(link.satisfiesMaximumVelocity, "link.satisfiesMaximumVelocity") !== (raw.status === "converged" && Math.abs(number(link.velocityMps, "link.velocityMps")) <= input.maximumVelocityMps)) throw new Error("Stored velocity status contradicts the link result.");
    } else if (link.satisfiesMaximumVelocity !== undefined) throw new Error("Stored link contains an undeclared velocity check.");
  });
  warningList(raw.warnings, "hydraulic.warnings", 20);
}
function validateCircuitReport(value: unknown): Record<string, unknown> {
  const raw = object(value, ["verification", "currentA", "voltageDropV", "voltageDropPct", "maximumFaultA", "minimumEarthFaultA", "deratedAmpacityA", "thermalWithstandA2s", "maximumAdiabaticFaultSeconds", "checks", "satisfiesSuppliedCriteria", "warnings"], "electrical report");
  if (raw.verification !== "unverified") throw new Error("Stored circuit must remain unverified.");
  for (const field of ["currentA", "voltageDropV", "voltageDropPct", "maximumFaultA", "minimumEarthFaultA", "deratedAmpacityA", "thermalWithstandA2s", "maximumAdiabaticFaultSeconds"]) number(raw[field], `electrical.${field}`, 0, field === "thermalWithstandA2s" ? 1e20 : LIMIT);
  const checks = object(raw.checks, ELECTRICAL_CHECKS, "electrical.checks");
  ELECTRICAL_CHECKS.forEach(field => boolean(checks[field], `electrical.${field}`));
  if (boolean(raw.satisfiesSuppliedCriteria, "electrical.satisfiesSuppliedCriteria") !== ELECTRICAL_CHECKS.every(field => checks[field] === true)) throw new Error("Stored circuit aggregate contradicts its checks.");
  warningList(raw.warnings, "electrical.warnings", 20);
  return checks;
}

/**
 * Strict restoration only: checks shape, declarations, IDs, units and pass gates.
 * It deliberately never runs an analysis or validates the mathematical solution.
 */
export function validateMepSystemReport(value: unknown, input: MepSystemInput, basis: EngineeringDesignBasis): value is MepSystemReport {
  try {
    const source = parseMepSystemInput(input), capturedBasis = parseEngineeringDesignBasis(basis);
    checkTraceReferences(source, capturedBasis);
    const raw = object(value, ["version", "verification", "claim", "nationalCodeCompliance", "source", "designBasis", "basisIssues", "systems", "equipment", "circuits", "checks", "satisfiesSuppliedCriteria", "warnings"], "MEP report");
    if (raw.version !== 1 || raw.verification !== "unverified" || raw.claim !== "supplied-criteria-only" || raw.nationalCodeCompliance !== "not-assessed") return false;
    if (canonical(parseMepSystemInput(raw.source)) !== canonical(source) || engineeringBasisFingerprint(parseEngineeringDesignBasis(raw.designBasis)) !== engineeringBasisFingerprint(capturedBasis)) return false;
    warningList(raw.basisIssues, "basisIssues", 300); warningList(raw.warnings, "warnings", 30);
    if (canonical(raw.basisIssues) !== canonical(validateEngineeringDesignBasis(capturedBasis))) return false;
    const systems = array(raw.systems, "report.systems", source.systems.length, source.systems.length).map((entry, index) => {
      const item = object(entry, ["systemId", "hydraulic"], "report.system");
      if (item.systemId !== source.systems[index].id) throw new Error("Stored system mapping is invalid.");
      validateHydraulicReport(item.hydraulic, source.systems[index].network);
      return { systemId: source.systems[index].id, hydraulic: item.hydraulic as unknown as FluidNetworkReport };
    });
    const circuits = array(raw.circuits, "report.circuits", source.circuits.length, source.circuits.length).map((entry, index) => {
      const item = object(entry, ["circuitId", "electrical"], "report.circuit");
      if (item.circuitId !== source.circuits[index].id) throw new Error("Stored circuit mapping is invalid.");
      return { circuitId: source.circuits[index].id, checks: validateCircuitReport(item.electrical) };
    });
    const equipment = array(raw.equipment, "report.equipment", source.equipment.length, source.equipment.length).map((entry, index) => {
      const item = object(entry, ["equipmentId", "systemId", "potentialUnit", "status", "flowM3s", "requiredPotential", "modeledPotential", "availablePotential", "shaftPowerW", "motorInputPowerW", "nameplateInputPowerW", "expectedRunningCurrentA"], "report.equipment.item"), definition = source.equipment[index];
      const system = source.systems.find(candidate => candidate.id === definition.systemId)!;
      if (item.equipmentId !== definition.id || item.systemId !== definition.systemId || item.potentialUnit !== (system.network.medium === "water" ? "m-water" : "Pa") || (item.status !== "pass" && item.status !== "fail")) throw new Error("Stored equipment mapping, units or status are invalid.");
      for (const field of ["flowM3s", "requiredPotential", "availablePotential", "shaftPowerW", "motorInputPowerW", "expectedRunningCurrentA"]) resultNumber(item[field], `equipment.${field}`, true, 0);
      number(item.modeledPotential, "equipment.modeledPotential", 0); number(item.nameplateInputPowerW, "equipment.nameplateInputPowerW", 0);
      if (item.modeledPotential !== system.network.links.find(link => link.id === definition.driveLinkId)!.addedPotential) throw new Error("Stored equipment gain differs from its input.");
      if (item.status === "pass" && (systems.find(candidate => candidate.systemId === definition.systemId)!.hydraulic.status !== "converged" || ["flowM3s", "requiredPotential", "availablePotential", "shaftPowerW", "motorInputPowerW", "expectedRunningCurrentA"].some(field => item[field] === null))) throw new Error("Unsolved equipment cannot pass.");
      return item;
    });
    // Only these checks are supported. Imported extra checks cannot introduce approval claims.
    const expected = new Map<string, MepCriterionTrace | undefined>();
    for (const system of source.systems) {
      expected.set(`system/${system.id}/convergence`, undefined);
      system.terminals.forEach(terminal => { expected.set(`system/${system.id}/terminal/${terminal.nodeId}/flow`, terminal.trace); expected.set(`system/${system.id}/terminal/${terminal.nodeId}/pressure`, terminal.trace); });
      system.network.nodes.forEach(node => { if (node.minimumPressure !== undefined) expected.set(`system/${system.id}/node/${node.id}/pressure`, undefined); });
      system.network.links.forEach(link => { if (link.maximumVelocityMps !== undefined) expected.set(`system/${system.id}/link/${link.id}/velocity`, undefined); });
      if (system.network.medium === "water") expected.set(`system/${system.id}/nonnegative-pressure`, undefined);
      if (system.fire) { expected.set(`system/${system.id}/fire/flow`, system.fire.trace); expected.set(`system/${system.id}/fire/storage`, system.fire.trace); }
    }
    source.equipment.forEach(item => ["usable-duty", "curve-range", "head", "modeled-curve-consistency", "motor"].forEach(name => expected.set(`equipment/${item.id}/${name}`, item.trace)));
    source.circuits.forEach(item => ["connected-power", "simultaneous-duty", ...ELECTRICAL_CHECKS, "adiabatic-applicability", "minimum-earth-fault-thermal"].forEach(name => expected.set(`circuit/${item.id}/${name}`, item.trace)));
    const seen = new Set<string>(), checks = array(raw.checks, "report.checks", expected.size, expected.size).map(entry => {
      const item = object(entry, ["id", "status", "message", "trace", "actual", "required", "unit"], "report.check"), checkId = text(item.id, "check.id", 300);
      if (!expected.has(checkId) || seen.has(checkId) || (item.status !== "pass" && item.status !== "fail")) throw new Error("Stored check mapping or status is invalid.");
      seen.add(checkId); text(item.message, "check.message", 2000);
      const expectedTrace = expected.get(checkId);
      if (expectedTrace === undefined ? item.trace !== undefined : canonical(trace(item.trace, "check.trace")) !== canonical(expectedTrace)) throw new Error("Stored check trace differs from its declared source.");
      if (item.actual !== undefined) number(item.actual, "check.actual", -1e20, 1e20);
      if (item.required !== undefined) number(item.required, "check.required", -1e20, 1e20);
      if (item.unit !== undefined) text(item.unit, "check.unit", 50);
      return { id: checkId, status: item.status };
    });
    for (const system of systems) {
      const related = checks.filter(check => check.id.startsWith(`system/${system.systemId}/`));
      const convergence = checks.find(check => check.id === `system/${system.systemId}/convergence`)!;
      if ((convergence.status === "pass") !== (system.hydraulic.status === "converged") || (system.hydraulic.status !== "converged" && related.some(check => check.status === "pass"))) return false;
    }
    for (let index = 0; index < equipment.length; index++) {
      const item = equipment[index], definition = source.equipment[index], hydraulic = systems.find(system => system.systemId === definition.systemId)!.hydraulic;
      const related = checks.filter(check => check.id.startsWith(`equipment/${definition.id}/`));
      if ((item.status === "pass") !== related.every(check => check.status === "pass")) return false;
      const drive = hydraulic.links.find(link => link.linkId === definition.driveLinkId)!;
      const forward = hydraulic.status === "converged" && drive.flowM3s > Math.max(1e-12, definition.flowToleranceM3s) && definition.path.every(step => hydraulic.links.find(link => link.linkId === step.linkId)!.flowM3s * step.direction > definition.flowToleranceM3s);
      if ((checks.find(check => check.id === `equipment/${definition.id}/usable-duty`)!.status === "pass") !== forward || (!forward && related.some(check => check.status === "pass"))) return false;
      if (forward ? item.flowM3s !== drive.flowM3s || item.requiredPotential === null : item.flowM3s !== null || item.requiredPotential !== null) return false;
    }
    for (const circuit of circuits) for (const field of ELECTRICAL_CHECKS) if ((checks.find(check => check.id === `circuit/${circuit.circuitId}/${field}`)!.status === "pass") !== (circuit.checks[field] === true)) return false;
    if (boolean(raw.satisfiesSuppliedCriteria, "satisfiesSuppliedCriteria") !== checks.every(check => check.status === "pass")) return false;
    return true;
  } catch { return false; }
}

/** Authored illustrative data only. Curves, ratings and project requirements must be replaced. */
export function mepSystemExample(): MepSystemInput {
  const exampleTrace = (): MepCriterionTrace => ({ source: "Illustrative user criteria; replace with reviewed project requirements and source references.", criterionIds: [] });
  const circuit = (connectedPowerW: number): ElectricalCircuitInput => ({ voltageV: 400, phases: 3, connectedPowerW, demandFactor: 1, powerFactor: 0.9, sourceResistanceOhm: 0.01, sourceReactanceOhm: 0.03, conductorResistanceOhm: 0.05, conductorReactanceOhm: 0.005, earthLoopResistanceOhm: 0.2, earthLoopReactanceOhm: 0.03, minimumVoltageFactor: 0.95, maximumVoltageFactor: 1.1, cableAmpacityA: 20, cableDeratingFactor: 0.8, breakerRatingA: 16, breakerBreakingCapacityA: 10000, instantaneousPickupA: 160, requiredDisconnectSeconds: 0.4, suppliedTripSecondsAtMinimumFault: 0.05, suppliedLetThroughA2sAtMaximumFault: 100000, conductorAreaMm2: 6, adiabaticK: 115, maximumVoltageDropPct: 5 });
  return {
    version: 1,
    systems: [
      { id: "fire-water", name: "Illustrative water and fire duty", source: "Authored pipe lengths, simultaneous demand and fixed source total head; not a surveyed design.", network: { version: 1, medium: "water", densityKgM3: 998.2, kinematicViscosityM2s: 1e-6, nodes: [{ id: "reservoir", elevationM: 0, demandM3s: 0, fixedPotential: 0 }, { id: "pump-out", elevationM: 0, demandM3s: 0 }, { id: "hydrant", elevationM: 5, demandM3s: 0.002 }], links: [{ id: "pump-drive", from: "reservoir", to: "pump-out", lengthM: 0.1, diameterM: 0.1, roughnessM: 0.0001, minorLossK: 0, addedPotential: 30 }, { id: "water-pipe", from: "pump-out", to: "hydrant", lengthM: 100, diameterM: 0.1, roughnessM: 0.0001, minorLossK: 2, maximumVelocityMps: 2 }] }, terminals: [{ nodeId: "hydrant", minimumFlowM3s: 0.002, minimumPressure: 20, trace: exampleTrace() }], fire: { criteria: { basis: "Illustrative supplied fire criteria only", requiredTotalFlowM3s: 0.002, requiredDurationMinutes: 60, usableStorageM3: 10, terminals: [{ nodeId: "hydrant", minimumFlowM3s: 0.002, minimumPressureHeadM: 20 }] }, trace: exampleTrace() } },
      { id: "supply-air", name: "Illustrative supply fan", source: "Authored duct, room demand and fixed static-pressure boundary; no thermal-load calculation.", network: { version: 1, medium: "air", densityKgM3: 1.2, kinematicViscosityM2s: 1.5e-5, nodes: [{ id: "intake", elevationM: 0, demandM3s: 0, fixedPotential: 0 }, { id: "fan-out", elevationM: 0, demandM3s: 0 }, { id: "room", elevationM: 0, demandM3s: 1 }], links: [{ id: "fan-drive", from: "intake", to: "fan-out", lengthM: 0.1, diameterM: 0.6, roughnessM: 0.00015, minorLossK: 0, addedPotential: 400 }, { id: "supply-duct", from: "fan-out", to: "room", lengthM: 20, widthM: 0.6, heightM: 0.5, roughnessM: 0.00015, minorLossK: 3, maximumVelocityMps: 5 }] }, terminals: [{ nodeId: "room", minimumFlowM3s: 1, minimumPressure: 100, trace: exampleTrace() }] },
    ],
    equipment: [
      { id: "pump-1", systemId: "fire-water", driveLinkId: "pump-drive", sourceNodeId: "reservoir", criticalTerminalNodeId: "hydrant", path: [{ linkId: "pump-drive", direction: 1 }, { linkId: "water-pipe", direction: 1 }], extraLossPotential: 0, reserveFraction: 0.1, potentialTolerance: 0.5, flowToleranceM3s: 1e-9, candidate: { id: "illustrative-pump", kind: "pump", curve: [{ flowM3s: 0.001, potential: 35 }, { flowM3s: 0.003, potential: 25 }], efficiency: 0.6, motorPowerW: 1500 }, manufacturerSource: "Illustrative curve, not a manufacturer product. Replace with a curve valid at the declared density and speed.", motorEfficiency: 0.9, electricalCircuitId: "pump-circuit", trace: exampleTrace() },
      { id: "fan-1", systemId: "supply-air", driveLinkId: "fan-drive", sourceNodeId: "intake", criticalTerminalNodeId: "room", path: [{ linkId: "fan-drive", direction: 1 }, { linkId: "supply-duct", direction: 1 }], extraLossPotential: 0, reserveFraction: 0.1, potentialTolerance: 5, flowToleranceM3s: 1e-9, candidate: { id: "illustrative-fan", kind: "fan", curve: [{ flowM3s: 0.5, potential: 450 }, { flowM3s: 1.5, potential: 350 }], efficiency: 0.65, motorPowerW: 1000 }, manufacturerSource: "Illustrative static-pressure curve and static efficiency, not a manufacturer product. Replace with a curve valid at the declared density and speed.", motorEfficiency: 0.9, electricalCircuitId: "fan-circuit", trace: exampleTrace() },
    ],
    circuits: [
      { id: "pump-circuit", input: circuit(1670), equipmentIds: ["pump-1"], otherConnectedPowerW: 0, powerToleranceW: 10, maximumFaultClearingSeconds: 0.05, protectionSource: "Illustrative supplied ratings, trip time and maximum-fault let-through; replace with manufacturer data.", ampacitySource: "Illustrative supplied ampacity and derating; replace with adopted installation criteria.", trace: exampleTrace() },
      { id: "fan-circuit", input: circuit(1115), equipmentIds: ["fan-1"], otherConnectedPowerW: 0, powerToleranceW: 10, maximumFaultClearingSeconds: 0.05, protectionSource: "Illustrative supplied ratings, trip time and maximum-fault let-through; replace with manufacturer data.", ampacitySource: "Illustrative supplied ampacity and derating; replace with adopted installation criteria.", trace: exampleTrace() },
    ],
  };
}
