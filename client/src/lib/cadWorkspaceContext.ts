import type { BuildingLevel } from "../types";
import { createCadObject, type CadCommand, type CadKind } from "./cadModel";
import type { CadSystem } from "./cadNetworks";

export type CadView = "top" | "bottom" | "front" | "back" | "left" | "right" | "iso";
export const CAD_VIEWS: [CadView, string][] = [["top", "Plan / top"], ["front", "Front"], ["back", "Back"], ["left", "Left"], ["right", "Right"], ["bottom", "Bottom"], ["iso", "Isometric"]];
export const PLUMBING_SYSTEMS: CadSystem[] = ["cold-water", "hot-water", "sanitary", "vent", "stormwater"];

/** A working plane is an offset from a named level, never an implicit world zero. */
export function workingPlaneElevation(level: BuildingLevel | undefined, plane: { levelId: string; offset: number } | null): number {
  return (level?.elevation ?? 0) + (plane?.levelId === level?.id && Number.isFinite(plane?.offset) ? plane!.offset : 0);
}

export function systemsForDiscipline(discipline: string): CadSystem[] {
  return discipline === "electrical" ? ["electrical"] : discipline === "plumbing" ? PLUMBING_SYSTEMS : discipline === "coordination" ? ["electrical", ...PLUMBING_SYSTEMS, "hvac"] : [];
}

export function systemForDiscipline(discipline: string, previous: CadSystem): CadSystem | undefined {
  const allowed = systemsForDiscipline(discipline);
  return allowed.includes(previous) ? previous : allowed[0];
}

/** All frame members are hosted on the active floor and committed atomically. */
export function starterFrameCommands(level: BuildingLevel, elevation: number): CadCommand[] {
  const members: Array<[CadKind, number, number, number, number, number, number]> = [["slab", 0, 0, 8, 6, .22, -.22], ["column", -3, -2, .4, .4, 3, 0], ["column", 3, -2, .4, .4, 3, 0], ["circular-column", -3, 2, .45, .45, 3, 0], ["column", 3, 2, .4, .4, 3, 0], ["beam", 0, -2, 6.4, .3, .45, 2.55], ["beam", 0, 2, 6.4, .3, .45, 2.55], ["wall", 0, -2.75, 8, .2, 3, 0]];
  return members.map(([kind, x, z, w, d, h, offset]) => {
    const object = createCadObject(kind, level);
    return { type: "create", object: { ...object, x, z, w, d, h, elevationM: elevation + offset, family: { ...object.family, instanceParameters: { baseOffset: elevation + offset - level.elevation } } } };
  });
}
