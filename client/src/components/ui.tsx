import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

const modalStack: HTMLDivElement[] = [];
let overflowBeforeModals = "";

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}) {
  const variants: Record<string, string> = {
    primary: "gw-button-primary",
    secondary: "gw-button-secondary",
    outline: "gw-button-outline",
    ghost: "gw-button-ghost",
    danger: "gw-button-danger",
  };
  const sizes: Record<string, string> = {
    sm: "gw-button-sm px-2.5 py-1.5 text-xs rounded-lg gap-1.5",
    md: "px-4 py-2 text-sm rounded-xl gap-2",
    lg: "gw-button-lg px-5 py-2.5 text-base rounded-xl gap-2",
  };
  return (
    <button
      className={cn(
        "gw-button inline-flex items-center justify-center font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none" role="status" aria-label="Loading">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function Input({
  label,
  error,
  icon,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; icon?: ReactNode }) {
  const errorId = useId();
  return (
    <label className="block space-y-1.5">
      {label && <span className="text-sm font-medium text-slate-300">{label}</span>}
      <div className="relative">
        {icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">{icon}</span>}
        <input
          className={cn(
            "gw-field w-full px-3.5 py-2.5 text-sm transition",
            icon ? "pl-10" : undefined,
            error && "border-rose-500/70 focus:border-rose-500 focus:ring-rose-500/30",
            className,
          )}
          {...props}
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={[props["aria-describedby"], error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
        />
      </div>
      {error && <span id={errorId} role="alert" className="text-xs text-rose-400">{error}</span>}
    </label>
  );
}

export function Select({
  label,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="text-sm font-medium text-slate-300">{label}</span>}
      <select
        className={cn(
          "gw-field w-full px-3.5 py-2.5 text-sm transition",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("gw-panel rounded-2xl", className)}>
      {children}
    </div>
  );
}

export function Badge({ tone = "slate", children }: { tone?: "slate" | "emerald" | "rose" | "cyan" | "amber"; children: ReactNode }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-800 text-slate-300 border-slate-700",
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    rose: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    cyan: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
    amber: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", tones[tone])}>
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const activeDialog = dialog.current;
    if (!activeDialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!modalStack.length) overflowBeforeModals = document.body.style.overflow;
    modalStack.push(activeDialog);
    document.body.style.overflow = "hidden";
    const isTopDialog = () => modalStack[modalStack.length - 1] === activeDialog;
    const focusable = () => Array.from(activeDialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]')).filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden" && !element.closest("[inert]"));
    const frame = requestAnimationFrame(() => {
      if (!isTopDialog()) return;
      const elements = focusable();
      const target = activeDialog.contains(document.activeElement) ? document.activeElement as HTMLElement : elements.find(element => element.matches("input, select, textarea")) ?? elements[0] ?? activeDialog;
      target?.focus();
    });
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTopDialog()) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) { event.preventDefault(); activeDialog.focus(); return; }
      const first = elements[0], last = elements[elements.length - 1];
      const currentIndex = elements.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && currentIndex <= 0) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (currentIndex < 0 || document.activeElement === last)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKey);
      const wasTopDialog = isTopDialog();
      const index = modalStack.indexOf(activeDialog);
      if (index >= 0) modalStack.splice(index, 1);
      if (!modalStack.length) document.body.style.overflow = overflowBeforeModals;
      if (wasTopDialog) {
        const remaining = modalStack[modalStack.length - 1];
        if (previous?.isConnected && (!remaining || remaining.contains(previous))) previous.focus();
        else remaining?.focus();
      }
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        ref={dialog}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "gw-modal relative w-full rounded-2xl",
          wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h3 id={titleId} className="text-base font-semibold text-slate-100">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:text-slate-200" aria-label={`Close ${title}`}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>, document.body
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3"
      role="switch"
      aria-checked={checked}
      aria-label={label || "Toggle setting"}
    >
      <span
        className={cn(
          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
          checked ? "bg-emerald-500" : "bg-slate-700",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </span>
      {label && <span className="text-sm text-slate-300">{label}</span>}
    </button>
  );
}

export function FieldGroup({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{label}</span>
        {value && <span className="text-xs text-slate-500">{value}</span>}
      </div>
      {children}
    </div>
  );
}
