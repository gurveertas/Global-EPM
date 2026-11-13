import { companySettingsSchema, SECRET_SETTING_PATHS, type CompanySettings } from "@eszy/shared";
import type { Db } from "@eszy/db";
import { decrypt, encrypt, isEncrypted } from "./crypto";

const get = (o: any, p: string) => p.split(".").reduce((a, k) => a?.[k], o);
const set = (o: any, p: string, v: unknown) => {
  const ks = p.split(".");
  const last = ks.pop()!;
  ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v;
};
export const MASK = "••••••••";

/** Company settings with secrets decrypted (server use only). */
export async function getSettings(db: Db): Promise<CompanySettings> {
  const row = (await db.query("SELECT data FROM company_settings")).rows[0];
  const s = companySettingsSchema.parse(row?.data ?? {});
  for (const p of SECRET_SETTING_PATHS) {
    const v = get(s, p);
    if (isEncrypted(v)) set(s, p, decrypt(v));
  }
  return s;
}

/** Settings safe to send to the browser: secrets replaced by a mask. */
export function maskSettings(s: CompanySettings): CompanySettings {
  const c = structuredClone(s);
  for (const p of SECRET_SETTING_PATHS) if (get(c, p)) set(c, p, MASK);
  return c;
}

/** Merges a partial update. A masked secret means "keep the saved value". */
export async function saveSettings(db: Db, tenantId: string, patch: Record<string, any>): Promise<CompanySettings> {
  const current = await getSettings(db);
  const merged: any = structuredClone(current);
  for (const [section, values] of Object.entries(patch ?? {})) {
    if (values && typeof values === "object" && !Array.isArray(values)) merged[section] = { ...(merged[section] ?? {}), ...values };
  }
  for (const p of SECRET_SETTING_PATHS) if (get(merged, p) === MASK) set(merged, p, get(current, p));
  const parsed = companySettingsSchema.parse(merged);
  const stored: any = structuredClone(parsed);
  for (const p of SECRET_SETTING_PATHS) set(stored, p, encrypt(get(parsed, p)));
  await db.query(
    `INSERT INTO company_settings (tenant_id, data, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (tenant_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [tenantId, stored],
  );
  return parsed;
}
