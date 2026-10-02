import type { InfraDesign, SiteLocation, TerrainSettings } from "../types";
import { centroid, toLocalMetres } from "./geo";
import { estimateCutFill, terrainElevation, terrainSettings } from "./terrain";

export interface CivilStation {
  stationM: number;
  x: number;
  z: number;
  elevationM: number;
  gradePct: number;
}

export interface CivilAlignmentReport {
  lengthM: number;
  stations: CivilStation[];
  maxGradePct: number;
  minElevationM: number;
  maxElevationM: number;
  cutFill: ReturnType<typeof estimateCutFill>;
  projectCrs: string;
}

function localRoute(location?: SiteLocation): { x: number; z: number }[] {
  const route = location?.route ?? [];
  if (!route.length) return [];
  const origin = centroid(route);
  return route.map((point) => {
    const local = toLocalMetres(point, origin);
    return { x: local.x, z: local.y };
  });
}

function samplePolyline(points: { x: number; z: number }[], intervalM: number): { distance: number; x: number; z: number }[] {
  if (!points.length) return [];
  if (points.length === 1) return [{ distance: 0, ...points[0] }];
  const segments: { a: { x: number; z: number }; b: { x: number; z: number }; start: number; length: number }[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    segments.push({ a, b, start: total, length });
    total += length;
  }
  const samples: { distance: number; x: number; z: number }[] = [];
  for (let distance = 0; distance < total; distance += Math.max(intervalM, 1)) {
    const segment = segments.find((item) => distance <= item.start + item.length) ?? segments[segments.length - 1];
    const t = segment.length ? (distance - segment.start) / segment.length : 0;
    samples.push({ distance, x: segment.a.x + (segment.b.x - segment.a.x) * t, z: segment.a.z + (segment.b.z - segment.a.z) * t });
  }
  samples.push({ distance: total, ...points[points.length - 1] });
  return samples;
}

export function analyzeCivilAlignment(infra: InfraDesign, intervalM = 25): CivilAlignmentReport {
  const terrain = terrainSettings(infra.terrain);
  const route = localRoute(infra.location);
  const fallbackLength = infra.kind === "highway" ? infra.highway?.runwayLengthM : undefined;
  const points = route.length >= 2 ? route : [
    { x: -Math.max(infra.location?.routeLengthM ?? fallbackLength ?? 500, 10) / 2, z: 0 },
    { x: Math.max(infra.location?.routeLengthM ?? fallbackLength ?? 500, 10) / 2, z: 0 },
  ];
  const sampled = samplePolyline(points, intervalM);
  let previous: { distance: number; elevationM: number } | null = null;
  const stations = sampled.map((point) => {
    const elevationM = terrainElevation(point.x, point.z, terrain);
    const gradePct = previous && point.distance > previous.distance ? ((elevationM - previous.elevationM) / (point.distance - previous.distance)) * 100 : 0;
    previous = { distance: point.distance, elevationM };
    return { stationM: point.distance, x: point.x, z: point.z, elevationM, gradePct };
  });
  const elevations = stations.map((station) => station.elevationM);
  const extentW = Math.max(...points.map((point) => point.x), 0) - Math.min(...points.map((point) => point.x), 0) || 100;
  const extentD = Math.max(...points.map((point) => point.z), 0) - Math.min(...points.map((point) => point.z), 0) || 50;
  const designElevation = elevations.length ? elevations.reduce((sum, value) => sum + value, 0) / elevations.length : terrain.baseElevationM;
  return {
    lengthM: stations.at(-1)?.stationM ?? 0,
    stations,
    maxGradePct: Math.max(0, ...stations.map((station) => Math.abs(station.gradePct))),
    minElevationM: elevations.length ? Math.min(...elevations) : terrain.baseElevationM,
    maxElevationM: elevations.length ? Math.max(...elevations) : terrain.baseElevationM,
    cutFill: estimateCutFill(Math.max(extentW, 10), Math.max(extentD, 10), terrain, designElevation),
    projectCrs: terrain.projectCrs || "LOCAL",
  };
}

const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildLandXml(infra: InfraDesign, projectName = "Groundwork Civil Model"): string {
  const terrain = terrainSettings(infra.terrain);
  const report = analyzeCivilAlignment(infra);
  const samples = terrain.samples ?? [];
  const points = samples.length ? samples : report.stations.map((station) => ({ x: station.x, z: station.z, elevationM: station.elevationM }));
  const pnts = points.map((point, index) => `        <P id="${index + 1}">${point.z.toFixed(3)} ${point.x.toFixed(3)} ${point.elevationM.toFixed(3)}</P>`).join("\n");
  const faces = points.length >= 3 ? Array.from({ length: points.length - 2 }, (_, index) => `        <F>1 ${index + 2} ${index + 3}</F>`).join("\n") : "";
  const coords = report.stations.map((station) => `        <CoordGeom><Line length="${Math.max(0, station.stationM).toFixed(3)}"><Start>${station.z.toFixed(3)} ${station.x.toFixed(3)}</Start><End>${station.z.toFixed(3)} ${station.x.toFixed(3)}</End></Line></CoordGeom>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${new Date().toISOString().slice(0, 10)}" time="${new Date().toISOString().slice(11, 19)}" language="English">
  <Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars"/></Units>
  <Project name="${xml(projectName)}"><Feature code="Groundwork"><Property label="ProjectCRS" value="${xml(terrain.projectCrs || "LOCAL")}"/></Feature></Project>
  <Surfaces>
    <Surface name="Groundwork Terrain">
      <Definition surfType="TIN">
        <Pnts>
${pnts}
        </Pnts>
        <Faces>
${faces}
        </Faces>
      </Definition>
    </Surface>
  </Surfaces>
  <Alignments name="Groundwork Alignments">
    <Alignment name="${xml(infra.kind)} alignment" length="${report.lengthM.toFixed(3)}">
${coords}
    </Alignment>
  </Alignments>
</LandXML>
`;
}

export function buildCivilReport(infra: InfraDesign): string {
  const report = analyzeCivilAlignment(infra);
  return [
    "GROUNDWORK CIVIL / INFRASTRUCTURE PLANNING REPORT",
    "Survey, hydraulic, geotechnical and jurisdiction-specific verification remain required.",
    `Project CRS: ${report.projectCrs}`,
    `Alignment length: ${report.lengthM.toFixed(1)} m`,
    `Elevation range: ${report.minElevationM.toFixed(2)}–${report.maxElevationM.toFixed(2)} m`,
    `Maximum sampled grade: ${report.maxGradePct.toFixed(2)}%`,
    `Cut: ${report.cutFill.cutM3.toFixed(0)} m3`,
    `Fill: ${report.cutFill.fillM3.toFixed(0)} m3`,
    `Net fill-cut: ${report.cutFill.netM3.toFixed(0)} m3`,
    "",
    "Station profile:",
    ...report.stations.map((station) => `STA ${station.stationM.toFixed(0).padStart(6, "0")} | ELEV ${station.elevationM.toFixed(3)} m | GRADE ${station.gradePct.toFixed(2)}%`),
  ].join("\n");
}
