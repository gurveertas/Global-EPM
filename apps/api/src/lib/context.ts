import { autoAudit } from "./audit";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createPool, withTenant, withPlatform, type Db } from "@eszy/db";
import type { Permission, Feature } from "@eszy/shared";
import { env } from "./env";
import { unauthorized } from "./errors";

export const pool = createPool(env.DATABASE_URL);

export interface TenantCtx {
  id: string;
  slug: string;
  name: string;
  status: string;
  planId: string | null;
  features: Set<Feature>;
  rateLimit: number;
  maxProjects: number | null;
}
export interface UserCtx {
  id: string;
  name: string;
  email: string;
  isOwner: boolean;
  teamId: string | null;
  permissions: Set<Permission>;
  roleKeys: string[];
  leadsTeamIds: string[]; // teams this person leads
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: TenantCtx;
      user?: UserCtx;
      platformAdmin?: { id: string; email: string };
    }
  }
}

export const can = (req: Request, p: Permission) => !!req.user?.permissions.has(p);

/** Wraps a handler in a company transaction. Whatever it returns is sent as JSON. */
export function h(fn: (req: Request, db: Db, res: Response) => Promise<unknown>): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.tenant) throw unauthorized("Company not found");
      const out = await withTenant(pool, req.tenant.id, async (db) => {
        const r = await fn(req, db, res);
        await autoAudit(db, req);
        return r;
      });
      if (!res.headersSent) res.json(withoutMoney(req, out ?? { ok: true }));
    } catch (e) {
      next(e);
    }
  };
}

/**
 * Amounts and rates are only for people with "See amounts, rates, revenue and costs". For everyone else every money field
 * (anything in minor units, rates, revenue, cost, profit, margin) is taken out of the response, whatever the route.
 */
const MONEY_KEY = /(_minor|Minor)$|^(rate|rates|revenue|profit|margin|cost|costs|labour|expenses)$/;
function withoutMoney(req: Request, v: unknown): unknown {
  if (!req.user || req.user.permissions.has("money.view")) return v;
  const strip = (x: any, depth: number): any => {
    if (depth > 12 || x === null || typeof x !== "object") return x;
    if (x instanceof Date || Buffer.isBuffer(x)) return x;
    if (Array.isArray(x)) return x.map((i) => strip(i, depth + 1));
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(x)) if (!MONEY_KEY.test(k)) o[k] = strip(val, depth + 1);
    return o;
  };
  return strip(v, 0);
}

/** Same as h() but on the platform layer (no company scope). */
export function hp(fn: (req: Request, db: Db, res: Response) => Promise<unknown>): RequestHandler {
  return async (req, res, next) => {
    try {
      const out = await withPlatform(pool, (db) => fn(req, db, res));
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      next(e);
    }
  };
}

export const userId = (req: Request) => {
  if (!req.user) throw unauthorized();
  return req.user.id;
};
