import { analyzeAdvancedCivil, advancedProfileElevation, parseAdvancedAlignment, type AdvancedAlignment, type AdvancedCivilReport, type AlignmentPosition } from "./civilAlignment";
import type { SurveySurface } from "./surveyExchange";

export const ADVANCED_CIVIL_UNITS = Object.freeze({ linear: "m", elevation: "m", area: "m2", volume: "m3", heading: "degree", grade: "percent", curvature: "1/m" } as const);
type LengthUnit = "m" | "international-foot" | "us-survey-foot";
export interface CivilSourceUnits {
  horizontalCrs: string; horizontalUnit: LengthUnit | "degree"; axisOrder: "east-north" | "lon-lat";
  elevationUnit: LengthUnit; horizontalFactorToMetres: number | null; elevationFactorToMetres: number;
}
export interface AdvancedCivilReference {
  crs: string; axisOrder: "east-north"; verticalDatum: string; source: string; sourceUnits: CivilSourceUnits | null;
  projectFrame: null | { projectId: string; projectCrs: string; originEastingM: number; originNorthingM: number; originApplied: boolean };
}
export interface AdvancedCivilExchange {
  version: 1; kind: "groundwork-advanced-civil"; certification: false; units: typeof ADVANCED_CIVIL_UNITS;
  alignmentSource: string; reference: AdvancedCivilReference; terrain: SurveySurface | null; notices: string[];
}
export interface AdvancedCivilExchangeAnalysis { source: AdvancedCivilExchange; alignment: AdvancedAlignment; report: AdvancedCivilReport; notices: string[] }
const MAX_JSON = 2000000, MAX_XML = 5000000, MAX_SECTION_POINTS = 20000;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function object(v: unknown, required: string[], optional: string[] = [], label = "object"): Record<string, unknown> {
  const allowed = new Set([...required, ...optional]);
  if (!isRecord(v) || Reflect.ownKeys(v).some(k => typeof k !== "string" || !allowed.has(k)) || required.some(k => !Object.prototype.hasOwnProperty.call(v, k))) throw new Error(`Malformed ${label}; missing or unknown fields.`);
  return v;
}
function array(v: unknown, min: number, max: number, label: string): unknown[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw new Error(`${label} exceeds its supported count.`);
  const length = v.length;
  if (Reflect.ownKeys(v).some(k => typeof k !== "string" || k !== "length" && (!/^(0|[1-9]\d*)$/.test(k) || Number(k) >= length)) || Array.from({ length }, (_, i) => i).some(i => !Object.prototype.hasOwnProperty.call(v, i))) throw new Error(`${label} must be a dense array without extra fields.`);
  return v;
}
function text(v: unknown, max: number, label: string, layout = false): string {
  if (typeof v !== "string" || !v.trim() || v.length > max || (layout ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/ : /[\u0000-\u001f\u007f\ufffe\uffff]/).test(v)) throw new Error(`Invalid bounded ${label}.`);
  for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(`${label} contains an unpaired surrogate.`); } else if (c >= 0xdc00 && c <= 0xdfff) throw new Error(`${label} contains an unpaired surrogate.`); }
  return v;
}
function number(v: unknown, min: number, max: number, label: string): number { if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error(`Invalid finite ${label}.`); return v; }
const notices = (v: unknown, label: string) => array(v, 0, 100, label).map(n => text(n, 4000, label, true));
const projected = (crs: string) => /^EPSG:(?:3857|326(?:0[1-9]|[1-5][0-9]|60)|327(?:0[1-9]|[1-5][0-9]|60))$/.test(crs);
function crs(v: unknown, geographic = false): string { const result = text(v, 100, "CRS"); if (result !== "LOCAL" && !projected(result) && !(geographic && result === "EPSG:4326")) throw new Error("Civil exchange requires LOCAL or a supported projected metre CRS; source metadata may additionally declare EPSG:4326."); return result; }
const factor = (unit: LengthUnit): number => unit === "m" ? 1 : unit === "international-foot" ? .3048 : 1200 / 3937;
function sourceUnits(v: unknown): CivilSourceUnits | null {
  if (v === null) return null;
  const r = object(v, ["horizontalCrs", "horizontalUnit", "axisOrder", "elevationUnit", "horizontalFactorToMetres", "elevationFactorToMetres"], [], "source unit declaration"), horizontalCrs = crs(r.horizontalCrs, true);
  if (typeof r.horizontalUnit !== "string" || typeof r.elevationUnit !== "string" || !["m", "international-foot", "us-survey-foot", "degree"].includes(r.horizontalUnit) || !["m", "international-foot", "us-survey-foot"].includes(r.elevationUnit)) throw new Error("Unsupported declared source units.");
  const horizontalUnit = r.horizontalUnit as CivilSourceUnits["horizontalUnit"], elevationUnit = r.elevationUnit as LengthUnit, geographic = horizontalCrs === "EPSG:4326";
  if (r.axisOrder !== (geographic ? "lon-lat" : "east-north") || (horizontalUnit === "degree") !== geographic || horizontalCrs !== "LOCAL" && !geographic && horizontalUnit !== "m") throw new Error("Source CRS, axis order and units are inconsistent.");
  const horizontalFactorToMetres = horizontalUnit === "degree" ? null : factor(horizontalUnit), elevationFactorToMetres = factor(elevationUnit);
  if (r.horizontalFactorToMetres !== horizontalFactorToMetres || r.elevationFactorToMetres !== elevationFactorToMetres) throw new Error("Captured source-unit factors differ from the declared units.");
  return { horizontalCrs, horizontalUnit, axisOrder: geographic ? "lon-lat" : "east-north", elevationUnit, horizontalFactorToMetres, elevationFactorToMetres };
}
function reference(v: unknown): AdvancedCivilReference {
  const r = object(v, ["crs", "axisOrder", "verticalDatum", "source", "sourceUnits", "projectFrame"], [], "civil reference"), target = crs(r.crs), units = sourceUnits(r.sourceUnits);
  if (r.axisOrder !== "east-north" || units && (units.horizontalCrs === "LOCAL") !== (target === "LOCAL")) throw new Error("Civil coordinates require east/north axes; LOCAL cannot acquire georeferencing from a metadata label.");
  let projectFrame: AdvancedCivilReference["projectFrame"] = null;
  if (r.projectFrame !== null) { const f = object(r.projectFrame, ["projectId", "projectCrs", "originEastingM", "originNorthingM", "originApplied"], [], "project frame"); if (typeof f.originApplied !== "boolean") throw new Error("Project frame must explicitly record whether its origin was already applied."); projectFrame = { projectId: text(f.projectId, 200, "source project"), projectCrs: text(f.projectCrs, 100, "project CRS"), originEastingM: number(f.originEastingM, -1e8, 1e8, "project easting origin"), originNorthingM: number(f.originNorthingM, -1e8, 1e8, "project northing origin"), originApplied: f.originApplied }; }
  return { crs: target, axisOrder: "east-north", verticalDatum: text(r.verticalDatum, 1000, "unchanged vertical datum"), source: text(r.source, 2000, "reference source", true), sourceUnits: units, projectFrame };
}
function alignment(source: unknown): { source: string; value: AdvancedAlignment } {
  const original = text(source, 100000, "alignment JSON", true), r = object(JSON.parse(original) as unknown, ["name", "origin", "headingDeg", "startElevationM", "startGradePct", "horizontal", "vertical", "superelevation", "widthM", "crownPct", "sideSlopeRatio", "stationIntervalM", "crossSectionIntervalM", "maxDaylightM"], [], "alignment");
  text(r.name, 255, "alignment name"); object(r.origin, ["x", "z"], [], "alignment origin");
  for (const h of array(r.horizontal, 1, 100, "horizontal segments")) { if (!isRecord(h) || typeof h.kind !== "string" || !["line", "arc", "spiral"].includes(h.kind)) throw new Error("Invalid horizontal segment kind; use an exact supported string."); object(h, h.kind === "line" ? ["kind", "lengthM"] : h.kind === "arc" ? ["kind", "lengthM", "radiusM"] : ["kind", "lengthM", "curvatureStart", "curvatureEnd"], [], "horizontal segment"); }
  for (const c of array(r.vertical, 0, 100, "vertical curves")) object(c, ["stationM", "lengthM", "startGradePct", "endGradePct"], [], "vertical curve");
  for (const s of array(r.superelevation, 0, 100, "superelevation points")) object(s, ["stationM", "slopePct"], [], "superelevation point");
  return { source: original, value: parseAdvancedAlignment(original) };
}
function terrain(v: unknown): SurveySurface | null {
  if (v === null) return null;
  const r = object(v, ["points", "triangles", "warnings"], [], "captured terrain"), seenPoints = new Set<string>();
  const points = array(r.points, 3, 2000, "terrain points").map(p => {
    const q = object(p, ["x", "z", "elevationM"], ["classification"], "terrain point"), next = { x: number(q.x, -1e8, 1e8, "terrain easting"), z: number(q.z, -1e8, 1e8, "terrain northing"), elevationM: number(q.elevationM, -1e5, 1e5, "terrain elevation") }, key = `${next.x}:${next.z}`;
    if (seenPoints.has(key)) throw new Error("Captured terrain has duplicate horizontal point locations; resolve their elevations before authoring."); seenPoints.add(key);
    if (q.classification === undefined) return next;
    const classification = number(q.classification, 0, 255, "point classification"); if (!Number.isInteger(classification)) throw new Error("Point classification must be an integer."); return { ...next, classification };
  });
  const seenFaces = new Set<string>(), triangles = array(r.triangles, 1, 4000, "terrain faces").map(t => {
    const indices = array(t, 3, 3, "triangle indices").map(i => number(i, 0, points.length - 1, "triangle point index"));
    if (indices.some(i => !Number.isInteger(i)) || new Set(indices).size !== 3) throw new Error("Terrain faces require three distinct valid point indices.");
    const key = [...indices].sort((a, b) => a - b).join(":"); if (seenFaces.has(key)) throw new Error("Captured terrain has duplicate faces."); seenFaces.add(key);
    const [a, b, c] = indices.map(i => points[i]), area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (!Number.isFinite(area) || Math.abs(area) <= 1e-12) throw new Error("Captured terrain contains a degenerate face.");
    return indices;
  });
  return { points, triangles, warnings: notices(r.warnings, "terrain warnings") };
}
/** Exact authored inputs only; imported calculation/report claims are not accepted. */
export function parseAdvancedCivilExchange(value: unknown): AdvancedCivilExchange {
  const raw: unknown = typeof value === "string" ? JSON.parse(text(value, MAX_JSON, "civil exchange JSON", true)) as unknown : value;
  const r = object(raw, ["version", "kind", "certification", "units", "alignmentSource", "reference", "terrain", "notices"], [], "authored civil exchange");
  if (r.version !== 1 || r.kind !== "groundwork-advanced-civil" || r.certification !== false) throw new Error("Unsupported civil exchange version/scope or certification claim.");
  const u = object(r.units, Object.keys(ADVANCED_CIVIL_UNITS), [], "civil exchange units");
  for (const [key, expected] of Object.entries(ADVANCED_CIVIL_UNITS)) if (u[key] !== expected) throw new Error("Civil exchange coordinates, heights and stationing must already be normalized to the fixed metre unit contract.");
  const a = alignment(r.alignmentSource);
  return { version: 1, kind: "groundwork-advanced-civil", certification: false, units: { ...ADVANCED_CIVIL_UNITS }, alignmentSource: a.source, reference: reference(r.reference), terrain: terrain(r.terrain), notices: notices(r.notices, "captured notices") };
}
export function captureAdvancedCivilExchange(input: unknown): AdvancedCivilExchange {
  const r = object(input, ["alignmentSource", "reference"], ["terrain", "notices"], "civil capture inputs");
  return parseAdvancedCivilExchange({ version: 1, kind: "groundwork-advanced-civil", certification: false, units: ADVANCED_CIVIL_UNITS, alignmentSource: r.alignmentSource, reference: r.reference, terrain: r.terrain ?? null, notices: r.notices ?? [] });
}
export function serializeAdvancedCivilExchange(value: unknown): string {
  const result = JSON.stringify(parseAdvancedCivilExchange(value), null, 2); if (result.length > MAX_JSON) throw new Error("Authored civil JSON exceeds 2 MB."); return result;
}
function unionNotices(...groups: string[][]): string[] { const result = [...new Set(groups.flat())]; if (result.length > 300) throw new Error("Civil review notices exceed the 300-message output bound; retain the original source exchange."); return result; }
export function analyzeAdvancedCivilExchange(value: unknown): AdvancedCivilExchangeAnalysis {
  const source = parseAdvancedCivilExchange(value), a = alignment(source.alignmentSource).value, report = analyzeAdvancedCivil(a, source.terrain ?? undefined);
  if (report.stations.length > 500 || report.sections.length > 500) throw new Error("Derived civil station/section count exceeded its supported bound.");
  number(report.lengthM, .01, 1e6, "derived alignment length"); number(report.quantifiedLengthM, 0, report.lengthM + 1e-6, "quantified length"); number(report.cutM3, 0, 1e16, "approximate cut volume"); number(report.fillM3, 0, 1e16, "approximate fill volume");
  for (const s of report.stations) { number(s.stationM, 0, report.lengthM, "derived station"); number(s.x, -2e8, 2e8, "derived easting"); number(s.z, -2e8, 2e8, "derived northing"); number(s.headingRad, -1e8, 1e8, "derived heading"); number(s.curvature, -1, 1, "derived curvature"); number(s.elevationM, -1e6, 1e6, "derived elevation"); number(s.gradePct, -31, 31, "derived grade"); if (s.superelevationPct !== undefined) number(s.superelevationPct, -20, 20, "derived superelevation"); }
  let pointCount = 0;
  for (const s of report.sections) { number(s.stationM, 0, report.lengthM, "section station"); number(s.cutAreaM2, 0, 1e10, "approximate cut area"); number(s.fillAreaM2, 0, 1e10, "approximate fill area"); pointCount += s.points.length; if (pointCount > MAX_SECTION_POINTS) throw new Error("Derived civil sections exceed 20,000 points; increase sampling intervals."); for (const p of s.points) { number(p.offsetM, -250, 250, "section offset"); number(p.x, -2e8, 2e8, "section easting"); number(p.z, -2e8, 2e8, "section northing"); number(p.groundM, -1e6, 1e6, "section ground elevation"); number(p.designM, -1e6, 1e6, "section design elevation"); } }
  const extra = ["Captured CRS, source-unit factors, origin and vertical datum are authored declarations; no origin addition, unit conversion, CRS reprojection, vertical transformation or accuracy certification occurs during this exchange export.", "Captured terrain faces and sampled earthworks are unverified study geometry; overlapping faces, narrow coverage gaps and between-sample errors require independent review."];
  if (!source.reference.sourceUnits) extra.push("No original source-unit normalization record was supplied; captured coordinates/heights are explicitly author-declared metres.");
  const incomplete = report.sections.filter(s => !s.complete || s.points.length < 2); if (incomplete.length) extra.push(`${incomplete.length} sampled sections are incomplete/insufficient; all ${report.sections.length} sections are omitted from LandXML to prevent consumers interpolating across those gaps. Full sampled records remain in the freshly recomputed JSON analysis, with adjoining incomplete volume intervals excluded.`);
  return { source, alignment: a, report, notices: unionNotices(source.notices, source.terrain?.warnings ?? [], report.warnings, extra) };
}
const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/\r/g, "&#13;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");
const n = (v: number): string => { if (!Number.isFinite(v)) throw new Error("Non-finite LandXML value."); return String(Object.is(v, -0) ? 0 : v); };
const coord = (p: { x: number; z: number }): string => `${n(p.z)} ${n(p.x)}`;
const feature = (values: [string, string][]): string => `<Feature code="GroundworkAdvancedCivil" source="Groundwork">${values.map(([label, value]) => `<Property label="${xml(label)}" value="${xml(value)}"/>`).join("")}</Feature>`;
function position(report: AdvancedCivilReport, station: number): AlignmentPosition { const p = report.stations.find(s => s.stationM === station); if (!p) throw new Error("Derived report is missing an authored horizontal boundary."); return p; }
/** Native horizontal geometry only: unsupported spirals/arcs fail instead of silently becoming sampled lines. */
export function buildAdvancedCivilLandXml(value: unknown): string {
  const { source, alignment: a, report, notices: review } = analyzeAdvancedCivilExchange(value), geometry: string[] = []; let station = 0;
  for (const [index, h] of a.horizontal.entries()) {
    const endStation = station + h.lengthM, start = position(report, station), end = position(report, endStation), startEnd = `<Start>${coord(start)}</Start><End>${coord(end)}</End>`, fail = (reason: string): never => { throw new Error(`LandXML horizontal segment ${index + 1}: ${reason} Keep the authored JSON exchange for the full source definition.`); };
    if (h.kind === "line") geometry.push(`<Line length="${n(h.lengthM)}" staStart="${n(station)}">${startEnd}</Line>`);
    else if (h.kind === "arc") {
      const radius = h.radiusM!, turn = h.lengthM / radius; if (Math.abs(turn) >= 2 * Math.PI - 1e-8) fail("Full-circle/multiple-turn circular arcs are outside this native exchange subset.");
      const center = { x: start.x - radius * Math.sin(start.headingRad), z: start.z + radius * Math.cos(start.headingRad) }; number(center.x, -2e8, 2e8, "arc centre easting"); number(center.z, -2e8, 2e8, "arc centre northing");
      geometry.push(`<Curve rot="${radius > 0 ? "ccw" : "cw"}" radius="${n(Math.abs(radius))}" length="${n(h.lengthM)}" staStart="${n(station)}"><Start>${coord(start)}</Start><Center>${coord(center)}</Center><End>${coord(end)}</End></Curve>`);
    } else {
      const k0 = h.curvatureStart!, k1 = h.curvatureEnd!, change = k1 - k0, turn = h.lengthM * (k0 + k1) / 2;
      if (k0 < 0 && k1 > 0 || k0 > 0 && k1 < 0 || change === 0 || Math.abs(turn) >= Math.PI - 1e-8) fail("Only non-inflecting varying-curvature clothoids with total turn below 180 degrees are supported; constant-curvature, inflecting and multiple-turn spirals are retained in JSON.");
      const u = { x: Math.cos(start.headingRad), z: Math.sin(start.headingRad) }, v = { x: Math.cos(end.headingRad), z: Math.sin(end.headingRad) }, dx = end.x - start.x, dz = end.z - start.z, determinant = u.x * v.z - u.z * v.x;
      if (Math.abs(determinant) < 1e-8) fail("Spiral end tangents do not yield a stable finite intersection.");
      const alongStart = (dx * v.z - dz * v.x) / determinant, alongEnd = (dx * u.z - dz * u.x) / determinant;
      if (!(alongStart > 0 && alongEnd < 0)) fail("Spiral tangent intersection is outside the supported forward/backward tangent arrangement.");
      const pi = { x: start.x + alongStart * u.x, z: start.z + alongStart * u.z }, constant = Math.sqrt(h.lengthM / Math.abs(change));
      number(pi.x, -2e8, 2e8, "spiral PI easting"); number(pi.z, -2e8, 2e8, "spiral PI northing"); number(constant, Number.MIN_VALUE, 1e12, "clothoid constant");
      const radius = (k: number): string => { if (k === 0) return "INF"; const r = Math.abs(1 / k); if (!Number.isFinite(r) || r > 1e12) fail("Finite spiral endpoint radius exceeds the 1,000,000,000,000 m native limit; only an exactly zero curvature is written as INF."); return n(r); };
      geometry.push(`<Spiral length="${n(h.lengthM)}" radiusStart="${radius(k0)}" radiusEnd="${radius(k1)}" rot="${(k0 || k1) > 0 ? "ccw" : "cw"}" spiType="clothoid" constant="${n(constant)}" staStart="${n(station)}"><Start>${coord(start)}</Start><PI>${coord(pi)}</PI><End>${coord(end)}</End></Spiral>`);
    }
    station = endStation;
  }
  const profile = [`<PVI>0 ${n(a.startElevationM)}</PVI>`]; let priorGrade = a.startGradePct;
  for (const [index, c] of a.vertical.entries()) {
    if (c.startGradePct !== priorGrade) throw new Error(`LandXML vertical curve ${index + 1} requires exact authored grade continuity; the alignment analyser's rounding allowance is retained only in JSON analysis.`);
    const begin = advancedProfileElevation(a, c.stationM).elevationM, pviStation = c.stationM + c.lengthM / 2, pviElevation = begin + c.startGradePct / 100 * c.lengthM / 2;
    profile.push(`<ParaCurve length="${n(c.lengthM)}">${n(pviStation)} ${n(pviElevation)}</ParaCurve>`); priorGrade = c.endGradePct;
  }
  profile.push(`<PVI>${n(report.lengthM)} ${n(advancedProfileElevation(a, report.lengthM).elevationM)}</PVI>`);
  const incomplete = report.sections.filter(s => !s.complete || s.points.length < 2), sections = (incomplete.length ? [] : report.sections).map(s => {
    const points = s.points.map(p => ({ offset: -p.offsetM, ground: p.groundM, design: p.designM })).sort((x, y) => x.offset - y.offset);
    return `<CrossSect sta="${n(s.stationM)}" name="Sampled ${n(s.stationM)}" desc="Complete at sampled offsets; gaps between samples remain unverified"><CrossSectSurf name="Captured ground"><PntList2D>${points.map(p => `${n(p.offset)} ${n(p.ground)}`).join(" ")}</PntList2D></CrossSectSurf><DesignCrossSectSurf name="Sampled design" side="both" closedArea="false">${points.map(p => `<CrossSectPnt dataFormat="Offset Elevation">${n(p.offset)} ${n(p.design)}</CrossSectPnt>`).join("")}</DesignCrossSectSurf></CrossSect>`;
  });
  const metadata: [string, string][] = [["Version", "1"], ["Certification", "false"], ["Scope", "Authored native alignment/profile; sampled approximate sections and earthworks"], ["ReferenceDeclaration", JSON.stringify(source.reference)], ["AlignmentSourceJSON", source.alignmentSource], ["ApproximateCutM3", n(report.cutM3)], ["ApproximateFillM3", n(report.fillM3)], ["QuantifiedLengthM", n(report.quantifiedLengthM)], ["LandXMLSectionOmittedCount", n(report.sections.length - sections.length)], ["IncompleteSectionStationsM", JSON.stringify(incomplete.map(s => s.stationM))], ...review.map((notice, i): [string, string] => [`Notice${i + 1}`, notice])];
  const ref = source.reference, coordinateSystem = ref.crs === "LOCAL" ? `<CoordinateSystem horizontalCoordinateSystemName="LOCAL" verticalCoordinateSystemName="${xml(`Authored unchanged reference: ${ref.verticalDatum}; heights normalized to metres`)}" desc="Authored local reference; no georeferencing inferred"/>` : `<CoordinateSystem name="${xml(ref.crs)}" epsgCode="${xml(ref.crs.slice(5))}" verticalCoordinateSystemName="${xml(`Authored unchanged reference: ${ref.verticalDatum}; heights normalized to metres`)}" desc="Authored projected reference; CRS and height datum unverified"/>`, date = new Date().toISOString();
  const result = `<?xml version="1.0" encoding="UTF-8"?>\n<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${date.slice(0, 10)}" time="${date.slice(11, 19)}" language="English" readOnly="false">\n<Units><Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter" elevationUnit="meter" angularUnit="decimal degrees" directionUnit="decimal degrees" temperatureUnit="celsius" pressureUnit="milliBars"/></Units>\n${coordinateSystem}\n<Project name="${xml(a.name)}" desc="Bounded authored civil exchange; unverified study geometry">${feature(metadata)}</Project>\n<Application name="Groundwork" manufacturer="Groundwork" version="1"/>\n<Alignments name="Groundwork authored alignment"><Alignment name="${xml(a.name)}" length="${n(report.lengthM)}" staStart="0"><CoordGeom>${geometry.join("")}</CoordGeom><Profile name="Authored design profile" staStart="0"><ProfAlign name="Continuous parabolic profile">${profile.join("")}</ProfAlign></Profile>${sections.length ? `<CrossSects>${sections.join("")}</CrossSects>` : ""}</Alignment></Alignments>\n</LandXML>\n`;
  if (result.length > MAX_XML) throw new Error("Native civil LandXML exceeds 5 MB; retain the authored JSON source and narrow the sampled exchange."); return result;
}
