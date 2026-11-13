import { Router } from "express";
import { z } from "zod";
import { leaveRequestSchema, sheetSaveSchema, wfhRequestSchema, formatMinutes } from "@eszy/shared";
import { can, h, userId } from "../lib/context";
import { requirePerm } from "../lib/auth";
import { requireFeature } from "../lib/tenant";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { audit, notify } from "../lib/audit";
import { getSettings } from "../lib/settings";
import { addMonths, dayOfWeek, eachDay, todayIn } from "../lib/dates";
import { approveSheet, approverFor, assertCanApprove, assertCanReopen, expectedMinutes, hasOpenBackdate, projectRemaining, rejectSheet, saveSheet, submitSheet } from "../services/time";
import { fireAlerts } from "../lib/alerts";
import { auditChange, snapshot } from "../lib/audit";

export const timeRouter = Router();
timeRouter.use(requireFeature("people_time"));
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ENTRY_SQL = `SELECT e.id, e.project_id, p.name AS project_name, c.name AS client_name, e.task_id, t.title AS task_title, e.minutes, e.description, e.source,
    e.activity_type_id, at.name AS activity_type, e.category AS chosen_category, e.tracker_id, tr.label AS tracker_label, e.offline, e.offline_reason,
    CASE WHEN e.category IS NOT NULL THEN e.category WHEN p.is_internal THEN 'inhouse' ELSE coalesce(at.category, 'billable') END AS category
  FROM time_entries e JOIN projects p ON p.id = e.project_id JOIN clients c ON c.id = p.client_id LEFT JOIN tasks t ON t.id = e.task_id
  LEFT JOIN activity_types at ON at.id = e.activity_type_id LEFT JOIN project_trackers tr ON tr.id = e.tracker_id
  WHERE e.sheet_id = $1 ORDER BY e.created_at`;

// ---------- my sheet ----------
timeRouter.get("/sheets/day", requirePerm("time.own"), h(async (req, db) => {
  const s = await getSettings(db);
  const d = date.optional().parse(req.query.date) ?? todayIn(s.locale.timezone);
  const uid = userId(req);
  const sheet = (await db.query("SELECT * FROM sheets WHERE user_id = $1 AND date = $2", [uid, d])).rows[0] ?? null;
  const entries = sheet ? (await db.query(ENTRY_SQL, [sheet.id])).rows : [];
  const expected = await expectedMinutes(db, uid, d, s);
  const projects = (await db.query(
    "SELECT p.* FROM projects p JOIN project_members m ON m.project_id = p.id AND m.user_id = $1 WHERE p.status = 'active' ORDER BY p.name", [uid],
  )).rows;
  const withLeft = [];
  for (const p of projects) {
    const left = await projectRemaining(db, p, d, s.locale.weekStartsOn, sheet?.id);
    const tasks = (await db.query(`SELECT t.id, t.title, t.assignee_id, t.status, t.priority, t.estimated_minutes,
         coalesce((SELECT sum(x.minutes) FROM time_entries x WHERE x.task_id = t.id AND ($3::uuid IS NULL OR x.sheet_id <> $3)),0)::int AS logged_minutes
       FROM tasks t WHERE t.project_id = $1 AND t.status <> 'done' ORDER BY (t.assignee_id = $2) DESC NULLS LAST, t.title`, [p.id, uid, sheet?.id ?? null])).rows;
    const trackers = (await db.query("SELECT id, label, external_id FROM project_trackers WHERE project_id = $1 AND active ORDER BY label", [p.id])).rows;
    withLeft.push({ id: p.id, name: p.name, remaining: left, tasks, trackers, allowOffline: p.allow_offline_hours, isInternal: p.is_internal, type: p.type, billingType: p.billing_type });
  }
  const approver = await approverFor(db, uid);
  const activityTypes = (await db.query("SELECT id, name, category FROM activity_types WHERE active ORDER BY name")).rows;
  const today = todayIn(s.locale.timezone);
  const back = (Date.parse(today) - Date.parse(d)) / 86400000;
  const editable = back <= s.policies.sheetEditDays || can(req, "time.approve_all") || (await hasOpenBackdate(db, uid, d));
  const request = (await db.query("SELECT * FROM sheet_requests WHERE user_id = $1 AND date = $2 ORDER BY created_at DESC LIMIT 1", [uid, d])).rows[0] ?? null;
  // Someone who can approve any sheet and has nobody above them (usually the owner) approves their own.
  const selfApprove = !approver && can(req, "time.approve_all");
  // Time the day loses to leave, holidays and company events, shown next to the hours logged.
  const pol = s.policies;
  const isWorkDay = pol.workingDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay());
  const leave = (await db.query("SELECT half_day, part, short_minutes FROM leave_requests WHERE user_id = $1 AND status = 'approved' AND $2 BETWEEN start_date AND end_date", [uid, d])).rows[0];
  const hol = (await db.query("SELECT name, half_day FROM holidays WHERE date = $1", [d])).rows[0];
  const base = pol.dailyMinimumMinutes;
  const leaveMinutes = !isWorkDay || !leave ? 0 : leave.part === "short" ? leave.short_minutes ?? 0 : leave.half_day ? Math.round(base / 2) : base;
  const holidayMinutes = !isWorkDay || !hol ? 0 : hol.half_day ? Math.round(base / 2) : base;
  const me = (await db.query("SELECT team_id, department_id FROM users WHERE id = $1", [uid])).rows[0] ?? {};
  const events = (await db.query(
    `SELECT title, kind, start_time, end_time FROM events WHERE $1 BETWEEN start_date AND end_date
       AND (audience = 'everyone' OR (audience = 'team' AND team_id = $2) OR (audience = 'department' AND department_id = $3)) ORDER BY start_time NULLS FIRST`,
    [d, me.team_id ?? null, me.department_id ?? null])).rows.map((e: any) => ({
      title: e.title, kind: e.kind,
      minutes: e.start_time && e.end_time ? Math.max(0, (Date.parse(`1970-01-01T${e.end_time}Z`) - Date.parse(`1970-01-01T${e.start_time}Z`)) / 60000) : 0,
    }));
  const away = { leaveMinutes, holidayMinutes, holiday: hol?.name ?? null, eventMinutes: events.reduce((a: number, e: any) => a + e.minutes, 0), events };
  return { date: d, sheet, entries, expected, away, projects: withLeft, hasApprover: !!approver || selfApprove, selfApprove, activityTypes, requireActivityType: s.policies.requireActivityType, workTypeMode: s.policies.workTypeMode, offlineReasons: s.policies.offlineReasons, offlineReasonOther: s.policies.offlineReasonOther, editable, request };
}));

