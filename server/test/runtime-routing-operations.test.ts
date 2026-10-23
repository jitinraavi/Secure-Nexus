import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import express from "express";
import dotenv from "dotenv";

dotenv.config = () => ({ parsed: {} });
const directory = mkdtempSync(join(tmpdir(), "groundwork-routing-operations-"));
const operations = randomBytes(32).toString("hex"), cron = randomBytes(32).toString("hex");
Object.assign(process.env, {
  NODE_ENV: "test", DATABASE_PROVIDER: "sqlite", DATABASE_URL: "", SUPABASE_DB_URL: "", GROUNDWORK_DATA_DIR: directory, DB_PATH: "",
  MASTER_KEY: randomBytes(32).toString("base64"), MAIL_PROVIDER: "console", PAYMENTS_MODE: "demo", BIND_HOST: "127.0.0.1",
  OPERATIONS_TOKEN: operations, CRON_SECRET: cron, ALERT_TO: "", TRACE_SAMPLE_PERCENT: "0", GROUNDWORK_SERVERLESS: "", VERCEL: "",
  GROUNDWORK_SERVER_ROLE: "authority", GROUNDWORK_AUTHORITY_GATEWAY_MODE: "direct", DURABLE_WORKERS_ENABLED: "false", NATIVE_WORKER_ENABLED: "false",
});
const { app } = await import("../src/index.js");
const { db, now } = await import("../src/db.js");
const { drainTelemetry } = await import("../src/telemetry.js");
const { csrfProtection } = await import("../src/security.js");
const { vercelRequestContext } = await import("../src/serverlessRuntime.js");
const { default: operationsRouter } = await import("../src/routes/operations.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address(); assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const machine = { authorization: `Bearer ${operations}`, "content-type": "application/json" };
const report = () => ({ backupId: "synthetic-backup", status: "succeeded", encrypted: true, checksum: "a".repeat(64), bytes: 12, completedAt: now() });

test("v1 aliases preserve API behavior, query strings and browser authentication", async () => {
  for (const prefix of ["/api", "/api/v1"]) {
    const live = await fetch(`${origin}${prefix}/live`);
    assert.equal(live.status, 200); assert.equal(live.headers.get("x-api-version"), "1");
    assert.deepEqual(await live.json(), { ok: true });
    assert.match(live.headers.get("x-request-id") || "", /^[a-f0-9]{32}$/);
    assert.equal((await fetch(`${origin}${prefix}/secrets`)).status, 401);
    const metrics = await fetch(`${origin}${prefix}/ops/metrics?minutes=5`, { headers: machine });
    assert.equal(metrics.status, 200); assert.equal((await metrics.json() as { windowMinutes: number }).windowMinutes, 5);
  }
  assert.equal((await fetch(`${origin}/api/v10/live`)).status, 404);
});

test("machine ops skip browser CSRF only through exact authenticated handlers", async () => {
  for (const prefix of ["/api", "/api/v1"]) {
    assert.equal((await fetch(`${origin}${prefix}/ops/backup-report`, { method: "POST", headers: machine, body: JSON.stringify(report()) })).status, 202);
    assert.equal((await fetch(`${origin}${prefix}/ops/backup-report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report()) })).status, 401);
    assert.equal((await fetch(`${origin}${prefix}/projects/missing`, { method: "PATCH", headers: machine, body: JSON.stringify({ name: "No browser CSRF" }) })).status, 403);
    assert.equal((await fetch(`${origin}${prefix}/ops/backup-report/extra`, { method: "POST", headers: machine, body: JSON.stringify(report()) })).status, 403);
  }
});

test("flag conflicts and unsupported worker changes remain HTTP409 through the real app", async () => {
  const body = { enabled: false, rolloutPercent: 100, baseRevision: 0 };
  const first = await fetch(`${origin}/api/ops/flags/assistant`, { method: "PATCH", headers: machine, body: JSON.stringify(body) });
  assert.equal(first.status, 200);
  const stale = await fetch(`${origin}/api/v1/ops/flags/assistant`, { method: "PATCH", headers: machine, body: JSON.stringify(body) });
  assert.equal(stale.status, 409); assert.equal((await stale.json() as { code: string }).code, "FLAG_CONFLICT");
  const unsupported = await fetch(`${origin}/api/ops/flags/native`, { method: "PATCH", headers: machine, body: JSON.stringify({ ...body, enabled: true }) });
  assert.equal(unsupported.status, 409); assert.equal((await unsupported.json() as { code: string }).code, "FEATURE_UNSUPPORTED");
});

test("valid operations credentials retain monitoring access when the public IP rate budget is exhausted", async () => {
  await fetch(`${origin}/api/countries`);
  await db.prepare("UPDATE runtime_rate_windows SET hits=100000").run();
  try {
    assert.equal((await fetch(`${origin}/api/countries`)).status, 429);
    assert.equal((await fetch(`${origin}/api/ops/metrics`, { headers: machine })).status, 200);
    assert.equal((await fetch(`${origin}/api/v1/ops/check`, { headers: { authorization: `Bearer ${cron}` } })).status, 200);
    assert.equal((await fetch(`${origin}/api/ops/metrics`, { headers: { authorization: `Bearer ${cron}` } })).status, 429);
    assert.equal((await fetch(`${origin}/api/live`)).status, 200);
  } finally { await db.prepare("DELETE FROM runtime_rate_windows").run(); }
});

const contextApp = express();
contextApp.use("/api", vercelRequestContext({ PUBLIC_APP_ORIGIN: "https://app.example.test", VERCEL_URL: "synthetic.vercel.app" }));
contextApp.use(express.json());
contextApp.use("/api/ops", operationsRouter);
contextApp.use("/api", csrfProtection);
contextApp.post("/api/projects", (_req, res) => { res.json({ ok: true }); });
const contextServer = contextApp.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => contextServer.once("listening", resolve));
const contextAddress = contextServer.address(); assert(contextAddress && typeof contextAddress !== "string");
const contextOrigin = `http://127.0.0.1:${contextAddress.port}`;

test("Vercel machine origin exceptions are exact and never waive bearer or verified-proxy checks", async () => {
  const proxy = { ...machine, "x-vercel-forwarded-for": "203.0.113.8" };
  const post = (path: string, headers: Record<string, string>) => fetch(`${contextOrigin}/api${path}`, { method: "POST", headers, body: JSON.stringify(report()) });
  assert.equal((await post("/ops/backup-report", proxy)).status, 202);
  assert.equal((await post("/ops/backup-report", { ...proxy, authorization: "Bearer invalid" })).status, 401);
  assert.equal((await post("/ops/backup-report", machine)).status, 400);
  assert.equal((await post("/ops/backup-report", { ...proxy, origin: "https://attacker.example.test" })).status, 403);
  assert.equal((await post("/ops/backup-report/extra", proxy)).status, 403);
  assert.equal((await post("/projects", proxy)).status, 403);
  assert.equal((await post("/projects", { ...proxy, origin: "https://app.example.test" })).status, 403, "Canonical browser requests still require CSRF");
  const unsupportedFlag = await fetch(`${contextOrigin}/api/ops/flags/not-a-feature`, { method: "PATCH", headers: proxy, body: "{}" });
  assert.equal(unsupportedFlag.status, 403);
});

after(async () => {
  await Promise.all([server, contextServer].map((listener) => new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))));
  await drainTelemetry(); await db.close();
  rmSync(directory, { recursive: true, force: true });
});
