import { CANCELLED, REFUNDED } from "../lib/invoiceState";
import type { Db } from "@eszy/db";
import type { CompanySettings } from "@eszy/shared";
import { dayOfWeek, eachDay } from "../lib/dates";

/**
 * The numbers behind every timesheet report, worked out day by day for each person:
 *  - expected: what the company policy asks for that day (normal day, WFH, half or short leave; 0 on weekends,
 *    holidays, full leave, or before joining / after leaving)
 *  - logged hours split by status (approved, waiting, draft) and by kind of work:
 *      billable  = client work with a billable work type
 *      in-house  = internal projects, or work types marked in-house (meetings, research)
 *      no work   = work types marked "no work" (idle, waiting for the client)
 *  - leave and holiday hours, offline (not tracked) hours, and unfilled hours for past days with no submitted sheet
 *  - utilization = approved billable hours ÷ expected hours
 */
export type Category = "billable" | "inhouse" | "no_work";
export interface DayCell {
  date: string;
  status: "present" | "absent" | "leave" | "half_leave" | "short_leave" | "holiday" | "half_holiday" | "non_working" | "wfh" | "future" | "not_employed" | "pending";
  expected: number; logged: number; approved: number; pending: number; sheet: string | null; wfh: string | null; leave: string | null; holiday: string | null;
}
export interface PersonStats {
  user_id: string; name: string; email: string; team_id: string | null; team_name: string | null; department_id: string | null; department_name: string | null;
  lead_id: string | null; lead_name: string | null; employment_status: string; employee_code: string;
  working_days: number; expected: number; logged: number; approved: number; pending: number; draft: number;
  billable: number; inhouse: number; no_work: number; pending_billable: number; offline: number; backdated: number;
  /** Approved hours whose invoice was refunded, and hours from cancelled invoices not yet invoiced again. */
  refunded: number; cancelled: number;
  leave: number; holiday: number; unfilled: number; unfilled_days: string[]; leave_days: number; present_days: number; absent_days: number; wfh_days: number;
  utilization: number | null; fill_rate: number | null;
  days?: DayCell[];
}

export interface Scope { userIds?: string[]; teamId?: string | null; departmentId?: string | null; managerId?: string | null; includeInactive?: boolean }

export async function peopleInScope(db: Db, scope: Scope) {
  return (await db.query(
    `SELECT u.id, u.name, u.email, u.team_id, t.name AS team_name, u.department_id, d.name AS department_name, u.joined_on, u.last_working_day, u.inactive_from,
       coalesce(u.reporting_manager_id, t.lead_user_id) AS lead_id, (SELECT name FROM users x WHERE x.id = coalesce(u.reporting_manager_id, t.lead_user_id)) AS lead_name,
       u.employment_status, u.employee_code, u.status
     FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.status <> 'invited' AND ($5 OR u.status = 'active' OR u.last_working_day IS NOT NULL)
       AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND 'time.own' = ANY(r.permissions))
       AND ($1::uuid[] IS NULL OR u.id = ANY($1)) AND ($2::uuid IS NULL OR u.team_id = $2) AND ($3::uuid IS NULL OR u.department_id = $3)
       AND ($4::uuid IS NULL OR coalesce(u.reporting_manager_id, t.lead_user_id) = $4 OR u.id = $4)
     ORDER BY t.name NULLS LAST, u.name`,
    [scope.userIds ?? null, scope.teamId ?? null, scope.departmentId ?? null, scope.managerId ?? null, !!scope.includeInactive],
  )).rows;
}

