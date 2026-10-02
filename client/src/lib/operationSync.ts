import { organizationRequest } from "./organizationApi";

export type CoordinationField = "title" | "body" | "status" | "assignee" | "dueDate" | "deleted";
export interface CoordinationOperation { operationId: string; clientId: string; logicalClock: number; entityId: string; field: CoordinationField; value: string | boolean }
export interface CoordinationRegister extends CoordinationOperation { sequence: number }
export interface CoordinationRecord { id: string; title: string; body: string; status: string; assignee: string; dueDate: string; deleted: boolean }
interface DurableQueue { version: 1; clientId: string; clock: number; pending: CoordinationOperation[] }
export interface CoordinationSyncStatus { pending: number; durable: boolean; backend: string; error: string | null; syncing: boolean }
const validFields = new Set<CoordinationField>(["title", "body", "status", "assignee", "dueDate", "deleted"]);
function validOperation(value: unknown): value is CoordinationOperation {
  if (!value || typeof value !== "object") return false;
  const op = value as CoordinationOperation;
  return typeof op.operationId === "string" && /^[A-Za-z0-9_.-]{8,120}$/.test(op.operationId) && typeof op.clientId === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(op.clientId) && Number.isSafeInteger(op.logicalClock) && op.logicalClock > 0 && op.logicalClock <= 1_000_000_000 && typeof op.entityId === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(op.entityId) && validFields.has(op.field) && (typeof op.value === "boolean" || (typeof op.value === "string" && op.value.length <= 10000));
}
function wins(a: CoordinationRegister, b?: CoordinationRegister) {
  return !b || a.logicalClock > b.logicalClock || (a.logicalClock === b.logicalClock && (a.clientId > b.clientId || (a.clientId === b.clientId && a.operationId > b.operationId)));
}
/** Durable offline coordination queue. Nothing in this module mutates CAD design
 * documents; geometry saves continue to use explicit revision/conflict gates. */
