# Central API authority and secondary hosts

This source increment implements the topology part of Phase 7. Tenant paid-seat
entitlements and payment transition work are a separate source increment. Nothing
in this module was run, built, compiled, migrated or deployed.

## Supported topology

Use one canonical browser-facing HTTPS origin, for example
`https://studio.example.com`. Its edge/load balancer may route to multiple
secondary gateways. Every gateway forwards every `/api` request to the same fixed
private HTTPS authority origin, for example `https://authority.internal.example`.
The authority owns users, sessions, organization permissions, payments, project
storage, encryption keys and native jobs. It retains the existing local SQLite
database and durable filesystem. Deploy one active authority; failover must fence
the previous authority and recover the same durable database/files/keys.

Secondary hosts serve the already supplied client assets and stream API requests.
They do not import the database, vault configuration, route modules, mail/payment
providers or workers. Missing configuration fails startup; failed upstream requests
return gateway errors. No local database, local session or private API fallback is
created. The regular `index.ts` entry checks the role before dynamically importing
`authorityServer.ts`; starting it with the secondary role fails before authority
storage/key initialization. The dedicated secondary entry is `secondaryHost.ts`.

This is centralized application authority with multiple delivery hosts. It does
not implement a distributed SQL database, active-active authorities, authority
replication, high availability or a rolling key/credential rotation protocol.
Redis remains optional for the existing transport/coordination sidecar. It does
not replace central project, account or entitlement authority.

## Authority configuration

The ordinary authority entry remains the package `start` script. Existing direct
deployment is the default `GROUNDWORK_AUTHORITY_GATEWAY_MODE=direct`. Direct mode
rejects requests that present gateway credential headers, preventing a gateway
from accepting a misconfigured authority. Direct mode now trusts only exact IPs
in `GROUNDWORK_TRUSTED_PROXY_IPS`; otherwise the socket peer is the client IP.
Operators of an existing reverse proxy must configure its literal address before
depending on per-user rate limiting or forwarded client IPs.

For the centralized topology configure the authority with:

| Variable | Required value |
| --- | --- |
| `GROUNDWORK_SERVER_ROLE` | `authority` |
| `NODE_ENV` | `production`; required gateway mode refuses insecure development session cookies. |
| `GROUNDWORK_AUTHORITY_GATEWAY_MODE` | `required` |
| `GROUNDWORK_AUTHORITY_ID` | Stable 8–64 character letters/digits/underscore/hyphen identifier shared by all gateways. |
| `GROUNDWORK_GATEWAY_SECRET` | Provisioned random secret: at least 32 random bytes represented as 43–128 base64url characters, shared only with authorized gateways. Character validation is not an entropy check. |
| `PUBLIC_APP_ORIGIN` | Exact canonical HTTPS origin without path, query, credentials or fragment. |

Retain authority-only production configuration including its persistent
`GROUNDWORK_DATA_DIR`, stable `MASTER_KEY`, provider credentials and native worker
configuration. Do not set `GROUNDWORK_AUTHORITY_URL` on the authority.

In required mode every API request, including health checks and provider webhook
delivery, requires the gateway secret, authority ID and canonical public origin.
The authority checks the secret with bounded constant-time comparison before
cookies, JSON parsing, rate limiting and routes. It requires one literal forwarded
client IP, the canonical forwarded host and HTTPS protocol. It adds its configured
authority ID to responses; gateways refuse unmatched responses. The authority
retains its own session, CSRF and tenant access checks.

Restrict private authority ingress to authorized gateways using deployment
firewall/network rules and valid TLS certificates. Do not expose a second direct
API bypass. A gateway credential grants access to this forwarding boundary; it
does not grant a user session or tenant membership. Never put it in browser assets,
URLs or request logs. Both sides must use the same credential; rotation currently
requires coordinated configuration/restarts and can interrupt in-flight traffic.

## Secondary configuration

Use the package `start:secondary` script after deployment supplies the compiled
server and client assets. `dev:secondary` names the source entry for a future
authorized development session; it was not executed for this delivery. Do not use
the root `start`/`dev` scripts for secondary hosts.

Set role `secondary`, gateway mode `required`, and the shared authority ID, secret
and `PUBLIC_APP_ORIGIN`. Also set `GROUNDWORK_AUTHORITY_URL` to a fixed HTTPS origin
different from the public origin. TLS certificate/hostname verification remains
enabled. DNS, private routing and certificate trust are deployment prerequisites;
the source does not bypass certificate checks or follow upstream network redirects.

Do not copy the authority `.env` onto a gateway. Secondary startup explicitly
rejects nonempty `MASTER_KEY`, `PREVIOUS_MASTER_KEY`, `DB_PATH`,
`GROUNDWORK_DATA_DIR`, payment secrets (including `RAZORPAY_WEBHOOK_SECRET`), assistant API key, Redis credential or mail
credentials. Native workers must be unset or `NATIVE_WORKER_ENABLED=false`.
The client asset directory is read-only; gateways need no authority data volume.

