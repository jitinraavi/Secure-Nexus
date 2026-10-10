# Additional security review

Historical review of local snapshot `e90f97a`; source line positions may differ in the merged branch. See [the current six-item comparison](SECURITY-AUDIT-COMPARISON.md) for integration status and current validation.

Date: 2026-10-10. Scope: the current local repository, including uncommitted changes and the previous security patches. This review covers the additional categories requested by the user. It does not replace the historical findings and remediation record in [SECURITY-AUDIT.md](<SECURITY-AUDIT.md>).

The subsequent [authentication and trust review](<SECURITY-REVIEW-AUTH-TRUST.md>) records four additional issues involving registration, in-flight upload revocation, payment resource limits and stored email codes, plus the MFA/phishing/session policy assessment.

**Result: seven remaining findings — six Medium and one Low.** Three depend on a configured native worker, an insecure provider URL, or restoring an older database. Operational and review-process gaps are listed separately. Product code and dependencies were not changed during this review.

## Findings

| ID | Severity | Finding | Required condition |
| --- | --- | --- | --- |
| E01 | Medium | Optional DWG conversion requires a LibreDWG version affected by a published denial-of-service advisory. | Configured Linux native worker; authenticated project editor submits crafted DWG. |
| E02 | Medium | BIM CSV export preserves formula-like entity names as spreadsheet formulas. | Untrusted/imported/AI-proposed name; user exports and opens CSV in a formula-evaluating spreadsheet. |
| E03 | Low | Removed collaboration recipients still receive immediate activity/presence metadata until the next authorization poll. | Existing SSE subscription followed by membership removal or session revocation. |
| E04 | Medium | Private render prompts and parameters remain plaintext in SQLite, and prompts are copied into tenant audit details. | Read access to database or a database backup without the application encryption key. |
| E05 | Medium | Personal audit-write failures are silently discarded. | Audit storage/insert failure during an otherwise permitted operation. |
| E06 | Medium | Production accepts an HTTP AI endpoint and would send the bearer key and project context over it. | Operator configures a non-TLS `AI_BASE_URL`; network observer can see that connection. |
| E07 | Medium | The documented database restore can resurrect revoked sessions and does not cover a relocated database. | Operator restores an older snapshot; a revoked but unexpired token is retained, or `DB_PATH` is outside the backed-up directory. |

### E01 — vulnerable native dependency is enforced by the adapter

