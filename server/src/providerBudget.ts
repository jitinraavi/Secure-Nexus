import { randomUUID } from "node:crypto";
import { db, now, withTransaction } from "./db.js";
import { validateDesignComplexity } from "./designValidation.js";

export type ProviderKind = "assistant" | "render";

export class ProviderResourceError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string) {
    super(message);
    this.name = "ProviderResourceError";
  }
}

function setting(name: string, fallback: number, maximum: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return number;
}

export function providerLimits(kind: ProviderKind) {
  const prefix = kind === "render" ? "RENDER" : "AI";
  return {
    userConcurrency: setting(`${prefix}_USER_CONCURRENCY`, kind === "render" ? 1 : 2, 32),
    globalConcurrency: setting(`${prefix}_GLOBAL_CONCURRENCY`, kind === "render" ? 4 : 16, 128),
    userDailyRequests: setting(`${prefix}_USER_DAILY_REQUESTS`, kind === "render" ? 20 : 100, 100_000),
    globalDailyRequests: setting(`${prefix}_GLOBAL_DAILY_REQUESTS`, kind === "render" ? 200 : 5_000, 1_000_000),
    userDailyTokens: setting(`${prefix}_USER_DAILY_TOKEN_BUDGET`, kind === "render" ? 200_000 : 250_000, 1_000_000_000),
    globalDailyTokens: setting(`${prefix}_GLOBAL_DAILY_TOKEN_BUDGET`, 10_000_000, 10_000_000_000),
    timeoutMs: setting(`${prefix}_PROVIDER_TIMEOUT_MS`, kind === "render" ? 120_000 : 30_000, 300_000),
  };
}

export function assistantOutputTokens(): number { return setting("AI_MAX_OUTPUT_TOKENS", 2_048, 8_192); }
export function renderOutputBytes(): number { return setting("RENDER_MAX_OUTPUT_BYTES", 16 * 1024 * 1024, 64 * 1024 * 1024); }

/** Reject expensive object shapes before recursive serialization and count wire bytes. */
export function isBoundedProviderJson(value: unknown, maximumBytes: number): boolean {
  try {
    validateDesignComplexity(value);
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maximumBytes;
  } catch {
    return false;
  }
}

// Usage reservations are intentionally not refunded after dispatch: a timed-out request
// may still incur provider charges. These are conservative spend proxies, not invoices.
db.exec(`
  CREATE TABLE IF NOT EXISTS provider_daily_usage (
    scope TEXT NOT NULL, kind TEXT NOT NULL, day INTEGER NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(scope,kind,day)
  );
  CREATE TABLE IF NOT EXISTS provider_active_permits (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, reserved_bytes INTEGER NOT NULL DEFAULT 0,
    reserved_artifacts INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS provider_permits_kind ON provider_active_permits(kind,user_id,expires_at);
  CREATE INDEX IF NOT EXISTS provider_permits_project ON provider_active_permits(project_id,expires_at);
`);

export interface ProviderPermit { id: string; kind: ProviderKind; timeoutMs: number; }

export function getReservedArtifactCapacity(projectId: string): { bytes: number; count: number } {
  return db.prepare("SELECT COALESCE(SUM(reserved_bytes),0) AS bytes,COALESCE(SUM(reserved_artifacts),0) AS count FROM provider_active_permits WHERE project_id=? AND expires_at>?")
    .get(projectId, now()) as { bytes: number; count: number };
}

