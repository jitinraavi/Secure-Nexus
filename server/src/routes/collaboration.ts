import { Router } from "express";
import { z } from "zod";
import { MASTER_KEY, PREVIOUS_MASTER_KEY } from "../config.js";
import { decryptAesGcm, deriveVaultKey, encryptAesGcm, randomId } from "../crypto.js";
import { db, now, withTransaction } from "../db.js";
import { asyncHandler, AuthedRequest, resolveSession } from "../security.js";
import { canManageProject, canReadProject, canWriteProject, getProjectAccess } from "../projectAccess.js";
import { collaborationItemId, emitProjectEvent, presenceSnapshot, replayProjectEvents, subscribeProject } from "../collaboration.js";
import { conflictingDesignLock } from "../designLocks.js";

const router = Router();
const vaultKey = deriveVaultKey(MASTER_KEY);
const previousVaultKey = PREVIOUS_MASTER_KEY ? deriveVaultKey(PREVIOUS_MASTER_KEY) : null;

router.use((req: AuthedRequest, res, next) => {
  const session = resolveSession(req);
  if (!session || session.status !== "active") {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.user = { id: session.user_id, email: "" };
  req.session = session;
  req.csrfToken = session.csrf_token;
  next();
});

function encryptProjectText(plaintext: string, ownerId: string): string {
  return JSON.stringify(encryptAesGcm(plaintext, vaultKey, `groundwork:project:${ownerId}`));
}

function decryptProjectText(payloadJson: string, ownerId: string): string {
  const payload = JSON.parse(payloadJson) as { iv?: string; tag?: string; data?: string };
  if (!payload.iv || !payload.tag || !payload.data) return payloadJson;
  try {
    return decryptAesGcm(payload as { iv: string; tag: string; data: string }, vaultKey, `groundwork:project:${ownerId}`);
  } catch (error) {
    if (!previousVaultKey) throw error;
    return decryptAesGcm(payload as { iv: string; tag: string; data: string }, previousVaultKey, `groundwork:project:${ownerId}`);
  }
}

function encryptItemBody(body: string, ownerId: string, projectId: string): string {
  return JSON.stringify(encryptAesGcm(body, vaultKey, `groundwork:collaboration:${ownerId}:${projectId}`));
}

function decryptItemBody(payloadJson: string, ownerId: string, projectId: string): string {
  try {
    const payload = JSON.parse(payloadJson) as { iv?: string; tag?: string; data?: string; body?: string };
    if (typeof payload.body === "string") return payload.body;
    if (!payload.iv || !payload.tag || !payload.data) return payloadJson;
    try {
      return decryptAesGcm(payload as { iv: string; tag: string; data: string }, vaultKey, `groundwork:collaboration:${ownerId}:${projectId}`);
    } catch (error) {
      if (!previousVaultKey) throw error;
      return decryptAesGcm(payload as { iv: string; tag: string; data: string }, previousVaultKey, `groundwork:collaboration:${ownerId}:${projectId}`);
    }
  } catch {
    return payloadJson;
  }
}

router.get("/:projectId/events", (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  if (!canReadProject(access)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ projectId: req.params.projectId, role: access.role })}\n\n`);
  const unsubscribe = subscribeProject(req.params.projectId, req.user!.id, res);
  const requestedId = Number(req.get("Last-Event-ID") || req.query.after || 0);
  let lastEventId = replayProjectEvents(req.params.projectId, res, Number.isSafeInteger(requestedId) && requestedId >= 0 ? requestedId : 0);
  res.write(`event: presence\ndata: ${JSON.stringify(presenceSnapshot(req.params.projectId))}\n\n`);
  const heartbeat = setInterval(() => {
    if (!canReadProject(getProjectAccess(req.params.projectId, req.user!.id))) { res.end(); return; }
    res.write(": heartbeat\n\n");
  }, 20_000);
  // SQLite event-log polling delivers events produced by other workers sharing this DB.
  const replay = setInterval(() => {
    const session = resolveSession(req);
    if (!session || session.status !== "active" || !canReadProject(getProjectAccess(req.params.projectId, req.user!.id))) { res.end(); return; }
    lastEventId = replayProjectEvents(req.params.projectId, res, lastEventId);
  }, 2000);
  res.on("close", () => { clearInterval(heartbeat); clearInterval(replay); unsubscribe(); });
});

router.get("/:projectId/presence", (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  if (!canReadProject(access)) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(presenceSnapshot(req.params.projectId));
});

router.get("/:projectId/items", (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  if (!canReadProject(access)) { res.status(404).json({ error: "Project not found" }); return; }
  const rows = db.prepare("SELECT id, user_id, kind, body, status, created_at, updated_at FROM project_collaboration_items WHERE project_id = ? ORDER BY created_at DESC")
    .all(req.params.projectId) as { id: string; user_id: string; kind: string; body: string; status: string; created_at: number; updated_at: number }[];
  res.json({ items: rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    body: decryptItemBody(row.body, access.ownerId, req.params.projectId),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })) });
});

const itemSchema = z.object({ kind: z.enum(["comment", "issue"]), body: z.string().trim().min(1).max(2000) });
router.post("/:projectId/items", asyncHandler(async (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  const parsed = itemSchema.safeParse(req.body || {});
  if (!canReadProject(access)) { res.status(404).json({ error: "Project not found" }); return; }
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid collaboration item" }); return; }
  const project = db.prepare("SELECT revision FROM projects WHERE id = ?").get(req.params.projectId) as { revision: number };
  const id = collaborationItemId();
  const timestamp = now();
  db.prepare("INSERT INTO project_collaboration_items (id, project_id, user_id, kind, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, req.params.projectId, req.user!.id, parsed.data.kind, encryptItemBody(parsed.data.body, access.ownerId, req.params.projectId), timestamp, timestamp);
  emitProjectEvent(req.params.projectId, req.user!.id, parsed.data.kind === "comment" ? "comment.created" : "issue.updated", project.revision, { itemId: id });
  res.status(201).json({ id, userId: req.user!.id, kind: parsed.data.kind, body: parsed.data.body, status: "open", createdAt: timestamp, updatedAt: timestamp });
}));

router.patch("/:projectId/items/:itemId", asyncHandler(async (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  const parsed = z.object({ status: z.enum(["open", "resolved"]) }).safeParse(req.body || {});
  if (!canWriteProject(access)) { res.status(access ? 403 : 404).json({ error: access ? "Editor access required" : "Project not found" }); return; }
  if (!parsed.success) { res.status(400).json({ error: "Status must be open or resolved" }); return; }
  const timestamp = now();
  const result = db.prepare("UPDATE project_collaboration_items SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?")
    .run(parsed.data.status, timestamp, req.params.itemId, req.params.projectId);
  if (!result.changes) { res.status(404).json({ error: "Collaboration item not found" }); return; }
  const project = db.prepare("SELECT revision FROM projects WHERE id = ?").get(req.params.projectId) as { revision: number };
  emitProjectEvent(req.params.projectId, req.user!.id, "issue.updated", project.revision, { itemId: req.params.itemId, status: parsed.data.status });
  res.json({ ok: true, status: parsed.data.status, updatedAt: timestamp });
}));

/* -------------------------- Project memberships -------------------------- */

router.get("/:projectId/members", (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  if (!canReadProject(access)) { res.status(404).json({ error: "Project not found" }); return; }
  const owner = db.prepare("SELECT u.id, u.email, u.username FROM projects p JOIN users u ON u.id = p.user_id WHERE p.id = ?")
    .get(req.params.projectId) as { id: string; email: string; username: string | null };
  const rows = db.prepare("SELECT pm.user_id, pm.role, pm.created_at, u.email, u.username FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? ORDER BY pm.created_at")
    .all(req.params.projectId) as { user_id: string; role: "editor" | "viewer"; created_at: number; email: string; username: string | null }[];
  res.json({ members: [
    { userId: owner.id, email: owner.email, username: owner.username, role: "owner", createdAt: 0 },
    ...rows.map((row) => ({ userId: row.user_id, email: row.email, username: row.username, role: row.role, createdAt: row.created_at })),
  ], currentRole: access.role });
});

const memberSchema = z.object({ identifier: z.string().trim().min(3).max(254), role: z.enum(["editor", "viewer"]) });
router.post("/:projectId/members", asyncHandler(async (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  const parsed = memberSchema.safeParse(req.body || {});
  if (!canManageProject(access)) { res.status(access ? 403 : 404).json({ error: access ? "Owner access required" : "Project not found" }); return; }
  if (!parsed.success) { res.status(400).json({ error: "Enter a valid user and role" }); return; }
  const target = db.prepare("SELECT id, email, username FROM users WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE LIMIT 1")
    .get(parsed.data.identifier, parsed.data.identifier) as { id: string; email: string; username: string | null } | undefined;
  if (!target || target.id === access.ownerId) { res.status(404).json({ error: "Eligible Groundwork user not found" }); return; }
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by`)
    .run(req.params.projectId, target.id, parsed.data.role, req.user!.id, now());
  const project = db.prepare("SELECT revision FROM projects WHERE id = ?").get(req.params.projectId) as { revision: number };
  emitProjectEvent(req.params.projectId, req.user!.id, "member.updated", project.revision, { userId: target.id, role: parsed.data.role });
  res.status(201).json({ userId: target.id, email: target.email, username: target.username, role: parsed.data.role });
}));

