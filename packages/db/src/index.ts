import pg from "pg";
export { loadEnv } from "./load-env";

// bigint (int8) and numeric come back as strings by default; money values fit safely in a JS number.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v); // date stays "YYYY-MM-DD"

export type Db = pg.PoolClient;
export type Pool = pg.Pool;

export function createPool(url = process.env.DATABASE_URL): pg.Pool {
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_SIZE ?? 20) });
  // An idle connection can drop (database restart, failover). Without this handler Node exits; with it the pool reconnects.
  pool.on("error", (err) => console.error(JSON.stringify({ level: 50, msg: "idle database connection lost", err: err.message })));
  return pool;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15000);

/**
 * Run fn inside a transaction scoped to one company. Row-level security only shows that company's rows.
 * Every statement has a time limit (15 s for requests by default, longer for background jobs),
 * so one heavy query can't hold the database for everyone else.
 */
export async function withTenant<T>(pool: pg.Pool, tenantId: string, fn: (db: Db) => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('statement_timeout', $2, true)", [tenantId, String(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Platform-level transaction (tenants, plans, subscriptions). Company tables return nothing here. */
export async function withPlatform<T>(pool: pg.Pool, fn: (db: Db) => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [String(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function one<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await db.query(sql, params);
  return (r.rows[0] as T) ?? null;
}
export async function many<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query(sql, params);
  return r.rows as T[];
}

export { provisionTenant, creditLeave } from "./provision";
