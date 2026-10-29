import assert from "node:assert/strict";
import test from "node:test";
import type { CadExchangeStatusResponse } from "../src/api";
import { dwgExportReadiness, observeCadExportReadiness, type CadExportReadiness } from "../src/lib/exportReadiness";

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const status = (available: boolean): CadExchangeStatusResponse => ({
  providers: [], openFallbacks: [], message: "Configuration report",
  nativeCapabilities: [{
    kind: "dxf-to-dwg", adapter: "LibreDWG", supportedVersion: "configured-version",
    configured: available, available, reason: available ? "Worker configuration reported." : "Worker disabled by administrator.",
    runtimeVerified: false,
  }],
});

test("a failed capability request becomes an error and an explicit retry can reach ready", async () => {
  const states: CadExportReadiness[] = [];
  observeCadExportReadiness(async () => { throw new Error("offline"); }, state => states.push(state));
  assert.equal(states.at(-1)?.status, "loading");
  await settle();
  assert.equal(states.at(-1)?.status, "error");
  const failed = dwgExportReadiness(states.at(-1)!);
  assert.match(failed.label, /could not be checked/);
  assert.match(failed.message, /retry/);
  assert.equal(failed.available, false);
  observeCadExportReadiness(async () => status(true), state => states.push(state));
  assert.equal(states.at(-1)?.status, "loading");
  await settle();
  assert.equal(states.at(-1)?.status, "ready");
  assert.equal(dwgExportReadiness(states.at(-1)!).label, "DWG conversion can be queued");
});

test("closing or replacing a request prevents stale availability from overwriting a newer report", async () => {
  const states: CadExportReadiness[] = [];
  let finishOld!: (value: CadExchangeStatusResponse) => void;
  const old = new Promise<CadExchangeStatusResponse>(resolve => { finishOld = resolve; });
  const cancelOld = observeCadExportReadiness(() => old, state => states.push(state));
  await settle();
  cancelOld();
  observeCadExportReadiness(async () => status(false), state => states.push(state));
  await settle();
  const count = states.length;
  finishOld(status(true));
  await settle();
  assert.equal(states.length, count);
  assert.equal(dwgExportReadiness(states.at(-1)!).available, false);
  assert.match(dwgExportReadiness(states.at(-1)!).message, /disabled/);
});

test("synchronous request failures and cancellation do not leave unhandled or stale results", async () => {
  const states: CadExportReadiness[] = [];
  observeCadExportReadiness(() => { throw new Error("request construction failed"); }, state => states.push(state));
  await settle();
  assert.equal(states.at(-1)?.status, "error");
  const cancel = observeCadExportReadiness(async () => status(true), state => states.push(state));
  cancel();
  const count = states.length;
  await settle();
  assert.equal(states.length, count);
});

test("missing and disabled capabilities are distinct from a request still loading", () => {
  const loading = dwgExportReadiness({ status: "loading" });
  const missing = dwgExportReadiness({ status: "ready", data: { providers: [], openFallbacks: [], message: "" } });
  const disabled = dwgExportReadiness({ status: "ready", data: status(false) });
  assert.match(loading.label, /Checking/);
  assert.match(missing.message, /did not report/);
  assert.match(disabled.message, /disabled/);
  assert.equal(missing.available, false);
  assert.equal(disabled.available, false);
});
