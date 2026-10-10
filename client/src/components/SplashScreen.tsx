import { useEffect, useState } from "react";
import { Logo } from "./Logo";

/** One-shot launch animation shown the first time the app boots in a tab. */
export function SplashScreen() {
  const [phase, setPhase] = useState<"show" | "leave" | "gone">(() => {
    try { return sessionStorage.getItem("groundwork-introduced") || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "gone" : "show"; }
    catch { return "gone"; }
  });

  useEffect(() => {
    try { sessionStorage.setItem("groundwork-introduced", "1"); } catch { /* Storage is optional. */ }
    const t1 = window.setTimeout(() => setPhase("leave"), 350);
    const t2 = window.setTimeout(() => setPhase("gone"), 550);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-slate-950 ${
        phase === "leave" ? "opacity-0 transition-opacity duration-200" : ""
      }`}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 460px at 50% 30%, rgba(181,199,171,0.08), transparent 60%)",
        }}
      />
      <div className="relative">
        <Logo />
      </div>
      <div className="relative flex flex-col items-center gap-1.5">
        <p className="gw-kicker">
          A place for your ideas
        </p>
      </div>
    </div>
  );
}
