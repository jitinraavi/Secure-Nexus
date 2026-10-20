# Supabase PostgreSQL

Groundwork keeps its Express authentication, Gmail OTP, session cookies and
application encryption. Supabase hosts PostgreSQL; the browser uses the existing
Groundwork API. Supabase Auth and browser service-role keys are not required.

## Connections and roles

Set these **server-only** values in the host's secret store or private `server/.env`:

```dotenv
DATABASE_PROVIDER=supabase
DATABASE_URL=postgresql://groundwork_api.PROJECT_REF:PASSWORD@COPIED_POOLER_HOST:5432/postgres
DATABASE_POOL_MAX=5
# Optional override; Groundwork includes the public Supabase Root 2021 CA.
# DATABASE_SSL_CA_FILE=/private/path/to/supabase-ca.crt
```

Copy the actual Session pooler host from Supabase **Connect → Direct → Session
pooler** for IPv4-only networks. Direct connections use the project database host
and a username without the project suffix. Never guess the pooler host. TLS
certificate verification is always enabled for hosted connections. The bundled
public CA certificate and its verified fingerprint are documented in `server/certs/README.md`.

Use a dedicated login granted membership in `groundwork_runtime`. This group has
application data privileges, not schema ownership, role creation or RLS bypass.
Keep administrator credentials out of the web runtime and frontend environment.
Application tables live in the private `groundwork` schema, with RLS enabled and
no grants to `anon`, `authenticated` or `PUBLIC`. Existing backend checks enforce
user and organization access. Do not expose this schema through the Data API.

## Schema and existing data

Build first. With an administrator connection supplied privately as
`DATABASE_ADMIN_URL`, run:

```sh
npm run build
npm run db:migrate
```

The versioned SQL lives in `server/supabase/migrations/`. Migration execution is
explicit; web startup checks the schema version without running administrator DDL.
The Supabase integration can also apply the same migration to an empty project.

Before importing, stop every old backend/worker that could write the SQLite
database. Preserve a verified snapshot of the original database and its matching
`MASTER_KEY`/`PREVIOUS_MASTER_KEY`. Keep the original key on the new backend:
changing it prevents decryption of projects, MFA seeds and files.

```sh
# DATABASE_ADMIN_URL must have table INSERT/SELECT and sequence UPDATE privileges.
npm run db:import -- /absolute/path/to/groundwork.db
```

Import is one PostgreSQL transaction. It reads a consistent, read-only SQLite
snapshot, verifies schema parity, requires every destination application table to
be empty, preserves IDs/ciphertexts/password hashes, verifies every returned value
and table count, then resets identity sequences. A populated destination is
refused; the tool never overwrites existing cloud records. Keep old writers stopped
until the new connection is verified and the application is restarted.

```sh
# Remove DATABASE_ADMIN_URL from the running web service.
npm run db:verify
npm start
```

Do not run both old and new databases as independent writable authorities. To roll
back before accepting new cloud writes, restore the old configuration and original
SQLite snapshot with its matching key. After new writes, plan a reverse migration
instead of switching blindly to the stale SQLite file.

## Backups, scaling and verification

Manage hosted database backups and restoration in Supabase or with a reviewed
PostgreSQL backup process. Check your plan's backup availability, retention and
off-host recovery. The old SQLite backup/checkpoint endpoints return an explicit
managed-database response; the local SQLite scheduler does not claim to back up
Supabase. A local data directory is still used for optional native-job scratch
files. Native execution remains disabled in the supplied deployment recipes.

Database transactions and standalone writes use a shared advisory lock to retain
the original quota, MFA and billing invariants. This favors correctness during
migration; resource-specific locking is a future throughput optimization.
Multiple APIs also need the configured shared collaboration transport for immediate
cross-instance notifications. Database hosting alone does not add that transport.

```sh
npm test -w server
npm run test:postgres-flow
npm run build
```

The tests use synthetic data and a local PostgreSQL engine; `db:verify` checks the
actual configured hosted connection. Complete a real project save/reload and login
after deployment, and verify your provider mail delivery and backup restoration.
