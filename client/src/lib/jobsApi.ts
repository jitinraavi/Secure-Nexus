import { ApiError, getCsrfToken } from "../api";
import type { WorkspaceArtifact } from "./workspaceApi";

export type NativeJobKind = "dwg-to-dxf" | "dxf-to-dwg" | "opensees-static";
export type NativeJobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export interface NativeCapability {
  kind: NativeJobKind; adapter: "LibreDWG" | "OpenSees"; supportedVersion: string;
  configured: boolean; available: boolean; reason: string; runtimeVerified: false;
}
export interface NativeJobSummary {
  kind: NativeJobKind; adapter: "LibreDWG" | "OpenSees"; declaredVersion: string;
  sourceArtifactId: string; sourceSha256: string; verification: "computed-unvalidated";
  dimension?: "planar-2d"; combinationId?: string; warnings: string[];
}
export interface ProjectJob {
  id: string; projectId: string; kind: NativeJobKind; state: NativeJobState;
  sourceArtifactId: string; sourceSha256: string; sourceRevision: number; sourceWorkspaceRevision: number | null;
  createdAt: number; updatedAt: number; createdBy: string | null; attempts: number;
  error: { code: string; message: string } | null; artifacts: WorkspaceArtifact[]; summary: NativeJobSummary | null;
}
export interface ProjectJobsState {
  project: { id: string; name: string; revision: number; role: "owner" | "editor" | "viewer" };
  jobs: ProjectJob[]; capabilities: NativeCapability[];
}
export class JobsApiError extends ApiError {
  constructor(status: number, message: string, readonly code?: string) { super(status, message); }
}
export const MAX_NATIVE_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_NATIVE_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const path = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/jobs`;

async function request<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const csrf = getCsrfToken(); if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
  const response = await fetch(url, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body), signal });
  if (!response.ok) {
    let detail: { error?: string; code?: string } = {};
    try { detail = await response.json() as typeof detail; } catch { /* retain HTTP status */ }
    throw new JobsApiError(response.status, detail.error || `Job request failed (${response.status}).`, detail.code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const listProjectJobs = (projectId: string, signal?: AbortSignal) => request<ProjectJobsState>(path(projectId), "GET", undefined, signal);
export const getProjectJob = (projectId: string, jobId: string, signal?: AbortSignal) => request<{ job: ProjectJob }>(`${path(projectId)}/${encodeURIComponent(jobId)}`, "GET", undefined, signal);
export const submitProjectJob = (projectId: string, input: { kind: NativeJobKind; sourceArtifactId: string; sourceRevision: number; sourceWorkspaceRevision?: number; idempotencyKey: string }, signal?: AbortSignal) => request<{ job: ProjectJob }>(path(projectId), "POST", input, signal);
export const cancelProjectJob = (projectId: string, jobId: string, signal?: AbortSignal) => request<{ job: ProjectJob }>(`${path(projectId)}/${encodeURIComponent(jobId)}/cancel`, "POST", undefined, signal);
export const deleteProjectJob = (projectId: string, jobId: string, signal?: AbortSignal) => request<void>(`${path(projectId)}/${encodeURIComponent(jobId)}`, "DELETE", undefined, signal);

export async function readJobArtifact(projectId: string, jobId: string, artifactId: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(`${path(projectId)}/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}`, { credentials: "same-origin", signal });
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new JobsApiError(response.status, "Job output is unavailable or project access changed."); }
  if (!response.body || Number(response.headers.get("Content-Length") || 0) > MAX_NATIVE_DOWNLOAD_BYTES) { await response.body?.cancel().catch(() => undefined); throw new Error("Job output exceeds its 64 MiB read limit."); }
  const reader = response.body.getReader(), parts: ArrayBuffer[] = []; let size = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > MAX_NATIVE_DOWNLOAD_BYTES) throw new Error("Job output exceeds its 64 MiB read limit."); parts.push(next.value.slice().buffer); }
  } finally { await reader.cancel().catch(() => undefined); }
  return new Blob(parts, { type: response.headers.get("Content-Type") || "application/octet-stream" });
}
