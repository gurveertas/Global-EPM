import { Router } from "express";
import { z } from "zod";
import { billingLineInputSchema, extraHoursSchema, projectCreateSchema, projectInputSchema } from "@eszy/shared";
import { can, h, userId } from "../lib/context";
import { requirePerm } from "../lib/auth";
import { requireFeature } from "../lib/tenant";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { audit, auditChange, notify, snapshot } from "../lib/audit";
import { getSettings } from "../lib/settings";
import { todayIn } from "../lib/dates";
import { createProject } from "../services/projects";
import { syncRoleHistory } from "../services/handover";
import { projectCap, projectRemaining, taskBudget } from "../services/time";
import { PROJECT_RATES_SQL } from "../services/rates";
import { recordPayment, runProjectBilling } from "../services/invoices";
import { formatMinutes, FREQUENCY_LABEL, INVOICE_FREQUENCIES, capPeriodsPerInvoice, isWeekly, upcomingRuns } from "@eszy/shared";

export const projectsRouter = Router();
const billingFeature = requireFeature("projects_billing");
const uuid = z.string().uuid();

const MONEY_FIELDS = ["price_minor", "hourly_rate_minor", "avg_rate_minor", "revenue_minor"];
const strip = (req: any, row: any) => {
  if (!can(req, "money.view")) for (const f of MONEY_FIELDS) delete row[f];
  return row;
};

/** Projects someone can see: all with projects.view_all, else ones they're a member, PM or salesperson of. */
const scopeSql = (req: any) =>
  can(req, "projects.view_all") ? "($1::uuid IS NOT NULL)" : "(p.pm_user_id = $1 OR p.sales_user_id = $1 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1))";

projectsRouter.get("/projects", h(async (req, db) => {
  const q = z.object({ status: z.string().optional(), clientId: uuid.optional(), mine: z.string().optional() }).parse(req.query);
  const rows = (await db.query(
    `SELECT p.*, c.name AS client_name, c.company AS client_company, pm.name AS pm_name, src.name AS source_name, acc.name AS account_name,
       coalesce((SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name) FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = p.id AND m.role = 'tl'), '[]') AS tls,
       coalesce((SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.id = p.pm_user_id DESC, u.name) FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = p.id AND m.role = 'pm'), '[]') AS pms,
       coalesce((SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name) FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = p.id AND m.role = 'member'), '[]') AS member_list,
       (SELECT count(*)::int FROM project_members m WHERE m.project_id = p.id AND m.role = 'member' AND m.user_id IS DISTINCT FROM p.pm_user_id) AS member_count,
       st.name AS stage_name, (SELECT count(*)::int FROM tasks tk WHERE tk.project_id = p.id AND tk.status <> 'done') AS open_tasks,
       rt.rate_minor AS avg_rate_minor, rt.revenue_minor AS revenue_minor,
       (SELECT coalesce(sum(e.minutes),0)::int FROM time_entries e WHERE e.project_id = p.id AND e.date >= current_date - 6) AS week_minutes,
       (SELECT max(e.date) FROM time_entries e WHERE e.project_id = p.id) AS last_work_on,
       (SELECT coalesce(sum(minutes),0)::int FROM billing_lines bl WHERE bl.project_id = p.id) AS cap_minutes,
       (SELECT count(*)::int FROM billing_lines bl WHERE bl.project_id = p.id) AS line_count,
       (SELECT coalesce(sum(minutes),0)::int FROM time_entries e WHERE e.project_id = p.id) AS logged_minutes,
       (SELECT coalesce(sum(e.minutes),0)::int FROM time_entries e JOIN sheets s ON s.id = e.sheet_id AND s.status='approved' WHERE e.project_id = p.id) AS approved_minutes,
       EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1) AS is_member
     FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN users pm ON pm.id = p.pm_user_id
       LEFT JOIN project_sources src ON src.id = p.source_id LEFT JOIN project_accounts acc ON acc.id = p.account_id
       LEFT JOIN project_stages st ON st.id = p.stage_id LEFT JOIN (${PROJECT_RATES_SQL}) rt ON rt.project_id = p.id
     WHERE ${scopeSql(req)} AND ($2::text IS NULL OR p.status = $2) AND ($3::uuid IS NULL OR p.client_id = $3)
       AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1))
     ORDER BY p.status, p.stage_position, p.created_at DESC`,
    [userId(req), q.status ?? null, q.clientId ?? null, q.mine ?? null],
  )).rows;
  return rows.map((r) => strip(req, r));
}));

/** Admins with projects.manage, the main PM, and anyone added to the project as a PM. */
async function isPmOf(req: any, db: any, p: any) {
  if (can(req, "projects.manage") || p.pm_user_id === userId(req)) return true;
  return !!(await db.query("SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = 'pm'", [p.id, userId(req)])).rowCount;
}

async function loadProject(req: any, db: any, id: string) {
  const p = (await db.query(`SELECT p.*, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = $2 AND ${scopeSql(req)}`, [userId(req), id])).rows[0];
  if (!p) throw notFound("Project not found");
  return p;
}

