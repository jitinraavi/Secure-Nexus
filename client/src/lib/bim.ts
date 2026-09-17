import * as THREE from "three";
import type { BimElementData, Design } from "../types";
import {
  type BuildCtx,
  type ElementDef,
  type ParamDef,
  material,
  prism,
  prismAt,
  val,
  sumParams,
  placeParams,
  applyPlace,
  dxfLine,
  dxfText,
  buildCtx,
  dxfPlan,
} from "./modelcore";

export const BIM_GLOBALS = [
  { id: "levels", label: "Storeys", unit: "", min: 1, max: 8, step: 1, default: 2 },
  { id: "floorHeight", label: "Floor height", unit: "m", min: 2.4, max: 6, step: 0.1, default: 3 },
  { id: "gridX", label: "Grid spacing X", unit: "m", min: 3, max: 12, step: 0.5, default: 6 },
  { id: "gridZ", label: "Grid spacing Z", unit: "m", min: 3, max: 9, step: 0.5, default: 5 },
] as const;

const CONC = () => material("#8d8b86", { rough: 0.85 });
const CONC_HI = () => material("#a8a49c", { rough: 0.8 });
const GLASS = () => material("#9fc0d8", { rough: 0.15, trans: 0.65 });
const FRAME = () => material("#4a4f55", { metal: 0.3 });

function withPlace(def: {
  kind: string;
  label: string;
  cat: string;
  params: ParamDef[];
  build: (p: Record<string, number>) => THREE.Group;
  summary?: (p: Record<string, number>) => string;
}): ElementDef {
  const params = [...def.params, ...placeParams()];
  const fallbackDef: ElementDef = {
    kind: def.kind,
    label: def.label,
    cat: def.cat,
    params,
    build: (p) => def.build(p),
    summary: () => "",
  };
  return {
    kind: def.kind,
    label: def.label,
    cat: def.cat,
    params,
    build(p, _ctx) {
      const g = def.build(p);
      return applyPlace(g, p);
    },
    summary(p) {
      const base = def.summary ? def.summary(p) : sumParams(fallbackDef, p);
      return `${base} · @ ${val(p, "ax", 0)}m, ${val(p, "az", 0)}m · L${val(p, "ay", 0).toFixed(1)}m`;
    },
  };
}

const COLUMN: ElementDef = withPlace({
  kind: "column",
  label: "RC Column",
  cat: "Structure",
  params: [
    { id: "b", label: "Width X", unit: "m", min: 0.25, max: 1.5, step: 0.05, default: 0.45 },
    { id: "d", label: "Width Z", unit: "m", min: 0.25, max: 1.5, step: 0.05, default: 0.45 },
    { id: "h", label: "Height", unit: "m", min: 1.5, max: 40, step: 0.1, default: 3 },
  ],
  build: (p) => {
    const g = new THREE.Group();
    g.add(prism(val(p, "b", 0.45), val(p, "h", 3), val(p, "d", 0.45), CONC()));
    return g;
  },
  summary: (p) => `${val(p, "b", 0.45).toFixed(2)}×${val(p, "d", 0.45).toFixed(2)} × ${val(p, "h", 3)}m tall`,
});

const BEAM: ElementDef = withPlace({
  kind: "beam",
  label: "RC Beam",
  cat: "Structure",
  params: [
    { id: "span", label: "Length", unit: "m", min: 1.5, max: 30, step: 0.1, default: 6 },
    { id: "bw", label: "Width", unit: "m", min: 0.2, max: 1, step: 0.05, default: 0.3 },
    { id: "bd", label: "Depth", unit: "m", min: 0.3, max: 2, step: 0.05, default: 0.6 },
  ],
  build: (p) => {
    const g = new THREE.Group();
    g.add(prism(val(p, "span", 6), val(p, "bd", 0.6), val(p, "bw", 0.3), CONC()));
    return g;
  },
  summary: (p) => `${val(p, "span", 6)}m × ${val(p, "bd", 0.6)}m deep`,
});

