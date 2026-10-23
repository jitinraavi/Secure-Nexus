/** SQLite test/local counterpart of the additive private PostgreSQL migration. */
export const ENGINEERING_SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS outbound_circuits (
  key TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0,
  open_until INTEGER NOT NULL DEFAULT 0, probe_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS runtime_rate_windows (
  bucket_key TEXT NOT NULL, window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL,
  PRIMARY KEY(bucket_key,window_start)
);
CREATE INDEX IF NOT EXISTS idx_runtime_rate_expiry ON runtime_rate_windows(expires_at);
CREATE TABLE IF NOT EXISTS runtime_request_metrics (
  bucket_start INTEGER NOT NULL, route TEXT NOT NULL, method TEXT NOT NULL,
  status_group INTEGER NOT NULL, request_count INTEGER NOT NULL,
  duration_sum_ms REAL NOT NULL, duration_max_ms REAL NOT NULL,
  histogram_json TEXT NOT NULL,
  PRIMARY KEY(bucket_start,route,method,status_group)
);
CREATE INDEX IF NOT EXISTS idx_runtime_metrics_bucket ON runtime_request_metrics(bucket_start);
CREATE TABLE IF NOT EXISTS runtime_traces (
  request_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, route TEXT NOT NULL,
  method TEXT NOT NULL, status INTEGER NOT NULL, duration_ms REAL NOT NULL,
  spans_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runtime_traces_created ON runtime_traces(created_at);
CREATE TABLE IF NOT EXISTS operational_state (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_feature_flags (
  name TEXT PRIMARY KEY, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), rollout_percent INTEGER NOT NULL CHECK(rollout_percent BETWEEN 0 AND 100),
  revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
`;
