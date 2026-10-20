import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
// Isolated accounts, keys, database and SMTP stub: never read .env or send email.
dotenv.config = () => ({ parsed: {} });
// Never select a remote database inherited from a developer environment.
process.env.DATABASE_PROVIDER = "sqlite";
process.env.DATABASE_URL = "";
const fixtureDir = mkdtempSync(join(tmpdir(), "groundwork-otp-delivery-"));
Object.assign(process.env, {
    NODE_ENV: "production", BIND_HOST: "127.0.0.1", GROUNDWORK_DATA_DIR: fixtureDir, DB_PATH: "",
    MASTER_KEY: randomBytes(32).toString("base64"), PREVIOUS_MASTER_KEY: "", PAYMENTS_MODE: "live",
    GROUNDWORK_SERVER_ROLE: "authority", GROUNDWORK_AUTHORITY_GATEWAY_MODE: "direct",
    GROUNDWORK_AUTHORITY_URL: "", GROUNDWORK_TRUSTED_PROXY_IPS: "", ADMIN_EMAILS: "",
    GROUNDWORK_DEV_OTP: "1", GROUNDWORK_SEED_DEMO: "", GROUNDWORK_DEMO_PASSWORD: "",
    MAIL_PROVIDER: "smtp", MAIL_HOST: "smtp.example.invalid", MAIL_PORT: "587", MAIL_SECURE: "false",
    MAIL_USER: "fixture@example.invalid", MAIL_PASS: randomBytes(32).toString("hex"),
    MAIL_FROM: "Groundwork Fixture <fixture@example.invalid>",
});
for (const name of ["RESEND_API_KEY", "AI_API_KEY", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_ACCOUNT_ID", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET",
    "PAYPAL_MERCHANT_ID", "COLLABORATION_REDIS_REST_URL", "COLLABORATION_REDIS_REST_TOKEN"])
    process.env[name] = "";
type Message = {
    to: string;
    html: string;
};
const messages: Message[] = [];
let transportMode: "accept" | "fail" | "reject" | "defer" = "accept";
let onDeferred: (() => void) | undefined;
let releaseDeferred: (() => void) | undefined;
const originalCreateTransport = nodemailer.createTransport;
nodemailer.createTransport = (() => ({
    async sendMail(message: Message) {
        messages.push(message);
        const mode = transportMode;
        if (mode === "defer") {
            await new Promise<void>((resolve) => { releaseDeferred = resolve; onDeferred?.(); });
            throw new Error("Synthetic delayed delivery failure");
        }
        if (mode === "fail")
            throw new Error("Synthetic SMTP failure");
        return { accepted: mode === "reject" ? [] : [message.to], rejected: mode === "reject" ? [message.to] : [], pending: [] };
    },
})) as typeof nodemailer.createTransport;
const [{ app }, { db, now }, { OTP_TTL_SECONDS }, { sha256Hex }] = await Promise.all([
    import("../src/index.js"), import("../src/db.js"), import("../src/config.js"), import("../src/crypto.js"),
]);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const address = server.address();
if (!address || typeof address === "string")
    throw new Error("Fixture server did not bind");
