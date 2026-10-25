import { routeParam } from "../routeParams.js";
import { Router, type Response } from "express";
import { boundedUpload } from "../uploads.js";
import { z } from "zod";
import { logAudit } from "../audit.js";
import { canWriteProject, getProjectAccess } from "../projectAccess.js";
import { asyncHandler, requireSession, type AuthedRequest } from "../security.js";
import {
  artifactIdSchema, createWorkspaceArtifact, deleteWorkspaceArtifact, listWorkspaceArtifacts,
  MAX_ARTIFACT_BYTES, pruneWorkspaceHistory, readWorkspace, readWorkspaceArtifact, saveWorkspace,
  WORKSPACE_KINDS, WorkspaceError, workspaceSaveSchema, type WorkspaceActor,
} from "../workspaces.js";

const router = Router({ mergeParams: true });
const kindSchema = z.enum(WORKSPACE_KINDS);
const projectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
const historyQuerySchema = z.object({
  beforeRevision: z.string().regex(/^\d{1,16}$/).transform(Number).refine((value) => Number.isSafeInteger(value) && value > 0, "Invalid history revision"),
}).strict();
const artifactQuerySchema = z.object({ kind: kindSchema.optional() }).strict();
const upload = boundedUpload("file", { fileSize: MAX_ARTIFACT_BYTES, fields: 1, fieldNameSize: 32,
  fieldSize: 128, parts: 2, allowedFields: ["kind"], sizeCode: "ARTIFACT_SIZE" });

function actor(req: AuthedRequest): WorkspaceActor {
  if (!req.user || !req.session) throw new WorkspaceError(401, "Not authenticated", "SESSION_EXPIRED");
  return { userId: req.user.id, sessionId: req.session.id };
}
function fail(res: Response, error: WorkspaceError): void {
  res.status(error.status).json({ error: error.message, code: error.code, ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }) });
}
function handle(work: (req: AuthedRequest, res: Response) => void | Promise<void>) {
  return asyncHandler(async (req: AuthedRequest, res) => {
    try { await work(req, res); }
    catch (error) { if (error instanceof WorkspaceError) fail(res, error); else throw error; }
  });
}
async function audit(req: AuthedRequest, action: string, detail: Record<string, unknown>): Promise<void> {
  (await logAudit(req.user?.id ?? null, action, { projectId: routeParam(req, "projectId"), ...detail }, req));
}

router.use(requireSession);
router.use(asyncHandler(async (req: AuthedRequest, res, next) => {
  if (!projectIdSchema.safeParse(routeParam(req, "projectId")).success) { res.status(400).json({ error: "Invalid project ID", code: "INVALID_PROJECT_ID" }); return; }
  const access = (await getProjectAccess(routeParam(req, "projectId"), req.user!.id));
  if (!access) { res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" }); return; }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !(await canWriteProject(access))) {
    res.status(403).json({ error: "Editor access required", code: "READ_ONLY" }); return;
  }
  res.set("Cache-Control", "private, no-store");
  next();
}));

// Artifact paths precede /:kind, so "artifacts" cannot be interpreted as a module.
router.get("/artifacts", handle(async (req, res) => {
  const parsed = artifactQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new WorkspaceError(400, "Invalid artifact query", "INVALID_QUERY");
  res.json((await listWorkspaceArtifacts(routeParam(req, "projectId"), actor(req), parsed.data.kind)));
}));
router.post("/artifacts", upload, handle(async (req, res) => {
  const parsed = z.object({ kind: kindSchema }).strict().safeParse(req.body);
  if (!parsed.success || !req.file) throw new WorkspaceError(400, "Upload requires a valid module kind and one file", "INVALID_MULTIPART");
  const artifact = (await createWorkspaceArtifact(routeParam(req, "projectId"), parsed.data.kind, actor(req), req.file.originalname, req.file.buffer));
  (await audit(req, "workspace.artifact.create", { artifactId: artifact.id, kind: artifact.kind, size: artifact.size }));
  res.status(201).json({ artifact });
}));
router.get("/artifacts/:artifactId", handle(async (req, res) => {
  if (!artifactIdSchema.safeParse(routeParam(req, "artifactId")).success) throw new WorkspaceError(400, "Invalid artifact ID", "INVALID_ARTIFACT_ID");
  const { artifact, bytes } = (await readWorkspaceArtifact(routeParam(req, "projectId"), routeParam(req, "artifactId"), actor(req)));
  const filename = encodeURIComponent(artifact.name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  res.set({
    "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `attachment; filename="artifact.bin"; filename*=UTF-8''${filename}`,
    "Content-Length": String(bytes.length), "X-Artifact-Sha256": artifact.sha256,
  });
  res.send(bytes);
}));
router.delete("/artifacts/:artifactId", handle(async (req, res) => {
  if (!artifactIdSchema.safeParse(routeParam(req, "artifactId")).success) throw new WorkspaceError(400, "Invalid artifact ID", "INVALID_ARTIFACT_ID");
  (await deleteWorkspaceArtifact(routeParam(req, "projectId"), routeParam(req, "artifactId"), actor(req)));
  (await audit(req, "workspace.artifact.delete", { artifactId: routeParam(req, "artifactId") }));
  res.status(204).end();
}));
router.get("/:kind", handle(async (req, res) => {
  const parsed = kindSchema.safeParse(routeParam(req, "kind"));
  if (!parsed.success) throw new WorkspaceError(400, "Invalid workspace module", "INVALID_KIND");
  res.json((await readWorkspace(routeParam(req, "projectId"), parsed.data, actor(req))));
}));
router.put("/:kind", handle(async (req, res) => {
  const kind = kindSchema.safeParse(routeParam(req, "kind"));
  const parsed = workspaceSaveSchema.safeParse(req.body);
  if (!kind.success || !parsed.success) throw new WorkspaceError(400, parsed.success ? "Invalid workspace module" : parsed.error.issues[0]?.message ?? "Invalid workspace save", "INVALID_WORKSPACE");
  const result = (await saveWorkspace(routeParam(req, "projectId"), kind.data, actor(req), parsed.data));
  (await audit(req, "workspace.save", { kind: kind.data, revision: result.workspace?.revision, sourceRevision: parsed.data.sourceRevision }));
  res.json(result);
}));
router.delete("/:kind/history", handle(async (req, res) => {
  const kind = kindSchema.safeParse(routeParam(req, "kind"));
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!kind.success || !parsed.success) throw new WorkspaceError(400, "Invalid workspace history request", "INVALID_HISTORY");
  const result = (await pruneWorkspaceHistory(routeParam(req, "projectId"), kind.data, actor(req), parsed.data.beforeRevision));
  (await audit(req, "workspace.prune", { kind: kind.data, beforeRevision: parsed.data.beforeRevision, deleted: result.deleted }));
  res.json(result);
}));

export default router;
