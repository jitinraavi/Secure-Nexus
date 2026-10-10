# Built offline shell source increment

This increment supplies a bounded public application shell. The source-only
handoff below is historical. The October 10 security integration also includes
account storage fences, sign-out recovery and browser security tests; see
[the current audit comparison](SECURITY-AUDIT-COMPARISON.md) for executed checks.
Full browser offline lifecycle and external deployment acceptance remain separate.

The existing Vite 6 production build runs the new post-write Rollup plugin after
the output is written. Its inventory covers every emitted HTML/chunk/asset,
including lazy JS/CSS, emitted worker bundles and emitted WASM, plus the exact
public allowlist `logo.svg`, `logo.png` and `manifest.webmanifest`. Runtime external
services such as maps, API data and uploaded project assets are outside the shell.
Referenced external bundled imports are rejected. Unsupported bases, SSR/watch/
in-memory builds, path traversal and reserved names fail explicitly. The full
checkout must retain the original public logos; the text-only working mirror is
not a complete deployable asset checkout.

The plugin hashes exact bounded output bytes and the worker template, then writes
`offline-shell.json` and publishes generated `sw.js` last. The version changes with
any inventoried asset or worker behavior. The raw source worker has a null inventory
and fails installation; development source never registers it. No dependency was
added and no generated output was produced in this source-only session.

Budgets are 256 files, 32 MiB per file and 96 MiB total. Installation uses at most
three concurrent fetches, 30 seconds per fetch and a 120-second overall deadline.
Each fetch uses the exact same-origin URL, omitted credentials, rejected redirects
and no HTTP cache reuse. Streamed bodies cannot exceed their declared build size;
length and SHA-256 must match before caching. The complete marker is written last
and every inventory entry is checked afterward. Failure removes only that staged
version. Deployment must publish the matching entire asset graph and generated
worker together; partial/rewritten/authenticated asset delivery cannot pass.

The worker caches only declared public files. It never caches API, user responses,
arbitrary runtime assets, cross-origin resources or query-specific HTML. SPA
navigations use the same cached canonical index from the active worker's version;
the browser's actual URL remains available to routing. Missing cached assets fall
back to network without populating another version's cache, and readiness then
fails. Browser storage eviction can invalidate readiness after a successful check.

Updates do not call `skipWaiting`, claim in-flight pages or reload editors. A new
complete worker waits until prior controlled tabs close. Activation deletes only
its own version-prefix caches and the named legacy Groundwork shell caches;
unrelated origin caches remain intact. The hub asks users to save, close all app
tabs and reopen when an update waits. A first installation can be prepared while
the current page remains uncontrolled; it is shown separately from a ready cache.

The lifecycle module queries the actual worker using MessageChannel. Readiness
requires the version's complete marker and every cached asset's declared metadata;
registration success and browser online state alone do not qualify. The hub exposes
unavailable, preparing, prepared, verified-cache-ready, failed/unverified and waiting
update states separately. Cache fingerprints are verified during installation;
the status check does not rehash every body. Same-origin trusted application code
and browser Cache Storage integrity remain assumptions. Account changes invalidate
in-flight hub queue/storage reads and clear visible prior-account metadata.

The associated bounded queue corrections reject unsupported legacy operations
instead of falsely marking them complete; project-save replay retains its base
revision and expected account, while the server rejects a cookie-account mismatch.
Editor fallback queues only network TypeErrors, never permission/not-found API
errors. These corrections do not establish complete artifact/job offline replay.

Remaining Phase 8 work includes the full account cache/permissions/conflict review,
immutable artifact/job dispatch, logout isolation, retention and recovery behavior.
Actual Vite output ordering/worker coverage, browser lifecycle, storage quota,
offline lazy loading, account switching and deployment acceptance remain unverified.

Primary references: [Vite 6 plugin hooks](https://v6.vite.dev/guide/api-plugin),
[Rollup output hooks](https://rollupjs.org/plugin-development/#writebundle),
[Service Worker lifecycle](https://w3c.github.io/ServiceWorker/).