const SLAB: ElementDef = withPlace({
  kind: "slab",
  label: "Floor Slab",
  cat: "Structure",
  params: [
    { id: "spanX", label: "Length X", unit: "m", min: 1, max: 30, step: 0.5, default: 6 },
    { id: "spanZ", label: "Length Z", unit: "m", min: 1, max: 20, step: 0.5, default: 5 },
    { id: "t", label: "Thickness", unit: "m", min: 0.1, max: 0.6, step: 0.05, default: 0.15 },
  ],
  build: (p) => {
    const g = new THREE.Group();
    g.add(prism(val(p, "spanX", 6), val(p, "t", 0.15), val(p, "spanZ", 5), CONC_HI()));
    return g;
  },
  summary: (p) => `${val(p, "spanX", 6)}×${val(p, "spanZ", 5)}m, ${val(p, "t", 0.15)}m thick`,
});

const RCC_WALL: ElementDef = withPlace({
  kind: "wall",
  label: "RCC / Block Wall",
  cat: "Envelope",
  params: [
    { id: "len", label: "Length", unit: "m", min: 0.5, max: 40, step: 0.5, default: 6 },
    { id: "h", label: "Height", unit: "m", min: 0.5, max: 12, step: 0.1, default: 3 },
    { id: "t", label: "Thickness", unit: "m", min: 0.1, max: 0.6, step: 0.02, default: 0.2 },
  ],
  build: (p) => {
    const g = new THREE.Group();
    g.add(prism(val(p, "len", 6), val(p, "h", 3), val(p, "t", 0.2), CONC()));
    return g;
  },
  summary: (p) => `${val(p, "len", 6)}m × ${val(p, "h", 3)}m × ${val(p, "t", 0.2)}m`,
});

const FOUNDATION: ElementDef = withPlace({
  kind: "footing",
  label: "Foundation Pad",
  cat: "Structure",
  params: [
    { id: "fx", label: "Size X", unit: "m", min: 0.6, max: 6, step: 0.1, default: 1.8 },
    { id: "fz", label: "Size Z", unit: "m", min: 0.6, max: 6, step: 0.1, default: 1.8 },
    { id: "ft", label: "Thickness", unit: "m", min: 0.2, max: 1.5, step: 0.05, default: 0.4 },
  ],
  build: (p) => {
    const g = new THREE.Group();
    g.add(prism(val(p, "fx", 1.8), val(p, "ft", 0.4), val(p, "fz", 1.8), material("#6d6a64", { rough: 0.9 })));
    return g;
  },
  summary: (p) => `${val(p, "fx", 1.8)}×${val(p, "fz", 1.8)}m pad`,
});

const DOOR: ElementDef = withPlace({
  kind: "door",
  label: "Door Opening",
  cat: "Envelope",
  params: [
    { id: "w", label: "Width", unit: "m", min: 0.6, max: 3, step: 0.05, default: 0.9 },
    { id: "h", label: "Height", unit: "m", min: 1.8, max: 3.5, step: 0.05, default: 2.1 },
    { id: "leaf", label: "Leaf thickness", unit: "m", min: 0.04, max: 0.12, step: 0.01, default: 0.06 },
  ],
  build: (p) => {
    const g = new THREE.Group();
    const w = val(p, "w", 0.9);
    const h = val(p, "h", 2.1);
    const lt = val(p, "leaf", 0.06);
    const jamb = prism(0.08, h, lt, CONC_HI());
    jamb.position.set(-w / 2 - 0.04 + 0.04, h / 2, 0);
    g.add(jamb);
    const jamb2 = jamb.clone();
    jamb2.position.x = w / 2 - 0.04;
    g.add(jamb2);
    const head = prism(w + 0.08, 0.08, lt, CONC_HI());
    head.position.set(0, h + 0.04, 0);
    g.add(head);
    const leaf = prism(w, h, lt * 0.6, FRAME());
    leaf.position.set(0, h / 2, 0.02);
    g.add(leaf);
    return g;
  },
  summary: (p) => `${val(p, "w", 0.9)} × ${val(p, "h", 2.1)}m opening`,
});

