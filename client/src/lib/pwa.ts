import { useSyncExternalStore } from "react";

export interface OfflineShellStatus {
  phase: "unavailable" | "installing" | "prepared" | "ready" | "failed";
  updateWaiting: boolean;
  version: string | null;
  files: number;
  bytes: number;
  message: string | null;
}
let status: OfflineShellStatus = { phase: "unavailable", updateWaiting: false, version: null, files: 0, bytes: 0, message: "Offline shell has not been checked" };
const listeners = new Set<() => void>();
const watched = new WeakSet<ServiceWorker>();
let started = false, generation = 0;
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
export async function refreshOfflineShellStatus(): Promise<void> {
  if (!import.meta.env.PROD || typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) return;
  const requestGeneration = ++generation;
  let waiting = false;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (requestGeneration !== generation) return;
    if (!registration) { publish({ ...status, phase: "unavailable", updateWaiting: false, message: "No offline shell worker is registered" }); return; }
    waiting = Boolean(registration.waiting);
    watch(registration.installing); watch(registration.waiting); watch(registration.active);
    const controller = navigator.serviceWorker.controller;
    const worker = controller || registration.active;
    if (!worker || new URL(worker.scriptURL).origin !== window.location.origin || new URL(worker.scriptURL).pathname !== "/sw.js") { publish({ ...status, phase: registration.installing ? "installing" : "unavailable", updateWaiting: waiting, message: "The built offline shell is not active" }); return; }
    const reply = await queryWorker(worker);
    if (requestGeneration !== generation) return;
    publish({ phase: reply.ready ? controller ? "ready" : "prepared" : registration.installing ? "installing" : "failed", updateWaiting: waiting, version: reply.version, files: reply.files, bytes: reply.bytes, message: reply.ready ? controller ? null : "Shell prepared; reopen the app to control this page" : reply.error });
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
  const register = async () => {
    publish({ ...status, phase: "installing", message: "Checking the complete built shell" });
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      registration.addEventListener("updatefound", () => { watch(registration.installing); void refreshOfflineShellStatus(); });
      watch(registration.installing); watch(registration.waiting); watch(registration.active);
      await refreshOfflineShellStatus();
    } catch {
      // An offline update check can fail while a previously verified shell works.
      await refreshOfflineShellStatus();
      if (status.phase !== "ready" && status.phase !== "prepared") publish({ ...status, phase: "failed", message: "Offline shell registration or preparation failed" });
    }
  };
  if (document.readyState === "complete") void register();
  else window.addEventListener("load", () => { void register(); }, { once: true });
}
