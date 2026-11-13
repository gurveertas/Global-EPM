import crypto from "node:crypto";
import Stripe from "stripe";
import Razorpay from "razorpay";
import type { Db } from "@eszy/db";
import { decrypt, encrypt, isEncrypted } from "../lib/crypto";
import { badRequest } from "../lib/errors";
import { computeTax, splitInclusive } from "../lib/tax";
import { logger } from "../lib/logger";

/** Platform keys, set by the eszy owner in the platform console. A provider without keys stays hidden. */
export interface PaymentKeys {
  stripe: { secretKey: string; publishableKey: string; webhookSecret: string };
  razorpay: { keyId: string; keySecret: string; webhookSecret: string };
}
const SECRET_FIELDS = ["stripe.secretKey", "stripe.webhookSecret", "razorpay.keySecret", "razorpay.webhookSecret"];
const EMPTY: PaymentKeys = { stripe: { secretKey: "", publishableKey: "", webhookSecret: "" }, razorpay: { keyId: "", keySecret: "", webhookSecret: "" } };

const getPath = (o: any, p: string) => p.split(".").reduce((a, k) => a?.[k], o);
const setPath = (o: any, p: string, v: unknown) => { const ks = p.split("."); const l = ks.pop()!; ks.reduce((a, k) => (a[k] ??= {}), o)[l] = v; };

export async function getPaymentKeys(db: Db): Promise<PaymentKeys> {
  const row = (await db.query("SELECT value FROM platform_settings WHERE key = 'payments'")).rows[0];
  const v: PaymentKeys = structuredClone({ ...EMPTY, ...(row?.value ?? {}) });
  for (const f of SECRET_FIELDS) { const x = getPath(v, f); if (isEncrypted(x)) setPath(v, f, decrypt(x)); }
  return v;
}
export async function savePaymentKeys(db: Db, patch: Partial<PaymentKeys>) {
  const cur = await getPaymentKeys(db);
  const next: any = { stripe: { ...cur.stripe, ...(patch.stripe ?? {}) }, razorpay: { ...cur.razorpay, ...(patch.razorpay ?? {}) } };
  for (const f of SECRET_FIELDS) if (getPath(next, f) === "••••••••") setPath(next, f, getPath(cur, f));
  const stored = structuredClone(next);
  for (const f of SECRET_FIELDS) setPath(stored, f, encrypt(getPath(next, f)));
  await db.query("INSERT INTO platform_settings (key, value, updated_at) VALUES ('payments', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [stored]);
}
export function maskKeys(k: PaymentKeys) {
  const c: any = structuredClone(k);
  for (const f of SECRET_FIELDS) if (getPath(c, f)) setPath(c, f, "••••••••");
  return c;
}
export const enabledProviders = (k: PaymentKeys) => ({ stripe: !!k.stripe.secretKey, razorpay: !!(k.razorpay.keyId && k.razorpay.keySecret) });

/** Indian companies default to Razorpay, others to Stripe, when both are set up. */
export function defaultProvider(k: PaymentKeys, country: string): "stripe" | "razorpay" | null {
  const e = enabledProviders(k);
  if (country.toUpperCase() === "IN" && e.razorpay) return "razorpay";
  if (e.stripe) return "stripe";
  return e.razorpay ? "razorpay" : null;
}

interface CheckoutInput { tenantId: string; slug: string; email: string; plan: any; interval: "month" | "year"; seats: number; currency: string; successUrl: string; cancelUrl: string }

export async function createCheckout(db: Db, provider: "stripe" | "razorpay", c: CheckoutInput): Promise<{ url: string; providerSubscriptionId?: string }> {
  const keys = await getPaymentKeys(db);
  const base = c.interval === "year" ? c.plan.price_year_minor : c.plan.price_month_minor;
  if (!base) throw badRequest("This plan is priced by our sales team. Use Contact sales.");
  // Plan prices are before tax; the charge includes the tax eszy owes for this company's location.
  const unit = base + Math.round((base * (await taxRateFor(db, c.tenantId))) / 10000);
  if (provider === "stripe") {
    if (!keys.stripe.secretKey) throw badRequest("Stripe isn't set up yet");
    const stripe = new Stripe(keys.stripe.secretKey);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: c.email,
      line_items: [{ quantity: c.seats, price_data: { currency: c.plan.currency.toLowerCase(), unit_amount: unit, recurring: { interval: c.interval }, product_data: { name: `eszy ${c.plan.name}` } } }],
      subscription_data: { metadata: { tenantId: c.tenantId, planId: c.plan.id, seats: String(c.seats) } },
      metadata: { tenantId: c.tenantId, planId: c.plan.id, interval: c.interval, seats: String(c.seats) },
      success_url: c.successUrl, cancel_url: c.cancelUrl,
    });
    return { url: session.url! };
  }
  if (!keys.razorpay.keyId) throw badRequest("Razorpay isn't set up yet");
  const rzp = new Razorpay({ key_id: keys.razorpay.keyId, key_secret: keys.razorpay.keySecret });
  // Razorpay needs a plan object per price; we create it once and remember its id.
  const cacheKey = `rzp_plan:${c.plan.id}:${c.interval}:${unit}:${c.plan.currency}`;
  let planId = (await db.query("SELECT value->>'id' AS id FROM platform_settings WHERE key = $1", [cacheKey])).rows[0]?.id;
  if (!planId) {
    const p: any = await rzp.plans.create({ period: c.interval === "year" ? "yearly" : "monthly", interval: 1, item: { name: `eszy ${c.plan.name}`, amount: unit, currency: c.plan.currency } });
    planId = p.id;
    await db.query("INSERT INTO platform_settings (key, value) VALUES ($1, $2)", [cacheKey, { id: planId }]);
  }
  const sub: any = await rzp.subscriptions.create({ plan_id: planId, total_count: c.interval === "year" ? 10 : 120, quantity: c.seats, customer_notify: 1, notes: { tenantId: c.tenantId, planId: c.plan.id, interval: c.interval } } as any);
  await db.query("UPDATE subscriptions SET provider = 'razorpay', provider_subscription_id = $2, plan_id = $3, interval = $4, seats = $5, updated_at = now() WHERE tenant_id = $1", [c.tenantId, sub.id, c.plan.id, c.interval, c.seats]);
  return { url: sub.short_url, providerSubscriptionId: sub.id };
}

