import { Router } from "express";
import { z } from "zod";
import { can, h, userId } from "../lib/context";
import { requirePerm } from "../lib/auth";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit, notify, usersWithPermission } from "../lib/audit";
import { getSettings } from "../lib/settings";
import { addDays, periodBounds, todayIn } from "../lib/dates";
import { timesheetStats } from "../services/reporting";
import { peopleStats } from "../services/rates";

/** Employee detail, project assignment (PM -> TL -> member), project transfers, company notes and accessory requests. */
export const epmRouter = Router();
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------- employee detail ----------
epmRouter.get("/users/:id/overview", h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const self = id === userId(req);
  const lead = (await db.query("SELECT 1 FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = $1 AND coalesce(u.reporting_manager_id, t.lead_user_id) = $2", [id, userId(req)])).rowCount;
  if (!self && !lead && !can(req, "users.view")) throw forbidden();
  const s = await getSettings(db);
  const today = todayIn(s.locale.timezone);
  const q = z.object({ from: date.optional(), to: date.optional() }).parse(req.query);
  const from = q.from ?? periodBounds(today, "month").start, to = q.to ?? today;
  const u = (await db.query(
    `SELECT u.id, u.name, u.email, u.phone, u.status, u.is_owner, u.joined_on, u.employee_code, u.designation, u.employment_status, u.inactive_from, u.last_working_day, u.deactivated_reason,
       u.probation_ends_on, u.notice_starts_on, u.last_working_day, u.date_of_birth, u.address, u.emergency_contact_name, u.emergency_contact_phone, u.has_photo,
       u.last_login_at, u.team_id, t.name AS team_name, d.name AS department_name, u.reporting_manager_id,
       (SELECT name FROM users x WHERE x.id = coalesce(u.reporting_manager_id, t.lead_user_id)) AS reporting_manager_name, tl.name AS team_lead_name
       ${can(req, "money.view") ? ", u.cost_per_hour_minor" : ""},
       coalesce((SELECT json_agg(json_build_object('id', r.id, 'key', r.key, 'name', r.name)) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]') AS roles
     FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN users tl ON tl.id = t.lead_user_id LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = $1`, [id])).rows[0];
  if (!u) throw notFound();
  const [stats] = await timesheetStats(db, s, from, to, today, { userIds: [id], includeInactive: true }, true);
  const projects = (await db.query(
    `SELECT p.id, p.name, p.status, p.type, c.name AS client_name, CASE WHEN p.pm_user_id = $1 THEN 'pm' ELSE m.role END AS role,
       coalesce((SELECT sum(e.minutes) FROM time_entries e WHERE e.project_id = p.id AND e.user_id = $1),0)::int AS logged_minutes,
       coalesce((SELECT sum(e.minutes) FROM time_entries e WHERE e.project_id = p.id AND e.user_id = $1 AND e.date BETWEEN $2 AND $3),0)::int AS period_minutes,
       (SELECT max(e.date) FROM time_entries e WHERE e.project_id = p.id AND e.user_id = $1) AS last_on,
       (SELECT count(*)::int FROM tasks tk WHERE tk.project_id = p.id AND tk.assignee_id = $1 AND tk.status <> 'done') AS open_tasks
     FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE m.user_id IS NOT NULL OR p.pm_user_id = $1 ORDER BY p.status, last_on DESC NULLS LAST`, [id, from, to])).rows;
  const activity = (await db.query(
    `SELECT p.name AS project_name, coalesce(a.name, CASE e.category WHEN 'billable' THEN 'Billable work' WHEN 'inhouse' THEN 'In-house work' WHEN 'no_work' THEN 'No work' END, 'No work type') AS activity, CASE WHEN e.category IS NOT NULL THEN e.category WHEN p.is_internal THEN 'inhouse' ELSE coalesce(a.category, 'billable') END AS category, sum(e.minutes)::int AS minutes
     FROM time_entries e JOIN projects p ON p.id = e.project_id LEFT JOIN activity_types a ON a.id = e.activity_type_id
     WHERE e.user_id = $1 AND e.date BETWEEN $2 AND $3 GROUP BY 1, 2, 3 ORDER BY 4 DESC`, [id, from, to])).rows;
  const leaves = (await db.query(
    `SELECT r.id, r.start_date, r.end_date, r.days, r.unpaid_days, r.part, r.short_minutes, r.status, r.reason, lt.name AS leave_type, r.created_at
     FROM leave_requests r JOIN leave_types lt ON lt.id = r.leave_type_id WHERE r.user_id = $1 ORDER BY r.start_date DESC LIMIT 100`, [id])).rows;
  const balances = (await db.query(
    "SELECT lt.name, lt.paid, b.credited_days, b.carried_days, b.used_days FROM leave_balances b JOIN leave_types lt ON lt.id = b.leave_type_id WHERE b.user_id = $1 AND b.year = $2 ORDER BY lt.name",
    [id, Number(today.slice(0, 4))])).rows;
  const wfh = (await db.query("SELECT id, date, kind, minutes, status, reason FROM wfh_requests WHERE user_id = $1 ORDER BY date DESC LIMIT 50", [id])).rows;
  const assets = (await db.query("SELECT id, name, category, serial_number, condition, assigned_on FROM assets WHERE assigned_to = $1 ORDER BY assigned_on DESC", [id])).rows;
  const months = (await db.query(
    `SELECT to_char(e.date, 'YYYY-MM') AS month, sum(e.minutes)::int AS minutes,
       sum(e.minutes) FILTER (WHERE coalesce(e.category, CASE WHEN p.is_internal THEN 'inhouse' END, a.category, 'billable') = 'billable')::int AS billable
     FROM time_entries e JOIN projects p ON p.id = e.project_id LEFT JOIN activity_types a ON a.id = e.activity_type_id
     WHERE e.user_id = $1 AND e.date >= date_trunc('month', current_date) - interval '5 months' GROUP BY 1 ORDER BY 1`, [id])).rows;
  // Average rate: Σ(approved hours × that project's rate) ÷ approved hours, for these dates and for all time. Money roles only.
  let rate = null;
  if (can(req, "money.view")) {
    const [period] = await peopleStats(db, from, to, [id]);
    const [all] = await peopleStats(db, "2000-01-01", today, [id]);
    rate = { period: period ?? null, all: all ?? null };
  }
  return { from, to, user: u, stats: stats ?? null, projects, activity, leaves, balances, wfh, assets, months, rate };
}));

