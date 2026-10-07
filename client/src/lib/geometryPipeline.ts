import * as THREE from "three";
import { inspectGeometryScene, validVec3, type Bounds3, type GeometryScene, type Vec3 } from "./meshGeometry";

export interface GeometryChunk { id: string; url: string; bounds: Bounds3; geometricErrorM: number; bytes: number; children: string[]; sha256?: string }
export interface GeometryManifest { version: 1; units: "m"; roots: string[]; chunks: GeometryChunk[] }
const plain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export function inspectGeometryManifest(value: unknown): GeometryManifest {
  if (!plain(value) || value.version !== 1 || value.units !== "m" || !Array.isArray(value.roots) || !Array.isArray(value.chunks) || value.chunks.length > 100_000 || value.roots.length > 10_000 || !value.roots.every(v => typeof v === "string")) throw new Error("Invalid streaming geometry manifest.");
  const ids = new Set<string>();
  const chunks = value.chunks.map((c): GeometryChunk => {
    if (!plain(c) || typeof c.id !== "string" || !c.id || c.id.length > 240 || ids.has(c.id) || typeof c.url !== "string" || c.url.length > 2000 || !plain(c.bounds) || !validVec3(c.bounds.min) || !validVec3(c.bounds.max) || typeof c.geometricErrorM !== "number" || !Number.isFinite(c.geometricErrorM) || c.geometricErrorM < 0 || typeof c.bytes !== "number" || !Number.isSafeInteger(c.bytes) || c.bytes <= 0 || c.bytes > 32_000_000 || !Array.isArray(c.children) || c.children.length > 16 || !c.children.every(v => typeof v === "string")) throw new Error("Invalid streaming chunk, bounds or byte budget.");
    if (c.sha256 !== undefined && (typeof c.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(c.sha256))) throw new Error("Chunk sha256 must be an exact lowercase 64-hex digest.");
    const min = c.bounds.min, max = c.bounds.max;
    if (min.some((v, k) => v > max[k])) throw new Error("Inverted chunk bounds.");
    ids.add(c.id); return { id: c.id, url: c.url, bounds: { min: c.bounds.min, max: c.bounds.max }, geometricErrorM: c.geometricErrorM, bytes: c.bytes, children: c.children as string[], ...(c.sha256 === undefined ? {} : { sha256: c.sha256 }) };
  });
  const lookup = new Map(chunks.map(c => [c.id, c])), parent = new Map<string, string>(), active = new Set<string>(), visited = new Set<string>();
  const visit = (id: string, depth: number) => {
    if (depth > 32 || active.has(id) || visited.has(id)) throw new Error("Chunk tree contains a cycle, repeated root or excessive depth.");
    const c = lookup.get(id); if (!c) throw new Error(`Unknown chunk ${id}.`);
    active.add(id); visited.add(id);
    for (const childId of c.children) {
      const child = lookup.get(childId); if (!child || parent.has(childId)) throw new Error("Chunk has missing or multiple parents.");
      if (child.geometricErrorM > c.geometricErrorM || child.bounds.min.some((v, k) => v < c.bounds.min[k] - 1e-6 || child.bounds.max[k] > c.bounds.max[k] + 1e-6)) throw new Error("Children must fit the parent bounds and refine its geometric error.");
      parent.set(childId, id); visit(childId, depth + 1);
    }
    active.delete(id);
  };
  for (const root of value.roots as string[]) visit(root, 0);
  if (visited.size !== chunks.length) throw new Error("Manifest contains unreachable chunks.");
  return { version: 1, units: "m", roots: value.roots as string[], chunks };
}

export function selectGeometryChunks(manifest: GeometryManifest, camera: THREE.PerspectiveCamera, viewportHeight: number, errorPixels = 3): GeometryChunk[] {
  if (!Number.isFinite(errorPixels) || errorPixels < 0.25 || !Number.isFinite(viewportHeight) || viewportHeight <= 0) throw new Error("Invalid screen-error budget.");
  camera.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)), lookup = new Map(manifest.chunks.map(c => [c.id, c])), selected: GeometryChunk[] = [], stack = [...manifest.roots];
  const scale = viewportHeight / (2 * Math.tan(camera.fov * Math.PI / 360));
  while (stack.length) {
    const chunk = lookup.get(stack.pop()!)!, box = new THREE.Box3(new THREE.Vector3(...chunk.bounds.min), new THREE.Vector3(...chunk.bounds.max));
    if (!frustum.intersectsBox(box)) continue;
    const distance = Math.max(camera.near, box.distanceToPoint(camera.position)), error = chunk.geometricErrorM * scale / distance;
    if (error > errorPixels && chunk.children.length) stack.push(...chunk.children);
    else selected.push(chunk);
  }
  return selected;
}

