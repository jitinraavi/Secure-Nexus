# Development phases

Develop phases sequentially and push coherent modules to `upgrade/r1-modeling-core`. The user's latest instruction authorizes incremental delivery across usage windows and scheduled continuation after allowance refreshes. Identify incomplete phases explicitly. The source-only constraint defers executable acceptance and live integrations; implementation and verified operation are separate statuses. See [continuation handoff](DEVELOPMENT-CONTINUATION.md).

| Phase | Scope | Position |
| --- | --- | --- |
| 1 | Saved project workspaces: persistence, source artifacts, revisions, permissions, recovery and editor links. | Implemented; source-reviewed; executable acceptance pending. See [details](PHASE-1-PROJECT-WORKSPACES.md). |
| 2 | Shared durable jobs, DWG/CAD conversion and native solver/result workflows. | Implemented and source-reviewed. GNU LibreDWG 0.13.4 and planar OpenSees 3.8.0 contracts selected. Runtimes, isolation, applicable solver rights and executable acceptance remain deployment prerequisites. See [details](PHASE-2-DURABLE-NATIVE-JOBS.md). |
| 3 | Broader structural/material/load/design support and coordinated MEP analysis, using the country selected for each project. | Bounded source increments delivered. 3D frames and supplied load/drift/material/foundation/MEP methods; Indian IS 456 flexure/shear, Table 18 recipes and authored wind/seismic actions; US AISC E3 compression, braced F2 yielding, nonslender G2 web shear and bearing-type bolt rupture/interaction subsets; authored steady-state HVAC thermal duties; and identified US D/L gravity rows are implemented. Complete national hazards/combinations, governing limit states and detailing remain explicit unsupported scopes; executable acceptance is deferred. |
| 4 | Broader BIM geometry/schema/IDS coverage and authoring exchanges. | Finite supported source contract implemented: bounded identity-origin mapped geometry, direct type-property inheritance, primitive/direct-SI IDS checks, declared engineering exchange provenance and exclusive direct-occurrence unitless scalar authoring. Broader representations, compound/conversion units and full IFC/IDS conformance remain explicit exclusions; executable acceptance is deferred. |
| 5 | Production survey/civil formats, datums, terrain and authoring workflows. | Finite supported source contract implemented: bounded LAS (E)VLR/GeoKey/WKT retention, explicit survey unit/axis/vertical-datum gates and captured advanced civil JSON/LandXML exchange. Unsupported reference systems/native geometry and full format conformance remain excluded; executable acceptance is deferred. |
| 6 | Scale/rendering scene production, streaming/editor integration and measured budgets. | Finite named source contract implemented: bounded exact partition production, visible-editor source file workflow, prepared project saves, protected references, source/revision gates, hash-verified recovery/streaming and cancellation/cleanup. Measured scale and executable acceptance remain deferred. |
| 7 | Enterprise multi-host authority, identity and billing operations. | Pending. Existing topology limits remain documented. |
| 8 | Offline/PWA cached projects and queued artifacts/jobs with explicit conflicts. | Pending. Draft recovery is not an offline application shell. |
| 9 | AI photo rendering through provider jobs and versioned outputs. | Pending. Assistant planning is separate. |

## Finite remaining source boundaries

The delivery target is the named supported contract in each phase, with unsupported scopes explicit. An indefinitely expanding implementation of every national provision is not an acceptance criterion. Operational prerequisites and the prohibited executable acceptance remain separate from missing source work.

