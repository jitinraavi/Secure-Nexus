import { useEffect, useRef, useState } from "react";
import { createHeroCity } from "../../studio/scene/hero-city.js";

export interface AuthCitySceneProps {
  className?: string;
  /** The owning page can pause the decoration without changing its global preference. */
  motionEnabled?: boolean;
}

function preferenceAllowsMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try { return window.localStorage.getItem("groundwork-motion") !== "off"; }
  catch { return true; }
}

/** The homepage point survey, framed as a quiet, non-interactive authentication illustration. */
export function AuthCityScene({ className = "", motionEnabled = true }: AuthCitySceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [preferenceAllows, setPreferenceAllows] = useState(preferenceAllowsMotion);
  const [sceneState, setSceneState] = useState<"loading" | "ready" | "fallback">("loading");
  const animate = motionEnabled && preferenceAllows;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPreferenceAllows(preferenceAllowsMotion());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "groundwork-motion") update();
    };
    update();
    query.addEventListener("change", update);
    window.addEventListener("storage", onStorage);
    window.addEventListener("groundwork:motionchange", update);
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("groundwork:motionchange", update);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    setSceneState("loading");
    let city: ReturnType<typeof createHeroCity>;
    try { city = createHeroCity({ canvas, reducedMotion: !animate, framing: "panel" }); }
    catch { setSceneState("fallback"); return; }

    let disposed = false;
    let frameId: number | null = null;
    let lastFrame: number | null = null;
    let elapsed = 0;
    let contextLost = false;
    let renderFailed = false;
    let pageSuspended = false;
    let ready = false;
    const initialBounds = host.getBoundingClientRect();
    let intersecting = initialBounds.bottom > 0 && initialBounds.top < window.innerHeight
      && initialBounds.right > 0 && initialBounds.left < window.innerWidth;
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };

    const canRender = () => !disposed && !contextLost && !renderFailed && !pageSuspended
      && !document.hidden && intersecting && host.clientWidth > 0 && host.clientHeight > 0;
    const stop = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = null;
      lastFrame = null;
    };
    const invalidate = () => {
      if (canRender() && frameId === null) frameId = window.requestAnimationFrame(frame);
    };
    function frame(now: number) {
      frameId = null;
      if (!canRender()) { lastFrame = null; return; }
      const delta = lastFrame === null ? 0 : Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;
      if (animate) elapsed += delta;
      const easing = animate ? 1 - Math.exp(-delta * 6) : 1;
      pointer.x += (pointer.targetX - pointer.x) * easing;
      pointer.y += (pointer.targetY - pointer.y) * easing;
      try {
        city.render({ time: elapsed, progress: 0, pointerX: pointer.x, pointerY: pointer.y });
        if (!ready) { ready = true; setSceneState("ready"); }
      } catch {
        renderFailed = true;
        setSceneState("fallback");
        stop();
        return;
      }
      if (animate) invalidate();
      else lastFrame = null;
    }

    const resize = () => {
      if (disposed) return;
      try { city.resize(); }
      catch { renderFailed = true; setSceneState("fallback"); stop(); return; }
      invalidate();
    };
    const onVisibility = () => { if (document.hidden) stop(); else invalidate(); };
    const onPageHide = () => { pageSuspended = true; stop(); };
    const onPageShow = () => { pageSuspended = false; resize(); };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      ready = false;
      setSceneState("fallback");
      stop();
    };
    const onContextRestored = () => {
      contextLost = false;
      renderFailed = false;
      setSceneState("loading");
      resize();
    };
    // Listen to the illustration's parent without capturing clicks or touching form behavior.
    const pointerArea = host.parentElement || host;
    const onPointer = (event: PointerEvent) => {
      if (!animate || event.pointerType === "touch") return;
      if (event.target instanceof Element && event.target.closest("input,button,textarea,select,form,[contenteditable=true]")) return;
      const bounds = pointerArea.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      pointer.targetX = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
      pointer.targetY = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
    };
    const onPointerLeave = () => { pointer.targetX = 0; pointer.targetY = 0; };

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    resizeObserver?.observe(host);
    const intersectionObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      intersecting = entries[0]?.isIntersecting ?? true;
      if (intersecting) invalidate(); else stop();
    });
    intersectionObserver?.observe(host);
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    pointerArea.addEventListener("pointermove", onPointer, { passive: true });
    pointerArea.addEventListener("pointerleave", onPointerLeave, { passive: true });
    invalidate();

    return () => {
      disposed = true;
      stop();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      pointerArea.removeEventListener("pointermove", onPointer);
      pointerArea.removeEventListener("pointerleave", onPointerLeave);
      city.dispose();
    };
  }, [animate]);

  return <div ref={hostRef} className={`auth-city-scene ${className}`.trim()} data-scene-state={sceneState} aria-hidden="true">
    <div className="auth-city-fallback">
      <span className="auth-city-fallback__survey" />
      {Array.from({ length: 5 }, (_, index) => <span className="auth-city-fallback__building" key={index} />)}
    </div>
    <canvas ref={canvasRef} className="auth-city-canvas" />
  </div>;
}
