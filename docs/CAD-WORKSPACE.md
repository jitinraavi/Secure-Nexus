# Groundwork CAD workspace — release 1.2

Groundwork opens existing projects in a shared architectural and engineering canvas.
The **Project modules** button retains the existing room/community/infrastructure,
civil, structural, documentation, exchange and presentation workflows. This release
extends the deployed React/TypeScript application; it does not replace its backend,
authentication, billing or database.

## Architectural authoring

Create rectangular/circular columns, walls, beams, slabs and supported roof envelopes
on the active floor/working elevation. Empty projects offer an explicitly created
starter frame: a slab, four columns, two beams and a wall, in one undo transaction.
The explorer controls selection, object visibility and editing locks. The inspector
controls semantic dimensions, position, rotation, material, level and wall openings.

Select a solid to expose local face grips. Drag a top grip for height, a side grip
for section/span or a slab face for thickness. The opposite face stays fixed;
**Symmetric** keeps the centre fixed. Dimensions use camera rays and world/local
axes. Rotated members keep their orientation. A nearly end-on axis requires exact
entry or another view. Click an on-canvas dimension to begin numeric resizing, enter
a value and press Enter; Escape restores the complete pre-operation document.
Invalid, inverted, nonfinite and out-of-range dimensions are rejected. Minimum solid
dimension is 10 mm. Pointer cancellation, window focus loss and access/context
changes cancel a preview. A completed drag produces one history entry and one save.

Use V to select, M to move, R to rotate, S to resize, F to fit selection/model,
Ctrl/Cmd+D to duplicate, Delete to delete, Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z
or Ctrl+Y to redo. Ctrl/Cmd+S saves. Inspector fields commit on Enter or blur.
Display units are metres, millimetres or feet; changing units never scales the model.
Drafts/MEP store metres; legacy room/furniture data retain their millimetre schema.

Right drag orbits, middle drag pans, and wheel zooms. Top/front/side/isometric views,
perspective/orthographic projection, shaded/edge/wireframe modes, section clipping,
adaptive grids, geometric snap feedback and fit controls share the same geometry.

## Electrical and plumbing authoring

Switch disciplines and open **Systems**. Choose the system, floor and elevation,
then place devices or routes using exact coordinates. Select a device/route from
the system explorer or canvas. Edit endpoints, bends, segment offsets, dimensions,
mounting orientation and elevations. A route is committed atomically; bend insert,
remove, connect and disconnect also use the common command history.

Ports have stable identifiers, a system and a medium. **Connect ports** creates an
explicit topology edge. Ports must be compatible and coincident within 5 mm unless
the user explicitly chooses alignment. Crossings and proximity never create edges.
Conduits/trays are containment, separate from conductors and circuit membership.
Moving endpoints preserves declared edges and reports broken physical connections
instead of silently rerouting unrelated systems. Tracing and connected/open/broken
symbols explain topology. Hidden elements remain in schedules and calculations.

For electrical analysis, place a panel, conductors and terminal devices; explicitly
connect them, create a circuit, assign its panel/devices/cables, enter device loads,
then author all conductor, supply and protection criteria plus a design basis.
The existing deterministic circuit solver uses actual assigned route length and
loads. Missing inputs cause an incomplete/error state; they never receive silent
conductor/protection defaults. Reports include source revision, captured inputs,
units, method and basis. Circuit tracing/diagrams describe explicit connectivity.

Cold/hot pressure-water analysis uses the existing steady network solver. Author
source head, terminal demands, pipe sizes/roughness/minor losses, water properties
and basis. Sanitary/stormwater review separately reports geometric slope, reverse
segments and invert levels against supplied slope criteria. It does not claim
drainage capacity or vent design. Vent analysis is explicitly unavailable. Existing
HVAC objects and modules remain available in coordination views.

Hosted coordination references preserve authored world coordinates. Host changes
or deletion produce review issues; the app never automatically cuts a structure
or alters unrelated routes. Explicitly review/reassign the host after a change.

## Engineering and coordination

The **Analysis** tab maps a selected beam/column's actual section and length into
the existing elastic frame solver. Material E, loads including explicit zero,
restraints and design basis must be authored. The local fixed-start/free-end
template is a single-member assessment, not an inferred whole-building model.
Existing civil, structural frame, load and design-code workbenches remain in Project
modules/Engineering for their declared supported scopes and authored inputs.

Geometry changes update lightweight quantities and invalidate dependent results.
Expensive calculations run after editing by explicit request. Geometry and engineering
inputs are separate. Current/historical/incomplete/unsupported states are distinct;
recording an old asynchronous result is rejected. Undo restores the geometry/result
pair while keeping command revisions monotonic.

The **Coordination** mode offers an explicit worker-based physical mesh intersection
check using the same authored meshes as the viewport/GLB. Hidden elements are included.
It is bounded to 150,000 triangles/10,000 meshes with a 30-second deadline. Partial
reports disclose solver limits. Stale results are discarded. Findings select and
focus the relevant objects. Separate envelope warnings are approximate and bounded
to the first 200 objects. Neither check authorizes structural penetrations.

## Persistence, compatibility and exchange

Geometry stays in existing community/infrastructure drafts or the additive root
`Design.drafts` collection for room projects. Optional version-1 `cad` and
`cadNetworks` metadata add levels, stable IDs, revisions, topology and evidence.
Missing fields resolve to compatible defaults. The parent Design version remains 1;
no database migration or client-side database credential is needed.

All edits use `executeCadCommand`, including properties, tool previews, network
operations and replacement documents. The editor retains authenticated access,
server revision checks, encrypted saves, collaboration, history and offline recovery.
Remote replacements clear local undo history. Viewers and unresolved revision
conflicts cannot commit changes. A preview is never autosaved.

**Model JSON** captures authored SI geometry, networks and analytical evidence with
source revision. **GLB** exports the authored meshes, including hidden authored
objects. Existing DXF, BIM JSON, IFC and documentation exports remain available in
Project modules. DXF is a millimetre 2D plan; BIM JSON is the Groundwork exchange
contract, not an IFC file. IFC retains supported parametric solids and explicit
approximation notices. Reports/schedules retain stable source identifiers.

The workspace is a parametric modeling layer with bounded mesh operations, not a
general-purpose B-rep kernel or a replacement for professional design verification.
Detailed roof build-ups, arbitrary boolean editing, fabrication geometry, complete
drainage/vent design and automatic national-code compliance are outside this scope.
MCP services are not invented: no CAD-editing MCP server is configured in this repo.
Existing native service adapters remain intact. Any future automated edit must use
the same revisioned commands and existing project authorization; AI prose is never
substituted for a deterministic numerical result.

## Development and verification

Run `npm ci`, `npm run dev`, then open an existing project. `npm run test:cad -w
client` runs geometry, topology, coordination and exchange regression tests.
`npm run lint`, `npm run build` and `npm test` retain the full application checks.
See [verification evidence](CAD-VERIFICATION.md) for the tested workflows and limits.
Production release uses the existing exact-commit CI release gate and Vercel setup.
No paid services or new environment secrets are required for these CAD features.
