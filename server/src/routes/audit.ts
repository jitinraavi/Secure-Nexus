import { Router } from "express";
import { db, now } from "../db.js";
import { AuthedRequest, resolveSession } from "../security.js";

const router = Router();

router.use((req: AuthedRequest, res, next) => {
  const session = resolveSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.user = { id: session.user_id, email: "" };
  req.session = session;
  next();
});

/* GET /api/audit?limit=&action= */
router.get("/", (req: AuthedRequest, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const action = typeof req.query.action === "string" ? req.query.action : null;

  const rows = action
    ? (db
        .prepare(
          "SELECT id, action, detail, ip, user_agent, created_at FROM audit_logs WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(req.user!.id, action, limit) as unknown as AuditRow[])
    : (db
        .prepare(
          "SELECT id, action, detail, ip, user_agent, created_at FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(req.user!.id, limit) as unknown as AuditRow[]);

  res.json({ events: rows });
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