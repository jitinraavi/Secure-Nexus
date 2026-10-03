# Authored Indian wind-pressure subset

`client/src/lib/nationalWindLoads.ts` calculates pressure from reviewed supplied values. It does not select a site speed or coefficient and does not certify wind-code compliance. The workbench must receive a confirmed country/adoption basis before this module issues results.

## Input and public API

- `parseNationalWindInput(value: unknown): NationalWindInput` rejects unknown fields, implicit units, duplicate identifiers, invalid normals and out-of-bounds numbers. It permits explicit unconfirmed declarations so draft inputs can be saved without a calculation.
- `assessNationalWind(input, basis): NationalWindReport` checks adoption and scope, then calculates only the supported pressure/surface arithmetic. It does not call a structural analyzer or native solver.
- `validateNationalWindReport(value, source, basis)` restores a report only when its captured source, basis, status, warnings and exact source-bound arithmetic match. It never calls `assessNationalWind` or a solver.
- `nationalWindExample()` supplies illustrative editable shape/units. All review confirmations are false. Its numbers are not site hazards, recommended coefficients or code-selected defaults.

Supply SI quantities as `{ value, unit, source, standardId?, clause?, criterionId? }`. A standard ID and clause travel together. A criterion reference must match one unique captured `frame` criterion, including its value, unit, source and standard/clause. Scalar criteria cannot stand in for a vector. Units are exactly `m/s`, `m`, `Hz`, `1` and `m2`; outputs identify Pa and N explicitly.

The project must adopt the exact Indian catalog entries `in-is875-3` / IS 875 (Part 3):2015 and `in-nbc` / NBC-SP 7:2016, with their catalog publishers, local authority/adoption and amendment declarations. The wind amendment declaration must include 2016 and 2020. The same named basis reviewer confirms the authored wind review. Every wind factor and signed coefficient cites the adopted wind standard and its actual clause/table/row. Sources remain authored declarations whose correctness requires professional review.

The review explicitly records reconciliation of Amendments 1:2016 and 2:2020, any additional locally applicable amendment, and either NBC 2016 Part 6/Section 1 Figure 1 or Amendment 2:2020 Annex A as the basic-speed source. No map is bundled. The original 2015 map cannot be selected. Later algorithm changes are not implemented merely because their names appear in review metadata.

## Arithmetic and scope

Clause 6.3 gives `Vz = Vb k1 k2 k3 k4`; clause 7.2 gives `pz = 0.6 Vz²` and `pd = max(Kd Ka Kc pz, 0.70 pz)`. Speed uses m/s and pressure Pa. Local-pressure coefficients and cyclone regions require `Kd=1`. Surface action follows clause 7.3.1: `(Cpe-Cpi) pd A`, acting along the supplied inward global XYZ unit normal for positive values and outward for negative values. These equations were read in the [BIS-authored original OCR](https://archive.org/stream/gov.in.is.875.3.2015/is.875.3.2015_djvu.txt) and [readable BIS publication mirror](https://studylib.net/doc/27669135/is-875-part-3---2015).

This implementation limits buildings to below 20 m, requires height/minimum lateral dimension at most 5 and first-mode frequency at least 1 Hz, and requires an external review declaring no additional dynamic investigation. The height restriction is a deliberate product bound. Completed ordinary onshore buildings only are accepted; special/unusual conditions, unresolved torsion and required interference treatment withhold results. These screening bounds do not prove static applicability: the supplied review must also cover flexible components and special behavior under clauses 1.3 and 9.1. Sources for geometry, modal frequency, cyclone status, torsion and dynamic/interference decisions are captured.

`k2` is supplied for the evaluation height above mean ground level. Below 10 m, its source must reflect the reviewed 10 m reference; `factorReferenceHeightM` reports `max(z,10)`. The optional sub-10 m framing-pressure reduction is excluded. `Ka` selection must cover its intended tributary area/application; the application neither derives that area nor interpolates Table 4. Coefficient source/review must identify the applicable amended row, geometry, enclosure, sign case and direction. Local coefficients may produce only `local-component` actions, never an overall structural action.

`Kc` must be exactly 1. The narrowly conditioned 0.90 reduction under clause 7.3.3.13 is deliberately excluded. `Kd` accepts reviewed values from 0.9 to 1, `Ka` from 0.8 to 1 and `k3` from 1 to 1.36; mandatory local/cyclone restrictions still apply. Other numeric limits are product bounds for bounded input, not automatic national coefficient selection. Factors and any reductions require an explicit sourced selection confirmation. The data contract supports at most 40 pressure rows, 40 surfaces per row and 200 surfaces total; all pressure/surface IDs are globally unique.

The [2016 BIS amendment](https://archive.org/download/gov.in.is.875.3.2015/zIS875:Part3Amd.1:2016.pdf) changes area interpolation wording and coefficient tables. The [2020 BIS amendment](https://archive.org/download/gov.in.is.875.3.2015/zIS875:Part3Amd.2:2020.pdf) deletes the original map, changes references to the NBC 2016 map and replaces Annex A. Their adoption/review is therefore mandatory even though no table/map selection is automated.

## Outputs, persistence and exclusions

Reports capture detached normalized inputs and basis; pressure results contain the unmodified pressure, factor product pressure, minimum pressure, governing pressure and minimum-rule indicator. Optional surfaces retain exact source IDs, signed coefficient/pressure/force and global vectors. A tie reports the factor product as governing (`minimumPressureGoverns` is false). Unsupported basis or scope returns no pressure results. Flags remain `verification: "unverified"` and `compliance: "not-assessed"`.

Restoration checks exact finite numbers against the captured input algebra, and rejects changed IDs, units, normals, factors, pressure floors, signs, vectors, status or basis. JSON serialization does not replace the required report validation. This correspondence check is not proof of an authentic professional review.

Hazard lookup, coefficient selection, terrain/area interpolation, enclosure classification, dynamic/gust/across-wind response, interference/shielding, offshore/special structures, construction/icing and automatic torsion remain outside scope. Surface application points, load distribution to frame nodes, whole-building patterns, opposite directions, combinations, resistance and full wind-code design are not generated. Transfer into structural load authoring requires separately reviewed mapping and every necessary direction/sign case.

No app, repository calculations, tests, builds, lint/typecheck or previews were executed. Independent formula, units/sign, minimum-pressure, scope/amendment gates, restore-tampering and integration acceptance remain deferred under the source-only constraint.