// ---------- project assignment chain ----------
/**
 * For the Admin and PMs: projects with their PM, TLs and members, so TLs can be assigned.
 * For TLs: the projects they lead, so members can be assigned. "Unassigned" means no TL yet (PM view) or no members yet (TL view).
 */
epmRouter.get("/assignments", h(async (req, db) => {
  const uid = userId(req);
  const all = can(req, "projects.manage") || can(req, "projects.view_all");
  const rows = (await db.query(
    `SELECT p.id, p.name, p.code, p.status, p.type, p.billing_type, p.start_date, p.pm_user_id, pm.name AS pm_name, c.name AS client_name,
       (SELECT coalesce(sum(minutes),0)::int FROM billing_lines bl WHERE bl.project_id = p.id) AS cap_minutes,
       (SELECT coalesce(sum(minutes),0)::int FROM time_entries e WHERE e.project_id = p.id) AS logged_minutes,
       (SELECT count(*)::int FROM tasks tk WHERE tk.project_id = p.id AND tk.status <> 'done') AS open_tasks,
       coalesce((SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name) FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = p.id AND m.role = 'tl'), '[]') AS tls,
       coalesce((SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name) FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = p.id AND m.role = 'member' AND m.user_id IS DISTINCT FROM p.pm_user_id), '[]') AS members,
       coalesce((SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.id = p.pm_user_id DESC, u.name) FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = p.id AND m.role = 'pm'), '[]') AS pms,
       EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1 AND m.role = 'tl') AS i_am_tl
     FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN users pm ON pm.id = p.pm_user_id
     WHERE p.status <> 'ended' AND ($2 OR p.pm_user_id = $1 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1 AND m.role IN ('tl','pm')))
     ORDER BY p.name`, [uid, all])).rows;
  return { canManage: can(req, "projects.manage"), projects: rows };
}));

