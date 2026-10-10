import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useTheme, type ThemeMode } from "../theme";
import { Logo } from "./Logo";
import { useToast } from "./Toast";
import { cn } from "../lib/cn";
import { OfflineSyncIndicator } from "./OfflineSyncIndicator";
import { SignOutDialog } from "./SignOutDialog";
import "./workspace.css";

const NAV = [
  { to: "/dashboard", label: "Overview", icon: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z" },
  { to: "/geometry", label: "Geometry & rendering", icon: "m12 3 9 5v8l-9 5-9-5V8zm0 0v10m9-5-9 5-9-5m9 5v8" },
  { to: "/engineering", label: "Engineering", icon: "M3 4h18M5 4v16m14-16v16M3 20h18M8 8h8M8 12h8M8 16h8" },
  { to: "/exchange", label: "BIM & civil exchange", icon: "M4 4h16v16H4zM4 9h16M9 4v16m5-6h3m-3 3h3" },
  { to: "/organizations", label: "Organizations", icon: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2M20 5a3 3 0 0 1 0 6M4 5a3 3 0 0 0 0 6" },
  { to: "/billing", label: "Plan & billing", icon: "M3 5h18v14H3zM3 9h18M7 15h4" },
  { to: "/audit", label: "Activity & audit", icon: "M14 3H5v18h14V8zm0 0v5h5M8 12h8M8 16h6" },
  { to: "/settings", label: "Settings", icon: "M4 7h16M4 17h16M8 4v6m8 4v6" },
];

function NavIcon({ d }: { d: string }) {
  return <svg className="studio-nav-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

export function Layout() {
  const { user, signingOut, logoutError } = useAuth();
  const { mode, setMode } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const drawer = useRef<HTMLElement>(null);
  const shellContent = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const currentPage = NAV.find((item) => location.pathname.startsWith(item.to))?.label ?? "Design studio";
  const displayName = user?.username || user?.email.split("@")[0] || "Your workspace";
  const initials = displayName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "GW";

  useEffect(() => { setDrawerOpen(false); }, [location.pathname, location.search]);

  useLayoutEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (shellContent.current) shellContent.current.inert = true;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : menuButton.current;
    const panel = drawer.current;
    const focusFrame = window.requestAnimationFrame(() => panel?.querySelector<HTMLButtonElement>(".studio-drawer-close")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setDrawerOpen(false); return; }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select, [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => { if (desktop.matches) setDrawerOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onResize);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      if (shellContent.current) shellContent.current.inert = false;
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onResize);
      previouslyFocused?.focus();
    };
  }, [drawerOpen]);

  const handleLogout = () => { if (!signingOut) { setDrawerOpen(false); setSignOutOpen(true); } };

  return (
    <div className="studio-shell">
      <a className="studio-skip-link" href="#main-content">Skip to workspace</a>
      {drawerOpen && <div className="studio-drawer-backdrop" aria-hidden="true" onClick={() => setDrawerOpen(false)} />}
      <aside ref={drawer} id="studio-navigation" className={cn("studio-sidebar", drawerOpen && "is-open")} role={drawerOpen ? "dialog" : undefined} aria-modal={drawerOpen ? true : undefined} aria-label="Workspace navigation" onTransitionEnd={(event) => {
        if (drawerOpen && event.target === event.currentTarget && event.propertyName === "transform" && !event.currentTarget.contains(document.activeElement)) {
          event.currentTarget.querySelector<HTMLButtonElement>(".studio-drawer-close")?.focus();
        }
      }}>
        <div className="studio-brand-row">
          <Link to="/dashboard" aria-label="Groundwork overview"><Logo /></Link>
          <button type="button" className="studio-icon-button studio-drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close navigation"><NavIcon d="m6 6 12 12M18 6 6 18" /></button>
        </div>
        <div className="studio-workspace-label"><span className="studio-workspace-mark"><NavIcon d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5m-9 5v8" /></span><div><strong>My workspace</strong><span>Architecture & design</span></div><span className="studio-workspace-dot" /></div>
        <nav className="studio-nav" aria-label="Primary navigation">
          <p className="studio-nav-heading">Design workspaces</p>
          {NAV.slice(0, 4).map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => cn("studio-nav-link", isActive && "is-active")}><NavIcon d={item.icon} /><span>{item.label}</span>{item.to === "/dashboard" && <span className="studio-nav-shortcut">01</span>}</NavLink>)}
          <p className="studio-nav-heading studio-nav-heading-manage">Manage</p>
          {NAV.slice(4).map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => cn("studio-nav-link", isActive && "is-active")}><NavIcon d={item.icon} /><span>{item.label}</span></NavLink>)}
        </nav>
        <div className="studio-sidebar-bottom">
          <div className="studio-sidebar-note"><div className="studio-mini-model" aria-hidden="true"><i /><i /><i /></div><p>Space for your<br /><strong>next big idea.</strong></p></div>
          <div className="studio-profile"><span className="studio-avatar">{initials}</span><div className="studio-profile-text"><strong>{displayName}</strong><span>{user?.plan === "studio" ? "Studio" : user?.plan === "pro" ? "Pro" : "Free"} plan</span></div><button type="button" className="studio-icon-button" title="Sign out" aria-label={signingOut ? "Signing out" : "Sign out"} disabled={signingOut} onClick={() => void handleLogout()}><NavIcon d="M9 4H4v16h5m6-12 4 4-4 4m4-4H8" /></button></div>
        </div>
      </aside>
      <div className="studio-shell-content" ref={shellContent}>
        <header className="studio-topbar">
          <div className="studio-topbar-location"><button ref={menuButton} type="button" className="studio-icon-button studio-menu-button" aria-label="Open navigation" aria-expanded={drawerOpen} aria-controls="studio-navigation" onClick={() => setDrawerOpen(true)}><NavIcon d="M4 6h16M4 12h16M4 18h16" /></button><span className="studio-topbar-workspace">My workspace</span><span className="studio-breadcrumb-divider" aria-hidden="true">/</span><span className="studio-current-page">{currentPage}</span></div>
          <div className="studio-topbar-tools"><OfflineSyncIndicator /><label className="studio-theme-control"><NavIcon d={mode === "light" ? "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17m10-10 1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0" : "M20 15.5A9 9 0 0 1 8.5 4 9 9 0 1 0 20 15.5"} /><select aria-label="Workspace appearance" value={mode} onChange={(event) => setMode(event.target.value as ThemeMode)}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label><Link to="/settings" className="studio-avatar studio-topbar-avatar" aria-label="Your account settings">{initials}</Link></div>
        </header>
        <main id="main-content" tabIndex={-1} className="studio-main">{logoutError && !signOutOpen && <div role="alert" className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300"><span className="min-w-0 flex-1">{logoutError}</span><button type="button" className="underline" onClick={handleLogout}>Retry sign-out</button></div>}<Outlet /></main>
        <footer className="studio-shell-footer"><span>GROUNDWORK <span className="studio-footer-separator">/</span> DESIGN STUDIO</span><span>Thoughtfully built for what comes next.</span></footer>
      </div>
      <SignOutDialog open={signOutOpen} onClose={() => { setSignOutOpen(false); if (window.matchMedia("(max-width: 1023px)").matches) window.setTimeout(() => menuButton.current?.focus(), 0); }} onSignedOut={() => { toast.push({ title: "Signed out", tone: "info" }); navigate("/"); }} />
    </div>
  );
}
