import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(SERVER_ROOT, ".env");

dotenv.config({ path: ENV_PATH, quiet: true });

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export const NODE_ENV = process.env.NODE_ENV || "development";
export const IS_PROD = NODE_ENV === "production";

export const PORT = Number(process.env.PORT || 4000);

/* Optional OpenAI-compatible assistant provider. The API key never leaves the server. */
export const AI = {
  apiKey: process.env.AI_API_KEY || "",
  model: process.env.AI_MODEL || "",
  baseUrl: (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
};

export const DATA_DIR = process.env.GROUNDWORK_DATA_DIR
  ? path.resolve(process.env.GROUNDWORK_DATA_DIR)
  : path.join(SERVER_ROOT, "data");
ensureDir(DATA_DIR);
export const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH, "groundwork.db")
  : path.join(DATA_DIR, "groundwork.db");

function loadOrCreateMasterKey(): Buffer {
  const envKey = process.env.MASTER_KEY;
  if (envKey && /^[A-Za-z0-9+/]{40,}={0,2}$/.test(envKey)) {
    return Buffer.from(envKey, "base64");
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
  return value && /^[A-Za-z0-9+/]{40,}={0,2}$/.test(value) ? Buffer.from(value, "base64") : null;
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

/* Pluggable mailer: set MAIL_PROVIDER=smtp or resend (auto-detected from creds if unset) */
export const MAIL = {
  provider: (process.env.MAIL_PROVIDER || "").toLowerCase(),
  host: process.env.MAIL_HOST || "",
  port: Number(process.env.MAIL_PORT || 587),
  secure: process.env.MAIL_SECURE === "true",
  user: process.env.MAIL_USER || "",
  pass: process.env.MAIL_PASS || "",
  from: process.env.MAIL_FROM || "Groundwork <groundwork.login@gmail.com>",
  resendKey: process.env.RESEND_API_KEY || "",
  devOtp: process.env.GROUNDWORK_DEV_OTP !== "0",
};
