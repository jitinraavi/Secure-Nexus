import type { Design, MepElement, ReviewMarker } from "../types";

export interface ExchangeEntity {
  id: string;
  type: string;
  name?: string;
  levelId?: string;
  geometry?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}

const number = (value: number) => Math.round(value * 1000) / 1000;

function entity(id: string, type: string, data: Omit<ExchangeEntity, "id" | "type"> = {}): ExchangeEntity {
  return { id, type, ...data };
}

function mepEntity(element: MepElement): ExchangeEntity {
  return entity(element.id, `MEP_${element.kind.toUpperCase().replace("-", "_")}`, {
    name: element.name,
    levelId: element.levelId,
    geometry: { kind: "polyline", points: element.route, widthM: element.width, heightM: element.height, diameterM: element.diameter },
    properties: { visible: element.visible, approximation: "Coordination route and nominal envelope; not fabrication geometry." },
  });
}

function reviewEntity(marker: ReviewMarker): ExchangeEntity {
  return entity(marker.id, "REVIEW_MARKER", {
    name: marker.text,
    geometry: { kind: "point", xM: number(marker.x), zM: number(marker.z) },
    properties: { severity: marker.severity, status: marker.status, targetIds: marker.targetIds ?? [] },
  });
}

/** IFC-like exchange for coordination tools. This is JSON, not a standards-compliant IFC file. */
export function buildBimExchange(design: Design): string {
  const entities: ExchangeEntity[] = [];
  const room = design.room;
  entities.push(entity("room", "SPACE", {
    name: "Room shell",
    geometry: { kind: "box", widthM: room.widthMm / 1000, depthM: room.depthMm / 1000, heightM: room.wallHeightMm / 1000 },
    properties: { wallColor: room.wallColor, floorColor: room.floorColor },
  }));

  for (const item of design.furniture) {
    entities.push(entity(item.id, "FURNISHING", {
      name: item.name,
      geometry: { kind: "box", xM: item.x / 1000, zM: item.z / 1000, rotationDeg: item.rotationDeg, scale: item.scale },
      properties: { catalogType: item.type, color: item.color, mount: item.mount ?? "unassigned", mountWall: item.mountWall },
    }));
  }
  for (const element of design.mep?.elements ?? []) entities.push(mepEntity(element));

  for (const c of [design.community, design.infra]) {
    if (!c) continue;
    for (const draft of c.drafts ?? []) {
      entities.push(entity(draft.id, `DRAFT_${draft.kind.toUpperCase()}`, {
        name: draft.label,
        geometry: { xM: draft.x, zM: draft.z, widthM: draft.w, depthM: draft.d, heightM: draft.h, rotationDeg: draft.rotationDeg },
        properties: { color: draft.color, civilKind: draft.civilKind, elevationM: draft.elevationM, gradePct: draft.gradePct },
      }));
    }
    if ("amenities" in c) {
      for (const amenity of c.amenities) {
        entities.push(entity(amenity.id, "SITE_AMENITY", {
          name: amenity.label ?? amenity.kind,
          geometry: { kind: amenity.shape ?? "box", xM: amenity.x, zM: amenity.z, widthM: amenity.w, depthM: amenity.d, heightM: amenity.h, rotationDeg: amenity.rotY },
          properties: { kind: amenity.kind, approximation: "Parametric site object; verify location and construction details." },
        }));
      }
      for (const roomPlan of c.interiors) {
        entities.push(entity(roomPlan.id, "SPACE", {
          name: roomPlan.name,
          levelId: roomPlan.towerId,
          geometry: { kind: "box", xM: roomPlan.x, zM: roomPlan.z, widthM: roomPlan.w, depthM: roomPlan.d, floor: roomPlan.floor },
          properties: { roomType: roomPlan.type, approximation: "Planning room envelope; openings and finishes are not fully exchanged." },
        }));
      }
      for (const panel of c.exteriors) {
        entities.push(entity(panel.id, "FACADE_PANEL", {
          name: panel.material,
          geometry: { kind: "panel", xM: panel.x, yM: panel.y, widthM: panel.w, heightM: panel.h },
          properties: { towerId: panel.towerId, face: panel.face, approximation: "Facade intent panel; connections and build-up are not modeled." },
        }));
      }
      if (c.parking.mode !== "none") {
        entities.push(entity("parking", "PARKING_STRUCTURE", {
          properties: { mode: c.parking.mode, surfaceBays: c.parking.surfaceBays, underground: c.parking.underground },
        }));
      }
    }
    for (const level of "levels" in c ? c.levels ?? [] : []) {
      entities.push(entity(level.id, "BUILDING_STOREY", {
        name: level.name,
        properties: { elevationM: level.elevation, floorHeightM: level.floorHeight },
      }));
    }
    for (const grid of "structuralGrid" in c ? c.structuralGrid ?? [] : []) {
      entities.push(entity(grid.id, "GRID_AXIS", {
        name: grid.label,
        geometry: { axis: grid.axis, positionM: grid.position, extentM: grid.extent },
        properties: { color: grid.color },
      }));
    }
    for (const marker of c.review?.markers ?? []) entities.push(reviewEntity(marker));
    for (const element of c.mep?.elements ?? []) entities.push(mepEntity(element));
    if (c.terrain) {
      entities.push(entity("terrain", "TERRAIN_SURFACE", {
        properties: { ...c.terrain, approximation: "Deterministic local profile; no surveyed DEM or georeferenced surface." },
      }));
    }
    if ("structural" in c && c.structural) {
      entities.push(entity("structural-settings", "STRUCTURAL_ANALYSIS_INPUT", {
        properties: { ...c.structural, approximation: "Preliminary screening inputs; not a design-code calculation." },
      }));
    }
    if ("towers" in c) {
      for (const tower of c.towers) entities.push(entity(tower.id, "BUILDING", {
        name: tower.label,
        geometry: { xM: tower.x, zM: tower.z, floors: tower.floors, widthM: tower.unitWidth, depthM: tower.unitDepth, floorHeightM: tower.floorHeight },
        properties: { unitsPerFloor: tower.unitsPerFloor, facadeMaterial: tower.facadeMaterial },
      }));
    }
    if ("facilities" in c) {
      entities.push(entity("infra-model", "INFRASTRUCTURE_MODEL", {
        name: c.kind,
        properties: { kind: c.kind, highway: c.highway, airport: c.airport, ports: c.ports, dams: c.dams, approximation: "Parametric infrastructure summary; alignment and engineering disciplines require detailed design." },
      }));
      for (const facility of c.facilities ?? []) entities.push(entity(facility.id, "INFRA_FACILITY", {
        name: facility.kind,
        properties: { kind: facility.kind, count: facility.count, lengthM: facility.lengthM, widthM: facility.widthM, heightM: facility.heightM },
      }));
    }
  }

  return JSON.stringify({
    exchange: "groundwork-ifc-like",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    units: "metres",
    standards: { ifc: false, note: "IFC-like coordination JSON; map entities to IFC classes in a downstream converter." },
    approximations: [
      "Drafting and structural geometry is exported as lightweight editable intent.",
      "Terrain is a local deterministic profile unless a surveyed surface is supplied.",
      "MEP routes are nominal coordination envelopes, not fabrication or code-compliant systems.",
      "Review markers and analysis inputs are metadata, not certification.",
    ],
    entities,
  }, null, 2) + "\n";
}

