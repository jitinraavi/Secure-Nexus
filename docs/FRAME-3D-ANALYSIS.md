# Bounded 3D frame analysis

`client/src/lib/frameAnalysis3D.ts` provides a browser-side linear elastic 3D beam-frame analysis. This is an authored analytical model, separate from the visual CAD model. Its public entry points are `parseFrameModel3D`, `frameLoadCombinations3D`, and `analyzeFrame3D`.

## Supported model and units

- Version 1 JSON; SI metres, newtons, pascals and radians. Global X/Y/Z are the user's analytical axes, independent of the viewer's up direction.
- Up to 30 nodes, 60 straight prismatic members, 20 load cases and 20 combinations. Each case admits up to 1,000 nodal and 1,000 member uniform load records.
- Six global DOFs per node: `[UX, UY, UZ, RX, RY, RZ]`. Boolean restraints prescribe zero displacement or rotation; free DOFs are solved.
- Member properties: area A, principal second moments Iy/Iz, Saint-Venant torsion constant J, Young's modulus E and shear modulus G. J is not automatically inferred from Iy + Iz. A section must have its principal axes aligned with the authored local y/z axes.
- Explicit global nodal force/moment components and constant local-axis distributed force components. There is no automatic self-weight, distributed torque, intermediate point load, temperature, load eccentricity or load generator.
- Explicit load combinations with bounded signed factors. Without combinations, each case is analyzed with factor 1. Results remain tied to the authored node, member, case and combination IDs.

The strict parser rejects unknown fields, including releases, springs, offsets, settlements, material nonlinear, P-delta, dynamic or shell features. Represent a supported intermediate nodal load by subdividing a member with a real connected node. Elastic connections, support springs and prescribed settlements require a separate reviewed formulation rather than silently ignoring their fields.

## Local axes and sign conventions

The local x axis points from `start` to `end`. `localYAxis` is a nonzero global reference vector; its component parallel to x is removed and the remainder normalized to form y. Then z = x cross y gives a proper right-hand basis. References within the parallel tolerance are rejected. Explicit orientation avoids vertical-member axis flips from an automatic fallback.

The local DOF/end-force order is `[UX, UY, UZ, RX, RY, RZ]` at I followed by J. The transform applies the same proper rotation to translations and rotations; global stiffness is `T^t k T` and consistent global loads are `T^t p`. In local XY bending, `RZ = dUY/dx`; in local XZ bending, `RY = -dUZ/dx`.

The Euler-Bernoulli bending block on `[vI, slopeI, vJ, slopeJ]` is:

```text
EI / L^3 * [ 12,   6L,  -12,   6L
              6L, 4L^2, -6L, 2L^2
             -12,  -6L,   12,  -6L
              6L, 2L^2, -6L, 4L^2 ]
```

The XY block uses EIz. The XZ block uses EIy with slope signs `[1,-1,1,-1]`. Axial and torsional blocks are `EA/L * [[1,-1],[-1,1]]` and `GJ/L * [[1,-1],[-1,1]]`. Shear deformation, warping and coupling from nonprincipal axes are excluded.

For uniform local forces `(qx,qy,qz)`, the consistent end vector is:

```text
[qx L/2, qy L/2, qz L/2, 0, -qz L^2/12,  qy L^2/12,
 qx L/2, qy L/2, qz L/2, 0,  qz L^2/12, -qy L^2/12]
```

Reported end forces `f = k u - p` act on the member, not on the supporting joint. Local section forces on the cut of the left segment, at x from I, are:

```text
N  = -fIX - qx x               (positive tension)
Vy = -fIY - qy x
Vz = -fIZ - qz x
T  = -fIMX
My = -fIMY - fIZ x - qz x^2/2
Mz = -fIMZ + fIY x + qy x^2/2
```

Force and moment peaks include both endpoints and roots of moment derivatives within the span, so section-force extrema are exact for supported constant loads apart from floating-point error. Deflection uses cubic Hermite interpolation plus the uniform-load particular solution `q x^2 (L-x)^2 / (24 EI)`. The resultant local y/z displacement relative to the displaced end chord is sampled at 101 stations and retained as `maxChordDeflectionM`. That sample can underestimate the true maximum; it is not absolute building drift or total tip displacement. Nodal displacement envelopes separately report total translation and rotation magnitudes.

User deflection screening instead uses `chordDeflectionUpperBoundM`, a conservative quartic Bezier convex-hull bound. For each transverse component, set `A = L*slopeI + uI-uJ`, `B = L*slopeJ + uI-uJ`, `Q = qL^4/(24EI)`. The chord-relative degree-four control ordinates are `[0, A/4, (A-B+Q)/6, -B/4, 0]`. Use slopes RZ for y and -RY for z. The maximum norm of paired y/z controls bounds the resultant curve because Bernstein weights are nonnegative and sum to one. The implementation takes at least the sampled maximum and adds a small floating-point margin. This bound can exceed the actual maximum and conservatively reject a deflection criterion; it prevents a pass based solely on an underestimated sample.

