import { bindGeometryChunkArtifacts, GEOMETRY_PRODUCTION_LIMITS, geometryChunkSourceMatches, geometryChunkWorkspaceReferences, produceGeometryChunks, type BoundGeometryChunkPackage, type ProducedGeometryChunks } from "./geometryChunkProducer";
import { inspectGeometryScene, type GeometryScene } from "./meshGeometry";
import { deleteWorkspaceArtifact, listWorkspaceArtifacts, readWorkspaceArtifact, uploadWorkspaceArtifact, type WorkspaceArtifact } from "./workspaceApi";
import type { WorkspaceSavePreparationContext } from "./workspaceSavePreparation";

interface ArtifactBinding { artifactId: string; sha256: string; bytes: number }
interface ChunkBinding extends ArtifactBinding { chunkId: string }
export interface SavedGeometryProduction {
  version: 1; projectId: string; sourceRevision: number; label: string;
  /** Exact canonical bytes as UTF-8 JSON text, retaining negative zero across workspace serialization. */
  sourceJson: string; source: ArtifactBinding; chunks: ChunkBinding[]; provenance: ArtifactBinding;
}
const idPattern = /^[a-f0-9]{32}$/, hashPattern = /^[a-f0-9]{64}$/;
function fields(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error(`Invalid ${label} fields.`);
  return value as Record<string, unknown>;
}
function binding(value: unknown, chunk = false): ArtifactBinding | ChunkBinding {
  const row = fields(value, chunk ? ["artifactId", "sha256", "bytes", "chunkId"] : ["artifactId", "sha256", "bytes"], "geometry artifact binding");
  if (typeof row.artifactId !== "string" || !idPattern.test(row.artifactId) || typeof row.sha256 !== "string" || !hashPattern.test(row.sha256) || typeof row.bytes !== "number" || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > GEOMETRY_PRODUCTION_LIMITS.sourceBytes) throw new Error("Invalid geometry artifact metadata.");
  const result = { artifactId: row.artifactId, sha256: row.sha256, bytes: row.bytes };
  if (!chunk) return result;
  if (typeof row.chunkId !== "string" || !/^sha256-[a-f0-9]{64}-[a-f0-9]{64}-([1-9]|1[0-4])$/.test(row.chunkId) || row.chunkId.split("-")[2] !== row.sha256 || row.bytes > GEOMETRY_PRODUCTION_LIMITS.chunkBytes) throw new Error("Invalid exact geometry chunk identity.");
  return { ...result, chunkId: row.chunkId };
}
export function geometryProductionReferences(value: SavedGeometryProduction): string[] { return [value.source.artifactId, ...value.chunks.map(chunk => chunk.artifactId), value.provenance.artifactId]; }
export function inspectSavedGeometryProduction(value: unknown): { record: SavedGeometryProduction; scene: GeometryScene } {
  const row = fields(value, ["version", "projectId", "sourceRevision", "label", "sourceJson", "source", "chunks", "provenance"], "saved geometry production");
  if (row.version !== 1 || typeof row.projectId !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(row.projectId) || typeof row.sourceRevision !== "number" || !Number.isSafeInteger(row.sourceRevision) || row.sourceRevision < 0 || typeof row.label !== "string" || !row.label.trim() || row.label.length > 240 || typeof row.sourceJson !== "string" || row.sourceJson.length > GEOMETRY_PRODUCTION_LIMITS.sourceBytes || new Blob([row.sourceJson]).size > GEOMETRY_PRODUCTION_LIMITS.sourceBytes || !Array.isArray(row.chunks) || row.chunks.length < 1 || row.chunks.length > GEOMETRY_PRODUCTION_LIMITS.maxChunks) throw new Error("Invalid saved geometry production scope or budget.");
  const source = binding(row.source) as ArtifactBinding, provenance = binding(row.provenance) as ArtifactBinding, chunks = row.chunks.map(item => binding(item, true) as ChunkBinding);
  if (provenance.bytes > GEOMETRY_PRODUCTION_LIMITS.provenanceBytes || new Blob([row.sourceJson]).size !== source.bytes || chunks.some((chunk, index) => chunk.chunkId !== `sha256-${source.sha256}-${chunk.sha256}-${index + 1}`)) throw new Error("Saved geometry hashes, order or source byte count differ.");
  const record: SavedGeometryProduction = { version: 1, projectId: row.projectId, sourceRevision: row.sourceRevision, label: row.label, sourceJson: row.sourceJson, source, chunks, provenance };
  if (new Set(geometryProductionReferences(record)).size !== chunks.length + 2) throw new Error("Saved geometry artifact IDs must be distinct.");
  const raw = fields(JSON.parse(row.sourceJson) as unknown, ["version", "units", "meshes", "camera", "warnings"], "captured geometry scene");
  if (raw.version !== 1 || raw.units !== "m" || !Array.isArray(raw.meshes) || raw.meshes.length < 1 || raw.meshes.length > GEOMETRY_PRODUCTION_LIMITS.maxMeshes || !Array.isArray(raw.warnings) || raw.warnings.length > 100 || raw.warnings.some(warning => typeof warning !== "string" || warning.length > 500)) throw new Error("Invalid captured geometry scene or warnings.");
  fields(raw.camera, ["position", "target", "up", "fov"], "captured geometry camera");
  let entries = 0;
  for (const item of raw.meshes) {
    const mesh = fields(item, ["id", "sourceId", "positions", "indices", "material"], "captured geometry mesh"), material = fields(mesh.material, ["color", "emission", "model", "ior"], "captured geometry material");
    if (typeof mesh.id !== "string" || !mesh.id.trim() || mesh.id.length > 240 || typeof mesh.sourceId !== "string" || !mesh.sourceId.trim() || mesh.sourceId.length > 240 || !Array.isArray(mesh.positions) || !Array.isArray(mesh.indices) || typeof material.model !== "string" || !["diffuse", "mirror", "glass"].includes(material.model)) throw new Error("Invalid captured geometry identity or material model.");
    entries += mesh.positions.length + mesh.indices.length;
    if (entries > GEOMETRY_PRODUCTION_LIMITS.maxNumericEntries) throw new Error("Captured geometry exceeds its numeric budget.");
  }
  return { record, scene: inspectGeometryScene(raw) };
}
const abort = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException("Geometry package operation cancelled.", "AbortError"); };
async function hash(blob: Blob, signal?: AbortSignal): Promise<string> {
  abort(signal); const bytes = await blob.arrayBuffer(); abort(signal);
  if (!crypto.subtle) throw new Error("Geometry integrity requires a secure context.");
  const value = await crypto.subtle.digest("SHA-256", bytes); abort(signal);
  return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join("");
}
function metadata(value: WorkspaceArtifact | undefined, expected: ArtifactBinding): WorkspaceArtifact {
  if (!value || value.kind !== "geometry" || value.id !== expected.artifactId || value.sha256 !== expected.sha256 || value.size !== expected.bytes) throw new Error("A retained geometry artifact is unavailable or has different metadata.");
  return value;
}
const toBinding = (value: WorkspaceArtifact): ArtifactBinding => ({ artifactId: value.id, sha256: value.sha256, bytes: value.size });

