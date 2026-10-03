# Explicit-criteria structural screening

`client/src/lib/structuralDesignChecks.ts` adds bounded structural calculations for material, member, section, foundation and connection quantities. This is a Phase 3 increment. It does not finish the national-code design phase.

## Input and traceability

`parseStructuralDesignInput(unknown)` accepts version 1 with 1–100 checks. Supported kinds are `steel-elastic`, `rc-rectangular`, `footing-contact` and `bolt-group`. Unknown fields and unsupported kinds are rejected. Every check needs a unique ID, label, input-source declaration and named load case. Geometry uses metres, section areas m², inertias m⁴ and elastic section moduli m³. Forces use N, moments Nm and material stresses Pa. No load combination or gravity action is generated automatically.

Material values, coefficients and acceptance limits are objects `{value,unit,source,criterionId?,standardId?,clause?}`. Exact units are `Pa`, `N` or `1`. Values must be finite within declared parser bounds. Reductions must be positive and no greater than one. A referenced `criterionId` must match the captured basis's frame criterion exactly in value, unit, source and standard/clause references. Basis criterion and standard identifiers must be unique. A referenced standard requires a country, explicit edition, local adoption and amendments declaration, and an HTTPS publisher source. A known catalog reference must match its country, edition, code, domain and publisher; another edition requires a custom adopted reference. A standalone source declaration is permitted so that explicitly supplied project criteria remain usable without pretending they implement a complete code.

`analyzeStructuralDesign(input,basis)` captures the normalized input and project basis in its report. India/USA/other-country selection is preserved, including region, adopted editions, local amendments and clauses. It supplies no national coefficients. Metadata-completeness issues remain visible. Results declare `verification: "unverified"` and `compliance: "not-assessed"`, regardless of their numerical screen status.

## Methods

### Gross steel stress and elastic column screen

The first-order gross normal-stress upper bound is `|N|/A + |My|/Sy + |Mz|/Sz`. It is conservative where extreme-fibre stresses about the two axes do not coincide. The limit is the supplied yield strength multiplied by the supplied stress reduction. Section properties must refer to centroidal principal axes.