/** Move projects from one person to another, as PM, TL or member (for when someone leaves or changes team). */
epmRouter.post("/assignments/transfer", requirePerm("projects.assign"), h(async (req, db) => {
  const b = z.object({ fromUserId: uuid, toUserId: uuid, role: z.enum(["pm", "tl", "member"]), projectIds: z.array(uuid).min(1).max(200) }).parse(req.body);
  if (b.fromUserId === b.toUserId) throw badRequest("Pick two different people");
  let moved = 0;
  for (const pid of b.projectIds) {
    if (b.role === "pm") {
      const main = await db.query("UPDATE projects SET pm_user_id = $3 WHERE id = $1 AND pm_user_id = $2", [pid, b.fromUserId, b.toUserId]);
      const had = (await db.query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = 'pm' RETURNING 1", [pid, b.fromUserId])).rowCount;
      if (!main.rowCount && !had) continue;
      await db.query("INSERT INTO project_members (tenant_id, project_id, user_id, role, assigned_by) VALUES ($1,$2,$3,'pm',$4) ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'pm'", [req.tenant!.id, pid, b.toUserId, userId(req)]);
      moved++;
    } else {
      const had = (await db.query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = $3 RETURNING 1", [pid, b.fromUserId, b.role])).rowCount;
      if (!had) continue;
      await db.query(
        `INSERT INTO project_members (tenant_id, project_id, user_id, role, assigned_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (project_id, user_id) DO UPDATE SET role = CASE WHEN EXCLUDED.role = 'tl' THEN 'tl' ELSE project_members.role END`,
        [req.tenant!.id, pid, b.toUserId, b.role, userId(req)]);
      moved++;
    }
  }
  await audit(db, req, "projects.transfer", "user", b.toUserId, b);
  await notify(db, [b.toUserId], { kind: "project.member", title: `${moved} project(s) were moved to you as ${b.role === "pm" ? "PM" : b.role === "tl" ? "TL" : "member"}`, link: "/assignments" });
  return { moved };
}));

// ---------- notes ----------
const noteSchema = z.object({ title: z.string().max(200).default(""), body: z.string().min(1).max(20000), visibility: z.enum(["private", "everyone"]).default("private"), pinned: z.boolean().default(false), color: z.enum(["plain", "amber", "green", "blue", "rose"]).default("plain") });
epmRouter.get("/notes", h(async (req, db) =>
  (await db.query("SELECT n.*, u.name AS author FROM notes n JOIN users u ON u.id = n.created_by WHERE n.created_by = $1 OR n.visibility = 'everyone' ORDER BY n.pinned DESC, n.updated_at DESC LIMIT 500", [userId(req)])).rows));
epmRouter.post("/notes", h(async (req, db) => {
  const b = noteSchema.parse(req.body);
  if (b.visibility === "everyone" && !can(req, "settings.manage") && !can(req, "events.manage")) throw forbidden("Only Admin and HR can share notes with everyone");
  return (await db.query("INSERT INTO notes (tenant_id, title, body, visibility, pinned, color, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [req.tenant!.id, b.title, b.body, b.visibility, b.pinned, b.color, userId(req)])).rows[0];
}));
epmRouter.put("/notes/:id", h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const n = (await db.query("SELECT * FROM notes WHERE id = $1", [id])).rows[0];
  if (!n) throw notFound();
  if (n.created_by !== userId(req) && !can(req, "settings.manage")) throw forbidden();
  const b = noteSchema.partial().parse(req.body);
  await db.query("UPDATE notes SET title = coalesce($2,title), body = coalesce($3,body), visibility = coalesce($4,visibility), pinned = coalesce($5,pinned), color = coalesce($6,color), updated_at = now() WHERE id = $1",
    [id, b.title ?? null, b.body ?? null, b.visibility ?? null, b.pinned ?? null, b.color ?? null]);
  return { ok: true };
}));
epmRouter.delete("/notes/:id", h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const n = (await db.query("SELECT created_by FROM notes WHERE id = $1", [id])).rows[0];
  if (!n) throw notFound();
  if (n.created_by !== userId(req) && !can(req, "settings.manage")) throw forbidden();
  await db.query("DELETE FROM notes WHERE id = $1", [id]);
  return { ok: true };
}));

