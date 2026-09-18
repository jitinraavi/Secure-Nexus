import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DoorFacing, FurnitureItem, InteriorRoom, RoomOpening, RoomWall } from "../types";
import { Button, Input, Modal } from "../components/ui";
import { buildFurniture, catalogEntry, furnitureMount } from "../lib/catalog";
import { cn } from "../lib/cn";
import { uid } from "../lib/modelcore";
import { describeObject, furnitureDimMm, parseObjectQuery } from "../lib/objects";

/**
 * In-room furniture editor.
 *
 * A focused three.js view of a single room where furniture can be dragged on
 * the floor, rotated, renamed, duplicated and deleted. Everything is offline:
 * objects come from the catalog and the right-click actions are local.
 */

interface RoomEditorProps {
  room: InteriorRoom;
  title?: string;
  onClose: () => void;
  onChange: (room: InteriorRoom) => void;
}

const WALL_H = 2.7;
const DOOR_FACING_LABELS: Record<DoorFacing, string> = {
  north: "North",
  east: "East",
  south: "South",
  west: "West",
};

export function RoomEditor({ room, title, onClose, onChange }: RoomEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const rebuildRef = useRef<(() => void) | null>(null);
  const roomRef = useRef(room);
  const selectedRef = useRef<string | null>(null);
  const handlersRef = useRef({ onChange });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [genText, setGenText] = useState("");
  const [ctx, setCtx] = useState<{ id: string; clientX: number; clientY: number } | null>(null);

  roomRef.current = room;
  selectedRef.current = selectedId;
  handlersRef.current = { onChange };

  const selected = (room.furniture ?? []).find((f) => f.id === selectedId) ?? null;

  const patchFurniture = (id: string, patch: Partial<FurnitureItem>) =>
    onChange({ ...room, furniture: (room.furniture ?? []).map((f) => (f.id === id ? { ...f, ...patch } : f)) });

  const removeFurniture = (id: string) => {
    onChange({ ...room, furniture: (room.furniture ?? []).filter((f) => f.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };

  const duplicateFurniture = (id: string) => {
    const item = (room.furniture ?? []).find((f) => f.id === id);
    if (!item) return;
    const copy = { ...item, id: uid("fu"), x: item.x + 0.6, z: item.z + 0.6 };
    onChange({ ...room, furniture: [...(room.furniture ?? []), copy] });
    setSelectedId(copy.id);
  };

  const addOpening = (kind: RoomOpening["kind"]) => {
    const opening: RoomOpening = {
      id: uid("op"),
      kind,
      wall: room.doorFacing,
      offsetM: 0,
      widthM: kind === "door" ? 1 : 1.5,
      heightM: kind === "door" ? 2.1 : 1.3,
      sillM: kind === "door" ? 0 : 0.9,
    };
    onChange({ ...room, openings: [...(room.openings ?? []), opening] });
  };

  const patchOpening = (id: string, patch: Partial<RoomOpening>) =>
    onChange({ ...room, openings: (room.openings ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)) });

  const addFromText = (text: string): boolean => {
    const parsed = parseObjectQuery(text);
    if (!parsed || parsed.recipe.kind !== "furniture") return false;
    const catalogId = parsed.recipe.catalogId;
    const dim = furnitureDimMm(catalogId);
    const color = catalogEntry(catalogId)?.defaultColor ?? "#90a4ae";
    const name = parsed.recipe.name;
    const items: FurnitureItem[] = [];
    for (let i = 0; i < parsed.qty; i++) {
      // Lay duplicates out in a small row from the room centre, clamped inside.
      const step = Math.max(dim.w / 1000, 0.6) + 0.2;
      const offset = (i - (parsed.qty - 1) / 2) * step;
      const halfW = room.w / 2 - dim.w / 2000;
      items.push({
        id: uid("fu"),
        type: catalogId,
        name: parsed.qty > 1 ? `${name} ${i + 1}` : name,
        x: Math.max(-halfW, Math.min(halfW, Math.round(offset * 100) / 100)),
        z: 0,
        rotationDeg: 0,
        scale: 1,
        color,
        mount: furnitureMount(catalogId),
        mountWall: "north",
      });
    }
    onChange({ ...room, furniture: [...(room.furniture ?? []), ...items] });
    return true;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b1220");
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.05, 200);
    const roomSpan = Math.max(roomRef.current.w, roomRef.current.d, 4);
    camera.position.set(roomSpan * 0.9, roomSpan * 0.85, roomSpan * 1.1);
    scene.add(camera);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 1.5;
    controls.maxDistance = roomSpan * 6;
    controls.target.set(0, 1, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 0.9));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.4);
    sun.position.set(6, 12, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 40;
    sun.shadow.camera.left = -roomSpan;
    sun.shadow.camera.right = roomSpan;
    sun.shadow.camera.top = roomSpan;
    sun.shadow.camera.bottom = -roomSpan;
    scene.add(sun);

    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    const floorMat = new THREE.MeshStandardMaterial({ color: "#d7cdbf", roughness: 0.9 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.95, side: THREE.DoubleSide });

    const buildRoom = () => {
      const r = roomRef.current;
      group.clear();

      const floor = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.08, r.d), floorMat);
      floor.position.y = -0.04;
      floor.receiveShadow = true;
      group.add(floor);

      const halfW = r.w / 2;
      const halfD = r.d / 2;
      const t = 0.12;
      const door = 1.0;
      const walls: [number, number, number, number][] = [
        [0, halfD, r.w, t],
        [0, -halfD, r.w, t],
        [-halfW, 0, t, r.d],
        [halfW, 0, t, r.d],
      ];
      walls.forEach(([x, z, w, d]) => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
        wall.position.set(x, WALL_H / 2, z);
        wall.receiveShadow = true;
        group.add(wall);
      });

       const openings = r.openings ?? [];
       if (!openings.some((o) => o.kind === "door")) {
         const marker = new THREE.Mesh(
           new THREE.BoxGeometry(door, WALL_H * 0.85, 0.05),
           new THREE.MeshStandardMaterial({ color: "#7c4a2d", roughness: 0.7 }),
         );
         const facing = r.doorFacing;
         if (facing === "north") marker.position.set(0, WALL_H * 0.425, halfD - 0.08);
         if (facing === "south") marker.position.set(0, WALL_H * 0.425, -halfD + 0.08);
         if (facing === "east") {
           marker.position.set(halfW - 0.08, WALL_H * 0.425, 0);
           marker.rotation.y = Math.PI / 2;
         }
         if (facing === "west") {
           marker.position.set(-halfW + 0.08, WALL_H * 0.425, 0);
           marker.rotation.y = Math.PI / 2;
         }
         group.add(marker);
       }
       for (const opening of openings) {
         const openingMesh = new THREE.Mesh(
           new THREE.BoxGeometry(opening.widthM, opening.heightM, 0.06),
           new THREE.MeshStandardMaterial({
             color: opening.kind === "door" ? "#7c4a2d" : "#5aa7c7",
             roughness: opening.kind === "door" ? 0.7 : 0.2,
             metalness: opening.kind === "window" ? 0.15 : 0,
             transparent: opening.kind === "window",
             opacity: opening.kind === "window" ? 0.72 : 1,
           }),
         );
         const y = (opening.kind === "door" ? 0 : opening.sillM) + opening.heightM / 2;
         if (opening.wall === "north") openingMesh.position.set(opening.offsetM, y, halfD - 0.08);
         if (opening.wall === "south") openingMesh.position.set(opening.offsetM, y, -halfD + 0.08);
         if (opening.wall === "east") {
           openingMesh.position.set(halfW - 0.08, y, opening.offsetM);
           openingMesh.rotation.y = Math.PI / 2;
         }
         if (opening.wall === "west") {
           openingMesh.position.set(-halfW + 0.08, y, opening.offsetM);
           openingMesh.rotation.y = Math.PI / 2;
         }
         openingMesh.userData.noSelect = true;
         group.add(openingMesh);
       }

      for (const item of r.furniture ?? []) {
        const node = buildFurniture(item);
        const mount = item.mount ?? furnitureMount(item.type);
        const itemHeight = (catalogEntry(item.type)?.h ?? 0) * 0.001 * item.scale;
        const wall = item.mountWall ?? "north";
        if (mount === "ceiling") {
          node.position.set(item.x, item.mountHeightM ?? Math.max(WALL_H - itemHeight, 0.2), item.z);
        } else if (mount === "wall") {
          node.position.y = item.mountHeightM ?? Math.max(WALL_H - itemHeight - 0.25, 0.3);
          if (wall === "north") node.position.set(item.x, node.position.y, halfD - 0.16);
          if (wall === "south") node.position.set(item.x, node.position.y, -halfD + 0.16);
          if (wall === "east") {
            node.position.set(halfW - 0.16, node.position.y, item.z);
            node.rotation.y = Math.PI / 2;
          }
          if (wall === "west") {
            node.position.set(-halfW + 0.16, node.position.y, item.z);
            node.rotation.y = Math.PI / 2;
          }
        } else {
          node.position.set(item.x, 0, item.z);
        }
        node.rotation.y = (item.rotationDeg * Math.PI) / 180;
        if (mount === "wall" && (wall === "east" || wall === "west")) node.rotation.y += Math.PI / 2;
        node.userData.selectId = item.id;
        node.userData.selectKind = "furniture";
        group.add(node);

        if (item.id === selectedRef.current) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.35, 0.45, 32),
            new THREE.MeshBasicMaterial({ color: 0x34d399, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(item.x, 0.02, item.z);
          group.add(ring);
        }
      }

      controls.target.set(0, 1, 0);
      controls.update();
    };

    rebuildRef.current = buildRoom;
    buildRoom();

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    /* ------------------------------ Interaction ------------------------------ */
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const setNdc = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
    };

    const pick = (clientX: number, clientY: number): string | null => {
      setNdc(clientX, clientY);
      const hits = raycaster.intersectObject(group, true);
      for (const hit of hits) {
        let node: THREE.Object3D | null = hit.object;
        while (node) {
          if (node.userData?.selectId) return node.userData.selectId as string;
          node = node.parent;
        }
      }
      return null;
    };

    let drag: { id: string; node: THREE.Object3D; plane: THREE.Plane; offset: THREE.Vector3; moved: boolean; mounted: boolean } | null = null;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const id = pick(e.clientX, e.clientY);
      setSelectedId(id);
      if (!id) return;
      const node = group.children.find((c) => c.userData?.selectId === id) ?? null;
      const item = (roomRef.current.furniture ?? []).find((f) => f.id === id);
      if (!node || !item) return;
      const mounted = (item.mount ?? furnitureMount(item.type)) === "wall";
      const wall = item.mountWall ?? "north";
      const r = roomRef.current;
      const halfW = r.w / 2;
      const halfD = r.d / 2;
      const plane = mounted
        ? wall === "north" || wall === "south"
          ? new THREE.Plane(new THREE.Vector3(0, 0, 1), -(wall === "north" ? halfD - 0.16 : -halfD + 0.16))
          : new THREE.Plane(new THREE.Vector3(1, 0, 0), -(wall === "east" ? halfW - 0.16 : -halfW + 0.16))
        : groundPlane;
      setNdc(e.clientX, e.clientY);
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) return;
      drag = { id, node, plane, offset: new THREE.Vector3().subVectors(node.position, hit), moved: false, mounted };
      controls.enabled = false;
      renderer.domElement.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!drag) return;
      setNdc(e.clientX, e.clientY);
      const hit = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!hit) return;
      const point = hit.add(drag.offset);
      const r = roomRef.current;
      const item = (r.furniture ?? []).find((f) => f.id === drag!.id);
      const dim = furnitureDimMm(item?.type ?? "");
      const halfW = Math.max(r.w / 2 - dim.w / 2000, 0);
      const halfD = Math.max(r.d / 2 - dim.d / 2000, 0);
      if (drag.mounted) {
        drag.node.position.x = Math.max(-halfW, Math.min(halfW, point.x));
        drag.node.position.y = Math.max(0.3, Math.min(WALL_H - 0.3, point.y));
        drag.node.position.z = Math.max(-halfD, Math.min(halfD, point.z));
        drag.moved = true;
      } else {
        const nx = Math.max(-halfW, Math.min(halfW, point.x));
        const nz = Math.max(-halfD, Math.min(halfD, point.z));
        drag.node.position.x = nx;
        drag.node.position.z = nz;
        drag.moved = true;
      }
    };

    const onPointerUp = () => {
      if (!drag) return;
      const { id, node, moved, mounted } = drag;
      drag = null;
      controls.enabled = true;
      if (!moved) return;
      const current = roomRef.current;
      handlersRef.current.onChange({
        ...current,
        furniture: (current.furniture ?? []).map((f) =>
          f.id === id ? { ...f, x: Math.round(node.position.x * 100) / 100, z: Math.round(node.position.z * 100) / 100, ...(mounted ? { mountHeightM: Math.round(node.position.y * 100) / 100 } : {}) } : f,
        ),
      });
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const id = pick(e.clientX, e.clientY);
      if (!id) {
        setCtx(null);
        return;
      }
      setSelectedId(id);
      setCtx({ id, clientX: e.clientX, clientY: e.clientY });
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

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
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      controls.dispose();
      renderer.dispose();
      group.clear();
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rebuildRef.current?.();
  }, [room, selectedId]);

  return (
    <Modal open onClose={onClose} title={title ?? room.name} wide>
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="relative min-h-[340px] flex-1 overflow-hidden rounded-xl border border-slate-800 bg-[#0b1220]">
          <div ref={containerRef} className="h-full w-full" style={{ touchAction: "none" }} data-scene="room" />
          <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-slate-950/80 px-2.5 py-1.5 text-[11px] text-slate-300 backdrop-blur">
             {room.w} × {room.d} m · door {DOOR_FACING_LABELS[room.doorFacing]} · drag furniture · right-click for actions
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-3 lg:w-64">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={genText}
              onChange={(e) => setGenText(e.target.value)}
              placeholder="Add: sofa, queen bed, lamp…"
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900/70 px-2.5 py-2 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500"
            />
            <Button
              size="sm"
              onClick={() => {
                if (addFromText(genText)) setGenText("");
              }}
              disabled={!genText.trim()}
            >
              Add
            </Button>
          </div>
          {genText.trim() && (() => {
            const parsed = parseObjectQuery(genText);
            const ok = parsed && parsed.recipe.kind === "furniture";
            return (
              <p className={cn("text-[11px]", ok ? "text-emerald-400" : "text-rose-400")}>
                {ok && parsed ? describeObject(parsed) : "Not a furniture item — try sofa, bed, table, chair, rug, plant."}
              </p>
            );
          })()}

          {selected ? (
            <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Selected</p>
               <Input label="Name" value={selected.name} onChange={(e) => patchFurniture(selected.id, { name: e.target.value })} />
               <div className="grid grid-cols-2 gap-2">
                 <label className="text-[11px] text-slate-400">Mounting<select value={selected.mount ?? furnitureMount(selected.type)} onChange={(e) => patchFurniture(selected.id, { mount: e.target.value as FurnitureItem["mount"] })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200"><option value="unassigned">Choose placement</option><option value="floor">Floor</option><option value="wall">Wall</option><option value="ceiling">Ceiling</option></select></label>
                 {(selected.mount ?? furnitureMount(selected.type)) === "wall" && <label className="text-[11px] text-slate-400">Wall<select value={selected.mountWall ?? "north"} onChange={(e) => patchFurniture(selected.id, { mountWall: e.target.value as RoomWall })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200"><option value="north">North</option><option value="east">East</option><option value="south">South</option><option value="west">West</option></select></label>}
               </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Colour</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={selected.color}
                      onChange={(e) => patchFurniture(selected.id, { color: e.target.value })}
                      className="h-8 w-10 cursor-pointer rounded border border-slate-700 bg-transparent"
                    />
                    <span className="font-mono text-[11px] text-slate-500">{selected.color}</span>
                  </div>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Scale {selected.scale.toFixed(2)}×</span>
                  <input
                    type="range"
                    min={0.5}
                    max={1.5}
                    step={0.05}
                    value={selected.scale}
                    onChange={(e) => patchFurniture(selected.id, { scale: Number(e.target.value) })}
                    className="w-full accent-emerald-500"
                  />
                </label>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => patchFurniture(selected.id, { rotationDeg: (selected.rotationDeg + 270) % 360 })}>⟲</Button>
                <Button size="sm" variant="secondary" onClick={() => patchFurniture(selected.id, { rotationDeg: (selected.rotationDeg + 90) % 360 })}>⟳</Button>
                <Button size="sm" variant="secondary" onClick={() => duplicateFurniture(selected.id)}>Copy</Button>
                <Button size="sm" variant="danger" onClick={() => removeFurniture(selected.id)}>Del</Button>
              </div>
            </div>
          ) : (
            <p className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-500">
              Click a piece to select it, or drag it across the floor.
            </p>
          )}

          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Walls & openings</p>
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" onClick={() => addOpening("window")}>+ Window</Button>
                <Button size="sm" variant="secondary" onClick={() => addOpening("door")}>+ Door</Button>
              </div>
            </div>
            {(room.openings ?? []).map((opening, index) => (
              <div key={opening.id} className="rounded-lg border border-slate-800 p-2">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">Opening {index + 1}</span>
                  <button onClick={() => onChange({ ...room, openings: room.openings?.filter((o) => o.id !== opening.id) })} className="text-[11px] font-semibold text-rose-400">Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={opening.kind} onChange={(e) => patchOpening(opening.id, { kind: e.target.value as RoomOpening["kind"] })} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200"><option value="window">Window</option><option value="door">Door</option></select>
                  <select value={opening.wall} onChange={(e) => patchOpening(opening.id, { wall: e.target.value as RoomOpening["wall"] })} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200"><option value="north">North wall</option><option value="east">East wall</option><option value="south">South wall</option><option value="west">West wall</option></select>
                  <Input label="Offset" type="number" value={opening.offsetM} step={0.1} onChange={(e) => patchOpening(opening.id, { offsetM: Number(e.target.value) || 0 })} />
                  <Input label="Width" type="number" min={0.3} step={0.1} value={opening.widthM} onChange={(e) => patchOpening(opening.id, { widthM: Math.max(Number(e.target.value) || 0.3, 0.3) })} />
                  <Input label="Height" type="number" min={0.3} step={0.1} value={opening.heightM} onChange={(e) => patchOpening(opening.id, { heightM: Math.max(Number(e.target.value) || 0.3, 0.3) })} />
                  {opening.kind === "window" && <Input label="Sill" type="number" min={0} step={0.1} value={opening.sillM} onChange={(e) => patchOpening(opening.id, { sillM: Math.max(Number(e.target.value) || 0, 0) })} />}
                </div>
              </div>
            ))}
            {(room.openings ?? []).length === 0 && <p className="text-xs text-slate-600">Add windows or doors to place them on the walls.</p>}
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {(room.furniture ?? []).map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedId(f.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition",
                  f.id === selectedId ? "bg-emerald-500/15 text-emerald-200" : "text-slate-300 hover:bg-slate-800/60",
                )}
              >
                <span className="h-3.5 w-3.5 shrink-0 rounded border border-slate-700" style={{ backgroundColor: f.color }} />
                <span className="truncate">{f.name}</span>
              </button>
            ))}
            {(room.furniture ?? []).length === 0 && <p className="px-1 text-xs text-slate-600">No furniture yet.</p>}
          </div>
        </div>
      </div>

      {ctx && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
          <div
            className="fixed z-50 w-44 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 py-1 text-sm shadow-2xl"
            style={{ left: Math.min(ctx.clientX, window.innerWidth - 190), top: Math.min(ctx.clientY, window.innerHeight - 170) }}
          >
            <MenuItem onClick={() => { patchFurniture(ctx.id, { rotationDeg: (((room.furniture ?? []).find((f) => f.id === ctx.id)?.rotationDeg ?? 0) + 90) % 360 }); setCtx(null); }}>Rotate 90°</MenuItem>
            <MenuItem onClick={() => { duplicateFurniture(ctx.id); setCtx(null); }}>Duplicate</MenuItem>
            <MenuItem danger onClick={() => { removeFurniture(ctx.id); setCtx(null); }}>Delete</MenuItem>
          </div>
        </>
      )}
    </Modal>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn("block w-full px-3 py-1.5 text-left text-sm transition hover:bg-slate-800", danger ? "text-rose-300" : "text-slate-200")}
    >
      {children}
    </button>
  );
}
