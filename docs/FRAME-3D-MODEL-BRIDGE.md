# Structural exchange to authored 3D frame

`client/src/lib/engineeringModelBridge3D.ts` converts the Community Editor's version-1 `groundwork-structural-analysis-model` SI JSON into the bounded editable `FrameModel3D` schema. It complements the planar-slice bridge; it does not reinterpret a raw visual CAD design as an engineering model.

Public APIs:

```ts
parseFrameBridgeOptions3D(value: unknown): FrameBridgeOptions3D
importStructuralExchange3D(value: unknown, options: FrameBridgeOptions3D): {
  model: FrameModel3D;
  warnings: string[];
}
```

## Explicit import options

```json
{
  "areaM2": 0.01,
  "inertiaYM4": 0.00002,
  "inertiaZM4": 0.00004,
  "torsionConstantM4": 0.00001,
  "elasticModulusPa": 200000000000,
  "shearModulusPa": 77000000000,
  "localYAxis": [1, 1, 1],
  "acceptAssumedFixedSupports": false
}
```

These are user-entered uniform overrides, not inferred section properties. The values above illustrate the schema only. The importer copies A, Iy, Iz, Saint-Venant J, E and G to every imported line member. Source widths, depths, tributary widths and screening capacities do not establish these properties. Review and replace each member's values after conversion. J is not inferred as Iy + Iz.

`localYAxis` is an explicit global reference vector for all imported members. The 3D parser projects it perpendicular to each member's start-to-end axis. A zero or nearly parallel reference rejects the import with the offending member ID and an instruction to change the reference or author a separate per-member `FrameModel3D` JSON. The example `[1,1,1]` can still be parallel to a diagonal member; no orientation fallback is applied.

## Geometry and support policy

- Retain beam, column and brace line members with their exact source IDs and referenced global X/Y/Z coordinates. Their modeled connections are rigid; a brace is an elastic beam member, not an automatically released truss.
- Skip known wall/slab representatives and report their count. Wall/slab shell stiffness, diaphragm action, foundations and other visual CAD objects are not converted to beams. Unknown member kinds, releases, springs, offsets, nodal restraints embedded in the geometry exchange and other unsupported schema fields reject the import rather than silently disappearing.
- Omit source nodes not used by retained line members, with a count in the warnings. Bound the retained model to 30 nodes and 60 members. The source may contain at most 20,000 node or member records; exceeding the solver bound requires a smaller exported subset, not arbitrary truncation.
- Preserve distinct node IDs even when coordinates coincide. No tolerance welding or automatic connection of crossings occurs. Shared node IDs establish joints; independently review the source's connectivity and its inferred geometry warnings.
- Start with all six node DOFs unrestrained. Only the explicit `acceptAssumedFixedSupports` choice can copy source `assumedRestraint: "fixed"` records, restraining all six DOFs at imported support nodes. These remain accepted source assumptions, not verified boundary conditions. Other support forms must be authored directly in the analysis JSON.
- Keep unused assumed-support records out of the retained model and disclose their count. Validate all declared source support references, even when the support opt-in is off; malformed references cannot silently enter a future import.

The imported model contains one empty `user-loads` case and no combinations. Source demand screens, gravity loads, self-weight, member/foundation screens, load combinations, verification labels and model fingerprints do not become applied loads or certified solver results. Establish actual loads and combinations independently. Project country/adopted-edition metadata is captured separately by the workbench rather than supplied by this geometry converter.

## Validation and limitations

Options and numerical geometry are finite and bounded. Source node/member IDs must be unique and references must exist. Only version 1 SI exchange is accepted. Source geometry records and import options reject unrecognized fields. The resulting model is checked by `parseFrameModel3D` for zero-length members, local-axis degeneracy and the strict analytical schema. Conversion preserves an editable template; it does not solve the model or certify support stability. An unrestrained, disconnected or ill-conditioned model may import successfully and will be rejected by analysis until corrected.

No app, tests, build, typechecker, previews or native solver were run for this module. Deferred verification includes source-ID preservation, reordered nodes, parallel references, known-surface omission, rejected unknown member features, coincident-but-distinct IDs, missing supports, opt-in fixed support mapping, capacity bounds and independent analysis of a reviewed imported spatial frame. See [FRAME-3D-ANALYSIS.md](FRAME-3D-ANALYSIS.md) for solver assumptions, force conventions, conservative deflection screening and required numerical benchmarks.
