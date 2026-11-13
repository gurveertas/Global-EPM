import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { withTenant, type Db } from "@eszy/db";
import { applyAccessOverrides, type Permission } from "@eszy/shared";
import { pool, type UserCtx } from "./context";
import { env, isProd } from "./env";
import { forbidden, unauthorized } from "./errors";
import { randomToken, sha256 } from "./crypto";

interface AccessClaims { sub: string; tid: string; typ: "user" }
interface PlatformClaims { sub: string; email: string; typ: "platform" }

export function signAccess(userId: string, tenantId: string) {
  return jwt.sign({ sub: userId, tid: tenantId, typ: "user" } satisfies AccessClaims, env.JWT_SECRET, { expiresIn: `${env.ACCESS_TOKEN_MINUTES}m` });
}
export function signPlatform(adminId: string, email: string) {
  return jwt.sign({ sub: adminId, email, typ: "platform" } satisfies PlatformClaims, env.JWT_SECRET, { expiresIn: "12h" });
}

/** Creates a refresh token row and sets it as an httpOnly cookie on the company's own host. */
export async function issueRefresh(db: Db, res: Response, tenantId: string, userId: string, days = env.REFRESH_TOKEN_DAYS) {
  const token = randomToken(48);
  await db.query(
    "INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(days => $4))",
    [tenantId, userId, sha256(token), days],
  );
  res.cookie("eszy_rt", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/api/v1/auth",
    maxAge: days * 86400_000,
  });
  return token;
}

export async function loadUserCtx(db: Db, userId: string): Promise<UserCtx | null> {
  const u = (
    await db.query(
      `SELECT u.id, u.name, u.email, u.is_owner, u.team_id, u.status, u.permission_overrides,
              coalesce(array_agg(DISTINCT r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS role_keys,
              coalesce(array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL), '{}') AS perms,
              coalesce((SELECT array_agg(t.id) FROM teams t WHERE t.lead_user_id = u.id), '{}') AS leads_teams,
              EXISTS (SELECT 1 FROM users r LEFT JOIN teams rt ON rt.id = r.team_id
                      WHERE r.status = 'active' AND r.id <> u.id AND coalesce(r.reporting_manager_id, rt.lead_user_id) = u.id) AS has_reports
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       LEFT JOIN LATERAL unnest(r.permissions) p ON true
       WHERE u.id = $1 GROUP BY u.id`,
      [userId],
    )
  ).rows[0];
  if (!u || u.status !== "active") return null;
  const permissions = new Set<Permission>(u.perms);
  // The owner always keeps full access; everyone else gets their per-person overrides on top of their roles.
  if (!u.is_owner) applyAccessOverrides(permissions as Set<string>, u.permission_overrides);
  if (u.is_owner) for (const p of ["roles.manage", "settings.manage", "subscription.manage"] as Permission[]) permissions.add(p);
  // Being someone's reporting manager (or their team's lead) is what makes you their approver, whatever your role says.
  if (u.has_reports) for (const p of ["time.approve_team", "leave.approve_team", "performance.view_team", "users.view"] as Permission[]) permissions.add(p);
  return {
    id: u.id, name: u.name, email: u.email, isOwner: u.is_owner, teamId: u.team_id,
    permissions, roleKeys: u.role_keys, leadsTeamIds: u.leads_teams,
  };
}

/** Requires a valid access token for the company on this host. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const hdr = req.header("authorization") ?? "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    if (!token) throw unauthorized();
    let claims: AccessClaims;
    try {
      claims = jwt.verify(token, env.JWT_SECRET) as AccessClaims;
    } catch {
      throw unauthorized("Your session has expired. Sign in again.");
    }
    if (claims.typ !== "user" || !req.tenant || claims.tid !== req.tenant.id) throw unauthorized();
    const out = await withTenant(pool, req.tenant.id, async (db) => ({
      user: await loadUserCtx(db, claims.sub),
      twoFactorRequired: (await db.query("SELECT data->'auth'->>'twoFactor' AS tf FROM company_settings")).rows[0]?.tf === "required",
      totp: (await db.query("SELECT totp_enabled FROM users WHERE id = $1", [claims.sub])).rows[0]?.totp_enabled,
    }));
    if (!out.user) throw unauthorized("Your account is not active");
    req.user = out.user;
    // When the company requires two-factor, people who haven't set it up can only reach their profile to do so.
    if (out.twoFactorRequired && !out.totp && !/^\/api\/v1\/(me(\/2fa.*)?|notifications.*)$/.test(req.originalUrl.split("?")[0])) {
      throw forbidden("Your company requires two-step sign-in. Set it up in your profile to continue.");
    }
    next();
  } catch (e) {
    next(e);
  }
}

export const requirePerm = (...perms: Permission[]) => (req: Request, _res: Response, next: NextFunction) =>
  perms.some((p) => req.user?.permissions.has(p)) ? next() : next(forbidden());

export function authenticatePlatform(req: Request, _res: Response, next: NextFunction) {
  try {
    const hdr = req.header("authorization") ?? "";
    const claims = jwt.verify(hdr.replace(/^Bearer /, ""), env.JWT_SECRET) as PlatformClaims;
    if (claims.typ !== "platform") throw new Error();
    req.platformAdmin = { id: claims.sub, email: claims.email };
    next();
  } catch {
    next(unauthorized());
  }
}
