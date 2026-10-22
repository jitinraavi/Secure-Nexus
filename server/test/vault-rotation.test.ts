import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Response } from "express";
import { decryptAesGcm, deriveVaultKey, encryptAesGcm, randomId } from "../src/crypto.js";
import { decryptWithKeyRotation } from "../src/vaultCrypto.js";

const directory = mkdtempSync(join(tmpdir(), "groundwork-vault-rotation-"));
const currentMasterKey = randomBytes(32), previousMasterKey = randomBytes(32);
const currentKey = deriveVaultKey(currentMasterKey), previousKey = deriveVaultKey(previousMasterKey);
Object.assign(process.env, {
  NODE_ENV: "test", DATABASE_PROVIDER: "sqlite", DATABASE_URL: "", SUPABASE_DB_URL: "",
  GROUNDWORK_DATA_DIR: directory, MASTER_KEY: currentMasterKey.toString("base64"), PREVIOUS_MASTER_KEY: previousMasterKey.toString("base64"),
  MAIL_PROVIDER: "console", PAYMENTS_MODE: "demo", BIND_HOST: "127.0.0.1",
});
delete process.env.DB_PATH;
const { app } = await import("../src/index.js");
const { db, now } = await import("../src/db.js");
const { createSession } = await import("../src/security.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const userId = randomId();
await db.prepare("INSERT INTO users(id,email,email_verified,password_salt,password_hash,password_changed_at,created_at,updated_at) VALUES(?,?,1,?,?,?,?,?)")
  .run(userId, `${userId}@example.test`, "synthetic-salt", "synthetic-hash", now(), now(), now());
const cookies = new Map<string, string>();
const session = await createSession({ cookie(name: string, value: string) { cookies.set(name, value); } } as unknown as Response, userId);
const headers = { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "), "x-csrf-token": session.csrfToken };
type SecretRow = { id: string; user_id: string; name: string; iv: string; tag: string; ciphertext: string; created_at: number; updated_at: number };
async function storedSecret(key: Buffer, aad = `groundwork:vault:${userId}`) {
  const id = randomId(), timestamp = now() - 60;
  const payload = encryptAesGcm("synthetic confidential text", key, aad);
  await db.prepare("INSERT INTO secrets(id,user_id,name,iv,tag,ciphertext,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(id, userId, "Rotation fixture", payload.iv, payload.tag, payload.data, timestamp, timestamp);
  return { id, timestamp, payload };
}
const readRow = async (id: string) => await db.prepare("SELECT * FROM secrets WHERE id=?").get(id) as SecretRow;

test("previous-key decode authenticates owner AAD before generating a current-key reseal", () => {
  const aad = "groundwork:vault:synthetic-owner";
  const old = encryptAesGcm("old secret", previousKey, aad);
  assert.throws(() => decryptAesGcm(old, currentKey, aad));
  const decoded = decryptWithKeyRotation(old, currentKey, previousKey, aad);
  assert.equal(decoded.plaintext, "old secret");
  assert(decoded.resealed);
  assert.equal(decryptAesGcm(decoded.resealed, currentKey, aad), "old secret");
  assert.throws(() => decryptAesGcm(decoded.resealed!, previousKey, aad));
  assert.throws(() => decryptWithKeyRotation(old, currentKey, null, aad));
  assert.throws(() => decryptWithKeyRotation(old, currentKey, previousKey, `${aad}-other`));
  const current = encryptAesGcm("current secret", currentKey, aad);
  assert.deepEqual(decryptWithKeyRotation(current, currentKey, previousKey, aad), { plaintext: "current secret" });
});

test("vault GET reads old ciphertext and persists a current-key reseal without changing logical timestamps", async () => {
  const old = await storedSecret(previousKey);
  const responses = await Promise.all([1, 2].map(() => fetch(`${origin}/api/secrets/${old.id}`, { headers })));
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { plaintext: string }).plaintext, "synthetic confidential text");
  }
  const stored = await readRow(old.id);
  assert.equal(stored.created_at, old.timestamp);
  assert.equal(stored.updated_at, old.timestamp);
  assert.notEqual(stored.ciphertext, old.payload.data);
  const payload = { iv: stored.iv, tag: stored.tag, data: stored.ciphertext };
  assert.equal(decryptAesGcm(payload, currentKey, `groundwork:vault:${userId}`), "synthetic confidential text");
  assert.throws(() => decryptAesGcm(payload, previousKey, `groundwork:vault:${userId}`));
  const second = await fetch(`${origin}/api/secrets/${old.id}`, { headers });
  assert.equal(second.status, 200);
  assert.deepEqual(await readRow(old.id), stored, "A current-key read does not rewrite ciphertext");
});

test("rotation compares old ciphertext and cannot overwrite a concurrent replacement", async () => {
  const old = await storedSecret(previousKey);
  const replacement = encryptAesGcm("concurrent replacement", currentKey, `groundwork:vault:${userId}`);
  const original = db.prepare;
  let injected = false;
  db.prepare = function(sql: string) {
    const statement = original.call(this, sql);
    if (/^UPDATE secrets SET iv=\?,tag=\?,ciphertext=\? WHERE/.test(sql)) {
      const run = statement.run.bind(statement);
      statement.run = async (...values: unknown[]) => {
        if (!injected) {
          injected = true;
          await original.call(db, "UPDATE secrets SET iv=?,tag=?,ciphertext=? WHERE id=?")
            .run(replacement.iv, replacement.tag, replacement.data, old.id);
        }
        return run(...values);
      };
    }
    return statement;
  };
  try {
    const response = await fetch(`${origin}/api/secrets/${old.id}`, { headers });
    assert.equal(response.status, 200);
    assert(injected);
  } finally { db.prepare = original; }
  const stored = await readRow(old.id);
  assert.deepEqual({ iv: stored.iv, tag: stored.tag, data: stored.ciphertext }, replacement);
});

test("unrelated owner ciphertext fails authentication and is never resealed", async () => {
  const old = await storedSecret(previousKey, "groundwork:vault:another-owner");
  const before = await readRow(old.id);
  const response = await fetch(`${origin}/api/secrets/${old.id}`, { headers });
  assert.equal(response.status, 500);
  const body = await response.json() as { error: string };
  assert(!JSON.stringify(body).includes("synthetic confidential text"));
  assert.deepEqual(await readRow(old.id), before);
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await (await import("../src/telemetry.js")).drainTelemetry();
  await db.close();
  rmSync(directory, { recursive: true, force: true });
});
