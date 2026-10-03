import { Router, type Response } from "express";
import multer from "multer";
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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ARTIFACT_BYTES, files: 1, fields: 1, fieldNameSize: 32, fieldSize: 128, parts: 2, headerPairs: 50 },
}).single("file");

function actor(req: AuthedRequest): WorkspaceActor {
  if (!req.user || !req.session) throw new WorkspaceError(401, "Not authenticated", "SESSION_EXPIRED");
  return { userId: req.user.id, sessionId: req.session.id };
}
function fail(res: Response, error: WorkspaceError): void {
  res.status(error.status).json({ error: error.message, code: error.code, ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }) });
}
function handle(work: (req: AuthedRequest, res: Response) => void) {
  return asyncHandler((req: AuthedRequest, res) => {
    try { work(req, res); }
    catch (error) { if (error instanceof WorkspaceError) fail(res, error); else throw error; }
  });
}
function audit(req: AuthedRequest, action: string, detail: Record<string, unknown>): void {
  logAudit(req.user?.id ?? null, action, { projectId: req.params.projectId, ...detail }, req);
}

router.use(requireSession);
router.use((req: AuthedRequest, res, next) => {
  if (!projectIdSchema.safeParse(req.params.projectId).success) { res.status(400).json({ error: "Invalid project ID", code: "INVALID_PROJECT_ID" }); return; }
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  if (!access) { res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" }); return; }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !canWriteProject(access)) {
    res.status(403).json({ error: "Editor access required", code: "READ_ONLY" }); return;
  }
  res.set("Cache-Control", "private, no-store");
  next();
});

// Artifact paths precede /:kind, so "artifacts" cannot be interpreted as a module.
router.get("/artifacts", handle((req, res) => {
  const parsed = artifactQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new WorkspaceError(400, "Invalid artifact query", "INVALID_QUERY");
  res.json(listWorkspaceArtifacts(req.params.projectId, actor(req), parsed.data.kind));
}));
router.post("/artifacts", (req: AuthedRequest, res, next) => {
  upload(req, res, (error: unknown) => {
    if (!error) { next(); return; }
    if (error instanceof multer.MulterError) {
      res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: error.code === "LIMIT_FILE_SIZE" ? "Artifact exceeds the 64 MiB limit" : "Upload requires exactly one file and one module kind field",
        code: error.code === "LIMIT_FILE_SIZE" ? "ARTIFACT_SIZE" : "INVALID_MULTIPART",
      });
      return;
    }
    // Malformed multipart is an input error; do not expose parser internals.
    res.status(400).json({ error: "Invalid multipart upload", code: "INVALID_MULTIPART" });
  });
}, handle((req, res) => {
  const parsed = z.object({ kind: kindSchema }).strict().safeParse(req.body);
  if (!parsed.success || !req.file) throw new WorkspaceError(400, "Upload requires a valid module kind and one file", "INVALID_MULTIPART");
  const artifact = createWorkspaceArtifact(req.params.projectId, parsed.data.kind, actor(req), req.file.originalname, req.file.buffer);
  audit(req, "workspace.artifact.create", { artifactId: artifact.id, kind: artifact.kind, size: artifact.size });
  res.status(201).json({ artifact });
}));
router.get("/artifacts/:artifactId", handle((req, res) => {
  if (!artifactIdSchema.safeParse(req.params.artifactId).success) throw new WorkspaceError(400, "Invalid artifact ID", "INVALID_ARTIFACT_ID");
  const { artifact, bytes } = readWorkspaceArtifact(req.params.projectId, req.params.artifactId, actor(req));
  const filename = encodeURIComponent(artifact.name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  res.set({
    "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `attachment; filename="artifact.bin"; filename*=UTF-8''${filename}`,
    "Content-Length": String(bytes.length), "X-Artifact-Sha256": artifact.sha256,
  });
  res.send(bytes);
}));
router.delete("/artifacts/:artifactId", handle((req, res) => {
  if (!artifactIdSchema.safeParse(req.params.artifactId).success) throw new WorkspaceError(400, "Invalid artifact ID", "INVALID_ARTIFACT_ID");
  deleteWorkspaceArtifact(req.params.projectId, req.params.artifactId, actor(req));
  audit(req, "workspace.artifact.delete", { artifactId: req.params.artifactId });
  res.status(204).end();
}));
router.get("/:kind", handle((req, res) => {
  const parsed = kindSchema.safeParse(req.params.kind);
  if (!parsed.success) throw new WorkspaceError(400, "Invalid workspace module", "INVALID_KIND");
  res.json(readWorkspace(req.params.projectId, parsed.data, actor(req)));
}));
router.put("/:kind", handle((req, res) => {
  const kind = kindSchema.safeParse(req.params.kind);
  const parsed = workspaceSaveSchema.safeParse(req.body);
  if (!kind.success || !parsed.success) throw new WorkspaceError(400, parsed.success ? "Invalid workspace module" : parsed.error.issues[0]?.message ?? "Invalid workspace save", "INVALID_WORKSPACE");
  const result = saveWorkspace(req.params.projectId, kind.data, actor(req), parsed.data);
  audit(req, "workspace.save", { kind: kind.data, revision: result.workspace?.revision, sourceRevision: parsed.data.sourceRevision });
  res.json(result);
}));
router.delete("/:kind/history", handle((req, res) => {
  const kind = kindSchema.safeParse(req.params.kind);
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!kind.success || !parsed.success) throw new WorkspaceError(400, "Invalid workspace history request", "INVALID_HISTORY");
  const result = pruneWorkspaceHistory(req.params.projectId, kind.data, actor(req), parsed.data.beforeRevision);
  audit(req, "workspace.prune", { kind: kind.data, beforeRevision: parsed.data.beforeRevision, deleted: result.deleted });
  res.json(result);
}));

export default router;
