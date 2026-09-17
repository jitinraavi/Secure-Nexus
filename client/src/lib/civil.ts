import * as THREE from "three";
import type { Design } from "../types";
import {
  material,
  prismAt,
  val,
  dxfLine,
  dxfText,
  dxfEntities,
  buildCtx,
  type BuildCtx,
} from "./modelcore";

export const CIVIL_GLOBALS = [
  { id: "grid", label: "Survey grid", unit: "", min: 2, max: 40, step: 1, default: 12 },
  { id: "rugosity", label: "Terrain roughness", unit: "m", min: 0, max: 4, step: 0.25, default: 1.2 },
  { id: "bench", label: "Grade elevation", unit: "m", min: -10, max: 40, step: 0.5, default: 3 },
  { id: "slopeX", label: "Cross slope X", unit: "%", min: -10, max: 10, step: 0.5, default: 1.5 },
  { id: "slopeZ", label: "Long slope Z", unit: "%", min: -10, max: 10, step: 0.5, default: 0 },
  { id: "station", label: "Station interval", unit: "m", min: 5, max: 60, step: 5, default: 20 },
  { id: "laneW", label: "Lane width", unit: "m", min: 2, max: 12, step: 0.5, default: 7 },
] as const;

function seedFrom(design: Design): number {
  const s = design.settings ?? {};
  return Math.round(
    design.room.widthMm +
      design.room.depthMm * 3 +
      val(s, "grid", 12) * 101 +
      val(s, "rugosity", 1.2) * 977 +
      val(s, "bench", 3) * 41,
  );
}

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t * 1664525 + 1013904223) >>> 0;
    return t / 4294967296;
  };
}

function elevFun(design: Design) {
  const s = design.settings ?? {};
  const W = design.room.widthMm / 1000;
  const D = design.room.depthMm / 1000;
  const grid = Math.max(2, Math.round(val(s, "grid", 12)));
  const rough = val(s, "rugosity", 1.2);
  const rng = makeRng(seedFrom(design));
  const lattice = new Map<string, number>();
  const get = (i: number, j: number): number => {
    const k = `${i},${j}`;
    if (!lattice.has(k)) lattice.set(k, (rng() - 0.5) * 2);
    return lattice.get(k)!;
  };
  return (x: number, z: number): number => {
    const gx = ((x + W / 2) / W) * grid;
    const gz = ((z + D / 2) / D) * grid;
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gz);
    const fx = gx - i0;
    const fz = gz - j0;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const v00 = get(i0, j0);
    const v10 = get(i0 + 1, j0);
    const v01 = get(i0, j0 + 1);
    const v11 = get(i0 + 1, j0 + 1);
    const vx0 = lerp(v00, v10, fx);
    const vx1 = lerp(v01, v11, fx);
    return (-rough + lerp(vx0, vx1, fz) * rough) * (grid / 8);
  };
}

