import { Pool } from "pg";
import { DATABASE, DB_PATH } from "./config.js";
import { createPostgresAdapter, migratePostgres, postgresPoolConfiguration } from "./postgresDatabase.js";
import { importSqliteDatabase } from "./databaseImport.js";

const command = process.argv[2];
try {
  if (command === "migrate") {
    if (!DATABASE.adminUrl) throw new Error("Set a private DATABASE_ADMIN_URL for migrations");
    await migratePostgres(DATABASE.adminUrl, { sslCa: DATABASE.sslCa });
    console.log("[database] Supabase schema migration verified.");
  } else if (command === "import") {
    if (!DATABASE.adminUrl) throw new Error("Set a private DATABASE_ADMIN_URL with import privileges");
    const source = process.argv[3] || DB_PATH;
    const pool = new Pool(postgresPoolConfiguration({ ...DATABASE, url: DATABASE.adminUrl, poolMax: 1 }));
    try { console.log(JSON.stringify(await importSqliteDatabase(source, pool))); }
    finally { await pool.end(); }
  } else if (command === "verify") {
    if (DATABASE.provider !== "supabase") throw new Error("Select DATABASE_PROVIDER=supabase and set the private DATABASE_URL first");
    const adapter = await createPostgresAdapter(DATABASE);
    try {
      const row = await adapter.db.prepare("SELECT 1 AS ok").get() as { ok: number };
      if (row.ok !== 1) throw new Error("Database check failed");
      console.log("[database] Verified Supabase connection and application schema.");
    } finally { await adapter.db.close(); }
  } else throw new Error("Use migrate, import [sqlite-path], or verify");
} catch (error) {
  console.error("[database]", error instanceof Error ? error.message : "Database operation failed");
  process.exitCode = 1;
}
