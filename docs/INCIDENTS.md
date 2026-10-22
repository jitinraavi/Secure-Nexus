# Incident ownership and response

Initial primary owner and authorized alert recipient: `jitinraavi99@gmail.com`.
Set `OPS_ALERT_TO` to that inbox during activation. No secondary responder or
24-hour coverage is established by this repository. The owner must appoint a
backup responder, acknowledgment channel and coverage hours before claiming an
on-call rotation. Never put passwords, tokens or recovery keys in this document.

| Severity | Examples | Initial response target during agreed coverage |
| --- | --- | --- |
| SEV1 | Suspected data exposure/loss, all users unable to log in or save | Acknowledge within 15 minutes; prioritize containment/recovery |
| SEV2 | Partial outages, repeated 5xx, failed daily backup, broken SMTP OTP delivery | Acknowledge within 1 hour |
| SEV3 | Degraded latency, approaching quota, missing optional integration | Review next working day |

Targets are internal expectations until coverage and delivery drills are proven.

## First response

1. Assign incident lead and record UTC start, impact, affected origin and release
   SHA. Keep a private timeline with request IDs and sanitized evidence.
2. Confirm externally: inspect the health workflow, public `/api/health`, Vercel
   deployment state/logs, Supabase connectivity/status, SMTP provider status and
   quota. A successful health response does not validate OTP delivery or saves.
3. Stop feature releases. For data/security incidents preserve evidence and pause
   affected writes. Do not rotate encryption keys casually, print environment
   variables, export customer records to chat, or overwrite the database.
4. Compare the first bad request with the latest release/configuration/migration.
   For application-only regressions, choose a known-good deployment with a
   compatible schema and obtain the release owner's approval to roll back.
   Record the exact deployment/commit and verify login plus save/reload afterward.
5. For database loss/corruption follow `OPERATIONS.md`: preserve the source,
   authenticate the chosen archive, rehearse in isolation, then propose the
   exact new hosted restore target and matching application-key version for
   explicit owner approval. Production restore is never automatic.
6. Confirm recovery with independent health checks and synthetic authorized
   application flows. Record the end of customer impact and continue observing
   for at least 30 minutes. Communicate the factual impact and next update time
   through owner-approved channels; this tooling sends no customer messages.

If monitoring is silent, inspect its last completed run and configuration first.
An inactive GitHub schedule, missing recipient, failed SMTP authentication or
exhausted Actions quota can suppress monitoring. Use failed-workflow
notifications and the owner's daily freshness check as the initial fallback.

## Postmortem template

Create a private incident record within two working days for SEV1/SEV2:

```text
Incident ID / severity:
Lead / reviewers:
UTC detected / acknowledged / mitigated / recovered:
Affected release SHA, origin and schema version:
Customer impact and duration (verified facts):
Detection source and gaps:
Timeline (UTC, evidence links, decisions):
Root cause and contributing conditions:
What restored service; why it was safe:
Data-loss/exposure assessment and backup/key versions used:
SLO/error-budget impact and missing measurement:
Actions (specific change, named owner, due date, verification evidence):
Rollback/restore drill follow-up:
Approval to resume ordinary releases:
```

Track actions to completion; avoid assigning blame or substituting a restart for
root-cause evidence. Keep customer data and secrets out of public issue trackers.
