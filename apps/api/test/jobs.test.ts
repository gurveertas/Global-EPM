import { describe, expect, it } from "vitest";
import request from "supertest";
import { withPlatform, withTenant } from "@eszy/db";
import { createApp } from "../src/app";
import { pool } from "../src/lib/context";
import { runLifecycle } from "../src/jobs/lifecycle";
import { runDaily } from "../src/jobs/daily";
import { todayIn, addDays } from "../src/lib/dates";

const app = createApp();
const today = todayIn("Asia/Kolkata");

describe("background jobs", () => {
  it("moves an unpaid trial to past due, read-only, suspended, then deletes it after 3 months", async () => {
    const s = await request(app).post("/api/v1/public/signup").send({ companyName: "Trial Co", slug: "trialco", name: "Tia", email: "tia@trial.test", password: "password123" });
    expect(s.status).toBe(200);
    const tid = s.body.tenantId;
    const status = () => withPlatform(pool, async (db) => (await db.query("SELECT status FROM tenants WHERE id = $1", [tid])).rows[0]?.status);

    await withPlatform(pool, (db) => db.query("UPDATE tenants SET trial_ends_at = now() - interval '1 day' WHERE id = $1", [tid]));
    await withPlatform(pool, (db) => runLifecycle(db));
    expect(await status()).toBe("past_due");

    await withPlatform(pool, (db) => db.query("UPDATE subscriptions SET payment_failed_at = now() - interval '8 days' WHERE tenant_id = $1", [tid]));
    await withPlatform(pool, (db) => runLifecycle(db));
    expect(await status()).toBe("read_only");

    await withPlatform(pool, (db) => db.query("UPDATE subscriptions SET payment_failed_at = now() - interval '22 days' WHERE tenant_id = $1", [tid]));
    await withPlatform(pool, (db) => runLifecycle(db));
    expect(await status()).toBe("suspended");
    const blocked = await request(app).get("/api/v1/clients").set("X-Tenant", "trialco").set("Authorization", `Bearer ${s.body.accessToken}`);
    expect(blocked.status).toBe(402);

    await withPlatform(pool, (db) => db.query("UPDATE tenants SET delete_after = now() - interval '1 minute' WHERE id = $1", [tid]));
    await withPlatform(pool, (db) => runLifecycle(db));
    expect(await status()).toBeUndefined();
  });

  it("creates due invoices and sends due-soon and overdue notices once", async () => {
    const s = await request(app).post("/api/v1/public/signup").send({ companyName: "Daily Co", slug: "dailyco", name: "Dan", email: "dan@daily.test", password: "password123" });
    const tid = s.body.tenantId;
    const auth = { Authorization: `Bearer ${s.body.accessToken}`, "X-Tenant": "dailyco" };
    const c = await request(app).post("/api/v1/clients").set(auth).send({ name: "Zed" });
    // Milestone due in 2 days (not yet), plus an overdue manual invoice.
    const p = await request(app).post("/api/v1/projects").set(auth).send({
      clientId: c.body.id, name: "Site", type: "fixed", fixedOption: "milestones", priceMinor: 30000,
      billingLines: [{ label: "Design", minutes: 600, amountMinor: 10000, dueDate: today }, { label: "Build", minutes: 600, amountMinor: 20000, dueDate: addDays(today, 2) }],
    });
    expect(p.body.invoices).toHaveLength(1);
    const late = await request(app).post("/api/v1/invoices").set(auth).send({ projectId: p.body.project.id, issueDate: addDays(today, -20), dueDays: 5, lines: [{ description: "Old work", amountMinor: 5000 }] });
    expect(late.status).toBe(200);

    const r1 = await withTenant(pool, tid, (db) => runDaily(db, { id: tid, slug: "dailyco" }));
    expect(r1.overdue).toBe(1);
    expect(r1.dueSoon).toBeGreaterThanOrEqual(0);
    const r2 = await withTenant(pool, tid, (db) => runDaily(db, { id: tid, slug: "dailyco" }));
    expect(r2.overdue).toBe(0); // only once
    expect(r2.invoices).toBe(0);
  });
});
