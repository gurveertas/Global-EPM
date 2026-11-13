import type { Db } from "@eszy/db";

/**
 * Rate rules:
 *  - Project rate  = (invoiced − refunded − cancelled, before tax) ÷ approved hours worked on it
 *  - Client rate   = total revenue ÷ total approved hours across the client's projects
 *  - Employee rate = Σ(hours × project rate) ÷ hours, over the period
 *  - Team rate     = the same over every member of the team
 * Money values are minor units; rates are minor units per hour.
 */
export const PROJECT_RATES_SQL = `
  WITH rev AS (
    SELECT project_id, sum(subtotal_minor) AS revenue FROM invoices WHERE status IN ('unpaid','partially_paid','paid') GROUP BY project_id
  ), hrs AS (
    SELECT e.project_id, sum(e.minutes) AS minutes FROM time_entries e JOIN sheets s ON s.id = e.sheet_id AND s.status = 'approved' GROUP BY e.project_id
  ), cost AS (
    SELECT e.project_id, sum(e.minutes * coalesce(u.cost_per_hour_minor,0) / 60.0) AS labour FROM time_entries e
      JOIN sheets s ON s.id = e.sheet_id AND s.status = 'approved' JOIN users u ON u.id = e.user_id GROUP BY e.project_id
  ), exp AS (SELECT project_id, sum(amount_minor) AS expenses FROM expenses WHERE project_id IS NOT NULL GROUP BY project_id)
  SELECT p.id AS project_id, p.name, p.client_id, p.type, p.billing_type, p.status,
    coalesce(rev.revenue,0)::bigint AS revenue_minor, coalesce(hrs.minutes,0)::int AS minutes,
    CASE WHEN coalesce(hrs.minutes,0) > 0 THEN round(coalesce(rev.revenue,0) * 60.0 / hrs.minutes) END::bigint AS rate_minor,
    round(coalesce(cost.labour,0))::bigint AS labour_cost_minor, coalesce(exp.expenses,0)::bigint AS expenses_minor
  FROM projects p LEFT JOIN rev ON rev.project_id = p.id LEFT JOIN hrs ON hrs.project_id = p.id
  LEFT JOIN cost ON cost.project_id = p.id LEFT JOIN exp ON exp.project_id = p.id`;

export async function projectRates(db: Db) {
  const rows = (await db.query(`${PROJECT_RATES_SQL} ORDER BY revenue_minor DESC`)).rows;
  return rows.map((r) => ({ ...r, profit_minor: r.revenue_minor - r.labour_cost_minor - r.expenses_minor }));
}

export async function clientRates(db: Db) {
  return (await db.query(
    `WITH pr AS (${PROJECT_RATES_SQL})
     SELECT c.id AS client_id, c.name, count(pr.project_id)::int AS projects, coalesce(sum(pr.revenue_minor),0)::bigint AS revenue_minor,
       coalesce(sum(pr.minutes),0)::int AS minutes,
       CASE WHEN sum(pr.minutes) > 0 THEN round(sum(pr.revenue_minor) * 60.0 / sum(pr.minutes)) END::bigint AS rate_minor,
       coalesce(sum(pr.labour_cost_minor + pr.expenses_minor),0)::bigint AS cost_minor
     FROM clients c LEFT JOIN pr ON pr.client_id = c.id GROUP BY c.id ORDER BY revenue_minor DESC`,
  )).rows;
}

/** Per person in a date range: approved hours, billable split, rate, revenue contribution, cost. */
export async function peopleStats(db: Db, from: string, to: string, userIds?: string[]) {
  return (await db.query(
    `WITH pr AS (${PROJECT_RATES_SQL}),
     ent AS (
       SELECT e.user_id, e.project_id, e.minutes, e.date,
         coalesce((SELECT sum(a.minutes) FROM time_allocations a JOIN billing_lines bl ON bl.id = a.billing_line_id WHERE a.entry_id = e.id AND bl.amount_minor = 0),0) AS free_minutes
       FROM time_entries e JOIN sheets s ON s.id = e.sheet_id AND s.status = 'approved'
       WHERE e.date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR e.user_id = ANY($3))
     )
     SELECT u.id AS user_id, u.name, u.team_id,
       coalesce(sum(ent.minutes),0)::int AS minutes,
       coalesce(sum(ent.minutes - ent.free_minutes),0)::int AS billable_minutes,
       coalesce(sum(ent.free_minutes),0)::int AS non_billable_minutes,
       count(DISTINCT ent.date)::int AS days_worked,
       coalesce(round(sum(ent.minutes * coalesce(pr.rate_minor,0) / 60.0)),0)::bigint AS revenue_minor,
       CASE WHEN sum(ent.minutes) > 0 THEN round(sum(ent.minutes * coalesce(pr.rate_minor,0)) / sum(ent.minutes)) END::bigint AS rate_minor,
       coalesce(round(sum(ent.minutes) * coalesce(u.cost_per_hour_minor,0) / 60.0),0)::bigint AS cost_minor
     FROM users u LEFT JOIN ent ON ent.user_id = u.id LEFT JOIN pr ON pr.project_id = ent.project_id
     WHERE u.status <> 'disabled' AND ($3::uuid[] IS NULL OR u.id = ANY($3))
     GROUP BY u.id ORDER BY revenue_minor DESC, minutes DESC`,
    [from, to, userIds ?? null],
  )).rows;
}

/** Sales and pre-sales results. Anyone who made calls shows up, whatever their role. */
export async function salesStats(db: Db, from: string, to: string) {
  return (await db.query(
    `WITH pr AS (${PROJECT_RATES_SQL}),
     brought AS (SELECT bringer_id AS uid, count(*) AS leads, count(*) FILTER (WHERE status IN ('converted','onboarded')) AS converted
                 FROM leads WHERE created_at::date BETWEEN $1 AND $2 GROUP BY bringer_id),
     calls AS (SELECT caller_id AS uid, count(*) AS calls, count(*) FILTER (WHERE outcome = 'converted') AS conversions
               FROM lead_calls WHERE called_at::date BETWEEN $1 AND $2 GROUP BY caller_id),
     rev AS (SELECT l.bringer_id AS uid, sum(pr.revenue_minor) AS revenue FROM leads l JOIN pr ON pr.project_id = l.project_id GROUP BY l.bringer_id)
     SELECT u.id AS user_id, u.name,
       coalesce(b.leads,0)::int AS leads_brought, coalesce(b.converted,0)::int AS leads_converted,
       CASE WHEN coalesce(b.leads,0) > 0 THEN round(100.0 * b.converted / b.leads, 1) END AS conversion_pct,
       coalesce(c.calls,0)::int AS calls_made, coalesce(c.conversions,0)::int AS calls_converted,
       CASE WHEN coalesce(c.calls,0) > 0 THEN round(100.0 * c.conversions / c.calls, 1) END AS call_conversion_pct,
       coalesce(rev.revenue,0)::bigint AS revenue_from_leads_minor
     FROM users u LEFT JOIN brought b ON b.uid = u.id LEFT JOIN calls c ON c.uid = u.id LEFT JOIN rev ON rev.uid = u.id
     WHERE b.uid IS NOT NULL OR c.uid IS NOT NULL OR rev.uid IS NOT NULL
     ORDER BY leads_converted DESC, calls_converted DESC`,
    [from, to],
  )).rows;
}