timeRouter.put("/sheets/day", requirePerm("time.own"), h(async (req, db) => {
  const b = sheetSaveSchema.parse(req.body);
  const s = await getSettings(db);
  const today = todayIn(s.locale.timezone);
  const back = (Date.parse(today) - Date.parse(b.date)) / 86400000;
  if (back > s.policies.sheetEditDays && !can(req, "time.approve_all") && !(await hasOpenBackdate(db, userId(req), b.date))) {
    throw badRequest(`Sheets older than ${s.policies.sheetEditDays} days need a backdate request approved by your TL.`, { needsRequest: true });
  }
  await saveSheet(db, req.tenant!.id, userId(req), b.date, b.entries, s, today);
  return { ok: true };
}));

timeRouter.post("/sheets/day/submit", requirePerm("time.own"), h(async (req, db) => {
  const { date: d } = z.object({ date }).parse(req.body);
  const s = await getSettings(db);
  const sheet = await submitSheet(db, userId(req), d, s);
  const lead = await approverFor(db, userId(req));
  await notify(db, [lead], { kind: "sheet.submitted", title: `${req.user!.name} submitted ${d}`, link: `/approvals` });
  await fireAlerts(db, "sheet.submitted", { key: `${sheet.id}:${Date.now()}`, title: `${req.user!.name} submitted the sheet for ${d}`, link: "/approvals", ownerIds: [lead] });
  return { ok: true, sheetId: sheet.id, approver: lead };
}));

timeRouter.get("/sheets/mine", requirePerm("time.own"), h(async (req, db) => {
  const q = z.object({ from: date, to: date }).parse(req.query);
  const s = await getSettings(db);
  const uid = userId(req);
  const sheets = (await db.query(
    `SELECT s.date, s.status, coalesce(sum(e.minutes),0)::int AS minutes FROM sheets s LEFT JOIN time_entries e ON e.sheet_id = s.id
     WHERE s.user_id = $1 AND s.date BETWEEN $2 AND $3 GROUP BY s.id ORDER BY s.date`, [uid, q.from, q.to],
  )).rows;
  const byDate = new Map(sheets.map((x) => [x.date, x]));
  const days = [];
  for (const d of eachDay(q.from, q.to)) {
    const exp = await expectedMinutes(db, uid, d, s);
    const sh = byDate.get(d);
    days.push({ date: d, status: sh?.status ?? "none", minutes: sh?.minutes ?? 0, expected: exp.minutes, reason: exp.reason });
  }
  return days;
}));

