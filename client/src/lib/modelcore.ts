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

/** Adds lightweight CAD-style silhouette edges without affecting picking. */
export function addTechnicalEdges(root: THREE.Object3D, color = "#263746", opacity = 0.62): void {
  const additions: { parent: THREE.Object3D; edges: THREE.LineSegments }[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.noTechnicalEdges || !mesh.geometry) return;
    const type = mesh.geometry.type;
    if (type !== "BoxGeometry" && type !== "CylinderGeometry" && type !== "ConeGeometry") return;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 18),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: true }),
    );
    edges.userData.noSelect = true;
    edges.userData.noTechnicalEdges = true;
    edges.renderOrder = 2;
    edges.position.copy(mesh.position);
    edges.rotation.copy(mesh.rotation);
    edges.scale.copy(mesh.scale);
    if (mesh.parent) additions.push({ parent: mesh.parent, edges });
  });
  for (const addition of additions) addition.parent.add(addition.edges);
}

/** Release per-build GPU resources while leaving the shared material cache valid. */
export function disposeObject3D(root: THREE.Object3D, disposeMaterials = true): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of list) {
      materials.add(mat);
      const texture = (mat as THREE.MeshStandardMaterial).map;
      texture?.dispose();
    }
  });
  for (const geometry of geometries) geometry.dispose();
  if (disposeMaterials) for (const material of materials) material.dispose();
}
