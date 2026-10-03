# National structural clause subset

`client/src/lib/nationalStructuralChecks.ts` implements a bounded Indian rectangular singly reinforced beam calculation. This is a separate Phase 3 increment from the explicit-user-criteria screening module. It applies published coefficients after checking the captured project country/adoption declarations; it does not supply a complete national structural design engine.

## Inspected source and equations

The source is a [BIS-authored IS 456:2000 artifact](https://law.resource.org/pub/in/bis/S03/is.456.2000.pdf), April 2007 reprint including Amendments 1 and 2. PDF pages 28, 59, 81, 82 and 108 contain the inspected provisions. Clause 5.6.3 requires the steel elastic modulus to be 200 kN/mm², or exactly `200e9 Pa`; this named national subset rejects other modulus declarations. Clause 38.1 and Annex G-1.1 provide `T=0.87fy As`, `C=0.36fck b xu`, `xu=T/(0.36fck b)` and `Mu=C(d−0.42xu)`. The strain condition uses `εs=0.0035(d−xu)/xu >= fy/(1.15Es)+0.002`. The grade-specific `xu/d` limits are 0.53/0.48/0.46 for 250/415/500 MPa steel. Both the table and strain condition are enforced; the stricter limit governs. Clause 26.5.1.1 supplies `As,min=0.85e6 b d/fyPa` and `As,max=0.04 b D` in SI units.

## Source contract

`parseNationalStructuralInput(unknown)` accepts version 1 and 1–100 uniquely identified `in-is456-rectangular-beam` checks. Dimensions are metres, steel area m², concrete characteristic strength Pa, steel grade explicitly MPa, elastic modulus Pa and factored moment Nm. Concrete strength is bounded to 20–50 MPa and steel grade to exactly 250/415/500 MPa. All quantities must be finite; unknown fields are rejected.

Every check declares geometry, load-case/factored-load and material sources. The steel modulus has its own source and optional exact link to a unique captured frame criterion, which must also declare `200e9 Pa`. Other material moduli remain available in the separate supplied-criteria screening module. The author must explicitly declare a rectangular beam, bonded tension reinforcement, plane-section behavior, `deepBeam: false`, zero axial force, zero compression reinforcement, no moment redistribution and the intended tension face. These are reviewed section assumptions; the module does not classify span/support behavior from CAD. A change of bending direction requires the corresponding reinforcement arrangement and effective depth to be entered; signed reversal is not silently folded into the same input.

Required `amendmentScopeConfirmed` and `amendmentReviewSource` fields record the author's review of adopted amendment applicability against this inspected artifact. They are declarations, not an automatic reconciliation of amendments. The example identifies its values and declarations as illustrative and requires project review before use.

## Country and adoption gates

`assessNationalStructure(input,basis)` captures normalized source and basis. Calculation requires country `IN`, the supported basis-catalog version, declared region and authority, named reviewer confirmation, unique basis standard/criterion IDs, and exactly one matching `in-is456` concrete reference with edition `2000`, publisher URL, local adoption reference and amendments declaration. Incomplete applicable adoption metadata returns `unsupported-basis` with no Indian evaluation. Other editions, USA and other-country selections are explicitly unsupported by this first module; no country falls back to Indian equations. General basis-completeness issues are also reported.

## Scoped results

Each result records intermediate section quantities and individual checks for neutral-axis depth, tensile strain, reinforcement limits and supplied factored moment. The reported overall status is `within-implemented-clauses`, `exceeds-implemented-clauses` or `unsupported-section`. An overreinforced or non-yielding-strain section receives no moment capacity or utilization. No provisional yielding capacity is displayed as an accepted result.

Every report declares `verification: "unverified"` and `compliance: "not-assessed"`. These statuses remain true even when every implemented comparison passes. Shear/torsion, axial interaction, prestress, compression steel, non-rectangular/deep-beam behavior, seismic detailing, redistribution, development/bond, spacing/cover, side-face reinforcement, cracking/deflection, durability and fire checks remain excluded. Factored load combinations and local amendment compatibility are supplied and reviewed externally.

`validateNationalStructuralReport(value,source,basis)` checks strict report fields, finite/bounded results, section identifiers, expected clause records, supported-country gates and exact captured source/basis identity. It also verifies every saved metric, capacity, utilization, null pattern and clause flag against closed-form source algebra, and requires the original basis issues to match current metadata gates. Stored IEEE-754 values must match the source algebra exactly; rounding or editing a capacity cannot introduce a pass near a clause boundary. This validator never calls the assessment/section routine, an iterative analysis or a solver. Stored reports remain unverified calculation records, not signed proof.

## Deferred acceptance and US extension

No app, tests, builds, lint/typechecker, previews or repository calculations were run. Independent benchmarks are required for each supported steel grade, the rounded table/strain boundary, minimum/maximum reinforcement, overreinforced rejection, capacity comparisons, country/adoption rejection and persisted-report restoration. TypeScript compilation remains unverified.

A separate [US AISC 360-22 E3 module](US-STEEL-COMPRESSION.md) follows the inspected AISC-authored 2022 artifact. It retains its own US adoption/errata gates and does not alter Indian equations. Referenced material criteria in either national module require complete unique adopted references, including country/catalog identity where registered. Further national clauses and complete Phase 3 design remain tracked separately.