router.patch("/:projectId/members/:userId", asyncHandler(async (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  const parsed = z.object({ role: z.enum(["editor", "viewer"]) }).safeParse(req.body || {});
  if (!canManageProject(access)) { res.status(access ? 403 : 404).json({ error: access ? "Owner access required" : "Project not found" }); return; }
  if (!parsed.success) { res.status(400).json({ error: "Role must be editor or viewer" }); return; }
  const result = db.prepare("UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?")
    .run(parsed.data.role, req.params.projectId, req.params.userId);
  if (!result.changes) { res.status(404).json({ error: "Project member not found" }); return; }
  if (parsed.data.role === "viewer") db.prepare("DELETE FROM project_locks WHERE project_id = ? AND user_id = ?").run(req.params.projectId, req.params.userId);
  const project = db.prepare("SELECT revision FROM projects WHERE id = ?").get(req.params.projectId) as { revision: number };
  emitProjectEvent(req.params.projectId, req.user!.id, "member.updated", project.revision, { userId: req.params.userId, role: parsed.data.role });
  res.json({ ok: true });
}));

router.delete("/:projectId/members/:userId", asyncHandler(async (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  if (!canManageProject(access)) { res.status(access ? 403 : 404).json({ error: access ? "Owner access required" : "Project not found" }); return; }
  const result = db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(req.params.projectId, req.params.userId);
  db.prepare("DELETE FROM project_locks WHERE project_id = ? AND user_id = ?").run(req.params.projectId, req.params.userId);
  if (!result.changes) { res.status(404).json({ error: "Project member not found" }); return; }
  const project = db.prepare("SELECT revision FROM projects WHERE id = ?").get(req.params.projectId) as { revision: number };
  emitProjectEvent(req.params.projectId, req.user!.id, "member.updated", project.revision, { userId: req.params.userId, removed: true });
  res.json({ ok: true });
}));

