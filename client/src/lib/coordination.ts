import * as THREE from "three";
import type { Design, ProjectType } from "../types";
import {
  material,
  prismAt,
  dxfLine,
  dxfText,
  dxfEntities,
  type BuildCtx,
  type AabbItem,
  type ElementDef,
  elementAABB,
} from "./modelcore";
import { bimDefs, buildBimScene } from "./bim";
import { steelDefs, buildSteelScene } from "./steel";
import { buildCivilScene } from "./civil";

export const COORD_GLOBALS = [
  { id: "timelineDay", label: "Simulation day", unit: "d", min: 0, max: 360, step: 1, default: 90 },
  { id: "clashTol", label: "Clash tolerance", unit: "mm", min: 0, max: 100, step: 5, default: 10 },
] as const;

export interface MergedModel {
  label: string;
  projectType: ProjectType;
  design: Design;
  color: string;
  opacity: number;
  startDay: number;
  durationDays: number;
}

export function modelScene(projectType: ProjectType, design: Design, ctx: BuildCtx): THREE.Group {
  const group = new THREE.Group();
  for (const el of design.elements ?? []) {
    const def = defsFor(projectType).get(el.kind);
    if (!def) continue;
    try {
      group.add(def.build(el.params, ctx));
    } catch {
      /* skip */
    }
  }
  return group;
}

function defsFor(projectType: ProjectType): Map<string, ElementDef> {
  if (projectType === "steel") return steelDefs;
  if (projectType === "bim") return bimDefs;
  return new Map<string, ElementDef>();
}

function tint(group: THREE.Group, color: string, opacity: number): void {
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const mesh = o as THREE.Mesh;
      const base = mesh.material as THREE.Material;
      const m = base.clone();
      if (m instanceof THREE.MeshStandardMaterial) {
        m.color.set(color);
        m.transparent = true;
        m.opacity = opacity;
        m.depthWrite = false;
      }
      mesh.material = m;
    }
  });
}

export function timelineVisible(model: MergedModel, day: number): boolean {
  return day >= model.startDay && day < model.startDay + model.durationDays;
}

export function mergedScene(projectType: ProjectType, design: Design, ctx: BuildCtx): THREE.Group {
  if (projectType === "civil") return buildCivilScene(design, ctx);
  return modelScene(projectType, design, ctx);
}

export function buildCoordinationScene(
  models: MergedModel[],
  day: number,
  ctx: BuildCtx,
): THREE.Group {
  const group = new THREE.Group();
  const ground = prismAt(0, -0.01, 0, ctx.siteW, 0.02, ctx.siteD, material("#2a2d31", { rough: 0.95 }));
  group.add(ground);
  const visible = models.filter((m) => timelineVisible(m, day));
  for (const m of visible) {
    const g = mergedScene(m.projectType, m.design, ctx);
    tint(g, m.color, m.opacity);
    group.add(g);
  }
  return group;
}

export interface ClashPair {
  a: AabbItem;
  b: AabbItem;
  penetration: number;
}

export function clashDetect(models: MergedModel[], tolMm: number): ClashPair[] {
  const boxes: AabbItem[] = [];
  const ctx: BuildCtx = { siteW: 30, siteD: 30, siteH: 20 };
  for (const m of models) {
    const defs = defsFor(m.projectType);
    for (const el of m.design.elements ?? []) {
      const def = defs.get(el.kind);
      if (!def) continue;
      try {
        boxes.push({ scope: m.label, code: el.code, label: def.label, box: elementAABB(def, el.params, ctx) });
      } catch {
        /* skip */
      }
    }
  }
  const tol = tolMm / 1000;
  const out: ClashPair[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const ix = Math.min(a.box.max.x, b.box.max.x) - Math.max(a.box.min.x, b.box.min.x);
      const iy = Math.min(a.box.max.y, b.box.max.y) - Math.max(a.box.min.y, b.box.min.y);
      const iz = Math.min(a.box.max.z, b.box.max.z) - Math.max(a.box.min.z, b.box.min.z);
      if (ix > -tol && iy > -tol && iz > -tol) {
        out.push({ a, b, penetration: Math.max(-Math.min(ix, iy, iz), 0) });
      }
    }
  }
  return out;
}

export function clashReport(models: MergedModel[], tolMm: number): string {
  const clashes = clashDetect(models, tolMm);
  const rows: string[] = ["Element A,Element B,Deduction mm,Severity"];
  for (const c of clashes) {
    const sev = c.penetration > 0.05 ? "HIGH" : c.penetration > 0.01 ? "MED" : "LOW";
    rows.push(`"${c.a.scope} ${c.a.code} (${c.a.label})","${c.b.scope} ${c.b.code} (${c.b.label})","${(c.penetration * 1000).toFixed(0)}","${sev}"`);
  }
  rows.push(`TOTAL CLASHES,${clashes.length}`);
  return rows.join("\r\n");
}

export function coordinationDxf(models: MergedModel[]): string {
  const entities: string[] = [];
  let y = 400;
  for (const m of models) {
    entities.push(
      dxfText(40, y, `${m.label} [${m.projectType}] — day ${m.startDay}–${m.startDay + m.durationDays}`, 70, "MDL"),
      dxfLine(40, y - 30, 3000, y - 30, "MDL"),
    );
    y -= 100;
  }
  entities.push(dxfText(14, 700, "COORDINATION — MODEL OVERVIEW", 90, "TITLE"));
  return dxfEntities(entities);
}

export function coordinationSummary(models: MergedModel[]): string {
  return `${models.length} models merged · ${clashDetect(models, 10).length} clashes @ 10mm tol`;
}

export function toMergedModel(
  label: string,
  projectType: ProjectType,
  design: Design,
  color: string,
  opacity: number,
  startDay: number,
  durationDays: number,
): MergedModel {
  return { label, projectType, design, color, opacity, startDay, durationDays };
}

export { buildBimScene, buildSteelScene, buildCivilScene };

export function designSummaryByType(_projectType: ProjectType, design: Design): string {
  const n = design.elements?.length ?? 0;
  const pieces: string[] = [];
  if (n) pieces.push(`${n} elements`);
  if (design.merge) pieces.push(`${design.merge.length} merged`);
  return pieces.join(", ") || "empty model";
}