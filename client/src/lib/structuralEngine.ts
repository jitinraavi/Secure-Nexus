import type { CommunityDesign, DraftElement, StructuralLoadCombination } from "../types";
import { structuralSettings } from "./structural";

export type StructuralNodeKind = "grid-intersection" | "column-base" | "column-top";
export type StructuralMemberKind = "column" | "beam" | "brace" | "wall" | "slab";

export interface StructuralNode {
  id: string;
  x: number;
  y: number;
  z: number;
  kind: StructuralNodeKind;
}

export interface StructuralMember {
  id: string;
  kind: StructuralMemberKind;
  startNodeId: string;
  endNodeId?: string;
  levelId?: string;
  widthM: number;
  depthM: number;
  lengthM: number;
  sourceId?: string;
}

export interface StructuralFrameModel {
  nodes: StructuralNode[];
  members: StructuralMember[];
  levels: { id: string; elevationM: number; heightM: number }[];
  warnings: string[];
}

export interface MemberDesignScreen {
  memberId: string;
  kind: StructuralMemberKind;
  demandKN: number;
  capacityKN: number;
  utilization: number;
  status: "pass" | "review";
  reinforcementRatio?: number;
}

export interface FoundationDesignScreen {
  columnId: string;
  demandKN: number;
  requiredAreaM2: number;
  providedAreaM2: number;
  bearingUtilization: number;
  suggestedWidthM: number;
  status: "pass" | "review";
}

export interface StructuralDesignPackage {
  frame: StructuralFrameModel;
  combinations: StructuralLoadCombination[];
  members: MemberDesignScreen[];
  foundations: FoundationDesignScreen[];
  governingUtilization: number;
  warnings: string[];
  verification: {
    externalSolverRequired: true;
    supportedTargets: string[];
    status: "not-verified";
  };
}

function draftHeight(draft: DraftElement, fallback = 3): number {
  return Math.max(draft.h ?? fallback, 0.05);
}

export function buildStructuralFrameModel(design: CommunityDesign): StructuralFrameModel {
  const levels = (design.levels?.length ? design.levels : [{ id: "ground", name: "Ground", elevation: 0, floorHeight: 3.2 }])
    .map((level) => ({ id: level.id, elevationM: level.elevation, heightM: level.floorHeight }));
  const nodes: StructuralNode[] = [];
  const members: StructuralMember[] = [];
  const warnings: string[] = [];
  const nodeIndex = new Map<string, StructuralNode>();
  const addNode = (node: StructuralNode) => {
    const key = `${node.x.toFixed(4)}|${node.y.toFixed(4)}|${node.z.toFixed(4)}`;
    const existing = nodeIndex.get(key);
    if (existing) return existing;
    nodeIndex.set(key, node);
    nodes.push(node);
    return node;
  };

  const gridsX = design.structuralGrid?.filter((line) => line.axis === "x") ?? [];
  const gridsZ = design.structuralGrid?.filter((line) => line.axis === "z") ?? [];
  for (const level of levels) for (const gx of gridsX) for (const gz of gridsZ) {
    addNode({ id: `grid_${level.id}_${gx.id}_${gz.id}`, x: gx.position, y: level.elevationM, z: gz.position, kind: "grid-intersection" });
  }

  const settings = structuralSettings(design.structural);
  for (const draft of design.drafts ?? []) {
    if (!["column", "wall", "slab"].includes(draft.kind)) continue;
    const level = levels.find((item) => item.id === draft.family?.levelId) ?? levels[0];
    if (draft.kind === "column") {
      const base = addNode({ id: `${draft.id}_base`, x: draft.x, y: level.elevationM + (draft.elevationM ?? 0), z: draft.z, kind: "column-base" });
      const height = draftHeight(draft, level.heightM);
      const top = addNode({ id: `${draft.id}_top`, x: draft.x, y: base.y + height, z: draft.z, kind: "column-top" });
      members.push({ id: draft.id, kind: "column", startNodeId: base.id, endNodeId: top.id, levelId: level.id, widthM: Math.max(draft.w, 0.1), depthM: Math.max(draft.d, 0.1), lengthM: height, sourceId: draft.id });
    } else {
      const start = addNode({ id: `${draft.id}_start`, x: draft.x - draft.w / 2, y: level.elevationM + (draft.elevationM ?? 0), z: draft.z, kind: "grid-intersection" });
      const end = addNode({ id: `${draft.id}_end`, x: draft.x + draft.w / 2, y: start.y, z: draft.z, kind: "grid-intersection" });
      members.push({ id: draft.id, kind: draft.kind === "wall" ? "wall" : "slab", startNodeId: start.id, endNodeId: end.id, levelId: level.id, widthM: Math.max(draft.w, 0.1), depthM: Math.max(draft.d, 0.1), lengthM: Math.max(draft.w, 0.1), sourceId: draft.id });
    }
  }

  if (!members.some((item) => item.kind === "column") && gridsX.length && gridsZ.length) {
    for (const level of levels.slice(0, -1)) {
      for (const gx of gridsX) for (const gz of gridsZ) {
        const base = addNode({ id: `auto_${level.id}_${gx.id}_${gz.id}_base`, x: gx.position, y: level.elevationM, z: gz.position, kind: "column-base" });
        const top = addNode({ id: `auto_${level.id}_${gx.id}_${gz.id}_top`, x: gx.position, y: level.elevationM + level.heightM, z: gz.position, kind: "column-top" });
        members.push({ id: `auto-col-${level.id}-${gx.id}-${gz.id}`, kind: "column", startNodeId: base.id, endNodeId: top.id, levelId: level.id, widthM: settings.columnWidthM, depthM: settings.columnDepthM, lengthM: level.heightM });
      }
    }
    warnings.push("Columns were inferred from structural-grid intersections because no explicit drafted columns were found.");
  }
  if (!members.length) warnings.push("No structural framing geometry is available. Add grid lines or drafted structural elements.");
  return { nodes, members, levels, warnings };
}

