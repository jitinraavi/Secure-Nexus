# External IFC acceptance

Groundwork's in-app checks remain internal preflight and source-metadata checks. They are not an external geometry round trip. The separate acceptance command below exports synthetic IFC4 fixtures and opens them with pinned **IfcOpenShell 0.8.5**, using its EXPRESS validator and OpenCASCADE geometry kernel.

## Run

Use an isolated Python 3.12 environment; these packages are validation tools, not application dependencies:

```sh
python3 -m venv .ifc-validation
.ifc-validation/bin/python -m pip install -r scripts/ifc-validation-requirements.txt
GROUNDWORK_IFC_PYTHON="$PWD/.ifc-validation/bin/python" npm run test:ifc
```

On Windows, set `GROUNDWORK_IFC_PYTHON` to the environment's `Scripts/python.exe`. Install Node dependencies with `npm ci` first. CI installs the same pinned requirements, requires the check to pass and retains only synthetic evidence for 14 days. The command fails on missing tooling or any failed assertion.

## Measured contract

`scripts/generate-ifc-validation-fixtures.mjs` exports seven independently dimensioned reference products in one synthetic project. Expected bounds and volumes are calculated from the fixture dimensions, independently of the exporter's geometry functions:

| Product | Acceptance |
|---|---|
| Rectangular column, translated and rotated 90 degrees | World bounds, solid volume, IFC class and material |
| Circular column | Analytic profile radius, world bounds and faceted solid volume |
| Wall with a window and an unfilled void | Two host void relationships, one filling and net physical volume |
| Wall rotated 37 degrees on an upper level | The same opening checks, transformed bounds and storey assignment |
| Concave L-shaped slab rotated 30 degrees | Polygon solid volume, transformed bounds and level/base-offset placement |
| Legacy east room wall | Correct width/depth axes and world placement |
| Legacy room space | Bounds align with its shell; spatial decomposition under its storey |

Every fixture also checks metre units, unique GUIDs and source IDs. After the external reader writes the file, the check reopens it and compares GUIDs, source IDs, world bounds and volumes again. Bounds tolerance is 0.1 mm for planar fixtures; the tessellated circle allows 1 mm bounds and 0.005 m³ volume difference while checking its analytic radius to 1 nm. Other solid volumes allow 0.000001 m³. Raw measurements, schema error counts and failure messages are written to `artifacts/ifc-interop/report.json`.

This acceptance exercise exposed and fixed invalid person/owner-history records, incorrect spatial containment/material associations for spaces and openings, legacy wall rotation and room-space placement errors, and authored unfilled voids that previously did not cut their hosts. Internal profile checks also accept legitimate unfilled openings while rejecting missing host/fill relationships and invalid spatial decomposition.

## Boundaries

Passing establishes this named reader/version and fixture contract. It does not establish Revit, Archicad, Solibri, arbitrary IFC import fidelity, every exported object, survey georeferencing, certification against an official MVD/IDS, or professional construction suitability. Each intended receiving application still needs representative project acceptance. The UI must continue to disclose unsupported/approximate coverage.

Reader API references: [IfcOpenShell geometry processing](https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html), [EXPRESS validation](https://docs.ifcopenshell.org/autoapi/ifcopenshell/validate/index.html).
