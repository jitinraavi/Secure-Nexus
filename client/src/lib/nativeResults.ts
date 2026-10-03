import { engineeringRecord, identifier } from "./engineeringNumerics";
import { frameLoadCombinations, parseFrameModel, type FrameModel2D } from "./frameAnalysis";

const MAX_BYTES = 32 * 1024 * 1024;
const DECK = "secure-nexus-frame.tcl", STATUS = "secure-nexus-run-status.txt";
const DISPLACEMENTS = "secure-nexus-node-displacements.txt", REACTIONS = "secure-nexus-node-reactions.txt", FORCES = "secure-nexus-member-global-forces.txt";
export interface NativeResultArtifact { filename: string; bytes: Uint8Array }
export interface NativeResultSource { artifactId: string; sha256: string; manifestSha256?: string }
export interface NativeFrameResult {
  version: 1; adapter: "OpenSees"; runtimeVersion: "3.8.0"; verification: "computed-unvalidated";
  dimension: "planar-2d"; units: "SI-N-m-Pa-rad"; analysis: "linear" | "p-delta";
  sourceArtifactId: string; sourceSha256: string; deckSha256: string; combinationId: string;
  displacements: { nodeId: string; uxM: number; uyM: number; rotationRad: number }[];
  reactions: { nodeId: string; fxN: number; fyN: number; mzNm: number }[];
  members: { memberId: string; globalEndForces: [number, number, number, number, number, number] }[];
  warnings: string[];
}
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function decode(bytes: Uint8Array, maximum: number): string {
  if (!bytes.byteLength || bytes.byteLength > maximum) throw new Error("Native artifact is empty or exceeds the import limit.");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("Native text artifact is not valid UTF-8."); }
}
export async function nativeArtifactSha256(bytes: Uint8Array): Promise<string> {
  // A dedicated ArrayBuffer avoids SharedArrayBuffer/typed-array BufferSource ambiguity.
  const normalized = new Uint8Array(bytes.byteLength); normalized.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", normalized.buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}
/** JSON only. Never uploads a Tcl program or mutates the original model. */
export function createNativeFrameInput(input: FrameModel2D, combinationId?: string): Uint8Array {
  const model = parseFrameModel(input);
  if (combinationId !== undefined && !frameLoadCombinations(model).some(item => item.id === combinationId)) throw new Error("Selected native load combination does not exist.");
  const sourceModel: FrameModel2D = {
    version: 1, analysis: model.analysis,
    nodes: model.nodes.map((node): FrameModel2D["nodes"][number] => ({ id: node.id, xM: node.xM, yM: node.yM, restraints: [node.restraints[0], node.restraints[1], node.restraints[2]] })),
    members: model.members.map(member => ({ id: member.id, start: member.start, end: member.end, areaM2: member.areaM2, inertiaM4: member.inertiaM4, elasticModulusPa: member.elasticModulusPa, ...(member.design ? { design: { sectionModulusM3: member.design.sectionModulusM3, allowableStressPa: member.design.allowableStressPa, effectiveLengthFactor: member.design.effectiveLengthFactor, bucklingSafetyFactor: member.design.bucklingSafetyFactor, allowableDeflectionRatio: member.design.allowableDeflectionRatio } } : {}) })),
    loadCases: model.loadCases.map(item => ({ id: item.id, nodal: item.nodal.map(load => ({ node: load.node, fxN: load.fxN, fyN: load.fyN, mzNm: load.mzNm })), uniform: item.uniform.map(load => ({ member: load.member, axialNPerM: load.axialNPerM, transverseNPerM: load.transverseNPerM })) })),
    ...(model.combinations ? { combinations: model.combinations.map(item => ({ id: item.id, factors: { ...item.factors } })) } : {}),
    ...(model.options ? { options: { tolerance: model.options.tolerance, maxIterations: model.options.maxIterations } } : {}),
  };
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, model: sourceModel, ...(combinationId === undefined ? {} : { combinationId }) }));
  if (bytes.byteLength > MAX_BYTES) throw new Error("Native frame source exceeds the input limit.");
  return bytes;
}
function rows(bytes: Uint8Array, expectedCount: number, valueCount: number): Map<number, number[]> {
  const lines = decode(bytes, MAX_BYTES).trim().split(/\r?\n/), result = new Map<number, number[]>();
  if (lines.length !== expectedCount) throw new Error("Native result does not contain exactly one row per mapped entity.");
  for (const line of lines) {
    const fields = line.trim().split(/\s+/), tag = Number(fields[0]);
    if (fields.length !== valueCount + 1 || !/^\d+$/.test(fields[0]) || !Number.isSafeInteger(tag) || tag < 1 || tag > expectedCount || result.has(tag)) throw new Error("Native result has an invalid, duplicate or unmapped solver tag.");
    if (fields.slice(1).some(value => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value)))) throw new Error("Native result contains a malformed or non-finite number.");
    result.set(tag, fields.slice(1).map(Number));
  }
  return result;
}
function mapping(value: unknown, sourceIds: string[]): void {
  if (!Array.isArray(value) || value.length !== sourceIds.length) throw new Error("Native manifest mapping does not match the exact source model.");
  value.forEach((item, index) => {
    if (!engineeringRecord(item) || item.sourceId !== sourceIds[index] || item.solverId !== index + 1) throw new Error("Native manifest source IDs or solver tags do not match the source model.");
  });
}

