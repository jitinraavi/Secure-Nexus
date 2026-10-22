/** Circuit storage is injectable so production can share admission across instances.
 * MemoryCircuitStore is explicitly process-local and bounds both keys and lifetime. */
export interface CircuitState { failures: number; openUntil: number; probeUntil: number; generation: number; updatedAt: number }
export interface CircuitStore {
  update<T>(key: string, work: (state: CircuitState | undefined) => { state?: CircuitState; result: T }): Promise<T>;
  remove(key: string): Promise<void>;
}
export class MemoryCircuitStore implements CircuitStore {
  private readonly states = new Map<string, CircuitState>();
  constructor(private readonly maximumEntries = 128, private readonly ttlMs = 3_600_000, private readonly clock = Date.now) {}
  async update<T>(key: string, work: (state: CircuitState | undefined) => { state?: CircuitState; result: T }): Promise<T> {
    const now = this.clock();
    for (const [name, state] of this.states) if (state.updatedAt + this.ttlMs < now && state.openUntil < now && state.probeUntil < now) this.states.delete(name);
    const current = this.states.get(key);
    if (!current && this.states.size >= this.maximumEntries) throw new CircuitOpenError(1_000, "Outbound circuit capacity is busy");
    const next = work(current ? { ...current } : undefined);
    if (next.state) this.states.set(key, next.state); else this.states.delete(key);
    return next.result;
  }
  async remove(key: string): Promise<void> { this.states.delete(key); }
  get size(): number { return this.states.size; }
}
export class CircuitOpenError extends Error {
  readonly status = 503;
  readonly code = "OUTBOUND_CIRCUIT_OPEN";
  constructor(public readonly retryAfterMs: number, message = "Provider is temporarily unavailable; retry after the recovery interval") { super(message); this.name = "CircuitOpenError"; }
}
export interface CircuitSettings { failureThreshold: number; cooldownMs: number; probeLeaseMs: number }
export interface CircuitPermit { key: string; generation: number; probe: boolean }
export class CircuitBreaker {
  constructor(private readonly store: CircuitStore, private readonly settings: CircuitSettings, private readonly clock = Date.now) {}
  async acquire(key: string): Promise<CircuitPermit> {
    if (!/^[a-z0-9:/. _-]{1,240}$/i.test(key)) throw new Error("Invalid outbound circuit key");
    return this.store.update(key, (previous) => {
      const now = this.clock(), state = previous ?? { failures: 0, openUntil: 0, probeUntil: 0, generation: 0, updatedAt: now };
      if (state.openUntil > now || state.probeUntil > now) throw new CircuitOpenError(Math.max(state.openUntil, state.probeUntil) - now);
      const probe = state.openUntil > 0;
      if (probe) { state.generation += 1; state.probeUntil = now + this.settings.probeLeaseMs; }
      state.updatedAt = now;
      return { state, result: { key, generation: state.generation, probe } };
    });
  }
  async complete(permit: CircuitPermit, outcome: "success" | "failure" | "cancelled"): Promise<void> {
    await this.store.update(permit.key, (state) => {
      if (!state || state.generation !== permit.generation) return { state, result: undefined };
      const now = this.clock();
      state.updatedAt = now;
      if (outcome === "cancelled") { if (permit.probe) state.probeUntil = 0; return { state, result: undefined }; }
      if (outcome === "success") { state.failures = 0; state.openUntil = 0; state.probeUntil = 0; if (permit.probe) state.generation += 1; }
      else {
        state.failures += 1;
        if (permit.probe || state.failures >= this.settings.failureThreshold) {
          state.openUntil = now + this.settings.cooldownMs; state.probeUntil = 0; state.generation += 1;
        }
      }
      return { state, result: undefined };
    });
  }
  /** Administrative recovery control; callers must enforce administrator authorization. */
  async reset(key: string): Promise<void> {
    await this.store.update(key, state => ({ state: { failures: 0, openUntil: 0, probeUntil: 0, generation: (state?.generation ?? 0) + 1, updatedAt: this.clock() }, result: undefined }));
  }
}
