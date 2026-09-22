import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Design, FurnitureItem } from "../types";
import { addTechnicalEdges } from "../lib/modelcore";
import { buildFurniture, catalogEntry, furnitureMount } from "../lib/catalog";
import { buildMepScene } from "../lib/mep";

const MM = 0.001;
const WALL_THICKNESS = 120;

export interface EditorApi {
  resetView(): void;
  topView(): void;
  frontView(): void;
  exportGlb(): Promise<Blob>;
}

interface Canvas3DProps {
  design: Design;
  photoUrl: string | null;
  showPhoto: boolean;
  photoOpacity: number;
  selectedId: string | null;
  onChange: (design: Design) => void;
  onSelect: (id: string | null) => void;
  onApiReady: (api: EditorApi | null) => void;
}

export function buildRoomParts(design: Design): THREE.Group {
  const { room } = design;
  const group = new THREE.Group();

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(room.widthMm * MM, 20 * MM, room.depthMm * MM),
    new THREE.MeshStandardMaterial({ color: room.floorColor, roughness: 0.9 }),
  );
  floor.position.y = -10 * MM;
  floor.receiveShadow = true;
  group.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: room.wallColor, roughness: 0.9 });
  const wallGeometry = new THREE.BoxGeometry(1, 1, 1);
  const mkWall = (
    x: number, y: number, z: number,
    w: number, d: number, h: number,
    rotY = 0,
  ) => {
    const box = new THREE.Mesh(wallGeometry, wallMat);
    box.position.set(x, y, z);
    box.rotation.y = rotY;
    box.scale.set(w * MM, h * MM, d * MM);
    box.receiveShadow = true;
    group.add(box);
  };

  mkWall(0, room.wallHeightMm / 2 * MM, room.depthMm / 2 * MM, room.widthMm, WALL_THICKNESS, room.wallHeightMm);
  mkWall(0, room.wallHeightMm / 2 * MM, -room.depthMm / 2 * MM, room.widthMm, WALL_THICKNESS, room.wallHeightMm);
  mkWall(room.widthMm / 2 * MM, room.wallHeightMm / 2 * MM, 0, WALL_THICKNESS, room.depthMm, room.wallHeightMm);
  mkWall(-room.widthMm / 2 * MM, room.wallHeightMm / 2 * MM, 0, WALL_THICKNESS, room.depthMm, room.wallHeightMm);

  return group;
}

export function buildCurtainParts(design: Design): THREE.Group | null {
  const cur = design.curtains;
  if (!cur?.enabled) return null;
  const { room } = design;
  const group = new THREE.Group();

  const wallLength = cur.wall === "north" || cur.wall === "south" ? room.widthMm : room.depthMm;
  const panelWidth = Math.max(wallLength * cur.widthPercentPerPanel, 300);
  const panelHeight = Math.max(room.wallHeightMm * cur.heightPercent, 800) * MM;
  const isSheer = cur.style === "sheer";
  const mat = new THREE.MeshStandardMaterial({
    color: cur.color,
    roughness: 0.95,
    side: THREE.DoubleSide,
    transparent: isSheer,
    opacity: isSheer ? 0.65 : 1,
  });
  const rodMat = new THREE.MeshStandardMaterial({ color: "#3a3a3a", metalness: 0.6, roughness: 0.4 });

  const panels = 2;
  for (let i = 0; i < panels; i++) {
    const offset = (i - (panels - 1) / 2) * panelWidth;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(panelWidth * MM, panelHeight), mat);
    panel.userData.noSelect = true;
    const wallOffset = (room.depthMm / 2 - WALL_THICKNESS / 2 - 20) * MM;
    const wallOffsetX = (room.widthMm / 2 - WALL_THICKNESS / 2 - 20) * MM;
    if (cur.wall === "north") {
      panel.position.set(offset * MM, panelHeight / 2, wallOffset);
    } else if (cur.wall === "south") {
      panel.position.set(offset * MM, panelHeight / 2, -wallOffset);
      panel.rotation.y = Math.PI;
    } else if (cur.wall === "east") {
      panel.position.set(wallOffsetX, panelHeight / 2, offset * MM);
      panel.rotation.y = Math.PI / 2;
    } else {
      panel.position.set(-wallOffsetX, panelHeight / 2, offset * MM - 0);
      panel.rotation.y = -Math.PI / 2;
    }
    group.add(panel);
  }

  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(14 * MM, 14 * MM, (wallLength + 400) * MM),
    rodMat,
  );
  rod.position.y = (room.wallHeightMm - 60) * MM;
  if (cur.wall === "north" || cur.wall === "south") {
    rod.rotation.z = Math.PI / 2;
  } else {
    rod.rotation.x = Math.PI / 2;
  }
  rod.userData.noSelect = true;
  group.add(rod);

  return group;
}

