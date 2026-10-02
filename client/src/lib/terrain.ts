import * as THREE from "three";
import type { TerrainSample, TerrainSettings } from "../types";
import { material } from "./modelcore";

export const MAX_SURVEY_POINTS = 2000;
export const defaultTerrain: TerrainSettings = {
  enabled: true, baseElevationM: 0, reliefM: 3, contourIntervalM: 1,
  contoursVisible: true, profileAxis: "x", profileOffsetM: 0,
  source: "procedural", projectCrs: "LOCAL",
  localOriginEasting: 0, localOriginNorthing: 0, samples: [],
};
const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback;

export function terrainSettings(value?: TerrainSettings): TerrainSettings {
  const t = { ...defaultTerrain, ...value };
  return {
    ...t, baseElevationM: finite(t.baseElevationM, 0),
    reliefM: Math.min(50, Math.max(0, finite(t.reliefM, 3))),
    contourIntervalM: Math.min(20, Math.max(0.25, finite(t.contourIntervalM, 1))),
    profileOffsetM: finite(t.profileOffsetM, 0),
    localOriginEasting: finite(t.localOriginEasting, 0),
    localOriginNorthing: finite(t.localOriginNorthing, 0),
  };
}

export interface TerrainTriangle { a: TerrainSample; b: TerrainSample; c: TerrainSample }
type IndexTriangle = { a: number; b: number; c: number };
const tinCache = new WeakMap<TerrainSample[], TerrainTriangle[]>();
const cross = (a: TerrainSample, b: TerrainSample, c: TerrainSample) =>
  (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

/** Unconstrained Delaunay TIN in the convex hull. Breaklines and holes are not modeled. */
export function buildSurveyTin(settings?: TerrainSettings): TerrainTriangle[] {
  const source = settings?.samples ?? defaultTerrain.samples!;
  const cached = tinCache.get(source);
  if (cached) return cached;
  if (source.length > MAX_SURVEY_POINTS) throw new Error(`TIN supports at most ${MAX_SURVEY_POINTS} points. Reduce the survey before importing.`);
  const unique = new Map<string, TerrainSample>();
  for (const p of source) {
    if ([p.x, p.z, p.elevationM].every(Number.isFinite)) unique.set(`${p.x}:${p.z}`, p);
  }
  const points = [...unique.values()].sort((a, b) => a.x - b.x || a.z - b.z);
  const count = points.length;
  if (count < 3) { tinCache.set(source, []); return []; }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const span = Math.max(maxX - minX, maxZ - minZ, 1);
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  // Normalize plan coordinates for circumcircle stability at large survey eastings.
  const normalized = points.map(p => ({ ...p, x: (p.x - cx) / span, z: (p.z - cz) / span }));
  normalized.push({ x: -32, z: -16, elevationM: 0 }, { x: 32, z: -16, elevationM: 0 }, { x: 0, z: 32, elevationM: 0 });
  let triangles: IndexTriangle[] = [{ a: count, b: count + 1, c: count + 2 }];
  const contains = (t: IndexTriangle, p: TerrainSample) => {
    const a = normalized[t.a], b = normalized[t.b], c = normalized[t.c];
    const ax = a.x - p.x, az = a.z - p.z, bx = b.x - p.x, bz = b.z - p.z, dx = c.x - p.x, dz = c.z - p.z;
    const det = (ax * ax + az * az) * (bx * dz - dx * bz)
      - (bx * bx + bz * bz) * (ax * dz - dx * az)
      + (dx * dx + dz * dz) * (ax * bz - bx * az);
    return cross(a, b, c) > 0 ? det > 1e-12 : det < -1e-12;
  };
  for (let i = 0; i < count; i++) {
    const edges = new Map<string, [number, number]>();
    const kept: IndexTriangle[] = [];
    for (const t of triangles) {
      if (!contains(t, normalized[i])) { kept.push(t); continue; }
      for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        if (edges.has(key)) edges.delete(key); else edges.set(key, [a, b]);
      }
    }
    for (const [a, b] of edges.values()) {
      if (Math.abs(cross(normalized[a], normalized[b], normalized[i])) > 1e-12) kept.push({ a, b, c: i });
    }
    triangles = kept;
  }
  const result = triangles.filter(t => t.a < count && t.b < count && t.c < count)
    .map(t => cross(points[t.a], points[t.b], points[t.c]) > 0
      ? { a: points[t.a], b: points[t.b], c: points[t.c] }
      : { a: points[t.a], b: points[t.c], c: points[t.b] });
  tinCache.set(source, result);
  return result;
}

