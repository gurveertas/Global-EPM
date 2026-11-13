import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Db } from "@eszy/db";
import type { CompanySettings } from "@eszy/shared";
import zlib from "node:zlib";
import { decryptWithPassphrase, encryptWithPassphrase } from "../lib/crypto";
import { badRequest } from "../lib/errors";

/** Every company table, parents first, so a restore can insert them in this order. */
export const TENANT_TABLES = [
  "company_settings", "roles", "departments", "teams", "users", "user_roles", "user_files", "holidays", "leave_types", "leave_balances", "leave_requests", "wfh_requests",
  "communication_types", "project_sources", "project_accounts", "activity_types", "project_stages",
  "clients", "leads", "lead_calls", "projects", "project_members", "project_files", "project_trackers", "tasks", "project_notes", "comments",
  "invoices", "billing_lines", "invoice_lines", "invoice_taxes", "invoice_sequences", "payments", "refunds",
  "sheets", "time_entries", "time_allocations", "sheet_requests", "standups", "expenses", "events", "assets", "asset_assignments",
  "asset_requests", "notes", "ai_messages", "ai_actions", "alert_rules", "audit_log",
];
/** Columns that point "forward" in that order; they are filled in after all rows are back. */
const LATE_COLUMNS: Record<string, string[]> = {
  departments: ["head_user_id"], teams: ["lead_user_id"], clients: ["lead_id"], leads: ["project_id", "client_id"], invoices: ["corrects_invoice_id"],
};

const enc = (v: unknown): unknown => (Buffer.isBuffer(v) ? { $b64: v.toString("base64") } : v);
const dec = (v: any): unknown => (v && typeof v === "object" && typeof v.$b64 === "string" ? Buffer.from(v.$b64, "base64") : v);

/** All of one company's data as JSON. Row-level security keeps it to the current company. */
export async function dumpTenant(db: Db) {
  const out: Record<string, unknown[]> = {};
  for (const t of TENANT_TABLES) {
    const rows = (await db.query(`SELECT * FROM ${t}`)).rows;
    out[t] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, enc(v)])));
  }
  const tenantId = (await db.query("SELECT current_setting('app.tenant_id') AS t")).rows[0].t;
  return { format: "eszy-export-v1", tenantId, exportedAt: new Date().toISOString(), tables: out };
}

/**
 * Replaces this company's data with a backup, in one transaction: if anything fails, nothing changes.
 * Only a backup of the same company can be restored. Backup and restore history are kept.
 */
export async function restoreTenant(db: Db, dump: any) {
  if (dump?.format !== "eszy-export-v1") throw badRequest("This file isn't an eszy backup");
  const tenantId = (await db.query("SELECT current_setting('app.tenant_id') AS t")).rows[0].t;
  if (dump.tenantId !== tenantId) throw badRequest("This backup belongs to another company");
  const generated = new Set((await db.query("SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND is_generated = 'ALWAYS'")).rows.map((r) => r.c));
  for (const t of [...TENANT_TABLES].reverse()) await db.query(`DELETE FROM ${t}`);
  const late: { table: string; id: string; values: Record<string, unknown> }[] = [];
  let rows = 0;
  for (const t of TENANT_TABLES) {
    for (const raw of (dump.tables?.[t] ?? []) as Record<string, unknown>[]) {
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) if (!generated.has(`${t}.${k}`)) r[k] = dec(v);
      const lateCols = (LATE_COLUMNS[t] ?? []).filter((c) => r[c] != null);
      if (lateCols.length) { late.push({ table: t, id: String(r.id), values: Object.fromEntries(lateCols.map((c) => [c, r[c]])) }); for (const c of lateCols) r[c] = null; }
      const cols = Object.keys(r);
      const vals = cols.map((c) => { const v = r[c]; return v !== null && typeof v === "object" && !Array.isArray(v) && !Buffer.isBuffer(v) ? JSON.stringify(v) : v; });
      await db.query(`INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`, vals);
      rows++;
    }
  }
  for (const l of late) {
    const cols = Object.keys(l.values);
    await db.query(`UPDATE ${l.table} SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(", ")} WHERE id = $1`, [l.id, ...cols.map((c) => l.values[c])]);
  }
  return { rows };
}

/** Endpoints for S3-compatible providers. R2, B2 and Wasabi need the account or region in the URL, so the company types it. */
export const STORAGE_HINTS: Record<string, string> = {
  s3: "Leave the endpoint blank.",
  r2: "https://<account-id>.r2.cloudflarestorage.com",
  b2: "https://s3.<region>.backblazeb2.com",
  wasabi: "https://s3.<region>.wasabisys.com",
  gcs: "https://storage.googleapis.com (use HMAC keys from Cloud Storage, Settings, Interoperability)",
  other: "Your provider's S3 endpoint",
};

function client(b: CompanySettings["backups"]) {
  if (!b.bucket || !b.accessKeyId || !b.secretAccessKey) throw badRequest("Backup storage keys are missing");
  const endpoint = b.endpoint || (b.provider === "gcs" ? "https://storage.googleapis.com" : undefined);
  return new S3Client({
    region: b.region || (b.provider === "r2" ? "auto" : "us-east-1"),
    endpoint,
    forcePathStyle: !!endpoint,
    credentials: { accessKeyId: b.accessKeyId, secretAccessKey: b.secretAccessKey },
  });
}

export async function testBackupTarget(b: CompanySettings["backups"]) {
  try {
    await client(b).send(new PutObjectCommand({ Bucket: b.bucket, Key: "eszy-backups/.eszy-test", Body: `ok ${new Date().toISOString()}` }));
  } catch (e) {
    throw badRequest(`eszy couldn't write to the bucket: ${(e as Error).message}`);
  }
}

/** Gzipped JSON, encrypted with the company's passphrase when set, uploaded to the company's bucket. */
export async function runBackup(db: Db, tenantSlug: string, b: CompanySettings["backups"]) {
  const dump = await dumpTenant(db);
  let body: Buffer = zlib.gzipSync(Buffer.from(JSON.stringify(dump))) as Buffer;
  let key = `eszy-backups/${tenantSlug}/${new Date().toISOString().replace(/[:.]/g, "-")}.json.gz`;
  if (b.encryptionPassphrase) { body = encryptWithPassphrase(body, b.encryptionPassphrase); key += ".enc"; }
  await client(b).send(new PutObjectCommand({ Bucket: b.bucket, Key: key, Body: body }));
  return { key, size: body.length };
}

export async function listBackupFiles(b: CompanySettings["backups"], slug: string) {
  const r = await client(b).send(new ListObjectsV2Command({ Bucket: b.bucket, Prefix: `eszy-backups/${slug}/` }));
  return (r.Contents ?? []).map((o) => ({ key: o.Key!, size: o.Size ?? 0, at: o.LastModified?.toISOString() ?? null })).sort((a, c) => String(c.at).localeCompare(String(a.at)));
}

export async function fetchBackup(b: CompanySettings["backups"], key: string) {
  const r = await client(b).send(new GetObjectCommand({ Bucket: b.bucket, Key: key }));
  let buf: Buffer = Buffer.from(await r.Body!.transformToByteArray()) as Buffer;
  if (key.endsWith(".enc")) {
    if (!b.encryptionPassphrase) throw badRequest("This backup is encrypted. Add the passphrase in Settings, Backups.");
    try { buf = decryptWithPassphrase(buf, b.encryptionPassphrase); } catch { throw badRequest("The passphrase doesn't open this backup"); }
  }
  return JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
}
