import { Router, raw } from "express";
import { z } from "zod";
import { can, h, userId } from "../lib/context";
import { requirePerm } from "../lib/auth";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { audit, auditChange, notify, snapshot } from "../lib/audit";
import { getSettings } from "../lib/settings";
import { addDays, periodBounds, todayIn } from "../lib/dates";
import { approverFor } from "../services/time";
import { ALERT_EVENTS } from "../lib/alerts";

/** Features carried over from the current EPM: departments, lists, project notes and activity, standups, calendar, accessories, profiles, charts. */
export const workspaceRouter = Router();
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------- departments ----------
workspaceRouter.get("/departments", h(async (_req, db) => (await db.query(
  `SELECT d.*, hd.name AS head_name, (SELECT count(*)::int FROM users u WHERE u.department_id = d.id AND u.status <> 'disabled') AS people,
     (SELECT count(*)::int FROM teams t WHERE t.department_id = d.id) AS teams
   FROM departments d LEFT JOIN users hd ON hd.id = d.head_user_id ORDER BY d.name`)).rows));
const deptSchema = z.object({ name: z.string().min(1), headUserId: uuid.nullable().optional() });
workspaceRouter.post("/departments", requirePerm("teams.manage"), h(async (req, db) => {
  const b = deptSchema.parse(req.body);
  const d = (await db.query("INSERT INTO departments (tenant_id, name, head_user_id) VALUES ($1,$2,$3) RETURNING *", [req.tenant!.id, b.name, b.headUserId ?? null])).rows[0];
  await audit(db, req, "department.create", "department", d.id, b);
  return d;
}));
workspaceRouter.put("/departments/:id", requirePerm("teams.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const b = deptSchema.partial().parse(req.body);
  const before = await snapshot(db, "departments", id);
  await db.query("UPDATE departments SET name = coalesce($2,name), head_user_id = CASE WHEN $3 THEN $4::uuid ELSE head_user_id END WHERE id = $1", [id, b.name ?? null, b.headUserId !== undefined, b.headUserId ?? null]);
  await auditChange(db, req, "department.update", "departments", id, before);
  return { ok: true };
}));
workspaceRouter.delete("/departments/:id", requirePerm("teams.manage"), h(async (req, db) => {
  await db.query("DELETE FROM departments WHERE id = $1", [uuid.parse(req.params.id)]);
  return { ok: true };
}));

// ---------- company lists: communication types, project sources, accounts, work types ----------
const LISTS: Record<string, { table: string; extra?: string[] }> = {
  "communication-types": { table: "communication_types" },
  "project-sources": { table: "project_sources" },
  "activity-types": { table: "activity_types" },
  "project-accounts": { table: "project_accounts", extra: ["source_id", "profile_url"] },
  "project-stages": { table: "project_stages" },
};
workspaceRouter.get("/lists/:list", h(async (req, db) => {
  const l = LISTS[String(req.params.list)];
  if (!l) throw notFound();
  if (l.table === "project_accounts") {
    return (await db.query(`SELECT a.*, s.name AS source_name, (SELECT count(*)::int FROM projects p WHERE p.account_id = a.id) AS project_count,
      (SELECT count(*)::int FROM clients c WHERE c.account_id = a.id) AS client_count FROM project_accounts a LEFT JOIN project_sources s ON s.id = a.source_id ORDER BY a.active DESC, a.name`)).rows;
  }
  if (l.table === "project_sources") {
    return (await db.query(`SELECT s.*, (SELECT count(*)::int FROM projects p WHERE p.source_id = s.id) AS project_count, (SELECT count(*)::int FROM clients c WHERE c.source_id = s.id) AS client_count,
      (SELECT count(*)::int FROM project_accounts a WHERE a.source_id = s.id) AS account_count FROM project_sources s ORDER BY s.active DESC, s.name`)).rows;
  }
  if (l.table === "activity_types") {
    return (await db.query(`SELECT a.*, (SELECT coalesce(sum(minutes),0)::int FROM time_entries e WHERE e.activity_type_id = a.id) AS logged_minutes FROM activity_types a ORDER BY a.active DESC, a.name`)).rows;
  }
  if (l.table === "project_stages") {
    return (await db.query("SELECT s.*, (SELECT count(*)::int FROM projects p WHERE p.stage_id = s.id) AS project_count FROM project_stages s ORDER BY s.active DESC, s.position, s.name")).rows;
  }
  return (await db.query(`SELECT * FROM ${l.table} ORDER BY active DESC, name`)).rows;
}));
const listSchema = z.object({
  name: z.string().trim().min(1).max(120), active: z.boolean().optional(), sourceId: uuid.nullable().optional(), profileUrl: z.string().optional(),
  category: z.enum(["billable", "inhouse", "no_work"]).optional(), position: z.number().int().optional(), isDone: z.boolean().optional(),
});
/** Adds an item. Anyone who sets up clients or projects can add sources, accounts and channels straight from a picker; adding the same name again returns the existing one. */
workspaceRouter.post("/lists/:list", h(async (req, db) => {
  const l = LISTS[String(req.params.list)];
  if (!l) throw notFound();
  const inline = ["project_sources", "project_accounts", "communication_types"].includes(l.table);
  if (!can(req, "masters.manage") && !can(req, "settings.manage") && !can(req, "projects.manage") && !(inline && can(req, "clients.manage"))) throw forbidden();
  const b = listSchema.parse(req.body);
  if (l.table !== "project_accounts") {
    const same = (await db.query(`SELECT * FROM ${l.table} WHERE lower(name) = lower($1)`, [b.name])).rows[0];
    if (same) { if (!same.active) await db.query(`UPDATE ${l.table} SET active = true WHERE id = $1`, [same.id]); return { ...same, active: true }; }
  }
  if (l.table === "project_stages") {
    const pos = b.position ?? (await db.query("SELECT coalesce(max(position),0)+1 AS n FROM project_stages")).rows[0].n;
    return (await db.query("INSERT INTO project_stages (tenant_id, name, position, is_done) VALUES ($1,$2,$3,$4) RETURNING *", [req.tenant!.id, b.name, pos, b.isDone ?? false])).rows[0];
  }
  if (l.table === "project_accounts") {
    return (await db.query("INSERT INTO project_accounts (tenant_id, name, source_id, profile_url) VALUES ($1,$2,$3,$4) RETURNING *", [req.tenant!.id, b.name, b.sourceId ?? null, b.profileUrl ?? ""])).rows[0];
  }
  if (l.table === "activity_types") return (await db.query("INSERT INTO activity_types (tenant_id, name, category) VALUES ($1,$2,$3) RETURNING *", [req.tenant!.id, b.name, b.category ?? "billable"])).rows[0];
  return (await db.query(`INSERT INTO ${l.table} (tenant_id, name) VALUES ($1,$2) RETURNING *`, [req.tenant!.id, b.name])).rows[0];
}));
workspaceRouter.put("/lists/:list/:id", requirePerm("masters.manage", "settings.manage", "projects.manage"), h(async (req, db) => {
  const l = LISTS[String(req.params.list)];
  if (!l) throw notFound();
  const b = listSchema.partial().parse(req.body);
  const id = uuid.parse(req.params.id);
  await db.query(`UPDATE ${l.table} SET name = coalesce($2,name), active = coalesce($3,active) WHERE id = $1`, [id, b.name ?? null, b.active ?? null]);
  if (l.table === "activity_types" && b.category) await db.query("UPDATE activity_types SET category = $2 WHERE id = $1", [id, b.category]);
  if (l.table === "project_stages") await db.query("UPDATE project_stages SET position = coalesce($2, position), is_done = coalesce($3, is_done) WHERE id = $1", [id, b.position ?? null, b.isDone ?? null]);
  if (l.table === "project_accounts") await db.query("UPDATE project_accounts SET source_id = CASE WHEN $2 THEN $3::uuid ELSE source_id END, profile_url = coalesce($4, profile_url) WHERE id = $1", [id, b.sourceId !== undefined, b.sourceId ?? null, b.profileUrl ?? null]);
  return { ok: true };
}));

