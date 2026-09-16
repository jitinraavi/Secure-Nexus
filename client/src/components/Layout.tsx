import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Logo } from "./Logo";
import { useToast } from "./Toast";
import { cn } from "../lib/cn";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: "M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z" },
  { to: "/billing", label: "Billing", icon: "M20 6H4a1 1 0 00-1 1v10a1 1 0 001 1h16a1 1 0 001-1V7a1 1 0 00-1-1zm-2 8h-3v-2h3v2z" },
  { to: "/audit", label: "Audit Log", icon: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-3 14l-4-4 1.5-1.5L11 13l4.5-4.5L17 10l-6 6z" },
  { to: "/settings", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1l2-1.5-2-3.5-2.4 1a7.5 7.5 0 00-1.7-1L14.8 3h-4L10 5.6a7.5 7.5 0 00-1.7 1L5.9 5.5 4 9l2 1.5a7.4 7.4 0 000 1L4 13l1.9 3.4 2.4-1a7.5 7.5 0 001.7 1l.8 2.6h4l.8-2.6a7.5 7.5 0 001.7-1l2.4 1 1.9-3.4-2-1.5c.06-.33.1-.66.1-1z" },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
      <path d={d} />
    </svg>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const handleLogout = async () => {
    await logout();
    toast.push({ title: "Signed out", tone: "info" });
    navigate("/");
  };

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-slate-800/80 bg-slate-950/80 backdrop-blur lg:flex">
        <div className="px-5 py-5">
          <Logo />
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-emerald-500/10 text-emerald-300"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
                )
              }
            >
              <NavIcon d={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800/80 p-3">
          <div className="rounded-xl bg-slate-900/70 px-3 py-3">
            <p className="truncate text-sm font-semibold text-slate-200">{user?.email}</p>
            <p className="mt-0.5 text-xs capitalize text-emerald-400">
              {user?.plan === "studio" ? "Studio" : user?.plan === "pro" ? "Pro" : "Free"} plan
            </p>
            <button
              onClick={handleLogout}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 transition hover:bg-slate-800 hover:text-rose-300"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800/80 bg-slate-950/80 px-4 py-3 backdrop-blur lg:hidden">
          <Logo />
          <button onClick={handleLogout} className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:text-rose-300">
            Sign out
          </button>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}