function surveyElevation(x: number, z: number, samples: TerrainSample[]): number | null {
  for (const { a, b, c } of buildSurveyTin({ ...defaultTerrain, samples })) {
    const denominator = cross(a, b, c);
    const point = { x, z, elevationM: 0 };
    const wa = cross(point, b, c) / denominator, wb = cross(a, point, c) / denominator;
    const wc = 1 - wa - wb;
    if (wa >= -1e-8 && wb >= -1e-8 && wc >= -1e-8) return wa * a.elevationM + wb * b.elevationM + wc * c.elevationM;
  }
  // Outside the convex hull (or for collinear surveys), use nearest-eight IDW.
  // Maintain only eight candidates rather than sorting the entire survey per query.
  const nearest: { p: TerrainSample; d2: number }[] = [];
  for (const p of samples) {
    if (![p.x, p.z, p.elevationM].every(Number.isFinite)) continue;
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d2 < 1e-12) return p.elevationM;
    if (nearest.length < 8 || d2 < nearest[nearest.length - 1].d2) {
      nearest.push({ p, d2 }); nearest.sort((a, b) => a.d2 - b.d2); if (nearest.length > 8) nearest.pop();
    }
  }
  let weighted = 0, weights = 0;
  for (const { p, d2 } of nearest) { weighted += p.elevationM / d2; weights += 1 / d2; }
  return weights ? weighted / weights : null;
}

export function terrainElevation(x: number, z: number, settings?: TerrainSettings): number {
  const t = terrainSettings(settings);
  if (t.source === "survey" && t.samples?.length) {
    const elevation = surveyElevation(x, z, t.samples);
    if (elevation !== null) return elevation;
  }
  return t.baseElevationM + t.reliefM * (Math.sin(x * 0.035) * 0.48 + Math.cos(z * 0.029) * 0.34 + Math.sin((x + z) * 0.018) * 0.18);
}

export interface TerrainProfile {
  minM: number; maxM: number; riseM: number; maxGradePct: number;
  samples: { distanceM: number; elevationM: number }[];
}
export function terrainProfile(width: number, depth: number, settings?: TerrainSettings): TerrainProfile {
  const t = terrainSettings(settings);
  const length = Math.max(0.01, finite(t.profileAxis === "x" ? width : depth, 1));
  const other = Math.max(0.01, finite(t.profileAxis === "x" ? depth : width, 1));
  const fixed = Math.max(-other / 2, Math.min(other / 2, t.profileOffsetM));
  const samples = Array.from({ length: 33 }, (_, i) => {
    const distanceM = length * i / 32, along = distanceM - length / 2;
    return { distanceM, elevationM: terrainElevation(t.profileAxis === "x" ? along : fixed, t.profileAxis === "x" ? fixed : along, t) };
  });
  let minM = Infinity, maxM = -Infinity, maxGradePct = 0;
  samples.forEach((p, i) => {
    minM = Math.min(minM, p.elevationM); maxM = Math.max(maxM, p.elevationM);
    if (i) maxGradePct = Math.max(maxGradePct, Math.abs(p.elevationM - samples[i - 1].elevationM) / (length / 32) * 100);
  });
  return { minM, maxM, riseM: samples[32].elevationM - samples[0].elevationM, maxGradePct, samples };
}

/** Shared surface triangles for rendering, contours, slope reporting and LandXML. */
export function terrainTriangles(width: number, depth: number, value?: TerrainSettings): TerrainTriangle[] {
  const t = terrainSettings(value);
  if (t.source === "survey" && t.samples?.length) return buildSurveyTin(t);
  const w = Math.max(0.01, finite(width, 100)), d = Math.max(0.01, finite(depth, 100)), resolution = 24;
  const points = Array.from({ length: resolution + 1 }, (_, iz) => Array.from({ length: resolution + 1 }, (_, ix) => {
    const x = w * ix / resolution - w / 2, z = d * iz / resolution - d / 2;
    return { x, z, elevationM: terrainElevation(x, z, t) };
  }));
  const triangles: TerrainTriangle[] = [];
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
    const a = points[z][x], b = points[z][x + 1], c = points[z + 1][x + 1], e = points[z + 1][x];
    triangles.push({ a, b, c }, { a, b: c, c: e });
  }
  return triangles;
}

export function terrainSlopeSummary(triangles: TerrainTriangle[]) {
  let areaM2 = 0, weightedSlope = 0, maxSlopePct = 0;
  for (const { a, b, c } of triangles) {
    const det = cross(a, b, c), area = Math.abs(det) / 2;
    if (area < 1e-12) continue;
    const dx = ((b.elevationM - a.elevationM) * (c.z - a.z) - (c.elevationM - a.elevationM) * (b.z - a.z)) / det;
    const dz = ((b.x - a.x) * (c.elevationM - a.elevationM) - (c.x - a.x) * (b.elevationM - a.elevationM)) / det;
    const slope = Math.hypot(dx, dz) * 100;
    areaM2 += area; weightedSlope += slope * area; maxSlopePct = Math.max(maxSlopePct, slope);
  }
  return { areaM2, meanSlopePct: areaM2 ? weightedSlope / areaM2 : 0, maxSlopePct };
}

