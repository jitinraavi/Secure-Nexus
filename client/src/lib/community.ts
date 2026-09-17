import type {
  AmenityData,
  BuildingBranch,
  CommunityDesign,
  InteriorRoom,
  LandSite,
  TowerData,
  UndergroundParking,
  UnitSystem,
} from "../types";
import { uid } from "./modelcore";

/* ------------------------------ Unit conversions ------------------------------ */

const UNIT_METERS: Record<UnitSystem, number> = { m: 1, yd: 0.9144, ft: 0.3048 };

export function toMeters(value: number, unit: UnitSystem): number {
  return value * UNIT_METERS[unit];
}

export function metersTo(value: number, unit: UnitSystem): number {
  return value / UNIT_METERS[unit];
}

export function landMeters(land: LandSite): { w: number; d: number } {
  return { w: toMeters(Math.max(land.width, 1), land.unit), d: toMeters(Math.max(land.depth, 1), land.unit) };
}

export function landAreaSqYards(land: LandSite): number {
  const { w, d } = landMeters(land);
  return (w * d) / (0.9144 * 0.9144);
}

export const UNIT_LABELS: Record<UnitSystem, string> = { m: "meters", yd: "yards", ft: "feet" };

/* ------------------------------- Amenity catalog ------------------------------- */

export type AmenityShape = "court" | "pool" | "green" | "track" | "steps" | "box" | "sand" | "kids";

export interface AmenityKind {
  kind: string;
  label: string;
  defW: number;
  defD: number;
  defH: number;
  color: string;
  shape: AmenityShape;
}

export const AMENITIES: AmenityKind[] = [
  { kind: "open-air-theatre", label: "Open-air theatre", defW: 22, defD: 18, defH: 4, color: "#8b7d6b", shape: "steps" },
  { kind: "amphitheatre", label: "Amphitheatre", defW: 26, defD: 20, defH: 5, color: "#a3907a", shape: "steps" },
  { kind: "cycling-track", label: "Cycling track", defW: 80, defD: 40, defH: 0.15, color: "#455a64", shape: "track" },
  { kind: "running-track", label: "Running track", defW: 120, defD: 60, defH: 0.15, color: "#b45309", shape: "track" },
  { kind: "swimming-pool", label: "Swimming pool", defW: 25, defD: 12.5, defH: 1.6, color: "#2196f3", shape: "pool" },
  { kind: "basketball", label: "Basketball court", defW: 28, defD: 15, defH: 0.1, color: "#ff8a65", shape: "court" },
  { kind: "tennis", label: "Tennis court", defW: 23.77, defD: 10.97, defH: 0.1, color: "#4caf50", shape: "court" },
  { kind: "pickleball", label: "Pickleball court", defW: 13.41, defD: 6.1, defH: 0.1, color: "#00bcd4", shape: "court" },
  { kind: "volleyball", label: "Volleyball court", defW: 18, defD: 9, defH: 0.1, color: "#9e9d24", shape: "court" },
  { kind: "sand-volleyball", label: "Sand volleyball", defW: 16, defD: 8, defH: 0.4, color: "#d7b98a", shape: "sand" },
  { kind: "cricket-nets", label: "Cricket nets", defW: 20, defD: 4, defH: 4, color: "#5d4037", shape: "court" },
  { kind: "practice-zones", label: "Cricket practice zones", defW: 30, defD: 20, defH: 0.1, color: "#8d6e63", shape: "green" },
  { kind: "squash", label: "Squash courts", defW: 9.75, defD: 6.4, defH: 5.6, color: "#7986cb", shape: "box" },
  { kind: "badminton-indoor", label: "Indoor badminton", defW: 13.4, defD: 6.1, defH: 3, color: "#7e57c2", shape: "box" },
  { kind: "badminton-outdoor", label: "Outdoor badminton", defW: 13.4, defD: 6.1, defH: 0.1, color: "#26a69a", shape: "court" },
  { kind: "kids-play", label: "Kids play area", defW: 16, defD: 16, defH: 1.2, color: "#f06292", shape: "kids" },
  { kind: "sand-park", label: "Sand park", defW: 12, defD: 12, defH: 0.5, color: "#c5b28b", shape: "sand" },
  { kind: "lawn", label: "Lawn", defW: 30, defD: 20, defH: 0.1, color: "#66bb6a", shape: "green" },
  { kind: "garden", label: "Community garden", defW: 24, defD: 16, defH: 0.2, color: "#2e7d32", shape: "green" },
  { kind: "clubhouse", label: "Clubhouse", defW: 20, defD: 15, defH: 4.5, color: "#546e7a", shape: "box" },
  { kind: "gym", label: "Gym", defW: 20, defD: 12, defH: 3.5, color: "#37474f", shape: "box" },
  { kind: "yoga", label: "Yoga deck", defW: 12, defD: 12, defH: 0.2, color: "#aed581", shape: "green" },
  { kind: "jogging-path", label: "Jogging path", defW: 60, defD: 30, defH: 0.1, color: "#78909c", shape: "track" },
  { kind: "walking-path", label: "Walking path", defW: 50, defD: 4, defH: 0.1, color: "#90a4ae", shape: "track" },
];

export function amenityKind(kind: string): AmenityKind | undefined {
  return AMENITIES.find((a) => a.kind === kind);
}

