import type { Request } from "express";
import { selfCall } from "../../lib/selfCall";

/**
 * What the assistant can look up and do. Every tool goes through eszy's own API as the person chatting, so it sees and changes
 * only what they could in the app. Tools that change something never run straight away: they become a pending action the
 * person confirms (or declines) in the chat.
 */
export type ToolDef = {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, any>; required?: string[] };
  kind: "read" | "write";
  /** Offer the tool only when the person holds one of these permissions. */
  perms?: string[];
};
type Ctx = { req: Request; can: (p: string) => boolean; today: string; meId: string };
export type Prepared = { summary: string; method: string; path: string; body?: unknown; done: string };

const str = (d: string) => ({ type: "string", description: d });
const num = (d: string) => ({ type: "number", description: d });
const dateP = (d: string) => ({ type: "string", description: `${d} (YYYY-MM-DD)` });

export const TOOLS: ToolDef[] = [
  { name: "my_profile", kind: "read", description: "The signed-in person's own details: name, roles, team, designation, reporting manager, contact details.", parameters: { type: "object", properties: {} } },
  { name: "my_day_sheet", kind: "read", description: "The signed-in person's timesheet for a day: entries, hours needed, status, and the projects and tasks they can log to.", parameters: { type: "object", properties: { date: dateP("Day, default today") } } },
  { name: "person_hours", kind: "read", description: "Hours, utilization, unfilled days and leave for a person in a date range. Use the signed-in person when no name is given.", parameters: { type: "object", properties: { person: str("Name or email; empty for me"), from: dateP("Start"), to: dateP("End") } } },
  { name: "find_people", kind: "read", description: "Search the people the signed-in person can see: name, designation, team, email, reporting manager.", parameters: { type: "object", properties: { query: str("Part of a name, email, team or designation") } } },
  { name: "list_projects", kind: "read", description: "Projects the signed-in person can see, with client, PM, stage, status and hours.", parameters: { type: "object", properties: { query: str("Optional name or client filter"), status: { type: "string", enum: ["active", "paused", "ended", "all"] } } } },
  { name: "project_details", kind: "read", description: "One project: team (PMs, Team Leads, employees), caps and hours left, open tasks, stage and description.", parameters: { type: "object", properties: { project: str("Project name or code") }, required: ["project"] } },
  { name: "my_work", kind: "read", description: "The signed-in person's open tasks and projects, who is out today, and upcoming holidays and events.", parameters: { type: "object", properties: {} } },
  { name: "leave_balance", kind: "read", description: "Leave balances by type for the signed-in person, and their recent leave requests.", parameters: { type: "object", properties: {} } },
  { name: "holidays", kind: "read", description: "Company holidays and non-working days.", parameters: { type: "object", properties: {} } },
  { name: "pending_approvals", kind: "read", perms: ["time.approve_team", "time.approve_all"], description: "Sheets waiting for the signed-in person's approval.", parameters: { type: "object", properties: {} } },
  { name: "team_utilization", kind: "read", perms: ["reports.view", "time.approve_team", "time.approve_all"], description: "Utilization and hours for the people the signed-in person manages (or everyone if they can see all reports).", parameters: { type: "object", properties: { from: dateP("Start"), to: dateP("End") } } },
  { name: "unpaid_invoices", kind: "read", perms: ["invoices.view"], description: "Invoices that are unpaid or partly paid, with amounts and due dates.", parameters: { type: "object", properties: {} } },

  { name: "log_time", kind: "write", perms: ["time.own"], description: "Add hours to the signed-in person's sheet for a day (keeps the existing entries). Needs confirmation.", parameters: { type: "object", properties: { date: dateP("Day, default today"), project: str("Project name or code"), hours: num("Hours, e.g. 1.5"), description: str("What was done"), task: str("Optional task title on that project") }, required: ["project", "hours", "description"] } },
  { name: "submit_sheet", kind: "write", perms: ["time.own"], description: "Submit the signed-in person's sheet for a day for approval. Needs confirmation.", parameters: { type: "object", properties: { date: dateP("Day, default today") } } },
  { name: "request_leave", kind: "write", perms: ["leave.request"], description: "Request leave for the signed-in person. Needs confirmation.", parameters: { type: "object", properties: { leave_type: str("Leave type name, e.g. Casual leave"), start_date: dateP("First day"), end_date: dateP("Last day, same as start for one day"), part: { type: "string", enum: ["full", "first_half", "second_half", "short"] }, short_hours: num("Hours for a short leave"), reason: str("Reason") }, required: ["leave_type", "start_date", "reason"] } },
  { name: "request_wfh", kind: "write", perms: ["leave.request"], description: "Request work from home for the signed-in person. Needs confirmation.", parameters: { type: "object", properties: { date: dateP("Day"), kind: { type: "string", enum: ["full", "half", "hours"] }, hours: num("Hours, when kind is hours"), reason: str("Reason") }, required: ["date", "kind"] } },
  { name: "update_task", kind: "write", description: "Change a task's status (todo, in_progress, review, done) on a project the person works on. Needs confirmation.", parameters: { type: "object", properties: { project: str("Project name"), task: str("Task title"), status: { type: "string", enum: ["todo", "in_progress", "review", "done"] } }, required: ["project", "task", "status"] } },
  { name: "decide_sheet", kind: "write", perms: ["time.approve_team", "time.approve_all"], description: "Approve or send back a submitted sheet of someone who reports to the signed-in person. Needs confirmation.", parameters: { type: "object", properties: { person: str("Name of the person"), date: dateP("Day of the sheet"), decision: { type: "string", enum: ["approve", "send_back"] }, reason: str("Why, when sending back") }, required: ["person", "date", "decision"] } },
];