// ---------- approvals (the employee's own TL) ----------
timeRouter.get("/approvals/sheets", requirePerm("time.approve_team", "time.approve_all"), h(async (req, db) => {
  const q = z.object({ status: z.enum(["submitted", "approved", "rejected"]).default("submitted"), from: date.optional(), to: date.optional() }).parse(req.query);
  const all = can(req, "time.approve_all");
  const sheets = (await db.query(
    `SELECT s.*, u.name AS user_name, coalesce((SELECT sum(minutes) FROM time_entries e WHERE e.sheet_id = s.id),0)::int AS minutes,
       (SELECT kind FROM wfh_requests w WHERE w.user_id = s.user_id AND w.date = s.date AND w.status = 'approved') AS wfh
     FROM sheets s JOIN users u ON u.id = s.user_id LEFT JOIN teams t ON t.id = u.team_id
     WHERE s.status = $1 AND ($2 OR (coalesce(u.reporting_manager_id, t.lead_user_id) = $3 AND s.user_id <> $3))
       AND ($4::date IS NULL OR s.date >= $4) AND ($5::date IS NULL OR s.date <= $5)
     ORDER BY s.date DESC, u.name LIMIT 300`,
    [q.status, all, userId(req), q.from ?? null, q.to ?? null],
  )).rows;
  for (const sh of sheets) sh.entries = (await db.query(ENTRY_SQL, [sh.id])).rows;
  return sheets;
}));

async function decide(req: any, db: any, id: string, action: "approve" | "reject") {
  const sheet = (await db.query("SELECT * FROM sheets WHERE id = $1", [id])).rows[0];
  if (!sheet) throw notFound("Sheet not found");
  await assertCanApprove(db, req.user, sheet.user_id);
  const before = await snapshot(db, "sheets", id);
  if (action === "approve") await approveSheet(db, id, userId(req));
  else await rejectSheet(db, id, userId(req));
  await notify(db, [sheet.user_id], {
    kind: `sheet.${action}d`,
    title: action === "approve" ? `Your sheet for ${sheet.date} was approved` : `Your sheet for ${sheet.date} was sent back. Update it and submit again.`,
    link: `/sheet?date=${sheet.date}`,
  });
  await auditChange(db, req, `sheet.${action}`, "sheets", id, before);
}
timeRouter.post("/approvals/sheets/:id/approve", h(async (req, db) => { await decide(req, db, uuid.parse(req.params.id), "approve"); return { ok: true }; }));
timeRouter.post("/approvals/sheets/:id/reject", h(async (req, db) => { await decide(req, db, uuid.parse(req.params.id), "reject"); return { ok: true }; }));
timeRouter.post("/approvals/sheets/bulk", h(async (req, db) => {
  const { ids, action } = z.object({ ids: z.array(uuid).min(1).max(200), action: z.enum(["approve", "reject"]) }).parse(req.body);
  for (const id of ids) await decide(req, db, id, action);
  return { ok: true, count: ids.length };
}));

/** Reopen an approved sheet, as the company's "editing approved sheets" setting allows. Its hours come off the billing lines again. */
timeRouter.post("/sheets/:id/reopen", h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const sheet = (await db.query("SELECT * FROM sheets WHERE id = $1", [id])).rows[0];
  if (!sheet || sheet.status !== "approved") throw conflict("Only approved sheets can be reopened");
  const s = await getSettings(db);
  await assertCanReopen(db, req.user!, sheet, s.policies.approvedSheetEdit);
  const before = await snapshot(db, "sheets", id);
  await db.query("DELETE FROM time_allocations WHERE entry_id IN (SELECT id FROM time_entries WHERE sheet_id = $1)", [id]);
  await db.query("UPDATE sheets SET status = 'draft', decided_by = NULL, decided_at = NULL, submitted_at = NULL WHERE id = $1", [id]);
  await auditChange(db, req, "sheet.reopen", "sheets", id, before);
  await notify(db, [sheet.user_id], { kind: "sheet.reopened", title: `Your approved sheet for ${sheet.date} was reopened`, body: "Update it and submit again.", link: `/sheet?date=${sheet.date}` });
  return { ok: true };
}));

