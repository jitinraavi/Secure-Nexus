# Phase 2 - Durable native jobs and DWG exchange

Phase 2 adds project-scoped durable conversion and native analysis workflows. Implementation has been reviewed by source inspection only. No app, compiler, tests, builds, previews, native programs or database migrations were executed. Runtimes are not installed or enabled by this change.

## User workflow

Select a project in the BIM/civil exchange workbench, upload a DWG or ASCII DXF, choose the conversion direction and queue a job. The engineering workbench captures the current planar frame JSON and chosen combination for OpenSees. Uploaded Tcl is rejected; the server generates a fixed script from a validated numerical model. The captured input excludes subsequent page edits.

Both workbenches show configuration availability, job states, source/project revision, immutable source SHA-256, attempt count, errors and downloads. Submission retries reuse the exact uploaded artifact and request key. Retrying an already accepted request retrieves its job even if the project subsequently changed. A new request checks the current project revision. Starting another attempt retains the previous upload, since an interrupted response may conceal a committed job.

The editor export menu links to DWG jobs: download its current DXF, then submit that file in the exchange workbench. Conversion produces downloadable drawing files; it does not import arbitrary DXF entities into the editable website model. Existing CAD geometry and workspace snapshots are unchanged. The OpenSees inspector keeps mapped native results separate from browser-calculated reports and verifies the authorized source/manifest fingerprints, output fingerprints and tag mapping.

## API and persistence

The authenticated router is mounted at `/api/projects/:projectId/jobs`, before the generic project router.

| Method and suffix | Behavior |
| --- | --- |
| `GET /` | Project role/revision, latest job records and static configuration capabilities. |
| `POST /` | Submit kind, source artifact ID, current project revision, optional proven saved workspace revision, and 32-hex idempotency key. Returns HTTP 202 and job. |
| `GET /:jobId` | Read one project job. |
| `POST /:jobId/cancel` | Cancel queued work or request termination of running work. |
| `DELETE /:jobId` | Remove a terminal record and release its artifact/history references. Retains encrypted files for explicit cleanup. |
| `GET /:jobId/artifacts/:artifactId` | Authorized source or output download with attachment headers and SHA-256. |

Kinds are `dwg-to-dxf`, `dxf-to-dwg`, and `opensees-static`. Inputs use the existing encrypted workspace artifact API: exchange artifacts for drawings, engineering artifacts for solver JSON. The queue stores immutable input hashes, project/workspace source lineage and submitted session identity. Output artifact insertion and the final succeeded state commit together in a transaction. Each immutable file uses the existing AES-GCM storage and integrity checks.

The submitting session and current project write access are rechecked at claim, renewal and publication; revocation or expiry stops publication. Any current editor may cancel or remove a terminal project job. Viewers may read/download. Audits contain metadata. Job input/output foreign keys prevent removal of referenced artifacts. Workspace pruning preserves snapshots referenced by any retained job. Remove that terminal job before pruning the snapshot, then remove unreferenced artifacts to reclaim storage.

New tables are `project_native_jobs` and `project_native_job_artifacts`. Schema initialization follows the existing create-if-absent mechanism. Foreign-key cascade and existing-database acceptance remain unexecuted.

## Queue guarantees and limits

One worker loop runs per enabled API process. SQLite write transactions serialize claims across processes using the **same authority database on a supported local filesystem**. Leases last 20 seconds and renew every three seconds. A lost lease fences publication; stale attempts can retry once using a new isolated attempt directory. The original and retry can temporarily overlap after a worker crash; both calculate immutable inputs, and only the current token can publish. This is at-least-once computation with fenced atomic publication, not exactly-once process execution.

Limits are 32 retained jobs and two queued/running jobs per project, 64 active queue records globally, four running leases globally, two attempts per job, and a 10-minute overall deadline. Input and aggregate retained output budgets are each 32 MiB. Outputs continue to consume the shared workspace limits: 128 artifacts and 256 MiB per project. A capacity failure rolls back all new outputs and records failure; the original remains available.

