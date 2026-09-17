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

      <section className="mx-auto max-w-6xl px-6 pt-16 text-center">
        <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-semibold text-emerald-300">
          For interior designers & freelance architects
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold tracking-tight text-slate-50 sm:text-6xl">
          Design your client's room,
          <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
            {" "}
            ship it to AutoCAD.
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-400">
          Photograph a room, drop in furniture, pick the palette and curtains, then export a CAD-ready plan in
          one click. Professionally secured — your designs and photos are encrypted.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link to="/signup">
            <Button size="lg">Start designing free</Button>
          </Link>
          <Link to="/login">
            <Button size="lg" variant="outline">
              Sign in
            </Button>
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
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