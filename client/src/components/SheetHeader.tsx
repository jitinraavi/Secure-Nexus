import { type ReactNode } from "react";
import { Badge } from "./ui";

export function SheetHeader({
  eyebrow,
  title,
  meta,
  tone = "slate",
}: {
  eyebrow: string;
  title: ReactNode;
  meta: ReactNode;
  tone?: "slate" | "emerald" | "cyan" | "amber";
}) {
  return (
    <header className="gw-sheet-header">
      <div className="min-w-0">
        <p className="gw-kicker">{eyebrow}</p>
        <h1 className="mt-1 truncate text-base font-semibold tracking-tight text-slate-100 sm:text-lg">{title || "Untitled project"}</h1>
      </div>
      <Badge tone={tone}>{meta}</Badge>
    </header>
  );
}
