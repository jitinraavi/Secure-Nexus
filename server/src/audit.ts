import type { Request } from "express";
import { db, now, withTransaction } from "./db.js";
export type AuditDetail = string | Record<string, unknown>;
export async function logAudit(userId: string | null, action: string, detail: AuditDetail, req?: Pick<Request, "ip" | "get">): Promise<void> {
    try {
        const detailStr = typeof detail === "string" ? detail : JSON.stringify({ ...detail, ip: req?.ip });
        // A nested savepoint keeps an optional audit failure from poisoning a
        // surrounding PostgreSQL transaction after the error has been handled.
        await withTransaction(async () => {
            await db.prepare(`INSERT INTO audit_logs (user_id, action, detail, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`).run(userId, action, detailStr, req?.ip || null, req?.get("user-agent") || null, now());
        });
    }
    catch {
        // Audit failures must never break the request.
    }
}