// ---------- backdate requests: ask to fill a day older than the edit window ----------
timeRouter.get("/sheet-requests", h(async (req, db) => {
  const q = z.object({ scope: z.enum(["mine", "team", "all"]).default("mine"), status: z.string().optional() }).parse(req.query);
  return (await db.query(
    `SELECT r.*, u.name AS user_name FROM sheet_requests r JOIN users u ON u.id = r.user_id LEFT JOIN teams t ON t.id = u.team_id
     WHERE (($1 = 'mine' AND r.user_id = $2) OR ($1 = 'team' AND coalesce(u.reporting_manager_id, t.lead_user_id) = $2 AND r.user_id <> $2) OR ($1 = 'all' AND $3))
       AND ($4::text IS NULL OR r.status = $4) ORDER BY r.created_at DESC LIMIT 300`,
    [q.scope, userId(req), can(req, "time.approve_all"), q.status ?? null],
  )).rows;
}));
timeRouter.post("/sheet-requests", requirePerm("time.own"), h(async (req, db) => {
  const b = z.object({ date, reason: z.string().min(3, "Say why the sheet is late") }).parse(req.body);
  const s = await getSettings(db);
  const today = todayIn(s.locale.timezone);
  if (b.date >= today) throw badRequest("Pick a past date");
  const sheet = (await db.query("SELECT status FROM sheets WHERE user_id = $1 AND date = $2", [userId(req), b.date])).rows[0];
  if (sheet && ["submitted", "approved"].includes(sheet.status)) throw conflict("That day's sheet is already submitted");
  const r = (await db.query("INSERT INTO sheet_requests (tenant_id, user_id, date, reason) VALUES ($1,$2,$3,$4) RETURNING *", [req.tenant!.id, userId(req), b.date, b.reason])).rows[0];
  await notify(db, [await approverFor(db, userId(req))], { kind: "sheet_request", title: `${req.user!.name} asks to fill ${b.date}`, body: b.reason, link: "/approvals?tab=requests" });
  return r;
}));
timeRouter.post("/sheet-requests/:id/:action", h(async (req, db) => {
  const action = z.enum(["approve", "reject", "cancel"]).parse(req.params.action);
  const r = (await db.query("SELECT * FROM sheet_requests WHERE id = $1", [uuid.parse(req.params.id)])).rows[0];
  if (!r) throw notFound();
  if (action === "cancel") {
    if (r.user_id !== userId(req)) throw forbidden();
    await db.query("UPDATE sheet_requests SET status = 'cancelled' WHERE id = $1 AND status = 'pending'", [r.id]);
    return { ok: true };
  }
  await assertCanApprove(db, req.user!, r.user_id);
  if (r.status !== "pending") throw conflict(`This request is already ${r.status}`);
  const s = await getSettings(db);
  await db.query(
    "UPDATE sheet_requests SET status = $2, decided_by = $3, decided_at = now(), expires_at = CASE WHEN $2 = 'approved' THEN now() + make_interval(hours => $4) END WHERE id = $1",
    [r.id, action === "approve" ? "approved" : "rejected", userId(req), s.policies.backdateRequestHours],
  );
  await notify(db, [r.user_id], {
    kind: `sheet_request.${action}d`,
    title: action === "approve" ? `You can now fill your sheet for ${r.date}` : `Your request to fill ${r.date} was declined`,
    body: action === "approve" ? `Submit it within ${s.policies.backdateRequestHours} hours.` : "",
    link: `/sheet?date=${r.date}`, email: true,
  });
  return { ok: true };
}));

/** TL view: who in my team has filled, submitted or missed a day. */
timeRouter.get("/sheets/team", requirePerm("time.approve_team", "time.approve_all"), h(async (req, db) => {
  const s = await getSettings(db);
  const d = date.optional().parse(req.query.date) ?? todayIn(s.locale.timezone);
  const all = can(req, "time.approve_all");
  const people = (await db.query(
    `SELECT u.id, u.name, s.status, coalesce((SELECT sum(minutes) FROM time_entries e WHERE e.sheet_id = s.id),0)::int AS minutes
     FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN sheets s ON s.user_id = u.id AND s.date = $1
     WHERE u.status = 'active' AND ($2 OR coalesce(u.reporting_manager_id, t.lead_user_id) = $3) AND u.id <> $3 ORDER BY u.name`,
    [d, all, userId(req)],
  )).rows;
  for (const p of people) p.expected = (await expectedMinutes(db, p.id, d, s)).minutes;
  return { date: d, people };
}));

