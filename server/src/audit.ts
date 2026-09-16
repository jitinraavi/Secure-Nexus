import type { Request } from "express";
import { db, now } from "./db.js";

export type AuditDetail = string | Record<string, unknown>;

export function logAudit(
  userId: string | null,
  action: string,
  detail: AuditDetail,
  req?: Pick<Request, "ip" | "get">,
) {
  try {
    const detailStr =
      typeof detail === "string" ? detail : JSON.stringify({ ...detail, ip: req?.ip });
    db.prepare(
      `INSERT INTO audit_logs (user_id, action, detail, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      action,
      detailStr,
      req?.ip || null,
      req?.get("user-agent") || null,
      now(),
    );
  } catch {
    // Audit failures must never break the request.
  }
}