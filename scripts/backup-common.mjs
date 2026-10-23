import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import pg from 'pg';

const MAGIC = Buffer.from('GWBK0001');
export const quote = value => `"${String(value).replaceAll('"', '""')}"`;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function encryptionKey(value) {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('A separate base64 32-byte BACKUP_ENCRYPTION_KEY is required');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new Error('Invalid backup encryption key');
  return key;
}
export function seal(value, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  return Buffer.concat([MAGIC, iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]);
}
export function open(value, key) {
  if (value.length < 36 || !value.subarray(0, 8).equals(MAGIC)) throw new Error('Invalid encrypted backup format');
  const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(8, 20));
  cipher.setAAD(MAGIC); cipher.setAuthTag(value.subarray(-16));
  // Return no plaintext until authentication succeeds.
  return Buffer.concat([cipher.update(value.subarray(20, -16)), cipher.final()]);
}
export async function boundedRead(path, maxBytes = 268435456) {
  if ((await stat(path)).size > maxBytes) throw new Error('Backup exceeds verification memory limit (256 MiB)');
  const data = await readFile(path);
  if (data.length > maxBytes) throw new Error('Backup exceeds verification memory limit');
  return data;
}
export function connection(value, allowedHost, { restore = false, ca } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Database URL must be configured privately'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password || !url.pathname.slice(1) || url.search || url.hash) throw new Error('Use a PostgreSQL URL without query parameters');
  if (!allowedHost || url.host !== allowedHost) throw new Error('Database host and port must exactly match the explicit allowlist');
  const local = ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (restore && (!local || !/^groundwork_restore_[a-z0-9_]+$/.test(url.pathname.slice(1)))) throw new Error('Restore rehearsal requires a loopback groundwork_restore_* database');
  if (!local && !ca) throw new Error('Hosted backup requires the reviewed PostgreSQL CA');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return {
    client: new pg.Client({ host, port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)), ssl: local ? false : { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 10000, query_timeout: 300000 }),
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PGHOST: host, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGSSLMODE: local ? 'disable' : 'verify-full', PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'groundwork-recovery', LC_ALL: 'C' },
  };
}
export async function fingerprint(client) {
  const { rows: names } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='groundwork' ORDER BY tablename");
  if (!names.length) throw new Error('Expected private groundwork tables are missing');
  const tables = [];
  for (const { tablename } of names) {
    const hash = createHash('sha256'); let count = 0;
    await client.query(`DECLARE backup_rows NO SCROLL CURSOR FOR SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS digest FROM groundwork.${quote(tablename)} t ORDER BY 1`);
    while (true) {
      const { rows } = await client.query('FETCH 1000 FROM backup_rows');
      if (!rows.length) break;
      for (const row of rows) { hash.update(row.digest); count++; }
    }
    await client.query('CLOSE backup_rows');
    tables.push({ name: tablename, count, sha256: hash.digest('hex') });
  }
  const { rows: migrations } = await client.query('SELECT version FROM groundwork.schema_migrations ORDER BY version');
  return { tables, migrations: migrations.map(row => row.version) };
}
export function runTool(executable, args, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let bytes = 0;
    const chunks = [];
    child.stdout.on('data', data => {
      bytes += data.length;
      if (bytes > 268435456) { child.kill(); reject(new Error('Backup exceeds 256 MiB tool limit')); return; }
      chunks.push(data);
    });
    // PostgreSQL stderr can include record contents/connection data. Do not log it.
    child.stderr.resume();
    child.on('error', () => reject(new Error(`Required PostgreSQL tool unavailable: ${executable}`)));
    child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${executable} failed; inspect privately, no database output was logged`)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