Each operation has a 90-second wall timeout; LibreDWG additionally has a version probe limited to five seconds. `prlimit` enforces 512 MiB address space, 60 seconds CPU, 32 MiB per file, 32 processes per native account, and 64 open files per process. Logs are bounded to 128 KiB per invocation. The runner checks an allowlist of regular, single-link files during execution and before accepting output. Unknown entries, symbolic links, oversized files, changed inputs and incompatible results fail closed. Scratch files are private plaintext, removed after each attempt; cleanup failure leaves protected data and a warning. Restart cleanup removes unleased attempt directories older than 30 minutes. It is not secure erasure.

## Native deployment contract

Use [server/native-jobs.env.example](../server/native-jobs.env.example) for non-secret settings and [native adapter contracts](PHASE-2-NATIVE-CONTRACTS.md) for exact formats and primary references.

- A Linux deployment must supply GNU LibreDWG **0.13.4**, OpenSees **3.8.0**, and `prlimit` through absolute trusted paths. Windows native execution is unavailable. Versions are declared in configuration and checked during a real job; capability reads do not execute or certify binaries.
- A dedicated, positive native UID/GID must differ from the API UID/GID. The supervisor must have narrowly administered privileges to change directory/file ownership and launch with that identity. Do not expose an ordinary root API deployment as the isolation solution.
- Administrators must enforce the native identity's confinement using an appropriate reviewed OS policy or service/container architecture. Native processes must have no network, secret, database, application-write or other tenant access; supply only the trusted binaries/libraries and current attempt. UID separation, minimal environment and `prlimit` **do not provide complete filesystem/network isolation**. Set the acknowledgement only when that external policy is enforced. The source does not provision or verify such a policy.
- The scratch root must be a real directory owned by the API account, mode 0700, under private persistent data storage. Native processes work from their inherited attempt directory with fixed relative filenames. Protect the database, environment/key files and all parent paths; allow required standard libraries through the external policy. Verify deployment behavior before enabling the worker.
- Binary files and their resolved parent paths must be outside native-writable directories; administrator-provided binaries need reviewed provenance and stable installation. Dynamic libraries must resolve without forwarding arbitrary API environment variables.

Missing, unsupported or incorrectly configured runtimes remain unavailable. Static configured availability means a job may be queued, not that a healthy worker or verified converter is operating.

## DXF and solver scope

The website DXF writer now emits deterministic R2000 ASCII model-space records with millimetre units, handles/owners/subclasses, linetype/layer/style/block tables, finite bounded coordinates, closed outlines, escaped text and CRLF. It remains a 2D projection; spline control polygons, proxy dimensions and approximate planning geometry retain their limitations. R2000 UCS-2 escapes cannot represent all non-BMP characters. The converter conservatively targets R2000, preserves the original source and declares a no-rescale unit policy. Writing DWG with LibreDWG is experimental and can lose unsupported drawing data.

OpenSees handles a bounded planar elastic beam-column model in SI units, one selected load combination, linear or geometric PDelta transformation, fixed supports and nodal/uniform loads. Results include global node displacements, reactions and member end forces. A versioned manifest binds the exact source JSON, generated deck, numerical tag mapping and every output file. Native results retain `computed-unvalidated` status; the adapter does not perform national-code design checks, assess supplied member criteria, certify a design, verify original 3D CAD, or implement STAAD/EPANET execution. PDelta semantics differ from the browser's initial-stress iteration.

## Deferred acceptance

Required later checks include compiler acceptance; schema creation/cascades/prune restrictions; mixed-owner permissions/session revocation; lost responses/idempotency; two-process claims and stale fencing; cancellation/timeouts/shutdown; storage rollback; scratch ownership/confinement and cleanup; malformed drawing/JSON/output rejection; actual LibreDWG fixture conversions and downstream drawing fidelity; and OpenSees version/load/sign/equilibrium benchmarks and source-bound browser reports. These checks require execution prohibited by the current instruction. No performance, format certification or production-readiness claim is made.
