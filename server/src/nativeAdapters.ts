import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, chown, lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export type NativeJobKind = "dwg-to-dxf" | "dxf-to-dwg" | "opensees-static";
export interface NativeAdapterConfig {
  libreDwg?: { dwg2dxfPath: string; dxf2dwgPath: string; version: string };
  openSees?: { executablePath: string; version: string };
  /** Requires an operator-confined Linux native account with no network/secrets access. */
  sandbox?: { uid: number; gid: number; prlimitPath: string; acknowledged: boolean };
  timeoutMs?: number;
  maximumInputBytes?: number;
  maximumOutputBytes?: number;
}
export interface NativeCapability {
  kind: NativeJobKind; adapter: "LibreDWG" | "OpenSees"; supportedVersion: string;
  configured: boolean; available: boolean; reason: string; runtimeVerified: false;
}
export interface NativeJobSummary {
  kind: NativeJobKind; adapter: "LibreDWG" | "OpenSees"; declaredVersion: string;
  sourceArtifactId: string; sourceSha256: string; verification: "computed-unvalidated";
  dimension?: "planar-2d"; combinationId?: string; warnings: string[];
}
export interface NativeOutputArtifact { filename: string; mediaType: string; bytes: Uint8Array; sha256: string }
export interface NativeJobRequest {
  kind: NativeJobKind; config: NativeAdapterConfig; workingDirectory: string;
  input: { bytes: Uint8Array; sourceArtifactId: string; sha256: string };
  metadata?: { combinationId?: string }; signal: AbortSignal;
}
export class NativeAdapterError extends Error {
  constructor(public readonly code: "adapter-unavailable" | "invalid-source" | "native-failed" | "native-timeout" | "native-cancelled" | "output-limit" | "invalid-output") {
    super({ "adapter-unavailable": "Native adapter is unavailable or incorrectly configured.", "invalid-source": "Source artifact does not meet the native adapter contract.", "native-failed": "Native process failed; no result was accepted.", "native-timeout": "Native job exceeded its time limit.", "native-cancelled": "Native job was cancelled.", "output-limit": "Native output exceeded its resource limits.", "invalid-output": "Native output does not meet the result contract." }[code]);
    this.name = "NativeAdapterError";
  }
}
const LIBREDWG_VERSION = "0.13.4", OPENSEES_VERSION = "3.8.0";
const MAX_INPUT = 32 * 1024 * 1024, MAX_OUTPUT = 32 * 1024 * 1024, MAX_LOG = 128 * 1024;
const NODE_DISPLACEMENTS = "secure-nexus-node-displacements.txt", NODE_REACTIONS = "secure-nexus-node-reactions.txt", MEMBER_FORCES = "secure-nexus-member-global-forces.txt";
const DECK = "secure-nexus-frame.tcl", RUN_STATUS = "secure-nexus-run-status.txt", MANIFEST = "secure-nexus-native-result.json";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const validAbsolute = (value: string | undefined): value is string => typeof value === "string" && path.isAbsolute(value) && !value.includes("\0");
function isolationConfigured(config: NativeAdapterConfig): boolean {
  const sandbox = config.sandbox;
  return process.platform === "linux" && !!sandbox?.acknowledged && Number.isSafeInteger(sandbox.uid) && sandbox.uid > 0 && Number.isSafeInteger(sandbox.gid) && sandbox.gid > 0 && sandbox.uid !== process.getuid?.() && sandbox.gid !== process.getgid?.() && validAbsolute(sandbox.prlimitPath);
}
/** Does not spawn a process. Configured availability is separate from runtime acceptance. */
export function getNativeCapabilities(config: NativeAdapterConfig): NativeCapability[] {
  return (["dwg-to-dxf", "dxf-to-dwg", "opensees-static"] as const).map(kind => {
    const solver = kind === "opensees-static", supportedVersion = solver ? OPENSEES_VERSION : LIBREDWG_VERSION;
    const configured = solver ? config.openSees?.version === supportedVersion && validAbsolute(config.openSees.executablePath) : config.libreDwg?.version === supportedVersion && validAbsolute(kind === "dwg-to-dxf" ? config.libreDwg.dwg2dxfPath : config.libreDwg.dxf2dwgPath);
    const available = configured && isolationConfigured(config);
    return { kind, adapter: solver ? "OpenSees" : "LibreDWG", supportedVersion, configured, available, runtimeVerified: false, reason: process.platform !== "linux" ? "Native jobs require an isolated Linux worker; this host is unsupported." : !configured ? `Configure the pinned ${solver ? "OpenSees" : "LibreDWG"} ${supportedVersion} executable.` : !isolationConfigured(config) ? "Configure a distinct native UID/GID, trusted prlimit executable and operator confinement acknowledgement." : "Configured; the binary version and output contract are checked when each job runs." };
  });
}

