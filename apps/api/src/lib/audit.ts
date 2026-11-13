import type { Request } from "express";
import type { Db } from "@eszy/db";
import { enqueueEmail } from "./queue";

export async function audit(db: Db, req: Request | null, action: string, entity: string, entityId: string | null, data: unknown = {}) {
  if (req) (req as any).__audited = true;
  await db.query(
    "INSERT INTO audit_log (tenant_id, user_id, action, entity, entity_id, data) VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5)",
    [req?.user?.id ?? null, action, entity, entityId, JSON.stringify(data ?? {})],
  );
}

/** In-app notification, plus an email when `email` is true. */
export async function notify(
  db: Db,
  userIds: (string | null | undefined)[],
  n: { kind: string; title: string; body?: string; link?: string; email?: boolean },
) {
  const ids = [...new Set(userIds.filter(Boolean) as string[])];
  for (const id of ids) {
    await db.query(
      "INSERT INTO notifications (tenant_id, user_id, kind, title, body, link) VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5)",
      [id, n.kind, n.title, n.body ?? "", n.link ?? ""],
    );
    if (n.email) {
      const u = (await db.query("SELECT email, name FROM users WHERE id = $1 AND status = 'active'", [id])).rows[0];
      if (u) await enqueueEmail({ to: u.email, subject: n.title, text: `Hi ${u.name},\n\n${n.body ?? n.title}\n` });
    }
  }
}

/** People holding a role key, e.g. all Billing Managers. */
export async function usersWithRole(db: Db, keys: string[]): Promise<string[]> {
  const r = await db.query(
    "SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id WHERE r.key = ANY($1) AND u.status='active'",
    [keys],
  );
  return r.rows.map((x) => x.user_id);
}
/** People holding a permission through any role. */
export async function usersWithPermission(db: Db, perm: string): Promise<string[]> {
  const r = await db.query(
    "SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id WHERE $1 = ANY(r.permissions) AND u.status='active'",
    [perm],
  );
  return r.rows.map((x) => x.user_id);
}

/** The row as it is now, to store as "before" in the change history. */
export async function snapshot(db: Db, table: string, id: string): Promise<Record<string, unknown> | null> {
  if (!/^[a-z_]+$/.test(table)) throw new Error("bad table");
  const row = (await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id])).rows[0];
  if (!row) return null;
  for (const k of ["password_hash", "totp_secret", "data"]) if (k in row && table !== "company_settings") delete row[k];
  return row;
}

/** Records only the fields that changed: { field: [old, new] }. */
export async function auditChange(db: Db, req: Request | null, action: string, table: string, id: string, before: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  const after = await snapshot(db, table, id);
  const diff: Record<string, [unknown, unknown]> = {};
  for (const k of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (k === "updated_at") continue;
    const a = before?.[k], b = after?.[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) diff[k] = [a ?? null, b ?? null];
  }
  if (Object.keys(diff).length || Object.keys(extra).length) await audit(db, req, action, table.replace(/s$/, ""), id, { changes: diff, ...extra });
}

// ---------------------------------------------------------------------------------------------------- automatic activity
/** Requests that are not changes people would look for in the activity history. */
const SKIP = [/^\/auth\//, /^\/assistant\/(chat|conversations)/, /^\/notifications/, /^\/public\//, /^\/platform\//, /^\/me\/2fa/, /\/read$/, /^\/backups\/test/, /^\/subscription\/delete/];
const SECRET = /pass(word)?|secret|token|totp|api_?key|^key$|^data$|^file|^bytes|^content$/i;
const SINGULAR: Record<string, string> = { people: "user", users: "user", leave: "leave", wfh: "wfh", sheets: "sheet", "sheet-requests": "sheet_request", entries: "time_entry", standups: "standup", leads: "lead", calls: "call", clients: "client", projects: "project", tasks: "task", invoices: "invoice", payments: "payment", holidays: "holiday", events: "event", assets: "asset", notes: "note", lists: "master", teams: "team", departments: "department", roles: "role", "leave-types": "leave_type", "alert-rules": "alert_rule", approvals: "approval" };

function summarise(body: any, depth = 0): any {
  if (body == null || typeof body !== "object") return typeof body === "string" ? body.slice(0, 200) : body;
  if (Array.isArray(body)) return body.length > 10 ? `${body.length} items` : body.slice(0, 10).map((x) => summarise(x, depth + 1));
  if (depth > 2) return "…";
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body).slice(0, 30)) if (!SECRET.test(k)) out[k] = summarise(v, depth + 1);
  return out;
}

/**
 * Records any change a route didn't record itself, so the activity history covers everything people do:
 * "POST /sheets/:id/submit" becomes sheet.submit on that sheet, with a short, secret-free summary of what was sent.
 */
export async function autoAudit(db: Db, req: Request) {
  if ((req as any).__audited || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || !req.user) return;
  const route = `${req.baseUrl ?? ""}${req.route?.path ?? ""}`.replace(/^\/api\/v\d+/, "");
  if (!route || SKIP.some((r) => r.test(route))) return;
  const parts = route.split("/").filter(Boolean);
  const nouns = parts.filter((x) => !x.startsWith(":"));
  const entity = SINGULAR[nouns[0]] ?? nouns[0]?.replace(/-/g, "_").replace(/s$/, "") ?? "item";
  const tail = nouns.length > 1 ? nouns[nouns.length - 1].replace(/-/g, "_") : null;
  const m = req.method === "POST" ? "create" : req.method === "DELETE" ? "delete" : "update";
  const tailEntity = tail ? SINGULAR[tail.replace(/_/g, "-")] ?? SINGULAR[tail] : null;
  const verb = !tail ? m : tailEntity ? `${tailEntity}_${m}` : tail;
  const id = (req.params?.id as string | undefined) ?? null;
  const data: Record<string, unknown> = { auto: true, route: `${req.method} ${route}`, ...(req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? { sent: summarise(req.body) } : {}) };
  if (entity === "project" && id) data.projectId = id;
  else if (req.body?.projectId) data.projectId = req.body.projectId;
  await audit(db, req, `${entity}.${verb}`, entity, id, data);
}
