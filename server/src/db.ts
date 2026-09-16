import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./config.js";

const raw = new DatabaseSync(DB_PATH);

raw.exec("PRAGMA journal_mode = WAL;");
raw.exec("PRAGMA foreign_keys = ON;");
raw.exec("PRAGMA busy_timeout = 5000;");

raw.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret   TEXT,
  totp_enabled  INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER,
  last_login_at INTEGER,
  password_changed_at INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  csrf_token    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',   -- active | pending_2fa | revoked
  user_agent    TEXT,
  ip            TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  detail     TEXT,
  ip         TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS secrets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  iv         TEXT NOT NULL,
  tag        TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_secrets_user ON secrets(user_id);

CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  iv         TEXT NOT NULL,
  tag        TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  project_type TEXT NOT NULL DEFAULT 'house',
  design_data TEXT,
  width_mm    INTEGER NOT NULL DEFAULT 6000,
  depth_mm    INTEGER NOT NULL DEFAULT 4000,
  photo_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  method        TEXT NOT NULL,
  plan          TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'INR',
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | paid | expired | failed
  provider_order_id TEXT,
  provider_url  TEXT,
  completed_at  INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at DESC);
`);

/* Lightweight migrations for pre-existing databases */
const userCols = (raw.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
if (!userCols.includes("plan")) {
  raw.exec("ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';");
}
if (!userCols.includes("plan_expires_at")) {
  raw.exec("ALTER TABLE users ADD COLUMN plan_expires_at INTEGER;");
}
if (!userCols.includes("country")) {
  raw.exec("ALTER TABLE users ADD COLUMN country TEXT NOT NULL DEFAULT 'IN';");
}
if (!userCols.includes("phone")) {
  raw.exec("ALTER TABLE users ADD COLUMN phone TEXT;");
}
if (!userCols.includes("account_type")) {
  raw.exec("ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'individual';");
}
if (!userCols.includes("gstin")) {
  raw.exec("ALTER TABLE users ADD COLUMN gstin TEXT;");
}

const projectCols = (raw.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map((c) => c.name);
if (!projectCols.includes("project_type")) {
  raw.exec("ALTER TABLE projects ADD COLUMN project_type TEXT NOT NULL DEFAULT 'house';");
}

export type Db = typeof raw;
export const db: Db = raw;

export function now(): number {
  return Math.floor(Date.now() / 1000);
}