import { Router } from "express";
import { z } from "zod";
import { clientInputSchema, leadCallSchema, leadInputSchema } from "@eszy/shared";
import { can, h, userId } from "../lib/context";
import { requirePerm } from "../lib/auth";
import { requireFeature } from "../lib/tenant";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit, notify, usersWithRole } from "../lib/audit";
import { PROJECT_RATES_SQL } from "../services/rates";

export const salesRouter = Router();
const uuid = z.string().uuid();

// ---------- leads ----------
// A lead keeps the person who brought it (locked) and the person who converted it (whoever logs the successful call).
// The bringer assigns a caller; the Sales TL can step in. A caller only sees leads assigned to them.
const leadScope = (req: any) => (can(req, "leads.view_all") ? "TRUE" : "(l.bringer_id = $U OR l.caller_id = $U)");

salesRouter.get("/leads", requireFeature("sales_crm"), h(async (req, db) => {
  const q = z.object({ status: z.string().optional(), mine: z.string().optional(), search: z.string().optional() }).parse(req.query);
  const uid = userId(req);
  const scope = leadScope(req).replaceAll("$U", "$1");
  return (await db.query(
    `SELECT l.*, b.name AS bringer_name, c.name AS caller_name, v.name AS converter_name,
       (SELECT name FROM clients cl WHERE cl.id = l.client_id) AS client_name, (SELECT name FROM projects pr WHERE pr.id = l.project_id) AS project_name,
       (SELECT count(*)::int FROM lead_calls lc WHERE lc.lead_id = l.id) AS call_count,
       (SELECT max(called_at) FROM lead_calls lc WHERE lc.lead_id = l.id) AS last_call_at
     FROM leads l JOIN users b ON b.id = l.bringer_id LEFT JOIN users c ON c.id = l.caller_id LEFT JOIN users v ON v.id = l.converter_id
     WHERE ${scope} AND ($2::text IS NULL OR l.status = $2) AND ($3::text IS NULL OR l.bringer_id = $1 OR l.caller_id = $1)
       AND ($4::text IS NULL OR l.title ILIKE '%'||$4||'%' OR l.company ILIKE '%'||$4||'%' OR l.contact_name ILIKE '%'||$4||'%')
     ORDER BY l.updated_at DESC LIMIT 500`,
    [uid, q.status ?? null, q.mine ?? null, q.search ?? null],
  )).rows;
}));

async function loadLead(req: any, db: any, id: string) {
  const l = (await db.query("SELECT * FROM leads WHERE id = $1", [id])).rows[0];
  if (!l) throw notFound("Lead not found");
  const uid = userId(req);
  if (!can(req, "leads.view_all") && l.bringer_id !== uid && l.caller_id !== uid) throw notFound("Lead not found");
  return l;
}

salesRouter.get("/leads/:id", requireFeature("sales_crm"), h(async (req, db) => {
  const l = await loadLead(req, db, uuid.parse(req.params.id));
  const calls = (await db.query("SELECT lc.*, u.name AS caller_name FROM lead_calls lc JOIN users u ON u.id = lc.caller_id WHERE lc.lead_id = $1 ORDER BY lc.called_at DESC", [l.id])).rows;
  const people = (await db.query("SELECT id, name FROM users WHERE id = ANY($1)", [[l.bringer_id, l.caller_id, l.converter_id].filter(Boolean)])).rows;
  const client = l.client_id ? (await db.query("SELECT id, name, company FROM clients WHERE id = $1", [l.client_id])).rows[0] ?? null : null;
  const projects = (await db.query("SELECT id, name, status FROM projects WHERE lead_id = $1 OR id = $2 OR ($3::uuid IS NOT NULL AND client_id = $3) ORDER BY created_at DESC LIMIT 20", [l.id, l.project_id, l.client_id])).rows;
  return { ...l, calls, people, client, projects };
}));

