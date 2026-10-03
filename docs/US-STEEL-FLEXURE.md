# US steel F2 braced major-axis yielding subset

`client/src/lib/usSteelFlexure.ts` supplies a bounded Phase 3 national-clause increment for compact, doubly symmetric, prismatic hot-rolled I sections bent about their major axis. It reports only the implemented yielding region, with externally reviewed classification and restraints. It does not establish complete beam resistance or US-code compliance.

## Primary references and implemented algebra

The inspected publisher-authored [AISC V16.0 companion design examples](https://www.aisc.org/media/kybevlwy/first-semester-design-examples-v160.pdf), Chapter F introduction and examples F/H, identify F1 factors `phi_b=0.90` and `Omega_b=1.67`, F2-1 plastic moment `Mn=Fy Zx`, and F2-5 `Lp=1.76 ry sqrt(E/Fy)`. The companion defines the yielding region `Lb<=Lp` and refers brace strength/stiffness to Appendix 6. The original publisher URL currently rejects direct retrieval; its cached publisher PDF extraction was inspected. The [AISC-authored ANSI/AISC 360-22 book artifact](https://welovesteelconstruction.ssi-steel.com/wp-content/uploads/2024/08/Specification-AISC-360-22_Specification-for-Structural-Steel-Buildings.pdf), revised September 2023, supplies the SI modulus `E=200000 MPa`. The [AISC announcement](https://www.aisc.org/news/aisc-releases-new-version-of-specification-for-structural-steel-buildings-ansiaisc-360-22/) identifies the edition.

The [AISC revisions/errata listing](https://www.aisc.org/aisc/publications/revisions-and-errata/) lists January 2025 and September 2026 errata. Their contents were not independently inspected or incorporated into these equations. Each authored check requires explicit amendment and errata applicability reviews. Those declarations must establish whether the inspected subset applies to the adopted project; the implementation does not silently reconcile later amendments.

The module derives `ry=sqrt(Iminor/Ag)` from supplied gross SI section properties. Within the implemented bracing region, `nominalF2CapacityNm=Fy*Zmajor`; `availableF2CapacityNm=0.90*Mn` for LRFD or `Mn/1.67` for ASD. Demand is the supplied maximum absolute major-axis moment. Values are never rounded before comparison. No guessed Cb, section classification, frame demand, brace capacity, or national load coefficient is inserted.

## Authored input contract

`parseUSSteelFlexureInput(unknown)` accepts version 1 and 1–100 uniquely identified `us-aisc360-f2` checks. Unknown fields, non-finite numbers, missing sources and unsupported declarations are rejected. `USSteelFlexureCheck` records:

- Identification, label, section-property source, load case and load/analysis source.
- `sectionType: "rolled-i"`, `prismatic: true`, `doublySymmetric: true`, `compactFlanges: true`, and `compactWeb: true`, with `classificationReviewSource` identifying the external **B4.1/Table B4.1b flexural compactness** review. Compression-element nonslender classification does not substitute for compactness.
- `sectionUnmodified: true` and `geometryReviewSource`, explicitly confirming no holes, copes, notches or other modifications requiring local/section-property reductions.
- `supportsRestrainedAgainstTwist: true`, `bracingStrengthStiffnessReviewed: true`, `bracingDirectionsReviewed: true`, and `bracingReviewSource`. Review covers support restraint, brace/connection strength and stiffness, and every compression-flange direction including moment reversal in the supplied load case.
- `restraintType: "compression-flange"` or `"twist"`. `bracingMode: "continuous"` requires `maximumUnbracedLengthM: 0`; `"discrete"` requires a positive maximum length between the reviewed bracing points. Zero length cannot silently represent absent discrete braces.
- `amendmentScopeConfirmed: true`, `amendmentReviewSource`, `errataApplicabilityReviewed: true`, and `errataReviewSource`.
- Gross `areaM2`, minor-axis `minorAxisInertiaM4`, major-axis `majorAxisPlasticSectionModulusM3`, and sourced specified minimum `steelYieldPa` (`value`, `unit: "Pa"`, `source`, optional `criterionId`). These are authored properties; section geometry is not reconstructed or classified by this module.
- Non-negative `demandMajorMomentNm`; explicit zero `demandAxialN`, `demandMinorMomentNm`, and `demandTorqueNm`. `designMethod: "LRFD"` requires `loadBasis: "factored"`; `"ASD"` requires `"service"` under the supplied applicable ASD combination. Shear is outside this flexural comparison and must be assessed separately.

Implementation bounds are area `1e-10..100 m²`, minor inertia `1e-16..1e6 m⁴`, plastic modulus `1e-15..1e4 m³`, yield `1e6..2e9 Pa`, unbraced length `0..10000 m`, and moment magnitude `0..1e12 N·m`. These are numerical input bounds, not standard-approved section/material ranges. Derived positive radii, lengths and capacities must be finite and at most `1e24`; utilization must be finite in `0..1e24`. Out-of-bound derived results are rejected before returning a report.

## Adoption and country behavior

`assessUSSteelFlexure(input,basis)` captures normalized source and basis. Calculation requires country `US`, the supported basis catalog version, project region and authority, named reviewer confirmation, non-empty unique criterion/standard IDs, and exactly one matching `us-aisc360` steel catalog entry with edition `2022`, publisher reference, adoption and amendments. Other countries and editions receive `unsupported-basis` and no beam results.

Optional steel-yield criterion IDs must match exactly one captured `frame` criterion in value, unit and source. A criterion referencing a standard requires one adopted standard, a clause, edition/adoption/amendment text and HTTPS reference; known catalog IDs must also match their country, code, domain, edition and publisher. Ambiguous or unresolved declarations do not choose the first match. Every general basis-completeness finding also gates calculation, including incomplete or cross-country additional adopted references. All findings are retained once in `basisIssues`; any issue yields `unsupported-basis` with no beam results.

## Result, unsupported region and restoration

`USSteelFlexureReport` always has `verification: "unverified"`, `compliance: "not-assessed"`, and implementation `AISC360-2022-F2-braced-yielding-v1`. Results retain the derived minor radius, limiting yielding length, authored maximum length, F1 factors and demand. `Lb<=Lp` returns `within-implemented-clause` or `exceeds-implemented-clause` with yielding capacity and utilization. `Lb>Lp` returns `unsupported-unbraced-scope`: both capacity fields, utilization and strength-comparison flag are null. Its bracing-region flag is false. A zero demand does not produce a pass outside the implemented region. Report status is `partial-subset` when any member has that unsupported scope, otherwise `assessed-subset`; basis rejection has `unsupported-basis`.

`validateUSSteelFlexureReport(value,source,basis)` is a restore-only boolean type guard. It checks exact normalized source/basis, adoption gates, scalar closed-form algebra, finite output bounds, null patterns, factors, capacities, utilization, method pairing, clause flags/status, and the exact warning/detail/exclusion lists. It never calls the assessor, beam routine or a solver. Persisted IEEE-754 values must match exactly; edited/rounded values cannot introduce a boundary pass. The assessor also checks its generated record against this same source-coherence contract before returning it.

`usSteelFlexureExample()` is an illustrative discrete-braced SI member; every authored classification, geometry, bracing, material, adoption and errata reference is explicitly marked for replacement with project review. It does not confirm a project design basis.

## Remaining acceptance and Phase 3 scope

F2 lateral-torsional buckling outside the yielding region, computed compactness/brace design, F13 modifications, shear, axial/biaxial/torsional interactions, connections/concentrated forces, stability, second-order effects, serviceability, material qualification, seismic detailing, fatigue/fire and complete beam/code certification remain unsupported here. Other section forms remain rejected. Source coverage of this increment cannot close all Phase 3 engineering scope.

No repository code, app, tests, builds, lint/typechecking or previews were executed. Later authorized acceptance should cover independent AISC yielding benchmarks, metric units, discrete/continuous bracing, exact `Lb=Lp` and immediately-above boundary behavior, zero/over-capacity demand, LRFD/ASD pairing, unsupported load/section declarations, country/adoption/criterion ambiguity, finite/derived-bound rejection, and mutations of every persisted strength/scope/status field. Latest applicable errata and project reviews also remain operational prerequisites.
