import type { Db } from "@eszy/db";
import type { CompanySettings } from "@eszy/shared";
import { formatMinutes } from "@eszy/shared";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { dayOfWeek, periodBounds } from "../lib/dates";

export interface EntryInput { projectId: string; taskId?: string | null; minutes: number; description: string; source: string; activityTypeId?: string | null; category?: "billable" | "inhouse" | "no_work" | null; trackerId?: string | null; offline?: boolean; offlineReason?: string }

/** Project cap = total minutes of all its billing lines. Null when a postpaid project has no lines yet. */
export async function projectCap(db: Db, projectId: string): Promise<number | null> {
  const r = (await db.query("SELECT count(*)::int AS n, coalesce(sum(minutes),0)::int AS m FROM billing_lines WHERE project_id = $1", [projectId])).rows[0];
  return r.n ? r.m : null;
}

/** Minutes already logged on a project (all sheets except rejected ones being edited), optionally within dates. */
export async function loggedMinutes(db: Db, projectId: string, opts: { excludeSheetId?: string; from?: string; to?: string } = {}) {
  const r = (
    await db.query(
      `SELECT coalesce(sum(e.minutes),0)::int AS m FROM time_entries e
       WHERE e.project_id = $1 AND ($2::uuid IS NULL OR e.sheet_id <> $2) AND ($3::date IS NULL OR e.date >= $3) AND ($4::date IS NULL OR e.date <= $4)`,
      [projectId, opts.excludeSheetId ?? null, opts.from ?? null, opts.to ?? null],
    )
  ).rows[0];
  return r.m as number;
}

/** What's left on a project: overall and in the billing period that contains `date`. */
export async function projectRemaining(db: Db, project: any, date: string, weekStartsOn: number, excludeSheetId?: string) {
  const cap = await projectCap(db, project.id);
  const used = await loggedMinutes(db, project.id, { excludeSheetId });
  let periodCap: number | null = null, periodUsed = 0, period: { start: string; end: string } | null = null;
  if (project.billing_cap_minutes && project.billing_period) {
    period = periodBounds(date, project.billing_period, weekStartsOn);
    periodCap = project.billing_cap_minutes;
    periodUsed = await loggedMinutes(db, project.id, { excludeSheetId, from: period.start, to: period.end });
  }
  return {
    projectCap: cap, projectUsed: used, projectLeft: cap === null ? null : cap - used,
    periodCap, periodUsed, periodLeft: periodCap === null ? null : periodCap - periodUsed, period,
  };
}

/**
 * A project's hours split into tasks: the cap (all billing lines, extra hours included), how much is already given to tasks,
 * and what's left to give out. Projects without a cap have no limit.
 */
export async function taskBudget(db: Db, projectId: string, excludeTaskId?: string) {
  // The billing cap when there is one; otherwise the task hours the PM set for the project.
  const cap = (await projectCap(db, projectId)) ?? (await db.query("SELECT task_budget_minutes FROM projects WHERE id = $1", [projectId])).rows[0]?.task_budget_minutes ?? null;
  const allocated = Number((await db.query(
    "SELECT coalesce(sum(estimated_minutes),0) AS m FROM tasks WHERE project_id = $1 AND ($2::uuid IS NULL OR id <> $2)", [projectId, excludeTaskId ?? null])).rows[0].m);
  return { cap, allocated, available: cap === null ? null : Math.max(0, cap - allocated) };
}

async function getOrCreateSheet(db: Db, tenantId: string, userId: string, date: string) {
  await db.query("INSERT INTO sheets (tenant_id, user_id, date) VALUES ($1,$2,$3) ON CONFLICT (user_id, date) DO NOTHING", [tenantId, userId, date]);
  return (await db.query("SELECT * FROM sheets WHERE user_id = $1 AND date = $2 FOR UPDATE", [userId, date])).rows[0];
}

/**
 * Saves a person's daily sheet. Hours past the project cap or the billing cap are blocked,
 * so nobody works unpaid hours by accident. Approved or submitted sheets can't be changed.
 */
