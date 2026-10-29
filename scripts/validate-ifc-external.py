"""External IFC4 acceptance checks, not interoperability certification.

Uses pinned IfcOpenShell's EXPRESS validator and OpenCASCADE geometry kernel:
https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html
https://docs.ifcopenshell.org/autoapi/ifcopenshell/validate/index.html
Only processes synthetic files produced by generate-ifc-validation-fixtures.mjs.
"""
import json
import math
from pathlib import Path
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.shape
import ifcopenshell.util.unit
import ifcopenshell.validate

ROOT = Path("artifacts/ifc-interop")
report = {"reader": "IfcOpenShell", "version": ifcopenshell.version, "scope": "Synthetic IFC4 fixtures; schema, geometry, units, hierarchy, identity and properties. Not general receiving-tool certification.", "fixtures": [], "failures": []}


def check(condition, message):
    if not condition:
        report["failures"].append(message)


for fixture in json.loads((ROOT / "manifest.json").read_text())["fixtures"]:
    source = ROOT / (fixture["name"] + ".ifc")
    model = ifcopenshell.open(str(source))
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(model, logger, express_rules=True)
    errors = [item for item in logger.statements if item["level"] == "error"]
    for item in errors:
        report["failures"].append(f"{fixture['name']} schema: {item['message']} ({item.get('instance', '')})")
    check(model.schema == fixture["schema"], "Unexpected IFC schema")
    check(ifcopenshell.util.unit.calculate_unit_scale(model) == 1, "Project length unit must be metres")
    guids = [element.GlobalId for element in model.by_type("IfcRoot")]
    check(len(guids) == len(set(guids)), "IFC identities must be unique")
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    measurements = []
    for expected in fixture["products"]:
        product = model.by_guid(expected["guid"])
        check(product.is_a() == expected["type"], f"{expected['id']} IFC class changed")
        psets = ifcopenshell.util.element.get_psets(product)
        check(psets.get("Groundwork Source", {}).get("SourceId") == expected["id"], f"{expected['id']} lost its source identity")
        if expected.get("storey"):
            container = ifcopenshell.util.element.get_container(product)
            check(container is not None and container.Name == expected["storey"], f"{expected['id']} storey changed")
        if expected.get("aggregateStorey"):
            parent = ifcopenshell.util.element.get_aggregate(product)
            check(parent is not None and parent.is_a("IfcBuildingStorey") and parent.Name == expected["aggregateStorey"], f"{expected['id']} storey decomposition changed")
            check(not any(product in relation.RelatedElements for relation in model.by_type("IfcRelContainedInSpatialStructure")), f"{expected['id']} space must not be contained as an ordinary element")
        if expected.get("material"):
            material = ifcopenshell.util.element.get_material(product)
            check(material is not None and material.Name == expected["material"], f"{expected['id']} material changed")
        if "voids" in expected:
            check(len(product.HasOpenings) == expected["voids"], f"{expected['id']} opening relationship count changed")
            check(sum(len(relation.RelatedOpeningElement.HasFillings) for relation in product.HasOpenings) == expected["fills"], f"{expected['id']} filled/unfilled openings changed")
        if "radius" in expected:
            solid = product.Representation.Representations[0].Items[0]
            check(solid.SweptArea.is_a("IfcCircleProfileDef") and abs(solid.SweptArea.Radius - expected["radius"]) < 1e-9, f"{expected['id']} analytic circle radius differs")
        try:
            shape = ifcopenshell.geom.create_shape(settings, product)
            vertices = shape.geometry.verts
            bounds = [[min(vertices[axis::3]), max(vertices[axis::3])] for axis in range(3)]
            for axis in range(3):
                for side in range(2):
                    check(abs(bounds[axis][side] - expected["bounds"][axis][side]) <= expected.get("boundsTolerance", 1e-4), f"{expected['id']} world bounds differ on axis {axis}: {bounds[axis]}")
            volume = ifcopenshell.util.shape.get_volume(shape.geometry)
            check(math.isfinite(volume) and abs(volume - expected["volume"]) <= expected["volumeTolerance"], f"{expected['id']} physical volume differs: {volume} vs {expected['volume']}")
            measurements.append({"sourceId": expected["id"], "globalId": product.GlobalId, "boundsM": bounds, "volumeM3": volume})
        except Exception as error:
            report["failures"].append(f"{expected['id']} external geometry failed: {type(error).__name__}: {error}")
    rewritten = ROOT / (fixture["name"] + "-ifcopenshell.ifc")
    model.write(str(rewritten))
    received = ifcopenshell.open(str(rewritten))
    check(sorted(element.GlobalId for element in received.by_type("IfcRoot")) == sorted(guids), "Reader write/reopen changed GUIDs")
    for expected in fixture["products"]:
        restored = received.by_guid(expected["guid"])
        check(ifcopenshell.util.element.get_psets(restored).get("Groundwork Source", {}).get("SourceId") == expected["id"], f"{expected['id']} lost its source identity after external write/reopen")
        try:
            restored_shape = ifcopenshell.geom.create_shape(settings, restored)
            restored_volume = ifcopenshell.util.shape.get_volume(restored_shape.geometry)
            restored_vertices = restored_shape.geometry.verts
            restored_bounds = [[min(restored_vertices[axis::3]), max(restored_vertices[axis::3])] for axis in range(3)]
            check(abs(restored_volume - expected["volume"]) <= expected["volumeTolerance"], f"{expected['id']} geometry volume changed after external write/reopen")
            check(all(abs(restored_bounds[axis][side] - expected["bounds"][axis][side]) <= expected.get("boundsTolerance", 1e-4) for axis in range(3) for side in range(2)), f"{expected['id']} world geometry changed after external write/reopen")
        except Exception as error:
            report["failures"].append(f"{expected['id']} external rewritten geometry failed: {type(error).__name__}: {error}")
    report["fixtures"].append({"name": fixture["name"], "schemaErrorCount": len(errors), "measurements": measurements})

report["ok"] = not report["failures"]
(ROOT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"ok": report["ok"], "reader": report["reader"], "version": report["version"], "fixtures": len(report["fixtures"]), "failures": len(report["failures"]), "report": str(ROOT / "report.json")}))
for failure in report["failures"][:20]:
    print(failure)
raise SystemExit(0 if report["ok"] else 1)