| Phase | Next source acceptance boundary |
| --- | --- |
| 3 | Supported US G2 shear, authored steady-state HVAC thermal/equipment duties and primary-sourced US basic gravity recipes are implemented. Preserve country/basis/source and unsupported actions, national checks and complete member-design exclusions. These increments do not provide complete national engineering design. |
| 4 | Existing direct-occurrence unitless scalar authoring and nine supported direct-SI measure comparisons are implemented with original STEP records/GlobalIds retained. Add/delete, shared/inherited property mutation, compound/conversion units, ambiguous inheritance and full IFC/IDS certification remain explicit exclusions. See [measure scope](IFC-SI-MEASURES.md). |
| 5 | Supported LAS CRS/(E)VLR and authored vertical-datum/elevation-unit metadata are retained without invented transformations. Captured advanced civil inputs exchange through bounded native LandXML and round-trip source JSON. See [survey scope](SURVEY-CRS-DATUM.md) and [civil scope](ADVANCED-CIVIL-EXCHANGE.md); full conformance and numerical/interoperability acceptance remain deferred. |
| 6 | Produce geometry chunks/manifests from existing scenes and integrate authenticated source/revision-bound artifacts into workspaces/editors, including retention, cancellation and resource bounds. Measured scale remains deferred. |
| 7 | Document and enforce a central API authority topology for secondary hosts; add tenant-scoped paid-seat entitlement and idempotent payment transitions. OIDC/Redis/payment configuration and live acceptance remain deployment prerequisites. |
| 8 | Actual offline application shell, account-scoped project cache and immutable artifact/job queues with revision conflicts, storage bounds, logout isolation and permission rechecks. Existing draft recovery/issue-board support is not this contract. |
| 9 | Declared image-provider contract, configuration-gated durable rendering jobs and versioned source/prompt/model/output artifacts. Preserve originals and expose unconfigured/failed states; provider deployment and executed acceptance remain deferred. |

This table is a bounded implementation sequence, not a claim these remaining sources already exist or operate successfully.

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

## Previous source boundary

This window pushed `912a10f09c7aa738416a2ac1c56069151274aa1f` (loads/structural/MEP), `dc1f784ed6eb79bc9bf113465e94650ea4893921` (Indian clauses/recipes), and `aa34f0196b015c89d3dc4c6a7699ffe9b3695e39` (US E3). Their Git blobs, parent chain and branch updates were verified. The [next wind-module handoff](WIND-MODULE-SOURCE-HANDOFF.md) preserves primary references, including the amended map, and the required source/applicability contract. No unfinished wind-generator source was left in the mirror. Phase 3 remains in progress; subsequent phases remain pending. Account usage was 90% of the five-hour window and 45% weekly at this assessment; ordinary usage was still allowed. This boundary reserves enough allowance for coherent final verification rather than claiming exhausted credits or a completed whole phase.

## Authored wind, seismic and US bending increment

The refreshed-window continuation adds [Indian authored wind pressures](NATIONAL-WIND-LOADS.md), [Indian equivalent-static floor actions](NATIONAL-SEISMIC-LOADS.md) and [US braced steel yielding](US-STEEL-FLEXURE.md). Workspace version 6 retains versions 1-5, their original drafts and captured reports; restoration checks the new source-bound formulas without invoking an assessment routine or solver.

The wind subset requires the amended hazard references, reviewed supplied speed/factors/coefficients and explicit ordinary low-rise static applicability. Dynamic/gust response and map/table selection remain unsupported. The seismic subset conservatively intersects the declared 2016 regular, low-rise Zone II static exception with short-period and other product scope gates, retaining computed/minimum/adopted base force and signed floor actions. Torsion, modal/directional analysis, load combinations and member/node distribution remain external. The AISC F2 subset requires reviewed compactness and bracing and produces no bending capacity for `Lb>Lp`.

These are source increments. Full national hazard/combination, material/detailing/MEP coverage and executed acceptance remain incomplete. Phase 3 retains its in-progress position; later phases have not been declared complete by these additions.

## Concrete shear and US bolt increment

[Indian ordinary rectangular beam shear](NATIONAL-CONCRETE-SHEAR.md) enforces the implemented IS 456 maximum-stress, vertical-stirrup contribution, minimum-area and maximum-spacing clauses. Concrete resistance is an externally reviewed Table 19 value with a grade/row trace tied to the computed tension reinforcement percentage; no tabulated resistance or interpolation rule is fabricated. Axial force, torsion, seismic/cyclic demands, deep beams and other unsupported scopes receive no subset resistance.

[US bearing-type bolt rupture and interaction](US-STEEL-BOLT-CONNECTIONS.md) uses supplied, reviewed AISC 360-22 Table J3.2 stresses and individual bolt demands for the scoped J3.6/J3.8 checks. LRFD and ASD remain distinct, including the combined tension/shear adjustment. Unsupported bolt groups, demand conventions and connection effects are rejected or reported without accepted resistance. This does not establish a complete connection design.

Workspace version 7 adds both inputs and their source-bound captured reports while retaining versions 1-6. Restoration validates scalar formulas and flags directly without invoking an assessor or solver. Compilation, numerical benchmarks, source authentication and engineering acceptance remain deferred; these bounded modules do not complete Phase 3.

