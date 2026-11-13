import { Router, raw } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { FEATURES, signupSchema } from "@eszy/shared";
import { provisionTenant, withPlatform, withTenant } from "@eszy/db";
import { h, hp, pool } from "../lib/context";
import { authenticatePlatform, issueRefresh, requirePerm, signAccess, signPlatform } from "../lib/auth";
import { badRequest, conflict, notFound, unauthorized } from "../lib/errors";
import { OAuth2Client } from "google-auth-library";
import { checkTotp, newTotp, readChallenge, signChallenge } from "../lib/totp";
import { companyUrl, env } from "../lib/env";
import { enqueueEmail } from "../lib/queue";
import { clearTenantCache } from "../lib/tenant";
import { getSettings } from "../lib/settings";
import {
  cancelAtProvider, createCheckout, defaultProvider, enabledProviders, getPaymentKeys, handleRazorpayEvent, handleStripeEvent,
  maskKeys, savePaymentKeys, setSubscriptionState, getBillingProfile, recordSubscriptionInvoice,
} from "../services/subscriptions";
import { renderPdf } from "../lib/threads";

const uuid = z.string().uuid();
const RESERVED = new Set(["www", "admin", "api", "app", "mail", "status", "help", "docs", "blog", "static", "cdn", "eszy"]);

// ---------- public: eszy.com ----------
export const publicRouter = Router();

publicRouter.get("/plans", hp(async (_req, db) =>
  (await db.query(
    `SELECT p.code, p.name, p.description, p.sort, p.price_month_minor, p.price_year_minor, p.currency,
       coalesce(array_agg(pf.feature_code ORDER BY pf.feature_code) FILTER (WHERE pf.feature_code IS NOT NULL), '{}') AS features
     FROM plans p LEFT JOIN plan_features pf ON pf.plan_id = p.id WHERE p.active AND p.public GROUP BY p.id ORDER BY p.sort`,
  )).rows));

publicRouter.get("/slug-available", hp(async (req, db) => {
  const slug = z.string().parse(req.query.slug ?? "").toLowerCase();
  const valid = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug) && !RESERVED.has(slug);
  const taken = valid && (await db.query("SELECT 1 FROM tenants WHERE slug = $1", [slug])).rowCount;
  return { slug, available: valid && !taken, reason: !valid ? "Use 3 to 30 letters, numbers or hyphens" : taken ? "That address is taken" : null };
}));

/** Self sign-up starts a 14-day trial with Growth features. The owner signs in at their own address afterwards. */
publicRouter.post("/signup", async (req, res, next) => {
  try {
    const b = signupSchema.parse(req.body);
    if (RESERVED.has(b.slug)) throw badRequest("That address is reserved");
    const out = await withPlatform(pool, async (db) => {
      if ((await db.query("SELECT 1 FROM tenants WHERE slug = $1", [b.slug])).rowCount) throw conflict("That address is taken");
      const r = await provisionTenant(db, {
        slug: b.slug, name: b.companyName, planCode: "growth", ownerName: b.name, ownerEmail: b.email, ownerPassword: b.password,
        currency: b.currency, country: b.country, trialDays: 14, baseDomain: env.BASE_DOMAIN, seats: b.seats,
      });
      await issueRefresh(db, res, r.tenant.id, r.ownerId);
      return { tenantId: r.tenant.id, slug: r.tenant.slug, accessToken: signAccess(r.ownerId, r.tenant.id), url: companyUrl(r.tenant.slug, "/") };
    });
    await enqueueEmail({ to: b.email, subject: "Your eszy panel is ready", text: `Hi ${b.name},\n\n${b.companyName} is set up at ${out.url}\nYour free trial runs for 14 days.\n` });
    res.json(out);
  } catch (e) { next(e); }
});

publicRouter.post("/enquiries", hp(async (req, db) => {
  const b = z.object({ name: z.string().min(1), company: z.string().min(1), email: z.string().email(), teamSize: z.string().default(""), features: z.string().default(""), message: z.string().max(5000).default("") }).parse(req.body);
  await db.query("INSERT INTO sales_enquiries (name, company, email, team_size, features, message) VALUES ($1,$2,$3,$4,$5,$6)", [b.name, b.company, b.email, b.teamSize, b.features, b.message]);
  await enqueueEmail({ to: env.SALES_EMAIL, subject: `eszy enquiry: ${b.company}`, text: `${b.name} <${b.email}>\nCompany: ${b.company}\nTeam size: ${b.teamSize}\nFeatures: ${b.features}\n\n${b.message}` });
  return { ok: true };
}));

