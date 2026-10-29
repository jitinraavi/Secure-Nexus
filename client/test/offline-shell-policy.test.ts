import assert from "node:assert/strict";
import test from "node:test";
import { offlineShellRegistration, type OfflineShellRegistrationAccess } from "../src/lib/offlineShellPolicy";

test("routine first-visit inspection cannot start the public-shell download", async () => {
  const calls: string[] = [];
  const access: OfflineShellRegistrationAccess<{ active: boolean }> = {
    async getRegistration(scope) { calls.push("inspect:" + scope); return undefined; },
    async register() { throw new Error("An inspection must not register a worker"); },
  };
  assert.equal(await offlineShellRegistration(access, "inspect"), undefined);
  assert.deepEqual(calls, ["inspect:/"]);
});

test("an already installed registration remains usable without update, unregister or reload", async () => {
  const existing = { active: true };
  const access: OfflineShellRegistrationAccess<typeof existing> = {
    async getRegistration(scope) { assert.equal(scope, "/"); return existing; },
    async register() { throw new Error("Existing offline access must not require a fresh download"); },
  };
  assert.equal(await offlineShellRegistration(access, "inspect"), existing);
});

test("only explicit preparation registers the built worker with its version-safe options and permits retry", async () => {
  const existing = { active: true };
  const calls: unknown[] = [];
  let fail = true;
  const access: OfflineShellRegistrationAccess<typeof existing> = {
    async getRegistration() { return undefined; },
    async register(script, options) {
      calls.push({ script, options });
      if (fail) throw new Error("network unavailable");
      return existing;
    },
  };
  await assert.rejects(offlineShellRegistration(access, "prepare"), /network unavailable/);
  fail = false;
  assert.equal(await offlineShellRegistration(access, "prepare"), existing);
  assert.deepEqual(calls, [
    { script: "/sw.js", options: { scope: "/", updateViaCache: "none" } },
    { script: "/sw.js", options: { scope: "/", updateViaCache: "none" } },
  ]);
});
