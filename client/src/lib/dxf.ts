import type { Design, DraftElement, FurnitureItem, MepElement } from "../types";
import { catalogEntry } from "./catalog";

type Point = [number, number];

function rotatedBox(x: number, y: number, width: number, depth: number, angleDeg = 0): Point[] {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]].map(([px, py]) => [
    x + px * cos - py * sin,
    y + px * sin + py * cos,
  ]);
}

function furnitureBox(item: FurnitureItem): Point[] {
  const entry = catalogEntry(item.type);
  return rotatedBox(item.x, item.z, (entry?.w ?? 1000) * item.scale, (entry?.d ?? 1000) * item.scale, item.rotationDeg);
}

function safeLayer(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9_-]/g, "_").slice(0, 31);
}

/** DXF is a 2D drafting projection; vertical and fabrication details are intentionally approximated. */
export function buildDxf(design: Design): string {
  const roomWidth = design.room.widthMm;
  const roomDepth = design.room.depthMm;
  const extent = Math.max(roomWidth, roomDepth, 10000);
  const lines: string[] = [];
  const ent = (...parts: string[]) => lines.push(...parts);
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => ent("0", "LINE", "8", safeLayer(layer), "10", x1.toFixed(3), "20", y1.toFixed(3), "11", x2.toFixed(3), "21", y2.toFixed(3));
  const text = (layer: string, x: number, y: number, value: string, height = 150) => ent("0", "TEXT", "8", safeLayer(layer), "10", x.toFixed(3), "20", y.toFixed(3), "40", String(height), "1", value.replace(/[\r\n]/g, " "));
  const box = (layer: string, points: Point[]) => points.forEach((point, index) => line(layer, point[0], point[1], points[(index + 1) % points.length][0], points[(index + 1) % points.length][1]));
  const dimension = (x1: number, y1: number, x2: number, y2: number, label: string) => {
    line("DIMENSIONS", x1, y1, x2, y2);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length * 80;
    const ny = dx / length * 80;
    line("DIMENSIONS", x1, y1, x1 + nx, y1 + ny);
    line("DIMENSIONS", x2, y2, x2 + nx, y2 + ny);
    text("DIMENSIONS", (x1 + x2) / 2 + nx, (y1 + y2) / 2 + ny, label, 100);
  };

  ent("0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1015", "9", "$INSUNITS", "70", "4", "9", "$EXTMIN", "10", (-extent).toFixed(1), "20", (-extent).toFixed(1), "9", "$EXTMAX", "10", extent.toFixed(1), "20", extent.toFixed(1), "0", "ENDSEC");
  const layerNames = ["WALLS", "COLUMNS", "SLABS", "ROOFS", "DIMENSIONS", "TEXT", "FURNITURE", "CURTAINS", "MEP_DUCT", "MEP_PIPE", "MEP_CABLE", "MEP_EQUIPMENT", "DRAFTING", "FACILITIES", "SITE", "STRUCTURAL_GRID"];
  ent("0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(layerNames.length));
  layerNames.forEach((name, index) => ent("0", "LAYER", "2", name, "70", "0", "62", String((index % 7) + 1)));
  ent("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");

  box("WALLS", [[-roomWidth / 2, -roomDepth / 2], [roomWidth / 2, -roomDepth / 2], [roomWidth / 2, roomDepth / 2], [-roomWidth / 2, roomDepth / 2]]);
  dimension(-roomWidth / 2, -roomDepth / 2 - 300, roomWidth / 2, -roomDepth / 2 - 300, `${(roomWidth / 1000).toFixed(2)} m`);
  dimension(roomWidth / 2 + 300, -roomDepth / 2, roomWidth / 2 + 300, roomDepth / 2, `${(roomDepth / 1000).toFixed(2)} m`);
  design.furniture.forEach((item) => { box("FURNITURE", furnitureBox(item)); text("TEXT", item.x, item.z, item.name, 90); });
  if (design.curtains?.enabled) {
    const cur = design.curtains;
    const span = (cur.wall === "north" || cur.wall === "south" ? roomWidth : roomDepth) * cur.widthPercentPerPanel;
    for (let i = 0; i < 2; i++) {
      const offset = (i - 0.5) * span;
      if (cur.wall === "north") line("CURTAINS", offset - 30, roomDepth / 2, offset + 30, roomDepth / 2);
      if (cur.wall === "south") line("CURTAINS", offset - 30, -roomDepth / 2, offset + 30, -roomDepth / 2);
      if (cur.wall === "east") line("CURTAINS", roomWidth / 2, offset - 30, roomWidth / 2, offset + 30);
      if (cur.wall === "west") line("CURTAINS", -roomWidth / 2, offset - 30, -roomWidth / 2, offset + 30);
    }
    text("TEXT", 0, 0, `CURTAINS (${cur.style})`, 90);
  }

  const addDraft = (draft: DraftElement) => {
    const layer = draft.kind === "wall" ? "WALLS" : draft.kind === "column" ? "COLUMNS" : draft.kind === "slab" ? "SLABS" : draft.kind === "roof" ? "ROOFS" : "DRAFTING";
    if (draft.kind === "circle") {
      ent("0", "CIRCLE", "8", layer, "10", draft.x.toFixed(3), "20", draft.z.toFixed(3), "40", (draft.w / 2).toFixed(3));
    } else if (draft.kind === "dimension") {
      dimension(draft.x, draft.z, draft.x + draft.w, draft.z, draft.label || `${draft.w.toFixed(2)} m`);
    } else {
      box(layer, rotatedBox(draft.x, draft.z, draft.w, Math.max(draft.d, draft.kind === "line" ? 1 : 0.05), draft.rotationDeg));
    }
    if (draft.label) text("TEXT", draft.x, draft.z, draft.label, 90);
  };
  for (const draft of [...(design.community?.drafts ?? []), ...(design.infra?.drafts ?? [])]) addDraft(draft);

  const addMep = (element: MepElement) => {
    const layer = element.kind === "duct" ? "MEP_DUCT" : element.kind === "pipe" ? "MEP_PIPE" : element.kind === "cable-tray" ? "MEP_CABLE" : "MEP_EQUIPMENT";
    for (let i = 1; i < element.route.length; i++) line(layer, element.route[i - 1].x * 1000, element.route[i - 1].z * 1000, element.route[i].x * 1000, element.route[i].z * 1000);
    if (element.route[0]) text("TEXT", element.route[0].x * 1000, element.route[0].z * 1000, `${element.name} [approx.]`, 80);
  };
  for (const element of [...(design.mep?.elements ?? []), ...(design.community?.mep?.elements ?? []), ...(design.infra?.mep?.elements ?? [])]) addMep(element);

  if (design.community) {
    for (const tower of design.community.towers) {
      box("WALLS", rotatedBox(tower.x * 1000, tower.z * 1000, tower.unitWidth * tower.unitsPerFloor * 1000, tower.unitDepth * 1000, tower.rotY));
      text("TEXT", tower.x * 1000, tower.z * 1000, `${tower.label} (${tower.floors}F)`, 100);
    }
    for (const amenity of design.community.amenities) box("SITE", rotatedBox(amenity.x * 1000, amenity.z * 1000, amenity.w * 1000, amenity.d * 1000, amenity.rotY));
  }
  if (design.infra) for (const facility of design.infra.facilities ?? []) {
    box("FACILITIES", rotatedBox(0, 0, facility.widthM * 1000, facility.lengthM * 1000));
    text("TEXT", 0, 0, `${facility.kind} x${facility.count} [approx.]`, 100);
  }
  ent("0", "ENDSEC", "0", "EOF");
  return lines.join("\n") + "\n";
}
