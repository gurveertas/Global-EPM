import type { Db } from "@eszy/db";
import { capPeriodsPerInvoice, formatMoney, nextRun, prevRun, upcomingRuns, type CompanySettings, type InvoiceFrequency } from "@eszy/shared";
import { badRequest, conflict, notFound } from "../lib/errors";
import { computeTax, splitInclusive } from "../lib/tax";
import { addDays, addPeriod, daysBetween, periodBounds } from "../lib/dates";
import { notify, usersWithRole, usersWithPermission } from "../lib/audit";
import { enqueueEmail } from "../lib/queue";
import { fireAlerts } from "../lib/alerts";

export interface NewInvoice {
  projectId: string;
  kind: "fixed" | "prepaid" | "postpaid" | "extra" | "manual";
  issueDate: string;
  dueDays?: number | null;
  lines: { description: string; minutes: number; amountMinor: number; billingLineId?: string | null }[];
  periodStart?: string | null;
  periodEnd?: string | null;
  notes?: string;
  initialPaymentMinor?: number;
  createdBy?: string | null;
  entryIds?: string[];
  correctsInvoiceId?: string | null;
}

async function nextNumber(db: Db, prefix: string) {
  const r = (await db.query("UPDATE invoice_sequences SET next_value = next_value + 1 RETURNING next_value - 1 AS n")).rows[0];
  if (!r) throw new Error("invoice sequence missing");
  return `${prefix}${String(r.n).padStart(4, "0")}`;
}

