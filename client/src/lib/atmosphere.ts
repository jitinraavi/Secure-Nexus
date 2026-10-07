import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

export type AtmospherePreset = "noon" | "sunset" | "cyberpunk" | "overcast";

export interface AtmosphereConfig {
  id: AtmospherePreset;
  label: string;
  icon: string;
  description: string;
  elevation: number; // degrees
  azimuth: number; // degrees
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  sunColor: string;
  sunIntensity: number;
  hemiSkyColor: string;
  hemiGroundColor: string;
  hemiIntensity: number;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  exposure: number;
  sceneBg: string;
  groundGrassColor: string;
  groundAsphaltColor: string;
  accentGlow: string;
}

export const ATMOSPHERE_PRESETS: Record<AtmospherePreset, AtmosphereConfig> = {
  noon: {
    id: "noon",
    label: "High Noon",
    icon: "☀️",
    description: "Crisp open-world daylight with clear atmospheric Rayleigh scattering and sharp contrast.",
    elevation: 64,
    azimuth: 180,
    turbidity: 4,
    rayleigh: 1.2,
    mieCoefficient: 0.003,
    mieDirectionalG: 0.8,
    sunColor: "#fffbf2",
    sunIntensity: 2.6,
    hemiSkyColor: "#bae6fd",
    hemiGroundColor: "#334155",
    hemiIntensity: 0.9,
    fogColor: "#dbeafe",
    fogNear: 800,
    fogFar: 3200,
    exposure: 1.05,
    sceneBg: "#dbeafe",
    groundGrassColor: "#22c55e",
    groundAsphaltColor: "#1e293b",
    accentGlow: "rgba(56, 189, 248, 0.35)",
  },
  sunset: {
    id: "sunset",
    label: "Golden Hour",
    icon: "🌅",
    description: "Cinematic twilight with long dramatic shadows and deep orange Rayleigh horizon glow.",
    elevation: 7,
    azimuth: 225,
    turbidity: 8,
    rayleigh: 4.0,
    mieCoefficient: 0.018,
    mieDirectionalG: 0.88,
    sunColor: "#ff7824",
    sunIntensity: 3.4,
    hemiSkyColor: "#f97316",
    hemiGroundColor: "#1e1b4b",
    hemiIntensity: 0.85,
    fogColor: "#fdba74",
    fogNear: 600,
    fogFar: 2800,
    exposure: 1.15,
    sceneBg: "#fdba74",
    groundGrassColor: "#4d7c0f",
    groundAsphaltColor: "#0f172a",
    accentGlow: "rgba(249, 115, 22, 0.4)",
  },
  cyberpunk: {
    id: "cyberpunk",
    label: "Cyberpunk Night",
    icon: "🌌",
    description: "Midnight atmosphere with cool lunar directional lighting and neon specular rim accents.",
    elevation: -15,
    azimuth: 180,
    turbidity: 10,
    rayleigh: 0.5,
    mieCoefficient: 0.002,
    mieDirectionalG: 0.7,
    sunColor: "#60a5fa",
    sunIntensity: 1.3,
    hemiSkyColor: "#1e1b4b",
    hemiGroundColor: "#030712",
    hemiIntensity: 0.65,
    fogColor: "#090d16",
    fogNear: 500,
    fogFar: 2200,
    exposure: 1.25,
    sceneBg: "#050811",
    groundGrassColor: "#064e3b",
    groundAsphaltColor: "#090d16",
    accentGlow: "rgba(168, 85, 247, 0.45)",
  },
  overcast: {
    id: "overcast",
    label: "Studio Overcast",
    icon: "☁️",
    description: "Nordic diffuse cloud cover with soft ambient occlusion and even, unharsh architectural illumination.",
    elevation: 38,
    azimuth: 180,
    turbidity: 20,
    rayleigh: 0.8,
    mieCoefficient: 0.06,
    mieDirectionalG: 0.6,
    sunColor: "#e2e8f0",
    sunIntensity: 1.8,
    hemiSkyColor: "#cbd5e1",
    hemiGroundColor: "#475569",
    hemiIntensity: 1.2,
    fogColor: "#94a3b8",
    fogNear: 650,
    fogFar: 2600,
    exposure: 0.98,
    sceneBg: "#94a3b8",
    groundGrassColor: "#15803d",
    groundAsphaltColor: "#1e293b",
    accentGlow: "rgba(148, 163, 184, 0.3)",
  },
};

