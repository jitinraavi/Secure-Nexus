import type { WebGLRenderer } from "three";

export const SCENE_METRICS_EVENT = "groundwork:scene-metrics";
export interface SceneMetrics {
  scene: string;
  fps: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  sampledAt: number;
}

/** Renderer counters sampled once per second; these counts do not measure GPU bytes. */
export function sceneMetricsReporter(scene: string, renderer: WebGLRenderer) {
  let started = performance.now(), frames = 0;
  return () => {
    frames++;
    const ended = performance.now(), elapsed = ended - started;
    if (elapsed < 1000) return;
    const detail: SceneMetrics = {
      scene, fps: frames * 1000 / elapsed,
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
      sampledAt: Date.now(),
    };
    window.dispatchEvent(new CustomEvent<SceneMetrics>(SCENE_METRICS_EVENT, { detail }));
    started = ended; frames = 0;
  };
}
