/** Bounded IFC STEP exchange. Geometry is a declared subset; original STEP is retained for lossless export. */
export type StepValue = null | number | string | StepValue[] | { ref: number } | { type: string; values: StepValue[] };
export interface StepEntity { id: number; type: string; args: StepValue[]; start: number; end: number }
export interface IfcMesh { vertices: number[]; triangles: number[] }
export interface IfcProduct { stepId: number; globalId: string; type: string; name: string; attributes: Record<string, string>; properties: Record<string, string>; propertyTypes?: Record<string, string>; meshes: IfcMesh[]; issues: string[] }
export interface IfcDocument { schema: string; source: string; products: IfcProduct[]; issues: string[]; entities: Map<number, StepEntity>; unitScale: number }
type V = [number, number, number];
type Matrix = [V, V, V, V];
const identity = (): Matrix => [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => { const n = Math.hypot(...a); if (n < 1e-12) throw new Error("Degenerate placement direction."); return mul(a, 1 / n); };
const vector = (m: Matrix, p: V): V => add(add(mul(m[0], p[0]), mul(m[1], p[1])), mul(m[2], p[2]));
const point = (m: Matrix, p: V): V => add(m[3], vector(m, p));
const compose = (a: Matrix, b: Matrix): Matrix => [vector(a, b[0]), vector(a, b[1]), vector(a, b[2]), point(a, b[3])];
const list = (v: StepValue | undefined): StepValue[] => Array.isArray(v) ? v : [];
const scalar = (v: StepValue | undefined): string => v === null || v === undefined ? "" : typeof v === "object" ? "type" in v ? scalar(v.values[0]) : "" : String(v);
const numeric = (v: StepValue | undefined): number => { if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("Expected finite STEP number."); return v; };
function decodeString(value: string): string {
  let out = "", i = 0;
  while (i < value.length) {
    if (value.startsWith("\\\\", i)) { out += "\\"; i += 2; continue; }
    const kind = value.startsWith("\\X2\\", i) ? 4 : value.startsWith("\\X4\\", i) ? 8 : 0;
    if (kind) { const end = value.indexOf("\\X0\\", i + 4), hex = value.slice(i + 4, end); if (end < 0 || !/^[0-9A-Fa-f]+$/.test(hex) || hex.length % kind) throw new Error("Malformed STEP Unicode escape."); for (let k = 0; k < hex.length; k += kind) { const code = parseInt(hex.slice(k, k + kind), 16); if (kind === 8 && code > 0x10ffff) throw new Error("Invalid STEP Unicode code point."); out += kind === 4 ? String.fromCharCode(code) : String.fromCodePoint(code); } i = end + 4; continue; }
    out += value[i++];
  }
  return out;
}

function parseArguments(text: string, budget: { values: number }): StepValue[] {
  let i = 0;
  const skip = () => { while (/\s/.test(text[i] ?? "") && i < text.length) i++; };
  const value = (depth: number): StepValue => {
    if (depth > 32 || ++budget.values > 1000000) throw new Error("STEP global nesting/value limit exceeded."); skip();
    const c = text[i++];
    if (c === "$" || c === "*") return null;
    if (c === "'") { let s = ""; while (i < text.length) { const ch = text[i++]; if (ch === "'") { if (text[i] === "'") { s += "'"; i++; } else return decodeString(s); } else s += ch; } throw new Error("Unterminated STEP string."); }
    if (c === "(") { const a: StepValue[] = []; skip(); if (text[i] === ")") { i++; return a; } while (i < text.length) { a.push(value(depth + 1)); skip(); if (text[i++] === ")") return a; if (text[i - 1] !== ",") throw new Error("Malformed STEP aggregate."); } throw new Error("Unclosed STEP aggregate."); }
    if (c === "#") { const match = /^\d+/.exec(text.slice(i)); if (!match) throw new Error("Malformed STEP reference."); i += match[0].length; return { ref: Number(match[0]) }; }
    if (c === "." && /^[A-Z]/i.test(text[i] ?? "")) { const end = text.indexOf(".", i); if (end < 0) throw new Error("Malformed STEP enumeration."); const s = `.${text.slice(i, end).toUpperCase()}.`; i = end + 1; return s; }
    i--; const n = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?/.exec(text.slice(i)); if (n) { i += n[0].length; const f = Number(n[0]); if (!Number.isFinite(f)) throw new Error("Nonfinite STEP number."); return f; }
    const t = /^[A-Z][A-Z0-9_]*/i.exec(text.slice(i)); if (t) { i += t[0].length; skip(); if (text[i] !== "(") throw new Error("Malformed typed STEP value."); return { type: t[0].toUpperCase(), values: list(value(depth + 1)) }; }
    throw new Error(`Unsupported STEP token at ${i}.`);
  };
  const result = list(value(0)); skip(); if (i !== text.length) throw new Error("Trailing STEP argument data."); return result;
}

function scan(source: string): Map<number, StepEntity> {
  const entities = new Map<number, StepEntity>(), budget = { values: 0 }; let i = 0;
  // A statement scanner preserves semicolons/hash characters inside quoted strings and comments.
  while (i < source.length) {
    if (source.startsWith("/*", i)) { const end = source.indexOf("*/", i + 2); if (end < 0) throw new Error("Unclosed STEP comment."); i = end + 2; continue; }
    if (source[i] === "'") { i++; while (i < source.length) { if (source[i++] === "'") { if (source[i] === "'") i++; else break; } } continue; }
    if (source[i] !== "#") { i++; continue; }
    const start = i, head = /^#(\d+)\s*=\s*([A-Z][A-Z0-9_]*)\s*/i.exec(source.slice(i)); if (!head) throw new Error("Unsupported complex/malformed STEP entity."); i += head[0].length;
    const argStart = i; let quoted = false, clean = "";
    while (i < source.length) {
      const c = source[i];
      if (!quoted && source.startsWith("/*", i)) { const end = source.indexOf("*/", i + 2); if (end < 0) throw new Error("Unclosed STEP comment."); clean += " "; i = end + 2; continue; }
      if (c === "'") { if (quoted && source[i + 1] === "'") { clean += "''"; i += 2; continue; } quoted = !quoted; }
      if (c === ";" && !quoted) break;
      clean += c; i++;
    }
    if (i === source.length || i === argStart) throw new Error("Unclosed STEP statement.");
    const id = Number(head[1]); if (!Number.isSafeInteger(id) || entities.has(id)) throw new Error("Invalid/duplicate STEP identifier.");
    entities.set(id, { id, type: head[2].toUpperCase(), args: parseArguments(clean, budget), start, end: ++i });
    if (entities.size > 100000) throw new Error("IFC entity limit is 100,000.");
  }
  return entities;
}

/** Ear clipping for simple planar polygons. Self intersections/holes are deliberately rejected. */
export function triangulatePolygon(points: V[]): number[] {
  if (points.length < 3 || points.length > 4096) throw new Error("Polygon vertex limit is 3–4096.");
  const n: V = [0, 0, 0];
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); }
  const normal = norm(n), distance = (a: V, b: V) => normal.reduce((s, v, k) => s + v * (a[k] - b[k]), 0);
  if (points.some(p => Math.abs(distance(p, points[0])) > 1e-5)) throw new Error("Nonplanar polygon not supported.");
  const axis = Math.abs(n[0]) > Math.abs(n[1]) ? Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2 : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
  const p = points.map(a => axis === 0 ? [a[1], a[2]] : axis === 1 ? [a[0], a[2]] : [a[0], a[1]]);
  const turn = (a: number, b: number, c: number) => (p[b][0] - p[a][0]) * (p[c][1] - p[a][1]) - (p[b][1] - p[a][1]) * (p[c][0] - p[a][0]);
  let intersections = 0;
  const on = (a: number, b: number, c: number) => Math.abs(turn(a, b, c)) <= 1e-10 && (p[c][0] - p[a][0]) * (p[c][0] - p[b][0]) + (p[c][1] - p[a][1]) * (p[c][1] - p[b][1]) <= 1e-10;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) { const a = i, b = (i + 1) % p.length, c = j, d = (j + 1) % p.length; if (a === d || b === c) continue; if (++intersections > 2000000) throw new Error("Polygon intersection check budget exceeded."); if (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0 || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)) throw new Error("Self-intersecting/touching polygon is unsupported."); }
  let area = 0; for (let i = 0; i < p.length; i++) area += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1];
  const sign = area > 0 ? 1 : -1, remaining = p.map((_, k) => k), out: number[] = []; let attempts = 0;
  while (remaining.length > 3) {
    let cut = false;
    for (let k = 0; k < remaining.length; k++) { if (++attempts > 2000000) throw new Error("Polygon triangulation budget exceeded."); const a = remaining[(k + remaining.length - 1) % remaining.length], b = remaining[k], c = remaining[(k + 1) % remaining.length];
      if (sign * turn(a, b, c) <= 1e-10) continue;
      if (remaining.some(j => j !== a && j !== b && j !== c && sign * turn(a, b, j) >= -1e-10 && sign * turn(b, c, j) >= -1e-10 && sign * turn(c, a, j) >= -1e-10)) continue;
      out.push(a, b, c); remaining.splice(k, 1); cut = true; break;
    }
    if (!cut) throw new Error("Invalid/degenerate polygon or unsupported self intersection.");
  }
  out.push(...remaining); return out;
}

