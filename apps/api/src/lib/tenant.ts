import type { NextFunction, Request, Response } from "express";
import type { Feature } from "@eszy/shared";
import { withPlatform } from "@eszy/db";
import { pool, type TenantCtx } from "./context";
import { env, isProd } from "./env";
import { HttpError, forbidden } from "./errors";
import { redis } from "./redis";

const cache = new Map<string, { at: number; t: TenantCtx | null }>();
const TTL = 30_000;
export const clearTenantCache = () => cache.clear();

/** Finds the company from the Host header (rober.eszy.com or a verified custom domain). */
export async function loadTenantByHostOrSlug(key: { host?: string; slug?: string }): Promise<TenantCtx | null> {
  const k = key.slug ? `s:${key.slug}` : `h:${key.host}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.t;
  const t = await withPlatform(pool, async (db) => {
    const row = (
      await db.query(
        `SELECT t.id, t.slug, t.name, t.status, t.plan_id, coalesce(p.rate_limit_per_minute, 600) AS rate_limit, p.max_projects
         FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
         WHERE ${key.slug ? "t.slug = $1" : "t.id = (SELECT tenant_id FROM tenant_domains WHERE host = $1 AND verified)"}`,
        [key.slug ?? key.host],
      )
    ).rows[0];
    if (!row) return null;
    const feats = (
      await db.query(
        `SELECT feature_code FROM plan_features WHERE plan_id = $1
         UNION SELECT feature_code FROM tenant_features WHERE tenant_id = $2 AND enabled
         EXCEPT SELECT feature_code FROM tenant_features WHERE tenant_id = $2 AND NOT enabled`,
        [row.plan_id, row.id],
      )
    ).rows.map((r) => r.feature_code as Feature);
    return { id: row.id, slug: row.slug, name: row.name, status: row.status, planId: row.plan_id, features: new Set(feats), rateLimit: row.rate_limit, maxProjects: row.max_projects };
  });
  cache.set(k, { at: Date.now(), t });
  return t;
}

export function hostSlug(host: string): string | null {
  const h = host.split(":")[0].toLowerCase();
  const base = env.BASE_DOMAIN.toLowerCase();
  if (h.endsWith(`.${base}`)) {
    const s = h.slice(0, -(base.length + 1));
    if (!s.includes(".") && !["www", "admin", "api"].includes(s)) return s;
  }
  if (h.endsWith(".localhost")) return h.split(".")[0];
  return null;
}

/** Attaches req.tenant. Companies that are suspended or cancelled can only reach billing and sign-in routes. */
export async function resolveTenant(req: Request, _res: Response, next: NextFunction) {
  try {
    const headerSlug = !isProd && env.DEV_TENANT_HEADER ? (req.header("x-tenant") ?? undefined) : undefined;
    const fwdHost = req.header("x-forwarded-host") ?? req.header("host") ?? "";
    const slug = headerSlug ?? hostSlug(fwdHost) ?? undefined;
    const t = slug ? await loadTenantByHostOrSlug({ slug }) : await loadTenantByHostOrSlug({ host: fwdHost.split(":")[0] });
    if (t) req.tenant = t;
    next();
  } catch (e) {
    next(e);
  }
}

const ALWAYS_OPEN = [/^\/api\/v1\/auth\//, /^\/api\/v1\/subscription/, /^\/api\/v1\/me$/, /^\/api\/v1\/export/];

/** Applies the company's subscription state: read-only blocks changes, suspended blocks everything but billing. */
export function enforceTenantState(req: Request, _res: Response, next: NextFunction) {
  const t = req.tenant;
  if (!t) return next();
  const open = ALWAYS_OPEN.some((r) => r.test(req.path));
  if ((t.status === "suspended" || t.status === "cancelled") && !open) {
    return next(new HttpError(402, "This company's eszy plan is suspended. An Admin can renew it in Settings, Subscription.", "suspended"));
  }
  if (t.status === "read_only" && req.method !== "GET" && !open) {
    return next(new HttpError(402, "This company is read-only until the eszy plan is renewed.", "read_only"));
  }
  next();
}

/** Per-company request limit, so one busy company can't slow down the others. */
export async function tenantRateLimit(req: Request, res: Response, next: NextFunction) {
  const t = req.tenant;
  if (!t || !redis) return next();
  try {
    const key = `rl:${t.id}:${Math.floor(Date.now() / 60000)}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 70);
    res.setHeader("X-RateLimit-Limit", String(t.rateLimit));
    if (n > t.rateLimit) return next(new HttpError(429, "Too many requests from this company. Try again in a minute.", "rate_limited"));
  } catch {
    /* if Redis is down, don't block requests */
  }
  next();
}

export const requireFeature = (f: Feature) => (req: Request, _res: Response, next: NextFunction) =>
  req.tenant?.features.has(f) ? next() : next(forbidden("Your eszy plan doesn't include this feature. An Admin can add it in Settings, Subscription."));
