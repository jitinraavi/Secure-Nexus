import * as THREE from "three";
import type { Design } from "../types";
import {
  type BuildCtx,
  type ElementDef,
  type ParamDef,
  material,
  prism,
  prismAt,
  val,
  placeParams,
  applyPlace,
  dxfLine,
  dxfText,
  dxfEntities,
  buildCtx,
} from "./modelcore";

export const STEEL_GLOBALS = [
  { id: "baysX", label: "Bays (X)", unit: "", min: 1, max: 10, step: 1, default: 4 },
  { id: "baySpan", label: "Bay span", unit: "m", min: 3, max: 15, step: 0.5, default: 6 },
  { id: "frames", label: "Frames (Z)", unit: "", min: 1, max: 8, step: 1, default: 3 },
  { id: "eaveHeight", label: "Eave height", unit: "m", min: 3, max: 15, step: 0.5, default: 7 },
] as const;

const STEEL = () => material("#5b7a99", { metal: 0.55, rough: 0.35 });
const GUSSET = () => material("#8296ab", { metal: 0.4, rough: 0.5 });

function iSection(secH: number, flange: number, web: number, len: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const tf = Math.max(0.02, flange * 0.12);
  const tw = Math.max(0.012, web * 0.12);
  const webH = secH - 2 * tf;
  g.add(prismAt(0, secH / 2 - tf / 2, 0, flange, tf, len, mat));
  g.add(prismAt(0, -secH / 2 + tf / 2, 0, flange, tf, len, mat));
  g.add(prismAt(0, -webH / 2, 0, tw, webH, len, mat));
  return g;
}

function memberBetween(from: THREE.Vector3, to: THREE.Vector3, sec: { w: number; h: number }, mat: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  const mesh = prism(sec.w, sec.h, len, mat);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
  return mesh;
}

function withPlace(def: {
  kind: string;
  label: string;
  cat: string;
  params: ParamDef[];
  build: (p: Record<string, number>) => THREE.Group;
  summary?: (p: Record<string, number>) => string;
}): ElementDef {
  return {
    kind: def.kind,
    label: def.label,
    cat: def.cat,
    params: [...def.params, ...placeParams()],
    build(p, _ctx) {
      const g = def.build(p);
      return applyPlace(g, p);
    },
    summary(p) {
      return def.summary ? def.summary(p) : def.params.map((d) => `${d.label} ${val(p, d.id, d.default)}${d.unit}`).join(" · ");
    },
  };
}

const STANCHION: ElementDef = withPlace({
  kind: "stanchion",
  label: "Column (H-Section)",
  cat: "Frame",
  params: [
    { id: "secH", label: "Section depth", unit: "m", min: 0.2, max: 1.2, step: 0.05, default: 0.45 },
    { id: "flg", label: "Flange width", unit: "m", min: 0.12, max: 0.6, step: 0.01, default: 0.28 },
    { id: "len", label: "Length", unit: "m", min: 1, max: 30, step: 0.1, default: 7 },
  ],
  build: (p) => iSection(val(p, "secH", 0.45), val(p, "flg", 0.28), val(p, "secH", 0.45), val(p, "len", 7), STEEL()),
  summary: (p) => `H ${val(p, "secH", 0.45).toFixed(2)} × ${val(p, "flg", 0.28).toFixed(2)} · ${val(p, "len", 7)}m`,
});