/** Regenerate fresh runtime ownership; verify retained source/provenance bytes before enabling streaming. */
export async function recoverGeometryProduction(value: SavedGeometryProduction, projectId: string, signal?: AbortSignal, assertActive: () => void = () => abort(signal)): Promise<{ produced: ProducedGeometryChunks; bound: BoundGeometryChunkPackage }> {
  const { record, scene } = inspectSavedGeometryProduction(value);
  if (record.projectId !== projectId) throw new Error("Generated geometry belongs to another project. Import the retained scene as new source instead.");
  const check = () => { abort(signal); assertActive(); };
  check(); const produced = await produceGeometryChunks(scene, { signal, context: { projectId, sourceRevision: record.sourceRevision, label: record.label } }); check();
  if (produced.source.sha256 !== record.source.sha256 || produced.source.bytes !== record.source.bytes || produced.chunks.length !== record.chunks.length || produced.chunks.some((chunk, index) => chunk.id !== record.chunks[index].chunkId || chunk.sha256 !== record.chunks[index].sha256 || chunk.bytes !== record.chunks[index].bytes)) throw new Error("Captured geometry does not reproduce its saved exact partition.");
  const inventory = await listWorkspaceArtifacts(projectId, "geometry"); check(); const lookup = new Map(inventory.artifacts.map(item => [item.id, item]));
  const source = metadata(lookup.get(record.source.artifactId), record.source), chunks = record.chunks.map(chunk => ({ chunkId: chunk.chunkId, artifact: metadata(lookup.get(chunk.artifactId), chunk) })), provenance = metadata(lookup.get(record.provenance.artifactId), record.provenance);
  const bound = await bindGeometryChunkArtifacts(produced, projectId, { source, chunks }, signal); check();
  geometryChunkWorkspaceReferences(bound, provenance);
  for (const expected of [record.source, record.provenance]) {
    const bytes = await readWorkspaceArtifact(projectId, expected.artifactId, signal); check();
    if (bytes.size !== expected.bytes || await hash(bytes, signal) !== expected.sha256) throw new Error("Retained source or provenance bytes failed integrity verification.");
    check();
  }
  return { produced, bound };
}