const bounded = (minimum: number, maximum: number) => z.number().finite().min(minimum).max(maximum);
const id = z.string().min(1).max(100).refine(value => !/[\u0000-\u001f]/.test(value));
const design = z.object({ sectionModulusM3: bounded(1e-12, 1e13), allowableStressPa: bounded(1e-12, 1e13), effectiveLengthFactor: bounded(1e-12, 1e13), bucklingSafetyFactor: bounded(1, 1e13), allowableDeflectionRatio: bounded(1e-12, 1e13) }).strict();
const frameSchema = z.object({
  version: z.literal(1), analysis: z.enum(["linear", "p-delta"]).optional(),
  nodes: z.array(z.object({ id, xM: bounded(-1e6, 1e6), yM: bounded(-1e6, 1e6), restraints: z.tuple([z.boolean(), z.boolean(), z.boolean()]) }).strict()).min(1).max(60),
  members: z.array(z.object({ id, start: id, end: id, areaM2: bounded(1e-8, 1e4), inertiaM4: bounded(1e-14, 1e6), elasticModulusPa: bounded(1e3, 1e13), design: design.optional() }).strict()).min(1).max(120),
  loadCases: z.array(z.object({ id, nodal: z.array(z.object({ node: id, fxN: bounded(-1e15, 1e15), fyN: bounded(-1e15, 1e15), mzNm: bounded(-1e15, 1e15) }).strict()).max(1000), uniform: z.array(z.object({ member: id, axialNPerM: bounded(-1e15, 1e15), transverseNPerM: bounded(-1e15, 1e15) }).strict()).max(1000) }).strict()).min(1).max(20),
  combinations: z.array(z.object({ id, factors: z.record(bounded(-100, 100)) }).strict()).min(1).max(20).optional(),
  options: z.object({ tolerance: bounded(1e-10, 0.01).optional(), maxIterations: bounded(2, 40).int().optional() }).strict().optional(),
}).strict();
const solverInputSchema = z.object({ version: z.literal(1), model: frameSchema, combinationId: id.optional() }).strict();
type SolverInput = z.infer<typeof solverInputSchema>;
function parseSolverInput(bytes: Uint8Array): SolverInput {
  try {
    const input = solverInputSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))), model = input.model;
    const unique = (values: string[]) => new Set(values).size === values.length;
    if (!unique(model.nodes.map(node => node.id)) || !unique(model.members.map(member => member.id)) || !unique(model.loadCases.map(item => item.id))) throw new Error();
    const nodes = new Map(model.nodes.map(node => [node.id, node])), members = new Set(model.members.map(member => member.id)), cases = new Set(model.loadCases.map(item => item.id));
    model.members.forEach(member => {
      const a = nodes.get(member.start), b = nodes.get(member.end);
      if (!a || !b || a.id === b.id || Math.hypot(a.xM - b.xM, a.yM - b.yM) < 1e-5) throw new Error();
    });
    model.loadCases.forEach(item => {
      if (item.nodal.some(load => !nodes.has(load.node)) || item.uniform.some(load => !members.has(load.member))) throw new Error();
    });
    const combinations = model.combinations ?? model.loadCases.map(item => ({ id: item.id, factors: { [item.id]: 1 } }));
    if (!unique(combinations.map(item => item.id)) || combinations.some(item => !Object.keys(item.factors).length || Object.keys(item.factors).some(key => !cases.has(key)))) throw new Error();
    if (input.combinationId !== undefined && !combinations.some(item => item.id === input.combinationId)) throw new Error();
    return input;
  } catch { throw new NativeAdapterError("invalid-source"); }
}
/** Validation at submission can reject scripts and malformed data before durable enqueue. */
export function validateNativeInput(kind: NativeJobKind, bytes: Uint8Array): void {
  if (!bytes.byteLength || bytes.byteLength > MAX_INPUT) throw new NativeAdapterError("invalid-source");
  if (kind === "opensees-static") { parseSolverInput(bytes); return; }
  if (kind === "dwg-to-dxf") {
    if (!/^AC10\d{2}$/.test(Buffer.from(bytes.subarray(0, 6)).toString("ascii"))) throw new NativeAdapterError("invalid-source");
    return;
  }
  if (kind !== "dxf-to-dwg") throw new NativeAdapterError("invalid-source");
  // This adapter accepts ASCII DXF only, with complete structural section terminators.
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error();
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    if (lines.length % 2 !== 0 || lines.length > 1_000_000) throw new Error();
    let section = false, entities = false, ended = false;
    for (let index = 0; index < lines.length; index += 2) {
      const code = lines[index].trim(), value = lines[index + 1].trim();
      if (!/^\d{1,4}$/.test(code) || Number(code) > 1071 || ended) throw new Error();
      if (Number(code) !== 0) continue;
      if (value === "SECTION") {
        if (section || lines[index + 2]?.trim() !== "2" || !lines[index + 3]?.trim()) throw new Error();
        section = true; if (lines[index + 3].trim() === "ENTITIES") entities = true;
      } else if (value === "ENDSEC") { if (!section) throw new Error(); section = false; }
      else if (value === "EOF") { if (section || !entities) throw new Error(); ended = true; }
      else if (!section) throw new Error();
    }
    if (!ended) throw new Error();
  } catch { throw new NativeAdapterError("invalid-source"); }
}

