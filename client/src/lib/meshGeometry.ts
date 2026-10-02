import * as THREE from "three";

export type Vec3 = [number, number, number];
export interface Bounds3 { min: Vec3; max: Vec3 }
export interface MeshMaterial { color: Vec3; emission: Vec3; model: "diffuse" | "mirror" | "glass"; ior: number }
export interface GeometryMesh {
  id: string; sourceId: string; positions: number[]; indices: number[]; material: MeshMaterial;
}
export interface GeometryScene {
  version: 1; units: "m"; meshes: GeometryMesh[];
  camera: { position: Vec3; target: Vec3; up: Vec3; fov: number };
  warnings: string[];
}
export interface Triangle { a: Vec3; b: Vec3; c: Vec3; mesh: number; bounds: Bounds3 }
export interface BvhNode { bounds: Bounds3; left?: BvhNode; right?: BvhNode; triangles?: number[] }
export const MAX_SCENE_TRIANGLES = 400_000;
export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function normalize3(a: Vec3): Vec3 { const n = Math.hypot(...a); if (n < 1e-15) throw new Error("Degenerate direction."); return scale3(a, 1 / n); }
export function boundsOf(points: Vec3[]): Bounds3 {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  return { min, max };
}
export function mergeBounds(a: Bounds3, b: Bounds3): Bounds3 {
  return { min: a.min.map((v, k) => Math.min(v, b.min[k])) as Vec3, max: a.max.map((v, k) => Math.max(v, b.max[k])) as Vec3 };
}
export function boundsOverlap(a: Bounds3, b: Bounds3, tolerance = 0): boolean {
  return a.min.every((v, k) => v <= b.max[k] + tolerance && b.min[k] <= a.max[k] + tolerance);
}
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export const validVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(x => typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1e8);

/** Parse externally supplied geometry before it reaches workers or GPU allocations. */
export function inspectGeometryScene(value: unknown): GeometryScene {
  if (!record(value) || value.version !== 1 || value.units !== "m" || !Array.isArray(value.meshes) || value.meshes.length > 100_000 || !record(value.camera)) throw new Error("Expected version 1 geometry in metres with a camera and at most 100,000 meshes.");
  const camera = value.camera;
  if (!validVec3(camera.position) || !validVec3(camera.target) || !validVec3(camera.up) || typeof camera.fov !== "number" || !Number.isFinite(camera.fov) || camera.fov <= 0 || camera.fov >= 175 || Math.hypot(...sub3(camera.target, camera.position)) < 1e-8 || Math.hypot(...cross3(sub3(camera.target, camera.position), camera.up)) < 1e-8) throw new Error("Invalid camera basis or field of view.");
  let count = 0;
  const ids = new Set<string>();
  const meshes = value.meshes.map((m): GeometryMesh => {
    if (!record(m) || typeof m.id !== "string" || !m.id || m.id.length > 240 || ids.has(m.id) || typeof m.sourceId !== "string" || m.sourceId.length > 240 || !Array.isArray(m.positions) || !Array.isArray(m.indices) || !record(m.material)) throw new Error("Invalid mesh identity or geometry.");
    ids.add(m.id);
    const positions: unknown[] = m.positions, indices: unknown[] = m.indices;
    count += indices.length / 3;
    if (count > MAX_SCENE_TRIANGLES || positions.length > MAX_SCENE_TRIANGLES * 9 || !positions.length || positions.length % 3 || !indices.length || indices.length % 3 || !positions.every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e8) || !indices.every(v => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v < positions.length / 3)) throw new Error("Mesh indices/positions are invalid or exceed the 400,000-triangle budget.");
    const material = m.material;
    if (!validVec3(material.color) || !validVec3(material.emission) || material.color.some(v => v < 0 || v > 1) || material.emission.some(v => v < 0 || v > 1e5) || !["diffuse", "mirror", "glass"].includes(String(material.model)) || typeof material.ior !== "number" || !Number.isFinite(material.ior) || material.ior < 1 || material.ior > 3) throw new Error("Invalid linear-RGB material.");
    return { id: m.id, sourceId: m.sourceId, positions: positions as number[], indices: indices as number[], material: { color: material.color, emission: material.emission, model: material.model as MeshMaterial["model"], ior: material.ior } };
  });
  return { version: 1, units: "m", meshes, camera: { position: camera.position, target: camera.target, up: camera.up, fov: camera.fov }, warnings: Array.isArray(value.warnings) ? value.warnings.filter((s): s is string => typeof s === "string").slice(0, 100).map(s => s.slice(0, 500)) : [] };
}

