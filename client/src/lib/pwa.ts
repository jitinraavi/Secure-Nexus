import { useSyncExternalStore } from "react";
import { offlineShellRegistration } from "./offlineShellPolicy";

export interface OfflineShellStatus {
  phase: "unavailable" | "available" | "installing" | "prepared" | "ready" | "failed";
  updateWaiting: boolean;
  version: string | null;
  files: number;
  bytes: number;
  message: string | null;
}
let status: OfflineShellStatus = { phase: "unavailable", updateWaiting: false, version: null, files: 0, bytes: 0, message: "Offline shell has not been checked" };
const listeners = new Set<() => void>();
const watched = new WeakSet<ServiceWorker>();
const registrations = new WeakSet<ServiceWorkerRegistration>();
let started = false, generation = 0;
let preparing: Promise<void> | null = null;
function publish(next: OfflineShellStatus): void { status = next; for (const listener of listeners) listener(); }
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useOfflineShellStatus(): OfflineShellStatus { return useSyncExternalStore(subscribe, () => status, () => status); }

function queryWorker(worker: ServiceWorker): Promise<{ ready: boolean; version: string | null; files: number; bytes: number; error: string | null }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const close = () => { channel.port1.close(); channel.port2.close(); };
    const timer = setTimeout(() => { close(); reject(new Error("Active worker did not verify its complete shell")); }, 5000);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      clearTimeout(timer); close();
      const data = event.data;
      if (!data || typeof data !== "object") { reject(new Error("Invalid shell status")); return; }
      const value = data as Record<string, unknown>;
      if (value.type !== "GROUNDWORK_SHELL_STATUS" || typeof value.ready !== "boolean" || (value.version !== null && (typeof value.version !== "string" || !/^[a-f0-9]{64}$/.test(value.version))) || typeof value.files !== "number" || !Number.isSafeInteger(value.files) || value.files < 0 || value.files > 256 || typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > 96 * 1024 * 1024 || (value.error !== null && (typeof value.error !== "string" || value.error.length > 300))) { reject(new Error("Invalid shell status")); return; }
      resolve({ ready: value.ready, version: value.version as string | null, files: value.files, bytes: value.bytes, error: value.error as string | null });
    };
    try { worker.postMessage({ type: "GROUNDWORK_SHELL_STATUS" }, [channel.port2]); }
    catch (error) { clearTimeout(timer); close(); reject(error); }
  });
}
function watch(worker: ServiceWorker | null): void {
  if (!worker || watched.has(worker)) return;
  watched.add(worker);
  worker.addEventListener("statechange", () => { void refreshOfflineShellStatus(); });
}
function watchRegistration(registration: ServiceWorkerRegistration): void {
  if (!registrations.has(registration)) {
    registrations.add(registration);
    registration.addEventListener("updatefound", () => { watch(registration.installing); void refreshOfflineShellStatus(); });
  }
  watch(registration.installing); watch(registration.waiting); watch(registration.active);
}
export async function refreshOfflineShellStatus(): Promise<void> {
  if (!import.meta.env.PROD || typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) return;
  const requestGeneration = ++generation;
  let waiting = false;
  try {
    const registration = await offlineShellRegistration(navigator.serviceWorker, "inspect");
    if (requestGeneration !== generation) return;
    if (!registration) { publish({ phase: "available", updateWaiting: false, version: null, files: 0, bytes: 0, message: "Offline files have not been prepared. Prepare them when you want this app available without a connection." }); return; }
    waiting = Boolean(registration.waiting);
    watchRegistration(registration);
    const controller = navigator.serviceWorker.controller;
    const worker = controller || registration.active || registration.waiting;
    if (!worker || new URL(worker.scriptURL).origin !== window.location.origin || new URL(worker.scriptURL).pathname !== "/sw.js") { publish({ ...status, phase: registration.installing ? "installing" : "unavailable", updateWaiting: waiting, message: "The built offline shell is not active" }); return; }
    const reply = await queryWorker(worker);
    if (requestGeneration !== generation) return;
    const installing = Boolean(registration.installing);
    publish({ phase: installing ? "installing" : reply.ready ? controller ? "ready" : "prepared" : "failed", updateWaiting: waiting, version: reply.version, files: reply.files, bytes: reply.bytes, message: installing ? "Downloading and verifying offline files. Current editor tabs keep their existing version." : reply.ready ? controller ? null : "Offline files prepared; save your work and reopen the app when convenient." : reply.error });
  } catch {
    if (requestGeneration === generation) publish({ ...status, phase: "failed", updateWaiting: waiting, message: "Complete offline shell readiness could not be verified" });
  }
}
export function registerServiceWorker(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  if (!import.meta.env.PROD || !("serviceWorker" in navigator) || !window.isSecureContext) {
    publish({ ...status, phase: "unavailable", message: import.meta.env.PROD ? "Offline shell requires a supported secure browser context" : "Offline shell is disabled for development source" }); return;
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => { void refreshOfflineShellStatus(); });
  window.addEventListener("online", () => { void refreshOfflineShellStatus(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void refreshOfflineShellStatus(); });
  // Inspect only: opening sign-in or a workspace must not start a whole-build download.
  void refreshOfflineShellStatus();
}

/** Called by the user's Prepare/Retry action; never forces worker activation or reload. */
export function prepareOfflineShell(): Promise<void> {
  if (preparing) return preparing;
  if (!import.meta.env.PROD || typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) return Promise.resolve();
  if (!navigator.onLine) {
    publish({ ...status, phase: "failed", message: "Connect to the internet before preparing offline files. Existing retained drafts are unchanged." });
    return Promise.resolve();
  }
  publish({ ...status, phase: "installing", message: "Downloading the complete public app shell for offline use. This can use several MiB of data and browser storage." });
  preparing = (async () => {
    try {
      const registration = await offlineShellRegistration(navigator.serviceWorker, "prepare");
      if (registration) watchRegistration(registration);
      await refreshOfflineShellStatus();
    } catch {
      // An update attempt can fail while the previously verified shell remains usable.
      await refreshOfflineShellStatus();
      if (status.phase !== "ready" && status.phase !== "prepared") publish({ ...status, phase: "failed", message: "Offline preparation failed. Your project data was not removed; connect and retry when convenient." });
    }
  })().finally(() => { preparing = null; });
  return preparing;
}
