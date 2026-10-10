import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { createProject, deleteProject, duplicateProject, getAuditStats, getPlans, listProjects, patchProject, type PlansResponse } from "../api";
import type { AuditStats, Project, ProjectType } from "../types";
import { PROJECT_TYPE_LABELS } from "../types";
import { Badge, Button, Card, Input, Modal, Select, Spinner, Toggle } from "../components/ui";
import { useToast } from "../components/Toast";
import { formatMoney, timeAgo } from "../lib/format";
import { cn } from "../lib/cn";
import { ProjectWorkspaceLinks } from "../components/ProjectWorkspaceLinks";
import { ArchitecturalScene } from "../components/ArchitecturalScene";
import { TiltCard3D } from "../components/TiltCard3D";

const TYPE_GROUPS: { label: string; description: string; types: ProjectType[] }[] = [
  { label: "Interiors", description: "Shape the spaces we live in.", types: ["house"] },
  { label: "Buildings", description: "From a single home to an entire community.", types: ["residential", "villa-community", "townhouse", "commercial"] },
  { label: "Infrastructure", description: "Design connections at a larger scale.", types: ["highway", "airport", "ports", "dams"] },
];
const LIBRARY_VIEWS = [{ value: "active", label: "Active" }, { value: "templates", label: "Templates" }, { value: "archive", label: "Archived" }, { value: "all", label: "All projects" }];

