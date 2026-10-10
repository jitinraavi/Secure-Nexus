import { z } from "zod";
import { randomId, sha256Hex } from "./crypto.js";
import { db, now, withTransaction } from "./db.js";
import { organizationAudit } from "./organization.js";
import { canWriteProject, getProjectAccess, type ProjectAccess, type ProjectRole } from "./projectAccess.js";
import {
  admitProviderRequest, isBoundedProviderJson, releaseProviderPermit, renderOutputBytes, withProviderDeadline,
  ProviderResourceError, type ProviderPermit,
} from "./providerBudget.js";
import {
  getRenderProvider,
  RENDER_STYLE_PRESETS,
  type RenderPreset,
  type RenderProvider,
  type RenderProviderResult,
} from "./renderProvider.js";
import {
  artifactIdSchema,
  createWorkspaceArtifact,
  readWorkspaceArtifact,
  WorkspaceError,
  type WorkspaceActor,
} from "./workspaces.js";

export const RENDER_JOB_STATES = ["queued", "running", "succeeded", "failed", "cancelled", "unconfigured"] as const;
export type RenderJobState = (typeof RENDER_JOB_STATES)[number];

export const submitRenderJobSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt cannot be empty").max(2000, "Prompt cannot exceed 2000 characters"),
  negativePrompt: z.string().trim().max(1000).optional(),
  stylePreset: z.string().trim().max(100).optional(),
  sourceRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sourceImageBase64: z.string().max(Math.ceil(32 * 1024 * 1024 / 3) * 4 + 128).optional(),
  sourceImageArtifactId: artifactIdSchema.optional(),
  parameters: z.record(z.unknown()).refine((value) => isBoundedProviderJson(value, 16_384), "Parameters exceed the supported byte or complexity limits").optional(),
}).strict().superRefine((val, ctx) => {
  if (!val.sourceImageBase64 && !val.sourceImageArtifactId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either sourceImageBase64 or sourceImageArtifactId is required",
    });
  }
  if (val.sourceImageBase64 && val.sourceImageArtifactId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Supply exactly one source image" });
  }
});

export type SubmitRenderJobInput = z.infer<typeof submitRenderJobSchema>;

export interface RenderJobSummary {
  id: string;
  projectId: string;
  sourceRevision: number;
  currentProjectRevision: number;
  isRevisionCurrent: boolean;
  revisionMismatch: boolean;
  sourceImageArtifactId: string;
  sourceImageSha256: string;
  prompt: string;
  negativePrompt: string | null;
  stylePreset: string | null;
  provider: string;
  model: string;
  version: string;
  status: RenderJobState;
  outputArtifactId: string | null;
  outputSha256: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  parameters: Record<string, unknown>;
}

