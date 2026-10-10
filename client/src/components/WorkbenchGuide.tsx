import { lazy, Suspense } from "react";
const Scene = lazy(() => import("./ArchitecturalScene"));

const GUIDES = {
  geometry: { variant: "pavilion" as const, label: "From model to material", steps: [["Connect your project", "Load a saved workspace or import a geometry file below."], ["Explore in 3D", "Inspect meshes, find intersections, and choose a view."], ["Create your output", "Render an image or export a package for your next tool."]] },
  engineering: { variant: "structure" as const, label: "From concept to calculation", steps: [["Define the basis", "Connect your project and confirm your engineering assumptions."], ["Choose a system", "Select a module and edit or import its engineering dataset."], ["Review the results", "Calculate, inspect the report, and export for independent review."]] },
  exchange: { variant: "city" as const, label: "From one tool to the next", steps: [["Connect your project", "Load a workspace to keep your imported sources together."], ["Choose your format", "Work with IFC models, survey data, or civil alignments."], ["Inspect and export", "Review findings and export the result to your next workspace."]] },
};

export function WorkbenchGuide({ kind }: { kind: keyof typeof GUIDES }) {
  const guide = GUIDES[kind];
  return <details className="gw-workbench-guide gw-panel" open>
    <summary><span className="gw-kicker">Getting started</span><span>{guide.label}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg></summary>
    <div className="gw-guide-content"><div className="gw-guide-scene"><Suspense fallback={<div className="gw-skeleton h-full w-full" />}><Scene variant={guide.variant} compact interactive={false} /></Suspense><span>Concept study · illustrative model</span></div><div className="gw-guide-steps">{guide.steps.map(([title, description], index) => <div key={title}><span className="gw-guide-number">0{index + 1}</span><div><h2>{title}</h2><p>{description}</p></div></div>)}</div></div>
  </details>;
}