export async function timesheetStats(db: Db, s: CompanySettings, from: string, to: string, today: string, scope: Scope, withDays = false): Promise<PersonStats[]> {
  const people = await peopleInScope(db, scope);
  if (!people.length) return [];
  const ids = people.map((p: any) => p.id);
  const pol = s.policies;
  const days = eachDay(from, to);
  const holidays = new Map((await db.query("SELECT date, name, half_day, kind FROM holidays WHERE date BETWEEN $1 AND $2", [from, to])).rows.map((h: any) => [h.date, h]));
  const leaves = (await db.query(
    `SELECT l.user_id, l.start_date, l.end_date, l.half_day, l.part, l.short_minutes, lt.name FROM leave_requests l JOIN leave_types lt ON lt.id = l.leave_type_id
     WHERE l.status = 'approved' AND l.user_id = ANY($1) AND l.start_date <= $3 AND l.end_date >= $2`, [ids, from, to])).rows;
  const wfh = new Map((await db.query("SELECT user_id, date, kind, minutes FROM wfh_requests WHERE status = 'approved' AND user_id = ANY($1) AND date BETWEEN $2 AND $3", [ids, from, to])).rows.map((w: any) => [`${w.user_id}|${w.date}`, w]));
  const sheets = new Map((await db.query("SELECT id, user_id, date, status FROM sheets WHERE user_id = ANY($1) AND date BETWEEN $2 AND $3", [ids, from, to])).rows.map((r: any) => [`${r.user_id}|${r.date}`, r]));
  const entries = (await db.query(
    `SELECT e.user_id, e.date, s.status, CASE WHEN e.category IS NOT NULL THEN e.category WHEN p.is_internal THEN 'inhouse' ELSE coalesce(a.category, 'billable') END AS category,
       sum(e.minutes)::int AS minutes, coalesce(sum(e.minutes) FILTER (WHERE e.offline), 0)::int AS offline,
       coalesce(sum(e.minutes) FILTER (WHERE ${REFUNDED}), 0)::int AS refunded, coalesce(sum(e.minutes) FILTER (WHERE ${CANCELLED}), 0)::int AS cancelled
     FROM time_entries e JOIN sheets s ON s.id = e.sheet_id JOIN projects p ON p.id = e.project_id LEFT JOIN activity_types a ON a.id = e.activity_type_id
     WHERE e.user_id = ANY($1) AND e.date BETWEEN $2 AND $3 GROUP BY 1, 2, 3, 4`, [ids, from, to])).rows;
  const backdated = new Map((await db.query(
    `SELECT r.user_id, coalesce(sum((SELECT sum(minutes) FROM time_entries e WHERE e.user_id = r.user_id AND e.date = r.date)),0)::int AS minutes
     FROM sheet_requests r WHERE r.status = 'used' AND r.user_id = ANY($1) AND r.date BETWEEN $2 AND $3 GROUP BY r.user_id`, [ids, from, to])).rows.map((r: any) => [r.user_id, r.minutes]));
  const byDay = new Map<string, typeof entries>();
  for (const e of entries) { const k = `${e.user_id}|${e.date}`; byDay.set(k, [...(byDay.get(k) ?? []), e]); }

  return people.map((u: any) => {
    const st: PersonStats = {
      user_id: u.id, name: u.name, email: u.email, team_id: u.team_id, team_name: u.team_name, department_id: u.department_id, department_name: u.department_name,
      lead_id: u.lead_id, lead_name: u.lead_name, employment_status: u.employment_status, employee_code: u.employee_code,
      working_days: 0, expected: 0, logged: 0, approved: 0, pending: 0, draft: 0, billable: 0, inhouse: 0, no_work: 0, pending_billable: 0, offline: 0, refunded: 0, cancelled: 0,
      backdated: backdated.get(u.id) ?? 0, leave: 0, holiday: 0, unfilled: 0, unfilled_days: [], leave_days: 0, present_days: 0, absent_days: 0, wfh_days: 0,
      utilization: null, fill_rate: null, days: withDays ? [] : undefined,
    };
    const end = u.last_working_day ?? u.inactive_from ?? null;
    for (const d of days) {
      const cell: DayCell = { date: d, status: "present", expected: 0, logged: 0, approved: 0, pending: 0, sheet: null, wfh: null, leave: null, holiday: null };
      const employed = (!u.joined_on || d >= u.joined_on) && (!end || d <= end);
      const working = pol.workingDays.includes(dayOfWeek(d));
      const hol = holidays.get(d) as any;
      const lv = leaves.find((l: any) => l.user_id === u.id && d >= l.start_date && d <= l.end_date) as any;
      const w = wfh.get(`${u.id}|${d}`) as any;
      const sheet = sheets.get(`${u.id}|${d}`) as any;
      cell.sheet = sheet?.status ?? null;
      for (const e of byDay.get(`${u.id}|${d}`) ?? []) {
        cell.logged += e.minutes;
        st.logged += e.minutes;
        st.offline += e.offline; st.refunded += e.refunded; st.cancelled += e.cancelled;
        if (e.status === "approved") {
          cell.approved += e.minutes; st.approved += e.minutes;
          st[e.category as Category] += e.minutes;
        } else if (e.status === "submitted") {
          cell.pending += e.minutes; st.pending += e.minutes;
          if (e.category === "billable") st.pending_billable += e.minutes;
        } else st.draft += e.minutes;
      }
      if (!employed) { cell.status = "not_employed"; withDays && st.days!.push(cell); continue; }
      if (!working) { cell.status = "non_working"; withDays && st.days!.push(cell); continue; }
      const normal = pol.dailyMinimumMinutes;
      let base = normal;
      if (w?.kind === "full") base = pol.wfhFullDayMinutes;
      if (w?.kind === "half") base = pol.wfhHalfDayMinutes;
      cell.wfh = w?.kind ?? null;
      if (hol) {
        cell.holiday = hol.name;
        if (!hol.half_day) { cell.status = "holiday"; st.holiday += normal; withDays && st.days!.push(cell); continue; }
        cell.status = "half_holiday"; st.holiday += Math.round(normal / 2); base = Math.round(base / 2);
      }
      st.working_days++;
      let expected = base;
      if (lv) {
        cell.leave = lv.name;
        if (lv.part === "short") { expected = Math.max(0, base - (lv.short_minutes ?? 0)); cell.status = "short_leave"; st.leave += lv.short_minutes ?? 0; st.leave_days += 0.25; }
        else if (lv.half_day) { expected = Math.round(base / 2); cell.status = "half_leave"; st.leave += base - expected; st.leave_days += 0.5; }
        else { expected = 0; cell.status = "leave"; st.leave += base; st.leave_days += 1; }
      }
      cell.expected = expected;
      st.expected += expected;
      if (w) st.wfh_days++;
      const filed = sheet && ["submitted", "approved"].includes(sheet.status);
      if (d > today || (d === today && !filed)) { if (cell.status === "present") cell.status = "future"; }
      else if (expected > 0 && !filed) {
        st.unfilled += Math.max(0, expected - cell.logged);
        st.unfilled_days.push(d);
        if (cell.status === "present") { cell.status = cell.logged > 0 ? "pending" : "absent"; if (!cell.logged) st.absent_days++; }
      } else if (cell.status === "present") {
        if (w) cell.status = "wfh";
        st.present_days++;
      } else if (cell.logged > 0) st.present_days++;
      withDays && st.days!.push(cell);
    }
    st.utilization = st.expected ? Math.round((st.billable / st.expected) * 1000) / 10 : null;
    st.fill_rate = st.expected ? Math.round((Math.min(st.expected, st.approved + st.pending) / st.expected) * 1000) / 10 : null;
    return st;
  });
}