salesRouter.post("/leads", requireFeature("sales_crm"), requirePerm("leads.create"), h(async (req, db) => {
  const b = leadInputSchema.parse(req.body);
  const uid = userId(req);
  const l = (await db.query(
    `INSERT INTO leads (tenant_id, title, contact_name, email, phone, company, country, source, notes, estimated_value_minor, bringer_id, caller_id, next_follow_up_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [req.tenant!.id, b.title, b.contactName, b.email, b.phone, b.company, b.country, b.source, b.notes, b.estimatedValueMinor ?? null, uid, b.callerId ?? null, b.nextFollowUpAt ?? null],
  )).rows[0];
  if (b.callerId && b.callerId !== uid) await notify(db, [b.callerId], { kind: "lead.assigned", title: `New lead to call: ${b.title}`, link: `/leads/${l.id}`, email: true });
  await audit(db, req, "lead.create", "lead", l.id, { title: b.title });
  return l;
}));

salesRouter.put("/leads/:id", requireFeature("sales_crm"), h(async (req, db) => {
  const l = await loadLead(req, db, uuid.parse(req.params.id));
  const uid = userId(req);
  if (l.bringer_id !== uid && !can(req, "leads.manage")) throw forbidden("Only the person who brought this lead or the Sales TL can edit it");
  const b = leadInputSchema.partial().extend({ status: z.enum(["new", "contacted", "follow_up", "lost"]).optional() }).parse(req.body);
  await db.query(
    `UPDATE leads SET title = coalesce($2,title), contact_name = coalesce($3,contact_name), email = coalesce($4,email), phone = coalesce($5,phone),
       company = coalesce($6,company), country = coalesce($7,country), source = coalesce($8,source), notes = coalesce($9,notes),
       estimated_value_minor = CASE WHEN $10 THEN $11::bigint ELSE estimated_value_minor END, status = coalesce($12,status),
       next_follow_up_at = CASE WHEN $13 THEN $14::timestamptz ELSE next_follow_up_at END, updated_at = now()
     WHERE id = $1`,
    [l.id, b.title ?? null, b.contactName ?? null, b.email ?? null, b.phone ?? null, b.company ?? null, b.country ?? null, b.source ?? null, b.notes ?? null,
      b.estimatedValueMinor !== undefined, b.estimatedValueMinor ?? null, b.status ?? null, b.nextFollowUpAt !== undefined, b.nextFollowUpAt ?? null],
  );
  return { ok: true };
}));

/** The bringer assigns the caller. The Sales TL (leads.assign) can step in when needed. */
salesRouter.post("/leads/:id/assign", requireFeature("sales_crm"), h(async (req, db) => {
  const l = await loadLead(req, db, uuid.parse(req.params.id));
  const { callerId } = z.object({ callerId: uuid.nullable() }).parse(req.body);
  if (l.bringer_id !== userId(req) && !can(req, "leads.assign")) throw forbidden("Only the person who brought this lead or the Sales TL can assign its caller");
  if (["converted", "onboarded"].includes(l.status)) throw badRequest("This lead is already converted");
  await db.query("UPDATE leads SET caller_id = $2, updated_at = now() WHERE id = $1", [l.id, callerId]);
  if (callerId) await notify(db, [callerId], { kind: "lead.assigned", title: `Lead to call: ${l.title}`, link: `/leads/${l.id}`, email: true });
  await audit(db, req, "lead.assign", "lead", l.id, { callerId });
  return { ok: true };
}));

/** Logs a call. A "converted" outcome sets the converter to whoever logged it. */
salesRouter.post("/leads/:id/calls", requireFeature("sales_crm"), h(async (req, db) => {
  const l = await loadLead(req, db, uuid.parse(req.params.id));
  const b = leadCallSchema.parse(req.body);
  const uid = userId(req);
  if (l.caller_id !== uid && l.bringer_id !== uid && !can(req, "leads.manage")) throw forbidden("Only the assigned caller or the bringer can log calls");
  if (["converted", "onboarded"].includes(l.status)) throw badRequest("This lead is already converted");
  await db.query("INSERT INTO lead_calls (tenant_id, lead_id, caller_id, outcome, notes, next_follow_up_at) VALUES ($1,$2,$3,$4,$5,$6)", [
    req.tenant!.id, l.id, uid, b.outcome, b.notes, b.nextFollowUpAt ?? null,
  ]);
  const status = b.outcome === "converted" ? "converted" : b.outcome === "not_interested" ? "lost" : b.outcome === "follow_up" ? "follow_up" : "contacted";
  await db.query(
    `UPDATE leads SET status = $2, next_follow_up_at = $3, updated_at = now(),
       converter_id = CASE WHEN $2 = 'converted' THEN $4::uuid ELSE converter_id END,
       converted_at = CASE WHEN $2 = 'converted' THEN now() ELSE converted_at END WHERE id = $1`,
    [l.id, status, b.nextFollowUpAt ?? null, uid],
  );
  if (status === "converted") {
    const tls = await usersWithRole(db, ["sales_tl"]);
    await notify(db, [l.bringer_id, ...tls].filter((x) => x !== uid), { kind: "lead.converted", title: `Lead converted: ${l.title}`, body: "Ready to onboard as a client and project.", link: `/leads/${l.id}` });
  }
  return { ok: true, status };
}));

salesRouter.delete("/leads/:id", requireFeature("sales_crm"), requirePerm("leads.manage"), h(async (req, db) => {
  await db.query("DELETE FROM leads WHERE id = $1 AND status NOT IN ('onboarded')", [uuid.parse(req.params.id)]);
  return { ok: true };
}));

/** Onboarding step 1: turn a converted lead into a client. The project is created next with leadId set. */
salesRouter.post("/leads/:id/client", requireFeature("sales_crm"), h(async (req, db) => {
  const l = await loadLead(req, db, uuid.parse(req.params.id));
  if (l.status !== "converted" && l.status !== "onboarded") throw badRequest("Only converted leads can be onboarded");
  if (l.bringer_id !== userId(req) && !can(req, "clients.manage")) throw forbidden();
  if (l.client_id) return (await db.query("SELECT * FROM clients WHERE id = $1", [l.client_id])).rows[0];
  const b = clientInputSchema.partial().parse(req.body ?? {});
  const c = (await db.query(
    "INSERT INTO clients (tenant_id, name, company, email, phone, country, state, tax_id, address, lead_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
    [req.tenant!.id, b.name ?? (l.contact_name || l.company || l.title), b.company ?? l.company, b.email ?? l.email, b.phone ?? l.phone,
      b.country ?? (l.country || "IN"), b.state ?? "", b.taxId ?? "", b.address ?? "", l.id, userId(req)],
  )).rows[0];
  await db.query("UPDATE leads SET client_id = $2, updated_at = now() WHERE id = $1", [l.id, c.id]);
  return c;
}));

/** Link a converted lead to a client that already exists (added by hand before the lead was marked converted). */
salesRouter.post("/leads/:id/link-client", requireFeature("sales_crm"), requirePerm("clients.manage"), h(async (req, db) => {
  const l = await loadLead(req, db, uuid.parse(req.params.id));
  if (l.status !== "converted" && l.status !== "onboarded") throw badRequest("Only converted leads can be linked to a client");
  const { clientId } = z.object({ clientId: uuid }).parse(req.body);
  const c = (await db.query("SELECT id FROM clients WHERE id = $1", [clientId])).rows[0];
  if (!c) throw notFound("Client not found");
  await db.query("UPDATE leads SET client_id = $2, updated_at = now() WHERE id = $1", [l.id, clientId]);
  await db.query("UPDATE clients SET lead_id = coalesce(lead_id, $2) WHERE id = $1", [clientId, l.id]);
  await audit(db, req, "lead.link_client", "lead", l.id, { clientId });
  return { ok: true };
}));

// ---------- clients ----------
salesRouter.get("/clients", requirePerm("clients.view", "projects.view_all", "invoices.view"), h(async (req, db) => {
  const money = can(req, "money.view");
  return (await db.query(
    `SELECT c.*, src.name AS source_name, acc.name AS account_name,
       coalesce((SELECT array_agg(ct.name ORDER BY ct.name) FROM communication_types ct WHERE ct.id = ANY(c.communication_type_ids)), '{}') AS communication_types,
       (SELECT count(*)::int FROM projects p WHERE p.client_id = c.id) AS project_count,
       (SELECT count(*)::int FROM projects p WHERE p.client_id = c.id AND p.status = 'active') AS active_projects,
       (SELECT coalesce(sum(e.minutes),0)::int FROM time_entries e JOIN projects p ON p.id = e.project_id WHERE p.client_id = c.id) AS logged_minutes,
       (SELECT max(e.date) FROM time_entries e JOIN projects p ON p.id = e.project_id WHERE p.client_id = c.id) AS last_work_on
       ${money ? `, (SELECT coalesce(sum(i.subtotal_minor),0) FROM invoices i WHERE i.client_id = c.id AND i.status IN ('unpaid','partially_paid','paid')) AS revenue_minor
       , (SELECT coalesce(sum(i.total_minor - i.paid_minor),0) FROM invoices i WHERE i.client_id = c.id AND i.status IN ('unpaid','partially_paid')) AS outstanding_minor
       , cr.rate_minor AS avg_rate_minor, cr.minutes AS approved_minutes` : ""}
     FROM clients c LEFT JOIN project_sources src ON src.id = c.source_id LEFT JOIN project_accounts acc ON acc.id = c.account_id
     ${money ? `LEFT JOIN (SELECT pr.client_id, sum(pr.minutes)::int AS minutes, CASE WHEN sum(pr.minutes) > 0 THEN round(sum(pr.revenue_minor) * 60.0 / sum(pr.minutes)) END::bigint AS rate_minor FROM (${PROJECT_RATES_SQL}) pr GROUP BY pr.client_id) cr ON cr.client_id = c.id` : ""}
     ORDER BY c.name`,
  )).rows;
}));
/** Everything about one client: details, projects with hours, invoices, hours by month, the people who work for them, and comments. */
salesRouter.get("/clients/:id", requirePerm("clients.view", "projects.view_all", "invoices.view"), h(async (req, db) => {
  const money = can(req, "money.view");
  const c = (await db.query(
    `SELECT c.*, src.name AS source_name, acc.name AS account_name, l.title AS lead_title, cb.name AS created_by_name,
       coalesce((SELECT array_agg(ct.name ORDER BY ct.name) FROM communication_types ct WHERE ct.id = ANY(c.communication_type_ids)), '{}') AS communication_types
     FROM clients c LEFT JOIN project_sources src ON src.id = c.source_id LEFT JOIN project_accounts acc ON acc.id = c.account_id
     LEFT JOIN leads l ON l.id = c.lead_id LEFT JOIN users cb ON cb.id = c.created_by WHERE c.id = $1`, [uuid.parse(req.params.id)])).rows[0];
  if (!c) throw notFound();
  const projects = (await db.query(
    `SELECT p.id, p.name, p.code, p.type, p.billing_type, p.fixed_option, p.status, p.start_date, pm.name AS pm_name,
       (SELECT coalesce(sum(minutes),0)::int FROM billing_lines bl WHERE bl.project_id = p.id) AS cap_minutes,
       (SELECT coalesce(sum(minutes),0)::int FROM time_entries e WHERE e.project_id = p.id) AS logged_minutes
       ${money ? ", p.hourly_rate_minor, p.price_minor, pr.rate_minor AS avg_rate_minor, pr.revenue_minor, pr.minutes AS approved_minutes" : ""}
     FROM projects p LEFT JOIN users pm ON pm.id = p.pm_user_id ${money ? `LEFT JOIN (${PROJECT_RATES_SQL}) pr ON pr.project_id = p.id` : ""}
     WHERE p.client_id = $1 ORDER BY p.status, p.created_at DESC`, [c.id])).rows;
  const invoices = can(req, "invoices.view")
    ? (await db.query(`SELECT i.id, i.number, i.issue_date, i.due_date, i.status, p.name AS project_name ${money ? ", i.total_minor, i.paid_minor" : ""} FROM invoices i JOIN projects p ON p.id = i.project_id WHERE i.client_id = $1 ORDER BY i.issue_date DESC`, [c.id])).rows
    : [];
  const months = (await db.query(
    `SELECT to_char(e.date, 'YYYY-MM') AS month, sum(e.minutes)::int AS minutes FROM time_entries e JOIN projects p ON p.id = e.project_id
     WHERE p.client_id = $1 AND e.date >= (current_date - interval '11 months') GROUP BY 1 ORDER BY 1`, [c.id])).rows;
  const people = (await db.query(
    `SELECT u.id, u.name, sum(e.minutes)::int AS minutes, max(e.date) AS last_on FROM time_entries e JOIN projects p ON p.id = e.project_id JOIN users u ON u.id = e.user_id
     WHERE p.client_id = $1 GROUP BY u.id ORDER BY minutes DESC LIMIT 20`, [c.id])).rows;
  const comments = (await db.query("SELECT cm.*, u.name AS author FROM comments cm LEFT JOIN users u ON u.id = cm.created_by WHERE cm.client_id = $1 ORDER BY cm.created_at DESC LIMIT 100", [c.id])).rows;
  const totals = {
    logged_minutes: projects.reduce((a: number, p: any) => a + p.logged_minutes, 0),
    ...(money ? {
      invoiced_minor: invoices.filter((i: any) => ["unpaid", "partially_paid", "paid"].includes(i.status)).reduce((a: number, i: any) => a + Number(i.total_minor), 0),
      paid_minor: invoices.filter((i: any) => i.status !== "cancelled").reduce((a: number, i: any) => a + Number(i.paid_minor), 0),
      outstanding_minor: invoices.filter((i: any) => ["unpaid", "partially_paid"].includes(i.status)).reduce((a: number, i: any) => a + Number(i.total_minor) - Number(i.paid_minor), 0),
      ...(() => {
        const rev = projects.reduce((a: number, p: any) => a + Number(p.revenue_minor ?? 0), 0);
        const mins = projects.reduce((a: number, p: any) => a + Number(p.approved_minutes ?? 0), 0);
        return { revenue_minor: rev, approved_minutes: mins, avg_rate_minor: mins > 0 ? Math.round((rev * 60) / mins) : null };
      })(),
    } : {}),
  };
  return { ...c, projects, invoices, months, people, comments, totals };
}));
salesRouter.post("/clients/:id/comments", requirePerm("clients.view", "projects.view_all"), h(async (req, db) => {
  const b = z.object({ body: z.string().min(1).max(5000) }).parse(req.body);
  return (await db.query("INSERT INTO comments (tenant_id, client_id, body, created_by) VALUES ($1,$2,$3,$4) RETURNING *", [req.tenant!.id, uuid.parse(req.params.id), b.body, userId(req)])).rows[0];
}));
async function linkLead(db: any, leadId: string, clientId: string) {
  const l = (await db.query("SELECT id, status FROM leads WHERE id = $1", [leadId])).rows[0];
  if (!l) throw notFound("Lead not found");
  if (l.status !== "converted" && l.status !== "onboarded") throw badRequest("Only converted leads can be linked to a client");
  await db.query("UPDATE leads SET client_id = $2, updated_at = now() WHERE id = $1", [leadId, clientId]);
  await db.query("UPDATE clients SET lead_id = $2 WHERE id = $1", [clientId, leadId]);
}
salesRouter.post("/clients", requirePerm("clients.manage"), h(async (req, db) => {
  const b = clientInputSchema.parse(req.body);
  const c = (await db.query(
    `INSERT INTO clients (tenant_id, name, company, email, phone, country, state, tax_id, address, created_by, client_type, hiring_id, source_id, account_id,
       communication_type_ids, contact_name, website, preferred_billing, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
    [req.tenant!.id, b.name, b.company, b.email, b.phone, b.country, b.state, b.taxId, b.address, userId(req), b.clientType, b.hiringId, b.sourceId ?? null, b.accountId ?? null,
      b.communicationTypeIds, b.contactName, b.website, b.preferredBilling ?? null, b.notes, b.status],
  )).rows[0];
  if (b.leadId) await linkLead(db, b.leadId, c.id);
  await audit(db, req, "client.create", "client", c.id, { name: b.name });
  return c;
}));
salesRouter.put("/clients/:id", requirePerm("clients.manage"), h(async (req, db) => {
  const raw = req.body ?? {};
  const b = clientInputSchema.partial().parse(raw);
  const id = uuid.parse(req.params.id);
  await db.query(
    `UPDATE clients SET name=coalesce($2,name), company=coalesce($3,company), email=coalesce($4,email), phone=coalesce($5,phone), country=coalesce($6,country),
       state=coalesce($7,state), tax_id=coalesce($8,tax_id), address=coalesce($9,address), client_type=coalesce($10,client_type), hiring_id=coalesce($11,hiring_id),
       communication_type_ids=coalesce($12,communication_type_ids), contact_name=coalesce($13,contact_name), website=coalesce($14,website),
       notes=coalesce($15,notes), status=coalesce($16,status) WHERE id=$1`,
    [id, b.name ?? null, b.company ?? null, b.email ?? null, b.phone ?? null, b.country ?? null, b.state ?? null, b.taxId ?? null, b.address ?? null,
      "clientType" in raw ? b.clientType : null, "hiringId" in raw ? b.hiringId : null, "communicationTypeIds" in raw ? b.communicationTypeIds : null,
      "contactName" in raw ? b.contactName : null, "website" in raw ? b.website : null, "notes" in raw ? b.notes : null, "status" in raw ? b.status : null],
  );
  for (const [k, col] of [["sourceId", "source_id"], ["accountId", "account_id"], ["preferredBilling", "preferred_billing"]] as const) {
    if (k in raw) await db.query(`UPDATE clients SET ${col} = $2 WHERE id = $1`, [id, (b as any)[k] ?? null]);
  }
  if ("leadId" in raw) {
    await db.query("UPDATE leads SET client_id = NULL WHERE client_id = $1 AND status = 'converted' AND id IS DISTINCT FROM $2", [id, b.leadId ?? null]);
    await db.query("UPDATE clients SET lead_id = $2 WHERE id = $1", [id, b.leadId ?? null]);
    if (b.leadId) await linkLead(db, b.leadId, id);
  }
  await audit(db, req, "client.update", "client", id, b);
  return { ok: true };
}));
salesRouter.delete("/clients/:id", requirePerm("clients.manage"), h(async (req, db) => {
  await db.query("DELETE FROM clients WHERE id = $1", [uuid.parse(req.params.id)]);
  return { ok: true };
}));
