import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { Badge, Button, Card, Modal } from "./ui";
import { useOfflineSync } from "../lib/offlineSyncManager";
import { offlineQueueStore, type OfflineQueueItem, type OfflineQueueStatus } from "../lib/offlineQueue";
import { offlineProjectStore, type StorageQuotaInfo } from "../lib/offlineProjectStore";
import { refreshOfflineShellStatus, useOfflineShellStatus } from "../lib/pwa";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function OfflineSyncIndicator() {
  const { user } = useAuth();
  const sync = useOfflineSync(user?.id);
  const shell = useOfflineShellStatus();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OfflineQueueItem[]>([]);
  const [filter, setFilter] = useState<OfflineQueueStatus | "all">("all");
  const [storage, setStorage] = useState<StorageQuotaInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const queueBusyRef = useRef(false);
  const mounted = useRef(false);
  const account = useRef(user?.id);
  account.current = user?.id;
  const generation = useRef(0);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    generation.current += 1;
    setItems([]); setStorage(null); setLoading(false); setDataError(null); setOpen(false); setFilter("all");
    setQueueBusy(false); queueBusyRef.current = false;
    return () => { generation.current += 1; };
  }, [user?.id]);

  const refreshData = async () => {
    const accountId = user?.id;
    if (!accountId) return;
    const requestGeneration = ++generation.current;
    setLoading(true);
    setDataError(null);
    try {
      const q = await offlineQueueStore.listQueue(accountId);
      if (requestGeneration !== generation.current || account.current !== accountId) return;
      const s = await offlineProjectStore.getStorageUsage(accountId);
      if (requestGeneration !== generation.current || account.current !== accountId) return;
      setItems(q); setStorage(s);
    } catch {
      if (requestGeneration === generation.current && account.current === accountId) setDataError("Offline queue or account storage could not be read");
    } finally {
      if (requestGeneration === generation.current && account.current === accountId) setLoading(false);
    }
  };

  const updateQueue = async (action: "clear" | "discard", itemId?: string) => {
    const accountId = user?.id;
    if (!accountId || queueBusyRef.current) return;
    queueBusyRef.current = true; setQueueBusy(true);
    const isCurrent = () => mounted.current && account.current === accountId;
    try {
      if (action === "clear") await offlineQueueStore.clearCompleted(accountId);
      else if (itemId) await offlineQueueStore.discardItem(itemId);
      if (isCurrent()) await refreshData();
    } catch (cause) {
      if (isCurrent()) setDataError(cause instanceof Error ? cause.message : "Couldn't update the offline queue. Try again.");
    } finally {
      if (isCurrent()) { queueBusyRef.current = false; setQueueBusy(false); }
    }
  };

  useEffect(() => {
    if (open) {
      void refreshData();
      void refreshOfflineShellStatus();
    }
  }, [open, sync.isSyncing, user?.id]);

  if (!user) return null;

  const filteredItems = items.filter((item) => (filter === "all" ? true : item.status === filter));

  return (
    <>
      {/* Indicator Pill in UI */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-700 hover:bg-slate-800/80"
        title="Offline & sync"
        aria-haspopup="dialog"
      >
        <span
          className={`h-2 w-2 rounded-full ${
            !sync.isOnline
              ? "bg-amber-400"
              : sync.conflictedCount > 0
                ? "bg-rose-400 animate-pulse"
                : sync.pendingCount > 0
                  ? "bg-cyan-400 animate-pulse"
                  : "bg-emerald-400"
          }`}
        />
        <span className="font-medium">
          {!sync.isOnline
            ? "Offline"
            : sync.conflictedCount > 0
              ? `${sync.conflictedCount} conflict`
              : sync.pendingCount > 0
                ? `${sync.pendingCount} queued`
                : "Sync Ready"}
        </span>
      </button>

      {/* Modal / Slide-over */}
      <Modal open={open} onClose={() => setOpen(false)} title="Offline & sync" wide>
            <p className="text-xs leading-relaxed text-slate-400">Review your connection, retained project drafts, and queued changes.</p>

            {/* Storage & Network Status Card */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Card className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">Network State</span>
                  <Badge tone={sync.isOnline ? "emerald" : "amber"}>
                    {sync.isOnline ? "Browser online" : "Browser offline"}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-slate-400">Sync Status</span>
                  <span className="text-xs font-medium text-slate-300">
                    {sync.isSyncing
                      ? "Synchronizing in progress..."
                      : sync.lastSyncTime
                        ? `Last synced ${new Date(sync.lastSyncTime).toLocaleTimeString()}`
                        : "Ready"}
                  </span>
                </div>
              </Card>

              <Card className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">Retained Account Storage</span>
                  <span className="text-xs font-bold text-slate-200">
                    {storage ? `${Math.round(storage.totalBytes / 1024)} KB estimated` : "—"}
                  </span>
                </div>
                {storage && (
                  <div className="mt-2">
                    <div className="h-1.5 w-full rounded-full bg-slate-800" role="progressbar" aria-label="Estimated browser storage usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, Math.max(0, storage.usagePercent)))}>
                      <div
                        className="h-1.5 rounded-full bg-emerald-400 transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, storage.usagePercent))}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                      <span>{storage.projectCount} cached projects</span>
                      <span>Browser storage estimates</span>
                    </div>
                  </div>
                )}
              </Card>
            </div>

            <Card className="mt-3 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-400">Application Shell</span>
                <Badge tone={shell.phase === "ready" ? "emerald" : shell.phase === "failed" ? "rose" : "amber"}>
                  {shell.phase === "ready" ? "Verified cache ready" : shell.phase === "prepared" ? "Prepared; reopen app" : shell.phase === "installing" ? "Preparing" : shell.phase === "failed" ? "Readiness unverified" : "Unavailable"}
                </Badge>
              </div>
              {shell.message && <p className="mt-2 text-xs text-slate-400">{shell.message}</p>}
              {shell.phase === "ready" && <p className="mt-2 text-xs text-slate-400">{shell.files} public files · {(shell.bytes / (1024 * 1024)).toFixed(1)} MiB. Project access and saved data are checked separately.</p>}
              {shell.updateWaiting && <p className="mt-2 text-xs text-amber-300">An update is waiting. Save your work, close all Groundwork tabs, then reopen the app. Current editor tabs keep their existing version.</p>}
              {dataError && <p role="alert" className="mt-2 text-xs text-rose-300">{dataError}</p>}
            </Card>

            {/* Actions Bar */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter queued changes by status">
                {(["all", "queued", "conflicted", "failed", "completed"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFilter(s)}
                    aria-pressed={filter === s}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition ${
                      filter === s
                        ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                        : "text-slate-400 hover:bg-slate-800 hover:text-slate-300"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={queueBusy}
                  onClick={() => void updateQueue("clear")}
                >
                  Clear History
                </Button>
                <Button
                  size="sm"
                  loading={sync.isSyncing}
                  disabled={!sync.isOnline || sync.pendingCount === 0}
                  onClick={() => {
                    sync.syncNow();
                    void refreshData();
                  }}
                >
                  Sync Now
                </Button>
              </div>
            </div>

            {/* Queue Items List */}
            <div className="mt-3 flex-1 overflow-y-auto space-y-2 pr-1">
              {filteredItems.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  {loading ? "Loading queue items..." : "No items in this queue category."}
                </div>
              ) : (
                filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-2 rounded-xl border border-slate-800/80 bg-slate-950/40 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-slate-300 capitalize">
                          {item.type.replace(/_/g, " ")}
                        </span>
                        <span className="text-[10px] text-slate-500">Project: {item.projectId.slice(0, 8)}...</span>
                      </div>
                      <Badge
                        tone={
                          item.status === "completed"
                            ? "emerald"
                            : item.status === "conflicted"
                              ? "rose"
                              : item.status === "failed"
                                ? "rose"
                                : item.status === "superseded"
                                  ? "slate"
                                  : "amber"
                        }
                      >
                        {item.status}
                      </Badge>
                    </div>

                    {item.conflictDetails && (
                      <div className="rounded-lg border border-rose-900/50 bg-rose-950/20 p-2 text-rose-300">
                        <p className="font-semibold">{item.conflictDetails.reason}</p>
                        <p className="text-[11px] text-rose-400 mt-0.5">
                          Server at revision {item.conflictDetails.serverRevision}, local draft at{" "}
                          {item.conflictDetails.localRevision}.
                        </p>
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => downloadJson(`offline-conflict-${item.projectId}.json`, item.payload)}
                          >
                            Export Local Draft
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={queueBusy}
                            onClick={() => void updateQueue("discard", item.id)}
                          >
                            Dismiss Conflict
                          </Button>
                        </div>
                      </div>
                    )}

                    {item.errorMessage && !item.conflictDetails && (
                      <p className="text-rose-400">{item.errorMessage}</p>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>Created {new Date(item.createdAt).toLocaleString()}</span>
                      {item.status === "superseded" && <span>Superseded by newer offline save</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
      </Modal>
    </>
  );
}