## Numerical and result boundaries

The assembled free-DOF stiffness is solved with the existing bounded, diagonally scaled Cholesky routine. Missing support stiffness, nonpositive pivots, near-singular scaled pivots, nonfinite values and asymmetric input stiffness are rejected. A connected model may still contain a mechanism; boolean support presence alone cannot establish stability.

Each combination includes:

- Global node displacements and support reactions. Unsupported reaction components are zero.
- Separate free force and free moment residual maxima.
- Global sum of applied plus reaction forces, and moments about the first node's coordinates, including force lever arms. Absolute residual components and separately normalized force/moment residuals are retained. Relative acceptance tolerance is `1e-7`; unacceptable residuals reject the result.
- Member local end forces, axial tension/compression, two shears, torsion, two bending moment peaks, sampled resultant chord deflection and its conservative upper bound.
- Node and member envelopes across supplied combinations, with the governing combination IDs. A magnitude envelope does not retain the signs or simultaneous force vector from another governing component.

Numerical equilibrium acceptance is distinct from engineering verification. The report declares `verification: "unverified"` until authorized executed benchmarks and independent comparison establish the actual implementation's behavior.

Optional `design` values are explicit user capacities. Axial/biaxial bending screening conservatively adds independent peak demands divided by the three user capacities. Shear y, shear z, torsion and the chord-deflection upper bound are checked separately. The supplied axial capacity applies to both tension and compression; no buckling resistance is derived. These criteria do not implement any country's design standard. A national-code profile must identify its adopted edition and supported resistance/check implementation separately before claiming compliance.

## Example input

```json
{
  "version": 1,
  "analysis": "linear",
  "nodes": [
    {"id":"base","xM":0,"yM":0,"zM":0,"restraints":[true,true,true,true,true,true]},
    {"id":"tip","xM":3,"yM":0,"zM":0,"restraints":[false,false,false,false,false,false]}
  ],
  "members": [
    {"id":"beam","start":"base","end":"tip","areaM2":0.01,"inertiaYM4":0.00002,"inertiaZM4":0.00004,"torsionConstantM4":0.00001,"elasticModulusPa":200000000000,"shearModulusPa":77000000000,"localYAxis":[0,1,0]}
  ],
  "loadCases": [
    {"id":"service","nodal":[{"node":"tip","fxN":0,"fyN":0,"fzN":-10000,"mxNm":1000,"myNm":0,"mzNm":0}],"uniform":[]}
  ]
}
```

## Required deferred verification

No application, tests, builds, typechecker or native solver were executed while developing this module, as requested. The following are review targets, not executed passing tests:

1. Cantilever axial force P: tip `ux = PL/(EA)` and base `fx = -P`.
2. Cantilever applied torque T: tip `rx = TL/(GJ)` and base `mx = -T`.
3. Cantilever tip load P in local y: `uy = PL^3/(3 EIz)`, `rz = PL^2/(2 EIz)`, base `fy = -P`, `mz = -PL`.
4. Cantilever tip load P in local z: `uz = PL^3/(3 EIy)`, `ry = -PL^2/(2 EIy)`, base `fz = -P`, `my = PL`.
5. Cantilever uniform q in y or z: tip displacement `qL^4/(8 EI)`, corresponding slope magnitude `qL^3/(6 EI)`; check signed reactions and the section-force diagrams in both planes.
6. Fixed-fixed uniform load q: opposite end moments with magnitude `qL^2/12`; chord deflection at midspan `qL^4/(384 EI)`.
7. Rotate and translate an entire stable model plus its loads and orientation vectors; compare transformed displacements/reactions and invariant local forces. Repeat with nonaxis-aligned members.
8. Compare case superposition to a signed combination; confirm source IDs and governing envelope combinations. Exercise all-fixed models, mechanisms, disconnected members, nearly parallel orientations, stiffness contrasts and bounded imports.
9. Independently compare a spatial portal frame against OpenSees with matching rigid connections, principal section axes, linear transformation, no shear deformation and identical loads. Do not compare to a nonlinear transformation and call discrepancies numerical error.

## Primary references

The element assumptions and A/E/G/J/Iy/Iz input interpretation are consistent with [OpenSees elasticBeamColumn documentation](https://opensees.github.io/OpenSeesDocumentation/user/manual/model/elements/elasticBeamColumn.html). Explicit coordinate orientation and transformation assumptions follow the role described by [OpenSees Linear Transformation documentation](https://opensees.github.io/OpenSeesDocumentation/user/manual/model/geomTransf/Linear.html). This module accepts a projected local-y reference, whereas OpenSees accepts `vecxz`; they are not interchangeable JSON fields. The displayed stiffness, consistent loads and section-force signs are derived for this module's stated DOF convention; the references do not establish that this implementation has been benchmarked.
