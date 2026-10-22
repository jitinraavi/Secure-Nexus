import { isIP } from "node:net";
import { CircuitBreaker, CircuitOpenError, type CircuitStore } from "./runtimeResilience.js";
import { operationalTraceHeaders, withOperationalSpan } from "./telemetry.js";

export class OutboundRequestError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string) { super(message); this.name = "OutboundRequestError"; }
}
function setting(name: string, fallback: number, maximum: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  return number;
}
export function outboundSettings() {
  return { timeoutMs: setting("OUTBOUND_TIMEOUT_MS", 15_000, 240_000), maxAttempts: setting("OUTBOUND_MAX_ATTEMPTS", 3, 4),
    retryBaseMs: setting("OUTBOUND_RETRY_BASE_MS", 200, 5_000), retryMaxMs: setting("OUTBOUND_RETRY_MAX_MS", 5_000, 30_000),
    failureThreshold: setting("OUTBOUND_CIRCUIT_FAILURE_THRESHOLD", 5, 100), cooldownMs: setting("OUTBOUND_CIRCUIT_COOLDOWN_MS", 30_000, 300_000), probeLeaseMs: 310_000 };
}
let sharedStore: Promise<CircuitStore> | undefined;
const databaseStore = () => sharedStore ??= import("./outboundCircuitStore.js").then(module => new module.DatabaseCircuitStore());
let circuitStore: CircuitStore = {
  update: async (key, work) => (await databaseStore()).update(key, work),
  remove: async key => (await databaseStore()).remove(key),
};
/** Install shared storage during server startup, before accepting provider work. */
export function setOutboundCircuitStore(store: CircuitStore): void { circuitStore = store; }
export function outboundCircuit(): CircuitBreaker { return new CircuitBreaker(circuitStore, outboundSettings()); }

export interface DestinationPolicy { allowedOrigins?: readonly string[]; allowedHosts?: readonly string[] }
/** Destinations are operator configuration or explicit allowlists, never request URLs.
 * Exact origins include the port; host allowlists only permit the standard TLS port.
 * Redirects are always rejected so credentials cannot cross a destination boundary. */
export function approvedOutboundUrl(input: string | URL, policy: DestinationPolicy): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new OutboundRequestError(503, "Invalid outbound destination", "OUTBOUND_DESTINATION_BLOCKED"); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const literal = host.replace(/^\[|\]$/g, "");
  const denied = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".") || isIP(literal) !== 0;
  const approved = policy.allowedOrigins?.includes(url.origin) || ((!url.port || url.port === "443") && policy.allowedHosts?.map(value => value.toLowerCase()).includes(host));
  if (url.protocol !== "https:" || url.username || url.password || url.hash || denied || !approved) throw new OutboundRequestError(503, "Outbound destination requires an approved public HTTPS origin", "OUTBOUND_DESTINATION_BLOCKED");
  return url;
}
export function configuredDestination(endpoint: string, allowlist?: string): DestinationPolicy {
  return allowlist?.trim() ? { allowedHosts: allowlist.split(",").map(host => host.trim()).filter(Boolean) } : { allowedOrigins: [new URL(endpoint).origin] };
}
export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Math.ceil(Number(value) * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}
export function retryDelayMs(attempt: number, baseMs: number, maximumMs: number, random = Math.random): number {
  return Math.floor(Math.max(0, Math.min(1, random())) * Math.min(maximumMs, baseMs * 2 ** Math.min(attempt - 1, 20)));
}
function cancelled(signal: AbortSignal): never { throw signal.reason ?? new DOMException("Request cancelled", "AbortError"); }
export async function abortableWait(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) cancelled(signal);
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delayMs);
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** A single timer covers connection, all attempts, waits, and complete body reads. */
export async function withOutboundDeadline<T>(timeoutMs: number, work: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal | null): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason ?? new DOMException("Request cancelled", "AbortError"));
  if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new OutboundRequestError(504, "Provider request timed out", "PROVIDER_TIMEOUT")), timeoutMs);
  let rejectAbort: (() => void) | undefined;
  try {
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(controller.signal.reason); if (controller.signal.aborted) rejectAbort(); else controller.signal.addEventListener("abort", rejectAbort, { once: true }); });
    return await Promise.race([Promise.resolve().then(() => { if (controller.signal.aborted) cancelled(controller.signal); return work(controller.signal); }), aborted]);
  } finally { clearTimeout(timer); parent?.removeEventListener("abort", abort); if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort); }
}
export async function readOutboundBody(response: Response, maximumBytes: number, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get("content-length")) > maximumBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new OutboundRequestError(502, "Provider response exceeded the byte limit", "PROVIDER_RESPONSE_SIZE");
  }
  if (!response.body) return "";
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) cancelled(signal);
      const part = await reader.read();
      if (signal.aborted) cancelled(signal);
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maximumBytes) throw new OutboundRequestError(502, "Provider response exceeded the byte limit", "PROVIDER_RESPONSE_SIZE");
      chunks.push(part.value);
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } catch (error) { void reader.cancel(error).catch(() => undefined); throw error; }
  finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
