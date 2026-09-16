import type { Design, FurnitureItem } from "../types";
import { catalogEntry } from "./catalog";

function rectCorners(item: FurnitureItem): [number, number][] {
  const entry = catalogEntry(item.type);
  const hw = ((entry?.w ?? 1000) * item.scale) / 2;
  const hd = ((entry?.d ?? 1000) * item.scale) / 2;
  const angle = (item.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return corners.map(([cx, cy]) => [
    item.x + cx * cos - cy * sin,
    item.z + cx * sin + cy * cos,
  ]);
}

export function buildDxf(design: Design): string {
  const { widthMm: W, depthMm: D } = design.room;
  const lines: string[] = [];
  const ent = (...parts: string[]) => lines.push(...parts);

  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
    ent("0", "LINE", "8", layer, "10", x1.toFixed(1), "20", y1.toFixed(1), "11", x2.toFixed(1), "21", y2.toFixed(1));
  };
  const text = (layer: string, x: number, y: number, value: string, height = 150) => {
    ent("0", "TEXT", "8", layer, "10", x.toFixed(1), "20", y.toFixed(1), "40", String(height), "1", value);
  };
  const layer = (name: string, color: number) => {
    ent("0", "LAYER", "2", name, "70", "0", "62", String(color));
  };

  /* HEADER */
  ent(
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1015",
    "9", "$INSUNITS", "70", "4",
    "9", "$EXTMIN", "10", (-W / 2 - 500).toFixed(1), "20", (-D / 2 - 500).toFixed(1),
    "9", "$EXTMAX", "10", (W / 2 + 500).toFixed(1), "20", (D / 2 + 500).toFixed(1),
    "0", "ENDSEC",
  );

  /* LAYER TABLE */
  ent("0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", "2");
  layer("WALLS", 7);
  layer("FURNITURE", 3);
  layer("CURTAINS", 5);
  layer("TEXT", 1);
  layer("DIMENSIONS", 8);
  ent("0", "ENDTAB", "0", "TABLE", "2", "LTYPE", "70", "2");
  ent(
    "0", "LTYPE", "2", "DASHED", "70", "0", "3", "", "72", "65", "73", "2", "40", "16", "49", "10", "49", "-6",
    "0", "ENDTAB", "0", "ENDSEC",
  );

  /* ENTITIES */
  ent("0", "SECTION", "2", "ENTITIES");

  /* Outer room rectangle */
  line("WALLS", -W / 2, -D / 2, W / 2, -D / 2);
  line("WALLS", W / 2, -D / 2, W / 2, D / 2);
  line("WALLS", W / 2, D / 2, -W / 2, D / 2);
  line("WALLS", -W / 2, D / 2, -W / 2, -D / 2);
  text("TEXT", 0, D / 2 + 180, `${W / 1000} m`, 100);
  text("TEXT", W / 2 + 180, 0, `${D / 1000} m`, 100, );

  /* Furniture footprints */
  for (const item of design.furniture) {
    const corners = rectCorners(item);
    const layerName = `FURN-${item.type.toUpperCase()}`;
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      line(layerName, a[0], a[1], b[0], b[1]);
    }
    text("TEXT", item.x, item.z, item.name, 90);
  }

  /* Curtains as panel lines on the chosen wall */
  if (design.curtains?.enabled) {
    const cur = design.curtains;
    const wallLine = cur.wall;
    const panels = 2;
    const span = ((wallLine === "north" || wallLine === "south" ? W : D) * cur.widthPercentPerPanel) / panels;
    const base = 0;
    const start = -span * panels / 2;
    for (let i = 0; i < panels; i++) {
      const offset = start + i * span + span / 2;
      if (wallLine === "north") line("CURTAINS", offset - 30, D / 2, offset + 30, D / 2);
      if (wallLine === "south") line("CURTAINS", offset - 30, -D / 2, offset + 30, -D / 2);
      if (wallLine === "east") line("CURTAINS", W / 2, offset - 30, W / 2, offset + 30);
      if (wallLine === "west") line("CURTAINS", -W / 2, offset - 30, -W / 2, offset + 30);
    }
    text("TEXT", 0, base, `CURTAINS (${cur.style})`, 90);
  }

  ent("0", "ENDSEC", "0", "EOF");

  return lines.join("\n");
}