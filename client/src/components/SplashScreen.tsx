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
        className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-[#15191e] ${
        phase === "leave" ? "pointer-events-none opacity-0 transition-opacity duration-700" : ""
      }`}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 460px at 50% 30%, rgba(214,168,74,0.18), transparent 60%), radial-gradient(700px 360px at 50% 70%, rgba(180,145,75,0.10), transparent 55%)",
        }}
      />
      <div className="gw-splash-pop relative w-72 overflow-hidden rounded-2xl bg-[#1b2026] shadow-2xl shadow-amber-900/30 ring-1 ring-[#d6a84a]/30">
        <img src="/logo.svg" alt="Groundwork Design Studio" className="h-auto w-full object-contain" />
      </div>
      <div className="relative flex flex-col items-center gap-1.5">
        <p className="gw-splash-rise text-xs font-semibold uppercase tracking-[0.32em] text-[#d6a84a]" style={{ animationDelay: "0.3s" }}>
          Opening workspace
        </p>
      </div>
      <div className="relative h-1 w-52 overflow-hidden rounded-full bg-[#34302a]">
        <div className="gw-splash-bar h-full rounded-full bg-gradient-to-r from-[#a9782d] via-[#d6a84a] to-[#f0cf83]" style={{ animation: "gw-splash-bar 1.8s ease-out 0.2s both" }} />
      </div>
    </div>
  );
}
