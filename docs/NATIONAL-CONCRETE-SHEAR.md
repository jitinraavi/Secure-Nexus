# IS 456:2000 ordinary rectangular beam shear subset

`client/src/lib/nationalConcreteShear.ts` implements a bounded source module for factored shear in an ordinary, nonseismic, uniform-depth rectangular reinforced-concrete beam with vertical stirrups. It requires an externally reviewed flexural design, continuing longitudinal tension steel, effective stirrup legs/anchorage and assessed section location. It does not calculate these prerequisites or claim complete beam design or national-code compliance.

The public APIs are `parseNationalConcreteShearInput(value)`, `assessNationalConcreteShear(input, basis)`, `validateNationalConcreteShearReport(value, source, basis)` and `nationalConcreteShearExample()`. Inputs use version 1 and 1–100 uniquely identified checks. The parser rejects unknown fields, missing declarations, holes in arrays, unsupported units, non-finite numbers and quantities outside documented product bounds. Each strength parameter contains an explicit Pa value, source and optional captured frame criterion ID. Geometry/actions have explicit SI field names and source/review declarations; concrete grade is the declared MPa grade M20/M25/M30/M35/M40/M45/M50.

## Verified source and adopted edition

The underlying sources are the original BIS-authored code and amendments, rather than a design tutorial:

