# Groundwork security audit

Historical review of local snapshot `e90f97a`; source line positions may differ in the merged branch. See [the current six-item comparison](SECURITY-AUDIT-COMPARISON.md) for integration status and current validation.

Date: 2026-10-10. Scope: the current local repository, including uncommitted changes, installed dependencies, React frontend, Express authority/gateway, authentication, billing, organization/project authorization, uploads, native jobs and offline storage.

Original audit result: **11 code findings (2 High, 8 Medium, 1 Low), plus 2 conditional High deployment risks.** Severity accounts for authentication and other exploit preconditions.

## Remediation — 2026-10-10

The findings below describe the pre-patch code and retain the original evidence.
Their historical line numbers may no longer match the patched files. The current
patches and their regression coverage are summarized here; deployment checks and
the absence of other possible vulnerabilities are not certified by this review.

| Finding | Current correction | Regression coverage |
| --- | --- | --- |
| F01 | Multer upgraded to 2.4.0 with updated types/lockfile; flat field depth/index restrictions applied. CI audits production dependencies. | Production dependency audit, valid/rejected multipart route tests. |
| F02 | Project write access precedes parsing. Shared upload middleware limits files, fields, parts, total streamed bytes, elapsed time and user/global concurrency. Malformed-body drains remain bounded. | Unauthorized photo, extra/nested fields, valid upload/read, chunked overflow, timeout and permit cleanup. |
| F03 | Credential epochs invalidate stale active/pending sessions. Credential rotations atomically revoke other live states and outstanding email codes; MFA upgrade rotates its cookie. | Password change, revoke-others, stale epochs and pending challenge tests. |
| F04 | Persistent account/challenge attempt limits and lockouts; atomic consumption of TOTP timesteps prevents reuse across challenges. | New-challenge throttling, cooldown, exhausted challenge and single-use code tests. |
| F05 | Persistent daily usage budgets, per-user/global concurrency, output token/byte caps, complete-call deadlines and artifact reservations precede provider dispatch. Retries use the same admission checks. Provider inputs reject excessive nesting/count/UTF-8 bytes before serialization. | Overload, cross-process quotas, retries, reservations, cancellation, oversized/stalled replies and late-completion tests using stubs. |
| F06 | Duplicate ID buckets append in place. Designs have byte/count/depth limits before lock traversal, serialization and cloning; unresolved locks reuse one whole-design comparison. | Invalid/deep/oversized API inputs, 25,000 duplicate IDs and 100 unresolved locks with preserved conflict behavior. |
| F07 | Worker-isolated BCF inflation counts actual streamed bytes before collection, enforcing per-entry/aggregate budgets, cancellation and a 30-second worker deadline. XML has bounded size and rejects DTD/entities. | Normal import, forged lengths, aggregate output, cancellation and unsafe paths. |
| F08 | Failed server logout retains signed-in UI with retry. A shared dialog defaults to keeping offline copies and offers export or acknowledged account-scoped removal, with pending-write fences. Fresh sign-in recovers interrupted logout without letting stale cleanup erase newer data; a retained removal generation prevents suspended tabs restoring deleted drafts. Private render images use `private, no-store`. | Browser storage/logout regressions and manual browser verification recorded below. |
| F09 | Console fallback is unavailable in production; mail payloads, codes and recipients are not logged. Delivery failures return sanitized errors. SMTP requires TLS in production. | Production missing-mail/developer-code checks and sanitized isolated fixture runs. |
| F10 | TOTP setup uses authenticated CSRF-protected POST; GET no longer changes enrollment state. | GET rejection, missing-CSRF rejection and successful encrypted enrollment. |
| F11 | User-bound AES-GCM seeds use a separately derived MFA key. Transactional migration encrypts legacy seeds and reseals previous-key values; corrupt or transplanted seeds fail closed. | Legacy/previous-key migration, ciphertext tampering, cross-user seed transplantation and migration rollback. |
| D01 | Development/test binds are loopback-only. Developer OTP disclosure requires explicit opt-in and loopback peer, effective IP, host and origin. Unknown environment modes fail startup. | Public development bind/invalid mode rejection and nonlocal developer-code denial. Public host/firewall inventory remains operator-owned. |
| D02 | Production requires exact `PAYMENTS_MODE=live`; missing, demo and invalid modes fail startup. Unconfigured live providers cannot fall back to demo entitlement grants. | Production startup rejection and explicit local demo fixture. Real provider credentials and live checkout remain operator-owned. |

