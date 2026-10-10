# Comparison with the six-finding pre-fix audit

Date: 2026-10-10. Scope: the integrated `codex/secure-nexus-hardening` working tree, combining local UI/security snapshot `e90f97a` with Secure Nexus main `130d575`. Numbered findings were rechecked against the integrated source. Historical report line numbers have shifted. Production infrastructure and a live deployment were not inspected.

**Result: items 2, 3 and 4 are fixed; item 5 describes an intentional collaboration permission; items 1 and 6 remain.** This is not a declaration that every security issue is fixed. Additional findings in the [extended review](<SECURITY-REVIEW-EXTENDED.md>) and [authentication and trust review](<SECURITY-REVIEW-AUTH-TRUST.md>) remain unpatched in the integrated source.

The integration preserves newer remote modeling, 3D atmosphere, Google Earth, parking, backup and admin features while retaining the local authentication, resource and browser-storage protections. It is uploaded as a review branch; the repository main branch is not replaced.

## Six-item comparison

| Item | Finding in the supplied report | Integrated result | Evidence |
| --- | --- | --- | --- |
| 1 | Locked-account password oracle and CPU DoS | **Remains: confirmed password oracle; conditional availability risk.** | [auth.ts:513](<../server/src/routes/auth.ts#L513>) verifies the password before the lock check at line 535. [crypto.ts:41](<../server/src/crypto.ts#L41>) executes synchronous scrypt. |
| 2 | PNG signature typo | **Fixed.** | [projects.ts:57](<../server/src/routes/projects.ts#L57>) checks `89 50 4E 47`, including the correct fourth byte `0x47`. |
| 3 | Missing TOTP attempt limits | **Fixed.** | [auth.ts:119](<../server/src/routes/auth.ts#L119>) enforces the persistent account lock; lines 122 and 142 enforce the challenge limit. Limits are five failures and a 15-minute account lock. |
| 4 | TOTP timestep replay | **Fixed in authentication.** | [auth.ts:136](<../server/src/routes/auth.ts#L136>) rejects a step at or before the last consumed step; line 150 records successful consumption inside the transaction. |
| 5 | Viewers can create comments/issues | **Intentional permission; policy now documented.** | [collaboration.ts:138](<../server/src/routes/collaboration.ts#L138>) permits authorized project readers to create items. [Line 152](<../server/src/routes/collaboration.ts#L152>) requires project write permission to change item status. |
| 6 | Nonconstant CSRF and email-OTP comparisons | **Remains as low-priority hardening; no practical timing exploit demonstrated.** | CSRF uses string equality at [security.ts:214](<../server/src/security.ts#L214>) and line 217. Email-code hashes use `Buffer.equals` at [auth.ts:321](<../server/src/routes/auth.ts#L321>) and line 465. |

### 1 — locked-account password validation remains observable

An isolated proof invoked the real login handler with a synthetic locked account and instrumented the actual scrypt function. A wrong password returned 401; the correct password returned 423. Each request executed one scrypt call, and neither created a session. An attacker can therefore distinguish a valid password candidate while the account is locked. This does not bypass the lock or enrolled MFA.

Synchronous scrypt also occupies the application's event loop even for an already locked account. The existing global limit of 300 requests per IP per 15 minutes reduces available traffic; it does not make the account lock skip password computation. No load, crash or CPU-exhaustion attack was performed. Calling the availability impact universally High would overstate the evidence and ignore deployment capacity and distributed traffic prerequisites.

Correction remains outstanding: return a consistent locked response before password verification and avoid changing lock state for password guesses during an active lock. Verify identical locked responses and zero scrypt calls for both correct and incorrect candidates.

### 2 — the reported PNG typo is corrected

The PNG fourth-byte check now requires `0x47` (`G`), rather than the reported second `N`. The existing [photo upload/read regression](<../server/test/api.test.ts#L462>) accepts a valid PNG and returns it as `image/png`; the [bounded-parser regression](<../server/test/upload-design-security.test.ts#L56>) also preserves valid uploads while rejecting extra fields. This fixes the specific signature typo, not every possible image-decoding or upload issue. The separately reported upload revocation boundary remains outstanding.

### 3 and 4 — attempt limits and atomic timestep consumption are present

The shared TOTP verification path persists failures and locks on the account, counts failures on each pending challenge, closes an exhausted challenge, checks credential epochs, and records successful timestep consumption before upgrading authorization. A fresh password-derived challenge cannot reset the account budget. The same consumed timestep cannot upgrade another challenge. The transaction uses SQLite `BEGIN IMMEDIATE` through [db.ts:604](<../server/src/db.ts#L604>).

The one-step clock-skew allowance remains deliberate. Accepting a nearby valid step does not permit repeated consumption. The exported stateless `verifyTotp` helper remains available, but the current authentication routes use `matchingTotpStep` together with the persistent replay guard.

Existing regressions cover [account limits across new challenges and cooldown](<../server/test/auth-security.test.ts#L144>), [five-failure challenge closure](<../server/test/auth-security.test.ts#L161>), and [simultaneous single-use verification and cookie rotation](<../server/test/auth-security.test.ts#L171>). Adding an IP-only strict limiter is not required to claim the missing account/challenge controls are corrected.

### 5 — viewers may discuss a project without changing its design

Authenticated project owners, editors and viewers may subscribe to project SSE and create comments/issues. Project owners and editors may change item status and design data; a viewer cannot resolve their own or another person's item. Organization roles map to project permissions, and the existing tenant entitlement checks still apply to design/status writes. Public share tokens remain read-only capabilities and grant no collaboration membership.

An isolated role fixture confirmed viewer item creation returned 201, viewer status modification returned 403, and a caller outside the project received 404. The README collaboration paragraph now describes this permission explicitly. The separate delayed SSE revocation finding is not resolved by documenting the role policy.

### 6 — timing hardening is incomplete

Password verification already uses `timingSafeEqual` at [crypto.ts:47](<../server/src/crypto.ts#L47>), and TOTP comparisons use it at [totp.ts:69](<../server/src/totp.ts#L69>). CSRF and email-code comparisons have not been converted.

The email-code comparison operates on a SHA-256 digest, so it does not provide an incremental OTP digit-prefix oracle. Five-attempt email-code limits and network noise further constrain a practical attack. No remote timing recovery was demonstrated. A shared comparison helper using matched buffer lengths and `timingSafeEqual` would address this remaining hardening item while preserving the stricter session-bound CSRF check.

## Remote snapshot and integration boundaries

Read-only inspection of `origin/main` at `130d5752d9908ed265f9c13bdbdd6b002933a9a7` found that its password verification still precedes lock checking (`auth.ts:438` and line 460); its MFA route uses stateless `verifyTotp` without the local account/challenge budgets or consumed-step fields (`auth.ts:518`); and its email-OTP and CSRF comparisons remain nonconstant (`auth.ts:246`, line 390 and `security.ts:189`). That remote code was not executed or subjected to the local regression suite.

The integration preserves the local encrypted MFA seeds, credential epochs, persistent TOTP budgets, atomic consumption, rotated upgraded session tokens and strict session-bound CSRF comparison. The inspected remote security commit also contains protections retained in the integration: production suppression of developer OTP responses, completed authentication for account changes, refusal to turn repeat email verification into a login, and the mail diagnostic's restriction of arbitrary recipients to configured administrators. None of these observations certifies other remote routes or a deployed service.

## Validation and remaining scope

The original local snapshot passed 63 server tests and 23 browser security tests. The final integrated tree passed **74 server tests and 23 browser security tests**, plus lint/typechecking and both production builds. A fresh `npm audit --json` reported zero advisories across production and development dependencies. The 13 authentication security regressions are included in the server total. Six new [production admin/mail regressions](../server/test/integration-admin-security.test.ts) verify authenticated admin-only backups, actual forced mail recipients, admin-selected recipients, unavailable delivery, sanitized provider failures and suppression of production developer OTPs using an isolated database and stub SMTP transport. The additional locked-account and role checks used isolated synthetic data and real route handlers; they were not added as permanent tests. No real account, mail/payment/identity provider or production database was used by these comparison proofs.

This comparison and the README policy correction change documentation only. The uploaded integration also retains the earlier code patches, resolves source conflicts and makes development demo seeding explicit with an operator-supplied password. Items 1 and 6 remain unpatched, as do the newer findings linked above. Passing tests verifies the covered behavior and is not proof that the application has no remaining vulnerabilities.
