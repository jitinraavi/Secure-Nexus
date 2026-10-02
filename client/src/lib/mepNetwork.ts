import type { MepDesign, MepElement, MepSystemType } from "../types";

export interface MepNetworkNode {
  id: string;
  elementId: string;
  name: string;
  system: MepSystemType;
  degree: number;
  isSource: boolean;
  isTerminal: boolean;
}

export interface MepNetworkEdge {
  from: string;
  to: string;
  system: MepSystemType;
}

export interface MepNetworkReport {
  nodes: MepNetworkNode[];
  edges: MepNetworkEdge[];
  components: string[][];
  orphanIds: string[];
  cycles: string[][];
  systemContinuity: Record<string, { elements: number; components: number; connected: boolean }>;
  flow: { elementId: string; designFlow: number; capacity: number; utilization: number; unit: string }[];
  electrical: { connectedKw: number; demandKw: number; currentA: number; voltageDropPct: number; faultScreenKA: number };
  fire: { pipeCount: number; terminalCount: number; connected: boolean; warnings: string[] };
  warnings: string[];
}

const routeLength = (element: MepElement) => element.route.reduce((sum, point, index) => index ? sum + Math.hypot(point.x - element.route[index - 1].x, point.y - element.route[index - 1].y, point.z - element.route[index - 1].z) : 0, 0);

function defaultSystem(element: MepElement): MepSystemType {
  if (element.system) return element.system;
  if (element.kind === "duct") return "hvac-supply";
  if (element.kind === "pipe") return "plumbing-supply";
  if (element.kind === "cable-tray" || element.kind === "equipment") return "electrical-power";
  return "controls";
}