// ---------- holidays ----------
timeRouter.get("/holidays", h(async (req, db) => {
  const year = z.coerce.number().optional().parse(req.query.year) ?? new Date().getFullYear();
  return (await db.query("SELECT * FROM holidays WHERE extract(year FROM date) = $1 ORDER BY date", [year])).rows;
}));
timeRouter.post("/holidays", requirePerm("leave.manage"), h(async (req, db) => {
  // A holiday or a non-working day (e.g. a company offsite), full or half day.
  const b = z.object({ date, name: z.string().min(1), halfDay: z.boolean().default(false), kind: z.enum(["holiday", "non_working"]).default("holiday"), description: z.string().max(500).default("") }).parse(req.body);
  return (await db.query(
    `INSERT INTO holidays (tenant_id, date, name, half_day, kind, description) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, date) DO UPDATE SET name = EXCLUDED.name, half_day = EXCLUDED.half_day, kind = EXCLUDED.kind, description = EXCLUDED.description RETURNING *`,
    [req.tenant!.id, b.date, b.name, b.halfDay, b.kind, b.description])).rows[0];
}));
timeRouter.delete("/holidays/:id", requirePerm("leave.manage"), h(async (req, db) => {
  await db.query("DELETE FROM holidays WHERE id = $1", [uuid.parse(req.params.id)]);
  return { ok: true };
}));

// ---------- leave ----------
timeRouter.get("/leave/types", h(async (_req, db) => (await db.query("SELECT * FROM leave_types ORDER BY active DESC, name")).rows));
const leaveTypeSchema = z.object({
  name: z.string().min(1), yearlyDays: z.number().min(0).max(365), paid: z.boolean().default(true), active: z.boolean().default(true),
  accrual: z.enum(["yearly", "monthly"]).default("yearly"), carryForwardMax: z.number().min(0).max(365).default(0),
  allowedInProbation: z.boolean().default(true), allowedInNotice: z.boolean().default(true), maxPerRequest: z.number().min(0.5).nullable().default(null),
});
timeRouter.post("/leave/types", requirePerm("leave.manage"), h(async (req, db) => {
  const b = leaveTypeSchema.parse(req.body);
  const t = (await db.query(
    "INSERT INTO leave_types (tenant_id, name, yearly_days, paid, active, accrual, carry_forward_max, allowed_in_probation, allowed_in_notice, max_per_request) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
    [req.tenant!.id, b.name, b.yearlyDays, b.paid, b.active, b.accrual, b.carryForwardMax, b.allowedInProbation, b.allowedInNotice, b.maxPerRequest],
  )).rows[0];
  // Yearly types are credited in full now; monthly types are credited month by month by the daily job.
  await db.query(
    `INSERT INTO leave_balances (tenant_id, user_id, leave_type_id, year, credited_days)
     SELECT $1, u.id, $2, extract(year FROM current_date)::int, CASE WHEN $4 = 'monthly' THEN 0 ELSE $3 END FROM users u WHERE u.status <> 'disabled' ON CONFLICT DO NOTHING`,
    [req.tenant!.id, t.id, b.yearlyDays, b.accrual],
  );
  return t;
}));
timeRouter.put("/leave/types/:id", requirePerm("leave.manage"), h(async (req, db) => {
  const b = leaveTypeSchema.partial().parse(req.body);
  const raw = leaveTypeSchema.partial().parse(req.body);
  await db.query(
    `UPDATE leave_types SET name = coalesce($2,name), yearly_days = coalesce($3,yearly_days), paid = coalesce($4,paid), active = coalesce($5,active),
       accrual = coalesce($6,accrual), carry_forward_max = coalesce($7,carry_forward_max), allowed_in_probation = coalesce($8,allowed_in_probation),
       allowed_in_notice = coalesce($9,allowed_in_notice), max_per_request = CASE WHEN $10 THEN $11::numeric ELSE max_per_request END WHERE id = $1`,
    [uuid.parse(req.params.id), raw.name ?? null, raw.yearlyDays ?? null, raw.paid ?? null, raw.active ?? null, raw.accrual ?? null, raw.carryForwardMax ?? null,
      raw.allowedInProbation ?? null, raw.allowedInNotice ?? null, "maxPerRequest" in (req.body ?? {}), raw.maxPerRequest ?? null],
  );
  return { ok: true };
}));