export function importIfcGeometry(source: string): IfcDocument {
  if (source.length > 20000000 || !/^\s*ISO-10303-21;/i.test(source)) throw new Error("Expected IFC STEP text, maximum 20 MB.");
  const entities = scan(source), schema = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(source)?.[1] ?? "UNKNOWN";
  if (!/^IFC(?:2X3|4)/i.test(schema)) throw new Error(`Unsupported schema ${schema}.`);
  const get = (v: StepValue | undefined): StepEntity | undefined => v && typeof v === "object" && !Array.isArray(v) && "ref" in v ? entities.get(v.ref) : undefined;
  const issues: string[] = []; let unitScale = 1;
  const project = [...entities.values()].find(e => e.type === "IFCPROJECT"), units = get(project?.args[8]);
  const lengthUnit = list(units?.args[0]).map(get).find(e => e && scalar(e.args[1]) === ".LENGTHUNIT.");
  if (lengthUnit?.type === "IFCSIUNIT" && scalar(lengthUnit.args[3]) === ".METRE.") {
    const prefix = scalar(lengthUnit.args[2]), scales: Record<string, number> = { "": 1, ".MILLI.": .001, ".CENTI.": .01, ".DECI.": .1, ".KILO.": 1000, ".MICRO.": .000001 };
    if (!Object.prototype.hasOwnProperty.call(scales, prefix)) throw new Error("Unsupported IFC SI length prefix."); unitScale = scales[prefix];
  } else if (lengthUnit?.type === "IFCCONVERSIONBASEDUNIT") {
    const factor = get(lengthUnit.args[3]), base = get(factor?.args[1]);
    if (base?.type !== "IFCSIUNIT" || scalar(base.args[3]) !== ".METRE." || scalar(base.args[2])) throw new Error("Conversion length unit must reference unprefixed metres.");
    unitScale = Number(scalar(factor?.args[0])); if (!Number.isFinite(unitScale) || unitScale <= 0) throw new Error("Invalid length conversion factor.");
  } else throw new Error("IFC project length unit is required and must be supported.");
  if (!Number.isFinite(unitScale) || unitScale <= 0) throw new Error("IFC length scale must be finite and positive.");
  const coords = (v: StepValue | undefined): V => { const a = list(get(v)?.args[0]); if (a.length < 2 || a.length > 3) throw new Error("Invalid point/direction coordinates."); return [numeric(a[0]), numeric(a[1]), a[2] === undefined ? 0 : numeric(a[2])]; };
  const axis = (v: StepValue | undefined): Matrix => { if (v === null || v === undefined) return identity(); const e = get(v); if (!e) throw new Error("Missing axis placement reference."); if (e.type === "IFCAXIS2PLACEMENT2D") { const x = e.args[1] ? norm(coords(e.args[1])) : [1, 0, 0] as V; return [x, [-x[1], x[0], 0], [0, 0, 1], coords(e.args[0])]; } if (e.type !== "IFCAXIS2PLACEMENT3D") throw new Error(`Unsupported placement ${e.type}.`); const z = e.args[1] ? norm(coords(e.args[1])) : [0, 0, 1] as V, ref = e.args[2] ? norm(coords(e.args[2])) : [1, 0, 0] as V, y = norm(cross(z, ref)); return [norm(cross(y, z)), y, z, coords(e.args[0])]; };
  const placement = (v: StepValue | undefined, seen = new Set<number>()): Matrix => { if (v === null || v === undefined) return identity(); const e = get(v); if (!e) throw new Error("Missing local placement reference."); if (e.type !== "IFCLOCALPLACEMENT" || seen.has(e.id) || seen.size > 64) throw new Error("Unsupported/circular placement."); seen.add(e.id); return compose(placement(e.args[0], seen), axis(e.args[1])); };
  const contextAxis = (v: StepValue | undefined, seen = new Set<number>()): Matrix => { const e = get(v); if (!e || seen.has(e.id) || seen.size > 64) throw new Error("Missing/circular representation context."); seen.add(e.id); if (e.type === "IFCGEOMETRICREPRESENTATIONSUBCONTEXT") return contextAxis(e.args[6], seen); if (e.type !== "IFCGEOMETRICREPRESENTATIONCONTEXT") throw new Error("Unsupported geometry context."); return axis(e.args[4]); };
  let vertexCount = 0, triangleCount = 0, geometrySteps = 0;
  const checkedMesh = (vertices: V[], triangles: number[], transform: Matrix): IfcMesh => {
    vertexCount += vertices.length; triangleCount += triangles.length / 3;
    if (vertexCount > 250000 || triangleCount > 500000 || triangles.length % 3 || triangles.some(i => !Number.isInteger(i) || i < 0 || i >= vertices.length)) throw new Error("Invalid indices or geometry budget exceeded.");
    const values = vertices.flatMap(p => point(transform, p).map(v => v * unitScale)); if (values.some(v => !Number.isFinite(v) || Math.abs(v) > 1e8)) throw new Error("Transformed IFC coordinates exceed finite 100,000 km bounds."); return { vertices: values, triangles };
  };
  const geometry = (v: StepValue | undefined, transform: Matrix, stack = new Set<number>()): IfcMesh[] => {
    if (++geometrySteps > 200000) throw new Error("IFC geometry traversal budget exceeded.");
    const e = get(v); if (!e) throw new Error("Missing geometry reference."); if (stack.has(e.id) || stack.size > 64) throw new Error("Circular geometry graph."); const next = new Set(stack); next.add(e.id);
    if (e.type === "IFCPRODUCTDEFINITIONSHAPE" || e.type === "IFCPRODUCTREPRESENTATION") return list(e.args[2]).flatMap(r => geometry(r, transform, next));
    if (e.type === "IFCSHAPEREPRESENTATION") { if (scalar(e.args[1]) && !["Body", "Facetation", "Model"].includes(scalar(e.args[1]))) return []; const world = compose(contextAxis(e.args[0]), transform); return list(e.args[3]).flatMap(r => geometry(r, world, next)); }
    if (e.type === "IFCTRIANGULATEDFACESET") { const vertices = list(get(e.args[0])?.args[0]).map(a => { const b = list(a); return [numeric(b[0]), numeric(b[1]), numeric(b[2])] as V; }), pn = list(e.args[4]); const triangles = list(e.args[3]).flatMap(a => { const b = list(a); if (b.length !== 3) throw new Error("Triangle needs 3 indices."); return b.map(i => { const n = numeric(i); return (pn.length ? numeric(pn[n - 1]) : n) - 1; }); }); return [checkedMesh(vertices, triangles, transform)]; }
    if (e.type === "IFCFACETEDBREP" || e.type === "IFCSHELLBASEDSURFACEMODEL") { const shells = e.type === "IFCFACETEDBREP" ? [e.args[0]] : list(e.args[0]); return shells.flatMap(shell => list(get(shell)?.args[0]).map(face => { const bounds = list(get(face)?.args[0]); if (bounds.length !== 1) throw new Error("BRep faces with holes are not supported."); const bound = get(bounds[0]), loop = get(bound?.args[0]); if (loop?.type !== "IFCPOLYLOOP") throw new Error("Only polygonal BRep face bounds supported."); const p = list(loop.args[0]).map(coords); if (scalar(bound?.args[1]) === ".F.") p.reverse(); return checkedMesh(p, triangulatePolygon(p), transform); })); }
    if (e.type === "IFCEXTRUDEDAREASOLID") {
      const profile = get(e.args[0]); if (!profile) throw new Error("Missing extrusion profile."); let p: V[];
      if (profile.type === "IFCRECTANGLEPROFILEDEF") { const w = numeric(profile.args[3]) / 2, h = numeric(profile.args[4]) / 2; if (w <= 0 || h <= 0) throw new Error("Invalid rectangular profile."); p = [[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0]].map(a => point(axis(profile.args[2]), a as V)); }
      else if (profile.type === "IFCCIRCLEPROFILEDEF") { const radius = numeric(profile.args[3]); if (radius <= 0) throw new Error("Invalid circular profile."); p = Array.from({ length: 48 }, (_, i) => point(axis(profile.args[2]), [radius * Math.cos(i * Math.PI / 24), radius * Math.sin(i * Math.PI / 24), 0])); }
      else if (profile.type === "IFCARBITRARYCLOSEDPROFILEDEF") { const curve = get(profile.args[2]); if (curve?.type !== "IFCPOLYLINE") throw new Error("Arbitrary profile requires a closed polyline."); p = list(curve.args[0]).map(coords); if (p.length < 4 || Math.hypot(...p[0].map((n, k) => n - p[p.length - 1][k])) > 1e-8) throw new Error("Profile polyline is not closed."); p.pop(); }
      else throw new Error(`Unsupported profile ${profile.type}.`);
      let area = 0; for (let i = 0; i < p.length; i++) area += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1]; if (area < 0) p.reverse();
      const depth = numeric(e.args[3]); if (depth <= 0) throw new Error("Invalid extrusion depth."); const direction = norm(coords(e.args[2])); if (direction[2] <= 1e-8) throw new Error("Only positive local-Z extrusion directions are supported."); const cap = triangulatePolygon(p), count = p.length, vertices = [...p, ...p.map(a => add(a, mul(direction, depth)))], triangles: number[] = [];
      for (let i = 0; i < cap.length; i += 3) triangles.push(cap[i + 2], cap[i + 1], cap[i], cap[i] + count, cap[i + 1] + count, cap[i + 2] + count);
      for (let i = 0; i < count; i++) { const j = (i + 1) % count; triangles.push(i, j, j + count, i, j + count, i + count); }
      return [checkedMesh(vertices, triangles, compose(transform, axis(e.args[1])))];
    }
    throw new Error(`Unsupported geometric entity ${e.type} (#${e.id}).`);
  };
  const products: IfcProduct[] = [], byId = new Map<number, IfcProduct>(), guids = new Set<string>();
  const productClasses = new Set("IFCWALL IFCWALLSTANDARDCASE IFCSLAB IFCROOF IFCCOLUMN IFCBEAM IFCMEMBER IFCPLATE IFCCOVERING IFCDOOR IFCWINDOW IFCSTAIR IFCSTAIRFLIGHT IFCRAMP IFCRAMPFLIGHT IFCBUILDINGELEMENTPROXY IFCBUILDINGELEMENTPART IFCFURNISHINGELEMENT IFCFURNITURE IFCSPACE IFCSITE IFCBUILDING IFCBUILDINGSTOREY IFCOPENINGELEMENT IFCFOOTING IFCPILE IFCFLOWSEGMENT IFCFLOWFITTING IFCFLOWTERMINAL IFCFLOWCONTROLLER IFCFLOWMOVINGDEVICE IFCFLOWSTORAGEDEVICE IFCENERGYCONVERSIONDEVICE IFCDUCTSEGMENT IFCPIPESEGMENT IFCCABLESEGMENT IFCDUCTFITTING IFCPIPEFITTING IFCVALVE IFCPUMP IFCSANITARYTERMINAL IFCAIRTERMINAL IFCLIGHTFIXTURE".split(" "));
  const predefinedIndex: Record<string, number> = { IFCWALL: 8, IFCWALLSTANDARDCASE: 8, IFCSLAB: 8, IFCROOF: 8, IFCCOLUMN: 8, IFCBEAM: 8, IFCMEMBER: 8, IFCPLATE: 8, IFCCOVERING: 8, IFCDOOR: 9, IFCWINDOW: 9 };
  for (const e of entities.values()) {
    // Product common attributes: GlobalId, OwnerHistory, Name, Description, ObjectType, ObjectPlacement, Representation.
    if (e.type.startsWith("IFCREL") || !productClasses.has(e.type) && get(e.args[6])?.type !== "IFCPRODUCTDEFINITIONSHAPE") continue;
    const globalId = scalar(e.args[0]); if (!/^[0-3][0-9A-Za-z_$]{21}$/.test(globalId)) { issues.push(`Invalid product GlobalId at #${e.id}; product omitted.`); continue; }
    const attributes: Record<string, string> = { GlobalId: globalId, Name: scalar(e.args[2]), Description: scalar(e.args[3]), ObjectType: scalar(e.args[4]) };
    if (schema !== "IFC2X3" && predefinedIndex[e.type] !== undefined) attributes.PredefinedType = scalar(e.args[predefinedIndex[e.type]]).replace(/^\.|\.$/g, "");
    const p: IfcProduct = { stepId: e.id, globalId, type: e.type, name: scalar(e.args[2]), attributes, properties: {}, propertyTypes: {}, meshes: [], issues: [] };
    if (guids.has(globalId)) p.issues.push("Duplicate GlobalId."); guids.add(globalId);
    try { p.meshes = geometry(e.args[6], placement(e.args[5])); if (!p.meshes.length) p.issues.push("No supported Body representation."); } catch (error) { p.issues.push(error instanceof Error ? error.message : "Geometry import failed."); }
    products.push(p); byId.set(e.id, p); if (products.length > 10000) throw new Error("IFC product limit is 10,000.");
  }
  for (const e of entities.values()) if (e.type === "IFCRELDEFINESBYPROPERTIES") { const set = get(e.args[5]); if (set?.type !== "IFCPROPERTYSET") continue; const properties: Record<string, string> = {}, types: Record<string, string> = {}; for (const ref of list(set.args[4])) { const p = get(ref); if (p?.type === "IFCPROPERTYSINGLEVALUE") { const key = `${scalar(set.args[2])}.${scalar(p.args[0])}`, value = p.args[2]; properties[key] = scalar(value); types[key] = value && typeof value === "object" && !Array.isArray(value) && "type" in value ? value.type : typeof value === "string" ? "STRING" : "UNKNOWN"; } } for (const ref of list(e.args[4])) { const product = byId.get(get(ref)?.id ?? -1); if (product) { Object.assign(product.properties, properties); Object.assign(product.propertyTypes!, types); } } }
  for (const e of entities.values()) if (e.type === "IFCRELVOIDSELEMENT") { const product = byId.get(get(e.args[4])?.id ?? -1); if (product) product.issues.push("Host void/opening geometry is retained in source but not subtracted from the imported mesh."); }
  if (entities.size && !products.length) issues.push("No products with supported product representation attributes found.");
  issues.push("Openings/Boolean operations, mapped items, type inheritance, textures and CRS map conversions are not applied. Source STEP is preserved on export.");
  return { schema, source, products, issues, entities, unitScale };
}

