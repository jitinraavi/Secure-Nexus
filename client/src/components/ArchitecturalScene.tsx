import { useEffect, useId, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

type SceneVariant = "pavilion" | "city" | "structure" | "interior";

export interface ArchitecturalSceneProps {
  variant?: SceneVariant;
  className?: string;
  interactive?: boolean;
  compact?: boolean;
}

const sceneLabels: Record<SceneVariant, string> = {
  pavilion: "The Courtyard House",
  city: "A new urban perspective",
  structure: "Every connection, considered",
  interior: "Space to live beautifully",
};

const sceneDescriptions: Record<SceneVariant, string> = {
  pavilion: "An interactive architectural model of a modern concrete pavilion, with bronze screens, glazed walls, a stepped terrace, and landscaped trees.",
  city: "An interactive architectural model of a contemporary neighborhood, with landscaped courtyards, towers, and pedestrian paths.",
  structure: "An interactive architectural model showing a building's concrete columns, beams, floor plates, and circulation.",
  interior: "An interactive architectural model of a warm, open living space, with a lounge, dining area, and landscaped terrace.",
};

/** A self-contained, resource-managed architectural model for marketing and studio surfaces. */
export function ArchitecturalScene({ variant = "pavilion", className = "", interactive = true, compact = false }: ArchitecturalSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<{ reset: () => void; rotate: (direction: number) => void; invalidate: () => void } | null>(null);
  const pausedRef = useRef(false);
  const wireframeRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [fallback, setFallback] = useState(false);
  const labelId = useId();
  const descriptionId = useId();

  useEffect(() => { pausedRef.current = paused; controllerRef.current?.invalidate(); }, [paused]);
  useEffect(() => { wireframeRef.current = wireframe; controllerRef.current?.invalidate(); }, [wireframe]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !compact, alpha: true, powerPreference: compact ? "low-power" : "default" });
    } catch {
      setFallback(true);
      return;
    }
    setFallback(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x171d1a, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const model = new THREE.Group();
    scene.add(model);
    const materials = new Set<THREE.Material>();
    const geometries = new Set<THREE.BufferGeometry>();
    const buildingMaterials: THREE.MeshStandardMaterial[] = [];
    const technicalLines: THREE.LineSegments[] = [];
    const standard = (color: string, roughness = 0.8, metalness = 0, architectural = true) => {
      const result = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      materials.add(result);
      if (architectural) buildingMaterials.push(result);
      return result;
    };
    const concrete = standard("#d8d5c5", 0.92);
    const roofMaterial = standard("#e8e4d5", 0.84);
    const stone = standard("#a9ae9b", 0.96);
    const baseMaterial = standard("#687368", 0.95);
    const bronze = standard("#9b7750", 0.42, 0.55);
    const darkMetal = standard("#2c3530", 0.6, 0.5);
    const floor = standard("#b2a38a", 0.88);
    const glass = standard("#344d49", 0.15, 0.65);
    const glassLight = standard("#657870", 0.28, 0.4);
    const upholstery = standard("#c8be9f", 0.96);
    const olive = standard("#697f54", 1, 0, false);
    const leafLight = standard("#8b9a6b", 1, 0, false);
    const trunkMaterial = standard("#665a43", 1, 0, false);
    const lawn = standard("#788365", 1, 0, false);
    const water = standard("#587976", 0.18, 0.35, false);
    const warm = standard("#e3c392", 0.55);
    warm.emissive.set("#bd8950");
    warm.emissiveIntensity = 0.35;
    const edgeMaterial = new THREE.LineBasicMaterial({ color: "#e8e5d3", transparent: true, opacity: 0.15 });
    materials.add(edgeMaterial);

    const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, edges = false) => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      geometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      model.add(mesh);
      if (edges) {
        const edgeGeometry = new THREE.EdgesGeometry(geometry);
        geometries.add(edgeGeometry);
        const lines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        mesh.add(lines);
        technicalLines.push(lines);
      }
      return mesh;
    };
    const cylinder = (radius: number, height: number, x: number, y: number, z: number, material: THREE.Material, segments = 12) => {
      const geometry = new THREE.CylinderGeometry(radius, radius, height, segments);
      geometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      model.add(mesh);
      return mesh;
    };
    const tree = (x: number, z: number, height = 2.9, y = 0.35) => {
      cylinder(0.075, height * 0.64, x, y + height * 0.32, z, trunkMaterial, 7);
      const canopyGeometry = new THREE.IcosahedronGeometry(height * 0.3, 1);
      geometries.add(canopyGeometry);
      const canopy = new THREE.Mesh(canopyGeometry, olive);
      canopy.position.set(x, y + height * 0.73, z);
      canopy.scale.set(1, 1.28, 0.95);
      canopy.rotation.set(0.2, x * 0.45, 0.1);
      canopy.castShadow = true;
      model.add(canopy);
      const second = new THREE.Mesh(canopyGeometry, leafLight);
      second.position.set(x + height * 0.08, y + height * 0.94, z - height * 0.06);
      second.scale.set(0.68, 0.9, 0.72);
      second.castShadow = true;
      model.add(second);
    };
    const planting = (w: number, d: number, x: number, z: number, y = 0.26) => {
      box(w, 0.15, d, x, y, z, lawn);
      for (let i = 0; i < 5; i++) {
        const radius = Math.min(w, d) * (0.16 + (i % 2) * 0.035);
        const geometry = new THREE.IcosahedronGeometry(radius, 1);
        geometries.add(geometry);
        const shrub = new THREE.Mesh(geometry, i % 2 ? olive : leafLight);
        shrub.position.set(x + (i - 2) * w * 0.16, y + 0.16, z + Math.sin(i * 2.1) * d * 0.18);
        shrub.scale.y = 0.65;
        shrub.castShadow = true;
        model.add(shrub);
      }
    };
    const person = (x: number, z: number, y: number) => {
      cylinder(0.09, 0.65, x, y + 0.35, z, roofMaterial, 8);
      const geometry = new THREE.SphereGeometry(0.105, 8, 6);
      geometries.add(geometry);
      const head = new THREE.Mesh(geometry, roofMaterial);
      head.position.set(x, y + 0.78, z);
      head.castShadow = true;
      model.add(head);
    };

    // The dark drafting grid grounds every model in a shared spatial language.
    const grid = new THREE.GridHelper(32, 32, 0x66766a, 0x536157);
    grid.position.y = -0.49;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((material) => { material.transparent = true; material.opacity = 0.13; materials.add(material); });
    geometries.add(grid.geometry);
    scene.add(grid);
    const shadowGeometry = new THREE.PlaneGeometry(60, 60);
    geometries.add(shadowGeometry);
    const shadowMaterial = new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.28 });
    materials.add(shadowMaterial);
    const shadowPlane = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.48;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    if (variant === "pavilion") {
      box(14, 0.45, 10.5, 0, -0.2, 0, baseMaterial, true);
      box(12.1, 0.18, 8.8, 0, 0.1, 0, stone, true);
      box(10.9, 0.16, 7.5, 0, 0.26, 0, concrete, true);
      box(10.3, 0.14, 6.9, -0.15, 0.41, -0.15, roofMaterial, true);
      // A floating concrete canopy, glazed courtyard, and an opaque service wing.
      box(9.5, 0.26, 6.25, -0.25, 3.4, -0.15, roofMaterial, true);
      box(5.4, 2.75, 0.3, -1.6, 1.91, -2.66, concrete, true);
      box(0.32, 2.75, 5.4, -4.2, 1.91, -0.15, concrete, true);
      box(2.85, 2.78, 3.6, 2.8, 1.92, -1.05, concrete, true);
      box(5.5, 2.57, 0.055, -1.22, 1.85, 2.5, glass, true);
      box(0.055, 2.57, 2.0, 4.27, 1.85, 1.55, glassLight, true);
      box(0.055, 2.57, 4.9, -4.02, 1.85, -0.15, glass, true);
      for (let i = 0; i <= 5; i++) box(0.06, 2.7, 0.1, -3.94 + i * 1.1, 1.91, 2.54, darkMetal);
      box(5.7, 0.06, 0.12, -1.22, 0.56, 2.54, darkMetal);
      box(5.7, 0.06, 0.12, -1.22, 3.22, 2.54, darkMetal);
      for (let i = 0; i < 10; i++) box(0.1, 2.75, 1.35, 1.55 + i * 0.28, 1.91, 2.03, bronze, true);
      box(4.8, 0.025, 0.08, -1.4, 3.22, 2.27, warm);
      box(2.6, 0.28, 0.86, -2.1, 0.72, 0.9, upholstery);
      box(2.6, 0.42, 0.23, -2.1, 1.01, 0.61, upholstery);
      box(1.2, 0.2, 0.7, -1.7, 0.72, 1.75, bronze);
      box(2.4, 0.04, 2.3, -1.75, 0.51, 1.3, floor);
      box(2.65, 0.07, 1.5, 3.08, 0.5, -1.1, glassLight);
      // Terrace steps and a narrow reflective pool.
      for (let i = 0; i < 3; i++) box(3.3 + i * 0.38, 0.14, 0.65, -1.3, 0.34 - i * 0.13, 3.65 + i * 0.42, concrete, true);
      box(1.85, 0.1, 4.7, 5.65, 0.27, -0.3, darkMetal);
      box(1.62, 0.035, 4.46, 5.65, 0.33, -0.3, water);
      planting(2, 4.6, -5.65, -0.3);
      planting(8.3, 1.2, -0.35, -4.28);
      tree(-5.6, -2.9, 3.4);
      tree(-5.7, 2.35, 2.85);
      tree(5.8, -3.95, 3.3);
      person(-0.3, 3.05, 0.48);
    } else if (variant === "city") {
      box(14, 0.45, 11.5, 0, -0.2, 0, baseMaterial, true);
      box(13.8, 0.12, 11.3, 0, 0.085, 0, stone);
      box(13.2, 0.02, 1.2, 0, 0.16, 1.1, concrete);
      box(1.1, 0.02, 10.8, 0.3, 0.17, 0, concrete);
      const towers = [
        { x: -3.8, z: -2.3, w: 3.3, d: 3.6, h: 5.4 },
        { x: 3.4, z: -2.5, w: 3.0, d: 3.7, h: 7.8 },
        { x: -3.8, z: 3.25, w: 3.4, d: 2.5, h: 3.3 },
        { x: 3.5, z: 3.2, w: 3.0, d: 2.4, h: 4.45 },
      ];
      towers.forEach(({ x, z, w, d, h }, index) => {
        box(w + 0.3, 0.3, d + 0.3, x, 0.29, z, concrete, true);
        box(w, h, d, x, h / 2 + 0.44, z, index === 1 ? glass : glassLight, true);
        box(w + 0.16, 0.24, d + 0.16, x, h + 0.47, z, roofMaterial, true);
        box(w * 0.5, 0.45, d * 0.55, x, h + 0.75, z, darkMetal);
        for (let level = 1; level < Math.ceil(h / 0.58); level++) {
          box(w + 0.08, 0.075, d + 0.08, x, 0.44 + level * 0.58, z, concrete);
        }
        for (let fin = 0; fin < 5; fin++) {
          box(0.07, h, 0.12, x - w * 0.43 + fin * w * 0.215, h / 2 + 0.44, z + d / 2 + 0.06, bronze);
        }
      });
      planting(2.6, 2.8, -0.95, -2.6, 0.2);
      planting(2.9, 2.5, 1.65, 3.4, 0.2);
      [-5.9, -1.1, 1.6, 5.8].forEach((x, i) => tree(x, i % 2 ? 4.6 : -4.6, 2.35, 0.17));
      tree(-1.2, -1.2, 2.8, 0.17);
      person(0.3, 2.0, 0.17);
      person(-2.1, 1.1, 0.17);
    } else if (variant === "structure") {
      box(13.2, 0.45, 10.3, 0, -0.2, 0, baseMaterial, true);
      box(10.4, 0.28, 7.6, 0, 0.16, 0, concrete, true);
      const columnsX = [-4.1, 0, 4.1];
      const columnsZ = [-2.85, 2.85];
      for (let level = 0; level < 3; level++) {
        const y = 0.3 + level * 2.0;
        columnsX.forEach((x) => columnsZ.forEach((z) => box(0.34, 1.86, 0.34, x, y + 0.93, z, concrete, true)));
        columnsZ.forEach((z) => box(8.6, 0.34, 0.34, 0, y + 1.86, z, roofMaterial, true));
        columnsX.forEach((x) => box(0.34, 0.34, 6.04, x, y + 1.86, 0, roofMaterial, true));
        if (level < 2) {
          box(8.8, 0.16, 6.1, 0, y + 2.04, 0, stone, true);
          for (let stair = 0; stair < 10; stair++) box(1.35, 0.15, 0.42, 2.8, y + stair * 0.185, -1.8 + stair * 0.36, concrete, true);
        }
      }
      box(2.2, 5.95, 0.22, -2.7, 3.3, -2.8, bronze, true);
      box(0.2, 5.95, 2.0, -3.7, 3.3, -1.9, bronze, true);
      for (let i = 0; i < 7; i++) box(0.16, 0.2, 6.0, -3.9 + i * 1.3, 6.18, 0, bronze, true);
      planting(2.0, 6.5, -5.6, 0, 0.08);
      tree(-5.7, -2.8, 2.7, 0.15);
      tree(5.6, 2.9, 2.7, 0.15);
      person(0.5, 3.5, 0.3);
    } else {
      box(13.3, 0.45, 10.5, 0, -0.2, 0, baseMaterial, true);
      box(11.3, 0.22, 8.3, 0, 0.14, 0, concrete, true);
      box(9.7, 0.14, 6.9, -0.1, 0.32, -0.1, floor, true);
      box(9.7, 3.5, 0.28, -0.1, 2.12, -3.4, concrete, true);
      box(0.28, 3.5, 6.9, -4.95, 2.12, -0.1, concrete, true);
      box(5.65, 0.23, 1.3, -1.9, 3.97, -2.8, roofMaterial, true);
      box(0.055, 3.25, 3.6, 4.7, 2.0, -1.8, glassLight, true);
      for (let i = 0; i < 4; i++) box(0.08, 3.4, 0.1, 4.75, 2.0, -3.2 + i * 1.0, darkMetal);
      box(4.1, 0.025, 3.2, -2.0, 0.41, 0.65, upholstery);
      box(3.25, 0.45, 0.98, -2.0, 0.68, -0.25, upholstery, true);
      box(3.25, 0.42, 0.27, -2.0, 1.1, -0.62, upholstery);
      box(0.36, 0.75, 0.98, -3.6, 0.82, -0.25, upholstery);
      box(0.36, 0.75, 0.98, -0.4, 0.82, -0.25, upholstery);
      box(1.85, 0.16, 0.85, -1.9, 0.71, 1.15, bronze, true);
      box(0.13, 0.34, 0.5, -2.5, 0.54, 1.15, darkMetal);
      box(0.13, 0.34, 0.5, -1.3, 0.54, 1.15, darkMetal);
      box(0.1, 1.35, 2.0, -4.75, 1.6, 0.1, darkMetal);
      box(0.08, 1.1, 1.72, -4.68, 1.65, 0.1, glass);
      // Warm cabinetry, a dining table, and generous glazing.
      box(3.4, 0.95, 0.72, 2.8, 0.87, -2.82, concrete, true);
      box(3.45, 0.09, 0.78, 2.8, 1.4, -2.82, roofMaterial);
      for (let i = 0; i < 5; i++) box(0.025, 0.75, 0.03, 1.15 + i * 0.66, 0.87, -2.44, bronze);
      box(2.2, 0.12, 1.1, 2.4, 1.17, 0.2, bronze, true);
      box(0.2, 0.76, 0.76, 1.65, 0.74, 0.2, darkMetal);
      box(0.2, 0.76, 0.76, 3.15, 0.74, 0.2, darkMetal);
      [1.7, 3.1].forEach((x) => [-0.85, 1.25].forEach((z) => {
        box(0.62, 0.1, 0.6, x, 0.92, z, upholstery);
        box(0.62, 0.72, 0.1, x, 1.05, z + (z < 0 ? -0.27 : 0.27), upholstery);
        cylinder(0.045, 0.52, x, 0.65, z, bronze);
      }));
      cylinder(0.47, 0.15, 2.4, 2.85, 0.2, bronze, 20);
      cylinder(0.018, 1.1, 2.4, 3.47, 0.2, darkMetal, 6);
      box(3.0, 0.025, 0.08, -2.5, 3.87, -3.23, warm);
      planting(1.8, 6.5, 5.65, -0.1);
      tree(5.65, -2.4, 3.0);
      tree(-5.7, 3.7, 2.3);
      person(4.3, 2.5, 0.4);
    }

    scene.add(new THREE.HemisphereLight(0xe6efde, 0x6f746a, 2.4));
    const sun = new THREE.DirectionalLight(0xffedcc, 4.8);
    sun.position.set(-6, 14, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(compact ? 512 : 1024, compact ? 512 : 1024);
    sun.shadow.camera.left = -15;
    sun.shadow.camera.right = 15;
    sun.shadow.camera.top = 15;
    sun.shadow.camera.bottom = -15;
    sun.shadow.normalBias = 0.03;
    sun.shadow.bias = -0.0003;
    sun.shadow.radius = 3;
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0xd0e5de, 1.4);
    rim.position.set(8, 6, -8);
    scene.add(rim);
    const environmentScene = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentTarget = pmrem.fromScene(environmentScene, 0.04);
    scene.environment = environmentTarget.texture;
    environmentScene.dispose();
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    const target = new THREE.Vector3(0, variant === "city" ? 2.3 : variant === "structure" ? 2.1 : 1.3, 0);
    const initialAngle = variant === "interior" ? 0.83 : 0.72;
    let angle = initialAngle;
    let elevation = 0.53;
    let distance = compact ? 26 : 25;
    let visible = true;
    let frame = 0;
    let lastTime = 0;
    let lastRenderTime = 0;
    let pointer: { id: number; x: number; y: number } | null = null;
    let disposed = false;
    let contextLost = false;
    let lastWireframe = false;
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = motionPreference.matches;

    const positionCamera = () => {
      camera.position.set(Math.sin(angle) * Math.cos(elevation) * distance, Math.sin(elevation) * distance + target.y, Math.cos(angle) * Math.cos(elevation) * distance);
      camera.lookAt(target);
    };
    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height || contextLost) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // Widen the distance on tall/mobile canvases so the complete model remains visible.
      distance = Math.max(compact ? 25 : 24.5, 25 / Math.max(camera.aspect, 0.65));
      camera.updateProjectionMatrix();
      positionCamera();
      renderer.render(scene, camera);
    };
    const render = (time: number) => {
      frame = 0;
      if (disposed || contextLost || !visible || document.hidden) return;
      // Small previews share a lower frame budget so multiple visible cards stay light.
      if (compact && time - lastRenderTime < 1000 / 30) {
        frame = window.requestAnimationFrame(render);
        return;
      }
      lastRenderTime = time;
      const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
      lastTime = time;
      if (interactive && !pausedRef.current && !reducedMotion && !pointer) angle += delta * 0.028;
      if (lastWireframe !== wireframeRef.current) {
        lastWireframe = wireframeRef.current;
        buildingMaterials.forEach((material) => { material.wireframe = lastWireframe; });
        edgeMaterial.opacity = lastWireframe ? 0.42 : 0.15;
        technicalLines.forEach((line) => { line.visible = !lastWireframe; });
      }
      positionCamera();
      renderer.render(scene, camera);
      if ((interactive && !pausedRef.current && !reducedMotion) || pointer) frame = window.requestAnimationFrame(render);
    };
    const start = () => {
      if (!frame && !disposed && !contextLost && visible && !document.hidden) {
        lastTime = 0;
        lastRenderTime = 0;
        frame = window.requestAnimationFrame(render);
      }
    };
    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
    };
    controllerRef.current = {
      invalidate: start,
      reset: () => { angle = initialAngle; elevation = 0.53; positionCamera(); renderer.render(scene, camera); },
      rotate: (direction) => { angle += direction * 0.28; positionCamera(); renderer.render(scene, camera); },
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!interactive || event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
      start();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      angle -= (event.clientX - pointer.x) * 0.007;
      elevation = THREE.MathUtils.clamp(elevation + (event.clientY - pointer.y) * 0.004, 0.2, 1.15);
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (pointer?.id !== event.pointerId) return;
      pointer = null;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      renderer.domElement.style.cursor = interactive ? "grab" : "default";
    };
    const onVisibility = () => { if (document.hidden) stop(); else start(); };
    const onMotionChange = (event: MediaQueryListEvent) => { reducedMotion = event.matches; start(); };
    const onContextLost = (event: Event) => { event.preventDefault(); contextLost = true; stop(); setFallback(true); };
    const onContextRestored = () => { contextLost = false; setFallback(false); resize(); start(); };
    renderer.domElement.style.cursor = interactive ? "grab" : "default";
    renderer.domElement.style.touchAction = interactive ? "pan-y" : "auto";
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("lostpointercapture", onPointerUp);
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);
    document.addEventListener("visibilitychange", onVisibility);
    motionPreference.addEventListener("change", onMotionChange);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start(); else stop();
    }, { rootMargin: "100px" });
    intersectionObserver.observe(host);
    resize();
    start();

    return () => {
      disposed = true;
      stop();
      controllerRef.current = null;
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motionPreference.removeEventListener("change", onMotionChange);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("lostpointercapture", onPointerUp);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      environmentTarget.dispose();
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [variant, interactive, compact]);

  return (
    <div className={`architectural-scene ${compact ? "architectural-scene--compact" : ""} ${className}`} role="group" aria-labelledby={labelId} aria-describedby={descriptionId}>
      <span id={labelId} className="architectural-scene__sr-only">{sceneLabels[variant]}</span>
      <span id={descriptionId} className="architectural-scene__sr-only">{sceneDescriptions[variant]}{interactive ? " Drag to orbit the model, or use the rotation controls." : ""}</span>
      <div ref={hostRef} className="architectural-scene__canvas" style={fallback ? { visibility: "hidden" } : undefined} />
      {fallback && <ArchitecturalFallback variant={variant} />}
      {!compact && <div className="architectural-scene__annotation" aria-hidden="true"><span className="architectural-scene__dot" /> LIVE MODEL <span className="architectural-scene__divider">/</span> {variant === "pavilion" ? "RESIDENTIAL CONCEPT" : variant === "city" ? "URBAN STUDY" : variant === "structure" ? "STRUCTURAL STUDY" : "INTERIOR STUDY"}</div>}
      {interactive && !fallback && <div className="architectural-scene__controls" aria-label="3D model controls">
        <button type="button" aria-label="Rotate model left" title="Rotate left" onClick={() => controllerRef.current?.rotate(-1)}><span aria-hidden="true">↶</span></button>
        <button type="button" aria-label={paused ? "Resume model rotation" : "Pause model rotation"} title={paused ? "Resume rotation" : "Pause rotation"} aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 3 7 5-7 5Z" fill="currentColor" stroke="none" /></svg> : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4v8M10.5 4v8" /></svg>}</button>
        <button type="button" aria-label="Reset model view" title="Reset view" onClick={() => controllerRef.current?.reset()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 7a5 5 0 1 1 .6 4M3 3v4h4" /></svg></button>
        {!compact && <button type="button" aria-label={wireframe ? "Show solid model" : "Show wireframe model"} title="Toggle wireframe" aria-pressed={wireframe} onClick={() => setWireframe((value) => !value)}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m8 1.5 5.5 3.2v6.6L8 14.5l-5.5-3.2V4.7L8 1.5Zm0 0v6.6m5.5-3.4L8 8.1 2.5 4.7M8 8.1v6.4" /></svg></button>}
        <button type="button" aria-label="Rotate model right" title="Rotate right" onClick={() => controllerRef.current?.rotate(1)}><span aria-hidden="true">↷</span></button>
      </div>}
      {!compact && <div className="architectural-scene__scale" aria-hidden="true"><span /><small>1 : 100</small></div>}
      <style>{`
        .architectural-scene{position:relative;width:100%;height:100%;min-height:360px;isolation:isolate;overflow:hidden;border-radius:inherit;background:radial-gradient(ellipse at 55% 43%,#343e32 0%,#222b23 48%,#19221d 100%)}
        .architectural-scene--compact{min-height:180px}
        .architectural-scene__canvas{position:absolute;inset:0}
        .architectural-scene__sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
        .architectural-scene__annotation{position:absolute;top:26px;left:28px;display:flex;align-items:center;gap:9px;font:500 9px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:1.4px;color:#b2bdac;pointer-events:none}
        .architectural-scene__dot{width:5px;height:5px;border-radius:50%;background:#c7d299;box-shadow:0 0 9px #c7d29944}
        .architectural-scene__divider{margin:0 4px;color:#667263}
        .architectural-scene__controls{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);display:flex;gap:3px;padding:5px;border:1px solid #ffffff18;background:#172019c9;border-radius:9px;backdrop-filter:blur(12px);box-shadow:0 4px 18px #00000020}
        .architectural-scene__controls button{display:grid;place-items:center;border:0;width:32px;height:30px;padding:0;border-radius:5px;background:transparent;color:#c9d0be;cursor:pointer;transition:background .15s,color .15s}
        .architectural-scene__controls button:hover,.architectural-scene__controls button[aria-pressed=true]{background:#c6d09420;color:#ecf0dc}
        .architectural-scene__controls button:focus-visible{outline:2px solid #d5dfac;outline-offset:2px}
        .architectural-scene__controls button span{font-size:20px;line-height:1}
        .architectural-scene__controls svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round}
        .architectural-scene--compact .architectural-scene__controls{bottom:12px;padding:3px;gap:1px}
        .architectural-scene--compact .architectural-scene__controls button{width:25px;height:25px}
        .architectural-scene__scale{position:absolute;right:26px;bottom:31px;display:grid;gap:8px;color:#a3ae99;font:9px/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:1px;pointer-events:none}
        .architectural-scene__scale span{width:53px;height:5px;border:1px solid #85917a;border-top:0;position:relative}
        .architectural-scene__scale span:after{content:"";position:absolute;left:50%;bottom:0;height:4px;border-left:1px solid #85917a}
        .architectural-scene__fallback{position:absolute;inset:0;width:100%;height:100%}
        @media(max-width:600px){.architectural-scene{min-height:300px}.architectural-scene--compact{min-height:170px}.architectural-scene__annotation{left:18px;top:20px;letter-spacing:.7px;font-size:8px;gap:6px}.architectural-scene__scale{right:18px;bottom:28px}}
        @media(prefers-reduced-motion:reduce){.architectural-scene__controls button{transition:none}}
      `}</style>
    </div>
  );
}

