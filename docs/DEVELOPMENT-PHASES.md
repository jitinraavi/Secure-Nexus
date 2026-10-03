# Development phases

Develop phases sequentially and push coherent modules to `upgrade/r1-modeling-core`. The user's latest instruction authorizes incremental delivery across usage windows and scheduled continuation after allowance refreshes. Identify incomplete phases explicitly. The source-only constraint defers executable acceptance and live integrations; implementation and verified operation are separate statuses. See [continuation handoff](DEVELOPMENT-CONTINUATION.md).

| Phase | Scope | Position |
| --- | --- | --- |
| 1 | Saved project workspaces: persistence, source artifacts, revisions, permissions, recovery and editor links. | Implemented; source-reviewed; executable acceptance pending. See [details](PHASE-1-PROJECT-WORKSPACES.md). |
| 2 | Shared durable jobs, DWG/CAD conversion and native solver/result workflows. | Implemented and source-reviewed. GNU LibreDWG 0.13.4 and planar OpenSees 3.8.0 contracts selected. Runtimes, isolation, applicable solver rights and executable acceptance remain deployment prerequisites. See [details](PHASE-2-DURABLE-NATIVE-JOBS.md). |
| 3 | Broader structural/material/load/design support and coordinated MEP analysis, using the country selected for each project. | In progress. Bounded 3D frames, supplied load/drift/material/foundation/MEP methods, Indian IS 456 flexure/Table 18 recipes and US AISC E3 flexural compression are implemented. National hazards/seismic combinations, broader limit states and detailing remain. |
| 4 | Broader BIM geometry/schema/IDS coverage and authoring exchanges. | Pending. Existing IFC subset remains available. |
| 5 | Production survey/civil formats, datums, terrain and authoring workflows. | Pending. Existing bounded studies remain available. |
| 6 | Scale/rendering scene production, streaming/editor integration and measured budgets. | Pending. Existing modules remain bounded and unmeasured. |
| 7 | Enterprise multi-host authority, identity and billing operations. | Pending. Existing topology limits remain documented. |
| 8 | Offline/PWA cached projects and queued artifacts/jobs with explicit conflicts. | Pending. Draft recovery is not an offline application shell. |
| 9 | AI photo rendering through provider jobs and versioned outputs. | Pending. Assistant planning is separate. |

Before starting or extending a module, assess account allowance and prerequisites. Preserve source and push coherent completed modules before allowance prevents progress; leave an exact handoff for the scheduled continuation. The previous whole-phase stopping rule was superseded by the user's instruction to continue across refreshed usage windows. Missing provider/runtime information is a prerequisite, not evidence of exhausted credits.

Phase 2 establishes a converter's real CLI contract and pinned supported versions, a native solver/result contract, and a declared Linux isolation/resource-limit model. Original source fingerprints, units, stable IDs and assumptions are preserved; planar native results are not relabelled as verified original 3D model results. Operational acceptance requires execution against real fixtures once authorized.

The DWG path uses GNU LibreDWG's `dxf2dwg` and `dwg2dxf` programs with conservative R2000 output and fixed arguments. Autodesk credentials are unnecessary for this converter. LibreDWG uses GPLv3-or-later and documents compatibility/recovery limitations; conversion does not imply complete drawing fidelity. See the [GNU project](https://www.gnu.org/software/libredwg/), [program documentation](https://www.gnu.org/software/libredwg/manual/html_node/Programs.html) and [DXF limitations](https://www.gnu.org/software/libredwg/manual/html_node/DXF.html).

Phase 2 includes the hardened DXF writer, converter status/configuration, fixed native process handling, durable leases and cancellation, job/artifact references, project UI, and source-bound solver result parsing. These are delivered together as one coherent source phase. Native processing is disabled by default.

## Previous boundary - Phase 1

Phase 1 was completed and pushed as `bd72532f2991c46922f2e40e504d1d2d42713b7d`. Its executable acceptance gates remain deferred. That pass stopped before Phase 2; the new continuation implements Phase 2 above.

At the phase-boundary allowance check, the five-hour window was 73% used (27% remaining), and the weekly window was 11% used (89% remaining). Ordinary usage was allowed; purchased-credit balance was zero. This is not an exhaustion claim. Phase 1 consumed a substantial part of the current window, and the larger native-jobs/conversion phase cannot confidently be completed within its remaining allowance. The stopping decision preserves a coherent completed phase as requested.

## Previous boundary - after Phase 2, 3 October 2026

Phase 2 source implementation is complete. The review covered typed client/server contracts, imports/call sites, native program documentation, SQL bindings and foreign keys, authorization, leases, cancellation, storage transactions, output structure and exact-source result parsing. No executable acceptance or native deployment was performed.

That pass stopped **before Phase 3** under the previous whole-phase rule. At its boundary assessment the five-hour allowance was 45% used (55% remaining), and the weekly allowance was 23% used (77% remaining). Ordinary usage was allowed; purchased-credit balance was zero. The later instruction to continue across usage refreshes authorizes the Phase 3 increments below.

The user's clarified Phase 3 requirement is a **project-level country choice**: India selects Indian standards, USA selects US standards, and other countries select their corresponding supported standards. Implement a versioned country/region/code-edition profile registry and explicit project design basis, with local adoption/edition overrides and required site/material/system inputs. Preserve the selected basis in inputs, calculation traces, exported solver bundles, stored workspaces and native result provenance. Unsupported countries, checks or editions must remain explicit rather than silently defaulting to another country's design.