function Icon({ path, className }: { path: string; className?: string }) {
  return <svg className={cn("h-4 w-4", className)} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
}
function ProjectModel({ type = "residential" }: { type?: ProjectType }) {
  const infrastructure = ["highway", "airport", "ports", "dams"].includes(type);
  return <div className={cn("studio-project-model", infrastructure && "is-infrastructure", type === "house" && "is-interior")} aria-hidden="true"><div className="studio-model-grid" /><div className="studio-model-platform" /><div className="studio-model-building model-one"><i /><i /><i /></div><div className="studio-model-building model-two"><i /><i /><i /></div><div className="studio-model-building model-three"><i /><i /><i /></div><span className="studio-model-tree tree-one" /><span className="studio-model-tree tree-two" /><span className="studio-model-shadow" /></div>;
}
function StatCard({ label, value, icon, note, warning }: { label: string; value: string | number; icon: string; note: string; warning?: boolean }) {
  return <TiltCard3D maxTilt={6} scale={1.02} className="studio-card-tilt min-w-0 rounded-xl"><Card className={cn("studio-stat-card", warning && "is-warning")}><div className="studio-stat-heading"><span>{label}</span><Icon path={icon} /></div><strong>{value}</strong><p>{note}</p></Card></TiltCard3D>;
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
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [libraryView, setLibraryView] = useState("active");
  const [folderFilter, setFolderFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [displayView, setDisplayView] = useState<"grid" | "list">("grid");
  const [libraryProject, setLibraryProject] = useState<Project | null>(null);
  const [folder, setFolder] = useState("");
  const [isTemplate, setIsTemplate] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [copyProject, setCopyProject] = useState<Project | null>(null);
  const [copyName, setCopyName] = useState("");
  const [copyBusy, setCopyBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const deleting = useRef(false);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    const results = await Promise.allSettled([getAuditStats(), getPlans(), listProjects()]);
    if (generation !== loadGeneration.current) return;
    const [audit, billing, library] = results;
    if (audit.status === "fulfilled") setStats(audit.value);
    if (billing.status === "fulfilled") setPlans(billing.value);
    if (library.status === "fulfilled") setProjects(library.value);
    const failed = results.filter((result) => result.status === "rejected");
    setLoadError(failed.map((result) => result.status === "rejected" && result.reason instanceof Error ? result.reason.message : "A part of your workspace could not be loaded.").join(" "));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); return () => { loadGeneration.current += 1; }; }, [load]);

  const create = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const project = await createProject(newName.trim(), newType);
      await load();
      setShowNew(false); setNewName(""); setNewType("residential");
      navigate(`/editor/${project.id}`);
    } catch (err) {
      toast.push({ title: "Could not create project", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally { setCreating(false); }
  };
  const remove = async () => {
    if (!confirmDelete || deleting.current) return;
    deleting.current = true; setDeleteBusy(true);
    try {
      await deleteProject(confirmDelete.id);
      await load();
      setConfirmDelete(null);
      toast.push({ title: "Project deleted", tone: "info" });
    } catch (err) {
      toast.push({ title: "Delete failed", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally { deleting.current = false; setDeleteBusy(false); }
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
      setLibraryProject(null); await load();
      toast.push({ title: "Project library updated", tone: "success" });
    } catch (err) { toast.push({ title: "Library update failed", description: err instanceof Error ? err.message : undefined, tone: "error" }); }
    finally { setLibraryBusy(false); }
  };
  const archive = async (project: Project) => {
    if (libraryBusy) return;
    setLibraryBusy(true);
    try {
      await patchProject(project.id, { archived: !project.archived, baseRevision: project.revision });
      await load();
      toast.push({ title: project.archived ? "Project restored to active work" : "Project archived", tone: "info" });
    } catch (err) { toast.push({ title: "Archive update failed", description: err instanceof Error ? err.message : undefined, tone: "error" }); }
    finally { setLibraryBusy(false); }
  };
  const duplicate = async () => {
    if (!copyProject || !copyName.trim() || copyBusy) return;
    setCopyBusy(true);
    try {
      const created = await duplicateProject(copyProject.id, copyName.trim());
      setCopyProject(null); await load(); navigate(`/editor/${created.id}`);
    } catch (err) { toast.push({ title: "Could not copy project", description: err instanceof Error ? err.message : undefined, tone: "error" }); }
    finally { setCopyBusy(false); }
  };
  const resetFilters = () => { setSearch(""); setFolderFilter("all"); setRoleFilter("all"); setLibraryView("active"); };
  const displayName = user?.username || user?.email.split("@")[0];

  return (
    <div className="studio-dashboard">
      <div className="studio-page-heading"><div><p className="gw-kicker">YOUR DESIGN STUDIO</p><h1>Workspace overview<span>.</span></h1><p>Welcome back{displayName ? `, ${displayName}` : ""}. Let's make room for your next idea.</p></div><Button onClick={() => setShowNew(true)}><Icon path="M12 5v14M5 12h14" />New project</Button></div>
      <section className="studio-welcome" aria-labelledby="studio-welcome-title"><div className="studio-welcome-copy"><span className="studio-eyebrow"><span /> FROM FIRST IDEA TO FINAL FORM</span><h2 id="studio-welcome-title">Great spaces start<br />with a little imagination.</h2><p>Bring your designs to life. Create, explore and refine your world in one connected workspace.</p><div className="studio-welcome-actions"><Button onClick={() => setShowNew(true)}>Start a new project<Icon path="M5 12h14m-5-5 5 5-5 5" /></Button><Link to="/geometry">Explore your tools<Icon path="m9 5 7 7-7 7" /></Link></div></div><div className="studio-welcome-visual"><ArchitecturalScene variant="pavilion" className="studio-welcome-scene" interactive /><span className="studio-scene-caption"><span /> Architectural concept · 3D study</span></div><span className="studio-welcome-coordinate" aria-hidden="true">FORM / SPACE / POSSIBILITY</span></section>
      {loadError && <div className="studio-load-error" role="alert"><Icon path="M12 8v5m0 3h.01M12 3 2 21h20z" /><div><strong>Some workspace information is unavailable</strong><p>{loadError}</p></div><Button variant="secondary" size="sm" loading={loading} onClick={() => void load()}>Retry</Button></div>}
      <section className="studio-stat-grid" aria-label="Workspace statistics" aria-busy={loading}><StatCard label="Total projects" value={stats?.projectsCount ?? (loading ? "…" : "—")} note="Across your workspace" icon="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z" /><StatCard label="Active sessions" value={stats?.activeSessions ?? (loading ? "…" : "—")} note="Connected to your account" icon="M3 4h18v12H3zm5 16h8m-4-4v4" /><StatCard label="Successful logins" value={stats?.logins24h ?? (loading ? "…" : "—")} note="In the past 24 hours" icon="m5 13 4 4L19 7" /><StatCard label="Failed logins" value={stats?.failedLogins24h ?? (loading ? "…" : "—")} note="In the past 24 hours" icon="M12 3 2 21h20zM12 9v4m0 3h.01" warning={Boolean(stats && stats.failedLogins24h > 0)} /></section>
      <section className="studio-library" aria-labelledby="studio-projects-title"><div className="studio-section-heading"><div><p className="gw-kicker">MAKE SOMETHING MEANINGFUL</p><h2 id="studio-projects-title">Your projects<span className="studio-count">{projects?.length ?? "—"}</span></h2></div>{plans?.plans[0] && user?.plan === "free" && <Link to="/billing" className="studio-upgrade-link">Explore {plans.plans[0].name}<span>{formatMoney(plans.plans[0].price, plans.plans[0].currency)}</span><Icon path="m9 5 7 7-7 7" /></Link>}</div>
        <div className="studio-library-tabs"><div className="studio-library-tab-list" aria-label="Project library views">{LIBRARY_VIEWS.map((view) => <button key={view.value} type="button" aria-pressed={libraryView === view.value} className={cn("studio-library-tab", libraryView === view.value && "is-active")} onClick={() => setLibraryView(view.value)}>{view.label}{view.value === "active" && projects && <span>{projects.filter((project) => !project.archived).length}</span>}</button>)}</div><div className="studio-view-switch" aria-label="Project display"><button type="button" className={cn(displayView === "grid" && "is-active")} onClick={() => setDisplayView("grid")} aria-label="Show project grid" aria-pressed={displayView === "grid"}><Icon path="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z" /></button><button type="button" className={cn(displayView === "list" && "is-active")} onClick={() => setDisplayView("list")} aria-label="Show project list" aria-pressed={displayView === "list"}><Icon path="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01" /></button></div></div>
        <div className="studio-project-filters"><Input aria-label="Search projects" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, folder or type…" icon={<Icon path="M21 21l-5-5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0" />} /><Select aria-label="Filter projects by folder" value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)}><option value="all">All folders</option><option value="folder:">Unfiled</option>{folders.map((name) => <option key={name} value={`folder:${name}`}>{name}</option>)}</Select><Select aria-label="Filter projects by access" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">All access</option><option value="owned">Owned by me</option><option value="shared">Shared with me</option></Select></div>
        {projects === null ? <div className="studio-empty-state" role="status">{loading ? <><Spinner className="h-6 w-6" /><h3>Opening your workspace</h3><p>Your projects will be ready in a moment.</p></> : <><Icon path="M12 8v5m0 3h.01M12 3 2 21h20z" className="h-8 w-8" /><h3>Your projects couldn't be loaded</h3><p>Try again to reconnect to your project library.</p><Button variant="secondary" onClick={() => void load()}>Reload projects</Button></>}</div> : projects.length === 0 ? <div className="studio-empty-state studio-first-project"><div className="studio-empty-model"><ProjectModel /></div><div><p className="gw-kicker">A FRESH CANVAS</p><h3>Your next idea belongs here.</h3><p>Start with a room, a building or something bigger. Give your project a name and begin shaping it in 3D.</p><Button onClick={() => setShowNew(true)}><Icon path="M12 5v14M5 12h14" />Create your first project</Button></div></div> : visibleProjects.length === 0 ? <div className="studio-empty-state"><Icon className="h-8 w-8" path="M21 21l-5-5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0" /><h3>No projects in this view</h3><p>Try a different search or reset your library filters.</p><Button variant="secondary" onClick={resetFilters}>Reset filters</Button></div> : <div className={cn("studio-project-grid", displayView === "list" && "is-list")}>
          {visibleProjects.map((p) => <TiltCard3D key={p.id} maxTilt={displayView === "grid" ? 5 : 0} scale={displayView === "grid" ? 1.015 : 1} className="studio-card-tilt min-w-0 rounded-xl"><Card className="studio-project-card h-full"><Link to={`/editor/${p.id}`} className="studio-project-thumbnail" aria-label={`Open ${p.name}`}>
            {p.hasPhoto ? <img src={`/api/projects/${p.id}/photo`} alt={`Room photo for ${p.name}`} loading="lazy" /> : <ProjectModel type={p.projectType} />}
            <span className="studio-thumbnail-type">{PROJECT_TYPE_LABELS[p.projectType] ?? p.projectType}</span><span className="studio-thumbnail-open"><Icon path="M7 17 17 7M7 7h10v10" /></span>{!p.hasPhoto && <span className="studio-thumbnail-note">Illustrative model</span>}
          </Link><div className="studio-project-details"><div className="studio-project-title-row"><Link to={`/editor/${p.id}`}><h3>{p.name}</h3></Link><Badge tone={p.role === "owner" ? "emerald" : "slate"}>{p.role ?? "owner"}</Badge></div><p className="studio-project-meta">{p.widthMm / 1000} × {p.depthMm / 1000} m<span>·</span>Updated {timeAgo(p.updatedAt)}</p><div className="studio-project-tags">{p.folder && <span><Icon path="M3 7V4h6l2 3h10v13H3z" />{p.folder}</span>}{p.archived && <Badge tone="amber">Archived</Badge>}{p.isTemplate && <Badge tone="emerald">Template</Badge>}</div><div className="studio-project-workspaces"><ProjectWorkspaceLinks projectId={p.id} /></div><div className="studio-project-actions"><Button size="sm" variant="secondary" onClick={() => { setCopyProject(p); setCopyName(`${p.name} copy`.slice(0, 80)); }}><Icon path="M8 8h13v13H8zM16 8V3H3v13h5" />{p.isTemplate ? "Use template" : "Duplicate"}</Button>{p.role === "owner" && <><Button size="sm" variant="ghost" onClick={() => { setLibraryProject(p); setFolder(p.folder ?? ""); setIsTemplate(Boolean(p.isTemplate)); }}>Organize</Button><Button size="sm" variant="ghost" disabled={libraryBusy} onClick={() => void archive(p)}>{p.archived ? "Restore" : "Archive"}</Button><button type="button" className="studio-project-delete" aria-label={`Delete ${p.name}`} title="Delete project" onClick={() => setConfirmDelete(p)}><Icon path="M3 6h18M8 6V3h8v3M6 6v15h12V6M10 10v7m4-7v7" /></button></>}</div></div></Card></TiltCard3D>)}
        </div>}
        <div className="studio-library-footnote"><Icon path="M6 7V3h12v4M4 7h16v14H4zM9 12h6" /><p>Archived projects keep their designs, collaborators and share links. Free accounts can keep one owned project active.</p>{projects && <span>{visibleProjects.length} of {projects.length} projects</span>}</div>
      </section>
      <section className="studio-workspace-shortcuts" aria-label="Explore design workspaces"><Link to="/geometry"><span className="studio-shortcut-number">01 / DESIGN</span><strong>Geometry & rendering<Icon path="M7 17 17 7M7 7h10v10" /></strong><p>Give every detail a new dimension.</p><div className="studio-shortcut-shape shortcut-cube" aria-hidden="true"><i /><i /><i /></div></Link><Link to="/engineering"><span className="studio-shortcut-number">02 / ANALYSE</span><strong>Engineering<Icon path="M7 17 17 7M7 7h10v10" /></strong><p>Build on a considered foundation.</p><div className="studio-shortcut-shape shortcut-columns" aria-hidden="true"><i /><i /><i /></div></Link><Link to="/exchange"><span className="studio-shortcut-number">03 / CONNECT</span><strong>BIM & civil exchange<Icon path="M7 17 17 7M7 7h10v10" /></strong><p>Keep your project moving forward.</p><div className="studio-shortcut-shape shortcut-planes" aria-hidden="true"><i /><i /><i /></div></Link></section>
      {plans?.isDemo && <p className="studio-demo-note">Demo billing mode · No real charges</p>}
      <Modal open={showNew} onClose={() => { if (!creating) setShowNew(false); }} title="Start something new" wide><form onSubmit={(event) => { event.preventDefault(); void create(); }} className="studio-create-form"><p className="studio-modal-intro">Every great space begins with an idea. Name your project and choose the kind of world you want to build.</p><Input label="Project name" placeholder="e.g. The courtyard residence" value={newName} onChange={(event) => setNewName(event.target.value)} autoFocus required maxLength={80} disabled={creating} /><fieldset disabled={creating} className="studio-project-types"><legend>What are you designing?</legend>{TYPE_GROUPS.map((group) => <div key={group.label} className="studio-type-group"><div className="studio-type-group-label"><strong>{group.label}</strong><span>{group.description}</span></div><div className="studio-type-options">{group.types.map((type) => <button key={type} type="button" onClick={() => setNewType(type)} aria-pressed={newType === type} className={cn("studio-type-option", newType === type && "is-selected")}><Icon path={group.label === "Infrastructure" ? "M3 20V4h18v16M8 4v16m8-16v16M3 12h18" : type === "house" ? "m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8" : "M4 21V3h16v18M8 7h2m4 0h2M8 11h2m4 0h2M8 15h2m4 0h2M10 21v-3h4v3"} /><span>{PROJECT_TYPE_LABELS[type]}</span><span className="studio-type-check"><Icon path="m5 12 4 4L19 6" /></span></button>)}</div></div>)}</fieldset><div className="studio-modal-actions"><Button type="button" variant="ghost" disabled={creating} onClick={() => setShowNew(false)}>Cancel</Button><Button type="submit" loading={creating} disabled={!newName.trim()}>Create & open<Icon path="M5 12h14m-5-5 5 5-5 5" /></Button></div></form></Modal>
      <Modal open={Boolean(libraryProject)} onClose={() => { if (!libraryBusy) setLibraryProject(null); }} title={`Organize ${libraryProject?.name ?? "project"}`}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void organize(); }}><Input label="Folder" value={folder} onChange={(event) => setFolder(event.target.value)} maxLength={80} placeholder="Campus / Building A" list="project-folders" disabled={libraryBusy} /><datalist id="project-folders">{folders.map((name) => <option key={name} value={name} />)}</datalist><Toggle checked={isTemplate} onChange={setIsTemplate} label="Use this project as a template" /><p className="studio-modal-intro">Templates remain accessible to their existing project members. Using a template creates a separate owned design without its photos, permissions, history or share links.</p><div className="studio-modal-actions"><Button type="button" variant="ghost" disabled={libraryBusy} onClick={() => setLibraryProject(null)}>Cancel</Button><Button type="submit" loading={libraryBusy}>Save changes</Button></div></form></Modal>
      <Modal open={Boolean(copyProject)} onClose={() => { if (!copyBusy) setCopyProject(null); }} title={copyProject?.isTemplate ? "Create from template" : "Duplicate project"}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void duplicate(); }}><Input label="New project name" value={copyName} onChange={(event) => setCopyName(event.target.value)} minLength={1} maxLength={80} required disabled={copyBusy} /><p className="studio-modal-intro">Copies the saved design and dimensions into your account. Photos, team access, history and share links remain with the source.</p><div className="studio-modal-actions"><Button type="button" variant="ghost" disabled={copyBusy} onClick={() => setCopyProject(null)}>Cancel</Button><Button type="submit" loading={copyBusy} disabled={!copyName.trim()}>Create & open</Button></div></form></Modal>
      <Modal open={Boolean(confirmDelete)} onClose={() => { if (!deleteBusy) setConfirmDelete(null); }} title="Delete this project?"><p className="studio-modal-intro"><strong>{confirmDelete?.name}</strong> and its design data will be permanently deleted. This cannot be undone.</p><div className="studio-modal-actions"><Button variant="ghost" disabled={deleteBusy} onClick={() => setConfirmDelete(null)}>Keep project</Button><Button variant="danger" loading={deleteBusy} onClick={() => void remove()}>Delete forever</Button></div></Modal>
    </div>
  );
}
