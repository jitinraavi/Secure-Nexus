import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ProjectDetail } from "../types";
import { ProjectWorkspacePanel } from "../components/ProjectWorkspacePanel";
import { ProjectJobsPanel } from "../components/ProjectJobsPanel";
import { Badge, Button, Card, Input, Select } from "../components/ui";
import { download, downloadBlob, zipFiles } from "../lib/download";
import { engineeringRecord, identifier, requireFinite } from "../lib/engineeringNumerics";
import { analyzeFrame2D, parseFrameModel } from "../lib/frameAnalysis";
import { analyzeElectricalCircuit, assessFireFlow, parseFluidNetwork, selectEquipment, solveFluidNetwork, type ElectricalCircuitInput, type EquipmentCandidate, type FireFlowCriteria } from "../lib/engineeringNetworks";
import { exportEpanetNetwork, exportOpenSees2D, exportStaadPlane, type SolverDeck } from "../lib/solverAdapters";
import { importRoutedMepNetwork, importStructuralExchange2D, type FrameBridgeOptions } from "../lib/engineeringModelBridge";
import { buildStructuralSolverExchange } from "../lib/structuralEngine";
import { createNativeFrameInput } from "../lib/nativeResults";

type Module = "frame" | "water" | "air" | "electrical" | "fire" | "equipment";
interface MepBridgeSettings { endpointToleranceM: number; sourceElementId: string; waterSourceHeadM: number; airSourcePressurePa: number; waterTerminalDemandM3s: number; airTerminalDemandM3s: number; roughnessM: number; minorLossKPerSegment: number }
interface StoredReport { module: Module; source: string; data: unknown }
interface ConversionWarnings { module: Module; warnings: string[] }
interface EngineeringWorkspace {
  version: 1; activeModule: Module; inputs: Record<Module, string>; combinationId: string;
  frameBridge: FrameBridgeOptions; mepBridge: MepBridgeSettings;
  conversionWarnings: ConversionWarnings | null; reports: Partial<Record<Module, StoredReport>>;
}
const modules: { id: Module; label: string; description: string }[] = [
  { id: "frame", label: "Structural frame", description: "2D elastic frame, user load combinations, geometric stiffness and explicit section criteria." },
  { id: "water", label: "Hydraulics", description: "Steady water flow, total heads, friction/minor losses, pressure-dependent emitters and nodal mass balance." },
  { id: "air", label: "HVAC airflow", description: "Steady airflow and static-pressure balancing with supplied terminal demands and fixed fan/source pressures." },
  { id: "electrical", label: "Electrical protection", description: "Demand current, voltage drop, supplied-impedance fault currents and explicit protection criteria." },
  { id: "fire", label: "Fire flow", description: "Simultaneous terminal flow/pressure and storage-duration checks against your declared criteria." },
  { id: "equipment", label: "Pump/fan selection", description: "Duty-point interpolation, motor/efficiency sizing and reserve checks against a supplied catalog." },
];

const waterExample = {
  version: 1, medium: "water", densityKgM3: 998.2, kinematicViscosityM2s: 1e-6,
  nodes: [{ id: "source", elevationM: 0, demandM3s: 0, fixedPotential: 45 }, { id: "terminal", elevationM: 5, demandM3s: 0.002, minimumPressure: 15 }],
  links: [{ id: "pipe-1", from: "source", to: "terminal", lengthM: 80, diameterM: 0.05, roughnessM: 0.0001, minorLossK: 3, maximumVelocityMps: 2 }],
};
const examples: Record<Module, unknown> = {
  frame: {
    version: 1, analysis: "p-delta",
    nodes: [{ id: "base", xM: 0, yM: 0, restraints: [true, true, true] }, { id: "top", xM: 0, yM: 3, restraints: [false, false, false] }],
    members: [{ id: "column", start: "base", end: "top", areaM2: 0.02, inertiaM4: 0.00008, elasticModulusPa: 200e9, design: { sectionModulusM3: 0.0008, allowableStressPa: 150e6, effectiveLengthFactor: 2, bucklingSafetyFactor: 1.5, allowableDeflectionRatio: 0.005 } }],
    loadCases: [{ id: "gravity", nodal: [{ node: "top", fxN: 0, fyN: -100000, mzNm: 0 }], uniform: [] }, { id: "lateral", nodal: [{ node: "top", fxN: 10000, fyN: 0, mzNm: 0 }], uniform: [] }],
    combinations: [{ id: "user-combination", factors: { gravity: 1, lateral: 1 } }], options: { tolerance: 1e-7, maxIterations: 30 },
  },
  water: waterExample,
  air: {
    version: 1, medium: "air", densityKgM3: 1.2, kinematicViscosityM2s: 1.5e-5,
    nodes: [{ id: "fan", elevationM: 0, demandM3s: 0, fixedPotential: 500 }, { id: "room", elevationM: 0, demandM3s: 0.2, minimumPressure: 0 }],
    links: [{ id: "duct-1", from: "fan", to: "room", lengthM: 20, widthM: 0.4, heightM: 0.25, roughnessM: 0.00015, minorLossK: 5, maximumVelocityMps: 5 }],
  },
  electrical: {
    voltageV: 400, phases: 3, connectedPowerW: 20000, demandFactor: 0.8, powerFactor: 0.9,
    sourceResistanceOhm: 0.01, sourceReactanceOhm: 0.03, conductorResistanceOhm: 0.05, conductorReactanceOhm: 0.005,
    earthLoopResistanceOhm: 0.2, earthLoopReactanceOhm: 0.03, minimumVoltageFactor: 0.95, maximumVoltageFactor: 1.1,
    cableAmpacityA: 63, cableDeratingFactor: 0.8, breakerRatingA: 32, breakerBreakingCapacityA: 10000, instantaneousPickupA: 320,
    requiredDisconnectSeconds: 0.4, suppliedTripSecondsAtMinimumFault: 0.05, suppliedLetThroughA2sAtMaximumFault: 100000,
    conductorAreaMm2: 6, adiabaticK: 115, maximumVoltageDropPct: 5,
  },
  fire: {
    network: { ...waterExample, nodes: [{ id: "source", elevationM: 0, demandM3s: 0, fixedPotential: 45 }, { id: "terminal", elevationM: 5, demandM3s: 0, emitterCoefficient: 0.0004 }] },
    criteria: { basis: "Example user criteria; replace with approved project requirements", requiredTotalFlowM3s: 0.002, requiredDurationMinutes: 60, usableStorageM3: 12, terminals: [{ nodeId: "terminal", minimumFlowM3s: 0.002, minimumPressureHeadM: 15 }] },
  },
  equipment: {
    duty: { kind: "pump", flowM3s: 0.005, requiredPotential: 20, densityKgM3: 998.2, reserveFraction: 0.1 },
    candidates: [{ id: "example-pump", kind: "pump", curve: [{ flowM3s: 0, potential: 35 }, { flowM3s: 0.01, potential: 15 }], efficiency: 0.7, motorPowerW: 2200 }],
  },
};
const initialInputs = () => Object.fromEntries(modules.map(module => [module.id, JSON.stringify(examples[module.id], null, 2)])) as Record<Module, string>;
const maxInputCharacters = 1_000_000;

