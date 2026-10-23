-- Additive engineering controls. Application runtime never owns this schema.
CREATE TABLE IF NOT EXISTS groundwork.outbound_circuits (
  key TEXT PRIMARY KEY, failures BIGINT NOT NULL DEFAULT 0,
  open_until BIGINT NOT NULL DEFAULT 0, probe_until BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0, generation BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS groundwork.runtime_rate_windows (
  bucket_key TEXT NOT NULL, window_start BIGINT NOT NULL,
  hits BIGINT NOT NULL DEFAULT 0, expires_at BIGINT NOT NULL,
  PRIMARY KEY(bucket_key,window_start)
);
CREATE INDEX IF NOT EXISTS idx_runtime_rate_expiry ON groundwork.runtime_rate_windows(expires_at);
CREATE TABLE IF NOT EXISTS groundwork.runtime_request_metrics (
  bucket_start BIGINT NOT NULL, route TEXT NOT NULL, method TEXT NOT NULL,
  status_group BIGINT NOT NULL, request_count BIGINT NOT NULL,
  duration_sum_ms DOUBLE PRECISION NOT NULL, duration_max_ms DOUBLE PRECISION NOT NULL,
  histogram_json TEXT NOT NULL,
  PRIMARY KEY(bucket_start,route,method,status_group)
);
CREATE INDEX IF NOT EXISTS idx_runtime_metrics_bucket ON groundwork.runtime_request_metrics(bucket_start);
CREATE TABLE IF NOT EXISTS groundwork.runtime_traces (
  request_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, route TEXT NOT NULL,
  method TEXT NOT NULL, status BIGINT NOT NULL, duration_ms DOUBLE PRECISION NOT NULL,
  spans_json TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runtime_traces_created ON groundwork.runtime_traces(created_at);
CREATE TABLE IF NOT EXISTS groundwork.operational_state (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS groundwork.runtime_feature_flags (
  name TEXT PRIMARY KEY, enabled BIGINT NOT NULL, rollout_percent BIGINT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL,
  CHECK (enabled IN (0,1)), CHECK (rollout_percent BETWEEN 0 AND 100)
);

DO $engineering_permissions$
DECLARE table_name TEXT; browser_role TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['outbound_circuits','runtime_rate_windows','runtime_request_metrics','runtime_traces','operational_state','runtime_feature_flags'] LOOP
    EXECUTE format('ALTER TABLE groundwork.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON groundwork.%I FROM PUBLIC',table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON groundwork.%I TO groundwork_runtime',table_name);
    FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
        EXECUTE format('REVOKE ALL ON groundwork.%I FROM %I',table_name,browser_role);
      END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='groundwork' AND tablename=table_name AND policyname='groundwork_server') THEN
      EXECUTE format('CREATE POLICY groundwork_server ON groundwork.%I TO groundwork_runtime USING (true) WITH CHECK (true)',table_name);
    END IF;
  END LOOP;
END $engineering_permissions$;

-- Cover FK prefixes to keep ownership joins and referential delete/update checks
-- from scanning child tables. Existing covering indexes are preserved.
DO $foreign_key_indexes$
DECLARE constraint_row RECORD; index_name TEXT;
BEGIN
  FOR constraint_row IN
    SELECT c.conname,c.conrelid,c.conkey,n.nspname,t.relname,
      (SELECT string_agg(format('%I',a.attname),', ' ORDER BY keys.ordinality)
       FROM unnest(c.conkey) WITH ORDINALITY keys(attnum,ordinality)
       JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=keys.attnum) AS columns_sql
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE c.contype='f' AND n.nspname='groundwork'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid
          AND i.indisvalid AND i.indpred IS NULL
          AND (SELECT array_agg(k::smallint ORDER BY ord)
               FROM unnest(i.indkey) WITH ORDINALITY cols(k,ord)
               WHERE ord<=cardinality(c.conkey)) @> c.conkey
      )
  LOOP
    index_name := 'idx_fk_' || substr(constraint_row.relname,1,36) || '_' || substr(md5(constraint_row.conname),1,12);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)',index_name,constraint_row.nspname,constraint_row.relname,constraint_row.columns_sql);
  END LOOP;
END $foreign_key_indexes$;

INSERT INTO groundwork.schema_migrations(version,applied_at)
VALUES ('groundwork_engineering_v2',extract(epoch FROM clock_timestamp())::BIGINT)
ON CONFLICT(version) DO NOTHING;