function nameRange(source: string, entity: StepEntity): [number, number] {
  let i = entity.start;
  while (i < entity.end) { if (source.startsWith("/*", i)) { const end = source.indexOf("*/", i + 2); if (end < 0 || end >= entity.end) throw new Error("Malformed source comment."); i = end + 2; continue; } if (source[i] === "(") break; i++; }
  if (i >= entity.end) throw new Error("Source entity argument list not found.");
  i++; let start = i, depth = 1, index = 0;
  while (i < entity.end) {
    if (source.startsWith("/*", i)) { const end = source.indexOf("*/", i + 2); if (end < 0) throw new Error("Malformed source comment."); i = end + 2; continue; }
    const ch = source[i]; if (ch === "'") { i++; while (i < entity.end) { if (source[i++] === "'") { if (source[i] === "'") i++; else break; } } continue; }
    if (ch === "(") depth++; if (ch === ")") depth--;
    if (depth === 1 && ch === "," || depth === 0) { if (index === 2) return [start, i]; start = i + 1; index++; }
    i++;
  }
  throw new Error("Source product name attribute not found.");
}
function encodeName(name: string): string { let encoded = ""; for (let i = 0; i < name.length; i++) { const code = name.charCodeAt(i); encoded += code > 126 ? `\\X2\\${code.toString(16).padStart(4, "0").toUpperCase()}\\X0\\` : name[i] === "\\" ? "\\\\" : name[i] === "'" ? "''" : name[i]; } return `'${encoded}'`; }