export const toolsFor = (can: (p: string) => boolean) => TOOLS.filter((t) => !t.perms || t.perms.some(can));

// ------------------------------------------------------------------------------------------------ helpers
const ok = (r: { status: number; body: any }) => {
  if (r.status >= 400) throw new ToolError(r.body?.error?.message ?? r.body?.message ?? `Not allowed (${r.status})`);
  return r.body;
};
export class ToolError extends Error {}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function pickOne(rows: any[], q: string, keys: string[], what: string): any {
  const n = norm(q);
  const exact = rows.filter((r) => keys.some((k) => norm(String(r[k] ?? "")) === n));
  if (exact.length === 1) return exact[0];
  const part = rows.filter((r) => keys.some((k) => norm(String(r[k] ?? "")).includes(n)));
  if (part.length === 1) return part[0];
  if (!part.length && !exact.length) throw new ToolError(`No ${what} matches “${q}”.`);
  throw new ToolError(`Several ${what}s match “${q}”: ${(exact.length ? exact : part).slice(0, 6).map((r) => r[keys[0]]).join(", ")}. Ask which one.`);
}
const users = async (c: Ctx) => ok(await selfCall(c.req, "GET", "/users")) as any[];
async function person(c: Ctx, q?: string) {
  if (!q || /^(me|myself|i)$/i.test(q.trim())) return { id: c.meId, name: "you" };
  return pickOne(await users(c), q, ["name", "email", "employee_code"], "person");
}
async function project(c: Ctx, q: string) {
  const list = ok(await selfCall(c.req, "GET", "/projects")) as any[];
  return pickOne(list, q, ["name", "code", "client_name"], "project");
}
const hrs = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
const monthStart = (d: string) => `${d.slice(0, 8)}01`;
const qs = (o: Record<string, unknown>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== "") as [string, string][]).toString();

