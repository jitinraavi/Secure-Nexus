export function Logo({ className }: { className?: string }) {
  return (
    <div className={`flex items-center ${className ?? ""}`}>
      <img
        src="/logo.png"
        alt="Groundwork Design Studio"
        className="h-auto w-48 rounded-lg object-contain shadow-[0_8px_30px_rgba(0,0,0,.25)] sm:w-52"
      />
    </div>
  );
}
