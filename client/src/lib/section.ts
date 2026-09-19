import * as THREE from "three";
import type { SectionSettings } from "../types";

export function sectionClippingPlanes(section?: SectionSettings): THREE.Plane[] {
  if (!section?.enabled) return [];
  const axis = section.axis === "x" ? new THREE.Vector3(1, 0, 0) : section.axis === "z" ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const start = Number.isFinite(section.offset) ? section.offset : 0;
  const end = start + Math.max(Number.isFinite(section.depth) ? section.depth : 0.1, 0.1);
  return [new THREE.Plane(axis, -start), new THREE.Plane(axis.clone().negate(), end)];
}
