import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSharedProject } from "../api";
import type { SharedProject } from "../types";
import { Badge, Card, Spinner } from "../components/ui";
import { PROJECT_TYPE_LABELS } from "../types";

export function SharedProject() {
  const { token = "" } = useParams<{ token: string }>();
  const [project, setProject] = useState<SharedProject | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void getSharedProject(token).then(setProject).catch((err) => setError(err instanceof Error ? err.message : "This share link is unavailable."));
  }, [token]);

  if (!project && !error) return <div className="flex min-h-screen items-center justify-center"><Spinner className="h-7 w-7 text-emerald-400" /></div>;
  if (error) return <div className="flex min-h-screen items-center justify-center px-5"><Card className="max-w-md p-6 text-center"><h1 className="text-lg font-semibold text-slate-100">Share link unavailable</h1><p className="mt-2 text-sm text-slate-400">{error}</p></Card></div>;
  if (!project) return null;

  return <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-100 sm:px-8">
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-4"><div><p className="gw-kicker">Groundwork / shared view</p><h1 className="mt-2 text-3xl font-black tracking-tight">{project.name}</h1><p className="mt-2 text-sm text-slate-400">{PROJECT_TYPE_LABELS[project.projectType] ?? project.projectType} · {project.widthMm / 1000} × {project.depthMm / 1000} m</p></div><Badge tone="emerald">Read only</Badge></div>
      <Card className="p-5"><p className="text-sm text-slate-400">This design was shared for viewing. Editing, restoring, and sharing are disabled.</p><pre className="mt-4 max-h-[65vh] overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs leading-relaxed text-slate-300">{JSON.stringify(project.design, null, 2)}</pre></Card>
      <p className="mt-4 text-center text-xs text-slate-600">Link expires {new Date(project.expiresAt * 1000).toLocaleString()}</p>
    </div>
  </main>;
}