/* ----------------------------- Object locks ------------------------------ */

function clearExpiredLocks() {
  db.prepare("DELETE FROM project_locks WHERE expires_at <= ?").run(now());
}

router.get("/:projectId/locks", (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  if (!canReadProject(access)) { res.status(404).json({ error: "Project not found" }); return; }
  clearExpiredLocks();
  const locks = db.prepare("SELECT object_id, user_id, expires_at, updated_at FROM project_locks WHERE project_id = ?")
    .all(req.params.projectId) as { object_id: string; user_id: string; expires_at: number; updated_at: number }[];
  res.json({ locks: locks.map((lock) => ({ objectId: lock.object_id, userId: lock.user_id, expiresAt: lock.expires_at, updatedAt: lock.updated_at })) });
});

router.post("/:projectId/locks", asyncHandler(async (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  const parsed = z.object({ objectId: z.string().trim().min(1).max(200), ttlSeconds: z.number().int().min(15).max(300).default(90) }).safeParse(req.body || {});
  if (!canWriteProject(access)) { res.status(access ? 403 : 404).json({ error: access ? "Editor access required" : "Project not found" }); return; }
  if (!parsed.success) { res.status(400).json({ error: "Invalid object lock request" }); return; }
  clearExpiredLocks();
  const existing = db.prepare("SELECT user_id, expires_at FROM project_locks WHERE project_id = ? AND object_id = ?")
    .get(req.params.projectId, parsed.data.objectId) as { user_id: string; expires_at: number } | undefined;
  if (existing && existing.user_id !== req.user!.id && existing.expires_at > now()) {
    res.status(423).json({ error: "Object is locked by another editor", userId: existing.user_id, expiresAt: existing.expires_at });
    return;
  }
  const token = randomId();
  const timestamp = now();
  const expiresAt = timestamp + parsed.data.ttlSeconds;
  db.prepare(`INSERT INTO project_locks (project_id, object_id, user_id, token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, object_id) DO UPDATE SET user_id = excluded.user_id, token = excluded.token, expires_at = excluded.expires_at, updated_at = excluded.updated_at`)
    .run(req.params.projectId, parsed.data.objectId, req.user!.id, token, expiresAt, timestamp);
  const project = db.prepare("SELECT revision FROM projects WHERE id = ?").get(req.params.projectId) as { revision: number };
  emitProjectEvent(req.params.projectId, req.user!.id, "lock.updated", project.revision, { objectId: parsed.data.objectId, userId: req.user!.id, expiresAt });
  res.status(201).json({ objectId: parsed.data.objectId, userId: req.user!.id, token, expiresAt, updatedAt: timestamp });
}));