const baseUrl = `http://127.0.0.1:${address.port}`;
async function request(path: string, body: unknown) {
    const response = await fetch(`${baseUrl}/api/auth${path}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
}
async function account(verified = true) {
    const id = randomBytes(16).toString("hex"), email = `${id}@example.invalid`;
    await db.prepare(`INSERT INTO users (id,email,email_verified,password_salt,password_hash,password_changed_at,created_at,updated_at)
    VALUES (?,?,?,'synthetic-salt','synthetic-hash',?,?,?)`).run(id, email, verified ? 1 : 0, now(), now(), now());
    return { id, email };
}
async function otpState(id: string) {
    return await db.prepare("SELECT otp_code_hash,otp_expires_at,otp_attempts FROM users WHERE id=?").get(id) as {
        otp_code_hash: string | null;
        otp_expires_at: number | null;
        otp_attempts: number;
    };
}
function sentCode() {
    const code = messages.at(-1)?.html.match(/verification code is (\d{6})/)?.[1];
    assert.ok(code, "synthetic message should contain a code");
    return code;
}
after(async () => {
    releaseDeferred?.();
    nodemailer.createTransport = originalCreateTransport;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
    rmSync(fixtureDir, { recursive: true, force: true });
});
test("failed login email clears the code and cooldown; immediate retry can sign in", async () => {
    const owner = await account();
    transportMode = "fail";
    const failed = await request("/otp/request", { email: owner.email });
    assert.equal(failed.status, 200);
    assert.equal(failed.body.ok, false);
    assert.equal(failed.body.delivered, false);
    assert.ok(!("devOtp" in failed.body), "production must never expose a code");
    assert.deepEqual({ ...await otpState(owner.id) }, { otp_code_hash: null, otp_expires_at: null, otp_attempts: 0 });
    assert.equal((await request("/otp/verify", { email: owner.email, code: sentCode() })).status, 400);
    transportMode = "accept";
    const retry = await request("/otp/request", { email: owner.email });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.delivered, true);
    assert.equal((await request("/otp/verify", { email: owner.email, code: sentCode() })).status, 200);
});
test("SMTP recipient rejection is a delivery failure and does not reserve a usable code", async () => {
    const owner = await account();
    transportMode = "reject";
    const rejected = await request("/otp/request", { email: owner.email });
    assert.equal(rejected.body.delivered, false);
    assert.equal(rejected.body.ok, false);
    assert.equal((await otpState(owner.id)).otp_code_hash, null);
    transportMode = "accept";
    assert.equal((await request("/otp/request", { email: owner.email })).body.delivered, true);
});
test("failed signup and verification resend allow immediate recovery without a false sent response", async () => {
    transportMode = "fail";
    const email = `${randomBytes(12).toString("hex")}@example.invalid`;
    const password = `SyntheticPassword${randomBytes(12).toString("hex")}1!`;
    const signup = await request("/signup", { email, password, confirmPassword: password, country: "US", accountType: "individual" });
    assert.equal(signup.status, 201);
    assert.equal(signup.body.emailDelivered, false);
    assert.ok(!("devOtp" in signup.body));
    const owner = await db.prepare("SELECT id FROM users WHERE email=?").get(email) as {
        id: string;
    };
    assert.equal((await otpState(owner.id)).otp_code_hash, null);
    const resend = await request("/resend-otp", { email });
    assert.equal(resend.status, 200);
    assert.equal(resend.body.ok, false);
    assert.equal((await otpState(owner.id)).otp_expires_at, null);
    transportMode = "accept";
    const recovered = await request("/resend-otp", { email });
    assert.equal(recovered.body.delivered, true);
    assert.equal((await request("/verify-email", { email, code: sentCode() })).status, 200);
});
test("late failed delivery cannot clear a newer request's OTP", async () => {
    const owner = await account();
    transportMode = "defer";
    const started = new Promise<void>((resolve) => { onDeferred = resolve; });
    const first = request("/otp/request", { email: owner.email });
    await started;
    // Advance the reservation age, not wall-clock time, to permit the next request.
    await db.prepare("UPDATE users SET otp_expires_at=? WHERE id=?").run(now() + OTP_TTL_SECONDS - 31, owner.id);
    transportMode = "accept";
    const second = await request("/otp/request", { email: owner.email });
    assert.equal(second.body.delivered, true);
    const newCode = sentCode();
    releaseDeferred?.();
    assert.equal((await first).body.delivered, false);
    assert.equal((await otpState(owner.id)).otp_code_hash, sha256Hex(`${owner.id}:${newCode}`));
    assert.equal((await request("/otp/verify", { email: owner.email, code: newCode })).status, 200);
    onDeferred = undefined;
});
test("production requests for unknown accounts retain the generic response without sending mail", async () => {
    const before = messages.length;
    const unknown = await request("/otp/request", { email: "unknown@example.invalid" });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.ok, true);
    assert.equal(unknown.body.message, "If that email has an account, a 6-digit login code is on its way.");
    assert.ok(!("devOtp" in unknown.body));
    assert.equal(messages.length, before);
});
test("console codes require explicit local development opt-in and never claim email delivery", () => {
    for (const optIn of ["", "1"]) {
        const directory = mkdtempSync(join(tmpdir(), "groundwork-console-otp-"));
        try {
            const script = `
        import dotenv from 'dotenv'; dotenv.config=()=>({parsed:{}});
        const {app}=await import('./src/index.ts'); const {db,now}=await import('./src/db.ts');
        await db.prepare("INSERT INTO users(id,email,email_verified,password_salt,password_hash,password_changed_at,created_at,updated_at) VALUES ('fixture','fixture@example.invalid',1,'salt','hash',?,?,?)").run(now(),now(),now());
        const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
        const url='http://127.0.0.1:'+server.address().port;
        const response=await fetch(url+'/api/auth/otp/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'fixture@example.invalid'})});
        const body=await response.json(); const state=await db.prepare("SELECT otp_code_hash FROM users WHERE id='fixture'").get();
        process.stdout.write(JSON.stringify({status:response.status,body,active:Boolean(state.otp_code_hash)}));
        await new Promise(resolve=>server.close(resolve)); await db.close();`;
            const child = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "--input-type=module", "-e", script], {
                cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 20000,
                env: { ...process.env, NODE_ENV: "test", PAYMENTS_MODE: "demo", MAIL_PROVIDER: "console", GROUNDWORK_DEV_OTP: optIn,
                    GROUNDWORK_DATA_DIR: directory, MAIL_HOST: "", MAIL_USER: "", MAIL_PASS: "", RESEND_API_KEY: "" },
            });
            assert.equal(child.status, 0, child.stderr);
            const result = JSON.parse(child.stdout) as {
                status: number;
                body: Record<string, unknown>;
                active: boolean;
            };
            assert.equal(result.body.delivered, false);
            assert.equal(Boolean(result.body.devOtp), optIn === "1");
            assert.equal(result.active, optIn === "1");
            if (optIn)
                assert.match(String(result.body.message), /no email was sent/);
        }
        finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }
});
