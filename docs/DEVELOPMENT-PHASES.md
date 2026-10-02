# Development phases

Develop phases sequentially and push each coherent phase to `upgrade/r1-modeling-core`. Identify incomplete phases explicitly. The source-only constraint defers executable acceptance and live integrations; implementation and verified operation are separate statuses.

| Phase | Scope | Position |
| --- | --- | --- |
| 1 | Saved project workspaces: persistence, source artifacts, revisions, permissions, recovery and editor links. | Implemented; source-reviewed; executable acceptance pending. See [details](PHASE-1-PROJECT-WORKSPACES.md). |
| 2 | Shared durable jobs, DWG/CAD conversion and native solver/result workflows. | Not started. User selected DWG without an Autodesk licence; LibreDWG is the proposed open-source converter. Native solver target/runtime remains unspecified. |
| 3 | Broader structural/material/load/design support and coordinated MEP analysis. | Pending Phase 2 targets and declared design basis. |
| 4 | Broader BIM geometry/schema/IDS coverage and authoring exchanges. | Pending. Existing IFC subset remains available. |
| 5 | Production survey/civil formats, datums, terrain and authoring workflows. | Pending. Existing bounded studies remain available. |
| 6 | Scale/rendering scene production, streaming/editor integration and measured budgets. | Pending. Existing modules remain bounded and unmeasured. |
| 7 | Enterprise multi-host authority, identity and billing operations. | Pending. Existing topology limits remain documented. |
| 8 | Offline/PWA cached projects and queued artifacts/jobs with explicit conflicts. | Pending. Draft recovery is not an offline application shell. |
| 9 | AI photo rendering through provider jobs and versioned outputs. | Pending. Assistant planning is separate. |

Before starting a phase, assess account allowance and prerequisites. If a whole phase cannot be completed within available allowance, stop at the last completed phase and report its commit and the next phase. Missing provider/runtime information is a prerequisite, not evidence of exhausted credits.

Phase 2 needs a converter's real CLI/API contract and supported versions, native solver/version and result contract, and a declared isolation/resource-limit model. Preserve original source fingerprints, units, stable IDs and assumptions; do not relabel planar native results as verified original 3D model results. Operational acceptance requires execution against real fixtures once authorized.

The proposed DWG path uses GNU LibreDWG's `dxf2dwg` and `dwg2dxf` programs with conservative R2000 output and fixed arguments. Autodesk credentials are unnecessary for this converter. LibreDWG uses GPLv3-or-later and documents compatibility/recovery limitations; conversion does not imply complete drawing fidelity. See the [GNU project](https://www.gnu.org/software/libredwg/), [program documentation](https://www.gnu.org/software/libredwg/manual/html_node/Programs.html) and [DXF limitations](https://www.gnu.org/software/libredwg/manual/html_node/DXF.html).

Full Phase 2 includes hardening the existing DXF writer, converter status/configuration, fixed native process handling, durable leases and cancellation, job/artifact references, project UI, and source-bound solver result parsing. These are one coherent phase; none of this phase's implementation has been started alongside Phase 1.

## Stop point — 3 October 2026

Phase 1 implementation is complete by source inspection and ready for its branch commit. Its executable acceptance gates remain deferred. Development stops **before Phase 2**; no partial Phase 2 code is included.

At the phase-boundary allowance check, the five-hour window was 73% used (27% remaining), and the weekly window was 11% used (89% remaining). Ordinary usage was allowed; purchased-credit balance was zero. This is not an exhaustion claim. Phase 1 consumed a substantial part of the current window, and the larger native-jobs/conversion phase cannot confidently be completed within its remaining allowance. The stopping decision preserves a coherent completed phase as requested.

Resume with Phase 2: first establish the native solver/version/result contract and isolation model, then develop durable project jobs, DXF hardening and the LibreDWG converter/UI together. Keep native execution and deployment verification deferred while the no-run instruction remains active.
