import { Router } from "express";
import { db, now } from "../db.js";
import { AuthedRequest, requireSession } from "../security.js";

const router = Router();

router.use(requireSession);

/* Stable personal audit pages: id is a unique cursor even when timestamps match. */
router.get("/", (req: AuthedRequest, res) => {
  const integer = (value: unknown, minimum: number): number | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !/^\d+$/.test(value)) return NaN;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : NaN;
  };
  const requestedLimit = integer(req.query.limit, 1);
  const beforeId = integer(req.query.beforeId, 1);
  const requestedSnapshot = integer(req.query.snapshotId, 0);
  const from = integer(req.query.from, 0);
  const to = integer(req.query.to, 0);
  const action = req.query.action === undefined ? undefined : typeof req.query.action === "string" ? req.query.action.trim() : null;
  if ([requestedLimit, beforeId, requestedSnapshot, from, to].some((value) => value !== undefined && !Number.isFinite(value)) ||
      (from !== undefined && to !== undefined && from > to) || action === null || (action !== undefined && (!action || action.length > 120))) {
    res.status(400).json({ error: "Invalid audit filters or cursor" }); return;
  }
  const limit = Math.min(requestedLimit ?? 50, 200);
  const latest = db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM audit_logs WHERE user_id = ?").get(req.user!.id) as { id: number };
  const snapshotId = Math.min(requestedSnapshot ?? Number(latest.id), Number(latest.id));
  const clauses = ["user_id = ?", "id <= ?"];
  const values: (string | number)[] = [req.user!.id, snapshotId];
  if (action !== undefined) { clauses.push("action = ?"); values.push(action); }
  if (beforeId !== undefined) { clauses.push("id < ?"); values.push(beforeId); }
  if (from !== undefined) { clauses.push("created_at >= ?"); values.push(from); }
  if (to !== undefined) { clauses.push("created_at <= ?"); values.push(to); }
  const rows = db.prepare(`SELECT id, action, detail, ip, user_agent, created_at FROM audit_logs WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`)
    .all(...values, limit + 1) as unknown as AuditRow[];
  const events = rows.slice(0, limit);
  res.set("Cache-Control", "private, no-store");
  res.json({ events, snapshotId, nextBeforeId: rows.length > limit ? events[events.length - 1]?.id ?? null : null });
});

interface AuditRow {
  id: number;
  action: string;
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: number;
}

/* GET /api/audit/stats — aggregates for the dashboard */
router.get("/stats", (req: AuthedRequest, res) => {
  const uid = req.user!.id;
  const dayAgo = now() - 86400;

  const activeSessions = Number(
    (db
      .prepare("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND status = 'active' AND expires_at > ?")
      .get(uid, now()) as { c: number }).c,
  );
  const secretsCount = Number(
    (db.prepare("SELECT COUNT(*) AS c FROM secrets WHERE user_id = ?").get(uid) as { c: number }).c,
  );
  const projectsCount = Number(
    (db.prepare("SELECT COUNT(*) AS c FROM projects WHERE user_id = ?").get(uid) as { c: number }).c,
  );
  const failedLogins24h = Number(
    (db
      .prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE user_id = ? AND action = 'auth.login_failed' AND created_at > ?")
      .get(uid, dayAgo) as { c: number }).c,
  );
  const logins24h = Number(
    (db
      .prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE user_id = ? AND action IN ('auth.login','auth.2fa_verified') AND created_at > ?")
      .get(uid, dayAgo) as { c: number }).c,
  );
  const signupsEver = Number(
    (db
      .prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE user_id = ? AND action = 'auth.signup'")
      .get(uid) as { c: number }).c,
  );
  const enabled2fa = Boolean(
    (db.prepare("SELECT totp_enabled FROM users WHERE id = ?").get(uid) as { totp_enabled: number })
      .totp_enabled,
  );
  const lastLogin = (
    db.prepare("SELECT last_login_at FROM users WHERE id = ?").get(uid) as {
      last_login_at: number | null;
    }
  ).last_login_at;

  res.json({
    activeSessions,
    secretsCount,
    projectsCount,
    failedLogins24h,
    logins24h,
    signupsEver,
    enabled2fa,
    lastLogin,
  });
});

export default router;
