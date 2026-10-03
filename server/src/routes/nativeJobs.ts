import { Router, type Response } from "express";
import { z } from "zod";
import { logAudit } from "../audit.js";
import { cancelNativeJob, deleteNativeJob, listNativeJobs, nativeJobSubmitSchema, readNativeJob, readNativeJobArtifact, submitNativeJob } from "../nativeJobs.js";
import { canWriteProject, getProjectAccess } from "../projectAccess.js";
import { asyncHandler, requireSession, type AuthedRequest } from "../security.js";
import { artifactIdSchema, WorkspaceError, type WorkspaceActor } from "../workspaces.js";

const router = Router({ mergeParams: true });
const projectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
function actor(req: AuthedRequest): WorkspaceActor {
  if (!req.user || !req.session) throw new WorkspaceError(401, "Not authenticated", "SESSION_EXPIRED");
  return { userId: req.user.id, sessionId: req.session.id };
}
function handle(work: (req: AuthedRequest, res: Response) => void) {
  return asyncHandler((req: AuthedRequest, res) => {
    try { work(req, res); }
    catch (error) {
      if (!(error instanceof WorkspaceError)) throw error;
      res.status(error.status).json({ error: error.message, code: error.code, ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }) });
    }
  });
}
function audit(req: AuthedRequest, action: string, jobId: string): void {
  logAudit(req.user?.id ?? null, action, { projectId: req.params.projectId, jobId }, req);
}
router.use(requireSession);
router.use((req: AuthedRequest, res, next) => {
  if (!projectIdSchema.safeParse(req.params.projectId).success) { res.status(400).json({ error: "Invalid project ID", code: "INVALID_PROJECT_ID" }); return; }
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  if (!access) { res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" }); return; }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !canWriteProject(access)) { res.status(403).json({ error: "Editor access required", code: "READ_ONLY" }); return; }
  res.set("Cache-Control", "private, no-store");
  next();
});
router.get("/", handle((req, res) => { res.json(listNativeJobs(req.params.projectId, actor(req))); }));
router.post("/", handle((req, res) => {
  const input = nativeJobSubmitSchema.safeParse(req.body);
  if (!input.success) throw new WorkspaceError(400, "Invalid native job request", "INVALID_JOB");
  const job = submitNativeJob(req.params.projectId, actor(req), input.data);
  audit(req, "native-job.submit", job.id);
  res.status(202).json({ job });
}));
router.param("jobId", (_req, _res, next, value: string) => {
  if (!artifactIdSchema.safeParse(value).success) { next(new WorkspaceError(400, "Invalid job ID", "INVALID_JOB_ID")); return; }
  next();
});
router.get("/:jobId", handle((req, res) => { res.json({ job: readNativeJob(req.params.projectId, req.params.jobId, actor(req)) }); }));
router.post("/:jobId/cancel", handle((req, res) => {
  const job = cancelNativeJob(req.params.projectId, req.params.jobId, actor(req)); audit(req, "native-job.cancel", job.id); res.json({ job });
}));
router.delete("/:jobId", handle((req, res) => {
  deleteNativeJob(req.params.projectId, req.params.jobId, actor(req)); audit(req, "native-job.delete", req.params.jobId); res.status(204).end();
}));
router.get("/:jobId/artifacts/:artifactId", handle((req, res) => {
  if (!artifactIdSchema.safeParse(req.params.artifactId).success) throw new WorkspaceError(400, "Invalid artifact ID", "INVALID_ARTIFACT_ID");
  const { artifact, bytes } = readNativeJobArtifact(req.params.projectId, req.params.jobId, req.params.artifactId, actor(req));
  const filename = encodeURIComponent(artifact.name).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  res.set({ "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="artifact.bin"; filename*=UTF-8''${filename}`, "Content-Length": String(bytes.length), "X-Artifact-Sha256": artifact.sha256 });
  res.send(bytes);
}));
router.use((error: unknown, _req: AuthedRequest, res: Response, next: import("express").NextFunction) => {
  if (!(error instanceof WorkspaceError)) { next(error); return; }
  res.status(error.status).json({ error: error.message, code: error.code });
});
export default router;