export function analyzeMepNetwork(design: MepDesign | undefined): MepNetworkReport {
  const elements = (design?.elements ?? []).filter((item) => item.visible);
  const byId = new Map(elements.map((item) => [item.id, item]));
  const adjacency = new Map<string, Set<string>>();
  for (const element of elements) adjacency.set(element.id, new Set());
  const edges: MepNetworkEdge[] = [];

  for (const element of elements) {
    for (const targetId of element.connectedTo ?? []) {
      const target = byId.get(targetId);
      if (!target) continue;
      adjacency.get(element.id)?.add(targetId);
      adjacency.get(targetId)?.add(element.id);
      edges.push({ from: element.id, to: targetId, system: defaultSystem(element) });
    }
  }

  const components: string[][] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    if (seen.has(element.id)) continue;
    const queue = [element.id];
    const component: string[] = [];
    seen.add(element.id);
    while (queue.length) {
      const id = queue.shift()!;
      component.push(id);
      for (const next of adjacency.get(id) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    components.push(component);
  }

  const cycles: string[][] = [];
  const cycleSeen = new Set<string>();
  const walk = (id: string, parent: string | null, path: string[]) => {
    cycleSeen.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (next === parent) continue;
      if (path.includes(next)) {
        const start = path.indexOf(next);
        const cycle = [...path.slice(start), next];
        if (cycle.length > 3) cycles.push(cycle);
      } else if (!cycleSeen.has(next)) walk(next, id, [...path, next]);
    }
  };
  for (const element of elements) if (!cycleSeen.has(element.id)) walk(element.id, null, [element.id]);

  const systems = new Map<string, MepElement[]>();
  for (const element of elements) {
    const system = defaultSystem(element);
    const list = systems.get(system) ?? [];
    list.push(element);
    systems.set(system, list);
  }
  const systemContinuity: MepNetworkReport["systemContinuity"] = {};
  for (const [system, list] of systems) {
    const ids = new Set(list.map((item) => item.id));
    const componentCount = components.filter((component) => component.some((id) => ids.has(id))).length;
    systemContinuity[system] = { elements: list.length, components: componentCount, connected: list.length <= 1 || componentCount === 1 };
  }

  const p = design?.planning;
  const flow = elements.filter((element) => element.kind === "duct" || element.kind === "pipe").map((element) => {
    const system = defaultSystem(element);
    if (element.kind === "duct") {
      const velocity = Math.max(p?.designAirVelocityMps ?? 4, 0);
      const capacity = Math.max(element.width * element.height * velocity * 3600, 0);
      const totalTarget = Math.max((p?.areaM2 ?? 0) * (p?.ceilingHeightM ?? 0) * (p?.airChangesPerHour ?? 0), 0);
      const count = Math.max(elements.filter((item) => item.kind === "duct" && defaultSystem(item) === system).length, 1);
      const designFlow = totalTarget / count;
      return { elementId: element.id, designFlow, capacity, utilization: designFlow / Math.max(capacity, 0.001), unit: "m3/h" };
    }
    const velocity = Math.max(p?.pipeVelocityMps ?? 1.5, 0);
    const capacity = Math.PI * Math.max(element.diameter, 0) ** 2 / 4 * velocity * 1000;
    const count = Math.max(elements.filter((item) => item.kind === "pipe" && defaultSystem(item) === system).length, 1);
    const designFlow = Math.max(p?.plumbingFlowLps ?? 0, 0) / count;
    return { elementId: element.id, designFlow, capacity, utilization: designFlow / Math.max(capacity, 0.001), unit: "L/s" };
  });

  const electricalElements = elements.filter((item) => defaultSystem(item) === "electrical-power");
  const connectedKw = electricalElements.reduce((sum, item) => sum + (item.ratedPowerKw ?? 0), 0);
  const demandKw = connectedKw * Math.min(Math.max(p?.electricalDemandFactor ?? 0.8, 0), 1);
  const voltage = Math.max(p?.designVoltageV ?? 230, 1);
  const currentA = demandKw * 1000 / voltage;
  const maxRoute = Math.max(0, ...electricalElements.map(routeLength));
  const conductorResistanceOhmPerKm = 7.41; // conservative 2.5 mm2 copper planning reference.
  const voltageDropPct = currentA * conductorResistanceOhmPerKm * (maxRoute / 1000) * 2 / voltage * 100;
  const faultScreenKA = voltage / Math.max((conductorResistanceOhmPerKm / 1000) * Math.max(maxRoute, 1), 0.01) / 1000;

  const fire = elements.filter((item) => defaultSystem(item) === "fire-protection");
  const fireTerminals = fire.filter((item) => item.kind === "fixture");
  const firePipes = fire.filter((item) => item.kind === "pipe");
  const fireConnected = fire.length === 0 || (firePipes.length > 0 && fire.every((item) => (adjacency.get(item.id)?.size ?? 0) > 0 || item.kind === "equipment"));
  const fireWarnings = [
    ...(fire.length && !firePipes.length ? ["Fire-protection system contains no pipe network."] : []),
    ...(fire.length && !fireTerminals.length ? ["Fire-protection system contains no terminal/sprinkler fixtures."] : []),
    ...(fire.length && !fireConnected ? ["Fire-protection graph contains disconnected elements."] : []),
  ];

  const orphanIds = elements.filter((item) => elements.length > 1 && (adjacency.get(item.id)?.size ?? 0) === 0).map((item) => item.id);
  const warnings = [
    ...Object.entries(systemContinuity).filter(([, report]) => !report.connected).map(([system, report]) => `${system} is split across ${report.components} disconnected components.`),
    ...flow.filter((item) => item.utilization > 1).map((item) => `${byId.get(item.elementId)?.name ?? item.elementId} design flow exceeds the modeled route capacity.`),
    ...(voltageDropPct > 5 ? [`Electrical voltage-drop screen is ${voltageDropPct.toFixed(1)}%; conductor sizing requires review.`] : []),
    ...fireWarnings,
  ];
  const nodes = elements.map((element): MepNetworkNode => ({
    id: element.id,
    elementId: element.id,
    name: element.name,
    system: defaultSystem(element),
    degree: adjacency.get(element.id)?.size ?? 0,
    isSource: element.kind === "equipment",
    isTerminal: element.kind === "fixture" || (adjacency.get(element.id)?.size ?? 0) <= 1,
  }));
  return {
    nodes, edges, components, orphanIds, cycles, systemContinuity, flow,
    electrical: { connectedKw, demandKw, currentA, voltageDropPct, faultScreenKA },
    fire: { pipeCount: firePipes.length, terminalCount: fireTerminals.length, connected: fireConnected, warnings: fireWarnings },
    warnings,
  };
}

export function autoConnectMepSystem(design: MepDesign, system: MepSystemType): MepDesign {
  const matching = design.elements.filter((element) => defaultSystem(element) === system);
  if (matching.length < 2) return design;
  const elements = design.elements.map((element) => {
    const index = matching.findIndex((candidate) => candidate.id === element.id);
    if (index < 0) return element;
    const connectedTo = new Set(element.connectedTo ?? []);
    if (index > 0) connectedTo.add(matching[index - 1].id);
    if (index < matching.length - 1) connectedTo.add(matching[index + 1].id);
    return { ...element, connectedTo: [...connectedTo] };
  });
  return { ...design, elements };
}