timeRouter.get("/leave/balances", h(async (req, db) => {
  const q = z.object({ userId: uuid.optional(), year: z.coerce.number().optional() }).parse(req.query);
  const target = q.userId ?? userId(req);
  if (target !== userId(req) && !can(req, "leave.manage") && !can(req, "leave.approve_team")) throw forbidden();
  const year = q.year ?? new Date().getFullYear();
  return (await db.query(
    `SELECT b.*, t.name, t.paid, t.accrual, (b.credited_days + b.carried_days - b.used_days) AS left_days FROM leave_balances b JOIN leave_types t ON t.id = b.leave_type_id
     WHERE b.user_id = $1 AND b.year = $2 ORDER BY t.name`, [target, year],
  )).rows;
}));
timeRouter.post("/leave/balances/adjust", requirePerm("leave.manage"), h(async (req, db) => {
  const b = z.object({ userId: uuid, leaveTypeId: uuid, year: z.number().int(), creditedDays: z.number().min(0) }).parse(req.body);
  await db.query(
    `INSERT INTO leave_balances (tenant_id, user_id, leave_type_id, year, credited_days) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, leave_type_id, year) DO UPDATE SET credited_days = EXCLUDED.credited_days`,
    [req.tenant!.id, b.userId, b.leaveTypeId, b.year, b.creditedDays],
  );
  await audit(db, req, "leave.adjust", "user", b.userId, b);
  return { ok: true };
}));

async function workingDaysBetween(db: any, s: any, start: string, end: string) {
  const hol = new Set((await db.query("SELECT date FROM holidays WHERE date BETWEEN $1 AND $2", [start, end])).rows.map((r: any) => r.date));
  return eachDay(start, end).filter((d) => s.policies.workingDays.includes(dayOfWeek(d)) && !hol.has(d)).length;
}

const scopeSql = `($1 = 'mine' AND r.user_id = $2) OR ($1 = 'team' AND (coalesce(u.reporting_manager_id, t.lead_user_id) = $2 AND r.user_id <> $2)) OR ($1 = 'all' AND $3)`;

timeRouter.get("/leave/requests", h(async (req, db) => {
  const q = z.object({ scope: z.enum(["mine", "team", "all"]).default("mine"), status: z.string().optional() }).parse(req.query);
  return (await db.query(
    `SELECT r.*, u.name AS user_name, lt.name AS leave_type FROM leave_requests r JOIN users u ON u.id = r.user_id
     JOIN leave_types lt ON lt.id = r.leave_type_id LEFT JOIN teams t ON t.id = u.team_id
     WHERE (${scopeSql}) AND ($4::text IS NULL OR r.status = $4) ORDER BY r.start_date DESC LIMIT 300`,
    [q.scope, userId(req), can(req, "leave.manage"), q.status ?? null],
  )).rows;
}));

/**
 * Leave request rules (all company settings):
 *  - days = working days in the range, minus holidays; half day = 0.5
 *  - sandwich rule: weekends and holidays between two leave days count as leave
 *  - a type can be closed during probation or notice, and can have a most-days-per-request limit
 *  - past the balance, the extra days become unpaid (or the request is refused)
 */
export async function leaveDays(db: any, s: any, start: string, end: string, halfDay: boolean) {
  const hol = new Set((await db.query("SELECT date FROM holidays WHERE date BETWEEN $1 AND $2", [start, end])).rows.map((r: any) => r.date));
  const all = eachDay(start, end);
  const isWorking = (d: string) => s.policies.workingDays.includes(dayOfWeek(d)) && !hol.has(d);
  const working = all.filter(isWorking).length;
  if (halfDay) return { days: 0.5, working, sandwich: 0 };
  let sandwich = 0;
  if (s.policies.sandwichRule && working >= 2) {
    const first = all.findIndex(isWorking), last = all.length - 1 - [...all].reverse().findIndex(isWorking);
    sandwich = all.slice(first, last + 1).filter((d) => !isWorking(d)).length;
  }
  return { days: working + sandwich, working, sandwich };
}