Each ideal Euler load is `π² E I / (K L)²`; the governing value is reduced by the supplied Euler screening factor. The governing elastic critical stress must not exceed the supplied elastic/proportional limit before a compression capacity comparison is issued. Inelastic behavior is explicitly unsupported. Compression with bending is also marked unsupported for acceptance, because this module does not implement a validated beam-column interaction or second-order analysis. Euler is a mechanics screen, not a national-code column curve. [AISC's specification commentary](https://www.aisc.org/globalassets/aisc/publications/standards/a360-16-spec-and-commentary_june-2018.pdf) explains the Euler form and the separate treatment of inelastic behavior; this implementation does not reproduce that specification's complete design equations.

Local, torsional, flexural-torsional and lateral-torsional buckling, shear, torsion, net-section rupture, fatigue and serviceability are excluded.

### Singly reinforced rectangular concrete section

With supplied block coefficients `α` and `β`, reduced concrete strength `fc,d`, reduced reinforcement yield stress `fy,d`, ultimate compression strain `εcu`, and steel modulus `Es`, the calculation solves:

```
a = βc
εs = εcu(d-c)/c
fs = min(Es εs, fy,d)
C = α fc,d b a
T = As fs
C = T
Msection = C(d-a/2)
Mcapacity = supplied moment reduction × Msection
```

The neutral axis is found by bounded bisection over `0<c<d`. Force equilibrium is checked to relative tolerance `1e-9`; failures are rejected. A separate supplied minimum tensile-strain screen is retained. The moment reduction is an explicit fixed input, not an automatically selected ductility factor. The underlying equilibrium/strain-compatibility principle is illustrated by [FHWA's concrete flexural analysis output](https://www.fhwa.dot.gov/bridge/lrfd/pscusappa5.cfm). Its published numerical coefficients are not presets in this module.

The supported section has one bonded tension-steel layer, zero axial force, a rectangular block and the declared positive bending direction. Compression reinforcement, prestress, non-rectangular sections, minimum/maximum reinforcement provisions, shear, torsion, anchorage, detailing, cracking, deflection and fire design remain excluded.

### Rectangular footing with full contact

For positive net compression `P`, the four hypothetical full-contact corner pressures are `P/(B L) ± 6My/(B² L) ± 6Mx/(B L²)`. Generalized positive `Mx` increases pressure toward `+y`; positive `My` increases it toward `+x`. These are declared bearing-resultant signs: authors must translate global frame-reaction signs explicitly. Eccentricities and the combined rectangular kern expression `6|ex|/B + 6|ey|/L` are reported.

Only nonnegative corner pressures permit comparison against the supplied gross allowable bearing pressure. Uplift/zero vertical compression produces no pressure or capacity result. A tension corner marks the calculation unsupported; negative hypothetical pressures are diagnostic and are never clipped or silently redistributed. Resultants on or outside a footprint edge flag the unsupported overturning equilibrium condition. [FHWA GEC No. 6, Section 6.6](https://www.fhwa.dot.gov/engineering/geotech/pubs/010943.pdf) describes the rigid-footing linear contact-pressure idealization and its limitations.

Soil resistance is not derived. Partial-contact redistribution, settlement, sliding, prescribed overturning safety factors, global stability, liquefaction and concrete footing reinforcement/shear are excluded. The supplied vertical action must include the weights and vertical actions intended for that load case; the supplied bearing limit must use the same gross/net and demand basis.

### Equal-stiffness planar bolt group

The geometric centroid is calculated for identical shear stiffness. With relative bolt coordinates `(x,y)` and `J=Σ(x²+y²)`, each demand is:

```
Fx = Vx/n - Mz y/J
Fy = Vy/n + Mz x/J
R = sqrt(Fx²+Fy²)
```

The supplied `Mz` acts about the centroid and is positive counterclockwise. An eccentric applied-force moment must already be included. Demand is compared separately with each supplied reduced shear capacity. Bolt capacities may differ; shear stiffness must remain identical. A one-point/degenerate group with nonzero moment is unsupported. Resultant force and moment residuals are checked to relative tolerance `1e-8`. The vector superposition method is documented in [NASA RP-1228, “Finding Shear Loads on Fastener Group”](https://ntrs.nasa.gov/api/citations/19900009424/downloads/19900009424.pdf).

Unequal stiffness, slip, plastic redistribution, tension/prying, out-of-plane moments, shear/tension interaction, plate bearing, tearout, block shear, welds, fatigue and installation checks are excluded.

## Reports and validation

Each result reports its method assumptions and exclusions, intermediate SI metrics, supplied-limit comparisons and an explicit status. `within-user-criteria` covers only those comparisons. `unsupported` prevents incomplete contact, elastic-domain or combined-compression calculations from being shown as accepted complete designs. It does not imply that the omitted checks have passed.

`validateStructuralDesignReport(value,source,basis)` is a restore-only type guard: it validates allowlisted report fields, finite quantities, bounded arrays, result/check correspondence and exact captured input/basis identity. Utilizations must agree with their demand/capacity ratio and acceptance direction, including rejection of a zero denominator in an at-least check. Supplied demands and capacities are tied to their source or saved metrics. Steel stress/Euler metrics, hypothetical footing corner pressures, and bolt geometry, forces, capacities and equilibrium must agree with source algebra. Concrete strain, block geometry, forces, moment capacity and criteria must agree with the stored neutral-axis position and satisfy force equilibrium. The validator does not call an analyzer or repeat the neutral-axis bisection. Stored reports are unverified records, not signed solver evidence. The educational example has explicit illustrative source labels for every material/coefficient/capacity and is not an Indian, US or other national preset.

## Deferred acceptance

No app, tests, builds, lint/typechecker, previews, native solvers or repository code were executed under the user's constraint. Source and formula inspection does not replace numerical verification. Future permitted acceptance needs independent stress/Euler examples; under- and over-reinforced section equilibrium cases; concentric, biaxial kern-boundary, partial-contact and uplift footings; bolt force/moment equilibrium and degenerate patterns; report round-trip/tamper checks; and TypeScript compilation. National load generation, country-code column curves, material/detailing provisions, foundation resistance and connection limit states remain separate required development.