projectsRouter.get("/projects/:id", h(async (req, db) => {
  const p = await loadProject(req, db, uuid.parse(req.params.id));
  const s = await getSettings(db);
  const money = can(req, "money.view");
  const lines = (await db.query(
    `SELECT bl.*, i.number AS invoice_number, i.status AS invoice_status,
       coalesce((SELECT sum(a.minutes) FROM time_allocations a WHERE a.billing_line_id = bl.id),0)::int AS used_minutes
     FROM billing_lines bl LEFT JOIN invoices i ON i.id = bl.invoice_id WHERE bl.project_id = $1 ORDER BY bl.position, bl.created_at`,
    [p.id],
  )).rows.map((l) => (money ? l : { id: l.id, label: l.label, minutes: l.minutes, kind: l.kind, due_date: l.due_date, used_minutes: l.used_minutes, billable: l.billable }));
  const members = (await db.query(
    `SELECT u.id, u.name, u.email, u.has_photo, u.employee_code, u.designation, m.role, m.assigned_at, ab.name AS assigned_by_name, t.name AS team_name,
       coalesce((SELECT sum(e.minutes) FROM time_entries e WHERE e.project_id = $1 AND e.user_id = u.id),0)::int AS logged_minutes,
       (SELECT max(e.date) FROM time_entries e WHERE e.project_id = $1 AND e.user_id = u.id) AS last_on
     FROM project_members m JOIN users u ON u.id = m.user_id LEFT JOIN users ab ON ab.id = m.assigned_by LEFT JOIN teams t ON t.id = u.team_id
     WHERE m.project_id = $1 ORDER BY CASE m.role WHEN 'pm' THEN 0 WHEN 'tl' THEN 1 ELSE 2 END, u.name`, [p.id])).rows;
  const people = (await db.query(
    `SELECT (SELECT name FROM users WHERE id = $1::uuid) AS pm_name, (SELECT name FROM users WHERE id = $2::uuid) AS sales_name,
       (SELECT name FROM users WHERE id = $3::uuid) AS estimator_name, (SELECT name FROM users WHERE id = $4::uuid) AS caller_name, (SELECT name FROM users WHERE id = $5::uuid) AS created_by_name`,
    [p.pm_user_id, p.sales_user_id, p.estimator_user_id, p.caller_user_id, p.created_by])).rows[0];
  const byActivity = (await db.query(
    `SELECT coalesce(a.name, CASE e.category WHEN 'billable' THEN 'Billable work' WHEN 'inhouse' THEN 'In-house work' WHEN 'no_work' THEN 'No work' END, 'No work type') AS name, coalesce(e.category, a.category, CASE WHEN $2 THEN 'inhouse' ELSE 'billable' END) AS category, sum(e.minutes)::int AS minutes
     FROM time_entries e LEFT JOIN activity_types a ON a.id = e.activity_type_id WHERE e.project_id = $1 GROUP BY 1, 2 ORDER BY 3 DESC`, [p.id, p.is_internal])).rows;
  const byWeek = (await db.query(
    `SELECT to_char(date_trunc('week', e.date), 'YYYY-MM-DD') AS week, sum(e.minutes)::int AS minutes FROM time_entries e
     WHERE e.project_id = $1 AND e.date >= current_date - 7 * 12 GROUP BY 1 ORDER BY 1`, [p.id])).rows;
  const byPerson = (await db.query(
    `SELECT u.name, sum(e.minutes)::int AS minutes, sum(e.minutes) FILTER (WHERE s.status = 'approved')::int AS approved_minutes
     FROM time_entries e JOIN users u ON u.id = e.user_id JOIN sheets s ON s.id = e.sheet_id WHERE e.project_id = $1 GROUP BY u.name ORDER BY 2 DESC`, [p.id])).rows;
  const tasks = (await db.query(
    `SELECT t.*, u.name AS assignee_name, cb.name AS created_by_name,
       coalesce((SELECT sum(e.minutes) FROM time_entries e WHERE e.task_id = t.id),0)::int AS logged_minutes,
       (SELECT count(*)::int FROM comments c WHERE c.task_id = t.id) AS comment_count,
       (SELECT count(*)::int FROM time_entries e WHERE e.task_id = t.id AND e.description <> '') AS log_count
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users cb ON cb.id = t.created_by WHERE t.project_id = $1 ORDER BY t.status, t.created_at DESC`, [p.id])).rows;
  const remaining = await projectRemaining(db, p, todayIn(s.locale.timezone), s.locale.weekStartsOn);
  const invoices = can(req, "invoices.view")
    ? (await db.query("SELECT id, number, kind, issue_date, due_date, total_minor, paid_minor, status FROM invoices WHERE project_id = $1 ORDER BY issue_date DESC, number DESC", [p.id])).rows
    : [];
  const expenses = money ? (await db.query("SELECT * FROM expenses WHERE project_id = $1 ORDER BY date DESC", [p.id])).rows : [];
  const trackers = (await db.query("SELECT t.*, a.name AS account_name FROM project_trackers t LEFT JOIN project_accounts a ON a.id = t.account_id WHERE t.project_id = $1 ORDER BY t.label", [p.id])).rows;
  const meta = (await db.query(
    `SELECT s.name AS source_name, a.name AS account_name, coalesce((SELECT array_agg(c.name ORDER BY c.name) FROM communication_types c WHERE c.id = ANY($1::uuid[])), '{}') AS communication_types
     FROM (SELECT 1) x LEFT JOIN project_sources s ON s.id = $2::uuid LEFT JOIN project_accounts a ON a.id = $3::uuid`, [p.communication_type_ids, p.source_id, p.account_id],
  )).rows[0];
  const rate = (await db.query(`SELECT revenue_minor, minutes, rate_minor FROM (${PROJECT_RATES_SQL}) r WHERE r.project_id = $1`, [p.id])).rows[0] ?? null;
  const stage = p.stage_id ? (await db.query("SELECT id, name, is_done FROM project_stages WHERE id = $1", [p.stage_id])).rows[0] ?? null : null;
  const fileCount = (await db.query("SELECT count(*)::int AS n FROM project_files WHERE project_id = $1", [p.id])).rows[0].n;
  const offline = (await db.query("SELECT coalesce(sum(minutes) FILTER (WHERE offline),0)::int AS offline, coalesce(sum(minutes) FILTER (WHERE NOT offline AND source <> 'eszy'),0)::int AS tracked FROM time_entries WHERE project_id = $1", [p.id])).rows[0];
  return { ...strip(req, p), ...meta, billingLines: lines, members, tasks, remaining, invoices: money ? invoices : invoices.map(({ total_minor, paid_minor, ...r }: any) => r), expenses, trackers, hoursSplit: offline, people, byActivity, byWeek, byPerson,
    stage, fileCount, rate: money ? rate : null, amPm: await isPmOf(req, db, p) };
}));

