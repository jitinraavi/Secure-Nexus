import { useEffect, useMemo, useRef, useState } from "react";
import { getAuditPage, type AuditQuery } from "../api";
import type { AuditEvent } from "../types";
import { Badge, Button, Card, Input, Select, Spinner } from "../components/ui";
import { useToast } from "../components/Toast";
import { ACTION_LABELS, actionTone, formatDate, timeAgo } from "../lib/format";
import { auditCsv, auditJson, MAX_AUDIT_EXPORT_EVENTS } from "../lib/auditExport";
import { download } from "../lib/download";

function parseDetail(detail: string | null): string {
  if (!detail) return "—";
  try {
    const parsed: unknown = JSON.parse(detail);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return detail;
    return Object.entries(parsed as Record<string, unknown>).filter(([key]) => key !== "ip").map(([key, value]) => key + ": " + (typeof value === "object" ? JSON.stringify(value) : String(value))).join(" · ") || "—";
  } catch { return detail; }
}

function utcDay(value: string): number | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && time >= 0 && new Date(time).toISOString().slice(0, 10) === value ? time / 1000 : NaN;
}

export function Audit() {
  const toast = useToast();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filter, setFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null);
  const [snapshotId, setSnapshotId] = useState<number | undefined>();
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportCount, setExportCount] = useState(0);
  const generation = useRef(0);
  const exportGeneration = useRef(0);
  const moreBusy = useRef(false);
  const exportLock = useRef(false);

  const range = useMemo(() => {
    const from = utcDay(fromDate);
    const dayTo = utcDay(toDate);
    const to = dayTo === undefined ? undefined : dayTo + 86_399;
    const invalid = (from !== undefined && !Number.isFinite(from)) || (to !== undefined && !Number.isFinite(to)) || (from !== undefined && to !== undefined && from > to);
    const query: AuditQuery = { action: filter === "all" ? undefined : filter, from, to };
    return { query, invalid };
  }, [filter, fromDate, toDate]);

  useEffect(() => {
    const current = ++generation.current;
    ++exportGeneration.current;
    moreBusy.current = false;
    setEvents([]); setNextBeforeId(null); setSnapshotId(undefined); setLoadingMore(false); setError("");
    if (range.invalid) { setError("Enter valid dates with the start on or before the end."); setLoading(false); return; }
    setLoading(true);
    void getAuditPage({ ...range.query, limit: 100 }).then((page) => {
      if (current !== generation.current) return;
      setEvents(page.events); setNextBeforeId(page.nextBeforeId); setSnapshotId(page.snapshotId);
    }).catch((err: unknown) => {
      if (current === generation.current) setError(err instanceof Error ? err.message : "Could not load audit events");
    }).finally(() => { if (current === generation.current) setLoading(false); });
    return () => { ++generation.current; ++exportGeneration.current; };
  }, [range, reload]);

  const loadMore = async () => {
    if (nextBeforeId === null || snapshotId === undefined || moreBusy.current || loading || range.invalid) return;
    const current = generation.current;
    moreBusy.current = true; setLoadingMore(true); setError("");
    try {
      const page = await getAuditPage({ ...range.query, limit: 100, beforeId: nextBeforeId, snapshotId });
      if (current !== generation.current) return;
      setEvents((previous) => [...previous, ...page.events]); setNextBeforeId(page.nextBeforeId);
    } catch (err) {
      if (current === generation.current) setError(err instanceof Error ? err.message : "Could not load more events");
    } finally {
      if (current === generation.current) { moreBusy.current = false; setLoadingMore(false); }
    }
  };

  const exportEvents = async (format: "csv" | "json") => {
    if (exportLock.current || loading || range.invalid || snapshotId === undefined) return;
    exportLock.current = true; setExportBusy(true); setExportCount(0);
    const current = ++exportGeneration.current;
    const query = range.query;
    const exportSnapshot = snapshotId;
    const rows: AuditEvent[] = [];
    let beforeId: number | undefined;
    let truncated = false;
    try {
      while (rows.length < MAX_AUDIT_EXPORT_EVENTS) {
        const page = await getAuditPage({ ...query, limit: Math.min(200, MAX_AUDIT_EXPORT_EVENTS - rows.length), snapshotId: exportSnapshot, beforeId });
        if (current !== exportGeneration.current) return;
        rows.push(...page.events); setExportCount(rows.length);
        if (page.nextBeforeId === null) break;
        if (page.events.length === 0 || (beforeId !== undefined && page.nextBeforeId >= beforeId)) throw new Error("Audit cursor did not advance");
        beforeId = page.nextBeforeId;
        truncated = rows.length >= MAX_AUDIT_EXPORT_EVENTS;
      }
      if (current !== exportGeneration.current) return;
      const name = "groundwork-audit-" + new Date().toISOString().slice(0, 10) + (truncated ? "-partial" : "") + "." + format;
      download(name, format === "csv" ? auditCsv(rows) : auditJson(rows, query, exportSnapshot, truncated), format === "csv" ? "text/csv;charset=utf-8" : "application/json");
      toast.push({ title: truncated ? "Partial audit export downloaded" : "Audit export downloaded", description: rows.length + " events" + (truncated ? "; narrow the dates to export more than 10,000 events" : ""), tone: "info" });
    } catch (err) {
      if (current === exportGeneration.current) toast.push({ title: "Audit export failed", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally { exportLock.current = false; setExportBusy(false); }
  };

  const actions = [...new Set([...Object.keys(ACTION_LABELS), ...events.map((event) => event.action)])].sort();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-slate-50">Audit log</h1><p className="mt-1 text-sm text-slate-400">Browse and export security and project events for your account. Date filters use UTC.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={loading} onClick={() => setReload((value) => value + 1)}>Refresh</Button>
          <Button variant="secondary" disabled={loading || exportBusy || range.invalid || snapshotId === undefined} onClick={() => void exportEvents("csv")}>Export CSV</Button>
          <Button variant="secondary" disabled={loading || exportBusy || range.invalid || snapshotId === undefined} onClick={() => void exportEvents("json")}>Export JSON</Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Event action" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All events</option>{actions.map((action) => <option key={action} value={action}>{ACTION_LABELS[action] ?? action}</option>)}</Select>
        <Input label="From date (UTC)" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        <Input label="To date (UTC)" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
      </div>
      {exportBusy && <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-slate-300"><p>Preparing export: {exportCount.toLocaleString()} events (maximum {MAX_AUDIT_EXPORT_EVENTS.toLocaleString()}).</p><Button size="sm" variant="ghost" onClick={() => { ++exportGeneration.current; }}>Cancel export</Button></Card>}
      {error && <Card className="p-4 text-sm text-rose-300">{error}</Card>}
      {loading ? <div className="flex h-40 items-center justify-center"><Spinner className="h-6 w-6 text-emerald-400" /></div> : <Card className="overflow-hidden">
        {events.length === 0 ? <p className="px-6 py-12 text-center text-sm text-slate-500">No events match these filters.</p> : <div className="divide-y divide-slate-800/70">{events.map((event) => <div key={event.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
          <div className="min-w-40 flex-1"><Badge tone={actionTone(event.action)}>{ACTION_LABELS[event.action] ?? event.action}</Badge><p className="mt-1 break-words text-xs text-slate-500">{parseDetail(event.detail)}</p></div>
          <div className="text-right"><p className="text-xs text-slate-300" title={formatDate(event.created_at)}>{timeAgo(event.created_at)}</p>{event.ip && <p className="mt-0.5 text-xs text-slate-500">IP {event.ip}</p>}{event.user_agent && <p className="mt-0.5 hidden max-w-[220px] truncate text-xs text-slate-600 sm:block" title={event.user_agent}>{event.user_agent}</p>}</div>
        </div>)}</div>}
      </Card>}
      {!loading && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">{events.length} events loaded. Refresh includes newly recorded events. Exports stop at 10,000 events.</p>{nextBeforeId !== null && <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>Load older events</Button>}</div>}
    </div>
  );
}
