import * as THREE from "three";

/**
 * Shared three.js primitives for the guided wizards.
 *
 * Only the helpers actually used by the community and infrastructure builders
 * live here now that the parametric studio modules are gone.
 */

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export function material(color: string, opts: { rough?: number; metal?: number; trans?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.rough ?? 0.8}|${opts.metal ?? 0}|${opts.trans ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.8,
      metalness: opts.metal ?? 0,
      transparent: opts.trans !== undefined && opts.trans < 1,
      opacity: opts.trans ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
}

export function prism(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.noSelect = true;
  return mesh;
}

export function prismAt(
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
): THREE.Mesh {
  const mesh = prism(w, h, d, mat);
  mesh.position.set(x, y, z);
  return mesh;
}
