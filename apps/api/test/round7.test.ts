import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { describeSchedule, firstRun, nextRun, prevRun, upcomingRuns } from "@eszy/shared";
import { createApp } from "../src/app";
import { todayIn, addDays, dayOfWeek } from "../src/lib/dates";
import { chat } from "../src/services/assistant/providers";

/** Round 7: Gemini thought signatures, deactivating people, recurring invoice schedules, and the activity history. */
const app = createApp();
const today = todayIn("Asia/Kolkata");
const T = "round7";
type Who = { token: string; id: string };
const api = (m: "get" | "post" | "put" | "delete", path: string, who?: Who) => {
  const r = request(app)[m](`/api/v1${path}`).set("X-Tenant", T);
  return who ? r.set("Authorization", `Bearer ${who.token}`) : r;
};
const login = async (email: string, ok = true): Promise<Who> => {
  const r = await api("post", "/auth/login").send({ email, password: "password123" });
  if (ok) expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { token: r.body.accessToken, id: r.body.user?.id };
};
let owner: Who, billing: Who, emp: Who;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await request(app).post("/api/v1/public/signup").send({ companyName: "Round Seven", slug: T, name: "Ola", email: "ola@r7.test", password: "password123", seats: 30 });
  owner = await login("ola@r7.test");
  const roles = (await api("get", "/roles", owner)).body as any[];
  const role = (k: string) => roles.find((r) => r.key === k).id;
  const add = async (name: string, email: string, keys: string[]) => {
    const r = await api("post", "/users", owner).send({ name, email, roleIds: keys.map(role), password: "password123", joinedOn: addDays(today, -100) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return login(email);
  };
  billing = await add("Bo Billing", "bo@r7.test", ["billing_manager"]);
  emp = await add("Eve Emp", "eve@r7.test", ["employee"]);
  ids.client = (await api("post", "/clients", owner).send({ name: "Acme", country: "US" })).body.id;
});

describe("Gemini thought signatures", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends Gemini's own reply back, signature included, on the next step", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      const parts = bodies.length === 1
        ? [{ functionCall: { name: "my_profile", args: {} }, thoughtSignature: "SIG-1" }]
        : [{ text: "Done" }];
      return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] }), { status: 200 });
    }));
    const tools = [{ name: "my_profile", description: "x", parameters: { type: "object", properties: {} } }] as any;
    const first = await chat({ provider: "gemini", key: "k", model: "gemini-2.5-flash", system: "s", messages: [{ role: "user", content: "hi" }], tools });
    expect(first.toolCalls[0].sig).toBe("SIG-1");
    await chat({ provider: "gemini", key: "k", model: "gemini-2.5-flash", system: "s", tools, messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", toolCalls: first.toolCalls, raw: first.raw },
      { role: "tool", toolCallId: first.toolCalls[0].id, name: "my_profile", content: "{}" },
    ] });
    const model = bodies[1].contents.find((c: any) => c.role === "model");
    expect(model.parts[0].thoughtSignature).toBe("SIG-1");
  });
  it("adds Google's placeholder for older calls saved without a signature", async () => {
    let body: any;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 }); }));
    await chat({ provider: "gemini", key: "k", model: "m", system: "s", tools: [], messages: [
      { role: "user", content: "hi" }, { role: "assistant", content: "", toolCalls: [{ id: "a", name: "x", args: {} }, { id: "b", name: "y", args: {} }] },
      { role: "tool", toolCallId: "a", name: "x", content: "{}" }, { role: "tool", toolCallId: "b", name: "y", content: "{}" },
    ] });
    const model = body.contents.find((c: any) => c.role === "model");
    expect(model.parts[0].thoughtSignature).toBe("skip_thought_signature_validator");
    expect(model.parts[1].thoughtSignature).toBeUndefined();
  });
});

describe("deactivating people", () => {
  it("stops sign-in, keeps them out of lists, and can be undone", async () => {
    expect((await api("post", `/users/${owner.id}/deactivate`, owner).send({})).status).toBe(400);
    expect((await api("post", `/users/${emp.id}/deactivate`, emp).send({})).status).toBe(403);
    await api("post", `/users/${emp.id}/deactivate`, owner).send({ reason: "Contract ended", lastWorkingDay: today }).expect(200);
    const r = await api("post", "/auth/login").send({ email: "eve@r7.test", password: "password123" });
    expect(r.status).not.toBe(200);
    // Their old session no longer works either.
    expect((await api("get", "/me", emp)).status).toBe(401);
    const list = (await api("get", "/users", owner)).body as any[];
    expect(list.find((u) => u.id === emp.id)?.status).toBe("disabled");
    const full = (await api("get", `/users/${emp.id}`, owner)).body;
    expect(full.status).toBe("disabled");
    expect(full.deactivated_reason).toBe("Contract ended");
    await api("post", `/users/${emp.id}/reactivate`, owner).expect(200);
    emp = await login("eve@r7.test");
  });
});

