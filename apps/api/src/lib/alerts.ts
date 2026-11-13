import type { Db } from "@eszy/db";
import { notify } from "./audit";

/**
 * Company-defined alert rules (Settings, Alerts). Built-in notifications still go out;
 * rules add more people, email, or a threshold (e.g. a project at 80% of its cap).
 */
export const ALERT_EVENTS: Record<string, { label: string; threshold?: string; owner?: string }> = {
  "invoice.created": { label: "An invoice is created", owner: "Project Manager" },
  "invoice.due_soon": { label: "An invoice is due soon", owner: "Project Manager" },
  "invoice.overdue": { label: "An invoice is overdue", threshold: "Days late (0 = as soon as it's late)", owner: "Project Manager" },
  "invoice.refunded": { label: "An invoice is refunded", owner: "Project Manager" },
  "payment.recorded": { label: "A payment is recorded", owner: "Project Manager" },
  "project.near_cap": { label: "A project reaches a share of its cap", threshold: "Percent of the project cap", owner: "Project Manager" },
  "sheet.submitted": { label: "A sheet is submitted", owner: "The person's TL" },
  "sheet.pending": { label: "A sheet waits for approval", threshold: "Days waiting", owner: "The person's TL" },
  "sheet.missing": { label: "Someone didn't submit yesterday", owner: "The person's TL" },
  "leave.requested": { label: "Leave or WFH is requested", owner: "The person's TL" },
  "lead.converted": { label: "A lead is converted", owner: "The person who brought it" },
};

export interface AlertCtx {
  key: string;                       // stops the same rule firing twice for the same thing
  title: string;
  body?: string;
  link?: string;
  ownerIds?: (string | null | undefined)[];
  value?: number;                    // compared with the rule's threshold
}

export async function fireAlerts(db: Db, event: string, ctx: AlertCtx) {
  const rules = (await db.query("SELECT * FROM alert_rules WHERE event = $1 AND active", [event])).rows;
  for (const r of rules) {
    if (r.threshold != null && ctx.value != null && ctx.value < r.threshold) continue;
    const fresh = (await db.query("INSERT INTO alert_log (tenant_id, rule_id, key) VALUES (current_setting('app.tenant_id')::uuid, $1, $2) ON CONFLICT DO NOTHING RETURNING 1", [r.id, ctx.key])).rowCount;
    if (!fresh) continue;
    const byRole = r.role_keys.length
      ? (await db.query("SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id JOIN users u ON u.id = ur.user_id WHERE ro.key = ANY($1) AND u.status = 'active'", [r.role_keys])).rows.map((x) => x.user_id)
      : [];
    const to = [...byRole, ...r.user_ids, ...(r.notify_owner ? (ctx.ownerIds ?? []) : [])];
    if (!r.in_app && !r.email) continue;
    // The in-app notice is always kept as a record; email goes out when the rule asks for it.
    await notify(db, to, { kind: `alert.${event}`, title: ctx.title, body: ctx.body, link: ctx.link, email: r.email });
  }
}
