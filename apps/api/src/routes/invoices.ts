import { Router } from "express";
import { z } from "zod";
import { expenseSchema, manualInvoiceSchema, paymentSchema, refundSchema } from "@eszy/shared";
import { can, h, userId } from "../lib/context";
import { requirePerm } from "../lib/auth";
import { requireFeature } from "../lib/tenant";
import { notFound } from "../lib/errors";
import { audit, auditChange, snapshot } from "../lib/audit";
import { getSettings } from "../lib/settings";
import { todayIn } from "../lib/dates";
import { renderPdf } from "../lib/threads";
import { enqueueEmail } from "../lib/queue";
import { cancelInvoice, correctInvoice, createInvoice, displayStatus, recordPayment, refundInvoice } from "../services/invoices";

export const invoicesRouter = Router();
invoicesRouter.use(requireFeature("projects_billing"));
const uuid = z.string().uuid();

/** Invoices tab: All, Unpaid, Partially paid, Paid, Due soon, Overdue, Refunded, Cancelled. */
invoicesRouter.get("/invoices", requirePerm("invoices.view"), h(async (req, db) => {
  const q = z.object({ tab: z.string().default("all"), projectId: uuid.optional(), clientId: uuid.optional(), search: z.string().optional() }).parse(req.query);
  const s = await getSettings(db);
  const today = todayIn(s.locale.timezone);
  const rows = (await db.query(
    `SELECT i.*, p.name AS project_name, c.name AS client_name, coalesce(p.due_soon_days, $1) AS due_soon_days
     FROM invoices i JOIN projects p ON p.id = i.project_id JOIN clients c ON c.id = i.client_id
     WHERE ($2::uuid IS NULL OR i.project_id = $2) AND ($3::uuid IS NULL OR i.client_id = $3)
       AND ($4::text IS NULL OR i.number ILIKE '%'||$4||'%' OR p.name ILIKE '%'||$4||'%' OR c.name ILIKE '%'||$4||'%')
     ORDER BY i.issue_date DESC, i.number DESC LIMIT 1000`,
    [s.invoices.dueSoonDays, q.projectId ?? null, q.clientId ?? null, q.search ?? null],
  )).rows.map((r) => ({ ...r, display_status: displayStatus(r, today, r.due_soon_days) }));
  const counts: Record<string, number> = { all: rows.length };
  for (const r of rows) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if (["overdue", "due_soon"].includes(r.display_status)) counts[r.display_status] = (counts[r.display_status] ?? 0) + 1;
  }
  const filtered = q.tab === "all" ? rows : rows.filter((r) => (["overdue", "due_soon"].includes(q.tab) ? r.display_status === q.tab : r.status === q.tab));
  const money = can(req, "money.view");
  return { counts, invoices: money ? filtered : filtered.map(({ subtotal_minor, tax_minor, total_minor, paid_minor, ...r }: any) => r) };
}));

/** Pending payments for the Billing Manager: everything with money still to come in, oldest due first. */
invoicesRouter.get("/invoices/pending", requirePerm("payments.record"), h(async (_req, db) => {
  const s = await getSettings(db);
  const today = todayIn(s.locale.timezone);
  const rows = (await db.query(
    `SELECT i.*, p.name AS project_name, c.name AS client_name, coalesce(p.due_soon_days, $1) AS due_soon_days, (i.total_minor - i.paid_minor) AS outstanding_minor
     FROM invoices i JOIN projects p ON p.id = i.project_id JOIN clients c ON c.id = i.client_id
     WHERE i.status IN ('unpaid','partially_paid') ORDER BY i.due_date`,
    [s.invoices.dueSoonDays],
  )).rows;
  return rows.map((r) => ({ ...r, display_status: displayStatus(r, today, r.due_soon_days) }));
}));

async function loadFull(db: any, id: string) {
  const inv = (await db.query("SELECT * FROM invoices WHERE id = $1", [id])).rows[0];
  if (!inv) throw notFound("Invoice not found");
  const [lines, taxes, payments, refund, client, project] = await Promise.all([
    db.query("SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY description", [id]),
    db.query("SELECT * FROM invoice_taxes WHERE invoice_id = $1", [id]),
    db.query("SELECT p.*, u.name AS recorded_by_name FROM payments p LEFT JOIN users u ON u.id = p.recorded_by WHERE p.invoice_id = $1 ORDER BY p.received_on", [id]),
    db.query("SELECT * FROM refunds WHERE invoice_id = $1", [id]),
    db.query("SELECT * FROM clients WHERE id = $1", [inv.client_id]),
    db.query("SELECT id, name, type, billing_type, due_soon_days FROM projects WHERE id = $1", [inv.project_id]),
  ]);
  return { inv, lines: lines.rows, taxes: taxes.rows, payments: payments.rows, refund: refund.rows[0] ?? null, client: client.rows[0], project: project.rows[0] };
}

