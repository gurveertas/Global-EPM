import { CalendarClock } from "lucide-react";
import { FREQUENCY_LABEL, INVOICE_FREQUENCIES, WEEKDAYS, capPeriodsPerInvoice, describeSchedule, isWeekly, upcomingRuns, type InvoiceFrequency } from "@eszy/shared";
import { Field, Input, Select, fmtDate, iso } from "./ui";

export interface ScheduleValue { frequency: InvoiceFrequency | ""; weekday: number | null; monthDay: number | null; startsOn: string }
export const emptySchedule = (startsOn = iso(new Date())): ScheduleValue => ({ frequency: "", weekday: 1, monthDay: 1, startsOn });
/** For a project without a schedule yet, the first invoice starts from today (not the project's start date in the past). */
export const scheduleFromProject = (p: any): ScheduleValue => ({
  frequency: p.invoice_frequency ?? "", weekday: p.invoice_weekday ?? 1, monthDay: p.invoice_month_day ?? 1,
  startsOn: String(p.invoice_starts_on ?? "").slice(0, 10) || [String(p.start_date ?? "").slice(0, 10), iso(new Date())].sort().pop()!,
});
/** The fields the API takes. An empty frequency switches the schedule off (invoices then follow the billing-cap week or month). */
export const scheduleBody = (v: ScheduleValue) => ({
  invoiceFrequency: v.frequency || null, invoiceWeekday: v.frequency && isWeekly(v.frequency) ? v.weekday : null,
  invoiceMonthDay: v.frequency && !isWeekly(v.frequency) ? v.monthDay : null, invoiceStartsOn: v.frequency ? v.startsOn : null,
});

/**
 * How often invoices are created and on which day: every week on Monday, every 2 weeks on Friday, every month on the 1st or the last day,
 * every 3 or 6 months, every year. Shows the next dates so there's no guessing.
 */
export function InvoiceScheduleFields({ value: v, onChange, capPeriod, prepaid, allowOff = true, note, label = "Create invoices", startLabel = "Starting from" }: {
  value: ScheduleValue; onChange: (v: ScheduleValue) => void; capPeriod?: "week" | "month" | null; prepaid?: boolean; allowOff?: boolean; note?: string; label?: string; startLabel?: string;
}) {
  const set = (p: Partial<ScheduleValue>) => onChange({ ...v, ...p });
  const on = !!v.frequency;
  const weekly = on && isWeekly(v.frequency as InvoiceFrequency);
  const sched = on ? { frequency: v.frequency as InvoiceFrequency, weekday: v.weekday, monthDay: v.monthDay, startsOn: v.startsOn || iso(new Date()) } : null;
  const today = iso(new Date());
  const next = sched ? upcomingRuns(sched, 4, sched.startsOn > today ? sched.startsOn : today) : [];
  const misfit = sched && prepaid && capPeriodsPerInvoice(capPeriod, sched.frequency) == null;
  const factor = sched && prepaid ? capPeriodsPerInvoice(capPeriod, sched.frequency) : null;
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={label}>
          <Select value={v.frequency} onChange={(e) => set({ frequency: e.target.value as any })}>
            {allowOff && <option value="">At the start of each {capPeriod ?? "period"}</option>}
            {INVOICE_FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
          </Select>
        </Field>
        {on && (weekly ? (
          <Field label="On"><Select value={v.weekday ?? 1} onChange={(e) => set({ weekday: Number(e.target.value) })}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field>
        ) : (
          <Field label="On day"><Select value={v.monthDay ?? 1} onChange={(e) => set({ monthDay: Number(e.target.value) })}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}<option value={0}>Last day of the month</option>
          </Select></Field>
        ))}
        {on && <Field label={startLabel} hint="The first invoice is on the first matching day from here."><Input type="date" value={v.startsOn} onChange={(e) => set({ startsOn: e.target.value })} /></Field>}
      </div>
      {sched && (
        <div className={misfit ? "rounded-xl border border-[#f3c2ad] bg-[#fbe5dc] p-3.5 text-[13.5px] text-[#9c3a19]" : "rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3.5 text-[13.5px]"}>
          {misfit ? <>A {capPeriod}ly billing cap can't be invoiced {FREQUENCY_LABEL[sched.frequency].toLowerCase()}. Pick a schedule that fits whole {capPeriod}s, or change the cap to per {isWeekly(sched.frequency) ? "week" : "month"}.</> : (
            <>
              <div className="flex items-center gap-2 font-semibold"><CalendarClock className="size-4 text-[var(--brand)]" />{describeSchedule(sched)}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{next.map((d, i) => <span key={d} className={i ? "rounded-md bg-[var(--card)] px-2 py-0.5 text-[12.5px] ring-1 ring-[var(--line)]" : "rounded-md bg-[var(--brand-soft)] px-2 py-0.5 text-[12.5px] font-semibold text-[var(--brand)] dark:text-white"}>{fmtDate(d, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>)}</div>
              <p className="mt-1.5 text-[12.5px] text-[var(--muted)]">{note ?? (prepaid ? `Each invoice is for the hours of the period it starts${factor && factor > 1 ? ` (${factor} × the ${capPeriod}ly cap)` : ""}.` : "Each invoice is for the approved hours up to the day before, including any approved late.")}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