/**
 * Creates and installs a physical Rayleigh scattering sky dome into the scene.
 */
export function createAtmosphericSky(): { sky: Sky; sunPosition: THREE.Vector3 } {
  const sky = new Sky();
  sky.name = "atmospheric-sky";
  sky.scale.setScalar(450000);
  const sunPosition = new THREE.Vector3();
  return { sky, sunPosition };
}

/**
 * Updates lighting, sky uniforms, fog, and renderer exposure to match an open-world graphics preset.
 */
export function applyAtmosphere(
  preset: AtmospherePreset,
  scene: THREE.Scene,
  sky: Sky | null,
  sunLight: THREE.DirectionalLight,
  hemiLight: THREE.HemisphereLight,
  renderer: THREE.WebGLRenderer,
  fillLight?: THREE.DirectionalLight,
) {
  const cfg = ATMOSPHERE_PRESETS[preset] ?? ATMOSPHERE_PRESETS.noon;

  // 1. Calculate Sun vector
  const sunPos = new THREE.Vector3();
  const phi = THREE.MathUtils.degToRad(90 - cfg.elevation);
  const theta = THREE.MathUtils.degToRad(cfg.azimuth);
  sunPos.setFromSphericalCoords(1, phi, theta);

  // Position directional light far along sun vector
  const dist = 500;
  sunLight.position.set(sunPos.x * dist, Math.max(sunPos.y * dist, 60), sunPos.z * dist);
  sunLight.color.set(cfg.sunColor);
  sunLight.intensity = cfg.sunIntensity;

  // Soft PCF shadow map tuning for ultra-high gaming quality
  sunLight.castShadow = true;
  sunLight.shadow.bias = -0.00012;
  sunLight.shadow.normalBias = 0.02;

  // 2. Configure Hemisphere Ambient Light
  hemiLight.color.set(cfg.hemiSkyColor);
  hemiLight.groundColor.set(cfg.hemiGroundColor);
  hemiLight.intensity = cfg.hemiIntensity;

  // 3. Optional Fill / Moonlight
  if (fillLight) {
    if (preset === "cyberpunk") {
      fillLight.visible = true;
      fillLight.color.set("#ec4899");
      fillLight.intensity = 0.8;
      fillLight.position.set(-180, 80, -120);
    } else if (preset === "sunset") {
      fillLight.visible = true;
      fillLight.color.set("#a855f7");
      fillLight.intensity = 0.5;
      fillLight.position.set(-120, 60, -80);
    } else {
      fillLight.visible = false;
    }
  }

  // 4. Update Atmospheric Scattering Shader Uniforms
  if (sky) {
    const uniforms = sky.material.uniforms;
    if (uniforms) {
      if (uniforms.turbidity) uniforms.turbidity.value = cfg.turbidity;
      if (uniforms.rayleigh) uniforms.rayleigh.value = cfg.rayleigh;
      if (uniforms.mieCoefficient) uniforms.mieCoefficient.value = cfg.mieCoefficient;
      if (uniforms.mieDirectionalG) uniforms.mieDirectionalG.value = cfg.mieDirectionalG;
      if (uniforms.sunPosition) uniforms.sunPosition.value.copy(sunPos);
    }
  }

  // 5. Scene Fog & Background
  if (scene.fog && scene.fog instanceof THREE.Fog) {
    scene.fog.color.set(cfg.fogColor);
    scene.fog.near = cfg.fogNear;
    scene.fog.far = cfg.fogFar;
  }
  scene.background = new THREE.Color(cfg.sceneBg);

  // 6. Filmic Tone Mapping & Exposure
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = cfg.exposure;
}