router.delete("/:projectId/locks/:objectId", asyncHandler(async (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  if (!canWriteProject(access)) { res.status(access ? 403 : 404).json({ error: access ? "Editor access required" : "Project not found" }); return; }
  const result = access.role === "owner"
    ? db.prepare("DELETE FROM project_locks WHERE project_id = ? AND object_id = ?").run(req.params.projectId, req.params.objectId)
    : db.prepare("DELETE FROM project_locks WHERE project_id = ? AND object_id = ? AND user_id = ?").run(req.params.projectId, req.params.objectId, req.user!.id);
  if (!result.changes) { res.status(404).json({ error: "Object lock not found" }); return; }
  const project = db.prepare("SELECT revision FROM projects WHERE id = ?").get(req.params.projectId) as { revision: number };
  emitProjectEvent(req.params.projectId, req.user!.id, "lock.updated", project.revision, { objectId: req.params.objectId, released: true });
  res.json({ ok: true });
}));

/* ------------------------- Conflict-safe operations ---------------------- */

const safePathKey = z.string().min(1).max(100).refine((key) => !["__proto__", "prototype", "constructor"].includes(key), "Unsafe path");
const operationSchema = z.object({
  operationId: z.string().trim().min(8).max(120),
  baseRevision: z.number().int().min(0),
  kind: z.enum(["set", "merge", "delete"]),
  path: z.array(safePathKey).min(1).max(16),
  value: z.unknown().optional(),
});