| Setting | Default / supported bounds |
| --- | --- |
| `PORT` | 4001; 1–65,535. |
| `GROUNDWORK_GATEWAY_BIND_HOST` | `127.0.0.1`; literal interface IP. Explicitly choose the container/private interface when needed. |
| `GROUNDWORK_TRUSTED_PROXY_IPS` | Empty; at most 32 comma-separated exact edge proxy IPs, no CIDR ranges or implicit hop trust. |
| `GROUNDWORK_GATEWAY_MAX_INFLIGHT` | 128; 1–1,024 API transfers. Socket count is also bounded. |
| `GROUNDWORK_GATEWAY_MAX_REQUEST_BYTES` | 70 MiB; 8–128 MiB. Covers the existing 64 MiB artifact plus multipart overhead; endpoint limits still apply. |
| `GROUNDWORK_GATEWAY_MAX_RESPONSE_BYTES` | 70 MiB; 8–128 MiB for non-SSE wire bytes. |
| `GROUNDWORK_GATEWAY_REQUEST_DEADLINE_MS` | 120,000; 30,000–300,000 absolute transfer deadline. |
| `GROUNDWORK_GATEWAY_CONNECT_DEADLINE_MS` | 10,000; 1,000–30,000 TLS connection deadline. |
| `GROUNDWORK_GATEWAY_IDLE_TIMEOUT_MS` | 90,000; 30,000–300,000 upstream inactivity deadline. |
| `GROUNDWORK_GATEWAY_SSE_LIFETIME_SECONDS` | 3,600; 60–14,400, after which clients must reconnect/replay. |

## Browser, proxy and provider requirements

Terminate browser HTTPS at the configured edge. Preserve the canonical `Host`
when forwarding to the secondary process. If forwarding client IPs, overwrite
incoming `X-Forwarded-For` at the edge and configure only that edge's literal IP as
trusted. Arbitrary browser forwarding/authority headers are discarded and replaced
by the gateway. The authority trusts one authenticated forwarding identity, even
if its own TLS terminator is a separate deployment hop; its ingress must preserve
the gateway-generated headers. Changing edge addresses requires updating the
explicit trust list. Incorrect trust configuration can group users under one
rate-limit IP or attribute an untrusted address.

API requests with another `Host` are rejected. Browser mutations require an exact
canonical `Origin`, or an exact-origin `Referer` when Origin is absent, including
anonymous login/OTP operations. The separately signed payment webhook path may
omit Origin. Non-browser API consumers must supply the canonical Origin in
addition to their session/CSRF credentials; the gateway offers no CORS exception.

Cookies and multiple `Set-Cookie` headers pass through unchanged. Current session
cookies are host-only, so one canonical public host avoids cross-host session
sharing. Required gateway authority startup enforces production so session cookies
remain Secure.
SSO uses the same canonical `PUBLIC_APP_ORIGIN` for registered callbacks. Existing
OIDC state, nonce, browser-binding cookie, PKCE, signature and membership checks
remain on the authority. Redirect responses are relayed to the browser; locations
pointing to the private authority are rewritten to the canonical public origin.
Configured external OIDC authorization redirects remain intact. The proxy itself
does not follow them. Register provider callbacks/webhooks against the canonical
public host so they pass through an authenticated gateway. Native SAML processing
remains unsupported; use the existing configured SAML-to-OIDC broker interface.

No JSON, multipart or cookie parser runs at the gateway. Bounded transforms retain
the exact request body bytes, preserving raw webhook signatures, multipart
boundaries, artifact uploads and compressed responses. Streaming uses backpressure
and destroys upstream streams on cancellation, overflow, deadline or early response.
Hop-by-hop headers and upgrades are stripped/rejected. SSE streams bypass the
total-response-byte cap but retain connection, inactivity and lifetime budgets;
they preserve the existing heartbeat/event replay behavior. WebSocket and HTTP
upgrade tunnels are unsupported. Configure edge buffering, body limits, idle
timeouts and TLS ingress to permit these existing SSE/multipart workflows.

Raw fragments in incoming request targets are rejected before URL construction;
the gateway never silently drops a fragment to choose a different API target.
Same-authority relative redirect locations resolve against the actual API request
URL before returning to the public host. Successful complete transfers keep the
agent's normal TLS connection reuse; incomplete uploads/responses cancel both
directions and all bounded transforms. Incoming upgrade and CONNECT requests are
closed explicitly. Early API validation/capacity rejections close their connection
after the error instead of draining a rejected upload on a reusable socket.
Importing the guarded authority index from an unrelated file named `index.ts` or
`index.js` no longer starts a listener or worker; only the exact
resolved authority entry path starts them automatically.

## Source review and deferred acceptance

Inspection covered role-before-import isolation, copied route/worker wiring,
fixed-origin URL construction, credential checking, canonical host/mutation gates,
header filtering, cookie arrays, raw-body paths, transfer bounds, cancellation and
signal cleanup. No dependencies were added. Compiler/type acceptance, TLS/proxy
behavior, streaming uploads, webhook signature preservation, browser cookies,
OIDC redirects/callbacks, Redis reconnects and deployment/failover remain unverified
until execution is authorized. The source cannot certify the network/firewall,
credential entropy, TLS termination or proxy header configuration.

Primary references: [Node HTTP](https://nodejs.org/api/http.html),
[Node HTTPS](https://nodejs.org/api/https.html),
[Express proxy trust](https://expressjs.com/en/guide/behind-proxies/).

