# Groundwork Design Studio

A deployable, full-stack design studio for interior designers, architects and site engineers:

- **Capture a room** — camera or file upload (PNG/JPEG/WebP/GIF), traced as the canvas backdrop.
- **Design in 3D** — place furniture, change finishes/colours, scale and rotate, paint walls/floors, add curtains (sheer/blackout/roman/panel) on any wall.
- **Ship to CAD & 3D tools** — export DXF (AutoCAD-ready plan with layers), OBJ+MTL (Blender/3ds Max), GLB, and a furniture bill-of-materials CSV.
- **Get paid** — subscription portal (Free / Pro ₹4,999·mo / Studio ₹11,999·yr) with UPI, card and PayPal; demo mode works with zero credentials.
- **Design outside the box** — residential/commercial community builder and highway/airport/ports/dams infrastructure wizards anchored on a Google Maps site, with earth-distortion-free 3D scenes and takeoffs.
- **Hardened by default** — scrypt password hashing, TOTP 2FA, encrypted-at-rest design data and photos (AES-256-GCM), CSRF, rate limiting, account lockout and a full audit log.
- **Bounded live collaboration** — authenticated owner presence over reconnecting SSE, encrypted collaboration events, comments/issues, snapshots, and optimistic revision conflict checks.

Stack: Node 22 · Express · SQLite (`node:sqlite`) · React 18 · Vite · Tailwind v4 · three.js.

---

## Local development

Requirements: Node >= 22.5.

```bash
npm install
npm run dev        # API on :4000, Vite app on :5173 (proxies /api)
```