function applyOperation(root: unknown, kind: "set" | "merge" | "delete", path: string[], value: unknown): unknown {
  const cloned = root && typeof root === "object" ? JSON.parse(JSON.stringify(root)) as Record<string, unknown> : {};
  let cursor: Record<string, unknown> = cloned;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    const next = cursor[key];
    if (!next || typeof next !== "object") throw new Error("Operation parent path does not exist");
    if (Array.isArray(cursor) && !/^(0|[1-9]\d*)$/.test(key)) throw new Error("Array path requires an index");
    if (!Object.prototype.hasOwnProperty.call(cursor, key)) throw new Error("Operation parent path does not exist");
    cursor = cursor[key] as Record<string, unknown>;
  }
  const key = path[path.length - 1];
  if (Array.isArray(cursor)) {
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= cursor.length) throw new Error("Array index is out of range");
    if (kind === "delete") { cursor.splice(Number(key), 1); return cloned; }
  }
  if (kind === "delete") {
    if (path.length === 1 && ["room", "furniture", "version"].includes(key)) throw new Error("Required design fields cannot be deleted");
    delete cursor[key];
  }
  else if (kind === "merge") {
    const current = cursor[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Merge value must be an object");
    cursor[key] = { ...(current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {}), ...(value as Record<string, unknown>) };
  } else {
    if (value === undefined) throw new Error("Set requires a value");
    cursor[key] = value;
  }
  return cloned;
}

router.post("/:projectId/operations", asyncHandler(async (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  const parsed = operationSchema.safeParse(req.body || {});
  if (!canWriteProject(access)) { res.status(access ? 403 : 404).json({ error: access ? "Editor access required" : "Project not found" }); return; }
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid collaboration operation" }); return; }

  const prior = db.prepare("SELECT result_revision FROM project_operations WHERE project_id = ? AND operation_id = ?")
    .get(req.params.projectId, parsed.data.operationId) as { result_revision: number } | undefined;
  if (prior) { res.json({ ok: true, revision: prior.result_revision, duplicate: true }); return; }

  const project = db.prepare("SELECT design_data, revision FROM projects WHERE id = ?").get(req.params.projectId) as { design_data: string | null; revision: number };
  if (project.revision !== parsed.data.baseRevision) {
    res.status(409).json({ error: "Project changed elsewhere", code: "REVISION_CONFLICT", currentRevision: project.revision });
    return;
  }

  let design: unknown = {};
  if (project.design_data) design = JSON.parse(decryptProjectText(project.design_data, access.ownerId));
  let next: unknown;
  try {
    next = applyOperation(design, parsed.data.kind, parsed.data.path, parsed.data.value);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Operation failed" });
    return;
  }
  const serialized = JSON.stringify(next);
  const lockedObject = conflictingDesignLock(req.params.projectId, req.user!.id, design, next);
  if (lockedObject) { res.status(423).json({ error: "Object is locked by another editor", objectId: lockedObject }); return; }
  if (serialized.length > 4_000_000) { res.status(413).json({ error: "Resulting design is too large" }); return; }
  const nextRevision = project.revision + 1;
  const committed = withTransaction(() => {
  const updated = db.prepare("UPDATE projects SET design_data = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?")
    .run(encryptProjectText(serialized, access.ownerId), nextRevision, now(), req.params.projectId, project.revision);
  if (!updated.changes) {
    return false;
  }
  db.prepare("INSERT INTO project_operations (project_id, user_id, operation_id, base_revision, result_revision, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(req.params.projectId, req.user!.id, parsed.data.operationId, project.revision, nextRevision, parsed.data.kind, JSON.stringify({ path: parsed.data.path }), now());
  emitProjectEvent(req.params.projectId, req.user!.id, "operation.applied", nextRevision, { operationId: parsed.data.operationId, kind: parsed.data.kind, path: parsed.data.path });
  return true;
  });
  if (!committed) {
    const latest = db.prepare("SELECT revision FROM projects WHERE id = ?").get(req.params.projectId) as { revision: number };
    res.status(409).json({ error: "Project changed elsewhere", code: "REVISION_CONFLICT", currentRevision: latest.revision });
    return;
  }
  res.status(201).json({ ok: true, revision: nextRevision, duplicate: false });
}));

export default router;