function parseInput(text: string): unknown {
  if (text.length > maxInputCharacters) throw new Error("Input exceeds the 1 MB text limit.");
  return JSON.parse(text) as unknown;
}
function calculate(module: Module, value: unknown): unknown {
  if (module === "frame") return analyzeFrame2D(parseFrameModel(value));
  if (module === "water" || module === "air") {
    const network = parseFluidNetwork(value);
    if (network.medium !== (module === "water" ? "water" : "air")) throw new Error(`Choose a ${module === "water" ? "water" : "air"} input for this module.`);
    return solveFluidNetwork(network);
  }
  if (module === "electrical") {
    if (!engineeringRecord(value)) throw new Error("Electrical input must be an object.");
    return analyzeElectricalCircuit(value as unknown as ElectricalCircuitInput);
  }
  if (!engineeringRecord(value)) throw new Error("Module input must be an object.");
  if (module === "fire") {
    if (!engineeringRecord(value.criteria)) throw new Error("Fire input requires criteria and a network.");
    return assessFireFlow(parseFluidNetwork(value.network), value.criteria as unknown as FireFlowCriteria);
  }
  if (!Array.isArray(value.candidates) || !engineeringRecord(value.duty)) throw new Error("Equipment input requires candidates and a duty object.");
  return selectEquipment(value.candidates as EquipmentCandidate[], value.duty as unknown as Parameters<typeof selectEquipment>[1]);
}

