import * as THREE from "three";
import type { TerrainProfileAxis, TerrainSettings } from "../types";
import { material } from "./modelcore";

export const defaultTerrain: TerrainSettings = {
  enabled: true,
  baseElevationM: 0,
  reliefM: 3,
  contourIntervalM: 1,
  contoursVisible: true,
  profileAxis: "x",
  profileOffsetM: 0,
};

export function terrainSettings(value?: TerrainSettings): TerrainSettings {
  return { ...defaultTerrain, ...value };
}

/** A repeatable low-frequency surface for local studies, not survey data. */
export function terrainElevation(x: number, z: number, settings?: TerrainSettings): number {
  const t = terrainSettings(settings);
  const relief = Math.max(0, t.reliefM);
  return t.baseElevationM + relief * (
    Math.sin(x * 0.035) * 0.48 +
    Math.cos(z * 0.029) * 0.34 +
    Math.sin((x + z) * 0.018) * 0.18
  );
}

export interface TerrainProfile {
  minM: number;
  maxM: number;
  riseM: number;
  maxGradePct: number;
  samples: { distanceM: number; elevationM: number }[];
}

export function terrainProfile(width: number, depth: number, settings?: TerrainSettings): TerrainProfile {
  const t = terrainSettings(settings);
  const axis: TerrainProfileAxis = t.profileAxis;
  const length = axis === "x" ? width : depth;
  const fixed = Math.max(-((axis === "x" ? depth : width) / 2), Math.min((axis === "x" ? depth : width) / 2, t.profileOffsetM));
  const samples = Array.from({ length:  nineSamples }, (_, index) => {
    const distanceM = (length * index) / (nineSamples - 1);
    const along = distanceM - length / 2;
    const x = axis === "x" ? along : fixed;
    const z = axis === "x" ? fixed : along;
    return { distanceM, elevationM: terrainElevation(x, z, t) };
  });
  const elevations = samples.map((sample) => sample.elevationM);
  let maxGradePct = 0;
  for (let i = 1; i < samples.length; i++) {
    maxGradePct = Math.max(maxGradePct, Math.abs((samples[i].elevationM - samples[i - 1].elevationM) / (samples[i].distanceM - samples[i - 1].distanceM)) * 100);
  }
  return { minM: Math.min(...elevations), maxM: Math.max(...elevations), riseM: elevations[elevations.length - 1] - elevations[0], maxGradePct, samples };
}

const nineSamples = 9;

function contourSegments(width: number, depth: number, settings: TerrainSettings): THREE.Group {
  const g = new THREE.Group();
  const resolution = 24;
  const values = Array.from({ length: resolution + 1 }, (_, z) => Array.from({ length: resolution + 1 }, (_, x) => terrainElevation(x / resolution * width - width / 2, z / resolution * depth - depth / 2, settings)));
  const interval = Math.max(0.25, settings.contourIntervalM);
  const low = Math.floor((settings.baseElevationM - settings.reliefM) / interval) * interval;
  const high = Math.ceil((settings.baseElevationM + settings.reliefM) / interval) * interval;
  for (let level = low; level <= high + interval * 0.01; level += interval) {
    const addEdge = (points: THREE.Vector3[], a: THREE.Vector3, av: number, b: THREE.Vector3, bv: number) => {
      if ((av < level && bv >= level) || (bv < level && av >= level)) {
        const ratio = (level - av) / (bv - av || 1);
        points.push(a.clone().lerp(b, ratio));
      }
    };
    for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
      const points: THREE.Vector3[] = [];
      const p = (ix: number, iz: number) => new THREE.Vector3(ix / resolution * width - width / 2, level + 0.05, iz / resolution * depth - depth / 2);
      addEdge(points, p(x, z), values[z][x], p(x + 1, z), values[z][x + 1]);
      addEdge(points, p(x + 1, z), values[z][x + 1], p(x + 1, z + 1), values[z + 1][x + 1]);
      addEdge(points, p(x + 1, z + 1), values[z + 1][x + 1], p(x, z + 1), values[z + 1][x]);
      addEdge(points, p(x, z + 1), values[z + 1][x], p(x, z), values[z][x]);
      if (points.length >= 2) {
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.splice(0, 2)), new THREE.LineBasicMaterial({ color: 0xc6d68b, transparent: true, opacity: 0.62 })));
      }
    }
  }
  g.userData.noSelect = true;
  return g;
}

export function buildTerrainVisualization(width: number, depth: number, value?: TerrainSettings): THREE.Group {
  const settings = terrainSettings(value);
  const g = new THREE.Group();
  g.userData.noSelect = true;
  if (!settings.enabled) return g;
  const segments = 32;
  const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) positions.setY(i, terrainElevation(positions.getX(i), positions.getZ(i), settings));
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  const surface = new THREE.Mesh(geometry, material("#71805c", { rough: 1, trans: 0.28 }));
  surface.receiveShadow = true;
  g.add(surface);
  if (settings.contoursVisible) g.add(contourSegments(width, depth, settings));
  return g;
}