/** Moves a company between active, past due, read-only and suspended, keeping tenants.status in step. */
export async function setSubscriptionState(db: Db, tenantId: string, patch: { status: string; periodEnd?: Date | null; provider?: string; providerSubscriptionId?: string; providerCustomerId?: string; planId?: string; interval?: string; seats?: number }) {
  await db.query(
    `UPDATE subscriptions SET status = $2, current_period_end = coalesce($3, current_period_end), provider = coalesce($4, provider),
       provider_subscription_id = coalesce($5, provider_subscription_id), provider_customer_id = coalesce($6, provider_customer_id),
       plan_id = coalesce($7, plan_id), interval = coalesce($8, interval), seats = coalesce($9, seats),
       payment_failed_at = CASE WHEN $2 = 'past_due' THEN coalesce(payment_failed_at, now()) WHEN $2 = 'active' THEN NULL ELSE payment_failed_at END,
       updated_at = now()
     WHERE tenant_id = $1`,
    [tenantId, patch.status, patch.periodEnd ?? null, patch.provider ?? null, patch.providerSubscriptionId ?? null, patch.providerCustomerId ?? null, patch.planId ?? null, patch.interval ?? null, patch.seats ?? null],
  );
  const tStatus = patch.status === "trialing" ? "trial" : patch.status;
  await db.query(
    `UPDATE tenants SET status = $2, plan_id = coalesce($3, plan_id),
       cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE NULL END,
       delete_after = CASE WHEN $2 = 'cancelled' THEN now() + interval '3 months' ELSE NULL END
     WHERE id = $1`,
    [tenantId, tStatus, patch.planId ?? null],
  );
}

