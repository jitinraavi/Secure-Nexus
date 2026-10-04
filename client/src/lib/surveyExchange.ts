import { buildSurveyTin, defaultTerrain } from "./terrain";

export interface SurveyPoint { x: number; z: number; elevationM: number; classification?: number }
/** Imported elevationM is a legacy field name: values remain in source units until prepareSurveyForTerrain. */
export interface SurveyImport { points: SurveyPoint[]; crs?: string; warnings: string[]; originalCount: number; coordinateMetadata?: SurveyCoordinateMetadata }
export type SurveyLengthUnit = "m" | "international-foot" | "us-survey-foot";
export type SurveyHorizontalUnit = SurveyLengthUnit | "degree";
export type SurveyAxisOrder = "east-north" | "lon-lat" | "north-east" | "lat-lon" | "unknown";
export interface SurveyMetadataSource { kind: "las-vlr" | "las-evlr" | "geotiff" | "csv"; recordId?: number; userId?: string; byteLength?: number; wkt?: string; geoKeys?: Record<string, number | string | number[]>; parseError?: string }
export interface SurveyCoordinateMetadata {
  version: 1; format: "csv" | "las" | "geotiff"; coordinateEncoding: "source-units";
  status: "undeclared" | "supported" | "unsupported" | "ambiguous";
  horizontalCrs?: string; horizontalUnit: SurveyHorizontalUnit | "unknown"; axisOrder: SurveyAxisOrder;
  elevationUnit: SurveyLengthUnit | "unknown"; verticalDatum?: { name?: string; epsg?: number; crsEpsg?: number };
  sources: SurveyMetadataSource[]; issues: string[]; lasVersion?: string; lasPointFormat?: number; wktFlag?: boolean;
}
export interface SurveyTerrainDeclaration { version: 1; horizontalCrs: string; horizontalUnit: SurveyHorizontalUnit; axisOrder: "east-north" | "lon-lat"; elevationUnit: SurveyLengthUnit; verticalDatum: string; source: string }
export interface PreparedSurvey {
  points: SurveyPoint[]; crs: string; warnings: string[];
  provenance: { version: 1; declaration: SurveyTerrainDeclaration; sourceMetadata?: SurveyCoordinateMetadata; horizontalFactorToMetres: number | null; elevationFactorToMetres: number; verticalTransformation: "none"; axisReordering: "none" };
}
export interface SurveyConstraints { breaklines: number[][]; holes: number[][] }
export interface SurveySurface { points: SurveyPoint[]; triangles: number[][]; warnings: string[] }
const A = 6378137, E2 = 0.0066943799901413165, K = .9996, RAD = Math.PI / 180;
const requireFinite = (...numbers: number[]) => { if (!numbers.every(Number.isFinite)) throw new Error("Coordinates must be finite."); };
const lengthUnits = new Set<SurveyLengthUnit>(["m", "international-foot", "us-survey-foot"]);
const horizontalUnits = new Set<SurveyHorizontalUnit>(["m", "degree", "international-foot", "us-survey-foot"]);
const unitFactor = (unit: SurveyLengthUnit) => unit === "m" ? 1 : unit === "international-foot" ? .3048 : 1200 / 3937;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, maximum: number, label: string): string => { if (typeof value !== "string" || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`Invalid ${label}.`); return value; };
const epsgUnit = (code: number | undefined): SurveyHorizontalUnit | "unknown" => code === 9001 ? "m" : code === 9002 ? "international-foot" : code === 9003 ? "us-survey-foot" : code === 9102 || code === 9122 ? "degree" : "unknown";
const supportedCrs = (crs: string) => /^EPSG:(?:4326|3857|326(?:0[1-9]|[1-5][0-9]|60)|327(?:0[1-9]|[1-5][0-9]|60))$/.test(crs);
function expectedUnit(crs: string): SurveyHorizontalUnit { return crs === "EPSG:4326" ? "degree" : "m"; }
// Small explicit authority subset, not a general EPSG registry or a vertical transformation engine.
const verticalDefinitions: Record<number, { unit: SurveyLengthUnit; datum: number }> = { 4979: { unit: "m", datum: 6326 }, 5702: { unit: "us-survey-foot", datum: 5102 }, 5703: { unit: "m", datum: 5103 }, 6360: { unit: "us-survey-foot", datum: 5103 } };
const verticalDefinition = (code: number | undefined) => code !== undefined && Object.prototype.hasOwnProperty.call(verticalDefinitions, code) ? verticalDefinitions[code] : undefined;
function unknownMetadata(format: SurveyCoordinateMetadata["format"], sources: SurveyMetadataSource[]): SurveyCoordinateMetadata { return { version: 1, format, coordinateEncoding: "source-units", status: "undeclared", horizontalUnit: "unknown", axisOrder: "unknown", elevationUnit: "unknown", sources, issues: [] }; }

