import { useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { ArchitecturalScene } from "../components/ArchitecturalScene";
import "./public-experience.css";

const STUDIES = [
  { variant: "pavilion", label: "Architecture", name: "The garden pavilion", detail: "A study in light, form, and landscape.", tag: "01 / ARCHITECTURE", scale: "Building scale" },
  { variant: "interior", label: "Interiors", name: "A room for possibility", detail: "Bring materials, furniture, and space together.", tag: "02 / INTERIORS", scale: "Room scale" },
  { variant: "city", label: "Communities", name: "Connected by design", detail: "Explore the relationships between buildings and place.", tag: "03 / COMMUNITIES", scale: "Neighborhood scale" },
  { variant: "structure", label: "Infrastructure", name: "The shape of connection", detail: "Make complex structural ideas easier to see.", tag: "04 / INFRASTRUCTURE", scale: "Structure scale" },
] as const;

const CAPABILITIES = [
  { number: "01", title: "Start with a place.", text: "Locate your site on the map, work from a room photo, or begin with an empty canvas. Every idea has a starting point.", icon: "map" },
  { number: "02", title: "See what could be.", text: "Place objects, explore geometry, and refine your model in an interactive 3D workspace. Turn a possibility into something you can see.", icon: "cube" },
  { number: "03", title: "Take the next step.", text: "Export your work as DXF, OBJ, or GLB, and download a bill of materials. Keep your project moving beyond the canvas.", icon: "export" },
] as const;

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h16m-6-6 6 6-6 6"} strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function FeatureIcon({ kind }: { kind: string }) {
  return <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    {kind === "map" ? <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Z" /><path d="M9 3v16m6-14v16" /></> : kind === "cube" ? <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" /><path d="m3 7 9 5 9-5m-9 5v10" /></> : <><path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6" /></>}
  </svg>;
}

export function Landing() {
  const [activeStudy, setActiveStudy] = useState(0);
  const study = STUDIES[activeStudy];

  function changeStudyWithKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % STUDIES.length;
    else if (event.key === "ArrowLeft") next = (index + STUDIES.length - 1) % STUDIES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = STUDIES.length - 1;
    else return;
    event.preventDefault();
    setActiveStudy(next);
    document.getElementById(`study-tab-${next}`)?.focus();
  }

  return (
    <div className="gw-public">
      <a className="public-skip-link" href="#main-content">Skip to content</a>
      <header className="public-header public-container">
        <Link to="/" aria-label="Groundwork home" className="public-brand"><Logo /></Link>
        <nav className="public-nav" aria-label="Main navigation">
          <a href="#possibilities">The possibilities</a>
          <a href="#process">How it works</a>
        </nav>
        <div className="public-header-actions"><Link to="/login" className="public-signin">Sign in</Link><Link to="/signup" className="public-button public-button-small">Enter the studio <Arrow diagonal /></Link></div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="public-hero public-container" aria-labelledby="hero-title">
          <div className="public-hero-copy">
            <p className="public-eyebrow"><span className="public-status-dot" /> SPACE FOR YOUR NEXT IDEA</p>
            <h1 id="hero-title">Give your ideas<br />a place to <em>grow.</em></h1>
            <p className="public-hero-description">From a room to a whole community. Bring your vision into focus with a thoughtful workspace for spatial design.</p>
            <div className="public-hero-actions"><Link to="/signup" className="public-button">Start creating <Arrow diagonal /></Link><a href="#possibilities" className="public-text-link">Explore the possibilities <Arrow /></a></div>
            <div className="public-hero-note"><span className="public-note-mark" aria-hidden="true">✦</span><span>Your perspective. Your process. Your place.</span></div>
          </div>
          <div className="public-hero-model">
            <div className="public-model-topline"><span>THE CONCEPT COLLECTION</span><span className="public-model-badge"><span /> LIVE 3D</span></div>
            <div className="public-model-scene" role="tabpanel" id="study-panel" aria-labelledby={`study-tab-${activeStudy}`}>
              <ArchitecturalScene variant={study.variant} interactive className="public-scene" />
              <div className="public-model-coordinate" aria-hidden="true">X / Y / Z<br /><span>Perspective view</span></div>
              <div className="public-model-orbit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-25 12 12)" /><circle cx="12" cy="12" r="2" /></svg> Drag to explore</div>
            </div>
            <div className="public-model-description" aria-live="polite"><div><p className="public-eyebrow">{study.tag}</p><h2>{study.name}</h2><p>{study.detail}</p></div><span className="public-scale">{study.scale}</span></div>
            <div className="public-study-tabs" role="tablist" aria-label="Explore design scales">{STUDIES.map((item, index) => <button key={item.variant} type="button" id={`study-tab-${index}`} role="tab" aria-controls="study-panel" aria-selected={activeStudy === index} tabIndex={activeStudy === index ? 0 : -1} onClick={() => setActiveStudy(index)} onKeyDown={event => changeStudyWithKeys(event, index)}><span>{String(index + 1).padStart(2, "0")}</span>{item.label}</button>)}</div>
          </div>
        </section>

        <div className="public-discipline-bar public-container" aria-label="Design disciplines"><span>ONE WORKSPACE. EVERY PERSPECTIVE.</span><div><span>Architecture</span><i /><span>Interiors</span><i /><span>Community planning</span><i /><span>Infrastructure</span></div></div>

        <section id="possibilities" className="public-capabilities public-container" aria-labelledby="possibilities-title">
          <div className="public-section-heading"><div><p className="public-eyebrow">THE POSSIBILITIES</p><h2 id="possibilities-title">Small details.<br /><span>Bigger possibilities.</span></h2></div><p>Good design starts with a clear view.<br />Make room for exploration, then give your ideas shape.</p></div>
          <div className="public-feature-grid">{CAPABILITIES.map(feature => <article className="public-feature" key={feature.number}><div className="public-feature-top"><FeatureIcon kind={feature.icon} /><span>{feature.number}</span></div><h3>{feature.title}</h3><p>{feature.text}</p></article>)}</div>
        </section>

        <section id="process" className="public-process public-container" aria-labelledby="process-title">
          <div className="public-process-art"><div className="public-process-art-label"><span className="public-eyebrow">FROM CONTEXT TO CONCEPT</span><span>STUDY / 002</span></div><ArchitecturalScene variant="city" compact className="public-process-scene" /><div className="public-process-art-foot"><span>A different scale. The same perspective.</span><svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" aria-hidden="true"><path d="M15 2v26M2 15h26" /><circle cx="15" cy="15" r="10" /></svg></div></div>
          <div className="public-process-copy"><p className="public-eyebrow">A CLEARER WAY TO CREATE</p><h2 id="process-title">From the first idea<br />to the next chapter.</h2><div className="public-steps"><div><span>01</span><div><h3>Find your starting point</h3><p>Create a project and choose the scale, site, or space you want to work with.</p></div></div><div><span>02</span><div><h3>Explore in three dimensions</h3><p>Build your composition, adjust the details, and move around your model to see it from every angle.</p></div></div><div><span>03</span><div><h3>Bring your work with you</h3><p>Save your progress and export models, drawings, and material lists for your next step.</p></div></div></div><Link to="/signup" className="public-text-link">Make space for your idea <Arrow /></Link></div>
        </section>

        <section className="public-invitation public-container" aria-labelledby="invitation-title"><div><p className="public-eyebrow">YOUR NEXT CHAPTER STARTS HERE</p><h2 id="invitation-title">What will you <em>make room for?</em></h2><p>A new space. A better neighborhood. An idea that deserves to be seen.</p></div><Link to="/signup" className="public-button">Create your studio <Arrow diagonal /></Link></section>
      </main>

      <footer className="public-footer public-container"><div><Link to="/" aria-label="Groundwork home"><Logo /></Link><p>A thoughtful space for spatial design.</p></div><div className="public-footer-links"><a href="#possibilities">The possibilities</a><a href="#process">How it works</a><Link to="/login">Sign in</Link></div><p className="public-copyright">© {new Date().getFullYear()} Groundwork<br /><span>Made for what comes next.</span></p></footer>
    </div>
  );
}