export async function handleStripeEvent(db: Db, raw: Buffer, signature: string) {
  const keys = await getPaymentKeys(db);
  if (!keys.stripe.secretKey || !keys.stripe.webhookSecret) throw badRequest("Stripe isn't set up");
  const stripe = new Stripe(keys.stripe.secretKey);
  const event = stripe.webhooks.constructEvent(raw, signature, keys.stripe.webhookSecret);
  const obj: any = event.data.object;
  const tenantFromSub = async (subId: string) => (await db.query("SELECT tenant_id FROM subscriptions WHERE provider_subscription_id = $1", [subId])).rows[0]?.tenant_id;
  switch (event.type) {
    case "checkout.session.completed": {
      const m = obj.metadata ?? {};
      await setSubscriptionState(db, m.tenantId, { status: "active", provider: "stripe", providerSubscriptionId: obj.subscription, providerCustomerId: obj.customer, planId: m.planId, interval: m.interval, seats: Number(m.seats) || undefined });
      break;
    }
    case "invoice.paid": {
      const tid = obj.subscription ? await tenantFromSub(obj.subscription) : null;
      if (tid) {
        const end = obj.lines?.data?.[0]?.period?.end;
        await setSubscriptionState(db, tid, { status: "active", periodEnd: end ? new Date(end * 1000) : null });
        const line = obj.lines?.data?.[0];
        await recordSubscriptionInvoice(db, tid, { provider: "stripe", providerInvoiceId: obj.id, amountMinor: obj.amount_paid, currency: obj.currency ?? "usd",
          periodStart: line?.period?.start ? new Date(line.period.start * 1000).toISOString().slice(0, 10) : null, periodEnd: end ? new Date(end * 1000).toISOString().slice(0, 10) : null });
      }
      break;
    }
    case "invoice.payment_failed": {
      const tid = obj.subscription ? await tenantFromSub(obj.subscription) : null;
      if (tid) await setSubscriptionState(db, tid, { status: "past_due" });
      break;
    }
    case "customer.subscription.deleted": {
      const tid = await tenantFromSub(obj.id);
      if (tid) await setSubscriptionState(db, tid, { status: "cancelled" });
      break;
    }
    default:
      logger.debug({ type: event.type }, "stripe event ignored");
  }
}

export async function handleRazorpayEvent(db: Db, raw: Buffer, signature: string) {
  const keys = await getPaymentKeys(db);
  if (!keys.razorpay.webhookSecret) throw badRequest("Razorpay isn't set up");
  const expected = crypto.createHmac("sha256", keys.razorpay.webhookSecret).update(raw).digest("hex");
  if (!signature || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature.padEnd(expected.length).slice(0, expected.length)))) throw badRequest("Bad signature");
  const body = JSON.parse(raw.toString("utf8"));
  const sub = body.payload?.subscription?.entity;
  if (!sub) return;
  const tid = sub.notes?.tenantId ?? (await db.query("SELECT tenant_id FROM subscriptions WHERE provider_subscription_id = $1", [sub.id])).rows[0]?.tenant_id;
  if (!tid) return;
  const end = sub.current_end ? new Date(sub.current_end * 1000) : null;
  switch (body.event) {
    case "subscription.activated":
    case "subscription.charged":
    case "subscription.resumed": {
      await setSubscriptionState(db, tid, { status: "active", periodEnd: end, provider: "razorpay", providerSubscriptionId: sub.id });
      const pay = body.payload?.payment?.entity;
      if (pay) await recordSubscriptionInvoice(db, tid, { provider: "razorpay", providerInvoiceId: pay.id, amountMinor: pay.amount, currency: pay.currency,
        periodStart: sub.current_start ? new Date(sub.current_start * 1000).toISOString().slice(0, 10) : null, periodEnd: end ? end.toISOString().slice(0, 10) : null });
      break;
    }
    case "subscription.pending":
    case "subscription.halted":
      await setSubscriptionState(db, tid, { status: "past_due" });
      break;
    case "subscription.cancelled":
    case "subscription.completed":
      await setSubscriptionState(db, tid, { status: "cancelled" });
      break;
  }
}

