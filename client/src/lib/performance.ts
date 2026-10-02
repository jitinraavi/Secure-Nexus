import type { Design } from "../types";

export type ModelSizeTier = "small" | "medium" | "large" | "enterprise";

export interface ModelPerformanceReport {
  tier: ModelSizeTier;
  estimatedComponents: number;
  estimatedTriangles: number;
  estimatedDrawCalls: number;
  serializationMs: number;
  jsonBytes: number;
  recommendations: string[];
  budgets: { targetFps: number; targetLoadMs: number; targetDrawCalls: number; targetMemoryMb: number };
}

const budgets: Record<ModelSizeTier, ModelPerformanceReport["budgets"]> = {
  small: { targetFps: 60, targetLoadMs: 1500, targetDrawCalls: 800, targetMemoryMb: 256 },
  medium: { targetFps: 45, targetLoadMs: 3000, targetDrawCalls: 1400, targetMemoryMb: 512 },
  large: { targetFps: 30, targetLoadMs: 6000, targetDrawCalls: 2200, targetMemoryMb: 1024 },
  enterprise: { targetFps: 24, targetLoadMs: 12000, targetDrawCalls: 3200, targetMemoryMb: 1536 },
};

export function estimateModelComponents(design: Design): number {
  let count = 6 + design.furniture.length + (design.mep?.elements.length ?? 0);
  const community = design.community;
  if (community) {
    count += community.amenities.length + (community.drafts?.length ?? 0) + community.exteriors.length + community.interiors.length + (community.mep?.elements.length ?? 0);
    for (const tower of community.towers) {
      count += 1 + tower.floors * Math.max(tower.unitsPerFloor, 1);
      count += tower.openings?.length ?? 0;
    }
    for (const room of community.interiors) count += (room.furniture?.length ?? 0) + (room.openings?.length ?? 0) + (room.mep?.elements.length ?? 0);
  }
  const infra = design.infra;
  if (infra) count += (infra.facilities?.length ?? 0) + (infra.drafts?.length ?? 0) + (infra.mep?.elements.length ?? 0);
  return count;
}

export function modelSizeTier(components: number): ModelSizeTier {
  if (components < 10_000) return "small";
  if (components < 50_000) return "medium";
  if (components < 100_000) return "large";
  return "enterprise";
}

export function benchmarkDesign(design: Design): ModelPerformanceReport {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const json = JSON.stringify(design);
  const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
  const estimatedComponents = estimateModelComponents(design);
  const tier = modelSizeTier(estimatedComponents);
  const estimatedTriangles = Math.round(estimatedComponents * 24);
  const estimatedDrawCalls = Math.max(1, Math.round(Math.sqrt(estimatedComponents) * 7));
  const recommendations: string[] = [];
  if (estimatedComponents >= 10_000) recommendations.push("Use chunked scene construction and progress UI.");
  if (estimatedComponents >= 25_000) recommendations.push("Move procedural generation and exchange parsing to Web Workers.");
  if (estimatedComponents >= 50_000) recommendations.push("Use spatial indexes, aggressive LOD and GPU instancing for repeated families.");
  if (estimatedComponents >= 100_000) recommendations.push("Stream disciplines/zones independently and enforce a memory budget.");
  return {
    tier,
    estimatedComponents,
    estimatedTriangles,
    estimatedDrawCalls,
    serializationMs: Math.max(0, ended - started),
    jsonBytes: new TextEncoder().encode(json).byteLength,
    recommendations,
    budgets: budgets[tier],
  };
}

export interface SpatialItem2D<T> { id: string; x: number; z: number; radius: number; value: T }

export class SpatialHash2D<T> {
  private readonly buckets = new Map<string, Map<string, SpatialItem2D<T>>>();
  private readonly items = new Map<string, SpatialItem2D<T>>();
  private readonly keys = new Map<string, string[]>();
  private readonly oversized = new Map<string, SpatialItem2D<T>>();
  private readonly cellSize: number;
  constructor(cellSize = 20) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error("Spatial cell size must be positive and finite.");
    this.cellSize = cellSize;
  }
  private cells(x: number, z: number, radius: number): string[] | null {
    const minX = Math.floor((x - radius) / this.cellSize), maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize), maxZ = Math.floor((z + radius) / this.cellSize);
    if (![minX, maxX, minZ, maxZ].every(Number.isSafeInteger) || (maxX - minX + 1) * (maxZ - minZ + 1) > 4096) return null;
    const keys: string[] = [];
    for (let ix = minX; ix <= maxX; ix++) for (let iz = minZ; iz <= maxZ; iz++) keys.push(`${ix}:${iz}`);
    return keys;
  }
  insert(item: SpatialItem2D<T>) {
    if (![item.x, item.z, item.radius].every(Number.isFinite) || item.radius < 0) throw new Error("Spatial item coordinates and radius must be finite; radius must be non-negative.");
    this.remove(item.id);
    const stored = { ...item };
    this.items.set(stored.id, stored);
    const keys = this.cells(stored.x, stored.z, stored.radius);
    if (!keys) { this.oversized.set(stored.id, stored); return; }
    this.keys.set(stored.id, keys);
    for (const key of keys) {
      const bucket = this.buckets.get(key) ?? new Map<string, SpatialItem2D<T>>();
      bucket.set(stored.id, stored); this.buckets.set(key, bucket);
    }
  }
  remove(id: string) {
    for (const key of this.keys.get(id) ?? []) {
      const bucket = this.buckets.get(key); bucket?.delete(id);
      if (bucket?.size === 0) this.buckets.delete(key);
    }
    this.keys.delete(id); this.items.delete(id); this.oversized.delete(id);
  }
  query(x: number, z: number, radius: number): SpatialItem2D<T>[] {
    if (![x, z, radius].every(Number.isFinite) || radius < 0) return [];
    const keys = this.cells(x, z, radius), candidates = new Map<string, SpatialItem2D<T>>();
    if (!keys) for (const item of this.items.values()) candidates.set(item.id, item);
    else {
      for (const item of this.oversized.values()) candidates.set(item.id, item);
      for (const key of keys) for (const item of this.buckets.get(key)?.values() ?? []) candidates.set(item.id, item);
    }
    return [...candidates.values()].filter(item => Math.hypot(item.x - x, item.z - z) <= radius + item.radius);
  }
  clear() { this.buckets.clear(); this.items.clear(); this.keys.clear(); this.oversized.clear(); }
}

export function recommendedLodDistance(componentRadius: number, tier: ModelSizeTier): number {
  const multiplier = tier === "small" ? 6 : tier === "medium" ? 4 : tier === "large" ? 3 : 2;
  return Math.max(30, componentRadius * multiplier);
}