projectsRouter.get("/projects/:id/remaining", h(async (req, db) => {
  const p = await loadProject(req, db, uuid.parse(req.params.id));
  const s = await getSettings(db);
  const date = z.string().optional().parse(req.query.date) ?? todayIn(s.locale.timezone);
  return projectRemaining(db, p, date, s.locale.weekStartsOn);
}));

projectsRouter.post("/projects", requirePerm("projects.manage", "projects.billing"), h(async (req, db) => {
  // People who set up billing get the full checks (price, rate, milestones adding up…); others only the basics.
  const billingChecks = req.tenant!.features.has("projects_billing") && can(req, "projects.billing");
  let input = (billingChecks ? projectCreateSchema : projectInputSchema).parse(req.body);
  // Without the Projects and Billing feature, projects are only for logging time: no rates, lines or invoices.
  if (!req.tenant!.features.has("projects_billing")) {
    input = { ...input, type: "hourly", billingType: "postpaid", invoicing: "one_time", hourlyRateMinor: 0, billingLines: [], billingCapMinutes: null, initialPaymentMinor: 0 };
  } else if (!can(req, "projects.billing") && !can(req, "projects.manage")) throw forbidden();
  if (!can(req, "projects.assign") && (input.pmUserId || input.pmIds?.length || input.tlIds?.length)) {
    throw forbidden("Only Admin, Billing Manager or Sales can assign Project Managers and Team Leads. Create the project without them and ask them to assign.");
  }
  const s = await getSettings(db);
  const out = await createProject(db, req.tenant!.id, s, input, userId(req), todayIn(s.locale.timezone), req.tenant!.maxProjects);
  await audit(db, req, "project.create", "project", out.project.id, { name: input.name, type: input.type });
  await notify(db, input.memberIds.filter((m) => m !== userId(req)), { kind: "project.member", title: `You were added to ${input.name}`, link: `/projects/${out.project.id}` });
  return { project: strip(req, out.project), invoices: can(req, "invoices.view") ? out.invoices : [] };
}));

const generalSchema = z.object({
  name: z.string().min(1).optional(), code: z.string().optional(), pmUserId: uuid.nullable().optional(),
  startDate: z.string().nullable().optional(), deliveryDate: z.string().nullable().optional(),
  sourceId: uuid.nullable().optional(), accountId: uuid.nullable().optional(), communicationTypeIds: z.array(uuid).optional(),
  allowOfflineHours: z.boolean().optional(), description: z.string().optional(),
  isInternal: z.boolean().optional(), estimatorUserId: uuid.nullable().optional(), callerUserId: uuid.nullable().optional(), salesUserId: uuid.nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});
