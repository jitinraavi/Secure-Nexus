import type { Design } from "../types";
import { catalogEntry } from "./catalog";

const m = (v: number) => (v / 1000).toFixed(4);

function hexToRgbFloat(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function buildObjMtl(design: Design): { obj: string; mtl: string } {
  const { widthMm: W, depthMm: D, wallHeightMm: H } = design.room;
  const obj: string[] = [];
  const mtl: string[] = [];
  let base = 0;
  let nextBase = 0;

  const addBox = (
    label: string,
    color: string,
    cx: number,
    cy: number,
    cz: number,
    w: number,
    d: number,
    h: number,
  ) => {
    const rgb = hexToRgbFloat(color);
    const matName = label;
    mtl.push(
      `newmtl ${matName}`,
      `Kd ${rgb[0].toFixed(3)} ${rgb[1].toFixed(3)} ${rgb[2].toFixed(3)}`,
      `Ka ${(rgb[0] * 0.1).toFixed(3)} ${(rgb[1] * 0.1).toFixed(3)} ${(rgb[2] * 0.1).toFixed(3)}`,
      "Ks 0.1 0.1 0.1",
      "Ns 10",
    );
    obj.push(`o ${label}`, `usemtl ${matName}`);
    const hw = w / 2, hd = d / 2, hh = h / 2;
    const minX = cx - hw, minY = cy - hh, minZ = cz - hd;
    const maxX = cx + hw, maxY = cy + hh, maxZ = cz + hd;
    const pts = [
      [minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ],
      [minX, maxY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [minX, maxY, maxZ],
    ];
    base = nextBase;
    for (const p of pts) obj.push(`v ${m(p[0])} ${m(p[1])} ${m(p[2])}`);
    nextBase += 8;
    /* Bottom, top, and 4 sides as quads */
    const faces = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];
    for (const f of faces) {
      obj.push(`f ${f.map((i) => base + i + 1).join(" ")}`);
    }
  };

  /* Floor plate */
  addBox("floor", design.room.floorColor, W / 2, 0, D / 2, W, D, 20);
  /* Two visible walls (north +X, east +Z) */
  addBox("wall_north", design.room.wallColor, W / 2, H / 2, 0, W, 100, H);
  addBox("wall_east", design.room.wallColor, 0, H / 2, D / 2, 100, D, H);

  /* Furniture as footprint boxes (plan-level fidelity) */
  for (const item of design.furniture) {
    const entry = catalogEntry(item.type);
    if (!entry) continue;
    addBox(
      `item_${item.id.slice(0, 6)}`,
      item.color,
      item.x,
      (entry.h * item.scale) / 2,
      item.z,
      entry.w * item.scale,
      entry.d * item.scale,
      entry.h * item.scale,
    );
  }

  return { obj: obj.join("\n"), mtl: mtl.join("\n") };
}

export function buildBillOfMaterials(design: Design): string {
  const rows: Record<string, { qty: number; type: string; w: number; d: number; h: number; colors: string[] }> = {};
  for (const item of design.furniture) {
    const entry = catalogEntry(item.type);
    const dims = entry ? `${entry.w} x ${entry.d} x ${entry.h}` : "";
    const key = `${item.name}|${dims}`;
    const row = (rows[key] ??= {
      qty: 0,
      type: item.type,
      w: entry?.w ?? 0,
      d: entry?.d ?? 0,
      h: entry?.h ?? 0,
      colors: [],
    });
    row.qty += 1;
    row.colors.push(item.color);
  }
  const header = "Qty,Item,Type,Size W x D x H (mm),Colours\n";
  const body = Object.entries(rows)
    .map(
      ([, r]) =>
        `${r.qty},${r.type},${r.type},${r.w} x ${r.d} x ${r.h},${r.colors.join(", ")}`,
    )
    .join("\n");
  const curtain = design.curtains?.enabled
    ? `\n1,Curtains,${design.curtains.style},wall-mounted,${design.curtains.color}`
    : "";
  return header + body + curtain + "\n";
}