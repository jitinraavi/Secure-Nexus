import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runInNewContext } from "node:vm";
import express from "express";
import { mountPublicSite } from "../src/publicSite.js";

const directory = mkdtempSync(path.join(tmpdir(), "groundwork-studio-routing-"));
for (const child of ["assets", "studio-assets/images"]) mkdirSync(path.join(directory, child), { recursive: true });
writeFileSync(path.join(directory, "index.html"), "<!doctype html><title>Workspace</title><div id='root'></div>");
writeFileSync(path.join(directory, "studio.html"), "<!doctype html><title>Groundwork studio</title><h1>Shaping spaces</h1>");
writeFileSync(path.join(directory, "assets/workspace-AbCd1234.js"), "console.log('workspace');");
writeFileSync(path.join(directory, "studio-assets/images/project-01.jpg"), "local-image");
writeFileSync(path.join(directory, "sw.js"), "/* worker */");
writeFileSync(path.join(directory, "offline-shell.json"), "{}");
const app = express();
app.get("/api/health", (_request, response) => response.json({ ok: true }));
app.use("/api", (_request, response) => { response.status(404).json({ error: "API not found" }); });
assert.equal(mountPublicSite(app, directory), true);
app.use((_request, response) => { response.status(404).json({ error: "Asset not found" }); });
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("Fixture did not bind a TCP port");
const base = `http://127.0.0.1:${address.port}`;
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

test("studio home uses its own document while deep links preserve the React workspace", async () => {
  for (const route of ["/", "/?campaign=studio", "/studio.html"]) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Shaping spaces/);
    assert.match(response.headers.get("cache-control") || "", /no-cache/);
  }
  for (const route of ["/login", "/signup", "/dashboard", "/editor/project-123", "/auth/complete?flow=state", "/share/token.with.dots", "/index.html"]) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /id='root'/);
    assert.match(response.headers.get("cache-control") || "", /no-cache/);
  }
});

test("missing files are never rewritten into a successful HTML response", async () => {
  for (const route of ["/assets/missing.js", "/studio-assets/images/missing.jpg", "/fonts/missing.woff2", "/missing.css", "/missing.html"]) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 404, route);
    assert.doesNotMatch(response.headers.get("content-type") || "", /text\/html/);
  }
  const api = await fetch(`${base}/api/missing`);
  assert.equal(api.status, 404);
  assert.equal((await api.json()).error, "API not found");
});

test("only fingerprinted build assets have immutable cache lifetimes", async () => {
  const hashed = await fetch(`${base}/assets/workspace-AbCd1234.js`);
  assert.match(hashed.headers.get("cache-control") || "", /max-age=31536000, immutable/);
  for (const route of ["/sw.js", "/offline-shell.json"]) {
    const response = await fetch(`${base}${route}`);
    assert.match(response.headers.get("cache-control") || "", /no-cache/);
  }
  const image = await fetch(`${base}/studio-assets/images/project-01.jpg`);
  assert.match(image.headers.get("cache-control") || "", /max-age=0, must-revalidate/);
  assert.doesNotMatch(image.headers.get("cache-control") || "", /immutable/);
});

test("HEAD preserves document metadata and does not return a body", async () => {
  const response = await fetch(`${base}/`, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/html/);
  assert.equal(await response.text(), "");
});

test("incomplete two-document builds are rejected", () => {
  const incomplete = path.join(directory, "incomplete");
  mkdirSync(incomplete);
  writeFileSync(path.join(incomplete, "index.html"), "workspace only");
  assert.throws(() => mountPublicSite(express(), incomplete), /missing the studio entry/);
  assert.equal(mountPublicSite(express(), path.join(directory, "not-built")), false);
});

test("the immutable worker selects the matching studio or workspace document offline", async () => {
  const origin = "https://groundwork.example";
  const hash = "a".repeat(64);
  const assets = ["/index.html", "/studio.html", "/assets/workspace-AbCd1234.js"].map((url) => ({ url, bytes: 1, sha256: hash }));
  const inventory = { schema: 1, version: hash, totalBytes: assets.length, assets };
  const callbacks = new Map<string, (event: any) => void>();
  const template = readFileSync(new URL("../../client/public/sw.js", import.meta.url), "utf8");
  runInNewContext(template.replace("/*__GROUNDWORK_SHELL_INVENTORY__*/null", JSON.stringify(inventory)), {
    self: { location: { origin }, addEventListener: (type: string, callback: (event: any) => void) => callbacks.set(type, callback) },
    URL, Response, Headers, AbortController, setTimeout, clearTimeout,
    caches: { open: async () => ({ match: async (url: string) => new Response(url.endsWith("/studio.html") ? "studio" : "workspace", {
      headers: { "x-groundwork-shell-sha256": hash, "content-length": "1" },
    }) }) },
    fetch: async () => new Response("network"),
  });
  const handle = callbacks.get("fetch");
  assert.ok(handle);
  async function navigate(route: string) {
    let response: Promise<Response> | undefined;
    handle!({ request: { method: "GET", url: `${origin}${route}`, mode: "navigate" }, respondWith: (value: Promise<Response>) => { response = value; } });
    return response ? (await response).text() : "network-unhandled";
  }
  assert.equal(await navigate("/"), "studio");
  assert.equal(await navigate("/?campaign=home"), "studio");
  assert.equal(await navigate("/studio.html"), "studio");
  assert.equal(await navigate("/login"), "workspace");
  assert.equal(await navigate("/editor/project-123"), "workspace");
  assert.equal(await navigate("/auth/complete?flow=sensitive-state"), "workspace");
  assert.equal(await navigate("/share/token.with.dots"), "workspace");
  assert.equal(await navigate("/api/auth/me"), "network-unhandled");
  assert.equal(await navigate("/assets/missing.js"), "network-unhandled");
  assert.equal(await navigate("/studio-assets/images/missing.jpg"), "network-unhandled");
  assert.equal(await navigate("/missing.css"), "network-unhandled");
});
