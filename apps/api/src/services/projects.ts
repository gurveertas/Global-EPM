import type { Db } from "@eszy/db";
import { FREQUENCY_LABEL, capPeriodsPerInvoice, firstRun, isWeekly, nextRun, upcomingRuns, type CompanySettings, type ProjectInput } from "@eszy/shared";
import { badRequest, conflict, notFound } from "../lib/errors";
import { addDays, addPeriod, periodBounds } from "../lib/dates";
import { recordPayment, runProjectBilling } from "./invoices";

interface Line { label: string; minutes: number; amountMinor: number; dueDate: string | null; kind?: "plan" | "extra" }

const split = (total: number, n: number) => Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));

/** Turns the project set-up into billing lines: the schedule of hours and money the client agreed to. */
export function planBillingLines(p: ProjectInput, start: string): Line[] {
  if (p.type === "fixed") {
    const price = p.priceMinor ?? p.billingLines.reduce((a, l) => a + l.amountMinor, 0);
    const est = p.estimatedMinutes ?? p.billingLines.reduce((a, l) => a + l.minutes, 0);
    if (!price) throw badRequest("Set the fixed price");
    switch (p.fixedOption) {
      case "one_time":
        return [{ label: "Full price", minutes: est, amountMinor: price, dueDate: start }];
      case "milestones": {
        if (!p.billingLines.length) throw badRequest("Add at least one milestone");
        const sum = p.billingLines.reduce((a, l) => a + l.amountMinor, 0);
        if (p.priceMinor && sum !== p.priceMinor) throw badRequest("Milestone amounts must add up to the fixed price");
        return p.billingLines.map((l) => ({ label: l.label, minutes: l.minutes, amountMinor: l.amountMinor, dueDate: l.dueDate ?? start }));
      }
      case "installments": {
        const n = p.installmentCount ?? 0;
        if (n < 2 || !p.installmentInterval) throw badRequest("Set the number of installments and how often they repeat");
        const amounts = split(price, n), mins = split(est, n);
        // With a chosen day (e.g. every month on the 5th, every week on Friday) the installments follow that schedule.
        const dayChosen = isWeekly(p.installmentInterval) ? p.installmentWeekday != null : p.installmentMonthDay != null;
        const dates = dayChosen
          ? upcomingRuns({ frequency: p.installmentInterval, weekday: p.installmentWeekday ?? null, monthDay: p.installmentMonthDay ?? null, startsOn: p.installmentStartsOn ?? start }, n)
          : amounts.map((_, i) => (p.installmentInterval === "week" || p.installmentInterval === "month" ? addPeriod(start, p.installmentInterval, i) : upcomingRuns({ frequency: p.installmentInterval!, monthDay: Number(start.slice(8, 10)) > 28 ? 0 : Number(start.slice(8, 10)), startsOn: start }, n)[i]));
        return amounts.map((a, i) => ({ label: `Installment ${i + 1} of ${n}`, minutes: mins[i], amountMinor: a, dueDate: dates[i] }));
      }
      case "advance_balance": {
        // The advance can be given as an amount (preferred) or a percentage; the other is worked out.
        if (!p.deliveryDate) throw badRequest("Set the delivery date; the balance is invoiced on it");
        const adv = p.advanceMinor != null ? p.advanceMinor : Math.round((price * (p.advancePercent ?? 0)) / 100);
        if (!(adv > 0 && adv < price)) throw badRequest("The advance must be more than zero and less than the full price");
        const pct = Math.round((adv / price) * 1000) / 10;
        const advMin = Math.round((est * adv) / price);
        return [
          { label: `Advance (${pct}%)`, minutes: advMin, amountMinor: adv, dueDate: start },
          { label: "Balance on delivery", minutes: est - advMin, amountMinor: price - adv, dueDate: p.deliveryDate },
        ];
      }
      default:
        throw badRequest("Pick how the fixed price is paid");
    }
  }
  // Hourly
  if (!p.billingType) throw badRequest("Pick prepaid or postpaid billing");
  if (p.hourlyRateMinor == null) throw badRequest("Set the hourly rate");
  const due = p.billingType === "prepaid" ? (p.billingDate ?? start) : null;
  const lines: Line[] = p.billingLines.map((l) => ({ label: l.label, minutes: l.minutes, amountMinor: l.amountMinor, dueDate: l.dueDate ?? due }));
  if (!lines.length && p.billingType === "prepaid") {
    if (!p.billingCapMinutes) throw badRequest("Add a billing line or set the billing cap for prepaid hours");
    const period = p.billingPeriod ?? "month";
    lines.push({
      label: p.invoicing === "recurring" ? `First ${period}` : "Prepaid hours",
      minutes: p.billingCapMinutes,
      amountMinor: Math.round((p.billingCapMinutes * p.hourlyRateMinor) / 60),
      dueDate: due,
    });
  }
  return lines;
}

