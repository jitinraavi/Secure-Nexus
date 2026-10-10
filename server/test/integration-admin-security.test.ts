import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

// Every credential and account is synthetic. No local .env or external provider is used.
dotenv.config = () => ({ parsed: {} });
const fixtureDir = mkdtempSync(join(tmpdir(), "secure-nexus-admin-security-"));
const adminEmail = "admin@example.invalid";
Object.assign(process.env, {
  NODE_ENV: "production", BIND_HOST: "127.0.0.1", GROUNDWORK_DATA_DIR: fixtureDir, DB_PATH: "",
  MASTER_KEY: randomBytes(32).toString("base64"), PREVIOUS_MASTER_KEY: "", PAYMENTS_MODE: "live",
  GROUNDWORK_SERVER_ROLE: "authority", GROUNDWORK_AUTHORITY_GATEWAY_MODE: "direct",
  GROUNDWORK_AUTHORITY_URL: "", GROUNDWORK_TRUSTED_PROXY_IPS: "", ADMIN_EMAILS: "Admin@Example.Invalid",
  GROUNDWORK_DEV_OTP: "1", GROUNDWORK_SEED_DEMO: "", GROUNDWORK_DEMO_PASSWORD: "",
  MAIL_PROVIDER: "smtp", MAIL_HOST: "smtp.example.invalid", MAIL_PORT: "587", MAIL_SECURE: "false",
  MAIL_USER: "synthetic-smtp-user", MAIL_PASS: randomBytes(32).toString("hex"),
  MAIL_FROM: "Groundwork Fixture <mailer@example.invalid>",
});
for (const name of ["RESEND_API_KEY", "AI_API_KEY", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_ACCOUNT_ID", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET",
  "PAYPAL_MERCHANT_ID", "COLLABORATION_REDIS_REST_URL", "COLLABORATION_REDIS_REST_TOKEN"])
  process.env[name] = "";

const originalCreateTransport = nodemailer.createTransport;
const messages: Array<Record<string, unknown>> = [];
const transportOptions: Array<Record<string, unknown>> = [];
const providerFailure = `SyntheticProviderFailure-${randomBytes(24).toString("hex")}`;
let failureStage: "verify" | "send" | undefined;
nodemailer.createTransport = ((options: Record<string, unknown>) => {
  transportOptions.push(options);
  return {
    async verify() {
      if (failureStage === "verify") throw new Error(providerFailure);
      return true;
    },
    async sendMail(message: Record<string, unknown>) {
      messages.push(message);
      if (failureStage === "send") throw new Error(providerFailure);
      return { messageId: "synthetic-mail-id" };
    },
  };
}) as typeof nodemailer.createTransport;

const [{ app }, { db, now }, { MAIL }, { sha256Hex }] = await Promise.all([
  import("../src/index.js"), import("../src/db.js"), import("../src/config.js"), import("../src/crypto.js"),
]);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("Fixture server failed to bind");
const baseUrl = `http://127.0.0.1:${address.port}`;

type Identity = { email: string; token: string; csrf: string };
function identity(id: string, email: string): Identity {
  const token = randomBytes(32).toString("hex"), csrf = randomBytes(24).toString("hex");
  db.prepare(`INSERT INTO users (id,email,email_verified,password_salt,password_hash,password_changed_at,created_at,updated_at)
    VALUES (?,?,1,'synthetic-unused-salt','synthetic-unused-hash',?,?,?)`).run(id, email, now(), now(), now());
  db.prepare(`INSERT INTO sessions (id,user_id,token_hash,csrf_token,status,created_at,last_seen_at,expires_at,credential_version)
    VALUES (?,?,?,?,'active',?,?,?,0)`).run(`session-${id}`, id, sha256Hex(token), csrf, now(), now(), now() + 3600);
  return { email, token, csrf };
}
const member = identity("ordinary-fixture", "member@example.invalid");
const admin = identity("admin-fixture", adminEmail);
async function request(actor: Identity | undefined, method: string, path: string, body?: unknown, sendCsrf = true) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(actor ? { cookie: `sid=${actor.token}; csrf=${actor.csrf}` } : {}),
      ...(actor && sendCsrf ? { "x-csrf-token": actor.csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
after(async () => {
  nodemailer.createTransport = originalCreateTransport;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  rmSync(fixtureDir, { recursive: true, force: true });
});

test("production backups require an authenticated allowlisted admin", async () => {
  assert.equal((await request(undefined, "GET", "/api/admin/backups")).status, 401);
  assert.equal((await request(member, "GET", "/api/admin/backups")).status, 403);
  assert.equal((await request(member, "POST", "/api/admin/backups", { label: "denied-fixture" })).status, 403);
  const listing = await request(admin, "GET", "/api/admin/backups");
  assert.equal(listing.status, 200);
  assert.ok(Array.isArray(listing.body.backups));
  const created = await request(admin, "POST", "/api/admin/backups", { label: "allowed-fixture" });
  assert.equal(created.status, 201);
  assert.equal(created.body.ok, true);
});

test("ordinary mail diagnostics require CSRF and send only to the authenticated account", async () => {
  const count = messages.length;
  assert.equal((await request(member, "POST", "/api/auth/test-mail", { recipient: "other@example.invalid" }, false)).status, 403);
  assert.equal(messages.length, count);
  const result = await request(member, "POST", "/api/auth/test-mail", { recipient: "other@example.invalid" });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(messages.length, count + 1);
  assert.equal(messages.at(-1)?.to, member.email);
  assert.equal(transportOptions.at(-1)?.requireTLS, true);
});

test("allowlisted admin diagnostics retain the selected-recipient feature", async () => {
  const recipient = "admin-selected@example.invalid", count = messages.length;
  const result = await request(admin, "POST", "/api/auth/test-mail", { recipient });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(messages.length, count + 1);
  assert.equal(messages.at(-1)?.to, recipient);
});

test("unconfigured production mail reports unavailable without falling back to development delivery", async () => {
  const originalHost = MAIL.host, count = messages.length;
  MAIL.host = "";
  try {
    const result = await request(member, "POST", "/api/auth/test-mail", {});
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.provider, "unavailable");
    assert.equal(messages.length, count);
  } finally {
    MAIL.host = originalHost;
  }
});

test("SMTP diagnostic failures do not disclose raw provider exceptions", async () => {
  try {
    for (const stage of ["verify", "send"] as const) {
      failureStage = stage;
      const result = await request(member, "POST", "/api/auth/test-mail", {});
      assert.equal(result.status, 200);
      assert.equal(result.body.ok, false);
      assert.equal(result.body.provider, "smtp");
      assert.ok(!JSON.stringify(result.body).includes(providerFailure));
      assert.equal(result.body.details, "SMTP verification or test delivery failed. Check the server mail configuration.");
    }
  } finally {
    failureStage = undefined;
  }
});

test("production signup does not expose an OTP when SMTP fails despite a development-OTP environment flag", async () => {
  const password = `SyntheticSignup${randomBytes(16).toString("hex")}123!`;
  failureStage = "send";
  try {
    const result = await request(undefined, "POST", "/api/auth/signup", {
      email: "new-owner@example.invalid", password, confirmPassword: password, accountType: "individual", country: "US",
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.emailDelivered, false);
    assert.ok(!("devOtp" in result.body) && !("devOtpNote" in result.body));
    assert.ok(!JSON.stringify(result.body).includes(providerFailure));
    assert.equal(MAIL.devOtp, false);
  } finally {
    failureStage = undefined;
  }
});
