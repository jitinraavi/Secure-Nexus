import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import {
  createProject,
  deleteProject,
  duplicateProject,
  getAuditStats,
  getPlans,
  listProjects,
  patchProject,
  type PlansResponse,
} from "../api";
import type { AuditStats, Project, ProjectType } from "../types";
import { PROJECT_TYPE_LABELS } from "../types";
import { Badge, Button, Card, Input, Modal, Select, Spinner, Toggle } from "../components/ui";
import { useToast } from "../components/Toast";
import { formatMoney, timeAgo } from "../lib/format";
import { cn } from "../lib/cn";
import { ProjectWorkspaceLinks } from "../components/ProjectWorkspaceLinks";
import { TiltCard3D } from "../components/TiltCard3D";

const TYPE_GROUPS: { label: string; types: ProjectType[] }[] = [
  { label: "Interiors", types: ["house"] },
  { label: "Buildings", types: ["residential", "villa-community", "townhouse", "commercial"] },
  { label: "Infrastructure", types: ["highway", "airport", "ports", "dams"] },
];

function StatCard({ label, value, icon, accent }: { label: string; value: string | number; icon: string; accent: string }) {
  return (
    <TiltCard3D maxTilt={6} scale={1.02}>
      <Card className="p-5 border border-slate-800/80 bg-slate-900/60 backdrop-blur-xl shadow-lg">
        <div className="flex items-center gap-4">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-inner ${accent}`}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d={icon} />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-50 tracking-tight">{value}</p>
            <p className="text-xs font-medium text-slate-400">{label}</p>
          </div>
        </div>
      </Card>
    </TiltCard3D>
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
  const [showTemplates, setShowTemplates] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [search, setSearch] = useState("");
  const [libraryView, setLibraryView] = useState("active");
  const [folderFilter, setFolderFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [libraryProject, setLibraryProject] = useState<Project | null>(null);
  const [folder, setFolder] = useState("");
  const [isTemplate, setIsTemplate] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [copyProject, setCopyProject] = useState<Project | null>(null);
  const [copyName, setCopyName] = useState("");
  const [copyBusy, setCopyBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const deleting = useRef(false);

  const load = useCallback(async () => {
    try {
      const [s, p, proj] = await Promise.all([getAuditStats(), getPlans(), listProjects()]);
      setStats(s);
      setPlans(p);
      setProjects(proj);
      setLoadError("");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load your workspace");
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

  const folders = useMemo(() => [...new Set((projects ?? []).map((project) => project.folder?.trim()).filter((value): value is string => Boolean(value)))].sort(), [projects]);
  const visibleProjects = useMemo(() => (projects ?? []).filter((project) => {
    const matchesView = libraryView === "all" || (libraryView === "archive" ? Boolean(project.archived) : libraryView === "templates" ? Boolean(project.isTemplate) : !project.archived);
    const matchesFolder = folderFilter === "all" || (project.folder ?? "") === folderFilter.slice(7);
    const matchesRole = roleFilter === "all" || (roleFilter === "owned" ? project.role === "owner" : project.role !== "owner");
    return matchesView && matchesFolder && matchesRole && `${project.name} ${project.folder ?? ""} ${PROJECT_TYPE_LABELS[project.projectType]}`.toLowerCase().includes(search.trim().toLowerCase());
  }), [projects, libraryView, folderFilter, roleFilter, search]);

  const organize = async () => {
    if (!libraryProject || libraryBusy) return;
    setLibraryBusy(true);
    try {
      await patchProject(libraryProject.id, { folder: folder.trim(), isTemplate, baseRevision: libraryProject.revision });
      setLibraryProject(null);
      await load();
      toast.push({ title: "Project library updated", tone: "success" });
    } catch (err) {
      toast.push({ title: "Library update failed", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally { setLibraryBusy(false); }
  };

  const archive = async (project: Project) => {
    if (libraryBusy) return;
    setLibraryBusy(true);
    try {
      await patchProject(project.id, { archived: !project.archived, baseRevision: project.revision });
      await load();
      toast.push({ title: project.archived ? "Project restored to active work" : "Project archived", tone: "info" });
    } catch (err) {
      toast.push({ title: "Archive update failed", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally { setLibraryBusy(false); }
  };

  const duplicate = async () => {
    if (!copyProject || !copyName.trim() || copyBusy) return;
    setCopyBusy(true);
    try {
      const created = await duplicateProject(copyProject.id, copyName.trim());
      setCopyProject(null);
      await load();
      navigate(`/editor/${created.id}`);
    } catch (err) {
      toast.push({ title: "Could not copy project", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally { setCopyBusy(false); }
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
          <p className="gw-kicker">Studio / workspace</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-50">
            Welcome back<span className="text-emerald-300">.</span>{user ? ` ${user.username ?? user.email.split("@")[0]}` : ""}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Your active design work, in one place · {planBadge}
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

      {loadError && <Card className="p-4 text-sm text-rose-300"><p>{loadError}</p><Button className="mt-3" variant="secondary" onClick={() => void load()}>Retry loading</Button></Card>}

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

       <div className="space-y-5">
         <div className="flex items-center justify-between">
           <div><p className="gw-kicker">Recent work</p><h2 className="mt-1 text-xl font-bold text-slate-100">Projects</h2></div>
          {plans && plans.plans[0] && user?.plan === "free" ? (
            <Link to="/billing" className="text-sm font-semibold text-emerald-400 hover:text-emerald-300">
              Upgrade to {plans.plans[0].name} — {formatMoney(plans.plans[0].price, plans.plans[0].currency)}
            </Link>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Search projects" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, folder or project type" />
          <Select label="Library view" value={libraryView} onChange={(event) => setLibraryView(event.target.value)}>
            <option value="active">Active projects</option><option value="archive">Archived projects</option><option value="templates">Templates</option><option value="all">All projects</option>
          </Select>
          <Select label="Folder" value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)}>
            <option value="all">All folders</option><option value="folder:">Unfiled</option>{folders.map((name) => <option key={name} value={`folder:${name}`}>{name}</option>)}
          </Select>
          <Select label="Access" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="all">All accessible projects</option><option value="owned">Owned by me</option><option value="shared">Shared with me</option>
          </Select>
        </div>
        <p className="text-xs text-slate-500">Archiving organizes the library and preserves design access, collaborators and share links. Free accounts can keep one owned project active.</p>

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
            {visibleProjects.length === 0 && <Card className="p-6 text-sm text-slate-400">No projects match these library filters.</Card>}
            {visibleProjects.map((p) => (
              <TiltCard3D key={p.id} maxTilt={5} scale={1.015}>
                <Card className="group h-full overflow-hidden border border-slate-800/80 bg-slate-900/60 backdrop-blur-xl transition-all duration-300 hover:shadow-2xl hover:shadow-emerald-500/10 hover:border-slate-700">
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
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Badge tone="slate">{p.role ?? "owner"}</Badge>
                          {p.folder && <Badge tone="slate">{p.folder}</Badge>}
                          {p.archived && <Badge tone="amber">Archived</Badge>}
                          {p.isTemplate && <Badge tone="emerald">Template</Badge>}
                        </div>
                      </div>
                      {p.role === "owner" && <button
                        onClick={() => setConfirmDelete(p)}
                        className="rounded-lg p-1.5 text-slate-400 opacity-60 transition hover:bg-rose-500/10 hover:text-rose-400 sm:opacity-0 sm:group-hover:opacity-100"
                        aria-label={`Delete ${p.name}`}
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 01-2 2H9a2 2 0 01-2-2V6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>}
                    </div>
                    <div className="mt-3"><ProjectWorkspaceLinks projectId={p.id} /></div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => { setCopyProject(p); setCopyName(`${p.name} copy`.slice(0, 80)); }}>{p.isTemplate ? "Use template" : "Duplicate"}</Button>
                      {p.role === "owner" && <>
                        <Button size="sm" variant="ghost" onClick={() => { setLibraryProject(p); setFolder(p.folder ?? ""); setIsTemplate(Boolean(p.isTemplate)); }}>Organize</Button>
                        <Button size="sm" variant="ghost" disabled={libraryBusy} onClick={() => void archive(p)}>{p.archived ? "Restore" : "Archive"}</Button>
                      </>}
                    </div>
                  </div>
                </Card>
              </TiltCard3D>
            ))}
          </div>
        )}
      </div>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="New 3D Project">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="space-y-5"
        >
          <Input
            label="Project name"
            placeholder="e.g. My Freeform Canvas, Sky Tower, or Greenfield Plot"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            required
          />

          {/* Default Freeform Option */}
          <div className="relative overflow-hidden rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 via-slate-900/80 to-slate-950 p-4 shadow-lg shadow-emerald-500/5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-slate-100">Freeform 3D Canvas (Build Whatever You Want)</h4>
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-300">DEFAULT</span>
                </div>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                  Start with a clean, open 3D workspace. Freely design any structures, custom land parcels, parking dimensions, landscaping, and architecture without forced template constraints.
                </p>
              </div>
            </div>
          </div>

          {/* Optional Archetype / Template Picker */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <button
              type="button"
              onClick={() => setShowTemplates((v) => !v)}
              className="flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200 transition"
            >
              <span className="flex items-center gap-2">
                <svg className={cn("h-4 w-4 transition-transform text-slate-500", showTemplates ? "rotate-90 text-emerald-400" : "")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Choose a building template / archetype (Optional)</span>
              </span>
              <span className="text-[11px] font-normal normal-case text-slate-500">
                {showTemplates ? "Hide templates" : `Current: ${PROJECT_TYPE_LABELS[newType] ?? "Freeform"}`}
              </span>
            </button>

            {showTemplates && (
              <div className="mt-4 space-y-3 border-t border-slate-800/80 pt-3">
                {TYPE_GROUPS.map((g) => (
                  <div key={g.label}>
                    <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{g.label}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {g.types.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setNewType(t)}
                          className={cn(
                            "rounded-xl border px-3 py-2 text-left text-xs font-medium transition",
                            newType === t
                              ? "border-emerald-500 bg-emerald-500/15 text-emerald-300 shadow-sm shadow-emerald-500/20"
                              : "border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700 hover:text-slate-200",
                          )}
                        >
                          {PROJECT_TYPE_LABELS[t]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button type="submit" loading={creating}>Create Canvas & Open</Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(libraryProject)} onClose={() => setLibraryProject(null)} title={`Organize ${libraryProject?.name ?? "project"}`}>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void organize(); }}>
          <Input label="Folder" value={folder} onChange={(event) => setFolder(event.target.value)} maxLength={80} placeholder="Campus / Building A" list="project-folders" />
          <datalist id="project-folders">{folders.map((name) => <option key={name} value={name} />)}</datalist>
          <Toggle checked={isTemplate} onChange={setIsTemplate} label="Use this project as a template" />
          <p className="text-xs text-slate-400">Templates remain accessible to their existing project members. Using a template creates a separate owned design without its photos, permissions, history or share links.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setLibraryProject(null)}>Cancel</Button><Button type="submit" loading={libraryBusy}>Save library settings</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(copyProject)} onClose={() => setCopyProject(null)} title={copyProject?.isTemplate ? "Create from template" : "Duplicate project"}>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void duplicate(); }}>
          <Input label="New project name" value={copyName} onChange={(event) => setCopyName(event.target.value)} minLength={1} maxLength={80} required />
          <p className="text-xs text-slate-400">Copies the saved design and dimensions into your account. Photos, team access, history and share links remain with the source.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setCopyProject(null)}>Cancel</Button><Button type="submit" loading={copyBusy}>Create & open</Button></div>
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

