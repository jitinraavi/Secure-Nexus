import { db, now } from "./db.js";

export type OrganizationRole = "owner" | "admin" | "editor" | "viewer";
export function organizationRole(organizationId: string, userId: string): OrganizationRole | null {
  const row = db.prepare("SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ?")
    .get(organizationId, userId) as { role: OrganizationRole } | undefined;
  return row?.role ?? null;
}
export function organizationAdmin(organizationId: string, userId: string): boolean {
  return ["owner", "admin"].includes(organizationRole(organizationId, userId) ?? "");
}
export function organizationAudit(organizationId: string, actorId: string | null, action: string, detail: unknown): void {
  db.prepare("INSERT INTO organization_audit (organization_id,actor_id,action,detail,created_at) VALUES (?,?,?,?,?)")
    .run(organizationId, actorId, action, JSON.stringify(detail), now());
  const policy = db.prepare("SELECT audit_retention_days FROM organizations WHERE id = ?").get(organizationId) as { audit_retention_days: number } | undefined;
  if (policy) db.prepare("DELETE FROM organization_audit WHERE organization_id = ? AND created_at < ?")
    .run(organizationId, now() - policy.audit_retention_days * 86400);
}