// ---------- a company's own subscription ----------
export const subscriptionRouter = Router();

subscriptionRouter.get("/subscription", requirePerm("subscription.manage"), h(async (req) =>
  withPlatform(pool, async (db) => {
    const sub = (await db.query("SELECT s.*, p.code AS plan_code, p.name AS plan_name, t.trial_ends_at, t.status AS tenant_status FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN tenants t ON t.id = s.tenant_id WHERE s.tenant_id = $1", [req.tenant!.id])).rows[0];
    const invoices = (await db.query("SELECT * FROM subscription_invoices WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50", [req.tenant!.id])).rows;
    const plans = (await db.query("SELECT p.*, coalesce(array_agg(pf.feature_code) FILTER (WHERE pf.feature_code IS NOT NULL), '{}') AS features FROM plans p LEFT JOIN plan_features pf ON pf.plan_id = p.id WHERE p.active GROUP BY p.id ORDER BY p.sort")).rows;
    const providers = enabledProviders(await getPaymentKeys(db));
    return { subscription: sub, invoices, plans, providers, features: FEATURES, salesEmail: env.SALES_EMAIL };
  })));

subscriptionRouter.post("/subscription/checkout", requirePerm("subscription.manage"), h(async (req, tdb) => {
  const b = z.object({ planCode: z.string(), interval: z.enum(["month", "year"]), seats: z.number().int().min(1).max(10000), provider: z.enum(["stripe", "razorpay"]).optional() }).parse(req.body);
  const s = await getSettings(tdb);
  const users = (await tdb.query("SELECT count(*)::int AS n FROM users WHERE status <> 'disabled'")).rows[0].n;
  if (b.seats < users) throw badRequest(`You have ${users} people, so you need at least ${users} seats`);
  return withPlatform(pool, async (db) => {
    const plan = (await db.query("SELECT * FROM plans WHERE code = $1 AND active", [b.planCode])).rows[0];
    if (!plan) throw notFound("Plan not found");
    const keys = await getPaymentKeys(db);
    const provider = b.provider ?? defaultProvider(keys, s.tax.country);
    if (!provider) throw badRequest("Online payment isn't available yet. Contact sales to subscribe.");
    return createCheckout(db, provider, {
      tenantId: req.tenant!.id, slug: req.tenant!.slug, email: req.user!.email, plan, interval: b.interval, seats: b.seats, currency: plan.currency,
      successUrl: companyUrl(req.tenant!.slug, "/settings/subscription?paid=1"), cancelUrl: companyUrl(req.tenant!.slug, "/settings/subscription"),
    });
  });
}));

subscriptionRouter.get("/subscription/invoices/:id/pdf", requirePerm("subscription.manage"), h(async (req, _tdb, res) => {
  const out = await withPlatform(pool, async (db) => ({
    inv: (await db.query("SELECT * FROM subscription_invoices WHERE id = $1 AND tenant_id = $2", [z.string().uuid().parse(req.params.id), req.tenant!.id])).rows[0],
    seller: await getBillingProfile(db),
  }));
  if (!out.inv) throw notFound();
  const pdf = await renderPdf("subscription", { ...out.inv, description: out.inv.bill_to?.description }, out.seller);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${out.inv.number ?? "eszy-invoice"}.pdf"`);
  res.send(pdf);
}));

subscriptionRouter.post("/subscription/cancel", requirePerm("subscription.manage"), h(async (req) =>
  withPlatform(pool, async (db) => {
    const sub = (await db.query("SELECT * FROM subscriptions WHERE tenant_id = $1", [req.tenant!.id])).rows[0];
    if (!sub) throw notFound();
    await cancelAtProvider(db, sub);
    if (!sub.provider || sub.provider === "manual" || sub.status === "trialing") await setSubscriptionState(db, req.tenant!.id, { status: "cancelled" });
    clearTenantCache();
    return { ok: true, message: "Your plan will end at the end of the period you've paid for. Your data is kept for 3 months after that." };
  })));

