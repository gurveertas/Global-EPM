import type { Request } from "express";
import { audit, notify } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";

import type { PoolClient } from "pg";
type Db = PoolClient;

/**
 * Keeps project_role_history in step with a project's PMs and Team Leads: closes the row of anyone who stops being PM/TL
 * and opens one for anyone who starts. Earlier rows are never changed, so past PMs and TLs stay on record.
 */
export async function syncRoleHistory(db: Db, tenantId: string, projectId: string, before: { user_id: string; role: string }[], after: Map<string, string>, opts: { handedTo?: string | null; handoverId?: string | null } = {}) {
  const old = new Map(before.map((r) => [r.user_id, r.role]));
  for (const id of new Set([...old.keys(), ...after.keys()])) {
    const was = old.get(id), now = after.get(id);
    if (was === now) continue;
    if (was === "pm" || was === "tl") {
      await db.query(
        `UPDATE project_role_history SET ended_at = now(), handed_to = coalesce($4, handed_to), handover_id = coalesce($5, handover_id)
         WHERE project_id = $1 AND user_id = $2 AND role = $3 AND ended_at IS NULL`, [projectId, id, was, opts.handedTo ?? null, opts.handoverId ?? null]);
    }
    if (now === "pm" || now === "tl") {
      await db.query("INSERT INTO project_role_history (tenant_id, project_id, user_id, role, handover_id) VALUES ($1,$2,$3,$4,$5)", [tenantId, projectId, id, now, opts.handoverId ?? null]);
    }
  }
}

/** Everything a person is responsible for that can be handed to someone else. */
export async function responsibilities(db: Db, userId: string) {
  const projects = (await db.query(
    `SELECT p.id, p.name, p.status, c.name AS client_name, m.role,
       (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.assignee_id = $1 AND t.status <> 'done') AS open_tasks
     FROM project_members m JOIN projects p ON p.id = m.project_id LEFT JOIN clients c ON c.id = p.client_id
     WHERE m.user_id = $1 AND (m.role IN ('pm','tl') OR p.pm_user_id = $1)
     ORDER BY p.status = 'active' DESC, p.name`, [userId])).rows.map((r) => ({ ...r, role: r.role === "member" ? "pm" : r.role }));
  const teams = (await db.query(
    `SELECT t.id, t.name, (t.lead_user_id = $1) AS is_lead, (t.manager_user_id = $1) AS is_manager,
       (SELECT count(*)::int FROM users u WHERE u.team_id = t.id AND u.status = 'active') AS people
     FROM teams t WHERE t.lead_user_id = $1 OR t.manager_user_id = $1 ORDER BY t.name`, [userId])).rows;
  const reports = (await db.query(
    "SELECT id, name, designation FROM users WHERE reporting_manager_id = $1 AND status IN ('active','invited') ORDER BY name", [userId])).rows;
  const tasks = (await db.query(
    `SELECT t.id, t.title, t.status, p.id AS project_id, p.name AS project_name FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE t.assignee_id = $1 AND t.status <> 'done' ORDER BY p.name, t.title`, [userId])).rows;
  const leads = (await db.query(
    "SELECT id, title, company, status FROM leads WHERE caller_id = $1 AND status IN ('new','contacted','follow_up') ORDER BY updated_at DESC", [userId])).rows;
  const pendingSheets = (await db.query(
    `SELECT count(*)::int AS n FROM sheets s JOIN users r ON r.id = s.user_id LEFT JOIN teams rt ON rt.id = r.team_id
     WHERE s.status = 'submitted' AND coalesce(r.reporting_manager_id, rt.lead_user_id) = $1`, [userId])).rows[0].n;
  return { projects, teams, reports, tasks, leads, pendingSheets };
}

export interface HandoverInput {
  fromUserId: string; toUserId: string;
  projectIds: string[]; teamIds: string[]; reportIds: string[]; taskIds: string[]; leadIds: string[];
  keepOnProjects: boolean; note: string;
}

/**
 * Moves the chosen responsibilities from one person to another in one go. Nothing done before is rewritten: approvals,
 * sheets, comments and activity keep the name of whoever did them, and project_role_history keeps who was PM/TL when.
 */
