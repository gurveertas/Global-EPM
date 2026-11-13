import { authenticator } from "otplib";
import QRCode from "qrcode";
import jwt from "jsonwebtoken";
import { decrypt, encrypt } from "./crypto";
import { env } from "./env";

authenticator.options = { window: 1 }; // accept the code before and after, for clock drift

/** A new two-factor secret, its otpauth link and a QR code image for authenticator apps. */
export async function newTotp(label: string, issuer: string) {
  const secret = authenticator.generateSecret();
  const url = authenticator.keyuri(label, issuer, secret);
  return { secretEncrypted: encrypt(secret), secret, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}
export const checkTotp = (code: string, secretEncrypted: string | null) =>
  !!secretEncrypted && /^\d{6}$/.test(code.trim()) && authenticator.check(code.trim(), decrypt(secretEncrypted));

/** Short-lived token proving the password step passed; the second step exchanges it with a code. */
export const signChallenge = (sub: string, scope: string) => jwt.sign({ sub, scope, typ: "2fa" }, env.JWT_SECRET, { expiresIn: "5m" });
export function readChallenge(token: string, scope: string): string {
  const c = jwt.verify(token, env.JWT_SECRET) as { sub: string; scope: string; typ: string };
  if (c.typ !== "2fa" || c.scope !== scope) throw new Error("bad challenge");
  return c.sub;
}
