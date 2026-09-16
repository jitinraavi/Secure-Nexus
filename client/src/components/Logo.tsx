export function Logo({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 shadow-lg shadow-emerald-500/30">
        <svg className="h-5 w-5 text-emerald-950" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2zm0 2.3L6 7.5v7l6 3.4 6-3.4v-7l-6-3.2zm-1 3h2v6h-2V7.3z" />
        </svg>
      </div>
      <div className="leading-tight">
        <p className="text-base font-bold tracking-tight text-slate-100">
          Secure<span className="text-emerald-400">Nexus</span>
        </p>
        <p className="text-[10px] font-medium text-slate-500">Interior Studio</p>
      </div>
    </div>
  );
}