export async function runHandover(db: Db, req: Request, b: HandoverInput) {
  if (b.fromUserId === b.toUserId) throw badRequest("Pick two different people");
  const people = (await db.query("SELECT id, name, status FROM users WHERE id = ANY($1)", [[b.fromUserId, b.toUserId]])).rows;
  const from = people.find((p) => p.id === b.fromUserId), to = people.find((p) => p.id === b.toUserId);
  if (!from || !to) throw notFound("Person not found");
  if (to.status === "disabled") throw badRequest(`${to.name} is deactivated. Reactivate them first or pick someone else.`);
  const tenantId = req.tenant!.id;
  const h = (await db.query("INSERT INTO handovers (tenant_id, from_user_id, to_user_id, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [tenantId, b.fromUserId, b.toUserId, b.note, req.user!.id])).rows[0];
  const moved: Record<string, any[]> = { projects: [], teams: [], reports: [], tasks: [], leads: [] };

  for (const pid of b.projectIds) {
    const before = (await db.query("SELECT user_id, role FROM project_members WHERE project_id = $1", [pid])).rows;
    const p = (await db.query("SELECT id, name, pm_user_id FROM projects WHERE id = $1", [pid])).rows[0];
    if (!p) continue;
    const fromRole = before.find((r) => r.user_id === b.fromUserId)?.role ?? (p.pm_user_id === b.fromUserId ? "pm" : null);
    if (fromRole !== "pm" && fromRole !== "tl") continue;
    const toNow = before.find((r) => r.user_id === b.toUserId)?.role;
    // The new person takes the role (a PM stays PM if they already were); the old one stays as a member or leaves.
    const toRole = toNow === "pm" ? "pm" : fromRole;
    await db.query(
      `INSERT INTO project_members (tenant_id, project_id, user_id, role, assigned_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [tenantId, pid, b.toUserId, toRole, req.user!.id]);
    if (b.keepOnProjects) await db.query("UPDATE project_members SET role = 'member' WHERE project_id = $1 AND user_id = $2", [pid, b.fromUserId]);
    else await db.query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2", [pid, b.fromUserId]);
    if (p.pm_user_id === b.fromUserId) await db.query("UPDATE projects SET pm_user_id = $2 WHERE id = $1", [pid, b.toUserId]);
    const after = new Map((await db.query("SELECT user_id, role FROM project_members WHERE project_id = $1", [pid])).rows.map((r) => [r.user_id, r.role] as [string, string]));
    await syncRoleHistory(db, tenantId, pid, before, after, { handedTo: b.toUserId, handoverId: h.id });
    const roleName = fromRole === "pm" ? "Project Manager" : "Team Lead";
    await audit(db, req, "project.handover", "project", pid, { from: from.name, to: to.name, role: roleName, handoverId: h.id });
    const members = (await db.query("SELECT user_id FROM project_members WHERE project_id = $1 AND user_id <> $2", [pid, req.user!.id])).rows.map((r) => r.user_id);
    await notify(db, members, { kind: "project.handover", title: `${to.name} is now ${roleName} of ${p.name}`, body: `Taking over from ${from.name}.`, link: `/projects/${pid}` });
    moved.projects.push({ id: pid, name: p.name, role: fromRole });
  }
  for (const tid of b.teamIds) {
    const t = (await db.query(
      `UPDATE teams SET lead_user_id = CASE WHEN lead_user_id = $2 THEN $3 ELSE lead_user_id END,
         manager_user_id = CASE WHEN manager_user_id = $2 THEN $3 ELSE manager_user_id END
       WHERE id = $1 AND (lead_user_id = $2 OR manager_user_id = $2) RETURNING id, name`, [tid, b.fromUserId, b.toUserId])).rows[0];
    if (t) moved.teams.push(t);
  }
  if (b.reportIds.length) {
    const r = (await db.query("UPDATE users SET reporting_manager_id = $2 WHERE id = ANY($1) AND reporting_manager_id = $3 AND id <> $2 RETURNING id, name",
      [b.reportIds, b.toUserId, b.fromUserId])).rows;
    moved.reports.push(...r);
  }
  if (b.taskIds.length) {
    const r = (await db.query("UPDATE tasks SET assignee_id = $2, updated_at = now() WHERE id = ANY($1) AND assignee_id = $3 RETURNING id, title, project_id",
      [b.taskIds, b.toUserId, b.fromUserId])).rows;
    moved.tasks.push(...r);
    for (const t of r) await audit(db, req, "task.update", "project", t.project_id, { taskId: t.id, title: t.title, changes: { assignee: [from.name, to.name] }, handoverId: h.id });
  }
  if (b.leadIds.length) {
    const r = (await db.query("UPDATE leads SET caller_id = $2, updated_at = now() WHERE id = ANY($1) AND caller_id = $3 RETURNING id, title",
      [b.leadIds, b.toUserId, b.fromUserId])).rows;
    moved.leads.push(...r);
  }
  await db.query("UPDATE handovers SET moved = $2 WHERE id = $1", [h.id, JSON.stringify(moved)]);
  const counts = Object.fromEntries(Object.entries(moved).map(([k, v]) => [k, v.length]));
  await audit(db, req, "user.handover", "user", b.fromUserId, { to: to.name, from: from.name, ...counts, note: b.note });
  await notify(db, [b.toUserId], {
    kind: "handover", title: `You've taken over from ${from.name}`,
    body: [counts.projects && `${counts.projects} project(s)`, counts.teams && `${counts.teams} team(s)`, counts.reports && `${counts.reports} direct report(s)`, counts.tasks && `${counts.tasks} task(s)`, counts.leads && `${counts.leads} lead(s)`].filter(Boolean).join(", "),
    link: "/handover",
  });
  return { id: h.id, moved, counts };
}
