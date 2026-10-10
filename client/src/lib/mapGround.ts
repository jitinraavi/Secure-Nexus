import * as THREE from "three";
import type { LandSite, SiteLocation } from "../types";
import { landMeters } from "./community";
import { toLocalMetres } from "./geo";

/* -------------------------------------------------------------------------- */
/*  OSM tile stitching + Google Static Maps fallback                          */
/* -------------------------------------------------------------------------- */

const OSM_URL = "https://tile.openstreetmap.org";
const TARGET_PX = 1280;
const TILES = 5;

const rad = (d: number) => (d * Math.PI) / 180;
const mpp = (lat: number, z: number) => (156543.03392 * Math.cos(rad(lat))) / 2 ** z;

function webMercator(lat: number, lng: number, zoom: number) {
  const n = 2 ** zoom;
  const x = ((lng + 180) / 360) * n;
  const latRad = rad(lat);
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

function tileUrl(z: number, x: number, y: number) {
  return `${OSM_URL}/${z}/${x}/${y}.png`;
}

function fetchImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/* -------------------------------------------------------------------------- */
/*  Label sprites                                                             */
/* -------------------------------------------------------------------------- */

function makeSprite(text: string, w: number, h: number, bg: string, fg: string): THREE.Sprite {
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 128;
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(8, 8, 496, 112, 14);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = "bold 60px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cv.width / 2, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(w, h, 1);
  sprite.userData.noSelect = true;
  return sprite;
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

export async function buildMapGround(
  location: SiteLocation,
  land: LandSite,
): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.userData.noSelect = true;

  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return group;

  const lat = location.lat;
  const lng = location.lng;
  const { w: W, d: D } = landMeters(land);
  const L = Math.max(W, D);
  const targetM = L * 2.2;

  /* Choose zoom so TARGET_PX pixels cover targetM. */
  let z = Math.round(Math.log2((156543.03392 * Math.cos(rad(lat)) * TARGET_PX) / targetM));
  z = Math.max(12, Math.min(19, z));
  const m = mpp(lat, z);
  const spanM = TARGET_PX * m;

  const center = webMercator(lat, lng, z);
  const leftTile = Math.floor(center.x) - Math.floor(TILES / 2);
  const topTile = Math.floor(center.y) - Math.floor(TILES / 2);
  const px = (center.x - leftTile) * 256;
  const py = (center.y - topTile) * 256;

  /* Try OSM first (free, CORS-friendly). */
  let img: HTMLImageElement | null = null;
  {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = TARGET_PX;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, TARGET_PX, TARGET_PX);
    let loaded = 0;
    const promises: Promise<void>[] = [];
    for (let row = 0; row < TILES; row++) {
      for (let col = 0; col < TILES; col++) {
        const p = fetchImage(tileUrl(z, leftTile + col, topTile + row)).then((el) => {
          if (el) {
            ctx.drawImage(el, col * 256, row * 256, 256, 256);
            loaded++;
          }
        });
        promises.push(p);
      }
    }
    await Promise.allSettled(promises);
    if (loaded > 0) {
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      try {
        tex.anisotropy = 8;
      } catch { /* ignore */ }
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(spanM, spanM),
        new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
      );
      plane.rotation.x = -Math.PI / 2;
      /* center pixel → world origin */
      const localX0 = (px - TARGET_PX / 2) * m;
      const localY0 = (TARGET_PX / 2 - py) * m;
      plane.position.set(-localX0, 0.035, localY0);
      plane.userData.noSelect = true;
      group.add(plane);
      img = canvas as unknown as HTMLImageElement; // truthy sentinel
    }
  }

  /* Google Static Maps fallback if OSM failed. */
  if (!img) {
    const key = (import.meta.env.VITE_GOOGLE_MAPS_KEY ?? "").trim();
    if (key) {
      try {
        const gUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${z}&size=640x640&scale=2&maptype=satellite&key=${encodeURIComponent(key)}`;
        const loaded2 = await fetchImage(gUrl);
        if (loaded2) {
          const tex = new THREE.Texture(loaded2);
          tex.needsUpdate = true;
          tex.colorSpace = THREE.SRGBColorSpace;
          try {
            tex.anisotropy = 8;
          } catch { /* ignore */ }
          const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(spanM, spanM),
            new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
          );
          plane.rotation.x = -Math.PI / 2;
          plane.position.y = 0.035;
          plane.userData.noSelect = true;
          group.add(plane);
        }
      } catch { /* ignore */ }
    }
  }

  /* Boundary outline. */
  if (location.boundary && location.boundary.length >= 3) {
    const origin = { lat, lng };
    const pts = location.boundary.map((p) => {
      const m2 = toLocalMetres(p, origin);
      return new THREE.Vector3(m2.x, 0.09, -m2.y);
    });
    pts.push(pts[0].clone());
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.95 }),
    );
    line.userData.noSelect = true;
    group.add(line);
    /* Faint fill */
    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x, pts[0].z);
    for (let i = 1; i < pts.length - 1; i++) shape.lineTo(pts[i].x, pts[i].z);
    shape.closePath();
    const fillGeo = new THREE.ShapeGeometry(shape);
    const fillMesh = new THREE.Mesh(
      fillGeo,
      new THREE.MeshBasicMaterial({
        color: 0x34d399,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    fillMesh.rotation.x = -Math.PI / 2;
    fillMesh.position.y = 0.025;
    fillMesh.userData.noSelect = true;
    group.add(fillMesh);
  }

  /* North arrow at top-left of land. */
  {
    const nx = -W / 2 + 8;
    const nz = -D / 2 - 12;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 4, 16),
      new THREE.MeshBasicMaterial({ color: 0xef4444 }),
    );
    cone.rotation.x = -Math.PI / 2;
    cone.position.set(nx, 0.08, nz);
    cone.userData.noSelect = true;
    group.add(cone);
    group.add(
      Object.assign(makeSprite("N", 4, 1.1, "rgba(15,23,42,0.88)", "#f8fafc"), {
        position: new THREE.Vector3(nx + 5, 0.08, nz),
      } as Partial<THREE.Object3D>),
    );
  }

  /* Coords label. */
  group.add(
    Object.assign(
      makeSprite(`${lat.toFixed(5)}, ${lng.toFixed(5)}`, 18, 2.2, "rgba(15,23,42,0.88)", "#94a3b8"),
      { position: new THREE.Vector3(0, 0.08, D / 2 + 10) } as Partial<THREE.Object3D>,
    ),
  );

  return group;
}
