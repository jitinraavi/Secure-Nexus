# Service objectives and measurement

These are initial operating targets for the low-traffic Vercel/Supabase service,
not measured guarantees. Record the start of a complete 28-day measurement window
before claiming attainment. Scheduled external probes and process-local counters
are different signals and must be reported separately.

| SLI | Numerator / denominator | Initial target, rolling 28 days |
| --- | --- | --- |
| External health | Successful first-attempt `/api/health` probes / scheduled probes actually executed | 99.5% |
| API reliability | Eligible completed API requests without 5xx / all eligible completed API requests | 99.5% |
| API latency | Eligible successful API requests completed in ≤2,000 ms / eligible successful API requests | 99% (p99 ≤2,000 ms) |
| Project persistence | Successful authorized saves subsequently reloaded with matching revision / controlled save-reload trials | 100% of daily owner-controlled trials |
| Recoverability | Latest completed encrypted archive age and successful restore evidence | Archive ≤26h; monthly real-data drill; initial RPO ≤24h, RTO ≤4h |

Eligible API requests are same-origin application API requests, including
server-side dependency latency. Exclude public probes, static assets, intentional
event streams and long-running export/AI/native routes from the interactive
latency SLI; report those routes separately. Expected 4xx authentication and
validation failures count as available responses but not successful-operation
latency samples. Treat unexpected 429 admission failures separately as capacity
events. Count network failures/timeouts and platform 5xx in external monitoring;
they cannot appear in application-only counters. Avoid per-user/project labels.

The monitor records each attempt's latency, HTTP status and a fixed reason in its
Actions log. Use the **first** attempt for availability measurement so retries do
not hide outages; the three-attempt rule controls alert noise only. Missing runs
are a coverage gap, not healthy samples. Report both executed-probe availability
and `executed / expected scheduled probes`, with a coverage target of 99%.
GitHub schedules are best effort: this low-cost monitor cannot certify continuous
uptime or a strict detection-time guarantee. Daily inspection covers stale runs;
continuous stale-run detection needs an independent monitor.

Runtime telemetry now persists minute-level route histograms and sampled
redacted traces in the shared database with seven-day retention. Retrieve them
through bearer-protected `/api/ops/metrics` and `/api/ops/traces`; the summary
endpoint accepts windows up to 24 hours. Preserve compatible timestamped
aggregates outside this retention window before claiming 28-day attainment.
Do not average instance percentiles. Runtime p95/p99 values are histogram bucket
upper-bound estimates; local capacity reports use nearest-rank samples.

The runtime check's defaults are a 99.9% availability budget, p95 ≤750 ms, and
at least 20 observed requests before traffic-based alerts. Set
`SLO_AVAILABILITY_PERCENT=99.5` to align its budget with the initial API objective
above, or record an intentionally stricter target. `SLO_P95_MS` and
`SLO_MIN_REQUESTS` configure the other check thresholds. Runtime summaries include
completed routes other than `/api/ops`; apply the eligibility rules above before
reporting the interactive SLI. The p95 runtime alert does not prove the p99
objective. Platform/network failures absent from application telemetry still
need external observations. Keep partial-window results explicitly labelled.

## Performance rehearsal

`npm run ops:performance` runs a bounded, sequential, unauthenticated health-route
rehearsal: default 100 samples, at least 500 ms between requests, maximum 500
samples, no mutating routes or cookies. Set `OPS_PERF_ACK=isolated-target-no-production`,
`OPS_PERF_ORIGIN`, `OPS_PERF_ALLOWED_ORIGINS` and `OPS_PERF_ISOLATED_ORIGIN` to the
same disposable target. Supply every live production origin in
`OPS_PRODUCTION_ORIGINS`; those targets are refused. Only literal loopback IP
origins or explicitly bound HTTPS `.vercel.app` deployments are accepted. The
owner must verify that a Vercel deployment is isolated; hostname validation
cannot distinguish a production `.vercel.app` alias from a preview.

The JSON output contains sample count, failure count, p50/p95/p99 (nearest rank),
target, route and UTC timestamp. Failures remain in the latency sample set and
any failure fails the rehearsal; default p99 budget is 2,000 ms, adjustable with
`OPS_PERF_P99_MS`. `OPS_PERF_SAMPLES` accepts 100–500. Record deployment SHA,
region, warm/cold behavior and configuration with the result. A health-route
rehearsal is not evidence of p99 under real user concurrency. Test representative
authenticated operations with synthetic accounts in an isolated environment
before claiming production capacity; never load-test the live service by default.

## Error budgets and response

A 99.5% objective allows 0.5% bad eligible events per window: 50 bad events per
10,000 requests, or approximately 202 minutes over 28 days for a separately
time-based availability objective. The event-based and time-based numbers are
not interchangeable. Latency allows 1% above-budget successful eligible requests.
At a 15-minute probe interval there are 2,688 expected samples per 28 days, so
the 99.5% executed-probe budget is about 13 failed samples at full coverage.

Burn rate = observed bad-event fraction / permitted bad-event fraction. Page the
owner for three consecutive failed external checks, confirmed customer inability
to log in/save, or suspected data loss/security exposure. With complete traffic
metrics, investigate burn >14.4x over both 1 hour and 5 minutes, and >6x over both
6 hours and 30 minutes; require at least 100 eligible requests before applying
request-based low-traffic alerts. Those burn alerts are definitions, not an
installed alert engine. The initial workflow implements the repeated-probe rule.

When the rolling budget is exhausted, pause feature releases and prioritize
recovery, data protection and reliability fixes. Resume ordinary releases after
owner review of the cause, mitigation, remaining budget and follow-up work.