/**
 * "Delete our data now": the company owner removes the company and all its data at once, instead of waiting
 * 3 months after cancelling. Needs the owner's password and the company address typed in.
 */
subscriptionRouter.post("/subscription/delete-now", requirePerm("subscription.manage"), h(async (req, tdb) => {
  const b = z.object({ confirm: z.string(), password: z.string().min(1) }).parse(req.body);
  if (!req.user!.isOwner) throw badRequest("Only the company owner can delete the company");
  if (b.confirm !== req.tenant!.slug) throw badRequest(`Type ${req.tenant!.slug} to confirm`);
  const u = (await tdb.query("SELECT password_hash FROM users WHERE id = $1", [req.user!.id])).rows[0];
  if (!u?.password_hash || !(await bcrypt.compare(b.password, u.password_hash))) throw unauthorized("Your password is wrong");
  await withPlatform(pool, async (db) => {
    const sub = (await db.query("SELECT * FROM subscriptions WHERE tenant_id = $1", [req.tenant!.id])).rows[0];
    if (sub) await cancelAtProvider(db, sub).catch(() => {});
    await db.query("DELETE FROM tenants WHERE id = $1", [req.tenant!.id]);
  });
  clearTenantCache();
  return { ok: true, message: "Your company and all its data have been deleted." };
}));

// ---------- webhooks (raw body for signatures) ----------
export const webhookRouter = Router();
webhookRouter.post("/stripe", raw({ type: "*/*" }), async (req, res, next) => {
  try {
    await withPlatform(pool, (db) => handleStripeEvent(db, req.body as Buffer, req.header("stripe-signature") ?? ""));
    clearTenantCache();
    res.json({ received: true });
  } catch (e) { next(e); }
});
webhookRouter.post("/razorpay", raw({ type: "*/*" }), async (req, res, next) => {
  try {
    await withPlatform(pool, (db) => handleRazorpayEvent(db, req.body as Buffer, req.header("x-razorpay-signature") ?? ""));
    clearTenantCache();
    res.json({ received: true });
  } catch (e) { next(e); }
});

// ---------- platform console: admin.eszy.com ----------
export const consoleRouter = Router();

const consoleSession = (a: any) => (a.totp_enabled ? { twoFactor: true, challenge: signChallenge(a.id, "platform") } : { accessToken: signPlatform(a.id, a.email), admin: { id: a.id, email: a.email, name: a.name } });

consoleRouter.post("/login", hp(async (req, db) => {
  const b = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
  const a = (await db.query("SELECT * FROM platform_admins WHERE email = lower($1)", [b.email])).rows[0];
  if (!a || !(await bcrypt.compare(b.password, a.password_hash))) throw unauthorized("Email or password is wrong");
  return consoleSession(a);
}));
consoleRouter.get("/auth-config", (_req, res) => { res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID ?? "" }); });
/** Sign in with Google: the Google email must belong to a platform admin. */
consoleRouter.post("/google", hp(async (req, db) => {
  const { credential } = z.object({ credential: z.string().min(20) }).parse(req.body);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw badRequest("Set GOOGLE_CLIENT_ID to use Google sign-in on the console");
  const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId }).catch(() => null);
  const p = ticket?.getPayload();
  if (!p?.email || !p.email_verified) throw unauthorized("Google didn't confirm this email");
  const a = (await db.query("SELECT * FROM platform_admins WHERE email = lower($1)", [p.email])).rows[0];
  if (!a) throw unauthorized("This Google account isn't an eszy console admin");
  return consoleSession(a);
}));
consoleRouter.post("/2fa", hp(async (req, db) => {
  const { challenge, code } = z.object({ challenge: z.string(), code: z.string() }).parse(req.body);
  let id: string;
  try { id = readChallenge(challenge, "platform"); } catch { throw unauthorized("Sign in again"); }
  const a = (await db.query("SELECT * FROM platform_admins WHERE id = $1", [id])).rows[0];
  if (!a || !checkTotp(code, a.totp_secret)) throw unauthorized("That code isn't right");
  return { accessToken: signPlatform(a.id, a.email), admin: { id: a.id, email: a.email, name: a.name } };
}));

