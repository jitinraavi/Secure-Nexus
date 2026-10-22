import { AsyncLocalStorage } from "node:async_hooks";
import { DATABASE } from "./config.js";
import { runCommitEffects, type CommitEffect } from "./databaseEffects.js";
import { withOperationalSpan } from "./telemetry.js";

export interface RunResult { changes: number; lastInsertRowid: number | bigint; }
export interface Statement {
  get(...parameters: unknown[]): Promise<unknown | undefined>;
  all(...parameters: unknown[]): Promise<unknown[]>;
  run(...parameters: unknown[]): Promise<RunResult>;
}
export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}
export interface DatabaseAdapter { db: Db; withTransaction<T>(work: () => Promise<T> | T): Promise<T>; afterCommit(work: CommitEffect): Promise<void>; }

/** FIFO ownership prevents a request from entering another request's transaction. */
export class DatabaseMutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(work: () => Promise<T> | T): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }
}

interface SqliteContext { active: boolean; children: DatabaseMutex; effects: CommitEffect[]; }
export function createSqliteAdapter(raw: import("node:sqlite").DatabaseSync): DatabaseAdapter {
  const mutex = new DatabaseMutex();
  const storage = new AsyncLocalStorage<SqliteContext>();
  let savepointId = 0;
  let closed = false;
  function owned<T>(work: () => T): Promise<T> {
    const context = storage.getStore();
    if (context && !context.active) return Promise.reject(new Error("Database transaction has ended"));
    const run = () => { if (closed) throw new Error("Database is closed"); return work(); };
    return context ? Promise.resolve().then(run) : mutex.run(run);
  }
  const sqlite: Db = {
    prepare(sql) {
      return {
        get: (...parameters) => owned(() => raw.prepare(sql).get(...parameters as import("node:sqlite").SQLInputValue[])),
        all: (...parameters) => owned(() => raw.prepare(sql).all(...parameters as import("node:sqlite").SQLInputValue[])),
        run: (...parameters) => owned(() => {
          const result = raw.prepare(sql).run(...parameters as import("node:sqlite").SQLInputValue[]);
          return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
        }),
      };
    },
    exec: (sql) => owned(() => { raw.exec(sql); }),
    close: () => mutex.run(() => { if (!closed) { raw.close(); closed = true; } }),
  };
  async function withSqliteTransaction<T>(work: () => Promise<T> | T): Promise<T> {
    const parent = storage.getStore();
    if (parent && !parent.active) throw new Error("Database transaction has ended");
    const effects: CommitEffect[] = [];
    const execute = async () => {
      if (closed) throw new Error("Database is closed");
      const savepoint = `groundwork_async_${++savepointId}`;
      const context: SqliteContext = { active: true, children: new DatabaseMutex(), effects: [] };
      raw.exec(parent ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
      try {
        const result = await storage.run(context, work);
        raw.exec(parent ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT");
        (parent ? parent.effects : effects).push(...context.effects);
        return result;
      } catch (error) {
        if (parent) { raw.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); raw.exec(`RELEASE SAVEPOINT ${savepoint}`); }
        else raw.exec("ROLLBACK");
        throw error;
      } finally { context.active = false; }
    };
    const result = await (parent ? parent.children.run(execute) : mutex.run(execute));
    if (!parent) await runCommitEffects(effects);
    return result;
  }
  async function afterCommit(work: CommitEffect): Promise<void> {
    const context = storage.getStore();
    if (context && !context.active) throw new Error("Database transaction has ended");
    if (context) context.effects.push(work);
    else await runCommitEffects([work]);
  }
  return { db: sqlite, withTransaction: withSqliteTransaction, afterCommit };
}

// SQLite is never imported/opened when the hosted database is selected.
const adapter: DatabaseAdapter = DATABASE.provider === "supabase"
  ? await (await import("./postgresDatabase.js")).createPostgresAdapter(DATABASE)
  : createSqliteAdapter((await import("./sqliteDatabase.js")).db);

export const db: Db = {
  prepare(sql) {
    const statement = adapter.db.prepare(sql);
    return {
      get: (...values) => withOperationalSpan("db.get", () => statement.get(...values)),
      all: (...values) => withOperationalSpan("db.all", () => statement.all(...values)),
      run: (...values) => withOperationalSpan("db.run", () => statement.run(...values)),
    };
  },
  exec: (sql) => withOperationalSpan("db.exec", () => adapter.db.exec(sql)),
  close: () => adapter.db.close(),
};
export const withTransaction = adapter.withTransaction;
export const afterCommit = adapter.afterCommit;
export function now(): number { return Math.floor(Date.now() / 1000); }
