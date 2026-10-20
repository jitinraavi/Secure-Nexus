import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { readMailConfiguration } from "../src/mailConfig.js";

// Isolated synthetic transport: never reads the real .env, opens SMTP, or sends email.
dotenv.config = () => ({ parsed: {} });
const fixture = mkdtempSync(join(tmpdir(), "groundwork-mail-test-"));
Object.assign(process.env, {
  NODE_ENV: "test", BIND_HOST: "127.0.0.1", PAYMENTS_MODE: "demo",
  GROUNDWORK_DATA_DIR: fixture, MASTER_KEY: randomBytes(32).toString("base64"),
  PREVIOUS_MASTER_KEY: "", DB_PATH: "", MAIL_PROVIDER: "smtp", MAIL_HOST: "smtp.gmail.com",
  MAIL_PORT: "465", MAIL_SECURE: "", MAIL_USER: "smtp-fixture@gmail.com",
  MAIL_PASS: "abcd efgh ijkl mnop", MAIL_FROM: "", RESEND_API_KEY: "", GROUNDWORK_DEV_OTP: "0",
});
const recipient = "recipient@example.invalid";
const sent: Record<string, unknown>[] = [];
let receipt: unknown = { accepted: [recipient], rejected: [] };
let sendError: unknown;
let verifyError: unknown;
let transportCount = 0;
let transportOptions: Record<string, unknown> = {};
const originalCreate = nodemailer.createTransport;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Unexpected network request in isolated mail test"); };
nodemailer.createTransport = ((options: Record<string, unknown>) => {
  transportCount++;
  transportOptions = options;
  return {
    async sendMail(message: Record<string, unknown>) {
      sent.push(message);
      if (sendError) throw sendError;
      return receipt;
    },
    async verify() { if (verifyError) throw verifyError; return true; },
  };
}) as typeof nodemailer.createTransport;
const { MAIL } = await import("../src/config.js");
const { sendMail, sendOtpEmail, testMailConnection } = await import("../src/mailer.js");
after(() => {
  nodemailer.createTransport = originalCreate;
  globalThis.fetch = originalFetch;
  rmSync(fixture, { recursive: true, force: true });
});

const smtpEnv = {
  MAIL_PROVIDER: " SMTP ", MAIL_HOST: " SMTP.GMAIL.COM ", MAIL_USER: " fixture@gmail.com ",
  MAIL_PASS: "abcd efgh ijkl mnop", MAIL_PORT: "465", MAIL_SECURE: "", MAIL_FROM: "",
};
const parse = (overrides: Record<string, string> = {}, isProd = false) =>
  readMailConfiguration({ ...smtpEnv, ...overrides }, { isProd, allowDevOtp: false });

test("mail configuration applies Gmail TLS, sender and displayed app-password defaults", () => {
  const config = parse();
  assert.equal(config.configError, undefined);
  assert.equal(config.provider, "smtp");
  assert.equal(config.host, "smtp.gmail.com");
  assert.equal(config.user, "fixture@gmail.com");
  assert.equal(config.pass, "abcdefghijklmnop");
  assert.equal(parse({ MAIL_PASS: "abcd efgh 1234 5678" }).pass, "abcdefgh12345678");
  assert.equal(config.from, "Groundwork <fixture@gmail.com>");
  assert.equal(config.secure, true);
  assert.equal(config.requireTLS, false);
  const starttls = parse({ MAIL_PORT: "587", MAIL_SECURE: "false" });
  assert.equal(starttls.secure, false);
  assert.equal(starttls.requireTLS, true);
  assert.equal(parse({ MAIL_FROM: "Studio <sender@example.invalid>" }).from, "Studio <sender@example.invalid>");
  assert.equal(parse({ MAIL_HOST: "smtp.example.invalid", MAIL_PASS: "  exact password  " }).pass, "  exact password  ");
});

test("mail configuration rejects broken TLS, ports, provider and incomplete credentials", () => {
  for (const overrides of [
    { MAIL_SECURE: "false" }, { MAIL_PORT: "587", MAIL_SECURE: "true" },
    { MAIL_PORT: "65536" }, { MAIL_PORT: "587.5" }, { MAIL_PORT: "invalid" },
    { MAIL_SECURE: "yes" }, { MAIL_PROVIDER: "unknown" }, { MAIL_PASS: "" },
    { MAIL_FROM: "invalid sender" }, { MAIL_FROM: "Sender <a@example.invalid>\r\nBcc: other@example.invalid" },
  ]) assert.ok(parse(overrides).configError, JSON.stringify(Object.keys(overrides)));
  assert.match(parse({ MAIL_PASS: "" }).configError!, /MAIL_PASS/);
  const partialAuto = readMailConfiguration({ MAIL_HOST: "smtp.gmail.com" }, { isProd: false, allowDevOtp: true });
  assert.equal(partialAuto.provider, "smtp");
  assert.ok(partialAuto.configError);
  const consoleProd = readMailConfiguration({ MAIL_PROVIDER: "console" }, { isProd: true, allowDevOtp: true });
  assert.ok(consoleProd.configError);
  assert.equal(consoleProd.devOtp, false);
  const otherSmtp = parse({ MAIL_HOST: "smtp.example.invalid", MAIL_PORT: "587" }, true);
  assert.equal(otherSmtp.requireTLS, true);
});

