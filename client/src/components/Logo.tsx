export function Logo({ className }: { className?: string }) {
  return (
    <div className={`gw-logo flex items-center ${className ?? ""}`} aria-label="Groundwork Design Studio">
      <svg className="gw-logo-mark" width="32" height="36" viewBox="0 0 32 36" fill="none" aria-hidden="true">
        <path d="M16 2 30 10v16l-14 8L2 26V10L16 2Z" stroke="currentColor" strokeWidth="1.4" />
        <path d="m2 10 14 8 14-8M16 18v16M9 6l14 8v8l-7 4-7-4v-8l14-8" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <span className="gw-logo-word">Groundwork<span className="text-emerald-400">.</span></span>
    </div>
  );
}