consoleRouter.use(authenticatePlatform);

consoleRouter.post("/me/2fa/setup", hp(async (req, db) => {
  const t = await newTotp(req.platformAdmin!.email, "eszy console");
  await db.query("UPDATE platform_admins SET totp_secret = $2 WHERE id = $1 AND NOT totp_enabled", [req.platformAdmin!.id, t.secretEncrypted]);
  return { url: t.url, qr: t.qr, secret: t.secret };
}));
consoleRouter.post("/me/2fa/enable", hp(async (req, db) => {
  const { code } = z.object({ code: z.string() }).parse(req.body);
  const a = (await db.query("SELECT totp_secret FROM platform_admins WHERE id = $1", [req.platformAdmin!.id])).rows[0];
  if (!checkTotp(code, a?.totp_secret)) throw badRequest("That code isn't right");
  await db.query("UPDATE platform_admins SET totp_enabled = true WHERE id = $1", [req.platformAdmin!.id]);
  return { ok: true };
}));
consoleRouter.get("/me", hp(async (req, db) => (await db.query("SELECT id, email, name, totp_enabled FROM platform_admins WHERE id = $1", [req.platformAdmin!.id])).rows[0]));

consoleRouter.get("/stats", hp(async (_req, db) => (await db.query(
  `SELECT count(*)::int AS companies, count(*) FILTER (WHERE status = 'trial')::int AS trials, count(*) FILTER (WHERE status = 'active')::int AS active,
     count(*) FILTER (WHERE status IN ('past_due','read_only'))::int AS at_risk, count(*) FILTER (WHERE status IN ('suspended','cancelled'))::int AS ended,
     (SELECT count(*)::int FROM sales_enquiries WHERE created_at > now() - interval '30 days') AS enquiries_30d
   FROM tenants`)).rows[0]));

consoleRouter.get("/tenants", hp(async (req, db) => {
  const q = z.object({ search: z.string().optional(), status: z.string().optional() }).parse(req.query);
  return (await db.query(
    `SELECT t.*, p.name AS plan_name, s.status AS sub_status, s.seats, s.interval, s.provider, s.current_period_end
     FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id LEFT JOIN subscriptions s ON s.tenant_id = t.id
     WHERE ($1::text IS NULL OR t.name ILIKE '%'||$1||'%' OR t.slug ILIKE '%'||$1||'%') AND ($2::text IS NULL OR t.status = $2)
     ORDER BY t.created_at DESC`, [q.search ?? null, q.status ?? null],
  )).rows;
}));

consoleRouter.get("/tenants/:id", hp(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const t = (await db.query("SELECT t.*, s.status AS sub_status, s.seats, s.interval, s.provider, s.provider_subscription_id, s.current_period_end, s.plan_id AS sub_plan_id FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id WHERE t.id = $1", [id])).rows[0];
  if (!t) throw notFound();
  const features = (await db.query("SELECT feature_code, enabled FROM tenant_features WHERE tenant_id = $1", [id])).rows;
  const domains = (await db.query("SELECT * FROM tenant_domains WHERE tenant_id = $1", [id])).rows;
  const invoices = (await db.query("SELECT * FROM subscription_invoices WHERE tenant_id = $1 ORDER BY created_at DESC", [id])).rows;
  const users = await withTenant(pool, id, async (tdb) => (await tdb.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE status='active')::int AS active FROM users")).rows[0]);
  return { ...t, featureOverrides: features, domains, invoices, users };
}));