interface WktNode { type: string; values: (string | number | WktNode)[] }
function parseWkt(value: string): WktNode {
  if (value.length > 65536) throw new Error("WKT exceeds the 64 KB supported metadata limit."); let index = 0, nodes = 0;
  const skip = () => { while (/\s/.test(value[index] ?? "") && index < value.length) index++; };
  const read = (depth: number): string | number | WktNode => {
    if (++nodes > 4096 || depth > 24) throw new Error("WKT structure exceeds supported bounds."); skip();
    if (value[index] === '"') { index++; let result = ""; while (index < value.length) { const c = value[index++]; if (c === '"') { if (value[index] === '"') { result += '"'; index++; } else return result; } else result += c; } throw new Error("Unclosed WKT string."); }
    const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?/.exec(value.slice(index)); if (numeric) { index += numeric[0].length; const n = Number(numeric[0]); if (!Number.isFinite(n)) throw new Error("Nonfinite WKT number."); return n; }
    const identifier = /^[A-Za-z][A-Za-z0-9_]*/.exec(value.slice(index)); if (!identifier) throw new Error("Unsupported WKT token."); index += identifier[0].length; skip();
    if (!["[", "("].includes(value[index] ?? "")) return identifier[0].toUpperCase(); const close = value[index++] === "[" ? "]" : ")", values: WktNode["values"] = [];
    while (index < value.length) { values.push(read(depth + 1)); skip(); const separator = value[index++]; if (separator === close) return { type: identifier[0].toUpperCase(), values }; if (separator !== ",") throw new Error("Malformed WKT node."); }
    throw new Error("Unclosed WKT node.");
  };
  const result = read(0); skip(); if (typeof result !== "object" || index !== value.length) throw new Error("WKT must contain one complete coordinate-system node."); return result;
}
const wktChildren = (node: WktNode, type: string): WktNode[] => node.values.filter((v): v is WktNode => typeof v === "object" && v.type === type);
function oneNode(node: WktNode, type: string): WktNode | undefined { const values = wktChildren(node, type); if (values.length > 1) throw new Error(`Ambiguous WKT ${type} nodes.`); return values[0]; }
function wktEpsg(node: WktNode): number | undefined { const authority = oneNode(node, "AUTHORITY"); if (!authority) return undefined; const code = Number(authority.values[1]); if (String(authority.values[0]).toUpperCase() !== "EPSG" || !/^\d+$/.test(String(authority.values[1])) || !Number.isSafeInteger(code) || code < 1 || code > 1000000) throw new Error("Only bounded literal EPSG WKT authorities are supported."); return code; }
function inspectWktShape(node: WktNode): void {
  const shapes: Record<string, { scalars: number; children: string[] }> = { COMPD_CS: { scalars: 1, children: ["GEOGCS", "PROJCS", "VERT_CS", "AUTHORITY"] }, PROJCS: { scalars: 1, children: ["GEOGCS", "PROJECTION", "PARAMETER", "UNIT", "AXIS", "AUTHORITY"] }, GEOGCS: { scalars: 1, children: ["DATUM", "PRIMEM", "UNIT", "AXIS", "AUTHORITY"] }, DATUM: { scalars: 1, children: ["SPHEROID", "AUTHORITY"] }, SPHEROID: { scalars: 3, children: ["AUTHORITY"] }, PRIMEM: { scalars: 2, children: ["AUTHORITY"] }, UNIT: { scalars: 2, children: ["AUTHORITY"] }, PROJECTION: { scalars: 1, children: ["AUTHORITY"] }, PARAMETER: { scalars: 2, children: [] }, AXIS: { scalars: 2, children: [] }, AUTHORITY: { scalars: 2, children: [] }, VERT_CS: { scalars: 1, children: ["VERT_DATUM", "UNIT", "AXIS", "AUTHORITY"] }, VERT_DATUM: { scalars: 2, children: ["AUTHORITY"] } };
  const shape = Object.prototype.hasOwnProperty.call(shapes, node.type) ? shapes[node.type] : undefined;
  if (!shape || node.values.length < shape.scalars || node.values.slice(0, shape.scalars).some(v => typeof v === "object") || typeof node.values[0] !== "string" || node.values.slice(shape.scalars).some(v => typeof v !== "object" || !shape.children.includes(v.type))) throw new Error(`Unsupported WKT ${node.type} structure/extension.`);
  if (["SPHEROID", "PRIMEM", "UNIT", "PARAMETER", "VERT_DATUM"].includes(node.type) && node.values.slice(1, shape.scalars).some(v => typeof v !== "number")) throw new Error(`WKT ${node.type} requires literal numeric parameters.`);
  for (const child of node.values.slice(shape.scalars)) if (typeof child === "object") inspectWktShape(child);
}
function wktUnit(node: WktNode): SurveyHorizontalUnit | "unknown" {
  const unit = oneNode(node, "UNIT"), name = String(unit?.values[0] ?? "").toLowerCase(), factor = unit?.values[1]; if (typeof factor !== "number") return "unknown";
  const authority = unit && wktEpsg(unit), matches = (code: number) => authority === undefined || authority === code;
  if (/^(degree|degrees|degree_angle)$/.test(name) && Math.abs(factor - RAD) < 1e-12 && (matches(9102) || matches(9122))) return "degree";
  if (Math.abs(factor - 1) < 1e-12 && /^(metre|meter|metres|meters|m)$/.test(name) && matches(9001)) return "m";
  if (Math.abs(factor - .3048) < 1e-12 && /^(foot|feet|international[_ ]foot)$/.test(name) && matches(9002)) return "international-foot";
  if (Math.abs(factor - 1200 / 3937) < 1e-12 && /^(us[_ ]survey[_ ]foot|foot_us|us[_ ]foot)$/.test(name) && matches(9003)) return "us-survey-foot";
  return "unknown";
}
function readWktMetadata(value: string, format: SurveyCoordinateMetadata["format"], sources: SurveyMetadataSource[]): SurveyCoordinateMetadata {
  const result = unknownMetadata(format, sources);
  try {
    const root = parseWkt(value); inspectWktShape(root); let horizontal = root, vertical: WktNode | undefined;
    if (root.type === "COMPD_CS") { const parts = root.values.filter((v): v is WktNode => typeof v === "object" && v.type !== "AUTHORITY"); if (oneNode(root, "AUTHORITY")) throw new Error("Compound WKT authority identifiers are retained but require unsupported registry reconciliation."); if (parts.length !== 2 || !["PROJCS", "GEOGCS"].includes(parts[0].type) || parts[1].type !== "VERT_CS") throw new Error("Only a horizontal plus vertical WKT1 compound CRS is supported."); [horizontal, vertical] = parts; }
    if (!["PROJCS", "GEOGCS"].includes(horizontal.type)) throw new Error("WKT2, geocentric, bound and local WKT coordinate systems are retained but unsupported.");
    const code = wktEpsg(horizontal); if (code) result.horizontalCrs = `EPSG:${code}`; result.horizontalUnit = wktUnit(horizontal);
    const axes = wktChildren(horizontal, "AXIS"), directions = axes.map(a => String(a.values[1]).toUpperCase());
    if (axes.length && axes.length !== 2) throw new Error("Horizontal WKT must have exactly two declared axes.");
    if (directions.join(",") === "EAST,NORTH") result.axisOrder = horizontal.type === "GEOGCS" ? "lon-lat" : "east-north";
    else if (directions.join(",") === "NORTH,EAST") result.axisOrder = horizontal.type === "GEOGCS" ? "lat-lon" : "north-east";
    else if (directions.length) throw new Error("Unsupported WKT horizontal axis directions.");
    if (vertical) { const datum = oneNode(vertical, "VERT_DATUM"), unit = wktUnit(vertical); result.elevationUnit = lengthUnits.has(unit as SurveyLengthUnit) ? unit as SurveyLengthUnit : "unknown"; result.verticalDatum = { ...(typeof datum?.values[0] === "string" ? { name: datum.values[0] } : {}), ...(datum && wktEpsg(datum) ? { epsg: wktEpsg(datum) } : {}), ...(wktEpsg(vertical) ? { crsEpsg: wktEpsg(vertical) } : {}) }; if (!datum || result.elevationUnit === "unknown") throw new Error("Vertical WKT datum/unit definition is unsupported."); const axis = oneNode(vertical, "AXIS"); if (axis && String(axis.values[1]).toUpperCase() !== "UP") throw new Error("Only positive-up elevation axes are supported."); const definition = verticalDefinition(result.verticalDatum.crsEpsg); if (result.verticalDatum.crsEpsg && (!definition || definition.unit !== result.elevationUnit || result.verticalDatum.epsg !== definition.datum)) throw new Error("Vertical WKT EPSG CRS is unsupported or conflicts with its explicit datum/unit definition."); }
    if (!code || !supportedCrs(`EPSG:${code}`)) throw new Error("WKT horizontal EPSG identifier is absent or outside the supported WGS84 CRS subset.");
    const geographic = horizontal.type === "GEOGCS" ? horizontal : oneNode(horizontal, "GEOGCS"), datum = geographic && oneNode(geographic, "DATUM"), spheroid = datum && oneNode(datum, "SPHEROID");
    if (!geographic || !datum || !spheroid || wktEpsg(geographic) !== undefined && wktEpsg(geographic) !== 4326 || wktEpsg(datum) !== undefined && wktEpsg(datum) !== 6326 || wktEpsg(spheroid) !== undefined && wktEpsg(spheroid) !== 7030 || wktUnit(geographic) !== "degree" || typeof spheroid.values[1] !== "number" || Math.abs(spheroid.values[1] - A) > 1e-6 || typeof spheroid.values[2] !== "number" || Math.abs(spheroid.values[2] - 298.257223563) > 1e-9 || !(wktEpsg(datum) === 6326 || ["WGS_1984", "WGS 84", "WGS84"].includes(String(datum.values[0]).toUpperCase()))) throw new Error("WKT datum/ellipsoid or transform does not match the supported WGS84 definition.");
    const prime = oneNode(geographic, "PRIMEM"); if (!prime || prime.values[1] !== 0 || wktEpsg(prime) !== undefined && wktEpsg(prime) !== 8901) throw new Error("Only Greenwich WKT prime meridians are supported.");
    if (horizontal.type === "GEOGCS" && code !== 4326 || horizontal.type === "PROJCS" && code === 4326 || result.horizontalUnit !== expectedUnit(`EPSG:${code}`)) throw new Error("WKT coordinate type/unit conflicts with its EPSG identifier.");
    if (code === 3857) throw new Error("EPSG:3857 WKT definition is retained but pseudo-Mercator WKT variants are unsupported; use declared GeoKeys or externally validated conversion.");
    if (horizontal.type === "PROJCS") { const projection = oneNode(horizontal, "PROJECTION"), parameters = wktChildren(horizontal, "PARAMETER"), expected: Record<string, number> = { latitude_of_origin: 0, central_meridian: (code % 100) * 6 - 183, scale_factor: K, false_easting: 500000, false_northing: code >= 32701 ? 10000000 : 0 }, seen = new Set<string>(); if (projection?.values[0] !== "Transverse_Mercator" || projection && wktEpsg(projection) !== undefined && wktEpsg(projection) !== 9807 || parameters.length !== 5) throw new Error("Only canonical five-parameter WGS84 UTM WKT is supported."); for (const p of parameters) { const key = String(p.values[0]).toLowerCase(), n = p.values[1]; if (seen.has(key) || !Object.prototype.hasOwnProperty.call(expected, key) || typeof n !== "number" || Math.abs(n - expected[key]) > 1e-8) throw new Error("WKT projection parameters conflict with the declared UTM EPSG identifier."); seen.add(key); } }
    if (["lat-lon", "north-east"].includes(result.axisOrder)) throw new Error("WKT axis order requires unsupported coordinate reordering.");
    result.status = "supported";
  } catch (error) { result.status = "unsupported"; result.issues.push(error instanceof Error ? error.message : "Unsupported WKT metadata."); }
  return result;
}

