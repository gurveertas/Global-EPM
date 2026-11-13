import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { todayIn, addDays } from "../src/lib/dates";

/** Round 3: the rest of the old EPM (employees, clients, project assignment, reporting, notes, accessory requests). */
const app = createApp();
const today = todayIn("Asia/Kolkata");
const T = "round3";
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
let owner: Who, tl: Who, emp: Who;
const ids: Record<string, string> = {};
const lastWorkday = (n: number) => { let d = addDays(today, n); while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, -1); return d; };

beforeAll(async () => {
  await request(app).post("/api/v1/public/signup").send({ companyName: "Round Three", slug: T, name: "Ora", email: "ora@r3.test", password: "password123", seats: 30 });
  owner = await login("ora@r3.test");
  // This file checks kinds of work that come from the detailed work types (Masters).
  await api("put", "/settings", owner).send({ policies: { workTypeMode: "detailed" } });
  const roles = (await api("get", "/roles", owner)).body as any[];
  const role = (k: string) => roles.find((r) => r.key === k).id;
  // An admin can set the password directly instead of inviting.
  const t = await api("post", "/users", owner).send({ name: "Tom Lead", email: "tom@r3.test", roleIds: [role("team_lead"), role("employee")], password: "password123", employeeCode: "R3-001", joinedOn: addDays(today, -300) });
  expect(t.status, JSON.stringify(t.body)).toBe(200);
  expect(t.body.inviteUrl).toBeNull();
  tl = await login("tom@r3.test");
  ids.team = (await api("post", "/teams", owner).send({ name: "Web", leadUserId: tl.id })).body.id;
  const e = await api("post", "/users", owner).send({ name: "Ema Emp", email: "ema@r3.test", roleIds: [role("employee")], password: "password123", teamId: ids.team,
    employeeCode: "R3-002", employmentStatus: "provisional", designation: "Developer", joinedOn: addDays(today, -60) });
  expect(e.status, JSON.stringify(e.body)).toBe(200);
  emp = await login("ema@r3.test");
});

describe("employees", () => {
  it("keeps employee ID, employment status, designation and reporting manager", async () => {
    await api("put", `/users/${emp.id}`, owner).send({ reportingManagerId: tl.id }).expect(200);
    const u = (await api("get", `/users/${emp.id}`, owner)).body;
    expect(u).toMatchObject({ employee_code: "R3-002", employment_status: "provisional", designation: "Developer", reporting_manager_name: "Tom Lead" });
  });
  it("rejects a duplicate employee ID", async () => {
    const r = await api("put", `/users/${tl.id}`, owner).send({ employeeCode: "R3-002" });
    expect(r.status).toBe(409);
  });
});

describe("clients and projects", () => {
  it("stores Upwork hiring details on a client and returns a full client page", async () => {
    const c = await api("post", "/clients", owner).send({ name: "Mia", company: "BrightCart", clientType: "upwork", hiringId: "UPW-77", contactName: "Mia Chen", country: "US" });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    ids.client = c.body.id;
    ids.internalClient = (await api("post", "/clients", owner).send({ name: "Us", country: "IN" })).body.id;
    const d = (await api("get", `/clients/${ids.client}`, owner)).body;
    expect(d).toMatchObject({ client_type: "upwork", hiring_id: "UPW-77", contact_name: "Mia Chen" });
    expect(d.totals).toBeDefined();
    await api("post", `/clients/${ids.client}/comments`, owner).send({ body: "Prefers Slack" }).expect(200);
  });
  it("assigns a TL when the project is created, and the TL assigns members", async () => {
    const p = await api("post", "/projects", owner).send({
      clientId: ids.client, name: "Store", type: "hourly", billingType: "postpaid", hourlyRateMinor: 2000, tlIds: [tl.id], tags: ["shopify"],
      billingLines: [{ label: "Budget", minutes: 100 * 60, amountMinor: 200000 }],
    });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    ids.project = p.body.project.id;
    let a = (await api("get", "/assignments", tl)).body.projects.find((x: any) => x.id === ids.project);
    expect(a.tls.map((x: any) => x.id)).toEqual([tl.id]);
    expect(a.members).toEqual([]);
    await api("put", `/projects/${ids.project}/members`, tl).send({ memberIds: [emp.id] }).expect(200);
    a = (await api("get", "/assignments", tl)).body.projects.find((x: any) => x.id === ids.project);
    expect(a.members.map((x: any) => x.id)).toEqual([emp.id]);
    // A TL can't change the TLs.
    expect((await api("put", `/projects/${ids.project}/members`, tl).send({ memberIds: [emp.id], tlIds: [] })).status).toBe(403);
    const internal = await api("post", "/projects", owner).send({ clientId: ids.internalClient, name: "Internal", type: "hourly", billingType: "postpaid", hourlyRateMinor: 0, isInternal: true, memberIds: [emp.id, tl.id] });
    ids.internal = internal.body.project.id;
  });
  it("transfers a project's TL to someone else", async () => {
    const r = await api("post", "/assignments/transfer", owner).send({ fromUserId: tl.id, toUserId: owner.id, role: "tl", projectIds: [ids.project] });
    expect(r.body.moved).toBe(1);
    await api("post", "/assignments/transfer", owner).send({ fromUserId: owner.id, toUserId: tl.id, role: "tl", projectIds: [ids.project] }).expect(200);
  });
  it("keeps task details and statuses", async () => {
    const t = await api("post", `/projects/${ids.project}/tasks`, owner).send({ title: "Checkout", assigneeId: emp.id, priority: "high", description: "Validate cards", status: "in_progress", estimatedMinutes: 600 });
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    await api("put", `/tasks/${t.body.id}`, emp).send({ status: "review" }).expect(200);
    const list = (await api("get", `/projects/${ids.project}/tasks`, owner)).body;
    expect(list[0]).toMatchObject({ status: "review", priority: "high", description: "Validate cards" });
  });
});