const WINDOW: ElementDef = withPlace({
  kind: "window",
  label: "Glazing Window",
  cat: "Envelope",
  params: [
    { id: "w", label: "Width", unit: "m", min: 0.5, max: 6, step: 0.1, default: 1.8 },
    { id: "h", label: "Height", unit: "m", min: 0.3, max: 3, step: 0.05, default: 1.5 },
    { id: "sill", label: "Sill above base", unit: "m", min: 0.3, max: 2, step: 0.05, default: 0.9 },
  ],
  build: (p) => {
    const g = new THREE.Group();
    const w = val(p, "w", 1.8);
    const h = val(p, "h", 1.5);
    const sill = val(p, "sill", 0.9);
    const glass = prism(w - 0.12, h - 0.12, 0.03, GLASS());
    glass.position.set(0, sill + h / 2, 0);
    g.add(glass);
    const fram = (x: number, y: number, wf: number, hf: number) => {
      const m = prism(wf, hf, 0.05, FRAME());
      m.position.set(x, y, 0);
      g.add(m);
    };
    fram(0, sill + h / 2 - h / 2 + 0.03, w, 0.06);
    fram(0, sill + h - 0.03, w, 0.06);
    fram(-w / 2 + 0.03, sill + h / 2, 0.06, h);
    fram(w / 2 - 0.03, sill + h / 2, 0.06, h);
    return g;
  },
  summary: (p) => `${val(p, "w", 1.8)} × ${val(p, "h", 1.5)}m at sill ${val(p, "sill", 0.9)}m`,
});

const ROOF: ElementDef = withPlace({
  kind: "roof",
  label: "Pitched Roof",
  cat: "Envelope",
  params: [
    { id: "spanX", label: "Span X", unit: "m", min: 3, max: 30, step: 0.5, default: 8 },
    { id: "spanZ", label: "Run Z", unit: "m", min: 2, max: 20, step: 0.5, default: 6 },
    { id: "pitch", label: "Pitch", unit: "°", min: 5, max: 45, step: 1, default: 22 },
    { id: "t", label: "Thickness", unit: "m", min: 0.05, max: 0.3, step: 0.01, default: 0.12 },
  ],
  build: (p) => {
    const g = new THREE.Group();
    const spanX = val(p, "spanX", 8);
    const z = val(p, "spanZ", 6);
    const pitch = THREE.MathUtils.degToRad(val(p, "pitch", 22));
    const t = val(p, "t", 0.12);
    const ridge = (Math.tan(pitch) * spanX) / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-spanX / 2, 0);
    shape.lineTo(0, ridge);
    shape.lineTo(spanX / 2, 0);
    shape.lineTo(spanX / 2, -t);
    shape.lineTo(0, ridge - t);
    shape.lineTo(-spanX / 2, -t);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: z, bevelEnabled: false });
    geo.translate(0, 0, -z / 2);
    const mesh = new THREE.Mesh(geo, material("#8a5a44", { rough: 0.75 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.noSelect = true;
    g.add(mesh);
    return g;
  },
  summary: (p) => `${val(p, "spanX", 8)}m span, ${val(p, "pitch", 22)}° pitch`,
});

export const BIM_ELEMENTS: ElementDef[] = [COLUMN, BEAM, SLAB, RCC_WALL, FOUNDATION, DOOR, WINDOW, ROOF];

export const bimDefs = new Map(BIM_ELEMENTS.map((d) => [d.kind, d]));

