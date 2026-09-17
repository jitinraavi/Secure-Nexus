import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import {
  createProject,
  deleteProject,
  getAuditStats,
  getPlans,
  listProjects,
  type PlansResponse,
} from "../api";
import type { AuditStats, Project, ProjectType } from "../types";
import { PROJECT_TYPE_LABELS } from "../types";
import { Badge, Button, Card, Input, Modal, Spinner } from "../components/ui";
import { useToast } from "../components/Toast";
import { formatMoney, timeAgo } from "../lib/format";
import { cn } from "../lib/cn";

const TYPE_GROUPS: { label: string; types: ProjectType[] }[] = [
  { label: "Interiors", types: ["house"] },
  { label: "Buildings", types: ["residential", "villa-community", "townhouse", "commercial"] },
  { label: "Infrastructure", types: ["highway", "airport", "ports", "dams"] },
];

function StatCard({ label, value, icon, accent }: { label: string; value: string | number; icon: string; accent: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${accent}`}>
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d={icon} />
          </svg>
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-50">{value}</p>
          <p className="text-xs font-medium text-slate-400">{label}</p>
        </div>
      </div>
    </Card>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<ProjectType>("residential");
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const deleting = useRef(false);

  const load = useCallback(async () => {
    try {
      const [s, p, proj] = await Promise.all([getAuditStats(), getPlans(), listProjects()]);
      setStats(s);
      setPlans(p);
      setProjects(proj);
    } catch {
      /* handled by global error state fallback */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const project = await createProject(newName.trim(), newType);
      await load();
      setShowNew(false);
      setNewName("");
      setNewType("residential");
      navigate(`/editor/${project.id}`);
    } catch (err) {
      toast.push({ title: "Could not create project", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setCreating(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete || deleting.current) return;
    deleting.current = true;
    try {
      await deleteProject(confirmDelete.id);
      await load();
      toast.push({ title: "Project deleted", tone: "info" });
    } catch (err) {
      toast.push({ title: "Delete failed", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      deleting.current = false;
      setConfirmDelete(null);
    }
  };

  const planBadge =
    user?.plan === "studio" ? (
      <Badge tone="emerald">Studio</Badge>
    ) : user?.plan === "pro" ? (
      <Badge tone="cyan">Pro</Badge>
    ) : (
      <Badge tone="slate">Free</Badge>
    );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">
            Welcome back{user ? `, ${user.username ?? user.email.split("@")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Your design workspace · {planBadge}
            {plans?.isDemo ? (
              <span className="ml-2 text-xs text-amber-300/80">Demo billing mode — no real charges</span>
            ) : null}
          </p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z" /></svg>
          New project
        </Button>
      </div>

      {stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Projects" value={stats.projectsCount} accent="bg-emerald-500/10 text-emerald-400" icon="M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z" />
          <StatCard label="Active sessions" value={stats.activeSessions} accent="bg-cyan-500/10 text-cyan-400" icon="M12 15a3 3 0 100-6 3 3 0 000 6zM4 6l2.5 5L4 16m16 0l-2.5-5L20 6" />
          <StatCard label="Logins (24h)" value={stats.logins24h} accent="bg-emerald-500/10 text-emerald-400" icon="M16 13l-4 4-2-2m2 2V7" />
          <StatCard label="Failed logins (24h)" value={stats.failedLogins24h} accent={stats.failedLogins24h > 0 ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400"} icon="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center"><Spinner className="h-6 w-6 text-emerald-400" /></div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">Projects</h2>
          {plans && plans.plans[0] && user?.plan === "free" ? (
            <Link to="/billing" className="text-sm font-semibold text-emerald-400 hover:text-emerald-300">
              Upgrade to {plans.plans[0].name} — {formatMoney(plans.plans[0].price, plans.plans[0].currency)}
            </Link>
          ) : null}
        </div>

        {projects === null ? (
          <div className="flex h-40 items-center justify-center"><Spinner className="h-6 w-6 text-emerald-400" /></div>
        ) : projects.length === 0 ? (
          <Card className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
              <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor"><path d="M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z" /></svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-200">No projects yet</h3>
            <p className="mt-1 max-w-sm text-sm text-slate-400">
              Create your first room design. Capture or upload a room photo, add furniture, colours and curtains,
              then export to CAD.
            </p>
            <Button className="mt-5" onClick={() => setShowNew(true)}>
              Create your first project
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Card key={p.id} className="group overflow-hidden">
                <Link to={`/editor/${p.id}`} className="block">
                  {p.hasPhoto ? (
                    <div className="relative h-36 w-full overflow-hidden bg-slate-950">
                      <img src={`/api/projects/${p.id}/photo`} alt={p.name} className="h-full w-full object-cover opacity-80 transition group-hover:opacity-100" />
                      <span className="absolute bottom-2 right-2 rounded-md bg-slate-950/80 px-1.5 py-0.5 text-[10px] text-emerald-300 backdrop-blur">Photo</span>
                    </div>
                  ) : (
                    <div className="flex h-36 w-full items-center justify-center bg-gradient-to-br from-slate-900 to-slate-950 text-slate-600">
                      <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor"><path d="M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z" /></svg>
                    </div>
                  )}
                </Link>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link to={`/editor/${p.id}`}>
                        <h3 className="truncate font-semibold text-slate-100 hover:text-emerald-300">{p.name}</h3>
                      </Link>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <Badge tone="cyan">{PROJECT_TYPE_LABELS[p.projectType] ?? p.projectType}</Badge>
                        <p className="text-xs text-slate-500">
                          {p.widthMm / 1000} × {p.depthMm / 1000} m · updated {timeAgo(p.updatedAt)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setConfirmDelete(p)}
                      className="rounded-lg p-1.5 text-slate-400 opacity-60 transition hover:bg-rose-500/10 hover:text-rose-400 sm:opacity-0 sm:group-hover:opacity-100"
                      aria-label={`Delete ${p.name}`}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 01-2 2H9a2 2 0 01-2-2V6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="New project">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="space-y-4"
        >
          <Input label="Project name" placeholder="Apartment living room" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus required />
          <div className="space-y-3">
            <span className="text-sm font-medium text-slate-300">Project type</span>
            {TYPE_GROUPS.map((g) => (
              <div key={g.label}>
                <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">{g.label}</p>
                <div className="grid grid-cols-2 gap-2">
                  {g.types.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setNewType(t)}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-left text-sm font-medium transition",
                        newType === t
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-700 bg-slate-900/70 text-slate-400 hover:border-slate-600",
                      )}
                    >
                      {PROJECT_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button type="submit" loading={creating}>Create & open</Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} title="Delete project?">
        <p className="text-sm text-slate-300">
          "{confirmDelete?.name}" and its design data will be permanently deleted. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => void remove()}>Delete forever</Button>
        </div>
      </Modal>
    </div>
  );
}
