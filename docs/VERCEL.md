# Groundwork on Vercel Hobby

This configuration hosts the public studio and React application as static Vite
assets and the existing Express API as one Node.js function. It is intended for a
personal non-commercial demo. Vercel Hobby does not permit commercial use; see
[the Hobby plan](https://vercel.com/docs/plans/hobby).

## Runtime and project configuration

Import the repository root, select Node 22 and use the checked-in `vercel.json`.
The install command is `npm ci --include=dev`, the build command is `npm run build`, and the
output directory is `client/dist`. The function runs in `iad1`, close to the
existing North Virginia Supabase database. It exports the Express handler without
starting a port listener, native worker, database backup scheduler or periodic
reconciliation process.

Set production environment variables in the Vercel project settings. Preserve the
existing encryption key and dedicated database runtime connection privately:

| Variable | Configuration |
| --- | --- |
| `NODE_ENV` | `production` |
| `GROUNDWORK_SERVERLESS` | `vercel` |
| `GROUNDWORK_DATA_DIR` | `/tmp/groundwork`, used only as ephemeral scratch |
| `GROUNDWORK_SERVER_ROLE` | `authority` |
| `GROUNDWORK_AUTHORITY_GATEWAY_MODE` | `direct` |
| `DATABASE_PROVIDER` | `supabase` |
| `DATABASE_URL` | Existing restricted runtime connection, stored as a sensitive secret |
| `DATABASE_POOL_MAX` | `1` for this low-traffic demo |
| `DATABASE_SSL_CA_FILE` | `server/certs/supabase-root-2021.crt` |
| `MASTER_KEY` | Existing stable encryption key, stored as a sensitive secret |
| `PREVIOUS_MASTER_KEY` | Preserve privately only if key rotation uses it |
| `PUBLIC_APP_ORIGIN` | The exact canonical public HTTPS origin |
| `MAIL_PROVIDER` and `MAIL_*` | Existing verified SMTP settings; store `MAIL_PASS` as sensitive |
| `PAYMENTS_MODE` | `live`; unconfigured providers cannot grant demo subscriptions |
| `NATIVE_WORKER_ENABLED` | `false` |
| `NATIVE_ISOLATION_ACKNOWLEDGED` | `false` |
| `VITE_HOSTING_MODE` | `vercel`, applied when building the frontend |

Vercel supplies `VERCEL=1` and `VERCEL_URL`. The runtime refuses serverless mode
without Vercel, production cookies and Supabase. Do not deploy database
administrator URLs, development OTP disclosure, demo seeding, local environment
files, database snapshots or gateway credentials. The committed public CA is a
trust certificate, not a private key.

## Supported demo behavior

The studio, account flows, Gmail SMTP transport, Supabase project persistence,
browser editors and local export tools use the same origin. Session, CSRF and
project permissions remain enforced by the API. The API takes client identity
from Vercel's verified forwarding header only in the validated Vercel runtime.
Mutations must originate from the canonical application or immutable deployment
origin. Static response headers preserve the security policy at the CDN.

Project event streams poll persisted events across function instances and close
before the function deadline so the browser can reconnect. Native execution and
asynchronous provider render submissions are unavailable in this deployment;
they require separately provisioned continuous or durable job execution.

## Platform limits

Vercel Functions have a 4.5 MB request and response limit. The shared application
API client uses a conservative 4,000,000 byte request budget, including multipart
overhead, and explains oversized saves or uploads before sending them. Separate
specialist upload helpers and large downloads remain subject to the platform
limit. The original larger upload limits still apply on a persistent backend.

Function filesystem storage is ephemeral. Supabase holds persistent project data;
`/tmp/groundwork` must never be treated as a backup destination. Automatic hosted
backups and restoration remain an operator responsibility. General API request
limits now use atomic shared database counters alongside persistent
account/provider budgets. Shared admission does not establish production load
capacity or guarantee protection from every denial-of-service pattern.

The Hobby allowance limits usage. This deployment does not enable paid Vercel
features or provision external paid AI, payments or native services.

## Verification after deployment

Verify the home page uses the studio document, direct `/login` and `/dashboard`
navigation uses the React document, static assets have correct content types,
and `/api/health` returns database health JSON rather than application HTML.
Then check password login, secure session cookies, a CSRF-protected project save
and reload, logout, unauthorized access denial and invalid-origin denial.
SMTP authentication and actual inbox delivery are separate checks.

References: [Express on Vercel](https://vercel.com/docs/frameworks/backend/express),
[function limits](https://vercel.com/docs/functions/limitations),
[request headers](https://vercel.com/docs/headers/request-headers) and
[SMTP on Vercel](https://vercel.com/kb/guide/serverless-functions-and-smtp).

## Operating and releasing the free-plan deployment

`OPERATIONS.md` describes opt-in external GitHub health checks with the existing
SMTP account, a real encrypted offsite export of the private Supabase schema,
separate key custody, and isolated restore verification. These run outside
Vercel and do not depend on an in-process timer or ephemeral function storage.
They require privately configured credentials and successful activation evidence;
their presence in the repository does not mean they are active.

`RELEASE.md` describes the checked-in main Git auto-deployment restriction,
post-CI deployment-hook workflow and exact-commit Vercel build guard. The private
hook and successful workflow/build evidence are required for activation. No paid
Deployment Checks are provisioned. The daily `/api/ops/check` cron also requires
the privately configured `CRON_SECRET`; it does not replace external uptime
checks. `SLO.md` defines initial objectives and measurement limits;
`INCIDENTS.md` records ownership and the recovery procedure.