export function buildTerrainVisualization(width: number, depth: number, value?: TerrainSettings): THREE.Group {
  const settings = terrainSettings(value), group = new THREE.Group();
  group.userData.noSelect = true;
  if (!settings.enabled) return group;
  const triangles = terrainTriangles(width, depth, settings);
  const vertices: number[] = [], contours: number[] = [];
  let low = Infinity, high = -Infinity;
  for (const { a, b, c } of triangles) {
    // Plan coordinates use north-positive Z; reverse winding for upward-facing normals.
    for (const p of [a, c, b]) { vertices.push(p.x, p.elevationM, p.z); low = Math.min(low, p.elevationM); high = Math.max(high, p.elevationM); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  const surface = new THREE.Mesh(geometry, material("#71805c", { rough: 1, trans: 0.28 }));
  surface.receiveShadow = true; group.add(surface);
  if (settings.contoursVisible && Number.isFinite(low)) {
    // Bound contour density and batch all segments into one draw call.
    const interval = Math.max(settings.contourIntervalM, (high - low) / 200);
    for (let level = Math.ceil(low / interval) * interval; level <= high; level += interval) {
      for (const { a, b, c } of triangles) {
        const intersections: number[][] = [];
        for (const [p, q] of [[a, b], [b, c], [c, a]]) {
          if ((p.elevationM < level && q.elevationM >= level) || (q.elevationM < level && p.elevationM >= level)) {
            const ratio = (level - p.elevationM) / (q.elevationM - p.elevationM);
            intersections.push([p.x + ratio * (q.x - p.x), level + 0.05, p.z + ratio * (q.z - p.z)]);
          }
        }
        if (intersections.length === 2) contours.push(...intersections[0], ...intersections[1]);
      }
    }
    const lines = new THREE.BufferGeometry();
    lines.setAttribute("position", new THREE.Float32BufferAttribute(contours, 3));
    group.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: 0xc6d68b, transparent: true, opacity: 0.62 })));
  }
  return group;
}

export function parseTerrainCsv(csv: string): TerrainSample[] {
  const samples: TerrainSample[] = [];
  for (const [index, raw] of csv.replace(/\r\n?/g, "\n").split("\n").entries()) {
    const line = raw.trim().replace(/^\uFEFF/, "");
    if (!line || /^#/.test(line) || /^(x|easting)[,;\t]/i.test(line)) continue;
    const parts = line.split(/[,;\t]/).map(v => v.trim());
    if (parts.length !== 3 || parts.some(v => !v || !Number.isFinite(Number(v)))) throw new Error(`Invalid survey row ${index + 1}; expected x,z,elevation in metres.`);
    samples.push({ x: Number(parts[0]), z: Number(parts[1]), elevationM: Number(parts[2]) });
    if (samples.length > MAX_SURVEY_POINTS) throw new Error(`Import at most ${MAX_SURVEY_POINTS} points per terrain study.`);
  }
  if (samples.length < 3) throw new Error("At least three survey points are required.");
  if (!buildSurveyTin({ ...defaultTerrain, samples }).length) throw new Error("Survey points must span a surface; collinear points cannot form a TIN.");
  return samples;
}

export interface CutFillSummary { cutM3: number; fillM3: number; netM3: number; sampledCells: number }
export function estimateCutFill(width: number, depth: number, settings: TerrainSettings | undefined, designElevationM: number, resolution = 30): CutFillSummary {
  if (![width, depth, designElevationM].every(Number.isFinite) || width <= 0 || depth <= 0) return { cutM3: 0, fillM3: 0, netM3: 0, sampledCells: 0 };
  const cells = Math.max(1, Math.min(100, Math.floor(finite(resolution, 30))));
  const dx = width / cells, dz = depth / cells, area = dx * dz;
  let cutM3 = 0, fillM3 = 0;
  for (let x = 0; x < cells; x++) for (let z = 0; z < cells; z++) {
    const delta = terrainElevation(-width / 2 + (x + 0.5) * dx, -depth / 2 + (z + 0.5) * dz, settings) - designElevationM;
    if (delta > 0) cutM3 += delta * area; else fillM3 += -delta * area;
  }
  return { cutM3, fillM3, netM3: fillM3 - cutM3, sampledCells: cells * cells };
}

