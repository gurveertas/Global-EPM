import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { withPlatform, withTenant } from "@eszy/db";
import { pool } from "./lib/context";
import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { QUEUES, getTenantQueue, type EmailJob } from "./lib/queue";
import { sendEmail } from "./lib/mailer";
import { getSettings } from "./lib/settings";
import { runDaily, backupNow } from "./jobs/daily";
import { runLifecycle } from "./jobs/lifecycle";
import { fetchBackup, restoreTenant } from "./services/backups";

/**
 * eszy worker.
 *  - scheduler: every hour, runs subscription lifecycle and queues one "daily" job per company per day.
 *  - tenant-jobs: company jobs. A Redis lock allows one running job per company, so a big company
 *    can never hold up the others; a busy company's job waits a minute and tries again.
 *  - email: sends mail with retries.
 */
const connection = { url: env.REDIS_URL };
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 8);

async function withCompanyLock<T>(tenantId: string, job: Job, fn: () => Promise<T>): Promise<T | undefined> {
  const key = `lock:tenant:${tenantId}`;
  const ok = await redis.set(key, job.id ?? "1", "EX", 15 * 60, "NX");
  if (!ok) {
    await getTenantQueue().add(job.name, job.data, { delay: 60_000, attempts: 3 });
    return undefined;
  }
  try {
    return await fn();
  } finally {
    await redis.del(key);
  }
}

const tenantWorker = new Worker(QUEUES.tenant, async (job) => {
  const { tenantId } = job.data as { tenantId: string };
  const tenant = await withPlatform(pool, async (db) => (await db.query("SELECT id, slug, status FROM tenants WHERE id = $1", [tenantId])).rows[0]);
  if (!tenant || ["suspended", "cancelled"].includes(tenant.status)) return { skipped: true };
  const run = () => withTenant(pool, tenantId, async (db) => {
      if (job.name === "daily") return runDaily(db, tenant);
      if (job.name === "restore") {
        const { key, restoreId } = job.data as { key: string; restoreId: string };
        try {
          const s = await getSettings(db);
          const dump = await fetchBackup(s.backups, key);
          const out = await restoreTenant(db, dump);
          await db.query("UPDATE restores SET status = 'done', finished_at = now() WHERE id = $1", [restoreId]).catch(() => {});
          await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL");
          return out;
        } catch (e) {
          throw e;
        }
      }
      if (job.name === "backup") {
        const s = await getSettings(db);
        await backupNow(db, tenant.slug, s.backups);
        return { backup: true };
      }
      throw new Error(`Unknown job ${job.name}`);
    }, { timeoutMs: 10 * 60_000 });
  return withCompanyLock(tenantId, job, async () => {
    try {
      return await run();
    } catch (e) {
      if (job.name === "restore") {
        // The restore rolled back, so the company's data is as it was. Record why.
        await withTenant(pool, tenantId, (db) => db.query("UPDATE restores SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [(job.data as any).restoreId, (e as Error).message.slice(0, 500)]));
      }
      throw e;
    }
  });
}, { connection, concurrency: CONCURRENCY });

const emailWorker = new Worker(QUEUES.email, async (job) => sendEmail(job.data as EmailJob), { connection, concurrency: 4, limiter: { max: 14, duration: 1000 } });

const scheduler = new Queue(QUEUES.scheduler, { connection });
await scheduler.upsertJobScheduler("hourly", { every: 60 * 60 * 1000 }, { name: "tick" });
const schedulerWorker = new Worker(QUEUES.scheduler, async () => {
  const life = await withPlatform(pool, (db) => runLifecycle(db));
  const tenants = await withPlatform(pool, async (db) => (await db.query("SELECT id FROM tenants WHERE status IN ('trial','active','past_due','read_only')")).rows);
  const day = new Date().toISOString().slice(0, 10);
  for (const t of tenants) {
    // jobId makes this once per company per day, however often the tick runs.
    await getTenantQueue().add("daily", { tenantId: t.id }, { jobId: `daily-${t.id}-${day}`, removeOnComplete: 2000, removeOnFail: 2000, attempts: 3, backoff: { type: "exponential", delay: 300_000 } });
  }
  return { ...life, queued: tenants.length };
}, { connection, concurrency: 1 });

for (const w of [tenantWorker, emailWorker, schedulerWorker]) {
  w.on("failed", (job, err) => logger.error({ queue: w.name, job: job?.name, id: job?.id, err: err.message }, "job failed"));
  w.on("completed", (job, out) => logger.info({ queue: w.name, job: job.name, out }, "job done"));
}
await scheduler.add("tick", {}, { jobId: `boot-${Date.now()}` });
logger.info(`eszy worker running (concurrency ${CONCURRENCY})`);

const shutdown = async () => {
  await Promise.all([tenantWorker.close(), emailWorker.close(), schedulerWorker.close()]);
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
