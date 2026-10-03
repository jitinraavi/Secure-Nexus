# Coordinated MEP system assessment

This Phase 3 module coordinates an explicitly authored water, air or fire network with an explicitly supplied pump/fan curve and an electrical circuit. It assesses a bounded steady operating point against supplied criteria. Every result has `verification: "unverified"`, `claim: "supplied-criteria-only"` and `nationalCodeCompliance: "not-assessed"`.

Selecting India, the USA or another country retains that project's adopted standards, editions, amendments, authority and criteria in the report. The module supplies no national coefficients, wire sizes, fire classifications, equipment approvals or ventilation tables. A reference to an adopted clause is traceability metadata, not an implemented national-code check.

## Input contract

`parseMepSystemInput(value)` requires version 1 and rejects unsupported keys at every system/network/curve/circuit level. Input identifiers use ASCII letters, digits, `_`, `.`, `:` and `-`, with a leading letter or digit. There are at most eight systems, 24 equipment items and 24 circuits; each system has at most 40 nodes and 100 links, with combined limits of 120 nodes and 300 links. Curves have 2–100 ordered points. Criteria traces have at most 16 criterion IDs. All numbers and strings are bounded.

- A **system** declares its `id`, `name`, source reference, `FluidNetwork` and consumer terminal mappings. Each terminal has a node ID, minimum simultaneous flow in m³/s, minimum residual pressure in m of water or Pa, and a trace.
- **Equipment** maps a system, one positive-gain driver link, a prescribed-potential source, a critical assessed terminal and a directed contiguous path between them. It declares additional loss, reserve fraction, absolute potential tolerance, forward-flow tolerance, one manufacturer candidate curve, its source, motor efficiency and its circuit ID.
- A **circuit** contains the existing `ElectricalCircuitInput`, its mapped equipment IDs, other connected electrical input power, absolute power tolerance, maximum-fault clearing seconds, protection/let-through source, ampacity/derating source and a trace.
- An optional **fire assessment** declares a criteria basis, required total simultaneous flow, duration, usable storage and terminal minimum flows/heads. Fire terminals must match their explicit system terminal mappings exactly.
- A **trace** contains a non-empty source, explicit `criterionIds`, and optionally both an adopted `standardId` and `clause`. Referenced criterion IDs must resolve to exactly one sourced criterion in the captured basis for the relevant water, air, equipment, electrical or fire module. Referenced standards require explicit country, code, edition, local adoption and HTTPS source; known catalog entries must match country, edition and publisher. Criterion-linked standards and clauses are checked too. Criterion values are not silently copied into input thresholds.

Every nonzero network gain must map to assessed equipment. Each equipment motor must map exactly once to the named electrical circuit. Driver mappings, systems, equipment, terminals and circuits have unique IDs. Duty paths contain no repeated links/nodes, no second gain and no second prescribed source. The driver runs in its stored positive direction. Pumps require water; fans require air. Unsupported curve coupling, valves, additional field semantics or other electrical configurations cause rejection instead of being ignored.

The curve's `potential` means developed head in m of water for pumps and developed **static** pressure in Pa for fans. `efficiency` is hydraulic efficiency or static fan efficiency. `motorPowerW` is rated motor **shaft output**. `motorEfficiency` converts shaft output to electrical input; it is not another pump/fan efficiency. Manufacturer data must already apply to the supplied fluid density, speed and installation conditions. No correction is inferred.

## Processing and result

`assessMepSystems(input, designBasis)` validates the declarations, solves each fluid network once through the existing bounded solver, and performs each circuit calculation once. Solver failure throws; non-convergence produces failed system/equipment checks, and cannot produce an acceptable aggregate.

For a converged system, every duty-path link must have positive flow in its declared direction above the explicit tolerance. The driver flow is the equipment duty flow; extrapolation outside the manufacturer curve is excluded. At that solved flow:

```text
water minimum terminal potential = terminal elevation + minimum pressure head
air minimum terminal potential   = minimum static pressure

required driver potential = max(0,
  minimum terminal potential - prescribed source potential
  + sum of directed path ordinary losses + declared additional loss)
```

Each path loss is included once. Ordinary friction/minor loss on the driver link is included, but the driver's added gain is never added as a loss. The curve must cover required potential times `(1 + reserveFraction)`, and curve potential must agree with the model's fixed driver gain within `potentialTolerance`. This is a consistency assessment at one operating point, not a coupled pump/fan system-curve intersection or an automatic resizing/re-solve.

```text
pump shaft power = density × 9.80665 × flow × curve head / hydraulic efficiency
fan shaft power  = flow × curve static pressure / static efficiency
motor electrical input = shaft power / motor efficiency
motor nameplate electrical input = rated shaft output / motor efficiency
```