- [BIS-authored IS 456:2000, April 2007 reprint with Amendments 1/2](https://law.resource.org/pub/in/bis/S03/is.456.2000.pdf), printed pages 47–48 and 72–74, clauses 26.5.1.5/.6 and 40.1–40.4, Tables 19/20. Amendment 1 corrects the uniform-depth nominal-stress formula to `Vu/(b*d)`.
- [BIS-authored book hosted by the Nepal government water-resources directorate](https://wriddodoti.gov.np/uploads/blog/20230331071217_IS-456-with-all-ammendments.pdf), printed page 48, confirms the complete minimum-stirrup equation and the 415 MPa strength cap. The publisher-authored text was inspected through its indexed page extract where the full PDF fetch timed out.
- [BIS/BSB-provided IS 456 book and appended Amendment 5](https://studylib.net/doc/28290884/456-2000-amd5-reff2021), title page identifies the fourteenth reprint as **August 2014**, incorporating Amendments 1–4; the book is marked reaffirmed 2021 and separately appends Amendment 5, **July 2019**. The inspected publisher-authored pages confirm the Table 20 values, vertical-stirrup formula, definitions and Table 19 continuity note. Amendment 5's replacement of 40.2.3.1 addresses solid slabs and earthquake/coupling-beam exceptions; this product excludes slabs and all seismic/coupling-beam demand.
- [BIS publisher catalog](https://www.bis.gov.in/know-your-standard/?lang=en) is the existing project catalog reference for the adopted `in-is456` entry. A catalog reference does not establish local adoption or absence of subsequent amendments.

These inspected artifacts do not establish that the implemented provisions are the complete current locally applicable code. The captured project basis must select country `IN`, current project catalog metadata and exactly one supported `in-is456` declaration matching code/domain/publisher reference and edition `2000`. Full project metadata, authority, local adoption, amendments, named reviewer and confirmation are mandatory. The input also requires an explicit review declaring the 2000 edition and amendment applicability. Incomplete metadata, duplicate/ambiguous identifiers and mismatched country/catalog/criterion references block assessment. A different country or edition receives an unsupported basis; no Indian coefficients are substituted.

## Calculations and trace

Let `Vu` be the externally reviewed **absolute** factored shear for the declared tension face, `b` the rectangular width, `d` the effective depth, `As` the continuing tension steel area, `Asv` the total effective stirrup leg area and `s` the spacing along the beam. All stresses below use Pa, lengths metres, areas metres squared and actions N.

| Provision | Implemented expression or bound |
| --- | --- |
| 40.1 uniform-depth nominal stress | `tau_v = Vu/(b*d)` |
| 40.2.1/Table 19 concrete strength | Externally supplied and reviewed `tau_c`; `Vc = tau_c*b*d` |
| Table 19 tension-steel percentage | `p = 100*As/(b*d)` with captured concrete grade column and row/bracket selection |
| 40.2.3/Table 20 maximum | M20: 2.8 MPa; M25: 3.1 MPa; M30: 3.5 MPa; M35: 3.7 MPa; M40 and above: 4.0 MPa |
| 40.4(a) stirrup contribution | `fyUsed = min(fy, 415 MPa)`; `Vus = 0.87*fyUsed*Asv*d/s` |
| Required stirrup contribution | `max(0, Vu - Vc)` |
| 26.5.1.6 minimum effective leg area | `Asv,min = (0.4 MPa)*b*s/(0.87*fyUsed)` |
| 26.5.1.5 maximum vertical spacing | `min(0.75*d, 0.300 m)` |
| Disclosed subset resistance | `min(Vc + Vus, tau_c,max*b*d)` |

The parser admits positive, sourced strength values; using stirrup steel with a declared strength above 415 MPa does not increase the effective strength used in these expressions. The module does not authenticate the steel material specification. Axial-force/concrete-strength enhancement and near-support enhancement are absent.

Table 19 resistance is deliberately **externally authored**. The input captures the reviewed grade column, actual lower/upper published percentage rows, selection type and review source. The implemented row grid is 0.15, 0.25, 0.50 and 0.75, then 1.00–3.00 at 0.25 increments. A tabulated-row declaration requires the computed percentage to equal that row; the lower boundary requires the 0.15-percent row for percentages at or below 0.15; the upper boundary requires the 3-percent row for percentages at or above 3. An intermediate externally reviewed selection requires the immediately adjacent bounding rows. The module does not calculate or prescribe linear interpolation, compare supplied resistance against the complete table, or claim authentication of source values. The supplied value cannot exceed the independently enforced Table 20 maximum. The externally reviewed longitudinal area must continue at least `d` beyond the assessed section; the Table 19 support-detailing exception is excluded.

Four flags independently assess maximum nominal stress, required stirrup contribution, minimum effective stirrup area and maximum spacing. `within-implemented-clauses` requires all four; a failed flag gives `exceeds-implemented-clauses`. Utilization describes only the disclosed subset resistance and can be below one while a detailing flag fails. It must not be interpreted as whole-member acceptance. Unsupported effects or missing scope prerequisites produce `unsupported-section`, explicit issues and no capacity/metrics/clause flags. Reports distinguish wholly supported, partly supported, wholly unsupported scope and unsupported basis; unassessed scope does not list implemented clauses as though they were evaluated.

## Explicit exclusions and persistence

This subset excludes axial force, torsion, variable-depth/flanged sections, deep beams, prestressing, slabs, punching, corbels, bent-up/inclined/mixed reinforcement, seismic/cyclic/coupling-beam design, IS 13920 detailing, the minor-importance minimum-reinforcement exception and all clause 40.5 enhancement/simplified section-selection procedures. Critical-section location and any remaining support-region checks stay with the external reviewer. Flexure, longitudinal reinforcement limits, development/bond, cover, stirrup hooks/leg configuration, side-face reinforcement, serviceability, durability, fire and whole-member governing resistance are not implemented here. The requirement to apply minimum stirrups even at small demand is a declared narrower product scope, not removal of the code's exception.

Reports capture parsed copies of the complete input and adoption basis and retain `verification: "unverified"` and `compliance: "not-assessed"`. Restoration rejects unknown nested fields, sparse arrays, changed source/basis, altered numbers/flags/status, fabricated supported scope and missing warnings/exclusions. It checks saved numbers against direct closed-form source arithmetic; it does not call the section assessor, solver or assessment API. Exact IEEE-754 equality is used for persisted calculations and flags so edited values close to a boundary cannot change acceptance. This is source coherence, not a security signature, benchmark or independent engineering verification.

The example includes illustrative declarations and values only. Its row trace uses an exactly represented 1.5625-percent geometry ratio and an externally authored strength between the M30 1.50/1.75-percent rows. A reviewed project basis and actual project reviews remain required. No application, tests, build, compiler, lint/typecheck, preview or numerical code was executed for this increment, in accordance with the user's source-only instruction.
