import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnv } from "./load-env";

/** Applies migrations/*.sql in name order, once each. Uses the owner connection (MIGRATION_DATABASE_URL). */
export async function migrate(url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL) {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`applied ${file}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`${file}: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  loadEnv();
  migrate().then(() => console.log("migrations up to date"), (e) => { console.error(e); process.exit(1); });
}