invoicesRouter.get("/invoices/:id", requirePerm("invoices.view"), h(async (req, db) => {
  const f = await loadFull(db, uuid.parse(req.params.id));
  const s = await getSettings(db);
  const hours = (await db.query(
    `SELECT u.name AS user_name, sum(a.minutes)::int AS minutes FROM time_allocations a JOIN time_entries e ON e.id = a.entry_id JOIN users u ON u.id = e.user_id
     WHERE a.billing_line_id IN (SELECT billing_line_id FROM invoice_lines WHERE invoice_id = $1)
     GROUP BY u.name UNION ALL
     SELECT u.name, sum(e.minutes)::int FROM time_entries e JOIN users u ON u.id = e.user_id WHERE e.invoice_id = $1 GROUP BY u.name`,
    [f.inv.id],
  )).rows;
  return {
    ...f.inv, display_status: displayStatus(f.inv, todayIn(s.locale.timezone), f.project.due_soon_days ?? s.invoices.dueSoonDays),
    lines: f.lines, taxes: f.taxes, payments: f.payments, refund: f.refund, client: f.client, project: f.project, hours,
    corrects: f.inv.corrects_invoice_id ? (await db.query("SELECT id, number FROM invoices WHERE id = $1", [f.inv.corrects_invoice_id])).rows[0] : null,
    correctedBy: (await db.query("SELECT id, number, status FROM invoices WHERE corrects_invoice_id = $1 ORDER BY created_at DESC LIMIT 1", [f.inv.id])).rows[0] ?? null,
  };
}));

invoicesRouter.get("/invoices/:id/pdf", requirePerm("invoices.view"), h(async (req, db, res) => {
  const f = await loadFull(db, uuid.parse(req.params.id));
  const s = await getSettings(db);
  const pdf = await renderPdf("invoice", s, f.inv, f.lines, f.taxes, f.client, f.project, f.payments);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${f.inv.number}.pdf"`);
  res.send(pdf);
}));

invoicesRouter.post("/invoices/:id/send", requirePerm("invoices.manage"), h(async (req, db) => {
  const f = await loadFull(db, uuid.parse(req.params.id));
  const { to } = z.object({ to: z.string().email().optional() }).parse(req.body ?? {});
  const email = to ?? f.client.email;
  if (!email) throw notFound("This client has no email address");
  const s = await getSettings(db);
  const pdf = await renderPdf("invoice", s, f.inv, f.lines, f.taxes, f.client, f.project, f.payments);
  await enqueueEmail({
    to: email, fromName: s.branding.emailSenderName,
    subject: `Invoice ${f.inv.number} from ${s.branding.displayName}`,
    text: `Hi ${f.client.name},\n\nPlease find invoice ${f.inv.number} attached. It is due on ${f.inv.due_date}.\n\n${s.invoices.footer}`,
    attachments: [{ filename: `${f.inv.number}.pdf`, contentBase64: pdf.toString("base64"), contentType: "application/pdf" }],
  });
  await audit(db, req, "invoice.send", "invoice", f.inv.id, { to: email });
  return { ok: true, sentTo: email };
}));

/** One-off invoice the Billing Manager writes by hand (also used for money received before an invoice exists). */
invoicesRouter.post("/invoices", requirePerm("invoices.manage"), h(async (req, db) => {
  const b = manualInvoiceSchema.parse(req.body);
  const s = await getSettings(db);
  const inv = await createInvoice(db, s, {
    projectId: b.projectId, kind: "manual", issueDate: b.issueDate, dueDays: b.dueDays, notes: b.notes,
    lines: b.lines.map((l) => ({ description: l.description, minutes: l.minutes, amountMinor: l.amountMinor })),
    initialPaymentMinor: b.initialPaymentMinor, createdBy: userId(req),
  });
  await audit(db, req, "invoice.create", "invoice", inv.id, { number: inv.number });
  return inv;
}));

