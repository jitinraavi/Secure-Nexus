# Engineering implementation and verification record

This record maps the 111-topic audit dated 21 October 2026 to the engineering
changes implemented for Groundwork 1.1. It describes the source and verification
evidence available on 23 October 2026. It is not a claim that every operational
control is active or that the application is free of vulnerabilities.

The original audit at commit `fa71b3c7d824cc416f4b5b69ea6df050c99b54d3`
classified 25 topics as implemented, 51 as partial, 10 as missing and 25 as
conditional. The original report is historical evidence; its counts must not be
presented as a new audit of this release. Conditional architecture choices are
not requirements to add Kubernetes, replicas, additional regions or paid services.

## Verification boundary

- Local verification passed: TypeScript checks, production build, 150 server
  tests, 32 client tests, 8 studio tests, 2 mail-setup tests and 18 operational
  tooling tests. Production dependency audit reported zero known advisories.
- The additive `groundwork_engineering_v2` migration was applied to the existing
  Supabase project. The resulting private schema has 44 tables with RLS enabled;
  the catalog check found no uncovered foreign keys, and the security advisor
  returned no lints. These checks do not replace application authorization tests.
- PostgreSQL-compatible API coverage uses PGlite locally. It does not simulate
  multiple hosted PostgreSQL connections, Vercel instances or regional latency.
