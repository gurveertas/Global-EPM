import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import pg from "pg";
import { loadEnv } from "./load-env";
import { FEATURES } from "@eszy/shared";
import { provisionTenant, creditLeave } from "./provision";

const PLANS = [
  { code: "starter", name: "Starter", sort: 1, description: "People and Time", features: ["people_time"], month: 0, year: 0 },
  { code: "growth", name: "Growth", sort: 2, description: "Adds Projects and Billing", features: ["people_time", "projects_billing"], month: 0, year: 0 },
  { code: "business", name: "Business", sort: 3, description: "Everything, including Sales CRM and Performance", features: Object.keys(FEATURES), month: 0, year: 0 },
];

/** Features, plans and the platform admin. Safe to run again. Set SEED_DEMO=1 to add a demo company. */
export async function seed(url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    for (const [code, name] of Object.entries(FEATURES)) {
      await c.query("INSERT INTO features (code, name) VALUES ($1,$2) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name", [code, name]);
    }
    for (const p of PLANS) {
      const row = (
        await c.query(
          `INSERT INTO plans (code, name, description, sort, price_month_minor, price_year_minor)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [p.code, p.name, p.description, p.sort, p.month, p.year],
        )
      ).rows[0];
      for (const f of p.features) {
        await c.query("INSERT INTO plan_features (plan_id, feature_code) VALUES ($1,$2) ON CONFLICT DO NOTHING", [row.id, f]);
      }
    }
    const email = process.env.PLATFORM_ADMIN_EMAIL ?? "owner@eszy.com";
    const password = process.env.PLATFORM_ADMIN_PASSWORD ?? "change-me-now";
    await c.query(
      "INSERT INTO platform_admins (email, name, password_hash) VALUES ($1,'eszy owner',$2) ON CONFLICT (email) DO NOTHING",
      [email, await bcrypt.hash(password, 11)],
    );

    if (process.env.SEED_DEMO === "1" && !(await c.query("SELECT 1 FROM tenants WHERE slug='demo'")).rowCount) {
      const { tenant, roleIds } = await provisionTenant(c as any, {
        slug: "demo", name: "Demo Studio", planCode: "business", ownerName: "Asha Admin",
        ownerEmail: "admin@demo.test", ownerPassword: "password123", currency: "INR", country: "IN", status: "active", seats: 25,
      });
      const tid = tenant.id;
      const pw = await bcrypt.hash("password123", 11);
      const mk = async (name: string, email: string, roles: string[]) => {
        const u = (await c.query("INSERT INTO users (tenant_id,email,name,password_hash,joined_on,cost_per_hour_minor) VALUES ($1,$2,$3,$4,current_date,900) RETURNING id", [tid, email, name, pw])).rows[0];
        for (const r of roles) await c.query("INSERT INTO user_roles VALUES ($1,$2,$3)", [tid, u.id, roleIds[r]]);
        await creditLeave(c as any, tid, u.id);
        return u.id as string;
      };
      const bm = await mk("Bina Billing", "billing@demo.test", ["billing_manager"]);
      const tl = await mk("Tarun Lead", "tl@demo.test", ["team_lead", "employee"]);
      const emp = await mk("Esha Employee", "employee@demo.test", ["employee"]);
      const sales = await mk("Rahul Sales", "sales@demo.test", ["sales"]);
      await mk("Sana Sales TL", "salestl@demo.test", ["sales_tl"]);
      const team = (await c.query("INSERT INTO teams (tenant_id,name,lead_user_id) VALUES ($1,'Web team',$2) RETURNING id", [tid, tl])).rows[0];
      await c.query("UPDATE users SET team_id=$1 WHERE id = ANY($2)", [team.id, [tl, emp]]);
      const client = (await c.query("INSERT INTO clients (tenant_id,name,company,email,country) VALUES ($1,'Mia Chen','BrightCart','mia@brightcart.test','US') RETURNING id", [tid])).rows[0];
      const proj = (await c.query(
        `INSERT INTO projects (tenant_id,client_id,name,type,billing_type,invoicing,hourly_rate_minor,billing_cap_minutes,billing_period,due_days,start_date,created_by,sales_user_id)
         VALUES ($1,$2,'BrightCart store','hourly','prepaid','one_time',1000,2400,'week',7,current_date,$3,$4) RETURNING id`,
        [tid, client.id, bm, sales],
      )).rows[0];
      await c.query("INSERT INTO billing_lines (tenant_id,project_id,position,label,minutes,amount_minor,due_date) VALUES ($1,$2,0,'First 100 hours',6000,100000,current_date + 7)", [tid, proj.id]);
      for (const u of [tl, emp]) await c.query("INSERT INTO project_members VALUES ($1,$2,$3)", [tid, proj.id, u]);
      await c.query("INSERT INTO leads (tenant_id,title,contact_name,company,bringer_id,caller_id,status) VALUES ($1,'Shopify rebuild','Leo Park','Parkside Co',$2,$2,'new')", [tid, sales]);
      void bm;
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  loadEnv();
  seed().then(() => console.log("seed done"), (e) => { console.error(e); process.exit(1); });
}
