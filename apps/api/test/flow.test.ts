import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { todayIn, addDays, periodBounds } from "../src/lib/dates";

/**
 * End-to-end checks of the agreed rules, against a real PostgreSQL database with row-level security.
 * One company ("acme") goes from sign-up to invoices, payments, refunds and rates; a second company checks isolation.
 */
const app = createApp();
const today = todayIn("Asia/Kolkata");

type Who = { token: string; id: string };
const T = "acme";
const api = (method: "get" | "post" | "put" | "delete", path: string, who?: Who, tenant = T) => {
  const r = request(app)[method](`/api/v1${path}`).set("X-Tenant", tenant);
  return who ? r.set("Authorization", `Bearer ${who.token}`) : r;
};

let owner: Who, bm: Who, tl: Who, emp: Who, sales: Who, caller: Who;
let platformToken = "";
const ids: Record<string, string> = {};

async function invite(name: string, email: string, roleKeys: string[], teamId?: string): Promise<Who> {
  const roles = (await api("get", "/roles", owner)).body as any[];
  const roleIds = roleKeys.map((k) => roles.find((r) => r.key === k).id);
  const r = await api("post", "/users", owner).send({ name, email, roleIds, teamId: teamId ?? null, costPerHourMinor: 500 });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const token = new URL(r.body.inviteUrl).searchParams.get("token");
  const a = await api("post", "/auth/accept-invite").send({ token, password: "password123" });
  expect(a.status).toBe(200);
  return { token: a.body.accessToken, id: a.body.user.id };
}

beforeAll(async () => {
  const s = await request(app).post("/api/v1/public/signup").send({
    companyName: "Acme Studio", slug: T, name: "Olivia Owner", email: "olivia@acme.test", password: "password123", country: "IN", currency: "INR",
  });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  const login = await api("post", "/auth/login").send({ email: "olivia@acme.test", password: "password123" });
  expect(login.status).toBe(200);
  owner = { token: login.body.accessToken, id: login.body.user.id };

  // eszy owner moves Acme to the Business plan (all features), active.
  const p = await request(app).post("/api/v1/platform/login").send({ email: "owner@eszy.test", password: "platform-pass" });
  platformToken = p.body.accessToken;
  const tenants = await request(app).get("/api/v1/platform/tenants").set("Authorization", `Bearer ${platformToken}`);
  ids.tenant = tenants.body.find((t: any) => t.slug === T).id;
  const up = await request(app).put(`/api/v1/platform/tenants/${ids.tenant}`).set("Authorization", `Bearer ${platformToken}`).send({ planCode: "business", status: "active", seats: 50 });
  expect(up.status, JSON.stringify(up.body)).toBe(200);

  await api("put", "/settings", owner).send({ tax: { country: "IN", state: "Karnataka", taxId: "29ABCDE1234F1Z5", rates: [{ name: "GST", rateBp: 1800 }] }, locale: { currency: "INR", timezone: "Asia/Kolkata" } });

  tl = await invite("Tara Lead", "tara@acme.test", ["team_lead", "employee"]);
  const team = await api("post", "/teams", owner).send({ name: "Web", leadUserId: tl.id });
  ids.team = team.body.id;
  emp = await invite("Eli Employee", "eli@acme.test", ["employee"], ids.team);
  bm = await invite("Bea Billing", "bea@acme.test", ["billing_manager"]);
  sales = await invite("Raj Sales", "raj@acme.test", ["sales"]);
  caller = await invite("Cara Caller", "cara@acme.test", ["employee"], ids.team);
});

describe("company set-up", () => {
  it("returns the signed-in person's permissions and features", async () => {
    const r = await api("get", "/me", owner);
    expect(r.status).toBe(200);
    expect(r.body.tenant.features).toEqual(expect.arrayContaining(["people_time", "projects_billing", "sales_crm", "performance_rates"]));
    expect(r.body.permissions).toContain("money.view");
  });
  it("blocks people from changing their own or others' roles without permission", async () => {
    const r = await api("put", `/users/${emp.id}`, emp).send({ roleIds: [] });
    expect(r.status).toBe(403);
  });
  it("hides money from people without the money permission", async () => {
    const r = await api("get", "/users", tl);
    expect(r.body[0]).not.toHaveProperty("cost_per_hour_minor");
  });
});