export async function cancelAtProvider(db: Db, sub: any) {
  const keys = await getPaymentKeys(db);
  if (sub.provider === "stripe" && sub.provider_subscription_id && keys.stripe.secretKey) {
    await new Stripe(keys.stripe.secretKey).subscriptions.update(sub.provider_subscription_id, { cancel_at_period_end: true });
  } else if (sub.provider === "razorpay" && sub.provider_subscription_id && keys.razorpay.keyId) {
    await new Razorpay({ key_id: keys.razorpay.keyId, key_secret: keys.razorpay.keySecret }).subscriptions.cancel(sub.provider_subscription_id, true);
  }
}

/** eszy's own seller details and tax rates, used on the invoices eszy sends to companies. */
export async function getBillingProfile(db: Db) {
  const row = (await db.query("SELECT value FROM platform_settings WHERE key = 'billing_profile'")).rows[0];
  return { legalName: "eszy", address: "", country: "IN", state: "", taxId: "", rates: [{ name: "GST", rateBp: 1800 }], indiaGstSplit: true, exportRateBp: 0, pricesIncludeTax: false, ...(row?.value ?? {}) };
}

/** The company's own tax details (from its settings) as the "bill to" of an eszy invoice. */
async function companyTax(db: Db, tenantId: string) {
  await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  const d = (await db.query("SELECT data FROM company_settings")).rows[0]?.data ?? {};
  await db.query("SELECT set_config('app.tenant_id', '', true)");
  const t = (await db.query("SELECT name FROM tenants WHERE id = $1", [tenantId])).rows[0];
  return { name: d.tax?.legalName || t?.name, address: d.tax?.address ?? "", country: d.tax?.country ?? "IN", state: d.tax?.state ?? "", taxId: d.tax?.taxId ?? "" };
}

/** Total tax rate (basis points) eszy charges this company, from eszy's profile and the company's location. */
export async function taxRateFor(db: Db, tenantId: string) {
  const prof = await getBillingProfile(db);
  const bill = await companyTax(db, tenantId);
  return computeTax(10000, prof, bill).reduce((a, t) => a + t.rateBp, 0);
}

/**
 * Records an eszy invoice for money a company paid (from Stripe, Razorpay, or entered in the console).
 * The amount paid includes tax; the tax engine splits it into subtotal and tax lines, with a numbered invoice.
 */
export async function recordSubscriptionInvoice(db: Db, tenantId: string, x: { provider: string; providerInvoiceId?: string | null; amountMinor: number; currency: string; periodStart?: string | null; periodEnd?: string | null; description?: string }) {
  if (x.providerInvoiceId && (await db.query("SELECT 1 FROM subscription_invoices WHERE provider = $1 AND provider_invoice_id = $2", [x.provider, x.providerInvoiceId])).rowCount) return null;
  const prof = await getBillingProfile(db);
  const bill = await companyTax(db, tenantId);
  const rate = computeTax(10000, prof, bill).reduce((a, t) => a + t.rateBp, 0);
  const { subtotal } = splitInclusive(x.amountMinor, rate);
  const taxes = computeTax(subtotal, prof, bill);
  const diff = x.amountMinor - subtotal - taxes.reduce((a, t) => a + t.amountMinor, 0);
  if (taxes.length && diff) taxes[taxes.length - 1].amountMinor += diff;
  const n = (await db.query("UPDATE subscription_invoice_seq SET next_value = next_value + 1 WHERE id = 1 RETURNING next_value - 1 AS n")).rows[0].n;
  return (await db.query(
    `INSERT INTO subscription_invoices (tenant_id, provider, provider_invoice_id, amount_minor, tax_minor, currency, status, paid_at, number, subtotal_minor, taxes, period_start, period_end, bill_to)
     VALUES ($1,$2,$3,$4,$5,$6,'paid',now(),$7,$8,$9,$10,$11,$12) RETURNING *`,
    [tenantId, x.provider, x.providerInvoiceId ?? null, x.amountMinor, x.amountMinor - subtotal, x.currency.toUpperCase(), `EZ-${String(n).padStart(5, "0")}`, subtotal,
      JSON.stringify(taxes), x.periodStart ?? null, x.periodEnd ?? null, JSON.stringify({ ...bill, description: x.description ?? "eszy subscription" })],
  )).rows[0];
}