describe("recurring invoice schedules", () => {
  it("works out the days", () => {
    const mon = { frequency: "week" as const, weekday: 1, startsOn: "2026-11-11" };
    expect(firstRun(mon)).toBe("2026-11-16");
    expect(nextRun(mon, "2026-11-16")).toBe("2026-11-23");
    expect(upcomingRuns({ frequency: "two_weeks", weekday: 5, startsOn: "2026-11-10" }, 3)).toEqual(["2026-11-13", "2026-11-27", "2026-12-11"]);
    const last = { frequency: "month" as const, monthDay: 0, startsOn: "2026-01-15" };
    expect(upcomingRuns(last, 3)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(prevRun(last, "2026-03-31")).toBe("2026-02-28");
    expect(upcomingRuns({ frequency: "quarter", monthDay: 1, startsOn: "2026-11-10" }, 2)).toEqual(["2026-12-01", "2027-03-01"]);
    expect(describeSchedule({ frequency: "month", monthDay: 1 })).toBe("Every month on the 1st");
  });

  it("creates the first prepaid invoice on the chosen day, sized to the schedule", async () => {
    const wd = dayOfWeek(today);
    const p = await api("post", "/projects", billing).send({
      clientId: ids.client, name: "Retainer", type: "hourly", billingType: "prepaid", invoicing: "recurring", hourlyRateMinor: 6000,
      billingCapMinutes: 600, billingPeriod: "week", invoiceFrequency: "two_weeks", invoiceWeekday: wd, invoiceStartsOn: today, memberIds: [],
    });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.invoices).toHaveLength(1);
    const d = (await api("get", `/projects/${p.body.project.id}`, billing)).body;
    const proj = d.project ?? d;
    expect(proj.invoice_frequency).toBe("two_weeks");
    expect(String(proj.next_billing_date).slice(0, 10)).toBe(addDays(today, 14));
    // Two weekly caps in one fortnightly invoice: 20 h at 60/h.
    expect(p.body.invoices[0].subtotal_minor).toBe(120000);
    ids.retainer = p.body.project.id;
  });

  it("refuses a schedule that doesn't fit the billing cap, and accepts a change that does", async () => {
    const bad = await api("put", `/projects/${ids.retainer}`, billing).send({ invoiceFrequency: "month", invoiceMonthDay: 1 });
    expect(bad.status).toBe(400);
    await api("put", `/projects/${ids.retainer}`, billing).send({ invoiceFrequency: "week", invoiceWeekday: 1, invoiceStartsOn: today }).expect(200);
    const d = (await api("get", `/projects/${ids.retainer}`, billing)).body;
    const proj = d.project ?? d;
    expect(dayOfWeek(String(proj.next_billing_date).slice(0, 10))).toBe(1);
    // Only billing can change it.
    expect([403, 404]).toContain((await api("put", `/projects/${ids.retainer}`, emp).send({ invoiceFrequency: "week", invoiceWeekday: 2 })).status);
  });
});

describe("activity history", () => {
  it("records changes routes don't record themselves, and shows them by record", async () => {
    await api("put", `/clients/${ids.client}`, owner).send({ name: "Acme Ltd", country: "US" });
    await api("post", "/holidays", owner).send({ date: addDays(today, 30), name: "Founders day" });
    const all = (await api("get", "/activity?limit=100", owner)).body;
    expect(all.rows.some((a: any) => a.action.startsWith("holiday."))).toBe(true);
    expect(all.rows.some((a: any) => a.action === "user.deactivate")).toBe(true);
    // Nothing secret is stored.
    expect(JSON.stringify(all.rows)).not.toMatch(/password123/);
    const client = (await api("get", `/activity?entity=client&entityId=${ids.client}`, owner)).body;
    expect(client.rows.length).toBeGreaterThan(0);
    const person = (await api("get", `/activity?entity=user&entityId=${emp.id}`, owner)).body;
    expect(person.rows.some((a: any) => a.action === "user.reactivate")).toBe(true);
    // Everyone's activity needs the change-history permission; your own history doesn't.
    expect((await api("get", "/activity", emp)).status).toBe(403);
    expect((await api("get", `/activity?entity=user&entityId=${emp.id}`, emp)).status).toBe(200);
    // Paging.
    const p1 = (await api("get", "/activity?limit=5", owner)).body;
    expect(p1.rows).toHaveLength(5);
    const p2 = (await api("get", `/activity?limit=5&before=${p1.next}`, owner)).body;
    expect(p2.rows[0].id).toBeLessThan(p1.rows[4].id);
  });
});