/** Each upload remains awaited after cancellation so a returned ID can be rolled back safely. */
export async function uploadGeometryProduction(produced: ProducedGeometryChunks, context: WorkspaceSavePreparationContext, payloadBytes: number, pendingBytes: number): Promise<{ record: SavedGeometryProduction; bound: BoundGeometryChunkPackage; referencedArtifactIds: string[]; uploadedArtifactIds: string[] }> {
  const uploaded: string[] = [];
  const check = () => { abort(context.signal); context.assertActive(); };
  try {
    check();
    if (produced.source.context.projectId !== context.projectId || produced.source.context.sourceRevision !== context.sourceRevision) throw new Error("Generated package differs from the captured project revision.");
    if (context.referencedArtifactIds.length + context.pendingFileCount + produced.chunks.length + 2 > 16) throw new Error("Generated source/chunks/provenance and manual attachments exceed 16 references. Keep existing sources or explicitly detach them before retrying.");
    const inventory = await listWorkspaceArtifacts(context.projectId); check();
    // Conservative preflight reserves the provenance cap and payload upper bound. Each server upload also checks capacity atomically.
    const bytes = produced.source.bytes + produced.chunks.reduce((total, chunk) => total + chunk.bytes, 0) + GEOMETRY_PRODUCTION_LIMITS.provenanceBytes + payloadBytes + pendingBytes;
    if (!Number.isSafeInteger(inventory.storedBytes) || !Number.isSafeInteger(inventory.maximumBytes) || !Number.isSafeInteger(inventory.maximumArtifacts) || inventory.artifacts.length + produced.chunks.length + 3 + context.pendingFileCount > inventory.maximumArtifacts || inventory.storedBytes + bytes > inventory.maximumBytes) throw new Error("Project capacity cannot hold the complete generated package, pending files and workspace payload. Remove unreferenced artifacts before retrying.");
    const upload = async (blob: Blob, name: string) => { check(); const artifact = await uploadWorkspaceArtifact(context.projectId, "geometry", blob, name); uploaded.push(artifact.id); check(); return artifact; };
    const source = await upload(produced.source.blob, produced.source.name), chunks: { chunkId: string; artifact: WorkspaceArtifact }[] = [];
    for (const chunk of produced.chunks) chunks.push({ chunkId: chunk.id, artifact: await upload(chunk.blob, chunk.name) });
    const bound = await bindGeometryChunkArtifacts(produced, context.projectId, { source, chunks }, context.signal); check();
    const provenance = await upload(bound.blob, "geometry-provenance.json"), referencedArtifactIds = geometryChunkWorkspaceReferences(bound, provenance);
    const sourceJson = await produced.source.blob.text(); check();
    const record: SavedGeometryProduction = { version: 1, projectId: context.projectId, sourceRevision: context.sourceRevision, label: produced.source.context.label, sourceJson, source: toBinding(source), chunks: chunks.map(chunk => ({ ...toBinding(chunk.artifact), chunkId: chunk.chunkId })), provenance: toBinding(provenance) };
    return { record, bound, referencedArtifactIds, uploadedArtifactIds: uploaded };
  } catch (cause) {
    // Referenced artifacts cannot be deleted by this API, including after an ambiguous committed response.
    for (const id of uploaded) await deleteWorkspaceArtifact(context.projectId, id).catch(() => undefined);
    throw cause;
  }
}
export async function assertGeometrySource(produced: ProducedGeometryChunks, scene: GeometryScene, context: WorkspaceSavePreparationContext): Promise<void> {
  context.assertActive(); if (!await geometryChunkSourceMatches(produced, scene, context.signal)) throw new Error("Geometry source changed while the package was being prepared."); context.assertActive();
}