export class CoordinationSync {
  private queue: DurableQueue = { version: 1, clientId: crypto.randomUUID(), clock: 0, pending: [] };
  private registers = new Map<string, CoordinationRegister>();
  private cursor = 0;
  private running = false;
  private stopped = false;
  private durable = true;
  private backend = "unknown";
  private error: string | null = null;
  private storageKey: string;
  private storageBlocked = false;
  private recoveryIncomplete = false;
  private recoveryRecords: { key: string; raw: string }[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private changed: () => void;
  constructor(private userId: string, private projectId: string, changed: () => void) {
    this.changed = changed;
    this.storageKey = `groundwork:coordination-operation:v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}:`;
    this.loadPending();
  }
  private loadPending(): void {
    try {
      // Each operation is immutable and has its own key. Separate pages never
      // overwrite another page's pending queue or reuse its client identity.
      const all = new Map(this.queue.pending.map((operation) => [operation.operationId, operation]));
      let size = 0, count = 0;
      if (localStorage.length > 10000) { this.storageBlocked = true; this.recoveryIncomplete = true; throw new Error("Browser storage has too many records to recover safely; original records are preserved. Repair storage and reopen this workspace."); }
      for (let index = 0; index < localStorage.length; index += 1) {
        const storageKey = localStorage.key(index);
        if (!storageKey?.startsWith(this.storageKey)) continue;
        const raw = localStorage.getItem(storageKey) || "";
        size += raw.length; count += 1;
        if (count > 200 || size > 2_000_000) {
          this.queue.pending = [...all.values()].sort((a, b) => a.logicalClock - b.logicalClock || a.operationId.localeCompare(b.operationId));
          this.storageBlocked = true; this.recoveryIncomplete = true;
          throw new Error("Stored coordination operations exceed recovery limits. Export is partial; original records are preserved. Repair storage and reopen this workspace.");
        }
        let operation: unknown;
        try { operation = JSON.parse(raw) as unknown; } catch { operation = null; }
        if (!validOperation(operation) || storageKey !== `${this.storageKey}${operation.operationId}`) {
          if (!this.recoveryRecords.some((record) => record.key === storageKey)) this.recoveryRecords.push({ key: storageKey, raw });
          this.storageBlocked = true; this.error = "An invalid stored operation is preserved. Export pending recovery data before clearing the damaged browser record.";
          continue;
        }
        if (!all.has(operation.operationId) && all.size >= 200) {
          this.storageBlocked = true; this.recoveryIncomplete = true;
          throw new Error("Combined memory and stored operations exceed the recovery limit; original records are preserved. Repair storage and reopen this workspace.");
        }
        all.set(operation.operationId, operation);
        this.queue.clock = Math.max(this.queue.clock, operation.logicalClock);
      }
      this.queue.pending = [...all.values()].sort((a, b) => a.logicalClock - b.logicalClock || a.operationId.localeCompare(b.operationId));
    } catch (error) { this.durable = false; this.error = error instanceof Error ? error.message : "Browser storage is unavailable; queued edits last only in this tab"; }
  }
  status(): CoordinationSyncStatus { return { pending: this.queue.pending.length, durable: this.durable, backend: this.backend, error: this.error, syncing: this.running }; }
  records(): CoordinationRecord[] {
    const all = new Map<string, CoordinationRecord>();
    const apply = (register: CoordinationRegister) => {
      let record = all.get(register.entityId);
      if (!record) { record = { id: register.entityId, title: "Untitled issue", body: "", status: "open", assignee: "", dueDate: "", deleted: false }; all.set(record.id, record); }
      if (register.field === "deleted") record.deleted = register.value === true;
      else record[register.field] = String(register.value);
    };
    const optimistic = new Map(this.registers);
    for (const operation of this.queue.pending) {
      const register = { ...operation, clientId: `${this.userId}:${operation.clientId}`, sequence: 0 };
      const key = `${register.entityId}|${register.field}`;
      if (wins(register, optimistic.get(key))) optimistic.set(key, register);
    }
    for (const register of optimistic.values()) apply(register);
    return [...all.values()].filter((record) => !record.deleted).sort((a, b) => a.id.localeCompare(b.id));
  }
  enqueue(entityId: string, field: CoordinationField, value: string | boolean): void {
    if (this.stopped) throw new Error("Coordination workspace is closed");
    if (this.storageBlocked) throw new Error("Export and repair the damaged browser operation before adding edits");
    this.loadPending();
    if (this.storageBlocked) throw new Error("Export and repair the damaged browser operation before adding edits");
    if (this.queue.pending.length >= 200) throw new Error("Offline queue is full; synchronize before editing more issues");
    const logicalClock = this.queue.clock + 1;
    const operation: CoordinationOperation = { operationId: crypto.randomUUID(), clientId: this.queue.clientId, logicalClock, entityId, field, value };
    if (!validOperation(operation)) throw new Error("Invalid coordination edit");
    const next = { ...this.queue, clock: logicalClock, pending: [...this.queue.pending, operation] };
    const serialized = JSON.stringify(next);
    if (serialized.length > 2_000_000) throw new Error("Offline queue exceeds browser storage limit");
    try { localStorage.setItem(`${this.storageKey}${operation.operationId}`, JSON.stringify(operation)); }
    catch { this.durable = false; this.error = "The edit is queued in memory; browser storage could not save it"; }
    this.queue = next; this.changed();
    void this.synchronize();
  }
  private persist(): void {
    // Writes are idempotent per immutable operation; malformed records are never
    // overwritten or removed by recovery, synchronization or closing the page.
    try {
      for (const operation of this.queue.pending) {
        const key = `${this.storageKey}${operation.operationId}`, raw = JSON.stringify(operation);
        const existing = localStorage.getItem(key);
        if (existing === null) localStorage.setItem(key, raw);
        else if (existing !== raw && !this.recoveryRecords.some((record) => record.key === key)) {
          this.recoveryRecords.push({ key, raw: existing }); this.storageBlocked = true;
        }
      }
    }
    catch { this.durable = false; }
  }
  async start(): Promise<void> {
    await this.synchronize(true);
    if (!this.stopped) this.interval = setInterval(() => { void this.synchronize(); }, 4000);
  }
  async synchronize(snapshot = false): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true; this.changed();
    this.loadPending();
    const path = `/api/collaboration/${encodeURIComponent(this.projectId)}/sync`;
    try {
      for (let page = 0; page < 20; page += 1) {
        const result = await organizationRequest<{ registers: CoordinationRegister[]; cursor: number; maxClock: number; backend: string }>(`${path}?${snapshot && page === 0 ? "snapshot=1" : `after=${this.cursor}`}`);
        if (this.stopped) return;
        if (!Array.isArray(result.registers) || result.registers.length > 10000 || !Number.isSafeInteger(result.cursor) || !Number.isSafeInteger(result.maxClock)) throw new Error("Invalid synchronization response");
        if (this.backend !== "unknown" && this.backend !== result.backend) throw new Error("The collaboration backend changed; reopen the workspace after the server migration");
        this.backend = result.backend;
        if (snapshot && page === 0) this.registers.clear();
        for (const register of result.registers) {
          if (!validFields.has(register.field) || !Number.isSafeInteger(register.logicalClock)) throw new Error("Invalid synchronization register");
          const key = `${register.entityId}|${register.field}`;
          if (wins(register, this.registers.get(key))) this.registers.set(key, register);
        }
        this.cursor = result.cursor; this.queue.clock = Math.max(this.queue.clock, result.maxClock);
        if (snapshot || result.registers.length < 200) break;
      }
      while (this.queue.pending.length && !this.stopped) {
        const operation = this.queue.pending[0];
        const accepted = await organizationRequest<{ sequence: number; register: CoordinationRegister; maxClock?: number }>(path, "POST", operation);
        if (this.stopped) return;
        const register = accepted.register;
        if (!register || register.entityId !== operation.entityId || register.field !== operation.field || !Number.isSafeInteger(register.logicalClock) || register.logicalClock < 1 || register.logicalClock > 1_000_000_000) throw new Error("Server did not return the effective coordination register");
        if (accepted.maxClock !== undefined && (!Number.isSafeInteger(accepted.maxClock) || accepted.maxClock < 0 || accepted.maxClock > 1_000_000_000)) throw new Error("Server returned an invalid logical clock");
        this.queue.clock = Math.max(this.queue.clock, register.logicalClock, accepted.maxClock ?? 0);
        const registerKey = `${register.entityId}|${register.field}`;
        if (wins(register, this.registers.get(registerKey))) this.registers.set(registerKey, register);
        this.queue.pending = this.queue.pending.filter((item) => item.operationId !== operation.operationId);
        try {
          const key = `${this.storageKey}${operation.operationId}`, existing = localStorage.getItem(key);
          if (existing === JSON.stringify(operation)) localStorage.removeItem(key);
          else if (existing !== null && !this.recoveryRecords.some((record) => record.key === key)) { this.recoveryRecords.push({ key, raw: existing }); this.storageBlocked = true; }
        } catch { this.durable = false; }
        this.changed();
      }
      this.persist(); this.error = this.storageBlocked ? this.recoveryIncomplete ? "Recovery exceeded its limit. Export is partial and original records remain preserved; repair storage and reopen the workspace." : "Invalid operation data remains preserved; export recovery data before clearing it" : this.durable ? null : "Browser storage is unavailable; keep this tab open until pending edits synchronize";
    } catch (error) { this.error = error instanceof Error ? error.message : "Synchronization failed; edits remain queued"; }
    finally { this.running = false; if (!this.stopped) this.changed(); }
  }
  exportQueue(): string { return JSON.stringify({ userId: this.userId, projectId: this.projectId, ...this.queue, invalidRecords: this.recoveryRecords, recoveryIncomplete: this.recoveryIncomplete, ...(this.recoveryIncomplete ? { recoveryNotice: "Partial export: records beyond the recovery budget remain untouched in browser storage. Preserve site data before repairing storage." } : {}) }, null, 2); }
  stop(): void { this.stopped = true; if (this.interval) clearInterval(this.interval); this.persist(); }
}
