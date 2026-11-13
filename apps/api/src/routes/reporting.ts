import { CANCELLED, INVOICE_STATE, REFUNDED } from "../lib/invoiceState";
import { Router } from "express";
import { z } from "zod";
import { can, h, userId } from "../lib/context";
import { forbidden, notFound } from "../lib/errors";
import { getSettings } from "../lib/settings";
import { addDays, periodBounds, todayIn } from "../lib/dates";
import ExcelJS from "exceljs";
import { byTeam, sumStats, timesheetStats, type Scope } from "../services/reporting";

/** Timesheet reporting carried over from the old EPM: team and sheet reporting, attendance, the master report, unfilled sheets and per-person reports. */
export const reportingRouter = Router();
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const filters = z.object({
  from: date.optional(), to: date.optional(), teamId: uuid.optional(), departmentId: uuid.optional(), userId: uuid.optional(), managerId: uuid.optional(),
  projectId: uuid.optional(), clientId: uuid.optional(), status: z.enum(["approved", "submitted", "draft", "rejected"]).optional(),
  activityTypeId: uuid.optional(), category: z.enum(["billable", "inhouse", "no_work"]).optional(), search: z.string().optional(),
  offline: z.enum(["1", "0"]).optional(), includeInactive: z.enum(["1"]).optional(),
  invoiceState: z.enum(["refunded", "cancelled", "invoiced", "not_invoiced"]).optional(),
  page: z.coerce.number().int().min(0).optional(), size: z.coerce.number().int().min(10).max(500).optional(),
});

/** Who the signed-in person may report on: everyone (reports.view or approve_all), the people who report to them (TLs), or only themselves. */
function scopeFor(req: any, q: z.infer<typeof filters>): Scope {
  const all = can(req, "reports.view") || can(req, "time.approve_all");
  const base: Scope = { teamId: q.teamId, departmentId: q.departmentId, userIds: q.userId ? [q.userId] : undefined, managerId: q.managerId, includeInactive: !!q.includeInactive };
  if (all) return base;
  if (can(req, "time.approve_team")) return { ...base, managerId: userId(req) };
  return { ...base, userIds: [userId(req)] };
}
async function window(req: any, db: any) {
  const s = await getSettings(db);
  const today = todayIn(s.locale.timezone);
  const q = filters.parse(req.query);
  const month = periodBounds(today, "month");
  const from = q.from ?? month.start, to = q.to ?? today;
  if (to < from) throw forbidden("The end date is before the start date");
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 400) throw forbidden("Pick a range of up to 13 months");
  return { s, today, q, from, to };
}

/** Team reporting: expected vs logged hours, billable/in-house/no work, leave, unfilled and utilization for each team, with each person below. */
reportingRouter.get("/reporting/utilization", h(async (req, db) => {
  const { s, today, q, from, to } = await window(req, db);
  const people = await timesheetStats(db, s, from, to, today, scopeFor(req, q));
  return { from, to, totals: sumStats(people), teams: byTeam(people), people };
}));

/** Day-by-day utilization for charts (company or the scoped people). */
reportingRouter.get("/reporting/trend", h(async (req, db) => {
  const { s, today, q, from, to } = await window(req, db);
  const people = await timesheetStats(db, s, from, to, today, scopeFor(req, q), true);
  const days = new Map<string, { date: string; expected: number; logged: number; approved: number; pending: number; present: number; absent: number; leave: number }>();
  for (const p of people) for (const c of p.days ?? []) {
    const d = days.get(c.date) ?? { date: c.date, expected: 0, logged: 0, approved: 0, pending: 0, present: 0, absent: 0, leave: 0 };
    d.expected += c.expected; d.logged += c.logged; d.approved += c.approved; d.pending += c.pending;
    if (["present", "wfh"].includes(c.status)) d.present++;
    if (c.status === "absent") d.absent++;
    if (["leave", "half_leave", "short_leave"].includes(c.status)) d.leave++;
    days.set(c.date, d);
  }
  return { from, to, days: [...days.values()] };
}));

/** Attendance: every person × every day, marked present, WFH, leave (full, half, short), holiday, absent or weekend. */
reportingRouter.get("/reporting/attendance", h(async (req, db) => {
  const { s, today, q, from, to } = await window(req, db);
  const people = await timesheetStats(db, s, from, to, today, scopeFor(req, q), true);
  return {
    from, to,
    events: (await db.query("SELECT title, kind, start_date, end_date FROM events WHERE start_date <= $2 AND end_date >= $1 ORDER BY start_date", [from, to])).rows,
    people: people.map((p) => ({
      user_id: p.user_id, name: p.name, team_name: p.team_name, department_name: p.department_name, employee_code: p.employee_code,
      present_days: p.present_days, absent_days: p.absent_days, leave_days: p.leave_days, wfh_days: p.wfh_days, working_days: p.working_days, expected: p.expected, logged: p.logged,
      days: (p.days ?? []).map((c) => ({ date: c.date, status: c.status, expected: c.expected, logged: c.logged, leave: c.leave, holiday: c.holiday, wfh: c.wfh })),
    })),
  };
}));