invoicesRouter.put("/invoices/:id", requirePerm("invoices.manage"), h(async (req, db) => {
  const b = z.object({ dueDate: z.string().optional(), notes: z.string().optional() }).parse(req.body);
  const before = await snapshot(db, "invoices", uuid.parse(req.params.id));
  await db.query("UPDATE invoices SET due_date = coalesce($2::date, due_date), notes = coalesce($3, notes), due_soon_notified_at = CASE WHEN $2 IS NOT NULL THEN NULL ELSE due_soon_notified_at END WHERE id = $1", [
    uuid.parse(req.params.id), b.dueDate ?? null, b.notes ?? null,
  ]);
  await auditChange(db, req, "invoice.update", "invoices", uuid.parse(req.params.id), before);
  return { ok: true };
}));

invoicesRouter.post("/invoices/:id/payments", requirePerm("payments.record"), h(async (req, db) => {
  const b = paymentSchema.parse(req.body);
  const inv = await recordPayment(db, uuid.parse(req.params.id), b, userId(req));
  await audit(db, req, "payment.record", "invoice", inv.id, b);
  return inv;
}));

invoicesRouter.delete("/payments/:id", requirePerm("payments.record"), h(async (req, db) => {
  const p = (await db.query("DELETE FROM payments WHERE id = $1 RETURNING invoice_id, amount_minor", [uuid.parse(req.params.id)])).rows[0];
  if (!p) throw notFound();
  const { refreshStatus } = await import("../services/invoices");
  await refreshStatus(db, p.invoice_id);
  await audit(db, req, "payment.delete", "invoice", p.invoice_id, p);
  return { ok: true };
}));

invoicesRouter.post("/invoices/:id/refund", requirePerm("refunds.manage"), h(async (req, db) => {
  const b = refundSchema.parse(req.body);
  const inv = await refundInvoice(db, uuid.parse(req.params.id), b, userId(req));
  await audit(db, req, "invoice.refund", "invoice", inv.id, b);
  return inv;
}));

invoicesRouter.post("/invoices/:id/cancel", requirePerm("invoices.manage"), h(async (req, db) => {
  const { reason } = z.object({ reason: z.string().min(3, "Say why the invoice is cancelled").max(500) }).parse(req.body ?? {});
  const before = await snapshot(db, "invoices", uuid.parse(req.params.id));
  const inv = await cancelInvoice(db, uuid.parse(req.params.id), reason);
  await auditChange(db, req, "invoice.cancel", "invoices", inv.id, before);
  return inv;
}));

invoicesRouter.post("/invoices/:id/correct", requirePerm("invoices.manage"), h(async (req, db) => {
  const b = z.object({
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().optional(), dueDays: z.number().int().min(0).optional(),
    lines: z.array(z.object({ description: z.string().min(1), minutes: z.number().int().min(0).default(0), amountMinor: z.number().int().min(0) })).optional(),
  }).parse(req.body);
  const s = await getSettings(db);
  const inv = await correctInvoice(db, s, uuid.parse(req.params.id), b, userId(req));
  await audit(db, req, "invoice.correct", "invoice", inv.id, { replaces: req.params.id, number: inv.number });
  return inv;
}));

// ---------- internal costs ----------
invoicesRouter.get("/expenses", requirePerm("expenses.manage", "money.view"), h(async (req, db) => {
  const q = z.object({ projectId: uuid.optional() }).parse(req.query);
  return (await db.query("SELECT e.*, p.name AS project_name FROM expenses e LEFT JOIN projects p ON p.id = e.project_id WHERE ($1::uuid IS NULL OR e.project_id = $1) ORDER BY e.date DESC LIMIT 500", [q.projectId ?? null])).rows;
}));
invoicesRouter.post("/expenses", requirePerm("expenses.manage"), h(async (req, db) => {
  const b = expenseSchema.parse(req.body);
  return (await db.query("INSERT INTO expenses (tenant_id, project_id, date, description, amount_minor, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [
    req.tenant!.id, b.projectId ?? null, b.date, b.description, b.amountMinor, userId(req),
  ])).rows[0];
}));
invoicesRouter.delete("/expenses/:id", requirePerm("expenses.manage"), h(async (req, db) => {
  await db.query("DELETE FROM expenses WHERE id = $1", [uuid.parse(req.params.id)]);
  return { ok: true };
}));
