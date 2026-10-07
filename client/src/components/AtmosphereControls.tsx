import { ATMOSPHERE_PRESETS, type AtmospherePreset } from "../lib/atmosphere";
import { cn } from "../lib/cn";

interface AtmosphereControlsProps {
  currentPreset: AtmospherePreset;
  onPresetChange: (preset: AtmospherePreset) => void;
  className?: string;
}

export function AtmosphereControls({ currentPreset, onPresetChange, className }: AtmosphereControlsProps) {
  const presets: AtmospherePreset[] = ["noon", "sunset", "cyberpunk", "overcast"];

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-center gap-1 rounded-2xl border border-white/10 bg-slate-950/80 p-1.5 shadow-2xl backdrop-blur-xl transition",
        className,
      )}
      style={{
        boxShadow: "0 12px 32px -4px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)",
      }}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="hidden sm:inline">Lighting / Atmosphere</span>
      </div>

      <div className="flex items-center gap-1 rounded-xl bg-slate-900/60 p-1 border border-slate-800/80">
        {presets.map((key) => {
          const cfg = ATMOSPHERE_PRESETS[key];
          const active = currentPreset === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPresetChange(key)}
              title={`${cfg.label} — ${cfg.description}`}
              className={cn(
                "relative flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all duration-200",
                active
                  ? "bg-gradient-to-r from-emerald-500/20 to-teal-500/20 text-emerald-300 shadow-sm border border-emerald-500/40"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent",
              )}
            >
              <span>{cfg.icon}</span>
              <span className="hidden md:inline">{cfg.label}</span>
              {active && (
                <span
                  className="absolute -bottom-1 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
