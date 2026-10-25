import * as THREE from "three";
import type { Design } from "../types";
import { cadLevels, cadObjects } from "./cadModel";
import { cadMep, cadNetworkState } from "./cadNetworks";
import { cadObjectGeometry, cadMepGeometry, disposeCadObject } from "./cadViewportGeometry";
import type { GeometryMesh, GeometryScene } from "./meshGeometry";

/** The same authored solids used for viewport/export, including hidden objects. */
export function cadCoordinationScene(design: Design): GeometryScene {
  const meshes: GeometryMesh[] = []; let triangles = 0;
  const append = (root: THREE.Group, sourceId: string) => {
    try {
      root.updateMatrixWorld(true);
      root.traverse(node => {
        if (!(node instanceof THREE.Mesh) || node.userData.cadDecoration) return;
        const attribute = node.geometry.getAttribute("position"), index = node.geometry.getIndex();
        if (!attribute) return;
        const indices: number[] = index ? Array.from(index.array as ArrayLike<number>) : Array.from({ length: attribute.count }, (_, i) => i);
        triangles += indices.length / 3;
        if (triangles > 150000 || meshes.length >= 10000) throw new Error("Coordination subset exceeds 150,000 triangles / 10,000 meshes. Review a smaller authored subset in the geometry workbench.");
        const positions: number[] = [], point = new THREE.Vector3();
        for (let i = 0; i < attribute.count; i++) { point.fromBufferAttribute(attribute, i).applyMatrix4(node.matrixWorld); positions.push(point.x, point.y, point.z); }
        meshes.push({ id: `${sourceId}:${meshes.length}`, sourceId, positions, indices, material: { color: [.6,.65,.7], emission: [0,0,0], model: "diffuse", ior: 1.5 } });
      });
    } finally { disposeCadObject(root); }
  };
  for (const object of cadObjects(design)) if (["wall", "column", "beam", "slab", "roof"].includes(object.kind)) append(cadObjectGeometry(object, cadLevels(design)), object.id);
  const orientations = new Map(cadNetworkState(design).equipment.map(item => [item.elementId, item.mountingRotationDeg ?? 0]));
  for (const object of cadMep(design).elements) append(cadMepGeometry(object, orientations.get(object.id) ?? 0), object.id);
  return { version: 1, units: "m", meshes, camera: { position: [10,10,10], target: [0,0,0], up: [0,1,0], fov: 45 }, warnings: ["Authored CAD solids and nominal MEP geometry only; generated building/room context, fabrication details and service clearances are excluded.", "A mesh intersection is a coordination finding, not permission to cut a member or a code-compliance assessment."] };
}
