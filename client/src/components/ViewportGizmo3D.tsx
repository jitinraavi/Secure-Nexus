import { useEffect, useState } from "react";
import * as THREE from "three";
import { cn } from "../lib/cn";

interface ViewportGizmo3DProps {
  camera: THREE.Camera | null;
  onSetView?: (view: "top" | "front" | "right" | "iso" | "reset") => void;
  className?: string;
}

/**
 * 3D Viewport Orientation Gizmo & Navigation ViewCube.
 * Dynamically tracks camera orientation with real-time 3D rotation,
 * providing direct alignment to orthogonal and isometric views.
 */
export function ViewportGizmo3D({ camera, onSetView, className }: ViewportGizmo3DProps) {
  const [rotX, setRotX] = useState(0);
  const [rotY, setRotY] = useState(0);

  useEffect(() => {
    if (!camera) return;

    let animId: number;
    const euler = new THREE.Euler(0, 0, 0, "YXZ");

    const updateGizmo = () => {
      if (camera) {
        euler.setFromRotationMatrix(camera.matrixWorldInverse, "YXZ");
        setRotX(Math.round(THREE.MathUtils.radToDeg(euler.x)));
        setRotY(Math.round(THREE.MathUtils.radToDeg(euler.y)));
      }
      animId = requestAnimationFrame(updateGizmo);
    };

    animId = requestAnimationFrame(updateGizmo);
    return () => cancelAnimationFrame(animId);
  }, [camera]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/85 p-2 shadow-2xl backdrop-blur-xl transition select-none",
        className,
      )}
      style={{
        boxShadow: "0 12px 32px -4px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)",
      }}
    >
      {/* 3D Interactive Orientation Cube / Sphere */}
      <div className="relative flex h-14 w-14 items-center justify-center [perspective:300px]">
        <div
          className="relative h-10 w-10 transition-transform duration-75 [transform-style:preserve-3d]"
          style={{
            transform: `rotateX(${-rotX}deg) rotateY(${rotY}deg)`,
          }}
        >
          {/* Top Face */}
          <button
            type="button"
            onClick={() => onSetView?.("top")}
            title="Top View"
            className="absolute inset-0 flex items-center justify-center rounded border border-emerald-500/50 bg-emerald-500/20 text-[10px] font-bold text-emerald-300 transition hover:bg-emerald-500/40"
            style={{ transform: "rotateX(90deg) translateZ(20px)" }}
          >
            TOP
          </button>

          {/* Front Face */}
          <button
            type="button"
            onClick={() => onSetView?.("front")}
            title="Front View"
            className="absolute inset-0 flex items-center justify-center rounded border border-cyan-500/50 bg-cyan-500/20 text-[10px] font-bold text-cyan-300 transition hover:bg-cyan-500/40"
            style={{ transform: "translateZ(20px)" }}
          >
            FRT
          </button>

          {/* Right Face */}
          <button
            type="button"
            onClick={() => onSetView?.("right")}
            title="Right Side View"
            className="absolute inset-0 flex items-center justify-center rounded border border-indigo-500/50 bg-indigo-500/20 text-[10px] font-bold text-indigo-300 transition hover:bg-indigo-500/40"
            style={{ transform: "rotateY(90deg) translateZ(20px)" }}
          >
            RGT
          </button>

          {/* Back Face */}
          <div
            className="absolute inset-0 flex items-center justify-center rounded border border-slate-700 bg-slate-900/60 text-[9px] font-bold text-slate-500"
            style={{ transform: "rotateY(180deg) translateZ(20px)" }}
          >
            BCK
          </div>

          {/* Left Face */}
          <div
            className="absolute inset-0 flex items-center justify-center rounded border border-slate-700 bg-slate-900/60 text-[9px] font-bold text-slate-500"
            style={{ transform: "rotateY(-90deg) translateZ(20px)" }}
          >
            LFT
          </div>

          {/* Bottom Face */}
          <div
            className="absolute inset-0 flex items-center justify-center rounded border border-slate-700 bg-slate-900/60 text-[9px] font-bold text-slate-500"
            style={{ transform: "rotateX(-90deg) translateZ(20px)" }}
          >
            BTM
          </div>
        </div>
      </div>

      {/* Axis indicators (X = Red, Y = Green, Z = Blue) */}
      <div className="flex items-center gap-1.5 px-1 text-[9px] font-bold tracking-wider">
        <span className="flex items-center gap-0.5 text-rose-400">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />X
        </span>
        <span className="flex items-center gap-0.5 text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Y
        </span>
        <span className="flex items-center gap-0.5 text-sky-400">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />Z
        </span>
      </div>

      {/* Quick View Switcher Pills */}
      <div className="grid grid-cols-2 gap-1 w-full pt-1 border-t border-slate-800">
        <button
          type="button"
          onClick={() => onSetView?.("iso")}
          title="Isometric 3D Camera"
          className="rounded-lg bg-slate-900/80 px-1.5 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-800 hover:text-emerald-300 transition"
        >
          ISO
        </button>
        <button
          type="button"
          onClick={() => onSetView?.("reset")}
          title="Reset Camera View"
          className="rounded-lg bg-slate-900/80 px-1.5 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-800 hover:text-emerald-300 transition"
        >
          RESET
        </button>
      </div>
    </div>
  );
}
