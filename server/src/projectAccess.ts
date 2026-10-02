import { db } from "./db.js";

export type ProjectRole = "owner" | "editor" | "viewer";

export interface ProjectAccess {
  projectId: string;
  ownerId: string;
  role: ProjectRole;
}

export function getProjectAccess(projectId: string, userId: string): ProjectAccess | null {
  const owner = db.prepare("SELECT user_id FROM projects WHERE id = ?").get(projectId) as { user_id: string } | undefined;
  if (!owner) return null;
  if (owner.user_id === userId) return { projectId, ownerId: owner.user_id, role: "owner" };
  const member = db.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(projectId, userId) as { role: string } | undefined;
  if (!member || !["editor", "viewer"].includes(member.role)) return null;
  return { projectId, ownerId: owner.user_id, role: member.role as ProjectRole };
}

export const canReadProject = (access: ProjectAccess | null): access is ProjectAccess => Boolean(access);
export const canWriteProject = (access: ProjectAccess | null): access is ProjectAccess => Boolean(access && (access.role === "owner" || access.role === "editor"));
export const canManageProject = (access: ProjectAccess | null): access is ProjectAccess => Boolean(access && access.role === "owner");
