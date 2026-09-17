import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { InfraDesign } from "../types";
import { buildInfraScene, infraExtent } from "../lib/infra";

/**
 * Infrastructure scene.
 *
 * Renders the guided infrastructure model (highway / airport / port / dam) on
 * a shared orbit view. Rebuilt whenever the design changes; the camera is
 * framed from the site extents on mount.
 */
export function InfraScene({ infra }: { infra: InfraDesign }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const rebuildRef = useRef<(() => void) | null>(null);
  const infraRef = useRef(infra);
  infraRef.current = infra;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b1220");
    const ext = infraExtent(infraRef.current);
    const span = Math.max(ext.w, ext.d);
    scene.fog = new THREE.Fog("#0b1220", span * 1.6, span * 4.5);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.5, span * 12);
    camera.position.set(span * 0.75, span * 0.65, span * 0.95);
    scene.add(camera);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 20;
    controls.maxDistance = span * 6;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 0.85));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.9);
    sun.position.set(span * 0.6, span, span * 0.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = span * 3;
    sun.shadow.camera.left = -span;
    sun.shadow.camera.right = span;
    sun.shadow.camera.top = span;
    sun.shadow.camera.bottom = -span;
    scene.add(sun);

    const grid = new THREE.GridHelper(span * 2, 40, 0x1e293b, 0x1e293b);
    grid.position.y = -0.5;
    grid.material = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.3 });
    scene.add(grid);

    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    const rebuild = () => {
      group.clear();
      group.add(buildInfraScene(infraRef.current));
    };
    rebuildRef.current = rebuild;
    rebuild();

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      scene.environment?.dispose();
      controls.dispose();
      renderer.dispose();
      group.clear();
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rebuildRef.current?.();
  }, [infra]);

  return <div ref={containerRef} className="relative h-full w-full" style={{ touchAction: "none" }} data-scene="infra" />;
}