- Groundwork 1.1.1 at `00d285bdf7772bd45ded63bd2366446adc0d9989` passed
  [main CI 39960744109](https://github.com/jitinraavi/Secure-Nexus/actions/runs/39960744109),
  including the native PostgreSQL 17 synthetic backup/restore drill. Vercel
  deployment `dpl_DQ5dyGpQcnJgGJMnTvtPFxrnR9Ad` reached READY with that exact SHA.
  A disposable production smoke account passed login, versioned session,
  encrypted save/reload, stale-write rejection, snapshot restore, geometry
  upload, SSE disconnect cleanup and logout/session revocation. Cleanup left
  no synthetic fixtures. These are release checks, not sustained capacity proof.
- Public external monitoring is activated. Both a scheduled health run and
  [manual run 39959697259](https://github.com/jitinraavi/Secure-Nexus/actions/runs/39959697259)
  completed successfully. Runtime operation tokens, the daily Vercel check and
  the owner's authorized SMTP alert route are configured. Inspect current run
  freshness; inbox delivery and an isolated outage/recovery drill remain separate
  verification requirements.
- The first private real-data backup/restore comparison exposed different
  floating-point serialization settings between hosted and local PostgreSQL.
  The 1.1.2 canonicalization correction is in progress. Private backup scheduling
  remains disabled until a new real archive, full restore comparison and artifact
  checks succeed; no successful real-data recovery drill is claimed here.
- Passing SMTP configuration tests does not prove that a message reaches an
  inbox. Synthetic backup tests do not prove that an actual production archive
  exists or can recover encrypted projects with separately preserved keys.

## Implemented mechanisms

| Area | Source and behavior | Verification |
| --- | --- | --- |
| Shared admission | `server/src/sharedRateLimit.ts` uses atomic database counters, HMAC identities and bounded expiry cleanup. IPv6 address normalization prevents privacy-address churn from creating a fresh budget. Database failure denies requests. | `server/test/runtime-protection.test.ts` |
| Outbound resilience | `outbound.ts`, `outboundCircuitStore.ts` and `runtimeResilience.ts` enforce approved HTTPS origins, reject redirects, bound response bytes/deadlines and share circuit state. Only explicitly safe operations retry, using capped jitter and Retry-After. | `outbound-resilience.test.ts`, `outbound-circuit-store.test.ts` |
| Browser recovery | `client/src/lib/requestResilience.ts`, `api.ts` and sync helpers bound request lifetimes, cancel full-body reads and stop unsafe replay of ambiguous writes. Unsynchronized edits remain available for explicit recovery. | `client/test/request-resilience.test.ts`, existing recovery tests |
| Concurrent editing | Project saves/restores require `baseRevision`; lock checks, mutation and revision increments are transactional. Conditional editor-lease acquisition allows one owner. Workspace artifact validation/insertion and presence access checks are batched. | `server/test/concurrency-engineering.test.ts`, PostgreSQL API flow |
| Streams | `server/src/sse.ts` bounds event and buffered bytes and closes slow streams for cursor-based replay. Subscription capacity is reserved in the shared database before headers; cleanup releases leases and timers. | Runtime protection tests and synthetic reconnect rehearsal |
| Encryption | `vaultCrypto.ts` supports previous-key decryption and compare-and-swap resealing. Render prompts and parameters are encrypted and audit records omit prompt bodies. | Vault rotation and render-input tests |
| Observability | `telemetry.ts` generates request IDs and W3C trace context with bounded database/provider spans. `operationalRuntime.ts` persists redacted route metrics and sampled traces; no query values, bodies, cookies, emails or raw SQL are recorded. | `server/test/operational-runtime.test.ts` |
| Operations | Bearer-protected `/api/ops` routes expose metrics/traces, checks, backup reports and revisioned flags. Flags have stable rollout buckets and audited updates; unsupported serverless workers remain disabled. | `server/test/runtime-routing-operations.test.ts` |
| Recovery and release | Encrypted offsite export/isolated restore tools, health/performance checks, exact-SHA CI checks and a post-CI deployment workflow are provided. Secrets remain separate from source. | 1.1.1 exact-source CI/deployment and native synthetic PostgreSQL drill passed; real-data comparison correction and rerun remain required |

The database migration and SQLite schema include shared rate windows, outbound
circuits, minute-level request histograms, bounded traces, operational state and
feature flags. Runtime roles retain restricted privileges; private-schema RLS
does not replace tenant and project access checks in the backend.

## All 111 topics

“Implemented” below means an applicable mechanism exists with the stated
verification. “Pending” identifies a remaining runtime, provider or measurement
requirement. “Retained” means an existing mechanism was preserved. “Conditional”
means no additional architecture is justified for the current demo.

| ID | Topic | Current disposition and evidence / remaining requirement |
| --- | --- | --- |
| 1 | Rate limiting | Implemented shared fixed-window counters, normalized pseudonymous identities and fail-closed behavior; account/challenge limits retained. |
| 2 | Caching | Retained versioned public shell, immutable assets and private API no-store policy. |
| 3 | Load balancing | Retained Vercel-managed distribution; production capacity remains unmeasured. |
| 4 | Reverse proxies | Retained exact API routing, trusted Vercel identity and development proxy. |
| 5 | API gateways | Implemented shared admission, tracing and centralized version alias at the existing API entry point. No separate gateway service is needed. |
| 6 | CI/CD | Implemented exact-SHA CI/readiness checks, disabled normal main Git auto-deploy and activated a CI-triggered deploy hook plus build guard. The 1.1.1 exact-source CI and production deployment passed; protected main requires the release gate. |
| 7 | Docker | Existing container recipe retained; a successful container build/runtime rehearsal remains pending before selecting that host. Docker is not required on Vercel. |
| 8 | Kubernetes | Conditional; current demo has no cluster requirement. |
| 9 | Service discovery | Conditional; configured service endpoints suffice. |
| 10 | Circuit breakers | Implemented shared, bounded circuit state with fenced half-open probes. Reset is an internal primitive; any future operator endpoint must enforce authorization. |
| 11 | Timeouts | Implemented bounded outbound/full-body browser deadlines and cancellation; stream lifetime remains separately bounded. |
| 12 | Retries | Implemented explicit safe-operation retry policies; side-effecting payment, auth and metered AI operations do not retry blindly. |
| 13 | Exponential backoff | Implemented capped jitter and Retry-After handling for safe provider requests and sync retries. |
| 14 | Idempotency | Retained operation/payment deduplication; ambiguous browser writes pause for recovery rather than blind replay. |
| 15 | Message queues | Durable operation/outbox code retained. Native/render submissions remain disabled on Vercel; a real durable worker must be provisioned and tested before enabling them. |
| 16 | Pub/Sub | Database event replay/polling works across function lifetimes; optional Redis transport is resilient but remains unprovisioned unless explicitly configured. |
| 17 | Event-driven architecture | Retained transactional events and after-commit fanout; redacted request/provider observations added. |
| 18 | Distributed transactions | Conditional; use database atomicity and provider reconciliation rather than two-phase commit. |
| 19 | Saga pattern | Conditional until an active multi-step provider workflow needs compensation. |
| 20 | Dead letter queues | Conditional alongside future active durable jobs; no separate queue service added. |
| 21 | Cron jobs | Configured authenticated daily Vercel operations and activated public external health schedules with successful run evidence. Private backup scheduling awaits a successful real-data comparison; inspect ongoing schedule freshness. |
| 22 | WebSockets | Conditional; current collaboration uses SSE. |
| 23 | Long polling | Conditional; no additional fallback transport is required. |
| 24 | Server-sent events | Retained authenticated cursor replay; added atomic shared admission, bounded writes and deterministic cleanup. |
| 25 | Database indexing | Applied additive covering foreign-key indexes; live catalog check has no uncovered FKs. Review actual workload/unused indexes over time. |
| 26 | Query optimization | Batched known artifact/presence paths; database spans and local rehearsals added. Hosted pg_stat_statements/query-plan review remains workload-dependent. |
| 27 | N+1 queries | Implemented batched workspace artifact validation/insertion and project-presence access checks. |
| 28 | Connection pooling | Retained bounded Supabase pool; parent deployment uses a one-connection per-function budget. Aggregate hosted demand still needs representative measurement. |
| 29 | Read replicas | Conditional until measured read saturation justifies lag-aware reads. |
| 30 | Sharding | Conditional; a single database is appropriate at current scale. |
| 31 | Partitioning | Conditional until retention volume/query cost warrants it. |
| 32 | Replication | Conditional; provider redundancy is not an application-tested failover guarantee. |
| 33 | Leader election | Conditional; existing database leases model current claims. |
| 34 | CAP theorem | Conditional architectural analysis; writes fail closed without the authority/database, while local drafts support explicit later recovery. |
| 35 | Eventual consistency | Retained persisted event cursors and revision authority. Real multi-instance delivery-lag measurement remains pending. |
| 36 | Optimistic locking | Implemented required revision tokens for design changes and snapshot restoration with stale/missing-token tests. |
| 37 | Pessimistic locking | Implemented atomic editor lease checks and conditional acquisition inside the mutation transaction. |
| 38 | Distributed locks | Shared database lease and transaction fences implemented; true simultaneous hosted multi-connection rehearsal remains pending. |
| 39 | Race conditions | Deterministic competing-editor/save tests added, plus subscription admission/cleanup protection. This does not certify absence of all races. |
| 40 | Deadlocks | Retained serialized write transaction ownership; span timing exposes waits. Hosted deadlock/lock-wait observation remains pending; unsafe blanket transaction retries were not added. |
| 41 | Memory leaks | Synthetic server read/SSE reconnect rehearsal passed with bounded heap observations and no retained presence/timers. Browser/GPU and long-running production soaks remain pending. |
| 42 | Garbage collection | Retained explicit renderer/worker disposal; local rehearsal records forced-GC heap deltas. No unsupported tuning claim. |
| 43 | Thread safety | Retained isolated worker messages and database transaction ownership; tested asynchronous admission and mutation boundaries. |
| 44 | Backpressure | Implemented bounded SSE frames/buffers with close-and-replay on slow consumers. |
| 45 | Autoscaling | Shared request/circuit/subscription admission removes process-local admission gaps. Actual Vercel burst capacity and aggregate pool saturation remain unmeasured. |
| 46 | Horizontal scaling | Shared state and transactional claims implemented; local PGlite is one leased connection. Two-instance hosted write/replay/load rehearsal remains pending. |
| 47 | Vertical scaling | Conditional; no paid compute upgrade enabled. |
| 48 | CDN | Retained deployment-managed static CDN and immutable asset caching. |
| 49 | Edge caching | Retained public-only caching with private response exclusions. |
| 50 | Cache invalidation | Retained versioned builds and no-cache worker/inventory metadata. |
| 51 | Feature flags | Implemented audited, revisioned server flags with stable percentage rollouts and unsupported-worker denial. No external provider required. |
| 52 | Blue-green deployment | Conditional; staged compatible release suffices for the demo. |
| 53 | Canary releases | Conditional until traffic and reliable metrics justify gradual exposure. |
| 54 | Rolling deployments | Conditional; Vercel manages function replacement. |
| 55 | Rollbacks | Added exact-commit release/rollback procedures and known-good release evidence requirements. A real application rollback rehearsal remains pending. |
| 56 | Health checks | Retained database readiness at `/api/health`; added external checking tools with strict JSON/status/deadline validation. |
| 57 | Liveness and readiness | Implemented process-only `/api/live`, separate from database readiness. |
| 58 | Monitoring | Implemented protected runtime checks and activated external health workflows with successful scheduled/manual runs. Ongoing freshness checks, an isolated outage drill and inbox evidence remain required. |
| 59 | Logging | Implemented structured redacted request outcomes/correlation IDs and audit-write failure signals; removed render prompt text from audit details. |
| 60 | Distributed tracing | Implemented request trace context, parent/child database/provider spans, bounded sampled storage and protected retrieval. No external trace exporter is claimed. |
| 61 | Metrics | Implemented shared minute histograms, route/error counters, latency summaries and bounded retention. Full 28-day measurement is not yet established. |
| 62 | Alerts | Implemented SMTP runtime state-change/throttled alerts and external health/backup-age checks. Recipient is owner-authorized; delivery and outage drills remain pending evidence. |
| 63 | SLOs | Defined internal objectives in `SLO.md`; attainment requires complete observation windows and coverage evidence. |
| 64 | SLIs | Defined API, probe, persistence and recoverability indicators; runtime aggregation and external attempts provide distinct signals, not a single complete availability measure. |
| 65 | Error budgets | Implemented windowed runtime availability budget summaries and documented release-response policy; full-window operational enforcement remains pending. |
| 66 | Observability | Implemented correlated logs, spans, shared metrics and actionable check routes; external monitoring is activated. Ongoing review and full observation windows remain operational work. |
| 67 | Secrets management | Implemented tested previous-key vault decryption/CAS resealing. Planned key custody/rotation rehearsal across record classes remains required before rotating real keys. |
| 68 | IAM | Retained least-privilege database roles, application ownership/tenant checks and private-schema RLS. New tables receive equivalent restricted policies. |
| 69 | OAuth | Existing OIDC/PKCE/nonce flow retained and outbound discovery/token paths hardened. No approved provider is configured/tested by this release. |
| 70 | JWT rotation | Conditional; application sessions are opaque. Test provider key rollover if OIDC is activated. |
| 71 | TLS | Retained certificate verification, Supabase CA validation and secure production cookies; provider helpers require approved HTTPS. |
| 72 | Encryption at rest | Implemented encrypted render inputs and previous-key handling; project/photo/artifact encryption retained. Browser drafts/recovery downloads remain explicitly plaintext on the device. |
| 73 | Encryption in transit | Implemented approved HTTPS provider destinations, redirect rejection and bounded transport policies. SMTP TLS verification retained. |
| 74 | WAF | Vercel managed mitigations retained, with shared application quotas. Additional account-level rules/bot controls require a separate traffic-based review; they were not silently enabled. |
| 75 | DDoS protection | Retained Vercel managed protection; added shared admission. This is not a denial-of-service capacity guarantee. |
| 76 | CORS | Retained same-origin policy and exact trusted-origin validation. |
| 77 | CSRF | Retained session-bound browser protection; only exact authenticated machine operations bypass browser CSRF. Version aliases are tested. |
| 78 | SQL injection | Retained parameterized values and reviewed/quoted identifiers; migration indexes use catalog-derived quoted names. |
| 79 | XSS | Retained text rendering, bounded validated input and CSP. Continued sink review is required for future changes. |
| 80 | SSRF | Implemented approved HTTPS origins, private/local literal destination denial and redirect rejection in shared outbound requests. Deployment/network egress controls remain a separate layer. |
| 81 | Database migrations | Applied an additive reviewed v2 migration; fresh bootstrap and upgrades share ordered migration files. |
| 82 | Schema versioning | Advanced runtime/ledger to `groundwork_engineering_v2`; old baseline migration remains unchanged. |
| 83 | Disaster recovery | Added authenticated isolated restore/fingerprint tooling and recovery runbook. Real hosted-data restore, matching-key decryption and restored-auth invalidation drill remain pending. |
| 84 | Backups | Added bounded AES-GCM PostgreSQL export/manifest and private-repository scheduled tooling. No active offsite backup is claimed without upload/freshness/restore evidence and separate key custody. |
| 85 | Failover | Conditional; never fail over to a stale writable SQLite copy. |
| 86 | Multi-region deployment | Conditional; keep compute near the single database. |
| 87 | Chaos engineering | Conditional platform; safe synthetic cancellation/lost-response/restore tests cover current failure cases. |
| 88 | Cost optimization | Retained provider budgets and free-plan restrictions; added measurement/runbooks. Provider monetary caps and account quota notifications require actual account configuration. |
| 89 | Cold starts | Local application import/first request/warm request timings recorded. Those are not Vercel cold-start measurements; hosted cold/warm login/save profiling remains pending. |
| 90 | Serverless limits | Applied conservative client payload/read deadlines and bounded stream lifetime; large responses/files still face platform limits. Unsupported background jobs remain disabled. |
| 91 | Latency | Added route histograms and synthetic authenticated read measurements; hosted login/save/sync journeys remain to be measured. |
| 92 | Throughput | Local four-concurrent-reader rehearsals recorded; no hosted write-throughput or multi-instance capacity claim. |
| 93 | P99 latency | Added nearest-rank local p99 evidence and shared histogram estimates. Runtime estimates use bucket upper bounds, not exact sampled percentiles. |
| 94 | Tail latency | Implemented complete-body deadlines/circuit admission, histogram observations and local p95/p99 regressions. Representative hosted tail measurement remains pending. |
| 95 | Network partitions | Added cancellation, Retry-After and commit/lost-response recovery tests; drafts/ambiguous edits are retained and unsafe automatic replay stops. |
| 96 | Clock skew | Existing TOTP/expiry boundaries and logical revisions retained; time-bounded operational reports reject stale/future evidence. Host NTP/drift monitoring is an external requirement. |
| 97 | DNS | Retained managed hosting DNS; no custom-domain ownership claim added. |
| 98 | TCP vs. UDP | Conditional; application relies on platform transports. |
| 99 | HTTP/2 and HTTP/3 | Platform-managed; negotiated protocol verification remains pending. No custom HTTP server is justified for this topic. |
| 100 | gRPC | Conditional; existing REST/JSON is appropriate. |
| 101 | Webhooks | Signed/duplicate callback tests retained; hardened payment outbound requests. Real provider callback secrets, delayed-event and reconciliation drills remain required before paid use. |
| 102 | API versioning | Implemented `/api/v1` contract alias, `X-API-Version: 1` and legacy `/api` compatibility; design writes/restores require revision tokens. |
| 103 | Semantic versioning | Documented compatibility/release policy added; 1.1.1 production release verified, with a 1.1.2 backup comparison correction in progress. |
| 104 | Infrastructure as code | Vercel configuration, migrations, pinned workflows and private provisioning procedures are reproducible source. Account secrets/settings are deliberately outside the repository. |
| 105 | Terraform | Conditional until multi-environment provisioning warrants it. |
| 106 | Helm charts | Conditional; no Kubernetes deployment is being introduced. |
| 107 | Build caching | Retained lockfile-based npm CI caching. |
| 108 | Dependency hell | Added scheduled Dependabot review configuration and immutable Actions pins; local production audit found no known advisories. Malicious/undisclosed packages still require review. |
| 109 | Production incidents | Added outage, SMTP, database, security and recovery response procedures in `INCIDENTS.md`. No actual incident is invented. |
| 110 | On-call | Named initial owner/alert recipient `jitinraavi99@gmail.com`; coverage hours, fallback responder and acknowledgment drills remain operational requirements. |
| 111 | Postmortems | Added concrete severity, timeline, impact, cause and owned-follow-up template; use it after a material incident. |

## Synthetic performance evidence

The disposable local rehearsal uses a synthetic cookie session and a 500-object
encrypted design, refuses all remote destinations, and deletes its temporary
database. Both runs used Node 22.19.0, 150 authenticated reads and concurrency 4.
Each also exercised six SSE reconnect/disconnect cycles, leaving zero presence
rows and zero extra intervals after cleanup.

| Local database | p50 | p95 | p99 | Read throughput | Retained heap growth after forced GC |
| --- | --- | --- | --- | --- | --- |
| SQLite | 18.55 ms | 25.81 ms | 33.15 ms | 206.85 requests/s | 2,457,056 bytes |
| PGlite PostgreSQL engine, one leased connection | 33.76 ms | 56.73 ms | 78.44 ms | 109.14 requests/s | 3,006,120 bytes |

Results are stored in local `artifacts/engineering-capacity.json` and
`artifacts/engineering-capacity-postgres.json`. These values are regression
observations on one machine, not production promises or high-volume benchmarks.
They do not measure browser GPU disposal, real network delay, hosted pool waits,
simultaneous PostgreSQL writers or a Vercel cold start. Application import times
are particularly sensitive to module cache and test order.

Run the rehearsal from the repository root with no production credentials:

```sh
npm run test:capacity
npm run test:capacity:postgres
```

## Ongoing verification and recovery completion

1. For each new release, retain a green exact-commit main CI run, native synthetic
   export/restore result, production deployment ID/SHA and post-release smoke
   checks. The verified 1.1.1 evidence above is historical and cannot stand in for
   a later patch's checks. Follow [RELEASE.md](RELEASE.md).
2. Keep the activated external health checks and configured runtime token/cron
   current. Confirm an isolated failure and recovery notification and inbox
   delivery, then inspect schedule freshness. A daily Vercel cron does not replace
   the external 15-minute schedule, which is subject to GitHub scheduling delay.
3. Complete the real-data comparison correction and rerun against the approved
   private recovery repository. Activate scheduling only after encrypted artifact
   and full restore comparison success. Preserve portable separate copies of the
   backup key and application-key history, then rehearse isolated project
   decryption and restored-auth invalidation. Windows-user DPAPI alone is not a
   portable recovery copy. Never upload production backups to public artifacts.
4. Observe real traffic long enough to evaluate the documented SLOs. Measure
   hosted login/save/replay, aggregate pool/lock demand, browser/GPU cleanup and
   negotiated protocols before raising capacity or availability claims.
5. Keep native/render workers and unconfigured paid integrations unavailable.
   Provider SSO, payments, Redis, durable workers and additional WAF rules each
   need their own configured, authorized end-to-end verification before use.

The operating procedures are [OPERATIONS.md](OPERATIONS.md), the service
objectives are [SLO.md](SLO.md), and incident ownership/review is documented in
[INCIDENTS.md](INCIDENTS.md). Local draft recovery is documented separately in
[DURABLE-RECOVERY.md](DURABLE-RECOVERY.md); it is not an offsite database backup.
