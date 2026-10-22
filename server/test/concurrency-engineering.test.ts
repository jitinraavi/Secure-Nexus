import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { EventEmitter } from "node:events";
import type { Response } from "express";

const directory = mkdtempSync(join(tmpdir(), "groundwork-concurrency-"));
Object.assign(process.env, {
  NODE_ENV: "test", DATABASE_PROVIDER: "sqlite", DATABASE_URL: "", SUPABASE_DB_URL: "",
  GROUNDWORK_DATA_DIR: directory, MASTER_KEY: randomBytes(32).toString("base64"),
  MAIL_PROVIDER: "console", PAYMENTS_MODE: "demo", BIND_HOST: "127.0.0.1",
});
delete process.env.DB_PATH;
delete process.env.PREVIOUS_MASTER_KEY;
const { app } = await import("../src/index.js");
const { db, now } = await import("../src/db.js");
const { createSession } = await import("../src/security.js");
const { randomId } = await import("../src/crypto.js");
const { createWorkspaceArtifact, saveWorkspace } = await import("../src/workspaces.js");
const { reserveProjectSubscription, releaseProjectSubscription, subscribeProject } = await import("../src/collaboration.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const users = [randomId(), randomId(), randomId()];
const actors: { userId: string; sessionId: string; headers: Record<string, string> }[] = [];
for (const userId of users) {
  await db.prepare("INSERT INTO users(id,email,email_verified,password_salt,password_hash,password_changed_at,created_at,updated_at) VALUES(?,?,1,?,?,?,?,?)")
    .run(userId, `${userId}@example.test`, "synthetic-salt", "synthetic-hash", now(), now(), now());
  const cookies = new Map<string, string>();
  const session = await createSession({ cookie(name: string, value: string) { cookies.set(name, value); } } as unknown as Response, userId);
  actors.push({ userId, sessionId: session.sessionId, headers: { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "), "x-csrf-token": session.csrfToken, "content-type": "application/json" } });
}
async function request(actor: number, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${origin}/api${path}`, { method, headers: actors[actor].headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
async function project() {
  const id = randomId();
  await db.prepare("INSERT INTO projects(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)").run(id, users[0], "Concurrency fixture", now(), now());
  for (const userId of users.slice(1)) await db.prepare("INSERT INTO project_members(project_id,user_id,role,invited_by,created_at) VALUES(?,?,'editor',?,?)").run(id, userId, users[0], now());
  return id;
}
const design = (x: number) => JSON.stringify({ entities: [{ id: "object-a", x }] });

test("two editors racing for a lease produce one owner and cannot steal or release that lease", async () => {
  const id = await project();
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const objectId = `race-${iteration}`;
    const results = await Promise.all([1, 2].map((actor) => request(actor, `/collaboration/${id}/locks`, "POST", { objectId, ttlSeconds: 30 })));
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 423]);
    const winner = results[0].status === 201 ? 1 : 2;
    const loser = winner === 1 ? 2 : 1;
    const stored = await db.prepare("SELECT user_id,token FROM project_locks WHERE project_id=? AND object_id=?").get(id, objectId) as { user_id: string; token: string };
    assert.equal(stored.user_id, users[winner]);
    assert.equal(stored.token, results[winner - 1].body.token);
    const denied = await request(loser, `/collaboration/${id}/locks`, "POST", { objectId });
    assert.equal(denied.status, 423);
    assert.equal(denied.body.userId, users[winner]);
    assert.equal((await request(loser, `/collaboration/${id}/locks/${objectId}`, "DELETE")).status, 404);
    const renewed = await request(winner, `/collaboration/${id}/locks`, "POST", { objectId, ttlSeconds: 60 });
    assert.equal(renewed.status, 201);
    assert.notEqual(renewed.body.token, stored.token);
    await db.prepare("UPDATE project_locks SET expires_at=? WHERE project_id=? AND object_id=?").run(now() - 1, id, objectId);
    assert.equal((await request(loser, `/collaboration/${id}/locks`, "POST", { objectId })).status, 201);
  }
});

test("design saves require a safe revision while metadata remains usable without one", async () => {
  const id = await project();
  for (const baseRevision of [undefined, null, -1, 0.5, "0", Number.MAX_SAFE_INTEGER]) {
    const invalid = await request(1, `/projects/${id}`, "PATCH", { designData: design(1), ...(baseRevision === undefined ? {} : { baseRevision }) });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "BASE_REVISION_REQUIRED");
  }
  assert.equal((await request(0, `/projects/${id}`, "PATCH", { name: "Metadata only" })).status, 200);
  const racers = await Promise.all([1, 2].map((actor) => request(actor, `/projects/${id}`, "PATCH", { designData: design(actor), baseRevision: 1 })));
  assert.deepEqual(racers.map((result) => result.status).sort(), [200, 409]);
  const saved = await request(0, `/projects/${id}`);
  const winner = racers[0].status === 200 ? 1 : 2;
  assert.equal(saved.body.revision, 2);
  assert.equal(saved.body.design.entities[0].x, winner);
  const conflict = racers.find((result) => result.status === 409)!;
  assert.equal(conflict.body.currentRevision, 2);
});

test("a live lease protects whole design saves and operation writes", async () => {
  const id = await project();
  assert.equal((await request(0, `/projects/${id}`, "PATCH", { designData: design(0), baseRevision: 0 })).status, 200);
  assert.equal((await request(1, `/collaboration/${id}/locks`, "POST", { objectId: "object-a" })).status, 201);
  const blocked = await request(2, `/projects/${id}`, "PATCH", { designData: design(9), baseRevision: 1 });
  assert.equal(blocked.status, 423);
  assert.equal(blocked.body.objectId, "object-a");
  assert.equal((await request(2, `/collaboration/${id}/operations`, "POST", { operationId: randomId(), baseRevision: 1, kind: "set", path: ["entities", "0", "x"], value: 9 })).status, 423);
  assert.equal((await request(0, `/projects/${id}`)).body.revision, 1);
});

test("concurrent operation retries commit once and return the same revision", async () => {
  const id = await project();
  await request(0, `/projects/${id}`, "PATCH", { designData: design(0), baseRevision: 0 });
  const body = { operationId: randomId(), baseRevision: 1, kind: "set", path: ["entities", "0", "x"], value: 8 };
  const results = await Promise.all([request(1, `/collaboration/${id}/operations`, "POST", body), request(1, `/collaboration/${id}/operations`, "POST", body)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
  assert(results.every((result) => result.body.revision === 2));
  const count = await db.prepare("SELECT COUNT(*) AS count FROM project_operations WHERE project_id=?").get(id) as { count: number };
  assert.equal(count.count, 1);
  assert.equal((await request(0, `/projects/${id}`)).body.revision, 2);
});

test("snapshot restores require a revision and race safely with editor saves", async () => {
  const id = await project();
  await request(0, `/projects/${id}`, "PATCH", { designData: design(0), baseRevision: 0 });
  const snapshot = await request(0, `/projects/${id}/revisions`, "POST", { name: "First revision" });
  assert.equal(snapshot.status, 201);
  await request(0, `/projects/${id}`, "PATCH", { designData: design(1), baseRevision: 1 });
  const path = `/projects/${id}/revisions/${snapshot.body.id}/restore`;
  assert.equal((await request(1, path, "POST", {})).status, 400);
  assert.equal((await request(1, path, "POST", { baseRevision: 1 })).status, 409);
  const results = await Promise.all([request(1, path, "POST", { baseRevision: 2 }), request(2, `/projects/${id}`, "PATCH", { designData: design(2), baseRevision: 2 })]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const saved = await request(0, `/projects/${id}`);
  assert.equal(saved.body.revision, 3);
  assert.equal(saved.body.design.entities[0].x, results[0].status === 200 ? 0 : 2);
});

test("workspace saves validate all 17 scoped artifacts in one read and persist every reference", async () => {
  const id = await project(), otherId = await project();
  const actor = actors[0];
  const artifacts = [];
  for (let index = 0; index < 17; index += 1) artifacts.push(await createWorkspaceArtifact(id, "geometry", actor, `artifact-${index}`, Buffer.from(`payload-${index}`)));
  const foreign = await createWorkspaceArtifact(otherId, "geometry", actor, "foreign", Buffer.from("other project"));
  await assert.rejects(saveWorkspace(id, "geometry", actor, { baseWorkspaceRevision: 0, sourceRevision: 0, payloadArtifactId: artifacts[0].id, referencedArtifactIds: [foreign.id] }), { code: "ARTIFACT_INVALID" });
  const original = db.prepare;
  let reads = 0;
  db.prepare = function(sql: string) {
    if (/SELECT\s+id\s+FROM\s+project_workspace_artifacts/i.test(sql)) reads += 1;
    return original.call(this, sql);
  };
  try {
    const saved = await saveWorkspace(id, "geometry", actor, { baseWorkspaceRevision: 0, sourceRevision: 0, payloadArtifactId: artifacts[0].id, referencedArtifactIds: artifacts.slice(1).map((artifact) => artifact.id) });
    assert.equal(saved.workspace?.revision, 1);
    assert.equal(saved.workspace?.referencedArtifactIds.length, 16);
    assert.equal(reads, 1);
    const refs = await db.prepare("SELECT artifact_id FROM project_workspace_artifact_refs WHERE project_id=? AND kind='geometry'").all(id) as { artifact_id: string }[];
    assert.deepEqual(refs.map((row) => row.artifact_id).sort(), artifacts.slice(1).map((artifact) => artifact.id).sort());
  } finally { db.prepare = original; }
});

test("concurrent SSE reservations admit at most ten connections and expired leases never restore capacity", async () => {
  const id = await project();
  const results = await Promise.allSettled(Array.from({ length: 16 }, () => reserveProjectSubscription(id, users[0])));
  const leases = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof reserveProjectSubscription>>> => result.status === "fulfilled").map((result) => result.value);
  assert.equal(leases.length, 10);
  assert(results.filter((result) => result.status === "rejected").every((result) => (result as PromiseRejectedResult).reason.status === 429));
  await db.prepare("UPDATE project_presence SET expires_at=? WHERE connection_id=?").run(now() - 1, leases[0].connectionId);
  const replacement = await reserveProjectSubscription(id, users[0]);
  const response = Object.assign(new EventEmitter(), {
    destroyed: false, writableEnded: false, writableLength: 0,
    write() { return true; }, end() { this.writableEnded = true; this.emit("finish"); },
  });
  const unsubscribe = await subscribeProject(id, users[0], response as unknown as Response, leases[0]);
  assert.equal(response.writableEnded, true);
  await unsubscribe();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM project_presence WHERE project_id=? AND expires_at>?").get(id, now()) as { count: number };
  assert.equal(count.count, 10);
  await Promise.all([...leases, replacement].map(releaseProjectSubscription));
});

test("slow consumers during initial subscription or ready frame release leases without leaving timers", async () => {
  const id = await project();
  const set = globalThis.setInterval, clear = globalThis.clearInterval;
  const active = new Set<ReturnType<typeof setInterval>>();
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { const timer = Reflect.apply(set, globalThis, args); active.add(timer); return timer; }) as typeof setInterval;
  globalThis.clearInterval = ((timer: ReturnType<typeof setInterval>) => { active.delete(timer); clear(timer); }) as typeof clearInterval;
  const slowResponse = () => Object.assign(new EventEmitter(), {
    destroyed: false, writableEnded: false, writableLength: 0, headersSent: false,
    status() { return this; }, set() { return this; }, flushHeaders() { this.headersSent = true; },
    write() { return false; }, end() { this.writableEnded = true; this.emit("finish"); },
  });
  try {
    const response = slowResponse();
    const unsubscribe = await subscribeProject(id, users[0], response as unknown as Response);
    await unsubscribe();
    assert.equal(response.writableEnded, true);
    assert.equal(active.size, 0);
    const { default: router } = await import("../src/routes/collaboration.js");
    const route = (router as unknown as { stack: { route?: { path: string; stack: { handle: Function }[] } }[] }).stack.find((item) => item.route?.path === "/:projectId/events")!.route!;
    const early = slowResponse();
    await new Promise<void>((resolve, reject) => {
      early.once("finish", resolve);
      route.stack[0].handle({ params: { projectId: id }, user: { id: users[0] }, query: {}, get() { return undefined; } }, early, reject);
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(active.size, 0);
    const count = await db.prepare("SELECT COUNT(*) AS count FROM project_presence WHERE project_id=?").get(id) as { count: number };
    assert.equal(count.count, 0);
  } finally { for (const timer of active) clear(timer); globalThis.setInterval = set; globalThis.clearInterval = clear; }
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await (await import("../src/telemetry.js")).drainTelemetry();
  await db.close();
  rmSync(directory, { recursive: true, force: true });
});
