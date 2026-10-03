import { ApiError, getCsrfToken } from "../api";

export type WorkspaceKind = "engineering" | "exchange" | "geometry";
export interface WorkspaceSnapshot {
  kind: WorkspaceKind; revision: number; sourceRevision: number; payloadArtifactId: string;
  referencedArtifactIds: string[]; updatedAt: number; updatedBy: string | null;
}
export interface WorkspaceState {
  project: { id: string; name: string; revision: number; role: "owner" | "editor" | "viewer" };
  workspace: WorkspaceSnapshot | null; history: WorkspaceSnapshot[];
}
export interface WorkspaceArtifact {
  id: string; kind: WorkspaceKind; name: string; mime: string; size: number; sha256: string; createdAt: number;
}
export class WorkspaceApiError extends ApiError {
  constructor(status: number, message: string, readonly code?: string, readonly currentRevision?: number) { super(status, message); }
}
export const MAX_WORKSPACE_BYTES = 64 * 1024 * 1024;
const path = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/workspaces`;
async function request<T>(url: string, method = "GET", body?: BodyInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (body && typeof body === "string") headers["Content-Type"] = "application/json";
  const csrf = getCsrfToken(); if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
  const response = await fetch(url, { method, headers, credentials: "same-origin", body });
  if (!response.ok) {
    let detail: { error?: string; code?: string; currentRevision?: number } = {};
    try { detail = await response.json() as typeof detail; } catch { /* retain HTTP status */ }
    throw new WorkspaceApiError(response.status, detail.error || `Workspace request failed (${response.status})`, detail.code, detail.currentRevision);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const getWorkspace = (projectId: string, kind: WorkspaceKind) => request<WorkspaceState>(`${path(projectId)}/${kind}`);
export const saveWorkspace = (projectId: string, kind: WorkspaceKind, snapshot: { baseWorkspaceRevision: number; sourceRevision: number; payloadArtifactId: string; referencedArtifactIds: string[] }) => request<WorkspaceState>(`${path(projectId)}/${kind}`, "PUT", JSON.stringify(snapshot));
export const listWorkspaceArtifacts = (projectId: string, kind: WorkspaceKind) => request<{ artifacts: WorkspaceArtifact[] }>(`${path(projectId)}/artifacts?kind=${kind}`);
export const deleteWorkspaceArtifact = (projectId: string, artifactId: string) => request<void>(`${path(projectId)}/artifacts/${encodeURIComponent(artifactId)}`, "DELETE");
export const pruneWorkspaceHistory = (projectId: string, kind: WorkspaceKind, beforeRevision: number) => request<WorkspaceState & { deleted: number }>(`${path(projectId)}/${kind}/history?beforeRevision=${beforeRevision}`, "DELETE");
export async function uploadWorkspaceArtifact(projectId: string, kind: WorkspaceKind, blob: Blob, name: string): Promise<WorkspaceArtifact> {
  if (blob.size > MAX_WORKSPACE_BYTES) throw new Error("Workspace files are limited to 64 MiB.");
  const body = new FormData(); body.set("kind", kind); body.set("file", blob, name);
  return (await request<{ artifact: WorkspaceArtifact }>(`${path(projectId)}/artifacts`, "POST", body)).artifact;
}
export async function readWorkspaceArtifact(projectId: string, artifactId: string): Promise<Blob> {
  const response = await fetch(`${path(projectId)}/artifacts/${encodeURIComponent(artifactId)}`, { credentials: "same-origin" });
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new WorkspaceApiError(response.status, "Workspace artifact is unavailable or access changed."); }
  if (!response.body || Number(response.headers.get("Content-Length") || 0) > MAX_WORKSPACE_BYTES) { await response.body?.cancel().catch(() => undefined); throw new Error("Workspace artifact exceeds its read limit."); }
  const reader = response.body.getReader(), parts: ArrayBuffer[] = []; let bytes = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > MAX_WORKSPACE_BYTES) throw new Error("Workspace artifact exceeds its read limit."); parts.push(next.value.slice().buffer); }
  } finally { await reader.cancel(); }
  return new Blob(parts, { type: response.headers.get("Content-Type") || "application/octet-stream" });
}