describe("reporting", () => {
  it("splits hours into billable, in-house and no work, and counts unfilled days", async () => {
    const acts = (await api("get", "/lists/activity-types", owner)).body as any[];
    const dev = acts.find((a) => a.name === "Development").id;
    const idle = (await api("post", "/lists/activity-types", owner).send({ name: "Waiting for client", category: "no_work" })).body.id;
    const d = lastWorkday(-1);
    const save = await api("put", "/sheets/day", emp).send({ date: d, entries: [
      { projectId: ids.project, minutes: 300, activityTypeId: dev, description: "Cart" },
      { projectId: ids.project, minutes: 60, activityTypeId: idle },
      { projectId: ids.internal, minutes: 150, description: "Training" },
    ] });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    await api("post", "/sheets/day/submit", emp).send({ date: d }).expect(200);
    const sheet = (await api("get", "/approvals/sheets", tl)).body.find((s: any) => s.date === d);
    await api("post", `/approvals/sheets/${sheet.id}/approve`, tl).expect(200);

    const r = await api("get", `/reporting/utilization?from=${d}&to=${d}`, owner);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const me = r.body.people.find((p: any) => p.user_id === emp.id);
    expect(me).toMatchObject({ expected: 510, billable: 300, no_work: 60, inhouse: 150, approved: 510, unfilled: 0 });
    const tom = r.body.people.find((p: any) => p.user_id === tl.id);
    expect(tom.unfilled).toBe(510);
    expect(tom.unfilled_days).toEqual([d]);
    expect(r.body.teams.find((t: any) => t.team_name === "Web").people).toBe(2);
  });
  it("lets a TL see only their people, and an employee only themself", async () => {
    const d = lastWorkday(-1);
    const asEmp = (await api("get", `/reporting/utilization?from=${d}&to=${d}`, emp)).body.people;
    expect(asEmp.map((p: any) => p.user_id)).toEqual([emp.id]);
    const asTl = (await api("get", `/reporting/utilization?from=${d}&to=${d}`, tl)).body.people.map((p: any) => p.user_id).sort();
    expect(asTl).toEqual([emp.id, tl.id].sort());
    expect((await api("get", `/reporting/person/${tl.id}`, emp)).status).toBe(403);
  });
  it("returns attendance, unfilled sheets, the master report and a person report", async () => {
    const d = lastWorkday(-1);
    const att = (await api("get", `/reporting/attendance?from=${d}&to=${d}`, owner)).body;
    expect(att.people.find((p: any) => p.user_id === emp.id).days[0].status).toBe("present");
    expect(att.people.find((p: any) => p.user_id === tl.id).days[0].status).toBe("absent");
    const un = (await api("get", `/reporting/unfilled?from=${d}&to=${d}`, owner)).body;
    expect(un.rows.map((r: any) => r.user_id)).toContain(tl.id);
    const m = (await api("get", `/reporting/entries?from=${d}&to=${d}&category=no_work`, owner)).body;
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].minutes).toBe(60);
    const p = (await api("get", `/reporting/person/${emp.id}?from=${d}&to=${d}`, owner)).body;
    expect(p.entries).toHaveLength(3);
    expect(p.byProject[0].project_name).toBe("Store");
    const o = (await api("get", `/users/${emp.id}/overview?from=${d}&to=${d}`, owner)).body;
    expect(o.projects.map((x: any) => x.name).sort()).toEqual(["Internal", "Store"]);
    expect(o.stats.billable).toBe(300);
  });
  it("counts a short leave as a few hours off the day", async () => {
    const types = (await api("get", "/leave/types", emp)).body as any[];
    const d = lastWorkday(-2);
    const r = await api("post", "/leave/requests", emp).send({ leaveTypeId: types[0].id, startDate: d, endDate: d, part: "short", shortMinutes: 120, reason: "Bank" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(Number(r.body.days)).toBe(0.2);
    await api("post", `/leave/requests/${r.body.id}/approve`, tl).expect(200);
    const day = (await api("get", `/sheets/day?date=${d}`, emp)).body;
    expect(day.expected.minutes).toBe(390);
  });
});

describe("notes and accessory requests", () => {
  it("keeps private and shared notes", async () => {
    await api("post", "/notes", emp).send({ body: "Remember the demo" }).expect(200);
    expect((await api("post", "/notes", emp).send({ body: "For all", visibility: "everyone" })).status).toBe(403);
    await api("post", "/notes", owner).send({ title: "Policy", body: "Office closes at 7", visibility: "everyone" }).expect(200);
    const mine = (await api("get", "/notes", emp)).body.map((n: any) => n.body).sort();
    expect(mine).toEqual(["Office closes at 7", "Remember the demo"]);
    expect((await api("get", "/notes", tl)).body.map((n: any) => n.body)).toEqual(["Office closes at 7"]);
  });
  it("lets an employee ask for an accessory and HR answer", async () => {
    const r = await api("post", "/asset-requests", emp).send({ kind: "new", category: "Monitor", details: "Second screen for design work", priority: "low" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await api("post", `/asset-requests/${r.body.id}/decide`, owner).send({ status: "done", response: "On your desk" }).expect(200);
    const mine = (await api("get", "/asset-requests", emp)).body;
    expect(mine[0]).toMatchObject({ status: "done", response: "On your desk" });
  });
});
