import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { after, test } from "node:test";
import type { RenderProvider, RenderProviderResult } from "../src/renderProvider.js";

const dataDir = mkdtempSync(join(tmpdir(), "groundwork-resource-security-"));
process.env.NODE_ENV = "test";
process.env.GROUNDWORK_DATA_DIR = dataDir;
process.env.MASTER_KEY = randomBytes(32).toString("base64");
process.env.AI_API_KEY = "isolated-stub-key";
process.env.AI_BASE_URL = "https://provider.invalid/v1";
process.env.AI_MODEL = "stub";
process.env.RENDER_PROVIDER = "demo";
delete process.env.DB_PATH;
delete process.env.PREVIOUS_MASTER_KEY;

const { db, now } = await import("../src/db.js");
const { sha256Hex } = await import("../src/crypto.js");
const { createWorkspaceArtifact } = await import("../src/workspaces.js");
const { submitRenderJob, submitRenderJobSchema, retryRenderJob, cancelRenderJob, getRenderJob } = await import("../src/renderJobs.js");
const { setRenderProviderForTesting, GeminiImagenRenderProvider } = await import("../src/renderProvider.js");
const { admitProviderRequest, releaseProviderPermit, getReservedArtifactCapacity, readProviderBody, withProviderDeadline } = await import("../src/providerBudget.js");
type WorkspaceActor = import("../src/workspaces.js").WorkspaceActor;

const actors: WorkspaceActor[] = [];
const tokens: string[] = [];
const projects: string[] = [];
for (let i = 0; i < 3; i++) {
  const userId = `resource-user-${i}`;
  const sessionId = `resource-session-${i}`;
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO users(id,email,email_verified,password_salt,password_hash,password_changed_at,created_at,updated_at) VALUES (?,?,1,'fixture','fixture',?,?,?)").run(userId, `${userId}@example.invalid`, now(), now(), now());
  db.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token,status,created_at,last_seen_at,expires_at) VALUES (?,?,?,'resource-csrf','active',?,?,?)").run(sessionId, userId, sha256Hex(token), now(), now(), now() + 3_600);
  const projectId = `resource-project-${i}`;
  db.prepare("INSERT INTO projects(id,user_id,name,design_data,created_at,updated_at) VALUES (?,?,?,'{}',?,?)").run(projectId, userId, "Isolated resource fixture", now(), now());
  actors.push({ userId, sessionId });
  projects.push(projectId);
  tokens.push(token);
}
db.prepare("INSERT INTO project_members(project_id,user_id,role,invited_by,created_at) VALUES (?,?,'editor',?,?)").run(projects[0], actors[1].userId, actors[0].userId, now());
const image = Buffer.alloc(256, 0x42);
image.set([137, 80, 78, 71, 13, 10, 26, 10]);
const sourceIds = projects.map((project, i) => createWorkspaceArtifact(project, "geometry", actors[i], "fixture.png", image).id);

class ControlledProvider implements RenderProvider {
  readonly id = "resource-stub"; readonly name = "Isolated stub"; readonly model = "stub"; readonly version = "1";
  calls = 0;
  pending: Array<{ resolve: (value: RenderProviderResult) => void; reject: (error: Error) => void }> = [];
  constructor(private readonly cooperative = true) {}
  isConfigured() { return true; }
  getUnconfiguredReason() { return null; }
  generate(_params: unknown, signal?: AbortSignal): Promise<RenderProviderResult> {
    this.calls++;
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      if (this.cooperative) signal?.addEventListener("abort", () => reject(signal.reason as Error), { once: true });
    });
  }
  finish(index = 0, bytes = image) {
    this.pending[index].resolve({ imageBuffer: bytes, mimeType: "image/png", provider: this.id, model: this.model, version: this.version });
  }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const input = (i: number) => ({ prompt: "Render an isolated test", sourceRevision: 0, sourceImageArtifactId: sourceIds[i] });
const code = (expected: string) => (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === expected);
function resetBudgets() {
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM provider_active_permits").get() as { count: number }).count, 0);
  db.prepare("DELETE FROM provider_daily_usage").run();
  process.env.RENDER_USER_CONCURRENCY = "1";
  process.env.RENDER_GLOBAL_CONCURRENCY = "2";
  process.env.RENDER_USER_DAILY_REQUESTS = "20";
  process.env.RENDER_GLOBAL_DAILY_REQUESTS = "200";
  process.env.RENDER_PROVIDER_TIMEOUT_MS = "1000";
}
after(() => { setRenderProviderForTesting(null); db.close(); rmSync(dataDir, { recursive: true, force: true }); });

