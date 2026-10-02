import type { AuditEvent } from "../types";
import type { AuditQuery } from "../api";

export const MAX_AUDIT_EXPORT_EVENTS = 10_000;

function csvCell(value: string | number | null): string {
  let text = String(value ?? "");
  // Quoting alone does not prevent spreadsheet formula evaluation.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function auditCsv(events: readonly AuditEvent[]): string {
  const rows: (string | number | null)[][] = [["id", "action", "created_at_utc", "detail", "ip", "user_agent"]];
  for (const event of events) rows.push([event.id, event.action, new Date(event.created_at * 1000).toISOString(), event.detail, event.ip, event.user_agent]);
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function auditJson(events: readonly AuditEvent[], query: AuditQuery, snapshotId: number, truncated: boolean): string {
  return JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), scope: "current-account", filters: query,
    snapshotId, eventCount: events.length, truncated, limit: MAX_AUDIT_EXPORT_EVENTS, events }, null, 2);
}
