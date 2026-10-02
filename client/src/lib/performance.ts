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
  private readonly buckets = new Map<string, SpatialItem2D<T>[]>();
  constructor(private readonly cellSize = 20) {}
  insert(item: SpatialItem2D<T>) {
    const minX = Math.floor((item.x - item.radius) / this.cellSize);
    const maxX = Math.floor((item.x + item.radius) / this.cellSize);
    const minZ = Math.floor((item.z - item.radius) / this.cellSize);
    const maxZ = Math.floor((item.z + item.radius) / this.cellSize);
    for (let ix = minX; ix <= maxX; ix += 1) for (let iz = minZ; iz <= maxZ; iz += 1) {
      const key = `${ix}:${iz}`;
      const bucket = this.buckets.get(key) ?? [];
      bucket.push(item);
      this.buckets.set(key, bucket);
    }
  }
  query(x: number, z: number, radius: number): SpatialItem2D<T>[] {
    const found = new Map<string, SpatialItem2D<T>>();
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize);
    const maxZ = Math.floor((z + radius) / this.cellSize);
    for (let ix = minX; ix <= maxX; ix += 1) for (let iz = minZ; iz <= maxZ; iz += 1) {
      for (const item of this.buckets.get(`${ix}:${iz}`) ?? []) {
        const limit = radius + item.radius;
        if ((item.x - x) ** 2 + (item.z - z) ** 2 <= limit ** 2) found.set(item.id, item);
      }
    }
    return [...found.values()];
  }
  clear() { this.buckets.clear(); }
}

export function recommendedLodDistance(componentRadius: number, tier: ModelSizeTier): number {
  const multiplier = tier === "small" ? 6 : tier === "medium" ? 4 : tier === "large" ? 3 : 2;
  return Math.max(30, componentRadius * multiplier);
}