/** Authenticated same-origin chunk loader, bounded decoded cache and abortable streaming reads. */
export class GeometryChunkCache {
  private entries = new Map<string, { scene: GeometryScene; bytes: number; descriptor: string }>();
  private used = 0;
  private generation = 0;
  constructor(readonly budgetBytes = 128 * 1024 * 1024) { if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 1_000_000 || budgetBytes > 512 * 1024 * 1024) throw new Error("Invalid cache memory budget."); }
  get bytes() { return this.used; }
  clear() { this.generation++; this.entries.clear(); this.used = 0; }
  async load(chunk: GeometryChunk, signal: AbortSignal, pinned: Set<string>): Promise<GeometryScene> {
    const cancelled = () => { if (signal.aborted) throw new DOMException("Geometry chunk loading cancelled.", "AbortError"); };
    cancelled(); const generation = this.generation;
    // Capture every descriptor field before the first await so callers cannot retarget an in-flight request.
    const captured: GeometryChunk = { id: chunk.id, url: chunk.url, bounds: { min: [...chunk.bounds.min] as Vec3, max: [...chunk.bounds.max] as Vec3 }, geometricErrorM: chunk.geometricErrorM, bytes: chunk.bytes, children: [...chunk.children], ...(chunk.sha256 === undefined ? {} : { sha256: chunk.sha256 }) };
    if (captured.sha256 !== undefined && (typeof captured.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(captured.sha256))) throw new Error("Chunk sha256 must be an exact lowercase 64-hex digest.");
    const url = new URL(captured.url, location.href); if (url.origin !== location.origin || !["http:", "https:"].includes(url.protocol)) throw new Error("Geometry chunks must use the current application origin.");
    const descriptor = JSON.stringify({ ...captured, url: url.href });
    const cached = this.entries.get(captured.id);
    if (cached?.descriptor === descriptor) { cancelled(); this.entries.delete(captured.id); this.entries.set(captured.id, cached); return cached.scene; }
    if (cached) { this.entries.delete(captured.id); this.used -= cached.bytes; }
    const response = await fetch(url, { credentials: "same-origin", signal }); cancelled();
    if (!response.ok || !response.body || response.url && new URL(response.url).origin !== location.origin) { await response.body?.cancel().catch(() => undefined); throw new Error(`Chunk ${captured.id} could not be loaded (${response.status}).`); }
    const reader = response.body.getReader(), buffers: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) { cancelled(); const next = await reader.read(); cancelled(); if (next.done) break; bytes += next.value.byteLength; if (bytes > captured.bytes || bytes > 32_000_000) throw new Error("Chunk exceeds its declared byte limit."); buffers.push(next.value); }
    } finally { await reader.cancel().catch(() => undefined); }
    cancelled();
    if (captured.sha256 !== undefined && bytes !== captured.bytes) throw new Error("Hashed chunk byte count differs from its exact declared size.");
    const content = new Uint8Array(bytes); let offset = 0; for (const buffer of buffers) { content.set(buffer, offset); offset += buffer.length; }
    if (captured.sha256 !== undefined) {
      if (!globalThis.crypto?.subtle) throw new Error("Hashed geometry chunks require Web Crypto in a secure context.");
      const hash = await globalThis.crypto.subtle.digest("SHA-256", content); cancelled();
      const actual = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
      if (actual !== captured.sha256) throw new Error("Geometry chunk SHA-256 does not match its manifest.");
    }
    cancelled();
    const scene = inspectGeometryScene(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)));
    for (const mesh of scene.meshes) for (let i = 0; i < mesh.positions.length; i += 3) for (let k = 0; k < 3; k++) if (mesh.positions[i + k] < captured.bounds.min[k] - 1e-6 || mesh.positions[i + k] > captured.bounds.max[k] + 1e-6) throw new Error("Chunk geometry falls outside its declared bounds.");
    // Cache-owned data stays immutable after byte-integrity validation.
    for (const mesh of scene.meshes) { Object.freeze(mesh.positions); Object.freeze(mesh.indices); Object.freeze(mesh.material.color); Object.freeze(mesh.material.emission); Object.freeze(mesh.material); Object.freeze(mesh); }
    Object.freeze(scene.meshes); Object.freeze(scene.camera.position); Object.freeze(scene.camera.target); Object.freeze(scene.camera.up); Object.freeze(scene.camera); Object.freeze(scene.warnings); Object.freeze(scene);
    // Ordinary JS numeric arrays have implementation-dependent overhead: conservatively reserve 16 bytes/value plus strings.
    const decoded = scene.meshes.reduce((sum, m) => sum + 16 * (m.positions.length + m.indices.length) + 2 * (m.id.length + m.sourceId.length) + 2048, 2048 + scene.warnings.reduce((sum, warning) => sum + 2 * warning.length, 0));
    if (decoded > this.budgetBytes) throw new Error("Decoded chunk exceeds the cache budget.");
    cancelled(); if (generation !== this.generation) throw new Error("Geometry cache was cleared while this chunk was loading.");
    // Concurrent loads of the same id must not replace an entry while counting its memory twice.
    const existing = this.entries.get(captured.id);
    if (existing?.descriptor === descriptor) { cancelled(); this.entries.delete(captured.id); this.entries.set(captured.id, existing); return existing.scene; }
    if (existing) { this.entries.delete(captured.id); this.used -= existing.bytes; }
    for (const [id, entry] of this.entries) { if (this.used + decoded <= this.budgetBytes) break; if (!pinned.has(id)) { this.entries.delete(id); this.used -= entry.bytes; } }
    if (this.used + decoded > this.budgetBytes) throw new Error("Visible chunks exceed the cache budget; use coarser LOD.");
    cancelled(); if (generation !== this.generation) throw new Error("Geometry cache was cleared while this chunk was loading.");
    this.entries.set(captured.id, { scene, bytes: decoded, descriptor }); this.used += decoded; return scene;
  }
}

