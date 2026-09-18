import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { Button } from "../components/ui";

const FEATURES = [
  {
    icon: "M16 8a2 2 0 11-4 0 2 2 0 014 0zm-7 0a2 2 0 11-4 0 2 2 0 014 0z",
    title: "Photo → Interior model",
    desc: "Capture a room with your camera, or upload a photo — then design furniture, colours and curtains over it.",
  },
  {
    icon: "M20 6H4a1 1 0 00-1 1v10a1 1 0 001 1h16a1 1 0 001-1V7a1 1 0 00-1-1zm-2 8h-3v-2h3v2z",
    title: "Built-in billing",
    desc: "UPI, cards and PayPal. Try the full demo checkout flow — works sandbox-ready for live providers too.",
  },
  {
    icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
    title: "Ship to CAD",
    desc: "Export DXF for AutoCAD, OBJ for Blender/3ds Max, GLB for any 3D viewer — plus a Bill of Materials CSV.",
  },
  {
    icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM5.6 3.4l1.7 2.9A8 8 0 004 12a8 8 0 003.3 5.7l-1.7 2.9a10 10 0 000-17.2zM18.4 3.4a10 10 0 000 17.2l-1.7-2.9A8 8 0 0020 12a8 8 0 00-3.3-5.7l1.7-2.9z",
    title: "Security-first",
    desc: "scrypt hashing, AES-256-GCM at rest, TOTP 2FA, CSRF + rate limiting, audit logging and account lockout.",
  },
];

export function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-3">
          <Link to="/login">
            <Button variant="ghost">Sign in</Button>
          </Link>
          <Link to="/signup">
            <Button>Get started</Button>
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-8 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:pt-24">
        <div>
          <p className="gw-kicker">A spatial design workspace</p>
          <h1 className="mt-5 max-w-3xl text-5xl font-black leading-[0.98] tracking-[-0.045em] text-slate-50 sm:text-7xl">
            From first sketch to
            <span className="block bg-gradient-to-r from-emerald-300 via-cyan-300 to-sky-400 bg-clip-text text-transparent">buildable intent.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-slate-400 sm:text-lg">
            Groundwork turns mapped sites, rooms, communities and infrastructure into a calm, visual workspace for making real design decisions.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/signup"><Button size="lg">Open the studio <span aria-hidden>↗</span></Button></Link>
            <Link to="/login"><Button size="lg" variant="outline">Sign in</Button></Link>
          </div>
          <div className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500">
            <span><b className="text-slate-300">01</b> Map the context</span>
            <span><b className="text-slate-300">02</b> Shape the model</span>
            <span><b className="text-slate-300">03</b> Ship the output</span>
          </div>
        </div>
        <div className="gw-panel relative overflow-hidden rounded-[2rem] p-3 shadow-2xl shadow-cyan-950/20">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(34,211,238,.18),transparent_35%)]" />
          <div className="relative aspect-[0.95] overflow-hidden rounded-[1.45rem] border border-slate-700/70 bg-[#0a1119] p-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div><p className="text-[10px] uppercase tracking-[.22em] text-slate-500">Live workspace</p><p className="mt-1 text-sm font-semibold text-slate-200">Community / site study</p></div>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-300">SAVED</span>
            </div>
            <div className="relative mt-5 h-[68%] rounded-xl border border-cyan-400/20 bg-[linear-gradient(rgba(34,211,238,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.08)_1px,transparent_1px)] bg-[size:28px_28px]">
              <div className="absolute left-[17%] top-[20%] h-28 w-24 rotate-[-8deg] border border-emerald-300/70 bg-emerald-300/10 shadow-[0_0_30px_rgba(52,211,153,.12)]" />
              <div className="absolute right-[17%] top-[34%] h-36 w-28 rotate-[8deg] border border-sky-300/70 bg-sky-300/10" />
              <div className="absolute bottom-[15%] left-[28%] h-10 w-44 rounded-full border border-amber-300/60 bg-amber-300/10" />
              <div className="absolute left-1/2 top-1/2 h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_24px_8px_rgba(52,211,153,.5)]" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-[10px]">
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2"><span className="text-slate-500">Site area</span><b className="mt-1 block text-slate-200">12,480 m²</b></div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2"><span className="text-slate-500">Objects</span><b className="mt-1 block text-slate-200">24 placed</b></div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2"><span className="text-slate-500">Export</span><b className="mt-1 block text-emerald-300">CAD ready</b></div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-8 max-w-xl"><p className="gw-kicker">One workspace, four scales</p><h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-100">Designed for the way projects actually grow.</h2></div>
        <div className="grid gap-5 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur transition hover:border-emerald-500/30 hover:bg-slate-900/80"
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d={f.icon} />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-100">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-slate-800/60 py-8 text-center text-xs text-slate-500">
        Groundwork Design Studio · Node 22 · SQLite · React · Three.js · Google Maps
      </footer>
    </div>
  );
}
