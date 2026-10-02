import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CameraWaypoint } from "../types";

export interface RecordedPresentation { blob: Blob; extension: "webm" | "mp4" }
export interface PresentationApi {
  captureCameraWaypoint(label: string): CameraWaypoint;
  showCameraWaypoint(waypoint: CameraWaypoint): void;
  playCameraPath(path: CameraWaypoint[], durationSeconds?: number): void;
  stopCameraPath(): void;
  isCameraPathPlaying(): boolean;
  capturePng(scale?: number): Promise<Blob>;
  recordVideo(durationSeconds: number, framesPerSecond?: number, path?: CameraWaypoint[]): Promise<RecordedPresentation>;
  cancelVideo(): void;
  isRecording(): boolean;
}

export function validCameraWaypoint(value: unknown): value is CameraWaypoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<CameraWaypoint>;
  const vector = (tuple: unknown) => Array.isArray(tuple) && tuple.length === 3 && tuple.every((number) => typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= 1e7);
  return typeof point.id === "string" && typeof point.label === "string" && vector(point.position) && vector(point.target)
    && new THREE.Vector3(...point.position!).distanceToSquared(new THREE.Vector3(...point.target!)) > 1e-10;
}

/** Uses the existing viewport; no remote render service, microphone or camera input. */
export function createPresentationController(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls, viewport?: () => { width: number; height: number; pixelRatio: number }) {
  let disposed = false;
  let capturing = false;
  let tour: { camera: THREE.CatmullRomCurve3; target: THREE.CatmullRomCurve3; startedAt: number; durationMs: number; enabled: boolean; damping: boolean } | null = null;
  let recording: { cancel: () => void } | null = null;
  const stopPath = () => {
    if (tour) { controls.enabled = tour.enabled; controls.enableDamping = tour.damping; }
    tour = null;
  };
  const available = () => { if (disposed) throw new Error("The presentation viewport is closed."); };
  const api: PresentationApi = {
    captureCameraWaypoint(label) {
      available();
      return { id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, label: label.trim().slice(0, 120) || "View", position: [camera.position.x, camera.position.y, camera.position.z], target: [controls.target.x, controls.target.y, controls.target.z] };
    },
    showCameraWaypoint(waypoint) {
      available();
      if (renderer.xr.isPresenting) throw new Error("Exit the immersive session before changing camera viewpoints.");
      if (!validCameraWaypoint(waypoint)) throw new Error("This viewpoint has invalid camera coordinates.");
      stopPath();
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      camera.position.fromArray(waypoint.position);
      controls.target.fromArray(waypoint.target);
      camera.lookAt(controls.target);
      controls.update();
      controls.enableDamping = damping;
    },
    playCameraPath(path, durationSeconds = Math.min(120, Math.max(3.5, (path.length - 1) * 3.5))) {
      available();
      if (renderer.xr.isPresenting) throw new Error("Exit the immersive session before playing a camera path.");
      if (path.length < 2 || path.length > 100 || !path.every(validCameraWaypoint)) throw new Error("A camera path needs 2–100 valid viewpoints.");
      if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 120) throw new Error("Path duration must be 1–120 seconds.");
      stopPath();
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      tour = { camera: new THREE.CatmullRomCurve3(path.map((point) => new THREE.Vector3(...point.position)), false, "centripetal"), target: new THREE.CatmullRomCurve3(path.map((point) => new THREE.Vector3(...point.target)), false, "centripetal"), startedAt: performance.now(), durationMs: durationSeconds * 1000, enabled: controls.enabled, damping };
      controls.enabled = false;
      controls.enableDamping = false;
    },
    stopCameraPath: stopPath,
    isCameraPathPlaying: () => tour !== null,
    async capturePng(scale = 1) {
      available();
      if (capturing || recording) throw new Error("Finish the current capture before exporting a still image.");
      if (renderer.xr.isPresenting) throw new Error("Exit the immersive session before capturing a still image.");
      if (![1, 2, 4].includes(scale)) throw new Error("Image scale must be 1×, 2× or 4×.");
      const size = renderer.getSize(new THREE.Vector2());
      const width = Math.round(size.x * scale), height = Math.round(size.y * scale);
      if (width < 1 || height < 1 || Math.max(width, height) > Math.min(8192, renderer.capabilities.maxTextureSize) || width * height > 16_777_216) throw new Error("Capture is too large. Reduce the image scale or viewport size.");
      const ratio = renderer.getPixelRatio();
      capturing = true;
      try {
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);
        renderer.render(scene, camera);
        return await new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The browser could not capture this viewport.")), "image/png"));
      } finally {
        capturing = false;
        if (!disposed) {
          const desired = viewport?.() ?? { width: renderer.domElement.parentElement?.clientWidth || size.x, height: renderer.domElement.parentElement?.clientHeight || size.y, pixelRatio: ratio };
          renderer.setPixelRatio(desired.pixelRatio);
          renderer.setSize(desired.width, desired.height, false);
          camera.aspect = desired.width / desired.height;
          camera.updateProjectionMatrix();
          renderer.render(scene, camera);
        }
      }
    },
    recordVideo(durationSeconds, framesPerSecond = 30, path) {
      available();
      if (recording || capturing) return Promise.reject(new Error("A presentation capture is already active."));
      if (renderer.xr.isPresenting) return Promise.reject(new Error("Exit the immersive session before recording."));
      if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 60 || ![15, 30, 60].includes(framesPerSecond)) return Promise.reject(new Error("Recording supports 1–60 seconds at 15, 30 or 60 fps."));
      if (typeof MediaRecorder === "undefined" || typeof renderer.domElement.captureStream !== "function") return Promise.reject(new Error("Viewport video recording is unavailable in this browser."));
      const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mime) return Promise.reject(new Error("This browser has no supported viewport video codec."));
      return new Promise<RecordedPresentation>((resolve, reject) => {
        let stream: MediaStream | undefined;
        let recorder: MediaRecorder | undefined;
        let timer: number | undefined;
        let settled = false;
        const chunks: Blob[] = [];
        let bytes = 0;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) window.clearTimeout(timer);
          if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch { /* Device/browser teardown may already have stopped it. */ } }
          stream?.getTracks().forEach((track) => track.stop());
          recording = null;
          if (path) stopPath();
          if (error) reject(error);
          else if (bytes === 0) reject(new Error("The browser returned an empty recording."));
          else { const actualMime = recorder?.mimeType || mime; resolve({ blob: new Blob(chunks, { type: actualMime }), extension: actualMime.startsWith("video/mp4") ? "mp4" : "webm" }); }
        };
        try {
          if (path) api.playCameraPath(path, durationSeconds);
          stream = renderer.domElement.captureStream(framesPerSecond);
          recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
          recording = { cancel: () => finish(new Error("Presentation recording cancelled.")) };
          recorder.ondataavailable = (event) => {
            if (settled || !event.data.size) return;
            bytes += event.data.size;
            if (bytes > 64 * 1024 * 1024) { finish(new Error("Recording exceeded the 64 MB limit.")); return; }
            chunks.push(event.data);
          };
          recorder.onerror = () => finish(new Error("The browser video recorder failed."));
          recorder.onstop = () => finish();
          recorder.start(250);
          timer = window.setTimeout(() => { if (recorder?.state !== "inactive") recorder?.stop(); }, durationSeconds * 1000);
        } catch (error) { finish(error instanceof Error ? error : new Error("Could not start recording.")); }
      });
    },
    cancelVideo() { recording?.cancel(); },
    isRecording: () => recording !== null,
  };
  return {
    api,
    update(now = performance.now()) {
      if (!tour || disposed) return false;
      const progress = Math.min(1, Math.max(0, (now - tour.startedAt) / tour.durationMs));
      camera.position.copy(tour.camera.getPointAt(progress));
      controls.target.copy(tour.target.getPointAt(progress));
      camera.lookAt(controls.target);
      if (progress >= 1) stopPath();
      return true;
    },
    dispose() { disposed = true; recording?.cancel(); stopPath(); },
  };
}