export function sceneTriangles(scene: GeometryScene): Triangle[] {
  const triangles: Triangle[] = [];
  scene.meshes.forEach((mesh, meshIndex) => {
    const vertex = (index: number): Vec3 => [mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]];
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = vertex(mesh.indices[i]), b = vertex(mesh.indices[i + 1]), c = vertex(mesh.indices[i + 2]);
      if (Math.hypot(...cross3(sub3(b, a), sub3(c, a))) <= 1e-15) continue;
      triangles.push({ a, b, c, mesh: meshIndex, bounds: boundsOf([a, b, c]) });
    }
  });
  return triangles;
}
export function buildBvh(triangles: Triangle[], indices = triangles.map((_, i) => i)): BvhNode | null {
  if (!indices.length) return null;
  let bounds = triangles[indices[0]].bounds;
  for (let i = 1; i < indices.length; i++) bounds = mergeBounds(bounds, triangles[indices[i]].bounds);
  if (indices.length <= 8) return { bounds, triangles: indices };
  let axis = 0;
  for (let k = 1; k < 3; k++) if (bounds.max[k] - bounds.min[k] > bounds.max[axis] - bounds.min[axis]) axis = k;
  indices.sort((a, b) => triangles[a].bounds.min[axis] + triangles[a].bounds.max[axis] - triangles[b].bounds.min[axis] - triangles[b].bounds.max[axis]);
  const mid = Math.floor(indices.length / 2);
  return { bounds, left: buildBvh(triangles, indices.slice(0, mid))!, right: buildBvh(triangles, indices.slice(mid))! };
}
export function rayBounds(origin: Vec3, direction: Vec3, bounds: Bounds3, maxDistance = Infinity): boolean {
  let low = 0, high = maxDistance;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(direction[k]) < 1e-15) { if (origin[k] < bounds.min[k] || origin[k] > bounds.max[k]) return false; continue; }
    let a = (bounds.min[k] - origin[k]) / direction[k], b = (bounds.max[k] - origin[k]) / direction[k];
    if (a > b) [a, b] = [b, a]; low = Math.max(low, a); high = Math.min(high, b);
    if (high < low) return false;
  }
  return true;
}
export function rayTriangle(origin: Vec3, direction: Vec3, triangle: Triangle, epsilon = 1e-9): number | null {
  const e1 = sub3(triangle.b, triangle.a), e2 = sub3(triangle.c, triangle.a), p = cross3(direction, e2), det = dot3(e1, p);
  if (Math.abs(det) <= 1e-15) return null;
  const inv = 1 / det, t = sub3(origin, triangle.a), u = dot3(t, p) * inv;
  if (u < -1e-12 || u > 1 + 1e-12) return null;
  const q = cross3(t, e1), v = dot3(direction, q) * inv;
  if (v < -1e-12 || u + v > 1 + 1e-12) return null;
  const distance = dot3(e2, q) * inv;
  return distance > epsilon ? distance : null;
}
export function nearestHit(origin: Vec3, direction: Vec3, triangles: Triangle[], root: BvhNode | null): { triangle: Triangle; distance: number } | null {
  let found: Triangle | null = null, distance = Infinity;
  const stack = root ? [root] : [];
  while (stack.length) {
    const node = stack.pop()!;
    if (!rayBounds(origin, direction, node.bounds, distance)) continue;
    if (node.triangles) for (const index of node.triangles) { const t = rayTriangle(origin, direction, triangles[index]); if (t !== null && t < distance) { distance = t; found = triangles[index]; } }
    else { if (node.left) stack.push(node.left); if (node.right) stack.push(node.right); }
  }
  return found ? { triangle: found, distance } : null;
}