function metadataIssue(result: SurveyCoordinateMetadata, message: string, status: "unsupported" | "ambiguous" = "unsupported"): void { if (result.issues.length < 32 && !result.issues.includes(message)) result.issues.push(message); if (result.status !== "ambiguous" || status === "ambiguous") result.status = status; }
function readGeoKeys(directory: number[], doubles: number[], ascii: string, las: boolean): Record<string, number | string | number[]> {
  if (directory.length < 4 || directory.length > 8192 || directory.some(n => !Number.isInteger(n) || n < 0 || n > 65535) || directory[0] !== 1 || directory[1] !== 1 || ![0, ...(las ? [] : [1])].includes(directory[2]) || directory[3] > 256 || directory.length < 4 + directory[3] * 4 || doubles.length > 8192 || doubles.some(n => !Number.isFinite(n)) || ascii.length > 65536) throw new Error("Malformed/unsupported GeoKey directory or parameter-table bounds.");
  const keys: Record<string, number | string | number[]> = {}, end = 4 + directory[3] * 4; let retainedText = 0;
  for (let i = 4; i < end; i += 4) {
    const [id, location, count, offset] = directory.slice(i, i + 4), key = String(id); if (!id || Object.prototype.hasOwnProperty.call(keys, key) || count < 1) throw new Error("Duplicate/empty GeoKey definition.");
    if (location === 0) { if (count !== 1) throw new Error("Inline GeoKey values must have count one."); keys[key] = offset; }
    else if (location === 34736 || location === 34735 && !las) { const table = location === 34736 ? doubles : directory; if (count > 32 || offset + count > table.length || location === 34735 && offset < end) throw new Error("GeoKey numeric parameter reference exceeds supported bounds."); const values = table.slice(offset, offset + count); keys[key] = count === 1 ? values[0] : values; }
    else if (location === 34737) { if (count > 8192 || offset + count > ascii.length || (retainedText += count) > 131072) throw new Error("GeoKey citation reference exceeds supported bounds."); keys[key] = text(ascii.slice(offset, offset + count).replace(/[|\0]+$/, ""), 8192, "GeoKey citation"); }
    else throw new Error(`Unsupported GeoKey table reference ${location}.`);
  }
  return keys;
}
function readGeoKeyMetadata(format: SurveyCoordinateMetadata["format"], sources: SurveyMetadataSource[], keys: Record<string, number | string | number[]>): SurveyCoordinateMetadata {
  const result = unknownMetadata(format, sources), allowed = new Set([1024, 1025, 1026, 2048, 2049, 2050, 2051, 2052, 2053, 2054, 2055, 2056, 2057, 2058, 2059, 2060, 2061, 3072, 3073, 3076, 3077, 4096, 4097, 4098, 4099]);
  const number = (id: number): number | undefined => { const value = keys[String(id)]; if (value === undefined) return undefined; if (typeof value !== "number" || !Number.isFinite(value)) { metadataIssue(result, `GeoKey ${id} must contain one numeric value.`); return undefined; } return value; };
  const code = (id: number): number | undefined => { const value = number(id); if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 65535)) { metadataIssue(result, `GeoKey ${id} has an invalid authority/unit code.`); return undefined; } return value; };
  for (const key of Object.keys(keys)) if (!allowed.has(Number(key))) metadataIssue(result, `GeoKey ${key} requires unsupported custom projection/metadata interpretation.`);
  const model = code(1024), projected = code(3072), geographic = code(2048);
  if (model !== undefined && ![1, 2].includes(model)) metadataIssue(result, "Only projected or geographic GeoKey model types are supported.");
  if (model === 2 && projected !== undefined) metadataIssue(result, "Geographic model and projected CRS GeoKeys conflict.", "ambiguous");
  if (model === undefined && (projected !== undefined || geographic !== undefined || Object.keys(keys).some(k => Number(k) >= 2048 && Number(k) <= 3077))) metadataIssue(result, "Horizontal GeoKey declarations are present without an explicit model type.", "ambiguous");
  const horizontal = model === 1 ? projected : model === 2 ? geographic : undefined;
  if (horizontal !== undefined && horizontal !== 32767) result.horizontalCrs = `EPSG:${horizontal}`;
  if (result.horizontalCrs && !supportedCrs(result.horizontalCrs)) metadataIssue(result, "GeoKey horizontal EPSG identifier lies outside the supported WGS84 subset.");
  if (model === 1 && horizontal === 4326 || model === 2 && horizontal !== undefined && horizontal !== 4326 && horizontal !== 32767) metadataIssue(result, "GeoKey model type conflicts with its horizontal CRS.", "ambiguous");
  if (horizontal === 32767 || model !== undefined && horizontal === undefined) metadataIssue(result, "User-defined/missing GeoKey CRS cannot be inferred from a base geographic CRS or citation.");
  if (model === 1 && geographic !== undefined && geographic !== 4326) metadataIssue(result, "Projected GeoKey base geographic CRS is inconsistent with WGS84.", "ambiguous");
  const unitCode = model === 1 || model === 2 ? code(model === 1 ? 3076 : 2054) : undefined; result.horizontalUnit = epsgUnit(unitCode); if (unitCode !== undefined && result.horizontalUnit === "unknown") metadataIssue(result, "Declared horizontal GeoKey unit is unsupported.");
  result.axisOrder = model === 1 ? "east-north" : model === 2 ? "lon-lat" : "unknown";
  if (result.horizontalCrs && result.horizontalUnit !== "unknown" && result.horizontalUnit !== expectedUnit(result.horizontalCrs)) metadataIssue(result, "GeoKey horizontal units conflict with its EPSG CRS definition.", "ambiguous");
  const datum = code(2050), prime = code(2051), ellipsoid = code(2056), geographicLinear = code(2052), angular = code(2054), azimuth = code(2060);
  if (datum !== undefined && datum !== 6326 || prime !== undefined && prime !== 8901 || ellipsoid !== undefined && ellipsoid !== 7030 || geographicLinear !== undefined && geographicLinear !== 9001 || angular !== undefined && ![9102, 9122].includes(angular) || azimuth !== undefined && ![9102, 9122].includes(azimuth)) metadataIssue(result, "GeoKey datum/ellipsoid/prime meridian or base units conflict with WGS84.", "ambiguous");
  const expected: Record<string, number> = { 2053: 1, 2055: RAD, 2057: A, 2058: A * Math.sqrt(1 - E2), 2059: 298.257223563, 2061: 0, 3077: result.horizontalUnit === "unknown" ? 1 : result.horizontalUnit === "degree" ? RAD : unitFactor(result.horizontalUnit) };
  for (const key of Object.keys(expected)) { const value = number(Number(key)); if (value !== undefined && Math.abs(value - expected[key]) > Math.max(1e-10, Math.abs(expected[key]) * 1e-10)) metadataIssue(result, `GeoKey ${key} custom value conflicts with the supported CRS/unit definition.`, "ambiguous"); }
  if (Object.prototype.hasOwnProperty.call(keys, "3077") && result.horizontalUnit === "unknown") metadataIssue(result, "Custom GeoKey linear unit size needs a supported explicit unit code.");
  const verticalCrs = code(4096), verticalDatum = code(4098), verticalUnit = code(4099), verticalName = keys["4097"];
  if (verticalName !== undefined && typeof verticalName !== "string") metadataIssue(result, "Vertical citation GeoKey must be a string.");
  if (verticalCrs !== undefined || verticalDatum !== undefined || typeof verticalName === "string" && verticalName.trim()) result.verticalDatum = { ...(typeof verticalName === "string" && verticalName.trim() ? { name: verticalName.trim() } : {}), ...(verticalCrs !== undefined && verticalCrs !== 32767 ? { crsEpsg: verticalCrs } : {}), ...(verticalDatum !== undefined && verticalDatum !== 32767 ? { epsg: verticalDatum } : {}) };
  const elevationUnit = epsgUnit(verticalUnit); result.elevationUnit = lengthUnits.has(elevationUnit as SurveyLengthUnit) ? elevationUnit as SurveyLengthUnit : "unknown";
  if (verticalUnit !== undefined && result.elevationUnit === "unknown") metadataIssue(result, "Declared elevation GeoKey unit is unsupported.");
  const definition = verticalDefinition(verticalCrs); if (verticalCrs !== undefined && verticalCrs !== 32767) { if (!definition) metadataIssue(result, "Vertical GeoKey EPSG CRS is outside the supported positive-up authority subset."); else if (result.elevationUnit !== "unknown" && result.elevationUnit !== definition.unit || verticalDatum !== undefined && verticalDatum !== definition.datum) metadataIssue(result, "Vertical GeoKey EPSG CRS conflicts with its declared elevation unit/datum.", "ambiguous"); }
  if (verticalCrs === 32767) metadataIssue(result, "User-defined vertical GeoKey CRS orientation is unsupported; a citation, datum and unit alone do not establish positive-up elevation.");
  if (result.status === "undeclared" && result.horizontalCrs) result.status = "supported";
  return result;
}
function summarizeCoordinateSources(format: SurveyCoordinateMetadata["format"], sources: SurveyMetadataSource[], lasVersion?: string, wktFlag?: boolean, lasPointFormat?: number): SurveyCoordinateMetadata {
  const wkt = sources.filter(s => s.recordId === 2112), geo = sources.filter(s => s.geoKeys !== undefined), math = sources.filter(s => s.recordId === 2111);
  let result = wkt.length === 1 && wkt[0].wkt ? readWktMetadata(wkt[0].wkt, format, sources) : geo.length === 1 ? readGeoKeyMetadata(format, sources, geo[0].geoKeys!) : unknownMetadata(format, sources);
  if (format === "las") { result = { ...result, lasVersion, lasPointFormat, wktFlag }; if (lasVersion === "1.4") { if (lasPointFormat !== undefined && lasPointFormat >= 6 && !wktFlag) metadataIssue(result, "LAS point formats 6–10 require the WKT encoding flag."); if (wktFlag && wkt.length !== 1 || !wktFlag && wkt.length) metadataIssue(result, "LAS WKT encoding flag disagrees with the active projection records.", "ambiguous"); } else if (wkt.length) metadataIssue(result, "WKT projection records require the supported LAS 1.4 WKT encoding declaration."); }
  const counts = new Map<number, number>(); for (const source of sources) { if (source.recordId !== undefined) counts.set(source.recordId, (counts.get(source.recordId) ?? 0) + 1); if (source.parseError) metadataIssue(result, source.parseError); }
  if ([...counts.values()].some(n => n > 1) || geo.length > 1 || wkt.length > 1) metadataIssue(result, "Duplicate active CRS projection (E)VLR/GeoKey records are ambiguous; superseded records must be marked in the source.", "ambiguous");
  if (wkt.length && sources.some(s => [34735, 34736, 34737].includes(s.recordId ?? -1)) || wkt.length && geo.length) metadataIssue(result, "Concurrent active WKT and GeoKey projection definitions are ambiguous.", "ambiguous");
  if (math.length) metadataIssue(result, "LAS math-transform WKT is retained but transformations are unsupported.");
  if (sources.some(s => [34736, 34737].includes(s.recordId ?? -1)) && !sources.some(s => s.recordId === 34735)) metadataIssue(result, "LAS GeoKey parameter records have no active key directory.");
  return result;
}

