import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { Badge, Button, Card } from "./ui";
import { useOfflineSync } from "../lib/offlineSyncManager";
import { offlineQueueStore, type OfflineQueueItem, type OfflineQueueStatus } from "../lib/offlineQueue";
import { offlineProjectStore, type StorageQuotaInfo } from "../lib/offlineProjectStore";

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
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OfflineQueueItem[]>([]);
  const [filter, setFilter] = useState<OfflineQueueStatus | "all">("all");
  const [storage, setStorage] = useState<StorageQuotaInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const q = await offlineQueueStore.listQueue(user.id);
      setItems(q);
      const s = await offlineProjectStore.getStorageUsage(user.id);
      setStorage(s);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void refreshData();
    }
  }, [open, sync.isSyncing, user?.id]);

  if (!user) return null;

  const filteredItems = items.filter((item) => (filter === "all" ? true : item.status === filter));

  return (
    <>
      {/* Indicator Pill in UI */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-700 hover:bg-slate-800/80"
        title="Groundwork Offline & Sync Hub"
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
            ? "Offline Mode"
            : sync.conflictedCount > 0
              ? `${sync.conflictedCount} conflict`
              : sync.pendingCount > 0
                ? `${sync.pendingCount} queued`
                : "Sync Ready"}
        </span>
      </button>

      {/* Modal / Slide-over */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">Offline PWA & Synchronization Hub</h2>
                <p className="text-xs text-slate-400">
                  Account-scoped caching, immutable queues, conflict resolution, and bounded offline storage.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            {/* Storage & Network Status Card */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Card className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">Network State</span>
                  <Badge tone={sync.isOnline ? "emerald" : "amber"}>
                    {sync.isOnline ? "Online (Connected)" : "Offline (PWA Shell Active)"}
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
                  <span className="text-xs font-medium text-slate-400">Account Storage Quota</span>
                  <span className="text-xs font-bold text-slate-200">
                    {storage ? `${Math.round(storage.totalBytes / 1024)} KB / 50 MB` : "—"}
                  </span>
                </div>
                {storage && (
                  <div className="mt-2">
                    <div className="h-1.5 w-full rounded-full bg-slate-800">
                      <div
                        className="h-1.5 rounded-full bg-emerald-400 transition-all"
                        style={{ width: `${Math.max(2, storage.usagePercent)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                      <span>{storage.projectCount} cached projects</span>
                      <span>LRU eviction safe</span>
                    </div>
                  </div>
                )}
              </Card>
            </div>

            {/* Actions Bar */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1.5">
                {(["all", "queued", "conflicted", "failed", "completed"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilter(s)}
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
                  onClick={() => {
                    void offlineQueueStore.clearCompleted(user.id).then(refreshData);
                  }}
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
                            onClick={() => {
                              void offlineQueueStore.discardItem(item.id).then(refreshData);
                            }}
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
          </div>
        </div>
      )}
    </>
  );
}