/** Snapshot current visible geometry, including instance transforms; coordinates are world metres. */
export function snapshotThreeScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera, target: THREE.Vector3): GeometryScene {
  scene.updateMatrixWorld(true);
  const meshes: GeometryMesh[] = [], warnings = new Set<string>();
  let triangleCount = 0;
  const visible = (object: THREE.Object3D): boolean => { for (let p: THREE.Object3D | null = object; p; p = p.parent) if (!p.visible) return false; return true; };
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !visible(object)) return;
    if (object instanceof THREE.SkinnedMesh) { warnings.add("Skinned geometry excluded."); return; }
    if (object.geometry.morphAttributes.position?.length) { warnings.add("Morph geometry excluded."); return; }
    const geometry = object.geometry, position = geometry.getAttribute("position");
    if (!position) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: geometry.index?.count ?? position.count, materialIndex: 0 }];
    const instanceCount = object instanceof THREE.InstancedMesh ? object.count : 1;
    for (let instance = 0; instance < instanceCount; instance++) {
      const world = object.matrixWorld.clone();
      if (object instanceof THREE.InstancedMesh) { const transform = new THREE.Matrix4(); object.getMatrixAt(instance, transform); world.multiply(transform); }
      for (const [groupIndex, group] of groups.entries()) {
        const source = materials[group.materialIndex ?? 0];
        if (!source?.visible) continue;
        const start = Math.max(group.start, geometry.drawRange.start), end = Math.min(group.start + group.count, geometry.drawRange.start + geometry.drawRange.count, geometry.index?.count ?? position.count);
        if (end <= start) continue;
        const positions: number[] = [], indices: number[] = [], lookup = new Map<number, number>();
        for (let i = start; i + 2 < end; i += 3) {
          if (++triangleCount > MAX_SCENE_TRIANGLES) throw new Error("Viewport exceeds the 400,000-triangle export budget. Hide zones or select a smaller model.");
          for (let k = 0; k < 3; k++) {
            const original = geometry.index?.getX(i + k) ?? i + k;
            let mapped = lookup.get(original);
            if (mapped === undefined) {
              mapped = positions.length / 3; lookup.set(original, mapped);
              const v = new THREE.Vector3().fromBufferAttribute(position, original).applyMatrix4(world);
              positions.push(v.x, v.y, v.z);
            }
            indices.push(mapped);
          }
          if (world.determinant() < 0) { const n = indices.length; [indices[n - 2], indices[n - 1]] = [indices[n - 1], indices[n - 2]]; }
        }
        if (!indices.length) continue;
        const m = source as THREE.MeshStandardMaterial;
        const color = m.color?.clone() ?? new THREE.Color(0.7, 0.7, 0.7);
        if (object instanceof THREE.InstancedMesh && object.instanceColor) { const c = new THREE.Color(); object.getColorAt(instance, c); color.multiply(c); }
        const emission = m.emissive?.clone().multiplyScalar(m.emissiveIntensity ?? 1) ?? new THREE.Color(0, 0, 0);
        if (m.map || m.normalMap || m.alphaMap) warnings.add("Texture, normal and alpha maps are represented by constant material values.");
        if (m.clippingPlanes?.length) warnings.add("Section/clipping planes are not applied to the exported triangle geometry.");
        if (m.transparent || m.opacity < 1) warnings.add("Transparent materials require explicit glass assignment in scene JSON.");
        let parent: THREE.Object3D | null = object, sourceId = object.name || object.uuid;
        while (parent) { const id = parent.userData.id ?? parent.userData.selectId ?? parent.userData.itemId; if (typeof id === "string") { sourceId = id; break; } parent = parent.parent; }
        meshes.push({ id: `${object.uuid}:${instance}:${groupIndex}`, sourceId: sourceId.slice(0, 240), positions, indices, material: { color: [color.r, color.g, color.b].map(v => Math.max(0, Math.min(1, v))) as Vec3, emission: [emission.r, emission.g, emission.b], model: (m.metalness ?? 0) > 0.95 && (m.roughness ?? 1) < 0.05 ? "mirror" : "diffuse", ior: 1.5 } });
      }
    }
  });
  if (!meshes.length) throw new Error("No supported visible mesh geometry.");
  return inspectGeometryScene({ version: 1, units: "m", meshes, camera: { position: camera.position.toArray(), target: target.toArray(), up: camera.up.toArray(), fov: camera.fov }, warnings: [...warnings] });
}