/** Validate bounded persisted source metadata and recompute interpreted fields from retained projection definitions. */
export function inspectSurveyCoordinateMetadata(value: unknown): SurveyCoordinateMetadata {
  const keys = new Set(["version", "format", "coordinateEncoding", "status", "horizontalCrs", "horizontalUnit", "axisOrder", "elevationUnit", "verticalDatum", "sources", "issues", "lasVersion", "lasPointFormat", "wktFlag"]);
  if (!isRecord(value) || Object.keys(value).some(k => !keys.has(k)) || value.version !== 1 || value.coordinateEncoding !== "source-units" || typeof value.format !== "string" || !["csv", "las", "geotiff"].includes(value.format) || typeof value.status !== "string" || !["undeclared", "supported", "unsupported", "ambiguous"].includes(value.status) || typeof value.horizontalUnit !== "string" || ![...horizontalUnits, "unknown"].includes(value.horizontalUnit) || typeof value.elevationUnit !== "string" || ![...lengthUnits, "unknown"].includes(value.elevationUnit) || typeof value.axisOrder !== "string" || !["east-north", "lon-lat", "north-east", "lat-lon", "unknown"].includes(value.axisOrder) || !Array.isArray(value.sources) || value.sources.length > 16 || !Array.isArray(value.issues) || value.issues.length > 32) throw new Error("Malformed/oversized survey coordinate metadata.");
  const format = value.format as SurveyCoordinateMetadata["format"], sourceKeys = new Set(["kind", "recordId", "userId", "byteLength", "wkt", "geoKeys", "parseError"]); let total = 0;
  const sources: SurveyMetadataSource[] = value.sources.map((raw: unknown) => {
    if (!isRecord(raw) || Object.keys(raw).some(k => !sourceKeys.has(k)) || typeof raw.kind !== "string" || !["las-vlr", "las-evlr", "geotiff", "csv"].includes(raw.kind) || (format === "las" ? !["las-vlr", "las-evlr"].includes(raw.kind) : raw.kind !== format)) throw new Error("Survey metadata source kind is inconsistent with its format.");
    const source: SurveyMetadataSource = { kind: raw.kind as SurveyMetadataSource["kind"] };
    if (raw.recordId !== undefined) { if (!Number.isInteger(raw.recordId) || ![2111, 2112, 34735, 34736, 34737].includes(raw.recordId as number)) throw new Error("Unsupported persisted projection record identifier."); source.recordId = raw.recordId as number; }
    if (raw.userId !== undefined) source.userId = text(raw.userId, 16, "projection user ID");
    if (format === "las" && (source.userId !== "LASF_Projection" || source.recordId === undefined) || format !== "las" && (source.userId !== undefined || source.recordId !== undefined)) throw new Error("Projection metadata source record declaration is inconsistent.");
    if (raw.byteLength !== undefined) { if (!Number.isInteger(raw.byteLength) || (raw.byteLength as number) < 0 || (raw.byteLength as number) > 262144) throw new Error("Invalid metadata payload length."); source.byteLength = raw.byteLength as number; }
    if (raw.wkt !== undefined) { source.wkt = text(raw.wkt, 65536, "projection WKT"); total += source.wkt.length; if (format !== "las" || ![2111, 2112].includes(source.recordId ?? -1)) throw new Error("WKT is attached to an incompatible metadata source."); }
    if (raw.parseError !== undefined) source.parseError = text(raw.parseError, 1024, "metadata parse diagnostic");
    if (raw.geoKeys !== undefined) { if (!isRecord(raw.geoKeys) || Object.keys(raw.geoKeys).length > 256 || format === "csv" || format === "las" && source.recordId !== 34735) throw new Error("Malformed/incompatible persisted GeoKeys."); const geoKeys: Record<string, number | string | number[]> = {}; for (const [id, item] of Object.entries(raw.geoKeys)) { if (!/^[1-9]\d{0,4}$/.test(id) || Number(id) > 65535) throw new Error("Invalid persisted GeoKey identifier."); if (typeof item === "number" && Number.isFinite(item)) geoKeys[id] = item; else if (typeof item === "string") { geoKeys[id] = text(item, 8192, "GeoKey citation"); total += item.length; } else if (Array.isArray(item) && item.length > 0 && item.length <= 32 && item.every(n => typeof n === "number" && Number.isFinite(n))) geoKeys[id] = [...item] as number[]; else throw new Error("Unsupported persisted GeoKey value."); } source.geoKeys = geoKeys; }
    if (format === "las" && source.recordId === 34735 && !source.geoKeys && !source.parseError || format === "las" && [2111, 2112].includes(source.recordId ?? -1) && !source.wkt && !source.parseError) throw new Error("Projection source lacks retained content or a parse diagnostic.");
    total += source.byteLength ?? 0; return source;
  });
  if (total > 524288) throw new Error("Persisted projection metadata exceeds aggregate bounds.");
  let lasVersion: string | undefined, lasPointFormat: number | undefined, wktFlag: boolean | undefined;
  if (format === "las") { lasVersion = text(value.lasVersion, 3, "LAS version"); const maximumFormat: Record<string, number> = { "1.1": 1, "1.2": 3, "1.3": 5, "1.4": 10 }; if (!/^1\.[1-4]$/.test(lasVersion) || !Number.isInteger(value.lasPointFormat) || (value.lasPointFormat as number) < 0 || (value.lasPointFormat as number) > (maximumFormat[lasVersion] ?? -1) || typeof value.wktFlag !== "boolean" || lasVersion !== "1.4" && value.wktFlag) throw new Error("Malformed LAS version/format/encoding metadata."); lasPointFormat = value.lasPointFormat as number; wktFlag = value.wktFlag; }
  else if (value.lasVersion !== undefined || value.lasPointFormat !== undefined || value.wktFlag !== undefined) throw new Error("LAS header metadata is attached to another format.");
  const result = summarizeCoordinateSources(format, sources, lasVersion, wktFlag, lasPointFormat);
  const declaredCrs = value.horizontalCrs === undefined ? undefined : text(value.horizontalCrs, 100, "metadata CRS");
  if (value.verticalDatum !== undefined) { const datum = value.verticalDatum; if (!isRecord(datum) || Object.keys(datum).some(k => !["name", "epsg", "crsEpsg"].includes(k)) || !Object.keys(datum).length) throw new Error("Malformed metadata vertical datum."); if (datum.name !== undefined) text(datum.name, 8192, "metadata vertical datum name"); for (const key of ["epsg", "crsEpsg"]) if (datum[key] !== undefined && (!Number.isInteger(datum[key]) || (datum[key] as number) < 1 || (datum[key] as number) > 1000000)) throw new Error("Invalid metadata vertical authority."); }
  const datum = value.verticalDatum as SurveyCoordinateMetadata["verticalDatum"];
  if (result.status !== value.status || result.horizontalCrs !== declaredCrs || result.horizontalUnit !== value.horizontalUnit || result.axisOrder !== value.axisOrder || result.elevationUnit !== value.elevationUnit || result.verticalDatum?.name !== datum?.name || result.verticalDatum?.epsg !== datum?.epsg || result.verticalDatum?.crsEpsg !== datum?.crsEpsg) throw new Error("Persisted survey metadata summary conflicts with its retained source definitions.");
  const issues = value.issues.map((issue: unknown) => text(issue, 1024, "metadata issue")); if (issues.length !== result.issues.length || issues.some((issue: string, i: number) => issue !== result.issues[i])) throw new Error("Persisted survey metadata diagnostics conflict with its retained source definitions.");
  return result;
}

