import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connection, encryptionKey, fingerprint, runTool, seal, sha256 } from './backup-common.mjs';

export async function exportBackup(env = process.env) {
  if (env.BACKUP_EXPORT_ACK !== 'read-only-groundwork-export') throw new Error('Explicit BACKUP_EXPORT_ACK is required');
  if (env.MASTER_KEY || env.PREVIOUS_MASTER_KEY) throw new Error('Application encryption keys must stay outside the backup process');
  const key = encryptionKey(env.BACKUP_ENCRYPTION_KEY);
  const caPath = resolve('server/certs/supabase-root-2021.crt');
  const ca = await readFile(caPath, 'utf8');
  const { client, env: pgEnv } = connection(env.BACKUP_DATABASE_URL, env.BACKUP_ALLOWED_HOST, { ca });
  pgEnv.PGSSLROOTCERT = caPath;
  pgEnv.PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=300000 -c lock_timeout=15000';
  const directory = resolve(env.BACKUP_OUTPUT_DIR || 'artifacts/encrypted-backups');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = resolve(directory, `groundwork-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.gwb`);
  let connected = false;
  try {
    await client.connect(); connected = true;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: [snapshot] } = await client.query('SELECT pg_export_snapshot() AS id, current_setting(\'server_version\') AS version');
    const manifest = await fingerprint(client);
    // pg_dump and fingerprints observe the same read-only database snapshot.
    // Plaintext exists in bounded memory only; only authenticated ciphertext is written.
    const archive = await runTool('pg_dump', ['--format=custom', '--schema=groundwork', '--strict-names', '--no-owner', '--no-acl', '--enable-row-security', '--inserts', `--snapshot=${snapshot.id}`], pgEnv);
    if (archive.subarray(0, 5).toString() !== 'PGDMP') throw new Error('PostgreSQL archive header missing');
    const metadata = { format: 1, schema: 'groundwork', createdAt: new Date().toISOString(), serverVersion: snapshot.version, archiveSha256: sha256(archive), ...manifest };
    await writeFile(file, seal(archive, key), { flag: 'wx', mode: 0o600 });
    try { await writeFile(`${file}.manifest.gwb`, seal(Buffer.from(JSON.stringify(metadata)), key), { flag: 'wx', mode: 0o600 }); }
    catch (error) { await rm(file, { force: true }); throw error; }
    await client.query('COMMIT');
    return { ok: true, archive: file, manifest: `${file}.manifest.gwb`, tables: manifest.tables.length };
  } finally { if (connected) await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  exportBackup().then(result => console.log(JSON.stringify(result))).catch(() => { console.error('Backup export failed. Check private configuration, read-only permissions and PostgreSQL client compatibility. No database output was logged.'); process.exitCode = 1; });
}