// ------------------------------------------------------------------------------------------------ read tools
export async function runRead(c: Ctx, name: string, a: any): Promise<unknown> {
  switch (name) {
    case "my_profile": {
      const me = ok(await selfCall(c.req, "GET", "/me"));
      const u = (await users(c)).find((x) => x.id === c.meId) ?? {};
      return { name: me.user.name, email: me.user.email, roles: me.user.roles, team: u.team_name, designation: u.designation, employee_code: u.employee_code, reporting_manager: u.reporting_manager_name, phone: me.user.phone, address: me.user.address };
    }
    case "my_day_sheet": {
      const d = ok(await selfCall(c.req, "GET", `/sheets/day?${qs({ date: a.date })}`));
      return {
        date: d.date, status: d.sheet?.status ?? "not started", needed: hrs(d.expected?.minutes ?? d.expected ?? 0),
        logged: hrs(d.entries.reduce((x: number, e: any) => x + e.minutes, 0)),
        entries: d.entries.map((e: any) => ({ project: e.project_name, task: e.task_title, hours: hrs(e.minutes), work_type: e.activity_type, notes: e.description })),
        projects: d.projects.map((p: any) => ({ name: p.name, tasks: p.tasks.map((t: any) => t.title).slice(0, 15) })), has_approver: d.hasApprover,
      };
    }
    case "person_hours": {
      const p = await person(c, a.person);
      const r = ok(await selfCall(c.req, "GET", `/reporting/person/${p.id}?${qs({ from: a.from ?? monthStart(c.today), to: a.to ?? c.today })}`));
      const s = r.stats;
      return { person: s.name ?? p.name, from: r.from, to: r.to, expected: hrs(s.expected), logged: hrs(s.logged), approved: hrs(s.approved), billable_approved: hrs(s.billable), in_house: hrs(s.inhouse), pending: hrs(s.pending), unfilled_days: s.unfilled_days?.length ?? s.unfilled_sheets ?? 0, leave: hrs(s.leave), utilization_pct: s.utilization, top_projects: r.byProject.slice(0, 5).map((x: any) => ({ project: x.project_name, hours: hrs(x.minutes) })) };
    }
    case "find_people": {
      const n = norm(a.query ?? "");
      return (await users(c)).filter((u) => !n || [u.name, u.email, u.team_name, u.designation, u.employee_code].some((v) => norm(String(v ?? "")).includes(n))).slice(0, 25)
        .map((u) => ({ name: u.name, designation: u.designation, team: u.team_name, email: u.email, code: u.employee_code, reporting_manager: u.reporting_manager_name, status: u.employment_status ?? u.status }));
    }
    case "list_projects": {
      const list = ok(await selfCall(c.req, "GET", "/projects")) as any[];
      const n = norm(a.query ?? "");
      return list.filter((p) => (a.status && a.status !== "all" ? p.status === a.status : p.status !== "ended") && (!n || norm(`${p.name} ${p.code ?? ""} ${p.client_name}`).includes(n))).slice(0, 30)
        .map((p) => ({ name: p.name, code: p.code, client: p.client_name, pm: p.pm_name, stage: p.stage_name, status: p.status, hours_logged: hrs(p.logged_minutes ?? 0), open_tasks: p.open_tasks }));
    }
    case "project_details": {
      const p = await project(c, a.project);
      const d = ok(await selfCall(c.req, "GET", `/projects/${p.id}`));
      const role = (m: any) => (m.role === "pm" || m.id === d.pm_user_id ? "Project Manager" : m.role === "tl" ? "Team Lead" : "Employee");
      return {
        name: d.name, client: d.client_name, status: d.status, stage: d.stage?.name, type: d.type, description: (d.description ?? "").slice(0, 800),
        team: d.members.map((m: any) => ({ name: m.name, role: role(m), hours: hrs(m.logged_minutes ?? 0) })),
        hours_logged: hrs(d.remaining?.projectUsed ?? 0), project_cap: d.remaining?.projectCap == null ? "no cap" : hrs(d.remaining.projectCap), hours_left: d.remaining?.projectLeft == null ? null : hrs(Math.max(0, d.remaining.projectLeft)),
        open_tasks: d.tasks.filter((t: any) => t.status !== "done").map((t: any) => ({ title: t.title, status: t.status, assignee: t.assignee_name, due: t.due_date })),
        average_rate_minor: d.rate?.rate_minor ?? undefined,
      };
    }
    case "my_work": {
      const x = ok(await selfCall(c.req, "GET", "/dashboard/extra"));
      return { tasks: x.myTasks, projects: x.myProjects, on_leave_today: x.onLeaveToday, wfh_today: x.wfhToday, upcoming: x.upcoming };
    }
    case "leave_balance": {
      const b = ok(await selfCall(c.req, "GET", "/leave/balances"));
      const r = ok(await selfCall(c.req, "GET", "/leave/requests?scope=mine"));
      return { balances: b, recent_requests: (Array.isArray(r) ? r : r.items ?? []).slice(0, 10).map((x: any) => ({ type: x.leave_type, from: x.start_date, to: x.end_date, days: x.days, status: x.status })) };
    }
    case "holidays": return ok(await selfCall(c.req, "GET", "/holidays"));
    case "pending_approvals": {
      const r = ok(await selfCall(c.req, "GET", "/approvals/sheets")) as any[];
      return r.slice(0, 40).map((s) => ({ person: s.user_name, date: s.date, hours: hrs(s.minutes ?? s.total_minutes ?? 0), submitted: s.submitted_at }));
    }
    case "team_utilization": {
      const r = ok(await selfCall(c.req, "GET", `/reporting/utilization?${qs({ from: a.from ?? monthStart(c.today), to: a.to ?? c.today })}`));
      return { from: r.from, to: r.to, totals: r.totals, people: (r.people ?? []).slice(0, 40).map((p: any) => ({ name: p.name, team: p.team_name, expected: hrs(p.expected), approved_billable: hrs(p.billable), utilization_pct: p.utilization, unfilled_days: p.unfilled_sheets })) };
    }
    case "unpaid_invoices": {
      const r = ok(await selfCall(c.req, "GET", "/invoices?status=unpaid"));
      return (Array.isArray(r) ? r : r.items ?? []).filter((i: any) => ["unpaid", "partially_paid"].includes(i.status)).slice(0, 30)
        .map((i: any) => ({ number: i.number, client: i.client_name, project: i.project_name, total_minor: i.total_minor, paid_minor: i.paid_minor, due: i.due_date, currency: i.currency }));
    }
  }
  throw new ToolError(`Unknown tool ${name}`);
}

