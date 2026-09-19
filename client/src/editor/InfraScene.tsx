import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { DraftElement, DraftElementKind, InfraDesign } from "../types";
import type { CadTool } from "../components/CadToolPalette";
import { buildInfraScene, infraExtent } from "../lib/infra";
import { sectionClippingPlanes } from "../lib/section";
import { constrainedDraftPatch } from "../lib/drafting";

/**
 * Infrastructure scene.
 *
 * Renders the guided infrastructure model (highway / airport / port / dam) on
 * a shared orbit view. Rebuilt whenever the design changes; the camera is
 * framed from the site extents on mount.
 */
export function InfraScene({ infra, activeTool = "select", onSelect, onChange }: { infra: InfraDesign; activeTool?: CadTool; onSelect?: (id: string | null) => void; onChange?: (next: InfraDesign) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const rebuildRef = useRef<(() => void) | null>(null);
  const infraRef = useRef(infra);
  const toolRef = useRef(activeTool);
  const handlersRef = useRef({ onSelect, onChange });
  infraRef.current = infra;
  toolRef.current = activeTool;
  handlersRef.current = { onSelect, onChange };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.localClippingEnabled = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
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
      renderer.clippingPlanes = sectionClippingPlanes(infraRef.current.section);
      group.add(buildInfraScene(infraRef.current));
    };
    rebuildRef.current = rebuild;
    rebuild();

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();
    const groundAt = (x: number, y: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(groundPlane, hitPoint) ? hitPoint.clone() : null;
    };
    const pick = (x: number, y: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      for (const hit of raycaster.intersectObject(group, true)) {
        let node: THREE.Object3D | null = hit.object;
        while (node) {
          if (node.userData.selectId) return { id: node.userData.selectId as string, node };
          node = node.parent;
        }
      }
      return null;
    };
    let draw: { kind: DraftElementKind; sx: number; sz: number; ex: number; ez: number } | null = null;
    let drag: { id: string; node: THREE.Object3D; sx: number; sz: number; gx: number; gz: number; moved: boolean } | null = null;
    const drawTools = new Set(["line", "rectangle", "circle", "dimension"]);
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const tool = toolRef.current;
      const ground = groundAt(e.clientX, e.clientY);
      if (!ground) return;
      if (drawTools.has(tool)) {
        draw = { kind: tool as DraftElementKind, sx: ground.x, sz: ground.z, ex: ground.x, ez: ground.z };
        controls.enabled = false;
        renderer.domElement.setPointerCapture?.(e.pointerId);
        return;
      }
      const target = pick(e.clientX, e.clientY);
      handlersRef.current.onSelect?.(target?.id ?? null);
      if (tool !== "move" || !target || !handlersRef.current.onChange) return;
      drag = { id: target.id, node: target.node, sx: target.node.position.x, sz: target.node.position.z, gx: ground.x, gz: ground.z, moved: false };
      controls.enabled = false;
      renderer.domElement.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const ground = groundAt(e.clientX, e.clientY);
      if (!ground) return;
      if (draw) { draw.ex = ground.x; draw.ez = ground.z; return; }
      if (!drag) return;
      const x = drag.sx + ground.x - drag.gx;
      const z = drag.sz + ground.z - drag.gz;
      drag.node.position.set(x, drag.node.position.y, z);
      drag.moved ||= Math.abs(x - drag.sx) > 0.01 || Math.abs(z - drag.sz) > 0.01;
    };
    const onPointerUp = () => {
      if (draw) {
        const current = infraRef.current;
        const w = Math.max(Math.abs(draw.ex - draw.sx), 0.5);
        const d = Math.max(Math.abs(draw.ez - draw.sz), draw.kind === "circle" ? w : 0.1);
        const draft: DraftElement = { id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, kind: draw.kind, x: (draw.sx + draw.ex) / 2, z: (draw.sz + draw.ez) / 2, w: draw.kind === "circle" ? Math.max(w, d) : w, d: draw.kind === "line" || draw.kind === "dimension" ? 0.12 : draw.kind === "circle" ? Math.max(w, d) : d, rotationDeg: draw.kind === "line" || draw.kind === "dimension" ? Math.atan2(draw.ez - draw.sz, draw.ex - draw.sx) * 180 / Math.PI : 0, color: draw.kind === "line" || draw.kind === "dimension" ? "#f2c14e" : "#a3c77b", civilKind: draw.kind === "dimension" ? "grade" : "contour" };
        draw = null;
        controls.enabled = true;
        handlersRef.current.onChange?.({ ...current, drafts: [...(current.drafts ?? []), draft] });
        handlersRef.current.onSelect?.(draft.id);
        return;
      }
      if (!drag) return;
      const current = infraRef.current;
      const item = current.drafts?.find((d) => d.id === drag?.id);
      if (drag.moved && item) handlersRef.current.onChange?.({ ...current, drafts: current.drafts?.map((d) => d.id === item.id ? { ...d, ...constrainedDraftPatch(d, { x: drag!.node.position.x, z: drag!.node.position.z }, current.drafts ?? []) } : d) });
      drag = null;
      controls.enabled = true;
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);

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
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
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
