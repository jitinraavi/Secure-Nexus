import { strict as assert } from "node:assert";
import { test } from "node:test";
// The preview is a public ES module and runs without a browser or account.
// @ts-ignore public JavaScript module
import { previewMetrics, sample } from "../public/workspace-preview.js";
test("unit changes retain the same physical sample and convert area quadratically", () => {
  assert.deepEqual(previewMetrics("m"), { width: 12, depth: 8, height: 3, area: 96 });
  assert.deepEqual(previewMetrics("mm"), { width: 12000, depth: 8000, height: 3000, area: 96000000 });
  const feet = previewMetrics("ft");
  assert.ok(Math.abs(feet.width * .3048 - 12) < 1e-10);
  assert.ok(Math.abs(feet.area * .3048 ** 2 - 96) < 1e-10);
  assert.deepEqual(sample, { widthM: 12, depthM: 8, heightM: 3 });
});
