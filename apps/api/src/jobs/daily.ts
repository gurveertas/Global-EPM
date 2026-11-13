import type { Db } from "@eszy/db";
import { formatMoney, formatMinutes } from "@eszy/shared";
import { getSettings } from "../lib/settings";
import { addDays, dayOfWeek, todayIn } from "../lib/dates";
import { notify, usersWithRole } from "../lib/audit";
import { enqueueEmail } from "../lib/queue";
import { runProjectBilling } from "../services/invoices";
import { runBackup } from "../services/backups";
import { logger } from "../lib/logger";
import { fireAlerts } from "../lib/alerts";
import { approverFor } from "../services/time";

/**
 * A company's daily run (inside its own row-level-security transaction):
 *  1. create every invoice that is due today (fixed, prepaid, recurring, postpaid),
 *  2. send "due soon" and "overdue" notices (company setting, project can override),
 *  3. remind people who didn't submit yesterday's sheet,
 *  4. back up to the company's own storage when it's scheduled.
 */
export async function runDaily(db: Db, tenant: { id: string; slug: string }) {
  const s = await getSettings(db);
  const today = todayIn(s.locale.timezone);
  const result = { invoices: 0, dueSoon: 0, overdue: 0, reminders: 0, tlReminders: 0, accrued: 0, carried: 0, backup: false };

  const projects = (await db.query("SELECT id FROM projects WHERE status = 'active' OR (status = 'ended' AND billing_type = 'postpaid')")).rows;
  for (const p of projects) {
    await db.query("SAVEPOINT proj");
    try {
      result.invoices += (await runProjectBilling(db, s, p.id, today)).length;
      await db.query("RELEASE SAVEPOINT proj");
    } catch (e) {
      await db.query("ROLLBACK TO SAVEPOINT proj");
      logger.error({ err: (e as Error).message, project: p.id, tenant: tenant.slug }, "billing run failed for project");
    }
  }

  // Due soon / overdue
  const billing = await usersWithRole(db, s.invoices.dueSoonNotifyRoles.length ? s.invoices.dueSoonNotifyRoles : ["billing_manager"]);
  const open = (await db.query(
    `SELECT i.*, c.email AS client_email, c.name AS client_name, p.name AS project_name,
       coalesce(p.due_soon_days, $1) AS ds_days, coalesce(p.due_soon_client_email, $2) AS ds_email
     FROM invoices i JOIN clients c ON c.id = i.client_id JOIN projects p ON p.id = i.project_id
     WHERE i.status IN ('unpaid','partially_paid')`,
    [s.invoices.dueSoonDays, s.invoices.dueSoonClientEmail],
  )).rows;
  for (const inv of open) {
    const left = formatMoney(inv.total_minor - inv.paid_minor, inv.currency);
    const pm = (await db.query("SELECT pm_user_id FROM projects WHERE id = $1", [inv.project_id])).rows[0]?.pm_user_id;
    if (inv.due_date < today) {
      const late = Math.round((Date.parse(today) - Date.parse(inv.due_date)) / 86400000);
      await fireAlerts(db, "invoice.overdue", { key: `${inv.id}`, value: late, title: `${inv.number} is ${late} day(s) overdue`, body: `${inv.client_name}: ${left} outstanding.`, link: `/invoices/${inv.id}`, ownerIds: [pm] });
    } else if (inv.due_date <= addDays(today, inv.ds_days)) {
      await fireAlerts(db, "invoice.due_soon", { key: `${inv.id}:${inv.due_date}`, title: `${inv.number} is due on ${inv.due_date}`, body: `${inv.client_name}: ${left} outstanding.`, link: `/invoices/${inv.id}`, ownerIds: [pm] });
    }
    if (inv.due_date < today && !inv.overdue_notified_at) {
      await notify(db, billing, { kind: "invoice.overdue", title: `${inv.number} is overdue`, body: `${inv.client_name}, ${inv.project_name}: ${left} was due on ${inv.due_date}.`, link: `/invoices/${inv.id}`, email: true });
      await db.query("UPDATE invoices SET overdue_notified_at = now() WHERE id = $1", [inv.id]);
      result.overdue++;
    } else if (inv.due_date >= today && inv.due_date <= addDays(today, inv.ds_days) && !inv.due_soon_notified_at) {
      await notify(db, billing, { kind: "invoice.due_soon", title: `${inv.number} is due on ${inv.due_date}`, body: `${inv.client_name}: ${left} outstanding.`, link: `/invoices/${inv.id}` });
      if (inv.ds_email && inv.client_email) {
        await enqueueEmail({
          to: inv.client_email, fromName: s.branding.emailSenderName,
          subject: `Reminder: invoice ${inv.number} is due on ${inv.due_date}`,
          text: `Hi ${inv.client_name},\n\nA friendly reminder that invoice ${inv.number} (${left}) is due on ${inv.due_date}.\n\n${s.invoices.footer}`,
        });
      }
      await db.query("UPDATE invoices SET due_soon_notified_at = now() WHERE id = $1", [inv.id]);
      result.dueSoon++;
    }
  }

  // Missing sheets for yesterday (working days only, not on leave or a holiday)
  const y = addDays(today, -1);
  if (s.policies.workingDays.includes(dayOfWeek(y)) && !(await db.query("SELECT 1 FROM holidays WHERE date = $1", [y])).rowCount) {
    const missing = (await db.query(
      `SELECT u.id FROM users u WHERE u.status = 'active'
         AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND 'time.own' = ANY(r.permissions))
         AND NOT EXISTS (SELECT 1 FROM sheets s WHERE s.user_id = u.id AND s.date = $1 AND s.status IN ('submitted','approved'))
         AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.user_id = u.id AND l.status = 'approved' AND $1 BETWEEN l.start_date AND l.end_date AND NOT l.half_day)`,
      [y],
    )).rows.map((r) => r.id);
    for (const uid of missing) {
      await fireAlerts(db, "sheet.missing", { key: `${uid}:${y}`, title: `A sheet for ${y} wasn't submitted`, link: "/approvals", ownerIds: [await approverFor(db, uid)] });
    }
    await notify(db, missing, { kind: "sheet.missing", title: `Your sheet for ${y} isn't submitted`, body: `Log at least ${formatMinutes(s.policies.dailyMinimumMinutes)} and submit it.`, link: `/sheet?date=${y}` });
    result.reminders = missing.length;
  }

  // Sheets waiting for the TL longer than the company allows: remind the TL (once a day per sheet).
  if (s.policies.pendingReminderDays > 0) {
    const waiting = (await db.query(
      `SELECT s.id, s.date, s.user_id, u.name, extract(day FROM now() - s.submitted_at)::int AS days FROM sheets s JOIN users u ON u.id = s.user_id
       WHERE s.status = 'submitted' AND s.submitted_at < now() - make_interval(days => $1) AND (s.reminder_sent_at IS NULL OR s.reminder_sent_at < now() - interval '20 hours')`,
      [s.policies.pendingReminderDays],
    )).rows;
    const byLead = new Map<string, any[]>();
    for (const w of waiting) {
      const lead = await approverFor(db, w.user_id);
      if (!lead) continue;
      byLead.set(lead, [...(byLead.get(lead) ?? []), w]);
      await fireAlerts(db, "sheet.pending", { key: `${w.id}:${today}`, value: w.days, title: `${w.name}'s sheet for ${w.date} has waited ${w.days} day(s)`, link: "/approvals", ownerIds: [lead] });
    }
    for (const [lead, list] of byLead) {
      await notify(db, [lead], { kind: "sheet.pending", title: `${list.length} sheet(s) are waiting for your approval`, body: list.slice(0, 5).map((x) => `${x.name}, ${x.date}`).join("; "), link: "/approvals", email: true });
      result.tlReminders++;
    }
    if (waiting.length) await db.query("UPDATE sheets SET reminder_sent_at = now() WHERE id = ANY($1)", [waiting.map((w) => w.id)]);
  }

  // Projects close to their cap (company alert rules decide the percentage).
  const caps = (await db.query(
    `SELECT p.id, p.name, p.pm_user_id, cap.m AS cap, used.m AS used FROM projects p
     JOIN LATERAL (SELECT sum(minutes) AS m FROM billing_lines WHERE project_id = p.id) cap ON cap.m > 0
     JOIN LATERAL (SELECT coalesce(sum(minutes),0) AS m FROM time_entries WHERE project_id = p.id) used ON true
     WHERE p.status = 'active'`,
  )).rows;
  for (const c of caps) {
    const pct = Math.floor((Number(c.used) / Number(c.cap)) * 100);
    await fireAlerts(db, "project.near_cap", { key: `${c.id}:${c.cap}`, value: pct, title: `${c.name} has used ${pct}% of its hours`, body: `${formatMinutes(Number(c.used))} of ${formatMinutes(Number(c.cap))}.`, link: `/projects/${c.id}`, ownerIds: [c.pm_user_id] });
  }

  // Leave: monthly accrual (1/12 of the yearly days each month) and carry-forward into a new year.
  const year = Number(today.slice(0, 4));
  const month = today.slice(0, 7) + "-01";
  result.accrued = (await db.query(
    `INSERT INTO leave_balances (tenant_id, user_id, leave_type_id, year, credited_days, accrued_through)
     SELECT current_setting('app.tenant_id')::uuid, u.id, lt.id, $1, round(lt.yearly_days / 12.0, 1), $2::date
     FROM users u CROSS JOIN leave_types lt WHERE u.status <> 'disabled' AND lt.active AND lt.accrual = 'monthly'
       AND (u.joined_on IS NULL OR u.joined_on <= $2::date + interval '1 month - 1 day')
     ON CONFLICT (user_id, leave_type_id, year) DO UPDATE
       SET credited_days = least(leave_balances.credited_days + round((SELECT yearly_days FROM leave_types WHERE id = EXCLUDED.leave_type_id) / 12.0, 1),
                                 (SELECT yearly_days FROM leave_types WHERE id = EXCLUDED.leave_type_id)),
           accrued_through = EXCLUDED.accrued_through
       WHERE leave_balances.accrued_through IS NULL OR leave_balances.accrued_through < EXCLUDED.accrued_through`,
    [year, month],
  )).rowCount ?? 0;
  result.carried = (await db.query(
    `INSERT INTO leave_balances (tenant_id, user_id, leave_type_id, year, credited_days, carried_days)
     SELECT prev.tenant_id, prev.user_id, prev.leave_type_id, $1, CASE WHEN lt.accrual = 'yearly' THEN lt.yearly_days ELSE 0 END,
            least(lt.carry_forward_max, greatest(0, prev.credited_days + prev.carried_days - prev.used_days))
     FROM leave_balances prev JOIN leave_types lt ON lt.id = prev.leave_type_id JOIN users u ON u.id = prev.user_id
     WHERE prev.year = $1 - 1 AND lt.active AND u.status <> 'disabled'
     ON CONFLICT (user_id, leave_type_id, year) DO UPDATE SET carried_days = EXCLUDED.carried_days
       WHERE leave_balances.carried_days = 0 AND EXCLUDED.carried_days > 0`,
    [year],
  )).rowCount ?? 0;

  // Scheduled backup
  if (s.backups.enabled && s.backups.bucket) {
    const last = (await db.query("SELECT max(started_at) AS at FROM backups WHERE status = 'done'")).rows[0].at as Date | null;
    const gapDays = s.backups.schedule === "weekly" ? 7 : 1;
    if (!last || Date.now() - last.getTime() > gapDays * 86400000 - 3600000) {
      await backupNow(db, tenant.slug, s.backups);
      result.backup = true;
    }
  }
  return result;
}

export async function backupNow(db: Db, slug: string, b: Awaited<ReturnType<typeof getSettings>>["backups"]) {
  const row = (await db.query("INSERT INTO backups (tenant_id, status) VALUES (current_setting('app.tenant_id')::uuid, 'running') RETURNING id")).rows[0];
  try {
    const out = await runBackup(db, slug, b);
    await db.query("UPDATE backups SET status = 'done', object_key = $2, size_bytes = $3, finished_at = now() WHERE id = $1", [row.id, out.key, out.size]);
  } catch (e) {
    await db.query("UPDATE backups SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [row.id, (e as Error).message.slice(0, 500)]);
  }
}
