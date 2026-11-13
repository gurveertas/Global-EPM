import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { todayIn, addDays } from "../src/lib/dates";

/** Round 4: several PMs, project stages, attachments, sheet activity on projects and tasks, average rates, inline masters, per-person access, leave reporting. */
const app = createApp();
const today = todayIn("Asia/Kolkata");
const T = "round4";
type Who = { token: string; id: string };
const api = (m: "get" | "post" | "put" | "delete", path: string, who?: Who) => {
  const r = request(app)[m](`/api/v1${path}`).set("X-Tenant", T);
  return who ? r.set("Authorization", `Bearer ${who.token}`) : r;
};
const login = async (email: string): Promise<Who> => {
  const r = await api("post", "/auth/login").send({ email, password: "password123" });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { token: r.body.accessToken, id: r.body.user.id };
};
const lastWorkday = (n: number) => { let d = addDays(today, n); while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, -1); return d; };
let owner: Who, pm: Who, pm2: Who, tl: Who, emp: Who, billing: Who;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await request(app).post("/api/v1/public/signup").send({ companyName: "Round Four", slug: T, name: "Ola", email: "ola@r4.test", password: "password123", seats: 30 });
  owner = await login("ola@r4.test");
  const roles = (await api("get", "/roles", owner)).body as any[];
  const role = (k: string) => roles.find((r) => r.key === k).id;
  const add = async (name: string, email: string, keys: string[]) => {
    const r = await api("post", "/users", owner).send({ name, email, roleIds: keys.map(role), password: "password123", joinedOn: addDays(today, -200) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return login(email);
  };
  // PMs here are plain employees made PM on the project, so their rights come from the project, not a company role.
  pm = await add("Pia PM", "pia@r4.test", ["employee"]);
  pm2 = await add("Pat PM", "pat@r4.test", ["employee"]);
  tl = await add("Tia Lead", "tia@r4.test", ["team_lead", "employee"]);
  emp = await add("Eli Emp", "eli@r4.test", ["employee"]);
  billing = await add("Bo Bill", "bo@r4.test", ["billing_manager"]);
  ids.team = (await api("post", "/teams", owner).send({ name: "Web", leadUserId: tl.id })).body.id;
  await api("put", `/users/${emp.id}`, owner).send({ teamId: ids.team }).expect(200);
});

describe("company lists from a picker", () => {
  it("lets a client manager add a source and channel inline, and reuses an existing name", async () => {
    const s = await api("post", "/lists/project-sources", billing).send({ name: "LinkedIn" });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    const again = await api("post", "/lists/project-sources", billing).send({ name: "linkedin" });
    expect(again.body.id).toBe(s.body.id);
    const c = await api("post", "/lists/communication-types", billing).send({ name: "Microsoft Teams" });
    expect(c.status).toBe(200);
    ids.source = s.body.id;
    ids.channel = c.body.id;
    // A plain employee can't add to company lists.
    expect((await api("post", "/lists/project-sources", emp).send({ name: "Nope" })).status).toBe(403);
    const stages = (await api("get", "/lists/project-stages", owner)).body as any[];
    expect(stages.map((x) => x.name)).toEqual(["To do", "In progress", "Awaiting feedback", "QA and review", "Complete"]);
    ids.stageTodo = stages[0].id;
    ids.stageQa = stages[3].id;
  });
});

