import { add3, buildBvh, cross3, dot3, nearestHit, normalize3, scale3, sceneTriangles, sub3, validVec3, type GeometryScene, type Vec3 } from "./meshGeometry";

export interface PathTraceSettings { width: number; height: number; samples: number; bounces: number; seed: number; exposure: number; environment: Vec3; sunDirection: Vec3; sunIrradiance: Vec3 }
export const DEFAULT_TRACE_SETTINGS: PathTraceSettings = { width: 320, height: 240, samples: 16, bounces: 5, seed: 42, exposure: 1, environment: [0.4, 0.5, 0.7], sunDirection: [0.4, 1, 0.3], sunIrradiance: [2, 1.8, 1.5] };
const multiply = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
function cosineHemisphere(normal: Vec3, random: () => number): Vec3 {
  const r = Math.sqrt(random()), angle = 2 * Math.PI * random();
  const tangent = normalize3(cross3(Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], normal)), bitangent = cross3(normal, tangent);
  return normalize3(add3(add3(scale3(tangent, r * Math.cos(angle)), scale3(bitangent, r * Math.sin(angle))), scale3(normal, Math.sqrt(Math.max(0, 1 - r * r)))));
}
function validateSettings(settings: PathTraceSettings) {
  if (![settings.width, settings.height, settings.samples, settings.bounces, settings.seed].every(Number.isSafeInteger) || settings.width < 16 || settings.height < 16 || settings.width > 2048 || settings.height > 2048 || settings.width * settings.height > 1_048_576 || settings.samples < 1 || settings.samples > 256 || settings.bounces < 1 || settings.bounces > 12 || settings.width * settings.height * settings.samples * settings.bounces > 40_000_000 || !Number.isFinite(settings.exposure) || settings.exposure <= 0 || settings.exposure > 100 || !validVec3(settings.environment) || !validVec3(settings.sunDirection) || !validVec3(settings.sunIrradiance) || [...settings.environment, ...settings.sunIrradiance].some(v => v < 0 || v > 1e4)) throw new Error("Invalid trace settings or ray budget (>40 million maximum bounce samples).");
  normalize3(settings.sunDirection);
}

/** CPU Monte Carlo radiance estimator: Lambert diffuse, delta mirror/dielectric, directional sun. */
export async function traceScene(scene: GeometryScene, settings: PathTraceSettings, progress: (fraction: number, rgba: Uint8ClampedArray) => void, cancelled: () => boolean): Promise<Uint8ClampedArray> {
  validateSettings(settings);
  const triangles = sceneTriangles(scene), tree = buildBvh(triangles), camera = scene.camera;
  const forward = normalize3(sub3(camera.target, camera.position)), right = normalize3(cross3(forward, camera.up)), up = cross3(right, forward);
  const fov = Math.tan(camera.fov * Math.PI / 360), aspect = settings.width / settings.height, sun = normalize3(settings.sunDirection);
  const sum = new Float64Array(settings.width * settings.height * 3), rgba = new Uint8ClampedArray(settings.width * settings.height * 4);
  let state = settings.seed >>> 0;
  const random = () => { state = (state + 0x6d2b79f5) >>> 0; let t = Math.imul(state ^ state >>> 15, state | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const radiance = (direction: Vec3): Vec3 => {
    let origin: Vec3 = camera.position, throughput: Vec3 = [1, 1, 1], light: Vec3 = [0, 0, 0];
    for (let bounce = 0; bounce < settings.bounces; bounce++) {
      const hit = nearestHit(origin, direction, triangles, tree);
      if (!hit) { light = add3(light, multiply(throughput, settings.environment)); break; }
      const triangle = hit.triangle, material = scene.meshes[triangle.mesh].material;
      light = add3(light, multiply(throughput, material.emission));
      const geometric = normalize3(cross3(sub3(triangle.b, triangle.a), sub3(triangle.c, triangle.a))), entering = dot3(geometric, direction) < 0, normal = entering ? geometric : scale3(geometric, -1);
      const point = add3(origin, scale3(direction, hit.distance)), epsilon = Math.max(1e-7, Math.hypot(...point) * 1e-12);
      if (material.model === "diffuse") {
        const cosine = Math.max(0, dot3(normal, sun));
        if (cosine > 0 && !nearestHit(add3(point, scale3(normal, epsilon)), sun, triangles, tree)) light = add3(light, scale3(multiply(multiply(throughput, material.color), settings.sunIrradiance), cosine / Math.PI));
        direction = cosineHemisphere(normal, random); throughput = multiply(throughput, material.color);
      } else if (material.model === "mirror") {
        direction = normalize3(sub3(direction, scale3(normal, 2 * dot3(direction, normal)))); throughput = multiply(throughput, material.color);
      } else {
        const eta = entering ? 1 / material.ior : material.ior, cosine = Math.min(1, -dot3(normal, direction)), sin2 = eta * eta * (1 - cosine * cosine);
        const r0 = ((1 - material.ior) / (1 + material.ior)) ** 2, fresnel = r0 + (1 - r0) * (1 - cosine) ** 5;
        if (sin2 > 1 || random() < fresnel) direction = normalize3(sub3(direction, scale3(normal, 2 * dot3(direction, normal))));
        else { direction = normalize3(add3(scale3(direction, eta), scale3(normal, eta * cosine - Math.sqrt(1 - sin2)))); throughput = scale3(multiply(throughput, material.color), eta * eta); }
      }
      origin = add3(point, scale3(normal, dot3(direction, normal) >= 0 ? epsilon : -epsilon));
      if (bounce >= 3) { const survival = Math.min(0.95, Math.max(0.05, ...throughput)); if (random() > survival) break; throughput = scale3(throughput, 1 / survival); }
    }
    return light;
  };
  const srgb = (v: number) => { const linear = Math.max(0, v * settings.exposure), mapped = linear / (1 + linear); return Math.round(255 * (mapped <= 0.0031308 ? 12.92 * mapped : 1.055 * mapped ** (1 / 2.4) - 0.055)); };
  for (let sample = 0; sample < settings.samples; sample++) {
    for (let y = 0; y < settings.height; y++) {
      if (cancelled()) throw new Error("Path tracing cancelled.");
      for (let x = 0; x < settings.width; x++) {
        const dx = (2 * (x + random()) / settings.width - 1) * aspect * fov, dy = (1 - 2 * (y + random()) / settings.height) * fov;
        const value = radiance(normalize3(add3(forward, add3(scale3(right, dx), scale3(up, dy))))), pixel = y * settings.width + x;
        for (let k = 0; k < 3; k++) { sum[pixel * 3 + k] += value[k]; rgba[pixel * 4 + k] = srgb(sum[pixel * 3 + k] / (sample + 1)); }
        rgba[pixel * 4 + 3] = 255;
      }
      if (y % 16 === 15) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    progress((sample + 1) / settings.samples, rgba);
  }
  return rgba;
}
