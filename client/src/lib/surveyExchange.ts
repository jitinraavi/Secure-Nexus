import { buildSurveyTin, defaultTerrain } from "./terrain";

export interface SurveyPoint { x: number; z: number; elevationM: number; classification?: number }
export interface SurveyImport { points: SurveyPoint[]; crs?: string; warnings: string[]; originalCount: number }
export interface SurveyConstraints { breaklines: number[][]; holes: number[][] }
export interface SurveySurface { points: SurveyPoint[]; triangles: number[][]; warnings: string[] }
const A = 6378137, E2 = 0.0066943799901413165, K = .9996, RAD = Math.PI / 180;
const requireFinite = (...numbers: number[]) => { if (!numbers.every(Number.isFinite)) throw new Error("Coordinates must be finite."); };
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
  return { points, originalCount: points.length, warnings: ["CSV CRS and elevation datum must be supplied by the surveyor."] };
}

export function importLas(buffer: ArrayBuffer): SurveyImport {
  if (buffer.byteLength < 227 || buffer.byteLength > 64000000) throw new Error("LAS size must be 227 bytes–64 MB.");
  const view = new DataView(buffer), signature = String.fromCharCode(...new Uint8Array(buffer, 0, 4)); if (signature !== "LASF") throw new Error("Expected an uncompressed LAS file.");
  const major = view.getUint8(24), minor = view.getUint8(25), header = view.getUint16(94, true), offset = view.getUint32(96, true), rawFormat = view.getUint8(104), format = rawFormat & 63, recordLength = view.getUint16(105, true);
  if (major !== 1 || minor < 1 || minor > 4 || (rawFormat & 192) || format > (minor === 1 ? 1 : minor === 2 ? 3 : minor === 3 ? 5 : 10)) throw new Error("Supported LAS 1.1–1.4 version-compatible point formats 0–10 only; LAZ compression is unsupported.");
  const minimums = [20, 28, 26, 34, 57, 63, 30, 36, 38, 59, 67]; if (recordLength < minimums[format] || header < 227 || offset < header || header > buffer.byteLength) throw new Error("Malformed LAS header/record length.");
  let count = view.getUint32(107, true);
  if (minor === 4) { if (header < 375) throw new Error("LAS 1.4 requires the extended header."); const extended = view.getBigUint64(247, true); if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("LAS point count is too large."); if (extended) count = Number(extended); }
  if (count < 3 || offset + count * recordLength > buffer.byteLength) throw new Error("LAS point payload truncated/empty.");
  const scales = [131, 139, 147].map(o => view.getFloat64(o, true)), origins = [155, 163, 171].map(o => view.getFloat64(o, true)); requireFinite(...scales, ...origins); if (scales.some(n => n <= 0)) throw new Error("LAS scales must be positive.");
  const points: SurveyPoint[] = [], sampleCount = Math.min(count, 2000); for (let i = 0; i < sampleCount; i++) { const index = Math.floor(i * (count - 1) / (sampleCount - 1)), o = offset + index * recordLength; const xyz = scales.map((s, k) => view.getInt32(o + 4 * k, true) * s + origins[k]); requireFinite(...xyz); points.push({ x: xyz[0], z: xyz[1], elevationM: xyz[2], classification: format >= 6 ? view.getUint8(o + 16) : view.getUint8(o + 15) & 31 }); }
  return { points, originalCount: count, warnings: ["LAS CRS/VLR and vertical datum are not interpreted; assign the survey CRS explicitly.", ...(count > 2000 ? [`Uniformly sampled ${count} records to 2000 points; this is not feature-aware terrain reduction.`] : [])] };
}

