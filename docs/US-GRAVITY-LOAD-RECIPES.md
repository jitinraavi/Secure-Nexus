# Authored US D/L gravity recipe subset

`client/src/lib/usGravityLoadRecipes.ts` supplies an editable draft of two identified basic rows for a reviewed ASCE/SEI 7-22 gravity subsystem. It neither analyzes the frame nor decides which load effect governs. Every report remains `verification: "unverified"` and `compliance: "not-assessed"`.

| Method | Published clause / row | Generated factors |
| --- | --- | --- |
| LRFD | 2.3.1, 1a | 1.4D |
| LRFD | 2.3.1, 2a, with Lr/S/R declared absent | 1.2D + 1.6L |
| ASD | 2.4.1, 1a | D |
| ASD | 2.4.1, 2a | D + L |

Strength row 2a includes a roof-live, snow or rain companion action in the published provision. This implementation requires explicit absence of all three in the reviewed subsystem. L is authored occupancy live load, never roof live load. Applicable fluid and soil/water actions cannot be hidden in D or L; they require separate combinations. The clauses require review of unfavorable effects and absent loads; these two draft rows do not establish that review or full combination coverage. ASD rows do not provide general serviceability combinations or allowable-stress increases.

## API and authoring contract

- `parseUSGravityLoadRecipeInput(value)` validates and detaches authored input.
- `generateUSGravityLoadRecipes(input, basis)` generates the supported draft or an `unsupported-basis` report with a null draft and no combination traces.
- `validateUSGravityLoadRecipeReport(value, input, basis)` validates captured restoration against current input and basis by direct factor and model comparison. It never invokes the generator, assessor or solver.
- `usGravityLoadRecipeExample()` returns an illustrative authored shape. Replace its review declarations and source text with actual project evidence before use.

Input requires `version: 1`, `method: "LRFD" | "ASD"`, an explicit SI `model: FrameModel3D`, `modelSource`, `deadCaseId`, `imposedCaseId`, `deadLoadSource`, and `imposedLoadSource`. Exactly two distinct source cases must be mapped once each. Original combinations remain in the captured source; generated combinations replace them in the editable draft.

The six declarations `nominalActionsConfirmed`, `gravityScopeReviewed`, `roofLiveSnowRainAbsent`, `otherActionsExcludedAcknowledged`, `amendmentScopeConfirmed`, and `errataApplicabilityReviewed` must explicitly be true. Four non-empty sources capture scope, omitted-action, amendment and errata review: `scopeReviewSource`, `omittedActionReviewSource`, `amendmentReviewSource`, `errataReviewSource`. The caller confirms authored nominal D/L and method/material compatibility; the module cannot verify those external facts.

The basis must be the current country catalog profile, US, with complete region, authority, declarations, adopted standards, unique IDs and named reviewer confirmation. Exactly one adopted `us-asce7` reference must match the catalog loads domain, `ASCE/SEI 7`, edition `2022`, publisher URL, local adoption reference and reviewed amendment/supplement/errata declaration. Other countries, editions, duplicate ASCE declarations and incomplete metadata produce no draft. Any criterion standard reference must resolve to the complete adopted basis and identify its clause; fixed recipe coefficients cannot be overridden by criteria.

Unknown input, basis, trace, report and frame fields are rejected. Arrays must be dense and bounded. Plain JSON preflight rejects nonfinite numbers, omitted/coerced values, excessive depth/size and sparse nested frame arrays before detachment. The existing frame schema retains its geometric, material, load and identifier bounds; recipe factors are finite and directly compared with the published constants. Generated drafts retain all source frame data except combinations. Restoration rejects altered factors, missing/extra traces, source or basis changes, changed frame data, unsupported-basis output, fabricated status or nonfinite data.

The report captures `source`, `basis`, `basisIssues`, `implementedClauses`, `combinations`, `generatedFrameModel`, and scope `warnings`. Its status is `generated-subset` or `unsupported-basis`. Each trace carries the exact combination ID, method, clause, purpose, factors and publisher chapter URL. Editing the draft is an explicit new authoring step; the captured recipe report is not silently updated.

## Excluded work and validation state

No hazard lookup, automatic actions/self-weight, occupancy exceptions, impact, live-load reduction, spatial pattern, favorable/adverse demand, minimum dead load, absent-action enumeration, serviceability limit, structural analysis, resistance or compliance check is implemented. Wind, tornado, seismic, fluid, soil/water, ice, self-straining, extraordinary, integrity and all other actions require separate review and combinations. Declaring their exclusion does not determine whether they apply to the actual project.

Only source inspection was performed. No repository code, numerical calculation, build, typecheck, lint, test, app or preview was executed. Runtime behavior, compilation, independent engineering validation and project-specific adoption reconciliation remain unverified. The latest publisher errata metadata identifies April 21, 2026; its full text was inaccessible during this work, so current errata applicability must be reconciled externally rather than inferred from an older errata list.

## Primary authored sources

- [ASCE publisher's ASCE/SEI 7-22 page](https://www.asce.org/publications-and-news/asce-7) identifies the edition and official supplements/errata access.
- [Official ASCE Amplify Chapter 2, ISBN 9780784415788](https://amplify.asce.org/content/standard/9780784415788/part/provisions/standard-chapter/s2) is the captured publisher reference; full access required a subscription. The [official indexed strength version text](https://amplify.asce.org/popup-data?apath=%2Fasceworks%2Fstandard%2F9780784415788%2Fpart%2Fprovisions%2Fstandard-chapter%2Fs2%2Fstandard-sec-ver%2Fs2.3.1.ver.atom) corroborated current strength rows.
- [Reproduction of the actual ASCE-authored published 2022 book](https://behsazcivil.ir/wp-content/uploads/2021/12/ASCE_7_22_Minimum_Design_Loads_and_Associated_Criteria_for_Buildings_compressed_compressed333.pdf), printed pages 7–8, exposed the provision text through indexed extraction. Copyright 2022, softcover ISBN 978-0-7844-1578-8 and PDF ISBN 978-0-7844-8349-7 were verified in the same artifact. [Another reproduction](https://dokumen.pub/asce-7-22-minimum-design-loads-and-associated-criteria-for-buildings-and-other-structures.html) corroborated published-book identity and the rows. These are copies of the primary publication, not tutorial coefficients; no 2016 or public-comment draft supplied the implementation.
- [Official ASCE/SEI 7-22 errata metadata](https://ascelibrary.org/doi/10.1061/9780784415788.err) identified the latest effective date. Access failure to its full text is retained as a material limitation.
