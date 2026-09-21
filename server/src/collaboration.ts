import type { Response } from "express";
import { deriveVaultKey, encryptAesGcm, randomId } from "./crypto.js";
import { MASTER_KEY } from "./config.js";
import { db, now } from "./db.js";

const key = deriveVaultKey(MASTER_KEY);
const connections = new Map<string, Set<Response>>();

function encrypt(userId: string, value: unknown): string {
  return JSON.stringify(encryptAesGcm(JSON.stringify(value), key, `groundwork:project:${userId}`));
}

export type CollaborationType = "design.updated" | "snapshot.created" | "comment.created" | "issue.updated";

export function emitProjectEvent(projectId: string, userId: string, type: CollaborationType, revision: number, payload: unknown) {
  const id = db.prepare(
    "INSERT INTO project_collaboration_events (project_id, user_id, event_type, revision, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(projectId, userId, type, revision, encrypt(userId, payload), now()).lastInsertRowid;
  const event = JSON.stringify({ id: Number(id), projectId, type, revision, createdAt: now() });
  for (const response of connections.get(projectId) ?? []) response.write(`event: collaboration\ndata: ${event}\n\n`);
}

export function subscribeProject(projectId: string, response: Response) {
  let set = connections.get(projectId);
  if (!set) {
    set = new Set<Response>();
    connections.set(projectId, set);
  }
  set.add(response);
  return () => {
    set?.delete(response);
    if (set && set.size === 0) connections.delete(projectId);
  };
}

export function collaborationItemId() {
  return randomId();
}