// ---------- tracking IDs on a project (e.g. Upwork contracts) ----------
async function projectVisible(req: any, db: any, projectId: string) {
  const p = (await db.query(
    `SELECT p.* FROM projects p WHERE p.id = $1 AND ($2 OR p.pm_user_id = $3 OR p.sales_user_id = $3 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $3))`,
    [projectId, can(req, "projects.view_all"), userId(req)],
  )).rows[0];
  if (!p) throw notFound("Project not found");
  return p;
}
workspaceRouter.get("/projects/:id/trackers", h(async (req, db) => {
  const p = await projectVisible(req, db, uuid.parse(req.params.id));
  return (await db.query("SELECT t.*, a.name AS account_name FROM project_trackers t LEFT JOIN project_accounts a ON a.id = t.account_id WHERE t.project_id = $1 ORDER BY t.active DESC, t.label", [p.id])).rows;
}));
const trackerSchema = z.object({ label: z.string().min(1), externalId: z.string().default(""), accountId: uuid.nullable().optional(), active: z.boolean().optional() });
workspaceRouter.post("/projects/:id/trackers", requirePerm("projects.manage", "projects.billing"), h(async (req, db) => {
  const p = await projectVisible(req, db, uuid.parse(req.params.id));
  const b = trackerSchema.parse(req.body);
  return (await db.query("INSERT INTO project_trackers (tenant_id, project_id, account_id, label, external_id) VALUES ($1,$2,$3,$4,$5) RETURNING *", [req.tenant!.id, p.id, b.accountId ?? p.account_id ?? null, b.label, b.externalId])).rows[0];
}));
workspaceRouter.put("/trackers/:id", requirePerm("projects.manage", "projects.billing"), h(async (req, db) => {
  const b = trackerSchema.partial().parse(req.body);
  await db.query("UPDATE project_trackers SET label = coalesce($2,label), external_id = coalesce($3,external_id), active = coalesce($4,active) WHERE id = $1", [uuid.parse(req.params.id), b.label ?? null, b.externalId ?? null, b.active ?? null]);
  return { ok: true };
}));

