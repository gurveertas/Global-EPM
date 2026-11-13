import { Queue } from "bullmq";
import { env } from "./env";
import { logger } from "./logger";

/** Queue names shared with apps/worker. */
export const QUEUES = { email: "email", tenant: "tenant-jobs", scheduler: "scheduler" } as const;

const connection = { url: env.REDIS_URL };
let emailQueue: Queue | null = null;
let tenantQueue: Queue | null = null;

export function getEmailQueue() {
  return (emailQueue ??= new Queue(QUEUES.email, { connection }));
}
export function getTenantQueue() {
  return (tenantQueue ??= new Queue(QUEUES.tenant, { connection }));
}

export interface EmailJob {
  to: string;
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
  attachments?: { filename: string; contentBase64: string; contentType?: string }[];
}

/** Emails go through the worker so a slow mail server never slows a request. */
export async function enqueueEmail(job: EmailJob) {
  if (env.NODE_ENV === "test") return;
  try {
    await getEmailQueue().add("send", job, { attempts: 5, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 1000 });
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "could not queue email");
  }
}

/** Company jobs carry the company id; the worker runs at most one heavy job per company at a time. */
export async function enqueueTenantJob(name: string, tenantId: string, data: Record<string, unknown> = {}, jobId?: string) {
  if (env.NODE_ENV === "test") return;
  await getTenantQueue().add(name, { tenantId, ...data }, { jobId, attempts: 3, backoff: { type: "exponential", delay: 60_000 }, removeOnComplete: 500, removeOnFail: 1000 });
}