## BIM exchange increment, 4 October 2026

[Mapped geometry and typed IDS metadata](IFC-IDS-EXTENSIONS.md) add bounded uniform 3D mapped instances with identity mapping origins, compatible direct type-property inheritance with occurrence overrides, primitive scalar/enum distinctions and literal typed information checks. Unsupported geometry or ambiguous metadata remains explicit and original STEP is preserved. This is representation coverage, not complete IFC schema validation or IDS certification.

[Engineering exchange declarations](EXCHANGE-ENGINEERING-PROVENANCE.md) retain country/adoption metadata in coordination JSON, custom IFC project properties, DXF comments, PDF sheet declarations, standalone JSON and structural solver exchanges. Imported file geometry copies its declaration; legacy undeclared files clear prior analytical adoption with a visible warning. Historical declarations remain recoverable while current catalog findings are shown separately. No supports, actions, material properties, code compliance or certified results are inferred from a declaration.

Source review and pushed Git blob comparison are the acceptance available under the user's constraint. IFC/DXF/PDF interoperability, compiler checks and numerical/rendered geometry verification remain deferred. Phase 3 continues with its remaining supported modules; this saved exchange increment starts Phase 4 without declaring either full phase complete.

## US stocky-web shear increment

[AISC G2.1(a) stocky rolled-web shear](US-STEEL-SHEAR.md) computes the slenderness branch directly from sourced dimensions and yield strength. Within scope it uses the published web area, yielding expression and distinct LRFD/ASD exception factors. Above the branch limit it returns no capacity, utilization or substitute factors; combined actions and other member/connection limit states remain separate.

Workspace version 8 adds this module with versions 1-7 retained. Its strict captured source/basis report restoration checks scalar algebra and null scope directly, without an assessor or solver. Independent source review found no blocking inconsistency. Compilation, numerical reference solutions and later errata reconciliation remain unverified. This adds a supported US clause subset without completing broader Phase 3 national design.

## Authored HVAC thermal increment, 4 October 2026

[Steady-state zone thermal duty](HVAC-THERMAL-LOADS.md) balances sourced UA, dry-air exterior exchange, sensible gains and moisture-equivalent latent gains at one authored condition. Four separate cooling/heating/dehumidification/humidification duties prevent opposite demands from cancelling into an equipment pass. Supported sensible supply flow combines the thermal requirement with an independently mapped total terminal flow minimum. Optional exact-condition simultaneous equipment capacities must satisfy sensible duty, latent duty and airflow independently; sensible credit is capped by the available air-flow heat transfer.

Any complete selected-country basis may use these physical relationships with authored properties. Every national ventilation, envelope/climate, energy, comfort and mechanical-code check remains explicitly unsupported. Mixed duties, dynamic peaks, psychrometric functions, central/DOAS allocation and complete system sizing are excluded. Strict source/basis snapshots and direct scalar restoration preserve these boundaries. Engineering workspace version 9 adds this module while recovering versions 1-8 without analysis. No executable acceptance was performed; US gravity recipes and Phases 4-9 remain pending at this increment.

## US basic gravity increment, 4 October 2026

[Authored US D/L recipes](US-GRAVITY-LOAD-RECIPES.md) generate two identified ASCE/SEI 7-22 rows for the selected LRFD or ASD method. Sourced nominal D and occupancy L map exactly two cases; roof live, snow and rain must be declared absent in the reviewed subsystem. The source, original combinations, US adoption, amendment/errata review and excluded actions remain captured. Direct restoration verifies factors and unchanged frame data without analysis. Copying the generated frame creates an independent editable draft, with method-specific limits exposed.

Engineering workspace version 10 restores versions 1-9 without recalculation. The latest publisher errata full text could not be accessed; reconciliation remains an explicit external requirement. This completes the finite named Phase 3 source increment sequence while broader hazards, action patterns, governing limit states, detailing, national MEP compliance and executable acceptance remain unsupported or deferred. The next missing source contract is Phase 4 typed single-value authoring and declared supported-unit comparisons; Phases 4-9 are not complete.

## Existing IFC property authoring increment, 4 October 2026

