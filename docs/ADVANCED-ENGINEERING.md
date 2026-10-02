# Advanced engineering source modules

The Engineering Workbench accepts independently authored SI JSON datasets. It does not infer supports, member sections, hydraulic boundaries or protection-device data from architectural envelopes. Input JSON and reports can be exported; native input bundles include the original dataset, integer/string tag mapping, supported scope and limitations.

`engineeringModelBridge.ts` connects existing project geometry to these inputs. `importStructuralExchange2D` reads the Community Editor's structural Solver model export, selects an XY/ZY plane/slice and applies explicit section overrides. Source assumed supports are imported only when that option is selected. Loads remain empty because the existing exchange's demand screens cannot establish actual load distribution. `importRoutedMepNetwork` reads room/community/infrastructure MEP design JSON, separates one pipe/duct system, merges coincident route vertices and copies segment dimensions/lengths. User source potential, per-terminal demand and loss inputs are displayed before import. Fixture/equipment connection labels do not establish physical ports; disconnected components, supports, loads and all conversion warnings require review in the editable JSON.

## Structural frame

`client/src/lib/frameAnalysis.ts` exports `parseFrameModel`, `frameLoadCombinations`, and `analyzeFrame2D`.

- A 2D prismatic Euler–Bernoulli elastic frame has three degrees of freedom per node: X/Y translation and Z rotation. Supports prescribe zero displacement. Member material modulus, area and second moment are explicit SI inputs.
- Static nodal forces/moments and uniform member loads in local axial/transverse axes are assembled for each user load combination. Uniform loads use consistent equivalent nodal forces. Member forces, support reactions and separate force/moment equilibrium residuals are reported.
- Optional geometric analysis iterates a consistent initial-stress stiffness matrix using member axial force (tension positive). Non-positive, singular or ill-conditioned reduced tangent stiffness is rejected. Bounded iteration reports convergence separately from independent verification.
- Explicit section criteria compare combined axial/bending stress, Euler elastic buckling with user effective length/safety factor, and sampled chord-relative deflection with user limits. Unsupplied criteria do not become a design pass. Envelopes sample 41 member stations.
- Limits: 60 nodes, 120 members, 20 load cases/combinations, 40 geometric iterations. Diagonal scaling and Cholesky factorization prevent accepting a non-positive system.

This is elastic geometric analysis, not material nonlinear analysis. Plastic hinges, yielding, cracking, large rotations, releases, settlement, plate/shell/3D behavior, dynamics, connection checks, torsional/shear failure and national-code detailing are unsupported. Geometric-stiffness force recovery and sampled deflections require mesh refinement and independent reference comparison before use. The workbench rejects declared unsupported material/release/settlement options rather than silently approximating them.

