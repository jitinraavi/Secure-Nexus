import type { Response } from "express";
import { deriveVaultKey, encryptAesGcm, randomId } from "./crypto.js";
import { MASTER_KEY } from "./config.js";
import { db, now, withTransaction } from "./db.js";
import { getProjectAccess } from "./projectAccess.js";
import { publishRedisProjectEvent, redisPresence, redisTransportConfigured } from "./redisTransport.js";

const key = deriveVaultKey(MASTER_KEY);
const connections = new Map<string, Map<string, Set<Response>>>();
export const collaborationInstanceId = randomId();
let drainingOutbox = false;

async function drainRedisOutbox() {
  if (!redisTransportConfigured || drainingOutbox) return;
  drainingOutbox = true;
  try {
    for (let index = 0; index < 50; index += 1) {
      const row = withTransaction(() => {
        const next = db.prepare("SELECT event_id,project_id,body,attempts FROM project_event_outbox WHERE next_attempt_at<=? AND claim_until<=? ORDER BY event_id LIMIT 1")
          .get(now(), now()) as { event_id: number; project_id: string; body: string; attempts: number } | undefined;
        if (next) db.prepare("UPDATE project_event_outbox SET claim_owner=?,claim_until=? WHERE event_id=?").run(collaborationInstanceId, now() + 15, next.event_id);
        return next;
      });
      if (!row) break;
      try {
        await publishRedisProjectEvent(row.project_id, JSON.parse(row.body) as unknown);
        db.prepare("DELETE FROM project_event_outbox WHERE event_id=? AND claim_owner=?").run(row.event_id, collaborationInstanceId);
      } catch {
        db.prepare("UPDATE project_event_outbox SET attempts=attempts+1,next_attempt_at=?,claim_until=0,claim_owner=NULL WHERE event_id=? AND claim_owner=?")
          .run(now() + Math.min(60, 2 ** Math.min(row.attempts + 1, 6)), row.event_id, collaborationInstanceId);
        broadcast(row.project_id, "transport-status", { backend: "redis-rest", degraded: true });
        break;
      }
    }
  } finally { drainingOutbox = false; }
}
if (redisTransportConfigured) setInterval(() => { void drainRedisOutbox().catch(() => undefined); }, 5000).unref();

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
  const id = withTransaction(() => {
    const rowId = db.prepare(
    "INSERT INTO project_collaboration_events (project_id, user_id, event_type, revision, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(projectId, userId, type, revision, encrypt(userId, payload), createdAt).lastInsertRowid;
    if (redisTransportConfigured) {
      db.prepare("INSERT INTO project_event_outbox (event_id,project_id,body,next_attempt_at) VALUES (?,?,?,?)")
        .run(rowId, projectId, JSON.stringify({ origin: collaborationInstanceId, eventId: randomId(), projectId, type, revision, createdAt, actorId: userId }), now());
      // Notification history is bounded; the authoritative design/revision and
      // coordination operation journals remain available for resynchronization.
      db.prepare("DELETE FROM project_event_outbox WHERE event_id IN (SELECT event_id FROM project_event_outbox ORDER BY event_id DESC LIMIT -1 OFFSET 100000)").run();
    }
    return rowId;
  });
  broadcast(projectId, "collaboration", { id: Number(id), projectId, type, revision, createdAt, actorId: userId }, Number(id));
}

export function presenceSnapshot(projectId: string) {
  const rows = db.prepare("SELECT user_id,COUNT(*) AS connections FROM project_presence WHERE project_id=? AND expires_at>? GROUP BY user_id LIMIT 2000")
    .all(projectId, now()) as { user_id: string; connections: number }[];
  const users = rows.filter((row) => getProjectAccess(projectId, row.user_id)).map((row) => ({ userId: row.user_id, connections: Number(row.connections) }));
  return { projectId, users, count: users.length };
}

function broadcastPresence(projectId: string) {
  broadcast(projectId, "presence", presenceSnapshot(projectId));
}

export function subscribeProject(projectId: string, userId: string, response: Response) {
  const connectionId = randomId();
  const redisMember = `${userId}|${connectionId}`;
  let closed = false;
  let renewing = false;
  const renew = () => {
    if (closed) return;
    db.prepare("DELETE FROM project_presence WHERE expires_at<=?").run(now());
    db.prepare("INSERT INTO project_presence (connection_id,project_id,user_id,expires_at) VALUES (?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET expires_at=excluded.expires_at")
      .run(connectionId, projectId, userId, now() + 45);
    if (redisTransportConfigured && !renewing) {
      renewing = true;
      void redisPresence(projectId, redisMember, now() + 45).then((presence) => { if (!closed) { const users = presence.users.filter((entry) => getProjectAccess(projectId, entry.userId)); broadcast(projectId, "presence", { projectId, users, count: users.length }); } else void redisPresence(projectId, redisMember).catch(() => undefined); })
        .catch(() => broadcast(projectId, "transport-status", { backend: "redis-rest", degraded: true })).finally(() => { renewing = false; });
    }
  };
  renew();
  const lease = setInterval(renew, 15000);
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
    if (closed) return;
    closed = true; clearInterval(lease);
    db.prepare("DELETE FROM project_presence WHERE connection_id=?").run(connectionId);
    if (redisTransportConfigured) void redisPresence(projectId, redisMember).catch(() => undefined);
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

