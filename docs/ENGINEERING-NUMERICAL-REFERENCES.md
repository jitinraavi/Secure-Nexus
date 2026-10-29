# Engineering numerical reference acceptance

The executable reference suite is `client/test/engineering-reference-validation.test.ts`. It checks implemented numerical outputs against closed-form continuum equations and independent static/conservation balances. It does not mark a project verified, establish national-code compliance, or substitute for an independent engineering review.

Run it with `node --import tsx --test client/test/engineering-reference-validation.test.ts` from the repository root. It uses synthetic fixtures, no network, no credentials and no native solver installation.

## Reference cases

| Fixture | Independent expectation | What it exercises |
|---|---|---|
| Rotated and translated 2D cantilever under axial force, transverse force and end moment | Axial extension `NL/(EA)` and the integrated moment/curvature solution, rotated into global axes; support force and moment equilibrium | Sign conventions, world/local coordinates, load superposition, all three 2D degrees of freedom |
| Uniformly loaded cantilever | Tip translation `qL^4/(8EI)`, rotation `qL^3/(6EI)`, reaction `-qL`, reaction moment `-qL^2/2` | Distributed-load effects independently from the element's equivalent-load construction |
| Simply supported span with a centre load and two members | Centre translation `PL^3/(48EI)`, symmetric rotation, half-load support reactions and zero support moments | Assembly, continuity and different support conditions |
| 3D cantilever with unequal bending inertias | Independent axial, two-plane bending and torsion solutions; six global equilibrium balances | Axis-specific section properties, bending signs, torsional `TL/(GJ)` response and load coupling |
| Serial circular laminar water pipes | Hagen–Poiseuille head losses add; each series link carries the prescribed terminal demand | Total head versus pressure head, nodal mass balance and link energy residuals |
| Parallel circular laminar branches with one reversed link | Conductance-proportional flow split and signed continuity | Parallel network assembly and flow orientation |
| Prescribed-potential water and air pipes | `Q = pi D^4 deltaP/(128 mu L)` with `deltaP = rho g deltaHead` for water and pressure in Pa for air | The two potential-unit conventions and inverse flow calculation |
| Guided field conversions | A GPa modulus and millimetre diameter produce the same closed-form physical response as direct SI values | Numeric input conversion through to the solver |
| Mechanism, missing member endpoint and unanchored fluid component | No result is accepted | Rejection of unsupported/invalid physical models |

The structural reference fixtures use prismatic, small-displacement, linear elastic Euler–Bernoulli theory with rigid connections, fixed support positions, and no shear deformation. The fluid cases use full circular pipes, steady incompressible laminar flow, constant viscosity, and no minor losses, pumps, valves or emitters. Each fixture explicitly stays below Reynolds number 2,000.

Numerical comparison tolerances are set in the executable cases. Structural comparisons generally use relative error `2e-9` with an absolute floor of `1e-11`; force/moment balance uses an absolute `1e-7` floor. Flow comparisons use a `1e-13 m3/s` floor and the network solver's supported `1e-10 m3/s` convergence setting. These are floating-point regression tolerances for the specified mathematical cases, not construction tolerances or an uncertainty estimate for real inputs.

## Primary references

- [MIT 2.002, David M. Parks, Euler–Bernoulli Beams: Bending, Buckling, and Vibration](https://ocw.mit.edu/courses/2-002-mechanics-and-materials-ii-spring-2004/bc25a56b5a91ad29ca5c7419616686f7_lec2.pdf), especially the slice equilibrium, moment/curvature and cantilever sections.
- [MIT 16.001, Statically Indeterminate Systems](https://ocw.mit.edu/courses/16-001-unified-engineering-materials-and-structures-fall-2021/mit16_001_f21_lec08.pdf), axial mechanical elongation.
- [MIT 16.20, Paul A. Lagace, Unit 10](https://ocw.mit.edu/courses/16-20-structural-mechanics-fall-2002/e888339011c834eb2a02bd365fa25052_unit10.pdf), torsional rigidity and twist rate.
- [USEPA, EPANET 2.2 User Manual, EPA/600/R-20/133](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P10113EM.TXT), sections 3.1 and 12.1, hydraulic head loss, laminar flow and continuity. Groundwork's laminar tests do not claim that its transitional/turbulent algorithms or all EPANET behavior are equivalent.

## Remaining domain validation

These references strengthen the mathematical regression evidence for the bounded cases above. They do not establish general validity for geometric nonlinearity, near-instability, large displacement, material nonlinearity, local/national capacity clauses, field hydraulic calibration, pump/valve operation, thermal/air compressibility, or arbitrary model topologies. Those require their own reference matrices and qualified review. Reports retain their `unverified` classification after these tests pass.
