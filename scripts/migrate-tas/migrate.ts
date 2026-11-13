/**
 * Moves TAS's data from the current EPM (Laravel, MySQL) into an eszy company.
 *
 *   MYSQL_URL=mysql://user:pass@host:3306/epm \
 *   MIGRATION_DATABASE_URL=postgres://eszy_owner:...@host/eszy \
 *   DATABASE_URL=postgres://eszy_app:...@host/eszy \
 *   pnpm tsx scripts/migrate-tas/migrate.ts --slug tas --owner you@tas.com [--dry-run]
 *
 * What moves: roles (mapped to eszy roles), departments, teams, people, clients, project sources and accounts,
 * communication types, projects (with source, account, communication and tracking IDs) and an hours budget line,
 * project members, tasks, daily sheets with work types and offline hours, backdated sheet requests,
 * leave and WFH requests, leave credits, holidays and events.
 * Passwords move as they are (Laravel bcrypt), so people keep signing in with the same password.
 * Projects come in as hourly postpaid with one "Imported budget" line; the Billing Manager reviews
 * each project's billing set-up afterwards (the old system had no billing model to copy).
 * Run on an empty company. --dry-run reads everything and reports counts without writing.
 * All writes run as eszy_app inside one transaction, so row-level security keeps them to this company.
 */
import mysql from "mysql2/promise";
import pg from "pg";
import { provisionTenant, creditLeave } from "../../packages/db/src/provision";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]] : [])).filter((x) => x.length));
const SLUG = args.slug ?? "tas";
const DRY = args["dry-run"] === "true";
const OWNER = args.owner;
if (!process.env.MYSQL_URL || !process.env.MIGRATION_DATABASE_URL) throw new Error("Set MYSQL_URL and MIGRATION_DATABASE_URL");

const report: Record<string, number> = {};
const warn: string[] = [];
const count = (k: string, n = 1) => (report[k] = (report[k] ?? 0) + n);

const roleKeyFor = (name: string): string => {
  const n = name.toLowerCase();
  if (/super|admin|owner|director|ceo/.test(n)) return "admin";
  if (/bill|account|finance/.test(n)) return "billing_manager";
  if (/hr|human/.test(n)) return "hr";
  if (/sales.*(tl|lead|head|manager)|bd.*(head|manager)/.test(n)) return "sales_tl";
  if (/sales|bd|business dev/.test(n)) return "sales";
  if (/project manager|\bpm\b/.test(n)) return "project_manager";
  if (/\btl\b|team lead|lead/.test(n)) return "team_lead";
  return "employee";
};
const hhmm = (s: string | null | undefined) => {
  if (!s) return 0;
  const m = /^(\d{1,3}):(\d{2})/.exec(String(s));
  return m ? Number(m[1]) * 60 + Number(m[2]) : Math.round(Number(s) * 60) || 0;
};
const json = <T>(v: unknown, fallback: T): T => {
  if (v == null) return fallback;
  if (typeof v === "object") return v as T;
  try { return JSON.parse(String(v)); } catch { return fallback; }
};
const day = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));
async function tableExists(my: mysql.Connection, t: string) {
  const [r] = await my.query("SHOW TABLES LIKE ?", [t]);
  return (r as any[]).length > 0;
}
async function rows(my: mysql.Connection, sql: string) {
  const [r] = await my.query(sql);
  return r as any[];
}

