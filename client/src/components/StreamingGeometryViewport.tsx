import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GeometryChunkCache, disposeGeometryGroup, geometryGroup, sceneAllocationBytes, selectGeometryChunks, type GeometryManifest } from "../lib/geometryPipeline";
import type { GeometryScene } from "../lib/meshGeometry";

export function StreamingGeometryViewport({ scene, manifest }: { scene: GeometryScene | null; manifest: GeometryManifest | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    const element = host.current; if (!element || (!scene && !manifest)) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { setError("WebGL is unavailable."); return; }
    setError("");
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); element.appendChild(renderer.domElement);
    const world = new THREE.Scene(); world.background = new THREE.Color(0x101827);
    const camera = new THREE.PerspectiveCamera(scene?.camera.fov ?? 50, 1, 0.01, 1e8);
    camera.position.fromArray(scene?.camera.position ?? [100, 100, 100]); camera.up.fromArray(scene?.camera.up ?? [0, 1, 0]);
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.fromArray(scene?.camera.target ?? [0, 0, 0]); controls.enableDamping = true;
    if (!scene && manifest?.chunks.length) { const box = new THREE.Box3().makeEmpty(); for (const id of manifest.roots) { const c = manifest.chunks.find(c => c.id === id)!; box.union(new THREE.Box3(new THREE.Vector3(...c.bounds.min), new THREE.Vector3(...c.bounds.max))); } const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length(); controls.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(size, size, size)); }
    world.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2)); const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(100, 200, 100); world.add(light);
    const loaded = new Map<string, THREE.Group>(), cache = new GeometryChunkCache(); let ended = false, pending = false, frame = 0, requested = "", lastSample = performance.now(), frames = 0, lastUpdate = 0;
    const controller = new AbortController();
    if (scene) { const group = geometryGroup(scene); world.add(group); loaded.set("local", group); }
    const resize = new ResizeObserver(() => { const w = element.clientWidth || 1, h = element.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }); resize.observe(element);
    const stream = async () => {
      if (!manifest || pending || ended) return;
      const chosen = selectGeometryChunks(manifest, camera, element.clientHeight || 400), key = JSON.stringify(chosen.map(c => c.id).sort()); if (key === requested) return;
      pending = true;
      try {
        const pinned = new Set(chosen.map(c => c.id)), additions = new Map<string, THREE.Group>(); let triangleCount = 0;
        // Load first; commit visibility atomically to retain the previous valid view on a failure.
        try { for (const chunk of chosen) { const data = await cache.load(chunk, controller.signal, pinned); triangleCount += data.meshes.reduce((sum, m) => sum + m.indices.length / 3, 0); if (triangleCount > 1_000_000) throw new Error("Visible selection exceeds one million triangles. Increase geometric-error levels in the manifest."); if (!loaded.has(chunk.id)) additions.set(chunk.id, geometryGroup(data)); } }
        catch (failure) { for (const group of additions.values()) disposeGeometryGroup(group); throw failure; }
        if (ended) { for (const group of additions.values()) disposeGeometryGroup(group); return; }
        for (const [id, group] of additions) { world.add(group); loaded.set(id, group); }
        for (const [id, group] of loaded) if (!pinned.has(id)) { world.remove(group); disposeGeometryGroup(group); loaded.delete(id); }
        requested = key; setError("");
      } catch (failure) { if (!ended) setError(failure instanceof Error ? failure.message : "Streaming failed."); }
      finally { pending = false; }
    };
    const render = () => {
      if (ended) return; frame = requestAnimationFrame(render); controls.update(); renderer.render(world, camera); frames++;
      const now = performance.now(); if (now - lastUpdate > 500) { lastUpdate = now; void stream(); }
      if (now - lastSample >= 1000) { const allocation = sceneAllocationBytes(world); setStatus(`${(frames * 1000 / (now - lastSample)).toFixed(1)} FPS · ${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} triangles · ${(allocation.geometryBytes / 1048576).toFixed(1)} MiB buffers · ${(cache.bytes / 1048576).toFixed(1)} MiB decoded cache`); frames = 0; lastSample = now; }
    };
    render();
    return () => { ended = true; controller.abort(); cancelAnimationFrame(frame); resize.disconnect(); controls.dispose(); for (const group of loaded.values()) disposeGeometryGroup(group); cache.clear(); renderer.dispose(); renderer.domElement.remove(); };
  }, [scene, manifest]);
  return <div className="space-y-2"><div ref={host} className="h-96 w-full overflow-hidden rounded-xl border border-slate-700" /><p className="text-xs text-slate-400">{status}</p>{error && <p role="status" className="text-sm text-amber-300">{error}</p>}</div>;
}