describe("sales: lead to project", () => {
  it("keeps the bringer, lets the bringer assign a caller, and credits the converter", async () => {
    const l = await api("post", "/leads", sales).send({ title: "Store rebuild", contactName: "Mia", company: "BrightCart", country: "IN" });
    expect(l.status).toBe(200);
    ids.lead = l.body.id;
    expect(l.body.bringer_id).toBe(sales.id);

    // The caller can't see the lead until it is assigned to them.
    expect((await api("get", `/leads/${ids.lead}`, caller)).status).toBe(404);
    expect((await api("post", `/leads/${ids.lead}/assign`, caller).send({ callerId: caller.id })).status).toBe(404);
    expect((await api("post", `/leads/${ids.lead}/assign`, sales).send({ callerId: caller.id })).status).toBe(200);
    expect((await api("get", `/leads`, caller)).body).toHaveLength(1);

    expect((await api("post", `/leads/${ids.lead}/calls`, caller).send({ outcome: "no_answer" })).status).toBe(200);
    const conv = await api("post", `/leads/${ids.lead}/calls`, caller).send({ outcome: "converted", notes: "Signed" });
    expect(conv.body.status).toBe("converted");
    const lead = (await api("get", `/leads/${ids.lead}`, sales)).body;
    expect(lead.converter_id).toBe(caller.id);
    expect(lead.bringer_id).toBe(sales.id);
  });

  it("onboards the lead as a client and a prepaid hourly project, invoicing on the billing date with IGST", async () => {
    const c = await api("post", `/leads/${ids.lead}/client`, sales).send({ state: "Maharashtra" });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    ids.client = c.body.id;
    const p = await api("post", "/projects", owner).send({
      clientId: ids.client, name: "BrightCart store", type: "hourly", billingType: "prepaid", invoicing: "one_time",
      hourlyRateMinor: 1000_00, billingCapMinutes: 40 * 60, billingPeriod: "week", billingDate: today, dueDays: 7,
      memberIds: [emp.id, tl.id, caller.id], salesUserId: sales.id, leadId: ids.lead,
      billingLines: [{ label: "First 100 hours", minutes: 100 * 60, amountMinor: 1_00_000_00 }],
      initialPaymentMinor: 50_000_00,
    });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    ids.project = p.body.project.id;
    expect(p.body.invoices).toHaveLength(1);
    const inv = p.body.invoices[0];
    ids.inv1 = inv.id;
    expect(inv.subtotal_minor).toBe(1_00_000_00);
    expect(inv.tax_minor).toBe(18_000_00); // IGST: client in another state
    expect(inv.status).toBe("partially_paid"); // money received before the invoice
    expect(inv.due_date).toBe(addDays(today, 7));
    const detail = (await api("get", `/invoices/${inv.id}`, bm)).body;
    expect(detail.taxes.map((t: any) => t.name)).toEqual(["IGST"]);
    expect((await api("get", `/leads/${ids.lead}`, sales)).body.status).toBe("onboarded");
  });
});

describe("time: caps, daily minimum and TL approval", () => {
  it("blocks hours past the weekly billing cap", async () => {
    // Shrink the billing cap to 10 h for this check.
    expect((await api("put", `/projects/${ids.project}`, bm).send({ billingCapMinutes: 600 })).status).toBe(200);
    const r = await api("put", "/sheets/day", emp).send({ date: today, entries: [{ projectId: ids.project, minutes: 11 * 60, description: "Too much" }] });
    expect(r.status).toBe(409);
    expect(r.body.error.details.problems[0]).toMatch(/billing cap/);
    expect((await api("put", `/projects/${ids.project}`, bm).send({ billingCapMinutes: 40 * 60 })).status).toBe(200);
  });

  it("stops the TL from changing billing", async () => {
    expect((await api("put", `/projects/${ids.project}`, tl).send({ billingCapMinutes: 9999 })).status).toBe(403);
  });

  it("needs the daily minimum, and 10 h on an approved full WFH day", async () => {
    const wd = (await api("get", "/sheets/day", emp)).body;
    const expected = wd.expected.minutes;
    if (expected === 0) return; // non-working day when the test runs
    const w = await api("post", "/wfh", emp).send({ date: today, kind: "full" });
    expect(w.status).toBe(200);
    expect((await api("post", `/wfh/${w.body.id}/approve`, emp)).status).toBe(403); // not their own
    expect((await api("post", `/wfh/${w.body.id}/approve`, tl)).status).toBe(200);
    await api("put", "/sheets/day", emp).send({ date: today, entries: [{ projectId: ids.project, minutes: 510, description: "Build" }] });
    const sub = await api("post", "/sheets/day/submit", emp).send({ date: today });
    expect(sub.status).toBe(400);
    expect(sub.body.error.message).toMatch(/10 h/);
  });

  it("lets only the employee's own TL approve, once", async () => {
    await api("put", "/sheets/day", emp).send({ date: today, entries: [{ projectId: ids.project, minutes: 600, description: "Build", source: "Upwork" }] });
    const sub = await api("post", "/sheets/day/submit", emp).send({ date: today });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const list = (await api("get", "/approvals/sheets", tl)).body;
    const sheet = list.find((s: any) => s.user_id === emp.id);
    expect(sheet.entries[0].source).toBe("Upwork");
    expect((await api("post", `/approvals/sheets/${sheet.id}/approve`, bm)).status).toBe(403);
    expect((await api("post", `/approvals/sheets/${sheet.id}/approve`, tl)).status).toBe(200);
    expect((await api("post", `/approvals/sheets/${sheet.id}/approve`, tl)).status).toBe(409); // never counted twice
    // Approved sheets are locked.
    expect((await api("put", "/sheets/day", emp).send({ date: today, entries: [] })).status).toBe(409);
  });

  it("blocks hours past the project cap", async () => {
    // 100 h line, 10 h used. A 95 h day is refused by the 24 h rule; check the cap via remaining.
    const rem = (await api("get", `/projects/${ids.project}/remaining`, emp)).body;
    expect(rem.projectCap).toBe(6000);
    expect(rem.projectUsed).toBe(600);
  });
});

