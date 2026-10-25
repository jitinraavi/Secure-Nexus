import assert from "node:assert/strict";
import { after, test } from "node:test";
import express from "express";
import { routeParam, RouteParameterError } from "../src/routeParams.js";

test("named route parameters preserve scalar identity without coercion", () => {
  for (const id of ["project-123", "A_b.42", "x".repeat(512)]) {
    assert.equal(routeParam({ params: { id } }, "id"), id);
  }
  for (const params of [{}, { id: [] }, { id: ["first", "second"] }, { id: "" }, { id: "x".repeat(513) }, { id: "id\u0000suffix" }, { id: "id\nsuffix" }, { id: "id\u007f" }]) {
    assert.throws(() => routeParam({ params }, "id"), (error: unknown) => {
      assert.ok(error instanceof RouteParameterError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "INVALID_ROUTE_PARAMETER");
      assert.equal(error.message, "Invalid route parameter");
      return true;
    });
  }
});

const app = express();
const child = express.Router({ mergeParams: true });
child.get("/:jobId", async (request, response) => {
  response.json({ projectId: routeParam(request, "projectId"), jobId: routeParam(request, "jobId") });
});
app.use("/projects/:projectId/jobs", child);
// Wildcard arrays are supported by Express, but are not scalar application IDs.
app.get("/wild/*id", async (request, response) => {
  response.json({ id: routeParam(request, "id") });
});
app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (!(error instanceof RouteParameterError)) { next(error); return; }
  response.status(error.status).json({ error: error.message, code: error.code });
});
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("Fixture did not bind");
const base = `http://127.0.0.1:${address.port}`;
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("Express 5 preserves merged parent IDs and decoded child IDs", async () => {
  const response = await fetch(`${base}/projects/project%2D123/jobs/job_456`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { projectId: "project-123", jobId: "job_456" });
});

test("Express 5 rejects wildcard arrays and invalid decoded segments with safe JSON", async () => {
  for (const url of ["/wild/first/second", "/projects/project%00secret/jobs/job", `/projects/${"x".repeat(513)}/jobs/job`]) {
    const response = await fetch(`${base}${url}`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid route parameter", code: "INVALID_ROUTE_PARAMETER" });
  }
});
