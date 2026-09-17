import { Router, type Request } from "express";
import multer from "multer";
import { logAudit } from "../audit.js";
import { deriveVaultKey, decryptAesGcm, encryptAesGcm, randomId } from "../crypto.js";
import { MASTER_KEY } from "../config.js";
import { db, now } from "../db.js";
import { asyncHandler, AuthedRequest, resolveSession } from "../security.js";
import { z } from "zod";

const router = Router();
const VAULT_KEY = deriveVaultKey(MASTER_KEY);
const PROJECT_AAD = "secure-nexus:project";
const FILE_AAD = "secure-nexus:file";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

router.use((req: AuthedRequest, res, next) => {
  const session = resolveSession(req);
  if (!session) {
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
  return decryptAesGcm(payload, VAULT_KEY, `${PROJECT_AAD}:${userId}`);
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
  "commercial",
  "highway",
  "roadways",
  "airport",
  "ports",
  "dams",
  "spillways",
  "bim",
  "steel",
  "civil",
  "coordination",
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
});

const designSchema = z.object({
  designData: z.string().min(2).max(4_000_000),
});

/* GET /api/projects */
router.get("/", (req: AuthedRequest, res) => {
  const rows = db
    .prepare(
      "SELECT p.id, p.name, p.project_type, p.width_mm, p.depth_mm, p.created_at, p.updated_at, p.photo_file_id FROM projects p WHERE p.user_id = ? ORDER BY p.updated_at DESC",
    )
    .all(req.user!.id) as {
    id: string;
    name: string;
    project_type: string;
    width_mm: number;
    depth_mm: number;
    created_at: number;
    updated_at: number;
    photo_file_id: string | null;
  }[];
  res.json({
    projects: rows.map((p) => ({
      id: p.id,
      name: p.name,
      projectType: p.project_type,
      widthMm: p.width_mm,
      depthMm: p.depth_mm,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      hasPhoto: Boolean(p.photo_file_id),
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
    db.prepare(
      `INSERT INTO projects (id, user_id, name, project_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, req.user!.id, parsed.data.name, parsed.data.projectType || "house", t, t);
    logAudit(req.user!.id, "project.created", { name: parsed.data.name, projectType: parsed.data.projectType || "house" }, req);
    res.status(201).json({
      id,
      name: parsed.data.name,
      projectType: parsed.data.projectType || "house",
      widthMm: 6000,
      depthMm: 4000,
      createdAt: t,
      updatedAt: t,
    });
  }),
);

/* GET /api/projects/:id */
router.get("/:id", (req: AuthedRequest, res) => {
  const row = db
    .prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user!.id) as
    | {
        id: string;
        name: string;
        project_type: string;
        design_data: string | null;
        width_mm: number;
        depth_mm: number;
        photo_file_id: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const design = row.design_data ? JSON.parse(decryptForUser(row.design_data, req.user!.id)) : null;
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
  });
});

/* PATCH /api/projects/:id — name, dims, or encrypted design data */
router.patch(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const row = db
      .prepare("SELECT id, name FROM projects WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id) as { id: string; name: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = (req.body as Record<string, unknown>) || {};
    } catch {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const hasDesign = typeof parsedBody.designData === "string";
    const meta = projectMetaSchema.partial().safeParse(parsedBody);
    if (!meta.success && !hasDesign) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }

    let designPayload: string | null = null;
    if (hasDesign) {
      const parsed = designSchema.safeParse(parsedBody);
      if (!parsed.success) {
        res.status(400).json({ error: "Design data is invalid" });
        return;
      }
      designPayload = encryptForUser(parsed.data.designData, req.user!.id);
    }

    const fields: string[] = [];
    const values: (string | number)[] = [];
    if (typeof parsedBody.name === "string" && parsedBody.name.trim()) {
      fields.push("name = ?");
      values.push(parsedBody.name.trim().slice(0, 80));
    }
    if (typeof parsedBody.projectType === "string" && PROJECT_TYPES.includes(parsedBody.projectType as ProjectType)) {
      fields.push("project_type = ?");
      values.push(parsedBody.projectType);
    }
    if (typeof parsedBody.widthMm === "number") {
      fields.push("width_mm = ?");
      values.push(Math.round(Math.min(Math.max(parsedBody.widthMm, 1000), 30000)));
    }
    if (typeof parsedBody.depthMm === "number") {
      fields.push("depth_mm = ?");
      values.push(Math.round(Math.min(Math.max(parsedBody.depthMm, 1000), 30000)));
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
    values.push(req.user!.id);

    db.prepare(
      `UPDATE projects SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
    ).run(...values);

    if (designPayload !== null) {
      logAudit(req.user!.id, "project.updated", { name: row.name }, req);
    }
    res.json({ ok: true });
  }),
);

/* POST /api/projects/:id/photo */
router.post(
  "/:id/photo",
  upload.single("photo"),
  (req: AuthedRequest, res) => {
    const row = db
      .prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!row) {
      res.status(404).json({ error: "Project not found" });
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
      `${FILE_AAD}:${req.user!.id}`,
    );
    const fileId = randomId();
    db.prepare(
      "INSERT INTO files (id, user_id, mime, iv, tag, ciphertext, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(fileId, req.user!.id, mime, payload.iv, payload.tag, payload.data, req.file.size, now());

    const oldFile = (
      db.prepare("SELECT photo_file_id FROM projects WHERE id = ? AND user_id = ?").get(
        req.params.id,
        req.user!.id,
      ) as { photo_file_id: string | null }
    ).photo_file_id;

    db.prepare("UPDATE projects SET photo_file_id = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(
      fileId,
      now(),
      req.params.id,
      req.user!.id,
    );

    if (oldFile) {
      db.prepare("DELETE FROM files WHERE id = ? AND user_id = ?").run(oldFile, req.user!.id);
    }
    logAudit(req.user!.id, "project.photo_uploaded", { mime, size: req.file.size }, req);
    res.json({ ok: true, fileId });
  },
);

/* GET /api/projects/:id/photo */
router.get("/:id/photo", (req: AuthedRequest, res) => {
  const row = db
    .prepare(
      "SELECT p.photo_file_id FROM projects p WHERE p.id = ? AND p.user_id = ?",
    )
    .get(req.params.id, req.user!.id) as { photo_file_id: string | null } | undefined;
  if (!row?.photo_file_id) {
    res.status(404).json({ error: "No photo" });
    return;
  }
  const file = db
    .prepare("SELECT mime, iv, tag, ciphertext FROM files WHERE id = ? AND user_id = ?")
    .get(row.photo_file_id, req.user!.id) as
    | { mime: string; iv: string; tag: string; ciphertext: string }
    | undefined;
  if (!file) {
    res.status(404).json({ error: "No photo" });
    return;
  }
  const base64 = decryptAesGcm(
    { iv: file.iv, tag: file.tag, data: file.ciphertext },
    VAULT_KEY,
    `${FILE_AAD}:${req.user!.id}`,
  );
  res.set("Content-Type", file.mime);
  res.set("Cache-Control", "private, no-store");
  res.set("X-Content-Type-Options", "nosniff");
  const buf = Buffer.from(base64, "base64");
  res.send(buf);
});

/* POST /api/projects/:id/export — records an export event (Downloaded client-side) */
router.post(
  "/:id/export",
  asyncHandler(async (req: AuthedRequest, res) => {
    const row = db
      .prepare("SELECT name FROM projects WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id) as { name: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
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
    const row = db
      .prepare("SELECT id, name, photo_file_id FROM projects WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id) as
      | { id: string; name: string; photo_file_id: string | null }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (row.photo_file_id) {
      db.prepare("DELETE FROM files WHERE id = ? AND user_id = ?").run(row.photo_file_id, req.user!.id);
    }
    db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
    logAudit(req.user!.id, "project.deleted", { name: row.name }, req);
    res.json({ ok: true });
  }),
);

// Kept for reference: request typing helper
export type { Request };
export default router;