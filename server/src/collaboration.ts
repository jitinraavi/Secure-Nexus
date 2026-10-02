import type { Response } from "express";
import { deriveVaultKey, encryptAesGcm, randomId } from "./crypto.js";
import { MASTER_KEY } from "./config.js";
import { db, now } from "./db.js";

const key = deriveVaultKey(MASTER_KEY);
const connections = new Map<string, Map<string, Set<Response>>>();

function encrypt(userId: string, value: unknown): string {
  return JSON.stringify(encryptAesGcm(JSON.stringify(value), key, `groundwork:project:${userId}`));
}

export type CollaborationType =
  | "design.updated"
  | "snapshot.created"
  | "comment.created"
  | "issue.updated"
  | "operation.applied"
  | "lock.updated"
  | "member.updated";

function writeEvent(response: Response, event: string, data: unknown, id?: number) {
  if (response.destroyed || response.writableEnded) return;
  try {
  if (id !== undefined) response.write(`id: ${id}\n`);
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch { response.end(); }
}

function broadcast(projectId: string, event: string, data: unknown, id?: number) {
  for (const set of connections.get(projectId)?.values() ?? []) {
    for (const response of set) writeEvent(response, event, data, id);
  }
}

export function emitProjectEvent(projectId: string, userId: string, type: CollaborationType, revision: number, payload: unknown) {
  const createdAt = now();
  const id = db.prepare(
    "INSERT INTO project_collaboration_events (project_id, user_id, event_type, revision, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(projectId, userId, type, revision, encrypt(userId, payload), createdAt).lastInsertRowid;
  broadcast(projectId, "collaboration", { id: Number(id), projectId, type, revision, createdAt, actorId: userId }, Number(id));
}

export function presenceSnapshot(projectId: string) {
  const users = [...(connections.get(projectId)?.entries() ?? [])].map(([userId, responses]) => ({
    userId,
    connections: responses.size,
  }));
  return { projectId, users, count: users.length };
}

function broadcastPresence(projectId: string) {
  broadcast(projectId, "presence", presenceSnapshot(projectId));
}

export function subscribeProject(projectId: string, userId: string, response: Response) {
  let project = connections.get(projectId);
  if (!project) {
    project = new Map<string, Set<Response>>();
    connections.set(projectId, project);
  }
  let userConnections = project.get(userId);
  if (!userConnections) {
    userConnections = new Set<Response>();
    project.set(userId, userConnections);
  }
  userConnections.add(response);
  broadcastPresence(projectId);

  return () => {
    userConnections?.delete(response);
    if (userConnections?.size === 0) project?.delete(userId);
    if (project?.size === 0) connections.delete(projectId);
    else broadcastPresence(projectId);
  };
}

export function replayProjectEvents(projectId: string, response: Response, afterId: number) {
  const rows = db.prepare(
    "SELECT id, user_id, event_type, revision, created_at FROM project_collaboration_events WHERE project_id = ? AND id > ? ORDER BY id ASC LIMIT 500",
  ).all(projectId, afterId) as { id: number; user_id: string; event_type: string; revision: number; created_at: number }[];
  for (const row of rows) {
    writeEvent(response, "collaboration", { id: row.id, projectId, type: row.event_type, revision: row.revision, createdAt: row.created_at, actorId: row.user_id }, row.id);
  }
  return rows[rows.length - 1]?.id ?? afterId;
}

export function collaborationItemId() {
  return randomId();
}

