import { inspectGeometryScene, buildBvh, boundsOf, nearestHit, type GeometryScene, type Triangle, type Vec3 } from "./meshGeometry";
import { detectMeshClashes, type MeshClashReport } from "./meshClash";
import { traceScene, type PathTraceSettings } from "./pathTracer";

export type GeometryRequest = { id: number; operation: "clash"; scene: GeometryScene; tolerance: number } | { id: number; operation: "trace"; scene: GeometryScene; settings: PathTraceSettings } | { id: number; operation: "benchmark"; components: 10_000 | 100_000 };
export interface GeometryBenchmark { kind: "synthetic-triangle-bvh"; components: number; triangles: number; buildMs: number; rayQueryMs: number; rays: number; hits: number; note: string }
export type GeometryResponse = { id: number; kind: "clashes"; report: MeshClashReport } | { id: number; kind: "progress"; fraction: number; pixels: Uint8ClampedArray; width: number; height: number } | { id: number; kind: "image"; pixels: Uint8ClampedArray; width: number; height: number } | { id: number; kind: "benchmark"; report: GeometryBenchmark } | { id: number; kind: "error"; message: string };
const scope = self as unknown as { onmessage: ((event: MessageEvent<GeometryRequest>) => void) | null; postMessage: (message: GeometryResponse, transfer?: Transferable[]) => void };
let active = false;
function benchmark(components: number): GeometryBenchmark {
  if (![10_000, 100_000].includes(components)) throw new Error("Benchmark supports 10,000 or 100,000 synthetic triangle components.");
  const triangles: Triangle[] = [];
  for (let i = 0; i < components; i++) { const x = i % 100, y = Math.floor(i / 100) % 100, z = Math.floor(i / 10_000); const a: Vec3 = [x, y, z], b: Vec3 = [x + 0.8, y, z], c: Vec3 = [x, y + 0.8, z]; triangles.push({ a, b, c, mesh: i, bounds: boundsOf([a, b, c]) }); }
  const start = performance.now(), tree = buildBvh(triangles), built = performance.now(); let hits = 0;
  for (let i = 0; i < 1000; i++) if (nearestHit([i % 100 + 0.1, Math.floor(i / 100) + 0.1, 20], [0, 0, -1], triangles, tree)) hits++;
  return { kind: "synthetic-triangle-bvh", components, triangles: triangles.length, buildMs: built - start, rayQueryMs: performance.now() - built, rays: 1000, hits, note: "Measured in this worker on this device. Synthetic triangle BVH only; excludes editor loading, GPU/FPS, exchange and full building complexity." };
}
scope.onmessage = async event => {
  const request = event.data;
  if (active) { scope.postMessage({ id: request.id, kind: "error", message: "Geometry worker is busy." }); return; }
  active = true;
  try {
    if (request.operation === "clash") scope.postMessage({ id: request.id, kind: "clashes", report: detectMeshClashes(inspectGeometryScene(request.scene), request.tolerance) });
    else if (request.operation === "benchmark") scope.postMessage({ id: request.id, kind: "benchmark", report: benchmark(request.components) });
    else if (request.operation === "trace") {
      const pixels = await traceScene(inspectGeometryScene(request.scene), request.settings, (fraction, rgba) => { const copy = rgba.slice(); scope.postMessage({ id: request.id, kind: "progress", fraction, pixels: copy, width: request.settings.width, height: request.settings.height }, [copy.buffer]); }, () => false);
      scope.postMessage({ id: request.id, kind: "image", pixels, width: request.settings.width, height: request.settings.height }, [pixels.buffer]);
    } else throw new Error("Unknown geometry operation.");
  } catch (error) { scope.postMessage({ id: request.id, kind: "error", message: error instanceof Error ? error.message : "Geometry operation failed." }); }
  finally { active = false; }
};
