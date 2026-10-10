# Release and deployment baseline

This application is a Node 22 web service with a SQLite database. Build with
`npm ci && npm run build`, start with `npm start`, and check `/api/health`.
Configure persistent storage and the environment below in the hosting platform.

## Release checks

Every push and pull request runs `.github/workflows/ci.yml` with Node 22 and the
root npm cache. The required gates are:

```bash
npm ci
npm audit --omit=dev --audit-level=high
npm run lint
npm run build
npm run test -w server
npm run test -w client
```

## Production secrets and persistence

Configure secrets in the deployment platform, never in the repository, client
bundle, or CI logs. Render account credentials and these service values must be
configured by the repository/service owner; this workflow does not provision or
manage Render credentials.

- `MASTER_KEY` is required in production and must be a stable base64-encoded
  32-byte secret. Generate one once (for example,
  `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`),
  store it in the owner-controlled secret store, and preserve it across every
  deploy. Changing or losing it makes encrypted projects, photos and MFA seeds
  undecryptable. MFA uses a separate derived encryption key and binds each seed
  to its user ID. Startup migrates legacy plaintext seeds into encrypted values.
  For a planned rotation, set `PREVIOUS_MASTER_KEY` to the old key while existing
  ciphertext is migrated; retain matching keys and database backups until every
  encrypted record has been rotated. Do not generate a new key on each deploy.
- `GROUNDWORK_DATA_DIR` must point to persistent storage. On Render use the
  persistent disk mounted at `/var/data` and set `GROUNDWORK_DATA_DIR=/var/data`.
  Production refuses to start without it. The SQLite database is
  `$GROUNDWORK_DATA_DIR/groundwork.db`; `DB_PATH`, when used, is a directory
  override and does not change the filename.
- `NODE_ENV=production` must be set for the production service. Keep the
  platform-provided `PORT` value. Unknown `NODE_ENV` values are rejected.
- `BIND_HOST` defaults to `0.0.0.0` in production and `127.0.0.1` in development
  and test. Development/test refuses non-loopback binds. Protect production and
  staging through the hosting platform's TLS, firewall and access controls.
- `PAYMENTS_MODE=live` is mandatory in production. Missing, invalid and demo
  modes fail startup; without live provider credentials checkout stays unavailable.

### Private AI, mail, and payment configuration

All of these values are read by the server and must remain private:

- AI: `AI_API_KEY` and `AI_MODEL`; optionally set `AI_BASE_URL` for an
  OpenAI-compatible provider other than the default.
- Mail via SMTP: `MAIL_PROVIDER=smtp`, `MAIL_HOST`, `MAIL_PORT`,
  `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASS`, and `MAIL_FROM`.
- Mail via Resend: `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `MAIL_FROM`.
  Production has no console-mail fallback and never returns or logs OTPs. Verify
  real delivery before onboarding users: missing or failed delivery returns an
  unavailable response. SMTP requires TLS in production.
  Local development can explicitly opt in with `GROUNDWORK_DEV_OTP=1`; returned
  codes additionally require loopback peer, request host, origin (if present)
  and effective IP. Keep this opt-in disabled outside an isolated local workflow.
- Payments: set `PAYMENTS_MODE=live` in production and configure the provider
  being offered: Razorpay uses `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and
  `RAZORPAY_WEBHOOK_SECRET` plus `RAZORPAY_ACCOUNT_ID`; PayPal uses `PAYPAL_CLIENT_ID`,
  `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`, and `PAYPAL_MODE=live`. Register
  `https://<service-host>/api/payments/webhook` for Razorpay's
  `payment_link.paid` event. Tenant seat checkout also requires the explicit
  price and term settings described in `PHASE-7-ENTERPRISE-AUTHORITY.md`.

### Provider resource budgets

AI and render calls use durable per-user/global daily request and token-proxy
budgets, concurrency admission, and a deadline spanning connection and body
reading. Exhausted capacity returns 429 instead of starting more work. Rendering
reserves project artifact capacity before dispatch. Retries use the same budgets.

