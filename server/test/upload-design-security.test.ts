import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { after, test } from "node:test";
import express, { type Response } from "express";

const directory = mkdtempSync(join(tmpdir(), "groundwork-security-upload-"));
process.env.NODE_ENV = "test";
process.env.GROUNDWORK_DATA_DIR = directory;
process.env.MASTER_KEY = randomBytes(32).toString("base64");
process.env.MAIL_PROVIDER = "console";
process.env.PAYMENTS_MODE = "demo";
process.env.BIND_HOST = "127.0.0.1";
delete process.env.DB_PATH;
delete process.env.PREVIOUS_MASTER_KEY;
const { app } = await import("../src/index.js");
const { db, now } = await import("../src/db.js");
const { createSession } = await import("../src/security.js");
const { hashPassword } = await import("../src/crypto.js");
const { conflictingDesignLock } = await import("../src/designLocks.js");
const { parseDesignInput, validateDesignComplexity } = await import("../src/designValidation.js");
const { boundedUpload } = await import("../src/uploads.js");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const userId = randomBytes(16).toString("hex"), secondUserId = randomBytes(16).toString("hex");
const projectId = randomBytes(16).toString("hex");
const credentials = hashPassword("SyntheticPassword2026");
for (const id of [userId, secondUserId]) {
  db.prepare("INSERT INTO users(id,email,email_verified,password_salt,password_hash,password_changed_at,created_at,updated_at) VALUES(?,?,1,?,?,?,?,?)")
    .run(id, `${id}@example.test`, credentials.salt, credentials.hash, now(), now(), now());
}
db.prepare("INSERT INTO projects(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)")
  .run(projectId, userId, "Security fixture", now(), now());
const cookies = new Map<string, string>();
const session = createSession({ cookie(name: string, value: string) { cookies.set(name, value); } } as unknown as Response, userId);
const headers = { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "), "x-csrf-token": session.csrfToken };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
function photo(extra?: [string, string]): FormData {
  const body = new FormData();
  if (extra) body.append(...extra);
  body.append("photo", new Blob([png], { type: "image/png" }), "photo.png");
  return body;
}

test("photo uploads reject unauthorized projects before multipart parsing", async () => {
  const response = await fetch(`${origin}/api/projects/missing/photo`, { method: "POST", headers, body: photo(["items[999999999]", "x"]) });
  assert.equal(response.status, 404);
});

test("photo parser rejects extra/nested text fields while preserving valid uploads", async () => {
  for (const field of ["unexpected", "items[999999999]", "items[a][b]"]) {
    const response = await fetch(`${origin}/api/projects/${projectId}/photo`, { method: "POST", headers, body: photo([field, "x"]) });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "INVALID_MULTIPART");
  }
  const response = await fetch(`${origin}/api/projects/${projectId}/photo`, { method: "POST", headers, body: photo() });
  assert.equal(response.status, 200);
  const image = await fetch(`${origin}/api/projects/${projectId}/photo`, { headers });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("cache-control"), "private, no-store");
});

test("malformed, deep and oversized designs are rejected before lock work or mutation", async () => {
  let deep: unknown = {};
  for (let index = 0; index < 70; index++) deep = { child: deep };
  assert.throws(() => validateDesignComplexity(deep), /nesting depth/);
  assert.throws(() => validateDesignComplexity(new Array(100_001).fill(0)), /too many/);
  assert.throws(() => parseDesignInput("not JSON"), /valid JSON/);
  for (const value of ["not JSON", JSON.stringify(deep), JSON.stringify(new Array(100_001).fill(0))]) {
    const response = await fetch(`${origin}/api/projects/${projectId}`, {
      method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ designData: value }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "INVALID_DESIGN");
  }
  const row = db.prepare("SELECT revision,design_data FROM projects WHERE id=?").get(projectId) as { revision: number; design_data: string | null };
  assert.equal(row.revision, 0);
  assert.equal(row.design_data, null);
});

test("linear duplicate-ID collection preserves lock conflict behavior", () => {
  db.prepare("INSERT INTO project_locks(project_id,object_id,user_id,token,expires_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run(projectId, "duplicate", secondUserId, randomBytes(16).toString("hex"), now() + 60, now());
  const before = { objects: Array.from({ length: 25_000 }, () => ({ id: "duplicate" })) };
  assert.equal(conflictingDesignLock(projectId, userId, before, before), null);
  const afterDesign = { objects: [...before.objects, { id: "duplicate" }] };
  assert.equal(conflictingDesignLock(projectId, userId, before, afterDesign), "duplicate");
});

test("many unresolved locks compare a whole design only once", () => {
  const insert = db.prepare("INSERT INTO project_locks(project_id,object_id,user_id,token,expires_at,updated_at) VALUES(?,?,?,?,?,?)");
  for (let index = 0; index < 100; index++) insert.run(projectId, `unresolved-${index}`, secondUserId, randomBytes(16).toString("hex"), now() + 60, now());
  const before = { values: Array.from({ length: 25_000 }, (_, index) => index) };
  const unchanged = { values: [...before.values] };
  const stringify = JSON.stringify;
  let wholeDesignComparisons = 0;
  JSON.stringify = ((value: unknown, ...options: unknown[]) => {
    if (value === before || value === unchanged) wholeDesignComparisons++;
    return Reflect.apply(stringify, JSON, [value, ...options]);
  }) as typeof JSON.stringify;
  try {
    assert.equal(conflictingDesignLock(projectId, userId, before, unchanged), null);
    assert.equal(wholeDesignComparisons, 2, "Unresolved locks must not repeatedly serialize the same designs");
  } finally { JSON.stringify = stringify; }
  assert.ok(conflictingDesignLock(projectId, userId, before, { values: [1] }));
});

const parserApp = express();
parserApp.use((req, _res, next) => { (req as typeof req & { user: { id: string } }).user = { id: "parser-fixture" }; next(); });
parserApp.post("/upload", boundedUpload("file", { fileSize: 64, fields: 0, fieldSize: 0, parts: 1, maxBytes: 256, deadlineMs: 1000 }), (_req, res) => res.json({ ok: true }));
const parserServer = parserApp.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => parserServer.once("listening", resolve));
const parserAddress = parserServer.address();
assert(parserAddress && typeof parserAddress !== "string");
const parserPort = parserAddress.port;

function chunkedRequest(write: (request: http.ClientRequest) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port: parserPort, path: "/upload", method: "POST", headers: { "content-type": "multipart/form-data; boundary=security-fixture" } }, (response) => {
      response.resume(); response.on("end", () => resolve(response.statusCode!));
    });
    request.on("error", reject);
    write(request);
  });
}

test("chunked malformed bodies remain subject to the total wire-byte budget", async () => {
  const status = await chunkedRequest((request) => {
    request.write("--security-fixture\r\nContent-Disposition: form-data; name=\"extra\"\r\n\r\nx\r\n");
    request.end("x".repeat(512));
  });
  assert.equal(status, 413);
});

test("slow multipart bodies have a deadline and release admission afterward", async () => {
  const status = await chunkedRequest((request) => {
    request.write("--security-fixture\r\nContent-Disposition: form-data; name=\"file\"; filename=\"f\"\r\n\r\nx");
  });
  assert.equal(status, 408);
  const body = new FormData(); body.append("file", new Blob(["hello"]), "f");
  const response = await fetch(`http://127.0.0.1:${parserPort}/upload`, { method: "POST", body });
  assert.equal(response.status, 200);
});

after(async () => {
  await Promise.all([server, parserServer].map((listener) => new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))));
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