timeRouter.post("/leave/requests", requirePerm("leave.request"), h(async (req, db) => {
  const b = leaveRequestSchema.parse(req.body);
  const part = b.part ?? (b.halfDay ? "first_half" : "full");
  const partial = part !== "full";
  if (partial && b.startDate !== b.endDate) throw badRequest("A half day or short leave must start and end on the same date");
  if (part === "short" && !b.shortMinutes) throw badRequest("Say how many hours the short leave is");
  const s = await getSettings(db);
  const calc = await leaveDays(db, s, b.startDate, b.endDate, partial);
  // A short leave counts as its share of a normal day (2 h of an 8 h 30 m day is 0.2 days, rounded to 0.1).
  if (part === "short") calc.days = Math.max(0.1, Math.round(((b.shortMinutes ?? 0) / s.policies.dailyMinimumMinutes) * 10) / 10);
  if (!calc.working) throw badRequest("These dates have no working days");
  const type = (await db.query("SELECT * FROM leave_types WHERE id = $1 AND active", [b.leaveTypeId])).rows[0];
  if (!type) throw notFound("Leave type not found");
  const me = (await db.query("SELECT probation_ends_on, notice_starts_on, joined_on FROM users WHERE id = $1", [userId(req)])).rows[0];
  const probationEnd = me.probation_ends_on ?? (me.joined_on ? addMonths(me.joined_on, s.policies.probationMonths) : null);
  if (!type.allowed_in_probation && probationEnd && b.startDate < probationEnd) throw badRequest(`${type.name} can't be taken during probation (until ${probationEnd})`);
  if (!type.allowed_in_notice && me.notice_starts_on && b.endDate >= me.notice_starts_on) throw badRequest(`${type.name} can't be taken during the notice period`);
  if (type.max_per_request && calc.days > Number(type.max_per_request)) throw badRequest(`${type.name} allows at most ${Number(type.max_per_request)} days per request`);
  let unpaid = 0;
  if (type.paid) {
    const bal = (await db.query("SELECT credited_days + carried_days - used_days AS left FROM leave_balances WHERE user_id = $1 AND leave_type_id = $2 AND year = $3", [userId(req), type.id, Number(b.startDate.slice(0, 4))])).rows[0];
    const left = Math.max(0, Number(bal?.left ?? 0));
    if (left < calc.days) {
      if (!s.policies.unpaidWhenNoBalance) throw badRequest(`You have ${left} days of ${type.name} left`);
      unpaid = calc.days - left;
    }
  } else unpaid = calc.days;
  const overlap = (await db.query("SELECT 1 FROM leave_requests WHERE user_id = $1 AND status IN ('pending','approved') AND start_date <= $3 AND end_date >= $2", [userId(req), b.startDate, b.endDate])).rowCount;
  if (overlap) throw conflict("You already have leave on some of these dates");
  const r = (await db.query(
    "INSERT INTO leave_requests (tenant_id, user_id, leave_type_id, start_date, end_date, half_day, days, reason, sandwich_days, unpaid_days, part, short_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
    [req.tenant!.id, userId(req), type.id, b.startDate, b.endDate, part === "first_half" || part === "second_half", calc.days, b.reason, calc.sandwich, unpaid, part, part === "short" ? b.shortMinutes : null],
  )).rows[0];
  const lead = await approverFor(db, userId(req));
  await notify(db, [lead], { kind: "leave.requested", title: `${req.user!.name} asked for ${calc.days} day(s) of ${type.name}${unpaid ? ` (${unpaid} unpaid)` : ""}`, link: "/leave?tab=team" });
  await fireAlerts(db, "leave.requested", { key: r.id, title: `${req.user!.name} asked for leave from ${b.startDate}`, link: "/leave?tab=team", ownerIds: [lead] });
  return r;
}));

async function assertLeaveApprover(req: any, db: any, ownerId: string) {
  if (can(req, "leave.manage")) return;
  const lead = await approverFor(db, ownerId);
  if (!can(req, "leave.approve_team") || lead !== userId(req) || ownerId === userId(req)) throw forbidden("Only this person's Team Lead or HR can decide");
}

timeRouter.post("/leave/requests/:id/:action", h(async (req, db) => {
  const action = z.enum(["approve", "reject", "cancel"]).parse(req.params.action);
  const r = (await db.query("SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE", [uuid.parse(req.params.id)])).rows[0];
  if (!r) throw notFound();
  if (action === "cancel") {
    if (r.user_id !== userId(req) && !can(req, "leave.manage")) throw forbidden();
    if (!["pending", "approved"].includes(r.status)) throw conflict(`This request is ${r.status}`);
    if (r.status === "approved") await db.query("UPDATE leave_balances SET used_days = used_days - $1 WHERE user_id = $2 AND leave_type_id = $3 AND year = $4", [Number(r.days) - Number(r.unpaid_days), r.user_id, r.leave_type_id, Number(r.start_date.slice(0, 4))]);
    await db.query("UPDATE leave_requests SET status = 'cancelled' WHERE id = $1", [r.id]);
    return { ok: true };
  }
  await assertLeaveApprover(req, db, r.user_id);
  if (r.status !== "pending") throw conflict(`This request is already ${r.status}`);
  if (action === "approve") {
    await db.query(
      `INSERT INTO leave_balances (tenant_id, user_id, leave_type_id, year, credited_days, used_days) VALUES ($1,$2,$3,$4,0,$5)
       ON CONFLICT (user_id, leave_type_id, year) DO UPDATE SET used_days = leave_balances.used_days + EXCLUDED.used_days`,
      [req.tenant!.id, r.user_id, r.leave_type_id, Number(r.start_date.slice(0, 4)), Number(r.days) - Number(r.unpaid_days)],
    );
  }
  await db.query("UPDATE leave_requests SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1", [r.id, action === "approve" ? "approved" : "rejected", userId(req)]);
  await notify(db, [r.user_id], { kind: `leave.${action}d`, title: `Your leave from ${r.start_date} was ${action === "approve" ? "approved" : "declined"}`, link: "/leave", email: true });
  await audit(db, req, `leave.${action}`, "leave_request", r.id, {});
  return { ok: true };
}));