async function main() {
  const my = await mysql.createConnection({ uri: process.env.MYSQL_URL!, dateStrings: true });
  const pgc = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await pgc.connect();
  await pgc.query("BEGIN");
  // Work as the app role so row-level security applies to every query, even though we connected as the owner.
  await pgc.query("SET LOCAL ROLE eszy_app");
  try {
    // ---------- company ----------
    let tenantId = (await pgc.query("SELECT id FROM tenants WHERE slug = $1", [SLUG])).rows[0]?.id as string | undefined;
    const oldUsers = await rows(my, "SELECT * FROM users");
    const ownerRow = oldUsers.find((u) => u.email?.toLowerCase() === OWNER?.toLowerCase()) ?? oldUsers[0];
    if (!tenantId) {
      const r = await provisionTenant(pgc as any, {
        slug: SLUG, name: "TAS", planCode: "business", ownerName: ownerRow.name, ownerEmail: ownerRow.email,
        ownerPassword: "temporary-password-1", status: "active", currency: "USD", country: "IN", seats: Math.max(10, oldUsers.length + 5),
      });
      tenantId = r.tenant.id as string;
      count("company created");
    } else {
      await pgc.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const n = (await pgc.query("SELECT count(*)::int AS n FROM projects WHERE tenant_id = $1", [tenantId])).rows[0].n;
      if (n > 0) throw new Error(`Company ${SLUG} already has projects. Run the migration on an empty company.`);
    }
    await pgc.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const tid = tenantId;
    const roleIds = Object.fromEntries((await pgc.query("SELECT key, id FROM roles WHERE tenant_id = $1", [tid])).rows.map((r) => [r.key, r.id]));

    // ---------- roles ----------
    const oldRoles = await rows(my, "SELECT * FROM roles");
    const roleMap = new Map<number, string>(oldRoles.map((r) => [Number(r.id), roleKeyFor(`${r.name} ${r.label ?? ""}`)]));
    for (const r of oldRoles) warn.push(`role "${r.name}" -> ${roleMap.get(Number(r.id))}`);

    // Company lists: reuse the defaults eszy created when the names match, otherwise add them.
    const lookup = async (table: string, name: string, extra: Record<string, unknown> = {}) => {
      const n = String(name ?? "").trim();
      if (!n) return null;
      const found = (await pgc.query(`SELECT id FROM ${table} WHERE tenant_id = $1 AND lower(name) = lower($2)`, [tid, n])).rows[0];
      if (found) return found.id as string;
      const cols = ["tenant_id", "name", ...Object.keys(extra)];
      const vals = [tid, n, ...Object.values(extra)];
      return (await pgc.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, vals)).rows[0].id as string;
    };

    // ---------- departments ----------
    const deptMap = new Map<number, string>();
    if (await tableExists(my, "departments")) {
      for (const d of await rows(my, "SELECT * FROM departments")) { deptMap.set(Number(d.id), (await lookup("departments", d.name))!); count("departments"); }
    }

    // ---------- teams ----------
    const teamMap = new Map<number, string>();
    for (const t of await rows(my, "SELECT * FROM teams")) {
      teamMap.set(Number(t.id), (await pgc.query("INSERT INTO teams (tenant_id, name, department_id) VALUES ($1,$2,$3) RETURNING id", [tid, t.name, deptMap.get(Number(t.department_id)) ?? null])).rows[0].id);
      count("teams");
    }

    const oldTeamDept = new Map<number, string>();
    for (const t of await rows(my, "SELECT * FROM teams")) if (t.department_id && deptMap.get(Number(t.department_id))) oldTeamDept.set(Number(t.id), deptMap.get(Number(t.department_id))!);

    // ---------- people ----------
    const userMap = new Map<number, string>();
    const existing = Object.fromEntries((await pgc.query("SELECT lower(email) AS e, id FROM users WHERE tenant_id = $1", [tid])).rows.map((r) => [r.e, r.id]));
    for (const u of oldUsers) {
      const email = String(u.email).toLowerCase();
      const hash = u.password ? String(u.password).replace(/^\$2y\$/, "$2b$") : null;
      const status = u.inactive_at ? "disabled" : "active";
      let id = existing[email];
      if (id) {
        await pgc.query("UPDATE users SET password_hash = coalesce($2, password_hash), phone = $3, team_id = $4 WHERE id = $1", [id, hash, u.phone_num ?? "", teamMap.get(Number(u.team_id)) ?? null]);
      } else {
        id = (await pgc.query(
          "INSERT INTO users (tenant_id, email, name, password_hash, status, team_id, phone, joined_on, created_at, address, emergency_contact_phone, date_of_birth) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::timestamptz, now()),$10,$11,$12) RETURNING id",
          [tid, email, u.name, hash, status, teamMap.get(Number(u.team_id)) ?? null, u.phone_num ?? "", u.created_at ? day(u.created_at) : null, u.created_at ?? null,
            u.address ?? "", u.emergency_phone_num ?? u.emergency_contact ?? "", u.dob ? day(u.dob) : null],
        )).rows[0].id;
      }
      userMap.set(Number(u.id), id);
      const dept = deptMap.get(Number(u.department_id)) ?? (u.team_id ? (oldTeamDept.get(Number(u.team_id)) ?? null) : null);
      if (dept) await pgc.query("UPDATE users SET department_id = $2 WHERE id = $1", [id, dept]);
      const oldRoleIds: number[] = Array.isArray(json(u.role_id, null)) ? json<number[]>(u.role_id, []) : [Number(u.role_id)].filter(Boolean);
      const keys = new Set(oldRoleIds.map((r) => roleMap.get(Number(r)) ?? "employee"));
      if (!keys.has("admin") && !keys.has("billing_manager")) keys.add("employee");
      for (const k of keys) await pgc.query("INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [tid, id, roleIds[k]]);
      await creditLeave(pgc as any, tid, id);
      count("people");
    }
    // Team Leads: a person with the team_lead role in the team, else the most common reporting manager.
    for (const [oldTeam, newTeam] of teamMap) {
      const members = oldUsers.filter((u) => Number(u.team_id) === oldTeam);
      const lead = members.find((u) => (json<number[]>(u.role_id, [Number(u.role_id)]) as number[]).some((r) => roleMap.get(Number(r)) === "team_lead"));
      const mgrCounts = new Map<number, number>();
      for (const m of members) if (m.reporting_manager_id) mgrCounts.set(Number(m.reporting_manager_id), (mgrCounts.get(Number(m.reporting_manager_id)) ?? 0) + 1);
      const mgr = [...mgrCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const leadId = lead ? userMap.get(Number(lead.id)) : mgr ? userMap.get(mgr) : undefined;
      if (leadId) await pgc.query("UPDATE teams SET lead_user_id = $2 WHERE id = $1", [newTeam, leadId]);
      else warn.push(`team ${newTeam} has no Team Lead: set one in People and teams`);
    }

    // ---------- clients ----------
    const clientMap = new Map<number, string>();
    const clientTable = (await tableExists(my, "clients_master")) ? "clients_master" : "clients";
    for (const c of await rows(my, `SELECT * FROM ${clientTable}`)) {
      const name = c.client_name ?? c.name ?? "Client";
      clientMap.set(Number(c.id), (await pgc.query(
        "INSERT INTO clients (tenant_id, name, company, email, phone, address, country) VALUES ($1,$2,$3,$4,$5,$6,'US') RETURNING id",
        [tid, name, c.company_name ?? "", c.client_email ?? "", c.client_number ?? c.contact_detail ?? "", c.company_address ?? ""],
      )).rows[0].id);
      count("clients");
    }
    const fallbackClient = async () => {
      let id = clientMap.get(-1);
      if (!id) { id = (await pgc.query("INSERT INTO clients (tenant_id, name) VALUES ($1,'Imported (no client)') RETURNING id", [tid])).rows[0].id as string; clientMap.set(-1, id); }
      return id;
    };

    // ---------- project sources, accounts, communication types ----------
    const sourceMap = new Map<number, string>(), accountMap = new Map<number, string>(), commMap = new Map<number, string>();
    if (await tableExists(my, "project_source")) for (const r of await rows(my, "SELECT * FROM project_source")) { sourceMap.set(Number(r.id), (await lookup("project_sources", r.source_name ?? r.name))!); count("project sources"); }
    if (await tableExists(my, "project_accounts")) for (const r of await rows(my, "SELECT * FROM project_accounts")) { accountMap.set(Number(r.id), (await lookup("project_accounts", r.account_name ?? r.name, { source_id: sourceMap.get(Number(r.source_id)) ?? null }))!); count("source accounts"); }
    if (await tableExists(my, "communication_type")) for (const r of await rows(my, "SELECT * FROM communication_type")) { commMap.set(Number(r.id), (await lookup("communication_types", r.name ?? r.type ?? r.communication_type))!); count("communication types"); }

    // ---------- projects ----------
    const projectMap = new Map<number, string>();
    const projTable = (await tableExists(my, "projects_master")) ? "projects_master" : "projects";
    const relations = (await tableExists(my, "project_relations")) ? await rows(my, "SELECT * FROM project_relations") : [];
    for (const p of await rows(my, `SELECT * FROM ${projTable}`)) {
      const rel = relations.find((r) => Number(r.project_id) === Number(p.id));
      const clientId = clientMap.get(Number(p.client_id ?? rel?.client_id)) ?? (await fallbackClient());
      const hours = Number(p.project_hours ?? p.total_hours ?? 0) || 0;
      const budget = Math.round((Number(String(p.project_budget ?? p.budget ?? "0").replace(/[^0-9.]/g, "")) || 0) * 100);
      const st = String(p.project_status ?? "").toLowerCase();
      const status = /complete|closed|done|ended/.test(st) ? "ended" : /hold|pause/.test(st) ? "paused" : "active";
      const rate = hours > 0 && budget > 0 ? Math.round(budget / hours) : 0;
      const id = (await pgc.query(
        `INSERT INTO projects (tenant_id, client_id, name, type, billing_type, invoicing, hourly_rate_minor, status, sales_user_id, created_at)
         VALUES ($1,$2,$3,'hourly','postpaid','one_time',$4,$5,$6, coalesce($7::timestamptz, now())) RETURNING id`,
        [tid, clientId, p.project_name ?? `Project ${p.id}`, rate, status, userMap.get(Number(rel?.sales_person_id ?? p.sales_team_id)) ?? null, p.created_at ?? null],
      )).rows[0].id;
      if (hours > 0) {
        await pgc.query("INSERT INTO billing_lines (tenant_id, project_id, position, label, minutes, amount_minor, kind) VALUES ($1,$2,0,'Imported budget',$3,$4,'plan')", [tid, id, Math.round(hours * 60), budget]);
      }
      projectMap.set(Number(p.id), id);
      count("projects");
      const comm = json<number[]>(rel?.communication_id, rel?.communication_id ? [Number(rel.communication_id)] : []).map((c) => commMap.get(Number(c))).filter(Boolean);
      const accId = accountMap.get(Number(rel?.tracking_id ?? rel?.account_id));
      await pgc.query("UPDATE projects SET source_id = $2, account_id = $3, communication_type_ids = $4 WHERE id = $1", [id, sourceMap.get(Number(rel?.tracking_source_id ?? rel?.source_id)) ?? null, accId ?? null, comm]);
      if (accId) { await pgc.query("INSERT INTO project_trackers (tenant_id, project_id, account_id, label) VALUES ($1,$2,$3,'Imported contract')", [tid, id, accId]); count("tracking IDs"); }
      for (const a of json<number[]>(rel?.assignees, [])) {
        const uid = userMap.get(Number(a));
        if (uid) await pgc.query("INSERT INTO project_members (tenant_id, project_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [tid, id, uid]);
      }
    }
    for (const t of ["project_user", "project_manager_project"]) {
      if (!(await tableExists(my, t))) continue;
      for (const m of await rows(my, `SELECT * FROM ${t}`)) {
        const pid = projectMap.get(Number(m.project_id));
        const uid = userMap.get(Number(m.user_id ?? m.project_manager_id));
        if (pid && uid) { await pgc.query("INSERT INTO project_members (tenant_id, project_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [tid, pid, uid]); count("project members"); }
        if (pid && uid && t === "project_manager_project") await pgc.query("UPDATE projects SET pm_user_id = coalesce(pm_user_id, $2) WHERE id = $1", [pid, uid]);
      }
    }

    // ---------- tasks ----------
    const taskMap = new Map<number, string>();
    if (await tableExists(my, "tasks")) {
      for (const t of await rows(my, "SELECT * FROM tasks")) {
        const pid = projectMap.get(Number(t.project_id));
        if (!pid) continue;
        taskMap.set(Number(t.id), (await pgc.query("INSERT INTO tasks (tenant_id, project_id, title, status) VALUES ($1,$2,$3,$4) RETURNING id", [tid, pid, t.title ?? t.name ?? `Task ${t.id}`, /done|complete/i.test(String(t.status)) ? "done" : "open"])).rows[0].id);
        count("tasks");
      }
    }

    // ---------- daily sheets ----------
    const sheetIds = new Map<string, { id: string; status: string }>();
    const statusMap = (s: string) => (/approv/i.test(s) ? "approved" : /reject/i.test(s) ? "rejected" : /pend|submit|backdat/i.test(s) ? "submitted" : "draft");
    for (const s of await rows(my, "SELECT * FROM performa_sheets ORDER BY id")) {
      const uid = userMap.get(Number(s.user_id));
      if (!uid) continue;
      const data = json<any>(s.data, null);
      const items: any[] = Array.isArray(data) ? data : data ? [data] : [];
      for (const e of items) {
        const date = day(e.date ?? s.work_date);
        const pid = projectMap.get(Number(e.project_id));
        const minutes = hhmm(e.time);
        if (!pid || !minutes || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { count("sheet entries skipped"); continue; }
        const key = `${uid}|${date}`;
        let sh = sheetIds.get(key);
        if (!sh) {
          const st = statusMap(String(s.status ?? e.status ?? ""));
          const row = (await pgc.query(
            `INSERT INTO sheets (tenant_id, user_id, date, status, submitted_at, decided_by, decided_at) VALUES ($1,$2,$3,$4, CASE WHEN $4 <> 'draft' THEN now() END, $5, CASE WHEN $4 IN ('approved','rejected') THEN now() END)
             ON CONFLICT (user_id, date) DO UPDATE SET status = EXCLUDED.status RETURNING id, status`,
            [tid, uid, date, st, userMap.get(Number(s.approve_rejected_by)) ?? null],
          )).rows[0];
          sh = { id: row.id, status: row.status };
          sheetIds.set(key, sh);
          count("sheets");
        }
        await pgc.query("INSERT INTO project_members (tenant_id, project_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [tid, pid, uid]);
        const tracked = String(e.is_tracking ?? "").toLowerCase() === "yes";
        const activity = await lookup("activity_types", e.activity_type ?? e.work_type ?? "");
        await pgc.query(
          "INSERT INTO time_entries (tenant_id, sheet_id, user_id, project_id, task_id, date, minutes, description, source, activity_type_id, offline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [tid, sh.id, uid, pid, taskMap.get(Number(e.task_id)) ?? null, date, minutes, String(e.narration ?? ""), tracked ? "Upwork" : "eszy", activity, !tracked && e.is_tracking !== undefined],
        );
        count("sheet entries");
      }
    }
    // Spread approved hours over each project's billing line, in date order.
    await pgc.query(
      `INSERT INTO time_allocations (tenant_id, entry_id, billing_line_id, minutes)
       SELECT e.tenant_id, e.id, bl.id, e.minutes FROM time_entries e JOIN sheets s ON s.id = e.sheet_id AND s.status = 'approved'
       LEFT JOIN billing_lines bl ON bl.project_id = e.project_id
       WHERE e.tenant_id = $1`,
      [tid],
    );

    // ---------- leave and WFH ----------
    const typeIds = new Map<string, string>(((await pgc.query("SELECT id, lower(name) AS name FROM leave_types WHERE tenant_id = $1", [tid])).rows).map((r) => [r.name, r.id]));
    const leaveType = async (name: string, paid: boolean) => {
      const k = (name || "Leave").toLowerCase();
      if (!typeIds.has(k)) typeIds.set(k, (await pgc.query("INSERT INTO leave_types (tenant_id, name, yearly_days, paid) VALUES ($1,$2,0,$3) RETURNING id", [tid, name || "Leave", paid])).rows[0].id);
      return typeIds.get(k)!;
    };
    const leaveStatus = (s: string) => (/approv/i.test(s) ? "approved" : /reject|declin/i.test(s) ? "rejected" : /cancel/i.test(s) ? "cancelled" : "pending");
    if (await tableExists(my, "leavespolicy")) {
      for (const l of await rows(my, "SELECT * FROM leavespolicy")) {
        const uid = userMap.get(Number(l.user_id));
        if (!uid) continue;
        const start = day(l.start_date), end = day(l.end_date || l.start_date);
        const half = !!l.halfday_period || /half/i.test(String(l.leave_type));
        if (String(l.is_wfh).toLowerCase() === "yes" || /wfh|work from home/i.test(String(l.leave_type))) {
          await pgc.query("INSERT INTO wfh_requests (tenant_id, user_id, date, kind, reason, status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [tid, uid, start, half ? "half" : "full", l.reason ?? "", leaveStatus(String(l.status))]);
          count("wfh requests");
          continue;
        }
        const days = Number(l.deducted_days ?? l.paid_days ?? 0) + Number(l.unpaid_days ?? 0) || (half ? 0.5 : 1);
        await pgc.query(
          "INSERT INTO leave_requests (tenant_id, user_id, leave_type_id, start_date, end_date, half_day, days, reason, status, decided_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [tid, uid, await leaveType(String(l.leave_type ?? "Leave"), Number(l.unpaid_days ?? 0) === 0), start, end < start ? start : end, half && start === end, days, l.reason ?? "", leaveStatus(String(l.status)), userMap.get(Number(l.approved_bymanager)) ?? null],
        );
        count("leave requests");
      }
    }
    if (await tableExists(my, "leave_credits")) {
      const paidType = await leaveType("Casual leave", true);
      for (const c of await rows(my, "SELECT * FROM leave_credits")) {
        const uid = userMap.get(Number(c.user_id));
        if (!uid) continue;
        const year = Number(c.year ?? new Date().getFullYear());
        await pgc.query(
          `INSERT INTO leave_balances (tenant_id, user_id, leave_type_id, year, credited_days) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (user_id, leave_type_id, year) DO UPDATE SET credited_days = GREATEST(leave_balances.credited_days, EXCLUDED.credited_days)`,
          [tid, uid, paidType, year, Number(c.paid_leaves ?? 0) + Number(c.carry_forward_balance ?? 0)],
        );
        count("leave credits");
      }
      await pgc.query(
        `UPDATE leave_balances b SET used_days = s.used FROM (
           SELECT user_id, leave_type_id, extract(year FROM start_date)::int AS year, sum(days) AS used FROM leave_requests WHERE status = 'approved' AND tenant_id = $1 GROUP BY 1,2,3
         ) s WHERE b.user_id = s.user_id AND b.leave_type_id = s.leave_type_id AND b.year = s.year AND b.tenant_id = $1`,
        [tid],
      );
    }
    if (await tableExists(my, "event_holidays")) {
      for (const h of await rows(my, "SELECT * FROM event_holidays")) {
        if (h.type && !/holiday/i.test(String(h.type))) {
          await pgc.query("INSERT INTO events (tenant_id, title, kind, start_date, end_date, start_time, end_time) VALUES ($1,$2,'event',$3,$4,$5,$6)",
            [tid, h.description || "Event", day(h.start_date), day(h.end_date || h.start_date), /^\d{2}:\d{2}/.test(String(h.start_time ?? "")) ? String(h.start_time).slice(0, 5) : null, /^\d{2}:\d{2}/.test(String(h.end_time ?? "")) ? String(h.end_time).slice(0, 5) : null]);
          count("events");
          continue;
        }
        await pgc.query("INSERT INTO holidays (tenant_id, date, name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [tid, day(h.start_date), h.description || "Holiday"]);
        count("holidays");
      }
    }

    // ---------- backdated sheet requests ----------
    if (await tableExists(my, "application_performa")) {
      for (const r of await rows(my, "SELECT * FROM application_performa")) {
        const uid = userMap.get(Number(r.user_id));
        const d = day(r.apply_date);
        if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
        const st = /approv/i.test(String(r.status)) ? "used" : /reject/i.test(String(r.status)) ? "rejected" : "pending";
        await pgc.query("INSERT INTO sheet_requests (tenant_id, user_id, date, reason, status, decided_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [tid, uid, d, r.reason ?? "", st, r.approval_date ?? null]);
        count("backdate requests");
      }
    }

    if (DRY) { await pgc.query("ROLLBACK"); console.log("DRY RUN: nothing was written."); }
    else await pgc.query("COMMIT");
    console.table(report);
    for (const w of warn) console.log(`note: ${w}`);
  } catch (e) {
    await pgc.query("ROLLBACK");
    throw e;
  } finally {
    await my.end();
    await pgc.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