const billingSchema = z.object({
  hourlyRateMinor: z.number().int().min(0).optional(), billingCapMinutes: z.number().int().min(0).nullable().optional(),
  billingPeriod: z.enum(["week", "month"]).nullable().optional(), billingDate: z.string().nullable().optional(),
  dueDays: z.number().int().min(0).nullable().optional(), dueSoonDays: z.number().int().min(0).max(60).nullable().optional(),
  dueSoonClientEmail: z.boolean().nullable().optional(), invoicing: z.enum(["one_time", "recurring"]).optional(),
  nextBillingDate: z.string().nullable().optional(),
  invoiceFrequency: z.enum(INVOICE_FREQUENCIES).nullable().optional(), invoiceWeekday: z.number().int().min(0).max(6).nullable().optional(),
  invoiceMonthDay: z.number().int().min(0).max(28).nullable().optional(), invoiceStartsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

projectsRouter.put("/projects/:id", h(async (req, db) => {
  const p = await loadProject(req, db, uuid.parse(req.params.id));
  const g = generalSchema.parse(req.body);
  const b = billingSchema.parse(req.body);
  const touchesBilling = Object.keys(b).length > 0;
  const onlyDescription = Object.keys(g).every((k) => k === "description");
  if (Object.keys(g).length && !can(req, "projects.manage") && !(onlyDescription && await isPmOf(req, db, p))) throw forbidden();
  if (touchesBilling && !can(req, "projects.billing")) throw forbidden("Only the Billing Manager can change billing set-up");
  if (g.pmUserId !== undefined && g.pmUserId !== p.pm_user_id && !can(req, "projects.assign")) throw forbidden("Only Admin, Billing Manager or Sales can change the Project Manager");
  const sets: string[] = [], vals: unknown[] = [p.id];
  const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (g.name !== undefined) put("name", g.name);
  if (g.code !== undefined) put("code", g.code);
  if (g.pmUserId !== undefined) put("pm_user_id", g.pmUserId);
  if (g.startDate !== undefined) put("start_date", g.startDate);
  if (g.deliveryDate !== undefined) put("delivery_date", g.deliveryDate);
  if (g.sourceId !== undefined) put("source_id", g.sourceId);
  if (g.accountId !== undefined) put("account_id", g.accountId);
  if (g.communicationTypeIds !== undefined) put("communication_type_ids", g.communicationTypeIds);
  if (g.allowOfflineHours !== undefined) put("allow_offline_hours", g.allowOfflineHours);
  if (g.description !== undefined) put("description", g.description);
  if (g.isInternal !== undefined) put("is_internal", g.isInternal);
  if (g.estimatorUserId !== undefined) put("estimator_user_id", g.estimatorUserId);
  if (g.callerUserId !== undefined) put("caller_user_id", g.callerUserId);
  if (g.salesUserId !== undefined) put("sales_user_id", g.salesUserId);
  if (g.tags !== undefined) put("tags", g.tags);
  if (b.hourlyRateMinor !== undefined) put("hourly_rate_minor", b.hourlyRateMinor);
  if (b.billingCapMinutes !== undefined) put("billing_cap_minutes", b.billingCapMinutes);
  if (b.billingPeriod !== undefined) put("billing_period", b.billingPeriod);
  if (b.billingDate !== undefined) put("billing_date", b.billingDate);
  if (b.dueDays !== undefined) put("due_days", b.dueDays);
  if (b.dueSoonDays !== undefined) put("due_soon_days", b.dueSoonDays);
  if (b.dueSoonClientEmail !== undefined) put("due_soon_client_email", b.dueSoonClientEmail);
  if (b.invoicing !== undefined) put("invoicing", b.invoicing);
  if (b.nextBillingDate !== undefined) put("next_billing_date", b.nextBillingDate);
  // A recurring invoice schedule: how often and on which day. The next invoice is the first scheduled day from today on.
  if (b.invoiceFrequency !== undefined) {
    if (b.invoiceFrequency) {
      const billingType = p.billing_type, capPeriod = b.billingPeriod !== undefined ? b.billingPeriod : p.billing_period;
      const sched = { frequency: b.invoiceFrequency, weekday: b.invoiceWeekday ?? null, monthDay: b.invoiceMonthDay ?? null, startsOn: b.invoiceStartsOn ?? p.start_date ?? todayIn((await getSettings(db)).locale.timezone) };
      if (isWeekly(sched.frequency) && sched.weekday == null) throw badRequest("Pick the day of the week invoices are created");
      if (!isWeekly(sched.frequency) && sched.monthDay == null) throw badRequest("Pick the day of the month invoices are created");
      if (p.type === "hourly" && billingType === "prepaid" && capPeriodsPerInvoice(capPeriod, sched.frequency) == null)
        throw badRequest(`A ${capPeriod}ly billing cap can't be invoiced ${FREQUENCY_LABEL[sched.frequency].toLowerCase()}. Pick a schedule that fits whole ${capPeriod}s.`);
      const today = todayIn((await getSettings(db)).locale.timezone);
      put("invoice_frequency", sched.frequency); put("invoice_weekday", isWeekly(sched.frequency) ? sched.weekday : null);
      put("invoice_month_day", isWeekly(sched.frequency) ? null : sched.monthDay); put("invoice_starts_on", sched.startsOn);
      if (b.invoicing === undefined) put("invoicing", "recurring");
      if (b.nextBillingDate === undefined) put("next_billing_date", upcomingRuns(sched, 1, sched.startsOn > today ? sched.startsOn : today)[0]);
    } else {
      put("invoice_frequency", null); put("invoice_weekday", null); put("invoice_month_day", null); put("invoice_starts_on", null);
    }
  }
  const before = await snapshot(db, "projects", p.id);
  if (sets.length) await db.query(`UPDATE projects SET ${sets.join(", ")} WHERE id = $1`, vals);
  if (g.pmUserId) await db.query("INSERT INTO project_members (tenant_id, project_id, user_id, role, assigned_by) VALUES ($1,$2,$3,'pm',$4) ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'pm'", [req.tenant!.id, p.id, g.pmUserId, userId(req)]);
  await auditChange(db, req, "project.update", "projects", p.id, before);
  return { ok: true };
}));

projectsRouter.post("/projects/:id/status", requirePerm("projects.manage"), h(async (req, db) => {
  const p = await loadProject(req, db, uuid.parse(req.params.id));
  const { status } = z.object({ status: z.enum(["active", "paused", "ended"]) }).parse(req.body);
  const before = await snapshot(db, "projects", p.id);
  await db.query("UPDATE projects SET status = $2 WHERE id = $1", [p.id, status]);
  if (status === "ended" && p.billing_type === "postpaid") {
    const s = await getSettings(db);
    await runProjectBilling(db, s, p.id, todayIn(s.locale.timezone), userId(req));
  }
  await auditChange(db, req, "project.status", "projects", p.id, before);
  return { ok: true };
}));

/**
 * The project's team: PM -> TLs -> members. The Admin/PM can set everything; a TL on the project can set its members.
 * Sending only memberIds keeps the TLs as they are.
 */
projectsRouter.put("/projects/:id/members", h(async (req, db) => {
  const p = await loadProject(req, db, uuid.parse(req.params.id));
  const b = z.object({ memberIds: z.array(uuid), tlIds: z.array(uuid).optional(), pmUserId: uuid.nullable().optional(), pmIds: z.array(uuid).optional() }).parse(req.body);
  // Admin, Billing Manager and the sales team (projects.assign) set the PMs and Team Leads.
  // The project's PMs and TLs add and remove employees; a Team Lead only from their own team.
  const assigner = can(req, "projects.assign");
  const isTl = (await db.query("SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = 'tl'", [p.id, userId(req)])).rowCount;
  const isPm = p.pm_user_id === userId(req) || !!(await db.query("SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = 'pm'", [p.id, userId(req)])).rowCount;
  if (!assigner && !isPm && !isTl && !can(req, "projects.manage")) throw forbidden("Only Admin, Billing, Sales or the project's PMs and Team Leads can change its team");
  if (!assigner && (b.tlIds || b.pmUserId !== undefined || b.pmIds)) {
    const cur = (await db.query("SELECT user_id, role FROM project_members WHERE project_id = $1", [p.id])).rows;
    const same = (role: string, ids?: string[]) => !ids || [...ids].sort().join() === cur.filter((r) => r.role === role).map((r) => r.user_id).sort().join();
    if (!same("tl", b.tlIds) || !same("pm", b.pmIds) || (b.pmUserId !== undefined && b.pmUserId !== p.pm_user_id)) throw forbidden("Only Admin, Billing Manager or Sales can assign Project Managers and Team Leads");
  }
  const current = (await db.query("SELECT user_id, role FROM project_members WHERE project_id = $1", [p.id])).rows;
  let pmIds: string[] = b.pmIds ?? (b.pmUserId !== undefined ? (b.pmUserId ? [b.pmUserId] : []) : current.filter((r) => r.role === "pm").map((r) => r.user_id));
  if (!b.pmIds && b.pmUserId === undefined && p.pm_user_id && !pmIds.includes(p.pm_user_id)) pmIds = [p.pm_user_id, ...pmIds];
  pmIds = [...new Set(pmIds)];
  const mainPm = pmIds.includes(p.pm_user_id) ? p.pm_user_id : pmIds[0] ?? null;
  if (mainPm !== p.pm_user_id) await db.query("UPDATE projects SET pm_user_id = $2 WHERE id = $1", [p.id, mainPm]);
  const tlIds = (b.tlIds ?? current.filter((r) => r.role === "tl").map((r) => r.user_id)).filter((x) => !pmIds.includes(x));
  const memberIds = [...new Set([...b.memberIds, ...tlIds, ...pmIds])];
  const before = current.map((r) => r.user_id);
  if (!assigner && !isPm && !can(req, "projects.manage")) {
    // A Team Lead can only add or remove people from their own team (people in teams they lead or who report to them).
    const touched = [...memberIds.filter((m) => !before.includes(m)), ...before.filter((m) => !memberIds.includes(m))];
    if (touched.length) {
      const mine = (await db.query(
        `SELECT u.id FROM users u LEFT JOIN teams t ON t.id = u.team_id
         WHERE u.id = ANY($1) AND (t.lead_user_id = $2 OR t.manager_user_id = $2 OR u.reporting_manager_id = $2)`, [touched, userId(req)])).rows.map((r) => r.id);
      const other = touched.filter((t) => !mine.includes(t) && t !== userId(req));
      if (other.length) {
        const names = (await db.query("SELECT name FROM users WHERE id = ANY($1)", [other])).rows.map((r) => r.name);
        throw forbidden(`${names.join(", ")} ${names.length === 1 ? "isn't" : "aren't"} in your team. Ask their Team Lead or the PM.`);
      }
    }
  }
  await db.query("DELETE FROM project_members WHERE project_id = $1 AND NOT (user_id = ANY($2))", [p.id, memberIds]);
  for (const m of memberIds) {
    const role = pmIds.includes(m) ? "pm" : tlIds.includes(m) ? "tl" : "member";
    await db.query(
      `INSERT INTO project_members (tenant_id, project_id, user_id, role, assigned_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [req.tenant!.id, p.id, m, role, userId(req)]);
  }
  await syncRoleHistory(db, req.tenant!.id, p.id, current, new Map(memberIds.map((m) => [m, pmIds.includes(m) ? "pm" : tlIds.includes(m) ? "tl" : "member"] as [string, string])));
  const added = memberIds.filter((m) => !before.includes(m));
  const removed = before.filter((m) => !memberIds.includes(m));
  const names = async (ids: string[]) => ids.length ? (await db.query("SELECT id, name FROM users WHERE id = ANY($1)", [ids])).rows : [];
  const roleOf = (id: string) => (pmIds.includes(id) ? "Project Manager" : tlIds.includes(id) ? "Team Lead" : "Member");
  const changedRole = current.filter((r) => memberIds.includes(r.user_id) && r.role !== (pmIds.includes(r.user_id) ? "pm" : tlIds.includes(r.user_id) ? "tl" : "member")).map((r) => r.user_id);
  if (added.length || removed.length || changedRole.length) {
    await audit(db, req, "project.team", "project", p.id, {
      added: (await names(added)).map((u: any) => ({ name: u.name, role: roleOf(u.id) })),
      removed: (await names(removed)).map((u: any) => u.name),
      changed: (await names(changedRole)).map((u: any) => ({ name: u.name, role: roleOf(u.id) })),
    });
  }
  await notify(db, added.filter((m) => m !== userId(req)), { kind: "project.member", title: `You were added to ${p.name}`, link: `/projects/${p.id}` });
  return { ok: true };
}));

/** Moves a project to a stage on the project board (and a position within it). */
projectsRouter.put("/projects/:id/stage", h(async (req, db) => {
  const p = await loadProject(req, db, uuid.parse(req.params.id));
  if (!(await isPmOf(req, db, p))) throw forbidden("Only a PM or an Admin can move a project");
  const b = z.object({ stageId: uuid, position: z.number().int().min(0).optional() }).parse(req.body);
  const st = (await db.query("SELECT id, name FROM project_stages WHERE id = $1", [b.stageId])).rows[0];
  if (!st) throw notFound("Stage not found");
  const from = p.stage_id ? (await db.query("SELECT name FROM project_stages WHERE id = $1", [p.stage_id])).rows[0]?.name ?? null : null;
  // Renumber the target column so the moved project lands where it was dropped.
  const ids = (await db.query("SELECT id FROM projects WHERE stage_id = $1 AND id <> $2 ORDER BY stage_position, created_at DESC", [st.id, p.id])).rows.map((r) => r.id);
  ids.splice(Math.min(b.position ?? ids.length, ids.length), 0, p.id);
  for (const [i, id] of ids.entries()) await db.query("UPDATE projects SET stage_id = $2, stage_position = $3 WHERE id = $1", [id, st.id, i]);
  if (from !== st.name) await audit(db, req, "project.stage", "project", p.id, { changes: { stage: [from, st.name] } });
  return { ok: true };
}));

// ---------- billing lines and extra hours (Billing Manager) ----------
projectsRouter.post("/projects/:id/billing-lines", billingFeature, requirePerm("projects.billing"), h(async (req, db) => {
  const p = await loadProject(req, db, uuid.parse(req.params.id));
  const b = billingLineInputSchema.parse(req.body);
  const pos = (await db.query("SELECT coalesce(max(position),0)+1 AS n FROM billing_lines WHERE project_id = $1", [p.id])).rows[0].n;
  const l = (await db.query(
    "INSERT INTO billing_lines (tenant_id, project_id, position, label, minutes, amount_minor, due_date, kind, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'plan',$8) RETURNING *",
    [req.tenant!.id, p.id, pos, b.label, b.minutes, b.amountMinor, b.dueDate ?? null, userId(req)],
  )).rows[0];
  const s = await getSettings(db);
  const invoices = await runProjectBilling(db, s, p.id, todayIn(s.locale.timezone), userId(req));
  await audit(db, req, "billing_line.create", "project", p.id, b);
  return { line: l, invoices };
}));

/**
 * Extra hours: added by the Billing Manager when more time is needed.
 * $0 makes them non-billable (e.g. fixing our own work). An amount makes them billable and creates an invoice now.
 */
projectsRouter.post("/projects/:id/extra-hours", billingFeature, requirePerm("projects.billing"), h(async (req, db) => {
  const p = await loadProject(req, db, uuid.parse(req.params.id));
  const b = extraHoursSchema.parse(req.body);
  const pos = (await db.query("SELECT coalesce(max(position),0)+1 AS n FROM billing_lines WHERE project_id = $1", [p.id])).rows[0].n;
  const l = (await db.query(
    "INSERT INTO billing_lines (tenant_id, project_id, position, label, minutes, amount_minor, due_date, kind, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'extra',$8) RETURNING *",
    [req.tenant!.id, p.id, pos, b.label, b.minutes, b.amountMinor, b.dueDate ?? null, userId(req)],
  )).rows[0];
  const s = await getSettings(db);
  const today = todayIn(s.locale.timezone);
  const invoices = b.amountMinor > 0 ? await runProjectBilling(db, s, p.id, today, userId(req)) : [];
  const inv = invoices.find((i: any) => i.kind === "extra");
  if (inv && b.paidNowMinor > 0) await recordPayment(db, inv.id, { amountMinor: Math.min(b.paidNowMinor, inv.total_minor), receivedOn: today, method: "received_before_invoice", reference: "" }, userId(req), false);
  const members = (await db.query("SELECT user_id FROM project_members WHERE project_id = $1", [p.id])).rows.map((r) => r.user_id);
  await notify(db, members, { kind: "project.hours", title: `More hours on ${p.name}`, body: `${Math.round(b.minutes / 6) / 10} h were added.`, link: `/projects/${p.id}` });
  await audit(db, req, "extra_hours.add", "project", p.id, b);
  return { line: l, invoices };
}));

projectsRouter.put("/billing-lines/:id", billingFeature, requirePerm("projects.billing"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const l = (await db.query("SELECT * FROM billing_lines WHERE id = $1", [id])).rows[0];
  if (!l) throw notFound();
  const b = billingLineInputSchema.partial().parse(req.body);
  if (l.invoice_id && (b.amountMinor !== undefined || b.minutes !== undefined)) throw conflict("This line is on an invoice. Cancel the invoice first to change its hours or amount.");
  const used = (await db.query("SELECT coalesce(sum(minutes),0)::int AS m FROM time_allocations WHERE billing_line_id = $1", [id])).rows[0].m;
  if (b.minutes !== undefined && b.minutes < used) throw badRequest(`${Math.round(used / 6) / 10} h are already used on this line`);
  const before = await snapshot(db, "billing_lines", id);
  await db.query("UPDATE billing_lines SET label = coalesce($2,label), minutes = coalesce($3,minutes), amount_minor = coalesce($4,amount_minor), due_date = CASE WHEN $5 THEN $6::date ELSE due_date END WHERE id = $1", [
    id, b.label ?? null, b.minutes ?? null, b.amountMinor ?? null, b.dueDate !== undefined, b.dueDate ?? null,
  ]);
  const after = await snapshot(db, "billing_lines", id);
  await audit(db, req, "billing_line.update", "project", l.project_id, { line: l.label, changes: Object.fromEntries(Object.keys(after ?? {}).filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])).map((k) => [k, [before?.[k], after?.[k]]])) });
  return { ok: true };
}));

projectsRouter.delete("/billing-lines/:id", billingFeature, requirePerm("projects.billing"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const l = (await db.query("SELECT * FROM billing_lines WHERE id = $1", [id])).rows[0];
  if (!l) throw notFound();
  if (l.invoice_id) throw conflict("This line is on an invoice. Cancel the invoice first.");
  if ((await db.query("SELECT 1 FROM time_allocations WHERE billing_line_id = $1 LIMIT 1", [id])).rowCount) throw conflict("Approved hours already use this line");
  await db.query("DELETE FROM billing_lines WHERE id = $1", [id]);
  await audit(db, req, "billing_line.delete", "project", l.project_id, { label: l.label });
  return { ok: true };
}));

projectsRouter.post("/projects/:id/run-billing", billingFeature, requirePerm("invoices.manage"), h(async (req, db) => {
  const p = await loadProject(req, db, uuid.parse(req.params.id));
  const s = await getSettings(db);
  return { invoices: await runProjectBilling(db, s, p.id, todayIn(s.locale.timezone), userId(req)) };
}));

// ---------- tasks ----------
const taskSchema = z.object({
  title: z.string().min(1), assigneeId: uuid.nullable().optional(), status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
  description: z.string().max(20000).optional(), priority: z.enum(["low", "medium", "high"]).optional(), dueDate: z.string().nullable().optional(),
  estimatedMinutes: z.number().int().min(0).nullable().optional(), links: z.array(z.string().url()).max(20).optional(),
});
/** Everyone who has been PM or Team Lead of the project, with when they started and stopped. */
projectsRouter.get("/projects/:id/role-history", h(async (req, db) => {
  const p = await loadProject(req, db, uuid.parse(req.params.id));
  return (await db.query(
    `SELECT r.*, u.name AS user_name, t.name AS handed_to_name,
       (SELECT max(s.decided_at) FROM sheets s JOIN time_entries e ON e.sheet_id = s.id WHERE e.project_id = r.project_id AND s.decided_by = r.user_id) AS last_approval,
       (SELECT count(DISTINCT s.id)::int FROM sheets s JOIN time_entries e ON e.sheet_id = s.id WHERE e.project_id = r.project_id AND s.decided_by = r.user_id
          AND (s.decided_at >= r.started_at OR NOT EXISTS (SELECT 1 FROM project_role_history o WHERE o.project_id = r.project_id AND o.role = r.role AND o.started_at < r.started_at))
          AND (r.ended_at IS NULL OR s.decided_at <= r.ended_at)) AS approvals
     FROM project_role_history r JOIN users u ON u.id = r.user_id LEFT JOIN users t ON t.id = r.handed_to
     WHERE r.project_id = $1 ORDER BY r.ended_at IS NULL DESC, r.started_at DESC`, [p.id])).rows;
}));
/** Hours for tasks on a project without a billing cap: set by the PM, raised with "Add hours". */
projectsRouter.put("/projects/:id/task-budget", h(async (req, db) => {
  const p = await loadProject(req, db, uuid.parse(req.params.id));
  if (!(can(req, "tasks.manage") || can(req, "projects.manage") || (await isPmOf(req, db, p)))) throw forbidden("Only the project's PM can set its task hours");
  const b = z.object({ minutes: z.number().int().min(0).optional(), addMinutes: z.number().int().positive().optional(), reason: z.string().max(500).default("") }).parse(req.body);
  const cap = await projectCap(db, p.id);
  if (cap !== null) throw conflict("This project's hours come from its billing. Add extra hours to it instead.");
  const before = p.task_budget_minutes ?? 0;
  const next = b.addMinutes != null ? before + b.addMinutes : b.minutes ?? before;
  const allocated = (await taskBudget(db, p.id)).allocated;
  if (next < allocated) throw badRequest(`Tasks already have ${formatMinutes(allocated)}, so the project can't have less than that`);
  await db.query("UPDATE projects SET task_budget_minutes = $2 WHERE id = $1", [p.id, next]);
  await audit(db, req, "project.task_budget", "project", p.id, { from: before, to: next, reason: b.reason });
  return { ok: true, minutes: next };
}));
/** Hours on the project and how much of them is given to tasks. */
projectsRouter.get("/projects/:id/task-budget", h(async (req, db) => {
  const p = await loadProject(req, db, uuid.parse(req.params.id));
  const b = await taskBudget(db, p.id, typeof req.query.exclude === "string" ? uuid.parse(req.query.exclude) : undefined);
  const logged = Number((await db.query("SELECT coalesce(sum(minutes),0) AS m FROM time_entries WHERE project_id = $1", [p.id])).rows[0].m);
  const billingCap = (await projectCap(db, p.id)) !== null;
  return { ...b, logged, source: billingCap ? "billing" : "budget",
    canAddHours: billingCap ? can(req, "projects.billing") && req.tenant!.features.has("projects_billing") : can(req, "tasks.manage") || can(req, "projects.manage") || (await isPmOf(req, db, p)) };
}));
/** Refuses a task size that doesn't fit what's left on the project. */
async function checkTaskHours(db: any, projectId: string, minutes: number | null | undefined, excludeTaskId?: string) {
  const b = await taskBudget(db, projectId, excludeTaskId);
  if (!minutes) throw badRequest("Set the task's hours: every task gets its share of the project's hours", { fields: { estimatedMinutes: ["Hours are required"] }, ...b });
  if (b.cap === null) throw conflict("This project has no hours to share out yet. Set its task hours first (Tasks tab), then add the task.", { ...b, needed: minutes });
  if (minutes > (b.available ?? 0)) throw conflict(
    b.available ? `Only ${formatMinutes(b.available)} of the project's ${formatMinutes(b.cap)} is left to give to tasks. Add extra hours to the project, or make the task smaller.`
      : `All ${formatMinutes(b.cap)} of the project is already given to tasks. Add extra hours to the project first.`,
    { ...b, needed: minutes - (b.available ?? 0) });
}
projectsRouter.get("/projects/:id/tasks", h(async (req, db) => {
  const p = await loadProject(req, db, uuid.parse(req.params.id));
  return (await db.query(
    `SELECT t.*, u.name AS assignee_name, cb.name AS created_by_name,
       coalesce((SELECT sum(e.minutes) FROM time_entries e WHERE e.task_id = t.id),0)::int AS logged_minutes,
       (SELECT count(*)::int FROM comments c WHERE c.task_id = t.id) AS comment_count
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users cb ON cb.id = t.created_by WHERE t.project_id = $1 ORDER BY t.created_at DESC`, [p.id])).rows;
}));
projectsRouter.post("/projects/:id/tasks", h(async (req, db) => {
  const p = await loadProject(req, db, uuid.parse(req.params.id));
  const isTl = (await db.query("SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = 'tl'", [p.id, userId(req)])).rowCount;
  if (!can(req, "tasks.manage") && !isTl && !(await isPmOf(req, db, p))) throw forbidden();
  const b = taskSchema.parse(req.body);
  await checkTaskHours(db, p.id, b.estimatedMinutes);
  const t = (await db.query(
    "INSERT INTO tasks (tenant_id, project_id, title, assignee_id, status, description, priority, due_date, estimated_minutes, links, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
    [req.tenant!.id, p.id, b.title, b.assigneeId ?? null, b.status ?? "todo", b.description ?? "", b.priority ?? "medium", b.dueDate ?? null, b.estimatedMinutes ?? null, b.links ?? [], userId(req)],
  )).rows[0];
  if (b.assigneeId && b.assigneeId !== userId(req)) await notify(db, [b.assigneeId], { kind: "task.assigned", title: `New task on ${p.name}: ${b.title}`, link: `/projects/${p.id}?tab=tasks` });
  await audit(db, req, "task.create", "project", p.id, { taskId: t.id, title: t.title });
  return t;
}));
projectsRouter.put("/tasks/:id", h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const t = (await db.query("SELECT t.*, p.pm_user_id, (SELECT m.role FROM project_members m WHERE m.project_id = t.project_id AND m.user_id = $2) AS my_role FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = $1", [id, userId(req)])).rows[0];
  if (!t) throw notFound();
  const b = taskSchema.partial().parse(req.body);
  const canEdit = can(req, "tasks.manage") || can(req, "projects.manage") || t.pm_user_id === userId(req) || t.my_role === "pm" || t.my_role === "tl" || t.assignee_id === userId(req);
  if (!canEdit) throw forbidden();
  if (b.estimatedMinutes !== undefined && (b.estimatedMinutes ?? 0) !== (t.estimated_minutes ?? 0)) {
    const logged = Number((await db.query("SELECT coalesce(sum(minutes),0) AS m FROM time_entries WHERE task_id = $1", [id])).rows[0].m);
    if (b.estimatedMinutes != null && b.estimatedMinutes < logged) throw badRequest(`${formatMinutes(logged)} is already logged on this task, so its hours can't go below that`);
    await checkTaskHours(db, t.project_id, b.estimatedMinutes, id);
  }
  await db.query(
    `UPDATE tasks SET title = coalesce($2,title), status = coalesce($3,status), assignee_id = CASE WHEN $4 THEN $5::uuid ELSE assignee_id END,
       description = coalesce($6, description), priority = coalesce($7, priority), due_date = CASE WHEN $8 THEN $9::date ELSE due_date END,
       estimated_minutes = CASE WHEN $10 THEN $11::int ELSE estimated_minutes END, links = coalesce($12, links), updated_at = now() WHERE id = $1`, [
    id, b.title ?? null, b.status ?? null, b.assigneeId !== undefined, b.assigneeId ?? null, b.description ?? null, b.priority ?? null,
    b.dueDate !== undefined, b.dueDate ?? null, b.estimatedMinutes !== undefined, b.estimatedMinutes ?? null, b.links ?? null,
  ]);
  const changes: Record<string, [unknown, unknown]> = {};
  if (b.status && b.status !== t.status) changes.status = [t.status, b.status];
  if (b.assigneeId !== undefined && b.assigneeId !== t.assignee_id) {
    const nm = b.assigneeId ? (await db.query("SELECT name FROM users WHERE id = $1", [b.assigneeId])).rows[0]?.name : null;
    changes.assignee = [null, nm ?? "nobody"];
    if (b.assigneeId && b.assigneeId !== userId(req)) await notify(db, [b.assigneeId], { kind: "task.assigned", title: `Task assigned to you: ${b.title ?? t.title}`, link: `/projects/${t.project_id}?tab=tasks` });
  }
  if (Object.keys(changes).length) await audit(db, req, "task.update", "project", t.project_id, { taskId: t.id, title: b.title ?? t.title, changes });
  return { ok: true };
}));
projectsRouter.delete("/tasks/:id", requirePerm("tasks.manage", "projects.manage"), h(async (req, db) => {
  await db.query("DELETE FROM tasks WHERE id = $1", [uuid.parse(req.params.id)]);
  return { ok: true };
}));
