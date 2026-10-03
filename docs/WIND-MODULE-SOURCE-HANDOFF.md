# Next Phase 3 wind module: inspected sources and implementation boundary

The subsequent refreshed-window increment implements the bounded authored module in `nationalWindLoads.ts` and documents its current contract in [NATIONAL-WIND-LOADS.md](NATIONAL-WIND-LOADS.md). The text below is the preserved pre-implementation source handoff, not the current implementation status.

No wind-generator source module was started at this boundary. Existing `structuralLoadAuthoring.ts` accepts authored global pressure vectors, and `nationalLoadRecipes.ts` generates the explicitly scoped IS 456 gravity/wind combination factors. Neither derives site hazards or wind pressures. Continue with a coherent authored wind-speed/design-pressure module before the broader seismic and design work.

## Inspected primary artifacts

- [BIS-authored IS 875 (Part 3):2015 original OCR](https://archive.org/stream/gov.in.is.875.3.2015/is.875.3.2015_djvu.txt).
- [Readable mirror of the actual BIS publication](https://studylib.net/doc/27669135/is-875-part-3---2015), bearing the RDSO licensed-copy provenance. It resolves equations missing in the original scan's OCR.
- [BIS Amendment 1, April 2016](https://archive.org/download/gov.in.is.875.3.2015/zIS875:Part3Amd.1:2016.pdf).
- [BIS Amendment 2, June 2020](https://archive.org/download/gov.in.is.875.3.2015/zIS875:Part3Amd.2:2020.pdf).

The inspections establish:

- Clause 6.3: `Vz = Vb k1 k2 k3 k4`.
- Clause 7.2: `pz = 0.6 Vz²`, `pd = max(Kd Ka Kc pz, 0.70 pz)`, with velocity m/s and pressure Pa.
- Clauses 7.2 note 2 / 7.2.1 require `Kd=1` for local-pressure coefficients and cyclone regions.
- Clause 7.3.3.13 narrowly permits `Kc=0.90` for its specified combined frame-envelope loading; it is not a general default.
- Clause 7.3.1 supplies signed surface action `(Cpe−Cpi) A pd`.
- Clause 9.1 requires dynamic examination for height/minimum lateral dimension above approximately 5, or first-mode frequency below 1 Hz; clause 1.3 also identifies special/tall/slender behavior.
- Amendment 1 permits Table 4 area interpolation and corrects coefficient tables. Amendment 2 changes wind-map references to NBC 2016 Part 6/Section 1 Figure 1, deletes the original map and replaces Annex A.

Table 2's height interpolation range does not establish static-method applicability. Re-read applicable clauses before coding; the notes above are a bounded source handoff, not a complete standard or a claim that later amendments have been reconciled.

## Coherent implementation contract to finish

Use explicit country IN and the project's actual adopted 2015 edition/amendments, publisher references, authority, named review and complete sources for every supplied quantity. Require the correct NBC map/adoption reference if supporting the inspected amended-map scope. Do not silently use the deleted 2015 map or infer a city speed from country selection. Country/edition coverage remains explicit; unsupported countries retain their own declared basis.

The first supported increment should calculate authored, reviewed basic speed and dimensionless factors into design speed/pressure, optionally resolving supplied signed surface coefficients into a global pressure/load with an explicitly declared normal/direction and area. Keep SI units exact and bind results to captured source/basis. Every factor, coefficient, applicability decision, site hazard and external dynamic/interference assessment requires a source and explicit declaration. Do not embed guessed coefficients, default maps, opposite-direction patterns or automatic cladding/frame reductions.

Require clear geometry, ordinary/special-structure scope and dynamic/interference review. Reject or explicitly exclude scope needing a dynamic/gust procedure; a product-specific conservative height cap must be labelled as a product bound, never a BIS rule. Resolve the cyclone/local-pressure Kd restriction and the narrow Kc scope instead of accepting arbitrary reductions without context.

Integrate the complete module into the engineering workbench with versioned legacy recovery and a restore-only validator checking source-bound formula arithmetic without assessment/solver execution. Preserve the explicit supplied-load workflow and source traces. Document hazard lookup, coefficient selection, dynamic/gust response, unusual/offshore structures, interference and full wind-code design as unsupported unless their complete algorithms and source contracts are actually added.

No app, tests, builds, lint/typecheck, previews, native programs or repository calculations were executed. Independent formula, applicability, amendment, sign/unit and persistence benchmarks remain deferred. The current source commit boundary leaves no unfinished unpushed module to recover.