// ---------- project notes, comments and activity feed ----------
workspaceRouter.get("/projects/:id/notes", h(async (req, db) => {
  const p = await projectVisible(req, db, uuid.parse(req.params.id));
  return (await db.query("SELECT n.*, u.name AS author FROM project_notes n LEFT JOIN users u ON u.id = n.created_by WHERE n.project_id = $1 ORDER BY n.pinned DESC, n.updated_at DESC", [p.id])).rows;
}));
const noteSchema = z.object({ title: z.string().min(1), body: z.string().default(""), pinned: z.boolean().default(false) });
workspaceRouter.post("/projects/:id/notes", h(async (req, db) => {
  const p = await projectVisible(req, db, uuid.parse(req.params.id));
  const b = noteSchema.parse(req.body);
  const n = (await db.query("INSERT INTO project_notes (tenant_id, project_id, title, body, pinned, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [req.tenant!.id, p.id, b.title, b.body, b.pinned, userId(req)])).rows[0];
  await audit(db, req, "note.create", "project", p.id, { title: b.title });
  return n;
}));
workspaceRouter.put("/notes/:id", h(async (req, db) => {
  const n = (await db.query("SELECT * FROM project_notes WHERE id = $1", [uuid.parse(req.params.id)])).rows[0];
  if (!n) throw notFound();
  if (n.created_by !== userId(req) && !can(req, "projects.manage")) throw forbidden();
  const b = noteSchema.partial().parse(req.body);
  await db.query("UPDATE project_notes SET title = coalesce($2,title), body = coalesce($3,body), pinned = coalesce($4,pinned), updated_at = now() WHERE id = $1", [n.id, b.title ?? null, b.body ?? null, b.pinned ?? null]);
  return { ok: true };
}));
workspaceRouter.delete("/notes/:id", h(async (req, db) => {
  const n = (await db.query("SELECT * FROM project_notes WHERE id = $1", [uuid.parse(req.params.id)])).rows[0];
  if (!n) throw notFound();
  if (n.created_by !== userId(req) && !can(req, "projects.manage")) throw forbidden();
  await db.query("DELETE FROM project_notes WHERE id = $1", [n.id]);
  return { ok: true };
}));

/** Comments on a project or one of its tasks. Mention someone with @Name to notify them. */
workspaceRouter.post("/projects/:id/comments", h(async (req, db) => {
  const p = await projectVisible(req, db, uuid.parse(req.params.id));
  const b = z.object({ body: z.string().min(1).max(5000), taskId: uuid.nullable().optional() }).parse(req.body);
  const c = (await db.query("INSERT INTO comments (tenant_id, project_id, task_id, body, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *", [req.tenant!.id, p.id, b.taskId ?? null, b.body, userId(req)])).rows[0];
  const members = (await db.query("SELECT u.id, u.name FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1", [p.id])).rows;
  const mentioned = members.filter((m) => b.body.toLowerCase().includes(`@${m.name.toLowerCase()}`)).map((m) => m.id);
  await notify(db, mentioned.filter((x) => x !== userId(req)), { kind: "comment.mention", title: `${req.user!.name} mentioned you on ${p.name}`, body: b.body.slice(0, 200), link: `/projects/${p.id}?tab=activity` });
  return c;
}));
workspaceRouter.delete("/comments/:id", h(async (req, db) => {
  const c = (await db.query("SELECT * FROM comments WHERE id = $1", [uuid.parse(req.params.id)])).rows[0];
  if (!c) throw notFound();
  if (c.created_by !== userId(req) && !can(req, "projects.manage")) throw forbidden();
  await db.query("DELETE FROM comments WHERE id = $1", [c.id]);
  return { ok: true };
}));

/**
 * One timeline for the project: sheets submitted with hours on it (and who approved or sent them back), task and team changes,
 * comments, status and billing changes, and invoices (money only for those who can see it).
 * ?taskId= narrows it to one task: its sheet entries with what the person wrote, its comments and its changes.
 */
workspaceRouter.get("/projects/:id/activity", h(async (req, db) => {
  const p = await projectVisible(req, db, uuid.parse(req.params.id));
  const money = can(req, "money.view");
  const q = z.object({ taskId: uuid.optional(), kind: z.enum(["all", "sheets", "comments", "changes"]).optional(), limit: z.coerce.number().int().min(10).max(500).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), userId: uuid.optional() }).parse(req.query);
  const limit = q.limit ?? 200;
  // Date and person filters, applied to each source. $4 = from, $5 = to, $6 = person.
  const extra = [q.from ?? null, q.to ?? null, q.userId ?? null];
  const when = (col: string) => `($4::date IS NULL OR (${col})::date >= $4::date) AND ($5::date IS NULL OR (${col})::date <= $5::date)`;
  const want = (k: string) => !q.kind || q.kind === "all" || q.kind === k;
  const comments = want("comments") ? (await db.query(
    `SELECT c.id, 'comment' AS kind, c.body, c.created_at AS at, u.name AS who, c.created_by, c.task_id, t.title AS task FROM comments c LEFT JOIN users u ON u.id = c.created_by LEFT JOIN tasks t ON t.id = c.task_id
     WHERE c.project_id = $1 AND ($2::uuid IS NULL OR c.task_id = $2) AND ${when("c.created_at")} AND ($6::uuid IS NULL OR c.created_by = $6)
     ORDER BY c.created_at DESC LIMIT $3`, [p.id, q.taskId ?? null, limit, ...extra],
  )).rows : [];
  const events = want("changes") ? (await db.query(
    `SELECT a.id::text, 'change' AS kind, a.action, a.data, a.at, u.name AS who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE ((a.entity = 'project' AND a.entity_id = $1) OR a.data->>'projectId' = $1::text OR (a.entity IN ('invoice') AND a.entity_id IN (SELECT id::text FROM invoices WHERE project_id = $1::uuid)))
       AND ($2::text IS NULL OR a.data->>'taskId' = $2) AND ${when("a.at")} AND ($6::uuid IS NULL OR a.user_id = $6)
       AND a.action NOT IN ('project.comments', 'comment.create')  -- comments are listed on their own
     ORDER BY a.at DESC LIMIT $3`, [p.id, q.taskId ?? null, limit, ...extra],
  )).rows.filter((e) => money || !/^(invoice|payment|billing_line|extra_hours)/.test(e.action))
    .map((e) => (money ? e : { ...e, data: safeActivityData(e.data) })) : [];
  let sheets: any[] = [];
  if (want("sheets")) {
    const rows = (await db.query(
      `SELECT s.id, s.date, s.status, s.submitted_at, s.decided_at, u.name AS who, u.id AS user_id, d.name AS decided_by_name,
         json_agg(json_build_object('id', e.id, 'minutes', e.minutes, 'description', e.description, 'task', tk.title, 'task_id', e.task_id,
           'activity', a.name, 'category', e.category, 'offline', e.offline, 'source', e.source) ORDER BY e.created_at) AS entries,
         sum(e.minutes)::int AS minutes
       FROM time_entries e JOIN sheets s ON s.id = e.sheet_id JOIN users u ON u.id = s.user_id LEFT JOIN users d ON d.id = s.decided_by
         LEFT JOIN tasks tk ON tk.id = e.task_id LEFT JOIN activity_types a ON a.id = e.activity_type_id
       WHERE e.project_id = $1 AND s.submitted_at IS NOT NULL AND ($2::uuid IS NULL OR e.task_id = $2) AND ${when("s.submitted_at")}
         AND ($6::uuid IS NULL OR s.user_id = $6 OR s.decided_by = $6)
       GROUP BY s.id, u.id, d.name ORDER BY s.submitted_at DESC LIMIT $3`, [p.id, q.taskId ?? null, limit, ...extra])).rows;
    for (const r of rows) {
      sheets.push({ id: `${r.id}:s`, kind: "sheet", action: "submitted", at: r.submitted_at, who: r.who, user_id: r.user_id, date: r.date, minutes: r.minutes, entries: r.entries, status: r.status });
      if (r.decided_at && (r.status === "approved" || r.status === "rejected")) {
        sheets.push({ id: `${r.id}:d`, kind: "sheet", action: r.status, at: r.decided_at, who: r.decided_by_name ?? "System", for: r.who, user_id: r.user_id, date: r.date, minutes: r.minutes });
      }
    }
  }
  return [...comments, ...events, ...sheets].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, limit);
}));

