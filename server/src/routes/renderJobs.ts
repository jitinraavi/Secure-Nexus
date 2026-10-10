import { Router, type Response } from "express";
import { z } from "zod";
import { logAudit } from "../audit.js";
import { canWriteProject, getProjectAccess } from "../projectAccess.js";
import {
  cancelRenderJob,
  getRenderJob,
  getRenderJobArtifact,
  listRenderJobs,
  retryRenderJob,
  submitRenderJob,
  submitRenderJobSchema,
} from "../renderJobs.js";
import { getRenderProvider, RENDER_STYLE_PRESETS } from "../renderProvider.js";
import { ProviderResourceError } from "../providerBudget.js";
import { boundedUpload } from "../uploads.js";
import { asyncHandler, requireSession, type AuthedRequest } from "../security.js";
import { WorkspaceError, type WorkspaceActor } from "../workspaces.js";

const router = Router({ mergeParams: true });
const projectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
const jobIdSchema = z.string().regex(/^[a-f0-9]{32}$/);

const upload = boundedUpload("sourceImage", {
  fileSize: 32 * 1024 * 1024, fields: 4, fieldSize: 8_192, parts: 6, fieldNameSize: 32,
  allowedFields: ["prompt", "negativePrompt", "stylePreset", "sourceRevision"],
});

function actor(req: AuthedRequest): WorkspaceActor {
  if (!req.user || !req.session) throw new WorkspaceError(401, "Not authenticated", "SESSION_EXPIRED");
  return { userId: req.user.id, sessionId: req.session.id };
}

function fail(res: Response, error: WorkspaceError): void {
  res.status(error.status).json({
    error: error.message,
    code: error.code,
    ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
  });
}

function handle(work: (req: AuthedRequest, res: Response) => void | Promise<void>) {
  return asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      await work(req, res);
    } catch (error) {
      if (error instanceof WorkspaceError) {
        fail(res, error);
      } else if (error instanceof ProviderResourceError) {
        res.status(error.status).json({ error: error.message, code: error.code });
      } else {
        throw error;
      }
    }
  });
}

router.use(requireSession);
router.use((req: AuthedRequest, res, next) => {
  if (!projectIdSchema.safeParse(req.params.projectId).success) {
    res.status(400).json({ error: "Invalid project ID", code: "INVALID_PROJECT_ID" });
    return;
  }
  const access = getProjectAccess(req.params.projectId, req.user!.id);
  if (!access) {
    res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
    return;
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !canWriteProject(access)) {
    res.status(403).json({ error: "Editor access required", code: "READ_ONLY" });
    return;
  }
  res.set("Cache-Control", "private, no-store");
  next();
});

// GET capabilities & presets
router.get("/capabilities", (_req, res) => {
  const provider = getRenderProvider();
  res.json({
    configured: provider.isConfigured(),
    provider: provider.id,
    model: provider.model,
    version: provider.version,
    unconfiguredReason: provider.getUnconfiguredReason(),
    presets: RENDER_STYLE_PRESETS,
  });
});

// GET /api/projects/:projectId/renders
router.get("/", handle((req, res) => {
  const data = listRenderJobs(req.params.projectId, actor(req));
  res.json(data);
}));

// POST /api/projects/:projectId/renders (accepts JSON or multipart)
router.post(
  "/",
  (req: AuthedRequest, res, next) => {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      upload(req, res, next);
    } else {
      next();
    }
  },
  handle((req, res) => {
    let payload = req.body;
    if (req.file) {
      payload = {
        prompt: req.body.prompt,
        negativePrompt: req.body.negativePrompt || undefined,
        stylePreset: req.body.stylePreset || undefined,
        sourceRevision: Number(req.body.sourceRevision ?? 0),
        sourceImageBase64: `data:image/png;base64,${req.file.buffer.toString("base64")}`,
      };
    }

    const parsed = submitRenderJobSchema.safeParse(payload);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(", "),
        code: "INVALID_JOB_INPUT",
      });
      return;
    }

    const job = submitRenderJob(req.params.projectId, actor(req), parsed.data);
    logAudit(req.user?.id ?? null, "render.submit", { projectId: req.params.projectId, jobId: job.id }, req);
    res.status(201).json({ job });
  }),
);

// GET /api/projects/:projectId/renders/:jobId
router.get("/:jobId", handle((req, res) => {
  if (!jobIdSchema.safeParse(req.params.jobId).success) {
    throw new WorkspaceError(400, "Invalid render job ID", "INVALID_JOB_ID");
  }
  const job = getRenderJob(req.params.projectId, req.params.jobId, actor(req));
  res.json({ job });
}));

// GET /api/projects/:projectId/renders/:jobId/image
router.get("/:jobId/image", handle((req, res) => {
  if (!jobIdSchema.safeParse(req.params.jobId).success) {
    throw new WorkspaceError(400, "Invalid render job ID", "INVALID_JOB_ID");
  }
  const which = req.query.type === "source" ? "source" : "output";
  const { bytes, mime, filename, sha256 } = getRenderJobArtifact(
    req.params.projectId,
    req.params.jobId,
    which,
    actor(req),
  );

  res.set({
    "Content-Type": mime,
    "Content-Length": String(bytes.length),
    "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
    "X-Content-Type-Options": "nosniff",
    "ETag": `"${sha256}"`,
    "Cache-Control": "private, no-store",
  });
  res.send(bytes);
}));

// POST /api/projects/:projectId/renders/:jobId/retry
router.post("/:jobId/retry", handle((req, res) => {
  if (!jobIdSchema.safeParse(req.params.jobId).success) {
    throw new WorkspaceError(400, "Invalid render job ID", "INVALID_JOB_ID");
  }
  const job = retryRenderJob(req.params.projectId, req.params.jobId, actor(req));
  logAudit(req.user?.id ?? null, "render.retry", { projectId: req.params.projectId, originalJobId: req.params.jobId, newJobId: job.id }, req);
  res.status(201).json({ job });
}));

// POST /api/projects/:projectId/renders/:jobId/cancel
router.post("/:jobId/cancel", handle((req, res) => {
  if (!jobIdSchema.safeParse(req.params.jobId).success) {
    throw new WorkspaceError(400, "Invalid render job ID", "INVALID_JOB_ID");
  }
  const job = cancelRenderJob(req.params.projectId, req.params.jobId, actor(req));
  logAudit(req.user?.id ?? null, "render.cancel", { projectId: req.params.projectId, jobId: job.id }, req);
  res.json({ job });
}));

export default router;