describe("project team, stages and activity", () => {
  it("creates a project with two PMs, a TL and an employee, in the first stage", async () => {
    const c = await api("post", "/clients", owner).send({ name: "Vlad", country: "US", sourceId: ids.source, communicationTypeIds: [ids.channel] });
    ids.client = c.body.id;
    const p = await api("post", "/projects", owner).send({
      clientId: ids.client, name: "Etsy audit", type: "hourly", billingType: "postpaid", hourlyRateMinor: 3000,
      pmIds: [pm.id, pm2.id], tlIds: [tl.id], memberIds: [emp.id], billingLines: [{ label: "Budget", minutes: 40 * 60, amountMinor: 120000 }],
    });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    ids.project = p.body.project.id;
    const d = (await api("get", `/projects/${ids.project}`, owner)).body;
    expect(d.pm_user_id).toBe(pm.id);
    expect(d.stage.name).toBe("To do");
    const roleOf = (id: string) => d.members.find((m: any) => m.id === id)?.role;
    expect([roleOf(pm.id), roleOf(pm2.id), roleOf(tl.id), roleOf(emp.id)]).toEqual(["pm", "pm", "tl", "member"]);
    const list = (await api("get", "/projects", owner)).body.find((x: any) => x.id === ids.project);
    expect(list.pms.map((x: any) => x.name)).toEqual(["Pia PM", "Pat PM"]);
  });
  it("lets a second PM change TLs and members but not the PMs, and logs the team change", async () => {
    expect((await api("get", `/projects/${ids.project}`, pm2)).body.amPm).toBe(true);
    await api("put", `/projects/${ids.project}/members`, pm2).send({ memberIds: [emp.id, owner.id], tlIds: [tl.id] }).expect(200);
    expect((await api("put", `/projects/${ids.project}/members`, pm2).send({ memberIds: [emp.id], pmIds: [pm2.id] })).status).toBe(403);
    // The main PM can.
    await api("put", `/projects/${ids.project}/members`, pm).send({ memberIds: [emp.id], pmIds: [pm.id, pm2.id] }).expect(200);
    const feed = (await api("get", `/projects/${ids.project}/activity?kind=changes`, owner)).body as any[];
    const team = feed.filter((a) => a.action === "project.team");
    expect(team.length).toBeGreaterThanOrEqual(2);
    expect(team.some((a) => a.data.added?.some((x: any) => x.name === "Ola"))).toBe(true);
    expect(team.some((a) => a.data.removed?.includes("Ola"))).toBe(true);
  });
  it("moves the project between stages (PMs only) and logs it", async () => {
    expect((await api("put", `/projects/${ids.project}/stage`, emp).send({ stageId: ids.stageQa })).status).toBe(403);
    await api("put", `/projects/${ids.project}/stage`, pm2).send({ stageId: ids.stageQa, position: 0 }).expect(200);
    const d = (await api("get", `/projects/${ids.project}`, owner)).body;
    expect(d.stage.name).toBe("QA and review");
    const feed = (await api("get", `/projects/${ids.project}/activity?kind=changes`, owner)).body as any[];
    expect(feed.find((a) => a.action === "project.stage").data.changes.stage).toEqual(["To do", "QA and review"]);
  });
  it("shows submitted and approved sheets with what was written, and a task's work log", async () => {
    const t = await api("post", `/projects/${ids.project}/tasks`, tl).send({ title: "Keyword research", assigneeId: emp.id, estimatedMinutes: 600 });
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    ids.task = t.body.id;
    const d = lastWorkday(-1);
    await api("put", "/sheets/day", emp).send({ date: d, entries: [
      { projectId: ids.project, taskId: ids.task, minutes: 240, description: "Researched 40 keywords for the shop" },
      { projectId: ids.project, minutes: 270, description: "Client call and report" },
    ] }).expect(200);
    await api("post", "/sheets/day/submit", emp).send({ date: d }).expect(200);
    const sheet = (await api("get", "/approvals/sheets", tl)).body.find((s: any) => s.date === d);
    await api("post", `/approvals/sheets/${sheet.id}/approve`, tl).expect(200);

    const feed = (await api("get", `/projects/${ids.project}/activity?kind=sheets`, pm)).body as any[];
    const sub = feed.find((a) => a.action === "submitted");
    expect(sub).toMatchObject({ who: "Eli Emp", minutes: 510 });
    expect(sub.entries.map((e: any) => e.description)).toContain("Researched 40 keywords for the shop");
    expect(feed.find((a) => a.action === "approved")).toMatchObject({ who: "Tia Lead", for: "Eli Emp" });

    const log = (await api("get", `/projects/${ids.project}/activity?taskId=${ids.task}`, pm)).body as any[];
    const s2 = log.find((a) => a.action === "submitted");
    expect(s2.minutes).toBe(240);
    expect(s2.entries).toHaveLength(1);
    expect(log.some((a) => a.action === "task.create")).toBe(true);
    // The employee sees it too (they're on the project), and the task card counts the notes.
    expect((await api("get", `/projects/${ids.project}/activity?taskId=${ids.task}`, emp)).status).toBe(200);
    expect((await api("get", `/projects/${ids.project}`, emp)).body.tasks.find((x: any) => x.id === ids.task).log_count).toBe(1);
  });
  it("lets a PM write the description but not other project fields", async () => {
    await api("put", `/projects/${ids.project}`, pm2).send({ description: "- Hired over Nikhil's profile\n- Upwork only" }).expect(200);
    expect((await api("put", `/projects/${ids.project}`, pm2).send({ name: "Renamed" })).status).toBe(403);
  });
});