/** Classic TIFF, one uncompressed elevation band, strips, north-up tiepoint/pixel-scale georeferencing. */
export function importGeoTiffDem(buffer: ArrayBuffer): SurveyImport {
  if (buffer.byteLength < 16 || buffer.byteLength > 64000000) throw new Error("GeoTIFF limit is 64 MB.");
  const view = new DataView(buffer), bytes = new Uint8Array(buffer), le = bytes[0] === 73 && bytes[1] === 73; if (!le && !(bytes[0] === 77 && bytes[1] === 77) || view.getUint16(2, le) !== 42) throw new Error("Expected classic TIFF II/MM header; BigTIFF is unsupported.");
  const ifd = view.getUint32(4, le); if (ifd + 2 > buffer.byteLength) throw new Error("Invalid TIFF IFD."); const count = view.getUint16(ifd, le); if (count > 256 || ifd + 2 + 12 * count + 4 > buffer.byteLength) throw new Error("Invalid TIFF directory size.");
  const tags = new Map<number, { type: number; count: number; offset: number }>(), sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };
  for (let i = 0; i < count; i++) { const o = ifd + 2 + i * 12, tag = view.getUint16(o, le), type = view.getUint16(o + 2, le), n = view.getUint32(o + 4, le), size = sizes[type]; if (!size || n > 100000) continue; const offset = size * n <= 4 ? o + 8 : view.getUint32(o + 8, le); if (offset + size * n > buffer.byteLength) throw new Error("TIFF tag points outside file."); tags.set(tag, { type, count: n, offset }); }
  const values = (tag: number): number[] => { const field = tags.get(tag); if (!field) return []; if (![1, 3, 4, 11, 12].includes(field.type)) throw new Error(`Unsupported TIFF numeric tag ${tag}.`); return Array.from({ length: field.count }, (_, i) => { const o = field.offset + i * sizes[field.type]; return field.type === 1 ? view.getUint8(o) : field.type === 3 ? view.getUint16(o, le) : field.type === 4 ? view.getUint32(o, le) : field.type === 11 ? view.getFloat32(o, le) : view.getFloat64(o, le); }); };
  const width = values(256)[0], height = values(257)[0], bits = values(258)[0], compression = values(259)[0] ?? 1, samples = values(277)[0] ?? 1, format = values(339)[0] ?? 1, rowsPerStrip = values(278)[0] ?? height, offsets = values(273), lengths = values(279), scale = values(33550), tie = values(33922);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16000000 || compression !== 1 || samples !== 1 || ![16, 32, 64].includes(bits) || ![1, 2, 3].includes(format) || (format === 3 && ![32, 64].includes(bits)) || (format !== 3 && bits === 64) || rowsPerStrip < 1 || !Number.isInteger(rowsPerStrip) || values(274)[0] && values(274)[0] !== 1 || tags.has(34264) || tags.has(322) || scale.length < 2 || tie.length < 6 || scale[0] <= 0 || scale[1] <= 0) throw new Error("DEM requires north-up classic TIFF, uncompressed single 16/32-bit integer or 32/64-bit float band, strips, pixel scale and tiepoint.");
  requireFinite(...scale, ...tie); if (offsets.length !== Math.ceil(height / rowsPerStrip) || lengths.length !== offsets.length) throw new Error("Malformed TIFF strip table.");
  const stride = width * bits / 8; for (let i = 0; i < offsets.length; i++) { const expected = Math.min(rowsPerStrip, height - i * rowsPerStrip) * stride; if (lengths[i] < expected || offsets[i] + lengths[i] > buffer.byteLength) throw new Error("Truncated DEM strip."); }
  const keys = values(34735), key = (id: number) => { if (keys.length < 4 || keys.length < 4 + 4 * keys[3]) return undefined; for (let i = 4; i < 4 + 4 * keys[3]; i += 4) if (keys[i] === id && keys[i + 1] === 0 && keys[i + 2] === 1) return keys[i + 3]; return undefined; }, pixelPoint = key(1025) === 2;
  const code = key(3072) ?? key(2048), crs = code && code !== 32767 ? `EPSG:${code}` : undefined;
  const nodata = tags.get(42113), noDataText = nodata?.type === 2 ? new TextDecoder().decode(bytes.slice(nodata.offset, nodata.offset + nodata.count)).replace(/\0/g, "").trim() : "", noData = noDataText ? Number(noDataText) : undefined;
  const stepX = Math.max(1, Math.ceil(Math.sqrt(width * height / 2000)), Math.ceil(width / 2000)), columns = Math.ceil(width / stepX), stepY = Math.max(1, Math.ceil(height / Math.floor(2000 / columns))), points: SurveyPoint[] = [];
  for (let row = 0; row < height; row += stepY) for (let col = 0; col < width; col += stepX) { const strip = Math.floor(row / rowsPerStrip), o = offsets[strip] + (row % rowsPerStrip) * stride + col * bits / 8; const elevationM = format === 3 ? bits === 32 ? view.getFloat32(o, le) : view.getFloat64(o, le) : format === 2 ? bits === 16 ? view.getInt16(o, le) : view.getInt32(o, le) : bits === 16 ? view.getUint16(o, le) : view.getUint32(o, le); if (!Number.isFinite(elevationM) || elevationM === noData) continue; const half = pixelPoint ? 0 : .5; points.push({ x: tie[3] + (col + half - tie[0]) * scale[0], z: tie[4] - (row + half - tie[1]) * scale[1], elevationM }); }
  if (points.length < 3 || points.length > 2000) throw new Error("DEM produces fewer than three valid cells or exceeds 2000 points; crop/reduce it before importing.");
  return { points, crs, originalCount: width * height, warnings: ["One north-up band sampled at cell centres; raster elevation units/datum must be metres and are not converted.", ...(stepX > 1 || stepY > 1 ? [`Raster sampled at ${stepX}-column/${stepY}-row intervals; breaklines require separate survey data.`] : []), ...(crs ? [] : ["No supported inline EPSG key; assign CRS explicitly."])] };
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
