import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedOutboundUrl, outboundRequest, retryAfterMs, retryDelayMs, type OutboundOptions } from "../src/outbound.js";
import { CircuitBreaker, CircuitOpenError, MemoryCircuitStore } from "../src/runtimeResilience.js";

const endpoint = "https://provider.example/v1";
function options(extra: Partial<OutboundOptions> = {}): OutboundOptions {
  return { service: "test", allowedOrigins: ["https://provider.example"], timeoutMs: 300,
    breaker: new CircuitBreaker(new MemoryCircuitStore(), { failureThreshold: 3, cooldownMs: 100, probeLeaseMs: 100 }), ...extra };
}
const hasCode = (code: string) => (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === code);

test("outbound destinations require exact approved public HTTPS and reject redirects before forwarding credentials", async () => {
  for (const url of ["http://provider.example/v1", "https://other.example/v1", "https://name:secret@provider.example/v1", "https://provider.example/v1#fragment", "https://provider.example:8443/v1", "https://127.0.0.1/v1", "https://[::1]/v1", "https://localhost/v1", "https://metadata.internal/v1"]) {
    assert.throws(() => approvedOutboundUrl(url, { allowedOrigins: ["https://provider.example"] }), hasCode("OUTBOUND_DESTINATION_BLOCKED"));
  }
  assert.equal(approvedOutboundUrl(endpoint, { allowedHosts: ["provider.example"] }).href, endpoint);
  let calls = 0, cancelled = false;
  await assert.rejects(outboundRequest(endpoint, { headers: { authorization: "Bearer isolated" } }, options({ fetch: (async (_url, init) => {
    calls += 1; assert.equal(init?.redirect, "manual");
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 302, headers: { location: "https://other.example/secret" } });
  }) as typeof fetch })), hasCode("OUTBOUND_REDIRECT_BLOCKED"));
  assert.equal(calls, 1); assert.equal(cancelled, true);
});

test("safe requests cap retries, jitter delays, and honor Retry-After without replaying payment POSTs", async () => {
  let calls = 0; const waits: number[] = [];
  const config = options({ timeoutMs: 3000, maxAttempts: 3, random: () => 0.5, wait: async delay => { waits.push(delay); }, fetch: (async () => {
    calls += 1;
    return calls < 3 ? new Response("busy", { status: 503, headers: { "retry-after": "1" } }) : Response.json({ ok: true });
  }) as typeof fetch });
  assert.equal((await outboundRequest(endpoint, {}, config)).status, 200);
  assert.equal(calls, 3); assert.deepEqual(waits, [1000, 1000]);
  calls = 0; waits.length = 0;
  await outboundRequest(endpoint, { method: "POST", body: "{}", headers: { "Idempotency-Key": "not-a-durable-contract" } }, config);
  assert.equal(calls, 1); assert.deepEqual(waits, []);
  calls = 0;
  await outboundRequest(endpoint, {}, options({ fetch: (async () => { calls += 1; return new Response("busy", { status: 429, headers: { "retry-after": "3600" } }); }) as typeof fetch }));
  assert.equal(calls, 1, "a long server recovery interval must not be shortened to the retry cap");
  calls = 0;
  await assert.rejects(outboundRequest(endpoint, {}, options({ maxAttempts: 2, wait: async () => undefined, fetch: (async () => { calls += 1; throw new TypeError("connection interrupted"); }) as typeof fetch })), /connection interrupted/);
  assert.equal(calls, 2);
  assert.equal(retryAfterMs("Wed, 21 Oct 2026 12:00:01 GMT", Date.parse("Wed, 21 Oct 2026 12:00:00 GMT")), 1000);
  assert.equal(retryAfterMs("invalid"), null);
  assert.equal(retryDelayMs(40, 200, 5000, () => 1), 5000);
});

test("one deadline covers ignored connection cancellation, a stalled body, and byte limits", async () => {
  let signal: AbortSignal | null | undefined;
  await assert.rejects(outboundRequest(endpoint, {}, options({ timeoutMs: 15, fetch: (async (_url, init) => { signal = init?.signal; return new Promise<Response>(() => undefined); }) as typeof fetch })), hasCode("PROVIDER_TIMEOUT"));
  assert.equal(signal?.aborted, true);
  let cancelled = false;
  await assert.rejects(outboundRequest(endpoint, {}, options({ timeoutMs: 15, fetch: (async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } }))) as typeof fetch })), hasCode("PROVIDER_TIMEOUT"));
  assert.equal(cancelled, true);
  cancelled = false;
  await assert.rejects(outboundRequest(endpoint, {}, options({ maximumBytes: 100, fetch: (async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(80)); }, cancel() { cancelled = true; } }))) as typeof fetch })), hasCode("PROVIDER_RESPONSE_SIZE"));
  assert.equal(cancelled, true);
});

test("caller cancellation interrupts retry waits and never counts as provider failure", async () => {
  const parent = new AbortController(); let calls = 0;
  const store = new MemoryCircuitStore(), breaker = new CircuitBreaker(store, { failureThreshold: 1, cooldownMs: 100, probeLeaseMs: 100 });
  await assert.rejects(outboundRequest(endpoint, { signal: parent.signal }, options({ breaker, wait: async (_delay, signal) => { parent.abort(new Error("caller cancelled")); signal.throwIfAborted(); }, fetch: (async () => { calls += 1; return new Response("busy", { status: 503 }); }) as typeof fetch })), /caller cancelled/);
  assert.equal(calls, 1);
  await breaker.acquire("test:https://provider.example");
  const already = new AbortController(); already.abort(new Error("already cancelled"));
  await assert.rejects(outboundRequest(endpoint, { signal: already.signal }, options({ fetch: (async () => { throw new Error("must never dispatch"); }) as typeof fetch })), /already cancelled/);
});

test("shared circuit opens, admits one recovery probe, fences stale completions, and resets", async () => {
  let now = 1000;
  const store = new MemoryCircuitStore(2, 1000, () => now);
  const first = new CircuitBreaker(store, { failureThreshold: 2, cooldownMs: 100, probeLeaseMs: 50 }, () => now);
  const second = new CircuitBreaker(store, { failureThreshold: 2, cooldownMs: 100, probeLeaseMs: 50 }, () => now);
  const stale = await first.acquire("service"), a = await first.acquire("service"), b = await second.acquire("service");
  await first.complete(a, "failure"); await second.complete(b, "failure");
  await assert.rejects(second.acquire("service"), CircuitOpenError);
  await first.complete(stale, "success");
  await assert.rejects(second.acquire("service"), CircuitOpenError);
  now += 101;
  const probe = await first.acquire("service"); assert.equal(probe.probe, true);
  await assert.rejects(second.acquire("service"), CircuitOpenError);
  await first.complete(probe, "success");
  const active = await second.acquire("service"); assert.equal(active.probe, false);
  await first.reset("service"); await second.complete(active, "failure");
  await second.acquire("service");
  await first.acquire("second");
  await assert.rejects(first.acquire("third"), /capacity/);
  now += 1001;
  await first.acquire("third"); assert.equal(store.size, 1);
});
