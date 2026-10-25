# CAD release verification

Verified on 25 October 2026 against the active `Secure-Nexus` application source.
The local browser fixture used the real Express authentication, encrypted project
storage and revision-aware API with an isolated synthetic SQLite database. Hosted
production data and real customer accounts were not used for fixture edits.

## Automated checks

| Check | Result |
| --- | --- |
| Server regression suite | 150 passed |
| Client security/resilience/CAD suite | 82 passed, including 50 CAD tests |
| Studio interaction tests | 8 passed |
| Private mail setup tests | 2 passed |
| Operational/backup/release tests | 19 passed |
| Production client/API build | Passed |
| Integrated build preflight | Passed |

The provider response-limit test encountered a local deadline failure during an
earlier concurrent run. Its isolated rerun and the subsequent full server suite
passed. The release gate additionally runs the exact pushed source in Linux CI,
including PostgreSQL API flow, bounded capacity and a native PostgreSQL backup drill.

The CAD tests cover anchored positive/negative faces, rotated geometry, symmetric
resize, circular sections, level offsets, invalid geometry, true snapping, polygon
validation/quantities, opening overlap, atomic commands, cancellation snapshots,
revision/access rejection, dependent analysis invalidation, real connector topology,
incompatible systems/media, routing edits/deletion, visibility-independent totals,
missing engineering inputs, pressure-water analysis, gravity/vent scope, mesh
coordination and dimension/identity consistency in exchange formats.

## Browser acceptance evidence

- Created the eight-object starter frame, saved and reloaded it through the API.
- Selected a column, dragged its top face, and observed immediate metric geometry,
  dimensions and inspector updates. Undo/redo restored the exact parameters.
- Set width 0.6 m, depth 0.5 m and rotation 30°. On-canvas numeric height editing
  previewed 4.2 m; Enter committed, undo restored 3.6 m and redo restored 4.2 m.
  Escape restored an uncommitted resize. Millimetre display retained physical size.
- Created an electrical panel, a 2 m cable and a 0.06 kW light, explicitly connected
  both ends, assigned a circuit and authored supply/conductor/protection criteria.
  Calculation returned 0.260869565 A and 0.004536862% voltage drop. Editing the cable
  to 3 m marked the report stale and identified separated ports. Undo restored
  geometry and connectivity. Saved circuit metadata/report survived editor reloads.
- Created a cold-water source, 25 mm pipe and outlet with explicit port connections,
  source head 30 m and demand 0.1 L/s. Authored density, viscosity, roughness and
  minor losses. The solver converged in three iterations with mass residual below
  1e-9 m³/s. These are synthetic verification inputs, not a building design.
- Created a sanitary branch from centre elevation 1 m to 0.96 m over a 2 m plan run.
  The separate gravity review displayed 2% slope and 0.95/0.91 m invert elevations
  for the 100 mm pipe. Required slope was explicitly entered.
- Ran the physical mesh coordination worker and obtained a complete scoped report
  with object-linked findings, distinct from approximate envelope warnings.
- Enabled slab boundary vertices and dragged one corner. The actual footprint
  changed from 48 to 51 m², and width from 8 to 9 m, in one command transaction.
- Downloaded model JSON and GLB from the UI. JSON retained eight architectural
  objects, seven network elements and four explicit connections at model r43.
  Inspecting the GLB position accessor confirmed column local dimensions
  0.600000024 × 4.199999809 × 0.5 m (ordinary Float32 export precision).
- At a 390 × 844 responsive test size both side panels initially collapsed, the
  canvas remained usable, and document width matched viewport width. The temporary
  viewport override was reset after testing.

## Supported scope

Read [CAD-WORKSPACE.md](CAD-WORKSPACE.md) for operating instructions and explicit
engineering limits. Results against supplied criteria do not establish national-code
compliance. The member template does not assemble a whole-building analytical model;
drainage capacity and vent analysis remain unavailable. Existing advanced civil,
structural and HVAC modules retain their separate authored models and design bases.
