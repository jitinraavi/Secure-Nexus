import { Router } from "express";
import { z } from "zod";
import { randomId } from "../crypto.js";
import { db, now, withTransaction } from "../db.js";
import { organizationAdmin, organizationAudit, organizationRole, type OrganizationRole } from "../organization.js";
import { asyncHandler, requireSession, type AuthedRequest } from "../security.js";

const router = Router();
router.use(requireSession);
const roleSchema = z.enum(["admin", "editor", "viewer"]);
const seatEntitlement = Math.min(10000, Math.max(1, Number.parseInt(process.env.ORGANIZATION_MAX_SEATS || "5", 10) || 5));
const admin = (req: AuthedRequest) => organizationAdmin(req.params.organizationId, req.user!.id);
function summary(row: { id: string; name: string; seat_limit: number; audit_retention_days: number; role: OrganizationRole; seats_used: number }) {
  return { id: row.id, name: row.name, seatLimit: row.seat_limit, seatsUsed: Number(row.seats_used), auditRetentionDays: row.audit_retention_days, role: row.role };
}
router.get("/", (req: AuthedRequest, res) => {
  const rows = db.prepare(`SELECT o.*,m.role,(SELECT COUNT(*) FROM organization_members WHERE organization_id=o.id) AS seats_used
    FROM organizations o JOIN organization_members m ON m.organization_id=o.id WHERE m.user_id=? ORDER BY o.updated_at DESC LIMIT 100`)
    .all(req.user!.id) as Parameters<typeof summary>[0][];
  res.json({ organizations: rows.map(summary), seatEntitlement });
});
router.post("/", asyncHandler((req: AuthedRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Organization name must have 1–80 characters" }); return; }
  const id = randomId();
  const created = withTransaction(() => {
    const count = db.prepare("SELECT COUNT(*) AS count FROM organizations WHERE created_by=?").get(req.user!.id) as { count: number };
    if (count.count >= 3) return false;
    db.prepare("INSERT INTO organizations (id,name,created_by,seat_limit,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(id, parsed.data.name, req.user!.id, Math.min(5, seatEntitlement), now(), now());
    db.prepare("INSERT INTO organization_members (organization_id,user_id,role,created_at) VALUES (?,?,'owner',?)").run(id, req.user!.id, now());
    organizationAudit(id, req.user!.id, "organization.created", { name: parsed.data.name });
    return true;
  });
  if (!created) { res.status(403).json({ error: "An account may create at most three organizations" }); return; }
  res.status(201).json({ id });
}));
router.get("/personal-projects", (req: AuthedRequest, res) => {
  const projects = db.prepare("SELECT id,name FROM projects WHERE user_id=? AND organization_id IS NULL ORDER BY updated_at DESC LIMIT 1000").all(req.user!.id);
  res.json({ projects });
});
router.get("/:organizationId", (req: AuthedRequest, res) => {
  const role = organizationRole(req.params.organizationId, req.user!.id);
  if (!role) { res.status(404).json({ error: "Organization not found" }); return; }
  const row = db.prepare("SELECT *, (SELECT COUNT(*) FROM organization_members WHERE organization_id=organizations.id) AS seats_used FROM organizations WHERE id=?")
    .get(req.params.organizationId) as Omit<Parameters<typeof summary>[0], "role">;
  const members = db.prepare("SELECT m.user_id AS userId,m.role,u.email,u.username FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? ORDER BY m.created_at LIMIT 10000")
    .all(req.params.organizationId);
  const projects = db.prepare("SELECT id,name,project_type AS projectType,revision FROM projects WHERE organization_id=? ORDER BY updated_at DESC LIMIT 1000")
    .all(req.params.organizationId);
  res.json({ organization: summary({ ...row, role }), members, projects, seatEntitlement });
});
router.patch("/:organizationId", asyncHandler((req: AuthedRequest, res) => {
  if (organizationRole(req.params.organizationId, req.user!.id) !== "owner") { res.status(403).json({ error: "Organization owner access required" }); return; }
  const parsed = z.object({ name: z.string().trim().min(1).max(80), seatLimit: z.number().int().min(1).max(seatEntitlement), auditRetentionDays: z.number().int().min(30).max(3650) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid organization settings or seat entitlement exceeded" }); return; }
  const changed = withTransaction(() => {
    if (organizationRole(req.params.organizationId, req.user!.id) !== "owner") return false;
    const seats = db.prepare("SELECT COUNT(*) AS count FROM organization_members WHERE organization_id=?").get(req.params.organizationId) as { count: number };
    if (seats.count > parsed.data.seatLimit) return false;
    db.prepare("UPDATE organizations SET name=?,seat_limit=?,audit_retention_days=?,updated_at=? WHERE id=?")
      .run(parsed.data.name, parsed.data.seatLimit, parsed.data.auditRetentionDays, now(), req.params.organizationId);
    organizationAudit(req.params.organizationId, req.user!.id, "organization.settings", parsed.data);
    return true;
  });
  if (!changed) { res.status(409).json({ error: "Remove members before reducing seats below current usage" }); return; }
  res.json({ ok: true });
}));
router.post("/:organizationId/members", asyncHandler((req: AuthedRequest, res) => {
  if (!admin(req)) { res.status(403).json({ error: "Organization administrator access required" }); return; }
  const parsed = z.object({ identifier: z.string().trim().min(3).max(254), role: roleSchema }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid member and role" }); return; }
  if (parsed.data.role === "admin" && organizationRole(req.params.organizationId, req.user!.id) !== "owner") { res.status(403).json({ error: "Only the owner may appoint administrators" }); return; }
  const target = db.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE OR username=? COLLATE NOCASE LIMIT 1")
    .get(parsed.data.identifier, parsed.data.identifier) as { id: string } | undefined;
  if (!target) { res.status(404).json({ error: "Registered user not found" }); return; }
  const result = withTransaction(() => {
    if (!admin(req) || (parsed.data.role === "admin" && organizationRole(req.params.organizationId, req.user!.id) !== "owner")) return "forbidden";
    if (organizationRole(req.params.organizationId, target.id)) return "exists";
    const row = db.prepare("SELECT seat_limit,(SELECT COUNT(*) FROM organization_members WHERE organization_id=organizations.id) AS used FROM organizations WHERE id=?")
      .get(req.params.organizationId) as { seat_limit: number; used: number };
    if (row.used >= row.seat_limit) return "full";
    db.prepare("INSERT INTO organization_members (organization_id,user_id,role,created_at) VALUES (?,?,?,?)")
      .run(req.params.organizationId, target.id, parsed.data.role, now());
    organizationAudit(req.params.organizationId, req.user!.id, "member.added", { userId: target.id, role: parsed.data.role });
    return "ok";
  });
  if (result !== "ok") { res.status(result === "forbidden" ? 403 : 409).json({ error: result === "forbidden" ? "Organization access changed" : result === "exists" ? "User is already a member" : "Organization seat limit reached" }); return; }
  res.status(201).json({ ok: true });
}));
router.patch("/:organizationId/members/:userId", asyncHandler((req: AuthedRequest, res) => {
  if (!admin(req)) { res.status(403).json({ error: "Organization administrator access required" }); return; }
  const parsed = z.object({ role: roleSchema }).safeParse(req.body);
  const targetRole = organizationRole(req.params.organizationId, req.params.userId);
  const actorRole = organizationRole(req.params.organizationId, req.user!.id);
  if (!parsed.success || !targetRole) { res.status(400).json({ error: "Invalid member and role" }); return; }
  if (targetRole === "owner" || (actorRole !== "owner" && (targetRole === "admin" || parsed.data.role === "admin"))) { res.status(403).json({ error: "Owner role is protected; only the owner may manage administrators" }); return; }
  const updated = withTransaction(() => {
    const currentActor = organizationRole(req.params.organizationId, req.user!.id), currentTarget = organizationRole(req.params.organizationId, req.params.userId);
    if (!admin(req) || !currentTarget || currentTarget === "owner" || (currentActor !== "owner" && (currentTarget === "admin" || parsed.data.role === "admin"))) return false;
    db.prepare("UPDATE organization_members SET role=? WHERE organization_id=? AND user_id=?").run(parsed.data.role, req.params.organizationId, req.params.userId);
    if (parsed.data.role === "viewer") db.prepare("DELETE FROM project_locks WHERE user_id=? AND project_id IN (SELECT id FROM projects WHERE organization_id=?)").run(req.params.userId, req.params.organizationId);
    organizationAudit(req.params.organizationId, req.user!.id, "member.role_changed", { userId: req.params.userId, role: parsed.data.role });
    return true;
  });
  if (!updated) { res.status(403).json({ error: "Organization access changed" }); return; }
  res.json({ ok: true });
}));
router.delete("/:organizationId/members/:userId", asyncHandler((req: AuthedRequest, res) => {
  const actorRole = organizationRole(req.params.organizationId, req.user!.id);
  const targetRole = organizationRole(req.params.organizationId, req.params.userId);
  if (!admin(req) || targetRole === "owner" || (targetRole === "admin" && actorRole !== "owner")) { res.status(403).json({ error: "Owner role is protected; administrator management requires the owner" }); return; }
  const removed = withTransaction(() => {
    const currentActor = organizationRole(req.params.organizationId, req.user!.id), currentTarget = organizationRole(req.params.organizationId, req.params.userId);
    if (!admin(req) || currentTarget === "owner" || (currentTarget === "admin" && currentActor !== "owner")) return false;
    db.prepare("DELETE FROM organization_members WHERE organization_id=? AND user_id=?").run(req.params.organizationId, req.params.userId);
    db.prepare("DELETE FROM organization_sso_identities WHERE organization_id=? AND user_id=?").run(req.params.organizationId, req.params.userId);
    db.prepare("DELETE FROM project_locks WHERE user_id=? AND project_id IN (SELECT id FROM projects WHERE organization_id=?)").run(req.params.userId, req.params.organizationId);
    organizationAudit(req.params.organizationId, req.user!.id, "member.removed", { userId: req.params.userId });
    return true;
  });
  if (!removed) { res.status(403).json({ error: "Organization access changed" }); return; }
  res.json({ ok: true });
}));
router.post("/:organizationId/transfer-owner", asyncHandler((req: AuthedRequest, res) => {
  if (organizationRole(req.params.organizationId, req.user!.id) !== "owner") { res.status(403).json({ error: "Organization owner access required" }); return; }
  const parsed = z.object({ userId: z.string().min(1).max(120) }).safeParse(req.body);
  if (!parsed.success || parsed.data.userId === req.user!.id || !organizationRole(req.params.organizationId, parsed.data.userId)) { res.status(400).json({ error: "Select a different existing organization member" }); return; }
  const transferred = withTransaction(() => {
    if (organizationRole(req.params.organizationId, req.user!.id) !== "owner" || !organizationRole(req.params.organizationId, parsed.data.userId)) return false;
    db.prepare("UPDATE organization_members SET role='admin' WHERE organization_id=? AND user_id=?").run(req.params.organizationId, req.user!.id);
    db.prepare("UPDATE organization_members SET role='owner' WHERE organization_id=? AND user_id=?").run(req.params.organizationId, parsed.data.userId);
    organizationAudit(req.params.organizationId, req.user!.id, "organization.owner_transferred", { userId: parsed.data.userId });
    return true;
  });
  if (!transferred) { res.status(403).json({ error: "Organization access changed" }); return; }
  res.json({ ok: true });
}));
router.post("/:organizationId/projects", asyncHandler((req: AuthedRequest, res) => {
  if (!admin(req)) { res.status(403).json({ error: "Organization administrator access required" }); return; }
  const parsed = z.object({ projectId: z.string().min(1).max(120) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid project" }); return; }
  const bound = withTransaction(() => {
    if (!admin(req)) return false;
    const project = db.prepare("SELECT user_id,organization_id FROM projects WHERE id=?").get(parsed.data.projectId) as { user_id: string; organization_id: string | null } | undefined;
    // Personal ownership is required to donate a project to a tenant. Moving an
    // already-bound project through another tenant cannot bypass its controls.
    if (!project || project.user_id !== req.user!.id || project.organization_id) return false;
    db.prepare("UPDATE projects SET organization_id=?,revision=revision+1,updated_at=? WHERE id=?").run(req.params.organizationId, now(), parsed.data.projectId);
    db.prepare("UPDATE project_share_links SET revoked_at=? WHERE project_id=? AND revoked_at IS NULL").run(now(), parsed.data.projectId);
    db.prepare("DELETE FROM project_members WHERE project_id=?").run(parsed.data.projectId);
    db.prepare("DELETE FROM project_locks WHERE project_id=?").run(parsed.data.projectId);
    organizationAudit(req.params.organizationId, req.user!.id, "project.bound", { projectId: parsed.data.projectId });
    return true;
  });
  if (!bound) { res.status(409).json({ error: "Choose an unbound personal project you own" }); return; }
  res.json({ ok: true });
}));
router.get("/:organizationId/audit", (req: AuthedRequest, res) => {
  if (!admin(req)) { res.status(403).json({ error: "Organization administrator access required" }); return; }
  const before = Number(req.query.beforeId || Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(before) || before < 1) { res.status(400).json({ error: "Invalid audit cursor" }); return; }
  const policy = db.prepare("SELECT audit_retention_days FROM organizations WHERE id=?").get(req.params.organizationId) as { audit_retention_days: number };
  db.prepare("DELETE FROM organization_audit WHERE organization_id=? AND created_at<?").run(req.params.organizationId, now() - policy.audit_retention_days * 86400);
  const events = db.prepare("SELECT id,actor_id AS actorId,action,detail,created_at AS createdAt FROM organization_audit WHERE organization_id=? AND id<? ORDER BY id DESC LIMIT 500")
    .all(req.params.organizationId, before) as { id: number; actorId: string | null; action: string; detail: string; createdAt: number }[];
  res.set("Cache-Control", "private, no-store");
  res.json({ events: events.map((event) => ({ ...event, detail: JSON.parse(event.detail) as unknown })), nextBeforeId: events.length === 500 ? events[events.length - 1].id : null });
});
export default router;
