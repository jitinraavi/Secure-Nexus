# Explicit structural load authoring and story drift

This Phase 3 increment turns reviewed project load inputs into the existing bounded 3D elastic frame model. The engineering workbench exposes it as **Loads and drift**. The module calculates only when the user explicitly selects Calculate. Restoring a workspace checks the saved source, report structure and arithmetic without solving the frame again.

The report always states `verification: unverified` and `compliance: not-assessed`. The implementation has been reviewed by source inspection only. Neither numerical examples nor compilation, applications, tests, builds, previews or native solvers were executed.

## Supported input contract

`client/src/lib/structuralLoadAuthoring.ts` exports `parseStructuralLoadInput`, `analyzeStructuralLoads`, `validateStructuralLoadReport` and `structuralLoadExample`. The validator is a boolean TypeScript type guard and returns false for malformed or inconsistent saved reports.

The version 1 input contains:

- `geometry`: the existing version 1 straight, prismatic, rigidly connected 3D frame nodes and members, with explicit restraints, section properties and local-axis reference vectors. This object contains no existing loads or combinations; copying a 3D model here requires selecting its geometry fields deliberately.
- `loadCases`: named cases containing `pressures`, `masses` and `selfWeights`. Each source has its own unique ID, and each target must identify an existing node or member.
- `combinations`: named sets of signed case factors. Every factor is supplied explicitly; omission of a case means zero contribution. Negative factors reverse the case. An entirely zero combination is rejected.
- `stories`: optional named node-pair checks with explicit lower and upper node IDs, supplied story height, a global unit projection direction, selected combination IDs, allowable drift ratio and displacement amplification multiplier. The module does not infer floors, vertical axes, diaphragms or the physical meaning of the selected pair.

Limits are 30 nodes, 60 members, 20 load cases, 20 combinations, 200 total load sources and 40 story checks. A case must contain at least one source. An intentional zero load may be represented by a zero pressure or acceleration vector; it must still have a source declaration. The inherited frame parser rejects unsupported geometry/analysis fields, mechanisms and out-of-range generated forces. Additional authoring fields are rejected instead of silently ignored.

Pressure and acceleration quantities use `{ value: [x,y,z], unit, trace }`, expressed in global coordinates. Density, factors and drift criteria use `{ value: number, unit, trace }`. Exact unit labels are `Pa`, `m/s2`, `kg/m3` and `1`, respectively. Areas, masses and heights are explicitly `areaM2`, `massKg` and `heightM`. No input is interpreted as kilograms-force, a percentage, kilopascals or a multiple of gravitational acceleration without explicit conversion before import.

## Sources and country context

Every quantity trace is one of:

- `{ kind: "supplied", source, statement }`: an explicit project criterion, including a statement of the supplied scalar or vector and its source. This supports analysis while country/adoption metadata is still a draft.
- `{ kind: "standard", source, standardId, clause }`: a unique adopted standard in the captured design basis, with explicit country, edition, local adoption reference and clause. Built-in catalog identifiers must match their registered country, code, domain, edition and publisher; another edition requires a custom adopted reference.
- `{ kind: "criterion", source, criterionId }`: one uniquely identified basis criterion for the frame module. Scalar value and exact SI unit must match. A criterion referencing a standard must resolve its standard and clause too. Three-component vectors cannot reference a scalar criterion as a proxy; provide an explicit supplied-vector statement or adopted-standard clause.

Duplicate standard or criterion IDs cannot be resolved by selecting the first match. The full captured basis accompanies the report; incomplete declarations produce warnings. India and US references retain their selected editions and clauses. Other countries retain their corresponding authored references without falling back to another country's coefficients. A source trace records the declaration; it does not verify that the input value or referenced clause applies to this project.

## Load mathematics

For an authored pressure vector `p` in Pa and tributary area `A` in m2, the node force is `F = p A`, in N. The pressure is an already resolved traction vector, so the module does not derive a surface normal, wind direction, projected area, shielding, internal pressure, eccentric moment or distribution to other nodes. NIST's [SI quantity guide](https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b9) distinguishes pressure, force, mass density and acceleration as separate quantities.

