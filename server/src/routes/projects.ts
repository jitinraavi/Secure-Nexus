import { Router, type Request } from "express";
import multer from "multer";
import { logAudit } from "../audit.js";
import { deriveVaultKey, decryptAesGcm, encryptAesGcm, randomId, randomToken, sha256Hex } from "../crypto.js";
import { MASTER_KEY, PREVIOUS_MASTER_KEY } from "../config.js";
import { db, now, withTransaction } from "../db.js";
import { asyncHandler, AuthedRequest, resolveSession } from "../security.js";
import { z } from "zod";
import { emitProjectEvent } from "../collaboration.js";
import { conflictingDesignLock } from "../designLocks.js";
import { canManageProject, canReadProject, canWriteProject, getProjectAccess } from "../projectAccess.js";
import { organizationAudit } from "../organization.js";

const router = Router();
const VAULT_KEY = deriveVaultKey(MASTER_KEY);
const PREVIOUS_VAULT_KEY = PREVIOUS_MASTER_KEY ? deriveVaultKey(PREVIOUS_MASTER_KEY) : null;
const PROJECT_AAD = "groundwork:project";
const FILE_AAD = "groundwork:file";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

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

function encryptForUser(plaintext: string, userId: string): string {
  const payload = encryptAesGcm(plaintext, VAULT_KEY, `${PROJECT_AAD}:${userId}`);
  return JSON.stringify(payload);
}

function decryptForUser(payloadJson: string, userId: string): string {
  const payload = JSON.parse(payloadJson) as {
    iv: string;
    tag: string;
    data: string;
  };
  /* Projects created before encrypted design storage may contain plain JSON. */
  if (!payload.iv || !payload.tag || !payload.data) return payloadJson;
  try {
    return decryptAesGcm(payload, VAULT_KEY, `${PROJECT_AAD}:${userId}`);
  } catch (currentError) {
    if (!PREVIOUS_VAULT_KEY) throw currentError;
    return decryptAesGcm(payload, PREVIOUS_VAULT_KEY, `${PROJECT_AAD}:${userId}`);
  }
}

function sniffMime(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length > 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.length > 4 && buf.toString("ascii", 0, 4) === "GIF8") {
    return "image/gif";
  }
  return null;
}

export const PROJECT_TYPES = [
  "house",
  "residential",
  "villa-community",
  "townhouse",
  "commercial",
  "highway",
  "airport",
  "ports",
  "dams",
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];

const projectTypeSchema = z.enum(PROJECT_TYPES);

const projectNameSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(80),
  projectType: projectTypeSchema.optional(),
});

const projectMetaSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  projectType: projectTypeSchema.optional(),
  widthMm: z.number().int().min(1000).max(30000).optional(),
  depthMm: z.number().int().min(1000).max(30000).optional(),
  folder: z.string().trim().max(80).optional(),
  archived: z.boolean().optional(),
  isTemplate: z.boolean().optional(),
});

const designSchema = z.object({
  designData: z.string().min(2).max(4_000_000),
});

const revisionSchema = z.object({ name: z.string().trim().min(1).max(80), designData: z.string().min(2).max(4_000_000).optional() });
const shareLinkSchema = z.object({ expiresInHours: z.number().int().min(1).max(24 * 30).default(24 * 7) });

function projectForUser(projectId: string, userId: string) {
  const access = getProjectAccess(projectId, userId);
  if (!canReadProject(access)) return undefined;
  const row = db.prepare("SELECT id, user_id, name, project_type, design_data, width_mm, depth_mm, revision, photo_file_id, folder, archived, is_template, created_at, updated_at FROM projects WHERE id = ?")
    .get(projectId) as {
      id: string; user_id: string; name: string; project_type: string; design_data: string | null; width_mm: number; depth_mm: number; revision: number;
      photo_file_id: string | null; folder: string; archived: number; is_template: number; created_at: number; updated_at: number;
    } | undefined;
  return row ? { ...row, ownerId: access.ownerId, role: access.role } : undefined;
}

