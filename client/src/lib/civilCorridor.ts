import * as THREE from "three";
import type { InfraDesign } from "../types";
import { analyzeCivilAlignment, civilSettings, civilStationNormal } from "./civil";

/** Study overlay from the same stations and elevations as civil quantities/exports. */
export function buildCivilCorridor(infra: InfraDesign): THREE.Group {
  const group = new THREE.Group();
  group.userData.noSelect = true;
  const settings = civilSettings(infra), report = analyzeCivilAlignment(infra);
  if (report.stations.length < 2 || report.stations.length > 12200) return group;
  const positions: number[] = [], indices: number[] = [], edges: number[] = [];
  report.stations.forEach((station, index) => {
    const normal = civilStationNormal(report.stations, index);
    for (const offset of [-settings.corridorWidthM / 2, 0, settings.corridorWidthM / 2]) positions.push(station.x + offset * normal.x, station.designElevationM - Math.abs(offset) * settings.crossfallPct / 100 + 0.04, station.z + offset * normal.z);
    if (index) for (const offset of [0, 1, 2]) {
      const previous = (index - 1) * 9 + offset * 3, current = index * 9 + offset * 3;
      edges.push(...positions.slice(previous, previous + 3), ...positions.slice(current, current + 3));
    }
    if (index < report.stations.length - 1) for (const strip of [0, 1]) {
      const current = index * 3 + strip, next = current + 3;
      indices.push(current, current + 1, next, current + 1, next + 1, next);
    }
  });
  if (!positions.every(value => Number.isFinite(value) && Math.abs(value) <= 1e7)) return group;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  const surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: "#22d3ee", transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
  surface.userData.noSelect = true; surface.renderOrder = 4; group.add(surface);
  const lines = new THREE.BufferGeometry(); lines.setAttribute("position", new THREE.Float32BufferAttribute(edges, 3));
  const outline = new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: "#67e8f9", depthTest: false, transparent: true, opacity: 0.8 }));
  outline.userData.noSelect = true; outline.renderOrder = 5; group.add(outline);
  return group;
}