| Setting suffix | `AI_` default | `RENDER_` default |
| --- | --- | --- |
| `USER_CONCURRENCY` | 2 | 1 |
| `GLOBAL_CONCURRENCY` | 16 | 4 |
| `USER_DAILY_REQUESTS` | 100 | 20 |
| `GLOBAL_DAILY_REQUESTS` | 5,000 | 200 |
| `USER_DAILY_TOKEN_BUDGET` | 250,000 | 200,000 |
| `GLOBAL_DAILY_TOKEN_BUDGET` | 10,000,000 | 10,000,000 |
| `PROVIDER_TIMEOUT_MS` | 30,000 | 120,000 |

`AI_MAX_OUTPUT_TOKENS` defaults to 2,048 (maximum 8,192), and
`RENDER_MAX_OUTPUT_BYTES` defaults to 16 MiB (maximum 64 MiB). Deadlines may not
exceed 300,000 ms. The assistant response body is capped at 256 KiB; provider error
bodies are bounded and not returned verbatim or logged.

These budgets are conservative usage proxies, not monetary invoices. Requests
that reach a provider may incur charges after cancellation or timeout, so their
daily reservations are retained. Set provider-account spending limits as well.
Daily budgets reset on the next UTC day and survive application restarts. Set
`GEMINI_API_KEY` or `IMAGEN_API_KEY` only on the server for live image rendering;
the explicit demo render provider is a local preview and grants no subscription.

### Authentication and browser storage

Startup adds credential epochs, TOTP attempt/replay fields and MFA encryption
without deleting accounts or projects. Password changes and revoke-other-session
operations invalidate pending MFA challenges and other live sessions atomically.
TOTP enrollment now uses authenticated CSRF-protected `POST /api/auth/2fa/setup`.

Sign-out reports success only after server revocation succeeds. The dialog keeps
local copies by default and offers a plaintext recovery ZIP and explicit removal
of account-scoped browser copies. Removal includes unsynchronized work and requires
acknowledgment; it does not delete server projects. Other tabs should be closed
before removal. A fresh, confirmed sign-in can recover an interrupted sign-out;
previously consented removal finishes before local writes resume. Suspended tabs
clear their stale tab-local copies after a removal, preserving newer shared
records. Recovery records carry the removal generation so new session-only drafts
survive reload even when durable storage is full. Private render images use
`private, no-store`.

## Backups and restore

Set `ADMIN_EMAILS` to the explicit administrator email allowlist for production
backup endpoints. An empty allowlist grants nobody access. The authenticated mail
diagnostic sends only to the caller's own email unless they are allowlisted.

Development demo seeding is disabled by default. It requires
`GROUNDWORK_SEED_DEMO=1`, a loopback development bind and an explicit
`GROUNDWORK_DEMO_PASSWORD` of at least 12 characters with letters and numbers.
The application does not log that password. Existing historical demo accounts
are not deleted or rotated by this change; remove or secure those identities
before deploying an existing database.

Back up the complete persistent data directory, including SQLite sidecar files
(`groundwork.db-wal` and `groundwork.db-shm` when present), and store the exact
`MASTER_KEY` in a separate owner-controlled secret backup. Take a provider disk
snapshot or stop the service before copying the directory so the SQLite backup
is consistent. Do not rely on the repository or an ephemeral filesystem as a
backup.

To restore, stop the service, replace the contents of
`GROUNDWORK_DATA_DIR` with a known-good snapshot, restore the original
`MASTER_KEY`, then start the same release and run the health check. Keep the
database and key from the same backup point; a database without its matching
key cannot be decrypted.

## Post-deploy health check

Render should use `/api/health` as the health-check path. After deployment,
verify the public service returns HTTP 200 and `ok: true`:

```bash
curl -fsS https://<service-host>/api/health
```

If the check fails, inspect startup logs first for invalid production mode,
missing `MASTER_KEY`/`GROUNDWORK_DATA_DIR`, or `PAYMENTS_MODE` before routing traffic
to the release. A successful health check does not verify email delivery, live
checkout, provider billing limits, TLS or external access controls; validate those
in the owner's controlled staging environment.