function readLasCoordinateMetadata(buffer: ArrayBuffer, view: DataView, minor: number, format: number, header: number, pointOffset: number, pointEnd: number): SurveyCoordinateMetadata {
  const sources: SurveyMetadataSource[] = [], payloads = new Map<number, { source: SurveyMetadataSource; bytes: Uint8Array }[]>(); let projectionBytes = 0;
  const retain = (kind: "las-vlr" | "las-evlr", offset: number, size: number, recordId: number, userId: string) => {
    if (userId !== "LASF_Projection" || ![2111, 2112, 34735, 34736, 34737].includes(recordId)) return;
    if (sources.length >= 16 || (projectionBytes += size) > 262144) throw new Error("LAS projection metadata exceeds 16 records/256 KB.");
    const source: SurveyMetadataSource = { kind, recordId, userId, byteLength: size }, bytes = new Uint8Array(buffer, offset, size); sources.push(source); const entries = payloads.get(recordId) ?? []; entries.push({ source, bytes }); payloads.set(recordId, entries);
    if ([2111, 2112].includes(recordId)) { try { if (!size || size > 65536 || bytes[size - 1] !== 0) throw new Error("LAS WKT must be a bounded null-terminated UTF-8 string."); const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size - 1)); if (value.includes("\0")) throw new Error("LAS WKT contains embedded null characters."); source.wkt = text(value, 65536, "LAS projection WKT"); } catch (error) { source.parseError = error instanceof Error ? error.message : "Malformed LAS WKT string."; } }
  };
  const user = (o: number) => String.fromCharCode(...new Uint8Array(buffer, o, 16)).replace(/\0+$/, "");
  const vlrs = view.getUint32(100, true); if (vlrs > 128) throw new Error("LAS supports at most 128 VLRs."); let cursor = header;
  for (let i = 0; i < vlrs; i++) { if (cursor + 54 > pointOffset) throw new Error("LAS VLR header overlaps the point payload."); const size = view.getUint16(cursor + 20, true), end = cursor + 54 + size; if (end > pointOffset) throw new Error("LAS VLR payload overlaps the point payload."); retain("las-vlr", cursor + 54, size, view.getUint16(cursor + 18, true), user(cursor + 2)); cursor = end; }
  if (minor === 4) { const start = view.getBigUint64(235, true), count = view.getUint32(243, true); if (count > 128 || start > BigInt(Number.MAX_SAFE_INTEGER) || count === 0 && start !== 0n || count > 0 && (Number(start) < pointEnd || Number(start) > buffer.byteLength)) throw new Error("LAS EVLR table start/count is malformed or outside supported bounds."); cursor = Number(start); for (let i = 0; i < count; i++) { if (cursor + 60 > buffer.byteLength) throw new Error("LAS EVLR header is truncated."); const wide = view.getBigUint64(cursor + 20, true); if (wide > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("LAS EVLR length is too large."); const size = Number(wide), end = cursor + 60 + size; if (!Number.isSafeInteger(end) || end > buffer.byteLength) throw new Error("LAS EVLR payload is truncated."); retain("las-evlr", cursor + 60, size, view.getUint16(cursor + 18, true), user(cursor + 2)); cursor = end; } }
  const directories = payloads.get(34735) ?? [], doubles = payloads.get(34736) ?? [], ascii = payloads.get(34737) ?? [];
  for (const directory of directories) { try { if (directory.bytes.length % 2 || doubles.length > 1 || ascii.length > 1) throw new Error("LAS GeoKey tables are malformed or duplicated."); const d = new DataView(directory.bytes.buffer, directory.bytes.byteOffset, directory.bytes.byteLength), numbers = doubles[0]?.bytes, a = ascii[0]?.bytes; if (numbers && numbers.length % 8) throw new Error("LAS GeoDouble parameters have an invalid length."); const numeric = numbers ? new DataView(numbers.buffer, numbers.byteOffset, numbers.byteLength) : undefined, words = Array.from({ length: directory.bytes.length / 2 }, (_, i) => d.getUint16(i * 2, true)), values = numeric ? Array.from({ length: numbers!.length / 8 }, (_, i) => numeric.getFloat64(i * 8, true)) : [], citation = a ? new TextDecoder("utf-8", { fatal: true }).decode(a) : ""; directory.source.geoKeys = readGeoKeys(words, values, citation, true); } catch (error) { directory.source.parseError = error instanceof Error ? error.message : "Malformed LAS GeoKey tables."; } }
  return inspectSurveyCoordinateMetadata(summarizeCoordinateSources("las", sources, `1.${minor}`, minor === 4 && !!(view.getUint16(6, true) & 16), format));
}

export function inspectSurveyTerrainDeclaration(value: unknown): SurveyTerrainDeclaration {
  const keys = new Set(["version", "horizontalCrs", "horizontalUnit", "axisOrder", "elevationUnit", "verticalDatum", "source"]);
  if (!isRecord(value) || value.version !== 1 || Object.keys(value).some(k => !keys.has(k)) || typeof value.horizontalUnit !== "string" || !horizontalUnits.has(value.horizontalUnit as SurveyHorizontalUnit) || typeof value.elevationUnit !== "string" || !lengthUnits.has(value.elevationUnit as SurveyLengthUnit) || typeof value.axisOrder !== "string" || !["east-north", "lon-lat"].includes(value.axisOrder)) throw new Error("Survey declaration requires version 1, supported horizontal/elevation units and authored axis order.");
  const horizontalCrs = text(value.horizontalCrs, 100, "survey CRS").trim().toUpperCase(), verticalDatum = text(value.verticalDatum, 1000, "vertical datum").trim(), source = text(value.source, 2000, "survey declaration source").trim();
  if (horizontalCrs !== "LOCAL" && !supportedCrs(horizontalCrs) || verticalDatum.length < 3 || source.length < 8) throw new Error("Declare supported CRS or LOCAL, an explicit unchanged vertical datum, and a traceable declaration source.");
  if (horizontalCrs === "EPSG:4326" ? value.horizontalUnit !== "degree" || value.axisOrder !== "lon-lat" : value.horizontalUnit === "degree" || value.axisOrder !== "east-north") throw new Error("Authored survey CRS, units and X/Y axis order are inconsistent.");
  if (horizontalCrs !== "LOCAL" && value.horizontalUnit !== expectedUnit(horizontalCrs)) throw new Error("The supported EPSG horizontal CRS has canonical metre/degree units; externally convert differently defined CRS coordinates first.");
  return { version: 1, horizontalCrs, horizontalUnit: value.horizontalUnit as SurveyHorizontalUnit, axisOrder: value.axisOrder as SurveyTerrainDeclaration["axisOrder"], elevationUnit: value.elevationUnit as SurveyLengthUnit, verticalDatum, source };
}

