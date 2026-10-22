import { createHmac } from "node:crypto";
import type { RequestHandler } from "express";
import { MASTER_KEY } from "./config.js";
import { db, type Db } from "./db.js";

/** Atomic, shared fixed windows survive process restarts and serverless scaling. */
export function sharedRateLimiter(options: {
  namespace: string; limit: number; windowMs: number; message: string;
  database?: Db; clock?: () => number;
}): RequestHandler {
  const database = options.database ?? db;
  const clock = options.clock ?? Date.now;
  let nextCleanup = 0;
  return async (req, res, next) => {
    try {
      const time = clock();
      const start = Math.floor(time / options.windowMs) * options.windowMs;
      const reset = Math.ceil((start + options.windowMs - time) / 1000);
      const identity = createHmac("sha256", MASTER_KEY).update(`rate:v1:${options.namespace}:${req.ip || req.socket.remoteAddress || "unknown"}`).digest("hex");
      const result = await database.prepare(`INSERT INTO runtime_rate_windows (bucket_key,window_start,hits,expires_at)
        VALUES (?,?,1,?) ON CONFLICT(bucket_key,window_start) DO UPDATE SET hits=runtime_rate_windows.hits+1 RETURNING hits`)
        .get(identity, start, start + options.windowMs * 2) as { hits: number };
      res.setHeader("RateLimit-Policy", `${options.limit};w=${Math.ceil(options.windowMs / 1000)}`);
      res.setHeader("RateLimit", `limit=${options.limit}, remaining=${Math.max(0, options.limit - Number(result.hits))}, reset=${reset}`);
      if (time >= nextCleanup) {
        nextCleanup = time + 60_000;
        await database.prepare("DELETE FROM runtime_rate_windows WHERE expires_at<=?").run(time);
      }
      if (Number(result.hits) > options.limit) {
        res.setHeader("Retry-After", String(reset));
        res.status(429).json({ error: options.message }); return;
      }
      next();
    } catch {
      console.error(JSON.stringify({ type: "rate_limit.unavailable", namespace: options.namespace }));
      res.setHeader("Retry-After", "5");
      res.status(503).json({ error: "Request protection is temporarily unavailable. Please retry." });
    }
  };
}
