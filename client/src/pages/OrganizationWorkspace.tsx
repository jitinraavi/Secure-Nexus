import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Badge, Button, Card, Input, Select, Toggle } from "../components/ui";
import { addOrganizationMember, bindOrganizationProject, configureOrganizationSso, createOrganization, getOrganization, getOrganizationAudit, getOrganizationSso, listOrganizations, listPersonalOrganizationProjects, removeOrganizationMember, transferOrganizationOwner, unlinkOrganizationIdentity, updateOrganization, updateOrganizationMember, type Organization, type OrganizationDetail, type OrganizationRole } from "../lib/organizationApi";
import { CoordinationSync, type CoordinationRecord, type CoordinationSyncStatus } from "../lib/operationSync";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function CoordinationWorkspace({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { user } = useAuth();
  const sync = useRef<CoordinationSync | null>(null);
  const [records, setRecords] = useState<CoordinationRecord[]>([]);
  const [status, setStatus] = useState<CoordinationSyncStatus>({ pending: 0, durable: true, backend: "unknown", error: null, syncing: false });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!user) return;
    let live = true;
    const instance = new CoordinationSync(user.id, projectId, () => { if (live) { setRecords(instance.records()); setStatus(instance.status()); } });
    sync.current = instance; setRecords(instance.records()); setStatus(instance.status());
    void instance.start();
    return () => { live = false; instance.stop(); sync.current = null; };
  }, [projectId, user]);
  const edit = (entityId: string, field: "title" | "body" | "status" | "assignee" | "dueDate" | "deleted", value: string | boolean) => {
    try { sync.current?.enqueue(entityId, field, value); setError(""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not queue edit"); }
  };
  const create = () => {
    if (!title.trim()) return;
    try {
      const instance = sync.current;
      if (!instance || instance.status().pending > 197) throw new Error("Synchronize the queue before creating another issue");
      const id = crypto.randomUUID();
      instance.enqueue(id, "title", title.trim()); instance.enqueue(id, "body", body); instance.enqueue(id, "status", "open");
      setTitle(""); setBody(""); setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not queue issue"); }
  };
  return <Card className="space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-100">Offline coordination workspace</h2><p className="text-sm text-slate-400">Issue fields synchronize independently using deterministic registers. Pending edits are saved in this browser.</p></div><Badge tone={status.pending ? "amber" : "emerald"}>{status.pending} pending · {status.backend}</Badge></div>
    <div className="flex gap-2"><Button variant="secondary" loading={status.syncing} onClick={() => { void sync.current?.synchronize(); }}>Synchronize</Button><Button variant="ghost" onClick={() => { const text = sync.current?.exportQueue(); if (text) download("coordination-pending.json", text); }}>Export pending queue</Button></div>
    {(status.error || error) && <p role="alert" className="text-sm text-amber-300">{error || status.error}</p>}
    {!status.durable && <p className="text-sm text-amber-300">Browser storage is unavailable. Keep this tab open or export pending edits.</p>}
    {canEdit && <div className="grid gap-3 md:grid-cols-2"><Input label="New issue title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /><Input label="Description" value={body} maxLength={10000} onChange={(event) => setBody(event.target.value)} /><Button disabled={!title.trim()} onClick={create}>Queue issue</Button></div>}
    {!records.length && <p className="text-sm text-slate-400">No coordination issues yet.</p>}
    {records.map((record) => <div key={record.id} className="grid gap-3 rounded-xl border border-slate-700 p-4 md:grid-cols-2">
      <Input label="Title" defaultValue={record.title} key={`${record.id}-title-${record.title}`} disabled={!canEdit} maxLength={200} onBlur={(event) => { if (event.target.value !== record.title) edit(record.id, "title", event.target.value); }} />
      <Select label="Status" value={record.status} disabled={!canEdit} onChange={(event) => edit(record.id, "status", event.target.value)}><option value="open">Open</option><option value="in-progress">In progress</option><option value="resolved">Resolved</option></Select>
      <Input label="Description" defaultValue={record.body} key={`${record.id}-body-${record.body}`} disabled={!canEdit} maxLength={10000} onBlur={(event) => { if (event.target.value !== record.body) edit(record.id, "body", event.target.value); }} />
      <Input label="Assignee" defaultValue={record.assignee} key={`${record.id}-assignee-${record.assignee}`} disabled={!canEdit} maxLength={120} onBlur={(event) => { if (event.target.value !== record.assignee) edit(record.id, "assignee", event.target.value); }} />
      <Input label="Due date" type="date" value={record.dueDate} disabled={!canEdit} onChange={(event) => edit(record.id, "dueDate", event.target.value)} />
      {canEdit && <Button variant="ghost" onClick={() => edit(record.id, "deleted", true)}>Archive issue</Button>}
    </div>)}
  </Card>;
}

export function OrganizationWorkspace() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [newName, setNewName] = useState("");
  const [name, setName] = useState("");
  const [seatLimit, setSeatLimit] = useState(5);
  const [retention, setRetention] = useState(365);
  const [identifier, setIdentifier] = useState("");
  const [memberRole, setMemberRole] = useState<Exclude<OrganizationRole, "owner">>("editor");
  const [projectId, setProjectId] = useState("");
  const [personalProjects, setPersonalProjects] = useState<{ id: string; name: string }[]>([]);
  const [coordinationProjectId, setCoordinationProjectId] = useState("");
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [redirectUri, setRedirectUri] = useState("");
  const [transferUser, setTransferUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadToken = useRef(0);
  const selectedOrganization = useRef(organizationId);
  selectedOrganization.current = organizationId;
  const isAdmin = detail?.organization.role === "owner" || detail?.organization.role === "admin";
  const isOwner = detail?.organization.role === "owner";
  const refreshList = useCallback(async () => { const result = await listOrganizations(); setOrganizations(result.organizations); return result.organizations; }, []);
  const refreshDetail = useCallback(async (id: string) => {
    const token = ++loadToken.current;
    const result = await getOrganization(id);
    if (token !== loadToken.current || selectedOrganization.current !== id) return;
    setDetail(result); setName(result.organization.name); setSeatLimit(result.organization.seatLimit); setRetention(result.organization.auditRetentionDays);
  }, []);
  useEffect(() => { let live = true; void refreshList().then((items) => { if (live && items[0]) setOrganizationId(items[0].id); }).catch((failure: unknown) => { if (live) setError(failure instanceof Error ? failure.message : "Could not load organizations"); }); return () => { live = false; }; }, [refreshList]);
  useEffect(() => {
    setDetail(null); setCoordinationProjectId(""); setIssuer(""); setClientId(""); setClientSecret(""); setRedirectUri(""); setSsoEnabled(false); setError("");
    if (!organizationId) return;
    let live = true;
    void refreshDetail(organizationId).catch((failure: unknown) => { if (live) setError(failure instanceof Error ? failure.message : "Could not load organization"); });
    void listPersonalOrganizationProjects().then((result) => { if (live) setPersonalProjects(result.projects); }).catch(() => { if (live) setPersonalProjects([]); });
    void getOrganizationSso(organizationId).then((result) => { if (!live || !result.configuration) return; setIssuer(result.configuration.issuer); setClientId(result.configuration.clientId); setRedirectUri(result.configuration.redirectUri); setSsoEnabled(result.configuration.enabled); }).catch(() => { /* ordinary members do not receive provider configuration */ });
    return () => { live = false; loadToken.current += 1; };
  }, [organizationId, refreshDetail]);
  const act = async (work: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await work(); await refreshList(); if (organizationId && selectedOrganization.current === organizationId) await refreshDetail(organizationId); setNotice(message); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Organization action failed"); }
    finally { setBusy(false); }
  };
  const exportAudit = async () => {
    let before: number | undefined;
    const events: unknown[] = [];
    for (let page = 0; page < 20; page += 1) {
      const result = await getOrganizationAudit(organizationId, before); events.push(...result.events);
      if (result.nextBeforeId === null) { download("organization-audit.json", JSON.stringify({ organizationId, events }, null, 2)); return; }
      before = result.nextBeforeId;
    }
    download("organization-audit-partial.json", JSON.stringify({ organizationId, events, nextBeforeId: before, partial: true }, null, 2));
  };
  return <div className="mx-auto max-w-6xl space-y-6 p-5">
    <div><h1 className="text-2xl font-semibold text-slate-100">Organization workspace</h1><p className="mt-1 text-sm text-slate-400">Manage tenant projects, seats, roles, identity providers and shared coordination.</p></div>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
    <Card className="grid gap-4 p-5 md:grid-cols-3"><Select label="Organization" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}><option value="">Select an organization</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</Select><Input label="New organization name" value={newName} maxLength={80} onChange={(event) => setNewName(event.target.value)} /><Button loading={busy} disabled={!newName.trim()} onClick={() => { void act(async () => { const result = await createOrganization(newName.trim()); setOrganizationId(result.id); setNewName(""); }, "Organization created"); }}>Create organization</Button></Card>
    {detail && <>
      <div className="flex flex-wrap gap-3"><Badge>{detail.organization.role}</Badge><Badge tone="cyan">{detail.organization.seatsUsed} / {detail.organization.seatLimit} seats</Badge><Badge>{detail.organization.auditRetentionDays} day audit retention</Badge><span className="text-xs text-slate-400">Organization ID: {detail.organization.id}</span></div>
      {isOwner && <Card className="grid gap-4 p-5 md:grid-cols-3"><Input label="Organization name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /><Input label={`Seats (deployment allowance ${detail.seatEntitlement})`} type="number" value={seatLimit} min={detail.organization.seatsUsed} max={detail.seatEntitlement} onChange={(event) => setSeatLimit(Number(event.target.value))} /><Input label="Audit retention days" type="number" value={retention} min={30} max={3650} onChange={(event) => setRetention(Number(event.target.value))} /><Button loading={busy} onClick={() => { void act(() => updateOrganization(organizationId, { name, seatLimit, auditRetentionDays: retention }), "Organization settings saved"); }}>Save settings</Button></Card>}
      <Card className="space-y-4 p-5"><h2 className="font-semibold text-slate-100">Members</h2>{detail.members.map((member) => <div key={member.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700 p-3"><span className="text-sm text-slate-200">{member.username || member.email}</span><div className="flex items-center gap-2"><Badge>{member.role}</Badge>{isAdmin && member.role !== "owner" && (isOwner || member.role !== "admin") && <><Select aria-label={`Role for ${member.email}`} value={member.role} disabled={busy} onChange={(event) => { void act(() => updateOrganizationMember(organizationId, member.userId, event.target.value as Exclude<OrganizationRole, "owner">), "Member role updated"); }}>{isOwner && <option value="admin">Administrator</option>}<option value="editor">Editor</option><option value="viewer">Viewer</option></Select><Button variant="ghost" disabled={busy} onClick={() => { void act(() => removeOrganizationMember(organizationId, member.userId), "Member removed"); }}>Remove</Button></>}</div></div>)}
        {isAdmin && <div className="grid gap-3 md:grid-cols-3"><Input label="Registered email or username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} /><Select label="Role" value={memberRole} onChange={(event) => setMemberRole(event.target.value as Exclude<OrganizationRole, "owner">)}>{isOwner && <option value="admin">Administrator</option>}<option value="editor">Editor</option><option value="viewer">Viewer</option></Select><Button loading={busy} disabled={!identifier.trim()} onClick={() => { void act(async () => { await addOrganizationMember(organizationId, identifier.trim(), memberRole); setIdentifier(""); }, "Member added"); }}>Add member</Button></div>}
        {isOwner && <div className="flex flex-wrap items-end gap-3"><Select label="Transfer ownership to member" value={transferUser} onChange={(event) => setTransferUser(event.target.value)}><option value="">Select a member</option>{detail.members.filter((member) => member.role !== "owner").map((member) => <option key={member.userId} value={member.userId}>{member.username || member.email}</option>)}</Select><Button variant="secondary" disabled={!transferUser || busy} onClick={() => { void act(() => transferOrganizationOwner(organizationId, transferUser), "Organization ownership transferred"); }}>Transfer ownership</Button></div>}
      </Card>
      <Card className="space-y-4 p-5"><h2 className="font-semibold text-slate-100">Tenant projects</h2><p className="text-sm text-slate-400">Binding a personal project applies organization roles and revokes its existing public links and individual invitations.</p>{detail.projects.map((project) => <div key={project.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700 p-3"><span className="text-sm text-slate-200">{project.name}</span><Link className="text-sm text-amber-300" to={`/editor/${project.id}`}>Open project</Link></div>)}{isAdmin && <div className="flex flex-wrap items-end gap-3"><Select label="Personal project you own" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Select a project</option>{personalProjects.filter((project) => !detail.projects.some((bound) => bound.id === project.id)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</Select><Button disabled={!projectId || busy} onClick={() => { void act(() => bindOrganizationProject(organizationId, projectId), "Project bound to organization"); }}>Bind project</Button></div>}</Card>
      <Card className="space-y-4 p-5"><h2 className="font-semibold text-slate-100">Single sign-on</h2><p className="text-sm text-slate-400">Link your current account by signing in to the configured provider. Each member proves both identities. SAML providers connect through a SAML-to-OIDC broker.</p><div className="flex flex-wrap gap-4"><a className="text-sm text-amber-300" href={`/api/sso/${encodeURIComponent(organizationId)}/start?link=1`}>Link my provider identity</a><a className="text-sm text-amber-300" href={`/api/sso/${encodeURIComponent(organizationId)}/start`}>Sign in through provider</a><Button variant="ghost" disabled={busy} onClick={() => { void act(() => unlinkOrganizationIdentity(organizationId), "Provider identity unlinked"); }}>Unlink my identity</Button></div>{isOwner && <><div className="grid gap-3 md:grid-cols-2"><Input label="OIDC issuer" value={issuer} onChange={(event) => setIssuer(event.target.value)} /><Input label="Client ID" value={clientId} onChange={(event) => setClientId(event.target.value)} /><Input label="Replace client secret (blank keeps existing)" type="password" autoComplete="new-password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} /><Toggle label="Enable organization SSO" checked={ssoEnabled} onChange={setSsoEnabled} /></div>{redirectUri && <p className="break-all text-xs text-slate-400">Provider callback: {redirectUri}</p>}<Button loading={busy} onClick={() => { void act(async () => { const result = await configureOrganizationSso(organizationId, { issuer, clientId, enabled: ssoEnabled, ...(clientSecret ? { clientSecret } : {}) }); setRedirectUri(result.redirectUri); setClientSecret(""); }, "Provider configuration saved"); }}>Save provider</Button></>}</Card>
      {isAdmin && <Card className="flex flex-wrap items-center justify-between gap-3 p-5"><div><h2 className="font-semibold text-slate-100">Organization audit export</h2><p className="text-sm text-slate-400">Exports retained administration and coordination events, up to 10,000 entries per download.</p></div><Button variant="secondary" loading={busy} onClick={() => { void act(exportAudit, "Audit export downloaded"); }}>Export audit JSON</Button></Card>}
      <Select label="Coordination project" value={coordinationProjectId} onChange={(event) => setCoordinationProjectId(event.target.value)}><option value="">Select a tenant project</option>{detail.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</Select>
      {coordinationProjectId && <CoordinationWorkspace key={coordinationProjectId} projectId={coordinationProjectId} canEdit={detail.organization.role !== "viewer"} />}
    </>}
  </div>;
}
