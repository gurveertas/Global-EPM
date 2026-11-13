import type { Db } from "@eszy/db";
import { enqueueEmail } from "../lib/queue";
import { companyUrl } from "../lib/env";
import { setSubscriptionState } from "../services/subscriptions";
import { logger } from "../lib/logger";

/** Grace rules: 7 days of reminders with full access, then 14 days read-only, then suspended. */
export const GRACE_FULL_DAYS = 7;
export const GRACE_READ_ONLY_DAYS = 14;

async function ownerEmail(db: Db, tenantId: string) {
  await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  const r = (await db.query("SELECT email, name FROM users WHERE is_owner LIMIT 1")).rows[0];
  await db.query("SELECT set_config('app.tenant_id', '', true)");
  return r;
}

/** Runs on the platform layer once an hour. */
export async function runLifecycle(db: Db) {
  const out = { trialsEnded: 0, readOnly: 0, suspended: 0, deleted: 0 };

  // Trial over and no paid plan: treat like a failed renewal.
  for (const t of (await db.query("SELECT t.id, t.slug, t.name FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id WHERE s.status = 'trialing' AND t.trial_ends_at < now()")).rows) {
    await setSubscriptionState(db, t.id, { status: "past_due" });
    const o = await ownerEmail(db, t.id);
    if (o) await enqueueEmail({ to: o.email, subject: "Your eszy trial has ended", text: `Hi ${o.name},\n\nThe free trial for ${t.name} has ended. Choose a plan within ${GRACE_FULL_DAYS} days to keep full access:\n${companyUrl(t.slug, "/settings/subscription")}\n` });
    out.trialsEnded++;
  }
  for (const t of (await db.query(`SELECT t.id, t.slug, t.name FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id WHERE s.status = 'past_due' AND s.payment_failed_at < now() - make_interval(days => $1)`, [GRACE_FULL_DAYS])).rows) {
    await setSubscriptionState(db, t.id, { status: "read_only" });
    const o = await ownerEmail(db, t.id);
    if (o) await enqueueEmail({ to: o.email, subject: "eszy is now read-only", text: `Hi ${o.name},\n\n${t.name} is read-only because the plan wasn't renewed. Renew within ${GRACE_READ_ONLY_DAYS} days to avoid suspension:\n${companyUrl(t.slug, "/settings/subscription")}\n` });
    out.readOnly++;
  }
  for (const t of (await db.query(`SELECT t.id FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id WHERE s.status = 'read_only' AND s.payment_failed_at < now() - make_interval(days => $1)`, [GRACE_FULL_DAYS + GRACE_READ_ONLY_DAYS])).rows) {
    await setSubscriptionState(db, t.id, { status: "suspended" });
    out.suspended++;
  }
  // Suspended companies are treated as cancelled for data retention.
  await db.query("UPDATE tenants SET cancelled_at = coalesce(cancelled_at, now()), delete_after = coalesce(delete_after, now() + interval '3 months') WHERE status = 'suspended'");
  // Data is kept 3 months after cancelling, then deleted (every company table cascades from tenants).
  for (const t of (await db.query("SELECT id, slug FROM tenants WHERE status IN ('cancelled','suspended') AND delete_after < now()")).rows) {
    await db.query("DELETE FROM tenants WHERE id = $1", [t.id]);
    logger.warn({ tenant: t.slug }, "company data deleted after retention period");
    out.deleted++;
  }
  return out;
}
