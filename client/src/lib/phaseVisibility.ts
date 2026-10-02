import type { Object3D } from "three";
import type { VisualizationSettings } from "../types";
import { phaseVisible } from "./visualization";

/** Phase visibility belongs to the selectable root, not its geometry children. */
export function setScenePhase(node: Object3D, phaseId: string | undefined, visualization?: VisualizationSettings): void {
  node.userData.phaseControlled = true;
  node.userData.phaseId = phaseId;
  node.visible = !visualization || phaseVisible(phaseId, visualization);
}

/** Updates only stored phase roots, preserving layer filtering and LOD visibility. */
export function updateScenePhaseVisibility(root: Object3D, visualization?: VisualizationSettings): void {
  const visibleByPhase = new Map<string | undefined, boolean>();
  root.traverse(node => {
    if (node.userData.phaseControlled !== true && typeof node.userData.phaseId !== "string") return;
    const phaseId = typeof node.userData.phaseId === "string" ? node.userData.phaseId : undefined;
    let visible = visibleByPhase.get(phaseId);
    if (visible === undefined) {
      visible = !visualization || phaseVisible(phaseId, visualization);
      visibleByPhase.set(phaseId, visible);
    }
    node.visible = visible;
  });
}

/** Three.js raycasting can include hidden nodes; picking must check ancestors. */
export function isSceneObjectVisible(node: Object3D): boolean {
  let ancestor: Object3D | null = node;
  while (ancestor) {
    if (!ancestor.visible) return false;
    ancestor = ancestor.parent;
  }
  return true;
}