test("SMTP sends plaintext and escaped HTML and reuses a secure transport", async () => {
  const text = 'Code 123456\n<b>not markup</b> & "quoted"';
  assert.deepEqual(await sendMail(recipient, "Synthetic test", text), { delivered: true, via: "smtp" });
  assert.equal(sent.at(-1)?.text, text);
  assert.match(String(sent.at(-1)?.html), /&lt;b&gt;not markup&lt;\/b&gt; &amp; &quot;quoted&quot;/);
  assert.match(String(sent.at(-1)?.html), /123456<br\/>/);
  assert.equal(sent.at(-1)?.from, "Groundwork <smtp-fixture@gmail.com>");
  assert.equal(transportOptions.port, 465);
  assert.equal(transportOptions.secure, true);
  assert.equal(transportOptions.requireTLS, false);
  assert.deepEqual(transportOptions.auth, { user: "smtp-fixture@gmail.com", pass: "abcdefghijklmnop" });
  await sendOtpEmail(recipient, "654321");
  assert.equal(transportCount, 1);
});

test("SMTP needs acceptance for the intended recipient, with no rejection or deferral", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const response of [
    { messageId: "id-without-acceptance" }, { accepted: [], rejected: [recipient] },
    { accepted: ["different@example.invalid"], rejected: [] },
    { accepted: [recipient], rejected: [recipient] }, { accepted: [recipient], pending: [recipient] },
  ]) {
    receipt = response;
    const result = await sendOtpEmail(recipient, "123456");
    assert.equal(result.delivered, false);
    assert.equal(result.errorCode, "recipient");
  }
  receipt = { accepted: [{ address: recipient.toUpperCase() }], rejected: [] };
  assert.equal((await sendOtpEmail(recipient, "123456")).delivered, true);
  receipt = { accepted: [recipient], rejected: [] };
});

test("mail failures expose only stable categories, never SMTP response contents", async (t) => {
  const logged: string[] = [];
  t.mock.method(console, "error", (...values: unknown[]) => logged.push(values.join(" ")));
  for (const [error, expected] of [
    [{ code: "EAUTH", response: "secret-password recipient@example.invalid OTP 123456" }, "auth"],
    [{ code: "ETIMEDOUT" }, "timeout"], [{ code: "ESOCKET" }, "connect"],
    [{ code: "EENVELOPE", command: "MAIL FROM" }, "sender"],
    [{ code: "EENVELOPE", command: "RCPT TO" }, "recipient"],
    [new Error("secret-password recipient@example.invalid OTP 123456"), "service"],
  ] as const) {
    sendError = error;
    const result = await sendOtpEmail(recipient, "123456");
    assert.equal(result.delivered, false);
    assert.equal(result.errorCode, expected);
    assert.doesNotMatch(JSON.stringify(result), /secret-password|recipient@example|123456/);
  }
  sendError = undefined;
  assert.doesNotMatch(logged.join("\n"), /secret-password|recipient@example|123456/);
});

test("diagnostics distinguish connection verification from recipient acceptance", async (t) => {
  t.mock.method(console, "error", () => {});
  let diagnostic = await testMailConnection();
  assert.equal(diagnostic.ok, true);
  assert.equal(diagnostic.delivered, false);
  assert.match(diagnostic.details, /have not been tested/);
  receipt = { accepted: [], rejected: [recipient] };
  diagnostic = await testMailConnection(recipient);
  assert.equal(diagnostic.ok, false);
  assert.equal(diagnostic.errorCode, "recipient");
  assert.doesNotMatch(diagnostic.details, /recipient@example/);
  receipt = { accepted: [recipient], rejected: [] };
  diagnostic = await testMailConnection(recipient);
  assert.equal(diagnostic.ok, true);
  assert.equal(diagnostic.delivered, true);
  assert.match(diagnostic.details, /inbox placement is not confirmed/);
  verifyError = { code: "EAUTH", response: "secret-password" };
  const sentBefore = sent.length;
  diagnostic = await testMailConnection(recipient);
  assert.equal(diagnostic.ok, false);
  assert.equal(diagnostic.errorCode, "auth");
  assert.equal(sent.length, sentBefore);
  verifyError = undefined;
});

test("missing SMTP configuration fails safely; local console never claims email delivery", async () => {
  const original = { ...MAIL };
  try {
    Object.assign(MAIL, parse({ MAIL_PASS: "" }));
    const failed = await sendOtpEmail(recipient, "123456");
    assert.equal(failed.delivered, false);
    assert.equal(failed.errorCode, "config");
    assert.equal(failed.devCode, undefined);
    assert.equal((await testMailConnection()).ok, false);
    Object.assign(MAIL, readMailConfiguration({ MAIL_PROVIDER: "console" }, { isProd: false, allowDevOtp: true }));
    assert.deepEqual(await sendOtpEmail(recipient, "123456"), { delivered: false, via: "console", devCode: "123456" });
    const diagnostic = await testMailConnection(recipient);
    assert.equal(diagnostic.delivered, false);
    assert.match(diagnostic.details, /No email was sent/);
  } finally { Object.assign(MAIL, original); }
});

test("Resend needs an acknowledged message identifier, with plaintext included", async (t) => {
  t.mock.method(console, "error", () => {});
  const original = { ...MAIL };
  let payload: Record<string, unknown> = {};
  try {
    Object.assign(MAIL, readMailConfiguration({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "synthetic-key", MAIL_FROM: "sender@example.invalid" }, { isProd: false, allowDevOtp: false }));
    globalThis.fetch = async (_input, init) => {
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "synthetic-message-id" }), { status: 200 });
    };
    assert.equal((await sendOtpEmail(recipient, "123456")).delivered, true);
    assert.match(String(payload.text), /123456/);
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    assert.equal((await sendOtpEmail(recipient, "123456")).errorCode, "service");
    globalThis.fetch = async () => new Response("sensitive-provider-response", { status: 401 });
    assert.equal((await sendOtpEmail(recipient, "123456")).errorCode, "auth");
  } finally {
    Object.assign(MAIL, original);
    globalThis.fetch = async () => { throw new Error("Unexpected network request in isolated mail test"); };
  }
});