/** Without money access, keep only the parts of a change that carry no amounts. */
function safeActivityData(d: any) {
  const out: any = {};
  if (d?.taskId) { out.taskId = d.taskId; out.title = d.title; }
  if (d?.added) { out.added = d.added; out.removed = d.removed; out.changed = d.changed; }
  if (d?.name) out.name = d.name;
  if (d?.changes) {
    const keep = ["stage", "status", "assignee", "name", "delivery_date", "start_date", "description", "pm_user_id", "tags"];
    out.changes = Object.fromEntries(Object.entries(d.changes).filter(([k]) => keep.includes(k)));
  }
  return out;
}

// ---------- project files and links ----------
const MAX_FILE = 10 * 1024 * 1024;
workspaceRouter.get("/projects/:id/files", h(async (req, db) => {
  const p = await projectVisible(req, db, uuid.parse(req.params.id));
  return (await db.query(
    "SELECT f.id, f.kind, f.name, f.url, f.content_type, f.size_bytes, f.created_at, f.created_by, u.name AS created_by_name FROM project_files f LEFT JOIN users u ON u.id = f.created_by WHERE f.project_id = $1 ORDER BY f.created_at DESC",
    [p.id])).rows;
}));
/** Upload a file as the raw request body; the file name goes in ?name=. Any project member can add files. */
// The browser sends the bytes as application/octet-stream (so no other body parser touches them) and the real type in ?type=.
workspaceRouter.post("/projects/:id/files", raw({ type: "application/octet-stream", limit: MAX_FILE }), h(async (req, db) => {
  const p = await projectVisible(req, db, uuid.parse(req.params.id));
  const name = z.string().trim().min(1).max(200).parse(req.query.name);
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || !body.length) throw badRequest("The file is empty");
  const type = String(req.query.type || "application/octet-stream").slice(0, 120);
  const f = (await db.query(
    "INSERT INTO project_files (tenant_id, project_id, kind, name, content_type, size_bytes, data, created_by) VALUES ($1,$2,'file',$3,$4,$5,$6,$7) RETURNING id, kind, name, content_type, size_bytes, created_at",
    [req.tenant!.id, p.id, name, type, body.length, body, userId(req)])).rows[0];
  await audit(db, req, "file.add", "project", p.id, { name });
  return f;
}));
workspaceRouter.post("/projects/:id/links", h(async (req, db) => {
  const p = await projectVisible(req, db, uuid.parse(req.params.id));
  const b = z.object({ url: z.string().url().refine((u) => /^https?:\/\//i.test(u), "Use an http or https link"), name: z.string().trim().max(200).optional() }).parse(req.body);
  const name = b.name || b.url.replace(/^https?:\/\/(www\.)?/i, "").slice(0, 120);
  const f = (await db.query("INSERT INTO project_files (tenant_id, project_id, kind, name, url, created_by) VALUES ($1,$2,'link',$3,$4,$5) RETURNING id, kind, name, url, created_at", [req.tenant!.id, p.id, name, b.url, userId(req)])).rows[0];
  await audit(db, req, "link.add", "project", p.id, { name });
  return f;
}));
workspaceRouter.get("/project-files/:id/download", h(async (req, db, res) => {
  const f = (await db.query("SELECT * FROM project_files WHERE id = $1", [uuid.parse(req.params.id)])).rows[0];
  if (!f || f.kind !== "file") throw notFound();
  await projectVisible(req, db, f.project_id);
  res.setHeader("Content-Type", f.content_type || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.send(f.data);
}));
workspaceRouter.delete("/project-files/:id", h(async (req, db) => {
  const f = (await db.query("SELECT id, project_id, name, created_by FROM project_files WHERE id = $1", [uuid.parse(req.params.id)])).rows[0];
  if (!f) throw notFound();
  const p = await projectVisible(req, db, f.project_id);
  if (f.created_by !== userId(req) && !can(req, "projects.manage") && p.pm_user_id !== userId(req)) throw forbidden("Only the person who added it, a PM or an Admin can remove it");
  await db.query("DELETE FROM project_files WHERE id = $1", [f.id]);
  await audit(db, req, "file.remove", "project", p.id, { name: f.name });
  return { ok: true };
}));

// ---------- standup ----------
workspaceRouter.get("/standups", h(async (req, db) => {
  const s = await getSettings(db);
  const q = z.object({ date: date.optional(), scope: z.enum(["mine", "team", "all"]).default("team") }).parse(req.query);
  const d = q.date ?? todayIn(s.locale.timezone);
  const uid = userId(req);
  const all = can(req, "standup.view_all");
  const rows = (await db.query(
    `SELECT u.id AS user_id, u.name, t.name AS team, st.id, st.yesterday, st.today, st.blockers, st.project_ids, st.updated_at
     FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN standups st ON st.user_id = u.id AND st.date = $1
     WHERE u.status = 'active' AND (
       ($2 = 'mine' AND u.id = $3) OR
       ($2 = 'team' AND (u.id = $3 OR u.team_id = (SELECT team_id FROM users WHERE id = $3) OR t.lead_user_id = $3)) OR
       ($2 = 'all' AND $4))
     ORDER BY (st.id IS NULL), u.name`,
    [d, q.scope, uid, all],
  )).rows;
  return { date: d, enabled: s.policies.standupEnabled, people: rows };
}));
workspaceRouter.put("/standups", h(async (req, db) => {
  const s = await getSettings(db);
  const b = z.object({ date: date.optional(), yesterday: z.string().max(4000).default(""), today: z.string().max(4000).default(""), blockers: z.string().max(4000).default(""), projectIds: z.array(uuid).default([]) }).parse(req.body);
  const d = b.date ?? todayIn(s.locale.timezone);
  if (d > todayIn(s.locale.timezone)) throw badRequest("Standups can't be written for future days");
  const r = (await db.query(
    `INSERT INTO standups (tenant_id, user_id, date, yesterday, today, blockers, project_ids) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id, date) DO UPDATE SET yesterday = EXCLUDED.yesterday, today = EXCLUDED.today, blockers = EXCLUDED.blockers, project_ids = EXCLUDED.project_ids, updated_at = now() RETURNING *`,
    [req.tenant!.id, userId(req), d, b.yesterday, b.today, b.blockers, b.projectIds],
  )).rows[0];
  if (b.blockers.trim()) await notify(db, [await approverFor(db, userId(req))], { kind: "standup.blocker", title: `${req.user!.name} is blocked`, body: b.blockers.slice(0, 200), link: "/standup" });
  return r;
}));

// ---------- calendar: events, holidays, leave, WFH, birthdays ----------
const eventSchema = z.object({
  title: z.string().min(1), description: z.string().default(""), kind: z.enum(["event", "meeting", "celebration", "training", "other"]).default("event"),
  startDate: date, endDate: date.optional(), startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  audience: z.enum(["everyone", "team", "department"]).default("everyone"), teamId: uuid.nullable().optional(), departmentId: uuid.nullable().optional(),
});
workspaceRouter.get("/calendar", h(async (req, db) => {
  const q = z.object({ from: date, to: date }).parse(req.query);
  const uid = userId(req);
  const me = (await db.query("SELECT team_id, department_id FROM users WHERE id = $1", [uid])).rows[0];
  const seeAll = can(req, "events.manage") || can(req, "leave.manage");
  const events = (await db.query(
    `SELECT e.*, u.name AS created_by_name FROM events e LEFT JOIN users u ON u.id = e.created_by
     WHERE e.start_date <= $2 AND e.end_date >= $1
       AND ($3 OR e.audience = 'everyone' OR (e.audience = 'team' AND e.team_id = $4) OR (e.audience = 'department' AND e.department_id = $5))
     ORDER BY e.start_date, e.start_time NULLS FIRST`, [q.from, q.to, seeAll, me?.team_id ?? null, me?.department_id ?? null],
  )).rows;
  const holidays = (await db.query("SELECT * FROM holidays WHERE date BETWEEN $1 AND $2 ORDER BY date", [q.from, q.to])).rows;
  // Leave and WFH: approved ones for everyone (names only), so the team can plan.
  const leave = (await db.query(
    `SELECT r.id, r.start_date, r.end_date, r.half_day, u.name AS user_name, lt.name AS type FROM leave_requests r JOIN users u ON u.id = r.user_id JOIN leave_types lt ON lt.id = r.leave_type_id
     WHERE r.status = 'approved' AND r.start_date <= $2 AND r.end_date >= $1`, [q.from, q.to],
  )).rows;
  const wfh = (await db.query("SELECT r.id, r.date, r.kind, u.name AS user_name FROM wfh_requests r JOIN users u ON u.id = r.user_id WHERE r.status = 'approved' AND r.date BETWEEN $1 AND $2", [q.from, q.to])).rows;
  const birthdays = (await db.query(
    `SELECT id, name, to_char(date_of_birth, 'MM-DD') AS md FROM users WHERE status = 'active' AND date_of_birth IS NOT NULL`,
  )).rows;
  return { events, holidays, leave, wfh, birthdays };
}));
workspaceRouter.post("/events", requirePerm("events.manage"), h(async (req, db) => {
  const b = eventSchema.parse(req.body);
  const end = b.endDate ?? b.startDate;
  if (end < b.startDate) throw badRequest("The event can't end before it starts");
  const e = (await db.query(
    `INSERT INTO events (tenant_id, title, description, kind, start_date, end_date, start_time, end_time, audience, team_id, department_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [req.tenant!.id, b.title, b.description, b.kind, b.startDate, end, b.startTime ?? null, b.endTime ?? null, b.audience, b.teamId ?? null, b.departmentId ?? null, userId(req)],
  )).rows[0];
  const to = (await db.query(
    "SELECT id FROM users WHERE status = 'active' AND ($1 = 'everyone' OR ($1 = 'team' AND team_id = $2) OR ($1 = 'department' AND department_id = $3))",
    [b.audience, b.teamId ?? null, b.departmentId ?? null],
  )).rows.map((r) => r.id);
  await notify(db, to.filter((x) => x !== userId(req)), { kind: "event", title: `${b.title} on ${b.startDate}`, body: b.description.slice(0, 200), link: "/calendar" });
  return e;
}));
workspaceRouter.put("/events/:id", requirePerm("events.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const b = eventSchema.parse(req.body);
  await db.query(
    `UPDATE events SET title=$2, description=$3, kind=$4, start_date=$5, end_date=$6, start_time=$7, end_time=$8, audience=$9, team_id=$10, department_id=$11 WHERE id = $1`,
    [id, b.title, b.description, b.kind, b.startDate, b.endDate ?? b.startDate, b.startTime ?? null, b.endTime ?? null, b.audience, b.teamId ?? null, b.departmentId ?? null],
  );
  return { ok: true };
}));
workspaceRouter.delete("/events/:id", requirePerm("events.manage"), h(async (req, db) => {
  await db.query("DELETE FROM events WHERE id = $1", [uuid.parse(req.params.id)]);
  return { ok: true };
}));

// ---------- accessories ----------
const assetSchema = z.object({
  name: z.string().min(1), category: z.string().default(""), serialNumber: z.string().default(""), purchasedOn: date.nullable().optional(),
  costMinor: z.number().int().min(0).nullable().optional(), condition: z.enum(["new", "good", "fair", "damaged", "retired"]).default("good"), notes: z.string().default(""),
  brand: z.string().default(""), vendor: z.string().default(""), vendorId: uuid.nullable().optional(), warrantyMonths: z.number().int().min(0).max(240).nullable().optional(),
});
/** The vendor's name is kept on the item too, so lists and exports read well even if a vendor is later removed. */
async function vendorName(db: any, vendorId: string | null | undefined, fallback: string) {
  if (!vendorId) return fallback;
  const v = (await db.query("SELECT name FROM vendors WHERE id = $1", [vendorId])).rows[0];
  if (!v) throw badRequest("That vendor doesn't exist any more");
  return v.name;
}

// ---------- vendors ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const vendorSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required").max(120),
  contactName: z.string().trim().default(""),
  phone: z.string().trim().refine((v) => !v || /^\+?[\d\s\-().]{6,20}$/.test(v), "Enter a valid phone number").default(""),
  email: z.string().trim().refine((v) => !v || EMAIL_RE.test(v), "Enter a valid email address").default(""),
  taxId: z.string().trim().max(40).default(""), address: z.string().default(""), website: z.string().trim().default(""), notes: z.string().default(""),
  active: z.boolean().default(true),
});
workspaceRouter.get("/vendors", h(async (_req, db) =>
  (await db.query(
    `SELECT v.*, (SELECT count(*)::int FROM assets a WHERE a.vendor_id = v.id) AS items,
       (SELECT max(a.purchased_on) FROM assets a WHERE a.vendor_id = v.id) AS last_bought
     FROM vendors v ORDER BY v.active DESC, v.name`)).rows));
workspaceRouter.post("/vendors", requirePerm("assets.manage"), h(async (req, db) => {
  const b = vendorSchema.parse(req.body);
  const v = (await db.query(
    `INSERT INTO vendors (tenant_id, name, contact_name, phone, email, tax_id, address, website, notes, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [req.tenant!.id, b.name, b.contactName, b.phone, b.email, b.taxId, b.address, b.website, b.notes, b.active])).rows[0];
  await audit(db, req, "vendor.create", "vendor", v.id, { name: b.name });
  return v;
}));
workspaceRouter.put("/vendors/:id", requirePerm("assets.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const b = vendorSchema.parse(req.body);
  const before = await snapshot(db, "vendors", id);
  await db.query(
    `UPDATE vendors SET name=$2, contact_name=$3, phone=$4, email=$5, tax_id=$6, address=$7, website=$8, notes=$9, active=$10 WHERE id = $1`,
    [id, b.name, b.contactName, b.phone, b.email, b.taxId, b.address, b.website, b.notes, b.active]);
  await db.query("UPDATE assets SET vendor = $2 WHERE vendor_id = $1", [id, b.name]);
  await auditChange(db, req, "vendor.update", "vendors", id, before);
  return { ok: true };
}));
workspaceRouter.delete("/vendors/:id", requirePerm("assets.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const used = (await db.query("SELECT count(*)::int AS n FROM assets WHERE vendor_id = $1", [id])).rows[0].n;
  if (used) throw conflict(`${used} item${used === 1 ? " was" : "s were"} bought from this vendor. Mark the vendor inactive instead.`);
  await db.query("DELETE FROM vendors WHERE id = $1", [id]);
  await audit(db, req, "vendor.delete", "vendor", id, {});
  return { ok: true };
}));
workspaceRouter.get("/assets", h(async (req, db) => {
  const mine = !can(req, "assets.manage");
  const rows = (await db.query(
    `SELECT a.*, u.name AS assigned_name, (SELECT count(*)::int FROM asset_assignments h WHERE h.asset_id = a.id) AS times_assigned,
       CASE WHEN a.purchased_on IS NOT NULL AND a.warranty_months IS NOT NULL THEN (a.purchased_on + make_interval(months => a.warranty_months))::date END AS warranty_ends_on
     FROM assets a LEFT JOIN users u ON u.id = a.assigned_to WHERE ($1 = false OR a.assigned_to = $2) ORDER BY a.category, a.name`,
    [mine, userId(req)],
  )).rows;
  return can(req, "money.view") ? rows : rows.map(({ cost_minor, ...r }) => r);
}));
workspaceRouter.get("/assets/:id/history", requirePerm("assets.manage"), h(async (req, db) =>
  (await db.query("SELECT h.*, u.name AS user_name FROM asset_assignments h JOIN users u ON u.id = h.user_id WHERE h.asset_id = $1 ORDER BY h.assigned_on DESC", [uuid.parse(req.params.id)])).rows));
workspaceRouter.post("/assets", requirePerm("assets.manage"), h(async (req, db) => {
  const b = assetSchema.parse(req.body);
  const vendor = await vendorName(db, b.vendorId, b.vendor);
  const a = (await db.query(
    "INSERT INTO assets (tenant_id, name, category, serial_number, purchased_on, cost_minor, condition, notes, brand, vendor, warranty_months, vendor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
    [req.tenant!.id, b.name, b.category, b.serialNumber, b.purchasedOn ?? null, b.costMinor ?? null, b.condition, b.notes, b.brand, vendor, b.warrantyMonths ?? null, b.vendorId ?? null],
  )).rows[0];
  await audit(db, req, "asset.create", "asset", a.id, { name: b.name });
  return a;
}));
workspaceRouter.put("/assets/:id", requirePerm("assets.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const b = assetSchema.partial().parse(req.body);
  const before = await snapshot(db, "assets", id);
  await db.query(
    `UPDATE assets SET name=coalesce($2,name), category=coalesce($3,category), serial_number=coalesce($4,serial_number), purchased_on=coalesce($5::date,purchased_on),
       cost_minor=coalesce($6,cost_minor), condition=coalesce($7,condition), notes=coalesce($8,notes), brand=coalesce($9,brand), vendor=coalesce($10,vendor),
       warranty_months=CASE WHEN $11 THEN $12::int ELSE warranty_months END WHERE id = $1`,
    [id, b.name ?? null, b.category ?? null, b.serialNumber ?? null, b.purchasedOn ?? null, b.costMinor ?? null, b.condition ?? null, b.notes ?? null,
      "brand" in (req.body ?? {}) ? b.brand : null, "vendor" in (req.body ?? {}) ? b.vendor : null, "warrantyMonths" in (req.body ?? {}), b.warrantyMonths ?? null],
  );
  if ("vendorId" in (req.body ?? {})) await db.query("UPDATE assets SET vendor_id = $2, vendor = $3 WHERE id = $1", [id, b.vendorId ?? null, await vendorName(db, b.vendorId, b.vendor ?? "")]);
  await auditChange(db, req, "asset.update", "assets", id, before);
  return { ok: true };
}));
workspaceRouter.post("/assets/:id/assign", requirePerm("assets.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({ userId: uuid, on: date.optional(), notes: z.string().default("") }).parse(req.body);
  const a = (await db.query("SELECT * FROM assets WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!a) throw notFound();
  if (a.assigned_to) throw conflict("Take it back from the current person first");
  if (a.condition === "retired") throw badRequest("This item is retired");
  const s = await getSettings(db);
  const on = b.on ?? todayIn(s.locale.timezone);
  await db.query("UPDATE assets SET assigned_to = $2, assigned_on = $3 WHERE id = $1", [id, b.userId, on]);
  await db.query("INSERT INTO asset_assignments (tenant_id, asset_id, user_id, assigned_on, notes) VALUES ($1,$2,$3,$4,$5)", [req.tenant!.id, id, b.userId, on, b.notes]);
  await notify(db, [b.userId], { kind: "asset.assigned", title: `${a.name} is now assigned to you`, link: "/accessories" });
  await audit(db, req, "asset.assign", "asset", id, { to: b.userId });
  return { ok: true };
}));
workspaceRouter.post("/assets/:id/return", requirePerm("assets.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({ on: date.optional(), condition: z.enum(["new", "good", "fair", "damaged", "retired"]).default("good"), notes: z.string().default("") }).parse(req.body);
  const a = (await db.query("SELECT * FROM assets WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!a?.assigned_to) throw badRequest("This item isn't assigned");
  const s = await getSettings(db);
  const on = b.on ?? todayIn(s.locale.timezone);
  await db.query("UPDATE asset_assignments SET returned_on = $2, condition_on_return = $3, notes = notes || CASE WHEN $4 = '' THEN '' ELSE ' ' || $4 END WHERE asset_id = $1 AND returned_on IS NULL", [id, on, b.condition, b.notes]);
  await db.query("UPDATE assets SET assigned_to = NULL, assigned_on = NULL, condition = $2 WHERE id = $1", [id, b.condition]);
  await audit(db, req, "asset.return", "asset", id, { from: a.assigned_to, condition: b.condition });
  return { ok: true };
}));
workspaceRouter.delete("/assets/:id", requirePerm("assets.manage"), h(async (req, db) => {
  const a = (await db.query("SELECT assigned_to FROM assets WHERE id = $1", [uuid.parse(req.params.id)])).rows[0];
  if (a?.assigned_to) throw conflict("Take it back first");
  await db.query("DELETE FROM assets WHERE id = $1", [uuid.parse(req.params.id)]);
  return { ok: true };
}));

// ---------- profile photo ----------
workspaceRouter.put("/users/:id/photo", raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "1mb" }), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  if (id !== userId(req) && !can(req, "users.manage")) throw forbidden();
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length < 100) throw badRequest("Upload a PNG, JPEG or WebP image up to 1 MB");
  await db.query(
    `INSERT INTO user_files (tenant_id, user_id, kind, content_type, data) VALUES ($1,$2,'photo',$3,$4)
     ON CONFLICT (user_id, kind) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data, created_at = now()`,
    [req.tenant!.id, id, req.header("content-type"), body],
  );
  await db.query("UPDATE users SET has_photo = true WHERE id = $1", [id]);
  return { ok: true };
}));
workspaceRouter.delete("/users/:id/photo", h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  if (id !== userId(req) && !can(req, "users.manage")) throw forbidden();
  await db.query("DELETE FROM user_files WHERE user_id = $1 AND kind = 'photo'", [id]);
  await db.query("UPDATE users SET has_photo = false WHERE id = $1", [id]);
  return { ok: true };
}));
workspaceRouter.get("/users/:id/photo", h(async (req, db, res) => {
  const f = (await db.query("SELECT content_type, data, created_at FROM user_files WHERE user_id = $1 AND kind = 'photo'", [uuid.parse(req.params.id)])).rows[0];
  if (!f) throw notFound();
  res.setHeader("Content-Type", f.content_type);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(f.data);
}));