export async function saveSheet(db: Db, tenantId: string, userId: string, date: string, entries: EntryInput[], settings: CompanySettings, today: string) {
  if (date > today) throw badRequest("You can't fill a sheet for a future date");
  const sheet = await getOrCreateSheet(db, tenantId, userId, date);
  if (sheet.status === "submitted") throw conflict("This sheet is waiting for approval. Ask your TL to send it back to change it.");
  if (sheet.status === "approved") throw conflict("This sheet is approved and locked");
  const total = entries.reduce((a, e) => a + e.minutes, 0);
  if (total > 24 * 60) throw badRequest("A day can't have more than 24 hours");

  const byProject = new Map<string, number>();
  for (const e of entries) byProject.set(e.projectId, (byProject.get(e.projectId) ?? 0) + e.minutes);
  const problems: string[] = [];
  for (const [pid, minutes] of byProject) {
    const p = (
      await db.query(
        `SELECT p.*, EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2) AS is_member
         FROM projects p WHERE p.id = $1`,
        [pid, userId],
      )
    ).rows[0];
    if (!p) throw notFound("Project not found");
    if (!p.is_member) throw forbidden(`You're not a member of ${p.name}`);
    if (p.status !== "active") { problems.push(`${p.name} is ${p.status}, so it can't take new hours.`); continue; }
    const left = await projectRemaining(db, p, date, settings.locale.weekStartsOn, sheet.id);
    if (left.projectLeft !== null && minutes > left.projectLeft) {
      problems.push(`${p.name} has ${formatMinutes(Math.max(0, left.projectLeft))} left of its ${formatMinutes(left.projectCap)} project cap. Ask the Billing Manager to add hours.`);
    }
    if (left.periodLeft !== null && minutes > left.periodLeft) {
      problems.push(`${p.name} has ${formatMinutes(Math.max(0, left.periodLeft))} left of its ${formatMinutes(left.periodCap)} ${p.billing_period}ly billing cap.`);
    }
  }
  for (const e of entries) {
    const pr = (await db.query("SELECT name, type, is_internal, allow_offline_hours FROM projects WHERE id = $1", [e.projectId])).rows[0];
    if (!pr) throw badRequest("A project on the sheet doesn't exist");
    if (settings.policies.workTypeMode === "simple") {
      // Billable on client projects (in-house allowed too); in-house or no work on internal ones.
      e.category = e.category ?? (pr.is_internal ? "inhouse" : "billable");
      if (pr.is_internal && e.category === "billable") throw badRequest(`${pr.name} is in-house, so its hours can't be billable`);
      if (!pr.is_internal && e.category === "no_work") throw badRequest(`Pick billable or in-house for ${pr.name}`);
    } else {
      e.category = null;
      if (settings.policies.requireActivityType && !e.activityTypeId) throw badRequest("Pick a work type for every entry");
    }
    // Fixed-price projects aren't tracked; hourly ones are, unless offline hours are allowed and a reason is given.
    if (pr.type === "fixed" || pr.is_internal) { e.offline = false; e.offlineReason = ""; e.trackerId = null; }
    if (e.trackerId) {
      const tr = (await db.query("SELECT project_id FROM project_trackers WHERE id = $1", [e.trackerId])).rows[0];
      if (!tr || tr.project_id !== e.projectId) throw badRequest("A tracking ID doesn't belong to its project");
    }
    if (e.offline) {
      const p = (await db.query("SELECT allow_offline_hours, name FROM projects WHERE id = $1", [e.projectId])).rows[0];
      if (!p.allow_offline_hours) throw badRequest(`${p.name} doesn't allow offline hours`);
      if (!e.offlineReason?.trim()) throw badRequest("Say why the offline hours weren't tracked");
    }
    if (e.taskId) {
      const t = (await db.query("SELECT project_id FROM tasks WHERE id = $1", [e.taskId])).rows[0];
      if (!t || t.project_id !== e.projectId) throw badRequest("A task doesn't belong to its project");
    }
  }
  // Each task has its own cap: its estimated hours. Hours past it need more hours given to the task first.
  const byTask = new Map<string, number>();
  for (const e of entries) if (e.taskId) byTask.set(e.taskId, (byTask.get(e.taskId) ?? 0) + e.minutes);
  for (const [tid, minutes] of byTask) {
    const t = (await db.query(
      `SELECT t.title, t.estimated_minutes, coalesce((SELECT sum(x.minutes) FROM time_entries x WHERE x.task_id = t.id AND x.sheet_id <> $2),0)::int AS used
       FROM tasks t WHERE t.id = $1`, [tid, sheet.id])).rows[0];
    if (t?.estimated_minutes != null && t.used + minutes > t.estimated_minutes) {
      problems.push(`The task "${t.title}" has ${formatMinutes(Math.max(0, t.estimated_minutes - t.used))} left of its ${formatMinutes(t.estimated_minutes)}. Ask your PM to give it more hours.`);
    }
  }
  if (problems.length) throw conflict("Some hours are over a cap", { problems });

  await db.query("DELETE FROM time_entries WHERE sheet_id = $1", [sheet.id]);
  for (const e of entries) {
    await db.query(
      `INSERT INTO time_entries (tenant_id, sheet_id, user_id, project_id, task_id, date, minutes, description, source, activity_type_id, tracker_id, offline, offline_reason, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [tenantId, sheet.id, userId, e.projectId, e.taskId ?? null, date, e.minutes, e.description, e.source || "eszy", e.activityTypeId ?? null, e.trackerId ?? null, !!e.offline, e.offline ? (e.offlineReason ?? "") : "", e.category ?? null],
    );
  }
  if (sheet.status === "rejected") await db.query("UPDATE sheets SET status = 'draft', decided_by = NULL, decided_at = NULL WHERE id = $1", [sheet.id]);
  return sheet.id as string;
}

/** Hours a person must log on a date: normal day, WFH (full or half), leave, holiday or non-working day. */
export async function expectedMinutes(db: Db, userId: string, date: string, settings: CompanySettings) {
  const pol = settings.policies;
  if (!pol.workingDays.includes(dayOfWeek(date))) return { minutes: 0, reason: "Non-working day" };
  const hol = (await db.query("SELECT name, half_day FROM holidays WHERE date = $1", [date])).rows[0];
  if (hol && !hol.half_day) return { minutes: 0, reason: hol.name ? `Holiday: ${hol.name}` : "Holiday" };
  const leave = (await db.query("SELECT half_day, part, short_minutes FROM leave_requests WHERE user_id = $1 AND status = 'approved' AND $2 BETWEEN start_date AND end_date", [userId, date])).rows[0];
  const wfh = (await db.query("SELECT kind, minutes FROM wfh_requests WHERE user_id = $1 AND date = $2 AND status = 'approved'", [userId, date])).rows[0];
  let base = pol.dailyMinimumMinutes, reason = "Normal day";
  if (wfh?.kind === "full") { base = pol.wfhFullDayMinutes; reason = "WFH, full day"; }
  if (wfh?.kind === "half") { base = pol.wfhHalfDayMinutes; reason = "WFH, half day"; }
  if (hol?.half_day) { base = Math.round(base / 2); reason = `Half holiday: ${hol.name}`; }
  if (leave?.part === "short") return { minutes: Math.max(0, base - (leave.short_minutes ?? 0)), reason: `Short leave (${Math.round((leave.short_minutes ?? 0) / 6) / 10} h)` };
  if (leave) return leave.half_day ? { minutes: Math.round(base / 2), reason: "Half-day leave" } : { minutes: 0, reason: "On leave" };
  return { minutes: base, reason };
}

export async function submitSheet(db: Db, userId: string, date: string, settings: CompanySettings) {
  const sheet = (await db.query("SELECT * FROM sheets WHERE user_id = $1 AND date = $2 FOR UPDATE", [userId, date])).rows[0];
  if (!sheet) throw notFound("Save the sheet before submitting it");
  if (!["draft", "rejected"].includes(sheet.status)) throw conflict(`This sheet is already ${sheet.status}`);
  const total = (await db.query("SELECT coalesce(sum(minutes),0)::int AS m FROM time_entries WHERE sheet_id = $1", [sheet.id])).rows[0].m;
  const exp = await expectedMinutes(db, userId, date, settings);
  if (total < exp.minutes) {
    throw badRequest(`${exp.reason}: log at least ${formatMinutes(exp.minutes)}. You have ${formatMinutes(total)}.`, { expected: exp.minutes, logged: total });
  }
  if (total === 0 && exp.minutes === 0) throw badRequest("Add at least one entry before submitting");
  await db.query("UPDATE sheets SET status = 'submitted', submitted_at = now(), reminder_sent_at = NULL WHERE id = $1", [sheet.id]);
  await db.query("UPDATE sheet_requests SET status = 'used' WHERE user_id = $1 AND date = $2 AND status = 'approved'", [userId, date]);
  return sheet;
}

/** Who approves this person's sheet: the Team Lead of their team. */
export async function approverFor(db: Db, userId: string): Promise<string | null> {
  // The person's own reporting manager if set, otherwise their team's TL. People at the top with neither
  // (an HR head, a department manager) go to the company owner, so every sheet has someone to approve it.
  const r = (await db.query("SELECT coalesce(u.reporting_manager_id, t.lead_user_id) AS lead FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = $1", [userId])).rows[0];
  if (r?.lead && r.lead !== userId) return r.lead;
  const owner = (await db.query("SELECT id FROM users WHERE is_owner AND status = 'active' AND id <> $1 ORDER BY created_at LIMIT 1", [userId])).rows[0];
  return owner?.id ?? null;
}

export async function assertCanApprove(db: Db, approver: { id: string; permissions: Set<string> }, ownerId: string) {
  if (approver.permissions.has("time.approve_all")) return;
  const lead = await approverFor(db, ownerId);
  if (!approver.permissions.has("time.approve_team") || lead !== approver.id || ownerId === approver.id) {
    throw forbidden("Only this person's own Team Lead can approve their sheet");
  }
}

/**
 * Approves a submitted sheet and spreads its hours over the project's billing lines in order.
 * Lines with an amount make the hours billable; $0 extra lines make them non-billable.
 * Only a submitted sheet can be approved, so hours are never counted twice.
 */
export async function approveSheet(db: Db, sheetId: string, approverId: string) {
  const sheet = (await db.query("UPDATE sheets SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1 AND status = 'submitted' RETURNING *", [sheetId, approverId])).rows[0];
  if (!sheet) throw conflict("Only a submitted sheet can be approved");
  const entries = (await db.query("SELECT * FROM time_entries WHERE sheet_id = $1 ORDER BY created_at", [sheetId])).rows;
  for (const e of entries) await allocateEntry(db, e);
  return sheet;
}

export async function allocateEntry(db: Db, e: { id: string; project_id: string; minutes: number; tenant_id: string }) {
  const lines = (
    await db.query(
      `SELECT bl.id, bl.minutes - coalesce((SELECT sum(a.minutes) FROM time_allocations a WHERE a.billing_line_id = bl.id),0) AS left
       FROM billing_lines bl WHERE bl.project_id = $1 ORDER BY bl.position, bl.created_at FOR UPDATE`,
      [e.project_id],
    )
  ).rows;
  let need = e.minutes;
  for (const l of lines) {
    if (need <= 0) break;
    const take = Math.min(need, Number(l.left));
    if (take <= 0) continue;
    await db.query("INSERT INTO time_allocations (tenant_id, entry_id, billing_line_id, minutes) VALUES ($1,$2,$3,$4)", [e.tenant_id, e.id, l.id, take]);
    need -= take;
  }
  if (need > 0) await db.query("INSERT INTO time_allocations (tenant_id, entry_id, billing_line_id, minutes) VALUES ($1,$2,NULL,$3)", [e.tenant_id, e.id, need]);
}

export async function rejectSheet(db: Db, sheetId: string, approverId: string) {
  const s = (await db.query("UPDATE sheets SET status = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1 AND status = 'submitted' RETURNING *", [sheetId, approverId])).rows[0];
  if (!s) throw conflict("Only a submitted sheet can be sent back");
  return s;
}

/** An approved backdate request lets someone fill a day older than the edit window, until it expires or is used. */
export async function hasOpenBackdate(db: Db, userId: string, date: string) {
  return !!(await db.query("SELECT 1 FROM sheet_requests WHERE user_id = $1 AND date = $2 AND status = 'approved' AND (expires_at IS NULL OR expires_at > now())", [userId, date])).rowCount;
}

/**
 * Reopening an approved sheet follows the company setting:
 *  none: never; admin: only people who approve every sheet; tl_until_invoiced: the person's TL (or an Admin) until the hours are invoiced.
 * Hours already on an issued invoice stay locked until that invoice is cancelled.
 */
export async function assertCanReopen(db: Db, actor: { id: string; permissions: Set<string> }, sheet: any, setting: "none" | "admin" | "tl_until_invoiced") {
  if (setting === "none") throw forbidden("Your company doesn't allow approved sheets to be changed");
  const isTl = actor.permissions.has("time.approve_team") && (await approverFor(db, sheet.user_id)) === actor.id;
  if (!actor.permissions.has("time.approve_all") && !(setting === "tl_until_invoiced" && isTl)) {
    throw forbidden(setting === "admin" ? "Only an Admin can reopen an approved sheet" : "Only this person's TL or an Admin can reopen it");
  }
  // Postpaid hours are billed by the hour, so once they're on an invoice they stay locked.
  // (Prepaid and fixed-price invoices bill a block or a price, which reopening a sheet doesn't change.)
  const invoiced = (await db.query(
    "SELECT 1 FROM time_entries e JOIN invoices i ON i.id = e.invoice_id AND i.status <> 'cancelled' WHERE e.sheet_id = $1 LIMIT 1", [sheet.id],
  )).rowCount;
  if (invoiced) throw conflict("Some of these hours are on an invoice. Cancel that invoice first.");
}