function makeDeck(input: SolverInput) {
  const model = input.model, combinations = model.combinations ?? model.loadCases.map(item => ({ id: item.id, factors: { [item.id]: 1 } }));
  const combination = combinations.find(item => item.id === input.combinationId) ?? combinations[0];
  const nodes = new Map(model.nodes.map((node, index) => [node.id, index + 1])), members = new Map(model.members.map((member, index) => [member.id, index + 1]));
  const nodal = new Map(model.nodes.map(node => [node.id, [0, 0, 0]])), uniform = new Map(model.members.map(member => [member.id, [0, 0]]));
  model.loadCases.forEach(item => {
    const factor = Object.prototype.hasOwnProperty.call(combination.factors, item.id) ? combination.factors[item.id] : 0;
    item.nodal.forEach(load => { const values = nodal.get(load.node)!; values[0] += factor * load.fxN; values[1] += factor * load.fyN; values[2] += factor * load.mzNm; });
    item.uniform.forEach(load => { const values = uniform.get(load.member)!; values[0] += factor * load.axialNPerM; values[1] += factor * load.transverseNPerM; });
  });
  const number = (value: number) => { if (!Number.isFinite(value)) throw new NativeAdapterError("invalid-source"); return value.toPrecision(17); };
  // User identifiers/strings are never inserted into Tcl. All command names/paths are fixed.
  const lines = ["# Secure-Nexus server-generated planar elastic frame; SI N, m, Pa, rad.", `if {[version] ne {${OPENSEES_VERSION}}} {exit 4}`, "wipe", "model BasicBuilder -ndm 2 -ndf 3", "set tcl_precision 17", "setPrecision 17"];
  model.nodes.forEach(node => { lines.push(`node ${nodes.get(node.id)} ${number(node.xM)} ${number(node.yM)}`); if (node.restraints.some(Boolean)) lines.push(`fix ${nodes.get(node.id)} ${node.restraints.map(value => value ? 1 : 0).join(" ")}`); });
  lines.push(`geomTransf ${model.analysis === "p-delta" ? "PDelta" : "Linear"} 1`);
  model.members.forEach(member => lines.push(`element elasticBeamColumn ${members.get(member.id)} ${nodes.get(member.start)} ${nodes.get(member.end)} ${number(member.areaM2)} ${number(member.elasticModulusPa)} ${number(member.inertiaM4)} 1`));
  lines.push("timeSeries Linear 1", "pattern Plain 1 1 {");
  nodal.forEach((values, sourceId) => { if (values.some(value => value !== 0)) lines.push(`load ${nodes.get(sourceId)} ${values.map(number).join(" ")}`); });
  uniform.forEach((values, sourceId) => { if (values.some(value => value !== 0)) lines.push(`eleLoad -ele ${members.get(sourceId)} -type -beamUniform ${number(values[1])} ${number(values[0])}`); });
  lines.push("}", "constraints Plain", "numberer RCM", "system BandGeneral", "test NormDispIncr 1.0e-10 40", `algorithm ${model.analysis === "p-delta" ? "Newton" : "Linear"}`, "integrator LoadControl 0.1", "analysis Static", "set status [analyze 10]", "if {$status != 0} {exit 5}", "reactions", `set output [open ${NODE_DISPLACEMENTS} w]`);
  model.nodes.forEach(node => { const tag = nodes.get(node.id); lines.push(`puts $output "${tag} [nodeDisp ${tag} 1] [nodeDisp ${tag} 2] [nodeDisp ${tag} 3]"`); });
  lines.push("close $output", `set output [open ${NODE_REACTIONS} w]`);
  model.nodes.forEach(node => { const tag = nodes.get(node.id); lines.push(`puts $output "${tag} [nodeReaction ${tag} 1] [nodeReaction ${tag} 2] [nodeReaction ${tag} 3]"`); });
  lines.push("close $output", `set output [open ${MEMBER_FORCES} w]`);
  model.members.forEach(member => { const tag = members.get(member.id); lines.push(`puts $output "${tag} [eleForce ${tag} 1] [eleForce ${tag} 2] [eleForce ${tag} 3] [eleForce ${tag} 4] [eleForce ${tag} 5] [eleForce ${tag} 6]"`); });
  lines.push("close $output", `set output [open ${RUN_STATUS} w]`, 'puts $output "version [version]"', 'puts $output "status $status"', 'puts $output "loadFactor [getTime]"', "close $output", "exit 0");
  return { bytes: Buffer.from(lines.join("\n") + "\n", "utf8"), combinationId: combination.id, nodes: [...nodes].map(([sourceId, solverId]) => ({ sourceId, solverId })), members: [...members].map(([sourceId, solverId]) => ({ sourceId, solverId })) };
}