Mathematical reference: [Duke University matrix structural analysis](https://people.duke.edu/~hpgavin/cee421/), including its [elastic frame matrices](https://people.duke.edu/~hpgavin/cee421/frame-element.pdf) and [geometric frame stiffness notes](https://people.duke.edu/~hpgavin/cee421/frame-finite-def.pdf). The implementation is independently authored from standard direct-stiffness relationships.

## Water and air networks

`client/src/lib/engineeringNetworks.ts` exports `parseFluidNetwork` and `solveFluidNetwork`.

The steady network balances mass at each unknown-potential node. Water potentials are total head in metres; air potentials are static pressure in pascals. Water pressure head is total head minus node elevation. Link resistance uses Darcy–Weisbach friction and minor losses, laminar friction below Re 2000, Swamee–Jain turbulent friction above Re 4000, and smooth transition blending. Circular links and rectangular air ducts are supported; rectangular links use hydraulic diameter. Water emitters add pressure-dependent demand `Q=C√max(H−z,0)`.

Link flow is found by bounded resistance inversion. A nodal Newton iteration uses resistance gradients, a positive graph matrix and residual-reducing damping. Every connected component must contain a fixed head/pressure boundary. Reports retain nodal and global mass residuals, link energy residuals, signed flows/velocities, source supplies and user minimum-pressure/maximum-velocity checks. Non-convergence stays explicit; negative water pressures generate infeasibility warnings.

Limits: 80 nodes, 200 links, 80 iterations. Constant pump/fan pressure gains may be authored, but operating-point pump curves, control/check valves, pressure-dependent consumer demand beyond emitters, tank dynamics, water hammer, air compressibility, heat transfer and automatic HVAC load/equipment sizing are not solved. Hydraulic-diameter laminar duct calculations are approximations.

Reference: [EPA EPANET 2.2 manual](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P10113EM.TXT). This implementation uses its own bounded nodal solve and a different transitional-flow blend; it does not embed EPANET or claim EPANET-equivalent results.

## Equipment, electrical and fire criteria

- `selectEquipment` interpolates supplied non-increasing pump/fan curves at a specified flow without extrapolation. It checks available potential, efficiency-based power and reserve against motor rating. Curves/catalogs are user supplied and are not manufacturer-certified selections. The curve is not coupled into the network solver.
- `analyzeElectricalCircuit` computes one-/three-phase demand current, impedance-based maximum symmetrical fault current, independently supplied minimum phase-to-earth fault current and circuit voltage drop. It checks `Ib ≤ In ≤ Iz`, breaking capacity, instantaneous pickup, supplied disconnection time, voltage-drop limit, and manufacturer-supplied maximum-fault let-through against `(kS)²`. Adiabatic maximum fault duration is reported separately. Use an outgoing/return loop impedance for single-phase conductor input and per-phase impedance for a balanced three-phase circuit.
- Electrical inputs require externally established ampacity, derating, source/earth-loop impedances, trip time and let-through. They do not implement IEC 60909, motor/generator contributions, DC asymmetry, arc flash, protection selectivity or a manufacturer's trip curve. [Schneider Electric's protection-setting guidance](https://productinfo.se.com/micrologicxuserguide/doca0102-micrologic-x/English/BM_MasterPact%20MTZ%20MicroLogic%20X_b5effd44_T001599214.xml/%24/TPC_ProtectionSettingGuidelines_b5effd44_T001599611) explains the need for established short-circuit calculations and installation-specific conductor data.
- `assessFireFlow` requires an explicit user criterion basis and unique water consumer nodes. It evaluates simultaneous delivered terminal flows/pressure, total flow and storage duration. Required storage covers the greater of declared fire duty and actual total network consumption. It does not infer hazard classification, remote area, hose demand, sprinkler spacing or NFPA/EN/local compliance. Pressure-dependent sprinkler emitters can be supplied explicitly.

## Native solver input adapters

`client/src/lib/solverAdapters.ts` exports:

1. `exportOpenSees2D`: Tcl `elasticBeamColumn` model, Linear/PDelta transformation, selected factored static combination, uniform/nodal loads and tagged displacement/reaction/global-force text outputs. OpenSees PDelta and the browser initial-stress formulation have different geometric assumptions.
2. `exportStaadPlane`: linear XY-plane `.std` subset with AX/IZ prismatic sections, member modulus, supports and local uniform/nodal loads. Geometric analysis is explicitly rejected in this adapter. AX/IZ properties cannot support section classification/code design.
3. `exportEpanetNetwork`: steady water `.inp`, LPS flow, metric geometry, Darcy roughness, reservoirs/junctions/pipes/emitters and fluid-property options. Constant head-gain links and demand/emitter loads on reservoirs are rejected. Air, native pump curves and temporal controls require other input adapters.

Exporting creates source text only. No adapter launches an executable, uploads a model or claims verified native results. ETABS/Robot licensed APIs, native nonlinear materials and certified result/design integration remain external work.

Syntax references: [OpenSees elasticBeamColumn](https://opensees.github.io/OpenSeesDocumentation/user/manual/model/elements/elasticBeamColumn.html), [PDelta](https://opensees.github.io/OpenSeesDocumentation/user/manual/model/geomTransf/PDelta.html), [uniform element loads](https://opensees.github.io/OpenSeesDocumentation/user/manual/model/pattern/PlainPatternloadcommands/eleLoad.html), [Bentley plane-frame constraints](https://bentleysystems.service-now.com/community?id=kb_article_view&sysparm_article=KB0112760), and [Bentley prismatic section scope](https://bentleysystems.service-now.com/community?id=kb_article_view&sysparm_article=KB0113774).

## No-run verification status

These files were authored and reviewed by source inspection only. No app, test, compiler, linter, build, sample calculation, engineering executable or format validator was executed. Matrix/sign conventions, iteration behavior, reference solutions, browser interactions and native input interoperability remain unverified. Every completed calculation report retains `verification: "unverified"`; meeting supplied numerical criteria does not change that status.
