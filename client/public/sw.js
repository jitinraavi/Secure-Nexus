/* Build-only immutable public shell. The unbuilt template never caches requests. */
const SHELL_BUILD = /*__GROUNDWORK_SHELL_INVENTORY__*/null;
const PREFIX = "groundwork-shell-v3-";
const LEGACY_CACHES = new Set(["groundwork-shell-v1", "groundwork-shell-v2"]);
const MAX_FILES = 256;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const origin = self.location.origin;
let failure = null;

function readInventory(value) {
  if (!value || value.schema !== 1 || !/^[a-f0-9]{64}$/.test(value.version) || !Array.isArray(value.assets) || value.assets.length < 2 || value.assets.length > MAX_FILES) throw new Error("A complete built shell inventory is required");
  const urls = new Set();
  let bytes = 0;
  for (const asset of value.assets) {
    if (!asset || typeof asset.url !== "string" || !/^\/[A-Za-z0-9_.\/-]+$/.test(asset.url) || /^\/api(?:\/|$)/i.test(asset.url) || asset.url === "/sw.js" || asset.url === "/offline-shell.json") throw new Error("Unsupported shell asset URL");
    const url = new URL(asset.url, origin);
    if (url.origin !== origin || url.pathname !== asset.url || url.search || url.hash || urls.has(asset.url)) throw new Error("Shell asset identities must be unique and same-origin");
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("Unsupported shell asset fingerprint");
    urls.add(asset.url); bytes += asset.bytes;
    if (bytes > MAX_TOTAL_BYTES) throw new Error("Shell byte budget exceeded");
  }
  if (!urls.has("/index.html") || !value.assets.some((asset) => asset.url.endsWith(".js")) || bytes !== value.totalBytes) throw new Error("Shell inventory is incomplete");
  return value;
}
let inventory = null;
try { inventory = readInventory(SHELL_BUILD); } catch { failure = "This deployment has no complete built offline shell"; }
const cacheName = inventory ? `${PREFIX}${inventory.version}` : null;
const assets = new Map(inventory ? inventory.assets.map((asset) => [asset.url, asset]) : []);
const markerUrl = inventory ? `${origin}/__groundwork_offline_shell__/${inventory.version}` : null;

