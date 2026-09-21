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
  const roomWidth = room.widthMm / 1000;
  const roomDepth = room.depthMm / 1000;
  const roomHeight = room.wallHeightMm / 1000;
  entities.push(
    entity("room-slab", "SLAB", {
      name: "Room floor slab",
      geometry: { kind: "box", xM: roomWidth / 2, zM: roomDepth / 2, widthM: roomWidth, depthM: roomDepth, heightM: 0.15 },
      properties: { approximation: "Nominal room floor slab; thickness is an exchange default." },
    }),
    entity("room-roof", "ROOF", {
      name: "Room roof",
      geometry: { kind: "box", xM: roomWidth / 2, zM: roomDepth / 2, yM: roomHeight, widthM: roomWidth, depthM: roomDepth, heightM: 0.15 },
      properties: { approximation: "Nominal flat roof; roof build-up and drainage are not modeled." },
    }),
    entity("room-wall-north", "WALL", { name: "North wall", geometry: { kind: "box", xM: roomWidth / 2, zM: 0, widthM: roomWidth, depthM: 0.15, heightM: roomHeight } }),
    entity("room-wall-south", "WALL", { name: "South wall", geometry: { kind: "box", xM: roomWidth / 2, zM: roomDepth, widthM: roomWidth, depthM: 0.15, heightM: roomHeight } }),
    entity("room-wall-east", "WALL", { name: "East wall", geometry: { kind: "box", xM: roomWidth, zM: roomDepth / 2, widthM: 0.15, depthM: roomDepth, heightM: roomHeight, rotationDeg: 90 } }),
    entity("room-wall-west", "WALL", { name: "West wall", geometry: { kind: "box", xM: 0, zM: roomDepth / 2, widthM: 0.15, depthM: roomDepth, heightM: roomHeight, rotationDeg: 90 } }),
  );

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
        for (const opening of roomPlan.openings ?? []) {
          entities.push(entity(opening.id, opening.kind === "door" ? "DOOR" : "WINDOW", {
            name: `${opening.kind} ${opening.wall}`,
            levelId: roomPlan.towerId,
            geometry: { kind: "opening", xM: roomPlan.x + opening.offsetM, zM: roomPlan.z, widthM: opening.widthM, depthM: 0.1, heightM: opening.heightM, yM: opening.sillM },
            properties: { wall: opening.wall, roomId: roomPlan.id, approximation: "Opening is exported as a typed element; host wall void and hardware are not modeled." },
          }));
        }
      }
      for (const tower of c.towers) {
        for (const opening of tower.openings ?? []) {
          entities.push(entity(opening.id, opening.kind === "door" ? "DOOR" : "WINDOW", {
            name: `${opening.kind} ${opening.face}`,
            levelId: `${tower.id}-floor-${opening.floor}`,
            geometry: { kind: "opening", xM: tower.x + opening.offset, zM: tower.z, widthM: opening.width, depthM: 0.1, heightM: opening.height, yM: opening.floor * tower.floorHeight + opening.sill, rotationDeg: tower.rotY ?? 0 },
            properties: { towerId: tower.id, face: opening.face, approximation: "Parametric opening; host facade, frame and hardware are not modeled." },
          }));
        }
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
 * IFC4 STEP coordination export. Geometry is deliberately limited to boxes
 * and swept rectangular profiles because the editor stores planning intent,
 * rather than construction-ready solids.
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
  const origin = add("IFCCARTESIANPOINT", "(0.,0.,0.)");
  const up = add("IFCDIRECTION", "(0.,0.,1.)");
  const east = add("IFCDIRECTION", "(1.,0.,0.)");
  const worldAxis = add("IFCAXIS2PLACEMENT3D", `#${origin},$,#${up}`);
  const context = add("IFCGEOMETRICREPRESENTATIONCONTEXT", `$, 'Model', 3, 1.E-05, #${worldAxis},$`);
  const metre = add("IFCSIUNIT", "*,.LENGTHUNIT.,$,.METRE.");
  const area = add("IFCSIUNIT", "*,.AREAUNIT.,$,.SQUARE_METRE.");
  const volume = add("IFCSIUNIT", "*,.VOLUMEUNIT.,$,.CUBIC_METRE.");
  const units = add("IFCUNITASSIGNMENT", `(#${metre},#${area},#${volume})`);
  const project = add("IFCPROJECT", `'${ifcGuid(1)}',#${history},'Groundwork exchange',$,$,$,$,$,$,(#${context}),#${units}`);
  const placement = (x = 0, y = 0, z = 0, rotation = 0, parent?: number) => {
    const point = add("IFCCARTESIANPOINT", `(${number(x).toFixed(3)},${number(y).toFixed(3)},${number(z).toFixed(3)})`);
    const angle = rotation ? Math.PI * rotation / 180 : 0;
    const ref = rotation ? add("IFCDIRECTION", `(${number(Math.cos(angle)).toFixed(6)},${number(Math.sin(angle)).toFixed(6)},0.)`) : east;
    const axis = add("IFCAXIS2PLACEMENT3D", `#${point},#${up},#${ref}`);
    return add("IFCLOCALPLACEMENT", `${parent ? `#${parent}` : "$"},#${axis}`);
  };
  const sitePlacement = placement();
  const site = add("IFCSITE", `'${ifcGuid(2)}',#${history},'Design site',$,$,#${sitePlacement},$,$,.ELEMENT.,$,$,$,$,$`);
  const buildingPlacement = placement(0, 0, 0, 0, sitePlacement);
  const building = add("IFCBUILDING", `'${ifcGuid(3)}',#${history},'Groundwork model',$,$,#${buildingPlacement},$,$,.ELEMENT.,$,$,$`);
  const aggregate = (name: string, parent: number, children: number[]) => children.length && add("IFCRELAGGREGATES", `'${ifcGuid(rows.length + 10)}',#${history},${ifcText(name)},$,#${parent},(${children.map((id) => `#${id}`).join(",")})`);
  aggregate("Project site", project, [site]);
  aggregate("Building", site, [building]);

  const storeyIds = new Map<string, number>();
  const storeyProducts = new Map<number, number[]>();
  const ensureStorey = (key: string, name: string, elevation: number) => {
    const existing = storeyIds.get(key);
    if (existing) return existing;
    const storeyPlacement = placement(0, 0, elevation, 0, buildingPlacement);
    const id = add("IFCBUILDINGSTOREY", `'${ifcGuid(4 + storeyIds.size)}',#${history},${ifcText(name)},$,$,#${storeyPlacement},$,$,.ELEMENT.,${number(elevation).toFixed(3)}`);
    storeyIds.set(key, id);
    storeyProducts.set(id, []);
    aggregate(name, building, [id]);
    return id;
  };
  ensureStorey("default", "Coordination level", 0);
  for (const level of design.community?.levels ?? []) ensureStorey(level.id, level.name, level.elevation);

  const measure = (value: unknown) => Math.max(0, Number(value) || 0);
  const dimensions = (item: ExchangeEntity) => {
    const geometry = item.geometry ?? {};
    const width = measure(geometry.widthM ?? geometry.wM);
    const depth = measure(geometry.depthM ?? geometry.dM ?? geometry.heightM);
    const height = measure(geometry.heightM ?? geometry.hM ?? geometry.widthM);
    return { width, depth, height };
  };
  const boxShape = (dims: { width: number; depth: number; height: number }) => {
    if (!dims.width || !dims.depth || !dims.height) return undefined;
    const profilePoint = add("IFCCARTESIANPOINT", "(0.,0.)");
    const profile = add("IFCRECTANGLEPROFILEDEF", `.AREA.,$,#${profilePoint},${number(dims.width).toFixed(3)},${number(dims.depth).toFixed(3)}`);
    const solidPlacement = add("IFCAXIS2PLACEMENT3D", `#${origin},$,#${up}`);
    const solid = add("IFCEXTRUDEDAREASOLID", `#${profile},#${solidPlacement},#${up},${number(dims.height).toFixed(3)}`);
    const representation = add("IFCSHAPEREPRESENTATION", `#${context},'Body','SweptSolid',(#${solid})`);
    return add("IFCPRODUCTDEFINITIONSHAPE", `$,$,(#${representation})`);
  };
  const pset = (product: number, item: ExchangeEntity, dims: { width: number; depth: number; height: number }) => {
    const values = [
      `IFCPROPERTYSINGLEVALUE('SourceId',$,IFCLABEL(${ifcText(item.id)}),$)`,
      `IFCPROPERTYSINGLEVALUE('SourceType',$,IFCLABEL(${ifcText(item.type)}),$)`,
      `IFCPROPERTYSINGLEVALUE('Approximation',$,IFCBOOLEAN(.T.),$)`,
    ];
    const propertyIds = values.map((value) => add("IFCPROPERTYSINGLEVALUE", value.slice(value.indexOf("(") + 1, -1)));
    const definition = add("IFCPROPERTYSET", `'${ifcGuid(rows.length + 100)}',#${history},'Groundwork Source',$,(${propertyIds.map((id) => `#${id}`).join(",")})`);
    add("IFCRELDEFINESBYPROPERTIES", `'${ifcGuid(rows.length + 100)}',#${history},'Source properties',$,(#${product}),#${definition}`);
    if (dims.width && dims.depth && dims.height) {
      const quantities = [
        add("IFCQUANTITYLENGTH", `'Width',$,$,${number(dims.width).toFixed(3)},$`),
        add("IFCQUANTITYLENGTH", `'Depth',$,$,${number(dims.depth).toFixed(3)},$`),
        add("IFCQUANTITYLENGTH", `'Height',$,$,${number(dims.height).toFixed(3)},$`),
        add("IFCQUANTITYVOLUME", `'GrossVolume',$,$,${number(dims.width * dims.depth * dims.height).toFixed(3)},$`),
      ];
      const quantitySet = add("IFCELEMENTQUANTITY", `'${ifcGuid(rows.length + 100)}',#${history},'Base quantities',$,$,(${quantities.map((id) => `#${id}`).join(",")})`);
      add("IFCRELDEFINESBYPROPERTIES", `'${ifcGuid(rows.length + 100)}',#${history},'Base quantities',$,(#${product}),#${quantitySet}`);
    }
  };
  const typedClass = (item: ExchangeEntity) => {
    if (item.type === "WALL" || item.type === "FACADE_PANEL") return "IFCWALL";
    if (item.type === "SLAB") return "IFCSLAB";
    if (item.type === "SPACE") return "IFCSPACE";
    if (item.type === "ROOF") return "IFCROOF";
    if (item.type === "COLUMN") return "IFCCOLUMN";
    if (item.type === "DOOR") return "IFCDOOR";
    if (item.type === "WINDOW") return "IFCWINDOW";
    if (item.type.startsWith("MEP_DUCT") || item.type.startsWith("MEP_PIPE") || item.type.startsWith("MEP_CABLE_TRAY")) return "IFCFLOWSEGMENT";
    if (item.type === "MEP_EQUIPMENT") return "IFCUNITARYEQUIPMENT";
    if (item.type === "MEP_FIXTURE") return "IFCFLOWTERMINAL";
    if (item.type === "INFRA_FACILITY") return "IFCBUILDINGELEMENTPROXY";
    return "IFCFURNISHINGELEMENT";
  };
  const products = exchange.entities.map((item, index) => {
    const geometry = item.geometry ?? {};
    const floor = Number(geometry.floor ?? item.properties?.floor ?? 0);
    const key = item.levelId || (floor ? `tower-floor-${floor}` : "default");
    const storey = storeyIds.get(key) ?? ensureStorey(key, key === "default" ? "Coordination level" : `Level ${floor}`, floor * measure(design.community?.towers[0]?.floorHeight));
    const x = Number(geometry.xM ?? 0);
    const y = Number(geometry.zM ?? 0);
    const z = Number(geometry.yM ?? 0);
    const local = placement(x, y, z, Number(geometry.rotationDeg ?? 0), storey ? (rows[storey - 1]?.includes("IFCBUILDINGSTOREY") ? storey : undefined) : undefined);
    const dims = dimensions(item);
    const shape = boxShape(dims);
    const description = `${item.type} intent; geometry is an approximate exchange envelope, not fabrication geometry.`;
    const type = typedClass(item);
    const base = `'${ifcGuid(100 + index)}',#${history},${ifcText(item.name || item.type)},${ifcText(description)},$,#${local},${shape ? `#${shape}` : "$"},$`;
    const suffix = type === "IFCSPACE" ? ",.ELEMENT."
      : ["IFCWALL", "IFCSLAB", "IFCROOF", "IFCCOLUMN"].includes(type) ? ",.ELEMENT."
      : ["IFCFLOWSEGMENT", "IFCUNITARYEQUIPMENT", "IFCFLOWTERMINAL"].includes(type) ? ",.NOTDEFINED."
      : type === "IFCDOOR" || type === "IFCWINDOW" ? ",$,$,.NOTDEFINED."
      : "";
    const id = add(type, `${base}${suffix}`);
    storeyProducts.get(storey)?.push(id);
    pset(id, item, dims);
    return id;
  });
  void products;
  for (const [storey, children] of storeyProducts) if (children.length) add("IFCRELCONTAINEDINSPATIALSTRUCTURE", `'${ifcGuid(rows.length + 10)}',#${history},'Storey contents',$,(${children.map((id) => `#${id}`).join(",")}),#${storey}`);

  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('Groundwork coordination export'),'2;1');",
    `FILE_NAME('groundwork.ifc','${new Date().toISOString()}',('Groundwork'),('Groundwork'),'Groundwork Design Studio','Groundwork','');`,
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