// ---------- charts for the dashboard ----------
workspaceRouter.get("/charts", h(async (req, db) => {
  const s = await getSettings(db);
  const now = todayIn(s.locale.timezone);
  // Day charts cover the chosen dates (default: the last 14 days, at most 92 days); month charts the months they touch.
  const rq = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
  const today = rq.to && rq.to < now ? rq.to : now;
  const from = rq.from && rq.from <= today ? (Date.parse(today) - Date.parse(rq.from) > 91 * 86400000 ? addDays(today, -91) : rq.from) : addDays(today, -13);
  const monthsBack = rq.from ? Math.max(0, Math.min(23, (Number(today.slice(0, 4)) - Number(rq.from.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(rq.from.slice(5, 7)))) : 5;
  const uid = userId(req);
  const out: Record<string, unknown> = {};
  // My hours per day (approved vs other), last 14 days
  out.myHours = (await db.query(
    `SELECT d::date AS date, coalesce(sum(e.minutes) FILTER (WHERE s.status = 'approved'),0)::int AS approved, coalesce(sum(e.minutes) FILTER (WHERE s.status <> 'approved'),0)::int AS other
     FROM generate_series($1::date, $2::date, interval '1 day') d LEFT JOIN time_entries e ON e.date = d::date AND e.user_id = $3 LEFT JOIN sheets s ON s.id = e.sheet_id
     GROUP BY d ORDER BY d`, [from, today, uid],
  )).rows;
  if (can(req, "time.approve_team") || can(req, "time.approve_all") || can(req, "performance.view")) {
    out.teamHours = (await db.query(
      `SELECT d::date AS date, coalesce(sum(e.minutes),0)::int AS minutes FROM generate_series($1::date, $2::date, interval '1 day') d
       LEFT JOIN time_entries e ON e.date = d::date AND e.user_id IN (
         SELECT u.id FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE $4 OR coalesce(u.reporting_manager_id, t.lead_user_id) = $3)
       GROUP BY d ORDER BY d`, [from, today, uid, can(req, "time.approve_all") || can(req, "performance.view")],
    )).rows;
  }
  if (can(req, "money.view") && req.tenant!.features.has("projects_billing")) {
    out.revenue = (await db.query(
      `SELECT to_char(m, 'YYYY-MM') AS month,
         coalesce((SELECT sum(subtotal_minor) FROM invoices i WHERE date_trunc('month', i.issue_date) = m AND i.status IN ('unpaid','partially_paid','paid')),0)::bigint AS invoiced,
         coalesce((SELECT sum(amount_minor) FROM payments p WHERE date_trunc('month', p.received_on) = m),0)::bigint AS collected
       FROM generate_series(date_trunc('month', $1::date) - make_interval(months => $2), date_trunc('month', $1::date), interval '1 month') m ORDER BY m`, [today, monthsBack],
    )).rows;
    out.invoiceStatus = (await db.query(
      `SELECT CASE WHEN status IN ('unpaid','partially_paid') AND due_date < $1 THEN 'overdue' ELSE status END AS status, count(*)::int AS n, sum(total_minor - CASE WHEN status IN ('paid','refunded','cancelled') THEN 0 ELSE paid_minor END)::bigint AS amount
       FROM invoices WHERE ($2::date IS NULL OR issue_date BETWEEN $2 AND $1) GROUP BY 1`, [today, rq.from ?? null],
    )).rows;
  }
  if (req.tenant!.features.has("sales_crm") && (can(req, "leads.view_all") || can(req, "performance.view"))) {
    out.funnel = (await db.query("SELECT status, count(*)::int AS n FROM leads WHERE ($1::date IS NULL OR created_at::date BETWEEN $1 AND $2) GROUP BY status", [rq.from ?? null, today])).rows;
  }
  const week = periodBounds(today, "week", s.locale.weekStartsOn);
  out.week = week;
  out.range = { from, to: today, monthsBack };
  return out;
}));

// ---------- alert rules ----------
workspaceRouter.get("/alert-rules", requirePerm("settings.manage"), h(async (_req, db) => ({
  events: ALERT_EVENTS,
  rules: (await db.query("SELECT * FROM alert_rules ORDER BY event, created_at")).rows,
})));
const ruleSchema = z.object({
  event: z.string().refine((e) => e in ALERT_EVENTS, "Unknown event"), threshold: z.number().int().min(0).max(1000).nullable().default(null),
  roleKeys: z.array(z.string()).default([]), userIds: z.array(uuid).default([]), notifyOwner: z.boolean().default(false),
  inApp: z.boolean().default(true), email: z.boolean().default(false), active: z.boolean().default(true),
});
workspaceRouter.post("/alert-rules", requirePerm("settings.manage"), h(async (req, db) => {
  const b = ruleSchema.parse(req.body);
  return (await db.query(
    "INSERT INTO alert_rules (tenant_id, event, threshold, role_keys, user_ids, notify_owner, in_app, email, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
    [req.tenant!.id, b.event, b.threshold, b.roleKeys, b.userIds, b.notifyOwner, b.inApp, b.email, b.active],
  )).rows[0];
}));
workspaceRouter.put("/alert-rules/:id", requirePerm("settings.manage"), h(async (req, db) => {
  const b = ruleSchema.parse(req.body);
  await db.query(
    "UPDATE alert_rules SET event=$2, threshold=$3, role_keys=$4, user_ids=$5, notify_owner=$6, in_app=$7, email=$8, active=$9 WHERE id = $1",
    [uuid.parse(req.params.id), b.event, b.threshold, b.roleKeys, b.userIds, b.notifyOwner, b.inApp, b.email, b.active],
  );
  return { ok: true };
}));
workspaceRouter.delete("/alert-rules/:id", requirePerm("settings.manage"), h(async (req, db) => {
  await db.query("DELETE FROM alert_rules WHERE id = $1", [uuid.parse(req.params.id)]);
  return { ok: true };
}));