/** Normalize declared length units only. No geoid, vertical-datum, axis-order or horizontal-CRS transformation occurs here. */
export function prepareSurveyForTerrain(survey: SurveyImport, value: unknown): PreparedSurvey {
  const declaration = inspectSurveyTerrainDeclaration(value), metadata = survey.coordinateMetadata ? inspectSurveyCoordinateMetadata(survey.coordinateMetadata) : undefined;
  if (!Array.isArray(survey.points) || survey.points.length < 3 || survey.points.length > 2000) throw new Error("Survey requires 3–2000 source points.");
  if (!Number.isInteger(survey.originalCount) || survey.originalCount < survey.points.length || survey.originalCount > 100000000 || !Array.isArray(survey.warnings) || survey.warnings.length > 100) throw new Error("Survey source count/warning bounds are invalid."); const warnings = survey.warnings.map(warning => text(warning, 2000, "survey warning"));
  if (metadata?.status === "unsupported" || metadata?.status === "ambiguous") throw new Error(`Survey CRS/unit metadata prevents terrain use: ${metadata.issues.join(" ")}`);
  const legacyCrs = survey.crs?.trim().toUpperCase();
  if (metadata?.horizontalCrs && metadata.horizontalCrs !== declaration.horizontalCrs || legacyCrs && legacyCrs !== declaration.horizontalCrs) throw new Error("Authored horizontal CRS conflicts with the source survey declaration; externally repair/convert the source rather than relabelling it.");
  if (metadata && metadata.horizontalUnit !== "unknown" && metadata.horizontalUnit !== declaration.horizontalUnit || metadata && metadata.elevationUnit !== "unknown" && metadata.elevationUnit !== declaration.elevationUnit || metadata && metadata.axisOrder !== "unknown" && metadata.axisOrder !== declaration.axisOrder) throw new Error("Authored units/axis order conflict with source survey metadata.");
  const verticalAuthority = verticalDefinition(metadata?.verticalDatum?.crsEpsg); if (verticalAuthority && verticalAuthority.unit !== declaration.elevationUnit) throw new Error("Authored elevation units conflict with the source vertical EPSG CRS.");
  const datum = metadata?.verticalDatum, datumNames = datum ? [datum.name, datum.epsg ? `EPSG:${datum.epsg}` : undefined, datum.crsEpsg ? `EPSG:${datum.crsEpsg}` : undefined].filter((v): v is string => !!v) : [];
  if (datumNames.length && !datumNames.some(name => name.trim().toUpperCase() === declaration.verticalDatum.toUpperCase())) throw new Error("Authored vertical datum differs from the source datum; vertical transformations are unsupported.");
  const horizontalFactorToMetres = declaration.horizontalUnit === "degree" ? null : unitFactor(declaration.horizontalUnit), elevationFactorToMetres = unitFactor(declaration.elevationUnit);
  const points = survey.points.map(p => { requireFinite(p.x, p.z, p.elevationM); const next = { ...p, x: p.x * (horizontalFactorToMetres ?? 1), z: p.z * (horizontalFactorToMetres ?? 1), elevationM: p.elevationM * elevationFactorToMetres }; requireFinite(next.x, next.z, next.elevationM); if (Math.abs(next.x) > 1e8 || Math.abs(next.z) > 1e8 || Math.abs(next.elevationM) > 1e5) throw new Error("Normalized survey exceeds supported coordinate/elevation ranges."); return next; });
  return { points, crs: declaration.horizontalCrs, warnings: [...warnings.slice(0, warnings.length === 100 ? 98 : 99), ...(warnings.length === 100 ? ["Two source warnings omitted to preserve the bounded prepared-survey warning list; full raw source warnings remain in the import."] : []), "Source height values normalized from the explicitly declared elevation unit. Vertical datum and axis order remain unchanged; no survey accuracy certification."], provenance: { version: 1, declaration, ...(metadata ? { sourceMetadata: metadata } : {}), horizontalFactorToMetres, elevationFactorToMetres, verticalTransformation: "none", axisReordering: "none" } };
}
function crsCode(crs: string): number { const match = /^EPSG:(\d+)$/i.exec(crs.trim()); if (!match) throw new Error("Use EPSG:4326, EPSG:3857 or WGS84 UTM EPSG:32601–32660/32701–32760."); const code = Number(match[1]); if (![4326, 3857].includes(code) && !(code >= 32601 && code <= 32660 || code >= 32701 && code <= 32760)) throw new Error("Unsupported CRS/datum."); return code; }
const utmZone = (code: number) => ({ zone: code % 100, south: code >= 32701 });
function forwardUtm(lon: number, lat: number, code: number): [number, number] {
  const { zone, south } = utmZone(code), meridian = zone * 6 - 183;
  if (lat < -80 || lat > 84 || Math.abs(lon - meridian) > 6 || (south ? lat > 0 : lat < 0)) throw new Error("Coordinate lies outside the bounded UTM zone/hemisphere.");
  const p = lat * RAD, d = (lon - meridian) * RAD, ep = E2 / (1 - E2), n = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2), t = Math.tan(p) ** 2, c = ep * Math.cos(p) ** 2, aa = Math.cos(p) * d;
  const m = A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * p - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * p) + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * p) - 35 * E2 ** 3 / 3072 * Math.sin(6 * p));
  return [500000 + K * n * (aa + (1 - t + c) * aa ** 3 / 6 + (5 - 18 * t + t ** 2 + 72 * c - 58 * ep) * aa ** 5 / 120), (south ? 10000000 : 0) + K * (m + n * Math.tan(p) * (aa ** 2 / 2 + (5 - t + 9 * c + 4 * c ** 2) * aa ** 4 / 24 + (61 - 58 * t + t ** 2 + 600 * c - 330 * ep) * aa ** 6 / 720))];
}
function inverseUtm(x: number, y: number, code: number): [number, number] {
  const { zone, south } = utmZone(code); if (x < 100000 || x > 900000 || y < 0 || y > 10000000) throw new Error("UTM easting/northing outside supported bounds.");
  const ep = E2 / (1 - E2), m = (y - (south ? 10000000 : 0)) / K, mu = m / (A * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256)), e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const p = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + 151 * e1 ** 3 / 96 * Math.sin(6 * mu) + 1097 * e1 ** 4 / 512 * Math.sin(8 * mu);
  const n = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2), r = A * (1 - E2) / (1 - E2 * Math.sin(p) ** 2) ** 1.5, t = Math.tan(p) ** 2, c = ep * Math.cos(p) ** 2, d = (x - 500000) / (n * K);
  const lat = p - n * Math.tan(p) / r * (d ** 2 / 2 - (5 + 3 * t + 10 * c - 4 * c ** 2 - 9 * ep) * d ** 4 / 24 + (61 + 90 * t + 298 * c + 45 * t ** 2 - 252 * ep - 3 * c ** 2) * d ** 6 / 720);
  const lon = (zone * 6 - 183) * RAD + (d - (1 + 2 * t + c) * d ** 3 / 6 + (5 - 2 * c + 28 * t - 3 * c ** 2 + 8 * ep + 24 * t ** 2) * d ** 5 / 120) / Math.cos(p);
  return [lon / RAD, lat / RAD];
}

/** Horizontal coordinates only: x is longitude/easting, z is latitude/northing. Elevation datum is unchanged. */
export function transformSurveyPoint(point: SurveyPoint, from: string, to: string): SurveyPoint {
  const source = crsCode(from), target = crsCode(to); requireFinite(point.x, point.z, point.elevationM); if (source === target) return { ...point };
  let lon: number, lat: number;
  if (source === 4326) { lon = point.x; lat = point.z; }
  else if (source === 3857) { lon = point.x / A / RAD; lat = (2 * Math.atan(Math.exp(point.z / A)) - Math.PI / 2) / RAD; }
  else [lon, lat] = inverseUtm(point.x, point.z, source);
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new Error("Geographic coordinate outside WGS84 bounds.");
  let x: number, z: number;
  if (target === 4326) { x = lon; z = lat; } else if (target === 3857) { if (Math.abs(lat) > 85.05112878) throw new Error("Latitude exceeds Web Mercator limit."); x = A * lon * RAD; z = A * Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2)); } else [x, z] = forwardUtm(lon, lat, target);
  requireFinite(x, z); return { ...point, x, z };
}

export function importSurveyCsv(text: string): SurveyImport {
  if (text.length > 2000000) throw new Error("Survey CSV limit is 2 MB."); const rows = text.trim().split(/\r?\n/); if (/^[a-z]/i.test(rows[0])) rows.shift();
  if (rows.length < 3 || rows.length > 2000) throw new Error("CSV must contain 3–2000 easting,northing,elevation points.");
  const points = rows.map(row => { const values = row.trim().split(/[,;\s]+/); if (values.length !== 3 || values.some(v => !v)) throw new Error("Each survey row requires three numbers."); const [x, z, elevationM] = values.map(Number); requireFinite(x, z, elevationM); return { x, z, elevationM }; });
  return { points, originalCount: points.length, coordinateMetadata: unknownMetadata("csv", [{ kind: "csv" }]), warnings: ["CSV coordinates/heights remain in source units. CRS, axes, horizontal/elevation units and unchanged vertical datum require an authored declaration."] };
}