/**
 * Verify byte identities, source IDs, chosen combination and output row structure.
 * The expected identity should come from the authorized durable job, not the manifest.
 * A matching hash establishes identity; it does not establish engineering correctness.
 */
export async function parseNativeFrameResult(sourceBytes: Uint8Array, manifestBytes: Uint8Array, artifacts: NativeResultArtifact[], expectedSource?: NativeResultSource): Promise<NativeFrameResult> {
  const source: unknown = JSON.parse(decode(sourceBytes, MAX_BYTES)), manifest: unknown = JSON.parse(decode(manifestBytes, 256 * 1024));
  if (!engineeringRecord(source) || source.version !== 1 || !engineeringRecord(source.model)) throw new Error("Native source must be the version 1 frame JSON envelope.");
  const model = parseFrameModel(source.model);
  if (source.combinationId !== undefined && !identifier(source.combinationId)) throw new Error("Invalid source combination identifier.");
  const combinationId = typeof source.combinationId === "string" ? source.combinationId : frameLoadCombinations(model)[0].id;
  if (!frameLoadCombinations(model).some(item => item.id === combinationId)) throw new Error("Native source references an unknown load combination.");
  if (!engineeringRecord(manifest) || manifest.version !== 1 || manifest.kind !== "opensees-static" || manifest.adapter !== "OpenSees" || manifest.declaredVersion !== "3.8.0" || manifest.runtimeVersion !== "3.8.0" || manifest.verification !== "computed-unvalidated" || manifest.dimension !== "planar-2d" || manifest.units !== "SI-N-m-Pa-rad" || manifest.analysis !== (model.analysis ?? "linear") || manifest.combinationId !== combinationId || !identifier(manifest.sourceArtifactId) || !validHash(manifest.sourceSha256) || !validHash(manifest.deckSha256)) throw new Error("Native manifest is incompatible with the supported planar OpenSees result contract.");
  const sourceSha256 = await nativeArtifactSha256(sourceBytes);
  if (manifest.sourceSha256 !== sourceSha256 || expectedSource && (expectedSource.artifactId !== manifest.sourceArtifactId || expectedSource.sha256 !== sourceSha256)) throw new Error("Native output is bound to a different source artifact. Preserve it as a separate job result.");
  if (expectedSource?.manifestSha256 !== undefined && (!validHash(expectedSource.manifestSha256) || await nativeArtifactSha256(manifestBytes) !== expectedSource.manifestSha256)) throw new Error("Native manifest bytes do not match the job artifact fingerprint.");
  mapping(manifest.nodes, model.nodes.map(node => node.id)); mapping(manifest.members, model.members.map(member => member.id));
  if (!engineeringRecord(manifest.nativeSettings) || manifest.nativeSettings.test !== "NormDispIncr" || manifest.nativeSettings.displacementIncrementTolerance !== 1e-10 || manifest.nativeSettings.maximumIterations !== 40 || manifest.nativeSettings.integrator !== "LoadControl" || manifest.nativeSettings.loadIncrement !== 0.1 || manifest.nativeSettings.loadSteps !== 10 || manifest.nativeSettings.constraints !== "Plain" || manifest.nativeSettings.numberer !== "RCM" || manifest.nativeSettings.system !== "BandGeneral" || manifest.nativeSettings.algorithm !== (model.analysis === "p-delta" ? "Newton" : "Linear") || manifest.nativeSettings.browserOptionsUsed !== false || manifest.nativeSettings.codeCriteriaAssessed !== false) throw new Error("Native settings do not match the supported static solver contract.");
  if (!Array.isArray(manifest.nodes) || manifest.nodes.some((item, index) => !engineeringRecord(item) || !Array.isArray(item.restraints) || item.restraints.length !== 3 || item.restraints.some((value, dof) => value !== model.nodes[index].restraints[dof]))) throw new Error("Native restraint mapping does not match the exact source model.");
  if (!Array.isArray(manifest.files) || manifest.files.length < 5 || manifest.files.length > 8 || !Array.isArray(artifacts) || artifacts.length > 8) throw new Error("Native manifest requires a bounded output artifact list.");
  const files = new Map<string, Uint8Array>(); let total = 0;
  for (const artifact of artifacts) {
    if (files.has(artifact.filename) || !artifact.bytes.byteLength || artifact.bytes.byteLength > MAX_BYTES) throw new Error("Native artifacts are empty, duplicate or oversized.");
    total += artifact.bytes.byteLength; if (total > MAX_BYTES) throw new Error("Native output bundle exceeds the import limit.");
    files.set(artifact.filename, artifact.bytes);
  }
  const declared = new Set<string>(), allowed = new Set([DECK, STATUS, DISPLACEMENTS, REACTIONS, FORCES, "secure-nexus-execution-log.txt"]);
  for (const item of manifest.files) {
    if (!engineeringRecord(item) || typeof item.filename !== "string" || !allowed.has(item.filename) || declared.has(item.filename) || !validHash(item.sha256) || typeof item.byteLength !== "number" || !Number.isSafeInteger(item.byteLength)) throw new Error("Native output artifact descriptor is invalid.");
    const bytes = files.get(item.filename);
    if (!bytes || bytes.byteLength !== item.byteLength || await nativeArtifactSha256(bytes) !== item.sha256) throw new Error("Native output artifact bytes do not match the manifest fingerprint.");
    declared.add(item.filename);
  }
  if (files.size !== declared.size || [DECK, STATUS, DISPLACEMENTS, REACTIONS, FORCES].some(filename => !declared.has(filename))) throw new Error("Native bundle contains missing or undeclared artifacts.");
  if (await nativeArtifactSha256(files.get(DECK)!) !== manifest.deckSha256) throw new Error("Native generated deck fingerprint does not match the manifest.");
  const status = /^version 3\.8\.0\r?\nstatus 0\r?\nloadFactor ([^\r\n]+)\r?\n?$/.exec(decode(files.get(STATUS)!, 1024));
  if (!status || !Number.isFinite(Number(status[1])) || Math.abs(Number(status[1]) - 1) > 1e-8) throw new Error("Native run did not declare a successful complete static load step.");
  const displacementRows = rows(files.get(DISPLACEMENTS)!, model.nodes.length, 3), reactionRows = rows(files.get(REACTIONS)!, model.nodes.length, 3), forceRows = rows(files.get(FORCES)!, model.members.length, 6);
  if (!Array.isArray(manifest.warnings) || manifest.warnings.length > 20 || manifest.warnings.some(value => typeof value !== "string" || value.length > 2000)) throw new Error("Native manifest warnings are invalid.");
  const warnings = manifest.warnings.filter((value): value is string => typeof value === "string");
  warnings.push("This parsed result belongs to the immutable planar source artifact. Do not apply it to a changed source, another combination or the original 3D model.");
  return {
    version: 1, adapter: "OpenSees", runtimeVersion: "3.8.0", verification: "computed-unvalidated", dimension: "planar-2d", units: "SI-N-m-Pa-rad", analysis: model.analysis ?? "linear",
    sourceArtifactId: manifest.sourceArtifactId, sourceSha256, deckSha256: manifest.deckSha256, combinationId,
    displacements: model.nodes.map((node, index) => { const values = displacementRows.get(index + 1)!; return { nodeId: node.id, uxM: values[0], uyM: values[1], rotationRad: values[2] }; }),
    reactions: model.nodes.map((node, index) => { const values = reactionRows.get(index + 1)!; return { nodeId: node.id, fxN: values[0], fyN: values[1], mzNm: values[2] }; }),
    members: model.members.map((member, index): NativeFrameResult["members"][number] => { const values = forceRows.get(index + 1)!; return { memberId: member.id, globalEndForces: [values[0], values[1], values[2], values[3], values[4], values[5]] }; }), warnings,
  };
}
