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

The editor uses a server-authoritative revision protocol rather than a CRDT. Each design write includes the last revision observed by the client; a stale write receives `409 REVISION_CONFLICT` and is never applied. The client keeps local edits in place and surfaces that a remote update is available instead of replacing them blindly. Authenticated project owners can subscribe to `/api/collaboration/:projectId/events` via SSE and create encrypted comments/issues; expiring share links remain read-only and do not receive collaboration access. SSE event payloads intentionally contain metadata only, while project and item content remains encrypted at rest. This phase is single-server/in-memory for live fanout, so reconnecting clients recover state through the normal project/revision APIs and multi-instance deployments need a shared event broker for immediate fanout.

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

Option A — from this repo:

1. Push the repo to GitHub/GitLab.
2. Render → **New** → **Blueprint**, pick the repo (uses the checked-in `render.yaml`), or create a **Web Service** and copy the settings from `render.yaml`.
3. Render runs `npm ci && npm run build`, starts `npm start`, and health-checks `/api/health`.

Option B — manual web service settings:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Env: `NODE_ENV` | `production` |
| Env: `MASTER_KEY` | **Required stable base64 32-byte secret** (must never change) |
| Env: `GROUNDWORK_DATA_DIR` | `/var/data` on the required persistent disk |

**Persistence:** production refuses to start without `MASTER_KEY` and `GROUNDWORK_DATA_DIR`. The Render blueprint uses a paid persistent disk mounted at `/var/data`; do not deploy on ephemeral storage or change `MASTER_KEY`, or encrypted data becomes unreadable. `DB_PATH` is an optional directory override and the database filename remains `groundwork.db`.

**Going live with payments:** set `PAYMENTS_MODE=live` and add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (register the webhook URL `https://<your-app>/api/payments/webhook` for the `payment_link.paid` event) and `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (set `PAYPAL_MODE=live` for production). In demo mode a "Confirm demo payment" button completes any checkout — never enable that with real credentials.

Payments are stored with `status`, provider order id and provider URL. PayPal amounts are collected in USD (converted from the INR plan price); Razorpay Payment Links accept UPI and cards natively.

## Security notes

- **Passwords:** scrypt with per-user random 16-byte salt, N=16384/r=8/p=1. Never logged or returned.
- **At-rest encryption:** AES-256-GCM. The vault key is derived from `MASTER_KEY` via HKDF; each user's blobs use a domain-separated AAD (project data and photos use distinct AADs), so ciphertexts cannot be replayed across resources.
- **Sessions:** server-side random 256-bit tokens stored as SHA-256 hashes; fixed TTL, `last_seen_at` tracking, programmatic revocation ("log out of all devices"). `SameSite=Lax`, `HttpOnly`, `Secure` in production.
- **CSRF:** double-submit cookie + server-stored token; anonymous signup/login exempt by design (covered by SameSite=Lax). GET/HEAD/OPTIONS are always safe.
- **Rate limiting:** per-IP strict limit on auth endpoints (10/15 min) and a global API limit (300/15 min). 5 failed logins lock the account for 15 minutes.
- **2FA:** TOTP (RFC 6238, SHA-1, 30 s, 6 digits), QR setup, enforced re-entry on login when enabled.
- **Input:** Zod validation on every route; JSON body ≤ 256 KiB; uploads ≤ 25 MB with magic-byte content sniffing (PNG/JPEG/WebP/GIF); CSP via Helmet (no inline scripts in production), `frame-ancestors none`, strict referrer policy.
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
