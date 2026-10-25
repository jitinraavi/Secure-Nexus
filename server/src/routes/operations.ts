import { routeParam } from "../routeParams.js";
import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { asyncHandler } from "../security.js";
import { now } from "../db.js";
import { FEATURE_NAMES, listFeatureFlags, updateFeatureFlag } from "../featureFlags.js";
import { operationalCheck, operationalMetrics, recentOperationalTraces, recordBackupReport, scheduleOperationalWork } from "../operationalRuntime.js";

const router = Router();
export function operationalTokenMatches(header: string | undefined, expected: string | undefined): boolean {
  if (!expected || expected.length < 32 || !header || header.length > 512 || !header.startsWith("Bearer ")) return false;
  return timingSafeEqual(createHash("sha256").update(header.slice(7)).digest(), createHash("sha256").update(expected).digest());
}
export const requireOperationsToken: RequestHandler = (req, res, next) => {
  if (!process.env.OPERATIONS_TOKEN || process.env.OPERATIONS_TOKEN.length < 32) { res.status(503).json({ error: "Operations access is not configured" }); return; }
  if (!operationalTokenMatches(req.get("authorization"), process.env.OPERATIONS_TOKEN)) { res.status(401).json({ error: "Operations authentication required" }); return; }
  res.setHeader("Cache-Control", "private, no-store");
  next();
};
router.get("/metrics", requireOperationsToken, asyncHandler(async (req, res) => {
  const minutes = z.coerce.number().int().min(5).max(1440).optional().safeParse(req.query.minutes);
  if (!minutes.success) { res.status(400).json({ error: "Window must be between 5 and 1440 minutes" }); return; }
  res.json(await operationalMetrics(minutes.data));
}));
router.get("/traces", requireOperationsToken, asyncHandler(async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(100).optional().safeParse(req.query.limit);
  if (!limit.success) { res.status(400).json({ error: "Trace limit must be between 1 and 100" }); return; }
  res.json({ traces: await recentOperationalTraces(limit.data) });
}));
router.get("/check", (req, res, next) => {
  if (!operationalTokenMatches(req.get("authorization"), process.env.CRON_SECRET) && !operationalTokenMatches(req.get("authorization"), process.env.OPERATIONS_TOKEN)) { res.status(401).json({ error: "Operations authentication required" }); return; }
  res.setHeader("Cache-Control", "private, no-store"); next();
}, asyncHandler(async (_req, res) => {
  const result = await operationalCheck();
  res.status(result.healthy ? 200 : 503).json(result);
}));
const backupReportSchema = z.object({
  backupId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), status: z.enum(["succeeded", "failed"]), encrypted: z.boolean(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/).optional(), bytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  completedAt: z.number().int().min(0),
}).strict().superRefine((value, context) => {
  if (value.completedAt > now() + 300 || value.completedAt < now() - 7 * 86400) context.addIssue({ code: z.ZodIssueCode.custom, message: "Backup timestamp is outside the allowed window" });
  if (value.status === "succeeded" && (!value.encrypted || !value.checksum || !value.bytes)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Successful backups require encryption, checksum and byte count" });
});
router.post("/backup-report", requireOperationsToken, asyncHandler(async (req, res) => {
  const parsed = backupReportSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid encrypted backup report" }); return; }
  await recordBackupReport(parsed.data);
  scheduleOperationalWork(() => operationalCheck());
  res.status(202).json({ ok: true });
}));
router.get("/flags", requireOperationsToken, asyncHandler(async (_req, res) => { res.json({ flags: await listFeatureFlags() }); }));
router.patch("/flags/:name", requireOperationsToken, asyncHandler(async (req, res) => {
  const name = z.enum(FEATURE_NAMES).safeParse(routeParam(req, "name"));
  const input = z.object({ enabled: z.boolean(), rolloutPercent: z.number().int().min(0).max(100), baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1) }).strict().safeParse(req.body);
  if (!name.success || !input.success) { res.status(400).json({ error: "Invalid feature flag update" }); return; }
  res.json(await updateFeatureFlag(name.data, input.data));
}));
router.use((error: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  const info = error as { code?: string; status?: number; message?: string } | null;
  if (info?.status === 409 && ["FLAG_CONFLICT", "FEATURE_UNSUPPORTED", "BACKUP_REPORT_STALE"].includes(info.code || "")) {
    res.status(409).json({ error: info.message, code: info.code }); return;
  }
  next(error);
});
export default router;
