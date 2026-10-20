import { db } from "./db.js";
import { organizationCanWrite, organizationRole } from "./organization.js";
export type ProjectRole = "owner" | "editor" | "viewer";
export interface ProjectAccess {
    projectId: string;
    ownerId: string;
    role: ProjectRole;
    organizationId?: string;
}
export async function getProjectAccess(projectId: string, userId: string): Promise<ProjectAccess | null> {
    const owner = await db.prepare("SELECT user_id, organization_id FROM projects WHERE id = ?").get(projectId) as {
        user_id: string;
        organization_id: string | null;
    } | undefined;
    if (!owner)
        return null;
    // Tenant membership takes precedence over personal ownership and legacy invites.
    // The immutable ownerId still authenticates encrypted design/file AAD.
    if (owner.organization_id) {
        const tenantRole = await organizationRole(owner.organization_id, userId);
        if (!tenantRole)
            return null;
        const role = tenantRole === "owner" || tenantRole === "admin" ? "owner" : tenantRole;
        return { projectId, ownerId: owner.user_id, role, organizationId: owner.organization_id };
    }
    if (owner.user_id === userId)
        return { projectId, ownerId: owner.user_id, role: "owner" };
    const member = await db.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?")
        .get(projectId, userId) as {
        role: string;
    } | undefined;
    if (!member || !["editor", "viewer"].includes(member.role))
        return null;
    return { projectId, ownerId: owner.user_id, role: member.role as ProjectRole };
}
export const canReadProject = (access: ProjectAccess | null): access is ProjectAccess => Boolean(access);
export const canWriteProject = async (access: ProjectAccess | null): Promise<boolean> => Boolean(access && (access.role === "owner" || access.role === "editor") && (!access.organizationId || await organizationCanWrite(access.organizationId)));
export const canManageProject = (access: ProjectAccess | null): access is ProjectAccess => Boolean(access && access.role === "owner");