async function trustedExecutable(filename: string, config: NativeAdapterConfig): Promise<string> {
  if (!validAbsolute(filename)) throw new NativeAdapterError("adapter-unavailable");
  try {
    const resolved = await realpath(filename), info = await lstat(resolved);
    if (!info.isFile() || info.uid === config.sandbox!.uid || (info.mode & 0o022) !== 0) throw new Error();
    let ancestor = path.dirname(resolved);
    for (;;) {
      const directory = await lstat(ancestor);
      if (!directory.isDirectory() || directory.uid === config.sandbox!.uid || (directory.mode & 0o022) !== 0) throw new Error();
      const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
    }
    await access(resolved, constants.X_OK);
    return resolved;
  } catch { throw new NativeAdapterError("adapter-unavailable"); }
}
async function writeNativeInput(directory: string, filename: string, bytes: Uint8Array, config: NativeAdapterConfig): Promise<void> {
  const handle = await open(path.join(directory, filename), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.chown(config.sandbox!.uid, config.sandbox!.gid); } finally { await handle.close(); }
}
async function readOutput(directory: string, filename: string, maximum: number): Promise<Buffer> {
  try {
    const handle = await open(path.join(directory, filename), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size < 1 || info.size > maximum) throw new NativeAdapterError("invalid-output");
      const bytes = await handle.readFile();
      if (bytes.byteLength !== info.size || bytes.byteLength > maximum) throw new NativeAdapterError("invalid-output");
      return bytes;
    } finally { await handle.close(); }
  } catch (error) { if (error instanceof NativeAdapterError) throw error; throw new NativeAdapterError("invalid-output"); }
}
function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}
async function runProcess(executable: string, args: string[], request: NativeJobRequest, maximumOutput: number, allowedFiles: Set<string>, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  const sandbox = request.config.sandbox!, prlimit = await trustedExecutable(sandbox.prlimitPath, request.config);
  if (request.signal.aborted) throw new NativeAdapterError("native-cancelled");
  return new Promise((resolve, reject) => {
    const child = spawn(prlimit, ["--as=536870912", "--cpu=60", "--fsize=33554432", "--nproc=32", "--nofile=64", "--", executable, ...args], { cwd: request.workingDirectory, uid: sandbox.uid, gid: sandbox.gid, shell: false, detached: true, windowsHide: true, env: { PATH: path.dirname(executable), HOME: request.workingDirectory, TMPDIR: request.workingDirectory, LANG: "C", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] });
    let failure: NativeAdapterError | undefined, stdout = "", stderr = "", logBytes = 0, closed = false, scanPromise: Promise<void> | undefined;
    const stop = (code: NativeAdapterError["code"]) => {
      failure ??= new NativeAdapterError(code);
      if (closed) return;
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    };
    const collect = (value: Buffer, stream: "stdout" | "stderr") => {
      logBytes += value.byteLength;
      if (logBytes > MAX_LOG) { stop("output-limit"); return; }
      if (stream === "stdout") stdout += value.toString("utf8"); else stderr += value.toString("utf8");
    };
    child.stdout?.on("data", (value: Buffer) => collect(value, "stdout"));
    child.stderr?.on("data", (value: Buffer) => collect(value, "stderr"));
    const abort = () => stop("native-cancelled");
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    const timer = setTimeout(() => stop("native-timeout"), timeoutMs);
    const scan = async () => {
        let total = 0;
        const filenames = await readdir(request.workingDirectory);
        if (filenames.length > allowedFiles.size) throw new NativeAdapterError("output-limit");
        for (const filename of filenames) {
          if (!allowedFiles.has(filename)) throw new NativeAdapterError("invalid-output");
          const info = await lstat(path.join(request.workingDirectory, filename));
          if (!info.isFile() || info.nlink !== 1) throw new NativeAdapterError("invalid-output");
          total += info.size;
        }
        if (total > maximumOutput + MAX_INPUT + 1024 * 1024) throw new NativeAdapterError("output-limit");
    };
    const monitor = setInterval(() => {
      if (scanPromise || closed) return;
      scanPromise = scan().catch(error => stop(error instanceof NativeAdapterError ? error.code : "invalid-output")).finally(() => { scanPromise = undefined; });
    }, 250);
    const cleanup = () => { clearTimeout(timer); clearInterval(monitor); request.signal.removeEventListener("abort", abort); };
    child.once("error", () => { failure ??= new NativeAdapterError("native-failed"); });
    child.once("close", (code, signal) => {
      closed = true;
      cleanup();
      // The trusted tools do not launch subprocesses; kill a remaining process group defensively.
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
      void (async () => {
        await scanPromise;
        await scan();
        if (failure) reject(failure);
        else if (code !== 0 || signal !== null) reject(new NativeAdapterError("native-failed"));
        else resolve({ stdout, stderr });
      })().catch(error => reject(failure ?? (error instanceof NativeAdapterError ? error : new NativeAdapterError("invalid-output"))));
    });
  });
}
function validateRows(bytes: Uint8Array, count: number, columns: number): void {
  const lines = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim().split(/\r?\n/), tags = new Set<number>();
  if (lines.length !== count) throw new NativeAdapterError("invalid-output");
  for (const line of lines) {
    const fields = line.trim().split(/\s+/), tag = Number(fields[0]);
    if (fields.length !== columns + 1 || !/^\d+$/.test(fields[0]) || !Number.isSafeInteger(tag) || tag < 1 || tag > count || tags.has(tag) || fields.slice(1).some(value => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value)))) throw new NativeAdapterError("invalid-output");
    tags.add(tag);
  }
}