The complete phase must cover the planned broader structural analysis, steel/concrete materials and design, gravity/wind/seismic load combinations and drift, foundations/connections, and coordinated MEP assessments with their required equipment/protection data and traceable clauses/assumptions. Country selection alone does not determine wind/seismic hazard, soil conditions, local adoption, detailing or manufacturer data. Use authorized standards content and primary references for implementation; don't fabricate coefficients or claim code compliance from reference names. Keep runtime/reference-solution verification deferred while the no-run instruction remains active. Phases 4-9 retain the sequence above.

## Current increment - Phase 3, 3 October 2026

CAD projects now retain an explicit engineering country, authority, adopted editions/amendments, site/material/load declarations and traceable numeric criteria. Built-in India and US publisher references are versioned metadata; other countries require their own custom references. Changing country clears prior adoption; concurrent edits choose one complete basis rather than mixing review confirmation with unreviewed fields.

Engineering workspaces upgrade to version 2 and retain the basis captured by each report. Version 1 reports remain recoverable with an undeclared basis and can be exported as previous results. Source or basis edits hide stale reports. Linked-project import explicitly copies the CAD basis. Exported solver bundles and planar native source/result manifests retain the exact declared basis; native code criteria remain unassessed.

The new 3D module implements bounded linear elastic prismatic beam frames with six degrees of freedom, explicit local axes, axial/torsional/biaxial stiffness, nodal and uniform loads, signed combinations, equilibrium checks and governing envelopes. User capacity screening uses a conservative chord-deflection bound. Unsupported nonlinearity, releases, springs and national-code resistance rules are rejected or explicitly excluded. No executable verification was performed. This increment does not complete Phase 3 or change the pending status of Phases 4-9.

The next coherent increment connects supported Community Editor structural exchange geometry to the 3D module. [3D model import](FRAME-3D-MODEL-BRIDGE.md) preserves global coordinates and line-member IDs with explicit A/Iy/Iz/J/E/G and orientation overrides, unrestrained supports by default, preserved source warnings and no inferred loads. Known wall/slab representatives are counted and omitted; unknown unsupported features reject the import. It produces an editable analytical template, not an accepted CAD/BIM analysis. Project import copies the saved country basis and workspace recovery retains the import settings.

## Load, structural design and coordinated MEP increment

[Load authoring and story drift](STRUCTURAL-LOAD-AUTHORING.md) records sourced tributary pressures, mass/acceleration forces, explicit member self-weight, signed case factors and node-pair drift criteria. It produces a bounded 3D model with source traces and selected-combination drift envelopes. Copying its generated frame creates an independent editable frame draft. National wind/seismic hazard and coefficients are not inferred.

[Structural screening](STRUCTURAL-DESIGN-CHECKS.md) supports gross steel stress and elastic Euler checks, rectangular RC strain-compatible flexure, biaxial rigid-footing full-contact pressures and equal-stiffness planar bolt-group demands. Material coefficients and limits are sourced inputs. Inelastic/combined compression, partial contact and omitted design limit states remain explicit rather than passing a complete design.

[Coordinated MEP](MEP-SYSTEM-ASSESSMENT.md) links authored water/air/fire terminals, one-driver duty paths, supplied catalog curves, motor efficiency/nameplate power, circuit power mappings and protection criteria. Nonconverged or inconsistent duties cannot pass; fire storage follows simultaneous demand and duration. National classification, wiring tables, thermal HVAC sizing and manufacturer approval remain unsupported.

Engineering workspace version 3 adds these three inputs and captured reports while recovering versions 1 and 2 without recalculation. Strict new-module parsers reject unsupported fields and ambiguous referenced criteria. Source review covers formulas, data contracts, finite limits and recovery; compilation, numerical fixtures and all executed acceptance remain deferred. Phase 3 remains in progress and Phases 4-9 retain their pending positions.

## Indian national clause increment

The [IS 456 flexure/reinforcement subset](NATIONAL-STRUCTURAL-CHECKS.md) evaluates declared rectangular singly reinforced ordinary beams with zero axial force, fixed code steel modulus, published stress-block/strain rules and reinforcement limits. Overreinforced/non-yielding scope receives no accepted capacity. [Table 18 gravity/wind recipes](NATIONAL-LOAD-RECIPES.md) generate sourced collapse and optional short-term serviceability factors against exactly mapped characteristic actions, without structural analysis or inferred hazards/directions.

Workspace version 4 adds these modules with legacy version 1-3 recovery. The country's matching adopted 2000 edition, reviewer and explicit amendment scope govern availability. US/other national algorithms, seismic/hazard generators and broader design/detailing remain required work; no Indian rules are substituted for another country. Every report remains unverified and whole-code compliance unassessed.

## US flexural-compression increment

[ANSI/AISC 360-22 E3](US-STEEL-COMPRESSION.md) calculates both principal-axis flexural buckling stress curves for declared nonslender prismatic rolled I sections under pure compression. Inputs explicitly pair LRFD with factored demand or ASD with the supplied applicable service-level combination. The US adoption, sources for classification/effective lengths and amendment/errata applicability review are retained. E4 and E1's complete minimum over applicable limit states remain excluded; the reported E3 strength is not a governing complete column resistance.

Workspace version 5 adds this separately scoped US input/report, preserves versions 1-4, and rejects inconsistent saved algebra or cross-country adopted criterion references. The inspected artifact revision is September 2023; later listed errata contents are not independently incorporated. Project reviewers must establish compatibility of the implemented subset with adopted amendments. All compilation, numerical and operational acceptance remains deferred.
