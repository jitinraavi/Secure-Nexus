export function Logo({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <div className="relative h-9 w-11 shrink-0 overflow-hidden rounded-lg bg-slate-950 ring-1 ring-white/10">
        <img src="/logo.png" alt="Groundwork" className="h-full w-full object-cover" />
      </div>
      <div className="leading-tight">
        <p className="text-base font-bold tracking-tight text-slate-100">
          Ground<span className="text-emerald-400">work</span>
        </p>
        <p className="text-[10px] font-medium text-slate-500">Design Studio</p>
      </div>
    </div>
  );
}