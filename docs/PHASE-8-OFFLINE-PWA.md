# Phase 8 — Real Offline & PWA Groundwork

## Overview
Phase 8 transforms Groundwork into a full-fledged Progressive Web Application (PWA) with offline execution, account-isolated project caching, immutable operation queues, and deterministic conflict resolution on reconnection.

## Architecture & Implementation

### 1. Service Worker & Application Shell
- **Manifest** (`client/public/manifest.webmanifest`):
  - Declares PWA identity, standalone display mode, theme colors, and maskable icons.
- **Service Worker** (`client/public/sw.js`):
  - Pre-caches core application shell assets on install (`/`, `/index.html`, `/manifest.webmanifest`, logos).
  - Implements network-first navigation with offline fallback to cached SPA shell (`index.html`).
  - Stale-while-revalidate strategy for static application assets (scripts, styles, fonts, images).
  - Explicit bypass for `/api/*` endpoints to permit dynamic offline queue processing.
- **Registration** (`client/src/lib/pwa.ts` & `client/src/main.tsx`):
  - Registers the service worker during page load and monitors background updates.

### 2. Account-Scoped Project & Snapshot Store (`client/src/lib/offlineProjectStore.ts`)
- **IndexedDB Storage** (`groundwork_offline_projects_v2`):
  - `cached_projects`: Stores `{ userId, projectId, name, projectType, revision, design, role, cachedAt, lastAccessedAt, sizeBytes }`.
  - `cached_snapshots`: Stores `{ userId, projectId, snapshotId, revision, description, snapshotData, createdAt, sizeBytes }`.
- **Bounded Storage & LRU Eviction**:
  - Maximum account storage quota: 50 MB.
  - Maximum cached projects per user: 50.
  - Maximum snapshots per project: 10.
  - Least Recently Used (LRU) eviction automatically frees capacity when limits are approached.
  - Projects with pending or conflicted offline operations (`protectedProjectIds`) are strictly shielded from eviction.
- **Account Isolation & Privacy**:
  - All read/write operations require authenticated `userId` and filter by account.
  - Upon logout (`client/src/auth.tsx`), `clearActiveUserSession(userId)` instantly clears in-memory caches and sensitive session references to prevent cross-account exposure.

### 3. Immutable Offline Queue (`client/src/lib/offlineQueue.ts`)
- **IndexedDB Store** (`groundwork_offline_queue_v2`):
  - Primary key: UUID.
  - Operation types: `project_save`, `snapshot_create`, `native_job_submit`, `render_job_submit`, `artifact_upload`.
  - Concurrency control: Records `expectedRevision` alongside payload for optimistic concurrency verification.
- **Deterministic State Machine**:
  - `queued`: Awaiting network reconnection.
  - `syncing`: In-flight network synchronization.
  - `completed`: Successfully reconciled and applied on server.
  - `conflicted`: Server revision advanced while client was offline; local edits preserved without overwriting.
  - `failed`: Non-recoverable error (e.g. project deleted or permissions revoked).
  - `superseded`: When multiple saves are made offline for the same project, earlier un-synced saves are marked `superseded`, preventing redundant writes.

### 4. Reconnect Synchronization Manager (`client/src/lib/offlineSyncManager.ts`)
- **Automated Online Detection**: Listens to `online` and `offline` browser events.
- **Verification Workflow on Reconnect**:
  1. *Authentication & Permission Recheck*: Calls `/api/auth/me`. If session is expired or revoked, synchronization halts.
  2. *FIFO Queue Processing*: Iterates through pending items in chronological order.
  3. *Revision Conflict Check*:
     - For `project_save`, inspects server state via `GET /api/projects/:id`.
     - If `server.revision !== expectedRevision`, the operation transitions to `conflicted` with server revision metadata. No silent overwriting occurs.
     - If clean, the save is applied via `PATCH /api/projects/:id`, updating the offline cache and marking the queue item `completed`.

### 5. UI Integration & Conflict Management (`client/src/components/OfflineSyncIndicator.tsx`)
- Status indicator pill embedded in sidebar and mobile navigation header:
  - Visual status for Online, Offline, Pending Queue, and Conflicted states.
- Offline Synchronization Hub Modal:
  - Network state and Account Storage gauge (MB used, cached project count).
  - Filterable queue viewer (Queued, Conflicted, Failed, Completed, Superseded).
  - Conflict resolution actions: One-click export of local conflicted drafts as JSON, or manual dismissal.
  - Manual "Sync Now" trigger.

## Verification
- Unit test suite in `server/test/offline.test.ts` covers:
  - Enqueueing immutable operations and superseding older un-synced project saves.
  - FIFO queue ordering and transition to conflicted status.
  - Multi-user account isolation (user A cannot access user B's projects or queues).
  - Session clearing upon user logout.
- Typecheck verification (`npm.cmd run lint`) passes with zero compiler errors across both client and server workspaces.