function validCached(response, asset) {
  return Boolean(response && response.status === 200 && response.headers.get("x-groundwork-shell-sha256") === asset.sha256 && response.headers.get("content-length") === String(asset.bytes));
}
async function shellComplete(cache) {
  if (!inventory || !markerUrl) return false;
  const marker = await cache.match(markerUrl);
  if (!marker || marker.headers.get("x-groundwork-shell-version") !== inventory.version) return false;
  for (const asset of inventory.assets) {
    if (!validCached(await cache.match(`${origin}${asset.url}`), asset)) return false;
  }
  return true;
}
async function fetchAsset(asset, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, 30000);
  let reader;
  try {
    const url = `${origin}${asset.url}`;
    const response = await fetch(url, { credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal });
    if (response.status !== 200 || response.type !== "basic" || response.redirected || response.url !== url || !response.body) throw new Error("Shell asset response was not the exact public resource");
    reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > asset.bytes || length > MAX_FILE_BYTES) throw new Error("Shell asset exceeds its declared size");
      chunks.push(part.value);
    }
    if (length !== asset.bytes) throw new Error("Shell asset size does not match the build");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (controller.signal.aborted) throw new Error("Shell asset fetch deadline reached");
    if (digest !== asset.sha256) throw new Error("Shell asset fingerprint does not match the build");
    const headers = new Headers(response.headers);
    // Fetch has already decoded content encoding. Cache the exact build bytes.
    headers.delete("content-encoding"); headers.set("content-length", String(length));
    headers.set("x-groundwork-shell-sha256", asset.sha256);
    return new Response(bytes, { status: 200, headers });
  } catch (error) {
    controller.abort();
    if (reader) { try { await reader.cancel(); } catch { /* Already cancelled. */ } }
    throw error;
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", abort);
  }
}
async function installShell() {
  if (!inventory || !cacheName || !markerUrl) throw new Error("Build-generated shell inventory is unavailable");
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 120000);
  try {
    const cache = await caches.open(cacheName);
    await cache.delete(markerUrl);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(3, inventory.assets.length) }, async () => {
      try {
        for (;;) {
          const index = cursor++;
          if (index >= inventory.assets.length) return;
          if (controller.signal.aborted) throw new Error("Shell preparation cancelled");
          const asset = inventory.assets[index];
          const response = await fetchAsset(asset, controller.signal);
          if (controller.signal.aborted) throw new Error("Shell preparation cancelled");
          await cache.put(`${origin}${asset.url}`, response);
        }
      } catch (error) { controller.abort(); throw error; }
    });
    const results = await Promise.allSettled(workers);
    if (results.some((result) => result.status === "rejected") || controller.signal.aborted) throw new Error("Complete offline shell preparation failed");
    // No active worker references this new version until install completes. The
    // marker is committed last; a partial cache never reports offline readiness.
    await cache.put(markerUrl, new Response("complete", { headers: { "x-groundwork-shell-version": inventory.version } }));
    if (controller.signal.aborted) throw new Error("Shell preparation deadline reached");
    if (!(await shellComplete(cache))) throw new Error("Offline shell cache could not be retained completely");
    if (controller.signal.aborted) throw new Error("Shell preparation deadline reached");
    failure = null;
  } catch (error) {
    controller.abort();
    await caches.delete(cacheName);
    failure = "Offline shell preparation failed; public assets, connection or storage are unavailable";
    throw error;
  } finally { clearTimeout(deadline); }
}
self.addEventListener("install", (event) => {
  // No skipWaiting: active editor tabs retain their current immutable version.
  event.waitUntil(installShell());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    if (!cacheName || !(await shellComplete(await caches.open(cacheName)))) { failure = "Offline shell cache is incomplete"; return; }
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== cacheName && (name.startsWith(PREFIX) || LEGACY_CACHES.has(name))).map((name) => caches.delete(name)));
    // Natural activation happens after prior controlled tabs close. Do not claim
    // unrelated in-flight pages or force reloads during an unsaved editing session.
  })());
});
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "GROUNDWORK_SHELL_STATUS" || !event.ports[0]) return;
  event.waitUntil((async () => {
    let ready = false;
    try { if (cacheName) ready = await shellComplete(await caches.open(cacheName)); }
    catch { failure = "Offline shell storage is unavailable"; }
    event.ports[0].postMessage({ type: "GROUNDWORK_SHELL_STATUS", ready, version: inventory ? inventory.version : null, files: inventory ? inventory.assets.length : 0, bytes: inventory ? inventory.totalBytes : 0, error: ready ? null : failure || "Offline shell cache is incomplete" });
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!inventory || !cacheName || request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== origin || /^\/api(?:\/|$)/i.test(url.pathname)) return;
  if (request.mode === "navigate") {
    // Route/query HTML is never read into Cache Storage. Every navigation uses
    // the same verified public entry for this worker's immutable application.
    event.respondWith((async () => {
      try {
        const cached = await (await caches.open(cacheName)).match(`${origin}/index.html`);
        if (validCached(cached, assets.get("/index.html"))) return cached;
      } catch { failure = "Offline shell storage is unavailable"; }
      return fetch(request);
    })());
    return;
  }
  if (url.search || url.hash || !assets.has(url.pathname)) return;
  event.respondWith((async () => {
    try {
      const cached = await (await caches.open(cacheName)).match(url.href);
      if (validCached(cached, assets.get(url.pathname))) return cached;
    } catch { failure = "Offline shell storage is unavailable"; }
    // A missing/evicted asset is not rewritten into another version's cache.
    // Default network handling remains available, and status reports not ready.
    return fetch(request);
  })());
});