/** Called only by a leased durable worker. A fresh empty, trusted directory is required. */
export async function runNativeJob(request: NativeJobRequest): Promise<{ artifacts: NativeOutputArtifact[]; summary: NativeJobSummary }> {
  const capability = getNativeCapabilities(request.config).find(item => item.kind === request.kind);
  if (!capability?.available) throw new NativeAdapterError("adapter-unavailable");
  const maximumInput = boundedInteger(request.config.maximumInputBytes, MAX_INPUT, MAX_INPUT), maximumOutput = boundedInteger(request.config.maximumOutputBytes, MAX_OUTPUT, MAX_OUTPUT), timeout = boundedInteger(request.config.timeoutMs, 60_000, 120_000);
  if (request.input.bytes.byteLength > maximumInput || !/^[a-f0-9]{64}$/.test(request.input.sha256) || hash(request.input.bytes) !== request.input.sha256 || !/^[A-Za-z0-9_-]{1,100}$/.test(request.input.sourceArtifactId)) throw new NativeAdapterError("invalid-source");
  validateNativeInput(request.kind, request.input.bytes);
  if (!validAbsolute(request.workingDirectory)) throw new NativeAdapterError("adapter-unavailable");
  const directory = await realpath(request.workingDirectory), directoryInfo = await lstat(request.workingDirectory);
  if (directory !== path.resolve(request.workingDirectory) || !directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (await readdir(directory)).length !== 0) throw new NativeAdapterError("adapter-unavailable");
  await chmod(directory, 0o700); await chown(directory, request.config.sandbox!.uid, request.config.sandbox!.gid);
  if (request.signal.aborted) throw new NativeAdapterError("native-cancelled");
  const artifacts: NativeOutputArtifact[] = [];
  const add = (filename: string, mediaType: string, bytes: Uint8Array) => {
    if (artifacts.reduce((sum, item) => sum + item.bytes.byteLength, bytes.byteLength) > maximumOutput) throw new NativeAdapterError("output-limit");
    artifacts.push({ filename, mediaType, bytes, sha256: hash(bytes) });
  };
  const summary: NativeJobSummary = { kind: request.kind, adapter: capability.adapter, declaredVersion: capability.supportedVersion, sourceArtifactId: request.input.sourceArtifactId, sourceSha256: request.input.sha256, verification: "computed-unvalidated", warnings: [] };
  let manifest: Record<string, unknown>;
  if (request.kind === "opensees-static") {
    const input = parseSolverInput(request.input.bytes);
    if (request.metadata?.combinationId !== undefined && request.metadata.combinationId !== input.combinationId) throw new NativeAdapterError("invalid-source");
    const deck = makeDeck(input), executable = await trustedExecutable(request.config.openSees!.executablePath, request.config);
    await writeNativeInput(directory, DECK, deck.bytes, request.config);
    const log = await runProcess(executable, [DECK], request, maximumOutput, new Set([DECK, NODE_DISPLACEMENTS, NODE_REACTIONS, MEMBER_FORCES, RUN_STATUS]), timeout);
    if (hash(await readOutput(directory, DECK, maximumOutput)) !== hash(deck.bytes)) throw new NativeAdapterError("invalid-output");
    const status = await readOutput(directory, RUN_STATUS, 1024), statusText = status.toString("utf8");
    const match = /^version 3\.8\.0\r?\nstatus 0\r?\nloadFactor ([^\r\n]+)\r?\n?$/.exec(statusText);
    if (!match || !Number.isFinite(Number(match[1])) || Math.abs(Number(match[1]) - 1) > 1e-8) throw new NativeAdapterError("invalid-output");
    const displacements = await readOutput(directory, NODE_DISPLACEMENTS, maximumOutput), reactions = await readOutput(directory, NODE_REACTIONS, maximumOutput), forces = await readOutput(directory, MEMBER_FORCES, maximumOutput);
    validateRows(displacements, deck.nodes.length, 3); validateRows(reactions, deck.nodes.length, 3); validateRows(forces, deck.members.length, 6);
    add(DECK, "text/plain", deck.bytes); add(NODE_DISPLACEMENTS, "text/plain", displacements); add(NODE_REACTIONS, "text/plain", reactions); add(MEMBER_FORCES, "text/plain", forces); add(RUN_STATUS, "text/plain", status);
    add("secure-nexus-execution-log.txt", "text/plain", Buffer.from(`stdout\n${log.stdout}\nstderr\n${log.stderr}`, "utf8"));
    summary.dimension = "planar-2d"; summary.combinationId = deck.combinationId;
    summary.warnings = ["Planar 2D elastic static subset and one explicit load combination only; this does not verify a 3D CAD/BIM model or certify design.", "PDelta and browser initial-stress approximations differ. Independently check units, restraints, force signs, mesh, equilibrium and user design assumptions.", "Native output was parsed, not independently validated against engineering benchmarks. Design criteria on the input are not assessed by this adapter.", "Browser relative tolerance/maxIterations options do not transfer to the native NormDispIncr test. Native convergence settings are fixed and declared in the manifest."];
    manifest = { version: 1, ...summary, runtimeVersion: OPENSEES_VERSION, units: "SI-N-m-Pa-rad", analysis: input.model.analysis ?? "linear", deckSha256: hash(deck.bytes), nodes: deck.nodes.map((item, index) => ({ ...item, restraints: input.model.nodes[index].restraints })), members: deck.members, nativeSettings: { test: "NormDispIncr", displacementIncrementTolerance: 1e-10, maximumIterations: 40, integrator: "LoadControl", loadIncrement: 0.1, loadSteps: 10, constraints: "Plain", numberer: "RCM", system: "BandGeneral", algorithm: input.model.analysis === "p-delta" ? "Newton" : "Linear", browserOptionsUsed: false, codeCriteriaAssessed: false } };
  } else {
    const toDxf = request.kind === "dwg-to-dxf", inputFile = toDxf ? "input.dwg" : "input.dxf", outputFile = toDxf ? "input.dxf" : "input.dwg";
    const executable = await trustedExecutable(toDxf ? request.config.libreDwg!.dwg2dxfPath : request.config.libreDwg!.dxf2dwgPath, request.config), allowed = new Set([inputFile, outputFile]);
    await writeNativeInput(directory, inputFile, request.input.bytes, request.config);
    const version = await runProcess(executable, ["--version"], request, maximumOutput, allowed, Math.min(timeout, 5000));
    const program = toDxf ? "dwg2dxf" : "dxf2dwg";
    if (!new RegExp(`^${program}(?: \\(GNU LibreDWG\\))? ${LIBREDWG_VERSION.replace(/\./g, "\\.")}(?:\\s|$)`, "m").test(version.stdout)) throw new NativeAdapterError("adapter-unavailable");
    const log = await runProcess(executable, ["--as=r2000", inputFile], request, maximumOutput, allowed, timeout), output = await readOutput(directory, outputFile, maximumOutput);
    if (hash(await readOutput(directory, inputFile, maximumInput)) !== request.input.sha256) throw new NativeAdapterError("invalid-output");
    if (toDxf) validateNativeInput("dxf-to-dwg", output); else if (output.subarray(0, 6).toString("ascii") !== "AC1015") throw new NativeAdapterError("invalid-output");
    add(toDxf ? "converted.dxf" : "converted.dwg", toDxf ? "application/dxf" : "image/vnd.dwg", output);
    add("secure-nexus-execution-log.txt", "text/plain", Buffer.from(`version\n${version.stdout}\nstdout\n${log.stdout}\nstderr\n${log.stderr}`, "utf8"));
    summary.warnings = ["LibreDWG conversion uses R2000 output and may skip unsupported drawing entities or lose fidelity. Preserve the original source and inspect the converted drawing independently.", "DWG writing is experimental; a valid AC1015 header and successful converter exit are not a drawing fidelity guarantee.", "Drawing units remain those recorded by the source/converter. This adapter does not reinterpret units, author BIM objects or execute embedded scripts."];
    manifest = { version: 1, ...summary, runtimeVersion: LIBREDWG_VERSION, outputVersion: "r2000", unitPolicy: "preserve-source-no-rescale" };
  }
  if (request.signal.aborted) throw new NativeAdapterError("native-cancelled");
  manifest.files = artifacts.map(item => ({ filename: item.filename, mediaType: item.mediaType, sha256: item.sha256, byteLength: item.bytes.byteLength }));
  add(MANIFEST, "application/json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
  return { artifacts, summary };
}
