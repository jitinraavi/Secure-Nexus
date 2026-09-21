import { Router } from "express";
import { z } from "zod";
import { db, now } from "../db.js";
import { asyncHandler, AuthedRequest, resolveSession } from "../security.js";
import { collaborationItemId, emitProjectEvent, subscribeProject } from "../collaboration.js";

const router = Router();
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

function ownedProject(projectId: string, userId: string) {
  return db.prepare("SELECT id, revision FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId) as { id: string; revision: number } | undefined;
}

router.get("/:projectId/events", (req: AuthedRequest, res) => {
  if (!ownedProject(req.params.projectId, req.user!.id)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ projectId: req.params.projectId })}\n\n`);
  const unsubscribe = subscribeProject(req.params.projectId, res);
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20_000);
  req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
});

router.get("/:projectId/items", (req: AuthedRequest, res) => {
  if (!ownedProject(req.params.projectId, req.user!.id)) { res.status(404).json({ error: "Project not found" }); return; }
  const rows = db.prepare("SELECT id, kind, status, created_at, updated_at FROM project_collaboration_items WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC")
    .all(req.params.projectId, req.user!.id) as { id: string; kind: string; status: string; created_at: number; updated_at: number }[];
  res.json({ items: rows.map((row) => ({ id: row.id, kind: row.kind, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at })) });
});

const itemSchema = z.object({ kind: z.enum(["comment", "issue"]), body: z.string().trim().min(1).max(2000) });
router.post("/:projectId/items", asyncHandler(async (req: AuthedRequest, res) => {
  const project = ownedProject(req.params.projectId, req.user!.id);
  const parsed = itemSchema.safeParse(req.body || {});
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid collaboration item" }); return; }
  const id = collaborationItemId();
  const timestamp = now();
  db.prepare("INSERT INTO project_collaboration_items (id, project_id, user_id, kind, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, project.id, req.user!.id, parsed.data.kind, JSON.stringify({ body: parsed.data.body }), timestamp, timestamp);
  emitProjectEvent(project.id, req.user!.id, parsed.data.kind === "comment" ? "comment.created" : "issue.updated", project.revision, { itemId: id });
  res.status(201).json({ id, kind: parsed.data.kind, status: "open", createdAt: timestamp, updatedAt: timestamp });
}));

router.patch("/:projectId/items/:itemId", asyncHandler(async (req: AuthedRequest, res) => {
  const project = ownedProject(req.params.projectId, req.user!.id);
  const parsed = z.object({ status: z.enum(["open", "resolved"]) }).safeParse(req.body || {});
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (!parsed.success) { res.status(400).json({ error: "Status must be open or resolved" }); return; }
  const timestamp = now();
  const result = db.prepare("UPDATE project_collaboration_items SET status = ?, updated_at = ? WHERE id = ? AND project_id = ? AND user_id = ?")
    .run(parsed.data.status, timestamp, req.params.itemId, project.id, req.user!.id);
  if (!result.changes) { res.status(404).json({ error: "Collaboration item not found" }); return; }
  emitProjectEvent(project.id, req.user!.id, "issue.updated", project.revision, { itemId: req.params.itemId, status: parsed.data.status });
  res.json({ ok: true, status: parsed.data.status, updatedAt: timestamp });
}));

export default router;