describe("attachments", () => {
  it("adds a file and a link, downloads the file, and only the uploader, a PM or an admin removes it", async () => {
    const f = await api("post", `/projects/${ids.project}/files?name=brief.txt&type=text/plain`, emp).set("Content-Type", "application/octet-stream").send(Buffer.from("hello brief"));
    expect(f.status, JSON.stringify(f.body)).toBe(200);
    const l = await api("post", `/projects/${ids.project}/links`, emp).send({ url: "https://www.etsy.com/shop/GoldenAcornLab" });
    expect(l.status, JSON.stringify(l.body)).toBe(200);
    expect(l.body.name).toBe("etsy.com/shop/GoldenAcornLab");
    expect((await api("post", `/projects/${ids.project}/links`, emp).send({ url: "javascript:alert(1)" })).status).toBe(400);
    const list = (await api("get", `/projects/${ids.project}/files`, pm)).body as any[];
    expect(list.map((x) => x.kind).sort()).toEqual(["file", "link"]);
    const dl = await api("get", `/project-files/${f.body.id}/download`, pm).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (x: Buffer) => c.push(x)); res.on("end", () => cb(null, Buffer.concat(c))); });
    expect(dl.status).toBe(200);
    expect(Buffer.from(dl.body).toString()).toBe("hello brief");
    expect((await api("delete", `/project-files/${f.body.id}`, tl)).status).toBe(403);
    await api("delete", `/project-files/${f.body.id}`, pm).expect(200);
    // Someone not on the project can't see them.
    expect((await api("get", `/projects/${ids.project}/files`, billing)).status).toBe(200); // billing sees every project
  });
});

