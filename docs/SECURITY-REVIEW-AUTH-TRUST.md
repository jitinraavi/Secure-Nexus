# Authentication, trust and real-time security review

Historical review of local snapshot `e90f97a`; source line positions may differ in the merged branch. See [the current six-item comparison](SECURITY-AUDIT-COMPARISON.md) for integration status and current validation.

Date: 2026-10-10. Scope: current local source, including previous patches and uncommitted changes. This completes the requested review of MFA, registration/recovery, replay attacks, phishing/vishing, vendor requests, AI/chat privacy, timeouts and real-time authorization. The user clarified that the other transcribed terms may be typos and will supply them later.

**Result: four additional issues — one High and three Medium.** MFA/SSO policy and operational gaps are separated from demonstrated bugs. Product code and dependencies were not changed in this audit. The seven findings in [the earlier extended review](<SECURITY-REVIEW-EXTENDED.md>) also remain outstanding.

## Confirmed issues

| ID | Severity | Finding | Prerequisite |
| --- | --- | --- | --- |
| A01 | High | An attacker-created registration password survives the email owner's account activation. | Attacker registers an unused victim email first; owner later claims the account by email code, without replacing the password or enrolling MFA before attacker access. |
| A02 | Medium | A project photo upload can commit after its session has been revoked. | Request passes initial authentication, then that session is revoked while multipart reception is pending; project write membership remains. |
| A03 | Medium | Payment provider calls lack complete deadline, response-size and concurrency limits. | Configured live payments and a stalled or oversized vendor response; requests remain pending or consume excess resources. |
| A04 | Medium | A database reader can recover live six-digit email codes offline from their stored hashes. | Read access to a current database or sufficiently recent snapshot containing an unexpired code; account has MFA disabled. |

### A01 — registration pre-hijacking

