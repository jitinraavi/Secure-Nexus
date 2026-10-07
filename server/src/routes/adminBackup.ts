import { Router } from "express";
import { ADMIN_EMAILS, IS_PROD } from "../config.js";
import { requireSession, type AuthedRequest } from "../security.js";
import {
  checkpointDatabase,
  listDatabaseBackups,
  performDatabaseBackup,
} from "../databaseBackup.js";

const router = Router();

router.use(requireSession);
router.use((req: AuthedRequest, res, next) => {
  if (!IS_PROD) {
    return next();
  }
  const email = req.user?.email?.toLowerCase();
  if (email && ADMIN_EMAILS.has(email)) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden: Admin access required" });
});

/**
 * GET /api/admin/backups
 * Returns list of point-in-time database backups, sorted newest first.
 */
router.get("/", async (_req: AuthedRequest, res) => {
  try {
    const backups = await listDatabaseBackups();
    res.json({ backups });
  } catch (err) {
    res.status(500).json({ error: "Failed to list database backups", details: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /api/admin/backups
 * Triggers an immediate atomic hot backup via SQLite VACUUM INTO with integrity check.
 */
router.post("/", async (req: AuthedRequest, res) => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim().slice(0, 50) : undefined;
  try {
    const result = await performDatabaseBackup({ label });
    res.status(201).json({
      ok: true,
      backup: result,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Backup creation failed",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * POST /api/admin/checkpoints
 * Manually flushes SQLite Write-Ahead Log (WAL) pages to disk.
 */
router.post("/checkpoint", (req: AuthedRequest, res) => {
  const mode = req.body?.mode;
  const validModes = ["PASSIVE", "FULL", "RESTART", "TRUNCATE"] as const;
  const selectedMode = validModes.includes(mode) ? mode : "TRUNCATE";
  try {
    const result = checkpointDatabase(selectedMode);
    res.json({ ok: true, mode: selectedMode, ...result });
  } catch (err) {
    res.status(500).json({ error: "WAL checkpoint failed", details: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