test("provider admission, persistent quotas, render reservations and deadlines", async (t) => {
  await t.test("rejects user/global overload before dispatch and releases cancelled/completed permits", async () => {
    resetBudgets();
    const provider = new ControlledProvider(); setRenderProviderForTesting(provider);
    const first = submitRenderJob(projects[0], actors[0], input(0));
    assert.throws(() => submitRenderJob(projects[0], actors[0], { ...input(0), sourceImageArtifactId: undefined, sourceImageBase64: image.toString("base64") }), code("PROVIDER_BUSY"));
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM project_workspace_artifacts WHERE project_id=?").get(projects[0]) as { count: number }).count, 1, "Rejected requests must not create source artifacts");
    const second = submitRenderJob(projects[1], actors[1], input(1));
    assert.throws(() => submitRenderJob(projects[2], actors[2], input(2)), code("PROVIDER_BUSY"));
    assert.throws(() => retryRenderJob(projects[0], first.id, actors[0]), code("INVALID_STATE"));
    await tick(); assert.equal(provider.calls, 2);
    cancelRenderJob(projects[0], first.id, actors[0]); await tick();
    assert.equal(getReservedArtifactCapacity(projects[0]).count, 0);
    provider.finish(1); await tick();
    assert.equal(getRenderJob(projects[1], second.id, actors[1]).status, "succeeded");
    assert.equal(getReservedArtifactCapacity(projects[1]).count, 0);
    const retried = retryRenderJob(projects[1], second.id, actors[1]); await tick();
    assert.notEqual(retried.id, second.id); assert.equal(provider.calls, 3);
    provider.finish(2); await tick();
    assert.equal(getRenderJob(projects[1], second.id, actors[1]).status, "succeeded");
  });

  await t.test("daily quota survives a fresh process, applies to retry, and has a global budget", async () => {
    resetBudgets(); process.env.RENDER_USER_DAILY_REQUESTS = "1";
    const provider = new ControlledProvider(); setRenderProviderForTesting(provider);
    const job = submitRenderJob(projects[2], actors[2], input(2)); await tick(); provider.finish(); await tick();
    assert.throws(() => retryRenderJob(projects[2], job.id, actors[2]), code("PROVIDER_DAILY_BUDGET"));
    const providerModuleUrl = new URL("../src/providerBudget.ts", import.meta.url).href;
    const output = execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "--input-type=module", "-e", `const {admitProviderRequest}=await import(${JSON.stringify(providerModuleUrl)});try{admitProviderRequest({userId:'resource-user-2',kind:'render',tokenBudget:1});process.exitCode=1}catch(error){if(error.code!=='PROVIDER_DAILY_BUDGET')throw error;console.log('persisted quota enforced')}`], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
    assert.match(output, /persisted quota enforced/);
    process.env.RENDER_GLOBAL_DAILY_REQUESTS = "1";
    assert.throws(() => submitRenderJob(projects[0], actors[0], input(0)), code("PROVIDER_DAILY_BUDGET"));
    process.env.AI_USER_DAILY_TOKEN_BUDGET = "10";
    assert.throws(() => admitProviderRequest({ userId: actors[0].userId, kind: "assistant", tokenBudget: 11 }), code("PROVIDER_DAILY_BUDGET"));
    delete process.env.AI_USER_DAILY_TOKEN_BUDGET;
  });

  await t.test("reserves artifact capacity before invoking providers and ordinary uploads honor it", async () => {
    resetBudgets(); const provider = new ControlledProvider(); setRenderProviderForTesting(provider);
    const fillers = Array.from({ length: 4 }, (_, i) => createWorkspaceArtifact(projects[0], "geometry", actors[0], `capacity-fixture-${i}.bin`, image));
    // Metadata-only synthetic capacity fixture; no large allocation or real data.
    fillers.forEach((filler, i) => db.prepare("UPDATE project_workspace_artifacts SET size=? WHERE id=?").run(i < 3 ? 64 * 1024 * 1024 : 48 * 1024 * 1024 - image.length, filler.id));
    const first = submitRenderJob(projects[0], actors[0], input(0));
    assert.equal(getReservedArtifactCapacity(projects[0]).bytes, 16 * 1024 * 1024);
    assert.throws(() => submitRenderJob(projects[0], actors[1], input(0)), code("ARTIFACT_CAPACITY"));
    assert.throws(() => createWorkspaceArtifact(projects[0], "geometry", actors[0], "extra.bin", Buffer.alloc(1)), code("ARTIFACT_CAPACITY"));
    await tick(); assert.equal(provider.calls, 1);
    cancelRenderJob(projects[0], first.id, actors[0]); await tick();
    fillers.forEach((filler) => db.prepare("DELETE FROM project_workspace_artifacts WHERE id=?").run(filler.id));
  });

  await t.test("timeout and oversized output release permits; late completion cannot save", async () => {
    resetBudgets(); process.env.RENDER_PROVIDER_TIMEOUT_MS = "20";
    const provider = new ControlledProvider(false); setRenderProviderForTesting(provider);
    const job = submitRenderJob(projects[0], actors[0], input(0));
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(getRenderJob(projects[0], job.id, actors[0]).errorCode, "PROVIDER_TIMEOUT");
    assert.equal(getReservedArtifactCapacity(projects[0]).count, 0);
    provider.finish(); await tick();
    assert.equal(getRenderJob(projects[0], job.id, actors[0]).outputArtifactId, null);
    process.env.RENDER_MAX_OUTPUT_BYTES = "100";
    const large = submitRenderJob(projects[0], actors[0], input(0)); await tick(); provider.finish(1); await tick();
    assert.equal(getRenderJob(projects[0], large.id, actors[0]).errorCode, "PROVIDER_RESPONSE_SIZE");
    assert.equal(getReservedArtifactCapacity(projects[0]).count, 0);
    delete process.env.RENDER_MAX_OUTPUT_BYTES;
  });

  await t.test("stream byte limit and deadline cover the body after headers", async () => {
    let cancelled = false;
    const huge = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(512)); }, cancel() { cancelled = true; } }));
    await assert.rejects(withProviderDeadline(200, (signal) => readProviderBody(huge, 1_000, signal)), code("PROVIDER_RESPONSE_SIZE"));
    assert.equal(cancelled, true);
    cancelled = false;
    const stalled = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } }));
    await assert.rejects(withProviderDeadline(20, (signal) => readProviderBody(stalled, 1_000, signal)), code("PROVIDER_TIMEOUT"));
    assert.equal(cancelled, true);
  });

  await t.test("Gemini adapter rejects oversized responses using an isolated fetch stub", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response("too large", { headers: { "content-length": "999999999" } });
    try {
      await assert.rejects(new GeminiImagenRenderProvider("fixture-key").generate({ prompt: "fixture", sourceImageBuffer: image }), code("PROVIDER_RESPONSE_SIZE"));
    } finally { globalThis.fetch = original; }
  });

  await t.test("provider parameters reject deep shapes and count UTF-8 bytes before serialization", () => {
    let deep: Record<string, unknown> = {};
    for (let depth = 0; depth < 70; depth++) deep = { child: deep };
    assert.equal(submitRenderJobSchema.safeParse({ ...input(0), parameters: deep }).success, false);
    assert.equal(submitRenderJobSchema.safeParse({ ...input(0), parameters: { text: "€".repeat(6_000) } }).success, false);
    assert.equal(submitRenderJobSchema.safeParse({ ...input(0), parameters: { quality: "high" } }).success, true);
  });

  await t.test("assistant handler caps output, rejects overload and bounds stalled/oversized replies", async () => {
    resetBudgets(); process.env.AI_USER_CONCURRENCY = "1";
    const { default: router } = await import("../src/routes/assistant.js");
    const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> }).stack.find((item) => item.route?.path === "/plan");
    assert.ok(layer?.route);
    const handler = layer.route.stack[0].handle;
    const invoke = (context: Record<string, unknown> = {}) => new Promise<{ status: number; body: { code?: string; source?: string }; headers: Map<string, string> }>((resolve, reject) => {
      const request = Object.assign(new EventEmitter(), { body: { message: "Make a plan", context }, user: { id: actors[0].userId } });
      const headers = new Map<string, string>();
      const response = Object.assign(new EventEmitter(), {
        statusCode: 200, destroyed: false, writableFinished: false,
        set(name: string, value: string) { headers.set(name, value); return this; },
        status(value: number) { this.statusCode = value; return this; },
        json(body: { code?: string; source?: string }) { this.writableFinished = true; resolve({ status: this.statusCode, body, headers }); return this; },
      });
      handler(request, response, reject);
    });
    const original = globalThis.fetch;
    let finish: ((value: Response) => void) | undefined;
    let requestBody: { max_tokens?: number } | undefined;
    globalThis.fetch = async (_url, options) => {
      requestBody = JSON.parse(String(options?.body)) as typeof requestBody;
      return new Promise<Response>((resolve) => { finish = resolve; });
    };
    try {
      let deep: Record<string, unknown> = {};
      for (let depth = 0; depth < 70; depth++) deep = { child: deep };
      assert.equal((await invoke(deep)).status, 400);
      assert.equal((await invoke({ text: "€".repeat(70_000) })).status, 400);
      const first = invoke(); await tick();
      assert.equal(requestBody?.max_tokens, 2_048);
      const overload = await invoke(); assert.equal(overload.status, 429); assert.equal(overload.body.code, "PROVIDER_BUSY");
      finish!(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "Isolated plan", actions: [], warnings: [] }) } }] })));
      const success = await first; await tick();
      assert.equal(success.body.source, "ai"); assert.equal(success.headers.get("Cache-Control"), "private, no-store");
      process.env.AI_PROVIDER_TIMEOUT_MS = "20";
      const timeout = await invoke(); assert.equal(timeout.status, 504); assert.equal(timeout.body.code, "PROVIDER_TIMEOUT");
      await tick();
      globalThis.fetch = async () => new Response("fixture", { headers: { "content-length": "262145" } });
      const oversized = await invoke(); assert.equal(oversized.status, 502); assert.equal(oversized.body.code, "PROVIDER_RESPONSE_SIZE");
      await tick();
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM provider_active_permits").get() as { count: number }).count, 0);
    } finally { globalThis.fetch = original; delete process.env.AI_PROVIDER_TIMEOUT_MS; delete process.env.AI_USER_CONCURRENCY; }
  });
});
