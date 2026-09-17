import * as THREE from "three";
import type { BimElementData, Design } from "../types";

export interface ParamDef {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface BuildCtx {
  siteW: number;
  siteD: number;
  siteH: number;
}

export interface ElementDef {
  kind: string;
  label: string;
  cat: string;
  params: ParamDef[];
  build(p: Record<string, number>, ctx: BuildCtx): THREE.Group;
  summary(p: Record<string, number>): string;
}

export function p(
  id: string,
  label: string,
  unit: string,
  def: number,
  min: number,
  max: number,
  step: number,
): ParamDef {
  return { id, label, unit, min, max, step, default: def };
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export function material(color: string, opts: { rough?: number; metal?: number; trans?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.rough ?? 0.8}|${opts.metal ?? 0}|${opts.trans ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.8,
      metalness: opts.metal ?? 0,
      transparent: opts.trans !== undefined && opts.trans < 1,
      opacity: opts.trans ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
}

export function prism(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.noSelect = true;
  return mesh;
}

export function prismAt(
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
): THREE.Mesh {
  const mesh = prism(w, h, d, mat);
  mesh.position.set(x, y, z);
  return mesh;
}

export function val(p: Record<string, number>, key: string, d: number): number {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

export function sumParams(def: ElementDef, p: Record<string, number>): string {
  return def.params.map((d) => `${d.label}: ${val(p, d.id, d.default)}${d.unit}`).join(" · ");
}

export function elementAABB(def: ElementDef, p: Record<string, number>, ctx: BuildCtx): THREE.Box3 {
  const mesh = def.build(p, ctx);
  const box = new THREE.Box3().setFromObject(mesh);
  box.expandByScalar(0.004);
  return box;
}

export interface AabbItem {
  scope: string;
  code: string;
  label: string;
  box: THREE.Box3;
}

export function designElements(design: Design): BimElementData[] {
  return design.elements ?? [];
}

export function defaultElement(def: ElementDef, code: string): BimElementData {
  const params: Record<string, number> = {};
  for (const d of def.params) params[d.id] = d.default;
  return { id: uid(def.kind), kind: def.kind, code, params };
}

export function scheduleCsv(defs: Map<string, ElementDef>, elements: BimElementData[]): string {
  const rows: string[] = ["Code,Kind,Description"];
  const grouped = new Map<string, BimElementData[]>();
  for (const el of elements) {
    const list = grouped.get(el.kind) ?? [];
    list.push(el);
    grouped.set(el.kind, list);
  }
  for (const [kind, list] of grouped) {
    const def = defs.get(kind);
    const label = def ? def.label : kind;
    rows.push(`"${list[0].code}","${kind}","${label}" × ${list.length}`);
    if (def) {
      for (const d of def.params) {
        rows.push(`"","  ${d.label}","${val(list[0].params, d.id, d.default)}${d.unit}"`);
      }
    }
  }
  return rows.join("\r\n");
}

export function designAabb(defs: Map<string, ElementDef>, elements: BimElementData[], ctx: BuildCtx): AabbItem[] {
  const out: AabbItem[] = [];
  for (const el of elements) {
    const def = defs.get(el.kind);
    if (!def) continue;
    try {
      out.push({ scope: "project", code: el.code, label: def.label, box: elementAABB(def, el.params, ctx) });
    } catch {
      /* skip unbuildable */
    }
  }
  return out;
}

const dxfLine = (x1: number, y1: number, x2: number, y2: number, layer = "0") =>
  `0\nLINE\n  8\n${layer}\n 10\n${x1.toFixed(2)}\n 20\n${y1.toFixed(2)}\n 30\n0\n 11\n${x2.toFixed(2)}\n 21\n${y2.toFixed(2)}\n 31\n0\n`;
const dxfText = (
  x: number,
  y: number,
  s: string,
  height = 120,
  layer = "0",
) =>
  `0\nTEXT\n  8\n${layer}\n 10\n${x.toFixed(2)}\n 20\n${y.toFixed(2)}\n 30\n0\n  1\n${s}\n 40\n${height.toFixed(1)}\n`;

function dxfEntities(entities: string[]): string {
  return `0\nSECTION\n2\nENTITIES\n${entities.join("")}0\nENDSEC\n0\nEOF\n`;
}

export function placeParams(): ParamDef[] {
  return [
    { id: "ax", label: "X", unit: "m", min: -60, max: 60, step: 0.5, default: 0 },
    { id: "az", label: "Z", unit: "m", min: -60, max: 60, step: 0.5, default: 0 },
    { id: "ay", label: "Base elev.", unit: "m", min: 0, max: 60, step: 0.1, default: 0 },
    { id: "rotY", label: "Rotation", unit: "°", min: -180, max: 180, step: 5, default: 0 },
  ];
}

export function applyPlace(group: THREE.Group, p: Record<string, number>): THREE.Group {
  group.position.set(val(p, "ax", 0), val(p, "ay", 0), val(p, "az", 0));
  group.rotation.y = THREE.MathUtils.degToRad(val(p, "rotY", 0));
  return group;
}

export function dxfTitle(title: string, lines: string[]): string {
  const head = [
    `0\nTEXT\n  8\nTITLE\n 10\n40\n 20\n${(220 + lines.length * 30).toFixed(1)}\n 30\n0\n  1\n${title}\n 40\n150\n`,
  ];
  return dxfEntities([...head, ...lines]);
}

export { dxfLine, dxfText, dxfEntities };

export function dxfPlan(defs: Map<string, ElementDef>, elements: BimElementData[], ctx: BuildCtx): string {
  const entities: string[] = [];
  const siteB = 60;
  entities.push(
    dxfLine(-siteB, -siteB, ctx.siteW * 1000 + siteB, -siteB, "SITE"),
    dxfLine(ctx.siteW * 1000 + siteB, -siteB, ctx.siteW * 1000 + siteB, ctx.siteD * 1000 + siteB, "SITE"),
    dxfLine(ctx.siteW * 1000 + siteB, ctx.siteD * 1000 + siteB, -siteB, ctx.siteD * 1000 + siteB, "SITE"),
    dxfLine(-siteB, ctx.siteD * 1000 + siteB, -siteB, -siteB, "SITE"),
  );
  for (const el of elements) {
    const def = defs.get(el.kind);
    if (!def) continue;
    const box = elementAABB(def, el.params, ctx);
    const x = box.min.x * 1000;
    const y = box.min.z * 1000;
    const w = (box.max.x - box.min.x) * 1000;
    const h = (box.max.z - box.min.z) * 1000;
    if (w < 2 || h < 2) {
      entities.push(dxfText(Math.round(x + w / 2), Math.round(y + h / 2), `•`, 120, "EL"));
      continue;
    }
    entities.push(
      dxfLine(x, y, x + w, y, "EL"),
      dxfLine(x + w, y, x + w, y + h, "EL"),
      dxfLine(x + w, y + h, x, y + h, "EL"),
      dxfLine(x, y + h, x, y, "EL"),
      dxfText(x, y - 40, `${el.code} ${def.label}`, 90, "EL"),
    );
  }
  return dxfEntities(entities);
}

export interface ModuleExportSpec {
  dxf: () => string;
  csv: () => string;
}

export function buildCtx(design: Design): BuildCtx {
  return {
    siteW: design.room.widthMm / 1000,
    siteD: design.room.depthMm / 1000,
    siteH: design.room.wallHeightMm / 1000,
  };
}