/** Allocated attribute/index and known texture storage; driver/render-target overhead is excluded. */
export function sceneAllocationBytes(root: THREE.Object3D): { geometryBytes: number; textureBytes: number; unmeasuredTextures: number } {
  const arrays = new Set<ArrayBufferLike>(), textures = new Set<THREE.Texture>(); let geometryBytes = 0, textureBytes = 0, unmeasuredTextures = 0;
  const count = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => { const buffer = attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array.buffer : attribute.array.buffer; if (!arrays.has(buffer)) { arrays.add(buffer); geometryBytes += buffer.byteLength; } };
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const attribute of Object.values(object.geometry.attributes)) {
      if (attribute instanceof THREE.BufferAttribute || attribute instanceof THREE.InterleavedBufferAttribute) count(attribute);
    }
    if (object.geometry.index) count(object.geometry.index);
    if (object instanceof THREE.InstancedMesh) { count(object.instanceMatrix); if (object.instanceColor) count(object.instanceColor); }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
  });
  for (const texture of textures) {
    const image = texture.image as { width?: number; height?: number; data?: ArrayBufferView } | undefined;
    if (image?.data) textureBytes += image.data.byteLength;
    else if (image?.width && image.height) textureBytes += image.width * image.height * 4 * (texture.generateMipmaps ? 4 / 3 : 1);
    else unmeasuredTextures++;
  }
  return { geometryBytes, textureBytes: Math.ceil(textureBytes), unmeasuredTextures };
}

export function geometryGroup(scene: GeometryScene): THREE.Group {
  const group = new THREE.Group(), origin = sceneCenter(scene);
  // Rebase before float32 allocation; world survey coordinates stay in the
  // double-precision object/camera transforms rather than every GPU vertex.
  group.position.fromArray(origin);
  for (const mesh of scene.meshes) {
    const local = mesh.positions.map((value, index) => value - origin[index % 3]);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(local, 3)); geometry.setIndex(mesh.indices); geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(...mesh.material.color), emissive: new THREE.Color(...mesh.material.emission), side: THREE.DoubleSide, metalness: mesh.material.model === "mirror" ? 1 : 0, roughness: mesh.material.model === "mirror" ? 0 : 0.7 });
    const object = new THREE.Mesh(geometry, material); object.userData.id = mesh.sourceId; group.add(object);
  }
  return group;
}
export function disposeGeometryGroup(group: THREE.Object3D) { group.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose(); } }); }
export function sceneCenter(scene: GeometryScene): Vec3 { const bounds = new THREE.Box3().makeEmpty(); for (const mesh of scene.meshes) for (let i = 0; i < mesh.positions.length; i += 3) bounds.expandByPoint(new THREE.Vector3(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2])); return bounds.isEmpty() ? [0, 0, 0] : bounds.getCenter(new THREE.Vector3()).toArray() as Vec3; }