export function admitProviderRequest(input: {
  userId: string; kind: ProviderKind; tokenBudget: number;
  projectId?: string; reservedBytes?: number; reservedArtifacts?: number;
}): ProviderPermit {
  if (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget < 1) throw new Error("Invalid provider token budget");
  const limits = providerLimits(input.kind);
  return withTransaction(() => {
    const timestamp = now();
    const day = Math.floor(timestamp / 86_400);
    db.prepare("DELETE FROM provider_active_permits WHERE expires_at<=?").run(timestamp);
    db.prepare("DELETE FROM provider_daily_usage WHERE day<?").run(day - 32);
    const active = db.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN user_id=? THEN 1 ELSE 0 END),0) AS user FROM provider_active_permits WHERE kind=?")
      .get(input.userId, input.kind) as { total: number; user: number };
    if (active.total >= limits.globalConcurrency || active.user >= limits.userConcurrency) {
      throw new ProviderResourceError(429, "Provider capacity is busy. Wait for an active request to finish before retrying.", "PROVIDER_BUSY");
    }
    for (const [scope, requests, tokens] of [
      [`user:${input.userId}`, limits.userDailyRequests, limits.userDailyTokens],
      ["global", limits.globalDailyRequests, limits.globalDailyTokens],
    ] as const) {
      const used = db.prepare("SELECT requests,tokens FROM provider_daily_usage WHERE scope=? AND kind=? AND day=?")
        .get(scope, input.kind, day) as { requests: number; tokens: number } | undefined;
      if ((used?.requests ?? 0) + 1 > requests || (used?.tokens ?? 0) + input.tokenBudget > tokens) {
        throw new ProviderResourceError(429, "Daily provider budget reached. Try again after the next UTC day.", "PROVIDER_DAILY_BUDGET");
      }
    }
    if (input.projectId && (input.reservedArtifacts || input.reservedBytes)) {
      const stored = db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS bytes FROM project_workspace_artifacts WHERE project_id=?")
        .get(input.projectId) as { count: number; bytes: number };
      const reserved = getReservedArtifactCapacity(input.projectId);
      if (stored.count + reserved.count + (input.reservedArtifacts ?? 0) > 128 ||
          stored.bytes + reserved.bytes + (input.reservedBytes ?? 0) > 256 * 1024 * 1024) {
        throw new ProviderResourceError(409, "Project artifact capacity cannot accommodate this render. Delete unreferenced artifacts before retrying.", "ARTIFACT_CAPACITY");
      }
    }
    for (const scope of [`user:${input.userId}`, "global"]) {
      db.prepare("INSERT INTO provider_daily_usage(scope,kind,day,requests,tokens) VALUES (?,?,?,1,?) ON CONFLICT(scope,kind,day) DO UPDATE SET requests=requests+1,tokens=tokens+excluded.tokens")
        .run(scope, input.kind, day, input.tokenBudget);
    }
    const id = randomUUID();
    db.prepare("INSERT INTO provider_active_permits(id,user_id,kind,project_id,expires_at,reserved_bytes,reserved_artifacts) VALUES (?,?,?,?,?,?,?)")
      .run(id, input.userId, input.kind, input.projectId ?? null, timestamp + Math.ceil(limits.timeoutMs / 1_000) + 30, input.reservedBytes ?? 0, input.reservedArtifacts ?? 0);
    return { id, kind: input.kind, timeoutMs: limits.timeoutMs };
  });
}

export function releaseProviderPermit(permit: ProviderPermit): void {
  db.prepare("DELETE FROM provider_active_permits WHERE id=?").run(permit.id);
}

/** One deadline spans connection, streamed body reading, and provider work. */
export async function withProviderDeadline<T>(
  timeoutMs: number, work: (signal: AbortSignal) => Promise<T>, parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal?.reason ?? new ProviderResourceError(409, "Request cancelled", "CANCELLED"));
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new ProviderResourceError(504, "Provider request timed out", "PROVIDER_TIMEOUT")), timeoutMs);
  let rejectAbort: (() => void) | undefined;
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(controller.signal.reason);
      if (controller.signal.aborted) rejectAbort();
      else controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    return await Promise.race([Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return work(controller.signal);
    }), aborted]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abort);
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
  }
}

export async function readProviderBody(response: Response, maximumBytes: number, signal: AbortSignal): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderResourceError(502, "Provider response exceeded the byte limit", "PROVIDER_RESPONSE_SIZE");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const result = await reader.read();
      signal.throwIfAborted();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) throw new ProviderResourceError(502, "Provider response exceeded the byte limit", "PROVIDER_RESPONSE_SIZE");
      chunks.push(result.value);
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
