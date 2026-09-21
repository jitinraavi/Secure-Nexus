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
  username      TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  otp_code_hash TEXT,
  otp_expires_at INTEGER,
  otp_attempts  INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS project_revisions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  design_data TEXT NOT NULL,
  project_type TEXT NOT NULL,
  width_mm    INTEGER NOT NULL,
  depth_mm    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_revisions_project ON project_revisions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_share_links (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_share_links_project ON project_share_links(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_collaboration_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  revision    INTEGER NOT NULL,
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_collaboration_events_project ON project_collaboration_events(project_id, id DESC);

CREATE TABLE IF NOT EXISTS project_collaboration_items (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_collaboration_items_project ON project_collaboration_items(project_id, created_at DESC);

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
/* OTP email verification (new column; default 1 grandfathers pre-existing accounts) */
if (!userCols.includes("username")) {
  raw.exec("ALTER TABLE users ADD COLUMN username TEXT;");
}
if (!userCols.includes("email_verified")) {
  raw.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;");
}
if (!userCols.includes("otp_code_hash")) {
  raw.exec("ALTER TABLE users ADD COLUMN otp_code_hash TEXT;");
}
if (!userCols.includes("otp_expires_at")) {
  raw.exec("ALTER TABLE users ADD COLUMN otp_expires_at INTEGER;");
}
if (!userCols.includes("otp_attempts")) {
  raw.exec("ALTER TABLE users ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0;");
}
raw.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL AND username != '';",
);

const projectCols = (raw.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map((c) => c.name);
if (!projectCols.includes("project_type")) {
  raw.exec("ALTER TABLE projects ADD COLUMN project_type TEXT NOT NULL DEFAULT 'house';");
}
if (!projectCols.includes("revision")) {
  raw.exec("ALTER TABLE projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;");
}

export type Db = typeof raw;
export const db: Db = raw;

export function now(): number {
  return Math.floor(Date.now() / 1000);
}
