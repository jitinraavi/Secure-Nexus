# Implementation continuation — 2 October 2026

Branch: `upgrade/r1-modeling-core`  
Updated continuation: [Remaining module completion](REMAINING-MODULES-COMPLETION.md) supersedes the recovery, worker, presentation and enterprise boundaries described in this earlier report.
Starting commit: `d3e73f789d776032eb58ecd798363757f75db12a`

This continuation resumes the committed terrain/civil work. The provided workspace contained no previous uncommitted repository edits. Synced project reference files were left unchanged.

## Pushed implementation commits

| Commit | Scope |
| --- | --- |
| `ed503d25b25a3bc3e1117d73074cd686006dc6bf` | Survey terrain, civil controls, corridor profiles, quantities, drainage and LandXML |
| `eb37e4eb3dc29d54fc10d60c68bbb4124278961d` | Lock enforcement, atomic operation logging, shared-DB event replay and local draft recovery |
| `1b942255a58fd66e09a8ca17414616908cc9b5fa` | IFC placement/record corrections, DATA normalization and source metadata round-trip inspection |
| `fb4225f30ac086e8c0a1c2275ebe624b241999ad` | Spatial clash candidates, renderer counters, deferred reporting and resource cleanup |
| `54bd1bfab2dece3fa91df4fa30065aaddd5ac5ee` | Structural grid framing, solver exchange details, graph continuity and branched MEP connections |

A subsequent inspection/report commit corrects slab section thickness and beam tributary widths. Its SHA is available in branch history.

## Completed integrations

- **Civil:** Survey CSV UI with row validation and duplicate-coordinate rejection; recorded CRS and local survey origin; normalized-coordinate unconstrained Delaunay TIN; shared terrain triangles for rendering/contours/LandXML; TIN interpolation inside the convex hull and nearest-eight IDW outside; slope summaries; bounded contour density and batched contour lines.
- **Corridor and drainage:** Persistent station interval, corridor width, constant grade, crown crossfall and rational-method rainfall/runoff inputs; profiles and sampled sections; average end-area cut/fill volumes; report, station CSV and LandXML export. Exports now join consecutive stations rather than creating zero-length alignment lines.
- **Collaboration:** Foreign entity locks protect operations, whole-design saves and snapshot restores; project/unknown-object locks conservatively protect the complete design. Team controls acquire, renew and release locks and show presence. Revocation/demotion removes locks; streaming access is rechecked. Array operations retain arrays and reject invalid paths. SQLite transactions commit revision and operation-log changes together.
- **Recovery:** Per-user, per-project sessionStorage retains a failed design save in the current browser tab. Save attempts are serialized and preserve the original base revision after failure. Recovery offers retry, download or discard/reload. Remote operation changes now appear in the editor. No automatic conflict rebasing or remote overwrite is performed.
- **BIM:** Corrected local-placement parents, storey-relative elevation, world axes, several STEP argument lists, grid axes and opening relationships/property sets. Normalization retains entities within DATA. SourceData metadata is preserved and checked through export/recovery. The inspector reads Groundwork source records without applying geometry.
- **Performance:** Bounded spatial hash with replacement/removal and large-envelope fallback; spatial candidates feed the existing rotated-envelope narrow phase; candidate pairs stream through a generator. Export validation and JSON benchmarks are deferred until panels open. Animated community/infrastructure views report FPS, draw calls, triangle and geometry/texture counts. Resource disposal includes lines, points and instanced meshes while preserving cached materials.
- **Engineering:** Inferred beams between adjacent grid lines, rotated drafted member endpoints, single-level inferred columns, base-level foundation screens and story-aware gravity allocation. Force and moment fields are distinguished. Solver JSON includes assumed support nodes, screening results and assumptions. Engineering profiles sanitize numeric inputs; zero dead/live load inputs are retained.
- **MEP:** Reciprocal branch connections, connection cleanup on deletion, same-system continuity, deduplicated undirected edges, invalid-reference reporting and iterative cycle traversal. Hidden elements remain in the engineering graph. Automatic connections use touching endpoints within 0.20 m. Per-route capacity screening no longer divides total demand by the count of series routes.

## Verification and limits

Only repository-file inspection and GitHub file/commit operations were performed. **No app, tests, type checker, build, preview, solver or exchange validator was run.** Type safety was reviewed from declarations/imports/call sites; it has not been verified by the compiler. The branch was updated by fast-forward commits, with no merge to main.

The following capabilities remain outside these implemented planning integrations, rather than being represented as production-complete:

- Professional structural/nonlinear/P-delta analysis, code design and native OpenSees/ETABS/STAAD/Robot adapters. The exchange remains generic SI JSON with assumed supports; gravity redistribution and flexural capacity are screening approximations.
- Balanced hydraulic/HVAC network solving, equipment selections, verified electrical protection/fault calculations and fire-code design. Current flow/electrical results retain stated planning assumptions.
- Generic IFC geometry import, buildingSMART schema/IDS/MVD certification and Revit/Archicad geometry round trips. Source metadata stability is not geometry fidelity. Local preflight success is not standards certification.
- Survey breaklines/holes, CRS reprojection, LAS/GeoTIFF/DEM import and full civil horizontal/vertical curve design. New CSV imports are limited to 2,000 points. Older programmatically stored larger surveys require reduction before TIN use. Corridor geometry/quantities are sampled planning studies without side slopes, bulking or hydraulic routing.
- Redis/multi-host event transport, distributed presence and durable offline operation synchronization. Event polling supports processes sharing this SQLite DB; presence remains process-local. Recovery stores plaintext design data in the user-scoped browser tab's sessionStorage and depends on available storage quota.
- Proven 10k/100k model performance, a general worker/streaming/LOD pipeline and GPU byte accounting. Renderer counters become observable only when the user later runs the app; no performance claims were measured here.
- Exact general solid/mesh clashes. Spatial indexing accelerates the existing envelope/SAT checks, which retain their approximation labels.

Unverified risks include TypeScript/runtime integration defects, numeric edge cases in triangulation and corridor sampling, IFC/LandXML interoperability, concurrent lock/save behavior across processes and browser/GPU resource behavior. Representative execution and external validation remain necessary before production or engineering use.