consoleRouter.put("/tenants/:id", hp(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({
    name: z.string().optional(), planCode: z.string().optional(), seats: z.number().int().min(1).optional(), interval: z.enum(["month", "year"]).optional(),
    status: z.enum(["trial", "active", "past_due", "read_only", "suspended", "cancelled"]).optional(),
    periodEnd: z.string().optional(), trialEndsAt: z.string().optional(),
    features: z.record(z.string(), z.enum(["plan", "on", "off"])).optional(),
  }).parse(req.body);
  if (b.name) await db.query("UPDATE tenants SET name = $2 WHERE id = $1", [id, b.name]);
  let planId: string | undefined;
  if (b.planCode) {
    planId = (await db.query("SELECT id FROM plans WHERE code = $1", [b.planCode])).rows[0]?.id;
    if (!planId) throw notFound("Plan not found");
  }
  if (b.trialEndsAt) await db.query("UPDATE tenants SET trial_ends_at = $2 WHERE id = $1", [id, b.trialEndsAt]);
  if (b.status || planId || b.seats || b.interval || b.periodEnd) {
    const cur = (await db.query("SELECT status FROM subscriptions WHERE tenant_id = $1", [id])).rows[0];
    const status = b.status ? (b.status === "trial" ? "trialing" : b.status) : cur.status;
    await setSubscriptionState(db, id, { status, planId, seats: b.seats, interval: b.interval, periodEnd: b.periodEnd ? new Date(b.periodEnd) : null, provider: b.status === "active" ? "manual" : undefined });
  }
  for (const [code, mode] of Object.entries(b.features ?? {})) {
    if (mode === "plan") await db.query("DELETE FROM tenant_features WHERE tenant_id = $1 AND feature_code = $2", [id, code]);
    else await db.query("INSERT INTO tenant_features (tenant_id, feature_code, enabled) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, feature_code) DO UPDATE SET enabled = EXCLUDED.enabled", [id, code, mode === "on"]);
  }
  clearTenantCache();
  return { ok: true };
}));

consoleRouter.post("/tenants/:id/domains", hp(async (req, db) => {
  const b = z.object({ host: z.string().min(4).toLowerCase() }).parse(req.body);
  return (await db.query("INSERT INTO tenant_domains (tenant_id, host, kind, verified) VALUES ($1,$2,'custom',true) RETURNING *", [uuid.parse(req.params.id), b.host])).rows[0];
}));

consoleRouter.post("/tenants", hp(async (req, db) => {
  const b = z.object({ slug: z.string(), name: z.string(), planCode: z.string(), ownerName: z.string(), ownerEmail: z.string().email(), currency: z.string().length(3).default("INR"), country: z.string().default("IN"), active: z.boolean().default(true), seats: z.number().int().min(1).default(10) }).parse(req.body);
  const r = await provisionTenant(db, { ...b, ownerPassword: null, status: b.active ? "active" : "trial", baseDomain: env.BASE_DOMAIN });
  // The owner gets an invite link to set their password.
  const { randomToken, sha256 } = await import("../lib/crypto");
  const token = randomToken();
  await db.query("INSERT INTO user_tokens (tenant_id, user_id, kind, token_hash, expires_at) VALUES ($1,$2,'invite',$3, now() + interval '7 days')", [r.tenant.id, r.ownerId, sha256(token)]);
  const url = companyUrl(b.slug, `/invite?token=${token}`);
  await enqueueEmail({ to: b.ownerEmail, subject: `Your eszy panel for ${b.name} is ready`, text: `Hi ${b.ownerName},\n\nSet your password here (valid 7 days):\n${url}\n` });
  return { tenantId: r.tenant.id, inviteUrl: url };
}));