const SUM_KEYS = ["refunded", "cancelled", "expected", "logged", "approved", "pending", "draft", "billable", "inhouse", "no_work", "pending_billable", "offline", "backdated", "leave", "holiday", "unfilled", "working_days", "present_days", "absent_days", "wfh_days", "leave_days"] as const;
export function sumStats(rows: PersonStats[]) {
  const t: Record<string, number> = Object.fromEntries(SUM_KEYS.map((k) => [k, 0]));
  for (const r of rows) for (const k of SUM_KEYS) t[k] += Number(r[k]) || 0;
  return {
    ...t, people: rows.length, unfilled_sheets: rows.reduce((a, r) => a + r.unfilled_days.length, 0),
    utilization: t.expected ? Math.round((t.billable / t.expected) * 1000) / 10 : null,
    fill_rate: t.expected ? Math.round((Math.min(t.expected, t.approved + t.pending) / t.expected) * 1000) / 10 : null,
  };
}
export function byTeam(rows: PersonStats[]) {
  const groups = new Map<string, PersonStats[]>();
  for (const r of rows) { const k = r.team_id ?? "none"; groups.set(k, [...(groups.get(k) ?? []), r]); }
  return [...groups.entries()].map(([id, list]) => ({ team_id: id === "none" ? null : id, team_name: list[0].team_name ?? "No team", lead_name: list.find((x) => x.lead_name)?.lead_name ?? null, ...sumStats(list) }))
    .sort((a, b) => (a.team_name ?? "").localeCompare(b.team_name ?? ""));
}