const RAFTER: ElementDef = withPlace({
  kind: "rafter",
  label: "Roof Rafter",
  cat: "Frame",
  params: [
    { id: "span", label: "Span", unit: "m", min: 3, max: 36, step: 0.5, default: 12 },
    { id: "rise", label: "Rise", unit: "m", min: 0, max: 8, step: 0.1, default: 2.2 },
    { id: "bd", label: "Section depth", unit: "m", min: 0.2, max: 1, step: 0.05, default: 0.5 },
    { id: "bw", label: "Width", unit: "m", min: 0.12, max: 0.5, step: 0.02, default: 0.25 },
  ],
  build: (p) => {
    const g = new THREE.Group();
    const span = val(p, "span", 12);
    const rise = val(p, "rise", 2.2);
    const bd = val(p, "bd", 0.5);
    const bw = val(p, "bw", 0.25);
    const a = new THREE.Vector3(-span / 2, 0, 0);
    const ridge = new THREE.Vector3(0, rise, 0);
    const b = new THREE.Vector3(span / 2, 0, 0);
    g.add(memberBetween(a, ridge, { w: bw, h: bd }, STEEL()));
    g.add(memberBetween(ridge, b, { w: bw, h: bd }, STEEL()));
    g.add(prismAt(0, rise - bd / 2 - 0.02, 0, 0.4, 0.03, bw + 0.12, GUSSET()));
    return g;
  },
  summary: (p) => `${val(p, "span", 12)}m span, ${val(p, "rise", 2.2)}m rise`,
});

const EAVE_BEAM: ElementDef = withPlace({
  kind: "eavebeam",
  label: "Eave Beam",
  cat: "Frame",
  params: [
    { id: "span", label: "Length", unit: "m", min: 2, max: 30, step: 0.5, default: 12 },
    { id: "bd", label: "Section depth", unit: "m", min: 0.2, max: 1, step: 0.05, default: 0.5 },
    { id: "bw", label: "Width", unit: "m", min: 0.12, max: 0.5, step: 0.02, default: 0.25 },
  ],
  build: (p) => {
    const g = new THREE.Group();
    const span = val(p, "span", 12);
    const bd = val(p, "bd", 0.5);
    const bw = val(p, "bw", 0.25);
    g.add(prismAt(span / 2, 0, 0, span, bd, bw, STEEL()));
    g.add(prismAt(0, -bd / 2 - 0.02, 0, span, 0.03, bw + 0.06, GUSSET()));
    return g;
  },
  summary: (p) => `${val(p, "span", 12)}m, H-section ${val(p, "bd", 0.5)} deep`,
});

const BRACE: ElementDef = withPlace({
  kind: "brace",
  label: "Cross Brace",
  cat: "Bracing",
  params: [
    { id: "len", label: "Length", unit: "m", min: 2, max: 30, step: 0.5, default: 8 },
    { id: "section", label: "Section", unit: "mm", min: 50, max: 250, step: 10, default: 110 },
  ],
  build: (p) => {
    const g = new THREE.Group();
    const len = val(p, "len", 8);
    const s = val(p, "section", 110) / 1000;
    const k = len * 0.12;
    g.add(memberBetween(new THREE.Vector3(0, -k, 0), new THREE.Vector3(len, k, 0), { w: s, h: s }, STEEL()));
    g.add(memberBetween(new THREE.Vector3(0, k, 0), new THREE.Vector3(len, -k, 0), { w: s, h: s }, STEEL()));
    return g;
  },
  summary: (p) => `${val(p, "len", 8)}m · ${val(p, "section", 110)}mm section`,
});