export function importLas(buffer: ArrayBuffer): SurveyImport {
  if (buffer.byteLength < 227 || buffer.byteLength > 64000000) throw new Error("LAS size must be 227 bytes–64 MB.");
  const view = new DataView(buffer), signature = String.fromCharCode(...new Uint8Array(buffer, 0, 4)); if (signature !== "LASF") throw new Error("Expected an uncompressed LAS file.");
  const major = view.getUint8(24), minor = view.getUint8(25), header = view.getUint16(94, true), offset = view.getUint32(96, true), rawFormat = view.getUint8(104), format = rawFormat & 63, recordLength = view.getUint16(105, true);
  if (major !== 1 || minor < 1 || minor > 4 || (rawFormat & 192) || format > (minor === 1 ? 1 : minor === 2 ? 3 : minor === 3 ? 5 : 10)) throw new Error("Supported LAS 1.1–1.4 version-compatible point formats 0–10 only; LAZ compression is unsupported.");
  const minimums = [20, 28, 26, 34, 57, 63, 30, 36, 38, 59, 67]; if (recordLength < minimums[format] || header < (minor === 3 ? 235 : 227) || offset < header || header > buffer.byteLength) throw new Error("Malformed LAS header/record length.");
  let count = view.getUint32(107, true);
  if (minor === 4) { if (header < 375) throw new Error("LAS 1.4 requires the extended header."); const extended = view.getBigUint64(247, true); if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("LAS point count is too large."); if (format >= 6 && count !== 0 || count > 0 && extended > 0n && count !== Number(extended)) throw new Error("LAS legacy and extended point counts conflict."); if (extended) count = Number(extended); }
  const pointEnd = offset + count * recordLength; if (count < 3 || !Number.isSafeInteger(pointEnd) || pointEnd > buffer.byteLength) throw new Error("LAS point payload truncated/empty.");
  const scales = [131, 139, 147].map(o => view.getFloat64(o, true)), origins = [155, 163, 171].map(o => view.getFloat64(o, true)); requireFinite(...scales, ...origins); if (scales.some(n => n <= 0)) throw new Error("LAS scales must be positive.");
  const points: SurveyPoint[] = [], sampleCount = Math.min(count, 2000); for (let i = 0; i < sampleCount; i++) { const index = Math.floor(i * (count - 1) / (sampleCount - 1)), o = offset + index * recordLength; const xyz = scales.map((s, k) => view.getInt32(o + 4 * k, true) * s + origins[k]); requireFinite(...xyz); points.push({ x: xyz[0], z: xyz[1], elevationM: xyz[2], classification: format >= 6 ? view.getUint8(o + 16) : view.getUint8(o + 15) & 31 }); }
  const coordinateMetadata = readLasCoordinateMetadata(buffer, view, minor, format, header, offset, pointEnd);
  return { points, crs: coordinateMetadata.horizontalCrs, coordinateMetadata, originalCount: count, warnings: ["LAS coordinates/heights remain in source units. Missing units, axes and unchanged vertical datum require an authored declaration; vertical transforms are unsupported.", ...coordinateMetadata.issues, ...(count > 2000 ? [`Uniformly sampled ${count} records to 2000 points; this is not feature-aware terrain reduction.`] : [])] };
}

/** Classic TIFF, one uncompressed elevation band, strips, north-up tiepoint/pixel-scale georeferencing. */
export function importGeoTiffDem(buffer: ArrayBuffer): SurveyImport {
  if (buffer.byteLength < 16 || buffer.byteLength > 64000000) throw new Error("GeoTIFF limit is 64 MB.");
  const view = new DataView(buffer), bytes = new Uint8Array(buffer), le = bytes[0] === 73 && bytes[1] === 73; if (!le && !(bytes[0] === 77 && bytes[1] === 77) || view.getUint16(2, le) !== 42) throw new Error("Expected classic TIFF II/MM header; BigTIFF is unsupported.");
  const ifd = view.getUint32(4, le); if (ifd + 2 > buffer.byteLength) throw new Error("Invalid TIFF IFD."); const count = view.getUint16(ifd, le); if (count > 256 || ifd + 2 + 12 * count + 4 > buffer.byteLength) throw new Error("Invalid TIFF directory size.");
  const tags = new Map<number, { type: number; count: number; offset: number }>(), sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };
  const seenTags = new Set<number>(); for (let i = 0; i < count; i++) { const o = ifd + 2 + i * 12, tag = view.getUint16(o, le), type = view.getUint16(o + 2, le), n = view.getUint32(o + 4, le), size = sizes[type]; if (seenTags.has(tag)) throw new Error("TIFF directory contains duplicate tags."); seenTags.add(tag); if (!size || n > 100000) { if ([34735, 34736, 34737].includes(tag)) throw new Error("GeoTIFF projection tag type/count exceeds supported bounds."); continue; } const offset = size * n <= 4 ? o + 8 : view.getUint32(o + 8, le); if (offset + size * n > buffer.byteLength) throw new Error("TIFF tag points outside file."); tags.set(tag, { type, count: n, offset }); }
  const values = (tag: number): number[] => { const field = tags.get(tag); if (!field) return []; if (![1, 3, 4, 11, 12].includes(field.type)) throw new Error(`Unsupported TIFF numeric tag ${tag}.`); return Array.from({ length: field.count }, (_, i) => { const o = field.offset + i * sizes[field.type]; return field.type === 1 ? view.getUint8(o) : field.type === 3 ? view.getUint16(o, le) : field.type === 4 ? view.getUint32(o, le) : field.type === 11 ? view.getFloat32(o, le) : view.getFloat64(o, le); }); };
  const width = values(256)[0], height = values(257)[0], bits = values(258)[0], compression = values(259)[0] ?? 1, samples = values(277)[0] ?? 1, format = values(339)[0] ?? 1, rowsPerStrip = values(278)[0] ?? height, offsets = values(273), lengths = values(279), scale = values(33550), tie = values(33922);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16000000 || compression !== 1 || samples !== 1 || ![16, 32, 64].includes(bits) || ![1, 2, 3].includes(format) || (format === 3 && ![32, 64].includes(bits)) || (format !== 3 && bits === 64) || rowsPerStrip < 1 || !Number.isInteger(rowsPerStrip) || values(274)[0] && values(274)[0] !== 1 || tags.has(34264) || tags.has(322) || ![2, 3].includes(scale.length) || tie.length !== 6 || scale[0] <= 0 || scale[1] <= 0) throw new Error("DEM requires north-up classic TIFF, uncompressed single 16/32-bit integer or 32/64-bit float band, strips, pixel scale and one tiepoint.");
  requireFinite(...scale, ...tie); if (offsets.length !== Math.ceil(height / rowsPerStrip) || lengths.length !== offsets.length) throw new Error("Malformed TIFF strip table.");
  const stride = width * bits / 8; for (let i = 0; i < offsets.length; i++) { const expected = Math.min(rowsPerStrip, height - i * rowsPerStrip) * stride; if (lengths[i] < expected || offsets[i] + lengths[i] > buffer.byteLength) throw new Error("Truncated DEM strip."); }
  const source: SurveyMetadataSource = { kind: "geotiff" }, projectionTags = [34735, 34736, 34737].map(id => tags.get(id)); source.byteLength = projectionTags.reduce((sum, field) => sum + (field ? field.count * sizes[field.type] : 0), 0); if (source.byteLength > 262144) throw new Error("GeoTIFF projection metadata exceeds 256 KB.");
  try { const directory = tags.get(34735), doubles = tags.get(34736), ascii = tags.get(34737); if (directory) { if (directory.type !== 3 || directory.count > 8192 || doubles && (doubles.type !== 12 || doubles.count > 8192) || ascii && (ascii.type !== 2 || ascii.count > 65536)) throw new Error("GeoTIFF GeoKey/parameter table type/count is unsupported."); const citation = ascii ? new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(ascii.offset, ascii.offset + ascii.count)) : ""; source.geoKeys = readGeoKeys(values(34735), values(34736), citation, false); } else if (doubles || ascii) throw new Error("GeoTIFF projection parameter tables lack a GeoKey directory."); } catch (error) { source.parseError = error instanceof Error ? error.message : "Malformed GeoTIFF CRS metadata."; }
  if (scale.length === 3 && ![0, 1].includes(scale[2]) || tie[2] !== 0 || tie[5] !== 0) source.parseError = `${source.parseError ? `${source.parseError} ` : ""}Nonidentity GeoTIFF vertical pixel-scale/tiepoint transforms are unsupported.`;
  const coordinateMetadata = inspectSurveyCoordinateMetadata(summarizeCoordinateSources("geotiff", [source])), crs = coordinateMetadata.horizontalCrs, rasterType = source.geoKeys?.["1025"], pixelPoint = rasterType === 2;
  if (rasterType !== undefined && rasterType !== 1 && rasterType !== 2) throw new Error("Unsupported GeoTIFF raster pixel interpretation.");
  const nodata = tags.get(42113), noDataText = nodata?.type === 2 ? new TextDecoder().decode(bytes.slice(nodata.offset, nodata.offset + nodata.count)).replace(/\0/g, "").trim() : "", noData = noDataText ? Number(noDataText) : undefined;
  const stepX = Math.max(1, Math.ceil(Math.sqrt(width * height / 2000)), Math.ceil(width / 2000)), columns = Math.ceil(width / stepX), stepY = Math.max(1, Math.ceil(height / Math.floor(2000 / columns))), points: SurveyPoint[] = [];
  for (let row = 0; row < height; row += stepY) for (let col = 0; col < width; col += stepX) { const strip = Math.floor(row / rowsPerStrip), o = offsets[strip] + (row % rowsPerStrip) * stride + col * bits / 8; const elevationM = format === 3 ? bits === 32 ? view.getFloat32(o, le) : view.getFloat64(o, le) : format === 2 ? bits === 16 ? view.getInt16(o, le) : view.getInt32(o, le) : bits === 16 ? view.getUint16(o, le) : view.getUint32(o, le); if (!Number.isFinite(elevationM) || elevationM === noData) continue; const half = pixelPoint ? 0 : .5; points.push({ x: tie[3] + (col + half - tie[0]) * scale[0], z: tie[4] - (row + half - tie[1]) * scale[1], elevationM }); }
  if (points.length < 3 || points.length > 2000) throw new Error("DEM produces fewer than three valid cells or exceeds 2000 points; crop/reduce it before importing.");
  return { points, crs, coordinateMetadata, originalCount: width * height, warnings: ["One north-up band sampled at cell centres; heights remain in source units. Authored elevation units and unchanged vertical datum are required before terrain use.", ...coordinateMetadata.issues, ...(stepX > 1 || stepY > 1 ? [`Raster sampled at ${stepX}-column/${stepY}-row intervals; breaklines require separate survey data.`] : []), ...(crs ? [] : ["No supported declared horizontal EPSG key; provide source CRS evidence."])] };
}