function revisionResponse(row: { id: string; name: string; project_type: string; width_mm: number; depth_mm: number; created_at: number }) {
  return { id: row.id, name: row.name, projectType: row.project_type, widthMm: row.width_mm, depthMm: row.depth_mm, createdAt: row.created_at };
}

/** All creation paths share the advertised free-plan active-project allowance. */
function canAddActiveProject(userId: string): boolean {
  const user = db.prepare("SELECT plan, plan_expires_at FROM users WHERE id = ?").get(userId) as { plan: string; plan_expires_at: number | null } | undefined;
  if (!user) return false;
  if (["pro", "studio"].includes(user.plan) && (user.plan_expires_at === null || user.plan_expires_at > now())) return true;
  const row = db.prepare("SELECT COUNT(*) AS count FROM projects WHERE user_id = ? AND archived = 0").get(userId) as { count: number };
  return Number(row.count) < 1;
}

const ACTIVE_PROJECT_LIMIT = "The Free plan allows one active owned project. Archive an existing project or upgrade before creating or restoring another.";

/* GET /api/projects */
router.get("/", (req: AuthedRequest, res) => {
  const rows = db.prepare(
    `SELECT p.id, p.name, p.project_type, p.width_mm, p.depth_mm, p.created_at, p.updated_at, p.photo_file_id, p.revision, p.folder, p.archived, p.is_template, 'owner' AS role
     FROM projects p WHERE p.user_id = ? AND p.organization_id IS NULL
     UNION ALL
     SELECT p.id, p.name, p.project_type, p.width_mm, p.depth_mm, p.created_at, p.updated_at, p.photo_file_id, p.revision, p.folder, p.archived, p.is_template, pm.role AS role
     FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = ? AND p.organization_id IS NULL
     UNION ALL
     SELECT p.id, p.name, p.project_type, p.width_mm, p.depth_mm, p.created_at, p.updated_at, p.photo_file_id, p.revision, p.folder, p.archived, p.is_template,
       CASE WHEN om.role IN ('owner','admin') THEN 'owner' ELSE om.role END AS role
     FROM organization_members om JOIN projects p ON p.organization_id=om.organization_id WHERE om.user_id=?
     ORDER BY updated_at DESC`,
  ).all(req.user!.id, req.user!.id, req.user!.id) as {
    id: string; name: string; project_type: string; width_mm: number; depth_mm: number; created_at: number; updated_at: number;
    photo_file_id: string | null; revision: number; folder: string; archived: number; is_template: number; role: "owner" | "editor" | "viewer";
  }[];
  res.json({
    projects: rows.map((p) => ({
      id: p.id, name: p.name, projectType: p.project_type, widthMm: p.width_mm, depthMm: p.depth_mm,
      createdAt: p.created_at, updatedAt: p.updated_at, hasPhoto: Boolean(p.photo_file_id), revision: p.revision, role: p.role,
      folder: p.folder, archived: Boolean(p.archived), isTemplate: Boolean(p.is_template),
    })),
  });
});

