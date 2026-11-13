import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { ACCESS_MODULES, ALL_PERMISSIONS, PERMISSIONS, FEATURES, accessFor, applyAccessOverrides, userInputSchema } from "@eszy/shared";
import { creditLeave, withPlatform } from "@eszy/db";
import { can, h, pool, userId } from "../lib/context";
import { requirePerm } from "../lib/auth";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { getSettings, maskSettings, saveSettings } from "../lib/settings";
import { audit, auditChange, snapshot } from "../lib/audit";
import { randomToken, sha256 } from "../lib/crypto";
import { enqueueEmail } from "../lib/queue";
import { responsibilities, runHandover } from "../services/handover";
import { companyUrl } from "../lib/env";
import { checkTotp, newTotp } from "../lib/totp";
import { clearTenantCache } from "../lib/tenant";

export const peopleRouter = Router();
const uuid = z.string().uuid();

// ---------- me ----------
peopleRouter.get("/me", h(async (req, db) => {
  const u = req.user!;
  const s = await getSettings(db);
  const sub = await withPlatform(pool, async (pdb) =>
    (await pdb.query("SELECT s.status, s.current_period_end, s.seats, s.interval, p.name AS plan_name, p.code AS plan_code, t.trial_ends_at FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN tenants t ON t.id = s.tenant_id WHERE s.tenant_id = $1", [req.tenant!.id])).rows[0],
  );
  const unread = (await db.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [u.id])).rows[0].n;
  const prof = (await db.query("SELECT has_photo, address, emergency_contact_name, emergency_contact_phone, date_of_birth, totp_enabled, phone FROM users WHERE id = $1", [u.id])).rows[0];
  return {
    user: { id: u.id, name: u.name, email: u.email, isOwner: u.isOwner, teamId: u.teamId, roles: u.roleKeys, leadsTeamIds: u.leadsTeamIds, ...prof,
      mustSetUpTwoFactor: s.auth.twoFactor === "required" && !prof.totp_enabled },
    permissions: [...u.permissions],
    tenant: { id: req.tenant!.id, slug: req.tenant!.slug, name: req.tenant!.name, status: req.tenant!.status, features: [...req.tenant!.features] },
    subscription: sub ?? null,
    settings: { branding: s.branding, locale: s.locale, policies: s.policies, invoices: { dueSoonDays: s.invoices.dueSoonDays }, auth: { twoFactor: s.auth.twoFactor } },
    unreadNotifications: unread,
  };
}));

peopleRouter.patch("/me", h(async (req, db) => {
  const b = z.object({
    name: z.string().min(1).optional(), phone: z.string().optional(), currentPassword: z.string().optional(), newPassword: z.string().min(8).optional(),
    address: z.string().optional(), emergencyContactName: z.string().optional(), emergencyContactPhone: z.string().optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }).parse(req.body);
  await db.query(
    `UPDATE users SET address = coalesce($2,address), emergency_contact_name = coalesce($3,emergency_contact_name), emergency_contact_phone = coalesce($4,emergency_contact_phone),
       date_of_birth = CASE WHEN $5 THEN $6::date ELSE date_of_birth END WHERE id = $1`,
    [userId(req), b.address ?? null, b.emergencyContactName ?? null, b.emergencyContactPhone ?? null, b.dateOfBirth !== undefined, b.dateOfBirth ?? null],
  );
  if (b.newPassword) {
    const row = (await db.query("SELECT password_hash FROM users WHERE id = $1", [userId(req)])).rows[0];
    if (row.password_hash && !(await bcrypt.compare(b.currentPassword ?? "", row.password_hash))) throw badRequest("Your current password is wrong");
    await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [await bcrypt.hash(b.newPassword, 11), userId(req)]);
  }
  await db.query("UPDATE users SET name = coalesce($1, name), phone = coalesce($2, phone) WHERE id = $3", [b.name ?? null, b.phone ?? null, userId(req)]);
  return { ok: true };
}));

// ---------- notifications ----------
peopleRouter.get("/notifications", h(async (req, db) =>
  (await db.query("SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100", [userId(req)])).rows));
peopleRouter.post("/notifications/read", h(async (req, db) => {
  const { ids } = z.object({ ids: z.array(uuid).optional() }).parse(req.body ?? {});
  await db.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2))", [userId(req), ids ?? null]);
  return { ok: true };
}));

