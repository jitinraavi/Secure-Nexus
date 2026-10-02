import type { CivilProfilePoint, CivilSettings, InfraDesign, SiteLocation, TerrainSample } from "../types";
import { centroid, toLocalMetres } from "./geo";
import { terrainElevation, terrainSettings, terrainTriangles, type CutFillSummary } from "./terrain";
import { infraExtent } from "./infra";

export interface CivilStation {
  stationM: number; x: number; z: number; elevationM: number; gradePct: number;
  designElevationM: number; leftElevationM: number; rightElevationM: number;
  cutAreaM2: number; fillAreaM2: number;
}
export interface CivilAlignmentReport {
  lengthM: number; stations: CivilStation[]; maxGradePct: number;
  minElevationM: number; maxElevationM: number; cutFill: CutFillSummary;
  projectCrs: string; peakRunoffM3s: number; warnings: string[];
}
const finite = (v: number | undefined, fallback: number) => Number.isFinite(v) ? v! : fallback;
export function inspectCivilProfile(value: unknown): { profile?: CivilProfilePoint[]; error?: string } {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return {};
  if (!Array.isArray(value) || value.length < 2 || value.length > 100) return { error: "A vertical profile needs 2–100 station/elevation points." };
  const profile: CivilProfilePoint[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return { error: "Profile points must contain numeric stationM and elevationM." };
    const point = item as Partial<CivilProfilePoint>;
    if (typeof point.stationM !== "number" || typeof point.elevationM !== "number" || !Number.isFinite(point.stationM) || !Number.isFinite(point.elevationM) || point.stationM < 0 || point.stationM > 1e7 || Math.abs(point.elevationM) > 1e5) return { error: "Profile coordinates are outside the supported finite range." };
    if (profile.length && point.stationM <= profile[profile.length - 1].stationM) return { error: "Profile stations must increase strictly, without duplicates." };
    profile.push({ stationM: point.stationM, elevationM: point.elevationM });
  }
  if (profile[0].stationM !== 0) return { error: "The first profile station must be zero." };
  return { profile };
}

export function parseCivilProfile(text: string): { profile?: CivilProfilePoint[]; error?: string } {
  if (!text.trim()) return {};
  if (text.length > 20000) return { error: "Profile text exceeds the supported size." };
  const lines = text.trim().split(/\r?\n/).filter(line => line.trim());
  if (/^station/i.test(lines[0])) lines.shift();
  const values = lines.map(line => { const fields = line.trim().split(/[,;\s]+/); return fields.length === 2 && fields.every(field => field.trim()) ? { stationM: Number(fields[0]), elevationM: Number(fields[1]) } : null; });
  return inspectCivilProfile(values);
}

export function civilDesignElevation(settings: CivilSettings, stationM: number): number {
  const profile = settings.profile;
  if (!profile?.length) return settings.startElevationM + stationM * settings.gradePct / 100;
  if (stationM >= profile[profile.length - 1].stationM) return profile[profile.length - 1].elevationM;
  let index = 1;
  while (index < profile.length - 1 && profile[index].stationM < stationM) index++;
  const a = profile[index - 1], b = profile[index];
  return a.elevationM + (b.elevationM - a.elevationM) * (stationM - a.stationM) / (b.stationM - a.stationM);
}

export function civilStationNormal(points: { x: number; z: number }[], index: number) {
  const point = points[index], prior = points[Math.max(0, index - 1)], next = points[Math.min(points.length - 1, index + 1)];
  let dx = next.x - prior.x, dz = next.z - prior.z;
  if (Math.hypot(dx, dz) < 1e-8) { dx = next.x - point.x; dz = next.z - point.z; }
  if (Math.hypot(dx, dz) < 1e-8) { dx = point.x - prior.x; dz = point.z - prior.z; }
  const length = Math.hypot(dx, dz) || 1;
  return { x: -dz / length, z: dx / length };
}