function ifcText(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function ifcGuid(index: number): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
  let value = index;
  let result = "";
  for (let i = 0; i < 22; i++) {
    result = alphabet[value % alphabet.length] + result;
    value = Math.floor(value / alphabet.length);
  }
  return result;
}

/**
 * Small IFC4 STEP coordination export. It intentionally uses proxy elements
 * without fabrication geometry: the source model is mostly planning intent,
 * while the hierarchy and names remain consumable by IFC viewers.
 */
export function buildIfcStep(design: Design): string {
  const exchange = JSON.parse(buildBimExchange(design)) as { entities: ExchangeEntity[] };
  const rows: string[] = [];
  const add = (type: string, fields: string) => {
    const id = rows.length + 1;
    rows.push(`#${id}=${type}(${fields});`);
    return id;
  };
  const owner = add("IFCPERSON", "$,$,'Groundwork',$,$,$,$");
  const org = add("IFCORGANIZATION", "$,'Groundwork',$,$,$");
  const personOrg = add("IFCPERSONANDORGANIZATION", `#${owner},#${org},$`);
  const application = add("IFCAPPLICATION", `#${org},'1.0','Groundwork Design Studio','GROUNDWORK'`);
  const history = add("IFCOWNERHISTORY", `#${personOrg},#${application},$,.ADDED.,$,$,$,0`);
  const origin = add("IFCCARTESIANPOINT", "((0.,0.,0.))".replace("((", "(").replace("))", ")"));
  const up = add("IFCDIRECTION", "((0.,0.,1.))".replace("((", "(").replace("))", ")"));
  const worldAxis = add("IFCAXIS2PLACEMENT3D", `#${origin},$,#${up}`);
  const context = add("IFCGEOMETRICREPRESENTATIONCONTEXT", `$, 'Model', 3, 1.E-05, #${worldAxis},$`);
  const metre = add("IFCSIUNIT", "*,.LENGTHUNIT.,$,.METRE.");
  const units = add("IFCUNITASSIGNMENT", `(#${metre})`);
  const project = add("IFCPROJECT", `'${ifcGuid(1)}',#${history},'Groundwork exchange',$,$,$,$,$,$,(#${context}),#${units}`);
  const placementAxis = add("IFCAXIS2PLACEMENT3D", `#${origin},$,#${up}`);
  const sitePlacement = add("IFCLOCALPLACEMENT", `$,#${placementAxis}`);
  const site = add("IFCSITE", `'${ifcGuid(2)}',#${history},'Design site',$,$,#${sitePlacement},$,$,.ELEMENT.,$,$,$,$,$`);
  const building = add("IFCBUILDING", `'${ifcGuid(3)}',#${history},'Groundwork model',$,$,#${sitePlacement},$,$,.ELEMENT.,$,$,$`);
  const storey = add("IFCBUILDINGSTOREY", `'${ifcGuid(4)}',#${history},'Coordination level',$,$,#${sitePlacement},$,$,.ELEMENT.,0.`);
  const aggregate = (name: string, parent: number, children: number[]) => add("IFCRELAGGREGATES", `'${ifcGuid(rows.length + 10)}',#${history},${ifcText(name)},$,#${parent},(${children.map((id) => `#${id}`).join(",")})`);
  aggregate("Project site", project, [site]);
  aggregate("Building", site, [building]);
  aggregate("Coordination level", building, [storey]);

  const products = exchange.entities.map((item, index) => {
    const point = add("IFCCARTESIANPOINT", `(${number(Number(item.geometry?.xM ?? 0)).toFixed(3)},${number(Number(item.geometry?.zM ?? 0)).toFixed(3)},0.)`);
    const axis = add("IFCAXIS2PLACEMENT3D", `#${point},$,#${up}`);
    const local = add("IFCLOCALPLACEMENT", `$,#${axis}`);
    const geometryNote = item.geometry ? `Approximate ${item.type} intent: ${JSON.stringify(item.geometry).slice(0, 350)}` : `Approximate ${item.type} intent`;
    return add("IFCBUILDINGELEMENTPROXY", `'${ifcGuid(100 + index)}',#${history},${ifcText(item.name || item.type)},${ifcText(`${geometryNote}. Not fabrication geometry.`)},$,#${local},$,$`);
  });
  aggregate("Model elements", storey, products);

  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('Groundwork coordination export'),'2;1');",
    "FILE_NAME('groundwork.ifc','2026-01-01T00:00:00',('Groundwork'),('Groundwork'),'Groundwork Design Studio','Groundwork','');",
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
    ...rows,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}

function csvCell(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildBimScheduleCsv(design: Design): string {
  const exchange = JSON.parse(buildBimExchange(design)) as { entities: ExchangeEntity[] };
  const rows = ["id,type,name,levelId,geometry,properties"];
  for (const item of exchange.entities) {
    rows.push([item.id, item.type, item.name ?? "", item.levelId ?? "", item.geometry ?? {}, item.properties ?? {}].map(csvCell).join(","));
  }
  return rows.join("\n") + "\n";
}
