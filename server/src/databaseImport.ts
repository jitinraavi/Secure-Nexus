import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { PostgresClient, PostgresPool } from "./postgresDatabase.js";

const quote = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Unsupported database identifier");
  return `"${name}"`;
};
function digest(row: Record<string, unknown>, columns: string[], integers: Set<string>): string {
  const data = columns.map(name => {
    const value = row[name];
    if (value === null) return null;
    if (integers.has(name)) return String(value);
    if (value instanceof Uint8Array) return { binary: Buffer.from(value).toString("base64") };
    return value;
  });
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

/** Read a consistent source snapshot and import only into a completely empty target. */
export async function importSqliteDatabase(sourcePath: string, pool: PostgresPool): Promise<{ tables: number; rows: number; verified: true }> {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  let client: PostgresClient | undefined;
  let sourceTransaction = false;
  try {
    const integrity = source.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    if (integrity.integrity_check !== "ok" || source.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Source integrity check failed");
    source.exec("BEGIN"); sourceTransaction = true;
    const tables = (source.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(row => row.name);
    const dependencies = new Map(tables.map(table => [table, (source.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all() as { table: string }[]).map(row => row.table).filter(parent => parent !== table)]));
    const sorted: string[] = [], visiting = new Set<string>();
    function visit(table: string) {
      if (sorted.includes(table)) return;
      if (visiting.has(table) || !dependencies.has(table)) throw new Error("Unsupported source foreign-key graph");
      visiting.add(table);
      for (const parent of dependencies.get(table)!) visit(parent);
      visiting.delete(table); sorted.push(table);
    }
    for (const table of tables) visit(table);
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(711326018359731::bigint)");
    await client.query("SET LOCAL statement_timeout='120000ms'");
    const targetTables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='groundwork' AND table_type='BASE TABLE' AND table_name<>'schema_migrations'");
    const targetNames = targetTables.rows.map(row => String(row.table_name)).sort();
    if (JSON.stringify(targetNames) !== JSON.stringify([...tables].sort())) throw new Error("Source and target schema tables differ");
    // Lock the empty destination before inspecting counts: concurrent imports cannot mix data.
    await client.query(`LOCK TABLE ${targetNames.map(table => `groundwork.${quote(table)}`).join(",")} IN ACCESS EXCLUSIVE MODE`);
    for (const table of targetNames) {
      const count = await client.query(`SELECT count(*) AS count FROM groundwork.${quote(table)}`);
      if (Number(count.rows[0].count) !== 0) throw new Error("Import refused: target already contains application data");
    }
    let rows = 0;
    for (const table of sorted) {
      const info = source.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string; type: string }[];
      const columns = info.map(column => column.name);
      const integers = new Set(info.filter(column => /INT/i.test(column.type)).map(column => column.name));
      const targetColumns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='groundwork' AND table_name=$1 ORDER BY ordinal_position", [table]);
      if (JSON.stringify(targetColumns.rows.map(row => row.column_name).sort()) !== JSON.stringify([...columns].sort())) throw new Error("Source and target columns differ");
      const statement = source.prepare(`SELECT ${columns.map(quote).join(",")} FROM ${quote(table)}`);
      statement.setReadBigInts(true);
      let count = 0;
      for (const row of statement.iterate()) {
        const values = columns.map(name => typeof row[name] === "bigint" ? String(row[name]) : row[name] instanceof Uint8Array ? Buffer.from(row[name] as Uint8Array) : row[name]);
        const result = await client.query(`INSERT INTO groundwork.${quote(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(",")}) RETURNING ${columns.map(quote).join(",")}`, values);
        if (result.rowCount !== 1 || digest(row, columns, integers) !== digest(result.rows[0], columns, integers)) throw new Error("Imported row verification failed");
        count++; rows++;
      }
      const actual = await client.query(`SELECT count(*) AS count FROM groundwork.${quote(table)}`);
      if (Number(actual.rows[0].count) !== count) throw new Error("Imported table count differs");
    }
    const identities = await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='groundwork' AND is_identity='YES'");
    for (const row of identities.rows) {
      const table = String(row.table_name), column = String(row.column_name);
      await client.query(`SELECT setval(pg_get_serial_sequence($1,$2), COALESCE(MAX(${quote(column)}),1), MAX(${quote(column)}) IS NOT NULL) FROM groundwork.${quote(table)}`, [`groundwork.${table}`, column]);
    }
    await client.query("COMMIT");
    source.exec("ROLLBACK"); sourceTransaction = false;
    return { tables: tables.length, rows, verified: true };
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => undefined);
    const safe = new Error(error instanceof Error && /^(Source|Import refused|Unsupported|Imported)/.test(error.message) ? error.message : "Database import failed; no target data was committed");
    Object.defineProperty(safe, "cause", { value: error });
    throw safe;
  } finally {
    if (sourceTransaction) source.exec("ROLLBACK");
    source.close(); client?.release();
  }
}
