import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Input, Select } from "../components/ui";
import { download, downloadBlob, zipFiles } from "../lib/download";
import { engineeringRecord } from "../lib/engineeringNumerics";
import { analyzeFrame2D, parseFrameModel } from "../lib/frameAnalysis";
import { analyzeElectricalCircuit, assessFireFlow, parseFluidNetwork, selectEquipment, solveFluidNetwork, type ElectricalCircuitInput, type EquipmentCandidate, type FireFlowCriteria } from "../lib/engineeringNetworks";
import { exportEpanetNetwork, exportOpenSees2D, exportStaadPlane, type SolverDeck } from "../lib/solverAdapters";
import { importRoutedMepNetwork, importStructuralExchange2D, type FrameBridgeOptions } from "../lib/engineeringModelBridge";

type Module = "frame" | "water" | "air" | "electrical" | "fire" | "equipment";
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

export default function EngineeringWorkbench() {
  const [module, setModule] = useState<Module>("frame"), [inputs, setInputs] = useState(initialInputs), [combinationId, setCombinationId] = useState("");
  const [result, setResult] = useState<{ module: Module; source: string; data: unknown } | null>(null), [error, setError] = useState<string | null>(null), [exporting, setExporting] = useState(false);
  const [frameBridge, setFrameBridge] = useState<FrameBridgeOptions>({ plane: "xy", sliceCoordinateM: 0, sliceToleranceM: 0.001, areaM2: 0.02, inertiaM4: 0.00008, elasticModulusPa: 200e9, acceptAssumedFixedSupports: false });
  const [mepBridge, setMepBridge] = useState({ endpointToleranceM: 0.001, sourceElementId: "", waterSourceHeadM: 45, airSourcePressurePa: 500, waterTerminalDemandM3s: 0.002, airTerminalDemandM3s: 0.2, roughnessM: 0.0001, minorLossKPerSegment: 0 });
  const [conversionWarnings, setConversionWarnings] = useState<{ module: Module; warnings: string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null), modelFileInput = useRef<HTMLInputElement>(null), description = modules.find(item => item.id === module)!;
  const activeResult = result?.module === module && result.source === inputs[module] ? result : null;
  const updateText = (text: string) => { setInputs(current => ({ ...current, [module]: text })); setError(null); };
  const run = () => {
    setError(null); setResult(null);
    try { setResult({ module, source: inputs[module], data: calculate(module, parseInput(inputs[module])) }); }
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
    <Card className="space-y-3 p-4">
      <Select label="Module" value={module} onChange={event => { setModule(event.target.value as Module); setError(null); }}>{modules.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
      <p className="text-sm text-slate-300">{description.description}</p>
      <p className="text-xs text-slate-400">Results use supplied geometry, demands, capacities and criteria. Examples are editable datasets with unverified results. Each report states its mathematical scope and missing design checks.</p>
    </Card>
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>Import JSON</Button>
          <Button variant="secondary" size="sm" onClick={() => download(`engineering-${module}-input.json`, inputs[module], "application/json")}>Export input</Button>
          <Button variant="ghost" size="sm" onClick={() => { updateText(JSON.stringify(examples[module], null, 2)); setResult(null); }}>Reset example</Button>
        </div>
        <input ref={fileInput} className="hidden" type="file" accept=".json,application/json" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          if (file.size > maxInputCharacters) { setError("JSON file exceeds 1 MB."); return; }
          const targetModule = module;
          try {
            const text = await file.text(); parseInput(text);
            setInputs(current => ({ ...current, [targetModule]: text })); setResult(null); setError(null);
          } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import JSON."); }
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
            <Input label="Source route element id (blank uses first route)" value={mepBridge.sourceElementId} onChange={event => setMepBridge(current => ({ ...current, sourceElementId: event.target.value }))} />
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
          if (file.size > maxInputCharacters) { setError("Project JSON exceeds 1 MB; export a smaller subsystem."); return; }
          const targetModule = module, frameOptions = { ...frameBridge }, mepOptions = { ...mepBridge };
          try {
            const value = parseInput(await file.text());
            if (targetModule !== "frame" && targetModule !== "water" && targetModule !== "air") throw new Error("Choose frame, water or airflow before importing geometry.");
            const converted = targetModule === "frame" ? importStructuralExchange2D(value, frameOptions) : importRoutedMepNetwork(value, { medium: targetModule === "water" ? "water" : "air", endpointToleranceM: mepOptions.endpointToleranceM, sourceElementId: mepOptions.sourceElementId.trim() || undefined, sourcePotential: targetModule === "water" ? mepOptions.waterSourceHeadM : mepOptions.airSourcePressurePa, terminalDemandM3s: targetModule === "water" ? mepOptions.waterTerminalDemandM3s : mepOptions.airTerminalDemandM3s, roughnessM: mepOptions.roughnessM, minorLossKPerSegment: mepOptions.minorLossKPerSegment });
            setInputs(current => ({ ...current, [targetModule]: JSON.stringify(converted.model, null, 2) })); setConversionWarnings({ module: targetModule, warnings: converted.warnings }); setResult(null); setError(null);
          } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not convert project geometry."); }
        }} />
        {conversionWarnings?.module === module && <ul className="list-disc space-y-1 pl-5 text-xs text-amber-200">{conversionWarnings.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
        <label className="block text-sm font-medium text-slate-300" htmlFor="engineering-source">SI input JSON</label>
        <textarea id="engineering-source" spellCheck={false} maxLength={maxInputCharacters} value={inputs[module]} onChange={event => updateText(event.target.value)} className="h-[32rem] w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-amber-300" />
        <Button onClick={run}>Calculate {description.label.toLowerCase()}</Button>
        {module === "frame" && <div className="space-y-3 border-t border-slate-800 pt-4">
          <Input label="Combination id for native export (blank selects the first)" value={combinationId} onChange={event => setCombinationId(event.target.value)} />
          <div className="flex flex-wrap gap-2"><Button loading={exporting} variant="secondary" size="sm" onClick={() => { void exportDeck("opensees"); }}>OpenSees bundle</Button><Button disabled={exporting} variant="secondary" size="sm" onClick={() => { void exportDeck("staad"); }}>STAAD linear bundle</Button></div>
        </div>}
        {(module === "water" || module === "fire") && <Button loading={exporting} variant="secondary" size="sm" onClick={() => { void exportDeck("epanet"); }}>EPANET input bundle</Button>}
        <p className="text-xs text-slate-500">Native export writes a deck, original input, tag mapping and limitations. Native executables are run separately by the engineer.</p>
      </Card>
      <Card className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Analysis report</h2><Button variant="secondary" size="sm" disabled={!activeResult} onClick={() => { if (activeResult) download(`engineering-${module}-report.json`, JSON.stringify({ module, sourceInput: parseInput(activeResult.source), report: activeResult.data }, null, 2), "application/json"); }}>Export report</Button></div>
        {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
        {activeResult ? <pre className="max-h-[42rem] overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-relaxed text-slate-200">{JSON.stringify(activeResult.data, null, 2)}</pre> : <p className="text-sm text-slate-400">Calculate the current dataset to create a report. Editing the input hides the previous report until recalculated.</p>}
      </Card>
    </div>
  </main>;
}