describe("simple work types and tracking by project type", () => {
  it("stores billable / in-house / no work, refuses billable on in-house projects, and drops tracking on fixed projects", async () => {
    const internal = (await api("post", "/projects", owner).send({ clientId: ids.client, name: "Internal", type: "hourly", billingType: "postpaid", invoicing: "one_time", hourlyRateMinor: 0, isInternal: true, memberIds: [owner.id] })).body.project.id;
    const fixed = (await api("post", "/projects", owner).send({ clientId: ids.client, name: "Site", type: "fixed", fixedOption: "installments", priceMinor: 90000, estimatedMinutes: 6000, installmentCount: 3, installmentInterval: "month", installmentMonthDay: 5, installmentStartsOn: "2026-12-01", memberIds: [owner.id] }));
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    const lines = (await api("get", `/projects/${fixed.body.project.id}`, owner)).body.billingLines ?? (await api("get", `/projects/${fixed.body.project.id}`, owner)).body.project?.billingLines;
    if (lines) expect(lines.map((l: any) => String(l.due_date).slice(0, 10))).toEqual(["2026-12-05", "2027-01-05", "2027-02-05"]);
    const day = addDays(today, -1);
    const bad = await api("put", "/sheets/day", owner).send({ date: day, entries: [{ projectId: internal, minutes: 60, description: "x", category: "billable" }] });
    expect(bad.status).toBe(400);
    const ok = await api("put", "/sheets/day", owner).send({ date: day, entries: [
      { projectId: internal, minutes: 60, description: "Hiring", category: "no_work" },
      { projectId: fixed.body.project.id, minutes: 90, description: "Build", category: "inhouse", offline: true, offlineReason: "Tracker not available" },
    ] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const sheet = (await api("get", `/sheets/day?date=${day}`, owner)).body;
    const byProject = Object.fromEntries(sheet.entries.map((e: any) => [e.project_id, e]));
    expect(byProject[internal].category).toBe("no_work");
    expect(byProject[fixed.body.project.id].category).toBe("inhouse");
    expect(byProject[fixed.body.project.id].offline).toBe(false);
    expect(sheet.workTypeMode).toBe("simple");
    expect(sheet.offlineReasons).toContain("Tracker not available");
  });
});

describe("reporting managers", () => {
  it("lets anyone set as someone's reporting manager approve their sheets, without a special role", async () => {
    const roles = (await api("get", "/roles", owner)).body as any[];
    expect(roles.some((r) => r.key === "reporting_manager")).toBe(true);
    const empRole = roles.find((r) => r.key === "employee").id;
    await api("post", "/users", owner).send({ name: "Ria Manager", email: "ria@r7.test", roleIds: [empRole], password: "password123", joinedOn: addDays(today, -100) });
    const ria = await login("ria@r7.test");
    expect((await api("get", "/approvals/sheets", ria)).status).toBe(403);
    const set = await api("put", `/users/${emp.id}`, owner).send({ reportingManagerId: ria.id });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const again = await login("ria@r7.test");
    expect((await api("get", "/approvals/sheets", again)).status).toBe(200);
    // And nobody can report to someone below them.
    const loop = await api("put", `/users/${ria.id}`, owner).send({ reportingManagerId: emp.id });
    expect(loop.status).toBe(400);
  });
});

describe("round 12: vendors, validation and the org chart", () => {
  it("keeps a vendor list and links items to it", async () => {
    const bad = await api("post", "/vendors", owner).send({ name: "  ", phone: "abc" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields)).toEqual(expect.arrayContaining(["name", "phone"]));
    const v = await api("post", "/vendors", owner).send({ name: "Croma Business", phone: "+91 98765 43210", email: "sales@croma.test" });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    const a = await api("post", "/assets", owner).send({ name: "MacBook Air", vendorId: v.body.id });
    expect(a.body.vendor).toBe("Croma Business");
    expect((await api("delete", `/vendors/${v.body.id}`, owner)).status).toBe(409);
    const list = (await api("get", "/vendors", owner)).body;
    expect(list.find((x: any) => x.id === v.body.id).items).toBe(1);
  });

  it("explains bad input field by field", async () => {
    const c = await api("post", "/clients", owner).send({ name: "Bad Co", email: "not-an-email", phone: "12", website: "nope" });
    expect(c.status).toBe(400);
    expect(c.body.error.fields.email[0]).toMatch(/valid email/);
    expect(c.body.error.fields.phone[0]).toMatch(/valid phone/);
    const p = await api("post", "/projects", owner).send({ clientId: ids.client, name: "No price", type: "fixed", fixedOption: "one_time", memberIds: [] });
    expect(p.status).toBe(400);
    expect(p.body.error.fields.priceMinor[0]).toMatch(/Fixed price is required/);
  });

  it("moves someone's reports up when they're deactivated", async () => {
    const roles = (await api("get", "/roles", owner)).body as any[];
    const empRole = roles.find((r) => r.key === "employee").id;
    const mid = await api("post", "/users", owner).send({ name: "Mo Mid", email: "mo@r7.test", roleIds: [empRole], password: "password123" });
    const low = await api("post", "/users", owner).send({ name: "Lu Low", email: "lu@r7.test", roleIds: [empRole], password: "password123", reportingManagerId: mid.body.id });
    await api("put", `/users/${mid.body.id}`, owner).send({ reportingManagerId: owner.id });
    expect((await api("post", `/users/${mid.body.id}/deactivate`, owner).send({ reason: "Left" })).body.reportsMoved).toBe(1);
    const chart = (await api("get", "/org-chart", owner)).body as any[];
    expect(chart.find((p) => p.id === low.body.id).manager_id).toBe(owner.id);
  });
});

describe("tasks split the project's hours", () => {
  it("gives each task its own hours, refuses more than the project has, and caps the sheet per task", async () => {
    const p = await api("post", "/projects", owner).send({ clientId: ids.client, name: "Fifty hours", type: "fixed", fixedOption: "one_time", priceMinor: 50_000_00, estimatedMinutes: 50 * 60, memberIds: [owner.id] });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const pid = p.body.project.id;
    const noHours = await api("post", `/projects/${pid}/tasks`, owner).send({ title: "Design" });
    expect(noHours.status).toBe(400);
    const t1 = await api("post", `/projects/${pid}/tasks`, owner).send({ title: "Design", estimatedMinutes: 30 * 60 });
    expect(t1.status).toBe(200);
    const tooBig = await api("post", `/projects/${pid}/tasks`, owner).send({ title: "Build", estimatedMinutes: 25 * 60 });
    expect(tooBig.status).toBe(409);
    expect(tooBig.body.error.details.available).toBe(20 * 60);
    // Extra hours make room.
    expect((await api("post", `/projects/${pid}/extra-hours`, owner).send({ minutes: 10 * 60, amountMinor: 0 })).status).toBe(200);
    expect((await api("get", `/projects/${pid}/task-budget`, owner)).body.available).toBe(30 * 60);
    const t2 = await api("post", `/projects/${pid}/tasks`, owner).send({ title: "Build", estimatedMinutes: 25 * 60 });
    expect(t2.status, JSON.stringify(t2.body)).toBe(200);
    // A small task can't take more hours than it was given.
    const t3 = await api("post", `/projects/${pid}/tasks`, owner).send({ title: "QA", estimatedMinutes: 60 });
    const over = await api("put", "/sheets/day", owner).send({ date: today, entries: [{ projectId: pid, taskId: t3.body.id, minutes: 120, description: "QA pass" }] });
    expect(over.status).toBe(409);
    expect(JSON.stringify(over.body)).toMatch(/QA/);
    const ok = await api("put", "/sheets/day", owner).send({ date: today, entries: [{ projectId: pid, taskId: t3.body.id, minutes: 60, description: "QA pass" }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});

describe("round 14: handovers and task hours without billing", () => {
  it("moves a PM's projects, reports, tasks and leads to someone else and keeps who led before", async () => {
    const roles = (await api("get", "/roles", owner)).body as any[];
    const role = (k: string) => roles.find((r) => r.key === k).id;
    const mk = async (name: string, email: string) => {
      const r = await api("post", "/users", owner).send({ name, email, roleIds: [role("project_manager") ?? role("employee")], password: "password123", joinedOn: addDays(today, -100) });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.id as string;
    };
    const oldPm = await mk("Olga Old", "olga@r7.test");
    const newPm = await mk("Nate New", "nate@r7.test");
    const p = await api("post", "/projects", owner).send({ clientId: ids.client, name: "Handover project", type: "fixed", fixedOption: "one_time", priceMinor: 10_000_00, estimatedMinutes: 20 * 60, pmUserId: oldPm, memberIds: [oldPm, emp.id] });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const pid = p.body.project.id;
    const task = await api("post", `/projects/${pid}/tasks`, owner).send({ title: "Spec", estimatedMinutes: 120, assigneeId: oldPm });
    expect(task.status, JSON.stringify(task.body)).toBe(200);
    await api("put", `/users/${emp.id}`, owner).send({ reportingManagerId: oldPm });

    const r = (await api("get", `/handovers/responsibilities/${oldPm}`, owner)).body;
    expect(r.projects.map((x: any) => x.id)).toContain(pid);
    expect(r.reports.map((x: any) => x.id)).toContain(emp.id);
    expect(r.tasks.map((x: any) => x.id)).toContain(task.body.id);

    expect((await api("post", "/handovers", owner).send({ fromUserId: oldPm, toUserId: newPm })).status).toBe(400);
    const h = await api("post", "/handovers", owner).send({ fromUserId: oldPm, toUserId: newPm, projectIds: [pid], reportIds: [emp.id], taskIds: [task.body.id], keepOnProjects: true, note: "Moving teams" });
    expect(h.status, JSON.stringify(h.body)).toBe(200);
    expect(h.body.counts.projects).toBe(1);

    const proj = (await api("get", `/projects/${pid}`, owner)).body;
    expect(proj.pm_user_id ?? proj.project?.pm_user_id).toBe(newPm);
    const hist = (await api("get", `/projects/${pid}/role-history`, owner)).body as any[];
    const old = hist.find((x) => x.user_id === oldPm && x.role === "pm");
    expect(old.ended_at).toBeTruthy();
    expect(old.handed_to).toBe(newPm);
    expect(hist.find((x) => x.user_id === newPm && x.role === "pm").ended_at).toBeNull();
    const moved = (await api("get", `/users/${emp.id}`, owner)).body;
    expect(moved.reporting_manager_id ?? moved.user?.reporting_manager_id).toBe(newPm);
    expect(((await api("get", `/handovers?userId=${oldPm}`, owner)).body as any[]).length).toBe(1);
    // Employees can't hand anything over.
    expect((await api("post", "/handovers", emp).send({ fromUserId: oldPm, toUserId: newPm, projectIds: [pid] })).status).toBe(403);
    await api("put", `/users/${emp.id}`, owner).send({ reportingManagerId: null });
  });

  it("asks for the project's hours before tasks on a project with no billing, and lets the PM add more", async () => {
    const p = await api("post", "/projects", owner).send({ clientId: ids.client, name: "No billing", type: "hourly", billingType: "postpaid", hourlyRateMinor: 1000, memberIds: [owner.id] });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const pid = p.body.project.id;
    const b0 = (await api("get", `/projects/${pid}/task-budget`, owner)).body;
    expect(b0.source).toBe("budget");
    expect(b0.cap).toBeNull();
    expect((await api("post", `/projects/${pid}/tasks`, owner).send({ title: "A", estimatedMinutes: 600 })).status).toBe(409);
    expect((await api("put", `/projects/${pid}/task-budget`, owner).send({ minutes: 50 * 60 })).status).toBe(200);
    for (const t of ["A", "B", "C", "D", "E"]) expect((await api("post", `/projects/${pid}/tasks`, owner).send({ title: t, estimatedMinutes: 600 })).status).toBe(200);
    const full = await api("post", `/projects/${pid}/tasks`, owner).send({ title: "F", estimatedMinutes: 300 });
    expect(full.status).toBe(409);
    expect((await api("put", `/projects/${pid}/task-budget`, owner).send({ minutes: 40 * 60 })).status).toBe(400);
    expect((await api("put", `/projects/${pid}/task-budget`, owner).send({ addMinutes: 300, reason: "New screen" })).status).toBe(200);
    expect((await api("post", `/projects/${pid}/tasks`, owner).send({ title: "F", estimatedMinutes: 300 })).status).toBe(200);
    expect((await api("get", `/projects/${pid}/task-budget`, owner)).body.available).toBe(0);
  });
});