function gridLines(ctx: BuildCtx, settings: Record<string, number>): THREE.Group {
  const g = new THREE.Group();
  const gx = val(settings, "gridX", 6);
  const gz = val(settings, "gridZ", 5);
  const mat = material("#c9b458", { rough: 0.5, trans: 0.75 });
  const xCount = Math.max(1, Math.round(ctx.siteW / gx));
  const zCount = Math.max(1, Math.round(ctx.siteD / gz));
  for (let i = 0; i <= xCount; i++) {
    g.add(prismAt(-ctx.siteW / 2 + i * gx + 0.0001, 0.025, 0, 0.05, 0.05, ctx.siteD, mat));
  }
  for (let j = 0; j <= zCount; j++) {
    g.add(prismAt(0, 0.025, -ctx.siteD / 2 + j * gz, ctx.siteW, 0.05, 0.05, mat));
  }
  return g;
}

function levelsLines(ctx: BuildCtx, settings: Record<string, number>): THREE.Group {
  const g = new THREE.Group();
  const n = Math.round(val(settings, "levels", 2));
  const fh = val(settings, "floorHeight", 3);
  const mat = material("#5f7fb0", { rough: 0.4, trans: 0.6 });
  for (let i = 1; i < n; i++) {
    const y = i * fh;
    g.add(prismAt(0, y, 0, ctx.siteW, 0.05, ctx.siteD, mat));
  }
  return g;
}

export function buildBimScene(design: Design, ctx: BuildCtx): THREE.Group {
  const group = new THREE.Group();
  const settings = design.settings ?? {};
  const ground = prism(ctx.siteW, 0.15, ctx.siteD, material("#5b5546", { rough: 0.95 }));
  ground.position.y = -0.075;
  group.add(ground);
  const site = prismAt(0, 0.02, 0, ctx.siteW, 0.04, ctx.siteD, material("#6b6142", { rough: 0.9, trans: 0.4 }));
  group.add(site);
  group.add(gridLines(ctx, settings));
  group.add(levelsLines(ctx, settings));
  for (const el of design.elements ?? []) {
    const def = bimDefs.get(el.kind);
    if (!def) continue;
    try {
      group.add(def.build(el.params, ctx));
    } catch {
      /* skip */
    }
  }
  return group;
}

export function buildBimDxf(design: Design): string {
  const ctx = buildCtx(design);
  const entities: string[] = [];
  const W = ctx.siteW * 1000;
  const D = ctx.siteD * 1000;
  entities.push(
    dxfLine(0, 0, W, 0, "SITE"),
    dxfLine(W, 0, W, D, "SITE"),
    dxfLine(W, D, 0, D, "SITE"),
    dxfLine(0, D, 0, 0, "SITE"),
  );
  const settings = design.settings ?? {};
  const gx = val(settings, "gridX", 6) * 1000;
  const gz = val(settings, "gridZ", 5) * 1000;
  for (let x = gx; x < W; x += gx) entities.push(dxfLine(x, 0, x, D, "GRID"));
  for (let zlev = gz; zlev < D; zlev += gz) entities.push(dxfLine(0, zlev, W, zlev, "GRID"));
  entities.push(dxfText(20, D + 40, "BIM STUDIO — LEVEL PLAN (mm)", 90, "TITLE"));
  const plan = dxfPlan(bimDefs, design.elements ?? [], ctx);
  return plan;
}

export function bimSchedule(design: Design): string {
  const rows: string[] = ["Code,Type,Description,Count"];
  const grouped = new Map<string, BimElementData[]>();
  for (const el of design.elements ?? []) {
    const l = grouped.get(el.kind) ?? [];
    l.push(el);
    grouped.set(el.kind, l);
  }
  for (const [kind, els] of grouped) {
    const def = bimDefs.get(kind);
    rows.push(`"${els[0].code}","${kind}","${def ? def.label : kind}","${els.length}"`);
    if (def) {
      for (const d of def.params) rows.push(`"","  ${d.label}","${val(els[0].params, d.id, d.default)}${d.unit}",""`);
    }
  }
  return rows.join("\r\n");
}

export function bimSummary(design: Design): string {
  const els = design.elements ?? [];
  return `${els.length} elements · ${design.settings?.levels ?? 2} storeys @ ${val(design.settings ?? {}, "floorHeight", 3)}m`;
}