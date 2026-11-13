import { Router } from "express";
import { z } from "zod";
import { can, h, userId } from "../lib/context";
import { requirePerm } from "../lib/auth";
import { requireFeature } from "../lib/tenant";
import { forbidden } from "../lib/errors";
import { getSettings } from "../lib/settings";
import { addDays, daysBetween, periodBounds, todayIn } from "../lib/dates";
import { clientRates, peopleStats, projectRates, salesStats } from "../services/rates";
import { displayStatus } from "../services/invoices";

export const reportsRouter = Router();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function range(req: any, db: any) {
  const s = await getSettings(db);
  const today = todayIn(s.locale.timezone);
  const q = z.object({ from: date.optional(), to: date.optional(), period: z.enum(["day", "week", "month"]).optional() }).parse(req.query);
  if (q.from && q.to) return { from: q.from, to: q.to, s, today };
  if (q.period === "day") return { from: today, to: today, s, today };
  const b = periodBounds(today, q.period === "week" ? "week" : "month", s.locale.weekStartsOn);
  return { from: b.start, to: b.end, s, today };
}

const stripMoney = (rows: any[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !/_minor$/.test(k))));

// ---------- rates (money: Admin and Billing Manager) ----------
reportsRouter.get("/rates/projects", requireFeature("performance_rates"), requirePerm("money.view"), h(async (_req, db) => projectRates(db)));
reportsRouter.get("/rates/clients", requireFeature("performance_rates"), requirePerm("money.view"), h(async (_req, db) => clientRates(db)));

// ---------- performance ----------
reportsRouter.get("/performance/people", requireFeature("performance_rates"), requirePerm("performance.view", "performance.view_team"), h(async (req, db) => {
  const { from, to } = await range(req, db);
  let ids: string[] | undefined;
  if (!can(req, "performance.view")) {
    ids = (await db.query("SELECT u.id FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE coalesce(u.reporting_manager_id, t.lead_user_id) = $1", [userId(req)])).rows.map((r) => r.id);
  }
  const rows = await peopleStats(db, from, to, ids);
  const days = daysBetween(from, to) + 1;
  const out = rows.map((r) => ({ ...r, daily_average_minutes: r.days_worked ? Math.round(r.minutes / r.days_worked) : 0 }));
  return { from, to, days, people: can(req, "money.view") ? out : stripMoney(out) };
}));

/** Team view for each TL: team revenue, hours billed, team rate and daily averages for the day, week or month. */
reportsRouter.get("/performance/teams", requireFeature("performance_rates"), requirePerm("performance.view", "performance.view_team"), h(async (req, db) => {
  const { from, to } = await range(req, db);
  const teams = (await db.query(
    `SELECT t.id, t.name, t.lead_user_id, l.name AS lead_name FROM teams t LEFT JOIN users l ON l.id = t.lead_user_id
     WHERE $1 OR t.lead_user_id = $2 ORDER BY t.name`, [can(req, "performance.view"), userId(req)],
  )).rows;
  const people = await peopleStats(db, from, to);
  const out = teams.map((t) => {
    const m = people.filter((p) => p.team_id === t.id);
    const minutes = m.reduce((a, p) => a + p.minutes, 0);
    const billable = m.reduce((a, p) => a + p.billable_minutes, 0);
    const revenue = m.reduce((a, p) => a + Number(p.revenue_minor), 0);
    const days = Math.max(1, ...m.map((p) => p.days_worked));
    return {
      ...t, members: m.length, minutes, billable_minutes: billable, revenue_minor: revenue,
      rate_minor: minutes ? Math.round((revenue * 60) / minutes) : null,
      daily_revenue_minor: Math.round(revenue / days), daily_minutes: Math.round(minutes / days),
    };
  });
  return { from, to, teams: can(req, "money.view") ? out : stripMoney(out) };
}));

reportsRouter.get("/performance/sales", requireFeature("sales_crm"), requirePerm("performance.view", "leads.view_all"), h(async (req, db) => {
  const { from, to } = await range(req, db);
  const rows = await salesStats(db, from, to);
  return { from, to, people: can(req, "money.view") ? rows : stripMoney(rows) };
}));

/** One person's own numbers (no money), for their dashboard. */
reportsRouter.get("/performance/me", h(async (req, db) => {
  const { from, to } = await range(req, db);
  const [me] = await peopleStats(db, from, to, [userId(req)]);
  const sales = (await salesStats(db, from, to)).find((r) => r.user_id === userId(req)) ?? null;
  const strip = (r: any) => (r && !can(req, "money.view") ? stripMoney([r])[0] : r);
  return { from, to, me: strip(me), sales: strip(sales) };
}));

