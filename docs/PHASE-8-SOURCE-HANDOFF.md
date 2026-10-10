# Phase 8 remaining source contract

Phase 8 is incomplete. The shell increment and legacy-dispatch safety corrections are separate from the durable offline data contract below. No application, tests, builds, lint/typecheck, previews, providers or repository code were executed.

## Preserve existing data

Keep the old `groundwork_offline_projects_v2` and `groundwork_offline_queue_v2` databases available for account-scoped recovery/export. Their arbitrary mutable payloads must not be automatically relabelled as validated new operations. Introduce a separately versioned database and explicit validated recovery/import. Malformed records remain exportable; never silently discard them or claim memory-only state is durably queued.

## Implement next, in order

1. Add `client/src/lib/offlineDatabase.ts` with strictly validated account-scoped projects, snapshots, immutable Blobs, operations, aggregate usage and leases. Replace `offlineProjectStore.ts` and `offlineQueue.ts` with typed facades. A single IndexedDB transaction must reserve bytes/counts, protect every nonterminal operation and dependency, supersede only never-dispatched unreferenced saves, evict unprotected LRU cache and commit the operation plus captured input. Return copies only after transaction completion. Unavailable storage, quota errors and aborted transactions reject visibly.
2. Add a server request ledger and transactional receipt/result replay for project PATCH, `/revisions` snapshots and workspace artifact uploads. Scope keys by initiating account/project/operation type and compare exact immutable wire hashes. Recheck the expected account, session, current membership, write entitlement and captured revision inside the mutation transaction. Preserve original results after lost responses; divergent reuse fails. Native jobs already have durable request keys but still need the expected-account guard. Artifact persistence must bind the created artifact/result and remove only its own staging bytes on rollback.
3. Replace `offlineSyncManager.ts` with the typed dispatcher and fenced leases. Claim FIFO per project; bounded backward dependencies may refer to a successful queued artifact upload. Lease expiry after dispatch becomes **uncertain**, not blindly queued. A stable request key reconciles uncertainty against the server ledger. Finalization checks its claim token so a stale tab cannot overwrite a newer claimant. Logout/account changes abort active work; each queued mutation carries `expectedAccountId` because generation checks alone cannot stop a shared cookie changing between client checks and server delivery.
4. Add an explicit `offline_cached` identity state and device opt-in in `auth.tsx`. A cached account is not a verified server session. Logout stops automatic restoration and clears active UI/memory references; reconnect requires current `/auth/me` verification. Integrate durable enqueue and exact save acknowledgement into Editor, then actual workspace artifact/native-job producers. Adopt an acknowledgement only for its matching captured pending edit; advance revision lineage without overwriting newer input. Preserve and expose conflicts instead of silently rebasing or overwriting.
5. Finish account-safe queue/recovery/conflict export/import/discard UI and document actual supported operations. Reinspect permission, account, source/revision, dependency, storage and cancellation boundaries before source delivery.

## Typed operation boundary

Use a versioned envelope with initiating account/project, immutable 32-hex request key, canonical request JSON and SHA-256, monotonic account sequence, creation time, bounded backward dependencies, accounted bytes and explicit state. Revalidate restored records and reject unknown fields or malformed arrays.

| Operation | Captured input / actual route |
| --- | --- |
| `project_save` | Required base revision, serialized design and finite authored project metadata; project PATCH with server result ledger. |
| `snapshot_create` | Source revision, name and captured authored design; POST `/revisions`, with current-revision and ledger checks. Never capture whatever server design happens to exist during replay. |
| `artifact_upload` | Module kind, name, immutable Blob ID, exact size/SHA-256; same-account/project ownership and idempotent artifact persistence. |
| `native_job_submit` | Kind, captured project/workspace revisions and either an existing server artifact or a completed uploaded-artifact operation dependency; durable native-job key. |
| `render_job_submit` | Explicitly unsupported until Phase 9 defines its real provider and job contract. |

Suggested finite product limits for the new store: 50 MiB aggregate per account including JSON, snapshots, queue and Blob bytes; 50 cached projects; 10 snapshots per project; 200 operations per account; 32 MiB per queued Blob. These are implementation proposals, not existing enforced guarantees. Capacity exhaustion must abort without deleting protected pending work. Account for replacement deltas and all retained results; transaction serialization must enforce limits across tabs.

The interim corrections bind legacy project saves to their initiating account and captured revision, reject unsupported legacy non-project dispatch, scope asynchronous count/UI results, and disallow permission-error cache fallback. They do not provide immutable durable storage, crash recovery, dependency uploads, cold-start offline identity or Editor acknowledgement reconciliation. Phase 9 remains next after this finite data contract is implemented; provider deployment and all executable acceptance remain deferred.
