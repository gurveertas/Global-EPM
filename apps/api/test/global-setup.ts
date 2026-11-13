import pg from "pg";
import { migrate } from "../../../packages/db/src/migrate";
import { seed } from "../../../packages/db/src/seed";

/** Fresh test database each run: drop, create, migrate, seed plans and the platform admin. */
export default async function () {
  const admin = process.env.TEST_ADMIN_URL ?? "postgres://eszy_owner:owner@localhost:5432/postgres";
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query("DROP DATABASE IF EXISTS eszy_test WITH (FORCE)");
  await c.query("CREATE DATABASE eszy_test OWNER eszy_owner");
  await c.end();
  const url = admin.replace(/\/postgres$/, "/eszy_test");
  await migrate(url);
  process.env.PLATFORM_ADMIN_EMAIL = "owner@eszy.test";
  process.env.PLATFORM_ADMIN_PASSWORD = "platform-pass";
  await seed(url);
}
