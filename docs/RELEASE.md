# Release and deployment baseline

This application is a Node 22 web service with a SQLite database. The checked-in
`render.yaml` is the reference Render configuration; the service runs
`npm ci && npm run build`, starts with `npm start`, and checks `/api/health`.

## Release checks

Every push and pull request runs `.github/workflows/ci.yml` with Node 22 and the
root npm cache. The required gates are:

```bash
npm ci
npm run lint
npm run build
npm run test -w server
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
  deploy. Changing or losing it makes encrypted projects and photos
  undecryptable.
- `GROUNDWORK_DATA_DIR` must point to persistent storage. On Render use the
  persistent disk mounted at `/var/data` and set `GROUNDWORK_DATA_DIR=/var/data`.
  Production refuses to start without it. The SQLite database is
  `$GROUNDWORK_DATA_DIR/groundwork.db`; `DB_PATH`, when used, is a directory
  override and does not change the filename.
- `NODE_ENV=production` must be set for the production service. Keep the
  platform-provided `PORT` value.

### Private AI, mail, and payment configuration

All of these values are read by the server and must remain private:

- AI: `AI_API_KEY` and `AI_MODEL`; optionally set `AI_BASE_URL` for an
  OpenAI-compatible provider other than the default.
- Mail via SMTP: `MAIL_PROVIDER=smtp`, `MAIL_HOST`, `MAIL_PORT`,
  `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASS`, and `MAIL_FROM`.
- Mail via Resend: `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `MAIL_FROM`.
  Set `GROUNDWORK_DEV_OTP=0` outside local development. Verify delivery before
  requiring email verification in a live release.
- Payments: keep `PAYMENTS_MODE=demo` until live provider credentials are
  ready. For live payments set `PAYMENTS_MODE=live` and configure the provider
  being offered: Razorpay uses `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and
  `RAZORPAY_WEBHOOK_SECRET`; PayPal uses `PAYPAL_CLIENT_ID`,
  `PAYPAL_CLIENT_SECRET`, and `PAYPAL_MODE=live`. Register
  `https://<service-host>/api/payments/webhook` for Razorpay's
  `payment_link.paid` event.

## Backups and restore

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

If the check fails, inspect startup logs first for missing `MASTER_KEY`,
`GROUNDWORK_DATA_DIR`, or provider configuration before routing traffic to the
release.
