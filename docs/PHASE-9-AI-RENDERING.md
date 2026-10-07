# Phase 9: AI Photorealistic Rendering Jobs

## Architecture Overview

Phase 9 introduces durable asynchronous AI photorealistic rendering jobs to Groundwork, distinct from the local path tracer and the AI design assistant. Renders are executed through an extensible provider abstraction, bound to exact project revisions, stored as immutable versioned workspace artifacts, and protected against accidental deletion or silent overwriting.

```
┌────────────────────────────────────────────────────────┐
│               Client 3D Viewport / Canvas              │
└───────────────────────────┬────────────────────────────┘
                            │
               PNG Snapshot │ (Canvas capture or upload)
                            ▼
┌────────────────────────────────────────────────────────┐
│            RenderStudioModal (Client UI)               │
│ - Style Presets (Daylight, Golden Hour, Dusk, etc.)    │
│ - Prompt & Negative Prompt                             │
│ - Stale Revision Badges (Rendered Rev vs Current Rev)  │
│ - Render History & High-Resolution PNG Export          │
└───────────────────────────┬────────────────────────────┘
                            │ POST /api/projects/:id/renders
                            ▼
┌────────────────────────────────────────────────────────┐
│            Render Jobs Engine (Server)                 │
│ - Verifies project access & source revision            │
│ - Saves source image as AES-256-GCM artifact           │
│ - Configuration Gating: if provider missing, records   │
│   status = 'unconfigured' with clear guidance          │
│ - If configured: records 'queued', runs async worker   │
└───────────────────────────┬────────────────────────────┘
                            │
              Durable Async │ AbortController
                            ▼
┌────────────────────────────────────────────────────────┐
│            Render Provider Abstraction                 │
│ - GeminiImagenRenderProvider (GEMINI_API_KEY)          │
│ - DemoRenderProvider (RENDER_PROVIDER=demo / test)     │
│ - UnconfiguredRenderProvider (Default when unset)      │
└───────────────────────────┬────────────────────────────┘
                            │
        Rendered PNG Buffer │
                            ▼
┌────────────────────────────────────────────────────────┐
│            Versioned Output Artifacts                  │
│ - Saved to project_workspace_artifacts                 │
│ - Retains historical renders permanently               │
│ - Retry spawns new immutable job without overwriting   │
│ - Deletion protection while referenced                 │
└────────────────────────────────────────────────────────┘
```

---

## 1. Provider Abstraction & Configuration Gating

The rendering provider contract (`server/src/renderProvider.ts`) defines an extensible interface for model inference:

```ts
export interface RenderProvider {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly version: string;
  isConfigured(): boolean;
  getUnconfiguredReason(): string | null;
  generate(params: RenderProviderParams, signal?: AbortSignal): Promise<RenderProviderResult>;
}
```

### Supported Providers
1. **Google Gemini / Imagen Provider (`GeminiImagenRenderProvider`)**:
   - Configured via `GEMINI_API_KEY` (or `IMAGEN_API_KEY`).
   - Model configurable via `IMAGEN_MODEL` (default: `imagen-3.0-generate-002`).
   - Dispatches requests to Google's generative models with combined architectural prompts and negative prompt guards.
2. **Demo Provider (`DemoRenderProvider`)**:
   - Active when `RENDER_PROVIDER=demo` or `NODE_ENV=test`.
   - Generates valid 32-bit RGBA PNG buffers using pure Node.js `node:zlib` deflate and CRC32 algorithms, simulating realistic architectural lighting and materials for testing and offline environments.
3. **Unconfigured Provider (`UnconfiguredRenderProvider`)**:
   - Default when credentials are absent.
   - `isConfigured()` returns `false`.
   - When a job is submitted, the server persists the job in `unconfigured` status with error code `PROVIDER_UNCONFIGURED` and actionable instructions, rather than failing the request or throwing unhandled errors.

### Style Presets
Six architectural style presets are built in:
- `photorealistic-daylight`: Natural bright daylight, sharp realistic shadows, 8k architectural quality.
- `golden-hour`: Warm sunset sunlight, long soft shadows, warm atmospheric glow.
- `dusk-architectural`: Twilight sky, glowing interior lighting through windows, facade accent lighting.
- `interior-warm`: Warm ambient recessed lighting, high detail finishes, elegant modern design.
- `modern-minimalist`: Diffused soft lighting, neutral tones, smooth concrete and glass textures.
- `dramatic-moody`: Overcast cloudy sky, wet surface reflections, deep contrast.

---

## 2. Durable Asynchronous Job Execution

Render jobs are stored in SQLite in `project_render_jobs`:

```sql
CREATE TABLE IF NOT EXISTS project_render_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_revision INTEGER NOT NULL CHECK(source_revision >= 0),
  source_image_artifact_id TEXT NOT NULL REFERENCES project_workspace_artifacts(id) ON DELETE CASCADE,
  source_image_sha256 TEXT NOT NULL,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  style_preset TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'unconfigured')),
  output_artifact_id TEXT REFERENCES project_workspace_artifacts(id) ON DELETE SET NULL,
  output_sha256 TEXT,
  error_code TEXT,
  error_message TEXT,
  parameters_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
```