// ---------- users ----------
const USER_COLS = `u.id, u.email, u.name, u.status, u.is_owner, u.team_id, u.phone, u.joined_on, u.last_login_at, u.created_at,
  u.department_id, d.name AS department_name, u.has_photo, u.address, u.emergency_contact_name, u.emergency_contact_phone, u.date_of_birth,
  u.probation_ends_on, u.notice_starts_on, u.last_working_day, u.deactivated_reason, u.totp_enabled,
  u.employee_code, u.employment_status, u.inactive_from, u.designation, u.reporting_manager_id,
  (SELECT name FROM users rm WHERE rm.id = coalesce(u.reporting_manager_id, t.lead_user_id)) AS reporting_manager_name,
  t.name AS team_name, t.lead_user_id AS team_lead_id,
  coalesce((SELECT json_agg(json_build_object('id', r.id, 'key', r.key, 'name', r.name)) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]') AS roles`;

peopleRouter.get("/users", h(async (req, db) => {
  // Everyone can list active colleagues by name (needed for pickers); details need users.view.
  const full = can(req, "users.view");
  const money = can(req, "money.view");
  const rows = (await db.query(`SELECT ${USER_COLS}, u.cost_per_hour_minor FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN departments d ON d.id = u.department_id ${full ? "" : "WHERE u.status = 'active'"} ORDER BY u.name`)).rows;
  return rows.map((r) => {
    if (!money) delete r.cost_per_hour_minor;
    if (!full) return { id: r.id, name: r.name, designation: r.designation, employee_code: r.employee_code, reporting_manager_name: r.reporting_manager_name, team_id: r.team_id, team_name: r.team_name, department_name: r.department_name, has_photo: r.has_photo, roles: r.roles };
    return r;
  });
}));

peopleRouter.get("/users/:id", requirePerm("users.view"), h(async (req, db) => {
  const r = (await db.query(`SELECT ${USER_COLS}, u.cost_per_hour_minor FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = $1`, [uuid.parse(req.params.id)])).rows[0];
  if (!r) throw notFound();
  if (!can(req, "money.view")) delete r.cost_per_hour_minor;
  return r;
}));

async function checkSeats(db: any, tenantId: string) {
  const sub = await withPlatform(pool, async (p) => (await p.query("SELECT s.seats, s.status, pl.max_users FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id WHERE s.tenant_id = $1", [tenantId])).rows[0]);
  if (!sub) return;
  const n = (await db.query("SELECT count(*)::int AS n FROM users WHERE status <> 'disabled'")).rows[0].n;
  const limit = sub.status === "trialing" ? (sub.max_users ?? 1000) : Math.min(sub.seats, sub.max_users ?? Infinity);
  if (n >= limit) throw conflict(`Your plan has ${limit} seats and all are in use. Add seats in Settings, Subscription.`);
}

async function setRoles(db: any, req: any, uid: string, roleIds: string[]) {
  if (roleIds.length) {
    const adminRole = (await db.query("SELECT id FROM roles WHERE key = 'admin'")).rows[0];
    if (roleIds.includes(adminRole?.id) && !can(req, "roles.manage")) throw forbidden("Only people who manage roles can make someone an Admin");
  }
  await db.query("DELETE FROM user_roles WHERE user_id = $1", [uid]);
  for (const r of roleIds) await db.query("INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1,$2,$3)", [req.tenant.id, uid, r]);
}

async function sendInvite(db: any, req: any, uid: string) {
  const u = (await db.query("SELECT email, name FROM users WHERE id = $1", [uid])).rows[0];
  const token = randomToken();
  await db.query("UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND kind = 'invite' AND used_at IS NULL", [uid]);
  await db.query("INSERT INTO user_tokens (tenant_id, user_id, kind, token_hash, expires_at) VALUES ($1,$2,'invite',$3, now() + interval '7 days')", [req.tenant.id, uid, sha256(token)]);
  const s = await getSettings(db);
  await enqueueEmail({
    to: u.email,
    subject: `You're invited to ${s.branding.displayName || req.tenant.name} on eszy`,
    text: `Hi ${u.name},\n\n${req.user.name} invited you to ${req.tenant.name} on eszy.\nSet your password here (the link works for 7 days):\n${companyUrl(req.tenant.slug, `/invite?token=${token}`)}\n`,
  });
  return token;
}