export function Canvas3D({
  design,
  photoUrl,
  showPhoto,
  photoOpacity,
  selectedId,
  onChange,
  onSelect,
  onApiReady,
}: Canvas3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const roomGroupRef = useRef<THREE.Group | null>(null);
  const curtainGroupRef = useRef<THREE.Group | null>(null);
  const mepGroupRef = useRef<THREE.Group | null>(null);
  const photoGroupRef = useRef<THREE.Group | null>(null);
  const itemGroups = useRef(new Map<string, { group: THREE.Group; sig: string }>());
  const pendingItemPatches = useRef(new Map<string, Partial<FurnitureItem>>());
  const pendingItemRaf = useRef(0);
  const selectionRingRef = useRef<THREE.Mesh | null>(null);
  const dragState = useRef<{
    id: string;
    plane: THREE.Plane;
    offset: THREE.Vector3;
    moved: boolean;
    mounted: boolean;
  } | null>(null);

  const designRef = useRef(design);
  designRef.current = design;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const container = containerRef.current!;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#10141c");
    scene.fog = new THREE.Fog("#10141c", 14, 30);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 200);
    camera.position.set(5.5, 4.2, 6.2);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, container.clientWidth < 900 ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;
    pmrem.dispose();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 + 0.12;
    controls.minDistance = 1.5;
    controls.maxDistance = 25;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight("#dfe8ff", "#3a2f25", 1.05));
    const sun = new THREE.DirectionalLight("#fff4e0", 2.4);
    sun.position.set(6, 10, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    scene.add(sun);

    const grid = new THREE.GridHelper(14, 14, 0x2b3444, 0x1c2432);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.7;
    grid.position.y = 0.005;
    scene.add(grid);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.45, 48),
      new THREE.MeshBasicMaterial({ color: "#34d399", side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.56, 48),
      new THREE.MeshBasicMaterial({ color: "#22d3ee", side: THREE.DoubleSide, transparent: true, opacity: 0.35 }),
    );
    glow.rotation.x = -Math.PI / 2;
    ring.add(glow);
    scene.add(ring);
    selectionRingRef.current = ring;

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const getIntersects = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const meshes: THREE.Mesh[] = [];
      for (const { group } of itemGroups.current.values()) {
        group.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && !o.userData.noSelect) meshes.push(o as THREE.Mesh);
        });
      }
      return raycaster.intersectObjects(meshes, false);
    };

    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      mutatePointer(e);
      if (dragState.current) return;
      const hits = getIntersects(e);
      if (hits.length === 0) {
        onSelectRef.current(null);
        return;
      }
      let itemId: string | null = null;
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj) {
          if (obj.userData.itemId) {
            itemId = obj.userData.itemId as string;
            break;
          }
          obj = obj.parent;
        }
        if (itemId) break;
      }
      if (!itemId) {
        onSelectRef.current(null);
        return;
      }
      const item = designRef.current.furniture.find((f) => f.id === itemId);
      const mount = item?.mount ?? furnitureMount(item?.type ?? "");
      const wall = item?.mountWall ?? "north";
      const halfW = designRef.current.room.widthMm * MM / 2;
      const halfD = designRef.current.room.depthMm * MM / 2;
      const plane = mount === "wall"
        ? wall === "north" || wall === "south"
          ? new THREE.Plane(new THREE.Vector3(0, 0, 1), -(wall === "north" ? halfD - 0.16 : -halfD + 0.16))
          : new THREE.Plane(new THREE.Vector3(1, 0, 0), -(wall === "east" ? halfW - 0.16 : -halfW + 0.16))
        : dragPlane;
      controls.enabled = false;
      const nearest = hits.find((h) => h.object.userData.itemId === itemId) ?? hits[0];
      dragState.current = {
        id: itemId,
        plane,
        offset: new THREE.Vector3(0, 0, 0),
        moved: false,
        mounted: mount === "wall",
      };
      if (nearest.point) {
        const planeHit = new THREE.Vector3().copy(nearest.point);
        const group = itemGroups.current.get(itemId);
        if (group) {
          dragState.current.offset.subVectors(group.group.position, planeHit);
        }
      }
      onSelectRef.current(itemId);
    };

    const onPointerMove = (e: PointerEvent) => {
      mutatePointer(e);
      if (!dragState.current) return;
      const state = dragState.current;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(state.plane, hit)) return;
      const group = itemGroups.current.get(state.id);
      if (!group) return;
      const pos = hit.add(state.offset);
      const room = designRef.current.room;
      const halfW = room.widthMm / 2 - 250;
      const halfD = room.depthMm / 2 - 250;
      const itemX = Math.max(-halfW, Math.min(halfW, Math.round(pos.x / MM)));
      const itemZ = Math.max(-halfD, Math.min(halfD, Math.round(pos.z / MM)));
       group.group.position.x = itemX * MM;
       group.group.position.z = itemZ * MM;
       if (state.mounted) group.group.position.y = Math.max(0.3, Math.min(room.wallHeightMm * MM - 0.3, pos.y));
       state.moved = true;
       updateDesignItem(state.id, { x: itemX, z: itemZ, ...(state.mounted ? { mountHeightM: group.group.position.y } : {}) });
      if (selectionRingRef.current) {
        selectionRingRef.current.position.copy(group.group.position);
      }
    };

    const onPointerUp = () => {
      if (dragState.current) {
        flushDesignItemPatches();
        dragState.current = null;
        controls.enabled = true;
      }
    };

    const mutatePointer = (e: PointerEvent) => renderer.domElement.setPointerCapture?.(e.pointerId);

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    onApiReady({
      resetView() {
        camera.position.set(5.5, 4.2, 6.2);
        controls.target.set(0, 0, 0);
      },
      topView() {
        camera.position.set(0, 11.5, 0.01);
        controls.target.set(0, 0, 0);
      },
      frontView() {
        camera.position.set(0, 2.2, 9.5);
        controls.target.set(0, 1.2, 0);
      },
      async exportGlb() {
        const ring = selectionRingRef.current;
        const gridVisible = grid.visible;
        const photoParent = photoGroupRef.current?.parent;
        if (ring) ring.visible = false;
        grid.visible = false;
        if (photoParent && photoGroupRef.current) photoParent.remove(photoGroupRef.current);
        try {
          const blob = await new Promise<Blob>((resolve, reject) => {
            const exporter = new GLTFExporter();
            exporter.parse(
              scene,
              (result) => {
                if (result instanceof ArrayBuffer) {
                  resolve(new Blob([result], { type: "model/gltf-binary" }));
                } else {
                  resolve(new Blob([JSON.stringify(result)], { type: "model/gltf-binary" }));
                }
              },
              (err) => reject(new Error(err instanceof ErrorEvent ? err.message : String(err))),
              { binary: true },
            );
          });
          return blob;
        } finally {
          if (ring) ring.visible = true;
          grid.visible = gridVisible;
          if (photoParent && photoGroupRef.current) photoParent.add(photoGroupRef.current);
        }
      },
    });

    return () => {
      cancelAnimationFrame(pendingItemRaf.current);
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      scene.environment?.dispose();
      disposeGroup(scene);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Room + curtains build */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (roomGroupRef.current) {
      scene.remove(roomGroupRef.current);
      disposeGroup(roomGroupRef.current);
      roomGroupRef.current = null;
    }
    if (curtainGroupRef.current) {
      scene.remove(curtainGroupRef.current);
      disposeGroup(curtainGroupRef.current);
      curtainGroupRef.current = null;
    }
    if (mepGroupRef.current) {
      scene.remove(mepGroupRef.current);
      disposeGroup(mepGroupRef.current);
      mepGroupRef.current = null;
    }

    const room = buildRoomParts(design);
    addTechnicalEdges(room, "#334155", 0.7);
    scene.add(room);
    roomGroupRef.current = room;
    const mep = buildMepScene(design.mep);
    scene.add(mep);
    mepGroupRef.current = mep;

    const curtain = buildCurtainParts(design);
    if (curtain) scene.add(curtain);
    curtainGroupRef.current = curtain;
  }, [design.room, design.curtains, design.mep]);

  /* Photo overlay */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (photoGroupRef.current) {
      scene.remove(photoGroupRef.current);
      disposeGroup(photoGroupRef.current);
      photoGroupRef.current = null;
    }
    if (!photoUrl || !showPhoto) return;
    const texture = new THREE.TextureLoader().load(photoUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    const { widthMm: W, depthMm: D } = design.room;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(W * MM, D * MM),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: photoOpacity, depthWrite: false }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.012;
    plane.userData.noSelect = true;
    plane.receiveShadow = false;
    photoGroupRef.current = new THREE.Group();
    photoGroupRef.current.add(plane);
    scene.add(photoGroupRef.current);
  }, [photoUrl, showPhoto, photoOpacity, design.room.widthMm, design.room.depthMm]);

  /* Furniture sync */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const desired = new Map(design.furniture.map((f) => [f.id, f]));

    for (const [id, rec] of itemGroups.current) {
      if (!desired.has(id)) {
        scene.remove(rec.group);
        disposeGroup(rec.group);
        itemGroups.current.delete(id);
      }
    }

    for (const item of desired.values()) {
      const sig = `${item.type}|${item.color}|${item.scale}|${item.mount ?? ""}|${item.mountWall ?? "north"}|${design.room.widthMm}|${design.room.depthMm}|${design.room.wallHeightMm}`;
      let rec = itemGroups.current.get(item.id);
      if (!rec || rec.sig !== sig) {
        if (rec) {
          scene.remove(rec.group);
          disposeGroup(rec.group);
        }
        const group = buildFurniture({ type: item.type, color: item.color, scale: item.scale });
        addTechnicalEdges(group, "#334155", 0.7);
        group.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.userData.itemId = item.id;
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        const mount = item.mount ?? furnitureMount(item.type);
        const room = designRef.current.room;
        const itemHeight = (catalogEntry(item.type)?.h ?? 0) * MM * item.scale;
        const wall = item.mountWall ?? "north";
        const halfW = room.widthMm * MM / 2;
        const halfD = room.depthMm * MM / 2;
        if (mount === "ceiling") {
          group.position.set(item.x * MM, item.mountHeightM ?? Math.max(room.wallHeightMm * MM - itemHeight, 0.2), item.z * MM);
        } else if (mount === "wall") {
          const y = item.mountHeightM ?? Math.max(room.wallHeightMm * MM - itemHeight - 0.25, 0.3);
          if (wall === "north") group.position.set(item.x * MM, y, halfD - 0.16);
          if (wall === "south") group.position.set(item.x * MM, y, -halfD + 0.16);
          if (wall === "east") group.position.set(halfW - 0.16, y, item.z * MM);
          if (wall === "west") group.position.set(-halfW + 0.16, y, item.z * MM);
        } else {
          group.position.set(item.x * MM, 0, item.z * MM);
        }
        group.rotation.y = (item.rotationDeg * Math.PI) / 180 + (mount === "wall" && (wall === "east" || wall === "west") ? Math.PI / 2 : 0);
        scene.add(group);
        rec = { group, sig };
        itemGroups.current.set(item.id, rec);
      } else {
        groupSync(rec.group, item, sig, design.room);
      }
    }
  }, [design.furniture, design.room.widthMm, design.room.depthMm, design.room.wallHeightMm]);

  /* Selection ring follow */
  useEffect(() => {
    const ring = selectionRingRef.current;
    if (!ring) return;
    if (!selectedId) {
      ring.visible = false;
      return;
    }
    const rec = itemGroups.current.get(selectedId);
    if (!rec) {
      ring.visible = false;
      return;
    }
    ring.visible = true;
    ring.position.copy(rec.group.position);
    ring.position.y += 0.02;
  }, [selectedId, design.furniture]);

  /* internal helper - updates a furniture item transform w/o rebuild */
  const flushDesignItemPatches = () => {
    pendingItemRaf.current = 0;
    if (!pendingItemPatches.current.size) return;
    const patches = new Map(pendingItemPatches.current);
    pendingItemPatches.current.clear();
    const d = designRef.current;
    onChangeRef.current({
      ...d,
      furniture: d.furniture.map((f) => {
        const patch = patches.get(f.id);
        return patch ? { ...f, ...patch } : f;
      }),
    });
  };

  const updateDesignItem = (id: string, patch: Partial<FurnitureItem>) => {
    const previous = pendingItemPatches.current.get(id);
    pendingItemPatches.current.set(id, { ...previous, ...patch });
    if (!pendingItemRaf.current) pendingItemRaf.current = requestAnimationFrame(flushDesignItemPatches);
  };

  return <div ref={containerRef} className="h-full w-full cursor-grab active:cursor-grabbing" />;
}