function isModule(value: unknown): value is Module { return modules.some(item => item.id === value); }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!engineeringRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}
function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) throw new Error(`${label} exceeds its text limit or is not text.`);
  return value;
}
function numericFields(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) requireFinite(value[key], key, -1e250, 1e250);
}
function booleans(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof value[key] !== "boolean") throw new Error(`${key} must be boolean.`);
}
function warnings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error("Warnings must contain at most 500 entries.");
  return value.map(item => boundedText(item, "Warning", 4000));
}
// Restoring a report validates data without running a solver or recomputing results.
function validateReportSource(module: Module, value: unknown): void {
  if (module === "frame") { parseFrameModel(value); return; }
  if (module === "water" || module === "air") {
    if (parseFluidNetwork(value).medium !== (module === "water" ? "water" : "air")) throw new Error("Saved fluid report has a different medium.");
    return;
  }
  const input = record(value, "Saved report source");
  if (module === "electrical") {
    if (input.phases !== 1 && input.phases !== 3) throw new Error("Saved electrical source needs one or three phases.");
    const limits: [string, number, number][] = [
      ["voltageV", 1, 1e5], ["connectedPowerW", 0, 1e10], ["demandFactor", 0, 1], ["powerFactor", 0.01, 1],
      ...["sourceResistanceOhm", "sourceReactanceOhm", "conductorResistanceOhm", "conductorReactanceOhm", "earthLoopResistanceOhm", "earthLoopReactanceOhm"].map(key => [key, 0, 1e6] as [string, number, number]),
      ["minimumVoltageFactor", 0.1, 1], ["maximumVoltageFactor", 1, 2], ["cableAmpacityA", 0.001, 1e6], ["cableDeratingFactor", 0.001, 1], ["breakerRatingA", 0.001, 1e6], ["breakerBreakingCapacityA", 0.001, 1e9], ["instantaneousPickupA", 0.001, 1e9],
      ["requiredDisconnectSeconds", 0.001, 1e4], ["suppliedTripSecondsAtMinimumFault", 0.001, 1e4], ["suppliedLetThroughA2sAtMaximumFault", 0, 1e20], ["conductorAreaMm2", 0.01, 1e5], ["adiabaticK", 1, 1000], ["maximumVoltageDropPct", 0, 100],
    ];
    for (const [key, min, max] of limits) requireFinite(input[key], key, min, max);
    if ((Number(input.sourceResistanceOhm) + Number(input.conductorResistanceOhm) === 0 && Number(input.sourceReactanceOhm) + Number(input.conductorReactanceOhm) === 0) || Number(input.earthLoopResistanceOhm) + Number(input.earthLoopReactanceOhm) === 0) throw new Error("Saved circuit impedances must be positive.");
    return;
  }
  if (module === "fire") {
    const network = parseFluidNetwork(input.network), criteria = record(input.criteria, "Fire criteria");
    if (network.medium !== "water" || !boundedText(criteria.basis, "Criteria basis", 500).trim()) throw new Error("Saved fire criteria require water and an explicit basis.");
    requireFinite(criteria.requiredTotalFlowM3s, "requiredTotalFlowM3s", 1e-12, 1000); requireFinite(criteria.requiredDurationMinutes, "requiredDurationMinutes", 0.01, 1e5); requireFinite(criteria.usableStorageM3, "usableStorageM3", 0, 1e10);
    if (!Array.isArray(criteria.terminals) || !criteria.terminals.length || criteria.terminals.length > 80) throw new Error("Saved fire criteria require 1–80 terminals.");
    const ids = new Set<string>();
    for (const item of criteria.terminals) {
      const terminal = record(item, "Fire terminal");
      if (!identifier(terminal.nodeId) || ids.has(terminal.nodeId) || !network.nodes.some(node => node.id === terminal.nodeId && node.fixedPotential === undefined)) throw new Error("Saved fire terminal references an invalid consumer.");
      ids.add(terminal.nodeId); requireFinite(terminal.minimumFlowM3s, "minimumFlowM3s", 0, 1000); requireFinite(terminal.minimumPressureHeadM, "minimumPressureHeadM", 0, 1e6);
    }
    return;
  }
  const duty = record(input.duty, "Equipment duty");
  if (duty.kind !== "pump" && duty.kind !== "fan") throw new Error("Saved equipment duty requires a pump or fan.");
  requireFinite(duty.flowM3s, "duty flow", 1e-12, 1000); requireFinite(duty.requiredPotential, "duty potential", 0, 1e8); requireFinite(duty.densityKgM3, "duty density", 0.01, 1e5); requireFinite(duty.reserveFraction, "reserveFraction", 0, 2);
  if (!Array.isArray(input.candidates) || input.candidates.length > 200) throw new Error("Saved catalog exceeds 200 candidates.");
  const ids = new Set<string>();
  for (const item of input.candidates) {
    const candidate = record(item, "Equipment candidate");
    if (!identifier(candidate.id) || ids.has(candidate.id) || (candidate.kind !== "pump" && candidate.kind !== "fan")) throw new Error("Saved equipment identifiers/kinds are invalid.");
    ids.add(candidate.id); requireFinite(candidate.efficiency, "efficiency", 0.01, 1); requireFinite(candidate.motorPowerW, "motorPowerW", 1, 1e10);
    if (!Array.isArray(candidate.curve) || candidate.curve.length < 2 || candidate.curve.length > 100) throw new Error("Saved equipment curves require 2–100 points.");
    const points = candidate.curve.map(item => { const point = record(item, "Curve point"); return { flow: requireFinite(point.flowM3s, "curve flow", 0, 1000), potential: requireFinite(point.potential, "curve potential", 0, 1e8) }; }).sort((a, b) => a.flow - b.flow);
    for (let index = 1; index < points.length; index++) if (points[index].flow <= points[index - 1].flow || points[index].potential > points[index - 1].potential) throw new Error("Saved equipment curve is not a unique-flow, non-increasing curve.");
  }
}
function reportRows(value: unknown, idKey: string, ids: Set<string>, keys: string[]): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length !== ids.size) throw new Error("Saved report row count differs from its source model.");
  const seen = new Set<string>();
  return value.map(item => {
    const row = record(item, "Report row"), id = row[idKey];
    if (typeof id !== "string" || !ids.has(id) || seen.has(id)) throw new Error("Saved report IDs differ from its source model.");
    seen.add(id); numericFields(row, keys); return row;
  });
}
function validateFluidReport(value: unknown, source: unknown): void {
  const network = parseFluidNetwork(source), report = record(value, "Fluid report");
  if (report.verification !== "unverified" || report.medium !== network.medium || (report.status !== "converged" && report.status !== "not-converged")) throw new Error("Saved fluid report has an invalid scope/status.");
  numericFields(report, ["iterations", "maxMassResidualM3s", "globalMassResidualM3s", "totalSupplyM3s", "totalDemandM3s"]); warnings(report.warnings);
  if (!Number.isInteger(report.iterations) || Number(report.iterations) < 0 || Number(report.iterations) > 80) throw new Error("Saved network iteration count is invalid.");
  for (const row of reportRows(report.nodes, "nodeId", new Set(network.nodes.map(node => node.id)), ["potential", "pressure", "demandM3s", "residualM3s"])) {
    if (row.pressureUnit !== (network.medium === "water" ? "m-water" : "Pa")) throw new Error("Saved node pressure units are invalid.");
    if (row.sourceSupplyM3s !== undefined) numericFields(row, ["sourceSupplyM3s"]);
    if (row.satisfiesMinimumPressure !== undefined) booleans(row, ["satisfiesMinimumPressure"]);
  }
  for (const row of reportRows(report.links, "linkId", new Set(network.links.map(link => link.id)), ["flowM3s", "velocityMps", "frictionFactor", "reynolds", "potentialLoss", "energyResidual"])) if (row.satisfiesMaximumVelocity !== undefined) booleans(row, ["satisfiesMaximumVelocity"]);
}
function validateReport(module: Module, data: unknown, source: unknown): void {
  validateReportSource(module, source);
  if (module === "water" || module === "air") { validateFluidReport(data, source); return; }
  if (module === "equipment") {
    const input = record(source, "Equipment source"), candidates = input.candidates as Record<string, unknown>[];
    for (const row of reportRows(data, "id", new Set(candidates.map(candidate => String(candidate.id))), ["availablePotential", "dutyShaftPowerW", "requiredShaftPowerW"])) booleans(row, ["meetsDuty"]);
    return;
  }
  const report = record(data, "Saved report");
  if (report.verification !== "unverified") throw new Error("Saved report must retain its unverified status.");
  warnings(report.warnings);
  if (module === "frame") {
    const model = parseFrameModel(source), ids = new Set((model.combinations ?? model.loadCases).map(combination => combination.id));
    boundedText(report.method, "Frame method", 1000);
    const results = reportRows(report.results, "combinationId", ids, ["iterations", "relativeChange", "maxFreeForceResidualN", "maxFreeMomentResidualNm"]);
    for (const result of results) {
      if ((result.status !== "converged" && result.status !== "not-converged") || !Number.isInteger(result.iterations) || Number(result.iterations) < 0 || Number(result.iterations) > 40) throw new Error("Saved frame status/iterations are invalid.");
      reportRows(result.displacements, "nodeId", new Set(model.nodes.map(node => node.id)), ["uxM", "uyM", "rotationRad"]);
      reportRows(result.reactions, "nodeId", new Set(model.nodes.filter(node => node.restraints.some(Boolean)).map(node => node.id)), ["fxN", "fyN", "mzNm"]);
      for (const member of reportRows(result.members, "memberId", new Set(model.members.map(member => member.id)), ["axialTensionN", "maxMomentNm", "maxShearN", "maxChordDeflectionM"])) {
        if (!Array.isArray(member.localEndForces) || member.localEndForces.length !== 6) throw new Error("Saved frame end forces require six components.");
        member.localEndForces.forEach(force => requireFinite(force, "End force", -1e250, 1e250));
        if (member.design !== undefined) { const design = record(member.design, "Member criteria report"); numericFields(design, ["axialBendingUtilization", "eulerBucklingUtilization", "deflectionUtilization"]); booleans(design, ["satisfiesUserCriteria"]); boundedText(design.basis, "Member criteria basis", 4000); }
      }
    }
  } else if (module === "electrical") {
    numericFields(report, ["currentA", "voltageDropV", "voltageDropPct", "maximumFaultA", "minimumEarthFaultA", "deratedAmpacityA", "thermalWithstandA2s", "maximumAdiabaticFaultSeconds"]);
    booleans(report, ["satisfiesSuppliedCriteria"]); booleans(record(report.checks, "Protection checks"), ["loadProtection", "breakingCapacity", "earthFaultPickup", "disconnectionTime", "thermalWithstand", "voltageDrop"]);
  } else {
    const input = record(source, "Fire source"), criteria = record(input.criteria, "Fire criteria");
    if (report.basis !== criteria.basis) throw new Error("Saved fire basis differs from its source criteria.");
    validateFluidReport(report.hydraulic, input.network); numericFields(report, ["deliveredTerminalFlowM3s", "requiredStorageM3"]); booleans(report, ["storageSatisfiesCriteria", "satisfiesSuppliedCriteria"]);
    const terminals = criteria.terminals as Record<string, unknown>[];
    for (const terminal of reportRows(report.terminals, "nodeId", new Set(terminals.map(terminal => String(terminal.nodeId))), ["minimumFlowM3s", "minimumPressureHeadM", "deliveredFlowM3s", "pressureHeadM"])) booleans(terminal, ["satisfiesCriteria"]);
  }
}
function parseWorkspace(value: unknown): EngineeringWorkspace {
  // Bound traversal before serialization; do not accept cyclic/non-JSON objects.
  let entries = 0, characters = 0;
  const ancestors = new Set<object>();
  const visit = (item: unknown, depth: number): void => {
    if (++entries > 250000 || depth > 32) throw new Error("Workspace data exceeds recovery complexity limits.");
    if (typeof item === "string") { characters += item.length; if (characters > 16_000_000) throw new Error("Workspace exceeds the 16 MB text recovery limit."); return; }
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || ancestors.has(item)) throw new Error("Workspace contains invalid non-JSON data.");
    ancestors.add(item);
    for (const [key, child] of Object.entries(item)) { characters += key.length; visit(child, depth + 1); }
    ancestors.delete(item);
  };
  visit(value, 0);
  const workspace = record(value, "Engineering workspace");
  if (workspace.version !== 1 || !isModule(workspace.activeModule)) throw new Error("Engineering workspace version/module is unsupported.");
  const savedInputs = record(workspace.inputs, "Module inputs"), inputs = {} as Record<Module, string>;
  if (Object.keys(savedInputs).length !== modules.length) throw new Error("Workspace must contain exactly six module inputs.");
  // Raw text is a draft: unfinished JSON survives recovery. Report source JSON
  // must satisfy the current solver schema before the report can be restored.
  for (const module of modules) inputs[module.id] = boundedText(savedInputs[module.id], `${module.label} input`, maxInputCharacters);
  const frame = record(workspace.frameBridge, "Frame conversion options");
  if (frame.plane !== "xy" && frame.plane !== "zy") throw new Error("Saved frame plane is invalid.");
  requireFinite(frame.sliceCoordinateM, "Slice coordinate", -1e6, 1e6); requireFinite(frame.sliceToleranceM, "Slice tolerance", 1e-6, 1); requireFinite(frame.areaM2, "Section area", 1e-8, 1e4); requireFinite(frame.inertiaM4, "Section inertia", 1e-14, 1e6); requireFinite(frame.elasticModulusPa, "Elastic modulus", 1e3, 1e13); booleans(frame, ["acceptAssumedFixedSupports"]);
  const mep = record(workspace.mepBridge, "MEP conversion options");
  boundedText(mep.sourceElementId, "Source element ID", 100); requireFinite(mep.endpointToleranceM, "Endpoint tolerance", 1e-6, 0.5); requireFinite(mep.waterSourceHeadM, "Water head", -1e7, 1e7); requireFinite(mep.airSourcePressurePa, "Air pressure", -1e7, 1e7);
  requireFinite(mep.waterTerminalDemandM3s, "Water terminal demand", 0, 1000); requireFinite(mep.airTerminalDemandM3s, "Air terminal demand", 0, 1000); requireFinite(mep.roughnessM, "Roughness", 0, 1); requireFinite(mep.minorLossKPerSegment, "Minor loss", 0, 1e6);
  let conversion: ConversionWarnings | null = null;
  if (workspace.conversionWarnings !== null) { const saved = record(workspace.conversionWarnings, "Conversion warnings"); if (!isModule(saved.module)) throw new Error("Saved warning module is invalid."); conversion = { module: saved.module, warnings: warnings(saved.warnings) }; }
  const savedReports = record(workspace.reports, "Saved reports"), reports: Partial<Record<Module, StoredReport>> = {};
  if (Object.keys(savedReports).length > modules.length) throw new Error("Workspace contains too many reports.");
  for (const [key, value] of Object.entries(savedReports)) {
    if (!isModule(key)) throw new Error("Workspace has an unknown report module.");
    const saved = record(value, "Saved module report"), source = boundedText(saved.source, "Report source input", maxInputCharacters);
    if (saved.module !== key || saved.data === undefined || JSON.stringify(saved.data).length > 2_000_000) throw new Error("Saved report module/size is invalid.");
    validateReport(key, saved.data, parseInput(source)); reports[key] = { module: key, source, data: saved.data };
  }
  return { version: 1, activeModule: workspace.activeModule, inputs, combinationId: boundedText(workspace.combinationId, "Combination ID", 100), frameBridge: { plane: frame.plane, sliceCoordinateM: Number(frame.sliceCoordinateM), sliceToleranceM: Number(frame.sliceToleranceM), areaM2: Number(frame.areaM2), inertiaM4: Number(frame.inertiaM4), elasticModulusPa: Number(frame.elasticModulusPa), acceptAssumedFixedSupports: frame.acceptAssumedFixedSupports as boolean }, mepBridge: { endpointToleranceM: Number(mep.endpointToleranceM), sourceElementId: String(mep.sourceElementId), waterSourceHeadM: Number(mep.waterSourceHeadM), airSourcePressurePa: Number(mep.airSourcePressurePa), waterTerminalDemandM3s: Number(mep.waterTerminalDemandM3s), airTerminalDemandM3s: Number(mep.airTerminalDemandM3s), roughnessM: Number(mep.roughnessM), minorLossKPerSegment: Number(mep.minorLossKPerSegment) }, conversionWarnings: conversion, reports };
}

