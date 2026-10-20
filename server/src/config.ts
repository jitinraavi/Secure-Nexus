import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { readMailConfiguration } from "./mailConfig.js";
import { readServerlessMode } from "./serverlessRuntime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(SERVER_ROOT, ".env");

dotenv.config({ path: ENV_PATH, quiet: true });

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export const NODE_ENV = process.env.NODE_ENV || "development";
if (!["development", "test", "production"].includes(NODE_ENV)) {
  throw new Error("NODE_ENV must be development, test or production");
}
export const IS_PROD = NODE_ENV === "production";
export const SERVERLESS = readServerlessMode(process.env);

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  return isIP(ipv4) === 4 && ipv4.startsWith("127.");
}

export const BIND_HOST = process.env.BIND_HOST || (IS_PROD ? "0.0.0.0" : "127.0.0.1");
if ((!isIP(BIND_HOST) && BIND_HOST !== "localhost") || (!IS_PROD && !isLoopbackAddress(BIND_HOST))) {
  throw new Error("BIND_HOST must be an IP address or localhost; development and test must bind to loopback");
}

export const PAYMENTS_MODE = process.env.PAYMENTS_MODE || (IS_PROD ? "" : "demo");
if (!["demo", "live"].includes(PAYMENTS_MODE) || (IS_PROD && PAYMENTS_MODE !== "live")) {
  throw new Error("PAYMENTS_MODE must be live in production, or demo/live in development and test");
}

export const PORT = Number(process.env.PORT || 4000);

/* Optional OpenAI-compatible assistant provider. The API key never leaves the server. */
export const AI = {
  apiKey: process.env.AI_API_KEY || "",
  model: process.env.AI_MODEL || "",
  baseUrl: (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
};

if (IS_PROD && !process.env.GROUNDWORK_DATA_DIR) {
  throw new Error("GROUNDWORK_DATA_DIR is required in production; configure persistent storage before starting");
}

export const DATA_DIR = process.env.GROUNDWORK_DATA_DIR
  ? path.resolve(process.env.GROUNDWORK_DATA_DIR)
  : path.join(SERVER_ROOT, "data");
ensureDir(DATA_DIR);
export const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH, "groundwork.db")
  : path.join(DATA_DIR, "groundwork.db");

/** Server-only PostgreSQL connection; never include these values in client configuration. */
const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "";
const databaseProvider = process.env.DATABASE_PROVIDER || (databaseUrl ? "supabase" : "sqlite");
if (databaseProvider !== "sqlite" && databaseProvider !== "supabase") {
  throw new Error("DATABASE_PROVIDER must be sqlite or supabase");
}
const databasePoolMax = Number(process.env.DATABASE_POOL_MAX || 5);
if (!Number.isSafeInteger(databasePoolMax) || databasePoolMax < 1 || databasePoolMax > 20) {
  throw new Error("DATABASE_POOL_MAX must be an integer between 1 and 20");
}
if (databaseProvider === "supabase") {
  try {
    const parsed = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.password) throw new Error();
  } catch { throw new Error("Supabase requires a valid server-only DATABASE_URL"); }
}
const databaseCaFile = process.env.DATABASE_SSL_CA_FILE || (databaseProvider === "supabase" ? path.join(SERVER_ROOT, "certs", "supabase-root-2021.crt") : undefined);
export const DATABASE = {
  provider: databaseProvider as "sqlite" | "supabase",
  url: databaseUrl,
  adminUrl: process.env.DATABASE_ADMIN_URL || "",
  sslCa: databaseCaFile ? fs.readFileSync(path.resolve(databaseCaFile), "utf8") : undefined,
  poolMax: databasePoolMax,
};

function loadOrCreateMasterKey(): Buffer {
  const envKey = process.env.MASTER_KEY;
  if (envKey && /^[A-Za-z0-9+/]{40,}={0,2}$/.test(envKey)) {
    const key = Buffer.from(envKey, "base64");
    if (key.length === 32) return key;
  }
  if (IS_PROD) {
    throw new Error("MASTER_KEY must be a stable base64-encoded 32-byte secret in production");
  }
  const key = crypto.randomBytes(32);
  const b64 = key.toString("base64");
  const lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8").split("\n") : [];
  if (!lines.some((l) => l.trim().startsWith("MASTER_KEY="))) {
    lines.push(`MASTER_KEY=${b64}`);
    fs.writeFileSync(ENV_PATH, lines.join("\n").trim() + "\n");
    console.log("[groundwork] Generated MASTER_KEY and wrote it to server/.env");
  }
  return key;
}

export const MASTER_KEY = loadOrCreateMasterKey();

function readOptionalMasterKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  const decoded = /^[A-Za-z0-9+/]{40,}={0,2}$/.test(value) ? Buffer.from(value, "base64") : null;
  if (!decoded || decoded.length !== 32) throw new Error("PREVIOUS_MASTER_KEY must be a base64-encoded 32-byte secret");
  return decoded;
}

/* Optional one-release key rotation support for decrypting older projects. */
export const PREVIOUS_MASTER_KEY = readOptionalMasterKey(process.env.PREVIOUS_MASTER_KEY);

export const COOKIE_SESSION = "sid";
export const COOKIE_CSRF = "csrf";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days absolute
export const PENDING_2FA_TTL_SECONDS = 5 * 60; // 5 minutes
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_SECONDS = 15 * 60;
export const BODY_LIMIT = "256kb";

/* Email verification OTP */
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 30;
export const TOTP_MAX_ATTEMPTS = 5;
export const TOTP_LOCK_SECONDS = 15 * 60;
export const TOTP_ATTEMPT_WINDOW_SECONDS = 15 * 60;

export const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/* Pluggable mailer: set MAIL_PROVIDER=smtp or resend (auto-detected from creds if unset) */
export const MAIL = readMailConfiguration(process.env, {
  isProd: IS_PROD,
  allowDevOtp: process.env.GROUNDWORK_DEV_OTP === "1" && isLoopbackAddress(BIND_HOST),
});