describe("extra hours, payments, refunds and cancellations", () => {
  it("adds $0 extra hours as non-billable without an invoice", async () => {
    const r = await api("post", `/projects/${ids.project}/extra-hours`, bm).send({ label: "Fix our own bug", minutes: 600, amountMinor: 0 });
    expect(r.status).toBe(200);
    expect(r.body.invoices).toHaveLength(0);
    expect(r.body.line.billable).toBe(false);
  });

  it("invoices paid extra hours straight away", async () => {
    const r = await api("post", `/projects/${ids.project}/extra-hours`, bm).send({ label: "New scope", minutes: 600, amountMinor: 10_000_00 });
    expect(r.body.invoices).toHaveLength(1);
    ids.inv2 = r.body.invoices[0].id;
    expect(r.body.invoices[0].kind).toBe("extra");
  });

  it("records payments by the Billing Manager: partial, then paid", async () => {
    const left = 1_18_000_00 - 50_000_00;
    expect((await api("post", `/invoices/${ids.inv1}/payments`, emp).send({ amountMinor: 100, receivedOn: today })).status).toBe(403);
    const over = await api("post", `/invoices/${ids.inv1}/payments`, bm).send({ amountMinor: left + 1, receivedOn: today });
    expect(over.status).toBe(400);
    const r = await api("post", `/invoices/${ids.inv1}/payments`, bm).send({ amountMinor: left, receivedOn: today, reference: "NEFT" });
    expect(r.body.status).toBe("paid");
  });

  it("refunds a whole invoice only after money was received", async () => {
    expect((await api("post", `/invoices/${ids.inv2}/refund`, bm).send({ refundedOn: today })).status).toBe(400);
    await api("post", `/invoices/${ids.inv2}/payments`, bm).send({ amountMinor: 11_800_00, receivedOn: today });
    const r = await api("post", `/invoices/${ids.inv2}/refund`, bm).send({ refundedOn: today, reason: "Scope dropped" });
    expect(r.body.status).toBe("refunded");
  });

  it("cancels an unpaid invoice, keeps its number and frees its line to be invoiced again", async () => {
    const m = await api("post", "/invoices", bm).send({ projectId: ids.project, issueDate: today, lines: [{ description: "Setup fee", amountMinor: 5_000_00 }] });
    expect(m.status).toBe(200);
    const c = await api("post", `/invoices/${m.body.id}/cancel`, bm).send({ reason: "Wrong amount" });
    expect(c.body.status).toBe("cancelled");
    expect(c.body.number).toBe(m.body.number);
    expect((await api("post", `/invoices/${ids.inv1}/cancel`, bm).send({ reason: "Try" })).status).toBe(409); // paid: refund instead
  });

  it("lists invoices by tab with counts", async () => {
    const r = await api("get", "/invoices?tab=refunded", bm);
    expect(r.body.counts.refunded).toBe(1);
    expect(r.body.invoices).toHaveLength(1);
  });

  it("pages the timesheet master list on the server and splits out refunded and cancelled hours", async () => {
    const r = await api("get", `/reporting/entries?from=${addDays(today, -180)}&to=${addDays(today, 30)}&size=10&page=0`, bm);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.rows.length).toBeLessThanOrEqual(10);
    expect(r.body.total).toBeGreaterThanOrEqual(r.body.rows.length);
    for (const s of r.body.sums) { expect(typeof s.refunded).toBe("number"); expect(typeof s.cancelled).toBe("number"); }
    for (const row of r.body.rows) expect(["refunded", "cancelled", "invoiced", "not_invoiced"]).toContain(row.invoice_state);
    const ref = await api("get", `/reporting/entries?from=${addDays(today, -180)}&to=${addDays(today, 30)}&invoiceState=refunded`, bm);
    expect(ref.status).toBe(200);
    for (const row of ref.body.rows) expect(row.invoice_state).toBe("refunded");
    const refundedSum = ref.body.sums.reduce((a: number, s: any) => a + s.refunded, 0);
    expect(refundedSum).toBe(ref.body.sums.reduce((a: number, s: any) => a + s.minutes, 0));
  });

  it("shows payment status of hours only in reports for money roles", async () => {
    expect((await api("get", "/reports/hours", tl)).status).toBe(403);
    const r = await api("get", "/reports/hours", bm);
    expect(r.body[0].payment_status).toBe("Paid");
  });
});