function convertGeometry(value: unknown, module: Module, frame: FrameBridgeOptions, mep: MepBridgeSettings) {
  if (module !== "frame" && module !== "water" && module !== "air") throw new Error("Choose frame, water or airflow before importing project geometry.");
  return module === "frame" ? importStructuralExchange2D(value, frame) : importRoutedMepNetwork(value, { medium: module === "water" ? "water" : "air", endpointToleranceM: mep.endpointToleranceM, sourceElementId: mep.sourceElementId.trim() || undefined, sourcePotential: module === "water" ? mep.waterSourceHeadM : mep.airSourcePressurePa, terminalDemandM3s: module === "water" ? mep.waterTerminalDemandM3s : mep.airTerminalDemandM3s, roughnessM: mep.roughnessM, minorLossKPerSegment: mep.minorLossKPerSegment });
}
function projectStructuralExchange(project: ProjectDetail): unknown {
  const community = project.design?.community;
  if (!community || community.version !== 1 || !Array.isArray(community.towers) || community.towers.length > 1000) throw new Error("Structural project import requires a supported community design with structural grids or drafted members.");
  const levels = community.levels ?? [], grids = community.structuralGrid ?? [], drafts = community.drafts ?? [];
  if (!Array.isArray(levels) || levels.length > 50 || !Array.isArray(grids) || grids.length > 100 || !Array.isArray(drafts) || drafts.length > 2000 || Math.max(levels.length, 1) * grids.filter(line => line.axis === "x").length * grids.filter(line => line.axis === "z").length > 5000) throw new Error("Structural source is too large; export a smaller subsystem from the editor.");
  // Use the editor's existing exchange; its assumptions are surfaced below. The
  // 2D bridge leaves loads empty and supports unrestrained unless explicitly opted in.
  return JSON.parse(buildStructuralSolverExchange(community)) as unknown;
}