consoleRouter.get("/plans", hp(async (_req, db) => (await db.query(
  "SELECT p.*, coalesce(array_agg(pf.feature_code) FILTER (WHERE pf.feature_code IS NOT NULL), '{}') AS features, (SELECT count(*)::int FROM tenants t WHERE t.plan_id = p.id) AS tenant_count FROM plans p LEFT JOIN plan_features pf ON pf.plan_id = p.id GROUP BY p.id ORDER BY p.sort",
)).rows));
const planSchema = z.object({
  code: z.string().regex(/^[a-z0-9_-]+$/), name: z.string(), description: z.string().default(""), sort: z.number().int().default(0),
  priceMonthMinor: z.number().int().min(0).default(0), priceYearMinor: z.number().int().min(0).default(0), currency: z.string().length(3).default("USD"),
  maxUsers: z.number().int().nullable().default(null), maxProjects: z.number().int().nullable().default(null), rateLimitPerMinute: z.number().int().min(60).default(600),
  public: z.boolean().default(true), active: z.boolean().default(true), features: z.array(z.string()).default([]),
});
async function savePlan(db: any, id: string | null, b: z.infer<typeof planSchema>) {
  const row = id
    ? (await db.query(`UPDATE plans SET code=$2,name=$3,description=$4,sort=$5,price_month_minor=$6,price_year_minor=$7,currency=$8,max_users=$9,max_projects=$10,rate_limit_per_minute=$11,public=$12,active=$13 WHERE id=$1 RETURNING *`,
        [id, b.code, b.name, b.description, b.sort, b.priceMonthMinor, b.priceYearMinor, b.currency, b.maxUsers, b.maxProjects, b.rateLimitPerMinute, b.public, b.active])).rows[0]
    : (await db.query(`INSERT INTO plans (code,name,description,sort,price_month_minor,price_year_minor,currency,max_users,max_projects,rate_limit_per_minute,public,active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [b.code, b.name, b.description, b.sort, b.priceMonthMinor, b.priceYearMinor, b.currency, b.maxUsers, b.maxProjects, b.rateLimitPerMinute, b.public, b.active])).rows[0];
  if (!row) throw notFound();
  await db.query("DELETE FROM plan_features WHERE plan_id = $1", [row.id]);
  for (const f of b.features) await db.query("INSERT INTO plan_features (plan_id, feature_code) VALUES ($1,$2)", [row.id, f]);
  clearTenantCache();
  return row;
}
consoleRouter.post("/plans", hp(async (req, db) => savePlan(db, null, planSchema.parse(req.body))));
consoleRouter.put("/plans/:id", hp(async (req, db) => savePlan(db, uuid.parse(req.params.id), planSchema.parse(req.body))));

consoleRouter.get("/payment-keys", hp(async (_req, db) => maskKeys(await getPaymentKeys(db))));
consoleRouter.put("/payment-keys", hp(async (req, db) => {
  const s = z.object({ secretKey: z.string(), publishableKey: z.string(), webhookSecret: z.string() }).partial();
  const r = z.object({ keyId: z.string(), keySecret: z.string(), webhookSecret: z.string() }).partial();
  await savePaymentKeys(db, z.object({ stripe: s.optional(), razorpay: r.optional() }).parse(req.body) as any);
  return maskKeys(await getPaymentKeys(db));
}));

consoleRouter.get("/billing-profile", hp(async (_req, db) => getBillingProfile(db)));
consoleRouter.put("/billing-profile", hp(async (req, db) => {
  const b = z.object({
    legalName: z.string(), address: z.string().default(""), country: z.string().length(2), state: z.string().default(""), taxId: z.string().default(""),
    rates: z.array(z.object({ name: z.string(), rateBp: z.number().int().min(0) })), indiaGstSplit: z.boolean().default(true), exportRateBp: z.number().int().min(0).default(0),
  }).parse(req.body);
  await db.query("INSERT INTO platform_settings (key, value) VALUES ('billing_profile', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [b]);
  return b;
}));
/** For plans paid outside Stripe/Razorpay (bank transfer): record the payment and issue eszy's tax invoice. */
consoleRouter.post("/tenants/:id/invoices", hp(async (req, db) => {
  const b = z.object({ amountMinor: z.number().int().min(1), currency: z.string().length(3), periodStart: z.string().optional(), periodEnd: z.string().optional(), description: z.string().optional() }).parse(req.body);
  return recordSubscriptionInvoice(db, uuid.parse(req.params.id), { provider: "manual", ...b });
}));
consoleRouter.get("/tenants/:id/invoices/:inv/pdf", async (req, res, next) => {
  try {
    const out = await withPlatform(pool, async (db) => ({ inv: (await db.query("SELECT * FROM subscription_invoices WHERE id = $1 AND tenant_id = $2", [req.params.inv, req.params.id])).rows[0], seller: await getBillingProfile(db) }));
    if (!out.inv) throw notFound();
    res.setHeader("Content-Type", "application/pdf");
    res.send(await renderPdf("subscription", { ...out.inv, description: out.inv.bill_to?.description }, out.seller));
  } catch (e) { next(e); }
});

consoleRouter.get("/enquiries", hp(async (_req, db) => (await db.query("SELECT * FROM sales_enquiries ORDER BY created_at DESC LIMIT 500")).rows));