export interface OutboundOptions extends DestinationPolicy {
  service: string;
  timeoutMs?: number;
  maximumBytes?: number;
  errorMaximumBytes?: number;
  /** Explicit contract for replayable read-only POSTs. Never set for payment creation or metered generation. */
  safeToRetry?: boolean;
  maxAttempts?: number;
  breaker?: CircuitBreaker;
  fetch?: typeof fetch;
  random?: () => number;
  wait?: typeof abortableWait;
}
export interface OutboundResponse { ok: boolean; status: number; headers: Headers; text: string }
const transient = (status: number) => status === 408 || status === 429 || [500, 502, 503, 504].includes(status);
export async function outboundRequest(endpoint: string | URL, init: RequestInit, options: OutboundOptions): Promise<OutboundResponse> {
  return withOperationalSpan("outbound.request", () => performOutboundRequest(endpoint, init, options));
}
async function performOutboundRequest(endpoint: string | URL, init: RequestInit, options: OutboundOptions): Promise<OutboundResponse> {
  const url = approvedOutboundUrl(endpoint, options), settings = outboundSettings();
  const timeoutMs = options.timeoutMs ?? settings.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error("Invalid outbound request deadline");
  const method = (init.method ?? "GET").toUpperCase();
  const replayable = init.body == null || typeof init.body === "string" || init.body instanceof URLSearchParams;
  const retry = replayable && (options.safeToRetry ?? ["GET", "HEAD", "OPTIONS"].includes(method));
  const maximumAttempts = options.maxAttempts ?? settings.maxAttempts;
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 4) throw new Error("Invalid outbound retry limit");
  const attempts = retry ? maximumAttempts : 1;
  const breaker = options.breaker ?? outboundCircuit();
  const permit = await breaker.acquire(`${options.service}:${url.origin}`);
  let outcome: "success" | "failure" | "cancelled" = "failure";
  try {
    const result = await withOutboundDeadline(timeoutMs, async signal => {
      const started = Date.now();
      for (let attempt = 1; ; attempt += 1) {
        let response: Response | undefined;
        try {
          const headers = new Headers(init.headers);
          for (const [name, value] of Object.entries(operationalTraceHeaders())) headers.set(name, value);
          response = await (options.fetch ?? fetch)(url, { ...init, headers, redirect: "manual", signal });
          if (response.status >= 300 && response.status < 400) {
            void response.body?.cancel().catch(() => undefined);
            throw new OutboundRequestError(502, "Provider redirects are not permitted", "OUTBOUND_REDIRECT_BLOCKED");
          }
          const text = await readOutboundBody(response, response.ok ? options.maximumBytes ?? 256_000 : options.errorMaximumBytes ?? 16_384, signal);
          const result = { ok: response.ok, status: response.status, headers: response.headers, text };
          if (!transient(response.status) || attempt >= attempts) return result;
          const serverDelay = retryAfterMs(response.headers.get("retry-after"));
          const delay = Math.max(serverDelay ?? 0, retryDelayMs(attempt, settings.retryBaseMs, settings.retryMaxMs, options.random));
          if (delay > settings.retryMaxMs || Date.now() - started + delay >= timeoutMs) return result;
          await (options.wait ?? abortableWait)(delay, signal);
        } catch (error) {
          if (signal.aborted) cancelled(signal);
          if (error instanceof OutboundRequestError || error instanceof CircuitOpenError || attempt >= attempts || response) throw error;
          await (options.wait ?? abortableWait)(retryDelayMs(attempt, settings.retryBaseMs, settings.retryMaxMs, options.random), signal);
        }
      }
    }, init.signal);
    outcome = transient(result.status) ? "failure" : "success";
    return result;
  } catch (error) {
    const reason = init.signal?.reason as { code?: string; name?: string } | undefined;
    if (init.signal?.aborted && reason?.code !== "PROVIDER_TIMEOUT" && reason?.name !== "TimeoutError") outcome = "cancelled";
    throw error;
  }
  finally { await breaker.complete(permit, outcome); }
}