// ---------- accessory requests and issues ----------
epmRouter.get("/asset-requests", h(async (req, db) => {
  const all = can(req, "assets.manage");
  return (await db.query(
    `SELECT r.*, u.name AS user_name, a.name AS asset_name, a.serial_number, d.name AS decided_by_name FROM asset_requests r JOIN users u ON u.id = r.user_id
     LEFT JOIN assets a ON a.id = r.asset_id LEFT JOIN users d ON d.id = r.decided_by WHERE ($1 OR r.user_id = $2) ORDER BY (r.status IN ('open','in_progress')) DESC, r.created_at DESC LIMIT 300`, [all, userId(req)])).rows;
}));
epmRouter.post("/asset-requests", h(async (req, db) => {
  const b = z.object({ kind: z.enum(["new", "issue"]), category: z.string().max(80).default(""), assetId: uuid.nullable().optional(), priority: z.enum(["low", "medium", "high"]).default("medium"), details: z.string().min(3).max(4000) }).parse(req.body);
  if (b.kind === "issue") {
    if (!b.assetId) throw badRequest("Pick the item that has the issue");
    const a = (await db.query("SELECT assigned_to FROM assets WHERE id = $1", [b.assetId])).rows[0];
    if (!a || a.assigned_to !== userId(req)) throw forbidden("You can only report issues with items you hold");
  }
  const r = (await db.query("INSERT INTO asset_requests (tenant_id, user_id, kind, category, asset_id, priority, details) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [req.tenant!.id, userId(req), b.kind, b.category, b.assetId ?? null, b.priority, b.details])).rows[0];
  await notify(db, await usersWithPermission(db, "assets.manage"), { kind: "asset.request", title: `${req.user!.name} ${b.kind === "new" ? `asked for a new ${b.category || "item"}` : "reported an issue with an item"}`, body: b.details.slice(0, 200), link: "/accessories?tab=requests" });
  return r;
}));
epmRouter.post("/asset-requests/:id/decide", requirePerm("assets.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({ status: z.enum(["in_progress", "done", "rejected"]), response: z.string().max(2000).default("") }).parse(req.body);
  const r = (await db.query("UPDATE asset_requests SET status = $2, response = $3, decided_by = $4, updated_at = now() WHERE id = $1 RETURNING *", [id, b.status, b.response, userId(req)])).rows[0];
  if (!r) throw notFound();
  await notify(db, [r.user_id], { kind: "asset.request", title: `Your accessory request is ${b.status === "in_progress" ? "being handled" : b.status}`, body: b.response || undefined, link: "/accessories?tab=requests" });
  return r;
}));

// ---------- dashboards: things the old EPM showed on each role's home page ----------
epmRouter.get("/dashboard/extra", h(async (req, db) => {
  const s = await getSettings(db);
  const today = todayIn(s.locale.timezone);
  const uid = userId(req);
  const rq = z.object({ from: date.optional(), to: date.optional() }).parse(req.query);
  const dm = periodBounds(today, "month");
  const month = { start: rq.from ?? dm.start, end: rq.to && rq.to < today ? rq.to : today };
  const week = rq.from ? { start: rq.from, end: month.end } : periodBounds(today, "week", s.locale.weekStartsOn);
  const [me] = await timesheetStats(db, s, month.start, month.end, today, { userIds: [uid] });
  const out: Record<string, unknown> = { me: me ?? null };
  const lead = can(req, "time.approve_team") || can(req, "time.approve_all") || can(req, "reports.view");
  if (lead) {
    const team = await timesheetStats(db, s, week.start, today, today, can(req, "reports.view") || can(req, "time.approve_all") ? {} : { managerId: uid });
    out.teamWeek = {
      people: team.length,
      expected: team.reduce((a, r) => a + r.expected, 0), logged: team.reduce((a, r) => a + r.logged, 0), billable: team.reduce((a, r) => a + r.billable, 0),
      unfilled: team.reduce((a, r) => a + r.unfilled_days.length, 0),
      low: team.filter((r) => r.expected > 0).map((r) => ({ user_id: r.user_id, name: r.name, team_name: r.team_name, fill: r.fill_rate, unfilled: r.unfilled_days.length, utilization: r.utilization }))
        .sort((a, b) => (a.fill ?? 0) - (b.fill ?? 0)).slice(0, 6),
    };
  }
  out.onLeaveToday = (await db.query(
    `SELECT u.id, u.name, lt.name AS leave_type, r.part FROM leave_requests r JOIN users u ON u.id = r.user_id JOIN leave_types lt ON lt.id = r.leave_type_id
     WHERE r.status = 'approved' AND $1 BETWEEN r.start_date AND r.end_date ORDER BY u.name`, [today])).rows;
  out.wfhToday = (await db.query("SELECT u.id, u.name, w.kind FROM wfh_requests w JOIN users u ON u.id = w.user_id WHERE w.status = 'approved' AND w.date = $1 ORDER BY u.name", [today])).rows;
  out.upcoming = (await db.query(
    `SELECT * FROM (
       SELECT 'holiday' AS kind, h.name AS title, h.date AS date FROM holidays h WHERE h.date BETWEEN $1 AND $2
       UNION ALL SELECT e.kind, e.title, e.start_date FROM events e WHERE e.start_date BETWEEN $1 AND $2
       UNION ALL SELECT 'birthday', u.name, make_date(extract(year FROM $1::date)::int, extract(month FROM u.date_of_birth)::int, least(extract(day FROM u.date_of_birth)::int, 28))
         FROM users u WHERE u.status = 'active' AND u.date_of_birth IS NOT NULL
           AND make_date(extract(year FROM $1::date)::int, extract(month FROM u.date_of_birth)::int, least(extract(day FROM u.date_of_birth)::int, 28)) BETWEEN $1 AND $2
     ) x ORDER BY date LIMIT 8`, [today, addDays(today, 30)])).rows;
  out.myProjects = (await db.query(
    `SELECT p.id, p.name, c.name AS client_name, (SELECT coalesce(sum(minutes),0)::int FROM billing_lines bl WHERE bl.project_id = p.id) AS cap_minutes,
       (SELECT coalesce(sum(minutes),0)::int FROM time_entries e WHERE e.project_id = p.id) AS logged_minutes,
       (SELECT coalesce(sum(minutes),0)::int FROM time_entries e WHERE e.project_id = p.id AND e.user_id = $1 AND e.date >= $2) AS my_month_minutes
     FROM projects p JOIN clients c ON c.id = p.client_id JOIN project_members m ON m.project_id = p.id AND m.user_id = $1 WHERE p.status = 'active' ORDER BY my_month_minutes DESC LIMIT 6`,
    [uid, month.start])).rows;
  out.myTasks = (await db.query(
    `SELECT t.id, t.title, t.status, t.priority, t.due_date, p.id AS project_id, p.name AS project_name FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE t.assignee_id = $1 AND t.status <> 'done' ORDER BY t.due_date NULLS LAST, t.created_at DESC LIMIT 8`, [uid])).rows;
  return out;
}));

/**
 * The company hierarchy for the org chart: everyone active, who they report to (their reporting manager, or their team's
 * lead), their roles and team. Everyone can see it, so people know who is under whom.
 */
epmRouter.get("/org-chart", h(async (_req, db) => {
  const people = (await db.query(
    `SELECT u.id, u.name, u.designation, u.employee_code, u.has_photo, u.is_owner, t.id AS team_id, t.name AS team_name, u.department_id, d.name AS department_name, u.reporting_manager_id,
       CASE WHEN u.reporting_manager_id IS NOT NULL THEN u.reporting_manager_id WHEN t.lead_user_id IS DISTINCT FROM u.id THEN coalesce(t.lead_user_id, t.manager_user_id) END AS manager_id,
       coalesce((SELECT array_agg(r.name ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '{}') AS roles,
       coalesce((SELECT array_agg(r.key) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '{}') AS role_keys,
       EXISTS (SELECT 1 FROM teams x WHERE x.lead_user_id = u.id) AS leads_team
     FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.status IN ('active','invited') ORDER BY u.is_owner DESC, u.name`)).rows;
  const ids = new Set(people.map((p: any) => p.id));
  // Break loops and links to people who left, so the chart is always a tree.
  const byId = new Map(people.map((p: any) => [p.id, p]));
  for (const p of people as any[]) {
    if (!p.manager_id || !ids.has(p.manager_id) || p.manager_id === p.id) { p.manager_id = null; continue; }
    let cur = byId.get(p.manager_id) as any, hops = 0;
    while (cur && hops++ < 50) { if (cur.id === p.id) { p.manager_id = null; break; } cur = cur.manager_id ? byId.get(cur.manager_id) : null; }
  }
  return people;
}));
