import type { CSSProperties, ReactNode } from "react";

export function PageIntro({ eyebrow, title, description, variant = "pavilion", actions }: { eyebrow: string; title: string; description: string; variant?: "pavilion" | "city" | "structure" | "interior"; actions?: ReactNode }) {
  return <div className="gw-page-intro">
    <div className="min-w-0"><p className="gw-kicker">{eyebrow}</p><h1>{title}</h1><p>{description}</p>{actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}</div>
    <div className="gw-spatial-mark" data-variant={variant} aria-hidden="true"><div className="gw-spatial-stack">{[0, 16, 32].map(level => <i key={level} style={{ "--level": `${level}px` } as CSSProperties} />)}</div></div>
  </div>;
}