export async function createProject(db: Db, tenantId: string, settings: CompanySettings, input: ProjectInput, by: string, today: string, maxProjects?: number | null) {
  if (maxProjects != null) {
    const n = (await db.query("SELECT count(*)::int AS n FROM projects WHERE status <> 'ended'")).rows[0].n;
    if (n >= maxProjects) throw conflict(`Your plan allows ${maxProjects} open projects. End a project or move to a bigger plan.`);
  }
  const client = (await db.query("SELECT id FROM clients WHERE id = $1", [input.clientId])).rows[0];
  if (!client) throw notFound("Client not found");
  if (input.invoicing === "recurring" && input.type === "hourly" && !input.billingPeriod) throw badRequest("Recurring invoices need a billing period (week or month)");
  const start = input.startDate ?? today;
  // A chosen schedule decides the first invoice day; prepaid blocks then cover one invoice period each.
  const sched = input.type === "hourly" && input.invoicing === "recurring" && input.invoiceFrequency
    ? { frequency: input.invoiceFrequency, weekday: input.invoiceWeekday ?? null, monthDay: input.invoiceMonthDay ?? null, startsOn: input.invoiceStartsOn ?? start }
    : null;
  if (sched && isWeekly(sched.frequency) && sched.weekday == null) throw badRequest("Pick the day of the week invoices are created");
  if (sched && !isWeekly(sched.frequency) && sched.monthDay == null) throw badRequest("Pick the day of the month invoices are created");
  const factor = sched ? capPeriodsPerInvoice(input.billingPeriod, sched.frequency) : 1;
  if (sched && input.billingType === "prepaid" && factor == null) throw badRequest(`A ${input.billingPeriod}ly billing cap can't be invoiced ${FREQUENCY_LABEL[sched.frequency].toLowerCase()}. Pick a schedule that fits whole ${input.billingPeriod}s.`);
  const firstInvoice = sched ? firstRun(sched) : null;
  const lines = planBillingLines(sched && input.billingType === "prepaid" ? { ...input, billingDate: firstInvoice } : input, start);
  if (sched && input.billingType === "prepaid" && !input.billingLines.length && lines[0] && factor && input.billingCapMinutes && input.hourlyRateMinor != null) {
    lines[0].minutes = input.billingCapMinutes * factor;
    lines[0].amountMinor = Math.round((lines[0].minutes * input.hourlyRateMinor) / 60);
    lines[0].label = `${firstInvoice} to ${addDays(nextRun(sched, firstInvoice!), -1)}`;
  }
  const price = input.type === "fixed" ? (input.priceMinor ?? lines.reduce((a, l) => a + l.amountMinor, 0)) : null;

  let nextBilling: string | null = null;
  if (sched) nextBilling = input.billingType === "prepaid" ? nextRun(sched, firstInvoice!) : firstInvoice;
  else if (input.type === "hourly" && input.invoicing === "recurring" && input.billingPeriod) {
    nextBilling = input.billingType === "prepaid"
      ? addPeriod(input.billingDate ?? start, input.billingPeriod)
      : periodBounds(start, input.billingPeriod, settings.locale.weekStartsOn).start;
  }
  const p = (
    await db.query(
      `INSERT INTO projects (tenant_id, client_id, name, code, type, billing_type, invoicing, fixed_option, price_minor, hourly_rate_minor,
         installment_count, installment_interval, advance_percent, delivery_date, billing_cap_minutes, billing_period, billing_date, next_billing_date,
         due_days, due_soon_days, due_soon_client_email, pm_user_id, sales_user_id, lead_id, start_date, created_by,
         source_id, account_id, communication_type_ids, allow_offline_hours, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31) RETURNING *`,
      [tenantId, input.clientId, input.name, input.code, input.type, input.type === "hourly" ? input.billingType : null,
        input.type === "fixed" ? (input.fixedOption === "installments" ? "recurring" : "one_time") : input.invoicing,
        input.type === "fixed" ? input.fixedOption : null, price, input.type === "hourly" ? input.hourlyRateMinor : null,
        input.installmentCount ?? null, input.installmentInterval ?? null, input.advanceMinor != null && input.priceMinor ? Math.max(1, Math.min(99, Math.round((input.advanceMinor / input.priceMinor) * 100))) : input.advancePercent ?? null, input.deliveryDate ?? null,
        input.billingCapMinutes ?? null, input.billingCapMinutes ? (input.billingPeriod ?? "week") : (input.billingPeriod ?? null),
        (sched && input.billingType === "prepaid" ? firstInvoice : input.billingDate) ?? (input.billingType === "prepaid" ? start : null), nextBilling,
        input.dueDays ?? null, input.dueSoonDays ?? null, input.dueSoonClientEmail ?? null,
        input.pmUserId ?? null, input.salesUserId ?? null, input.leadId ?? null, start, by,
        input.sourceId ?? null, input.accountId ?? null, input.communicationTypeIds ?? [], input.allowOfflineHours ?? true, input.description ?? ""],
    )
  ).rows[0];
  let pos = 0;
  for (const l of lines) {
    await db.query("INSERT INTO billing_lines (tenant_id, project_id, position, label, minutes, amount_minor, due_date, kind, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'plan',$8)", [
      tenantId, p.id, pos++, l.label, l.minutes, l.amountMinor, l.dueDate, by,
    ]);
  }
  if (sched) await db.query("UPDATE projects SET invoice_frequency = $2, invoice_weekday = $3, invoice_month_day = $4, invoice_starts_on = $5 WHERE id = $1",
    [p.id, sched.frequency, isWeekly(sched.frequency) ? sched.weekday : null, isWeekly(sched.frequency) ? null : sched.monthDay, sched.startsOn]);
  await db.query("UPDATE projects SET is_internal = $2, estimator_user_id = $3, caller_user_id = $4, tags = $5 WHERE id = $1",
    [p.id, input.isInternal ?? false, input.estimatorUserId ?? null, input.callerUserId ?? null, input.tags ?? []]);
  const pmIds = [...new Set([input.pmUserId, ...(input.pmIds ?? [])].filter(Boolean) as string[])];
  if (!input.pmUserId && pmIds[0]) await db.query("UPDATE projects SET pm_user_id = $2 WHERE id = $1", [p.id, pmIds[0]]);
  const stage = input.stageId ?? (await db.query("SELECT id FROM project_stages WHERE active ORDER BY position LIMIT 1")).rows[0]?.id ?? null;
  if (stage) await db.query("UPDATE projects SET stage_id = $2 WHERE id = $1", [p.id, stage]);
  for (const m of pmIds) await db.query("INSERT INTO project_members (tenant_id, project_id, user_id, role, assigned_by) VALUES ($1,$2,$3,'pm',$4) ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'pm'", [tenantId, p.id, m, by]);
  const members = new Set(input.memberIds.filter((m) => !pmIds.includes(m)));
  for (const t of (input.tlIds ?? []).filter((x) => !pmIds.includes(x))) await db.query("INSERT INTO project_members (tenant_id, project_id, user_id, role, assigned_by) VALUES ($1,$2,$3,'tl',$4) ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'tl'", [tenantId, p.id, t, by]);
  for (const m of members) await db.query("INSERT INTO project_members (tenant_id, project_id, user_id, assigned_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [tenantId, p.id, m, by]);
  await db.query(
    "INSERT INTO project_role_history (tenant_id, project_id, user_id, role) SELECT tenant_id, project_id, user_id, role FROM project_members WHERE project_id = $1 AND role IN ('pm','tl')", [p.id]);
  // The lead this work came from: passed in, or the converted lead the client was made from.
  const leadId = input.leadId ?? (await db.query(
    "SELECT l.id FROM clients c JOIN leads l ON l.id = c.lead_id WHERE c.id = $1 AND l.status = 'converted' AND l.project_id IS NULL", [input.clientId])).rows[0]?.id ?? null;
  if (leadId) {
    await db.query("UPDATE leads SET status = 'onboarded', project_id = coalesce(project_id, $2), client_id = $3, updated_at = now() WHERE id = $1", [leadId, p.id, input.clientId]);
    await db.query("UPDATE projects SET lead_id = coalesce(lead_id, $2) WHERE id = $1", [p.id, leadId]);
    await db.query("UPDATE clients SET lead_id = coalesce(lead_id, $2) WHERE id = $1", [input.clientId, leadId]);
  }
  const invoices = await runProjectBilling(db, settings, p.id, today, by);
  if (input.initialPaymentMinor > 0) {
    if (!invoices.length) throw badRequest("No invoice is created today for this project, so there's nothing to record the payment on yet");
    invoices[0] = await recordPayment(db, invoices[0].id, { amountMinor: Math.min(input.initialPaymentMinor, invoices[0].total_minor), receivedOn: today, method: "received_before_invoice", reference: "" }, by, false);
  }
  return { project: p, invoices };
}