// ---------- work from home ----------
timeRouter.get("/wfh", h(async (req, db) => {
  const q = z.object({ scope: z.enum(["mine", "team", "all"]).default("mine"), status: z.string().optional() }).parse(req.query);
  return (await db.query(
    `SELECT r.*, u.name AS user_name FROM wfh_requests r JOIN users u ON u.id = r.user_id LEFT JOIN teams t ON t.id = u.team_id
     WHERE (${scopeSql}) AND ($4::text IS NULL OR r.status = $4) ORDER BY r.date DESC LIMIT 300`,
    [q.scope, userId(req), can(req, "leave.manage"), q.status ?? null],
  )).rows;
}));
timeRouter.post("/wfh", requirePerm("leave.request"), h(async (req, db) => {
  const b = wfhRequestSchema.parse(req.body);
  const s = await getSettings(db);
  const auto = !s.policies.wfhNeedsApproval;
  const sheet = (await db.query("SELECT status FROM sheets WHERE user_id = $1 AND date = $2", [userId(req), b.date])).rows[0];
  if (sheet && ["submitted", "approved"].includes(sheet.status)) throw conflict("That day's sheet is already submitted");
  const r = (await db.query(
    "INSERT INTO wfh_requests (tenant_id, user_id, date, kind, reason, status, decided_at, minutes) VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $6 = 'approved' THEN now() END, $7) RETURNING *",
    [req.tenant!.id, userId(req), b.date, b.kind, b.reason, auto ? "approved" : "pending", b.kind === "hours" ? (b.minutes ?? 120) : null],
  )).rows[0];
  if (!auto) {
    const mins = b.kind === "full" ? s.policies.wfhFullDayMinutes : b.kind === "half" ? s.policies.wfhHalfDayMinutes : s.policies.dailyMinimumMinutes;
    await fireAlerts(db, "leave.requested", { key: r.id, title: `${req.user!.name} asked to work from home on ${b.date}`, link: "/leave?tab=team", ownerIds: [await approverFor(db, userId(req))] });
    await notify(db, [await approverFor(db, userId(req))], { kind: "wfh.requested", title: `${req.user!.name} asked to work from home on ${b.date}`, body: b.kind === "hours" ? `${formatMinutes(b.minutes ?? 120)} from home; a normal day is still expected.` : `${b.kind === "full" ? "Full" : "Half"} day: ${formatMinutes(mins)} expected.`, link: "/leave?tab=team" });
  }
  return r;
}));
timeRouter.post("/wfh/:id/:action", h(async (req, db) => {
  const action = z.enum(["approve", "reject", "cancel"]).parse(req.params.action);
  const r = (await db.query("SELECT * FROM wfh_requests WHERE id = $1", [uuid.parse(req.params.id)])).rows[0];
  if (!r) throw notFound();
  if (action === "cancel") {
    if (r.user_id !== userId(req)) throw forbidden();
    await db.query("UPDATE wfh_requests SET status = 'cancelled' WHERE id = $1 AND status IN ('pending','approved')", [r.id]);
    return { ok: true };
  }
  await assertLeaveApprover(req, db, r.user_id);
  if (r.status !== "pending") throw conflict(`This request is already ${r.status}`);
  await db.query("UPDATE wfh_requests SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1", [r.id, action === "approve" ? "approved" : "rejected", userId(req)]);
  await notify(db, [r.user_id], { kind: `wfh.${action}d`, title: `Your WFH on ${r.date} was ${action === "approve" ? "approved" : "declined"}`, link: "/leave" });
  return { ok: true };
}));