/** Creates an invoice with tax, links its billing lines and hours, and records money already received. */
export async function createInvoice(db: Db, settings: CompanySettings, inv: NewInvoice) {
  const p = (await db.query("SELECT p.*, c.country AS client_country, c.state AS client_state, c.email AS client_email, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = $1", [inv.projectId])).rows[0];
  if (!p) throw notFound("Project not found");
  const gross = inv.lines.reduce((a, l) => a + l.amountMinor, 0);
  if (gross <= 0) throw badRequest("An invoice needs an amount above zero");
  let subtotal = gross;
  let taxes = computeTax(subtotal, settings.tax, { country: p.client_country, state: p.client_state });
  if (settings.tax.pricesIncludeTax && taxes.length) {
    const rate = taxes.reduce((a, t) => a + t.rateBp, 0);
    subtotal = splitInclusive(gross, rate).subtotal;
    taxes = computeTax(subtotal, settings.tax, { country: p.client_country, state: p.client_state });
    const diff = gross - subtotal - taxes.reduce((a, t) => a + t.amountMinor, 0);
    if (taxes.length && diff) taxes[taxes.length - 1].amountMinor += diff;
  }
  const taxTotal = taxes.reduce((a, t) => a + t.amountMinor, 0);
  const dueDays = inv.dueDays ?? p.due_days ?? settings.invoices.defaultDueDays;
  const number = await nextNumber(db, settings.invoices.numberPrefix);
  const row = (
    await db.query(
      `INSERT INTO invoices (tenant_id, project_id, client_id, number, kind, issue_date, due_date, currency, subtotal_minor, tax_minor, total_minor, period_start, period_end, notes, created_by, corrects_invoice_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [p.tenant_id, p.id, p.client_id, number, inv.kind, inv.issueDate, addDays(inv.issueDate, dueDays), settings.locale.currency,
        subtotal, taxTotal, subtotal + taxTotal, inv.periodStart ?? null, inv.periodEnd ?? null, inv.notes ?? "", inv.createdBy ?? null, inv.correctsInvoiceId ?? null],
    )
  ).rows[0];
  for (const l of inv.lines) {
    await db.query("INSERT INTO invoice_lines (tenant_id, invoice_id, description, minutes, amount_minor, billing_line_id) VALUES ($1,$2,$3,$4,$5,$6)", [
      p.tenant_id, row.id, l.description, l.minutes, l.amountMinor, l.billingLineId ?? null,
    ]);
    if (l.billingLineId) await db.query("UPDATE billing_lines SET invoice_id = $1 WHERE id = $2", [row.id, l.billingLineId]);
  }
  for (const t of taxes) {
    await db.query("INSERT INTO invoice_taxes (tenant_id, invoice_id, name, rate_bp, amount_minor) VALUES ($1,$2,$3,$4,$5)", [p.tenant_id, row.id, t.name, t.rateBp, t.amountMinor]);
  }
  if (inv.entryIds?.length) await db.query("UPDATE time_entries SET invoice_id = $1 WHERE id = ANY($2)", [row.id, inv.entryIds]);
  if (inv.initialPaymentMinor && inv.initialPaymentMinor > 0) {
    await recordPayment(db, row.id, { amountMinor: Math.min(inv.initialPaymentMinor, row.total_minor), receivedOn: inv.issueDate, method: "received_before_invoice", reference: "" }, inv.createdBy ?? null, false);
  }
  const bms = await usersWithRole(db, ["billing_manager"]);
  await notify(db, bms, { kind: "invoice.created", title: `Invoice ${number} created`, body: `${p.name}: ${formatMoney(row.total_minor, row.currency)}`, link: `/invoices/${row.id}` });
  await fireAlerts(db, "invoice.created", { key: row.id, title: `Invoice ${number} created for ${p.name}`, body: formatMoney(row.total_minor, row.currency), link: `/invoices/${row.id}`, ownerIds: [p.pm_user_id] });
  if (settings.invoices.emailInvoicesToClient && p.client_email) {
    await enqueueEmail({
      to: p.client_email,
      subject: `Invoice ${number} from ${settings.branding.displayName}`,
      text: `Hi ${p.client_name},\n\nInvoice ${number} for ${formatMoney(row.total_minor, row.currency)} is due on ${row.due_date}.\n\n${settings.invoices.footer}`,
    });
  }
  return (await db.query("SELECT * FROM invoices WHERE id = $1", [row.id])).rows[0];
}

/** Sets Unpaid / Partially paid / Paid from the payments recorded. Refunded and cancelled stay as they are. */
export async function refreshStatus(db: Db, invoiceId: string) {
  await db.query(
    `UPDATE invoices i SET paid_minor = s.paid,
       status = CASE WHEN i.status IN ('refunded','cancelled') THEN i.status
                     WHEN s.paid >= i.total_minor THEN 'paid' WHEN s.paid > 0 THEN 'partially_paid' ELSE 'unpaid' END
     FROM (SELECT coalesce(sum(amount_minor),0) AS paid FROM payments WHERE invoice_id = $1) s WHERE i.id = $1`,
    [invoiceId],
  );
}

export async function recordPayment(db: Db, invoiceId: string, p: { amountMinor: number; receivedOn: string; method: string; reference: string }, by: string | null, notifyPeople = true) {
  const inv = (await db.query("SELECT * FROM invoices WHERE id = $1 FOR UPDATE", [invoiceId])).rows[0];
  if (!inv) throw notFound("Invoice not found");
  if (["cancelled", "refunded"].includes(inv.status)) throw conflict(`This invoice is ${inv.status}`);
  const outstanding = inv.total_minor - inv.paid_minor;
  if (p.amountMinor > outstanding) throw badRequest(`Only ${formatMoney(outstanding, inv.currency)} is outstanding on this invoice`);
  await db.query("INSERT INTO payments (tenant_id, invoice_id, amount_minor, received_on, method, reference, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
    inv.tenant_id, invoiceId, p.amountMinor, p.receivedOn, p.method, p.reference, by,
  ]);
  await refreshStatus(db, invoiceId);
  const after = (await db.query("SELECT * FROM invoices WHERE id = $1", [invoiceId])).rows[0];
  if (notifyPeople) {
    const pm = (await db.query("SELECT pm_user_id FROM projects WHERE id = $1", [inv.project_id])).rows[0]?.pm_user_id;
    await fireAlerts(db, "payment.recorded", { key: `${invoiceId}:${after.paid_minor}`, title: `Payment of ${formatMoney(p.amountMinor, inv.currency)} on ${inv.number}`, link: `/invoices/${invoiceId}`, ownerIds: [pm] });
    const ids = await usersWithPermission(db, "money.view");
    await notify(db, ids.filter((x) => x !== by), { kind: "payment", title: `Payment on ${inv.number}`, body: `${formatMoney(p.amountMinor, inv.currency)} received. Invoice is now ${after.status.replace("_", " ")}.`, link: `/invoices/${invoiceId}` });
  }
  return after;
}

/** Refunds always cover one whole invoice. Its hours then show as Refunded in reports. */
export async function refundInvoice(db: Db, invoiceId: string, r: { refundedOn: string; reason: string }, by: string | null) {
  const inv = (await db.query("SELECT * FROM invoices WHERE id = $1 FOR UPDATE", [invoiceId])).rows[0];
  if (!inv) throw notFound("Invoice not found");
  if (inv.status === "refunded") throw conflict("This invoice is already refunded");
  if (inv.status === "cancelled") throw conflict("A cancelled invoice can't be refunded");
  if (inv.paid_minor <= 0) throw badRequest("Nothing has been paid on this invoice. Cancel it instead.");
  await db.query("INSERT INTO refunds (tenant_id, invoice_id, amount_minor, refunded_on, reason, recorded_by) VALUES ($1,$2,$3,$4,$5,$6)", [
    inv.tenant_id, invoiceId, inv.paid_minor, r.refundedOn, r.reason, by,
  ]);
  await db.query("UPDATE invoices SET status = 'refunded', refunded_at = now() WHERE id = $1", [invoiceId]);
  const pm = (await db.query("SELECT pm_user_id FROM projects WHERE id = $1", [inv.project_id])).rows[0]?.pm_user_id;
  await fireAlerts(db, "invoice.refunded", { key: invoiceId, title: `${inv.number} was refunded`, body: r.reason, link: `/invoices/${invoiceId}`, ownerIds: [pm] });
  return (await db.query("SELECT * FROM invoices WHERE id = $1", [invoiceId])).rows[0];
}

/** Cancelling keeps the number and records why. Its billing lines and hours go back to be invoiced again. */
export async function cancelInvoice(db: Db, invoiceId: string, reason = "") {
  const inv = (await db.query("SELECT * FROM invoices WHERE id = $1 FOR UPDATE", [invoiceId])).rows[0];
  if (!inv) throw notFound("Invoice not found");
  if (inv.status === "cancelled") throw conflict("Already cancelled");
  if (inv.paid_minor > 0) throw conflict("Money was received on this invoice. Refund it instead of cancelling.");
  await db.query("UPDATE invoices SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2 WHERE id = $1", [invoiceId, reason]);
  await db.query("UPDATE billing_lines SET invoice_id = NULL, cancelled_invoice_id = $1 WHERE invoice_id = $1", [invoiceId]);
  await db.query("UPDATE time_entries SET invoice_id = NULL, cancelled_invoice_id = $1 WHERE invoice_id = $1", [invoiceId]);
  return (await db.query("SELECT * FROM invoices WHERE id = $1", [invoiceId])).rows[0];
}

/** Display status: Overdue and Due soon come from the due date; the rest is stored. */
export function displayStatus(inv: { status: string; due_date: string }, today: string, dueSoonDays: number): string {
  if (!["unpaid", "partially_paid"].includes(inv.status)) return inv.status;
  if (inv.due_date < today) return "overdue";
  if (daysBetween(today, inv.due_date) <= dueSoonDays) return "due_soon";
  return inv.status;
}

const minutesAmount = (minutes: number, rateMinor: number) => Math.round((minutes * rateMinor) / 60);

/** Postpaid hours: approved, billable, not yet invoiced, dated up to `to`; one invoice issued on `issueDate`, labelled from `labelFrom`. */
async function postpaidUpTo(db: Db, settings: CompanySettings, p: any, labelFrom: string, to: string, issueDate: string, by: string | null) {
  const rows = (await db.query(
    `SELECT e.id, coalesce(sum(a.minutes) FILTER (WHERE bl.id IS NULL OR (bl.kind = 'plan' AND bl.amount_minor > 0)),0)::int AS billable
     FROM time_entries e JOIN sheets s ON s.id = e.sheet_id AND s.status = 'approved'
     LEFT JOIN time_allocations a ON a.entry_id = e.id LEFT JOIN billing_lines bl ON bl.id = a.billing_line_id
     WHERE e.project_id = $1 AND e.invoice_id IS NULL AND e.date <= $2 GROUP BY e.id`, [p.id, to])).rows;
  const minutes = rows.reduce((a, r) => a + r.billable, 0);
  if (minutes <= 0) return [];
  return [await createInvoice(db, settings, {
    projectId: p.id, kind: "postpaid", issueDate, periodStart: labelFrom, periodEnd: to,
    lines: [{ description: `${p.name}: hours ${labelFrom} to ${to}`, minutes, amountMinor: minutesAmount(minutes, p.hourly_rate_minor) }],
    entryIds: rows.map((r) => r.id), createdBy: by,
  })];
}

/**
 * Creates every invoice a project is due today. Safe to run any number of times:
 * each billing line is invoiced once, and each postpaid period once.
 *  - Fixed price: each billing line on its date (one-time, milestones, installments, advance + balance).
 *  - Hourly prepaid: each block on the billing date; recurring adds a new block every period.
 *  - Hourly postpaid: approved billable hours after each period (recurring) or when the project ends (one-time).
 *  - Paid extra hours: as soon as the Billing Manager adds them.
 */
export async function runProjectBilling(db: Db, settings: CompanySettings, projectId: string, today: string, by: string | null = null) {
  const p = (await db.query("SELECT * FROM projects WHERE id = $1 FOR UPDATE", [projectId])).rows[0];
  if (!p) return [];
  const created: any[] = [];

  // Billing lines that are invoiced directly: all fixed lines, prepaid blocks, and paid extra lines on any project.
  const lines = (
    await db.query(
      `SELECT * FROM billing_lines WHERE project_id = $1 AND invoice_id IS NULL AND amount_minor > 0
         AND ($2 <> 'postpaid' OR kind = 'extra') ORDER BY position, created_at`,
      [p.id, p.billing_type ?? ""],
    )
  ).rows;
  for (const l of lines) {
    const when: string = l.kind === "extra" ? today : (l.due_date ?? (p.type === "hourly" ? p.billing_date : null) ?? today);
    if (when > today) continue;
    created.push(await createInvoice(db, settings, {
      projectId: p.id, kind: l.kind === "extra" ? "extra" : p.type === "fixed" ? "fixed" : "prepaid", issueDate: when,
      lines: [{ description: `${p.name}: ${l.label}`, minutes: l.minutes, amountMinor: l.amount_minor, billingLineId: l.id }], createdBy: by,
    }));
  }
  if (p.status !== "active" && !(p.status === "ended" && p.billing_type === "postpaid")) return created;

  // A recurring schedule the Billing Manager chose (e.g. every 2 weeks on Monday, every month on the 1st).
  const sched = p.invoice_frequency
    ? { frequency: p.invoice_frequency as InvoiceFrequency, weekday: p.invoice_weekday, monthDay: p.invoice_month_day, startsOn: (p.invoice_starts_on ?? p.start_date ?? today) as string }
    : null;
  if (sched && p.invoicing === "recurring" && p.type === "hourly") {
    let next = (p.next_billing_date as string | null) ?? upcomingRuns(sched, 1, today)[0];
    const factor = capPeriodsPerInvoice(p.billing_period, sched.frequency) ?? 1;
    while (next && next <= today) {
      const after = nextRun(sched, next);
      if (p.billing_type === "prepaid" && p.billing_cap_minutes && p.hourly_rate_minor) {
        // Prepaid: a block covering this invoice period, invoiced on its first day.
        const end = addDays(after, -1);
        const minutes = p.billing_cap_minutes * factor;
        const pos = (await db.query("SELECT coalesce(max(position),0)+1 AS n FROM billing_lines WHERE project_id = $1", [p.id])).rows[0].n;
        const bl = (await db.query(
          "INSERT INTO billing_lines (tenant_id, project_id, position, label, minutes, amount_minor, due_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [p.tenant_id, p.id, pos, `${next} to ${end}`, minutes, minutesAmount(minutes, p.hourly_rate_minor), next, by],
        )).rows[0];
        created.push(await createInvoice(db, settings, {
          projectId: p.id, kind: "prepaid", issueDate: next, periodStart: next, periodEnd: end,
          lines: [{ description: `${p.name}: ${bl.label}`, minutes: bl.minutes, amountMinor: bl.amount_minor, billingLineId: bl.id }], createdBy: by,
        }));
      } else if (p.billing_type === "postpaid" && p.hourly_rate_minor) {
        // Postpaid: on each scheduled day, invoice the approved hours up to the day before (late approvals included).
        created.push(...(await postpaidUpTo(db, settings, p, prevRun(sched, next), addDays(next, -1), next, by)));
      }
      next = after;
      await db.query("UPDATE projects SET next_billing_date = $2 WHERE id = $1", [p.id, next]);
    }
    // When a postpaid project ends, whatever is left is invoiced straight away.
    if (p.status === "ended" && p.billing_type === "postpaid" && p.hourly_rate_minor) created.push(...(await postpaidUpTo(db, settings, p, prevRun(sched, next), today, today, by)));
    return created;
  }

  // Recurring prepaid: add next period's block and invoice it on its date.
  if (p.type === "hourly" && p.billing_type === "prepaid" && p.invoicing === "recurring" && p.billing_period && p.billing_cap_minutes && p.hourly_rate_minor) {
    let next = p.next_billing_date as string | null;
    while (next && next <= today) {
      const end = addDays(addPeriod(next, p.billing_period), -1);
      const pos = (await db.query("SELECT coalesce(max(position),0)+1 AS n FROM billing_lines WHERE project_id = $1", [p.id])).rows[0].n;
      const amount = minutesAmount(p.billing_cap_minutes, p.hourly_rate_minor);
      const bl = (await db.query(
        "INSERT INTO billing_lines (tenant_id, project_id, position, label, minutes, amount_minor, due_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [p.tenant_id, p.id, pos, `${next} to ${end}`, p.billing_cap_minutes, amount, next, by],
      )).rows[0];
      created.push(await createInvoice(db, settings, {
        projectId: p.id, kind: "prepaid", issueDate: next, periodStart: next, periodEnd: end,
        lines: [{ description: `${p.name}: ${bl.label}`, minutes: bl.minutes, amountMinor: bl.amount_minor, billingLineId: bl.id }], createdBy: by,
      }));
      next = addPeriod(next, p.billing_period);
      await db.query("UPDATE projects SET next_billing_date = $2 WHERE id = $1", [p.id, next]);
    }
  }

  // Postpaid: invoice approved billable hours that are not on an invoice yet.
  if (p.type === "hourly" && p.billing_type === "postpaid" && p.hourly_rate_minor) {
    const invoicePeriod = async (from: string | null, to: string) => {
      const rows = (await db.query(
        `SELECT e.id, e.minutes, coalesce(sum(a.minutes) FILTER (WHERE bl.id IS NULL OR (bl.kind = 'plan' AND bl.amount_minor > 0)),0)::int AS billable
         FROM time_entries e JOIN sheets s ON s.id = e.sheet_id AND s.status = 'approved'
         LEFT JOIN time_allocations a ON a.entry_id = e.id LEFT JOIN billing_lines bl ON bl.id = a.billing_line_id
         WHERE e.project_id = $1 AND e.invoice_id IS NULL AND ($2::date IS NULL OR e.date >= $2) AND e.date <= $3
         GROUP BY e.id`,
        [p.id, from, to],
      )).rows;
      const minutes = rows.reduce((a, r) => a + r.billable, 0);
      if (minutes <= 0) return;
      created.push(await createInvoice(db, settings, {
        projectId: p.id, kind: "postpaid", issueDate: today, periodStart: from, periodEnd: to,
        lines: [{ description: `${p.name}: hours ${from ?? "to"} ${from ? "to " : ""}${to}`, minutes, amountMinor: minutesAmount(minutes, p.hourly_rate_minor) }],
        entryIds: rows.map((r) => r.id), createdBy: by,
      }));
    };
    if (p.invoicing === "recurring" && p.billing_period) {
      // Every finished period with approved, not-yet-invoiced hours gets its own invoice.
      // Hours approved late (after their period was invoiced) go on a new invoice for that period.
      const current = periodBounds(today, p.billing_period, settings.locale.weekStartsOn);
      const lastEnd = addDays(current.start, -1);
      const dates = (await db.query(
        `SELECT DISTINCT e.date FROM time_entries e JOIN sheets s ON s.id = e.sheet_id AND s.status = 'approved'
         WHERE e.project_id = $1 AND e.invoice_id IS NULL AND e.date <= $2 ORDER BY e.date`, [p.id, lastEnd],
      )).rows.map((r) => r.date as string);
      const periods = [...new Set(dates.map((d) => periodBounds(d, p.billing_period, settings.locale.weekStartsOn).start))];
      for (const start of periods) {
        await invoicePeriod(start, periodBounds(start, p.billing_period, settings.locale.weekStartsOn).end);
      }
      await db.query("UPDATE projects SET next_billing_date = $2 WHERE id = $1", [p.id, addPeriod(current.start, p.billing_period)]);
    } else if (p.status === "ended") {
      await invoicePeriod(null, today);
    }
  }
  return created;
}

/**
 * Issues a corrected invoice for a cancelled one. It is linked to the cancelled invoice and, by default,
 * carries the same lines (so the same billing lines and hours are invoiced again); the lines can be changed.
 */
export async function correctInvoice(db: Db, settings: CompanySettings, cancelledId: string, opts: { issueDate: string; lines?: { description: string; minutes: number; amountMinor: number }[]; notes?: string; dueDays?: number }, by: string | null) {
  const old = (await db.query("SELECT * FROM invoices WHERE id = $1", [cancelledId])).rows[0];
  if (!old) throw notFound("Invoice not found");
  if (old.status !== "cancelled") throw conflict("Cancel the invoice before issuing a corrected one");
  if ((await db.query("SELECT 1 FROM invoices WHERE corrects_invoice_id = $1 AND status <> 'cancelled'", [cancelledId])).rowCount) throw conflict("A corrected invoice already exists for this one");
  const oldLines = (await db.query("SELECT * FROM invoice_lines WHERE invoice_id = $1", [cancelledId])).rows;
  const lines = opts.lines?.length
    ? opts.lines.map((l, i) => ({ ...l, billingLineId: oldLines[i]?.billing_line_id ?? null }))
    : oldLines.map((l) => ({ description: l.description, minutes: l.minutes, amountMinor: l.amount_minor, billingLineId: l.billing_line_id }));
  for (const l of lines) if (l.billingLineId && (await db.query("SELECT 1 FROM billing_lines WHERE id = $1 AND invoice_id IS NOT NULL", [l.billingLineId])).rowCount) l.billingLineId = null;
  const entryIds = (await db.query("SELECT id FROM time_entries WHERE project_id = $1 AND invoice_id IS NULL AND id IN (SELECT entry_id FROM time_allocations) AND $2 = 'postpaid' AND date BETWEEN coalesce($3::date, '-infinity') AND coalesce($4::date, 'infinity')",
    [old.project_id, old.kind, old.period_start, old.period_end])).rows.map((r) => r.id);
  return createInvoice(db, settings, {
    projectId: old.project_id, kind: old.kind, issueDate: opts.issueDate, dueDays: opts.dueDays, periodStart: old.period_start, periodEnd: old.period_end,
    notes: opts.notes ?? `Replaces ${old.number}${old.cancel_reason ? ` (${old.cancel_reason})` : ""}.`, lines, entryIds, createdBy: by, correctsInvoiceId: cancelledId,
  });
}
