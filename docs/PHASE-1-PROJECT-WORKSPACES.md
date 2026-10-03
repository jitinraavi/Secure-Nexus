# Phase 1 — Saved project workspaces

Phase 1 connects engineering, BIM/civil exchange and geometry workbenches to projects. Implementation is reviewed by source inspection only. No app, compiler, tests, builds, previews or database migrations were executed for this phase.

## Workflow

Open a workbench from a project card or editor toolbar, or select a project inside the workbench. Each project has three independent histories. Save creates an immutable workspace revision using the last observed workspace revision. Concurrent writes receive a conflict and retain local inputs. Refresh server metadata explicitly before saving those inputs as a subsequent revision. Reload and historical restore preserve changed local inputs as browser recovery copies first.

Workspace writes do not change CAD geometry or its revision. A source revision and stale-source badge identify the saved CAD model used by the workspace. Import linked editor model explicitly converts the current saved project and retains its conversion warnings. Owners/editors can save, upload, prune and remove unreferenced artifacts; viewers can load and download. The server rechecks session and membership inside each transaction, including after multipart reception.

| Workspace | Saved state |
| --- | --- |
| Engineering | Six module input drafts, active module, conversion settings, combination selection, warnings and per-module reports bound to their original inputs. Restore validates reports without running a solver. |
| BIM / civil exchange | Original IFC source, source-preserving names, IDS text/report selection, normalized survey samples, CRS/origin metadata, constraints and alignment. Calculated subset reports are rebuilt from validated inputs before setters commit restored state. |
| Geometry / rendering | Bounded scene or streaming manifest, tolerance, trace settings, calculation reports and latest completed PNG. Restore does not start rendering or request streaming chunks. |

Engineering uses existing planar structural and routed-MEP bridges. Structural loads remain empty and inferred supports require opt-in. IFC and geometry use existing exporter/importer subsets; editor envelopes are approximate coordination geometry. Project terrain origins are only added when recognized authored projected CRS metadata is present, with explicit notices. These bridges do not extend the underlying mathematical, CAD or geospatial support.

Attach original source files to the next revision when byte-preserving retention is needed. Importing normalized/sampled data does not automatically retain its original binary. Source artifacts download as exact raw bytes.

## Server storage

The router is mounted at `/api/projects/:projectId/workspaces`. `kind` is engineering, exchange or geometry.

| Method and suffix | Contract |
| --- | --- |
| `GET /:kind` | Current snapshot, bounded history and current project revision/role. |
| `PUT /:kind` | CAS save: base workspace revision, source revision, payload artifact ID and source artifact IDs. |
| `DELETE /:kind/history?beforeRevision=N` | Explicitly prune older history, preserving current snapshot. |
| `GET /artifacts?kind=...` | Artifact metadata and project capacity. |
| `POST /artifacts` | One multipart file and module-kind field; encrypted storage. |
| `GET /artifacts/:id` | Authorized raw-byte attachment download. |
| `DELETE /artifacts/:id` | Delete only artifacts unreferenced by all retained history; HTTP 204. |

AES-256-GCM protects SQLite artifact BLOBs, binding immutable owner/project/artifact IDs as authenticated data. Decryption checks raw-byte SHA-256 and supports the configured previous master key. Audit records contain metadata rather than contents. New tables cascade project deletion; existing CAD design JSON is unchanged.

Limits: 64 MiB per artifact, 256 MiB of raw artifact bytes and 128 artifacts per project, 16 source references per snapshot, and 32 retained revisions per kind. Capacity failure is explicit. Prune older revisions, then remove their unreferenced artifacts to free capacity. Failed saves attempt to remove newly uploaded orphan artifacts; interrupted responses can leave unreferenced files for explicit removal.

## Browser recovery

IndexedDB stores draft JSON, source references and pending file Blobs per authenticated user/project/kind and browser document. Tabs have separate slots. Recovery selection supports restore, export and explicit discard. Recovery ZIPs contain metadata and pending original files; they are exports, not an automatic ZIP-import contract. Invalid existing data is preserved and blocks new writes.

Writes and conditional acknowledgment deletion are serialized per slot. Navigation flushes the latest captured draft. Recovery is bounded to 16 copies and 256 MiB per user/project/kind. Quota/storage failures leave page inputs available for export with a warning. Local browser storage is **not encrypted at rest**. Browser eviction, private-mode quotas, or closing before a final IndexedDB transaction finishes can prevent recovery.

## Deferred acceptance

Source review covered API types, route ordering, permission checks, CAS transactions, encryption binding, artifact references, quotas and async context guards. Compiler and runtime checks remain pending under the user's no-run instruction.

Deferred gates: existing-database schema/cascade checks; byte round trips; module save/reload; simultaneous save conflicts; viewer/revoked access; navigation/tab recovery including files; pruning/quota reclamation; stale-source metadata; report/image restoration; and editor conversions. No native CAD interoperability, engineering correctness, performance measurement or production certification is asserted.
