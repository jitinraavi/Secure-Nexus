import { useEffect, useState } from "react";

/** One-shot launch animation shown the first time the app boots in a tab. */
export function SplashScreen() {
  const [phase, setPhase] = useState<"show" | "leave" | "gone">("show");

  useEffect(() => {
    const t1 = window.setTimeout(() => setPhase("leave"), 2200);
    const t2 = window.setTimeout(() => setPhase("gone"), 2900);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-slate-950 ${
        phase === "leave" ? "pointer-events-none opacity-0 transition-opacity duration-700" : ""
      }`}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 460px at 50% 30%, rgba(16,185,129,0.14), transparent 60%), radial-gradient(700px 360px at 50% 70%, rgba(34,211,238,0.10), transparent 55%)",
        }}
      />
      <div className="gw-splash-pop relative w-56 overflow-hidden rounded-2xl bg-slate-900 shadow-2xl shadow-emerald-500/20 ring-1 ring-white/10">
        <img src="/logo.png" alt="Groundwork" className="h-auto w-full object-cover" />
      </div>
      <div className="relative flex flex-col items-center gap-1.5">
        <p className="gw-splash-rise text-2xl font-bold tracking-tight text-slate-50" style={{ animationDelay: "0.3s" }}>
          Ground<span className="text-emerald-400">work</span>
        </p>
        <p className="gw-splash-rise text-xs font-medium uppercase tracking-[0.3em] text-slate-500" style={{ animationDelay: "0.45s" }}>
          Design Studio
        </p>
      </div>
      <div className="relative h-1 w-44 overflow-hidden rounded-full bg-slate-800">
        <div className="gw-splash-bar h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400" style={{ animation: "gw-splash-bar 1.8s ease-out 0.2s both" }} />
      </div>
    </div>
  );
}