// ---------- reports ----------
/** Hours with payment status. Shown only to Admin and Billing Manager. */
reportsRouter.get("/reports/hours", requirePerm("money.view"), h(async (req, db) => {
  const { from, to } = await range(req, db);
  const q = z.object({ projectId: z.string().uuid().optional(), userId: z.string().uuid().optional() }).parse(req.query);
  return (await db.query(
    `SELECT e.date, u.name AS user_name, p.name AS project_name, e.description, e.source, s.status AS sheet_status,
       coalesce(a.minutes, e.minutes)::int AS minutes, bl.label AS billing_line,
       CASE
         WHEN s.status <> 'approved' THEN 'Not approved'
         WHEN bl.id IS NOT NULL AND bl.amount_minor = 0 THEN 'Non-billable'
         WHEN coalesce(i.status, ie.status) = 'refunded' THEN 'Refunded'
         WHEN coalesce(i.status, ie.status) = 'paid' THEN 'Paid'
         WHEN coalesce(i.status, ie.status) = 'partially_paid' THEN 'Partially paid'
         WHEN coalesce(i.status, ie.status) = 'unpaid' THEN 'Unpaid'
         ELSE 'Not invoiced yet'
       END AS payment_status,
       coalesce(i.number, ie.number) AS invoice_number
     FROM time_entries e JOIN sheets s ON s.id = e.sheet_id JOIN users u ON u.id = e.user_id JOIN projects p ON p.id = e.project_id
     LEFT JOIN time_allocations a ON a.entry_id = e.id LEFT JOIN billing_lines bl ON bl.id = a.billing_line_id
     LEFT JOIN invoices i ON i.id = bl.invoice_id AND i.status <> 'cancelled' LEFT JOIN invoices ie ON ie.id = e.invoice_id AND ie.status <> 'cancelled'
     WHERE e.date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR e.project_id = $3) AND ($4::uuid IS NULL OR e.user_id = $4)
     ORDER BY e.date DESC, u.name LIMIT 5000`,
    [from, to, q.projectId ?? null, q.userId ?? null],
  )).rows;
}));

reportsRouter.get("/reports/revenue", requirePerm("money.view"), h(async (_req, db) =>
  (await db.query(
    `SELECT to_char(issue_date, 'YYYY-MM') AS month,
       sum(subtotal_minor) FILTER (WHERE status IN ('unpaid','partially_paid','paid'))::bigint AS invoiced_minor,
       sum(tax_minor) FILTER (WHERE status IN ('unpaid','partially_paid','paid'))::bigint AS tax_minor,
       sum(paid_minor) FILTER (WHERE status <> 'cancelled')::bigint AS collected_minor,
       sum(subtotal_minor) FILTER (WHERE status = 'refunded')::bigint AS refunded_minor,
       count(*)::int AS invoices
     FROM invoices GROUP BY 1 ORDER BY 1 DESC LIMIT 24`,
  )).rows));

reportsRouter.get("/reports/receivables", requirePerm("money.view"), h(async (_req, db) => {
  const s = await getSettings(db);
  const today = todayIn(s.locale.timezone);
  const rows = (await db.query("SELECT i.*, c.name AS client_name, p.name AS project_name FROM invoices i JOIN clients c ON c.id = i.client_id JOIN projects p ON p.id = i.project_id WHERE i.status IN ('unpaid','partially_paid')")).rows;
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const r of rows) {
    const out = r.total_minor - r.paid_minor;
    const late = daysBetween(r.due_date, today);
    if (late <= 0) buckets.current += out; else if (late <= 30) buckets.d1_30 += out; else if (late <= 60) buckets.d31_60 += out; else if (late <= 90) buckets.d61_90 += out; else buckets.d90_plus += out;
    r.display_status = displayStatus(r, today, s.invoices.dueSoonDays);
  }
  return { buckets, invoices: rows };
}));