The first server boot generates a random `MASTER_KEY` in `server/.env` (used to derive the vault key that encrypts all project data and photos — keep it safe, it is your data's backstop).

The API lives in `server/`, the client in `client/`.

### Collaboration model

The editor uses a server-authoritative revision protocol rather than a CRDT. Each design write includes the last revision observed by the client; a stale write receives `409 REVISION_CONFLICT` and is never applied. The client keeps local edits in place and surfaces that a remote update is available instead of replacing them blindly. Authenticated project owners, editors and viewers can subscribe to `/api/collaboration/:projectId/events` via SSE and create encrypted comments/issues. Only project owners and editors can change item status or design data; viewers cannot resolve items. Expiring public share links remain read-only and grant no collaboration membership. SSE event payloads intentionally contain metadata only, while project and item content remains encrypted at rest. This phase is single-server/in-memory for live fanout, so reconnecting clients recover state through the normal project/revision APIs and multi-instance deployments need a shared event broker for immediate fanout.

### Assistant configuration

The first assistant phase is opt-in and server-side. Set `AI_API_KEY` and `AI_MODEL` in `server/.env`; set `AI_BASE_URL` when using an OpenAI-compatible provider other than the default `https://api.openai.com/v1`. The client calls `POST /api/assistant/plan` with the current project context. Without `AI_API_KEY`, the endpoint returns a deterministic configuration-required message and no AI-generated actions.

Assistant output is a validated, non-mutating action plan. Structural and MEP suggestions are preliminary coordination concepts and require review by qualified licensed professionals before use.

## Production build

```bash
npm run build      # builds client then server
npm start          # serves API + built SPA on $PORT (default 4000)
```

Navigate to the app at the served port. In production the session/CSRF cookies use the `Secure` flag, so use HTTPS (Render provides it).

## Deploy to Render

Create a web service with these settings and persistent storage. See
[release instructions](docs/RELEASE.md) for the required mail, payment, key and
provider-budget configuration; this repository does not include a Render blueprint.

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Env: `NODE_ENV` | `production` |
| Env: `PAYMENTS_MODE` | `live` (required in production) |
| Env: `MASTER_KEY` | **Required stable base64 32-byte secret** (must never change) |
| Env: `GROUNDWORK_DATA_DIR` | `/var/data` on the required persistent disk |

**Persistence:** production refuses to start without `MASTER_KEY` and `GROUNDWORK_DATA_DIR`. Configure a persistent disk mounted at `/var/data`; encrypted data requires its matching master key. `DB_PATH` is an optional directory override and the database filename remains `groundwork.db`.

**Payments:** production requires `PAYMENTS_MODE=live`; missing, invalid or demo modes fail startup. Razorpay requires a live `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and `RAZORPAY_ACCOUNT_ID`. Register `https://<your-app>/api/payments/webhook` for `payment_link.paid`. PayPal requires `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID` and `PAYPAL_MODE=live`. Unconfigured live providers cannot grant demo subscriptions. Demo checkout is available in local development/test.

**Email:** configure SMTP or Resend before onboarding users. Production has no console-mail fallback, OTP response disclosure or OTP payload logging. Local code disclosure requires explicit `GROUNDWORK_DEV_OTP=1` and a loopback-only request/service.

Payments are stored with `status`, provider order id and provider URL. PayPal amounts are collected in USD (converted from the INR plan price); Razorpay Payment Links accept UPI and cards natively.

## Security notes

- **Passwords:** scrypt with per-user random 16-byte salt, N=16384/r=8/p=1. Never logged or returned.
- **At-rest encryption:** AES-256-GCM. The vault key is derived from `MASTER_KEY` via HKDF; each user's blobs use a domain-separated AAD (project data and photos use distinct AADs), so ciphertexts cannot be replayed across resources.
- **Sessions:** random 256-bit tokens stored as SHA-256 hashes, absolute expiry and credential epochs. Password changes/revocation invalidate other active and pending MFA sessions and outstanding email login codes. Cookies use `SameSite=Lax`, `HttpOnly`, and `Secure` in production. Failed logout retains signed-in UI with retry.
- **CSRF:** session-bound tokens protect authenticated mutations. Anonymous JSON authentication and verified provider webhooks have scoped exemptions. MFA setup uses POST with CSRF validation.
- **Rate limiting:** global API limit (300/IP/15 min) before JSON parsing; SSO has a stricter IP limit. Password, email OTP and TOTP attempts have account/challenge limits. Upload and provider work have independent concurrency/resource budgets.
- **2FA:** TOTP (RFC 6238, SHA-1, 30 s, 6 digits), user-bound encrypted seeds, single-use timesteps, persistent throttling and enforced re-entry on login when enabled.
- **Input:** route schemas, design byte/count/depth limits, bounded multipart parsing and sniffed photo formats (PNG/JPEG/WebP/GIF). Photos allow 25 MiB; workspace files allow 64 MiB; render sources allow 32 MiB. BCF imports use bounded worker inflation. CSP uses Helmet, `frame-ancestors none`, and strict referrer policy.
- **Offline privacy:** sign-out defaults to keeping unsynchronized copies, offers a plaintext recovery ZIP and requires explicit acknowledgment for removal. Retained browser copies and backups are plaintext. Private render images use `private, no-store`.
- **Audit log:** signup/login/2FA/export/payment/project events recorded with IP and user agent; visible in the app (Settings → Audit log) including export history and failed-login attempts.

## Project layout

```
server/src
  config.ts         env, constants, cookie names
  db.ts             SQLite schema + migrations (users, sessions, audit_logs, secrets, files, projects, payments)
  crypto.ts         scrypt, AES-256-GCM, HKDF, random tokens
  totp.ts           TOTP implementation
  validate.ts       Zod schemas (email/password/confirm)
  audit.ts          audit log helper
  security.ts       rate limits, sessions, CSRF middleware
  routes/           auth, secrets, audit, projects (+photo upload), payments, assistant plan
  payments/         plans + demo/razorpay/paypal providers
client/src
  api.ts            typed API client (CSRF header injection)
  editor/Canvas3D.tsx  three.js room editor (drag, selection, GLB export)
  lib/              furniture catalog, DXF/OBJ/CSV exporters, zip/download
  pages/            landing, auth, dashboard, editor, audit, settings, billing, checkout
render.yaml         Render blueprint (free tier, optional persistent disk)
SPEC.md             product specification & open questions
```

## Testing

- Server: `npm run build -w server` (tsc).
- Client: `npm run build -w client` (tsc + vite).
- Smoke test the API flow with the built server running (`npm start`): sign up → create project → save design → upload photo → pay (demo) → export → check the audit log.
