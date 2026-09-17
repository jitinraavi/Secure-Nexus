import * as THREE from "three";
import type { BimElementData, Design, ProjectType } from "../types";
import { buildCtx, type BuildCtx, type ElementDef, type ParamDef, defaultElement, uid } from "./modelcore";
import {
  BIM_ELEMENTS,
  BIM_GLOBALS,
  bimDefs,
  buildBimScene,
  buildBimDxf,
  bimSchedule,
  bimSummary,
} from "./bim";
import {
  STEEL_ELEMENTS,
  STEEL_GLOBALS,
  steelDefs,
  buildSteelScene,
  steelDxf,
  memberList,
  steelSummary,
} from "./steel";
import { CIVIL_GLOBALS, buildCivilScene, civilDxf, civilReport, civilSummary } from "./civil";
import {
  COORD_GLOBALS,
  buildCoordinationScene,
  clashReport,
  coordinationDxf,
  coordinationSummary,
} from "./coordination";

export interface StudioModule {
  palette: ElementDef[];
  globals: ParamDef[];
  defs: Map<string, ElementDef>;
  buildScene: (design: Design, ctx: BuildCtx) => THREE.Group;
  dxf: (design: Design) => string;
  csv: (design: Design) => string;
  csvLabel: string;
  summary: (design: Design) => string;
}

export const STUDIO_TYPES: ProjectType[] = ["bim", "steel", "civil", "coordination"];

export function isStudioType(t: ProjectType | string | undefined | null): t is ProjectType {
  return typeof t === "string" && (STUDIO_TYPES as string[]).includes(t);
}

/* Legacy infrastructure project types are now served by the parametric models:
   site/earthwork types → Civil Suite, complex multi-system types → Coordination. */
export const LEGACY_INFRA_TO_MODEL: Record<string, ProjectType> = {
  highway: "civil",
  roadways: "civil",
  dams: "civil",
  spillways: "civil",
  airport: "coordination",
  ports: "coordination",
};

export function resolveModelType(t: ProjectType | string | undefined | null): ProjectType {
  if (!t) return "house";
  return LEGACY_INFRA_TO_MODEL[t] ?? (t as ProjectType);
}

export const HELPER_LABELS: Record<string, string> = {
  bim: "Parametric building • place columns, beams, slabs, walls, openings; levels & grids drive the model",
  steel: "Steel frame • stanchions, rafters, eave beams, braces and trusses with automatic member lists",
  civil: "Survey → grade • deterministic terrain, alignment, profile and cut/fill corridor",
  coordination: "Merge models → clash • bring other projects into one scene, run 4D and clash detection",
};

export function starterElements(projectType: ProjectType, settings?: Record<string, number>): BimElementData[] {
  const s = settings ?? {};
  if (projectType === "bim") {
    const span = 6;
    const fh = s.floorHeight ?? 3;
    const out: BimElementData[] = [];
    for (let i = 0; i < 4; i++) {
      const x = i % 2 === 0 ? -2 : 2;
      const z = i < 2 ? -2 : 2;
      out.push({
        id: uid("column"),
        kind: "column",
        code: `C-${i + 1}`,
        params: { ax: x, az: z, ay: 0, rotY: 0, b: 0.45, d: 0.45, h: fh * 2 },
      });
    }
    out.push({ id: uid("slab"), kind: "slab", code: "S-1", params: { ax: 0, az: 0, ay: 0, rotY: 0, spanX: span, spanZ: span, t: 0.15 } });
    out.push({ id: uid("beam"), kind: "beam", code: "B-1", params: { ax: 0, az: -2.85, ay: fh - 0.3, rotY: 0, span, bw: 0.3, bd: 0.6 } });
    out.push({ id: uid("wall"), kind: "wall", code: "W-1", params: { ax: -2.55, az: 0, ay: 0, rotY: 0, len: 5.1, h: fh, t: 0.2 } });
    out.push({ id: uid("door"), kind: "door", code: "D-1", params: { ax: 0, az: -2.7, ay: 0, rotY: 0, w: 1, h: 2.1, leaf: 0.06 } });
    out.push({ id: uid("window"), kind: "window", code: "WI-1", params: { ax: 2.2, az: 0, ay: 0, rotY: 0, w: 1.8, h: 1.5, sill: 0.9 } });
    return out;
  }
  if (projectType === "steel") {
    const bays = s.baysX ?? 4;
    const span = s.baySpan ?? 6;
    const frames = s.frames ?? 3;
    const eave = s.eaveHeight ?? 7;
    const width = bays * span;
    const out: BimElementData[] = [];
    let ci = 1;
    for (let f = 0; f < frames; f++) {
      for (let b = 0; b <= bays; b++) {
        const x = -width / 2 + b * span;
        const z = (f - (frames - 1) / 2) * 5;
        out.push({ id: uid("stanchion"), kind: "stanchion", code: `C-${ci++}`, params: { ax: x, az: z, ay: 0, rotY: 0, secH: 0.45, flg: 0.28, len: eave } });
      }
    }
    let bi = 1;
    for (let f = 0; f < frames; f++) {
      const z = (f - (frames - 1) / 2) * 5;
      for (let b = 0; b < bays; b++) {
        const x = -width / 2 + b * span + span / 2;
        out.push({ id: uid("eavebeam"), kind: "eavebeam", code: `B-${bi++}`, params: { ax: x, az: z + 1, ay: eave - 0.55, rotY: Math.PI / 2, span, bd: 0.5, bw: 0.25 } });
      }
    }
    out.push({ id: uid("truss"), kind: "truss", code: "T-1", params: { ax: 0, az: 1.2, ay: eave - 0.55, rotY: 0, span: width, depth: 1.4, npanels: 10, section: 80 } });
    return out;
  }
  return [];
}

export const studioModule: (t: ProjectType) => StudioModule | undefined = (t) => {
  if (t === "bim") {
    return {
      palette: BIM_ELEMENTS,
      globals: [...BIM_GLOBALS],
      defs: bimDefs,
      buildScene: buildBimScene,
      dxf: buildBimDxf,
      csv: bimSchedule,
      csvLabel: "Schedule",
      summary: bimSummary,
    };
  }
  if (t === "steel") {
    return {
      palette: STEEL_ELEMENTS,
      globals: [...STEEL_GLOBALS],
      defs: steelDefs,
      buildScene: buildSteelScene,
      dxf: steelDxf,
      csv: memberList,
      csvLabel: "Member list",
      summary: steelSummary,
    };
  }
  if (t === "civil") {
    return {
      palette: [],
      globals: [...CIVIL_GLOBALS],
      defs: new Map<string, ElementDef>(),
      buildScene: buildCivilScene,
      dxf: civilDxf,
      csv: civilReport,
      csvLabel: "Cut/Fill report",
      summary: civilSummary,
    };
  }
  if (t === "coordination") {
    return {
      palette: [],
      globals: [...COORD_GLOBALS],
      defs: new Map<string, ElementDef>(),
      buildScene: (design, ctx) => buildCoordinationScene([], design.timelineDay ?? 0, ctx),
      dxf: (_design: Design) => coordinationDxf([]),
      csv: (_design: Design) => clashReport([], 10),
      csvLabel: "Clash report",
      summary: (_design: Design) => coordinationSummary([]),
    };
  }
  return undefined;
};

export { buildCtx };
export { defaultElement };
export function makeDefaultElement(def: ElementDef, index: number): BimElementData {
  return defaultElement(def, `${def.kind.slice(0, 3).toUpperCase()}-${index + 1}`);
}