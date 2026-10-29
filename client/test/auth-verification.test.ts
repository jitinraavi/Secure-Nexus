import assert from "node:assert/strict";
import { test } from "node:test";
import { bootstrap, getMe, setCsrfToken } from "../src/api.ts";
import { verifySession } from "../src/lib/sessionVerification.ts";
import { sessionDeviceLabel } from "../src/lib/sessionDevice.ts";

test("a bootstrap outage stops session lookup and remains unavailable rather than signed out", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async input => {
    calls.push(String(input));
    throw new TypeError("Network unavailable");
  }) as typeof fetch;
  try {
    const result = await verifySession(bootstrap, getMe);
    assert.equal(result.status, "unavailable");
    assert.deepEqual(calls, ["/api/auth/bootstrap"]);
    assert.equal("account" in result, false, "a failed check supplies no replacement for the retained account");
  } finally { globalThis.fetch = original; setCsrfToken(null); }
});

test("only a confirmed 401 becomes signed out; a current-user 503 can retry successfully", async () => {
  const original = globalThis.fetch;
  let responseStatus = 503;
  globalThis.fetch = (async input => {
    if (String(input) === "/api/auth/bootstrap") return Response.json({ csrfToken: "synthetic-csrf" });
    if (responseStatus === 200) return Response.json({ user: { id: "synthetic-account" } });
    return Response.json({ error: responseStatus === 401 ? "Not authenticated" : "Temporarily unavailable" }, { status: responseStatus });
  }) as typeof fetch;
  try {
    const unavailable = await verifySession(bootstrap, getMe);
    assert.equal(unavailable.status, "unavailable");
    responseStatus = 200;
    const recovered = await verifySession(bootstrap, getMe);
    assert.equal(recovered.status, "authenticated");
    if (recovered.status === "authenticated") assert.equal(recovered.account.user.id, "synthetic-account");
    responseStatus = 401;
    assert.deepEqual(await verifySession(bootstrap, getMe), { status: "unauthenticated", account: null });
  } finally { globalThis.fetch = original; setCsrfToken(null); }
});

test("device labels distinguish Chromium-based browsers without exposing the whole user agent", () => {
  const chromium = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36";
  assert.equal(sessionDeviceLabel(chromium), "Chrome on Windows");
  assert.equal(sessionDeviceLabel(`${chromium} Edg/156.0.0.0`), "Edge on Windows");
  assert.equal(sessionDeviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1"), "Safari on iPhone");
  assert.equal(sessionDeviceLabel("Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0"), "Firefox on Linux");
  assert.equal(sessionDeviceLabel(null), "Browser not identified");
  assert.equal(sessionDeviceLabel("unrecognized-client"), "Unrecognized browser");
});
