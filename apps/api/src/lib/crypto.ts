import crypto from "node:crypto";
import { env } from "./env";

const key = crypto.createHash("sha256").update(env.APP_ENCRYPTION_KEY).digest();

/** AES-256-GCM. Output: "enc:v1:<iv>:<tag>:<data>" in base64. */
export function encrypt(plain: string): string {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `enc:v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}
export function decrypt(value: string): string {
  if (!value || !value.startsWith("enc:v1:")) return value ?? "";
  const [, , iv, tag, data] = value.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}
export const isEncrypted = (v: unknown) => typeof v === "string" && v.startsWith("enc:v1:");

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

/** Encrypt data with a passphrase (backups). Output starts with a salt and iv. */
export function encryptWithPassphrase(buf: Buffer, passphrase: string): Buffer {
  const salt = crypto.randomBytes(16);
  const k = crypto.scryptSync(passphrase, salt, 32);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from("ESZYBK1"), salt, iv, c.getAuthTag(), data]);
}
export function decryptWithPassphrase(buf: Buffer, passphrase: string): Buffer {
  const salt = buf.subarray(7, 23), iv = buf.subarray(23, 35), tag = buf.subarray(35, 51), data = buf.subarray(51);
  const d = crypto.createDecipheriv("aes-256-gcm", crypto.scryptSync(passphrase, salt, 32), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]);
}
