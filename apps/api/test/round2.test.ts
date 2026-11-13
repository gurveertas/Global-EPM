import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { authenticator } from "otplib";
import { withPlatform, withTenant } from "@eszy/db";
import { createApp } from "../src/app";
import { pool } from "../src/lib/context";
import { todayIn, addDays } from "../src/lib/dates";
import { runDaily } from "../src/jobs/daily";
import { dumpTenant, restoreTenant } from "../src/services/backups";

/** Checks for the features carried over from EPM and the remaining architecture items. */
const app = createApp();
const today = todayIn("Asia/Kolkata");
const T = "round2";
type Who = { token: string; id: string };
const api = (m: "get" | "post" | "put" | "delete", path: string, who?: Who, tenant = T) => {
  const r = request(app)[m](`/api/v1${path}`).set("X-Tenant", tenant);
  return who ? r.set("Authorization", `Bearer ${who.token}`) : r;
};
let owner: Who, tl: Who, emp: Who, platform = "";
const ids: Record<string, string> = {};
const workday = (from: string) => { let d = from; while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, 1); return d; };

async function invite(name: string, email: string, roles: string[], extra: Record<string, unknown> = {}): Promise<Who> {
  const all = (await api("get", "/roles", owner)).body as any[];
  const r = await api("post", "/users", owner).send({ name, email, roleIds: roles.map((k) => all.find((x) => x.key === k).id), ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const a = await api("post", "/auth/accept-invite").send({ token: new URL(r.body.inviteUrl).searchParams.get("token"), password: "password123" });
  return { token: a.body.accessToken, id: a.body.user.id };
}

beforeAll(async () => {
  await request(app).post("/api/v1/public/signup").send({ companyName: "Round Two", slug: T, name: "Owen", email: "owen@r2.test", password: "password123", seats: 30 });
  owner = { token: (await api("post", "/auth/login").send({ email: "owen@r2.test", password: "password123" })).body.accessToken, id: "" };
  owner.id = (await api("get", "/me", owner)).body.user.id;
  platform = (await request(app).post("/api/v1/platform/login").send({ email: "owner@eszy.test", password: "platform-pass" })).body.accessToken;
  const t = (await request(app).get("/api/v1/platform/tenants").set("Authorization", `Bearer ${platform}`)).body.find((x: any) => x.slug === T);
  ids.tenant = t.id;
  await request(app).put(`/api/v1/platform/tenants/${t.id}`).set("Authorization", `Bearer ${platform}`).send({ planCode: "business", status: "active", seats: 30 });
  const dept = await api("post", "/departments", owner).send({ name: "Engineering" });
  ids.dept = dept.body.id;
  tl = await invite("Tia Lead", "tia@r2.test", ["team_lead", "employee"], { departmentId: ids.dept });
  ids.team = (await api("post", "/teams", owner).send({ name: "Core", leadUserId: tl.id })).body.id;
  emp = await invite("Eve Emp", "eve@r2.test", ["employee"], { teamId: ids.team, departmentId: ids.dept, joinedOn: addDays(today, -400) });
  ids.client = (await api("post", "/clients", owner).send({ name: "Acme", country: "IN" })).body.id;
  const sources = (await api("get", "/lists/project-sources", owner)).body;
  const acct = await api("post", "/lists/project-accounts", owner).send({ name: "Agency Upwork", sourceId: sources.find((s: any) => s.name === "Upwork").id });
  const p = await api("post", "/projects", owner).send({
    clientId: ids.client, name: "Portal", type: "hourly", billingType: "prepaid", hourlyRateMinor: 1000, memberIds: [emp.id, tl.id],
    billingLines: [{ label: "Block", minutes: 6000, amountMinor: 100000 }], sourceId: sources[0].id, accountId: acct.body.id, allowOfflineHours: true,
  });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  ids.project = p.body.project.id;
  ids.inv1 = p.body.invoices[0].id;
});

describe("EPM features", () => {
  it("records work type, tracking ID and offline hours on sheet entries", async () => {
    const tr = await api("post", `/projects/${ids.project}/trackers`, owner).send({ label: "Contract 4411", externalId: "4411" });
    ids.tracker = tr.body.id;
    const types = (await api("get", "/lists/activity-types", owner)).body;
    // These checks are for the detailed work types (picked from Masters).
    await api("put", "/settings", owner).send({ policies: { workTypeMode: "detailed", requireActivityType: true } });
    expect((await api("put", "/sheets/day", emp).send({ date: today, entries: [{ projectId: ids.project, minutes: 60 }] })).status).toBe(400);
    expect((await api("put", "/sheets/day", emp).send({ date: today, entries: [{ projectId: ids.project, minutes: 60, activityTypeId: types[0].id, offline: true }] })).status).toBe(400);
    const ok = await api("put", "/sheets/day", emp).send({ date: today, entries: [
      { projectId: ids.project, minutes: 300, activityTypeId: types[0].id, trackerId: ids.tracker, source: "Upwork" },
      { projectId: ids.project, minutes: 240, activityTypeId: types[1].id, offline: true, offlineReason: "Client call outside the tracker" },
    ] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const day = (await api("get", "/sheets/day", emp)).body;
    expect(day.entries.map((e: any) => [e.tracker_label, e.offline])).toEqual([["Contract 4411", false], [null, true]]);
    const detail = (await api("get", `/projects/${ids.project}`, owner)).body;
    expect(detail.hoursSplit.offline).toBe(240);
    expect(detail.source_name).toBeTruthy();
    await api("put", "/settings", owner).send({ policies: { requireActivityType: false } });
  });

  it("needs an approved backdate request to fill an old day", async () => {
    const old = addDays(today, -20);
    const blocked = await api("put", "/sheets/day", emp).send({ date: old, entries: [{ projectId: ids.project, minutes: 60 }] });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.details.needsRequest).toBe(true);
    const r = await api("post", "/sheet-requests", emp).send({ date: old, reason: "Was travelling" });
    expect((await api("post", `/sheet-requests/${r.body.id}/approve`, emp)).status).toBe(403);
    expect((await api("post", `/sheet-requests/${r.body.id}/approve`, tl)).status).toBe(200);
    expect((await api("put", "/sheets/day", emp).send({ date: old, entries: [{ projectId: ids.project, minutes: 60 }] })).status).toBe(200);
  });

  it("reopens approved sheets only as the company setting allows", async () => {
    const d = workday(today) === today ? today : addDays(today, -1);
    await api("put", "/sheets/day", emp).send({ date: today, entries: [{ projectId: ids.project, minutes: 600 }] });
    const sub = await api("post", "/sheets/day/submit", emp).send({ date: today });
    if (sub.status !== 200) return; // weekend
    const sheet = (await api("get", "/approvals/sheets", tl)).body[0];
    await api("post", `/approvals/sheets/${sheet.id}/approve`, tl);
    await api("put", "/settings", owner).send({ policies: { approvedSheetEdit: "none" } });
    const none = await api("post", `/sheets/${sheet.id}/reopen`, owner);
    expect(none.status, JSON.stringify(none.body) + JSON.stringify(sheet)).toBe(403);
    await api("put", "/settings", owner).send({ policies: { approvedSheetEdit: "admin" } });
    expect((await api("post", `/sheets/${sheet.id}/reopen`, tl)).status).toBe(403);
    await api("put", "/settings", owner).send({ policies: { approvedSheetEdit: "tl_until_invoiced" } });
    expect((await api("post", `/sheets/${sheet.id}/reopen`, tl)).status).toBe(200);
    void d;
  });

  it("keeps notes, comments with mentions, and an activity feed", async () => {
    await api("post", `/projects/${ids.project}/notes`, tl).send({ title: "Access", body: "Staging login in 1Password", pinned: true });
    await api("post", `/projects/${ids.project}/comments`, tl).send({ body: "@Eve Emp please check the cart bug" });
    const n = (await api("get", "/notifications", emp)).body;
    expect(n.some((x: any) => x.kind === "comment.mention")).toBe(true);
    const feed = (await api("get", `/projects/${ids.project}/activity`, emp)).body;
    expect(feed.some((x: any) => x.kind === "comment")).toBe(true);
  });

  it("stores standups and shows the team's", async () => {
    await api("put", "/standups", emp).send({ yesterday: "Cart", today: "Checkout", blockers: "Waiting on API keys" });
    const t = (await api("get", "/standups?scope=team", tl)).body;
    expect(t.people.find((p: any) => p.name === "Eve Emp").blockers).toMatch(/API keys/);
  });

  it("shows events, holidays, leave and birthdays on the calendar", async () => {
    await api("post", "/events", owner).send({ title: "Town hall", startDate: addDays(today, 2), startTime: "16:00", endTime: "17:00" });
    await api("post", "/holidays", owner).send({ date: addDays(today, 5), name: "Founders day" });
    await api("put", `/users/${emp.id}`, owner).send({ dateOfBirth: "1995-01-15", address: "12 Main St", emergencyContactName: "Ann", emergencyContactPhone: "+91 99999 00000" });
    const c = (await api("get", `/calendar?from=${today}&to=${addDays(today, 30)}`, emp)).body;
    expect(c.events[0].title).toBe("Town hall");
    expect(c.holidays[0].name).toBe("Founders day");
    expect(c.birthdays.some((b: any) => b.name === "Eve Emp")).toBe(true);
  });

  it("tracks accessories and who has them", async () => {
    const a = await api("post", "/assets", owner).send({ name: "MacBook Air", category: "Laptop", serialNumber: "C02X" });
    expect((await api("post", `/assets/${a.body.id}/assign`, owner).send({ userId: emp.id })).status).toBe(200);
    expect((await api("post", `/assets/${a.body.id}/assign`, owner).send({ userId: tl.id })).status).toBe(409);
    expect((await api("get", "/assets", emp)).body).toHaveLength(1);
    await api("post", `/assets/${a.body.id}/return`, owner).send({ condition: "fair" });
    expect((await api("get", `/assets/${a.body.id}/history`, owner)).body[0].returned_on).toBeTruthy();
  });

  it("saves a profile photo", async () => {
    const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(200, 1)]);
    expect((await api("put", `/users/${emp.id}/photo`, emp).set("Content-Type", "image/png").send(png)).status).toBe(200);
    const g = await api("get", `/users/${emp.id}/photo`, tl);
    expect(g.headers["content-type"]).toBe("image/png");
  });

  it("returns chart data for the dashboard", async () => {
    const c = (await api("get", "/charts", owner)).body;
    expect(c.myHours).toHaveLength(14);
    expect(c.revenue).toHaveLength(6);
  });
});

describe("architecture items", () => {
  it("cancels with a reason and issues a linked corrected invoice for the same line", async () => {
    expect((await api("post", `/invoices/${ids.inv1}/cancel`, owner).send({})).status).toBe(400);
    const c = await api("post", `/invoices/${ids.inv1}/cancel`, owner).send({ reason: "Wrong rate" });
    expect(c.body.cancel_reason).toBe("Wrong rate");
    const fix = await api("post", `/invoices/${ids.inv1}/correct`, owner).send({ issueDate: today, lines: [{ description: "Block (corrected)", minutes: 6000, amountMinor: 90000 }] });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    expect(fix.body.corrects_invoice_id).toBe(ids.inv1);
    const d = (await api("get", `/invoices/${fix.body.id}`, owner)).body;
    expect(d.corrects.id).toBe(ids.inv1);
    const lines = (await api("get", `/projects/${ids.project}`, owner)).body.billingLines;
    expect(lines.find((l: any) => l.label === "Block").invoice_id).toBe(fix.body.id);
    expect((await api("post", `/invoices/${ids.inv1}/correct`, owner).send({ issueDate: today })).status).toBe(409);
  });

  it("applies the sandwich rule, makes extra days unpaid, and blocks types during probation", async () => {
    await api("put", "/settings", owner).send({ policies: { sandwichRule: true } });
    const types = (await api("get", "/leave/types", emp)).body;
    const casual = types.find((t: any) => t.name === "Casual leave");
    // Friday to Monday = 2 working days + the weekend between them.
    let fri = addDays(today, 21); while (new Date(`${fri}T00:00:00Z`).getUTCDay() !== 5) fri = addDays(fri, 1);
    const r = await api("post", "/leave/requests", emp).send({ leaveTypeId: casual.id, startDate: fri, endDate: addDays(fri, 3) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(Number(r.body.days)).toBe(4);
    expect(Number(r.body.sandwich_days)).toBe(2);
    const big = await api("post", "/leave/requests", emp).send({ leaveTypeId: casual.id, startDate: addDays(fri, 14), endDate: addDays(fri, 30) });
    expect(Number(big.body.unpaid_days)).toBeGreaterThan(0);
    const t = await api("post", "/leave/types", owner).send({ name: "Earned leave", yearlyDays: 12, accrual: "monthly", carryForwardMax: 5, allowedInProbation: false });
    await api("put", `/users/${emp.id}`, owner).send({ probationEndsOn: addDays(today, 60) });
    const p = await api("post", "/leave/requests", emp).send({ leaveTypeId: t.body.id, startDate: workday(addDays(today, 10)), endDate: workday(addDays(today, 10)) });
    expect(p.status).toBe(400);
    expect(p.body.error.message).toMatch(/probation/);
  });

  it("credits monthly leave once a month and reminds the TL about waiting sheets", async () => {
    await api("put", "/settings", owner).send({ policies: { pendingReminderDays: 1 } });
    const d = addDays(today, -2);
    await api("put", "/sheets/day", tl).send({ date: d, entries: [{ projectId: ids.project, minutes: 600 }] });
    await withTenant(pool, ids.tenant, (db) => db.query("UPDATE sheets SET status = 'submitted', submitted_at = now() - interval '3 days' WHERE user_id = (SELECT id FROM users WHERE email='tia@r2.test') AND date = $1", [d]));
    // Tia's sheets go to... nobody (she leads the team). Put her in a team led by Owen.
    const t2 = (await api("post", "/teams", owner).send({ name: "Leads", leadUserId: owner.id, memberIds: [tl.id] })).body;
    void t2;
    const r1 = await withTenant(pool, ids.tenant, (db) => runDaily(db, { id: ids.tenant, slug: T }));
    expect(r1.tlReminders).toBe(1);
    expect(r1.accrued).toBeGreaterThan(0);
    const r2 = await withTenant(pool, ids.tenant, (db) => runDaily(db, { id: ids.tenant, slug: T }));
    expect(r2.tlReminders).toBe(0);
    expect(r2.accrued).toBe(0);
  });

  it("fires company alert rules, e.g. a project at 5% of its cap", async () => {
    const r = await api("post", "/alert-rules", owner).send({ event: "project.near_cap", threshold: 5, roleKeys: ["admin"], inApp: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await withTenant(pool, ids.tenant, (db) => runDaily(db, { id: ids.tenant, slug: T }));
    const n = (await api("get", "/notifications", owner)).body;
    expect(n.some((x: any) => x.kind === "alert.project.near_cap")).toBe(true);
  });

  it("records old and new values in the change history", async () => {
    await api("put", `/projects/${ids.project}`, owner).send({ name: "Portal v2" });
    const a = (await api("get", "/audit", owner)).body.find((x: any) => x.action === "project.update");
    expect(a.data.changes.name).toEqual(["Portal", "Portal v2"]);
  });

  it("imports teams, projects, billing lines, tasks and leave balances, and exports Excel", async () => {
    const up = (entity: string, csv: string) => api("post", `/import/${entity}`, owner).attach("file", Buffer.from(csv), "f.csv");
    expect((await up("teams", "name,team_lead_email,department\nDesign,tia@r2.test,Engineering\n")).body.created).toBe(1);
    expect((await up("projects", "name,client,type,billing_type,hourly_rate,members\nImported,Acme,hourly,postpaid,20,eve@r2.test\n")).body.created).toBe(1);
    expect((await up("billing_lines", "project,label,hours,amount\nImported,Budget,10,200\n")).body.created).toBe(1);
    expect((await up("tasks", "project,title,assignee_email\nImported,Set up,eve@r2.test\n")).body.created).toBe(1);
    expect((await up("leave_balances", `email,leave_type,year,credited_days,used_days\neve@r2.test,Sick leave,${today.slice(0, 4)},8,1\n`)).body.created).toBe(1);
    const x = await api("get", "/export/projects?format=xlsx", owner).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
    expect(x.status).toBe(200);
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe("PK");
    const csv = await api("get", "/export/time.csv", owner);
    expect(csv.text.split("\n")[0]).toMatch(/date,person,project/);
  });

  it("enforces the plan's project limit", async () => {
    await withPlatform(pool, (db) => db.query("UPDATE plans SET max_projects = 2 WHERE code = 'business'"));
    const { clearTenantCache } = await import("../src/lib/tenant");
    clearTenantCache();
    const r = await api("post", "/projects", owner).send({ clientId: ids.client, name: "One too many", type: "hourly", billingType: "postpaid", hourlyRateMinor: 100 });
    expect(r.status).toBe(409);
    await withPlatform(pool, (db) => db.query("UPDATE plans SET max_projects = NULL WHERE code = 'business'"));
    clearTenantCache();
  });

  it("uses two-step sign-in with an authenticator app", async () => {
    const s = (await api("post", "/me/2fa/setup", emp)).body;
    expect(s.qr).toMatch(/^data:image\/png/);
    expect((await api("post", "/me/2fa/enable", emp).send({ code: "000000" })).status).toBe(400);
    expect((await api("post", "/me/2fa/enable", emp).send({ code: authenticator.generate(s.secret) })).status).toBe(200);
    const l = await api("post", "/auth/login").send({ email: "eve@r2.test", password: "password123" });
    expect(l.body.twoFactor).toBe(true);
    expect(l.body.accessToken).toBeUndefined();
    expect((await api("post", "/auth/2fa").send({ challenge: l.body.challenge, code: "123456" })).status).toBe(401);
    const ok = await api("post", "/auth/2fa").send({ challenge: l.body.challenge, code: authenticator.generate(s.secret) });
    expect(ok.body.accessToken).toBeTruthy();
    // When the company requires it, people without it can only reach their profile.
    expect((await api("put", "/settings", owner).send({ auth: { twoFactor: "required" } })).status).toBe(400); // owner hasn't set it up
    const os = (await api("post", "/me/2fa/setup", owner)).body;
    await api("post", "/me/2fa/enable", owner).send({ code: authenticator.generate(os.secret) });
    expect((await api("put", "/settings", owner).send({ auth: { twoFactor: "required" } })).status).toBe(200);
    expect((await api("get", "/clients", tl)).status).toBe(403);
    expect((await api("get", "/me", tl)).body.user.mustSetUpTwoFactor).toBe(true);
    await api("put", "/settings", owner).send({ auth: { twoFactor: "optional" } });
  });

  it("issues eszy's own invoice with the tax engine", async () => {
    const bp = await request(app).put("/api/v1/platform/billing-profile").set("Authorization", `Bearer ${platform}`).send({ legalName: "eszy Pvt Ltd", country: "IN", state: "Karnataka", rates: [{ name: "GST", rateBp: 1800 }] });
    expect(bp.status, JSON.stringify(bp.body)).toBe(200);
    const st = await api("put", "/settings", owner).send({ tax: { country: "IN", state: "Karnataka" } });
    expect(st.body.tax.state, JSON.stringify(st.body)).toBe("Karnataka");
    const inv = await request(app).post(`/api/v1/platform/tenants/${ids.tenant}/invoices`).set("Authorization", `Bearer ${platform}`).send({ amountMinor: 11800, currency: "INR" });
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    expect(inv.body.subtotal_minor).toBe(10000);
    expect(inv.body.taxes.map((t: any) => t.name)).toEqual(["CGST", "SGST"]);
    expect(inv.body.number).toMatch(/^EZ-\d{5}$/);
    const pdf = await api("get", `/subscription/invoices/${inv.body.id}/pdf`, owner);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
  });

  it("restores a company from its own backup", async () => {
    const dump = await withTenant(pool, ids.tenant, (db) => dumpTenant(db));
    await api("post", "/clients", owner).send({ name: "Added after backup" });
    const out = await withTenant(pool, ids.tenant, (db) => restoreTenant(db, JSON.parse(JSON.stringify(dump))), { timeoutMs: 60000 });
    expect(out.rows).toBeGreaterThan(50);
    const clients = (await api("get", "/clients", owner)).body.map((c: any) => c.name);
    expect(clients).not.toContain("Added after backup");
    expect(clients).toContain("Acme");
    // People can still sign in with their passwords.
    expect((await api("post", "/auth/login").send({ email: "tia@r2.test", password: "password123" })).status).toBe(200);
    // A backup of another company is refused.
    await expect(withTenant(pool, ids.tenant, (db) => restoreTenant(db, { ...dump, tenantId: "00000000-0000-0000-0000-000000000000" }))).rejects.toThrow(/another company/);
  });

  it("lets the owner delete the company and all its data now", async () => {
    await request(app).post("/api/v1/public/signup").send({ companyName: "Bye", slug: "byeco", name: "Bo", email: "bo@bye.test", password: "password123" });
    const t = (await api("post", "/auth/login", undefined, "byeco").send({ email: "bo@bye.test", password: "password123" })).body.accessToken;
    const who = { token: t, id: "" };
    expect((await api("post", "/subscription/delete-now", who, "byeco").send({ confirm: "wrong", password: "password123" })).status).toBe(400);
    expect((await api("post", "/subscription/delete-now", who, "byeco").send({ confirm: "byeco", password: "nope" })).status).toBe(401);
    expect((await api("post", "/subscription/delete-now", who, "byeco").send({ confirm: "byeco", password: "password123" })).status).toBe(200);
    const gone = await withPlatform(pool, async (db) => (await db.query("SELECT 1 FROM tenants WHERE slug = 'byeco'")).rowCount);
    expect(gone).toBe(0);
  });
});
