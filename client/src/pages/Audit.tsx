import { useEffect, useState } from "react";
import { getAuditLog } from "../api";
import type { AuditEvent } from "../types";
import { Badge, Card, Spinner } from "../components/ui";
import { ACTION_LABELS, actionTone, formatDate, timeAgo } from "../lib/format";
import { cn } from "../lib/cn";

const ACTIONS = Object.keys(ACTION_LABELS);

function parseDetail(detail: string | null): { line: string; extra?: string } {
  if (!detail) return { line: "—" };
  const trimmed = detail.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const ip = obj.ip;
      delete obj.ip;
      const pieces = Object.entries(obj).map(([, v]) => {
        if (Array.isArray(v)) return v.join(", ");
        return String(v);
      });
      return { line: pieces.join(" · ") || "—", extra: ip ? `IP ${String(ip)}` : undefined };
    } catch {
      return { line: trimmed };
    }
  }
  return { line: trimmed };
}

export function Audit() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getAuditLog(200)
      .then(setEvents)
      .finally(() => setLoading(false));
  }, []);

  const filtered = events?.filter((e) => filter === "all" || e.action === filter) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">Audit log</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every security-relevant event on your account (last 200 events).
          </p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">Filter</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
          >
            <option value="all">All events</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a]}</option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Spinner className="h-6 w-6 text-emerald-400" /></div>
      ) : (
        <Card className="overflow-hidden">
          {filtered.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">No events match this filter.</p>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {filtered.map((e) => {
                const { line, extra } = parseDetail(e.detail);
                return (
                  <div key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <div className="flex-1 min-w-40">
                      <div className="flex items-center gap-2">
                        <Badge tone={actionTone(e.action)}>{ACTION_LABELS[e.action] || e.action}</Badge>
                        {extra && <span className="text-xs text-slate-500">{extra}</span>}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{line}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-300" title={formatDate(e.created_at)}>{timeAgo(e.created_at)}</p>
                      {e.user_agent && (
                        <p className={cn("mt-0.5 hidden max-w-[220px] truncate text-xs text-slate-600 sm:block")}>
                          {e.user_agent}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}