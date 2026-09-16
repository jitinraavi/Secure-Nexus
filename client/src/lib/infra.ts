import * as THREE from "three";
import type { ProjectType } from "../types";

export const INFRA_TYPES: ProjectType[] = [
  "highway",
  "roadways",
  "airport",
  "ports",
  "dams",
  "spillways",
];

export function isInfraType(t: string | undefined | null): t is ProjectType {
  return INFRA_TYPES.includes(t as ProjectType);
}

export interface InfraParamDef {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

type ParamMap = Record<string, InfraParamDef[]>;

const LENGTH = { min: 20, max: 2000, step: 10, default: 400 };
const WIDTH = { min: 4, max: 120, step: 1, default: 24 };

export const INFRA_PARAMS: ParamMap = {
  highway: [
    { id: "length", label: "Carriageway length", unit: "m", ...LENGTH, default: 600 },
    { id: "lanes", label: "Lanes per direction", unit: "", min: 1, max: 5, step: 1, default: 2 },
    { id: "laneWidth", label: "Lane width", unit: "m", ...WIDTH, default: 3.5 },
    { id: "median", label: "Median width", unit: "m", min: 0, max: 12, step: 0.5, default: 2 },
    { id: "shoulder", label: "Shoulder width", unit: "m", min: 0, max: 6, step: 0.5, default: 1.5 },
  ],
  roadways: [
    { id: "length", label: "Road length", unit: "m", ...LENGTH, default: 500 },
    { id: "carriagewayWidth", label: "Carriageway width", unit: "m", ...WIDTH, default: 7 },
    { id: "camber", label: "Camber", unit: "%", min: 1, max: 5, step: 0.5, default: 2.5 },
    { id: "footpath", label: "Footpath width", unit: "m", min: 0, max: 5, step: 0.5, default: 1.5 },
    { id: "speedLimit", label: "Design speed", unit: "km/h", min: 20, max: 120, step: 10, default: 60 },
  ],
  airport: [
    { id: "runwayLength", label: "Runway length", unit: "m", min: 600, max: 4000, step: 50, default: 2750 },
    { id: "runwayWidth", label: "Runway width", unit: "m", min: 23, max: 60, step: 1, default: 45 },
    { id: "taxiwayWidth", label: "Taxiway width", unit: "m", min: 15, max: 30, step: 1, default: 23 },
    { id: "apronWidth", label: "Apron width", unit: "m", min: 40, max: 200, step: 5, default: 90 },
    { id: "terminals", label: "Terminal buildings", unit: "", min: 1, max: 3, step: 1, default: 1 },
  ],
  ports: [
    { id: "length", label: "Berth length", unit: "m", ...LENGTH, default: 300 },
    { id: "berths", label: "Berths", unit: "", min: 1, max: 8, step: 1, default: 2 },
    { id: "waterDepth", label: "Draft depth", unit: "m", min: 5, max: 25, step: 1, default: 12 },
    { id: "apronWidth", label: "Apron width", unit: "m", min: 20, max: 80, step: 5, default: 40 },
    { id: "storageArea", label: "Container yard depth", unit: "m", min: 100, max: 1500, step: 20, default: 500 },
  ],
  dams: [
    { id: "crestLength", label: "Crest length", unit: "m", ...LENGTH, default: 800 },
    { id: "height", label: "Dam height", unit: "m", min: 5, max: 200, step: 1, default: 60 },
    { id: "crestWidth", label: "Crest width", unit: "m", min: 4, max: 30, step: 1, default: 10 },
    { id: "baseWidth", label: "Base width", unit: "m", min: 20, max: 300, step: 5, default: 120 },
    { id: "reservoirLength", label: "Reservoir length", unit: "m", min: 100, max: 10000, step: 100, default: 2000 },
  ],
  spillways: [
    { id: "crestLength", label: "Crest length", unit: "m", ...LENGTH, default: 150 },
    { id: "gates", label: "Radial gates", unit: "", min: 1, max: 12, step: 1, default: 4 },
    { id: "gateWidth", label: "Gate width", unit: "m", min: 6, max: 30, step: 1, default: 12 },
    { id: "height", label: "Gate height", unit: "m", min: 4, max: 30, step: 1, default: 10 },
    { id: "chuteSlope", label: "Chute slope", unit: "°", min: 0, max: 45, step: 5, default: 20 },
  ],
};

export function infraParamDefs(type: ProjectType): InfraParamDef[] {
  return INFRA_PARAMS[type] ?? INFRA_PARAMS.highway;
}

export function defaultInfraParams(type: ProjectType): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of infraParamDefs(type)) out[def.id] = def.default;
  return out;
}

