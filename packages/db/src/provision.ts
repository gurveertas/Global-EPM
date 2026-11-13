import bcrypt from "bcryptjs";
import { DEFAULT_ROLES, defaultCompanySettings } from "@eszy/shared";
import type { Db } from "./index";

export interface ProvisionInput {
  slug: string;
  name: string;
  planCode: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword?: string | null;
  currency?: string;
  country?: string;
  trialDays?: number;
  baseDomain?: string;
  status?: "trial" | "active";
  seats?: number;
}

/**
 * Creates a company with its subdomain, default roles, settings, leave types and its first Admin.
 * Runs on a platform transaction, then switches the row-level security setting to the new company.
 */
export async function provisionTenant(db: Db, input: ProvisionInput) {
  const plan = (await db.query("SELECT id FROM plans WHERE code = $1 AND active", [input.planCode])).rows[0];
  if (!plan) throw new Error(`Unknown plan ${input.planCode}`);
  const trialDays = input.trialDays ?? 14;
  const status = input.status ?? "trial";
  const t = (
    await db.query(
      `INSERT INTO tenants (slug, name, status, plan_id, trial_ends_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'trial' THEN now() + make_interval(days => $5) END) RETURNING *`,
      [input.slug, input.name, status, plan.id, trialDays],
    )
  ).rows[0];
  const base = input.baseDomain ?? process.env.BASE_DOMAIN ?? "eszy.com";
  await db.query("INSERT INTO tenant_domains (tenant_id, host) VALUES ($1, $2)", [t.id, `${input.slug}.${base}`]);
  await db.query(
    `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_end, seats)
     VALUES ($1, $2, $3, now() + make_interval(days => $4), $5)`,
    [t.id, plan.id, status === "trial" ? "trialing" : "active", status === "trial" ? trialDays : 30, input.seats ?? 5],
  );

  await db.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
  const settings = defaultCompanySettings();
  settings.branding.displayName = input.name;
  settings.branding.emailSenderName = input.name;
  if (input.currency) settings.locale.currency = input.currency;
  if (input.country) settings.tax.country = input.country;
  await db.query("INSERT INTO company_settings (tenant_id, data) VALUES ($1, $2)", [t.id, settings]);
  await db.query("INSERT INTO invoice_sequences (tenant_id) VALUES ($1)", [t.id]);

  const roleIds: Record<string, string> = {};
  for (const r of DEFAULT_ROLES) {
    const row = (
      await db.query("INSERT INTO roles (tenant_id, key, name, is_system, permissions) VALUES ($1,$2,$3,true,$4) RETURNING id", [
        t.id, r.key, r.name, r.permissions,
      ])
    ).rows[0];
    roleIds[r.key] = row.id;
  }
  for (const [name, days, paid] of [["Casual leave", 12, true], ["Sick leave", 6, true], ["Unpaid leave", 0, false]] as const) {
    await db.query("INSERT INTO leave_types (tenant_id, name, yearly_days, paid) VALUES ($1,$2,$3,$4)", [t.id, name, days, paid]);
  }

  const lists: [string, string[]][] = [
    ["project_sources", ["Upwork", "Direct", "Referral", "Freelancer", "Fiverr"]],
    ["communication_types", ["Email", "Slack", "WhatsApp", "Phone", "Upwork messages", "Google Meet", "Zoom"]],
    ["activity_types", ["Development", "Design", "Testing", "Code review", "Meeting", "Research", "Bug fix", "Support", "Deployment"]],
  ];
  for (const [table, names] of lists) {
    for (const n of names) await db.query(`INSERT INTO ${table} (tenant_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [t.id, n]);
  }
  // Meetings and research are in-house work by default; companies can change this under Masters.
  await db.query("UPDATE activity_types SET category = 'inhouse' WHERE tenant_id = $1 AND name IN ('Meeting','Research')", [t.id]);
  for (const [i, name] of ["To do", "In progress", "Awaiting feedback", "QA and review", "Complete"].entries()) {
    await db.query("INSERT INTO project_stages (tenant_id, name, position, is_done) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [t.id, name, i + 1, name === "Complete"]);
  }

  const hash = input.ownerPassword ? await bcrypt.hash(input.ownerPassword, 11) : null;
  const owner = (
    await db.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, status, is_owner, joined_on)
       VALUES ($1, lower($2), $3, $4, $5, true, current_date) RETURNING id`,
      [t.id, input.ownerEmail, input.ownerName, hash, hash ? "active" : "invited"],
    )
  ).rows[0];
  await db.query("INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1,$2,$3)", [t.id, owner.id, roleIds.admin]);
  await creditLeave(db, t.id, owner.id);
  return { tenant: t, ownerId: owner.id, roleIds };
}

/** Gives a person this year's leave credits for every active leave type (only once per year). */
export async function creditLeave(db: Db, tenantId: string, userId: string, year = new Date().getFullYear()) {
  await db.query(
    `INSERT INTO leave_balances (tenant_id, user_id, leave_type_id, year, credited_days)
     SELECT $1, $2, id, $3, yearly_days FROM leave_types WHERE active AND tenant_id = $1
     ON CONFLICT (user_id, leave_type_id, year) DO NOTHING`,
    [tenantId, userId, year],
  );
}