The API rate limiter now runs before JSON parsing, and general error logging
records error types rather than raw exception/provider payloads. Release settings,
mail/payment requirements, key migration and provider budget defaults are in
[RELEASE.md](RELEASE.md).

### Patch verification

- Full server suite: **63 passed, 0 failed**, including the existing integration/offline/render suites and new auth/resource/upload/design regressions, all against isolated fixture data.
- Production dependency audit: **0 known vulnerabilities reported**. This complements the explicit middleware version/advisory review; registry results alone are not proof of safety.
- Client security suite: **23 passed, 0 failed**, covering bounded BCF inflation, draft flushing/preservation, scoped removal, stale authentication, parallel sign-out fences, delayed sync callbacks, logout deadlines, interrupted sign-out recovery, suspended-tab removal notifications and post-removal session-only drafts across reloads and storage quota failures.
- `npm run lint` and `npm run build`: **passed**. The production build includes the dedicated BCF worker and disables source maps.
- Manual browser verification on the isolated preview: keep-local is the default; removal without acknowledgment is disabled; stopping the fixture API produces a visible failure while the authenticated workspace remains present; restarting it and retrying reaches `/login`, which remains signed out after reload. [Screenshot of the failure/retry flow](C:/Users/jitin/.codex/visualizations/2026/10/09/01a120bd-e062-7d82-bab2-7ffa667cddf8/security-signout-verification.jpg). Permanent browser-data deletion was covered by isolated helper regressions rather than performed on a user's real browser data.
- No real customer data, emails, payments or paid AI provider calls were used. Live infrastructure and provider settings remain outside this code patch.

## Original findings

### F01 — High: installed upload middleware has published denial-of-service vulnerabilities

