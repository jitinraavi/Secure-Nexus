import { inspectGeometryScene, MAX_SCENE_TRIANGLES, type Bounds3, type GeometryMesh, type GeometryScene, type MeshMaterial, type Vec3 } from "./meshGeometry";
import { inspectGeometryManifest, type GeometryManifest } from "./geometryPipeline";
import type { WorkspaceArtifact } from "./workspaceApi";

/** Whole-mesh exact partitions. These limits deliberately fit the current workspace reference contract. */
export const GEOMETRY_PRODUCTION_LIMITS = Object.freeze({ maxChunks: 14, maxMeshes: 4096, maxNumericEntries: 4_000_000, sourceBytes: 32_000_000, sourceDecodedBytes: 64 * 1024 * 1024, chunkBytes: 8 * 1024 * 1024, chunkDecodedBytes: 8 * 1024 * 1024, provenanceBytes: 2 * 1024 * 1024, yieldEntries: 4096 });
export interface GeometrySourceContext { label: string; projectId: string | null; sourceRevision: number | null }
export interface GeometryProductionOptions { signal?: AbortSignal; context?: GeometrySourceContext; onProgress?: (progress: { stage: "capture" | "hash" | "partition"; completedMeshes: number; totalMeshes: number }) => void }
export interface ProducedGeometryChunk { readonly id: string; readonly name: string; readonly bounds: Bounds3; readonly scene: GeometryScene; readonly blob: Blob; readonly bytes: number; readonly decodedBytes: number; readonly sha256: string; readonly meshIds: readonly string[] }
export interface ProducedGeometryChunks {
  readonly version: 1; readonly kind: "exact-geometry-partition"; readonly algorithm: "whole-mesh-input-order-v1";
  readonly sourceScene: GeometryScene; readonly source: { readonly name: string; readonly blob: Blob; readonly bytes: number; readonly sha256: string; readonly decodedBytes: number; readonly triangles: number; readonly numericEntries: number; readonly context: GeometrySourceContext };
  readonly chunks: readonly ProducedGeometryChunk[];
}
export interface BoundGeometryChunkPackage {
  readonly manifest: GeometryManifest; readonly provenance: Readonly<Record<string, unknown>>; readonly blob: Blob; readonly bytes: number; readonly sha256: string;
  /** Source and chunks only. Append the verified bound-provenance artifact using geometryChunkWorkspaceReferences. */
  readonly referencedArtifactIds: readonly string[];
}
export interface GeometryChunkArtifactBindings { source: WorkspaceArtifact; chunks: readonly { chunkId: string; artifact: WorkspaceArtifact }[] }
const produced = new WeakSet<ProducedGeometryChunks>(), boundPackages = new WeakSet<BoundGeometryChunkPackage>();
const PROJECT_ID = /^[A-Za-z0-9_-]{1,120}$/, ARTIFACT_ID = /^[a-f0-9]{32}$/, HASH = /^[a-f0-9]{64}$/;
const own = (value: object, key: PropertyKey): unknown => { const field = Object.getOwnPropertyDescriptor(value, key); if (!field || !("value" in field)) throw new Error("Geometry inputs require own data fields; accessors and sparse arrays are unsupported."); return field.value; };
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error(`Invalid/unknown ${label} fields.`);
  for (const key of keys) own(value, key); return value as Record<string, unknown>;
}
function array(value: unknown, maximum: number, label: string): unknown[] { if (!Array.isArray(value) || !Number.isSafeInteger(value.length) || value.length > maximum) throw new Error(`Invalid or oversized ${label}.`); return value; }
function text(value: unknown, maximum: number, label: string, nonempty = true): string { if (typeof value !== "string" || value.length > maximum || nonempty && !value.trim()) throw new Error(`Invalid ${label}.`); return value; }
function number(value: unknown, min: number, max: number, label: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}.`); return value; }
function vector(value: unknown, min: number, max: number, label: string): Vec3 { const values = array(value, 3, label); if (values.length !== 3) throw new Error(`Invalid ${label} dimension.`); return [0, 1, 2].map(index => number(own(values, String(index)), min, max, label)) as Vec3; }
function context(value?: GeometrySourceContext): GeometrySourceContext {
  const fields = record(value ?? { label: "Captured geometry scene", projectId: null, sourceRevision: null }, ["label", "projectId", "sourceRevision"], "source context");
  const label = text(fields.label, 240, "source label"), projectId = fields.projectId, revision = fields.sourceRevision;
  if (projectId === null ? revision !== null : typeof projectId !== "string" || !PROJECT_ID.test(projectId) || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) throw new Error("Source project and revision must be paired or both null.");
  return Object.freeze({ label, projectId: projectId as string | null, sourceRevision: revision as number | null });
}
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException("Geometry production cancelled.", "AbortError"); }
async function yieldWork(signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  await new Promise<void>((resolve, reject) => {
    const stop = () => { clearTimeout(timer); signal?.removeEventListener("abort", stop); reject(new DOMException("Geometry production cancelled.", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, 0);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
  });
  checkAbort(signal);
}
async function digest(blob: Blob, signal?: AbortSignal): Promise<string> {
  checkAbort(signal); if (!globalThis.crypto?.subtle) throw new Error("Geometry fingerprints require Web Crypto in a secure context.");
  const bytes = await blob.arrayBuffer(); checkAbort(signal);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes); checkAbort(signal);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
function freezeMesh(mesh: GeometryMesh): GeometryMesh { Object.freeze(mesh.positions); Object.freeze(mesh.indices); Object.freeze(mesh.material.color); Object.freeze(mesh.material.emission); Object.freeze(mesh.material); return Object.freeze(mesh); }
function freezeScene(scene: GeometryScene): GeometryScene { for (const mesh of scene.meshes) freezeMesh(mesh); Object.freeze(scene.meshes); Object.freeze(scene.camera.position); Object.freeze(scene.camera.target); Object.freeze(scene.camera.up); Object.freeze(scene.camera); Object.freeze(scene.warnings); return Object.freeze(scene); }
function freezeBounds(bounds: Bounds3): Bounds3 { Object.freeze(bounds.min); Object.freeze(bounds.max); return Object.freeze(bounds); }
const numericText = (value: number) => Object.is(value, -0) ? "-0" : String(value);
const vectorJson = (value: Vec3) => `[${value.map(numericText).join(",")}]`;
const materialJson = (value: MeshMaterial) => `{"color":${vectorJson(value.color)},"emission":${vectorJson(value.emission)},"model":${JSON.stringify(value.model)},"ior":${numericText(value.ior)}}`;
const cameraJson = (value: GeometryScene["camera"]) => `{"position":${vectorJson(value.position)},"target":${vectorJson(value.target)},"up":${vectorJson(value.up)},"fov":${numericText(value.fov)}}`;
/** Bounded UTF-8 pieces avoid a second monolithic scene-sized JavaScript string. */
class JsonPieces {
  private pieces: BlobPart[] = []; private pending: string[] = []; private characters = 0; private bytes = 0;
  append(value: string): void { this.pending.push(value); this.characters += value.length; if (this.characters >= 8192) this.flush(); }
  private flush(): void { if (!this.pending.length) return; const bytes = new TextEncoder().encode(this.pending.join("")); this.bytes += bytes.byteLength; if (this.bytes > GEOMETRY_PRODUCTION_LIMITS.chunkBytes) throw new Error("A mesh exceeds the serialized chunk budget; split it in the source authoring tool."); this.pieces.push(bytes); this.pending = []; this.characters = 0; }
  blob(): Blob { this.flush(); return new Blob(this.pieces, { type: "application/json" }); }
}
interface CapturedScene { scene: GeometryScene; sourceBlob: Blob; meshBlobs: Blob[]; meshDecoded: number[]; meshBounds: Bounds3[]; decodedBytes: number; baseDecoded: number; triangles: number; numericEntries: number }
async function capture(value: unknown, options: GeometryProductionOptions): Promise<CapturedScene> {
  checkAbort(options.signal);
  const fields = record(value, ["version", "units", "meshes", "camera", "warnings"], "scene");
  if (fields.version !== 1 || fields.units !== "m") throw new Error("Geometry production requires version 1 world-metre geometry.");
  const inputMeshes = array(fields.meshes, GEOMETRY_PRODUCTION_LIMITS.maxMeshes, "mesh list"), rawWarnings = array(fields.warnings, 100, "warnings");
  const meshCount = inputMeshes.length;
  if (!meshCount) throw new Error("An exact geometry package requires at least one mesh.");
  const warnings: string[] = []; for (let index = 0; index < rawWarnings.length; index++) warnings.push(text(own(rawWarnings, String(index)), 500, "warning", false));
  const rawCamera = record(fields.camera, ["position", "target", "up", "fov"], "camera"), camera = { position: vector(rawCamera.position, -1e8, 1e8, "camera position"), target: vector(rawCamera.target, -1e8, 1e8, "camera target"), up: vector(rawCamera.up, -1e8, 1e8, "camera up"), fov: number(rawCamera.fov, 0, 175, "field of view") };
  // The shared inspector validates the camera basis, without a large synchronous numeric-array walk.
  inspectGeometryScene({ version: 1, units: "m", meshes: [], camera, warnings });
  const baseDecoded = 4096 + 16 * 10 + warnings.reduce((sum, warning) => sum + 2 * warning.length, 0);
  const meshes: GeometryMesh[] = [], meshBlobs: Blob[] = [], meshDecoded: number[] = [], meshBounds: Bounds3[] = [], ids = new Set<string>();
  let decodedBytes = baseDecoded, triangles = 0, numericEntries = 0, serializedMeshes = 0;
  await yieldWork(options.signal);
  for (let meshIndex = 0; meshIndex < meshCount; meshIndex++) {
    const raw = record(own(inputMeshes, String(meshIndex)), ["id", "sourceId", "positions", "indices", "material"], "mesh"), id = text(raw.id, 240, "mesh id"), sourceId = text(raw.sourceId, 240, "source id");
    if (ids.has(id)) throw new Error("Geometry mesh ids must be unique."); ids.add(id);
    const inputPositions = array(raw.positions, MAX_SCENE_TRIANGLES * 9, "positions"), inputIndices = array(raw.indices, MAX_SCENE_TRIANGLES * 3, "indices"), positionsLength = inputPositions.length, indicesLength = inputIndices.length;
    if (!positionsLength || positionsLength % 3 || !indicesLength || indicesLength % 3) throw new Error("Meshes require nonempty xyz positions and triangle indices.");
    const reservation = 16 * (positionsLength + indicesLength) + 2 * (id.length + sourceId.length) + 2048;
    numericEntries += positionsLength + indicesLength; triangles += indicesLength / 3; decodedBytes += reservation;
    if (baseDecoded + reservation > GEOMETRY_PRODUCTION_LIMITS.chunkDecodedBytes || numericEntries > GEOMETRY_PRODUCTION_LIMITS.maxNumericEntries || triangles > MAX_SCENE_TRIANGLES || decodedBytes > GEOMETRY_PRODUCTION_LIMITS.sourceDecodedBytes) throw new Error("Whole-mesh/source decoded or triangle budgets exceeded; author a smaller source scene or split an oversized mesh.");
    const rawMaterial = record(raw.material, ["color", "emission", "model", "ior"], "material"), model = rawMaterial.model;
    if (typeof model !== "string" || !["diffuse", "mirror", "glass"].includes(model)) throw new Error("Unsupported material model.");
    const material: MeshMaterial = { color: vector(rawMaterial.color, 0, 1, "linear RGB"), emission: vector(rawMaterial.emission, 0, 1e5, "emission"), model: model as MeshMaterial["model"], ior: number(rawMaterial.ior, 1, 3, "index of refraction") };
    const positions: number[] = [], indices: number[] = [], bounds: Bounds3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }, json = new JsonPieces();
    json.append(`{"id":${JSON.stringify(id)},"sourceId":${JSON.stringify(sourceId)},"positions":[`);
    for (let index = 0; index < positionsLength; index++) {
      const coordinate = number(own(inputPositions, String(index)), -1e8, 1e8, "position"); positions.push(coordinate); json.append(`${index ? "," : ""}${numericText(coordinate)}`);
      const axis = index % 3; bounds.min[axis] = Math.min(bounds.min[axis], coordinate); bounds.max[axis] = Math.max(bounds.max[axis], coordinate);
      if ((index + 1) % GEOMETRY_PRODUCTION_LIMITS.yieldEntries === 0) await yieldWork(options.signal);
    }
    json.append('],"indices":[');
    for (let index = 0; index < indicesLength; index++) {
      const vertex = number(own(inputIndices, String(index)), 0, positionsLength / 3 - 1, "vertex index"); if (!Number.isSafeInteger(vertex)) throw new Error("Vertex indices require safe integers.");
      indices.push(vertex); json.append(`${index ? "," : ""}${numericText(vertex)}`);
      if ((index + 1) % GEOMETRY_PRODUCTION_LIMITS.yieldEntries === 0) await yieldWork(options.signal);
    }
    if (inputPositions.length !== positionsLength || inputIndices.length !== indicesLength) throw new Error("Source arrays changed while being captured; cancel and regenerate from stable inputs.");
    json.append(`],"material":${materialJson(material)}}`);
    const mesh = freezeMesh({ id, sourceId, positions, indices, material }), blob = json.blob(); serializedMeshes += blob.size;
    if (serializedMeshes > GEOMETRY_PRODUCTION_LIMITS.sourceBytes) throw new Error("Serialized source geometry exceeds 32 MB.");
    meshes.push(mesh); meshBlobs.push(blob); meshDecoded.push(reservation); meshBounds.push(freezeBounds(bounds));
    options.onProgress?.({ stage: "capture", completedMeshes: meshIndex + 1, totalMeshes: meshCount }); await yieldWork(options.signal);
  }
  if (inputMeshes.length !== meshCount) throw new Error("Source mesh list changed while being captured; cancel and regenerate from stable inputs.");
  const scene = freezeScene({ version: 1, units: "m", meshes, camera, warnings }), sourceBlob = sceneBlob(scene, meshBlobs);
  if (sourceBlob.size > GEOMETRY_PRODUCTION_LIMITS.sourceBytes) throw new Error("Complete captured scene exceeds the 32 MB source budget.");
  return { scene, sourceBlob, meshBlobs, meshDecoded, meshBounds, decodedBytes, baseDecoded, triangles, numericEntries };
}
function sceneBlob(scene: GeometryScene, meshBlobs: readonly Blob[]): Blob {
  const pieces: BlobPart[] = ['{"version":1,"units":"m","meshes":['];
  meshBlobs.forEach((mesh, index) => { if (index) pieces.push(","); pieces.push(mesh); });
  pieces.push(`],"camera":${cameraJson(scene.camera)},"warnings":${JSON.stringify(scene.warnings)}}`);
  return new Blob(pieces, { type: "application/json" });
}
function merge(left: Bounds3, right: Bounds3): Bounds3 { return { min: left.min.map((value, axis) => Math.min(value, right.min[axis])) as Vec3, max: left.max.map((value, axis) => Math.max(value, right.max[axis])) as Vec3 }; }

/** Does not upload, overwrite source objects, fabricate simplified geometry, or perform network requests. */
export async function produceGeometryChunks(value: unknown, options: GeometryProductionOptions = {}): Promise<ProducedGeometryChunks> {
  const capturedContext = context(options.context), captured = await capture(value, options), sourceHash = await digest(captured.sourceBlob, options.signal), chunks: ProducedGeometryChunk[] = [];
  options.onProgress?.({ stage: "hash", completedMeshes: captured.scene.meshes.length, totalMeshes: captured.scene.meshes.length });
  let start = 0; const sceneOverheadBytes = sceneBlob(captured.scene, []).size;
  while (start < captured.scene.meshes.length) {
    if (chunks.length >= GEOMETRY_PRODUCTION_LIMITS.maxChunks) throw new Error("Exact source requires more than 14 chunks; narrow the source scene.");
    let end = start, decoded = captured.baseDecoded, bytes = sceneOverheadBytes, bounds = captured.meshBounds[start];
    while (end < captured.scene.meshes.length) {
      const candidateDecoded = decoded + captured.meshDecoded[end];
      if (candidateDecoded > GEOMETRY_PRODUCTION_LIMITS.chunkDecodedBytes) break;
      const candidateBytes = bytes + captured.meshBlobs[end].size + (end === start ? 0 : 1);
      if (candidateBytes > GEOMETRY_PRODUCTION_LIMITS.chunkBytes) break;
      bytes = candidateBytes; decoded = candidateDecoded; bounds = merge(bounds, captured.meshBounds[end]); end++;
      if ((end - start) % 64 === 0) await yieldWork(options.signal);
    }
    if (end === start) throw new Error("An indivisible source mesh exceeds the exact chunk budget.");
    const blob = sceneBlob(captured.scene, captured.meshBlobs.slice(start, end)); if (blob.size !== bytes) throw new Error("Serialized chunk byte accounting differs from its captured parts.");
    const scene = freezeScene(inspectGeometryScene({ version: 1, units: "m", meshes: captured.scene.meshes.slice(start, end), camera: captured.scene.camera, warnings: captured.scene.warnings }));
    const sha256 = await digest(blob, options.signal), id = `sha256-${sourceHash}-${sha256}-${chunks.length + 1}`;
    chunks.push(Object.freeze({ id, name: `geometry-chunk-${chunks.length + 1}.json`, bounds: freezeBounds(bounds), scene, blob, bytes: blob.size, decodedBytes: decoded, sha256, meshIds: Object.freeze(scene.meshes.map(mesh => mesh.id)) }));
    start = end; options.onProgress?.({ stage: "partition", completedMeshes: start, totalMeshes: captured.scene.meshes.length }); await yieldWork(options.signal);
  }
  const source = Object.freeze({ name: `geometry-source-${sourceHash}.json`, blob: captured.sourceBlob, bytes: captured.sourceBlob.size, sha256: sourceHash, decodedBytes: captured.decodedBytes, triangles: captured.triangles, numericEntries: captured.numericEntries, context: capturedContext });
  const result: ProducedGeometryChunks = Object.freeze({ version: 1, kind: "exact-geometry-partition", algorithm: "whole-mesh-input-order-v1", sourceScene: captured.scene, source, chunks: Object.freeze(chunks) });
  checkAbort(options.signal); produced.add(result); return result;
}
/** Optional final stale-source guard; fingerprint the current scene before committing generated artifacts. */
export async function geometryChunkSourceMatches(packageValue: ProducedGeometryChunks, value: unknown, signal?: AbortSignal): Promise<boolean> { if (!produced.has(packageValue)) throw new Error("Unknown geometry production package."); const captured = await capture(value, { signal }); return await digest(captured.sourceBlob, signal) === packageValue.source.sha256; }
function artifact(value: WorkspaceArtifact, expected: { sha256: string; bytes: number }, used: Set<string>): { artifactId: string; sha256: string; bytes: number } {
  if (!value || typeof value !== "object" || value.kind !== "geometry" || typeof value.id !== "string" || !ARTIFACT_ID.test(value.id) || used.has(value.id) || typeof value.sha256 !== "string" || !HASH.test(value.sha256) || value.sha256 !== expected.sha256 || value.size !== expected.bytes || !Number.isSafeInteger(value.size)) throw new Error("Uploaded geometry artifact has a duplicate id, wrong kind, hash or byte count.");
  used.add(value.id); return Object.freeze({ artifactId: value.id, sha256: value.sha256, bytes: value.size });
}
/** Bind exact uploaded bytes to authenticated same-origin artifact routes, without uploading or saving. */
export async function bindGeometryChunkArtifacts(packageValue: ProducedGeometryChunks, projectId: string, bindings: GeometryChunkArtifactBindings, signal?: AbortSignal): Promise<BoundGeometryChunkPackage> {
  checkAbort(signal);
  if (!produced.has(packageValue) || typeof projectId !== "string" || !PROJECT_ID.test(projectId) || packageValue.source.context.projectId !== null && packageValue.source.context.projectId !== projectId || !Array.isArray(bindings?.chunks) || bindings.chunks.length !== packageValue.chunks.length) throw new Error("Geometry package, captured project or chunk artifact bindings differ.");
  const used = new Set<string>(), source = artifact(bindings.source, packageValue.source, used), lookup = new Map<string, WorkspaceArtifact>();
  for (let index = 0; index < bindings.chunks.length; index++) { const binding = own(bindings.chunks, String(index)) as GeometryChunkArtifactBindings["chunks"][number]; if (!binding || typeof binding.chunkId !== "string" || lookup.has(binding.chunkId)) throw new Error("Duplicate or malformed chunk binding."); lookup.set(binding.chunkId, binding.artifact); }
  const url = (id: string) => `/api/projects/${encodeURIComponent(projectId)}/workspaces/artifacts/${id}`;
  const boundChunks = packageValue.chunks.map(chunk => { const uploaded = lookup.get(chunk.id); if (!uploaded) throw new Error("A generated chunk has no uploaded artifact."); return Object.freeze({ id: chunk.id, name: chunk.name, ...artifact(uploaded, chunk, used), decodedBytes: chunk.decodedBytes, bounds: chunk.bounds, meshIds: chunk.meshIds }); });
  const manifest = inspectGeometryManifest({ version: 1, units: "m", roots: boundChunks.map(chunk => chunk.id), chunks: boundChunks.map(chunk => ({ id: chunk.id, url: url(chunk.artifactId), bounds: chunk.bounds, geometricErrorM: 0, bytes: chunk.bytes, children: [], sha256: chunk.sha256 })) });
  for (const chunk of manifest.chunks) { Object.freeze(chunk.children); freezeBounds(chunk.bounds); Object.freeze(chunk); } Object.freeze(manifest.roots); Object.freeze(manifest.chunks); Object.freeze(manifest);
  const sourceMetadata = Object.freeze({ ...source, name: packageValue.source.name, decodedBytes: packageValue.source.decodedBytes, meshes: packageValue.sourceScene.meshes.length, triangles: packageValue.source.triangles, numericEntries: packageValue.source.numericEntries, context: packageValue.source.context });
  const provenance = Object.freeze({ version: 1, kind: packageValue.kind, algorithm: packageValue.algorithm, projectId, source: sourceMetadata, limits: GEOMETRY_PRODUCTION_LIMITS, chunks: Object.freeze(boundChunks), manifest, certification: false });
  await yieldWork(signal);
  const blob = new Blob([JSON.stringify(provenance)], { type: "application/json" }); if (blob.size > GEOMETRY_PRODUCTION_LIMITS.provenanceBytes) throw new Error("Geometry provenance exceeds the 2 MiB package budget.");
  const sha256 = await digest(blob, signal), result: BoundGeometryChunkPackage = Object.freeze({ manifest, provenance, blob, bytes: blob.size, sha256, referencedArtifactIds: Object.freeze([...used]) });
  boundPackages.add(result); checkAbort(signal); return result;
}
/** Protect source, every chunk and the exact provenance bytes in the saved workspace revision. */
export function geometryChunkWorkspaceReferences(packageValue: BoundGeometryChunkPackage, provenanceArtifact: WorkspaceArtifact): string[] { if (!boundPackages.has(packageValue)) throw new Error("Unknown bound geometry package."); const used = new Set(packageValue.referencedArtifactIds); artifact(provenanceArtifact, packageValue, used); if (used.size > 16) throw new Error("Geometry package exceeds workspace reference capacity."); return [...used]; }