function buildSurface(ctx: BuildCtx, elev: (x: number, z: number) => number): THREE.Mesh {
  const seg = 40;
  const geo = new THREE.PlaneGeometry(ctx.siteW, ctx.siteD, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const verts = new Float32Array(pos.array);
  for (let i = 0; i < pos.count; i++) {
    verts[i * 3 + 1] = elev(verts[i * 3], verts[i * 3 + 2]);
  }
  pos.array = verts;
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material("#7d8a63", { rough: 0.95 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.noSelect = true;
  return mesh;
}

function gradeElev(design: Design, x: number, z: number): number {
  const s = design.settings ?? {};
  return val(s, "bench", 3) + (val(s, "slopeX", 1.5) / 100) * x + (val(s, "slopeZ", 0) / 100) * z;
}

export function buildCivilScene(design: Design, ctx: BuildCtx): THREE.Group {
  const group = new THREE.Group();
  const s = design.settings ?? {};
  const elev = elevFun(design);
  group.add(buildSurface(ctx, elev));

  const lane = val(s, "laneW", 7);
  const bench = (x: number, z: number) => gradeElev(design, x, z);

  const alignMat = material("#d8b238", { rough: 0.4, metal: 0.2 });
  const align = prismAt(0, 0.02, 0, lane, 0.04, ctx.siteD, alignMat);
  group.add(align);

  const profilePts: THREE.Vector3[] = [];
  const gcPts: THREE.Vector3[] = [];
  for (let z = -ctx.siteD / 2; z <= ctx.siteD / 2; z += 2) {
    profilePts.push(new THREE.Vector3(z + ctx.siteD / 2, elev(0, z), 0));
    gcPts.push(new THREE.Vector3(z + ctx.siteD / 2, bench(0, z), 0));
  }
  const groundLine = new THREE.BufferGeometry().setFromPoints(profilePts);
  const line = new THREE.Line(groundLine, new THREE.LineBasicMaterial({ color: "#c9b458" }));
  line.position.set(-ctx.siteW / 2 - 8, 0.05, 0);
  group.add(line);
  const gcLine = new THREE.BufferGeometry().setFromPoints(gcPts);
  const gcl = new THREE.Line(gcLine, new THREE.LineBasicMaterial({ color: "#e0563f", linewidth: 2 }));
  gcl.position.set(-ctx.siteW / 2 - 8, 0.06, 0);
  group.add(gcl);

  const station = Math.max(2, Math.round(val(s, "station", 20)));
  const step = ctx.siteD / station;
  for (let i = 0; i <= station; i++) {
    const z = -ctx.siteD / 2 + i * step;
    const g = elev(0, z);
    const b = bench(0, z);
    const h = Math.max(0.01, Math.abs(b - g) * 0.55);
    const fill = b > g;
    const col = prismAt(0, g + (fill ? h / 2 : -h / 2), z, 0.8, h, 0.8, material(fill ? "#4a8f4a" : "#b0523a", { rough: 0.8, trans: 0.85 }));
    group.add(col);
  }

  const labelsMat = material("#e9eef2", { rough: 0.4 });
  const notchs = 8;
  for (let i = 0; i <= notchs; i++) {
    const z = -ctx.siteD / 2 + (i * ctx.siteD) / notchs;
    const b = bench(0, z);
    const bm = prismAt(lane / 2 + 0.4, b + 0.04, z, 0.15, 0.3, 0.5, labelsMat);
    group.add(bm);
  }
  return group;
}

export function civilReport(design: Design): string {
  const s = design.settings ?? {};
  const ctx = buildCtx(design);
  const elev = elevFun(design);
  const station = Math.max(2, Math.round(val(s, "station", 20)));
  const step = ctx.siteD / station;
  const cellArea = step * val(s, "laneW", 7);
  const rows: string[] = ["Station m,Ground m,Grade m,Cut m,Fill m,Volume m3"];
  let cutTotal = 0;
  let fillTotal = 0;
  for (let i = 0; i <= station; i++) {
    const z = -ctx.siteD / 2 + i * step;
    const g = elev(0, z);
    const b = gradeElev(design, 0, z);
    const delta = b - g;
    const cut = Math.max(0, -delta);
    const fill = Math.max(0, delta);
    cutTotal += cut * cellArea;
    fillTotal += fill * cellArea;
    rows.push(`${Math.round(i * step)}.00,${g.toFixed(2)},${b.toFixed(2)},${cut.toFixed(2)},${fill.toFixed(2)},${(Math.max(cut, fill) * cellArea).toFixed(1)}`);
  }
  rows.push(`TOTALS,,,,${cutTotal.toFixed(1)},${fillTotal.toFixed(1)}`);
  return rows.join("\r\n");
}

export function civilDxf(design: Design): string {
  const ctx = buildCtx(design);
  const W = ctx.siteW * 1000;
  const D = ctx.siteD * 1000;
  const entities: string[] = [];
  entities.push(
    dxfLine(0, 0, W, 0, "SITE"),
    dxfLine(W, 0, W, D, "SITE"),
    dxfLine(W, D, 0, D, "SITE"),
    dxfLine(0, D, 0, 0, "SITE"),
  );
  const alignY = D / 2;
  entities.push(dxfLine(0, alignY, W, alignY, "ALIGN"));
  const s = design.settings ?? {};
  const station = Math.max(2, Math.round(val(s, "station", 20)));
  const step = D / station;
  for (let i = 0; i <= station; i++) {
    const z = i * step;
    const y = D - z;
    entities.push(dxfText(0, y + 90, `${Math.round(z)}`, 60, "STN"));
    entities.push(dxfLine(-60, y, 60, y, "STN"));
  }
  entities.push(dxfText(W / 2 - 400, D / 2 + 200, "ALIGNMENT", 80, "ALIGN"));
  entities.push(dxfText(14, D + 40, "CIVIL SUITE — ALIGNMENT & PROFILE (mm)", 90, "TITLE"));
  return dxfEntities(entities);
}

export function civilSummary(design: Design): string {
  const s = design.settings ?? {};
  const ctx = buildCtx(design);
  return `${ctx.siteW}m × ${ctx.siteD}m site · grade ${val(s, "bench", 3)}m · slope ${val(s, "slopeX", 1.5)}%/${val(s, "slopeZ", 0)}%`;
}