### Job States
- `queued`: Enqueued for processing.
- `running`: Actively generating output via provider.
- `succeeded`: Completed with output artifact ID and SHA-256 hash.
- `failed`: Terminated with error code and descriptive message.
- `cancelled`: Aborted cooperatively via user request.
- `unconfigured`: Persisted input awaiting provider credentials.

### Cooperative Cancellation
An in-flight job can be cancelled via `POST /api/projects/:projectId/renders/:jobId/cancel`. The server triggers the job's `AbortController`, aborting upstream HTTP requests and transitioning the status to `cancelled`.

### Startup Reconciliation
On server restart, `reconcileInterruptedRenderJobs()` reconciles any jobs left in `running` status, transitioning them to `failed` with code `SERVER_RESTARTED` so users can re-trigger them cleanly.

---

## 3. Versioned Artifact Preservation & Immutability

1. **Non-Destructive Storage**:
   - The captured source design image is encrypted using AES-256-GCM and stored as an artifact in `project_workspace_artifacts` with `kind: 'geometry'`.
   - Every generated render output is saved as its own distinct artifact: `render-output-rev${sourceRevision}-${jobId.slice(0, 8)}.png`.
   - Previous renders and their outputs are never overwritten or deleted.
2. **Immutable Retries**:
   - Calling `POST /api/projects/:projectId/renders/:jobId/retry` creates a **brand-new job record** with a new unique ID, inheriting the original prompt, preset, and source image artifact.
   - The original job row and its output artifacts remain completely untouched.
3. **Deletion Barrier**:
   - `deleteWorkspaceArtifact()` checks `project_render_jobs`. Any artifact linked as a `source_image_artifact_id` or `output_artifact_id` is protected from deletion with HTTP 409 `ARTIFACT_REFERENCED`.

---

## 4. Revision Attribution & Stale Render Detection

A major problem in architectural rendering is old renderings falsely presenting as current design revisions. Groundwork solves this systematically:
- Each render job records the exact `source_revision` of the project at the moment of submission.
- The API compares `job.sourceRevision` with `project.currentRevision`.
- If `sourceRevision !== project.currentRevision`, the API returns `revisionMismatch: true`, and the UI displays a clear badge:
  `⚠️ Stale: Rev {sourceRevision} (Current is Rev {currentRevision})`
- The system rejects submissions where `sourceRevision > project.revision` with HTTP 409 `SOURCE_REVISION_AHEAD`.

---

## 5. API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/projects/:id/renders` | `GET` | List all render jobs for project, revision status, and provider capabilities |
| `/api/projects/:id/renders` | `POST` | Submit durable asynchronous render job (JSON or multipart image) |
| `/api/projects/:id/renders/capabilities` | `GET` | Fetch provider status, model name, and style preset catalog |
| `/api/projects/:id/renders/:jobId` | `GET` | Get single render job details, revision status, and output artifact metadata |
| `/api/projects/:id/renders/:jobId/image` | `GET` | Stream rendered output image (or `?type=source` for source image) with `image/png` headers |
| `/api/projects/:id/renders/:jobId/retry` | `POST` | Retries job as a new immutable job without corrupting historical outputs |
| `/api/projects/:id/renders/:jobId/cancel` | `POST` | Cancels an active or queued render job |

---

## 6. Client User Interface

1. **Render Studio Modal (`RenderStudioModal.tsx`)**:
   - Interactive modal with provider status banner, model info, and project revision tracking.
   - Source snapshot preview with file upload fallback.
   - Style preset picker with visual descriptions.
   - Prompt & negative prompt inputs.
   - Chronological render gallery with status indicators, stale revision badges, full-screen lightbox preview, and high-res PNG export button.
2. **Geometry Workbench Integration (`GeometryWorkbench.tsx`)**:
   - Prominent "AI Photorealistic Rendering Jobs" card.
   - "Open Render Studio" button opens the studio modal with the current canvas data URL pre-filled.
3. **3D Editor Integration (`Editor.tsx`)**:
   - "✨ AI Render" button in the main presentation toolbar automatically captures the active Three.js camera viewport using `api.capturePng(1)` and opens the Render Studio.
   - "AI Photorealistic Render" connector in the Export / CAD menu.

---

## 7. Verification & Automated Tests

Automated tests in `server/test/render.test.ts` verify:
1. Capabilities endpoint returning active provider and presets.
2. Configuration gating when credentials are missing (`unconfigured` status).
3. Durable async job submission and AES-256-GCM artifact generation.
4. Binary image streaming with `image/png` Content-Type and SHA-256 verification.
5. Stale revision detection when `project.revision` advances.
6. Immutable job retry preserving historical records.
7. Artifact deletion protection under `deleteWorkspaceArtifact`.
