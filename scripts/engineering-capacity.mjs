import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const round = value => Math.round(value * 100) / 100;
const percentile = (values, fraction) => [...values].sort((left, right) => left - right)[Math.ceil(values.length * fraction) - 1];
const pause = () => new Promise(resolve => setImmediate(resolve));

/** A disposable local regression rehearsal, never a caller-supplied target. */
export async function runCapacity({ samples = 150, postgresEngine = false } = {}) {
  assert(Number.isInteger(samples) && samples >= 100 && samples <= 200, 'Use 100–200 synthetic read samples');
  const concurrency = 4, reconnectCycles = 6;
  const budgets = { p99Ms: 10000, batchElapsedMs: 60000, retainedHeapGrowthBytes: 96 * 1024 * 1024, disconnectCleanupMs: 3000 };
  const directory = await mkdtemp(join(tmpdir(), 'groundwork-engineering-capacity-'));
  const masterKey = randomBytes(32), cookieValues = new Map();
  const nativeFetch = globalThis.fetch, nativeInterval = globalThis.setInterval, nativeClearInterval = globalThis.clearInterval;
  const nativeInfo = console.info, originalDotenv = require('dotenv').config, originalPool = require('pg').Pool;
  const intervals = new Set();
  let server, database, engine, telemetry, targetOrigin, requestLogCount = 0;
  const failures = [], durations = [], lifecycle = [];
  const startedAt = new Date().toISOString();
  let output;
  // Disable dotenv before the application module graph is loaded. No private
  // environment file, real account, SMTP server or remote database is consulted.
  require('dotenv').config = () => ({ parsed: {} });
  Object.assign(process.env, {
    NODE_ENV: 'test', BIND_HOST: '127.0.0.1', MASTER_KEY: masterKey.toString('base64'),
    GROUNDWORK_DATA_DIR: directory, DATABASE_PROVIDER: postgresEngine ? 'supabase' : 'sqlite',
    DATABASE_URL: postgresEngine ? 'postgresql://fixture:fixture@localhost/capacity' : '', DATABASE_ADMIN_URL: '',
    DATABASE_SSL_CA_FILE: '', DATABASE_POOL_MAX: '4', MAIL_PROVIDER: 'console', PAYMENTS_MODE: 'demo',
    GROUNDWORK_SERVERLESS: '', VERCEL: '', GROUNDWORK_SERVER_ROLE: 'authority', GROUNDWORK_AUTHORITY_GATEWAY_MODE: 'direct',
    NATIVE_WORKER_ENABLED: 'false', DURABLE_WORKERS_ENABLED: 'false', RENDER_PROVIDER: 'demo', ALERT_TO: '',
    TRACE_SAMPLE_PERCENT: '0', REDIS_REST_URL: '', REDIS_REST_TOKEN: '',
  });
  for (const key of ['DB_PATH', 'PREVIOUS_MASTER_KEY', 'SUPABASE_DB_URL', 'GROUNDWORK_AUTHORITY_URL', 'GROUNDWORK_SEED_DEMO',
    'AI_API_KEY', 'GEMINI_API_KEY', 'IMAGEN_API_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET',
    'MAIL_HOST', 'MAIL_USER', 'MAIL_PASS', 'RESEND_API_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'OPERATIONS_TOKEN', 'CRON_SECRET']) delete process.env[key];
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!targetOrigin || url.origin !== targetOrigin) throw new Error('Capacity fixture refuses every remote destination');
    return nativeFetch(input, init);
  };
  globalThis.setInterval = (...args) => { const timer = Reflect.apply(nativeInterval, globalThis, args); intervals.add(timer); return timer; };
  globalThis.clearInterval = timer => { intervals.delete(timer); nativeClearInterval(timer); };
  console.info = (...values) => {
    if (typeof values[0] === 'string' && values[0].startsWith('{"type":"api.request"')) requestLogCount += 1;
    else nativeInfo(...values);
  };
  try {
    if (postgresEngine) {
      const { PGlite } = await import('@electric-sql/pglite');
      engine = new PGlite();
      let tail = Promise.resolve();
      const acquire = async () => { const prior = tail; let release; tail = new Promise(resolve => { release = resolve; }); await prior; return release; };
      const query = async (text, parameters = []) => {
        const result = await engine.query(text, parameters);
        for (const field of result.fields) if ([20, 1700].includes(field.dataTypeID)) {
          for (const row of result.rows) if (row[field.name] !== null) row[field.name] = String(row[field.name]);
        }
        return { rows: result.rows, fields: result.fields, command: result.command, rowCount: result.command === 'SELECT' ? result.rows.length : result.affectedRows, oid: 0 };
      };
      require('pg').Pool = class extends EventEmitter {
        async query(text, parameters) { const release = await acquire(); try { return await query(text, parameters); } finally { release(); } }
        async connect() { const release = await acquire(); return { query, release }; }
        async end() {}
      };
      const { postgresMigrationSql } = await import('../server/src/postgresDatabase.ts');
      await engine.exec(await postgresMigrationSql());
      await engine.exec('SET ROLE groundwork_runtime');
    }
    const bootStart = performance.now();
    const [{ app }, { db, now }, { createSession }, crypto, observed] = await Promise.all([
      import('../server/src/index.ts'), import('../server/src/db.ts'), import('../server/src/security.ts'),
      import('../server/src/crypto.ts'), import('../server/src/telemetry.ts'),
    ]);
    const applicationImportMs = round(performance.now() - bootStart);
    database = db; telemetry = observed;
    const userId = crypto.randomId(), projectId = crypto.randomId();
    await db.prepare('INSERT INTO users(id,email,email_verified,password_salt,password_hash,password_changed_at,created_at,updated_at) VALUES(?,?,1,?,?,?,?,?)')
      .run(userId, 'synthetic-capacity@example.invalid', 'synthetic-salt', 'synthetic-hash', now(), now(), now());
    const design = { version: 1, room: { widthMm: 6000, depthMm: 4000 }, furniture: Array.from({ length: 500 }, (_, index) => ({ id: `synthetic-object-${index}`, x: index * 10, y: index % 20, kind: 'fixture' })) };
    const plaintext = JSON.stringify(design);
    const encrypted = crypto.encryptAesGcm(plaintext, crypto.deriveVaultKey(masterKey), `groundwork:project:${userId}`);
    await db.prepare('INSERT INTO projects(id,user_id,name,design_data,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(projectId, userId, 'Synthetic capacity project', JSON.stringify(encrypted), now(), now());
    await createSession({ cookie(name, value) { cookieValues.set(name, value); } }, userId);
    const headers = { cookie: [...cookieValues].map(([name, value]) => `${name}=${value}`).join('; '), accept: 'application/json' };
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    targetOrigin = `http://127.0.0.1:${server.address().port}`;
    const endpoint = `${targetOrigin}/api/projects/${projectId}`;
    const read = async () => {
      const start = performance.now();
      const response = await fetch(endpoint, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
      const body = await response.json();
      assert.equal(response.status, 200, 'Synthetic authenticated project read must succeed');
      assert.equal(body.revision, 0); assert.equal(body.design.furniture.length, 500);
      assert.equal(body.design.furniture[499].id, 'synthetic-object-499');
      return round(performance.now() - start);
    };
    const firstHttpRequestMs = await read();
    await telemetry.drainTelemetry();
    const settleHeap = async () => { if (globalThis.gc) { for (let index = 0; index < 3; index++) { globalThis.gc(); await pause(); } } return process.memoryUsage(); };
    const before = await settleHeap(), intervalBaseline = intervals.size;
    let cursor = 0;
    const batchStart = performance.now();
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < samples) { const sample = cursor++; try { durations[sample] = await read(); } catch { failures.push(`read_failed_${sample}`); durations[sample] = round(performance.now() - batchStart); } }
    }));
    const elapsedMs = round(performance.now() - batchStart);
    const telemetryDrained = await telemetry.drainTelemetry(10000);
    const elapsedWithTelemetryMs = round(performance.now() - batchStart);
    if (!telemetryDrained) failures.push('telemetry_drain_timeout');
    for (let index = 0; index < reconnectCycles; index++) {
      const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 10000);
      let reader;
      const connectedAt = performance.now();
      try {
        const response = await fetch(`${targetOrigin}/api/collaboration/${projectId}/events`, { headers, signal: controller.signal, redirect: 'error' });
        assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
        reader = response.body.getReader();
        const initial = await reader.read();
        assert(initial.value?.byteLength && initial.value.byteLength <= 64 * 1024, 'Initial SSE data must be bounded');
        const connectMs = round(performance.now() - connectedAt), disconnectedAt = performance.now();
        controller.abort(); await reader.cancel().catch(() => undefined);
        let remaining = 1;
        while (performance.now() - disconnectedAt < budgets.disconnectCleanupMs) {
          remaining = (await db.prepare('SELECT COUNT(*) AS count FROM project_presence WHERE project_id=?').get(projectId)).count;
          if (remaining === 0 && intervals.size === intervalBaseline) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        lifecycle.push({ connectMs, disconnectCleanupMs: round(performance.now() - disconnectedAt), remainingPresence: remaining, extraIntervals: intervals.size - intervalBaseline });
        if (remaining !== 0 || intervals.size !== intervalBaseline) failures.push(`sse_cleanup_failed_${index}`);
      } finally { clearTimeout(deadline); controller.abort(); await reader?.cancel().catch(() => undefined); }
    }
    await telemetry.drainTelemetry(10000);
    const after = await settleHeap();
    const heapGrowthBytes = after.heapUsed - before.heapUsed;
    const latency = { firstHttpRequestMs, p50Ms: percentile(durations, .50), p95Ms: percentile(durations, .95), p99Ms: percentile(durations, .99), maximumMs: Math.max(...durations) };
    if (latency.p99Ms > budgets.p99Ms) failures.push('p99_budget_exceeded');
    if (elapsedMs > budgets.batchElapsedMs) failures.push('batch_elapsed_budget_exceeded');
    if (globalThis.gc && heapGrowthBytes > budgets.retainedHeapGrowthBytes) failures.push('retained_heap_budget_exceeded');
    output = {
      ok: failures.length === 0, startedAt, completedAt: new Date().toISOString(), nodeVersion: process.version,
      scope: 'Synthetic disposable local Express regression; no production capacity, multi-instance, GPU or network-latency claim',
      database: postgresEngine ? 'PGlite PostgreSQL engine, one leased connection' : 'Temporary SQLite', samples, concurrency,
      route: '/api/projects/:id', authentication: 'Synthetic active cookie session', encryptedDesignBytes: Buffer.byteLength(plaintext), objectsPerDesign: 500,
      applicationImportMs, latency, batch: { elapsedMs, elapsedWithTelemetryMs, throughputRequestsPerSecond: round(samples / (elapsedMs / 1000)), observedStructuredRequestLogs: requestLogCount },
      memory: { forcedGcAvailable: Boolean(globalThis.gc), before, after, retainedHeapGrowthBytes: heapGrowthBytes, browserGpuMeasured: false },
      sse: { reconnectCycles, lifecycle }, budgets, failures,
    };
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await telemetry?.drainTelemetry(10000);
    for (const timer of intervals) nativeClearInterval(timer);
    await database?.close(); await engine?.close();
    globalThis.fetch = nativeFetch; globalThis.setInterval = nativeInterval; globalThis.clearInterval = nativeClearInterval; console.info = nativeInfo;
    require('dotenv').config = originalDotenv; require('pg').Pool = originalPool;
    const canonical = await realpath(directory), temporary = await realpath(tmpdir());
    assert.equal(dirname(canonical).toLowerCase(), temporary.toLowerCase());
    assert(canonical.split(/[\\/]/).at(-1).startsWith('groundwork-engineering-capacity-'));
    await rm(canonical, { recursive: true, force: true });
  }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const postgresEngine = process.argv.includes('--postgres-engine');
  const artifact = join(root, 'artifacts', `engineering-capacity${postgresEngine ? '-postgres' : ''}.json`);
  try {
    const result = await runCapacity({ samples: Number(process.env.ENGINEERING_CAPACITY_SAMPLES || 150), postgresEngine });
    await mkdir(dirname(artifact), { recursive: true });
    await writeFile(artifact, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ok: result.ok, database: result.database, samples: result.samples, concurrency: result.concurrency, ...result.latency, throughputRequestsPerSecond: result.batch.throughputRequestsPerSecond, retainedHeapGrowthBytes: result.memory.retainedHeapGrowthBytes, forcedGc: result.memory.forcedGcAvailable, sseClean: result.sse.lifecycle.every(value => value.remainingPresence === 0 && value.extraIntervals === 0), artifact: artifact.replaceAll('\\', '/'), failures: result.failures }));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, type: error instanceof Error ? error.name : 'UnknownError', reason: 'Isolated capacity rehearsal failed; no remote target was used' }));
    process.exitCode = 1;
  }
}
