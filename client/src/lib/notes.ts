import type { CommunityDesign } from "../types";
import { FACADES, UNIT_LABELS, amenityKind, landAreaSqYards, landMeters } from "./community";
import { computeTakeoff, type TakeoffResult } from "./takeoff";

/**
 * Notes-app export.
 *
 * Produces a plain-text brief that pastes cleanly into Notepad, OneNote,
 * Samsung Notes, Apple Notes or any markdown-aware editor, and provides
 * download / clipboard / native-share helpers.
 */

export interface NotesContext {
  projectName: string;
  design: CommunityDesign;
  takeoff?: TakeoffResult;
}

const pad = (label: string, value: string, width = 34) => {
  const dots = Math.max(2, width - label.length);
  return `${label} ${".".repeat(dots)} ${value}`;
};

export function buildNotesText({ projectName, design, takeoff }: NotesContext): string {
  const t = takeoff ?? computeTakeoff(design);
  const land = landMeters(design.land);
  const branch = design.branch === "residential" ? "Residential community" : "Commercial complex";
  const now = new Date();
  const lines: string[] = [];

  lines.push(`# ${projectName}`);
  lines.push(`${branch} · generated ${now.toLocaleString()}`);
  lines.push("");

  lines.push("## Site");
  lines.push(pad("Plot size", `${design.land.width} × ${design.land.depth} ${UNIT_LABELS[design.land.unit]}`));
  lines.push(pad("Plot area", `${Math.round(land.w * land.d).toLocaleString()} m² (${Math.round(landAreaSqYards(design.land)).toLocaleString()} sq yd)`));
  lines.push(pad("Footprint", `${t.summary.footprintM2.toLocaleString()} m²`));
  lines.push(pad("Built-up area", `${t.summary.builtUpM2.toLocaleString()} m²`));
  lines.push(pad("FAR / FSI", `${t.summary.far}`));
  lines.push(pad("Open area", `${t.summary.openAreaM2.toLocaleString()} m²`));
  lines.push("");

  lines.push("## Parking & basement");
  lines.push(pad("Parking type", design.parking.mode === "none" ? "None" : design.parking.mode === "surface" ? "Surface" : "Underground"));
  if (design.parking.underground) {
    const u = design.parking.underground;
    lines.push(pad("Basement levels", `${u.levels}`));
    lines.push(pad("Clear height / level", `${u.floorHeight} m`));
    lines.push(pad("Foundation depth", `${u.foundationDepth} m`));
    lines.push(pad("Excavation depth", `${(u.levels * u.floorHeight + u.foundationDepth).toFixed(1)} m`));
    lines.push(pad("Ramp", `${u.rampWidth} m wide × ${u.rampLength} m @ ${u.rampSlope}%`));
    lines.push(pad("Lift / stair lobby", `${u.liftLobby ? "Yes" : "No"} / ${u.stairLobby ? "Yes" : "No"}`));
  }
  lines.push(pad("Parking bays", `${t.summary.parkingBays}`));
  lines.push("");

  lines.push("## Towers");
  design.towers.forEach((tw, i) => {
    const facade = FACADES.find((f) => f.key === tw.facadeMaterial)?.label ?? tw.facadeMaterial;
    lines.push(`${i + 1}. ${tw.label}`);
    lines.push(`   Floors ${tw.floors} · ${tw.unitsPerFloor} units/floor · floor height ${tw.floorHeight} m`);
    lines.push(`   Unit ${tw.unitWidth} × ${tw.unitDepth} m · door faces ${tw.doorFacing} · facade ${facade}`);
    lines.push(`   Common ${tw.commonAreaPerFloor} m² · open ${tw.openAreaPerFloor} m² per floor`);
  });
  lines.push("");

  if (design.amenities.length > 0) {
    lines.push("## Ground-floor amenities");
    design.amenities.forEach((a) => {
      const k = amenityKind(a.kind);
      lines.push(`- ${a.label ?? k?.label ?? a.kind} — ${a.w} × ${a.d} m`);
    });
    lines.push("");
  }

  if (design.exteriors.length > 0) {
    lines.push("## Exterior material panels");
    design.exteriors.forEach((p) => {
      const facade = FACADES.find((f) => f.key === p.material)?.label ?? p.material;
      const tower = design.towers.find((x) => x.id === p.towerId)?.label ?? p.towerId;
      lines.push(`- ${tower} · ${p.face} face · ${p.w} × ${p.h} m · ${facade}`);
    });
    lines.push("");
  }

  const roomsWithFurniture = design.interiors.filter((r) => r.furniture && r.furniture.length > 0);
  if (roomsWithFurniture.length > 0) {
    lines.push("## Interiors");
    roomsWithFurniture.forEach((r) => {
      const tower = design.towers.find((x) => x.id === r.towerId)?.label ?? r.towerId;
      lines.push(`- ${r.name} (${tower}, floor ${r.floor})`);
      r.furniture!.forEach((f) => lines.push(`    · ${f.name}`));
    });
    lines.push("");
  }

  lines.push("## Material takeoff");
  for (const g of t.groups) {
    lines.push(`### ${g.group}`);
    for (const item of g.items) {
      lines.push(pad(item.label, `${item.qty.toLocaleString()} ${item.unit}`));
    }
    lines.push("");
  }

  lines.push("## Basis of quantities");
  for (const item of t.items) {
    lines.push(`- ${item.label}: ${item.basis}`);
  }
  lines.push("");
  lines.push("Estimates follow conventional RCC practice and standard work-item norms.");
  lines.push("Verify against structural drawings and a certified BOQ before procurement.");
  lines.push("");

  return lines.join("\n");
}

export function notesFilename(projectName: string): string {
  const safe = projectName.replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "-").slice(0, 40) || "project";
  return `${safe}-brief.txt`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export async function shareText(title: string, text: string): Promise<boolean> {
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  if (!nav.share) return false;
  try {
    await nav.share({ title, text });
    return true;
  } catch {
    return false;
  }
}