peopleRouter.post("/users", requirePerm("users.manage"), h(async (req, db) => {
  const b = userInputSchema.parse(req.body);
  await checkSeats(db, req.tenant!.id);
  const u = (
    await db.query(
      `INSERT INTO users (tenant_id, email, name, status, team_id, phone, joined_on, cost_per_hour_minor, department_id, address, emergency_contact_name, emergency_contact_phone,
         date_of_birth, probation_ends_on, notice_starts_on, last_working_day)
       VALUES ($1, lower($2), $3, 'invited', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [req.tenant!.id, b.email, b.name, b.teamId ?? null, b.phone, b.joinedOn ?? null, can(req, "money.view") ? (b.costPerHourMinor ?? null) : null,
        b.departmentId ?? null, b.address ?? "", b.emergencyContactName ?? "", b.emergencyContactPhone ?? "", b.dateOfBirth ?? null,
        b.probationEndsOn ?? null, b.noticeStartsOn ?? null, b.lastWorkingDay ?? null],
    )
  ).rows[0];
  await setRoles(db, req, u.id, b.roleIds);
  await creditLeave(db, req.tenant!.id, u.id);
  await db.query("UPDATE users SET employee_code = $2, designation = $3, employment_status = $4, reporting_manager_id = $5, inactive_from = $6 WHERE id = $1",
    [u.id, b.employeeCode ?? "", b.designation ?? "", b.employmentStatus ?? (b.probationEndsOn ? "provisional" : "appointed"), b.reportingManagerId ?? null, b.inactiveFrom ?? null]);
  if (b.password) {
    // The admin set a password: the account is ready to use, no invite needed.
    await db.query("UPDATE users SET password_hash = $2, status = 'active' WHERE id = $1", [u.id, await bcrypt.hash(b.password, 11)]);
    await audit(db, req, "user.create", "user", u.id, { email: b.email });
    return { id: u.id, inviteUrl: null };
  }
  const token = await sendInvite(db, req, u.id);
  await audit(db, req, "user.invite", "user", u.id, { email: b.email });
  return { id: u.id, inviteUrl: companyUrl(req.tenant!.slug, `/invite?token=${token}`) };
}));

peopleRouter.post("/users/:id/resend-invite", requirePerm("users.manage"), h(async (req, db) => {
  const token = await sendInvite(db, req, uuid.parse(req.params.id));
  return { ok: true, inviteUrl: companyUrl(req.tenant!.slug, `/invite?token=${token}`) };
}));

/**
 * Deactivate: the person can no longer sign in (every session ends now), is marked inactive from the given day,
 * and drops out of pickers, approvals and seat counts. Their sheets, hours and history stay as they were.
 */
peopleRouter.post("/users/:id/deactivate", requirePerm("users.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({ lastWorkingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reason: z.string().trim().max(500).optional(), removeFromProjects: z.boolean().optional() }).parse(req.body ?? {});
  const u = (await db.query("SELECT id, name, is_owner, status FROM users WHERE id = $1", [id])).rows[0];
  if (!u) throw notFound();
  if (u.is_owner) throw badRequest("The company owner can't be deactivated");
  if (id === userId(req)) throw badRequest("You can't deactivate yourself");
  const before = await snapshot(db, "users", id);
  const day = b.lastWorkingDay ?? new Date().toISOString().slice(0, 10);
  await db.query(
    `UPDATE users SET status = 'disabled', employment_status = 'inactive', inactive_from = $2::date, last_working_day = $2::date,
       deactivated_reason = $3, deactivated_at = now() WHERE id = $1`, [id, day, b.reason ?? ""]);
  await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
  // People who reported to them now report to whoever they reported to, so nobody drops out of the org chart.
  const up = (await db.query("SELECT reporting_manager_id FROM users WHERE id = $1", [id])).rows[0]?.reporting_manager_id ?? null;
  const moved = (await db.query("UPDATE users SET reporting_manager_id = $2 WHERE reporting_manager_id = $1 RETURNING id", [id, up])).rowCount ?? 0;
  let projects = 0;
  if (b.removeFromProjects) projects = (await db.query("DELETE FROM project_members WHERE user_id = $1", [id])).rowCount ?? 0;
  await auditChange(db, req, "user.deactivate", "users", id, before, { reason: b.reason ?? "", lastWorkingDay: day, removedFromProjects: projects, reportsMoved: moved });
  return { ok: true, removedFromProjects: projects, reportsMoved: moved };
}));
/** Reactivate: they can sign in again with their old password and roles. Needs a free seat. */
peopleRouter.post("/users/:id/reactivate", requirePerm("users.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const u = (await db.query("SELECT id, status, password_hash IS NOT NULL AS has_pw FROM users WHERE id = $1", [id])).rows[0];
  if (!u) throw notFound();
  if (u.status !== "disabled") return { ok: true };
  await checkSeats(db, req.tenant!.id);
  const before = await snapshot(db, "users", id);
  await db.query(
    `UPDATE users SET status = CASE WHEN $2 THEN 'active' ELSE 'invited' END, employment_status = 'appointed', inactive_from = NULL, last_working_day = NULL,
       deactivated_reason = '', deactivated_at = NULL WHERE id = $1`, [id, u.has_pw]);
  await auditChange(db, req, "user.reactivate", "users", id, before);
  return { ok: true };
}));

/** Cost per hour is set by finance on the Rates page, not by HR when adding someone. */
peopleRouter.put("/users/:id/cost", requirePerm("money.view"), h(async (req, db) => {
  const b = z.object({ costPerHourMinor: z.number().int().min(0).nullable() }).parse(req.body);
  const id = uuid.parse(req.params.id);
  const before = (await db.query("SELECT cost_per_hour_minor FROM users WHERE id = $1", [id])).rows[0];
  if (!before) throw notFound("Person not found");
  await db.query("UPDATE users SET cost_per_hour_minor = $2 WHERE id = $1", [id, b.costPerHourMinor]);
  await audit(db, req, "user.cost", "user", id, { changes: { costPerHourMinor: [before.cost_per_hour_minor, b.costPerHourMinor] } });
  return { ok: true };
}));
peopleRouter.put("/users/:id", requirePerm("users.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const b = userInputSchema.partial().parse(req.body);
  const target = (await db.query("SELECT is_owner FROM users WHERE id = $1", [id])).rows[0];
  if (!target) throw notFound();
  const before = await snapshot(db, "users", id);
  if (target.is_owner && b.status === "disabled") throw badRequest("The company owner can't be disabled");
  if (b.reportingManagerId) {
    // Nobody can report to themselves or to someone below them; that would make a loop in the org chart.
    if (b.reportingManagerId === id) throw badRequest("Someone can't report to themselves");
    const below = (await db.query(
      `WITH RECURSIVE down AS (SELECT id FROM users WHERE reporting_manager_id = $1 UNION SELECT u.id FROM users u JOIN down ON u.reporting_manager_id = down.id)
       SELECT 1 FROM down WHERE id = $2`, [id, b.reportingManagerId])).rowCount;
    if (below) throw badRequest("That person reports to them already, directly or further down. Pick someone above or beside them.");
  }
  await db.query(
    `UPDATE users SET name = coalesce($2, name), email = coalesce(lower($3), email), team_id = CASE WHEN $4 THEN $5::uuid ELSE team_id END,
       phone = coalesce($6, phone), joined_on = coalesce($7::date, joined_on), status = coalesce($8, status),
       cost_per_hour_minor = CASE WHEN $9 THEN $10::bigint ELSE cost_per_hour_minor END
     WHERE id = $1`,
    [id, b.name ?? null, b.email ?? null, b.teamId !== undefined, b.teamId ?? null, b.phone ?? null, b.joinedOn ?? null, b.status ?? null,
      b.costPerHourMinor !== undefined && can(req, "money.view"), b.costPerHourMinor ?? null],
  );
  if (b.roleIds) {
    if (target.is_owner) {
      const admin = (await db.query("SELECT id FROM roles WHERE key='admin'")).rows[0];
      if (!b.roleIds.includes(admin.id)) throw badRequest("The company owner always keeps the Admin role");
    }
    await setRoles(db, req, id, b.roleIds);
  }
  const opt = (k: keyof typeof b, col: string) => (b[k] !== undefined ? db.query(`UPDATE users SET ${col} = $2 WHERE id = $1`, [id, b[k] ?? null]) : null);
  await opt("departmentId", "department_id");
  await opt("dateOfBirth", "date_of_birth");
  await opt("probationEndsOn", "probation_ends_on");
  await opt("noticeStartsOn", "notice_starts_on");
  await opt("lastWorkingDay", "last_working_day");
  await opt("reportingManagerId", "reporting_manager_id");
  await opt("inactiveFrom", "inactive_from");
  if (b.employmentStatus !== undefined) {
    await db.query("UPDATE users SET employment_status = $2 WHERE id = $1", [id, b.employmentStatus]);
    // Marking someone inactive also stops them signing in from that date.
    if (b.employmentStatus === "inactive" && (!b.inactiveFrom || b.inactiveFrom <= new Date().toISOString().slice(0, 10)) && !target.is_owner) {
      await db.query("UPDATE users SET status = 'disabled' WHERE id = $1", [id]);
      await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
    }
  }
  if (b.password) await db.query("UPDATE users SET password_hash = $2, status = CASE WHEN status = 'invited' THEN 'active' ELSE status END WHERE id = $1", [id, await bcrypt.hash(b.password, 11)]);
  for (const [k, col] of [["address", "address"], ["emergencyContactName", "emergency_contact_name"], ["emergencyContactPhone", "emergency_contact_phone"], ["employeeCode", "employee_code"], ["designation", "designation"]] as const) {
    if (b[k] !== undefined) await db.query(`UPDATE users SET ${col} = $2 WHERE id = $1`, [id, b[k] ?? ""]);
  }
  if (b.status === "disabled") await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
  await auditChange(db, req, "user.update", "users", id, before);
  return { ok: true };
}));

// ---------- roles & permissions ----------
peopleRouter.get("/permissions", h(async () => ({ permissions: PERMISSIONS, features: FEATURES })));
/** One person's access per module: what their roles give, their overrides, and the result. */
peopleRouter.get("/users/:id/access", requirePerm("roles.view", "roles.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const u = (await db.query(
    `SELECT u.id, u.name, u.is_owner, u.permission_overrides,
       coalesce((SELECT array_agg(DISTINCT p) FROM user_roles ur JOIN roles r ON r.id = ur.role_id, unnest(r.permissions) p WHERE ur.user_id = u.id), '{}') AS perms,
       coalesce((SELECT array_agg(r.name ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '{}') AS role_names
     FROM users u WHERE u.id = $1`, [id])).rows[0];
  if (!u) throw notFound();
  const fromRoles = new Set<string>(u.perms);
  const effective = applyAccessOverrides(new Set(fromRoles), u.is_owner ? {} : u.permission_overrides);
  return {
    id: u.id, name: u.name, isOwner: u.is_owner, roles: u.role_names, overrides: u.permission_overrides,
    modules: ACCESS_MODULES.map((m) => ({ ...m, fromRole: accessFor(m, fromRoles), effective: accessFor(m, effective), override: u.permission_overrides?.[m.key] ?? null })),
  };
}));
/** Everyone's access at a glance, for the "By person" view of Roles and permissions: roles, team, overrides and each module's level. */
peopleRouter.get("/access/overview", requirePerm("roles.view", "roles.manage"), h(async (_req, db) => {
  const rows = (await db.query(
    `SELECT u.id, u.name, u.email, u.status, u.is_owner, u.designation, u.permission_overrides, t.name AS team_name,
       coalesce((SELECT array_agg(DISTINCT p) FROM user_roles ur JOIN roles r ON r.id = ur.role_id, unnest(r.permissions) p WHERE ur.user_id = u.id), '{}') AS perms,
       coalesce((SELECT json_agg(json_build_object('id', r.id, 'name', r.name) ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]') AS roles
     FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.status <> 'disabled' ORDER BY u.name`)).rows;
  return {
    modules: ACCESS_MODULES.map((m) => ({ key: m.key, label: m.label, group: m.group, view: m.view.length > 0, edit: m.edit.length > 0 })),
    people: rows.map((u) => {
      const fromRoles = new Set<string>(u.perms);
      const eff = u.is_owner ? new Set<string>(ALL_PERMISSIONS) : applyAccessOverrides(new Set(fromRoles), u.permission_overrides);
      return {
        id: u.id, name: u.name, email: u.email, designation: u.designation, team_name: u.team_name, is_owner: u.is_owner, roles: u.roles,
        overrides: Object.keys(u.permission_overrides ?? {}).length,
        access: Object.fromEntries(ACCESS_MODULES.map((m) => [m.key, accessFor(m, eff)])),
      };
    }),
  };
}));
peopleRouter.put("/users/:id/access", requirePerm("roles.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const keys = ACCESS_MODULES.map((m) => m.key) as [string, ...string[]];
  const b = z.object({ overrides: z.record(z.enum(keys), z.enum(["hidden", "view", "edit"])) }).parse(req.body);
  const u = (await db.query("SELECT id, is_owner, permission_overrides FROM users WHERE id = $1", [id])).rows[0];
  if (!u) throw notFound();
  if (u.is_owner) throw badRequest("The owner always has full access");
  if (id === userId(req) && b.overrides.roles === "hidden") throw badRequest("You can't remove your own access to permissions");
  await db.query("UPDATE users SET permission_overrides = $2 WHERE id = $1", [id, JSON.stringify(b.overrides)]);
  await audit(db, req, "user.access", "users", id, { before: u.permission_overrides, after: b.overrides });
  return { ok: true };
}));

peopleRouter.get("/roles", h(async (_req, db) =>
  (await db.query("SELECT r.*, (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id) AS user_count FROM roles r ORDER BY r.is_system DESC, r.name")).rows));
const roleSchema = z.object({ name: z.string().min(1), permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])) });
peopleRouter.post("/roles", requirePerm("roles.manage"), h(async (req, db) => {
  const b = roleSchema.parse(req.body);
  const key = `custom_${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30)}_${randomToken(3).toLowerCase()}`;
  const r = (await db.query("INSERT INTO roles (tenant_id, key, name, permissions) VALUES ($1,$2,$3,$4) RETURNING *", [req.tenant!.id, key, b.name, b.permissions])).rows[0];
  await audit(db, req, "role.create", "role", r.id, b);
  return r;
}));
peopleRouter.put("/roles/:id", requirePerm("roles.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const b = roleSchema.partial().parse(req.body);
  const role = (await db.query("SELECT key FROM roles WHERE id = $1", [id])).rows[0];
  if (!role) throw notFound();
  if (role.key === "admin" && b.permissions) throw badRequest("The Admin role always has every permission");
  const before = await snapshot(db, "roles", id);
  await db.query("UPDATE roles SET name = coalesce($2, name), permissions = coalesce($3, permissions) WHERE id = $1", [id, b.name ?? null, b.permissions ?? null]);
  await auditChange(db, req, "role.update", "roles", id, before);
  return { ok: true };
}));
peopleRouter.delete("/roles/:id", requirePerm("roles.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const role = (await db.query("SELECT is_system, (SELECT count(*) FROM user_roles WHERE role_id = $1)::int AS n FROM roles WHERE id = $1", [id])).rows[0];
  if (!role) throw notFound();
  if (role.is_system) throw badRequest("Built-in roles can be renamed or changed, but not deleted");
  if (role.n) throw conflict("Move the people in this role to another role first");
  await db.query("DELETE FROM roles WHERE id = $1", [id]);
  return { ok: true };
}));

// ---------- teams ----------
peopleRouter.get("/teams", h(async (_req, db) =>
  (await db.query(`SELECT t.*, l.name AS lead_name, mg.name AS manager_name, d.name AS department_name,
       (SELECT count(*)::int FROM users u WHERE u.team_id = t.id AND u.status <> 'disabled') AS member_count,
       coalesce((SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'phone', u.phone, 'employee_code', u.employee_code, 'has_photo', u.has_photo) ORDER BY u.name)
         FROM users u WHERE u.team_id = t.id AND u.status <> 'disabled'), '[]') AS members
     FROM teams t LEFT JOIN users l ON l.id = t.lead_user_id LEFT JOIN users mg ON mg.id = t.manager_user_id LEFT JOIN departments d ON d.id = t.department_id ORDER BY t.name`)).rows));
const teamSchema = z.object({ name: z.string().min(1), leadUserId: uuid.nullable().optional(), managerUserId: uuid.nullable().optional(), departmentId: uuid.nullable().optional(), memberIds: z.array(uuid).optional() });
async function saveTeamMembers(db: any, teamId: string, memberIds?: string[], leadId?: string | null) {
  if (memberIds) {
    await db.query("UPDATE users SET team_id = NULL WHERE team_id = $1 AND NOT (id = ANY($2))", [teamId, memberIds]);
    await db.query("UPDATE users SET team_id = $1 WHERE id = ANY($2)", [teamId, memberIds]);
  }
  if (leadId) await db.query("UPDATE users SET team_id = coalesce(team_id, $1) WHERE id = $2", [teamId, leadId]);
}
peopleRouter.post("/teams", requirePerm("teams.manage"), h(async (req, db) => {
  const b = teamSchema.parse(req.body);
  const t = (await db.query("INSERT INTO teams (tenant_id, name, lead_user_id) VALUES ($1,$2,$3) RETURNING *", [req.tenant!.id, b.name, b.leadUserId ?? null])).rows[0];
  await db.query("UPDATE teams SET manager_user_id = $2, department_id = $3 WHERE id = $1", [t.id, b.managerUserId ?? null, b.departmentId ?? null]);
  await saveTeamMembers(db, t.id, b.memberIds, b.leadUserId);
  await audit(db, req, "team.create", "team", t.id, b);
  return t;
}));
peopleRouter.put("/teams/:id", requirePerm("teams.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const b = teamSchema.partial().parse(req.body);
  await db.query("UPDATE teams SET name = coalesce($2, name), lead_user_id = CASE WHEN $3 THEN $4::uuid ELSE lead_user_id END WHERE id = $1", [id, b.name ?? null, b.leadUserId !== undefined, b.leadUserId ?? null]);
  if (b.managerUserId !== undefined) await db.query("UPDATE teams SET manager_user_id = $2 WHERE id = $1", [id, b.managerUserId]);
  if (b.departmentId !== undefined) await db.query("UPDATE teams SET department_id = $2 WHERE id = $1", [id, b.departmentId]);
  await saveTeamMembers(db, id, b.memberIds, b.leadUserId);
  await audit(db, req, "team.update", "team", id, b);
  return { ok: true };
}));
peopleRouter.delete("/teams/:id", requirePerm("teams.manage"), h(async (req, db) => {
  await db.query("DELETE FROM teams WHERE id = $1", [uuid.parse(req.params.id)]);
  return { ok: true };
}));

// ---------- settings ----------
peopleRouter.get("/settings", requirePerm("settings.manage"), h(async (_req, db) => maskSettings(await getSettings(db))));
peopleRouter.put("/settings", requirePerm("settings.manage"), h(async (req, db) => {
  if (req.body?.auth?.twoFactor === "required") {
    const me = (await db.query("SELECT totp_enabled FROM users WHERE id = $1", [userId(req)])).rows[0];
    if (!me?.totp_enabled) throw badRequest("Turn on two-step sign-in for yourself first (in your profile), so you don't lock yourself out.");
  }
  const before = maskSettings(await getSettings(db)) as any;
  const saved = await saveSettings(db, req.tenant!.id, req.body ?? {});
  const after = maskSettings(saved) as any;
  const changes: Record<string, [unknown, unknown]> = {};
  for (const sec of Object.keys(req.body ?? {})) for (const k of Object.keys(after[sec] ?? {})) {
    if (JSON.stringify(before[sec]?.[k]) !== JSON.stringify(after[sec]?.[k])) changes[`${sec}.${k}`] = [before[sec]?.[k] ?? null, after[sec]?.[k] ?? null];
  }
  await audit(db, req, "settings.update", "settings", null, { changes });
  clearTenantCache();
  return maskSettings(saved);
}));

// ---------- activity ----------
/**
 * Who did what, newest first. Without a scope it is the whole company (needs the change-history permission).
 * Scoped to a client, person, invoice or lead it needs that record's own view permission, and includes related records:
 * a client's projects and invoices, or everything a person did and everything done to them.
 */
peopleRouter.get("/activity", h(async (req, db) => {
  const q = z.object({
    entity: z.enum(["client", "user", "invoice", "lead", "project"]).optional(), entityId: z.string().max(64).optional(),
    by: uuid.optional(), kind: z.string().max(40).optional(), q: z.string().max(100).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    before: z.coerce.number().optional(), limit: z.coerce.number().int().min(5).max(200).optional(),
  }).parse(req.query);
  const scoped = q.entity && q.entityId;
  if (!scoped && !can(req, "audit.view")) throw forbidden("You need the change history permission to see everyone's activity");
  if (scoped) {
    const ok = q.entity === "client" ? can(req, "clients.view") || can(req, "audit.view")
      : q.entity === "user" ? can(req, "users.view") || q.entityId === userId(req)
      : q.entity === "invoice" ? can(req, "invoices.view")
      : q.entity === "lead" ? can(req, "leads.view_all") || can(req, "audit.view")
      : can(req, "projects.view_all") || can(req, "audit.view");
    if (!ok) throw forbidden();
  }
  const where: string[] = [], vals: unknown[] = [];
  const v = (x: unknown) => { vals.push(x); return `$${vals.length}`; };
  if (scoped) {
    const id = v(q.entityId);
    if (q.entity === "client") where.push(`((a.entity = 'client' AND a.entity_id = ${id})
      OR (a.entity = 'project' AND a.entity_id IN (SELECT id::text FROM projects WHERE client_id::text = ${id}))
      OR (a.entity = 'invoice' AND a.entity_id IN (SELECT i.id::text FROM invoices i JOIN projects p ON p.id = i.project_id WHERE p.client_id::text = ${id}))
      OR (a.data->>'projectId' IN (SELECT id::text FROM projects WHERE client_id::text = ${id})))`);
    else if (q.entity === "user") where.push(`((a.entity = 'user' AND a.entity_id = ${id}) OR a.user_id::text = ${id})`);
    else if (q.entity === "project") where.push(`((a.entity = 'project' AND a.entity_id = ${id}) OR a.data->>'projectId' = ${id} OR (a.entity = 'invoice' AND a.entity_id IN (SELECT id::text FROM invoices WHERE project_id::text = ${id})))`);
    else where.push(`(a.entity = ${v(q.entity)} AND a.entity_id = ${id})`);
  }
  if (q.by) where.push(`a.user_id = ${v(q.by)}`);
  if (q.kind) where.push(`(a.entity = ${v(q.kind)} OR a.action LIKE ${v(`${q.kind}.%`)})`);
  if (q.q) where.push(`(a.action ILIKE ${v(`%${q.q}%`)} OR a.data::text ILIKE ${v(`%${q.q}%`)} OR u.name ILIKE ${v(`%${q.q}%`)})`);
  if (q.from) where.push(`a.at >= ${v(q.from)}::date`);
  if (q.to) where.push(`a.at < (${v(q.to)}::date + 1)`);
  if (q.before) where.push(`a.id < ${v(q.before)}`);
  if (!can(req, "money.view")) where.push(`a.action !~ '^(invoice|payment|billing_line|extra_hours|refund|expense)'`);
  const limit = q.limit ?? 50;
  const rows = (await db.query(
    `SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.data, a.user_id, u.name AS user_name,
       CASE a.entity
         WHEN 'project' THEN (SELECT name FROM projects WHERE id::text = a.entity_id)
         WHEN 'client' THEN (SELECT name FROM clients WHERE id::text = a.entity_id)
         WHEN 'user' THEN (SELECT name FROM users WHERE id::text = a.entity_id)
         WHEN 'invoice' THEN (SELECT number FROM invoices WHERE id::text = a.entity_id)
         WHEN 'lead' THEN (SELECT title FROM leads WHERE id::text = a.entity_id)
         WHEN 'team' THEN (SELECT name FROM teams WHERE id::text = a.entity_id)
         WHEN 'role' THEN (SELECT name FROM roles WHERE id::text = a.entity_id)
         WHEN 'asset' THEN (SELECT name FROM assets WHERE id::text = a.entity_id)
         WHEN 'task' THEN (SELECT title FROM tasks WHERE id::text = a.entity_id)
       END AS entity_name,
       (SELECT name FROM projects WHERE id::text = a.data->>'projectId') AS project_name
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.id DESC LIMIT ${limit + 1}`, vals)).rows;
  return { rows: rows.slice(0, limit), more: rows.length > limit, next: rows.length > limit ? rows[limit - 1].id : null };
}));

// ---------- audit ----------
peopleRouter.get("/audit", requirePerm("audit.view"), h(async (req, db) => {
  const q = z.object({ entity: z.string().optional(), before: z.coerce.number().optional() }).parse(req.query);
  return (await db.query(
    `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE ($1::text IS NULL OR a.entity = $1) AND ($2::bigint IS NULL OR a.id < $2) ORDER BY a.id DESC LIMIT 200`,
    [q.entity ?? null, q.before ?? null],
  )).rows;
}));

// ---------- two-step sign-in ----------
peopleRouter.post("/me/2fa/setup", h(async (req, db) => {
  const t = await newTotp(req.user!.email, `eszy (${req.tenant!.name})`);
  await db.query("UPDATE users SET totp_secret = $2 WHERE id = $1 AND NOT totp_enabled", [userId(req), t.secretEncrypted]);
  return { url: t.url, qr: t.qr, secret: t.secret };
}));
peopleRouter.post("/me/2fa/enable", h(async (req, db) => {
  const { code } = z.object({ code: z.string() }).parse(req.body);
  const u = (await db.query("SELECT totp_secret FROM users WHERE id = $1", [userId(req)])).rows[0];
  if (!checkTotp(code, u?.totp_secret)) throw badRequest("That code isn't right. Check your authenticator app and try again.");
  await db.query("UPDATE users SET totp_enabled = true WHERE id = $1", [userId(req)]);
  await audit(db, req, "2fa.enable", "user", userId(req));
  return { ok: true };
}));
peopleRouter.post("/me/2fa/disable", h(async (req, db) => {
  const { code } = z.object({ code: z.string() }).parse(req.body);
  const s = await getSettings(db);
  if (s.auth.twoFactor === "required") throw forbidden("Your company requires two-step sign-in");
  const u = (await db.query("SELECT totp_secret FROM users WHERE id = $1", [userId(req)])).rows[0];
  if (!checkTotp(code, u?.totp_secret)) throw badRequest("That code isn't right");
  await db.query("UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = $1", [userId(req)]);
  await audit(db, req, "2fa.disable", "user", userId(req));
  return { ok: true };
}));
/** For someone who lost their phone: an Admin turns two-step off so they can set it up again. */
peopleRouter.post("/users/:id/reset-2fa", requirePerm("users.manage"), h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  await db.query("UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = $1", [id]);
  await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
  await audit(db, req, "2fa.reset", "user", id);
  return { ok: true };
}));

// ---------- handovers: move one person's projects, teams, reports, tasks and leads to another ----------
const canHandover = (req: any) => can(req, "projects.assign") || can(req, "users.manage");
peopleRouter.get("/handovers/responsibilities/:id", h(async (req, db) => {
  if (!canHandover(req)) throw forbidden();
  return responsibilities(db, uuid.parse(req.params.id));
}));
peopleRouter.get("/handovers", h(async (req, db) => {
  if (!canHandover(req)) throw forbidden();
  const q = z.object({ userId: uuid.optional() }).parse(req.query);
  return (await db.query(
    `SELECT h.*, f.name AS from_name, t.name AS to_name, c.name AS created_by_name FROM handovers h
       JOIN users f ON f.id = h.from_user_id JOIN users t ON t.id = h.to_user_id LEFT JOIN users c ON c.id = h.created_by
     WHERE ($1::uuid IS NULL OR h.from_user_id = $1 OR h.to_user_id = $1) ORDER BY h.created_at DESC LIMIT 200`, [q.userId ?? null])).rows;
}));
peopleRouter.post("/handovers", h(async (req, db) => {
  if (!canHandover(req)) throw forbidden("Only Admin, HR or whoever assigns PMs and Team Leads can hand responsibilities over");
  const ids = z.array(uuid).default([]);
  const b = z.object({
    fromUserId: uuid, toUserId: uuid, projectIds: ids, teamIds: ids, reportIds: ids, taskIds: ids, leadIds: ids,
    keepOnProjects: z.boolean().default(false), note: z.string().max(2000).default(""),
  }).parse(req.body);
  if (![b.projectIds, b.teamIds, b.reportIds, b.taskIds, b.leadIds].some((x) => x.length)) throw badRequest("Pick at least one thing to hand over");
  return runHandover(db, req, b);
}));