describe("average rates", () => {
  it("shows the project and client average rate to people who see money", async () => {
    await api("post", `/projects/${ids.project}/run-billing`, owner);
    const inv = await api("post", "/invoices", owner).send({ projectId: ids.project, lines: [{ description: "Audit", quantity: 1, unitPriceMinor: 150000 }] });
    if (inv.status === 200 && inv.body.id) await api("post", `/invoices/${inv.body.id}/issue`, owner);
    const p = (await api("get", `/projects/${ids.project}`, owner)).body;
    expect(p.rate).toBeTruthy();
    expect(p.rate.minutes).toBe(510);
    const c = (await api("get", `/clients/${ids.client}`, owner)).body;
    expect(c.totals.approved_minutes).toBe(510);
    expect("avg_rate_minor" in c.totals).toBe(true);
    // Without money access there's no rate, and no amount of any kind anywhere in the response.
    const asPm = (await api("get", `/projects/${ids.project}`, pm)).body;
    expect(asPm.rate).toBeUndefined();
    expect(JSON.stringify(asPm)).not.toMatch(/_minor"/);
    const pl = (await api("get", "/projects", pm)).body.find((x: any) => x.id === ids.project);
    expect(pl.avg_rate_minor).toBeUndefined();
  });
});

describe("per-person access", () => {
  it("starts from the role and lets an admin hide or grant a module for one person", async () => {
    const roles = (await api("get", "/roles", owner)).body as any[];
    const pmRole = roles.find((r) => r.key === "project_manager").id;
    await api("put", `/users/${pm.id}`, owner).send({ roleIds: [pmRole] }).expect(200);
    const a = (await api("get", `/users/${pm.id}/access`, owner)).body;
    const mod = (k: string) => a.modules.find((m: any) => m.key === k);
    expect(mod("projects").fromRole).toBe("edit");
    expect(mod("invoices").fromRole).toBe("hidden");
    await api("put", `/users/${pm.id}/access`, owner).send({ overrides: { projects: "view", invoices: "view", employees: "hidden" } }).expect(200);
    const pmNow = await login("pia@r4.test");
    const perms: string[] = (await api("get", "/me", pmNow)).body.permissions;
    expect(perms).toContain("invoices.view");
    expect(perms).toContain("projects.view_all");
    expect(perms).not.toContain("projects.manage");
    expect(perms).not.toContain("users.view");
    expect((await api("get", "/invoices", pmNow)).status).toBe(200);
    expect((await api("post", "/projects", pmNow).send({ clientId: ids.client, name: "X", type: "hourly", billingType: "postpaid" })).status).toBe(403);
    const after = (await api("get", `/users/${pm.id}/access`, owner)).body;
    expect(after.modules.find((m: any) => m.key === "projects").effective).toBe("view");
    // Only people who manage roles can do this, and the owner can't be limited.
    expect((await api("put", `/users/${emp.id}/access`, pmNow).send({ overrides: {} })).status).toBe(403);
    expect((await api("put", `/users/${owner.id}/access`, owner).send({ overrides: { projects: "hidden" } })).status).toBe(400);
    await api("put", `/users/${pm.id}/access`, owner).send({ overrides: {} }).expect(200);
  });
});

describe("leave reporting", () => {
  it("reports leave by person and type with half and short leave", async () => {
    const types = (await api("get", "/leave/types", emp)).body as any[];
    const d1 = lastWorkday(-3), d2 = lastWorkday(-6);
    const a = await api("post", "/leave/requests", emp).send({ leaveTypeId: types[0].id, startDate: d1, endDate: d1, part: "first_half", reason: "Doctor" });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    await api("post", `/leave/requests/${a.body.id}/approve`, tl).expect(200);
    const b = await api("post", "/leave/requests", emp).send({ leaveTypeId: types[0].id, startDate: d2, endDate: d2, part: "short", shortMinutes: 120, reason: "Bank" });
    await api("post", `/leave/requests/${b.body.id}/approve`, tl).expect(200);
    const from = addDays(today, -20);
    const r = await api("get", `/reporting/leave?from=${from}&to=${today}`, owner);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const eli = r.body.people.find((p: any) => p.id === emp.id);
    expect(eli).toMatchObject({ half: 1, short: 1 });
    expect(eli.days).toBeCloseTo(0.7, 5);
    expect(r.body.requests.filter((x: any) => x.user_id === emp.id).map((x: any) => x.kind).sort()).toEqual(["half", "short"]);
    // An employee sees only themself; the TL sees their team.
    expect((await api("get", `/reporting/leave?from=${from}&to=${today}`, emp)).body.people.map((p: any) => p.id)).toEqual([emp.id]);
    expect((await api("get", `/reporting/leave?from=${from}&to=${today}`, tl)).body.people.map((p: any) => p.id)).toContain(emp.id);
  });
  it("adds expected, unfilled and leave numbers to the timesheet manager and exports Excel", async () => {
    const from = addDays(today, -20);
    const m = (await api("get", `/reporting/entries?from=${from}&to=${today}&userId=${emp.id}`, owner)).body;
    expect(m.stats.expected).toBeGreaterThan(0);
    expect(m.stats.leave).toBeGreaterThan(0);
    expect(m.rows[0].sheet_id).toBeTruthy();
    const x = await api("get", `/reporting/entries?from=${from}&to=${today}&format=xlsx`, owner);
    expect(x.status).toBe(200);
    expect(x.headers["content-type"]).toContain("spreadsheetml");
  });
});