[auth.ts:239](<../server/src/routes/auth.ts#L239>) stores the submitted password on an unverified account before proving ownership of its email address. A later signup for the same email returns 409. Both [email verification at line 328](<../server/src/routes/auth.ts#L328>) and [email-code login at line 465](<../server/src/routes/auth.ts#L465>) set email verification without replacing that original password. Password login then accepts it.

An isolated proof invoked the actual authentication route handlers with synthetic accounts and a temporary database:

1. Attacker registers an unused synthetic email with a chosen password: 201, no active session.
2. Email owner attempts signup with a different password: 409; original password remains.
3. After the resend cooldown, owner requests and enters a fresh email login code: 200, verified account and active session.
4. Attacker signs in with the original password: 200; authenticated /me returns the same account ID.
5. The stored password hash is unchanged. Reusing the consumed email code returns 400.

The attacker does not need the victim's email code: the owner performs the legitimate code step. Subsequent private projects, organization permissions and vault access belong to the same account that the attacker can access. Enabling MFA before attacker access would restrict the attack, but is optional.

[Password replacement at auth.ts:802](<../server/src/routes/auth.ts#L802>) also requires the existing password. A separate synthetic fixture confirmed that an email-authenticated owner who does not know the original password receives 400. No dedicated forgot/reset-password route was found. Email-code sign-in is not a safe password replacement mechanism in this scenario.

This is High severity because it permits persistent account access. Calling it universally Critical would overstate the prerequisites: it requires pre-registration and the owner's later account activation, and does not overwrite an already verified account's password.

Correction: bind pending registration to the initiating browser/registration challenge, and establish the password only after proving email ownership. A separate email-owner claim of an existing unverified registration must discard its untrusted password/profile and establish fresh credentials through a restricted completion flow. Invalidate all old sessions, OTPs and credential state atomically. Expire abandoned registrations. Add a purpose-bound, short-lived password recovery flow that revokes other sessions and preserves any enrolled MFA requirements. Test both normal same-browser signup and a different browser claiming a pre-registered email.

### A02 — photo upload commits after session revocation

[projects.ts:24](<../server/src/routes/projects.ts#L24>) authenticates and retains the caller before upload parsing. The photo route checks write membership before parsing and again in its final handler at [projects.ts:527](<../server/src/routes/projects.ts#L527>), but does not re-resolve the session after parsing. The retained caller can therefore write the encrypted file and replace the project photo after their session becomes invalid.

An isolated real-middleware/handler fixture passed initial authentication, simulated multipart completion across the revocation boundary, revoked the session and confirmed resolveSession returned null. The final handler still returned 200 and persisted the new photo. This was a route-boundary simulation, not a live slow-upload or network attack.

This is a narrow stale-authorization write, not a broad tenant bypass. The shared upload parser already enforces file/body/part limits, concurrency and a 90-second deadline. Fresh requests with the revoked token fail authentication, and removed project membership is rechecked.

Correction: inside the final commit transaction, resolve the same session again, require active status and current credential epoch, and recheck project write access before storing/replacing the photo. Review other asynchronous mutation paths for the same boundary. Test revocation, password changes, MFA changes and membership removal while upload reception is pending.

### A03 — payment vendor responses are insufficiently bounded

Personal Razorpay creation at [providers.ts:86](<../server/src/payments/providers.ts#L86>) and personal PayPal authentication/order creation at [providers.ts:131](<../server/src/payments/providers.ts#L131>) omit an application deadline/AbortSignal. Their response.json calls consume the complete response without a byte cap.

Tenant Razorpay creation has a 20-second timeout, but [providers.ts:258](<../server/src/payments/providers.ts#L258>) still reads unrestricted JSON. PayPal capture/authentication also have 20-second signals, but their JSON reads at [payments.ts:281](<../server/src/routes/payments.ts#L281>) and line 304 lack byte limits. The payment calls do not use a per-provider concurrency reservation.

Safe local fetch stubs confirmed the missing personal-call signals and a stalled call remaining pending. Personal and tenant Razorpay accepted a modest 1,048,736-byte synthetic response despite an oversized declared Content-Length. No live vendor was contacted and no memory-exhaustion test was performed.

The URLs are fixed HTTPS vendor endpoints. This finding concerns availability during vendor failure or unexpected responses; it does not demonstrate user-controlled SSRF or attacker control of vendor response bodies. Runtime networking defaults do not supply the missing application-wide resource policy.

Correction: use a shared streamed JSON reader with an actual byte cap, one explicit total deadline covering each operation, disconnect cancellation and bounded pending requests. Preserve durable uncertain-payment state and receipt validation when introducing cancellation; a timeout is not proof that the vendor created no order.

### A04 — low-entropy email code hashes permit offline recovery

[auth.ts:54](<../server/src/routes/auth.ts#L54>) stores SHA-256 of the public database user ID plus a six-digit code. The verifier uses the same construction at [auth.ts:454](<../server/src/routes/auth.ts#L454>). The code has only one million possible values, and the hash does not depend on a secret outside the database.

An isolated synthetic fixture recovered a live code using only its database user ID and stored hash. That particular random code took 490 ms to recover on this host; this is a measured fixture result, not a universal timing guarantee. The recovered code was accepted by the real passwordless login handler with 200, within the 600-second lifetime. The proof did not use a development-disclosed code as the attack input, contact a provider or access real data.

Online attempt limits do not slow an offline search. A database-only reader could use this route to obtain application access to an MFA-disabled account, even though session tokens and encrypted vault contents are not directly recoverable from the database. Enrolled TOTP still requires its separate code. No public database exposure was established by this review.

Correction: authenticate each code with a server-held, domain-separated key, binding the account, purpose, challenge and expiry. Support key rotation and consume challenges atomically. Retain expiry, attempt limits and enrolled MFA enforcement. Do not put the verification key in the same database/backup, and do not log codes. Test that a database-only fixture cannot verify candidate codes without the server-held key.

## Coverage and policy gaps

| Requested area | Result |
| --- | --- |
| MFA missing or bypassed | TOTP is implemented. Password, email-code and SSO login enforce it when enrolled, and pending sessions cannot use protected APIs. An MFA-disabled owner can still change organization settings; mandatory privileged MFA is absent. This is a policy gap, not a bypass of an enabled factor. |
| Registration/recovery | A01 is a confirmed High issue. Accounts require email ownership verification before ordinary password login. Email-code login retains the old password, and password replacement requires knowing it. |
| OTP replay | Consumed email code replay returned 400. The existing auth suite verifies TOTP step single-use across simultaneous challenges and pending-cookie rotation. A fresh intercepted code can still be relayed before the owner consumes it. |
| SSO replay and identity trust | Isolated signed-RSA provider stubs verified enrolled MFA enforcement, pending-session denial, callback replay 400, nonce mismatch 401 and unbound subject 401. State is browser-bound, expires after five minutes and is consumed atomically. PKCE, signatures, issuer/audience/time/nonce validation, explicit subject binding and configuration revision checks are present. No email-based identity auto-link was found. |
| Mandatory SSO | Organization SSO is optional; local login remains available. Mandatory SSO and provider assurance-level policy are not implemented. The repository documents mandatory SSO as a deployment extension; enabling a provider alone should not be represented as enforcing it. |
| Payment/webhook replay | Invalid signatures returned 401; a valid event created one receipt; replay did not renew an expired plan; moving the same receipt to another payment returned 409. Transactional receipt validation remains effective. A03 concerns resource bounds, not payment entitlement bypass. |
| Phishing and real-time relay | Passwords, email codes and TOTP can be phished. Single-use validation blocks reuse after consumption, but cannot stop an impostor from relaying a fresh code first. No WebAuthn/passkey flow was found in Groundwork. Consider phishing-resistant authentication for privileged accounts; do not describe the existing OTP flow as phishing-resistant. |
| Voice phishing/support trust | No telephone/voice authentication or in-repo support-reset endpoint was found. Settings advises contacting support after device loss, but provides no auditable support identity-verification procedure. Actual support handling, recovery approvals and impersonation resistance require operational review; no support bypass was demonstrated. |
| Session inactivity | Sessions have a seven-day absolute expiry and no inactivity check. A synthetic session last seen 48 hours earlier still returned /me 200. Pending MFA expires after five minutes. An idle timeout and fresh authentication for sensitive operations are policy hardening, not evidence that revocation is generally broken. A02 is the confirmed upload exception. |
| Vendor request timeouts | Assistant defaults to 30 seconds, render generation to 120 seconds, SSO JSON to eight seconds per fetch, uploads to 90 seconds. Resend has a 20-second timeout; SMTP connection/greeting/socket timeouts are 10/10/20 seconds. These are request/resource controls, separate from session inactivity. A03 identifies payment exceptions. |
| AI/chat sensitive information | Assistant requests require an active session, CSRF and server-side budgets. The browser submits current project context, including the design/infrastructure state, to the configured provider. This may include locations and review metadata. No anonymous dispatch, automatic cross-tenant project retrieval, model tool execution or voice-chat path was found. Provider disclosure/retention controls and tenant opt-out policy are absent. Earlier E04/E05/E06 cover plaintext render content, audit reliability and configurable non-TLS AI transport. |
| AI action trust | Typed proposals require explicit confirmation, but tower patches are previewed as generic labels rather than field changes. The earlier E02 proof shows a valid formula-like label can reach CSV export. Show before/after values and treat provider summaries as untrusted text. React text rendering and typed actions are useful boundaries; they do not make a model's proposal trustworthy. |
| Real-time collaboration | Earlier E03 remains: direct broadcasts can disclose activity/presence metadata until the next authorization poll, normally two seconds. No private design/comment body was demonstrated in that broadcast. Earlier E07 also remains: restoring an old authentication database can revive old unexpired tokens. |

The phishing distinction follows [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/): manually entered OTPs do not bind the response to the intended verifier. The broader registration failure class is studied in [Pre-hijacked accounts](https://arxiv.org/abs/2205.10174); the specific Groundwork finding above is supported by local source and isolated proof, not inferred from that paper.

## Action plan

1. Fix A01 before relying on public registration. Implement safe email-owner account claiming/password recovery and add regression coverage for different-browser activation.
2. Revalidate session and access at photo commit (A02); harden stored email challenges against database-only recovery (A04); complete payment request bounds (A03).
3. Address the seven earlier extended findings, especially provider TLS, native dependency exposure, private prompt storage, CSV export and reliable audit/restore behavior.
4. Define privileged MFA, inactivity/step-up authentication, mandatory SSO if required, AI disclosure/retention, support recovery verification and centralized security alerts. Phishing-resistant enrollment can be added when the user has an appropriate authenticator; it is not needed to complete the code audit or the above patches.

## Validation and limits

- The 13 existing authentication security tests passed with authorized localhost access. The first sandboxed run could not perform local HTTP requests; the rerun succeeded. These tests do not currently cover A01/A02/A04.
- Registration and offline OTP recovery proofs used actual auth handlers and synthetic temporary databases, without network calls. Fixtures were cleaned afterward.
- Photo revocation and MFA-disabled owner mutation were checked with actual middleware/handlers and isolated data; the upload reception boundary was simulated.
- SSO signing/nonce/subject checks and payment timeout/size/replay checks used local provider stubs. No real identity/payment provider was called, no charge was made and no real account was altered.
- No product edits were made, so build/lint and the unrelated full suite were not repeated. Dependency results remain documented in the preceding review; this turn does not claim a new package audit.
- Production proxy/TLS behavior, device authenticator availability, email-domain protections, provider retention, support procedures and deployed alerting remain unverified. No phishing campaign, voice call, credential interception or real-user attack was attempted.

OpenAI account passkey enrollment is separate from Groundwork's authentication code. It was not completed and no passkey/private-key file was created. The account's setup requirements could not be verified from an active browser session because the browser inventory contained no accessible tabs. Device enrollment can be completed separately by the user.
