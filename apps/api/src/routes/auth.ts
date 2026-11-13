import { Router } from "express";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { loginSchema } from "@eszy/shared";
import { h } from "../lib/context";
import { issueRefresh, loadUserCtx, signAccess } from "../lib/auth";
import { badRequest, forbidden, unauthorized } from "../lib/errors";
import { randomToken, sha256 } from "../lib/crypto";
import { getSettings } from "../lib/settings";
import { enqueueEmail } from "../lib/queue";
import { companyUrl } from "../lib/env";
import { audit } from "../lib/audit";
import { checkTotp, readChallenge, signChallenge } from "../lib/totp";
import type { Db } from "@eszy/db";
import type { Request, Response } from "express";

export const authRouter = Router();

async function session(db: Db, req: Request, res: Response, userId: string) {
  await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
  const s = await getSettings(db);
  await issueRefresh(db, res, req.tenant!.id, userId, s.auth.sessionDays);
  const u = await loadUserCtx(db, userId);
  if (!u) throw unauthorized("Your account is not active");
  return { accessToken: signAccess(userId, req.tenant!.id), user: { id: u.id, name: u.name, email: u.email } };
}

authRouter.post("/login", h(async (req, db, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const u = (await db.query("SELECT id, password_hash, status, is_owner FROM users WHERE email = lower($1)", [email])).rows[0];
  const ok = u?.password_hash && (await bcrypt.compare(password, u.password_hash));
  if (!ok) throw unauthorized("Email or password is wrong");
  if (u.status !== "active") throw unauthorized("Your account is not active");
  const s = await getSettings(db);
  if (s.auth.googleEnabled && s.auth.googleRequired && !u.is_owner) throw forbidden("Your company requires Sign in with Google");
  return secondStep(db, req, res, u.id);
}));

/** If the person has two-step sign-in on, the password step returns a challenge instead of a session. */
async function secondStep(db: Db, req: Request, res: Response, uid: string) {
  const t = (await db.query("SELECT totp_enabled FROM users WHERE id = $1", [uid])).rows[0];
  if (t?.totp_enabled) return { twoFactor: true, challenge: signChallenge(uid, req.tenant!.id) };
  return session(db, req, res, uid);
}

authRouter.post("/2fa", h(async (req, db, res) => {
  const { challenge, code } = z.object({ challenge: z.string(), code: z.string() }).parse(req.body);
  let uid: string;
  try { uid = readChallenge(challenge, req.tenant!.id); } catch { throw unauthorized("Sign in again"); }
  const u = (await db.query("SELECT totp_secret FROM users WHERE id = $1 AND status = 'active'", [uid])).rows[0];
  if (!u || !checkTotp(code, u.totp_secret)) throw unauthorized("That code isn't right. Use the latest code from your authenticator app.");
  await audit(db, null, "login.2fa", "user", uid);
  return session(db, req, res, uid);
}));

authRouter.post("/refresh", h(async (req, db, res) => {
  const token = req.cookies?.eszy_rt;
  if (!token) throw unauthorized();
  const row = (
    await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now() RETURNING user_id", [sha256(token)])
  ).rows[0];
  if (!row) throw unauthorized("Your session has expired. Sign in again.");
  return session(db, req, res, row.user_id);
}));

authRouter.post("/logout", h(async (req, db, res) => {
  const token = req.cookies?.eszy_rt;
  if (token) await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1", [sha256(token)]);
  res.clearCookie("eszy_rt", { path: "/api/v1/auth" });
  return { ok: true };
}));

authRouter.post("/forgot", h(async (req, db) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const u = (await db.query("SELECT id, name, email FROM users WHERE email = lower($1) AND status = 'active'", [email])).rows[0];
  if (u) {
    const token = randomToken();
    await db.query(
      "INSERT INTO user_tokens (tenant_id, user_id, kind, token_hash, expires_at) VALUES ($1,$2,'reset',$3, now() + interval '1 hour')",
      [req.tenant!.id, u.id, sha256(token)],
    );
    await enqueueEmail({
      to: u.email,
      subject: "Reset your eszy password",
      text: `Hi ${u.name},\n\nUse this link within an hour to set a new password:\n${companyUrl(req.tenant!.slug, `/reset?token=${token}`)}\n\nIf you didn't ask for this, ignore this email.`,
    });
  }
  return { ok: true, message: "If that email has an account, we've sent a reset link." };
}));

const tokenPassword = z.object({ token: z.string().min(10), password: z.string().min(8), name: z.string().optional() });

async function useToken(db: Db, token: string, kind: "reset" | "invite") {
  const row = (
    await db.query(
      "UPDATE user_tokens SET used_at = now() WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now() RETURNING user_id",
      [sha256(token), kind],
    )
  ).rows[0];
  if (!row) throw badRequest("This link has expired or was already used. Ask for a new one.");
  return row.user_id as string;
}

authRouter.post("/reset", h(async (req, db, res) => {
  const { token, password } = tokenPassword.parse(req.body);
  const uid = await useToken(db, token, "reset");
  await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [await bcrypt.hash(password, 11), uid]);
  await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [uid]);
  return session(db, req, res, uid);
}));

authRouter.post("/accept-invite", h(async (req, db, res) => {
  const { token, password, name } = tokenPassword.parse(req.body);
  const uid = await useToken(db, token, "invite");
  await db.query("UPDATE users SET password_hash = $1, status = 'active', name = coalesce(nullif($2,''), name) WHERE id = $3", [
    await bcrypt.hash(password, 11), name ?? "", uid,
  ]);
  return session(db, req, res, uid);
}));

authRouter.get("/config", h(async (req, db) => {
  const s = await getSettings(db);
  const clientId = s.auth.googleClientId || process.env.GOOGLE_CLIENT_ID || "";
  return {
    company: { name: s.branding.displayName || req.tenant!.name, logoUrl: s.branding.logoUrl, primaryColor: s.branding.primaryColor, theme: s.branding.theme },
    google: { enabled: s.auth.googleEnabled && !!clientId, required: s.auth.googleRequired, clientId },
  };
}));

/** Sign in with Google: the browser sends the ID token from Google's button; we check it and match the email. */
authRouter.post("/google", h(async (req, db, res) => {
  const { credential } = z.object({ credential: z.string().min(20) }).parse(req.body);
  const s = await getSettings(db);
  const clientId = s.auth.googleClientId || process.env.GOOGLE_CLIENT_ID || "";
  if (!s.auth.googleEnabled || !clientId) throw forbidden("Sign in with Google is not turned on for this company");
  const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId }).catch(() => null);
  const p = ticket?.getPayload();
  if (!p?.email || !p.email_verified) throw unauthorized("Google didn't confirm this email");
  const domain = p.email.split("@")[1];
  if (s.auth.allowedEmailDomains.length && !s.auth.allowedEmailDomains.includes(domain)) throw forbidden("This email domain isn't allowed here");
  const u = (await db.query("SELECT id, status FROM users WHERE email = lower($1)", [p.email])).rows[0];
  if (!u || u.status === "disabled") throw unauthorized("No eszy account uses this Google email. Ask your Admin to invite you.");
  await db.query("UPDATE users SET google_sub = $1, status = 'active', name = CASE WHEN name = '' THEN $2 ELSE name END WHERE id = $3", [p.sub, p.name ?? "", u.id]);
  await audit(db, null, "login.google", "user", u.id);
  return secondStep(db, req, res, u.id);
}));