function groupSync(group: THREE.Group, item: FurnitureItem, sig: string, room: Design["room"]) {
  const mount = item.mount ?? furnitureMount(item.type);
  const wall = item.mountWall ?? "north";
  const itemHeight = (catalogEntry(item.type)?.h ?? 0) * MM * item.scale;
  const halfW = room.widthMm * MM / 2;
  const halfD = room.depthMm * MM / 2;
  if (mount === "ceiling") {
    group.position.set(item.x * MM, item.mountHeightM ?? Math.max(room.wallHeightMm * MM - itemHeight, 0.2), item.z * MM);
  } else if (mount === "wall") {
    const y = item.mountHeightM ?? Math.max(room.wallHeightMm * MM - itemHeight - 0.25, 0.3);
    if (wall === "north") group.position.set(item.x * MM, y, halfD - 0.16);
    if (wall === "south") group.position.set(item.x * MM, y, -halfD + 0.16);
    if (wall === "east") group.position.set(halfW - 0.16, y, item.z * MM);
    if (wall === "west") group.position.set(-halfW + 0.16, y, item.z * MM);
  } else {
    group.position.set(item.x * MM, 0, item.z * MM);
  }
  group.rotation.y = (item.rotationDeg * Math.PI) / 180 + (mount === "wall" && (wall === "east" || wall === "west") ? Math.PI / 2 : 0);
  group.userData.sig = sig;
}

function disposeGroup(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      if (mesh.geometry) geometries.add(mesh.geometry);
      const m = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const ma of m) materials.add(ma);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const ma of materials) {
    const texture = (ma as THREE.MeshStandardMaterial).map;
    texture?.dispose();
    ma.dispose();
  }
}