Evidence: [server/package.json:21](../server/package.json#L21) selects Multer 1.x; [package-lock.json:3274](../package-lock.json#L3274) resolves `1.4.5-lts.2`. Upload routes use that installed library.

The maintainer documents process crashes from crafted multipart field names and CPU exhaustion from oversized array indexes; the affected ranges include this version. Authentication precedes the inspected upload parsers, so exploitation here requires an active account; upstream advisories' unauthenticated severity should not be copied blindly into this application. File-size/part limits do not fix a vulnerable parser. See the [crafted-field advisory](https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm), [array-index advisory](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4), and [older malformed-request advisory](https://github.com/expressjs/multer/security/advisories/GHSA-fjgf-rc76-4x9p).

Fix: migrate to a currently supported patched Multer release, at least 2.4.0 at this audit date, update types/lockfile and validate every upload path. Configure the new field-name/index/depth protections for the actual request schema. The maintainers identify 2.4.0 as a further cleanup fix in their [September advisory](https://github.com/expressjs/multer/security/advisories/GHSA-3pph-fpjx-jg34); that particular disk-storage issue is not asserted against Groundwork's memory-storage routes.

Validation: installed-version and maintainer-advisory comparison. No process-crashing payload was sent. `npm audit --json` returned zero findings; that registry result conflicts with the independently checked advisory ranges and does not establish safety.

### F02 — High: project photo uploads accept unbounded multipart text fields

Evidence: [projects.ts:20](../server/src/routes/projects.ts#L20) sets only a 25 MiB file limit and one file. [projects.ts:518](../server/src/routes/projects.ts#L518) parses the upload before checking project access.

An active account can send many text fields in a single request, including to a nonexistent project. Each field may be individually limited by the parser, but the number of fields/parts and total request size are not bounded at this route. They accumulate in memory. The 8 MiB Express JSON limit does not apply to multipart bodies. The required gateway has a total request ceiling, but direct-authority mode does not, and gateway limits are still large enough to amplify concurrent memory use.

Fix: check project write access before parsing; allow only the expected file and required fields; bound fields, field bytes, parts and total streamed bytes. Bound concurrent uploads as well. Apply F01 independently.

Validation: a small isolated parser test accepted 20 text fields without a photo under the current configuration. No large or exhausting request was executed.

### F03 — Medium: password changes and session revocation leave pending 2FA challenges valid

Evidence: [auth.ts:726](../server/src/routes/auth.ts#L726) and [auth.ts:766](../server/src/routes/auth.ts#L766) revoke only `status = 'active'`. [auth.ts:487](../server/src/routes/auth.ts#L487) accepts pending challenges and [auth.ts:515](../server/src/routes/auth.ts#L515) upgrades them without checking the password-change time or a credential/session epoch.

A challenge obtained before a password change or “revoke other sessions” remains usable until its five-minute expiry. A party holding that challenge and a valid TOTP can establish an active session after the user attempted revocation. This is not a TOTP-free authentication bypass. Active-session middleware does protect subsequent account-management and project routes.

Fix: revoke all other live states, including `pending_2fa`, and atomically check challenge revocation, expiry and credential epoch during upgrade.

Validation: isolated production-mode router tests verified pending challenges after password change and revoke-others; both returned 200. A pending-session account-management request correctly returned 401.

### F04 — Medium: TOTP challenges lack account/challenge throttling and replay prevention

Evidence: [auth.ts:509](../server/src/routes/auth.ts#L509) verifies codes without a failure counter. [totp.ts:63](../server/src/totp.ts#L63) accepts matching codes in the adjacent time windows without recording a consumed timestep. [security.ts:37](../server/src/security.ts#L37) supplies only the shared 300 requests/IP/15 minutes limit for this endpoint.

A party that has passed the first factor can repeatedly guess within the challenge lifetime and use multiple IPs or new challenges to evade an IP-only budget. A captured valid code can also be reused across challenges within its accepted window. Password and email-OTP attempt counters exist; they do not cap this TOTP path.

Fix: use atomic per-account and per-challenge attempt budgets, short lockouts/backoff, and a last-consumed timestep. Maintain an aggregate user budget across newly issued challenges; retain the IP limiter as another layer.

Validation: eight wrong codes returned 401, then the valid code returned 200; the same valid code succeeded on multiple synthetic challenges. No brute-force campaign was performed.

### F05 — Medium, external provider required: AI work lacks application concurrency and spend limits

Evidence: [renderJobs.ts:386](../server/src/renderJobs.ts#L386) dispatches accepted jobs immediately; [renderJobs.ts:95](../server/src/renderJobs.ts#L95) and line 174 track controllers without admission limits. Retry reuses an existing source and immediately dispatches again at [renderJobs.ts:459](../server/src/renderJobs.ts#L459). Provider execution at line 193 precedes output capacity checks at line 206. [renderProvider.ts:311](../server/src/renderProvider.ts#L311) has manual cancellation without an application execution deadline. [assistant.ts:88](../server/src/routes/assistant.ts#L88) has a 30-second timeout, but no per-user/concurrency/spend or output-token budget.

Artifact caps exist (64 MiB each, 256 MiB and 128 artifacts/project), but retry can cause provider work without a new source upload, including when output storage is full. With a configured paid provider, ordinary authenticated users can amplify spend, open requests or exhaust upstream capacity. Rendering requires project write access. Unconfigured deployments make no provider call. The shared IP limiter and upstream provider limits mitigate impact. This is a resource-control gap, not a demonstrated subscription entitlement bypass.

Fix: bounded queues, atomic per-user/global concurrency admission, usage/spend budgets, render deadlines, output-size/token bounds and capacity admission before provider calls.

Validation: source trace and independent review. No paid provider calls or expenditure were generated.

### F06 — Medium: duplicate design IDs cause quadratic lock validation on the API event loop

Evidence: [designLocks.ts:14](../server/src/designLocks.ts#L14) copies the entire existing duplicate-ID array on every insertion. Whole-design saves call it at [projects.ts:325](../server/src/routes/projects.ts#L325); collaboration operations call it at [collaboration.ts:345](../server/src/routes/collaboration.ts#L345), before their final size rejection.

An authorized editor can submit a permitted-size design containing many repeated IDs while another user holds a live project lock. Repeated copying is quadratic and synchronous, so the work can stall the shared process and other tenants. The design byte ceiling and request-rate limit do not bound this algorithmic cost. Two ordinary collaborating accounts can meet the lock precondition.

Fix: append to existing buckets in place; enforce design object/count/depth limits before traversal; reject ambiguous duplicate IDs where the model requires unique IDs.

Validation: isolated exact-helper measurements used 4,000/8,000/16,000 objects (76/152/304 KB) and approximately 37/72/565 ms. These timings illustrate the code-level complexity issue; they are not production capacity measurements. No large payload was sent to a running service.

### F07 — Medium, malicious file import required: BCF decompression budgets apply after inflation

Evidence: [bcf.ts:89](../client/src/lib/bcf.ts#L89) trusts declared central-directory expanded sizes for preflight. [bcf.ts:106](../client/src/lib/bcf.ts#L106) fully inflates an entry before checking its actual byte count.

A malicious archive can claim small expanded lengths and require substantially more memory while inflating. JSZip's eventual size-mismatch error occurs after the decompression work. Opening such a BCF file can exhaust or stall the importing browser; this finding does not establish server execution or path traversal.

Fix: bounded streaming inflation with per-entry and aggregate counters that abort before collecting oversized output; use a cancellable worker to isolate expensive imports. Retain header/path validation as an additional layer.

Validation: a synthetic 2,180-byte ZIP declaring one expanded byte produced 2 MiB of decompression output before mismatch rejection. No browser out-of-memory test was performed.

### F08 — Medium, same browser profile required: signing out does not reliably end local access

Evidence: [client auth.tsx:55](../client/src/auth.tsx#L55) ignores logout failures and clears the signed-in UI. Actual session/cookie revocation happens server-side at [server auth.ts:537](../server/src/routes/auth.ts#L537). [renderJobs.ts:165](../server/src/routes/renderJobs.ts#L165) caches private source/output images for one hour, overriding the router's `no-store` policy.

If logout fails/offline, the server session survives; going online and reloading can restore authentication. Previously viewed private render URLs can also be reused from a fresh browser cache without a new access check after logout or permission revocation. Network retrieval still checks authorization, and `private` prevents shared intermediary caching.

Offline designs, queues and workspace attachments intentionally remain in localStorage/IndexedDB; logout clears the project-cache and queue stores' in-memory copies rather than their persisted records. This retained plaintext is documented offline behavior, not a remote cross-account bypass or failure of server encryption. It adds a shared-device privacy limitation. Account-scoped keys and browser origin isolation protect ordinary UI/remote access.

Fix: represent failed logout honestly and retry server revocation; use `private, no-store` for sensitive render images. Offer a clear preserve/export/remove local-data choice without silently deleting unsynchronized work. See [offlineDraft.ts:107](../client/src/lib/offlineDraft.ts#L107), [offlineProjectStore.ts:110](../client/src/lib/offlineProjectStore.ts#L110), [offlineQueue.ts:97](../client/src/lib/offlineQueue.ts#L97), and [workspaceDraft.ts:75](../client/src/lib/workspaceDraft.ts#L75).

Validation: code/data-flow review; no real user's browser storage was read. The existing offline suite verifies in-memory/account isolation, not persistent-data removal or failed-network logout.

### F09 — Medium, console mail fallback/log access required: authentication codes enter production logs

Evidence: [mailer.ts:19](../server/src/mailer.ts#L19) falls back to console when credentials are absent/misconfigured; [mailer.ts:85](../server/src/mailer.ts#L85) logs full email bodies, including usable OTPs. Only the returned developer code at line 86 is production-gated.

Production mode does not prevent console OTP logging. A person with access to these logs can obtain a passwordless authentication code. Accounts with enabled TOTP still require that factor. Logs also contain recipients. The impact depends on mail configuration and log access; a configured working provider does not execute this console branch.

Fix: reject console/fallback mail in production and never log authentication codes or email bodies. Emit delivery metadata and redacted errors. Review log retention/access and provider-error logging without assuming every error contains a secret.

Validation: isolated production-mode test with missing SMTP credentials and developer OTPs disabled confirmed that the code was logged while the response's developer code remained absent. Synthetic values only.

### F10 — Low: a GET request changes TOTP enrollment state without CSRF protection

Evidence: [auth.ts:775](../server/src/routes/auth.ts#L775) exposes `GET /api/auth/2fa/setup`; line 794 replaces the enrollment secret. [security.ts:157](../server/src/security.ts#L157) exempts GET from CSRF checking and session cookies use SameSite=Lax.

In direct-authority mode, a cross-site top-level navigation can send a logged-in session cookie and regenerate an unenrolled account's setup secret, disrupting an in-progress enrollment. The endpoint requires an active session and refuses already-enabled TOTP; this is not disabling enabled MFA, reading the response cross-origin or taking over the account. Gateway origin checks currently also exempt safe-method GET requests.

Fix: make setup an authenticated CSRF-protected POST; consider recent reauthentication for factor enrollment changes.

Validation: method, cookie and middleware trace. No cross-site navigation was performed against a real account.

### F11 — Medium, database disclosure required: authenticator seeds are stored in plaintext

Evidence: [db.ts:21](../server/src/db.ts#L21) defines the TOTP secret field; [auth.ts:794](../server/src/routes/auth.ts#L794) writes the raw seed. TOTP verification later reads it directly. Other vault/project data uses authenticated encryption, but these seeds do not.

A database or database-backup disclosure lets someone clone an enrolled authenticator permanently, until its seed is rotated. Reading the database is a precondition, not a demonstrated remote attack path; a normal password login still requires the first factor. This weakens MFA as a separate protection following a database compromise.

Fix: encrypt seeds with a separately managed key and user-bound authenticated encryption, migrate existing seeds safely, and keep backup/key permissions separated. Seeds cannot be one-way hashed because TOTP verification needs their secret value.

Validation: schema, enrollment write and verification read trace. No actual database backup or real authenticator seed was inspected.

## Conditional deployment risks

### D01 — High if a development-mode authority is exposed: passwordless OTPs are disclosed in responses

[config.ts:17](../server/src/config.ts#L17) defaults to development; line 94 enables developer OTPs unless disabled. [auth.ts:84](../server/src/routes/auth.ts#L84) returns codes when console delivery or a provider failure permits developer disclosure; the passwordless request response includes them at line 344. [authorityServer.ts:161](../server/src/authorityServer.ts#L161) does not supply a loopback bind host, so its development listener is not restricted to localhost by code.

If that development instance is reachable by an attacker, requesting and submitting a victim's disclosed code permits passwordless access to accounts without TOTP. Production mode suppresses response disclosure; enabled TOTP remains enforced. Firewall, routing and the live deployment's environment were not inspected, so exposure is not asserted.

Fix: developer-code disclosure should require explicit opt-in and a loopback-only development service. Fail startup for insecure externally exposed configurations and set/validate production mode in deployment.

### D02 — High for a paid production deployment: missing/invalid payment mode grants demo subscriptions

[providers.ts:185](../server/src/payments/providers.ts#L185) selects demo for every value except exact `live`, independent of NODE_ENV. [payments.ts:206](../server/src/routes/payments.ts#L206) permits personal demo confirmation, and line 198 grants the user's subscription server-side.

In a production deployment with PAYMENTS_MODE unset, misspelled or intentionally left demo, an ordinary user can create and confirm a personal Studio/Pro payment without a real charge. This is an intentional demo flow whose production configuration fails open; it is not a live-provider signature bypass. Tenant seat products independently reject personal demo grants.

Fix: validate payment mode, reject missing/invalid values in production and disable demo confirmations on production paid deployments. If a public demo is intentional, isolate it from commercial entitlements and real customer data.

Validation: an isolated production-mode test with an unrecognized payment mode selected demo and granted a synthetic account Studio for 30 days without a provider receipt. The live production configuration was not inspected.

## Coverage of every requested category

“No issue identified” describes the inspected code, not proof that deployment or all possible inputs are safe.

| Requested category | Result and evidence |
| --- | --- |
| Cross-site scripting | No direct HTML/eval injection identified in inspected frontend sinks. React text rendering, CSP and nosniff provide protection. Engineering links require HTTPS and geometry fetches require the current origin. Personal checkout URLs are trusted provider output without an explicit scheme allowlist; no attacker-controlled exploit was established. Photos accept sniffed PNG/JPEG/WebP/GIF; HTML/SVG are rejected. No uploaded executable-content bypass was demonstrated. |
| Cross-site request forgery | Protected mutations compare against the server session's CSRF token. Anonymous JSON authentication and signed webhook exemptions do not by themselves establish an exploit: no permissive CORS or form/text body parser was found. F10 is a limited state-changing GET issue. |
| Insecure file uploads | F01, F02 and F07. Workspace/render multipart paths have stronger part limits; workspace/native downloads use octet-stream attachments. |
| Path traversal | No direct bypass identified. Uploaded names are metadata, native files use fixed names/fenced leases/NOFOLLOW, artifact IDs are project-scoped, BCF rejects unsafe paths, static serving targets only client/dist. Native runtime confinement depends on operator setup. |
| Server-side request forgery | No user-directed unrestricted fetch found. SSO uses administrator-controlled HTTPS hostname allowlisting, bounded responses and refuses redirects (routes/sso.ts:17–50). Payments/Resend use fixed service origins; SMTP, AI, Redis and gateway destinations come from server configuration. Allowlist/DNS/egress configuration was not assessed live. |
| Broken password reset | No dedicated forgot-password/reset-token route exists in this code. Password change requires current password; passwordless email login is the recovery-like mechanism. F03, F04, F09 and D01 affect authentication/recovery assurances. |
| Weak session management | F03, F04 and F08; F11 concerns MFA secret storage. Otherwise tokens are random, SHA-256 hashed in the DB, HttpOnly, Secure in production, SameSite=Lax, with absolute expiry and active-state guards. Pending challenges have five-minute expiry. |
| Vulnerable JWT secrets | No application JWT session signing secret exists. OIDC ID tokens use approved asymmetric algorithms with key type/strength, signature, issuer, audience, time and nonce checks (routes/sso.ts:112–132). PKCE, single-use state and a browser-bound flow are implemented. |
| Overly permissive CORS | No wildcard/reflected Access-Control-Allow-Origin or CORS middleware found. Required gateway mode also validates canonical host/origin for mutations. |
| Missing rate limits | Global 300/IP/15-minute and SSO 10/IP/15-minute limits exist; password/email-OTP counters exist. F02/F04/F05/F06 identify gaps that these limits do not cover. JSON parsing precedes the API limiter; an edge byte/connection budget would further reduce parsing costs. |
| Exposed test/staging environments | D01. Test scripts use temporary isolated data. Static serving excludes source/test/data directories. Actual public hosts, firewall rules and cloud staging inventory were outside scope. |
| Default credentials left unchanged | No committed seeded administrator/default account credentials identified. Master keys are generated randomly for development; production requires an explicit stable key/data directory. Actual operator/provider credentials were not inspected. |
| Webhook signature verification | Razorpay webhook verifies HMAC-SHA256 over preserved raw body using timingSafeEqual before applying receipts (payments.ts:331–358). Missing/invalid signatures fail. Receipt identity, merchant, amount/currency and idempotency are checked server-side. No unsigned billing grant found in live mode. |
| Frontend-only payment/subscription checks | D02. Real payment receipts, prices, personal active-project allowance (projects.ts:132–139) and tenant seat entitlements are enforced server-side. Tenant grants require verified receipts. Client-generated local exports are not a server-side paid endpoint; product feature promises should be aligned with actual gates. |
| IDOR | No cross-user object access bypass identified in inspected project/artifact/job/secret/payment/session routes. Access decisions use authenticated users and project/owner scoping, not just knowledge of an ID. Public-share tokens are intentional scoped grants with expiry/revocation. |
| BOLA | No cross-tenant bypass identified in inspected organization/membership/project/native/render paths. Organization membership supersedes legacy invitations/ownership, and organization binding revokes public shares. F08 concerns already cached local content, not a network BOLA bypass. |
| Trust in user-controlled API input | Zod schemas, bounded values and parameterized SQL are present. F02/F06/F07 show limits that do not bound actual processing cost. No arbitrary command execution or prototype-pollution bypass was established. Native adapters spawn fixed executables with shell disabled and resource limits. |
| Sensitive information in logs | F09. General exception/provider-error logging deserves redaction review; this audit does not assume every logged error contains credentials. No real logs or production secrets were collected. |
| Exposed source maps | client/vite.config.ts:19 disables sourcemaps; the inspected current client build contains no .map files/embedded source-map data. Source/test/env files are not in the static root. CDN/deployment artifacts were not inspected. |

## Original audit validation and limitations

- `npm run test -w server`: **34 passed, 0 failed**, using isolated temporary databases and demo providers. Initial sandbox loopback denials were rerun with approved escalation. These tests verify existing behavior; they do not remediate or comprehensively exercise the new findings.
- Bounded synthetic parser, archive, lock-helper, session/TOTP, production mail and demo-billing checks described above. No high-volume traffic, process-crash payload, real emails, payments, paid AI calls or real customer-data access.
- Installed dependency inventory plus `npm audit --json` and independent primary maintainer advisories. The zero-result npm audit must not override F01.
- Live production/staging topology, TLS/firewall/CDN configuration, provider dashboards, real secret strength/rotation, database/log permissions and actual Linux native-worker isolation remain unverified. No findings here certify those external systems.
- Tenant billing implements prepaid finite terms. Automatic refund/dispute revocation, recurring subscriptions and reconciliation are unsupported; do not infer those lifecycle protections from the verified checkout controls.

The original recommended patch order has been completed in code. Use the current
remediation table and [release instructions](RELEASE.md)
for the corrected behavior and remaining owner-controlled deployment validation.