/** Unfilled sheets: each past working day someone owed hours but didn't submit, with their TL, team and department. */
reportingRouter.get("/reporting/unfilled", h(async (req, db) => {
  const { s, today, q, from, to } = await window(req, db);
  const people = await timesheetStats(db, s, from, addDays(today, -1) < to ? addDays(today, -1) : to, today, scopeFor(req, q), true);
  const rows = people.flatMap((p) => (p.days ?? []).filter((c) => p.unfilled_days.includes(c.date)).map((c) => ({
    user_id: p.user_id, name: p.name, team_name: p.team_name, department_name: p.department_name, lead_name: p.lead_name, date: c.date,
    expected: c.expected, logged: c.logged, missing: Math.max(0, c.expected - c.logged), sheet: c.sheet,
  })));
  return { from, to, rows: rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name))), people: people.filter((p) => p.unfilled_days.length).map((p) => ({ user_id: p.user_id, name: p.name, team_name: p.team_name, lead_name: p.lead_name, days: p.unfilled_days.length, missing: p.unfilled })) };
}));

/**
 * Master reporting: every sheet entry with every filter (person, team, department, reporting manager, project, client, status,
 * work type, kind of work, offline), totals by kind and status, and groupings for the charts.
 */
reportingRouter.get("/reporting/entries", h(async (req, db, res) => {
  const { s, today, q, from, to } = await window(req, db);
  const sc = scopeFor(req, q);
  const where = [
    "e.date BETWEEN $1 AND $2",
    "($3::uuid[] IS NULL OR e.user_id = ANY($3))", "($4::uuid IS NULL OR u.team_id = $4)", "($5::uuid IS NULL OR u.department_id = $5)",
    "($6::uuid IS NULL OR coalesce(u.reporting_manager_id, t.lead_user_id) = $6 OR u.id = $6)",
    "($7::uuid IS NULL OR e.project_id = $7)", "($8::uuid IS NULL OR p.client_id = $8)", "($9::text IS NULL OR s.status = $9)",
    "($10::uuid IS NULL OR e.activity_type_id = $10)",
    "($11::text IS NULL OR (CASE WHEN e.category IS NOT NULL THEN e.category WHEN p.is_internal THEN 'inhouse' ELSE coalesce(a.category, 'billable') END) = $11)",
    "($12::text IS NULL OR e.description ILIKE $12 OR p.name ILIKE $12 OR u.name ILIKE $12 OR c.name ILIKE $12)",
    "($13::boolean IS NULL OR e.offline = $13)",
    `($14::text IS NULL OR ${INVOICE_STATE} = $14)`,
  ].join(" AND ");
  const args = [from, to, sc.userIds ?? null, sc.teamId ?? null, sc.departmentId ?? null, sc.managerId ?? null, q.projectId ?? null, q.clientId ?? null, q.status ?? null,
    q.activityTypeId ?? null, q.category ?? null, q.search ? `%${q.search}%` : null, q.offline ? q.offline === "1" : null, q.invoiceState ?? null];
  // The list is paged on the server so it stays quick however many entries there are; the Excel export takes everything.
  const xlsx = String(req.query.format ?? "") === "xlsx";
  const size = q.size ?? 50, page = q.page ?? 0;
  const FROM = `FROM time_entries e JOIN sheets s ON s.id = e.sheet_id JOIN users u ON u.id = e.user_id LEFT JOIN teams t ON t.id = u.team_id
    LEFT JOIN departments d ON d.id = u.department_id JOIN projects p ON p.id = e.project_id JOIN clients c ON c.id = p.client_id
    LEFT JOIN activity_types a ON a.id = e.activity_type_id LEFT JOIN tasks tk ON tk.id = e.task_id LEFT JOIN project_trackers tr ON tr.id = e.tracker_id`;
  const rows = (await db.query(
    `SELECT e.id, e.sheet_id, e.date, e.minutes, e.description, e.source, e.offline, e.offline_reason, s.status, s.submitted_at, s.decided_at, (SELECT name FROM users x WHERE x.id = s.decided_by) AS decided_by_name,
       u.id AS user_id, u.name AS user_name, t.name AS team_name, d.name AS department_name, p.id AS project_id, p.name AS project_name, p.type AS project_type, p.status AS project_status,
       c.name AS client_name, a.name AS activity, CASE WHEN e.category IS NOT NULL THEN e.category WHEN p.is_internal THEN 'inhouse' ELSE coalesce(a.category, 'billable') END AS category, tk.title AS task, tr.label AS tracker,
       (SELECT name FROM users x WHERE x.id = coalesce(u.reporting_manager_id, t.lead_user_id)) AS manager_name, ${INVOICE_STATE} AS invoice_state
     ${FROM} WHERE ${where} ORDER BY e.date DESC, u.name, e.id LIMIT ${xlsx ? 100000 : size} OFFSET ${xlsx ? 0 : page * size}`, args)).rows;
  const total = (await db.query(`SELECT count(*)::int AS n ${FROM} WHERE ${where}`, args)).rows[0].n as number;
  const sums = (await db.query(
    `SELECT CASE WHEN e.category IS NOT NULL THEN e.category WHEN p.is_internal THEN 'inhouse' ELSE coalesce(a.category, 'billable') END AS category, s.status, sum(e.minutes)::int AS minutes, count(*)::int AS entries,
       coalesce(sum(e.minutes) FILTER (WHERE e.offline),0)::int AS offline,
       coalesce(sum(e.minutes) FILTER (WHERE ${REFUNDED}),0)::int AS refunded, coalesce(sum(e.minutes) FILTER (WHERE ${CANCELLED}),0)::int AS cancelled
     ${FROM} WHERE ${where} GROUP BY 1, 2`, args)).rows;
  if (xlsx) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Timesheets");
    ws.columns = [
      { header: "Date", key: "date", width: 12 }, { header: "Employee", key: "user_name", width: 22 }, { header: "Team", key: "team_name", width: 16 },
      { header: "Reporting manager", key: "manager_name", width: 20 }, { header: "Client", key: "client_name", width: 22 }, { header: "Project", key: "project_name", width: 28 },
      { header: "Task", key: "task", width: 24 }, { header: "Work type", key: "activity", width: 16 }, { header: "Kind", key: "category", width: 10 },
      { header: "Hours", key: "hours", width: 8 }, { header: "What was done", key: "description", width: 50 }, { header: "Tracked", key: "tracked", width: 16 },
      { header: "Sheet status", key: "status", width: 12 }, { header: "Invoice", key: "invoice", width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    const label: Record<string, string> = { approved: "Approved", submitted: "Waiting", draft: "Draft", rejected: "Sent back" };
    for (const r of rows) ws.addRow({ ...r, hours: Math.round((r.minutes / 60) * 100) / 100, tracked: r.offline ? "Offline" : r.tracker ? `Tracking ID ${r.tracker}` : r.source === "eszy" ? "Tracked here" : r.source, status: label[r.status] ?? r.status, invoice: ({ refunded: "Refunded", cancelled: "Cancelled invoice", invoiced: "Invoiced", not_invoiced: "Not invoiced" } as any)[r.invoice_state], category: r.category === "inhouse" ? "In-house" : r.category === "no_work" ? "No work" : "Billable" });
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="timesheets-${from}-to-${to}.xlsx"`);
    res.send(Buffer.from(buf));
    return;
  }
  // Expected hours, unfilled sheets and leave for the people in the filter (not narrowed by project, client or work type).
  const people = await timesheetStats(db, s, from, to, today, sc);
  const totals = sumStats(people);
  const group = async (expr: string, label: string) => (await db.query(
    `SELECT ${expr} AS key, ${label} AS label, sum(e.minutes)::int AS minutes,
       sum(e.minutes) FILTER (WHERE s.status = 'approved' AND (CASE WHEN e.category IS NOT NULL THEN e.category WHEN p.is_internal THEN 'inhouse' ELSE coalesce(a.category, 'billable') END) = 'billable')::int AS billable
     ${FROM} WHERE ${where} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 25`, args)).rows;
  return {
    from, to, rows, total, page, size, truncated: false, sums,
    stats: { expected: (totals as any).expected ?? 0, unfilled_minutes: (totals as any).unfilled ?? 0, unfilled_sheets: totals.unfilled_sheets, leave: (totals as any).leave ?? 0, people: people.length, utilization: totals.utilization },
    groups: {
      person: await group("u.id::text", "u.name"), project: await group("p.id::text", "p.name"), client: await group("c.id::text", "c.name"),
      team: await group("coalesce(t.id::text, 'none')", "coalesce(t.name, 'No team')"), activity: await group("coalesce(a.id::text, 'none')", "coalesce(a.name, 'No work type')"),
      date: (await db.query(`SELECT e.date AS key, e.date AS label, sum(e.minutes)::int AS minutes ${FROM} WHERE ${where} GROUP BY 1 ORDER BY 1`, args)).rows,
    },
  };
}));

/** One person's report: their numbers, each day, each project and work type, and every entry. */
reportingRouter.get("/reporting/person/:id", h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const { s, today, from, to } = await window(req, db);
  const all = can(req, "reports.view") || can(req, "time.approve_all") || can(req, "users.view");
  if (!all && id !== userId(req)) {
    const reports = (await db.query("SELECT 1 FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = $1 AND coalesce(u.reporting_manager_id, t.lead_user_id) = $2", [id, userId(req)])).rowCount;
    if (!reports) throw forbidden("You can only see reports for yourself and the people who report to you");
  }
  const [stats] = await timesheetStats(db, s, from, to, today, { userIds: [id], includeInactive: true }, true);
  if (!stats) throw notFound("This person doesn't fill timesheets");
  const entries = (await db.query(
    `SELECT e.id, e.date, e.minutes, e.description, e.source, e.offline, e.offline_reason, s.status, p.id AS project_id, p.name AS project_name, c.name AS client_name,
       a.name AS activity, CASE WHEN e.category IS NOT NULL THEN e.category WHEN p.is_internal THEN 'inhouse' ELSE coalesce(a.category, 'billable') END AS category, tk.title AS task, tr.label AS tracker,
       ${INVOICE_STATE} AS invoice_state
     FROM time_entries e JOIN sheets s ON s.id = e.sheet_id JOIN projects p ON p.id = e.project_id JOIN clients c ON c.id = p.client_id
     LEFT JOIN activity_types a ON a.id = e.activity_type_id LEFT JOIN tasks tk ON tk.id = e.task_id LEFT JOIN project_trackers tr ON tr.id = e.tracker_id
     WHERE e.user_id = $1 AND e.date BETWEEN $2 AND $3 ORDER BY e.date DESC, p.name`, [id, from, to])).rows;
  const byProject = Object.values(entries.reduce((m: any, e: any) => {
    const k = e.project_id; m[k] ??= { project_id: k, project_name: e.project_name, client_name: e.client_name, minutes: 0, billable: 0, inhouse: 0, no_work: 0, approved: 0, refunded: 0, cancelled: 0 };
    m[k].minutes += e.minutes; m[k][e.category] += e.minutes; if (e.status === "approved") m[k].approved += e.minutes;
    if (e.invoice_state === "refunded") m[k].refunded += e.minutes; if (e.invoice_state === "cancelled") m[k].cancelled += e.minutes; return m;
  }, {})).sort((a: any, b: any) => b.minutes - a.minutes);
  const byActivity = Object.values(entries.reduce((m: any, e: any) => {
    const k = e.activity ?? "No work type"; m[k] ??= { activity: k, category: e.category, minutes: 0 }; m[k].minutes += e.minutes; return m;
  }, {})).sort((a: any, b: any) => b.minutes - a.minutes);
  return { from, to, stats, entries, byProject, byActivity };
}));

/** Morning standup, built from yesterday's approved and submitted sheets, grouped into billable, in-house and other work. */
reportingRouter.get("/reporting/standup", h(async (req, db) => {
  const s = await getSettings(db);
  const today = todayIn(s.locale.timezone);
  const q = z.object({ date: date.optional(), teamId: uuid.optional() }).parse(req.query);
  let d = q.date ?? addDays(today, -1);
  if (!q.date) { for (let i = 0; i < 7 && !s.policies.workingDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay()); i++) d = addDays(d, -1); }
  const sc = scopeFor(req, { teamId: q.teamId } as any);
  const rows = (await db.query(
    `SELECT u.id AS user_id, u.name, t.name AS team_name, p.name AS project_name, c.name AS client_name, a.name AS activity,
       CASE WHEN e.category IS NOT NULL THEN e.category WHEN p.is_internal THEN 'inhouse' ELSE coalesce(a.category, 'billable') END AS category, sum(e.minutes)::int AS minutes,
       string_agg(DISTINCT nullif(e.description, ''), '; ') AS notes
     FROM time_entries e JOIN sheets s ON s.id = e.sheet_id AND s.status IN ('submitted','approved') JOIN users u ON u.id = e.user_id LEFT JOIN teams t ON t.id = u.team_id
     JOIN projects p ON p.id = e.project_id JOIN clients c ON c.id = p.client_id LEFT JOIN activity_types a ON a.id = e.activity_type_id
     WHERE e.date = $1 AND ($2::uuid[] IS NULL OR u.id = ANY($2)) AND ($3::uuid IS NULL OR u.team_id = $3) AND ($4::uuid IS NULL OR coalesce(u.reporting_manager_id, t.lead_user_id) = $4 OR u.id = $4)
     GROUP BY 1,2,3,4,5,6,7 ORDER BY 3 NULLS LAST, 2, 8 DESC`, [d, sc.userIds ?? null, sc.teamId ?? null, sc.managerId ?? null])).rows;
  const plans = (await db.query("SELECT st.user_id, st.today, st.blockers FROM standups st WHERE st.date = $1", [today])).rows;
  return { date: d, rows, plans };
}));

/** Leave credits: each person's balances with probation and notice dates, and paid/unpaid leave taken this year. */
reportingRouter.get("/reporting/leave-credits", h(async (req, db) => {
  if (!can(req, "leave.manage") && !can(req, "reports.view")) throw forbidden();
  const s = await getSettings(db);
  const today = todayIn(s.locale.timezone);
  const q = z.object({ year: z.coerce.number().int().optional() }).parse(req.query);
  const year = q.year ?? Number(today.slice(0, 4));
  const from = `${year}-01-01`, to = `${year}-12-31` < today ? `${year}-12-31` : today;
  const stats = from <= to ? await timesheetStats(db, s, from, to, today, { includeInactive: true }) : [];
  const people = (await db.query(
    `SELECT u.id, u.name, u.employee_code, u.employment_status, u.joined_on, u.probation_ends_on, u.notice_starts_on, u.last_working_day, t.name AS team_name,
       coalesce((SELECT json_agg(json_build_object('leave_type_id', b.leave_type_id, 'name', lt.name, 'paid', lt.paid, 'credited', b.credited_days, 'carried', b.carried_days, 'used', b.used_days) ORDER BY lt.name)
         FROM leave_balances b JOIN leave_types lt ON lt.id = b.leave_type_id WHERE b.user_id = u.id AND b.year = $1), '[]') AS balances,
       (SELECT coalesce(sum(r.unpaid_days),0) FROM leave_requests r WHERE r.user_id = u.id AND r.status = 'approved' AND extract(year FROM r.start_date) = $1) AS unpaid_days,
       (SELECT coalesce(sum(r.days),0) FROM leave_requests r WHERE r.user_id = u.id AND r.status = 'approved' AND extract(year FROM r.start_date) = $1) AS taken_days,
       (SELECT count(*)::int FROM leave_requests r WHERE r.user_id = u.id AND r.status = 'pending') AS pending_requests
     FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.status <> 'invited' ORDER BY u.name`, [year])).rows;
  const by = new Map(stats.map((x) => [x.user_id, x]));
  return {
    year, dailyMinutes: s.policies.dailyMinimumMinutes,
    people: people.map((p: any) => ({ ...p, expected: by.get(p.id)?.expected ?? null, logged: by.get(p.id)?.logged ?? null, leave_minutes: by.get(p.id)?.leave ?? null })),
  };
}));

/**
 * Leave reporting: for the people in scope, leave taken in the period by type (full, half and short), WFH, pending requests
 * and unpaid days, each request, and days per month. A request counts in the period its start date falls in.
 */
reportingRouter.get("/reporting/leave", h(async (req, db) => {
  const { s, q, from, to } = await window(req, db);
  const all = can(req, "reports.view") || can(req, "time.approve_all") || can(req, "leave.manage");
  const base: Scope = { teamId: q.teamId, departmentId: q.departmentId, userIds: q.userId ? [q.userId] : undefined, managerId: q.managerId, includeInactive: !!q.includeInactive };
  const sc: Scope = all ? base : can(req, "leave.approve_team") || can(req, "time.approve_team") ? { ...base, managerId: userId(req) } : { ...base, userIds: [userId(req)] };
  const extra = z.object({ leaveTypeId: uuid.optional(), leaveStatus: z.enum(["pending", "approved", "rejected", "cancelled"]).optional() }).parse(req.query);
  const people = (await db.query(
    `SELECT u.id, u.name, u.employee_code, u.employment_status, t.name AS team_name, d.name AS department_name,
       (SELECT name FROM users x WHERE x.id = coalesce(u.reporting_manager_id, t.lead_user_id)) AS manager_name
     FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.status <> 'invited' AND ($5 OR u.status = 'active')
       AND ($1::uuid[] IS NULL OR u.id = ANY($1)) AND ($2::uuid IS NULL OR u.team_id = $2) AND ($3::uuid IS NULL OR u.department_id = $3)
       AND ($4::uuid IS NULL OR coalesce(u.reporting_manager_id, t.lead_user_id) = $4 OR u.id = $4)
     ORDER BY u.name`, [sc.userIds ?? null, sc.teamId ?? null, sc.departmentId ?? null, sc.managerId ?? null, !!sc.includeInactive])).rows;
  const ids = people.map((p: any) => p.id);
  const types = (await db.query("SELECT id, name, paid FROM leave_types ORDER BY active DESC, name")).rows;
  const requests = ids.length ? (await db.query(
    `SELECT r.id, r.user_id, u.name AS user_name, t.name AS team_name, r.leave_type_id, lt.name AS type_name, lt.paid, r.start_date, r.end_date, r.days, r.part, r.half_day,
       r.short_minutes, r.unpaid_days, r.reason, r.status, r.created_at, r.decided_at, dc.name AS decided_by_name
     FROM leave_requests r JOIN users u ON u.id = r.user_id LEFT JOIN teams t ON t.id = u.team_id JOIN leave_types lt ON lt.id = r.leave_type_id LEFT JOIN users dc ON dc.id = r.decided_by
     WHERE r.user_id = ANY($1) AND r.start_date BETWEEN $2 AND $3 AND ($4::uuid IS NULL OR r.leave_type_id = $4) AND ($5::text IS NULL OR r.status = $5)
     ORDER BY r.start_date DESC, u.name`, [ids, from, to, extra.leaveTypeId ?? null, extra.leaveStatus ?? null])).rows : [];
  const wfh = ids.length ? (await db.query(
    `SELECT w.user_id, count(*) FILTER (WHERE w.kind = 'full')::int AS full_days, count(*) FILTER (WHERE w.kind = 'half')::int AS half_days,
       coalesce(sum(w.minutes) FILTER (WHERE w.kind = 'hours'),0)::int AS hour_minutes
     FROM wfh_requests w WHERE w.status = 'approved' AND w.user_id = ANY($1) AND w.date BETWEEN $2 AND $3 GROUP BY w.user_id`, [ids, from, to])).rows : [];
  const wfhBy = new Map(wfh.map((w: any) => [w.user_id, w]));
  const part = (r: any) => (r.short_minutes ? "short" : r.part === "first_half" || r.part === "second_half" || r.half_day ? "half" : "full");
  const rows = people.map((p: any) => {
    const mine = requests.filter((r: any) => r.user_id === p.id);
    const ok = mine.filter((r: any) => r.status === "approved");
    const byType: Record<string, number> = {};
    for (const r of ok) byType[r.leave_type_id] = (byType[r.leave_type_id] ?? 0) + Number(r.days);
    const w: any = wfhBy.get(p.id) ?? {};
    return {
      ...p, by_type: byType,
      days: ok.reduce((a: number, r: any) => a + Number(r.days), 0),
      full: ok.filter((r: any) => part(r) === "full").length, half: ok.filter((r: any) => part(r) === "half").length, short: ok.filter((r: any) => part(r) === "short").length,
      unpaid: ok.reduce((a: number, r: any) => a + Number(r.unpaid_days ?? 0), 0),
      pending: mine.filter((r: any) => r.status === "pending").length, rejected: mine.filter((r: any) => r.status === "rejected").length,
      wfh_days: (w.full_days ?? 0) + (w.half_days ?? 0) / 2, wfh_hours: w.hour_minutes ?? 0,
    };
  });
  const months: Record<string, any> = {};
  for (const r of requests.filter((x: any) => x.status === "approved")) {
    const m = String(r.start_date).slice(0, 7);
    months[m] ??= { month: m, days: 0 };
    months[m].days += Number(r.days);
    months[m][r.leave_type_id] = (months[m][r.leave_type_id] ?? 0) + Number(r.days);
  }
  const approved = requests.filter((r: any) => r.status === "approved");
  return {
    from, to, types, people: rows, requests: requests.map((r: any) => ({ ...r, kind: part(r) })), byMonth: Object.values(months).sort((a: any, b: any) => a.month.localeCompare(b.month)),
    totals: {
      days: approved.reduce((a: number, r: any) => a + Number(r.days), 0), requests: requests.length,
      pending: requests.filter((r: any) => r.status === "pending").length, unpaid: approved.reduce((a: number, r: any) => a + Number(r.unpaid_days ?? 0), 0),
      people_on_leave: new Set(approved.map((r: any) => r.user_id)).size, wfh_days: rows.reduce((a: number, r: any) => a + r.wfh_days, 0),
      half: approved.filter((r: any) => part(r) === "half").length, short: approved.filter((r: any) => part(r) === "short").length,
    },
    dailyMinutes: s.policies.dailyMinimumMinutes,
  };
}));

/**
 * A report that fits what the person does, for their page: the people under them if they lead anyone, the projects they run
 * as PM or TL, the leads they brought and converted if they sell, and the invoices and payments they handled if they bill.
 * Only the parts the viewer is allowed to see are filled in.
 */
reportingRouter.get("/reporting/person/:id/role", h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const { s, today, from, to } = await window(req, db);
  const all = can(req, "reports.view") || can(req, "time.approve_all") || can(req, "users.view");
  if (!all && id !== userId(req)) {
    const reports = (await db.query("SELECT 1 FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = $1 AND coalesce(u.reporting_manager_id, t.lead_user_id) = $2", [id, userId(req)])).rowCount;
    if (!reports) throw forbidden("You can only see reports for yourself and the people who report to you");
  }
  const u = (await db.query(
    `SELECT u.id, u.name, u.designation, coalesce((SELECT array_agg(r.key) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '{}') AS role_keys,
       coalesce((SELECT array_agg(r.name ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '{}') AS role_names,
       coalesce((SELECT array_agg(DISTINCT p) FROM user_roles ur JOIN roles r ON r.id = ur.role_id, unnest(r.permissions) p WHERE ur.user_id = u.id), '{}') AS perms
     FROM users u WHERE u.id = $1`, [id])).rows[0];
  if (!u) throw notFound();
  const perms = new Set<string>(u.perms);
  const money = can(req, "money.view");
  const sections: any[] = [];

  // People who report to them (directly, or through a team they lead or manage).
  const team = (await db.query(
    `SELECT u.id FROM users u LEFT JOIN teams t ON t.id = u.team_id
     WHERE u.status = 'active' AND u.id <> $1 AND (u.reporting_manager_id = $1 OR (u.reporting_manager_id IS NULL AND t.lead_user_id = $1) OR t.manager_user_id = $1)`, [id])).rows.map((r) => r.id);
  if (team.length) {
    const rows = await timesheetStats(db, s, from, to, today, { userIds: team });
    const names = (await db.query("SELECT u.id, u.name, u.designation, t.name AS team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ANY($1)", [team])).rows;
    const nm = new Map(names.map((x: any) => [x.id, x]));
    const pending = (await db.query("SELECT count(*)::int AS n FROM sheets WHERE status = 'submitted' AND user_id = ANY($1)", [team])).rows[0].n;
    const leavePending = (await db.query("SELECT count(*)::int AS n FROM leave_requests WHERE status = 'pending' AND user_id = ANY($1)", [team])).rows[0].n;
    sections.push({
      kind: "team", title: "Their team", totals: sumStats(rows), pendingSheets: pending, pendingLeave: leavePending,
      people: rows.map((r: any) => ({ ...r, ...nm.get(r.user_id ?? r.id) })).sort((a: any, b: any) => (a.utilization ?? 0) - (b.utilization ?? 0)),
    });
  }

  // Projects they run as PM or Team Lead.
  const projects = (await db.query(
    `SELECT p.id, p.name, p.status, c.name AS client_name, CASE WHEN p.pm_user_id = $1 OR m.role = 'pm' THEN 'pm' ELSE 'tl' END AS as_role,
       st.name AS stage_name, p.delivery_date,
       (SELECT coalesce(sum(e.minutes),0)::int FROM time_entries e WHERE e.project_id = p.id AND e.date BETWEEN $2 AND $3) AS minutes,
       (SELECT coalesce(sum(e.minutes),0)::int FROM time_entries e JOIN sheets sh ON sh.id = e.sheet_id AND sh.status = 'approved' WHERE e.project_id = p.id AND e.date BETWEEN $2 AND $3) AS approved,
       (SELECT count(*)::int FROM tasks tk WHERE tk.project_id = p.id AND tk.status <> 'done') AS open_tasks,
       (SELECT count(*)::int FROM tasks tk WHERE tk.project_id = p.id AND tk.status <> 'done' AND tk.due_date < $4) AS late_tasks,
       (SELECT count(*)::int FROM project_members pm WHERE pm.project_id = p.id) AS people
     FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1 LEFT JOIN project_stages st ON st.id = p.stage_id
     WHERE p.status <> 'ended' AND (p.pm_user_id = $1 OR m.role IN ('pm','tl'))
     ORDER BY minutes DESC`, [id, from, to, today])).rows;
  if (projects.length) {
    sections.push({
      kind: "projects", title: "Projects they run", rows: projects,
      totals: { projects: projects.length, minutes: projects.reduce((a, p) => a + p.minutes, 0), open_tasks: projects.reduce((a, p) => a + p.open_tasks, 0), late_tasks: projects.reduce((a, p) => a + p.late_tasks, 0) },
    });
  }

  // Sales: leads brought, called and converted.
  const sales = perms.has("leads.create") || perms.has("leads.view_all") || u.role_keys.some((k: string) => k.startsWith("sales"));
  // Others only get this section when they did sales work in these dates (brought, converted or called a lead).
  const leadCount = sales ? 1 : (await db.query(
    `SELECT (SELECT count(*) FROM leads WHERE (bringer_id = $1 AND created_at::date BETWEEN $2 AND $3) OR (converter_id = $1 AND converted_at::date BETWEEN $2 AND $3))
          + (SELECT count(*) FROM lead_calls WHERE caller_id = $1 AND called_at::date BETWEEN $2 AND $3) AS n`, [id, from, to])).rows[0].n;
  if (sales || Number(leadCount) > 0) {
    const l = (await db.query(
      `SELECT count(*) FILTER (WHERE bringer_id = $1 AND created_at::date BETWEEN $2 AND $3)::int AS brought,
         count(*) FILTER (WHERE converter_id = $1 AND converted_at::date BETWEEN $2 AND $3)::int AS converted,
         count(*) FILTER (WHERE caller_id = $1 AND status NOT IN ('converted','lost','onboarded'))::int AS open_assigned,
         count(*) FILTER (WHERE (caller_id = $1 OR bringer_id = $1) AND next_follow_up_at < now() AND status NOT IN ('converted','lost','onboarded'))::int AS overdue,
         coalesce(sum(estimated_value_minor) FILTER (WHERE converter_id = $1 AND converted_at::date BETWEEN $2 AND $3),0)::bigint AS converted_value_minor
       FROM leads`, [id, from, to])).rows[0];
    const calls = (await db.query(
      `SELECT outcome, count(*)::int AS n FROM lead_calls WHERE caller_id = $1 AND called_at::date BETWEEN $2 AND $3 GROUP BY outcome`, [id, from, to])).rows;
    const recent = (await db.query(
      `SELECT id, title, company, status, created_at, converted_at, CASE WHEN converter_id = $1 THEN 'converted' WHEN bringer_id = $1 THEN 'brought' ELSE 'calling' END AS how
       FROM leads WHERE bringer_id = $1 OR caller_id = $1 OR converter_id = $1 ORDER BY greatest(created_at, coalesce(converted_at, created_at)) DESC LIMIT 8`, [id])).rows;
    sections.push({ kind: "sales", title: "Sales", totals: { ...l, converted_value_minor: money ? l.converted_value_minor : null, calls: calls.reduce((a, c) => a + c.n, 0) }, calls, recent });
  }

  // Billing: invoices they raised and payments they recorded.
  if (perms.has("invoices.manage") || perms.has("payments.record")) {
    const b = (await db.query(
      `SELECT (SELECT count(*)::int FROM audit_log WHERE user_id = $1 AND action IN ('invoice.create','invoice.issue') AND at::date BETWEEN $2 AND $3) AS invoices,
         (SELECT count(*)::int FROM payments WHERE recorded_by = $1 AND received_on BETWEEN $2 AND $3) AS payments,
         (SELECT coalesce(sum(amount_minor),0)::bigint FROM payments WHERE recorded_by = $1 AND received_on BETWEEN $2 AND $3) AS collected_minor,
         (SELECT count(*)::int FROM invoices WHERE status IN ('unpaid','partially_paid') AND due_date < $4) AS overdue_company`, [id, from, to, today])).rows[0];
    sections.push({ kind: "billing", title: "Billing", totals: { ...b, collected_minor: money ? b.collected_minor : null } });
  }

  // HR: people and leave they look after.
  if (perms.has("users.manage") || perms.has("leave.manage")) {
    const h2 = (await db.query(
      `SELECT (SELECT count(*)::int FROM users WHERE status = 'active') AS headcount,
         (SELECT count(*)::int FROM users WHERE joined_on BETWEEN $1 AND $2) AS joined,
         (SELECT count(*)::int FROM users WHERE employment_status = 'notice') AS on_notice,
         (SELECT count(*)::int FROM users WHERE employment_status = 'provisional' AND status = 'active') AS provisional,
         (SELECT count(*)::int FROM leave_requests WHERE status = 'pending') AS leave_pending,
         (SELECT count(*)::int FROM leave_requests WHERE decided_by = $3 AND decided_at::date BETWEEN $1 AND $2) AS leave_decided`, [from, to, id])).rows[0];
    sections.push({ kind: "hr", title: "People and leave", totals: h2 });
  }
  return { from, to, user: { id: u.id, name: u.name, designation: u.designation, roles: u.role_names }, sections };
}));
