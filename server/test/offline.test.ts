import { strict as assert } from "node:assert";
import { test } from "node:test";
import { offlineQueueStore } from "../../client/src/lib/offlineQueue.js";
import { offlineProjectStore } from "../../client/src/lib/offlineProjectStore.js";
import type { Design, Project } from "../../client/src/types.js";

const sampleDesign: Design = {
  room: { widthMm: 5000, depthMm: 4000, heightMm: 2800 },
  furniture: [],
};

const sampleProject: Project = {
  id: "proj_offline_1",
  name: "Offline Villa",
  projectType: "house",
  revision: 2,
};

test("Phase 8 offline store & queue suite", async (t) => {
  const userA = "user_alpha";
  const userB = "user_beta";
  const projectId = "proj_offline_1";

  await t.test("enqueues immutable operations and supersedes older un-synced saves", async () => {
    // Enqueue initial save at revision 2
    const firstSave = await offlineQueueStore.enqueue(
      userA,
      projectId,
      "project_save",
      { name: "Villa Draft 1", designData: "{}" },
      2,
    );
    assert.equal(firstSave.status, "queued");
    assert.equal(firstSave.expectedRevision, 2);

    // Enqueue subsequent save at revision 2 (before first is synced)
    const secondSave = await offlineQueueStore.enqueue(
      userA,
      projectId,
      "project_save",
      { name: "Villa Draft 2", designData: "{}" },
      2,
    );
    assert.equal(secondSave.status, "queued");

    // First save should now be superseded
    const queue = await offlineQueueStore.listQueue(userA);
    const oldItem = queue.find((item) => item.id === firstSave.id);
    const newItem = queue.find((item) => item.id === secondSave.id);

    assert.equal(oldItem?.status, "superseded");
    assert.equal(newItem?.status, "queued");
  });

  await t.test("preserves FIFO pending order and transitions to conflicted state", async () => {
    const jobOp = await offlineQueueStore.enqueue(
      userA,
      projectId,
      "native_job_submit",
      { kind: "dwg-to-dxf" },
      2,
    );
    assert.equal(jobOp.status, "queued");

    const pending = await offlineQueueStore.getPendingQueue(userA);
    assert.ok(pending.length >= 2);
    // Oldest queued item first
    assert.ok(pending[0].createdAt <= pending[1].createdAt);

    // Simulate conflict transition
    await offlineQueueStore.updateStatus(
      pending[0].id,
      "conflicted",
      "Server revision advanced",
      {
        serverRevision: 4,
        localRevision: 2,
        reason: "Remote concurrent update",
      },
    );

    const updated = (await offlineQueueStore.listQueue(userA)).find((i) => i.id === pending[0].id);
    assert.equal(updated?.status, "conflicted");
    assert.equal(updated?.conflictDetails?.serverRevision, 4);
    assert.equal(updated?.conflictDetails?.localRevision, 2);
  });

  await t.test("enforces strict account isolation between users", async () => {
    // User B caches a project
    await offlineProjectStore.cacheProject(userB, sampleProject, sampleDesign);

    // User A attempts to read User B's project
    const userAView = await offlineProjectStore.getCachedProject(userA, projectId);
    assert.equal(userAView, null);

    // User B reads their own project
    const userBView = await offlineProjectStore.getCachedProject(userB, projectId);
    assert.ok(userBView !== null);
    assert.equal(userBView.projectId, projectId);
    assert.equal(userBView.userId, userB);

    // User A cannot see User B's offline queue
    const userAQueue = await offlineQueueStore.listQueue(userA);
    const userBQueue = await offlineQueueStore.listQueue(userB);
    assert.ok(userAQueue.every((q) => q.userId === userA));
    assert.equal(userBQueue.length, 0);
  });

  await t.test("clears active user session upon logout", async () => {
    offlineProjectStore.clearActiveUserSession(userB);
    offlineQueueStore.clearActiveUserSession(userA);

    // Memory cache cleared
    const postLogoutA = await offlineQueueStore.listQueue(userA);
    assert.equal(postLogoutA.length, 0);
  });
});