[Exclusive occurrence property edits](IFC-PROPERTY-AUTHORING.md) change only the nominal token of an existing unitless text/boolean/integer/real property. Exact property-set/name identity, unique source GlobalId, direct occurrence ownership and whole-source reference scans reject shared, inherited, ambiguous, unresolved and unit-bearing targets. Every other source token remains intact; new/deleted/unset/type-changing properties are outside this increment.

Exchange workspace version 2 preserves the original imported IFC and a separate raw edit draft; version 1 restores an empty draft. IFC/metadata exports and IDS checks apply the same edits and names. Editing either clears prior reports, and saved IDS recovery evaluates the same authored source. Original IFC export remains available. Unicode/scalar parsing, token ranges, ownership and persistence were reviewed by inspection only. Supported SI measure comparison remains the next Phase 4 module; Phases 4-9 and executable acceptance remain incomplete.

## Supported IFC SI comparison increment, 4 October 2026

[Nine scalar measure types](IFC-SI-MEASURES.md) now normalize declared direct SI units for IDS literals. Explicit property units override uniquely resolved project defaults; area/volume prefixes and GRAM-to-kg conversion preserve dimensional meaning. Positive type domains, exact schema availability, complete STEP marker roles and bounded finite factors are checked from retained source. Unsupported unit graphs remain incomplete before applicability filtering. Float equality follows the published strict IDS rounding band; integers, strings and booleans stay exact. Original values, units and property authoring limits remain unchanged. The finite supported Phase 4 contract is source-implemented; compilation, numerical boundaries and full IFC/IDS certification remain unverified or excluded. Phase 5 is next.

## Survey coordinate declaration increment, 4 October 2026

[Survey source metadata](SURVEY-CRS-DATUM.md) retains bounded LAS projection VLR/EVLRs, WKT/GeoKeys, vertical reference identities and diagnostics. Persisted summaries are re-derived from retained definitions. Imported heights keep their source units until the authored terrain declaration passes; supported length factors normalize units while CRS/datum conflicts and unsupported transformations block terrain use.

Exchange workspace version 3 retains the raw coordinate declaration and metadata. Versions 1/2 recover inputs and require a declaration before rebuilding previous terrain/civil results. Project-imported terrain already uses metres and cannot be relabelled with feet. Surface/drainage exports retain declaration/source factors and unchanged datum provenance. No binary files, geometry routines, compiler, tests or previews were executed; real survey interoperability and coordinate accuracy remain unverified. Advanced civil exchange is next.

## Captured advanced civil exchange increment, 4 October 2026

[Authored advanced civil exchange](ADVANCED-CIVIL-EXCHANGE.md) captures the exact alignment draft, copied normalized terrain, units, source factors and reference/origin/datum declarations. Source JSON round-trips independently of result claims. Calculated JSON, CSV and native LandXML use the same captured inputs. Native lines/arcs/bounded clothoids and parabolic PVI geometry preserve semantics; unsupported spirals/multiple-turn arcs fail explicitly, with source JSON retained. Section offsets become right-positive; incomplete sampling suppresses the entire LandXML section family with omitted counts and notices.

Workspace version 4 retains civil source snapshots and restores versions 1–3 drafts without fabricating historical reference declarations. Current survey/reference edits clear results. The separate WKT authority follow-up rejects unreconciled compound and conflicting projection-method authorities. This completes the finite named Phase 5 source contract. Actual LandXML XSD/consumer acceptance, binary interoperability, numerical accuracy and compilation remain unverified. Phase 6 scene production/editor integration is next.

## Exact geometry producer increment, 4 October 2026

[Geometry production](GEOMETRY-CHUNK-PRODUCTION.md) captures immutable canonical source bytes and SHA-256, preserves exact whole meshes/materials/camera/source IDs and partitions within bounded byte/decoded counts. Flat zero-error manifests describe exact partitions rather than invented simplified LOD. Cooperative cancellation and source fingerprint checks support stale-work rejection. Artifact binding verifies geometry kind, content hashes, byte counts and distinct IDs, then generates same-origin project routes and at most 16 protected source/chunk/provenance references.

This is a source library increment. Upload/capacity reservation, original raw files, workspace/editor controls, project/source-generation checks, reference retention, restore integration and rollback/conflict UI remain required next work. Existing streaming consumers stay available, and no performance, browser, compiler or executable acceptance has occurred. Phase 6 remains incomplete.