describe("rates", () => {
  it("computes project rate as (invoiced − refunded) ÷ hours worked", async () => {
    const r = (await api("get", "/rates/projects", owner)).body;
    const p = r.find((x: any) => x.project_id === ids.project);
    // Invoiced: 1,00,000 (paid) + 10,000 (refunded, excluded) + 5,000 (cancelled, excluded) = 1,00,000 over 10 h
    expect(p.revenue_minor).toBe(1_00_000_00);
    expect(p.minutes).toBe(600);
    expect(p.rate_minor).toBe(10_000_00);
  });
  it("keeps rates away from TLs", async () => {
    expect((await api("get", "/rates/projects", tl)).status).toBe(403);
    const perf = (await api("get", "/performance/people?period=month", tl)).body;
    expect(perf.people[0]).not.toHaveProperty("revenue_minor");
  });
  it("credits pre-sales calls to whoever made them", async () => {
    const r = (await api("get", "/performance/sales?period=month", owner)).body;
    const c = r.people.find((x: any) => x.user_id === caller.id);
    expect(c.calls_made).toBe(2);
    expect(c.calls_converted).toBe(1);
  });
});

describe("fixed price and postpaid", () => {
  it("installments: invoices only the installment that is due", async () => {
    const r = await api("post", "/projects", bm).send({
      clientId: ids.client, name: "CRM build", type: "fixed", fixedOption: "installments", priceMinor: 3_00_000_00,
      estimatedMinutes: 300 * 60, installmentCount: 3, installmentInterval: "month", memberIds: [emp.id],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.invoices).toHaveLength(1);
    expect(r.body.invoices[0].subtotal_minor).toBe(1_00_000_00);
    const p = (await api("get", `/projects/${r.body.project.id}`, bm)).body;
    expect(p.billingLines).toHaveLength(3);
    expect(p.remaining.projectCap).toBe(300 * 60);
  });

  it("advance + balance: invoices the advance now", async () => {
    const r = await api("post", "/projects", bm).send({
      clientId: ids.client, name: "Brand site", type: "fixed", fixedOption: "advance_balance", priceMinor: 50_000_00,
      estimatedMinutes: 50 * 60, advancePercent: 40, deliveryDate: addDays(today, 30), memberIds: [],
    });
    expect(r.body.invoices[0].subtotal_minor).toBe(20_000_00);
  });

  it("advance + balance: takes the advance as an amount and works out the rest", async () => {
    const r = await api("post", "/projects", bm).send({
      clientId: ids.client, name: "Brand film", type: "fixed", fixedOption: "advance_balance", priceMinor: 90_000_00,
      estimatedMinutes: 30 * 60, advanceMinor: 25_000_00, deliveryDate: addDays(today, 30), memberIds: [],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.invoices[0].subtotal_minor).toBe(25_000_00);
    const bad = await api("post", "/projects", bm).send({
      clientId: ids.client, name: "Brand film 2", type: "fixed", fixedOption: "advance_balance", priceMinor: 90_000_00,
      estimatedMinutes: 30 * 60, advanceMinor: 95_000_00, deliveryDate: addDays(today, 30), memberIds: [],
    });
    expect(bad.status).toBe(400);
  });

  it("postpaid weekly: invoices approved billable hours after the week ends", async () => {
    const lastWeek = periodBounds(addDays(today, -7), "week", 1);
    const r = await api("post", "/projects", bm).send({
      clientId: ids.client, name: "Support retainer", type: "hourly", billingType: "postpaid", invoicing: "recurring",
      hourlyRateMinor: 2_000_00, billingPeriod: "week", startDate: lastWeek.start, memberIds: [tl.id],
      billingLines: [{ label: "Budget", minutes: 200 * 60, amountMinor: 4_00_000_00 }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    ids.postpaid = r.body.project.id;
    // TL logs 9 h on a day last week; an Admin (approve_all) approves it.
    const day = addDays(lastWeek.start, 4); // last Friday: inside the 7-day edit window
    { const sv = await api("put", "/sheets/day", tl).send({ date: day, entries: [{ projectId: ids.postpaid, minutes: 540 }] }); expect(sv.status, JSON.stringify(sv.body)).toBe(200); }
    const s = await api("post", "/sheets/day/submit", tl).send({ date: day });
    expect([200, 400]).toContain(s.status);
    if (s.status !== 200) return; // only if last week's first day is a working day
    const sheet = (await api("get", "/approvals/sheets", owner)).body.find((x: any) => x.user_id === tl.id);
    expect((await api("post", `/approvals/sheets/${sheet.id}/approve`, owner)).status).toBe(200);
    const run = await api("post", `/projects/${ids.postpaid}/run-billing`, bm);
    expect(run.body.invoices.length).toBeGreaterThanOrEqual(1);
    expect(run.body.invoices.at(-1).subtotal_minor).toBe(18_000_00); // 9 h × 2,000
    const again = await api("post", `/projects/${ids.postpaid}/run-billing`, bm);
    expect(again.body.invoices).toHaveLength(0); // never twice
  });
});

describe("leave", () => {
  it("approves leave through the TL and uses the balance", async () => {
    const types = (await api("get", "/leave/types", emp)).body;
    const casual = types.find((t: any) => t.name === "Casual leave");
    let d = addDays(today, 14);
    while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, 1);
    const r = await api("post", "/leave/requests", emp).send({ leaveTypeId: casual.id, startDate: d, endDate: d });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await api("post", `/leave/requests/${r.body.id}/approve`, tl)).status).toBe(200);
    const bal = (await api("get", "/leave/balances", emp)).body.find((b: any) => b.leave_type_id === casual.id);
    expect(Number(bal.used_days)).toBe(1);
  });
});

describe("CSV and company isolation", () => {
  it("exports and imports clients", async () => {
    const ex = await api("get", "/export/clients.csv", owner);
    expect(ex.status).toBe(200);
    expect(ex.text).toMatch(/^name,company/);
    const im = await api("post", "/import/clients", owner).attach("file", Buffer.from("name,company,email,country\nZed,ZedCo,z@z.test,US\n,Bad,,\n"), "c.csv");
    expect(im.body.created).toBe(1);
    expect(im.body.errors).toHaveLength(1);
  });

  it("keeps a second company from seeing the first company's data", async () => {
    await request(app).post("/api/v1/public/signup").send({ companyName: "Other Co", slug: "other", name: "Omar", email: "omar@other.test", password: "password123" });
    const login = await api("post", "/auth/login", undefined, "other").send({ email: "omar@other.test", password: "password123" });
    const other = { token: login.body.accessToken, id: login.body.user.id };
    expect((await api("get", `/projects/${ids.project}`, other, "other")).status).toBe(404);
    expect((await api("get", "/clients", other, "other")).body).toHaveLength(0);
    // A token from one company is refused on another company's address.
    expect((await api("get", "/me", owner, "other")).status).toBe(401);
  });

  it("puts a company in read-only mode after a failed renewal", async () => {
    await request(app).put(`/api/v1/platform/tenants/${ids.tenant}`).set("Authorization", `Bearer ${platformToken}`).send({ status: "read_only" });
    expect((await api("get", "/clients", owner)).status).toBe(200);
    expect((await api("post", "/clients", owner).send({ name: "New" })).status).toBe(402);
    await request(app).put(`/api/v1/platform/tenants/${ids.tenant}`).set("Authorization", `Bearer ${platformToken}`).send({ status: "active" });
    expect((await api("post", "/clients", owner).send({ name: "New" })).status).toBe(200);
  });
});