[nativeAdapters.ts:40](<../server/src/nativeAdapters.ts#L40>) pins LibreDWG to `0.13.4`. Capability checks and the actual binary version check at [nativeAdapters.ts:295](<../server/src/nativeAdapters.ts#L295>) reject other versions. DWG submission validates the six-byte header at [nativeAdapters.ts:96](<../server/src/nativeAdapters.ts#L96>), then the configured converter parses the file.

The maintainer's [GHSA-gp83-hcvh-g255 / CVE-2026-62254 advisory](https://github.com/LibreDWG/libredwg/security/advisories/GHSA-gp83-hcvh-g255) identifies versions below `0.14` as affected by crafted R13–R2000 drawings that cause excessive parser work; it names `0.14` as the fix for that advisory. The enforced version falls in that range.

The adapter already uses a distinct Linux UID/GID, resource limits, timeouts and bounded job admission. These reduce impact to worker/queue availability; they do not patch the parser. This Windows workspace and an unconfigured native worker do not execute this path. No malformed native file or native executable was run during the review.

Correction: disable this conversion until a vetted patched release is integrated; update the version contract, capability tests and deployment instructions together. Check current upstream advisories before selecting the release.

### E02 — spreadsheet formula injection in BIM schedule export

[bim.ts:731](<../client/src/lib/bim.ts#L731>) escapes CSV quotes but does not neutralize formula prefixes. [bim.ts:736](<../client/src/lib/bim.ts#L736>) uses this function for entity IDs, names and other fields. The BIM archive export includes this CSV at [Editor.tsx:450](<../client/src/pages/Editor.tsx#L450>).

A safe pure-module proof passed a typed AI `update_tower` action with `label: "=1+1"`. The action passed preview/apply validation, and the exporter produced a literal quoted `"=1+1"` name cell. Imported or collaborator-controlled names can reach the same sink. No spreadsheet, external formula or provider was invoked.

Quoting CSV syntax does not force spreadsheet text interpretation. Formula evaluation and possible impact depend on the spreadsheet and its protections; this review does not demonstrate operating-system code execution. See [OWASP's CSV injection guidance](https://community.owasp.org/attacks/CSV_Injection).

Correction: share a tested spreadsheet-safe text-cell export policy across every CSV exporter, and consider typed text cells in an XLSX export for human viewing. Test the intended spreadsheet workflow, including re-saving; a universal CSV escaping guarantee would be inaccurate.

### E03 — delayed revocation for direct collaboration broadcasts

[collaboration.ts:60](<../server/src/collaboration.ts#L60>) broadcasts to retained response objects without rechecking the recipient's current membership or session. Both immediate collaboration and presence updates use it. [routes/collaboration.ts:88](<../server/src/routes/collaboration.ts#L88>) checks those permissions in a two-second replay poll and then closes the stream.

An isolated synthetic tenant proof subscribed a viewer, removed their membership, verified `getProjectAccess` returned null, then emitted an event and subscribed the owner. The removed viewer still received the event type, actor ID, revision and presence metadata. The event's private body was not broadcast. This is a narrow metadata leak until the next poll; event-loop stalls can extend the window. Other tenant CRUD checks were not bypassed.

Correction: associate authenticated session information with each subscription and recheck permission immediately before every outbound frame; close affected streams when membership/session changes are committed.

### E04 — render content bypasses the application's at-rest encryption

[db.ts:428](<../server/src/db.ts#L428>) defines ordinary text fields for render prompts, negative prompts and parameters. [renderJobs.ts:354](<../server/src/renderJobs.ts#L354>) writes the input values directly. [renderJobs.ts:375](<../server/src/renderJobs.ts#L375>) also copies the prompt into tenant audit details, which [organization.ts:45](<../server/src/organization.ts#L45>) stores as plaintext JSON.

An isolated fixture with an explicitly unconfigured render provider submitted synthetic marker values and read them directly from the raw job row and tenant audit row. No provider was called. A database reader can therefore see private prompt content without the key needed for encrypted designs and source/output artifacts. This does not establish a remotely accessible database.

Correction: encrypt private prompt/parameter content with a job/project-bound authenticated encryption format and transactional migration. Keep audit entries to identifiers, outcome and minimal metadata rather than copying the prompt. Profile/contact and other database metadata also remain plaintext; application payload encryption is not whole-database encryption.

### E05 — audit failure is invisible and assistant requests lack individual audit events

[audit.ts:26](<../server/src/audit.ts#L26>) catches all insert failures without reporting failure, emitting a sanitized alert, or returning a status. Callers such as [secrets.ts:89](<../server/src/routes/secrets.ts#L89>) continue returning decrypted data afterward.

An isolated SQLite fixture installed a trigger that rejects only audit inserts. Calling the real `logAudit` returned normally, produced zero events, and emitted zero warning/error messages. Thus an audit failure can persist without appearing in the application's error monitoring. Authentication, secret access, project activity and organization audit records do exist; the issue is incomplete reliability rather than a wholly missing log system.

The assistant route at [assistant.ts:80](<../server/src/routes/assistant.ts#L80>) does not emit individual request/denial/outcome audit events. Daily usage counters and temporary permits are not a durable request-by-request incident trail.

Correction: report sanitized audit failures to an independent restricted monitoring sink, expose operational audit health, and define transactional/fail-closed behavior for actions that require a reliable security event. Add privacy-preserving assistant request/outcome records; do not log provider keys or complete prompts.

### E06 — production AI transport can be unencrypted

[config.ts:48](<../server/src/config.ts#L48>) accepts `AI_BASE_URL` without validating its protocol. [assistant.ts:108](<../server/src/routes/assistant.ts#L108>) uses it for a provider fetch that includes a bearer API key and the caller's project context.

An isolated production configuration test successfully loaded `http://provider.example.invalid/v1` as the endpoint. It made no network request and used a synthetic key. The default endpoint is HTTPS; exploitation requires an insecure operator setting and access to that network connection. Browser CORS and CSP do not protect this server-to-provider hop. This is not a user-controlled SSRF endpoint.

Correction: validate a fixed HTTPS provider URL in production, reject URL credentials and malformed bases, and disable redirects unless deliberately validated. Any development HTTP allowance should be explicit and confined to a trusted local provider.

### E07 — restore procedure reintroduces old authentication state

[RELEASE.md:131](<RELEASE.md#L131>) instructs replacing the data directory and restarting with the matching master key. It does not invalidate restored live sessions/challenges. Session validity at [security.ts:134](<../server/src/security.ts#L134>) relies on session status, expiry and the credential version in the same database snapshot.

An isolated SQLite proof verified a synthetic session before a snapshot, rejected it after revocation and a credential-version change, then accepted it again after restoring the older database in a fresh process. Explicit post-restore session invalidation rejected it again. The token/key remained private to the fixture; no real account or backup was touched. This needs an actual restore and possession of the old unexpired token, not merely access to a public endpoint.

The backup instructions also cover only `GROUNDWORK_DATA_DIR`, while [config.ts:59](<../server/src/config.ts#L59>) allows `DB_PATH` to move the database to another directory. Such a backup can omit the database. This is a source-derived configuration case, not an assertion about the live hosting configuration.

Correction: define a stopped-service restore procedure that invalidates all restored active/pending sessions and outstanding login/SSO challenges before accepting traffic. Review credential and MFA changes made since the snapshot, because they are also rolled back. Cover the resolved database location and sidecars, preserve the matching encryption key separately, and verify restore and forced reauthentication in an isolated environment.

## Coverage of all requested categories

| Category | Review result |
| --- | --- |
| Malicious packages | No evidence found in the reviewed manifests, lockfile sources and application entrypoints. All 352 remote lockfile entries use the npm registry and include integrity values. The recorded install-script packages are esbuild and optional fsevents. Integrity/source metadata does not establish that every transitive package is benign; a full malware/provenance investigation was not performed. |
| Vulnerable dependencies | Fresh full `npm audit --json`, including development dependencies, reported zero registry findings. E01 is a separately configured native dependency outside that scan. |
| Missing third-party libraries | `npm ls --all --json` completed successfully with no reported dependency problems. REST calls implemented with native fetch do not need an SDK. Native capabilities fail unavailable when their optional runtime is absent. |
| Prompt injection | The model receives untrusted caller text/context and can be steered within its allowed proposal schema. There are no model tools, autonomous server project reads or executable-code actions in this assistant path. Strict typed actions and explicit apply contain that boundary; E02 demonstrates a downstream unsafe export sink. See the AI review limitations below. |
| Unpermissioned AI access | Assistant requests require an active session and global CSRF protection, with persistent budgets. The client explicitly requests a plan and supplies its current context. No anonymous AI dispatch or cross-tenant server read was found. There is no per-tenant AI disable/provider-consent policy in the reviewed flow; whether that is required depends on the product's data policy. |
| Excessive database permissions | SQLite is an embedded file database used by the authority, not a remote service with SQL account grants. The authority necessarily reads/writes its schema. Production service identity, DB/key file ACLs, disk encryption and hosting privileges were not inspected. Separate native UID/GID and protected executable checks exist but operator confinement must be verified in deployment. |
| Missing audit logs | Authentication, vault, project, billing and organization events exist. E05 identifies silent audit loss and absent individual assistant audit events. |
| Security monitoring | Health checks and audit screens exist; no security alert exporter, centralized monitoring integration or backup-age alert was found in repository configuration. External hosting/SIEM monitoring may exist and cannot be inferred from this repository. |
| Backup | Manual consistent backup/key/restore guidance exists. E07 identifies unsafe authentication restoration and alternate database-path coverage. No automated backup schedule or restore drill is implemented in the repository; provider-managed backups were not inspected. |
| Exposed internal dashboards | Personal audit queries are scoped to the caller; organization audit/billing/admin routes check membership and roles. No unauthenticated internal data dashboard route was found. Provider administration/staging dashboards are outside this review. |
| Missing security headers | Both authority and secondary gateway configure Helmet, CSP, framing restrictions, no-sniff and referrer protections. This is code coverage; live TLS/proxy header behavior was not tested. |
| Insecure CORS | No wildcard or reflected credentialed CORS configuration was found. The app uses same-origin requests; gateway mutations also enforce the configured origin. Hosting/proxy-added headers were not inspected. |
| Unencrypted sensitive data | Designs, snapshots, artifacts, vault values, MFA seeds and SSO secrets have authenticated encryption paths. E04 identifies plaintext render content and audit duplication; E06 covers provider transport. Profile/metadata and deliberately retained browser recovery copies are plaintext. |
| Poor tenant isolation | Role-scoped project/workspace/organization CRUD and artifact lookups were traced without a broad tenant bypass. E03 is the confirmed narrow collaboration revocation exception. |
| Unreviewed AI code | AI returns data proposals rather than generated executable code. Application source has CI type/build/test checks, but repository-host approval requirements and human review history cannot be established from local files. The AI proposal preview is incomplete, as described below. |
| SQL injection | No user-controlled SQL value interpolation was found in the traced routes. Values use bound parameters; interpolated filter clauses, update fields, table choices and migration/savepoint names are constructed from server-owned constants or validated internal state. This is not a claim of exhaustive formal verification. |
| Insecure deserialization | No executable object deserializer, eval or new Function sink was found in the reviewed server/client source. JSON/schema checks, bounded BCF inflation and DTD/entity rejection exist. Native DWG parsing remains exposed to E01 when enabled. |

## Operational and AI review limitations

- **AI change review:** [assistant.ts:54](<../client/src/lib/assistant.ts#L54>) labels a tower patch only as `Update tower <id>`. The panel at [DesignAssistantPanel.tsx:75](<../client/src/components/DesignAssistantPanel.tsx#L75>) displays that label before applying the full patch. The safe E02 proof also changed `floors` to 299 without showing either changed value in that preview. Display a field-by-field before/after diff; an AI-produced summary cannot substitute for showing the actual proposed changes. This is incomplete review visibility, not evidence of model code execution.
- **AI data scope:** Community and infrastructure requests include the current design object at [CommunityEditor.tsx:289](<../client/src/pages/CommunityEditor.tsx#L289>) and [InfraEditor.tsx:225](<../client/src/pages/InfraEditor.tsx#L225>). Explain the configured external provider and data scope, minimize unnecessary context, and enforce tenant policy if the product promises owner-controlled external AI access.
- **Supply-chain/review controls:** CI audits production dependencies only and uses major-version action tags. The current full scan found no npm advisories, but dev dependencies/native binaries also warrant ongoing review. Local files do not establish protected branches, required human/security approval, signed-release provenance or a deployment SBOM. No malicious package is asserted from those absences. npm documents advisory scanning and signature/provenance verification as separate operations in its [audit documentation](https://docs.npmjs.com/cli/v11/commands/npm-audit/).
- **Deployment evidence:** Service privileges, native worker network isolation, encrypted disks/backups, monitoring alerts, backup schedules, restore drills and private hosting dashboards require operator-controlled deployment verification. Their absence in repository code does not prove they are absent from the hosting platform.

## Validation performed

- Read-only tracing of manifests/lockfile/CI, authentication and authorization, SQL construction, audit callers, encryption, provider dispatch, native execution, imports/exports and release instructions.
- Fresh full npm advisory scan: zero findings. Dependency-tree check: exit 0 with no dependency problems. Lockfile source/integrity/install-script metadata inspection.
- Current primary-source verification of the LibreDWG advisory and CSV spreadsheet interpretation.
- Isolated proofs for plaintext render records/audit copies; silently rejected audit writes; production acceptance of HTTP AI configuration; removed-recipient activity/presence broadcasts; revoked-session resurrection after database restore; and harmless CSV formula export from a typed AI action.
- All proof data was synthetic. No paid provider, real email, payment, native binary, spreadsheet formula, production database or real browser deletion was used. Disposable fixture directories were removed after closing their databases.
- Product code, dependencies and deployed configuration were not modified. The prior 63 server and 23 frontend passing regressions remain recorded in the earlier audit; they were not represented as new runs of this read-only review.

## Suggested correction order

1. Disable or update the vulnerable native converter; enforce secure AI provider transport.
2. Neutralize spreadsheet formula sinks and improve the actual AI change preview.
3. Encrypt render content and remove private prompts from audit details.
4. Recheck every collaboration recipient at send time and expose audit failures to monitoring.
5. Correct and exercise backup/restore, including forced reauthentication and resolved database location.
6. Verify deployment monitoring, backup schedules, isolation and repository approval controls with the operator.
