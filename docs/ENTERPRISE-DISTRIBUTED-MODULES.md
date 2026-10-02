# Organization, identity and distributed coordination source

This module is implemented by source inspection only. The app, compiler, tests,
builds, migrations, identity provider and Redis commands have not been executed.

## Organization workspace

`/organizations` exposes organization creation, owner/admin/editor/viewer roles,
seat usage and limits, ownership transfer, retention policy, project binding,
audit JSON downloads, provider configuration and an offline coordination board.
The organization owner can appoint administrators. Administrators can manage
editor/viewer membership; they cannot change the owner or appoint administrators.
Seat allocation uses an atomic SQLite transaction. The deployment entitlement is
`ORGANIZATION_MAX_SEATS` (default 5, upper bound 10,000); this is administrator
provisioning, not automatic paid seat billing. Accounts may create three tenants.

Binding requires both organization administrator access and personal ownership of
an unbound project. Binding revokes public share capabilities, removes individual
project invitations/locks, and applies tenant membership to every project access
check. Public capability reads additionally reject bound projects. Bound projects
cannot be duplicated into personal workspaces. Design/file encryption keeps the
original owner AAD; changing membership never changes encryption identity. There
is no unbind/delete-tenant shortcut that restores old external invitations.

The retained tenant audit records administration, project design updates/deletion,
SSO decisions and coordination operations. Retention is 30–3,650 days; expiry is
applied on audit activity/read. It is not a WORM/legal-hold audit service or a claim
to capture every historical user action. Personal security audit remains separate.
Audit export downloads at most 10,000 events per file and marks a partial export
with a continuation cursor.

## OIDC and SAML gateway

Set `PUBLIC_APP_ORIGIN` to the fixed public HTTPS application origin and
`SSO_ALLOWED_HOSTS` to a comma-separated exact hostname allowlist covering the
issuer's discovery, authorization, token and JWKS endpoints. Redirects from these
server fetches are rejected. Register the displayed callback URI at the provider.
Organization owners configure issuer/client ID and optional secret in the UI.
Credentials are encrypted with the server vault key and never returned to clients.

The authorization-code flow uses S256 PKCE, an expiring single-use state record, a
browser-bound HttpOnly cookie and an ID-token nonce. ID tokens require verified
RS256/PS256 or ES256 signatures from a uniquely matched JWKS `kid`, exact issuer,
audience/authorized-party checks and bounded timestamp validation. Responses and
network duration are bounded. Existing local TOTP remains required after SSO.

Each member first signs in locally, then selects **Link my provider identity**.
The callback proves both the original local session and the provider identity.
Organization owners cannot map their identity to another member's global account;
email matching and automatic account provisioning are intentionally absent.
Removed members lose provider bindings and tenant authorization. A provider change
invalidates old flows/bindings. Sign-in URL: `/api/sso/<organization-id>/start`.

Native SAML XML signature/assertion processing is **not** implemented. A maintained
SAML-to-OIDC broker (for example, the organization's identity gateway) supplies the
OIDC interface for a SAML deployment. This source never claims a SAML assertion was
verified locally. Logout is local session logout; provider back-channel logout,
SCIM provisioning and mandatory SSO enforcement remain deployment extensions.

Protocol references: [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html),
[PKCE RFC 7636](https://www.rfc-editor.org/rfc/rfc7636).

## Event and presence transport

Without Redis, presence leases and notification journals are shared in SQLite,
with expiry/revocation checks and bounded replay. This supports multiple processes
on one host using the same database. SQLite WAL is not a supported shared network
filesystem topology.

Optional deployment variables:

* `COLLABORATION_REDIS_REST_URL`: HTTPS Upstash-compatible REST endpoint.
* `COLLABORATION_REDIS_REST_TOKEN`: server-only command credential.
* `COLLABORATION_REDIS_NAMESPACE`: unique application/environment namespace.

Configured Redis supplies independent-host event streams, expiring presence leases
and atomic coordination registers. Events enter a SQLite outbox in the same
transaction as their notification journal. A leased worker retries failed delivery
with bounded batches/backoff; a lost acknowledgement may deliver a duplicate.
Clients deduplicate notification UUIDs. Notification streams retain approximately
2,000 events per project and the outbox retains the newest 100,000 notifications.
After a notification gap, authoritative revisions/coordination snapshots remain
the resynchronization source. Presence expires after 45 seconds. Transport failure
reports degradation; it never silently moves accepted Redis operations to SQLite.

**Topology boundary:** Redis makes the transport and coordination sidecar shared
across hosts. Users/sessions/tenant membership/project geometry still use this
repository's SQLite authority. Independent application hosts require a centralized
authority/API or a separately implemented network database adapter and consistent
master keys/identifiers. Copying independent SQLite files does not create a valid
distributed project database, and configuring Redis does not make that claim.

Transport reference: [Redis REST commands](https://upstash.com/docs/redis/features/restapi).

## Offline operation synchronization

`/api/collaboration/:projectId/sync` exposes snapshot/replay and idempotent field
operations for the coordination sidecar. Each title/body/status/assignee/due-date/
archive register uses a deterministic Lamport-clock, authenticated-client and
operation-ID ordering. Arrival order commutes. Reusing an operation ID with
different content is rejected. Every acknowledgement includes the effective
winning register, so superseded offline fields reconcile with accepted state.

The board actually uses this API. Browser pending operations use immutable,
account/project/operation-specific localStorage records, and each page generates
its own client identity. Other tabs can retry the same pending operation safely;
they never replace another tab's entire queue. Queue recovery/export is bounded to
200 operations / 2 MB. Invalid records remain untouched and exportable. Storage
failures visibly fall back to memory.
Capacity overflow blocks new edits and marks recovery exports as partial; records
beyond the recovery budget remain untouched in browser storage. Repair storage and
reopen the workspace before adding edits. Successful acknowledgements advance the
local Lamport clock from the effective register and current server clock.
Browser drafts contain plaintext coordination
fields; shared devices should export/synchronize and clear their site data when
changing accounts.

Server registers are bounded to 1,000 fields / 2.5 MB of encrypted values, with at
most 50,000 accepted operations per project and 200 operations per replay page.
These are explicit capacity errors, not silent truncation of edits. Tombstones and
idempotency records are retained; there is no automatic journal compaction that
can accidentally resurrect deleted issues or accept old IDs twice. Backup/migrate
the active backend before changing it. Geometry remains encrypted and uses the
existing revision/lock/conflict mechanism; arbitrary CAD operations are not
represented as commutative edits by this module.

## Unverified deployment checks

Type/compiler correctness, migrations, Redis Lua/REST behavior and outage retries,
multi-tab storage recovery, member-revocation races, provider discovery/signatures,
TOTP navigation, browser rendering and backup/restore require verification when
execution is permitted. No native SAML library, provider tenant, Redis instance or
central database service is installed/provisioned by these source changes.