For an authored point mass `m` in kg and signed equivalent load acceleration `a` in m/s2, the node force is `F = m a`. The acceleration specifies the desired force direction. It is not treated as a support-motion time history or automatically negated ground acceleration. The force relation and newton unit follow [NIST's force definition](https://www.nist.gov/pml/quantum-measurement/mass-and-force/proving-ring/what-force).

For each authored member self-weight source, the global uniform load is `q = density × member area × acceleration`, in N/m. It is projected onto the same local axes used by `frameAnalysis3D`: local x from start to end, local y from the supplied reference projected perpendicular to x, and local z from `x × y`. Each local component is a dot product of `q` with its unit axis. The existing frame solver applies consistent axial and transverse uniform loads. OpenSees' [element load documentation](https://opensees.github.io/OpenSeesDocumentation/user/manual/model/eleLoad.html) likewise identifies uniform beam loads by member-local axes; this module remains a separate browser solver, not a new native solver adapter.

No self-weight is added unless explicitly authored. Repeated sources add. Users must prevent overlapping tributary areas, duplicated point masses or duplicate self-weight sources. The report retains each source ID, case ID, target ID, generated global vector, applicable local uniform vector, unit and quantity trace, along with every signed combination factor.

## Drift mathematics and result meaning

For each selected combination, let `uUpper` and `uLower` be the saved global translation vectors at the exact authored node pair, `d` the supplied unit direction, `h` the supplied height, `amp` the supplied multiplier and `limit` the supplied allowable ratio:

```
relative translation = uUpper - uLower
signed projected drift = dot(relative translation, d)
elastic drift ratio = abs(signed projected drift) / h
amplified drift = abs(signed projected drift) × amp
amplified drift ratio = amplified drift / h
criterion utilization = amplified drift ratio / limit
```

The report separately retains the magnitude of each total node translation, magnitude of relative chord translation, signed projected drift, elastic and amplified ratios and criterion utilization. Only the supplied projected criterion is assessed. Resultant chord translation is not silently used as its demand. Each story envelope identifies its governing combination; ties retain the first authored selection. An empty story list means no drift checks were supplied, rather than a passing result for the whole structure.

The ratio of relative floor movement to story height is consistent with the definition and selected-point treatment in [NIST TN 2000, section 5.3](https://nvlpubs.nist.gov/nistpubs/TechnicalNotes/NIST.TN.2000.pdf). That reference includes additional floor torsion and time-series mechanics; this increment does not implement those features. The module uses already modeled node movements and does not construct center-of-mass, diaphragm-edge or interpolated floor displacements.

The supplied amplification multiplier merely scales a reported displacement. It does not add geometric stiffness, P-Delta effects, modal response, accidental torsion or seismic detailing, and it does not automatically implement an Indian or US code displacement formula.

## Report restoration and exclusions

Reports contain the captured source comparison key, complete design basis, generated frame model, load/factor traces, frame combination results and envelopes, story results/envelopes and warnings. The comparison key is deterministic JSON, not a cryptographic attestation. Source object key order does not alter the key. Source IDs and all referenced node/member/case/combination IDs must match exactly.

Restore validation checks bounded objects, finite numbers, version/scope flags, actual saved restrained degrees of freedom, reaction IDs, conservative deflection-bound ordering and envelope consistency with stored combination results. It regenerates deterministic load arithmetic and reads saved displacements to check story arithmetic. It never assembles a stiffness matrix, calls the frame analyzer or executes a native job. These consistency checks cannot establish that saved numerical results were actually produced by a trusted solver; report verification remains unverified.

National wind/seismic/gravity coefficient generators, hazard maps, site spectra, importance and response factors, automatic national combinations, diaphragm distribution, accidental torsion, dynamic analysis, geometric/material nonlinearity, member releases, imposed support movement and full national-code checks remain unsupported. Capacity screening attached to the underlying frame members retains that solver's existing exclusions. Selecting standards does not turn this module into a complete national-code implementation.

When execution is authorized, acceptance should cover pressure/mass unit fixtures, gravity sign, rotated-axis self-weight invariance, reversed factors, zero vectors, overlapping-source behavior, drift under common rigid translation, projection directions, governing-combination ties, absent story checks, invalid reference IDs, ambiguous basis declarations, saved source tampering, legacy workspace upgrades and comparison with an independently verified frame solution. None of these executed checks is claimed to have passed.