function box(mat: THREE.Material, w: number, h: number, d: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.noSelect = true;
  return mesh;
}

function ramp(mat: THREE.Material, bottomW: number, topW: number, h: number, d: number): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-bottomW / 2, 0);
  shape.lineTo(bottomW / 2, 0);
  shape.lineTo(topW / 2, h);
  shape.lineTo(-topW / 2, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, h / 2, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.noSelect = true;
  return mesh;
}

export function buildInfraMesh(
  type: ProjectType,
  params: Record<string, number>,
  siteW: number,
  siteD: number,
): THREE.Group {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: "#9aa3ad", roughness: 0.85 });
  const asphalt = new THREE.MeshStandardMaterial({ color: "#3b4148", roughness: 0.95 });
  const water = new THREE.MeshStandardMaterial({ color: "#2f6f9f", roughness: 0.25, transparent: true, opacity: 0.85 });
  const laneMarking = new THREE.MeshStandardMaterial({ color: "#e9eef2", roughness: 0.9 });
  const centreMarking = new THREE.MeshStandardMaterial({ color: "#f2c94c", roughness: 0.6 });
  const w = siteW;
  const d = siteD;

  switch (type) {
    case "highway": {
      const lanes = Math.round(params.lanes ?? 2);
      const laneW = params.laneWidth ?? 3.5;
      const median = params.median ?? 2;
      const shoulder = params.shoulder ?? 1.5;
      const roadW = lanes * 2 * laneW + median + shoulder * 2;
      const slab = box(asphalt, Math.min(roadW, w * 0.9), 0.35, d * 0.92);
      slab.position.y = 0.2;
      group.add(slab);
      const total = lanes * 2;
      for (let i = 0; i < total; i++) {
        const line = box(laneMarking, 0.18, 0.02, d * 0.9);
        line.position.set((i - (total - 1) / 2) * laneW, 0.42, 0);
        group.add(line);
      }
      if (median > 0) {
        const m = box(concrete, median, 0.45, d * 0.9);
        m.position.y = 0.25;
        group.add(m);
        const stripe = box(centreMarking, 0.25, 0.04, d * 0.9);
        stripe.position.y = 0.5;
        group.add(stripe);
      }
      break;
    }
    case "roadways": {
      const cw = params.carriagewayWidth ?? 7;
      const foot = params.footpath ?? 1.5;
      const slab = box(asphalt, Math.min(cw, w * 0.9), 0.4, d * 0.95);
      slab.position.y = 0.2;
      group.add(slab);
      const centreline = box(centreMarking, 0.18, 0.03, d * 0.85);
      centreline.position.y = 0.44;
      group.add(centreline);
      for (const side of [-1, 1]) {
        const f = box(concrete, foot, 0.5, d * 0.95);
        f.position.set(side * (cw / 2 + foot / 2), 0.25, 0);
        group.add(f);
      }
      break;
    }
    case "airport": {
      const runwayLen = Math.min(params.runwayLength ?? 2750, w * 0.92);
      const runwayW = Math.min(params.runwayWidth ?? 45, w * 0.7);
      const twW = params.taxiwayWidth ?? 23;
      const rw = box(asphalt, runwayW, 0.4, runwayLen);
      rw.position.y = 0.2;
      group.add(rw);
      const taxi = box(asphalt, twW, 0.35, runwayLen * 0.6);
      taxi.position.set(runwayW / 2 + twW / 2 + 4, 0.22, runwayLen * 0.1);
      group.add(taxi);
      const stripes = Math.max(2, Math.floor(runwayLen / 45));
      for (let i = 0; i < stripes; i++) {
        const s = box(centreMarking, runwayW * 0.02, 0.02, runwayLen * 0.3);
        s.position.set(0, 0.45, (i - (stripes - 1) / 2) * (runwayLen / stripes) * 0.6);
        group.add(s);
      }
      const terminals = Math.max(1, Math.min(Math.round(params.terminals ?? 1), 3));
      for (let i = 0; i < terminals; i++) {
        const t = box(concrete, 60, 18, 50);
        t.position.set(-runwayW / 2 - 70, 9, (i - (terminals - 1) / 2) * 80);
        group.add(t);
      }
      break;
    }
    case "ports": {
      const berths = Math.max(1, Math.round(params.berths ?? 2));
      const berthL = Math.min(params.length ?? 300, d * 0.9);
      const apron = Math.min(params.apronWidth ?? 40, w * 0.3);
      const quay = box(concrete, apron, 2.5, d * 0.95);
      quay.position.set(-w / 2 + apron / 2, 1.25, 0);
      group.add(quay);
      for (let i = 0; i < berths; i++) {
        const bollard = box(centreMarking, 1.2, 1.2, 1.2);
        bollard.position.set(-w / 2, 1.8, (i - (berths - 1) / 2) * (berthL / berths) * 0.8);
        group.add(bollard);
      }
      const sea = box(water, w * 0.55, 0.5, d * 0.98);
      sea.position.set(w / 4, 0.1, 0);
      group.add(sea);
      const yardD = Math.min(params.storageArea ?? 500, w * 0.4) * 0.5;
      const yard = box(asphalt, yardD, 0.3, d * 0.5);
      yard.position.set(0, 0.15, -d * 0.2);
      group.add(yard);
      break;
    }
    case "dams": {
      const crestL = Math.min(params.crestLength ?? 800, w * 0.9);
      const h = (params.height ?? 60) * 0.25;
      const crestW = params.crestWidth ?? 10;
      const baseW = Math.min(params.baseWidth ?? 120, w * 0.4);
      const body = ramp(concrete, baseW, crestW, h, crestL);
      body.position.z = 0;
      group.add(body);
      const crest = box(concrete, crestW, 2, crestL);
      crest.position.y = h + 1;
      group.add(crest);
      const lake = box(water, w * 0.45, 0.4, d * 0.95);
      lake.position.set(-w * 0.15, 0.1, 0);
      group.add(lake);
      break;
    }
    case "spillways": {
      const crestL = Math.min(params.crestLength ?? 150, w * 0.9);
      const gates = Math.max(1, Math.round(params.gates ?? 4));
      const gateW = Math.min(params.gateWidth ?? 12, crestL / gates);
      const gateH = Math.min(params.height ?? 10, d * 0.25);
      const chuteSlope = params.chuteSlope ?? 20;
      const base = box(concrete, crestL * 1.1, 0.5, gateH * 2.2);
      base.position.y = 0.25;
      group.add(base);
      for (let i = 0; i < gates; i++) {
        const opening = gateW * 0.8;
        const pillar = box(concrete, (crestL / gates - opening) * 0.6, gateH + 0.5, gateH * 0.4);
        pillar.position.set(
          (i - (gates - 1) / 2) * (crestL / gates),
          gateH / 2 + 0.5,
          0,
        );
        group.add(pillar);
        const gate = box(centreMarking, opening, gateH, gateH * 0.12);
        gate.position.set(
          (i - (gates - 1) / 2) * (crestL / gates),
          gateH / 2 + 0.5,
          0,
        );
        gate.visible = false;
        group.add(gate);
      }
      const chuteLen = gateH * (2 + chuteSlope * 0.02);
      const chute = box(asphalt, crestL, 0.4, chuteLen);
      chute.position.set(0, 0.2, chuteLen * 0.45);
      group.add(chute);
      break;
    }
  }
  return group;
}