/** Dashboard numbers for whoever is signed in. Money only for those allowed to see it. */
reportsRouter.get("/dashboard", h(async (req, db) => {
  const s = await getSettings(db);
  const today = todayIn(s.locale.timezone);
  // The money tiles follow the chosen dates (default: this month).
  const rq = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
  const dm = periodBounds(today, "month");
  const month = { start: rq.from ?? dm.start, end: rq.to ?? dm.end };
  const uid = userId(req);
  const out: Record<string, unknown> = { today };
  if (can(req, "time.own")) {
    const sheet = (await db.query("SELECT status FROM sheets WHERE user_id = $1 AND date = $2", [uid, today])).rows[0];
    const week = periodBounds(today, "week", s.locale.weekStartsOn);
    out.mySheet = { status: sheet?.status ?? "none" };
    out.myWeekMinutes = (await db.query("SELECT coalesce(sum(minutes),0)::int AS m FROM time_entries WHERE user_id = $1 AND date BETWEEN $2 AND $3", [uid, week.start, week.end])).rows[0].m;
    out.missingDays = (await db.query(
      `SELECT d::date AS date FROM generate_series($2::date - 6, $2::date - 1, interval '1 day') d
       WHERE extract(dow FROM d)::int = ANY($3) AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = d::date)
         AND NOT EXISTS (SELECT 1 FROM sheets s WHERE s.user_id = $1 AND s.date = d::date AND s.status IN ('submitted','approved'))
         AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.user_id = $1 AND l.status = 'approved' AND d::date BETWEEN l.start_date AND l.end_date AND NOT l.half_day)`,
      [uid, today, s.policies.workingDays],
    )).rows.map((r) => r.date);
  }
  if (can(req, "time.approve_team") || can(req, "time.approve_all")) {
    out.sheetsToApprove = (await db.query(
      `SELECT count(*)::int AS n FROM sheets s JOIN users u ON u.id = s.user_id LEFT JOIN teams t ON t.id = u.team_id
       WHERE s.status = 'submitted' AND ($1 OR (coalesce(u.reporting_manager_id, t.lead_user_id) = $2 AND s.user_id <> $2))`, [can(req, "time.approve_all"), uid],
    )).rows[0].n;
    out.requestsToApprove = (await db.query(
      `SELECT (SELECT count(*) FROM leave_requests r JOIN users u ON u.id = r.user_id LEFT JOIN teams t ON t.id = u.team_id WHERE r.status='pending' AND ($1 OR coalesce(u.reporting_manager_id, t.lead_user_id) = $2))
            + (SELECT count(*) FROM wfh_requests r JOIN users u ON u.id = r.user_id LEFT JOIN teams t ON t.id = u.team_id WHERE r.status='pending' AND ($1 OR coalesce(u.reporting_manager_id, t.lead_user_id) = $2)) AS n`,
      [can(req, "leave.manage"), uid],
    )).rows[0].n;
  }
  if (req.tenant!.features.has("sales_crm")) {
    out.myLeads = (await db.query(
      `SELECT count(*) FILTER (WHERE caller_id = $1 AND status IN ('new','contacted','follow_up'))::int AS to_call,
              count(*) FILTER (WHERE bringer_id = $1 AND created_at::date BETWEEN $3 AND $4)::int AS brought,
              count(*) FILTER (WHERE (bringer_id = $1 OR caller_id = $1) AND next_follow_up_at::date <= $2 AND status IN ('contacted','follow_up','new'))::int AS follow_ups_due
       FROM leads`, [uid, today, month.start, month.end],
    )).rows[0];
  }
  if (can(req, "money.view") && req.tenant!.features.has("projects_billing")) {
    const inv = (await db.query(
      `SELECT coalesce(sum(subtotal_minor) FILTER (WHERE issue_date BETWEEN $1 AND $2 AND status IN ('unpaid','partially_paid','paid')),0)::bigint AS invoiced_month,
              coalesce(sum(total_minor - paid_minor) FILTER (WHERE status IN ('unpaid','partially_paid')),0)::bigint AS outstanding,
              coalesce(sum(total_minor - paid_minor) FILTER (WHERE status IN ('unpaid','partially_paid') AND due_date < $3),0)::bigint AS overdue,
              count(*) FILTER (WHERE status IN ('unpaid','partially_paid') AND due_date < $3)::int AS overdue_count,
              count(*) FILTER (WHERE status IN ('unpaid','partially_paid') AND due_date BETWEEN $3 AND $4)::int AS due_soon_count
       FROM invoices`, [month.start, month.end, today, addDays(today, s.invoices.dueSoonDays)],
    )).rows[0];
    const collected = (await db.query("SELECT coalesce(sum(amount_minor),0)::bigint AS n FROM payments WHERE received_on BETWEEN $1 AND $2", [month.start, month.end])).rows[0].n;
    out.money = { ...inv, collected_month: collected, currency: s.locale.currency };
  }
  if (can(req, "projects.view_all")) {
    out.projects = (await db.query("SELECT count(*) FILTER (WHERE status='active')::int AS active, count(*) FILTER (WHERE status='paused')::int AS paused FROM projects")).rows[0];
    out.projectsNearCap = (await db.query(
      `SELECT p.id, p.name, cap.m AS cap_minutes, used.m AS used_minutes FROM projects p
       JOIN LATERAL (SELECT sum(minutes) AS m FROM billing_lines WHERE project_id = p.id) cap ON cap.m > 0
       JOIN LATERAL (SELECT coalesce(sum(minutes),0) AS m FROM time_entries WHERE project_id = p.id) used ON true
       WHERE p.status = 'active' AND used.m >= cap.m * 0.85 ORDER BY used.m::float / cap.m DESC LIMIT 10`,
    )).rows;
  }
  if (!Object.keys(out).length) throw forbidden();
  return out;
}));