export function screenStructuralDesign(design: CommunityDesign): StructuralDesignPackage {
  const settings = structuralSettings(design.structural);
  const frame = buildStructuralFrameModel(design);
  const combinations = settings.loadCombinations ?? [];
  const towerFloorArea = design.towers.reduce((sum, tower) => sum + tower.unitWidth * tower.unitDepth * Math.max(tower.unitsPerFloor, 1) * Math.max(tower.floors, 1), 0);
  const dead = towerFloorArea * settings.deadLoadKPa;
  const live = towerFloorArea * settings.liveLoadKPa;
  const governing = Math.max(dead + live, ...combinations.map((combo) => combo.deadFactor * dead + combo.liveFactor * live));
  const columns = frame.members.filter((member) => member.kind === "column");
  const columnDemand = governing / Math.max(columns.length, 1);

  const members = frame.members.map((member): MemberDesignScreen => {
    const area = Math.max(member.widthM * member.depthM, 0.001);
    const lengthFactor = Math.max(member.lengthM / 3, 1);
    const demandKN = member.kind === "column" ? columnDemand : (settings.deadLoadKPa + settings.liveLoadKPa) * Math.max(member.lengthM, 0.5) * Math.max(member.widthM, 0.5);
    const materialStrength = settings.material === "steel" ? 250 : settings.material === "masonry" ? 8 : settings.concreteStrengthMPa;
    const capacityKN = member.kind === "column"
      ? materialStrength * area * 1000 / settings.safetyFactor / lengthFactor
      : materialStrength * Math.max(member.widthM, 0.1) * Math.max(member.depthM, 0.1) ** 2 * 1000 / Math.max(6 * settings.safetyFactor, 1);
    const utilization = demandKN / Math.max(capacityKN, 0.001);
    const reinforcementRatio = settings.material === "reinforced-concrete" ? Math.min(Math.max(0.008 + Math.max(utilization - 0.5, 0) * 0.012, 0.008), 0.04) : undefined;
    return { memberId: member.id, kind: member.kind, demandKN, capacityKN, utilization, reinforcementRatio, status: utilization <= 1 ? "pass" : "review" };
  });

  const foundations = columns.map((column): FoundationDesignScreen => {
    const requiredAreaM2 = columnDemand / Math.max(settings.soilBearingKPa, 1);
    const providedAreaM2 = settings.footingWidthM * settings.footingDepthM;
    const bearingUtilization = requiredAreaM2 / Math.max(providedAreaM2, 0.001);
    return {
      columnId: column.id,
      demandKN: columnDemand,
      requiredAreaM2,
      providedAreaM2,
      bearingUtilization,
      suggestedWidthM: Math.sqrt(requiredAreaM2),
      status: bearingUtilization <= 1 ? "pass" : "review",
    };
  });

  const governingUtilization = Math.max(0, ...members.map((item) => item.utilization), ...foundations.map((item) => item.bearingUtilization));
  return {
    frame,
    combinations,
    members,
    foundations,
    governingUtilization,
    warnings: [
      ...frame.warnings,
      "Member and foundation results are deterministic screening calculations, not code design.",
      "P-delta, response-spectrum, nonlinear behavior, reinforcement detailing and connections require verification in a qualified structural solver.",
    ],
    verification: { externalSolverRequired: true, supportedTargets: ["OpenSees", "ETABS", "STAAD", "Robot"], status: "not-verified" },
  };
}

export function buildStructuralSolverExchange(design: CommunityDesign): string {
  const pkg = screenStructuralDesign(design);
  return JSON.stringify({
    format: "groundwork-structural-analysis-model",
    version: 1,
    units: "SI",
    nodes: pkg.frame.nodes,
    members: pkg.frame.members,
    loadCombinations: pkg.combinations,
    assumptions: structuralSettings(design.structural),
    verification: pkg.verification,
  }, null, 2);
}
