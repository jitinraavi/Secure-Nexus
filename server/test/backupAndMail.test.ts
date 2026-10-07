import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const testDataDir = mkdtempSync(join(tmpdir(), "secure-nexus-backup-test-"));
process.env.NODE_ENV = "development";
process.env.GROUNDWORK_DATA_DIR = testDataDir;
process.env.MASTER_KEY = randomBytes(32).toString("base64");
process.env.GROUNDWORK_DEV_OTP = "1";
process.env.MAIL_PROVIDER = "console";
delete process.env.DB_PATH;
delete process.env.PREVIOUS_MASTER_KEY;

const { app } = await import("../src/index.js");
const { performDatabaseBackup, listDatabaseBackups, checkpointDatabase } = await import("../src/databaseBackup.js");
const { testMailConnection } = await import("../src/mailer.js");

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Test server did not expose a TCP address");
}
const baseUrl = `http://127.0.0.1:${address.port}`;

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    rmSync(testDataDir, { recursive: true, force: true });
  } catch {
    // Ignore Windows file lock on temporary sqlite db during test exit
  }
});

class CookieClient {
  private readonly cookies = new Map<string, string>();

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) {
      headers.set(
        "cookie",
        [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }

    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const setCookies = getSetCookie
      ? getSetCookie.call(response.headers)
      : response.headers.get("set-cookie")?.split(/, (?=[^;]+=)/g) || [];
    for (const setCookie of setCookies) {
      const pair = setCookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    return response;
  }

  get csrfToken(): string {
    return this.cookies.get("csrf") || "";
  }
}

test("Database backup and maintenance suite", async (t) => {
  await t.test("performs atomic hot backup and verifies database integrity", async () => {
    const result = await performDatabaseBackup({ label: "test-snapshot", pruneCount: 5 });
    assert.ok(result.backupFile.includes("test-snapshot"));
    assert.strictEqual(result.integrity, "ok");
    assert.ok(result.sizeBytes > 0);

    const list = await listDatabaseBackups();
    assert.ok(list.length >= 1);
    const found = list.find((b) => b.filename === result.backupFile);
    assert.ok(found);
    assert.strictEqual(found?.integrity, true);
  });

  await t.test("executes WAL checkpoint without errors", () => {
    const check = checkpointDatabase("TRUNCATE");
    assert.strictEqual(typeof check.busy, "number");
    assert.strictEqual(typeof check.log, "number");
    assert.strictEqual(typeof check.checkpointed, "number");
  });

  await t.test("tests outbound email deliverability diagnostics", async () => {
    const diag = await testMailConnection("architect@example.com");
    assert.strictEqual(diag.ok, true);
    assert.strictEqual(diag.provider, "console");
    assert.ok(diag.details.length > 0);
  });

  await t.test("executes backup and test-mail endpoints via authenticated API", async () => {
    const client = new CookieClient();
    await client.request("/api/auth/bootstrap");

    const email = `architect-${Date.now()}@example.com`;
    const signupRes = await client.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "Password123!",
        confirmPassword: "Password123!",
        account_type: "individual",
        country: "US",
      }),
    });
    const signupJson = await signupRes.json();
    assert.ok(signupJson.devOtp);

    await client.request("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: signupJson.devOtp }),
    });

    await client.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "Password123!" }),
    });

    // Test Mail endpoint
    const testMailRes = await client.request("/api/auth/test-mail", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": client.csrfToken,
      },
      body: JSON.stringify({ recipient: email }),
    });
    assert.strictEqual(testMailRes.status, 200);
    const testMailJson = await testMailRes.json();
    assert.strictEqual(testMailJson.ok, true);
    assert.strictEqual(testMailJson.provider, "console");

    // Non-admin attempting arbitrary external recipient defaults safely to own email
    const relayAttemptRes = await client.request("/api/auth/test-mail", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": client.csrfToken,
      },
      body: JSON.stringify({ recipient: "attacker@external-domain.com" }),
    });
    assert.strictEqual(relayAttemptRes.status, 200);
    const relayAttemptJson = await relayAttemptRes.json();
    assert.strictEqual(relayAttemptJson.ok, true);

    // Admin Backups list
    const backupsListRes = await client.request("/api/admin/backups");
    assert.strictEqual(backupsListRes.status, 200);
    const backupsListJson = await backupsListRes.json();
    assert.ok(Array.isArray(backupsListJson.backups));

    // Admin Backup create
    const createBackupRes = await client.request("/api/admin/backups", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": client.csrfToken,
      },
      body: JSON.stringify({ label: "api-triggered" }),
    });
    assert.strictEqual(createBackupRes.status, 201);
    const createBackupJson = await createBackupRes.json();
    assert.strictEqual(createBackupJson.ok, true);
    assert.strictEqual(createBackupJson.backup.integrity, "ok");

    // Admin WAL Checkpoint
    const checkpointRes = await client.request("/api/admin/backups/checkpoint", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": client.csrfToken,
      },
      body: JSON.stringify({ mode: "TRUNCATE" }),
    });
    assert.strictEqual(checkpointRes.status, 200);
    const checkpointJson = await checkpointRes.json();
    assert.strictEqual(checkpointJson.ok, true);
  });
});