const orient = (a: SurveyPoint, b: SurveyPoint, c: SurveyPoint) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
const crosses = (a: SurveyPoint, b: SurveyPoint, c: SurveyPoint, d: SurveyPoint) => orient(a, b, c) * orient(a, b, d) < -1e-12 && orient(c, d, a) * orient(c, d, b) < -1e-12;
function inside(p: SurveyPoint, ring: number[], points: SurveyPoint[]): boolean { let value = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = points[ring[i]], b = points[ring[j]]; if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) value = !value; } return value; }

/** Edge-flip constrained TIN: constraints must reference existing unique vertices; crossing/unsplit constraints are rejected. */
export function constrainedSurveySurface(points: SurveyPoint[], constraints: SurveyConstraints): SurveySurface {
  if (points.length < 3 || points.length > 2000 || constraints.breaklines.length > 100 || constraints.holes.length > 100) throw new Error("TIN supports 3–2000 points and at most 100 breaklines/holes.");
  const byCoordinate = new Map<string, number>(); points.forEach((p, i) => { requireFinite(p.x, p.z, p.elevationM); if (Math.abs(p.x) > 1e8 || Math.abs(p.z) > 1e8 || Math.abs(p.elevationM) > 1e5) throw new Error("TIN coordinates exceed supported metre ranges."); const key = `${p.x}:${p.z}`; if (byCoordinate.has(key)) throw new Error("TIN points must have unique plan coordinates."); byCoordinate.set(key, i); });
  const edges: [number, number][] = [];
  for (const [rings, closed] of [[constraints.breaklines, false], [constraints.holes, true]] as const) for (const ring of rings) { if (ring.length < (closed ? 3 : 2) || ring.length > 1000 || new Set(ring).size !== ring.length || ring.some(i => !Number.isInteger(i) || i < 0 || i >= points.length)) throw new Error("Constraints require unique valid zero-based point indices; hole rings are implicitly closed."); for (let i = 1; i < ring.length; i++) edges.push([ring[i - 1], ring[i]]); if (closed) edges.push([ring[ring.length - 1], ring[0]]); }
  if (edges.length > 1000) throw new Error("TIN constraint edge limit is 1000.");
  for (let i = 0; i < edges.length; i++) { const [a, b] = edges[i]; for (let j = i + 1; j < edges.length; j++) { const [c, d] = edges[j]; if (crosses(points[a], points[b], points[c], points[d])) throw new Error("Constraints intersect; split both segments at the shared survey vertex."); } for (let k = 0; k < points.length; k++) if (k !== a && k !== b && Math.abs(orient(points[a], points[b], points[k])) < 1e-8 && (points[k].x - points[a].x) * (points[k].x - points[b].x) + (points[k].z - points[a].z) * (points[k].z - points[b].z) < 0) throw new Error("Constraint passes through another point; split it at that point."); }
  const triangles = buildSurveyTin({ ...defaultTerrain, samples: points }).map(t => [byCoordinate.get(`${t.a.x}:${t.a.z}`)!, byCoordinate.get(`${t.b.x}:${t.b.z}`)!, byCoordinate.get(`${t.c.x}:${t.c.z}`)!]);
  if (!triangles.length) throw new Error("Survey has no nondegenerate terrain triangles.");
  const key = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`, locked = new Set<string>(); let budget = 0;
  const ccw = (a: number, b: number, c: number) => orient(points[a], points[b], points[c]) > 0 ? [a, b, c] : [a, c, b];
  for (const [a, b] of edges) {
    let done = false;
    for (let attempt = 0; attempt < 10000; attempt++) {
      const adjacency = new Map<string, { edge: [number, number]; owners: number[] }>();
      for (let i = 0; i < triangles.length; i++) { const t = triangles[i]; for (let j = 0; j < 3; j++) { if (++budget > 15000000) throw new Error("Constrained TIN operation budget exceeded; simplify constraints."); const u = t[j], v = t[(j + 1) % 3], id = key(u, v), current = adjacency.get(id); if (current) current.owners.push(i); else adjacency.set(id, { edge: [u, v], owners: [i] }); } }
      if (adjacency.has(key(a, b))) { locked.add(key(a, b)); done = true; break; }
      let flipped = false;
      for (const [id, item] of adjacency) { const [u, v] = item.edge; if (locked.has(id) || item.owners.length !== 2 || !crosses(points[a], points[b], points[u], points[v])) continue; const [i, j] = item.owners, c = triangles[i].find(n => n !== u && n !== v)!, d = triangles[j].find(n => n !== u && n !== v)!;
        if (!crosses(points[u], points[v], points[c], points[d]) || adjacency.has(key(c, d))) continue;
        triangles[i] = ccw(c, d, u); triangles[j] = ccw(d, c, v); flipped = true; break;
      }
      if (!flipped) break;
    }
    if (!done) throw new Error("Could not enforce a constraint inside the convex hull; revise survey/constraint topology.");
  }
  for (let i = 0; i < constraints.holes.length; i++) for (let j = i + 1; j < constraints.holes.length; j++) if (inside(points[constraints.holes[i][0]], constraints.holes[j], points) || inside(points[constraints.holes[j][0]], constraints.holes[i], points)) throw new Error("Nested/overlapping terrain holes are unsupported.");
  const kept = triangles.filter(t => !constraints.holes.some(ring => inside({ x: (points[t[0]].x + points[t[1]].x + points[t[2]].x) / 3, z: (points[t[0]].z + points[t[1]].z + points[t[2]].z) / 3, elevationM: 0 }, ring, points)));
  return { points, triangles: kept, warnings: ["Breakline edges are enforced by flips and holes removed. No exterior polygon trimming, elevation datum conversion or survey accuracy certification."] };
}

export function surveySurfaceElevation(surface: SurveySurface, x: number, z: number): number | undefined { const p = { x, z, elevationM: 0 }; for (const t of surface.triangles) { const [a, b, c] = t.map(i => surface.points[i]), area = orient(a, b, c), wa = orient(p, b, c) / area, wb = orient(a, p, c) / area, wc = 1 - wa - wb; if (wa >= -1e-8 && wb >= -1e-8 && wc >= -1e-8) return wa * a.elevationM + wb * b.elevationM + wc * c.elevationM; } return undefined; }

/** Steepest adjacent-vertex descent. Sinks remain sinks; no rainfall, pit filling or hydraulic solver. */
export function routeSurfaceDrainage(surface: SurveySurface): { paths: number[][]; sinks: number[] } {
  const neighbours = surface.points.map(() => new Set<number>()); for (const t of surface.triangles) for (let i = 0; i < 3; i++) { neighbours[t[i]].add(t[(i + 1) % 3]); neighbours[t[(i + 1) % 3]].add(t[i]); }
  const next = surface.points.map((p, i) => { let best = -1, slope = 0; for (const j of neighbours[i]) { const q = surface.points[j], drop = (p.elevationM - q.elevationM) / Math.hypot(q.x - p.x, q.z - p.z); if (drop > slope + 1e-9) { best = j; slope = drop; } } return best; });
  const paths = next.map((_, start) => { const path = [start]; let i = start; while (next[i] !== -1 && path.length <= surface.points.length) { i = next[i]; path.push(i); } return path; });
  return { paths, sinks: next.flatMap((n, i) => n === -1 && neighbours[i].size ? [i] : []) };
}