/* POST /api/projects */
router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = projectNameSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const id = randomId();
    const t = now();
    const created = withTransaction(() => {
      if (!canAddActiveProject(req.user!.id)) return false;
      db.prepare(
        `INSERT INTO projects (id, user_id, name, project_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, req.user!.id, parsed.data.name, parsed.data.projectType || "house", t, t);
      return true;
    });
    if (!created) { res.status(403).json({ error: ACTIVE_PROJECT_LIMIT, code: "ACTIVE_PROJECT_LIMIT" }); return; }
    logAudit(req.user!.id, "project.created", { name: parsed.data.name, projectType: parsed.data.projectType || "house" }, req);
    res.status(201).json({
      id,
      name: parsed.data.name,
      projectType: parsed.data.projectType || "house",
      widthMm: 6000,
      depthMm: 4000,
      createdAt: t,
      updatedAt: t,
      revision: 0,
      role: "owner", folder: "", archived: false, isTemplate: false,
    });
  }),
);

/* GET /api/projects/:id */
router.get("/:id", (req: AuthedRequest, res) => {
  const row = projectForUser(req.params.id, req.user!.id);
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  let design: unknown = null;
  if (row.design_data) {
    try {
      design = JSON.parse(decryptForUser(row.design_data, row.ownerId));
    } catch (error) {
      console.error(`[groundwork] Could not open project ${row.id}:`, error);
      res.status(422).json({ error: "This project cannot be opened because its stored design data is unreadable. Contact support." });
      return;
    }
  }
  res.json({
    id: row.id,
    name: row.name,
    projectType: row.project_type,
    design,
    widthMm: row.width_mm,
    depthMm: row.depth_mm,
    hasPhoto: Boolean(row.photo_file_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    role: row.role,
    folder: row.folder, archived: Boolean(row.archived), isTemplate: Boolean(row.is_template),
  });
});

/* POST /api/projects/:id/duplicate — read access is required even for templates. */
router.post("/:id/duplicate", asyncHandler(async (req: AuthedRequest, res) => {
  const source = projectForUser(req.params.id, req.user!.id);
  if (!source) { res.status(404).json({ error: "Project not found" }); return; }
  const sourceAccess = getProjectAccess(req.params.id, req.user!.id);
  if (sourceAccess?.organizationId) { res.status(403).json({ error: "Tenant projects cannot be duplicated into a personal workspace" }); return; }
  const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(req.body || {});
  if (!parsed.success) { res.status(400).json({ error: "A project name of 1–80 characters is required" }); return; }
  let designData: string | null = null;
  try {
    if (source.design_data) {
      const plaintext = decryptForUser(source.design_data, source.ownerId);
      if (plaintext.length > 4_000_000) throw new Error("Design exceeds the project size limit");
      JSON.parse(plaintext);
      designData = encryptForUser(plaintext, req.user!.id);
    }
  } catch {
    res.status(422).json({ error: "The source design cannot be copied because its stored data is unreadable or too large" });
    return;
  }
  const id = randomId();
  const t = now();
  const created = withTransaction(() => {
    if (!canAddActiveProject(req.user!.id)) return false;
    db.prepare("INSERT INTO projects (id, user_id, name, project_type, design_data, width_mm, depth_mm, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, req.user!.id, parsed.data.name, source.project_type, designData, source.width_mm, source.depth_mm, t, t);
    return true;
  });
  if (!created) { res.status(403).json({ error: ACTIVE_PROJECT_LIMIT, code: "ACTIVE_PROJECT_LIMIT" }); return; }
  // Photos, team permissions, share links, history, locks and operations stay with the source.
  logAudit(req.user!.id, "project.duplicated", { projectId: id, sourceProjectId: source.id, name: parsed.data.name, fromTemplate: Boolean(source.is_template) }, req);
  res.status(201).json({ id, name: parsed.data.name, projectType: source.project_type, widthMm: source.width_mm, depthMm: source.depth_mm,
    createdAt: t, updatedAt: t, hasPhoto: false, revision: 0, role: "owner", folder: "", archived: false, isTemplate: false });
}));

/* PATCH /api/projects/:id — name, dims, or encrypted design data */
router.patch(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const access = getProjectAccess(req.params.id, req.user!.id);
    if (!canWriteProject(access)) {
      res.status(access ? 403 : 404).json({ error: access ? "Editor access required" : "Project not found" });
      return;
    }
    const row = db.prepare("SELECT id, name, revision, archived FROM projects WHERE id = ?").get(req.params.id) as { id: string; name: string; revision: number; archived: number };

    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = (req.body as Record<string, unknown>) || {};
    } catch {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const hasDesign = typeof parsedBody.designData === "string";
    const expectedRevision = typeof parsedBody.baseRevision === "number" ? parsedBody.baseRevision : null;
    const current = { revision: row.revision };
    if (expectedRevision !== null && expectedRevision !== current.revision) {
      res.status(409).json({ error: "Project changed elsewhere", code: "REVISION_CONFLICT", currentRevision: current.revision });
      return;
    }
    const meta = projectMetaSchema.partial().safeParse(parsedBody);
    if (!meta.success) {
      res.status(400).json({ error: meta.error.issues[0]?.message || "Invalid project metadata" });
      return;
    }
    const hasLibraryMetadata = meta.data.folder !== undefined || meta.data.archived !== undefined || meta.data.isTemplate !== undefined;
    if (hasLibraryMetadata && !canManageProject(access)) {
      res.status(403).json({ error: "Owner access required to organize, archive or designate templates" });
      return;
    }

    let designPayload: string | null = null;
    if (hasDesign) {
      const parsed = designSchema.safeParse(parsedBody);
      if (!parsed.success) {
        res.status(400).json({ error: "Design data is invalid" });
        return;
      }
      designPayload = encryptForUser(parsed.data.designData, access.ownerId);
      const stored = db.prepare("SELECT design_data FROM projects WHERE id = ?").get(req.params.id) as { design_data: string | null };
      const before: unknown = stored.design_data ? JSON.parse(decryptForUser(stored.design_data, access.ownerId)) : null;
      const lockedObject = conflictingDesignLock(req.params.id, req.user!.id, before, JSON.parse(parsed.data.designData));
      if (lockedObject) { res.status(423).json({ error: "Object is locked by another editor", objectId: lockedObject }); return; }
    }

    const fields: string[] = [];
    const values: (string | number)[] = [];
    if (meta.data.name !== undefined) {
      fields.push("name = ?");
      values.push(meta.data.name);
    }
    if (meta.data.projectType !== undefined) {
      fields.push("project_type = ?");
      values.push(meta.data.projectType);
    }
    if (meta.data.widthMm !== undefined) {
      fields.push("width_mm = ?");
      values.push(meta.data.widthMm);
    }
    if (meta.data.depthMm !== undefined) {
      fields.push("depth_mm = ?");
      values.push(meta.data.depthMm);
    }
    if (meta.data.folder !== undefined) {
      fields.push("folder = ?"); values.push(meta.data.folder);
    }
    if (meta.data.archived !== undefined) {
      fields.push("archived = ?"); values.push(Number(meta.data.archived));
    }
    if (meta.data.isTemplate !== undefined) {
      fields.push("is_template = ?"); values.push(Number(meta.data.isTemplate));
    }
    if (designPayload !== null) {
      fields.push("design_data = ?");
      values.push(designPayload);
    }
    if (fields.length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    fields.push("updated_at = ?");
    values.push(now());
    values.push(req.params.id);

    fields.push("revision = revision + 1");
    const result = withTransaction(() => {
      const libraryState = db.prepare("SELECT archived FROM projects WHERE id = ?").get(req.params.id) as { archived: number } | undefined;
      if (libraryState?.archived && meta.data.archived === false && !canAddActiveProject(access.ownerId)) return null;
      return db.prepare(
        `UPDATE projects SET ${fields.join(", ")} WHERE id = ?${expectedRevision !== null ? " AND revision = ?" : ""}`,
      ).run(...values, ...(expectedRevision !== null ? [expectedRevision] : []));
    });
    if (!result) { res.status(403).json({ error: ACTIVE_PROJECT_LIMIT, code: "ACTIVE_PROJECT_LIMIT" }); return; }
    if (!result.changes) {
      const latest = db.prepare("SELECT revision FROM projects WHERE id = ?").get(req.params.id) as { revision: number };
      res.status(409).json({ error: "Project changed elsewhere", code: "REVISION_CONFLICT", currentRevision: latest.revision });
      return;
    }

    if (designPayload !== null) {
      logAudit(req.user!.id, "project.updated", { name: row.name }, req);
    }
    if (hasLibraryMetadata) {
      logAudit(req.user!.id, "project.library_updated", { projectId: req.params.id, folder: meta.data.folder, archived: meta.data.archived, isTemplate: meta.data.isTemplate }, req);
    }
    const revision = current.revision + 1;
    if (access.organizationId) organizationAudit(access.organizationId, req.user!.id, "project.updated", { projectId: req.params.id, revision, designChanged: designPayload !== null });
    emitProjectEvent(req.params.id, req.user!.id, designPayload !== null ? "design.updated" : "snapshot.created", revision, { designChanged: designPayload !== null });
    res.json({ ok: true, revision });
  }),
);

/* GET /api/projects/:id/revisions */
router.get("/:id/revisions", (req: AuthedRequest, res) => {
  if (!projectForUser(req.params.id, req.user!.id)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const rows = db.prepare(
    "SELECT id, name, project_type, width_mm, depth_mm, created_at FROM project_revisions WHERE project_id = ? ORDER BY created_at DESC",
  ).all(req.params.id) as { id: string; name: string; project_type: string; width_mm: number; depth_mm: number; created_at: number }[];
  res.json({ revisions: rows.map(revisionResponse) });
});

/* POST /api/projects/:id/revisions — a named, encrypted snapshot of the current project */
router.post("/:id/revisions", asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = revisionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid snapshot name" });
    return;
  }
  const project = projectForUser(req.params.id, req.user!.id);
  const access = getProjectAccess(req.params.id, req.user!.id);
  if (!project || !canWriteProject(access)) {
    res.status(access ? 403 : 404).json({ error: access ? "Editor access required" : "Project not found" });
    return;
  }
  const revision = {
    id: randomId(), name: parsed.data.name, project_type: project.project_type,
    width_mm: project.width_mm, depth_mm: project.depth_mm, created_at: now(),
  };
  const snapshotData = parsed.data.designData
    ? encryptForUser(parsed.data.designData, project.ownerId)
    : encryptForUser(
        project.design_data ? decryptForUser(project.design_data, project.ownerId) : "null",
        project.ownerId,
      );
  db.prepare(
    "INSERT INTO project_revisions (id, project_id, user_id, name, design_data, project_type, width_mm, depth_mm, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(revision.id, project.id, req.user!.id, revision.name, snapshotData, revision.project_type, revision.width_mm, revision.depth_mm, revision.created_at);
  emitProjectEvent(project.id, req.user!.id, "snapshot.created", project.revision, { revisionId: revision.id, name: revision.name });
  logAudit(req.user!.id, "project.revision_created", { projectId: project.id, name: revision.name }, req);
  res.status(201).json(revisionResponse(revision));
}));

/* POST /api/projects/:id/revisions/:revisionId/restore */
router.post("/:id/revisions/:revisionId/restore", asyncHandler(async (req: AuthedRequest, res) => {
  const project = projectForUser(req.params.id, req.user!.id);
  const access = getProjectAccess(req.params.id, req.user!.id);
  const revision = db.prepare(
    "SELECT * FROM project_revisions WHERE id = ? AND project_id = ?",
  ).get(req.params.revisionId, req.params.id) as {
    id: string; name: string; design_data: string; project_type: string; width_mm: number; depth_mm: number;
  } | undefined;
  if (!project || !revision || !canWriteProject(access)) {
    res.status(access && !canWriteProject(access) ? 403 : 404).json({ error: access && !canWriteProject(access) ? "Editor access required" : "Project or snapshot not found" });
    return;
  }
  // Keep the encrypted payload intact; it remains bound to the project owner's vault AAD.
  const before = project.design_data ? JSON.parse(decryptForUser(project.design_data, project.ownerId)) : null;
  const restored = JSON.parse(decryptForUser(revision.design_data, project.ownerId)) as unknown;
  const lockedObject = conflictingDesignLock(project.id, req.user!.id, before, restored);
  if (lockedObject) { res.status(423).json({ error: "Object is locked by another editor", objectId: lockedObject }); return; }
  db.prepare("UPDATE projects SET design_data = ?, project_type = ?, width_mm = ?, depth_mm = ?, revision = revision + 1, updated_at = ? WHERE id = ?")
    .run(revision.design_data, revision.project_type, revision.width_mm, revision.depth_mm, now(), project.id);
  const nextRevision = project.revision + 1;
  emitProjectEvent(project.id, req.user!.id, "design.updated", nextRevision, { restoredRevisionId: revision.id });
  logAudit(req.user!.id, "project.revision_restored", { projectId: project.id, revisionId: revision.id }, req);
  res.json({ ok: true, revision: nextRevision, name: revision.name, projectType: revision.project_type, widthMm: revision.width_mm, depthMm: revision.depth_mm, design: JSON.parse(decryptForUser(revision.design_data, project.ownerId)) });
}));

/* GET /api/projects/:id/share-links */
router.get("/:id/share-links", (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.id, req.user!.id);
  if (!canManageProject(access)) {
    res.status(access ? 403 : 404).json({ error: access ? "Owner access required" : "Project not found" });
    return;
  }
  const rows = db.prepare("SELECT id, expires_at, revoked_at, created_at FROM project_share_links WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC")
    .all(req.params.id, access.ownerId) as { id: string; expires_at: number; revoked_at: number | null; created_at: number }[];
  res.json({ links: rows.map((row) => ({ id: row.id, expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at, active: !row.revoked_at && row.expires_at > now() })) });
});

/* POST /api/projects/:id/share-links */
router.post("/:id/share-links", asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = shareLinkSchema.safeParse(req.body || {});
  const project = projectForUser(req.params.id, req.user!.id);
  const access = getProjectAccess(req.params.id, req.user!.id);
  if (!parsed.success) {
    res.status(400).json({ error: "Expiry must be between 1 hour and 30 days" });
    return;
  }
  if (!project || !canManageProject(access)) {
    res.status(access ? 403 : 404).json({ error: access ? "Owner access required" : "Project not found" });
    return;
  }
  if (access.organizationId) { res.status(403).json({ error: "Public share links are disabled for organization projects" }); return; }
  const token = randomToken(32);
  const id = randomId();
  const createdAt = now();
  const expiresAt = createdAt + parsed.data.expiresInHours * 3600;
  db.prepare("INSERT INTO project_share_links (id, project_id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, project.id, access.ownerId, sha256Hex(token), expiresAt, createdAt);
  logAudit(req.user!.id, "project.share_link_created", { projectId: project.id, expiresAt }, req);
  res.status(201).json({ id, token, expiresAt, url: `/share/${token}` });
}));

/* DELETE /api/projects/:id/share-links/:linkId */
router.delete("/:id/share-links/:linkId", asyncHandler(async (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.id, req.user!.id);
  if (!canManageProject(access)) { res.status(access ? 403 : 404).json({ error: access ? "Owner access required" : "Project not found" }); return; }
  const result = db.prepare("UPDATE project_share_links SET revoked_at = ? WHERE id = ? AND project_id = ? AND user_id = ? AND revoked_at IS NULL")
    .run(now(), req.params.linkId, req.params.id, access.ownerId);
  if (!result.changes) {
    res.status(404).json({ error: "Share link not found" });
    return;
  }
  logAudit(req.user!.id, "project.share_link_revoked", { projectId: req.params.id, linkId: req.params.linkId }, req);
  res.json({ ok: true });
}));

/* POST /api/projects/:id/photo */
router.post(
  "/:id/photo",
  upload.single("photo"),
  (req: AuthedRequest, res) => {
    const access = getProjectAccess(req.params.id, req.user!.id);
    if (!canWriteProject(access)) {
      res.status(access ? 403 : 404).json({ error: access ? "Editor access required" : "Project not found" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No photo uploaded" });
      return;
    }
    const mime = sniffMime(req.file.buffer);
    if (!mime) {
      res.status(415).json({ error: "Unsupported file type. Use PNG, JPEG, WebP or GIF." });
      return;
    }

    const payload = encryptAesGcm(
      req.file.buffer.toString("base64"),
      VAULT_KEY,
      `${FILE_AAD}:${access.ownerId}`,
    );
    const fileId = randomId();
    db.prepare(
      "INSERT INTO files (id, user_id, mime, iv, tag, ciphertext, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(fileId, access.ownerId, mime, payload.iv, payload.tag, payload.data, req.file.size, now());

    const oldFile = (
      db.prepare("SELECT photo_file_id FROM projects WHERE id = ?").get(
        req.params.id,
      ) as { photo_file_id: string | null }
    ).photo_file_id;

    db.prepare("UPDATE projects SET photo_file_id = ?, updated_at = ? WHERE id = ?").run(
      fileId,
      now(),
      req.params.id,
    );

    if (oldFile) {
      db.prepare("DELETE FROM files WHERE id = ? AND user_id = ?").run(oldFile, access.ownerId);
    }
    logAudit(req.user!.id, "project.photo_uploaded", { mime, size: req.file.size }, req);
    res.json({ ok: true, fileId });
  },
);

/* GET /api/projects/:id/photo */
router.get("/:id/photo", (req: AuthedRequest, res) => {
  const access = getProjectAccess(req.params.id, req.user!.id);
  if (!canReadProject(access)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const row = db.prepare("SELECT photo_file_id FROM projects WHERE id = ?").get(req.params.id) as { photo_file_id: string | null } | undefined;
  if (!row?.photo_file_id) {
    res.status(404).json({ error: "No photo" });
    return;
  }
  const file = db.prepare("SELECT mime, iv, tag, ciphertext FROM files WHERE id = ? AND user_id = ?")
    .get(row.photo_file_id, access.ownerId) as { mime: string; iv: string; tag: string; ciphertext: string } | undefined;
  if (!file) {
    res.status(404).json({ error: "No photo" });
    return;
  }
  const base64 = decryptAesGcm({ iv: file.iv, tag: file.tag, data: file.ciphertext }, VAULT_KEY, `${FILE_AAD}:${access.ownerId}`);
  res.set("Content-Type", file.mime);
  res.set("Cache-Control", "private, no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.send(Buffer.from(base64, "base64"));
});

/* POST /api/projects/:id/export — records an export event (Downloaded client-side) */
router.post(
  "/:id/export",
  asyncHandler(async (req: AuthedRequest, res) => {
    const access = getProjectAccess(req.params.id, req.user!.id);
    if (!canReadProject(access)) { res.status(404).json({ error: "Project not found" }); return; }
    const row = db.prepare("SELECT name FROM projects WHERE id = ?").get(req.params.id) as { name: string };
    const format =
      typeof req.body?.format === "string" && /^[a-z0-9-]{1,20}$/i.test(req.body.format)
        ? String(req.body.format).toUpperCase()
        : "UNKNOWN";
    logAudit(req.user!.id, "project.exported", { name: row.name, format }, req);
    res.json({ ok: true });
  }),
);

/* DELETE /api/projects/:id */
router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const access = getProjectAccess(req.params.id, req.user!.id);
    if (!canManageProject(access)) {
      res.status(access ? 403 : 404).json({ error: access ? "Owner access required" : "Project not found" });
      return;
    }
    const row = db.prepare("SELECT id, name, photo_file_id FROM projects WHERE id = ?").get(req.params.id) as { id: string; name: string; photo_file_id: string | null };
    if (row.photo_file_id) {
      db.prepare("DELETE FROM files WHERE id = ? AND user_id = ?").run(row.photo_file_id, access.ownerId);
    }
    db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
    if (access.organizationId) organizationAudit(access.organizationId, req.user!.id, "project.deleted", { projectId: req.params.id, name: row.name });
    logAudit(req.user!.id, "project.deleted", { name: row.name }, req);
    res.json({ ok: true });
  }),
);

// Kept for reference: request typing helper
export type { Request };
export default router;