export function infraSummary(type: ProjectType, params: Record<string, number>): string {
  const defs = infraParamDefs(type);
  return defs.map((d) => `${d.label}: ${params[d.id] ?? d.default}${d.unit}`).join(" · ");
}

export function buildInfraDxf(type: ProjectType, params: Record<string, number>): string {
  const defs = infraParamDefs(type);
  const L: string[] = [
    "0\nSECTION\n2\nENTITIES\n",
    `0\nTEXT\n  8\nTITLE\n 10\n50\n 20\n190\n 30\n0\n  1\n${type.toUpperCase()} — SPECIFICATION DRAWING (mm)\n 40\n25\n0\nSEQEND\n`,
  ];
  let handle = 0x100;
  for (const def of defs) {
    const val = params[def.id] ?? def.default;
    L.push(
      `0\nTEXT\n  5\n${handle++}\n  8\nPARAMS\n 10\n50\n 20\n${(160 - defs.indexOf(def) * 25).toFixed(1)}\n 30\n0\n  1\n${def.label}: ${val}${def.unit}\n 40\n18\n0\nSEQEND\n`,
    );
  }
  L.push("0\nENDSEC\n0\nEOF\n");
  return L.join("");
}

export function buildInfraCsv(type: ProjectType, params: Record<string, number>): string {
  const defs = infraParamDefs(type);
  const rows: string[] = ["Project type,Parameter,Value,Unit"];
  for (const def of defs) {
    rows.push(`${type},"${def.label}","${params[def.id] ?? def.default}","${def.unit}"`);
  }
  return rows.join("\r\n");
}