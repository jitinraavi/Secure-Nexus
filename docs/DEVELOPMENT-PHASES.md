# Development phases

Develop phases sequentially and push each coherent phase to `upgrade/r1-modeling-core`. Identify incomplete phases explicitly. The source-only constraint defers executable acceptance and live integrations; implementation and verified operation are separate statuses.

| Phase | Scope | Position |
| --- | --- | --- |
| 1 | Saved project workspaces: persistence, source artifacts, revisions, permissions, recovery and editor links. | Implemented; source-reviewed; executable acceptance pending. See [details](PHASE-1-PROJECT-WORKSPACES.md). |
| 2 | Shared durable jobs, DWG/CAD conversion and native solver/result workflows. | Implemented and source-reviewed. GNU LibreDWG 0.13.4 and planar OpenSees 3.8.0 contracts selected. Runtimes, isolation, applicable solver rights and executable acceptance remain deployment prerequisites. See [details](PHASE-2-DURABLE-NATIVE-JOBS.md). |
| 3 | Broader structural/material/load/design support and coordinated MEP analysis, using the country selected for each project. | Pending. India uses Indian standards; USA uses US standards; other countries need corresponding supported, editioned profiles. Country routing alone is not implementation of the design algorithms. |
| 4 | Broader BIM geometry/schema/IDS coverage and authoring exchanges. | Pending. Existing IFC subset remains available. |
| 5 | Production survey/civil formats, datums, terrain and authoring workflows. | Pending. Existing bounded studies remain available. |
| 6 | Scale/rendering scene production, streaming/editor integration and measured budgets. | Pending. Existing modules remain bounded and unmeasured. |
| 7 | Enterprise multi-host authority, identity and billing operations. | Pending. Existing topology limits remain documented. |
| 8 | Offline/PWA cached projects and queued artifacts/jobs with explicit conflicts. | Pending. Draft recovery is not an offline application shell. |
| 9 | AI photo rendering through provider jobs and versioned outputs. | Pending. Assistant planning is separate. |

Before starting a phase, assess account allowance and prerequisites. If a whole phase cannot be completed within available allowance, stop at the last completed phase and report its commit and the next phase. Missing provider/runtime information is a prerequisite, not evidence of exhausted credits.

Phase 2 establishes a converter's real CLI contract and pinned supported versions, a native solver/result contract, and a declared Linux isolation/resource-limit model. Original source fingerprints, units, stable IDs and assumptions are preserved; planar native results are not relabelled as verified original 3D model results. Operational acceptance requires execution against real fixtures once authorized.

The DWG path uses GNU LibreDWG's `dxf2dwg` and `dwg2dxf` programs with conservative R2000 output and fixed arguments. Autodesk credentials are unnecessary for this converter. LibreDWG uses GPLv3-or-later and documents compatibility/recovery limitations; conversion does not imply complete drawing fidelity. See the [GNU project](https://www.gnu.org/software/libredwg/), [program documentation](https://www.gnu.org/software/libredwg/manual/html_node/Programs.html) and [DXF limitations](https://www.gnu.org/software/libredwg/manual/html_node/DXF.html).

Phase 2 includes the hardened DXF writer, converter status/configuration, fixed native process handling, durable leases and cancellation, job/artifact references, project UI, and source-bound solver result parsing. These are delivered together as one coherent source phase. Native processing is disabled by default.

## Previous boundary - Phase 1

Phase 1 was completed and pushed as `bd72532f2991c46922f2e40e504d1d2d42713b7d`. Its executable acceptance gates remain deferred. That pass stopped before Phase 2; the new continuation implements Phase 2 above.

At the phase-boundary allowance check, the five-hour window was 73% used (27% remaining), and the weekly window was 11% used (89% remaining). Ordinary usage was allowed; purchased-credit balance was zero. This is not an exhaustion claim. Phase 1 consumed a substantial part of the current window, and the larger native-jobs/conversion phase cannot confidently be completed within its remaining allowance. The stopping decision preserves a coherent completed phase as requested.

## Current boundary - after Phase 2, 3 October 2026

Phase 2 source implementation is complete. The review covered typed client/server contracts, imports/call sites, native program documentation, SQL bindings and foreign keys, authorization, leases, cancellation, storage transactions, output structure and exact-source result parsing. No executable acceptance or native deployment was performed.

Development stops **before Phase 3**, preserving the requested whole-phase boundary. At the boundary assessment the five-hour allowance was 45% used (55% remaining), and the weekly allowance was 23% used (77% remaining). Ordinary usage was allowed; purchased-credit balance was zero. This is not an exhaustion claim. The full next phase includes broad structural materials, loads and design plus coordinated MEP and country-dependent standards. It cannot confidently be completed within that remaining window, so no partial Phase 3 implementation is included.

The user's clarified Phase 3 requirement is a **project-level country choice**: India selects Indian standards, USA selects US standards, and other countries select their corresponding supported standards. Implement a versioned country/region/code-edition profile registry and explicit project design basis, with local adoption/edition overrides and required site/material/system inputs. Preserve the selected basis in inputs, calculation traces, exported solver bundles, stored workspaces and native result provenance. Unsupported countries, checks or editions must remain explicit rather than silently defaulting to another country's design.

The complete phase must cover the planned broader structural analysis, steel/concrete materials and design, gravity/wind/seismic load combinations and drift, foundations/connections, and coordinated MEP assessments with their required equipment/protection data and traceable clauses/assumptions. Country selection alone does not determine wind/seismic hazard, soil conditions, local adoption, detailing or manufacturer data. Use authorized standards content and primary references for implementation; don't fabricate coefficients or claim code compliance from reference names. Keep runtime/reference-solution verification deferred while the no-run instruction remains active. Phases 4-9 retain the sequence above.