const TRUSS: ElementDef = withPlace({
  kind: "truss",
  label: "Planar Truss",
  cat: "Bracing",
  params: [
    { id: "span", label: "Span", unit: "m", min: 4, max: 40, step: 0.5, default: 18 },
    { id: "depth", label: "Depth", unit: "m", min: 0.4, max: 4, step: 0.1, default: 1.4 },
    { id: "npanels", label: "Panels", unit: "", min: 2, max: 16, step: 1, default: 8 },
    { id: "section", label: "Member square", unit: "mm", min: 40, max: 200, step: 10, default: 80 },
  ],
  build: (p) => {
    const g = new THREE.Group();
    const span = val(p, "span", 18);
    const depth = val(p, "depth", 1.4);
    const n = Math.round(val(p, "npanels", 8));
    const s = val(p, "section", 80) / 1000;
    const mat = STEEL();
    for (let i = 0; i < n; i++) {
      const x0 = (i / n - 0.5) * span;
      const x1 = ((i + 1) / n - 0.5) * span;
      g.add(memberBetween(new THREE.Vector3(x0, 0, 0), new THREE.Vector3(x1, 0, 0), { w: s, h: s }, mat));
      g.add(memberBetween(new THREE.Vector3(x0, depth, 0), new THREE.Vector3(x1, depth, 0), { w: s, h: s }, mat));
      g.add(memberBetween(new THREE.Vector3(x0, 0, 0), new THREE.Vector3(x1, depth, 0), { w: s, h: s }, mat));
      g.add(memberBetween(new THREE.Vector3(x0, depth, 0), new THREE.Vector3(x1, 0, 0), { w: s, h: s }, mat));
    }
    for (let i = 0; i <= n; i++) {
      const x = (i / n - 0.5) * span;
      g.add(memberBetween(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, depth, 0), { w: s, h: s }, mat));
    }
    return g;
  },
  summary: (p) => `${val(p, "span", 18)}m × ${val(p, "depth", 1.4)}m truss`,
});

export const STEEL_ELEMENTS: ElementDef[] = [STANCHION, RAFTER, EAVE_BEAM, BRACE, TRUSS];
export const steelDefs = new Map(STEEL_ELEMENTS.map((d) => [d.kind, d]));

function defaultFrame(settings: Record<string, number>): THREE.Group {
  const g = new THREE.Group();
  const bays = Math.round(val(settings, "baysX", 4));
  const span = val(settings, "baySpan", 6);
  const frames = Math.round(val(settings, "frames", 3));
  const eave = val(settings, "eaveHeight", 7);
  const width = bays * span;
  for (let f = 0; f < frames; f++) {
    const z = (f - (frames - 1) / 2) * 5;
    for (let b = 0; b <= bays; b++) {
      const x = -width / 2 + b * span;
      const colMesh = prismAt(x, eave / 2, z, 0.45, eave, 0.28, STEEL());
      g.add(colMesh);
    }
    for (let b = 0; b < bays; b++) {
      const x = -width / 2 + b * span + span / 2;
      const beamMesh = prismAt(x, eave - 0.2, z, span, 0.5, 0.25, STEEL());
      g.add(beamMesh);
    }
  }
  return g;
}

export function buildSteelScene(design: Design, ctx: BuildCtx): THREE.Group {
  const group = new THREE.Group();
  const settings = design.settings ?? {};
  const ground = prism(ctx.siteW, 0.1, ctx.siteD, material("#3f3a33", { rough: 0.95 }));
  ground.position.y = -0.05;
  group.add(ground);
  group.add(defaultFrame(settings));
  for (const el of design.elements ?? []) {
    const def = steelDefs.get(el.kind);
    if (!def) continue;
    try {
      group.add(def.build(el.params, ctx));
    } catch {
      /* skip */
    }
  }
  return group;
}

interface MemberRow {
  mark: string;
  label: string;
  section: string;
  length: number;
  kgPerM: number;
}

function sectionKgPerM(def: ElementDef, p: Record<string, number>): { section: string; kgpm: number } {
  if (def.kind === "stanchion") {
    const h = val(p, "secH", 0.45) * 1000;
    const grade = Math.round((h * h) / 1000) * 1.2;
    return { section: `H ${val(p, "secH", 0.45).toFixed(2)}×${val(p, "flg", 0.28).toFixed(2)}m`, kgpm: Math.max(30, grade / 10) };
  }
  if (def.kind === "brace" || def.kind === "truss") {
    const s = val(p, "section", 80) / 1000;
    return { section: `${val(p, "section", 80)}×${val(p, "section", 80)}mm SHS`, kgpm: s * s * 7850 * 1.15 };
  }
  return { section: `${val(p, "bd", 0.5).toFixed(2)}×${val(p, "bw", 0.25).toFixed(2)}m`, kgpm: (val(p, "bd", 0.5) + val(p, "bw", 0.25)) * 382 };
}

