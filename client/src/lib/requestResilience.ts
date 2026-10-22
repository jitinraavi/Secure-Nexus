/** Finite requests share a deadline across headers and the complete body. SSE
 * EventSource subscriptions deliberately do not use this finite-request helper. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 150_000;
export class RequestTimeoutError extends Error { constructor() { super("Request timed out. Check your connection and retry."); this.name = "RequestTimeoutError"; } }
export async function withRequestTimeout<T>(work: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal | null, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason ?? new DOMException("Request cancelled", "AbortError"));
  if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new RequestTimeoutError()), timeoutMs);
  let rejectAbort: (() => void) | undefined;
  try {
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(controller.signal.reason); if (controller.signal.aborted) rejectAbort(); else controller.signal.addEventListener("abort", rejectAbort, { once: true }); });
    return await Promise.race([Promise.resolve().then(() => { if (controller.signal.aborted) throw controller.signal.reason; return work(controller.signal); }), aborted]);
  } finally { clearTimeout(timer); parent?.removeEventListener("abort", abort); if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort); }
}
export async function readResponseJson<T>(response: Response, signal: AbortSignal): Promise<T> {
  const reader = response.body?.getReader();
  if (!reader) return JSON.parse("") as T;
  const decoder = new TextDecoder();
  let text = "";
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason;
      const part = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (part.done) break;
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as T;
  } catch (error) { void reader.cancel(error).catch(() => undefined); throw error; }
  finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
export async function fetchJsonResponse<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<{ response: Response; data: T }> {
  return withRequestTimeout(async signal => {
    const response = await fetch(input, { ...init, signal });
    try { return { response, data: await readResponseJson<T>(response, signal) }; }
    catch (error) { if (response.ok || signal.aborted) throw error; return { response, data: {} as T }; }
  }, init.signal);
}
export function retryAfterDelay(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const delay = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, Math.ceil(delay)) : undefined;
}
export function syncRetryDelay(failures: number, retryAfterMs = 0, random = Math.random): number {
  if (retryAfterMs > 300_000) return Number.POSITIVE_INFINITY;
  const ceiling = Math.min(60_000, 1_000 * 2 ** Math.min(Math.max(0, failures - 1), 10));
  // A nonzero floor avoids immediate repeated failures when jitter chooses zero.
  return Math.max(250 + Math.floor(Math.max(0, Math.min(1, random())) * ceiling), Math.max(0, retryAfterMs));
}
export function isTransientStatus(status: number): boolean { return status === 408 || status === 429 || [500, 502, 503, 504].includes(status); }
