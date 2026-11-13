import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { todayIn, addDays } from "../src/lib/dates";

/** Round 5: who assigns people to projects, Team Leads limited to their own team, the role report, and the Astra assistant. */
const app = createApp();
const today = todayIn("Asia/Kolkata");
const T = "round5";
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
let owner: Who, billing: Who, salesTl: Who, pmRole: Who, tlA: Who, tlB: Who, empA: Who, empB: Who;
const ids: Record<string, string> = {};
let nextWorkday = today;
while ([0, 6].includes(new Date(`${nextWorkday}T00:00:00Z`).getUTCDay())) nextWorkday = addDays(nextWorkday, 1);

beforeAll(async () => {
  await request(app).post("/api/v1/public/signup").send({ companyName: "Round Five", slug: T, name: "Oma", email: "oma@r5.test", password: "password123", seats: 30 });
  owner = await login("oma@r5.test");
  const roles = (await api("get", "/roles", owner)).body as any[];
  const role = (k: string) => roles.find((r) => r.key === k).id;
  const add = async (name: string, email: string, keys: string[]) => {
    const r = await api("post", "/users", owner).send({ name, email, roleIds: keys.map(role), password: "password123", joinedOn: addDays(today, -200) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return login(email);
  };
  billing = await add("Bea Billing", "bea@r5.test", ["billing_manager"]);
  salesTl = await add("Sam Sales", "sam@r5.test", ["sales_tl"]);
  pmRole = await add("Pam PM", "pam@r5.test", ["project_manager"]);
  tlA = await add("Ana TL", "ana@r5.test", ["team_lead", "employee"]);
  tlB = await add("Ben TL", "ben@r5.test", ["team_lead", "employee"]);
  empA = await add("Amy A", "amy@r5.test", ["employee"]);
  empB = await add("Bob B", "bob@r5.test", ["employee"]);
  ids.teamA = (await api("post", "/teams", owner).send({ name: "Alpha", leadUserId: tlA.id })).body.id;
  ids.teamB = (await api("post", "/teams", owner).send({ name: "Beta", leadUserId: tlB.id })).body.id;
  await api("put", `/users/${empA.id}`, owner).send({ teamId: ids.teamA }).expect(200);
  await api("put", `/users/${empB.id}`, owner).send({ teamId: ids.teamB }).expect(200);
  ids.client = (await api("post", "/clients", owner).send({ name: "Zed", country: "US" })).body.id;
});

describe("project assignment", () => {
  it("lets Billing and Sales assign PMs and TLs, but not a PM-role user", async () => {
    const p = await api("post", "/projects", salesTl).send({ clientId: ids.client, name: "Alpha site", type: "hourly", billingType: "postpaid", hourlyRateMinor: 1000, pmIds: [pmRole.id], tlIds: [tlA.id], memberIds: [] });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    ids.project = p.body.project.id;
    // The PM role can create projects but not set who runs them.
    expect((await api("post", "/projects", pmRole).send({ clientId: ids.client, name: "X", type: "hourly", billingType: "postpaid", pmIds: [tlA.id] })).status).toBe(403);
    // Billing can add a second TL; the PM can't.
    await api("put", `/projects/${ids.project}/members`, billing).send({ memberIds: [], tlIds: [tlA.id, tlB.id] }).expect(200);
    expect((await api("put", `/projects/${ids.project}/members`, pmRole).send({ memberIds: [], tlIds: [tlA.id] })).status).toBe(403);
    // The PM can still add employees.
    await api("put", `/projects/${ids.project}/members`, pmRole).send({ memberIds: [empA.id] }).expect(200);
  });
  it("lets a Team Lead add only people from their own team", async () => {
    expect((await api("put", `/projects/${ids.project}/members`, tlA).send({ memberIds: [empA.id, empB.id] })).status).toBe(403);
    await api("put", `/projects/${ids.project}/members`, tlB).send({ memberIds: [empA.id, empB.id] }).expect(200);
    // And can't remove someone from another team either.
    const r = await api("put", `/projects/${ids.project}/members`, tlA).send({ memberIds: [empA.id] });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toContain("Bob B");
    const d = (await api("get", `/projects/${ids.project}`, owner)).body;
    expect(d.members.map((m: any) => m.name).sort()).toEqual(["Amy A", "Ana TL", "Ben TL", "Bob B", "Pam PM"]);
  });
});

describe("role report on a person's page", () => {
  it("shows the team for a Team Lead, projects they run, and sales for sales people", async () => {
    const r = (await api("get", `/reporting/person/${tlA.id}/role`, owner)).body;
    expect(r.sections.map((s: any) => s.kind)).toEqual(expect.arrayContaining(["team", "projects"]));
    expect(r.sections.find((s: any) => s.kind === "team").people.map((p: any) => p.name)).toEqual(["Amy A"]);
    const s = (await api("get", `/reporting/person/${salesTl.id}/role`, owner)).body;
    expect(s.sections.map((x: any) => x.kind)).toContain("sales");
    const b = (await api("get", `/reporting/person/${billing.id}/role`, owner)).body;
    expect(b.sections.map((x: any) => x.kind)).toContain("billing");
    // An employee can't see someone else's report.
    expect((await api("get", `/reporting/person/${tlA.id}/role`, empB)).status).toBe(403);
  });
});

describe("assistant", () => {
  it("is not ready until a key is added; only admins see and set keys", async () => {
    expect((await api("get", "/assistant/info", empA)).body).toMatchObject({ name: "Astra", ready: false });
    expect((await api("post", "/assistant/chat", empA).send({ message: "hi" })).status).toBe(400);
    expect((await api("put", "/assistant/keys/anthropic", empA).send({ key: "test-key-123456" })).status).toBe(403);
    await api("put", "/assistant/keys/anthropic", owner).send({ key: "test-key-123456" }).expect(200);
    const keys = (await api("get", "/assistant/keys", owner)).body;
    expect(keys.find((k: any) => k.provider === "anthropic")).toMatchObject({ hasKey: true, last4: "3456" });
    expect(JSON.stringify(keys)).not.toContain("test-key");
    await api("put", "/settings", owner).send({ assistant: { name: "Nova", icon: "rocket" } }).expect(200);
    expect((await api("get", "/assistant/info", empA)).body).toMatchObject({ name: "Nova", icon: "rocket", ready: true });
  });
  it("answers from tools with the person's own access", async () => {
    const r = await api("post", "/assistant/chat", empA).send({ message: "show my projects" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.tools).toContain("list_projects");
    expect(r.body.reply).toContain("Alpha site");
    // An employee can't use approvals; the tool isn't offered, so it falls back to a normal reply.
    const a = await api("post", "/assistant/chat", empA).send({ message: "pending approvals", conversationId: r.body.conversationId });
    expect(a.body.tools ?? []).not.toContain("pending_approvals");
    const conv = (await api("get", `/assistant/conversations/${r.body.conversationId}`, empA)).body;
    expect(conv.messages.filter((m: any) => m.role === "user")).toHaveLength(2);
    // Someone else can't read it.
    expect((await api("get", `/assistant/conversations/${r.body.conversationId}`, empB)).body.messages).toHaveLength(0);
  });
  it("prepares a change and only does it once the person confirms", async () => {
    const r = await api("post", "/assistant/chat", empA).send({ message: "log 2h on alpha site for testing" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.actions).toHaveLength(1);
    const act = r.body.actions[0];
    expect(act.summary).toContain("Log 2h on Alpha site");
    // Nothing saved yet.
    expect((await api("get", `/sheets/day?date=${today}`, empA)).body.entries).toHaveLength(0);
    expect((await api("post", `/assistant/actions/${act.id}/confirm`, empB)).status).toBe(404);
    const c = await api("post", `/assistant/actions/${act.id}/confirm`, empA);
    expect(c.body.status, JSON.stringify(c.body)).toBe("done");
    expect((await api("get", `/sheets/day?date=${today}`, empA)).body.entries[0]).toMatchObject({ minutes: 120, description: "Logged from chat" });
    expect((await api("post", `/assistant/actions/${act.id}/confirm`, empA)).status).toBe(400);
  });
  it("prepares leave and can be declined; a refused change reports the reason", async () => {
    const r = await api("post", "/assistant/chat", empA).send({ message: `apply leave on ${nextWorkday}` });
    expect(r.body.actions).toHaveLength(1);
    const d = await api("post", `/assistant/actions/${r.body.actions[0].id}/decline`, empA);
    expect(d.body.status).toBe("declined");
    expect(((await api("get", "/leave/requests?scope=mine", empA)).body as any[]).length).toBe(0);
    // Bob isn't on the project after all? He is (TL B added him). Remove him, then he can't log there.
    const bad = await api("post", "/assistant/chat", empB).send({ message: "log 1h on nothing real for x" });
    expect(bad.body.actions ?? []).toHaveLength(0);
    expect(bad.body.reply).toContain("error");
  });
});
