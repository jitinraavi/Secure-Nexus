import type { CivilSettings, InfraDesign, SiteLocation, TerrainSample } from "../types";
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
export function civilSettings(infra: InfraDesign): CivilSettings {
  const v = infra.civil;
  return {
    stationIntervalM: Math.min(1000, Math.max(1, finite(v?.stationIntervalM, 25))),
    corridorWidthM: Math.min(500, Math.max(1, finite(v?.corridorWidthM, 12))),
    startElevationM: finite(v?.startElevationM, terrainSettings(infra.terrain).baseElevationM),
    gradePct: Math.min(30, Math.max(-30, finite(v?.gradePct, 0))),
    crossfallPct: Math.min(20, Math.max(-20, finite(v?.crossfallPct, 2))),
    rainfallMmPerHour: Math.max(0, finite(v?.rainfallMmPerHour, 50)),
    runoffCoefficient: Math.min(1, Math.max(0, finite(v?.runoffCoefficient, 0.7))),
    catchmentAreaHa: Math.max(0, finite(v?.catchmentAreaHa, 1)),
  };
}

function localRoute(location?: SiteLocation): { x: number; z: number }[] {
  const route = (location?.route ?? []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
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
  if (route.length < 2) warnings.push("No traced alignment: using a straight local fallback.");
  if (interval > civil.stationIntervalM && intervalM === undefined) warnings.push("Station interval increased to limit regular sampling to 2,000 stations.");
  if (terrain.source !== "survey") warnings.push("Terrain is procedural. Quantities are planning estimates.");
  if (terrain.source === "survey") warnings.push("Sampling outside the survey convex hull uses IDW extrapolation.");
  warnings.push("Straight horizontal segments and a constant design grade; no spiral or vertical-curve design.");
  let previous: CivilStation | undefined;
  const stations = sampled.map((point, i): CivilStation => {
    const elevationM = terrainElevation(point.x, point.z, terrain);
    const gradePct = previous && point.distance > previous.stationM ? (elevationM - previous.elevationM) / (point.distance - previous.stationM) * 100 : 0;
    const a = sampled[Math.max(0, i - 1)], b = sampled[Math.min(sampled.length - 1, i + 1)];
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
    const designElevationM = civil.startElevationM + point.distance * civil.gradePct / 100;
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
      <Profile name="Design profile"><ProfAlign name="Constant grade">
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
    `Maximum sampled ground grade: ${r.maxGradePct.toFixed(2)}%; design grade: ${c.gradePct.toFixed(2)}%`,
    `Cut: ${r.cutFill.cutM3.toFixed(1)} m3; fill: ${r.cutFill.fillM3.toFixed(1)} m3; net fill-cut: ${r.cutFill.netM3.toFixed(1)} m3`,
    "Volumes use average end areas across a fixed-width crowned corridor; no side slopes, shrinkage or bulking.",
    `Rational-method runoff: ${r.peakRunoffM3s.toFixed(3)} m3/s (C=${c.runoffCoefficient}, i=${c.rainfallMmPerHour} mm/h, A=${c.catchmentAreaHa} ha).`,
    "Drainage does not include routing, infiltration, time of concentration or pipe sizing.",
    ...r.warnings, "", "Station | Ground m | Design m | Grade % | Cut m2 | Fill m2",
    ...r.stations.map(s => `${s.stationM.toFixed(2)} | ${s.elevationM.toFixed(3)} | ${s.designElevationM.toFixed(3)} | ${s.gradePct.toFixed(2)} | ${s.cutAreaM2.toFixed(2)} | ${s.fillAreaM2.toFixed(2)}`),
  ].join("\n");
}

