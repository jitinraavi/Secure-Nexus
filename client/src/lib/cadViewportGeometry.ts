import * as THREE from "three";
import type { BuildingLevel, DraftElement, MepElement } from "../types";
import { resolveDraft } from "./parametric";

export type CadAxis = "x" | "y" | "z";
export const localCadAxis = (axis: CadAxis, rotationDeg: number) => new THREE.Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationDeg * Math.PI / 180);
/** Closest point on a model axis to a camera ray. Near-parallel axes require numeric entry. */
export function rayAxisParameter(ray: THREE.Ray, origin: THREE.Vector3, axis: THREE.Vector3): number | null {
  const direction = axis.clone().normalize(), rayDirection = ray.direction.clone().normalize();
  const cosine = direction.dot(rayDirection), denominator = 1 - cosine * cosine;
  if (denominator < 0.003) return null;
  const delta = ray.origin.clone().sub(origin);
  return (direction.dot(delta) - cosine * rayDirection.dot(delta)) / denominator;
}
export function cadObjectGeometry(draft: DraftElement, levels: BuildingLevel[] = []): THREE.Group {
  const r = resolveDraft(draft, levels), group = new THREE.Group();
  group.position.set(draft.x, r.elevation, draft.z); group.rotation.y = draft.rotationDeg * Math.PI / 180;
  group.name = draft.label ?? `${draft.kind}-${draft.id}`; group.userData.cadId = draft.id;
  const material = new THREE.MeshStandardMaterial({ color: draft.color, roughness: .78, metalness: .04, side: THREE.DoubleSide });
  const box = (width: number, height: number, depth: number, x = 0, y = height / 2, z = 0) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material); mesh.position.set(x, y, z); mesh.castShadow = false; mesh.receiveShadow = true; group.add(mesh); };
  if (draft.kind === "column" && draft.family?.type === "circular-column") {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r.width / 2, r.width / 2, r.height, 64), material); mesh.position.y = r.height / 2; group.add(mesh);
  } else if (draft.kind === "wall" && draft.openings?.length) {
    // Rectangular through-openings are represented by disjoint wall cells, not a cosmetic overlay.
    const xs = new Set([-r.width / 2, r.width / 2]), ys = new Set([0, r.height]);
    for (const opening of draft.openings) { xs.add(opening.offsetM - opening.widthM / 2); xs.add(opening.offsetM + opening.widthM / 2); ys.add(opening.sillM); ys.add(opening.sillM + opening.heightM); }
    const x = [...xs].sort((a, b) => a - b), y = [...ys].sort((a, b) => a - b);
    for (let i = 0; i < x.length - 1; i++) for (let j = 0; j < y.length - 1; j++) {
      const cx = (x[i] + x[i + 1]) / 2, cy = (y[j] + y[j + 1]) / 2;
      if (cx < -r.width / 2 || cx > r.width / 2 || cy < 0 || cy > r.height) continue;
      if (draft.openings.some(opening => Math.abs(cx - opening.offsetM) < opening.widthM / 2 && cy > opening.sillM && cy < opening.sillM + opening.heightM)) continue;
      box(x[i + 1] - x[i], y[j + 1] - y[j], r.depth, cx, cy);
    }
  } else if (["line", "dimension", "polyline", "spline", "arc", "circle", "rectangle"].includes(draft.kind)) {
    let points: THREE.Vector3[];
    if (draft.points?.length) points = draft.points.map(point => new THREE.Vector3(point.x, .01, point.z));
    else if (draft.kind === "circle" || draft.kind === "arc") { const radius = draft.radiusM ?? r.width / 2, start = (draft.startAngleDeg ?? 0) * Math.PI / 180, end = (draft.endAngleDeg ?? 360) * Math.PI / 180; points = Array.from({ length: 65 }, (_, index) => new THREE.Vector3(Math.cos(start + (end - start) * index / 64) * radius, .01, Math.sin(start + (end - start) * index / 64) * radius)); }
    else if (draft.kind === "rectangle") points = [[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]].map(([x, z]) => new THREE.Vector3(x * r.width / 2, .01, z * r.depth / 2));
    else points = [new THREE.Vector3(-r.width / 2, .01, 0), new THREE.Vector3(r.width / 2, .01, 0)];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: draft.color })); group.add(line); material.dispose();
  } else if ((draft.kind === "slab" || draft.kind === "roof") && draft.points && draft.points.length >= 3) {
    const shape = new THREE.Shape(draft.points.map(point => new THREE.Vector2(point.x, -point.z)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: r.height, bevelEnabled: false }); geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material); group.add(mesh);
  } else {
    box(r.width, r.height, r.depth);
    if (draft.kind === "roof" && r.slope) group.children[0].rotation.x = Math.atan(r.slope / 100);
  }
  group.traverse(node => { if (node instanceof THREE.Mesh) { const edge = new THREE.LineSegments(new THREE.EdgesGeometry(node.geometry, 24), new THREE.LineBasicMaterial({ color: "#293c48", transparent: true, opacity: .72 })); edge.userData.cadEdge = true; node.add(edge); } });
  return group;
}

export function cadMepGeometry(element: MepElement, mountingRotationDeg = 0): THREE.Group {
  const group = new THREE.Group(); group.userData.cadId = element.id; group.name = element.name;
  const radius = Math.max(element.diameter / 2, .012), color = element.color || "#66b6d4";
  const material = new THREE.MeshStandardMaterial({ color, roughness: .65 });
  const route = element.route.map(point => new THREE.Vector3(point.x, point.y, point.z));
  if (route.length === 1 || ["fixture", "equipment"].includes(element.kind)) {
    const type = element.family?.type ?? "";
    const shape = type.includes("light") || type.includes("junction") ? new THREE.CylinderGeometry(.12, .12, .07, 24) : new THREE.BoxGeometry(Math.max(element.width, .16), Math.max(element.height, .16), Math.max(element.diameter, .12));
    const mesh = new THREE.Mesh(shape, material); if (route[0]) mesh.position.copy(route[0]);mesh.rotation.y=mountingRotationDeg*Math.PI/180; group.add(mesh);
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.14,0,-.14),new THREE.Vector3(.14,0,-.14),new THREE.Vector3(.14,0,.14),new THREE.Vector3(-.14,0,.14)]),new THREE.LineBasicMaterial({color})); ring.position.copy(route[0] ?? new THREE.Vector3());ring.rotation.y=mountingRotationDeg*Math.PI/180; group.add(ring);
  } else for (let index = 1; index < route.length; index++) {
    const direction = route[index].clone().sub(route[index - 1]), length = direction.length(); if (length < .000001) continue;
    const rectangular = element.kind==="duct"||element.kind==="cable-tray"&&!["cable","conduit"].includes(element.family?.type??"");
    const geometry = rectangular ? new THREE.BoxGeometry(Math.max(element.width, .025), length, Math.max(element.height, .025)) : new THREE.CylinderGeometry(radius, radius, length, 16);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.copy(route[index]).add(route[index - 1]).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), direction.normalize()); group.add(mesh);
  }
  return group;
}
export function disposeCadObject(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  object.traverse(child => { if (child instanceof THREE.Mesh || child instanceof THREE.Line) { geometries.add(child.geometry); for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material); } });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); object.removeFromParent();
}
