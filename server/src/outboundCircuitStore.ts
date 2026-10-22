import { db, withTransaction } from "./db.js";
import { CircuitOpenError, type CircuitState, type CircuitStore } from "./runtimeResilience.js";

/** Existing database transactions serialize writers across API instances. No
 * provider network operation runs inside this short storage transaction. */
export class DatabaseCircuitStore implements CircuitStore {
  constructor(private readonly maximumEntries = 128, private readonly ttlMs = 3_600_000) {}
  async update<T>(key: string, work: (state: CircuitState | undefined) => { state?: CircuitState; result: T }): Promise<T> {
    return withTransaction(async () => {
      const now = Date.now();
      await db.prepare("DELETE FROM outbound_circuits WHERE updated_at<? AND open_until<? AND probe_until<?").run(now - this.ttlMs, now, now);
      const row = await db.prepare("SELECT failures,open_until,probe_until,generation,updated_at FROM outbound_circuits WHERE key=?").get(key) as { failures: number; open_until: number; probe_until: number; generation: number; updated_at: number } | undefined;
      if (!row) {
        const total = await db.prepare("SELECT COUNT(*) AS count FROM outbound_circuits").get() as { count: number };
        if (total.count >= this.maximumEntries) throw new CircuitOpenError(1_000, "Outbound circuit capacity is busy");
      }
      const previous = row ? { failures: row.failures, openUntil: row.open_until, probeUntil: row.probe_until, generation: row.generation, updatedAt: row.updated_at } : undefined;
      const next = work(previous);
      if (next.state) {
        const state = next.state;
        await db.prepare(`INSERT INTO outbound_circuits(key,failures,open_until,probe_until,generation,updated_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,open_until=excluded.open_until,probe_until=excluded.probe_until,generation=excluded.generation,updated_at=excluded.updated_at`)
          .run(key, state.failures, state.openUntil, state.probeUntil, state.generation, state.updatedAt);
      } else if (row) await db.prepare("DELETE FROM outbound_circuits WHERE key=?").run(key);
      return next.result;
    });
  }
  async remove(key: string): Promise<void> { await withTransaction(() => db.prepare("DELETE FROM outbound_circuits WHERE key=?").run(key)); }
}