/** Replace only requested product names; all GUIDs, properties, geometry and unsupported source records remain intact. */
export function exportIfcRoundTrip(document: IfcDocument, names: Record<string, string> = {}): string {
  const patches: { start: number; end: number; text: string }[] = [];
  const counts = new Map<string, number>(); for (const product of document.products) counts.set(product.globalId, (counts.get(product.globalId) ?? 0) + 1);
  for (const product of document.products) { const name = names[product.globalId]; if (name === undefined || name === product.name) continue; if (counts.get(product.globalId)! > 1) throw new Error("Duplicate GlobalIds prevent unambiguous renaming; repair identifiers in the authoring tool."); if (name.length > 1024 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Name must be at most 1024 printable characters."); const e = document.entities.get(product.stepId)!, [start, end] = nameRange(document.source, e); patches.push({ start, end, text: encodeName(name) }); }
  let result = document.source; for (const patch of patches.sort((a, b) => b.start - a.start)) result = result.slice(0, patch.start) + patch.text + result.slice(patch.end); return result;
}

export function exportIfcMeshObj(document: IfcDocument): string { let offset = 1; const out = ["# IFC supported geometry in metres; IFC Z-up coordinates"]; for (const product of document.products) { out.push(`o ${product.globalId}`); for (const mesh of product.meshes) { for (let i = 0; i < mesh.vertices.length; i += 3) out.push(`v ${mesh.vertices[i]} ${mesh.vertices[i + 1]} ${mesh.vertices[i + 2]}`); for (let i = 0; i < mesh.triangles.length; i += 3) out.push(`f ${mesh.triangles[i] + offset} ${mesh.triangles[i + 1] + offset} ${mesh.triangles[i + 2] + offset}`); offset += mesh.vertices.length / 3; } } return out.join("\n"); }