export default function EngineeringWorkbench() {
  const [module, setModule] = useState<Module>("frame"), [inputs, setInputs] = useState(initialInputs), [combinationId, setCombinationId] = useState("");
  const [reports, setReports] = useState<Partial<Record<Module, StoredReport>>>({}), [error, setError] = useState<string | null>(null), [exporting, setExporting] = useState(false);
  const [frameBridge, setFrameBridge] = useState<FrameBridgeOptions>({ plane: "xy", sliceCoordinateM: 0, sliceToleranceM: 0.001, areaM2: 0.02, inertiaM4: 0.00008, elasticModulusPa: 200e9, acceptAssumedFixedSupports: false });
  const [mepBridge, setMepBridge] = useState<MepBridgeSettings>({ endpointToleranceM: 0.001, sourceElementId: "", waterSourceHeadM: 45, airSourcePressurePa: 500, waterTerminalDemandM3s: 0.002, airTerminalDemandM3s: 0.2, roughnessM: 0.0001, minorLossKPerSegment: 0 });
  const [conversionWarnings, setConversionWarnings] = useState<ConversionWarnings | null>(null);
  const importGeneration = useRef(0);
  useEffect(() => () => { importGeneration.current++; }, []);
  const fileInput = useRef<HTMLInputElement>(null), modelFileInput = useRef<HTMLInputElement>(null), description = modules.find(item => item.id === module)!;
  const activeResult = reports[module]?.source === inputs[module] ? reports[module]! : null;
  const payload = useMemo<EngineeringWorkspace>(() => ({ version: 1, activeModule: module, inputs, combinationId, frameBridge, mepBridge, conversionWarnings, reports }), [module, inputs, combinationId, frameBridge, mepBridge, conversionWarnings, reports]);
  const restoreWorkspace = useCallback((value: unknown) => {
    const restored = parseWorkspace(value);
    importGeneration.current++;
    // No setters run until the whole snapshot, all options and reports validate.
    setModule(restored.activeModule); setInputs(restored.inputs); setCombinationId(restored.combinationId); setFrameBridge(restored.frameBridge); setMepBridge(restored.mepBridge); setConversionWarnings(restored.conversionWarnings); setReports(restored.reports); setError(null);
  }, []);
  const importProject = useCallback((project: ProjectDetail) => {
    try {
      if (!project.design) throw new Error("The selected project has no saved design geometry.");
      const source = module === "frame" ? projectStructuralExchange(project) : project.design;
      const converted = convertGeometry(source, module, frameBridge, mepBridge), text = JSON.stringify(converted.model, null, 2);
      if (text.length > maxInputCharacters) throw new Error("Converted project subsystem exceeds the 1 MB input limit.");
      const sourceWarnings = module === "frame" && engineeringRecord(source) && Array.isArray(source.warnings) ? warnings(source.warnings) : [];
      importGeneration.current++;
      setInputs(current => ({ ...current, [module]: text })); setConversionWarnings({ module, warnings: [...sourceWarnings, ...converted.warnings] }); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import project geometry."); throw cause; }
  }, [module, frameBridge, mepBridge]);
  const updateText = (text: string) => { importGeneration.current++; setInputs(current => ({ ...current, [module]: text })); setError(null); };
  const run = () => {
    setError(null);
    setReports(current => { const next = { ...current }; delete next[module]; return next; });
    try { const data = calculate(module, parseInput(inputs[module])); setReports(current => ({ ...current, [module]: { module, source: inputs[module], data } })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to calculate this dataset."); }
  };
  const exportDeck = async (target: "opensees" | "staad" | "epanet") => {
    setError(null); setExporting(true);
    try {
      const value = parseInput(inputs[module]); let deck: SolverDeck;
      if (target === "epanet") deck = exportEpanetNetwork(module === "fire" && engineeringRecord(value) ? parseFluidNetwork(value.network) : parseFluidNetwork(value));
      else {
        const model = parseFrameModel(value);
        deck = target === "opensees" ? exportOpenSees2D(model, combinationId.trim() || undefined) : exportStaadPlane(model, combinationId.trim() || undefined);
      }
      const bundle = await zipFiles([{ name: deck.filename, content: deck.content }, { name: "mapping-and-limitations.json", content: JSON.stringify({ ...deck, content: undefined }, null, 2) }, { name: "source-input.json", content: inputs[module] }]);
      downloadBlob(`secure-nexus-${target}-input.zip`, bundle);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to export solver deck."); }
    finally { setExporting(false); }
  };
  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-8 text-slate-100">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Engineering workbench</h1><p className="mt-2 max-w-3xl text-sm text-slate-400">Edit or import an explicit SI engineering dataset, calculate bounded analysis, and export its source/report or native solver input.</p></div>
      <div className="flex items-center gap-3"><Badge tone="amber">Independent verification required</Badge><Link to="/dashboard" className="text-sm text-amber-300">Projects</Link></div>
    </div>
    <ProjectWorkspacePanel kind="engineering" payload={payload} onRestore={restoreWorkspace} onImportProject={importProject} />
    <ProjectJobsPanel workspaceKind="engineering" kinds={["opensees-static"]} preparedInputLabel="Queuing captures the structural frame JSON and selected combination shown on this page, even when another browser module is selected. Edit supports, loads and section properties before submission." prepareInput={() => {
      const model = parseFrameModel(parseInput(inputs.frame)), selectedCombination = combinationId.trim() || undefined;
      const bytes = createNativeFrameInput(model, selectedCombination), buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      return { name: "frame-native-input.json", blob: new Blob([buffer], { type: "application/json" }) };
    }} />
    <Card className="space-y-3 p-4">
      <Select label="Module" value={module} onChange={event => { importGeneration.current++; setModule(event.target.value as Module); setError(null); }}>{modules.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
      <p className="text-sm text-slate-300">{description.description}</p>
      <p className="text-xs text-slate-400">Results use supplied geometry, demands, capacities and criteria. Examples are editable datasets with unverified results. Each report states its mathematical scope and missing design checks.</p>
    </Card>
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>Import JSON</Button>
          <Button variant="secondary" size="sm" onClick={() => download(`engineering-${module}-input.json`, inputs[module], "application/json")}>Export input</Button>
          <Button variant="ghost" size="sm" onClick={() => { updateText(JSON.stringify(examples[module], null, 2)); }}>Reset example</Button>
        </div>
        <input ref={fileInput} className="hidden" type="file" accept=".json,application/json" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          const attempt = ++importGeneration.current;
          if (file.size > maxInputCharacters) { setError("JSON file exceeds 1 MB."); return; }
          const targetModule = module;
          try {
            const text = await file.text(); if (attempt !== importGeneration.current) return; parseInput(text);
            setInputs(current => ({ ...current, [targetModule]: text })); setError(null);
          } catch (cause) { if (attempt === importGeneration.current) setError(cause instanceof Error ? cause.message : "Could not import JSON."); }
        }} />
        {(module === "frame" || module === "water" || module === "air") && <details className="space-y-3 rounded-xl border border-slate-700 p-3">
          <summary className="cursor-pointer text-sm font-medium text-amber-300">Convert existing project geometry</summary>
          {module === "frame" ? <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Frame plane" value={frameBridge.plane} onChange={event => setFrameBridge(current => ({ ...current, plane: event.target.value as "xy" | "zy" }))}><option value="xy">XY at constant Z</option><option value="zy">ZY at constant X</option></Select>
            <Input type="number" step="any" label="Slice coordinate (m)" value={frameBridge.sliceCoordinateM} onChange={event => setFrameBridge(current => ({ ...current, sliceCoordinateM: Number(event.target.value) }))} />
            <Input type="number" step="any" label="Slice tolerance (m)" value={frameBridge.sliceToleranceM} onChange={event => setFrameBridge(current => ({ ...current, sliceToleranceM: Number(event.target.value) }))} />
            <Input type="number" step="any" label="Member area override (m²)" value={frameBridge.areaM2} onChange={event => setFrameBridge(current => ({ ...current, areaM2: Number(event.target.value) }))} />
            <Input type="number" step="any" label="Member inertia override (m⁴)" value={frameBridge.inertiaM4} onChange={event => setFrameBridge(current => ({ ...current, inertiaM4: Number(event.target.value) }))} />
            <Input type="number" step="any" label="Elastic modulus override (Pa)" value={frameBridge.elasticModulusPa} onChange={event => setFrameBridge(current => ({ ...current, elasticModulusPa: Number(event.target.value) }))} />
            <label className="flex gap-2 text-xs text-slate-300 sm:col-span-2"><input type="checkbox" checked={frameBridge.acceptAssumedFixedSupports} onChange={event => setFrameBridge(current => ({ ...current, acceptAssumedFixedSupports: event.target.checked }))} />Import the source exchange's assumed fixed supports for further review</label>
          </div> : <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Source route element id (blank uses first route)" value={mepBridge.sourceElementId} maxLength={100} onChange={event => setMepBridge(current => ({ ...current, sourceElementId: event.target.value }))} />
            <Input type="number" step="any" label="Vertex merge tolerance (m)" value={mepBridge.endpointToleranceM} onChange={event => setMepBridge(current => ({ ...current, endpointToleranceM: Number(event.target.value) }))} />
            <Input type="number" step="any" label={module === "water" ? "Source total head (m)" : "Source static pressure (Pa)"} value={module === "water" ? mepBridge.waterSourceHeadM : mepBridge.airSourcePressurePa} onChange={event => setMepBridge(current => ({ ...current, [module === "water" ? "waterSourceHeadM" : "airSourcePressurePa"]: Number(event.target.value) }))} />
            <Input type="number" step="any" label="Demand at each other route end (m³/s)" value={module === "water" ? mepBridge.waterTerminalDemandM3s : mepBridge.airTerminalDemandM3s} onChange={event => setMepBridge(current => ({ ...current, [module === "water" ? "waterTerminalDemandM3s" : "airTerminalDemandM3s"]: Number(event.target.value) }))} />
            <Input type="number" step="any" label="Roughness per segment (m)" value={mepBridge.roughnessM} onChange={event => setMepBridge(current => ({ ...current, roughnessM: Number(event.target.value) }))} />
            <Input type="number" step="any" label="Minor-loss K per segment" value={mepBridge.minorLossKPerSegment} onChange={event => setMepBridge(current => ({ ...current, minorLossKPerSegment: Number(event.target.value) }))} />
          </div>}
          <p className="text-xs text-slate-400">{module === "frame" ? "Import Community Editor → Structural → Solver model JSON. The selected plane receives your section overrides and an empty load case; assign actual supports and loads." : "Import exported design JSON containing one routed pipe/duct system. Review source, terminal demands and every converted connection before calculation."}</p>
          <Button variant="secondary" size="sm" onClick={() => modelFileInput.current?.click()}>Import {module === "frame" ? "structural exchange" : "MEP design"}</Button>
        </details>}
        <input ref={modelFileInput} className="hidden" type="file" accept=".json,application/json" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          const attempt = ++importGeneration.current;
          if (file.size > maxInputCharacters) { setError("Project JSON exceeds 1 MB; export a smaller subsystem."); return; }
          const targetModule = module, frameOptions = { ...frameBridge }, mepOptions = { ...mepBridge };
          try {
            const source = await file.text(); if (attempt !== importGeneration.current) return;
            const value = parseInput(source);
            const converted = convertGeometry(value, targetModule, frameOptions, mepOptions), text = JSON.stringify(converted.model, null, 2);
            if (text.length > maxInputCharacters) throw new Error("Converted geometry exceeds the 1 MB input limit.");
            setInputs(current => ({ ...current, [targetModule]: text })); setConversionWarnings({ module: targetModule, warnings: converted.warnings }); setError(null);
          } catch (cause) { if (attempt === importGeneration.current) setError(cause instanceof Error ? cause.message : "Could not convert project geometry."); }
        }} />
        {conversionWarnings?.module === module && <ul className="list-disc space-y-1 pl-5 text-xs text-amber-200">{conversionWarnings.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
        <label className="block text-sm font-medium text-slate-300" htmlFor="engineering-source">SI input JSON</label>
        <textarea id="engineering-source" spellCheck={false} maxLength={maxInputCharacters} value={inputs[module]} onChange={event => updateText(event.target.value)} className="h-[32rem] w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-amber-300" />
        <Button onClick={run}>Calculate {description.label.toLowerCase()}</Button>
        {module === "frame" && <div className="space-y-3 border-t border-slate-800 pt-4">
          <Input label="Combination id for native export (blank selects the first)" value={combinationId} maxLength={100} onChange={event => setCombinationId(event.target.value)} />
          <div className="flex flex-wrap gap-2"><Button loading={exporting} variant="secondary" size="sm" onClick={() => { void exportDeck("opensees"); }}>OpenSees bundle</Button><Button disabled={exporting} variant="secondary" size="sm" onClick={() => { void exportDeck("staad"); }}>STAAD linear bundle</Button></div>
        </div>}
        {(module === "water" || module === "fire") && <Button loading={exporting} variant="secondary" size="sm" onClick={() => { void exportDeck("epanet"); }}>EPANET input bundle</Button>}
        <p className="text-xs text-slate-500">Native export writes a deck, original input, tag mapping and limitations. OpenSees can also be queued in Native project jobs when the server worker is configured. STAAD and EPANET bundles require an external native run.</p>
      </Card>
      <Card className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Analysis report</h2><Button variant="secondary" size="sm" disabled={!activeResult} onClick={() => { if (activeResult) download(`engineering-${module}-report.json`, JSON.stringify({ module, sourceInput: parseInput(activeResult.source), report: activeResult.data }, null, 2), "application/json"); }}>Export report</Button></div>
        {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
        {activeResult ? <pre className="max-h-[42rem] overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-relaxed text-slate-200">{JSON.stringify(activeResult.data, null, 2)}</pre> : <p className="text-sm text-slate-400">Calculate the current dataset to create a report. Editing the input hides the previous report until recalculated.</p>}
      </Card>
    </div>
  </main>;
}