function ArchitecturalFallback({ variant }: { variant: SceneVariant }) {
  const fallbackId = useId().replace(/:/g, "");
  const gridId = `architectural-grid-${fallbackId}`;
  const wallId = `architectural-wall-${fallbackId}`;
  const city = variant === "city";
  const structure = variant === "structure";
  return <svg className="architectural-scene__fallback" viewBox="0 0 800 550" role="img" aria-label={sceneDescriptions[variant]}>
    <defs>
      <pattern id={gridId} width="48" height="28" patternUnits="userSpaceOnUse" patternTransform="translate(400 335) skewY(-28)"><path d="M0 0H48V28" fill="none" stroke="#77886d" strokeOpacity=".12" /></pattern>
      <linearGradient id={wallId} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ddd9c6" /><stop offset="1" stopColor="#a2aa94" /></linearGradient>
    </defs>
    <rect width="800" height="550" fill={`url(#${gridId})`} />
    <ellipse cx="411" cy="423" rx="224" ry="65" fill="#0d1710" opacity=".25" />
    <path d="m152 339 305-171 223 125-306 174Z" fill="#89967c" /><path d="m152 339 222 125v16L152 354Z" fill="#596a57" /><path d="m374 464 306-171v15L374 480Z" fill="#41533f" />
    <path d="m185 322 272-151 185 104-271 155Z" fill="#c5cbb6" /><path d="m185 322 186 108v12L185 335Z" fill="#8d9b80" />
    {city ? <>
      <path d="m240 307 87-49v-147l-87 49Z" fill="#8faaa0" /><path d="m327 111 64 38v147l-64-38Z" fill="#44665d" /><path d="m240 160 87-49 64 38-86 48Z" fill="#dfdfc8" />
      <path d="m443 304 82-47V75l-82 47Z" fill="#90a397" /><path d="m525 75 68 38v183l-68-39Z" fill="#44645a" /><path d="m443 122 82-47 68 38-82 48Z" fill="#e0e0ca" />
      <path d="m347 377 83-47v-100l-83 47Z" fill="#a5b1a0" /><path d="m430 230 66 38v100l-66-38Z" fill="#5c7665" /><path d="m347 277 83-47 66 38-84 47Z" fill="#d9dcc4" />
      {[145, 172, 200, 226].map((y) => <path key={y} d={`M443 ${y}l82-47 68 38`} stroke="#dfddc6" strokeWidth="5" fill="none" />)}
    </> : <>
      <path d="m249 295 198-110 153 86-198 113Z" fill="#8d9786" /><path d="m249 295 153 89v-96l-153-88Z" fill="#3a5147" /><path d="m402 288 198-112v95L402 384Z" fill={`url(#${wallId})`} />
      <path d="m236 195 204-114 173 96-205 118Z" fill="#e4dfcb" /><path d="m236 195 172 100v12L236 207Z" fill="#b6bba2" /><path d="m408 295 205-118v12L408 307Z" fill="#919e86" />
      {structure ? <>
        <path d="M258 212v83m61-46v82m80-40v90m74-127v83m116-149v78M249 258l153 88 198-113" stroke="#cbcdb4" strokeWidth="9" fill="none" />
      </> : <>
        <path d="M265 218v85m43-60v85m45-59v86M249 284l153 88" stroke="#9b9e80" strokeWidth="4" fill="none" />
        {[0, 1, 2, 3, 4, 5, 6].map((n) => <path key={n} d={`m${431 + n * 10} ${281 - n * 5.7}v81`} stroke="#a48658" strokeWidth="5" />)}
      </>}
    </>}
    <path d="m313 396 62-35 51 29-64 35Z" fill="#d3d4bb" /><path d="m298 411 66-35 57 31-65 36Z" fill="#b3bda2" />
    {[{ x: 208, y: 287 }, { x: 594, y: 317 }, { x: 484, y: 157 }].map(({ x, y }) => <g key={x}><path d={`M${x} ${y}v58`} stroke="#727453" strokeWidth="5" /><path d={`m${x} ${y - 52} 29 40-9 44-41-1-13-35Z`} fill="#829666" /><path d={`m${x} ${y - 52} 29 40-9 44-17-21Z`} fill="#687f50" /></g>)}
  </svg>;
}

export default ArchitecturalScene;