// ------------------------------------------------------------------------------------------------ write tools (prepared, then confirmed)
export async function prepareWrite(c: Ctx, name: string, a: any): Promise<Prepared> {
  switch (name) {
    case "log_time": {
      const date = a.date || c.today;
      const p = await project(c, a.project);
      const day = ok(await selfCall(c.req, "GET", `/sheets/day?date=${date}`));
      const proj = day.projects.find((x: any) => x.id === p.id);
      if (!proj) throw new ToolError(`You're not on ${p.name}, so you can't log time to it.`);
      const minutes = Math.round(Number(a.hours) * 60);
      if (!(minutes > 0 && minutes <= 1440)) throw new ToolError("Hours must be between 0 and 24.");
      const task = a.task ? pickOne(proj.tasks, a.task, ["title"], "task") : null;
      const keep = day.entries.map((e: any) => ({ projectId: e.project_id, taskId: e.task_id, minutes: e.minutes, description: e.description, source: e.source, activityTypeId: e.activity_type_id, trackerId: e.tracker_id, offline: e.offline, offlineReason: e.offline_reason }));
      return {
        summary: `Log ${hrs(minutes)} on ${p.name}${task ? ` (task: ${task.title})` : ""} for ${date}: “${a.description}”`,
        method: "PUT", path: "/sheets/day", body: { date, entries: [...keep, { projectId: p.id, taskId: task?.id ?? null, minutes, description: a.description ?? "" }] },
        done: `Logged ${hrs(minutes)} on ${p.name} for ${date}. It's saved as a draft; submit the day when it's complete.`,
      };
    }
    case "submit_sheet": {
      const date = a.date || c.today;
      const day = ok(await selfCall(c.req, "GET", `/sheets/day?date=${date}`));
      const logged = day.entries.reduce((x: number, e: any) => x + e.minutes, 0);
      return { summary: `Submit your sheet for ${date} (${hrs(logged)} logged) to your Team Lead`, method: "POST", path: "/sheets/day/submit", body: { date }, done: `Submitted your sheet for ${date}.` };
    }
    case "request_leave": {
      const types = ok(await selfCall(c.req, "GET", "/leave/types")) as any[];
      const t = pickOne(types.filter((x) => x.active !== false), a.leave_type, ["name"], "leave type");
      const part = a.part ?? "full";
      const end = part === "full" ? a.end_date || a.start_date : a.start_date;
      const shortMinutes = part === "short" ? Math.round(Number(a.short_hours || 2) * 60) : null;
      const when = end !== a.start_date ? `${a.start_date} to ${end}` : a.start_date;
      const label = part === "first_half" ? " (first half)" : part === "second_half" ? " (second half)" : part === "short" ? ` (short leave, ${hrs(shortMinutes!)})` : "";
      return {
        summary: `Request ${t.name} for ${when}${label}. Reason: “${a.reason}”`, method: "POST", path: "/leave/requests",
        body: { leaveTypeId: t.id, startDate: a.start_date, endDate: end, part, halfDay: part === "first_half" || part === "second_half", shortMinutes, reason: a.reason ?? "" },
        done: `Leave requested for ${when}. Your approver has been told.`,
      };
    }
    case "request_wfh": {
      const minutes = a.kind === "hours" ? Math.round(Number(a.hours || 2) * 60) : null;
      return { summary: `Request work from home on ${a.date} (${a.kind === "hours" ? hrs(minutes!) : a.kind === "half" ? "half day" : "full day"})${a.reason ? `. Reason: “${a.reason}”` : ""}`,
        method: "POST", path: "/wfh", body: { date: a.date, kind: a.kind, minutes, reason: a.reason ?? "" }, done: `Work from home requested for ${a.date}.` };
    }
    case "update_task": {
      const p = await project(c, a.project);
      const d = ok(await selfCall(c.req, "GET", `/projects/${p.id}`));
      const t = pickOne(d.tasks, a.task, ["title"], "task");
      const word: Record<string, string> = { todo: "To do", in_progress: "In progress", review: "In review", done: "Done" };
      return { summary: `Move the task “${t.title}” on ${p.name} from ${word[t.status] ?? t.status} to ${word[a.status]}`, method: "PUT", path: `/tasks/${t.id}`, body: { status: a.status }, done: `“${t.title}” is now ${word[a.status]}.` };
    }
    case "decide_sheet": {
      const who = await person(c, a.person);
      const list = ok(await selfCall(c.req, "GET", "/approvals/sheets")) as any[];
      const s = list.find((x) => (x.user_id === who.id) && x.date === a.date);
      if (!s) throw new ToolError(`There's no sheet from ${who.name} for ${a.date} waiting for you.`);
      const approve = a.decision === "approve";
      return { summary: `${approve ? "Approve" : "Send back"} ${who.name}'s sheet for ${a.date}${!approve && a.reason ? ` (“${a.reason}”)` : ""}`,
        method: "POST", path: `/approvals/sheets/${s.id}/${approve ? "approve" : "reject"}`, body: approve ? {} : { reason: a.reason ?? "" },
        done: `${approve ? "Approved" : "Sent back"} ${who.name}'s sheet for ${a.date}.` };
    }
  }
  throw new ToolError(`Unknown tool ${name}`);
}
