import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  GeometryChunkCache,
  disposeGeometryGroup,
  geometryGroup,
  sceneAllocationBytes,
  selectGeometryChunks,
  type GeometryManifest,
} from "../lib/geometryPipeline";
import type { GeometryScene } from "../lib/meshGeometry";

export type QualityPreset = "performance" | "balanced" | "fidelity";

const PRESET_BASE_ERROR: Record<QualityPreset, number> = {
  performance: 6.0,
  balanced: 3.0,
  fidelity: 1.5,
};

export function StreamingGeometryViewport({
  scene,
  manifest,
  sourceCamera,
}: {
  scene: GeometryScene | null;
  manifest: GeometryManifest | null;
  sourceCamera?: GeometryScene["camera"];
}) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [quality, setQuality] = useState<QualityPreset>("balanced");
  const [adaptiveLevel, setAdaptiveLevel] = useState<number>(1);
  const qualityRef = useRef<QualityPreset>("balanced");
  qualityRef.current = quality;

  useEffect(() => {
    const element = host.current;
    if (!element || (!scene && !manifest)) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    } catch {
      setError("WebGL is unavailable.");
      return;
    }
    setError("");
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    element.appendChild(renderer.domElement);

    const world = new THREE.Scene();
    world.background = new THREE.Color(0x101827);

    const view = scene?.camera ?? sourceCamera;
    const camera = new THREE.PerspectiveCamera(view?.fov ?? 50, 1, 0.01, 1e8);
    camera.position.fromArray(view?.position ?? [100, 100, 100]);
    camera.up.fromArray(view?.up ?? [0, 1, 0]);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.fromArray(view?.target ?? [0, 0, 0]);
    controls.enableDamping = true;

    if (!scene && !view && manifest?.chunks.length) {
      const box = new THREE.Box3().makeEmpty();
      for (const id of manifest.roots) {
        const c = manifest.chunks.find((item) => item.id === id)!;
        if (c) box.union(new THREE.Box3(new THREE.Vector3(...c.bounds.min), new THREE.Vector3(...c.bounds.max)));
      }
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(size, size, size));
    }

    world.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(100, 200, 100);
    world.add(light);

    const loaded = new Map<string, THREE.Group>();
    const cache = new GeometryChunkCache();
    let ended = false;
    let pending = false;
    let frame = 0;
    let requested = "";
    let failedUntil = 0;
    let lastSample = performance.now();
    let frames = 0;
    let lastUpdate = 0;
    let currentAdaptiveScale = 1.0;
    const controller = new AbortController();

    if (scene) {
      const group = geometryGroup(scene);
      world.add(group);
      loaded.set("local", group);
    }

    const resize = new ResizeObserver(() => {
      const w = element.clientWidth || 1;
      const h = element.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(element);

    const stream = async () => {
      if (!manifest || pending || ended || performance.now() < failedUntil) return;

      const baseError = PRESET_BASE_ERROR[qualityRef.current];
      let effectiveError = Math.max(0.5, baseError * currentAdaptiveScale);

      // Select chunks with adaptive fallback if triangle budget is exceeded
      let chosen = selectGeometryChunks(manifest, camera, element.clientHeight || 400, effectiveError);
      let attempts = 0;

      while (attempts < 3) {
        // Pre-check triangle estimate using chunk bounds & hierarchy
        const candidateKey = JSON.stringify(chosen.map((c) => c.id).sort());
        if (candidateKey === requested) return;
        break;
      }

      pending = true;
      try {
        let successfulLoad = false;
        let scale = currentAdaptiveScale;

        // Adaptive loop: if triangle count exceeds 1M, step up errorPixels to load coarser LODs
        while (!successfulLoad && attempts < 4 && !ended) {
          const targetError = Math.max(0.5, baseError * scale);
          chosen = selectGeometryChunks(manifest, camera, element.clientHeight || 400, targetError);
          const pinned = new Set(chosen.map((c) => c.id));
          const additions = new Map<string, THREE.Group>();
          let triangleCount = 0;
          let budgetExceeded = false;

          try {
            for (const chunk of chosen) {
              const data = await cache.load(chunk, controller.signal, pinned);
              const chunkTriangles = data.meshes.reduce((sum, m) => sum + m.indices.length / 3, 0);
              triangleCount += chunkTriangles;
              if (triangleCount > 1_000_000) {
                budgetExceeded = true;
                break;
              }
              if (!loaded.has(chunk.id)) additions.set(chunk.id, geometryGroup(data));
            }
          } catch (failure) {
            for (const group of additions.values()) disposeGeometryGroup(group);
            throw failure;
          }

          if (budgetExceeded) {
            for (const group of additions.values()) disposeGeometryGroup(group);
            scale *= 1.6; // Coarsen LOD
            attempts++;
            continue;
          }

          if (ended) {
            for (const group of additions.values()) disposeGeometryGroup(group);
            return;
          }

          for (const [id, group] of additions) {
            world.add(group);
            loaded.set(id, group);
          }
          for (const [id, group] of loaded) {
            if (!pinned.has(id)) {
              world.remove(group);
              disposeGeometryGroup(group);
              loaded.delete(id);
            }
          }

          currentAdaptiveScale = scale;
          setAdaptiveLevel(Number(scale.toFixed(1)));
          requested = JSON.stringify(chosen.map((c) => c.id).sort());
          setError("");
          successfulLoad = true;
        }
      } catch (failure) {
        failedUntil = performance.now() + 5000;
        if (!ended) setError(failure instanceof Error ? failure.message : "Streaming failed.");
      } finally {
        pending = false;
      }
    };

    const render = () => {
      if (ended) return;
      frame = requestAnimationFrame(render);
      controls.update();
      renderer.render(world, camera);
      frames++;

      const now = performance.now();
      if (now - lastUpdate > 500) {
        lastUpdate = now;
        void stream();
      }

      if (now - lastSample >= 1000) {
        const fps = (frames * 1000) / (now - lastSample);
        const allocation = sceneAllocationBytes(world);

        // Dynamically adjust adaptive scale if framerate drops severely
        if (fps < 24 && currentAdaptiveScale < 3.0) {
          currentAdaptiveScale = Math.min(4.0, currentAdaptiveScale * 1.25);
        } else if (fps > 55 && currentAdaptiveScale > 1.0) {
          currentAdaptiveScale = Math.max(1.0, currentAdaptiveScale * 0.9);
        }

        setStatus(
          `${fps.toFixed(1)} FPS · ${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} triangles · ${(
            allocation.geometryBytes / 1048576
          ).toFixed(1)} MiB buffers · ${(cache.bytes / 1048576).toFixed(1)} MiB cache`,
        );
        frames = 0;
        lastSample = now;
      }
    };

    render();

    return () => {
      ended = true;
      controller.abort();
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      for (const group of loaded.values()) disposeGeometryGroup(group);
      cache.clear();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [scene, manifest, sourceCamera]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <div ref={host} className="h-96 w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-950" />
        {/* Interactive LOD Quality Controls */}
        <div className="absolute top-3 right-3 flex items-center space-x-1 rounded-lg border border-slate-700/80 bg-slate-900/90 p-1 text-xs backdrop-blur">
          <button
            type="button"
            onClick={() => setQuality("performance")}
            className={`rounded px-2 py-0.5 font-medium transition ${
              quality === "performance" ? "bg-amber-500/20 text-amber-300" : "text-slate-400 hover:text-slate-200"
            }`}
            title="Fastest rendering, coarsest level of detail"
          >
            ⚡ Performance
          </button>
          <button
            type="button"
            onClick={() => setQuality("balanced")}
            className={`rounded px-2 py-0.5 font-medium transition ${
              quality === "balanced" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-slate-200"
            }`}
            title="Balanced fidelity and frame rate (default)"
          >
            ⚖️ Balanced
          </button>
          <button
            type="button"
            onClick={() => setQuality("fidelity")}
            className={`rounded px-2 py-0.5 font-medium transition ${
              quality === "fidelity" ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400 hover:text-slate-200"
            }`}
            title="Maximum geometric detail"
          >
            💎 Ultra
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <p>{status}</p>
        {adaptiveLevel > 1 && (
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-cyan-400">
            Adaptive LOD: ×{adaptiveLevel} Coarsening
          </span>
        )}
      </div>
      {error && (
        <p role="status" className="text-sm text-amber-300">
          {error}
        </p>
      )}
    </div>
  );
}
