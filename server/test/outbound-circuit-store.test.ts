import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { CircuitBreaker, CircuitOpenError } from "../src/runtimeResilience.js";

process.env.DATABASE_PROVIDER = "sqlite";
process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
process.env.MASTER_KEY = randomBytes(32).toString("base64");
const directory = mkdtempSync(join(tmpdir(), "groundwork-circuit-"));
process.env.GROUNDWORK_DATA_DIR = directory;
delete process.env.DB_PATH;
delete process.env.PREVIOUS_MASTER_KEY;
const { db } = await import("../src/db.js");
const { DatabaseCircuitStore } = await import("../src/outboundCircuitStore.js");
after(async () => { await db.close(); rmSync(directory, { force: true, recursive: true }); });

test("independent database circuit stores share failures and serialize the single half-open probe", async () => {
  let now = Date.now();
  const settings = { failureThreshold: 1, cooldownMs: 100, probeLeaseMs: 100 };
  const one = new CircuitBreaker(new DatabaseCircuitStore(), settings, () => now);
  const two = new CircuitBreaker(new DatabaseCircuitStore(), settings, () => now);
  const permit = await one.acquire("shared-provider");
  await one.complete(permit, "failure");
  await assert.rejects(two.acquire("shared-provider"), CircuitOpenError);
  now += 101;
  const attempts = await Promise.allSettled([one.acquire("shared-provider"), two.acquire("shared-provider")]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter(result => result.status === "rejected").length, 1);
  const winner = attempts.find(result => result.status === "fulfilled");
  assert.ok(winner?.status === "fulfilled");
  await two.complete(winner.value, "success");
  assert.equal((await one.acquire("shared-provider")).probe, false);
  await two.reset("shared-provider");
});

test("database circuit keys are capped without evicting live recovery fences", async () => {
  const breaker = new CircuitBreaker(new DatabaseCircuitStore(2), { failureThreshold: 1, cooldownMs: 100, probeLeaseMs: 100 });
  await breaker.acquire("bounded-second");
  await assert.rejects(breaker.acquire("bounded-third"), /capacity/);
  const total = await db.prepare("SELECT COUNT(*) AS count FROM outbound_circuits").get() as { count: number };
  assert.equal(total.count, 2);
});