Rated shaft output must cover curve-point shaft demand times `(1 + reserveFraction)`. Expected motor running current uses circuit phase count, voltage and supplied power factor. Circuit connected input must match the sum of mapped nameplate input and other connected power within the declared absolute tolerance. Demand allowance must cover the simultaneous calculated running duties and all other connected loads; no equipment diversity is inferred. An unknown equipment duty fails that allowance check.

Existing circuit checks assess supplied load protection, breaking capacity, minimum earth-fault pickup, disconnection time, maximum-fault let-through versus `(kS)²`, and voltage drop. The coordination layer also requires supplied maximum-fault clearing and minimum-earth-fault trip times to stay within five seconds for the adiabatic approximation, and screens minimum earth-fault RMS-current squared times supplied trip time against `(kS)²`. This minimum-fault-point screening is separate from the supplied manufacturer maximum-fault let-through; it does not synthesize a trip curve or establish thermal adequacy at all intermediate fault currents.

All authored node pressure and link velocity limits are included. Negative water pressure head prevents an acceptable aggregate. The fire storage requirement uses the greater of required fire total flow and modeled total demand, multiplied by the declared duration in seconds. Fire flow, terminal flow/pressure and storage checks all require a converged hydraulic report. Fixed demands at an insufficient pressure do not become a successful fire design.

The report captures the normalized source, full country/adoption basis, basis completeness issues, hydraulic/circuit results, linked equipment duties, a finite allowlist of checks and the aggregate `satisfiesSuppliedCriteria`. Generated outputs must also pass the strict finite/bounded result schema before return; extreme derived values (such as fault current from vanishing impedance) reject the assessment before JSON serialization. A pass means all these supplied checks passed; basis completeness and professional adoption review remain separately visible.

## Persistence and APIs

```typescript
parseMepSystemInput(value: unknown): MepSystemInput
assessMepSystems(input: MepSystemInput, basis: EngineeringDesignBasis): MepSystemReport
validateMepSystemReport(value: unknown, source: MepSystemInput,
  basis: EngineeringDesignBasis): value is MepSystemReport
mepSystemExample(): MepSystemInput
```

Restoration requires matching normalized source and complete basis, bounded allowlisted result fields, exact system/node/link/equipment/circuit mappings, correct units, the expected checks and traces, convergence gates and consistent aggregates. The validator returns false for malformed data. It never invokes a solver or recalculates the assessment. It validates storage structure and declaration correspondence; it cannot establish that a saved hydraulic or electrical numerical solution is mathematically correct. Restored reports remain unverified, and must be recalculated and independently validated before use.

The example includes illustrative fire water, a supply fan and their circuits. Its curves, efficiency, impedances, protection timing and criteria are authored placeholders, with no product or national-code certification. Replace them before applying the module to a project. The example was not executed under the user's no-run instruction.

## Excluded scope and acceptance

This module does not implement automatic ventilation/thermal loads, sprinkler remote-area selection, equipment product certification, NPSH/cavitation, valve control, tank dynamics, water hammer, compressible flow, variable-speed intersection solving, cable table selection, motor starting/overload settings, protection selectivity, grounding-grid design, arc flash, national wiring rules or authority approval. The existing incompressible solver and simplified circuit formula retain their documented limitations. Choosing a reference does not extend this scope.

Only source inspection is authorized for this delivery. No application, tests, builds, typecheck/lint, previews or engineering solvers were run. Acceptance remains deferred: independently verify network mass/energy residuals and published benchmarks; check equipment curves and motor duties against manufacturer data; verify circuit outputs against an applicable fault/protection study; review fire requirements and adopted local rules; and exercise persistence and error paths in the deployed workflow.

## Primary references

- [US Department of Energy, Improving Pumping System Performance: A Sourcebook for Industry, Second Edition](https://www.energy.gov/sites/prod/files/2014/05/f16/pump.pdf): pump flow/head work, motor input and system/equipment assessment context.
- [US Department of Energy, Improving Fan System Performance: A Sourcebook for Industry](https://www.energy.gov/sites/default/files/2014/05/f16/fan_sourcebook.pdf): airflow × pressure power, distinction between static and total efficiency, curves and motor efficiency. This module uses static pressure consistently.
- [US Department of Energy, DOE-HDBK-1012/3-92](https://www.energy.gov/ehss/articles/doe-hdbk-10123-92): prescribed potential, fluid energy balance and head losses.
- [Schneider Electric, Overcurrent protection principles](https://www.electrical-installation.org/enwiki/Overcurrent_protection_principles) and [Verification of cable withstand under short-circuit conditions](https://www.electrical-installation.org/enwiki/Verification_of_the_withstand_capabilities_of_cables_under_short-circuit_conditions): conductor adiabatic screening, supplied device performance and the short-duration applicability limit. These manufacturer references do not substitute for a project-adopted national code.

