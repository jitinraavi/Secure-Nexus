import { sha256Hex } from "./crypto.js";

const endpoint = process.env.COLLABORATION_REDIS_REST_URL || "";
const token = process.env.COLLABORATION_REDIS_REST_TOKEN || "";
const namespace = process.env.COLLABORATION_REDIS_NAMESPACE || "groundwork";
export const redisTransportConfigured = Boolean(endpoint && token);
export function redisProjectKey(projectId: string): string {
  return `${namespace}:{${sha256Hex(projectId)}}`;
}
/** Upstash-compatible REST command transport. The URL is deployment configuration,
 * never a user supplied URL. No bearer credential is returned to the browser. */
export async function redisCommand<T>(command: (string | number)[]): Promise<T> {
  if (!redisTransportConfigured) throw new Error("Redis collaboration transport is not configured");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Redis REST transport requires a plain HTTPS endpoint");
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(command), redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Redis collaboration transport unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Redis response is empty");
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    length += part.value.length;
    if (length > 4_000_000) { await reader.cancel(); throw new Error("Redis response exceeds transport limit"); }
    chunks.push(part.value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const data = JSON.parse(text) as { result?: T; error?: string };
  if (data.error || !("result" in data)) throw new Error("Redis collaboration command rejected");
  return data.result as T;
}

const presenceScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if ARGV[2] ~= '' then
  if ARGV[3] == 'remove' then redis.call('ZREM',KEYS[1],ARGV[2])
  else redis.call('ZADD',KEYS[1],ARGV[3],ARGV[2]) end
end
redis.call('EXPIRE',KEYS[1],120)
return redis.call('ZRANGE',KEYS[1],0,1999)
`;
export async function redisPresence(projectId: string, member = "", expiresAt?: number): Promise<{ users: { userId: string; connections: number }[]; count: number }> {
  const members = await redisCommand<string[]>(["EVAL", presenceScript, 1, `${redisProjectKey(projectId)}:presence`, Math.floor(Date.now() / 1000), member, expiresAt === undefined ? "remove" : expiresAt]);
  const users = new Map<string, number>();
  for (const entry of members) {
    const separator = entry.lastIndexOf("|");
    if (separator > 0) { const userId = entry.slice(0, separator); users.set(userId, (users.get(userId) ?? 0) + 1); }
  }
  return { users: [...users].map(([userId, connections]) => ({ userId, connections })), count: users.size };
}
export async function publishRedisProjectEvent(projectId: string, event: unknown): Promise<void> {
  await redisCommand(["XADD", `${redisProjectKey(projectId)}:events`, "MAXLEN", "~", 2000, "*", "event", JSON.stringify(event)]);
}
export async function readRedisProjectEvents(projectId: string, afterId: string): Promise<{ cursor: string; events: unknown[] }> {
  const rows = await redisCommand<[string, string[]][]>(["XRANGE", `${redisProjectKey(projectId)}:events`, afterId === "0" ? "-" : `(${afterId}`, "+", "COUNT", 200]);
  const events: unknown[] = [];
  for (const [, fields] of rows) {
    const index = fields.indexOf("event");
    if (index >= 0 && fields[index + 1]) events.push(JSON.parse(fields[index + 1]) as unknown);
  }
  return { cursor: rows[rows.length - 1]?.[0] ?? afterId, events };
}