export function makeAmenity(kind: string, x: number, z: number): AmenityData {
  const k = amenityKind(kind) ?? AMENITIES[0];
  return { id: uid("am"), kind: k.kind, x, z, rotY: 0, w: k.defW, d: k.defD, h: k.defH };
}

/* --------------------------------- Facades ---------------------------------- */

export interface FacadeOption {
  key: string;
  label: string;
  color: string;
  rough: number;
  metal: number;
  trans?: boolean;
}

export const FACADES: FacadeOption[] = [
  { key: "glass", label: "Glass", color: "#9ccfe4", rough: 0.15, metal: 0.4, trans: true },
  { key: "concrete", label: "Concrete", color: "#b0b4b8", rough: 0.9, metal: 0 },
  { key: "brick", label: "Brick", color: "#a0522d", rough: 0.85, metal: 0 },
  { key: "stone", label: "Stone cladding", color: "#b8aa94", rough: 0.8, metal: 0 },
  { key: "wood", label: "Wood", color: "#9b6b43", rough: 0.7, metal: 0 },
  { key: "aluminium", label: "Aluminium", color: "#c9ced2", rough: 0.3, metal: 0.8 },
  { key: "white", label: "White panels", color: "#f2f2f2", rough: 0.5, metal: 0 },
  { key: "dark", label: "Dark tint", color: "#263238", rough: 0.4, metal: 0.2 },
];

export function facadeOption(key: string): FacadeOption {
  return FACADES.find((f) => f.key === key) ?? FACADES[0];
}

/* -------------------------------- Interior types ----------------------------- */

export const INTERIOR_TYPES: { key: string; label: string }[] = [
  { key: "living", label: "Living room" },
  { key: "bedroom", label: "Bedroom" },
  { key: "kitchen", label: "Kitchen" },
  { key: "dining", label: "Dining room" },
  { key: "bathroom", label: "Bathroom" },
  { key: "balcony", label: "Balcony" },
  { key: "study", label: "Study" },
  { key: "utility", label: "Utility" },
  { key: "office", label: "Office space" },
  { key: "cubicle", label: "Cubicle" },
  { key: "meeting", label: "Meeting room" },
  { key: "pantry", label: "Food court / pantry" },
  { key: "reception", label: "Reception" },
  { key: "restroom", label: "Restroom" },
];

export function interiorLabel(type: string): string {
  return INTERIOR_TYPES.find((t) => t.key === type)?.label ?? type;
}

/* --------------------------------- Defaults --------------------------------- */

export function defaultUnderground(): UndergroundParking {
  return {
    levels: 1,
    floorHeight: 3,
    foundationDepth: 1.5,
    rampWidth: 3,
    rampLength: 30,
    rampSlope: 12,
    pillarSpacingX: 6,
    pillarSpacingZ: 6,
    bayWidth: 2.5,
    bayLength: 5,
    bayCols: 4,
    bayRows: 4,
    liftLobby: true,
    stairLobby: true,
  };
}

export function defaultTower(branch: BuildingBranch, label: string, x: number, z: number): TowerData {
  return {
    id: uid("tw"),
    label,
    x,
    z,
    floors: branch === "residential" ? 12 : 8,
    unitsPerFloor: branch === "residential" ? 4 : 8,
    unitWidth: branch === "residential" ? 7 : 6,
    unitDepth: branch === "residential" ? 9 : 8,
    floorHeight: 3.2,
    commonAreaPerFloor: 60,
    openAreaPerFloor: 30,
    doorFacing: "south",
    facadeMaterial: "glass",
    facadeColor: "#9ccfe4",
  };
}

export function defaultCommunity(branch: BuildingBranch): CommunityDesign {
  return {
    version: 1,
    branch,
    land: { unit: "m", width: 140, depth: 90 },
    parking: { mode: "underground", surfaceBays: 16, underground: defaultUnderground() },
    amenities: [
      makeAmenity("lawn", -40, -6),
      makeAmenity("swimming-pool", 24, -20),
      makeAmenity("kids-play", 40, 2),
      makeAmenity("clubhouse", 6, -18),
    ],
    towers: [
      defaultTower(branch, branch === "residential" ? "Tower A" : "Block A", -12, 16),
      defaultTower(branch, branch === "residential" ? "Tower B" : "Block B", 14, 18),
    ],
    exteriors: [],
    interiors: [],
  };
}

/* -------------------------------- Helpers ----------------------------------- */

export function towerMeters(t: TowerData): { w: number; d: number; h: number } {
  const unitsPerSide = Math.ceil(Math.sqrt(t.unitsPerFloor));
  const w = unitsPerSide * t.unitWidth + Math.sqrt(t.commonAreaPerFloor) * 0.4;
  const d = Math.ceil(t.unitsPerFloor / unitsPerSide) * t.unitDepth + Math.sqrt(t.commonAreaPerFloor) * 0.4;
  return { w, d, h: Math.max(t.floors, 1) * t.floorHeight };
}

export function undergroundDepth(p: UndergroundParking): number {
  return p.levels * p.floorHeight + p.foundationDepth;
}

export function makeRoom(towerId: string, floor: number, name: string, type: string): InteriorRoom {
  return {
    id: uid("rm"),
    towerId,
    floor,
    name,
    type,
    x: 0,
    z: 0,
    w: 4,
    d: 3.5,
    doorFacing: "south",
  };
}

export const DOOR_FACING_LABELS: Record<string, string> = {
  north: "North",
  east: "East",
  south: "South",
  west: "West",
};