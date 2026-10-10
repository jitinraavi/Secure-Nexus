import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { ArchitecturalScene } from "../components/ArchitecturalScene";
import "./public-experience.css";

export function AuthShell({ children, stage = "login" }: { children: ReactNode; stage?: "login" | "signup" | "verify" }) {
  return <div className="gw-public public-auth">
    <header className="public-auth-header"><Link to="/" aria-label="Groundwork home"><Logo /></Link><Link to="/" className="public-auth-back"><span aria-hidden="true">←</span> Back to Groundwork</Link></header>
    <main className="public-auth-layout">
      <aside className="public-auth-art" aria-label="Groundwork design studio introduction"><div className="public-auth-art-copy"><p className="public-eyebrow">A LITTLE SPACE. A LOT OF POSSIBILITY.</p><h2>Good ideas<br />start with <em>room.</em></h2><p>Your next project is waiting to take shape.</p></div><ArchitecturalScene variant={stage === "signup" ? "city" : "pavilion"} interactive className="public-auth-scene" /><div className="public-auth-art-foot"><span>GROUNDWORK / CONCEPT STUDY</span><span>Drag to explore <span aria-hidden="true">↗</span></span></div></aside>
      <div className={`public-auth-content public-auth-content-${stage}`}><div className="public-auth-progress"><span className="public-status-dot" /><span>{stage === "login" ? "WELCOME TO YOUR WORKSPACE" : stage === "signup" ? "YOUR STUDIO STARTS HERE" : "ONE MORE STEP"}</span></div>{children}<p className="public-auth-footnote">A thoughtful space for spatial design.</p></div>
    </main>
    <footer className="public-auth-footer"><span>© {new Date().getFullYear()} Groundwork</span><span>Made for what comes next.</span></footer>
  </div>;
}