export function civilSettings(infra: InfraDesign): CivilSettings {
  const v = infra.civil;
  return {
    showCorridor: v?.showCorridor === true,
    profile: inspectCivilProfile(v?.profile).profile,
    stationIntervalM: Math.min(1000, Math.max(1, finite(v?.stationIntervalM, 25))),
    corridorWidthM: Math.min(500, Math.max(1, finite(v?.corridorWidthM, 12))),
    startElevationM: Math.max(-100000, Math.min(100000, finite(v?.startElevationM, terrainSettings(infra.terrain).baseElevationM))),
    gradePct: Math.min(30, Math.max(-30, finite(v?.gradePct, 0))),
    crossfallPct: Math.min(20, Math.max(-20, finite(v?.crossfallPct, 2))),
    rainfallMmPerHour: Math.min(1000000, Math.max(0, finite(v?.rainfallMmPerHour, 50))),
    runoffCoefficient: Math.min(1, Math.max(0, finite(v?.runoffCoefficient, 0.7))),
    catchmentAreaHa: Math.min(1000000, Math.max(0, finite(v?.catchmentAreaHa, 1))),
  };
}

function localRoute(location?: SiteLocation): { x: number; z: number }[] {
  if ((location?.route?.length ?? 0) > 10000) return [];
  const route = (location?.route ?? []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
  if (!route.length) return [];
  const origin = centroid(route);
  return route.map(point => {
    const local = toLocalMetres(point, origin);
    return { x: local.x, z: local.y };
  });
}

/** Include every route vertex as well as regular stations to retain bends in exchange. */
function samplePolyline(points: { x: number; z: number }[], intervalM: number) {
  const stations: { distance: number; x: number; z: number }[] = [{ distance: 0, ...points[0] }];
  let distance = 0, nextRegular = intervalM;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-8) continue;
    const end = distance + length;
    while (nextRegular < end - 1e-8) {
      if (nextRegular > distance + 1e-8) {
        const t = (nextRegular - distance) / length;
        stations.push({ distance: nextRegular, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
      nextRegular += intervalM;
    }
    stations.push({ distance: end, ...b });
    if (Math.abs(nextRegular - end) < 1e-8) nextRegular += intervalM;
    distance = end;
  }
  return stations;
}

export function analyzeCivilAlignment(infra: InfraDesign, intervalM?: number): CivilAlignmentReport {
  const terrain = terrainSettings(infra.terrain), civil = civilSettings(infra), route = localRoute(infra.location);
  const fallback = Math.max(10, Math.min(1000000, finite(infra.location?.routeLengthM, 500)));
  const points = route.length >= 2 ? route : [{ x: -fallback / 2, z: 0 }, { x: fallback / 2, z: 0 }];
  const total = points.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z) : 0, 0);
  // Bound sampling on long routes; original vertices are retained.
  const interval = Math.max(finite(intervalM, civil.stationIntervalM), 1, total / 2000);
  const sampled = samplePolyline(points, interval), warnings: string[] = [];
  if (total < 1e-8) warnings.push("The alignment has no nonzero segment; no corridor surface or volume is generated.");
  const profileCheck = inspectCivilProfile(infra.civil?.profile);
  if (profileCheck.error) warnings.push(profileCheck.error + " Constant-grade settings are used.");
  if ((infra.location?.route?.length ?? 0) > 10000) warnings.push("The traced route exceeds 10,000 vertices; a straight fallback is used.");
  if (civil.profile) {
    const originalStations = [...sampled];
    for (const point of civil.profile) {
      if (point.stationM <= 0 || point.stationM >= total || sampled.some(station => Math.abs(station.distance - point.stationM) < 1e-7)) continue;
      const index = originalStations.findIndex(station => station.distance > point.stationM);
      if (index < 1) continue;
      const a = originalStations[index - 1], b = originalStations[index], t = (point.stationM - a.distance) / (b.distance - a.distance);
      sampled.push({ distance: point.stationM, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
    sampled.sort((a, b) => a.distance - b.distance);
    const end = civil.profile[civil.profile.length - 1].stationM;
    if (end < total) warnings.push("The vertical profile ends before the route; the final elevation is held beyond it.");
    if (end > total) warnings.push("The vertical profile extends beyond the route; only covered stations are exported.");
  }
  if (route.length < 2) warnings.push("No traced alignment: using a straight local fallback.");
  if (interval > civil.stationIntervalM && intervalM === undefined) warnings.push("Station interval increased to limit regular sampling to 2,000 stations.");
  if (terrain.source !== "survey") warnings.push("Terrain is procedural. Quantities are planning estimates.");
  if (terrain.source === "survey") warnings.push("Sampling outside the survey convex hull uses IDW extrapolation.");
  warnings.push(civil.profile ? "Straight horizontal segments and piecewise linear vertical profile; no spiral or vertical curves." : "Straight horizontal segments and a constant design grade; no spiral or vertical-curve design.");
  let previous: CivilStation | undefined;
  const stations = sampled.map((point, i): CivilStation => {
    const elevationM = terrainElevation(point.x, point.z, terrain);
    const gradePct = previous && point.distance > previous.stationM ? (elevationM - previous.elevationM) / (point.distance - previous.stationM) * 100 : 0;
    const normal = civilStationNormal(sampled, i), nx = normal.x, nz = normal.z;
    const designElevationM = civilDesignElevation(civil, point.distance);
    let cutAreaM2 = 0, fillAreaM2 = 0;
    const strips = 12, stripWidth = civil.corridorWidthM / strips;
    for (let strip = 0; strip < strips; strip++) {
      const offset = -civil.corridorWidthM / 2 + (strip + 0.5) * stripWidth;
      const target = designElevationM - Math.abs(offset) * civil.crossfallPct / 100;
      const delta = terrainElevation(point.x + offset * nx, point.z + offset * nz, terrain) - target;
      if (delta > 0) cutAreaM2 += delta * stripWidth; else fillAreaM2 += -delta * stripWidth;
    }
    const edge = designElevationM - civil.corridorWidthM / 2 * civil.crossfallPct / 100;
    const station = { stationM: point.distance, x: point.x, z: point.z, elevationM, gradePct, designElevationM, leftElevationM: edge, rightElevationM: edge, cutAreaM2, fillAreaM2 };
    previous = station;
    return station;
  });
  if (stations.some(station => [station.x, station.z, station.designElevationM].some(value => !Number.isFinite(value) || Math.abs(value) > 1e7))) warnings.push("The corridor surface exceeds its supported coordinate range and is hidden; reduce the study extent.");
  let cutM3 = 0, fillM3 = 0, maxGradePct = 0, minElevationM = Infinity, maxElevationM = -Infinity;
  stations.forEach((station, i) => {
    minElevationM = Math.min(minElevationM, station.elevationM); maxElevationM = Math.max(maxElevationM, station.elevationM);
    maxGradePct = Math.max(maxGradePct, Math.abs(station.gradePct));
    if (i) {
      const prior = stations[i - 1], length = station.stationM - prior.stationM;
      cutM3 += (station.cutAreaM2 + prior.cutAreaM2) / 2 * length;
      fillM3 += (station.fillAreaM2 + prior.fillAreaM2) / 2 * length;
    }
  });
  return {
    lengthM: stations[stations.length - 1]?.stationM ?? 0, stations, maxGradePct, minElevationM, maxElevationM,
    cutFill: { cutM3, fillM3, netM3: fillM3 - cutM3, sampledCells: stations.length * 12 },
    projectCrs: terrain.projectCrs || "LOCAL",
    peakRunoffM3s: civil.runoffCoefficient * civil.rainfallMmPerHour * civil.catchmentAreaHa / 360,
    warnings,
  };
}

const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function buildLandXml(infra: InfraDesign, projectName = "Groundwork Civil Model"): string {
  const terrain = terrainSettings(infra.terrain), report = analyzeCivilAlignment(infra), extent = infraExtent(infra);
  const triangles = terrainTriangles(extent.w, extent.d, terrain);
  const points: TerrainSample[] = [], ids = new Map<string, number>();
  const pointId = (p: TerrainSample) => {
    const key = `${p.x}:${p.z}:${p.elevationM}`;
    const existing = ids.get(key);
    if (existing) return existing;
    points.push(p); ids.set(key, points.length); return points.length;
  };
  const faces = triangles.map(t => `          <F>${pointId(t.a)} ${pointId(t.b)} ${pointId(t.c)}</F>`).join("\n");
  const coord = (p: { x: number; z: number }) => `${(p.z + (terrain.localOriginNorthing ?? 0)).toFixed(6)} ${(p.x + (terrain.localOriginEasting ?? 0)).toFixed(6)}`;
  const pnts = points.map((p, i) => `          <P id="${i + 1}">${coord(p)} ${p.elevationM.toFixed(6)}</P>`).join("\n");
  const lines = report.stations.slice(1).map((s, i) => {
    const a = report.stations[i];
    return `        <Line length="${(s.stationM - a.stationM).toFixed(6)}"><Start>${coord(a)}</Start><End>${coord(s)}</End></Line>`;
  }).join("\n");
  const profile = report.stations.map(s => `          <PVI>${s.stationM.toFixed(6)} ${s.designElevationM.toFixed(6)}</PVI>`).join("\n");
  const date = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${date.slice(0, 10)}" time="${date.slice(11, 19)}" language="English">
  <Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars"/></Units>
  <Project name="${xml(projectName)}"><Feature code="Groundwork"><Property label="ProjectCRS" value="${xml(terrain.projectCrs || "LOCAL")}"/></Feature></Project>
  <Surfaces><Surface name="Groundwork Terrain"><Definition surfType="TIN">
        <Pnts>
${pnts}
        </Pnts><Faces>
${faces}
        </Faces>
  </Definition></Surface></Surfaces>
  <Alignments name="Groundwork Alignments">
    <Alignment name="${xml(infra.kind)} alignment" length="${report.lengthM.toFixed(6)}" staStart="0">
      <CoordGeom>
${lines}
      </CoordGeom>
      <Profile name="Design profile"><ProfAlign name="${civilSettings(infra).profile ? "Station elevations" : "Constant grade"}">
${profile}
      </ProfAlign></Profile>
    </Alignment>
  </Alignments>
</LandXML>
`;
}

export function buildCivilReport(infra: InfraDesign): string {
  const r = analyzeCivilAlignment(infra), c = civilSettings(infra);
  return [
    "GROUNDWORK CIVIL / INFRASTRUCTURE PLANNING REPORT",
    `Project CRS: ${r.projectCrs}; coordinates are local metres plus the recorded survey origin.`,
    `Alignment length: ${r.lengthM.toFixed(1)} m; corridor width: ${c.corridorWidthM.toFixed(2)} m`,
    `Elevation range: ${r.minElevationM.toFixed(2)}–${r.maxElevationM.toFixed(2)} m`,
    `Maximum sampled ground grade: ${r.maxGradePct.toFixed(2)}%; design profile: ${c.profile ? "piecewise linear station elevations" : c.gradePct.toFixed(2) + "% constant grade"}`,
    `Cut: ${r.cutFill.cutM3.toFixed(1)} m3; fill: ${r.cutFill.fillM3.toFixed(1)} m3; net fill-cut: ${r.cutFill.netM3.toFixed(1)} m3`,
    "Volumes use average end areas across a fixed-width crowned corridor; no side slopes, shrinkage or bulking.",
    `Rational-method runoff: ${r.peakRunoffM3s.toFixed(3)} m3/s (C=${c.runoffCoefficient}, i=${c.rainfallMmPerHour} mm/h, A=${c.catchmentAreaHa} ha).`,
    "Drainage does not include routing, infiltration, time of concentration or pipe sizing.",
    ...r.warnings, "", "Station | Ground m | Design m | Grade % | Cut m2 | Fill m2",
    ...r.stations.map(s => `${s.stationM.toFixed(2)} | ${s.elevationM.toFixed(3)} | ${s.designElevationM.toFixed(3)} | ${s.gradePct.toFixed(2)} | ${s.cutAreaM2.toFixed(2)} | ${s.fillAreaM2.toFixed(2)}`),
  ].join("\n");
}