interface RenderJobRow {
  id: string;
  project_id: string;
  source_revision: number;
  source_image_artifact_id: string;
  source_image_sha256: string;
  prompt: string;
  negative_prompt: string | null;
  style_preset: string | null;
  provider: string;
  model: string;
  version: string;
  status: RenderJobState;
  output_artifact_id: string | null;
  output_sha256: string | null;
  error_code: string | null;
  error_message: string | null;
  parameters_json: string;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

// In-memory active job cancellation controllers
const activeRenderJobs = new Map<string, AbortController>();

function authorizeProject(
  projectId: string,
  actor: WorkspaceActor,
  write = false,
): { access: ProjectAccess; project: { id: string; name: string; revision: number; role: ProjectRole } } {
  const session = db
    .prepare("SELECT status,expires_at FROM sessions WHERE id=? AND user_id=?")
    .get(actor.sessionId, actor.userId) as { status: string; expires_at: number } | undefined;
  if (!session || session.status !== "active" || session.expires_at <= now()) {
    throw new WorkspaceError(401, "Session is no longer active", "SESSION_EXPIRED");
  }
  const access = getProjectAccess(projectId, actor.userId);
  if (!access) throw new WorkspaceError(404, "Project not found", "PROJECT_NOT_FOUND");
  if (write && !canWriteProject(access)) throw new WorkspaceError(403, "Editor access required", "READ_ONLY");
  const project = db.prepare("SELECT id,name,revision FROM projects WHERE id=?").get(projectId) as
    | { id: string; name: string; revision: number }
    | undefined;
  if (!project) throw new WorkspaceError(404, "Project not found", "PROJECT_NOT_FOUND");
  if (!Number.isSafeInteger(project.revision) || project.revision < 0) {
    throw new WorkspaceError(500, "Project revision cannot be read safely", "STORAGE_ERROR");
  }
  return { access, project: { ...project, role: access.role } };
}

function parseParameters(jsonStr: string): Record<string, unknown> {
  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function formatJobSummary(row: RenderJobRow, currentProjectRevision: number): RenderJobSummary {
  const isRevisionCurrent = row.source_revision === currentProjectRevision;
  return {
    id: row.id,
    projectId: row.project_id,
    sourceRevision: row.source_revision,
    currentProjectRevision,
    isRevisionCurrent,
    revisionMismatch: !isRevisionCurrent,
    sourceImageArtifactId: row.source_image_artifact_id,
    sourceImageSha256: row.source_image_sha256,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    stylePreset: row.style_preset,
    provider: row.provider,
    model: row.model,
    version: row.version,
    status: row.status,
    outputArtifactId: row.output_artifact_id,
    outputSha256: row.output_sha256,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    parameters: parseParameters(row.parameters_json),
  };
}

function tenantAudit(access: ProjectAccess, actor: WorkspaceActor, action: string, detail: Record<string, unknown>): void {
  if (access.organizationId) {
    organizationAudit(access.organizationId, actor.userId, action, { projectId: access.projectId, ...detail });
  }
}

/**
 * Executes a queued render job asynchronously.
 */
async function executeRenderJob(
  jobId: string,
  projectId: string,
  actor: WorkspaceActor,
  provider: RenderProvider,
  permit: ProviderPermit,
): Promise<void> {
  const controller = new AbortController();
  activeRenderJobs.set(jobId, controller);

  try {
    // 1. Mark running
    withTransaction(() => {
      authorizeProject(projectId, actor, true);
      db.prepare("UPDATE project_render_jobs SET status='running', updated_at=? WHERE id=? AND status='queued'").run(
        now(),
        jobId,
      );
    });

    const job = db.prepare("SELECT * FROM project_render_jobs WHERE id=?").get(jobId) as unknown as RenderJobRow | undefined;
    if (!job || job.status !== "running") return;

    // 2. Read source image artifact
    const { bytes: sourceImageBuffer } = readWorkspaceArtifact(projectId, job.source_image_artifact_id, actor);

    // 3. Call AI provider
    const result: RenderProviderResult = await withProviderDeadline(permit.timeoutMs, (signal) => provider.generate({
      prompt: job.prompt, negativePrompt: job.negative_prompt || undefined,
      stylePreset: job.style_preset || undefined, sourceImageBuffer,
      parameters: parseParameters(job.parameters_json),
    }, signal), controller.signal);
    controller.signal.throwIfAborted();
    if (!Buffer.isBuffer(result.imageBuffer) || result.imageBuffer.length === 0 || result.imageBuffer.length > renderOutputBytes()) {
      throw new ProviderResourceError(502, "Rendered image exceeded the output byte limit", "PROVIDER_RESPONSE_SIZE");
    }

    // 4. Save rendered output as a brand-new versioned artifact
    const outputArtifactName = `render-output-rev${job.source_revision}-${jobId.slice(0, 8)}.png`;
    withTransaction(() => {
      authorizeProject(projectId, actor, true);
      const current = db.prepare("SELECT status FROM project_render_jobs WHERE id=? AND project_id=?").get(jobId, projectId) as { status: string } | undefined;
      if (current?.status !== "running" || controller.signal.aborted) return;
      // Consume this reservation in the same transaction as the artifact write.
      releaseProviderPermit(permit);
      const outputArtifact = createWorkspaceArtifact(projectId, "geometry", actor, outputArtifactName, result.imageBuffer);
      const timestamp = now();
      db.prepare(
        "UPDATE project_render_jobs SET status='succeeded', output_artifact_id=?, output_sha256=?, updated_at=?, completed_at=? WHERE id=? AND status='running'",
      ).run(outputArtifact.id, outputArtifact.sha256, timestamp, timestamp, jobId);
    });
  } catch (err: unknown) {
    const error = err as Error;
    const isAbort = error.name === "AbortError" || controller.signal.aborted;
    const status: RenderJobState = isAbort ? "cancelled" : "failed";
    const errorCode = (error as { code?: string }).code || (isAbort ? "CANCELLED" : "RENDER_FAILED");
    const errorMessage = error.message || (isAbort ? "Job was cancelled" : "Rendering failed");
    const timestamp = now();

    withTransaction(() => {
      db.prepare(
        "UPDATE project_render_jobs SET status=?, error_code=?, error_message=?, updated_at=?, completed_at=? WHERE id=? AND status IN ('queued','running')",
      ).run(status, errorCode, errorMessage, timestamp, timestamp, jobId);
    });
  } finally {
    activeRenderJobs.delete(jobId);
    releaseProviderPermit(permit);
  }
}

/**
 * List all render jobs for a project.
 */
export function listRenderJobs(
  projectId: string,
  actor: WorkspaceActor,
): {
  project: { id: string; name: string; revision: number; role: ProjectRole };
  jobs: RenderJobSummary[];
  capabilities: {
    configured: boolean;
    provider: string;
    model: string;
    unconfiguredReason: string | null;
    presets: RenderPreset[];
  };
} {
  return withTransaction(() => {
    const { project } = authorizeProject(projectId, actor);
    const provider = getRenderProvider();
    const rows = db
      .prepare("SELECT * FROM project_render_jobs WHERE project_id=? ORDER BY created_at DESC, id DESC LIMIT 100")
      .all(projectId) as unknown as RenderJobRow[];

    return {
      project,
      jobs: rows.map((r) => formatJobSummary(r, project.revision)),
      capabilities: {
        configured: provider.isConfigured(),
        provider: provider.id,
        model: provider.model,
        unconfiguredReason: provider.getUnconfiguredReason(),
        presets: RENDER_STYLE_PRESETS,
      },
    };
  });
}

/**
 * Get details for a specific render job.
 */
export function getRenderJob(projectId: string, jobId: string, actor: WorkspaceActor): RenderJobSummary {
  return withTransaction(() => {
    const { project } = authorizeProject(projectId, actor);
    const row = db
      .prepare("SELECT * FROM project_render_jobs WHERE project_id=? AND id=?")
      .get(projectId, jobId) as unknown as RenderJobRow | undefined;
    if (!row) throw new WorkspaceError(404, "Render job not found", "JOB_NOT_FOUND");
    return formatJobSummary(row, project.revision);
  });
}

/**
 * Submit an asynchronous durable AI rendering job.
 */
export function submitRenderJob(
  projectId: string,
  actor: WorkspaceActor,
  input: SubmitRenderJobInput,
): RenderJobSummary {
  const provider = getRenderProvider();
  const configured = provider.isConfigured();
  const jobId = randomId();
  const timestamp = now();
  let permit: ProviderPermit | undefined;

  const summary = withTransaction(() => {
    const { access, project } = authorizeProject(projectId, actor, true);
    ensureRenderHistoryCapacity(projectId);
    if (input.sourceRevision > project.revision) {
      throw new WorkspaceError(409, "Source revision is ahead of current project revision", "SOURCE_REVISION_AHEAD");
    }
    if (configured) permit = admitRender(projectId, actor, input);
    let sourceArtifactId = input.sourceImageArtifactId;
    let sourceSha256 = "";
    if (input.sourceImageBase64) {
      const rawBase64 = input.sourceImageBase64.replace(/^data:image\/\w+;base64,/, "");
      const imageBytes = Buffer.from(rawBase64, "base64");
      if (imageBytes.length < 100 || imageBytes.length > 32 * 1024 * 1024) {
        throw new WorkspaceError(400, "Source image must be between 100 bytes and 32 MiB", "INVALID_IMAGE_SIZE");
      }
      sourceSha256 = sha256Hex(imageBytes);
      sourceArtifactId = createWorkspaceArtifact(projectId, "geometry", actor, `render-source-rev${input.sourceRevision}-${jobId.slice(0, 8)}.png`, imageBytes).id;
    } else if (sourceArtifactId) {
      const existing = db.prepare("SELECT id,sha256,size FROM project_workspace_artifacts WHERE id=? AND project_id=?").get(sourceArtifactId, projectId) as { id: string; sha256: string; size: number } | undefined;
      if (!existing) throw new WorkspaceError(400, "Specified source image artifact was not found", "ARTIFACT_NOT_FOUND");
      if (existing.size > 32 * 1024 * 1024) throw new WorkspaceError(400, "Source image cannot exceed 32 MiB", "INVALID_IMAGE_SIZE");
      sourceSha256 = existing.sha256;
    } else {
      throw new WorkspaceError(400, "A valid source image is required", "MISSING_SOURCE_IMAGE");
    }

    const initialStatus: RenderJobState = configured ? "queued" : "unconfigured";
    const errorCode = configured ? null : "PROVIDER_UNCONFIGURED";
    const errorMessage = configured ? null : provider.getUnconfiguredReason();

    db.prepare(`
      INSERT INTO project_render_jobs (
        id, project_id, source_revision, source_image_artifact_id, source_image_sha256,
        prompt, negative_prompt, style_preset, provider, model, version, status,
        output_artifact_id, output_sha256, error_code, error_message, parameters_json,
        created_by, created_at, updated_at, completed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      jobId,
      projectId,
      input.sourceRevision,
      sourceArtifactId!,
      sourceSha256,
      input.prompt,
      input.negativePrompt ?? null,
      input.stylePreset ?? null,
      provider.id,
      provider.model,
      provider.version,
      initialStatus,
      null,
      null,
      errorCode,
      errorMessage,
      JSON.stringify(input.parameters ?? {}),
      actor.userId,
      timestamp,
      timestamp,
      configured ? null : timestamp,
    );

    tenantAudit(access, actor, "render.submit", {
      jobId,
      sourceRevision: input.sourceRevision,
      prompt: input.prompt,
      stylePreset: input.stylePreset,
      status: initialStatus,
    });

    const row = db.prepare("SELECT * FROM project_render_jobs WHERE id=?").get(jobId) as unknown as RenderJobRow;
    return formatJobSummary(row, project.revision);
  });
  if (permit) void executeRenderJob(jobId, projectId, actor, provider, permit);
  return summary;
}

function ensureRenderHistoryCapacity(projectId: string): void {
  const row = db.prepare("SELECT COUNT(*) AS count FROM project_render_jobs WHERE project_id=?").get(projectId) as { count: number };
  if (row.count >= 200) throw new WorkspaceError(409, "Project render history capacity reached", "RENDER_HISTORY_CAPACITY");
}

function admitRender(projectId: string, actor: WorkspaceActor, input: { prompt: string; negativePrompt?: string | null; parameters?: Record<string, unknown> }): ProviderPermit {
  // Image generation uses a fixed request charge proxy plus bounded prompt bytes.
  return admitProviderRequest({
    userId: actor.userId, kind: "render", projectId,
    tokenBudget: 4_096 + Buffer.byteLength(input.prompt + (input.negativePrompt ?? "") + JSON.stringify(input.parameters ?? {}), "utf8"),
    reservedBytes: renderOutputBytes(), reservedArtifacts: 1,
  });
}

/**
 * Retries a failed or cancelled render job by creating an immutable NEW job,
 * preserving historical records and outputs without corrupting the original.
 */
export function retryRenderJob(projectId: string, jobId: string, actor: WorkspaceActor): RenderJobSummary {
  const provider = getRenderProvider();
  const configured = provider.isConfigured();
  const newJobId = randomId();
  const timestamp = now();
  let permit: ProviderPermit | undefined;

  const summary = withTransaction(() => {
    const { access, project } = authorizeProject(projectId, actor, true);
    const original = db
      .prepare("SELECT * FROM project_render_jobs WHERE id=? AND project_id=?")
      .get(jobId, projectId) as unknown as RenderJobRow | undefined;
    if (!original) throw new WorkspaceError(404, "Original render job not found", "JOB_NOT_FOUND");
    if (original.status === "queued" || original.status === "running") {
      throw new WorkspaceError(409, "An active render cannot be retried", "INVALID_STATE");
    }
    ensureRenderHistoryCapacity(projectId);

    const originalParams = parseParameters(original.parameters_json);
    const newParams = { ...originalParams, retriedFromJobId: jobId };
    const source = db.prepare("SELECT size FROM project_workspace_artifacts WHERE id=? AND project_id=?").get(original.source_image_artifact_id, projectId) as { size: number } | undefined;
    if (!source || source.size > 32 * 1024 * 1024) throw new WorkspaceError(400, "The original source image is unavailable or too large", "ARTIFACT_NOT_FOUND");
    if (configured) permit = admitRender(projectId, actor, { prompt: original.prompt, negativePrompt: original.negative_prompt, parameters: newParams });

    const initialStatus: RenderJobState = configured ? "queued" : "unconfigured";
    const errorCode = configured ? null : "PROVIDER_UNCONFIGURED";
    const errorMessage = configured ? null : provider.getUnconfiguredReason();

    db.prepare(`
      INSERT INTO project_render_jobs (
        id, project_id, source_revision, source_image_artifact_id, source_image_sha256,
        prompt, negative_prompt, style_preset, provider, model, version, status,
        output_artifact_id, output_sha256, error_code, error_message, parameters_json,
        created_by, created_at, updated_at, completed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      newJobId,
      projectId,
      original.source_revision,
      original.source_image_artifact_id,
      original.source_image_sha256,
      original.prompt,
      original.negative_prompt,
      original.style_preset,
      provider.id,
      provider.model,
      provider.version,
      initialStatus,
      null,
      null,
      errorCode,
      errorMessage,
      JSON.stringify(newParams),
      actor.userId,
      timestamp,
      timestamp,
      configured ? null : timestamp,
    );

    tenantAudit(access, actor, "render.retry", {
      originalJobId: jobId,
      newJobId,
      sourceRevision: original.source_revision,
      status: initialStatus,
    });

    const row = db.prepare("SELECT * FROM project_render_jobs WHERE id=?").get(newJobId) as unknown as RenderJobRow;
    return formatJobSummary(row, project.revision);
  });
  if (permit) void executeRenderJob(newJobId, projectId, actor, provider, permit);
  return summary;
}

/**
 * Cancel an in-flight or queued render job.
 */
export function cancelRenderJob(projectId: string, jobId: string, actor: WorkspaceActor): RenderJobSummary {
  return withTransaction(() => {
    const { access, project } = authorizeProject(projectId, actor, true);
    const row = db
      .prepare("SELECT * FROM project_render_jobs WHERE id=? AND project_id=?")
      .get(jobId, projectId) as unknown as RenderJobRow | undefined;
    if (!row) throw new WorkspaceError(404, "Render job not found", "JOB_NOT_FOUND");

    if (row.status !== "queued" && row.status !== "running") {
      throw new WorkspaceError(409, `Job cannot be cancelled in state ${row.status}`, "INVALID_STATE");
    }

    // Signal abort
    const controller = activeRenderJobs.get(jobId);
    if (controller) {
      controller.abort();
    }

    const timestamp = now();
    db.prepare(
      "UPDATE project_render_jobs SET status='cancelled', error_code='CANCELLED', error_message='Job was cancelled by user', updated_at=?, completed_at=? WHERE id=?",
    ).run(timestamp, timestamp, jobId);

    tenantAudit(access, actor, "render.cancel", { jobId });

    const updated = db.prepare("SELECT * FROM project_render_jobs WHERE id=?").get(jobId) as unknown as RenderJobRow;
    return formatJobSummary(updated, project.revision);
  });
}

/**
 * Retrieves the raw image artifact bytes (source or output) for a render job.
 */
export function getRenderJobArtifact(
  projectId: string,
  jobId: string,
  which: "output" | "source",
  actor: WorkspaceActor,
): { bytes: Buffer; mime: string; filename: string; sha256: string } {
  return withTransaction(() => {
    authorizeProject(projectId, actor);
    const job = db
      .prepare("SELECT * FROM project_render_jobs WHERE id=? AND project_id=?")
      .get(jobId, projectId) as unknown as RenderJobRow | undefined;
    if (!job) throw new WorkspaceError(404, "Render job not found", "JOB_NOT_FOUND");

    const targetArtifactId = which === "output" ? job.output_artifact_id : job.source_image_artifact_id;
    if (!targetArtifactId) {
      throw new WorkspaceError(404, `No ${which} image artifact available for this job`, "ARTIFACT_NOT_FOUND");
    }

    const { artifact, bytes } = readWorkspaceArtifact(projectId, targetArtifactId, actor);
    return {
      bytes,
      mime: "image/png",
      filename: artifact.name || `render-${which}-${jobId}.png`,
      sha256: artifact.sha256,
    };
  });
}

/**
 * Reconcile any in-flight jobs interrupted during server shutdown.
 */
export function reconcileInterruptedRenderJobs(): void {
  try {
    const timestamp = now();
    db.prepare(
      "UPDATE project_render_jobs SET status='failed', error_code='SERVER_RESTARTED', error_message='Job was interrupted by server restart', updated_at=?, completed_at=? WHERE status IN ('queued', 'running')",
    ).run(timestamp, timestamp);
  } catch {
    // Schema might not be initialized yet during early test runs
  }
}
