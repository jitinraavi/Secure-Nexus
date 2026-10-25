import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connection, encryptionKey, fingerprint, open, seal } from './backup-common.mjs';
import { PGlite } from '@electric-sql/pglite';
import { exportBackup } from './backup-export.mjs';
import { verifyBackup } from './backup-verify.mjs';

test('backup ciphertext authenticates data, key, IV and format before returning plaintext', () => {
  const key = randomBytes(32), data = Buffer.from('synthetic private database fixture'), sealed = seal(data, key);
  assert.deepEqual(open(sealed, key), data);
  assert.equal(sealed.includes(data), false);
  for (const index of [0, 8, 20, sealed.length - 1]) {
    const corrupt = Buffer.from(sealed); corrupt[index] ^= 1;
    assert.throws(() => open(corrupt, key));
  }
  assert.throws(() => open(sealed, randomBytes(32)));
  assert.throws(() => open(sealed.subarray(0, 20), key));
});
test('backup configuration rejects missing keys, host mismatch and unsafe restore targets', () => {
  assert.equal(encryptionKey(randomBytes(32).toString('base64')).length, 32);
  assert.throws(() => encryptionKey('invalid'));
  assert.throws(() => connection('postgres://u:p@production.example/postgres', 'other.example', { ca: 'fixture' }));
  assert.throws(() => connection('postgres://u:p@production.example/postgres', 'production.example', { restore: true }));
  assert.throws(() => connection('postgres://u:p@127.0.0.1/postgres', '127.0.0.1', { restore: true }));
  assert.throws(() => connection('postgres://u:p@127.0.0.1/groundwork_restore_fixture?sslmode=disable', '127.0.0.1', { restore: true }));
  assert.throws(() => connection('postgres://u:p@cloud.example/postgres', 'cloud.example'));
  const fixture = connection('postgres://u:p@127.0.0.1:5432/groundwork_restore_fixture', '127.0.0.1:5432', { restore: true });
  assert.equal(fixture.env.PGSSLMODE, 'disable');
  assert.equal(fixture.env.PGPASSWORD, 'p');
  assert.equal(fixture.env.MASTER_KEY, undefined);
});
test('backup fails closed before connecting if acknowledgment or separate key is missing', async () => {
  await assert.rejects(exportBackup({}), /ACK/);
  await assert.rejects(exportBackup({ BACKUP_EXPORT_ACK: 'read-only-groundwork-export', MASTER_KEY: 'fixture' }), /outside/);
  await assert.rejects(verifyBackup('fixture', {}), /KEY/);
});

test('PostgreSQL row fingerprints detect changed values and preserve duplicates independent of insertion order', async () => {
  const engine = new PGlite();
  try {
    await engine.exec("CREATE SCHEMA groundwork; CREATE TABLE groundwork.schema_migrations(version text); INSERT INTO groundwork.schema_migrations VALUES ('fixture-v1'); CREATE TABLE groundwork.fixture(id int, value text); INSERT INTO groundwork.fixture VALUES (2,'two'), (1,'one'), (1,'one'); BEGIN READ ONLY");
    const first = await fingerprint(engine);
    await engine.exec("COMMIT; DELETE FROM groundwork.fixture; INSERT INTO groundwork.fixture VALUES (1,'one'),(1,'one'),(2,'two'); BEGIN READ ONLY");
    assert.deepEqual(await fingerprint(engine), first);
    await engine.exec("COMMIT; UPDATE groundwork.fixture SET value='tampered' WHERE id=2; BEGIN READ ONLY");
    const changed = await fingerprint(engine);
    assert.equal(changed.tables[0].count, 3);
    assert.notEqual(changed.tables[0].sha256, first.tables[0].sha256);
    await engine.exec('COMMIT');
  } finally { await engine.close(); }
});

test('PostgreSQL fingerprints canonicalize floating, binary and time output across source and restore sessions', async () => {
  const engine = new PGlite();
  try {
    await engine.exec("CREATE SCHEMA groundwork; CREATE TABLE groundwork.schema_migrations(version text); INSERT INTO groundwork.schema_migrations VALUES ('fixture-v1'); CREATE TABLE groundwork.fixture(id int, value double precision, bytes bytea, happened_at timestamptz); INSERT INTO groundwork.fixture VALUES (1,1.2345678901234567,decode('0001ff5c','hex'),'2026-10-23T12:34:56.123456Z'); SET extra_float_digits=0; SET bytea_output='escape'; SET TimeZone='America/New_York'; BEGIN READ ONLY");
    const { rows: [rounded] } = await engine.query('SELECT to_jsonb(value)::text AS value FROM groundwork.fixture');
    const source = await fingerprint(engine);
    await engine.exec("COMMIT; SET extra_float_digits=3; SET bytea_output='hex'; SET TimeZone='UTC'; BEGIN READ ONLY");
    const { rows: [precise] } = await engine.query('SELECT to_jsonb(value)::text AS value FROM groundwork.fixture');
    assert.notEqual(rounded.value, precise.value, 'the source setting must reproduce the floating output difference');
    assert.deepEqual(await fingerprint(engine), source);
    await engine.exec("COMMIT; UPDATE groundwork.fixture SET value=1.234567890123456 WHERE id=1; BEGIN READ ONLY");
    assert.notDeepEqual(await fingerprint(engine), source);
    await engine.exec('COMMIT');
  } finally { await engine.close(); }
});