export function memberList(design: Design): string {
  const rows: MemberRow[] = [];
  for (const el of design.elements ?? []) {
    const def = steelDefs.get(el.kind);
    if (!def) continue;
    const { section, kgpm } = sectionKgPerM(def, el.params);
    let length = 0;
    if (def.kind === "stanchion") length = val(el.params, "len", 7);
    if (def.kind === "rafter") length = Math.hypot(val(el.params, "span", 12) / 2, val(el.params, "rise", 2.2)) * 2;
    if (def.kind === "eavebeam") length = val(el.params, "span", 12);
    if (def.kind === "brace") length = val(el.params, "len", 8);
    if (def.kind === "truss") {
      const n = Math.round(val(el.params, "npanels", 8));
      const diag = Math.hypot(val(el.params, "span", 18) / n, val(el.params, "depth", 1.4));
      length = val(el.params, "span", 18) * 2 + diag * n * 2 + 0.1 * (n + 1);
    }
    rows.push({ mark: el.code, label: def.label, section, length: Math.round(length * 100) / 100, kgPerM: Math.round(kgpm * 100) / 100 });
  }
  const lines = ["Mark,Piece,Section,Length m,kg/m,Qty,kg"];
  const tally = new Map<string, { label: string; section: string; length: number; kgpm: number; qty: number }>();
  for (const r of rows) {
    const k = `${r.label}|${r.section}`;
    const t = tally.get(k) ?? { label: r.label, section: r.section, length: 0, kgpm: r.kgPerM, qty: 0 };
    t.qty += 1;
    t.length += r.length;
    tally.set(k, t);
  }
  for (const t of tally.values()) {
    lines.push(`"${t.label}","${t.section}","${t.length.toFixed(2)}","${t.kgpm.toFixed(2)}","${t.qty}","${(t.length * t.kgpm).toFixed(1)}"`);
  }
  lines.push(`"TOTAL TONNAGE","","","","","${(Array.from(tally.values()).reduce((s, t) => s + t.length * t.kgpm, 0) / 1000).toFixed(2)}"`);
  return lines.join("\r\n");
}

export function steelDxf(design: Design): string {
  const ctx = buildCtx(design);
  const W = ctx.siteW * 1000;
  const H = Math.max(6000, ctx.siteH * 1000 * 2);
  const entities: string[] = [];
  entities.push(
    dxfLine(0, 0, W, 0, "BASE"),
    dxfLine(0, 0, 0, H, "GA"),
    dxfLine(W, 0, W, H, "GA"),
  );
  let j = 1;
  for (const el of design.elements ?? []) {
    const def = steelDefs.get(el.kind);
    if (!def) continue;
    const len = memberListLength(el.kind, el.params);
    const x = 200 + j * 320;
    const y = 400 + (j % 4) * 180;
    entities.push(
      dxfLine(x, 0, x + Math.max(200, len * 1000), 0, "MBR"),
      dxfText(x, y, `${el.code} ${def.label}`, 70, "MBR"),
    );
    j += 1;
  }
  entities.push(dxfText(14, H - 40, "STEEL FRAME — GA (mm)", 90, "TITLE"));
  return dxfEntities(entities);
}

function memberListLength(kind: string, p: Record<string, number>): number {
  if (kind === "stanchion") return val(p, "len", 7);
  if (kind === "rafter") return Math.hypot(val(p, "span", 12) / 2, val(p, "rise", 2.2)) * 2;
  if (kind === "eavebeam") return val(p, "span", 12);
  if (kind === "brace") return val(p, "len", 8);
  if (kind === "truss") return val(p, "span", 18) * 2 + val(p, "depth", 1.4) * 2;
  return 1;
}

export function steelSummary(design: Design): string {
  const els = design.elements ?? [];
  return `${els.length} members · ${design.settings?.baysX ?? 4}×${design.settings?.frames ?? 3} frame`;
}