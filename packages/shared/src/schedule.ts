/**
 * Recurring invoice schedules: how often, and on which day, a project's invoices are created.
 * Dates are "YYYY-MM-DD" strings. The server uses these to create invoices; the app uses them to preview the next dates.
 */
export const INVOICE_FREQUENCIES = ["week", "two_weeks", "month", "quarter", "half_year", "year"] as const;
export type InvoiceFrequency = (typeof INVOICE_FREQUENCIES)[number];
export const FREQUENCY_LABEL: Record<InvoiceFrequency, string> = {
  week: "Every week", two_weeks: "Every 2 weeks", month: "Every month", quarter: "Every 3 months", half_year: "Every 6 months", year: "Every year",
};
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface InvoiceSchedule {
  frequency: InvoiceFrequency;
  /** 0 = Sunday … 6 = Saturday, for weekly schedules. */
  weekday?: number | null;
  /** 1–28, or 0 for the last day of the month, for monthly schedules. */
  monthDay?: number | null;
  /** The first invoice is on the first matching day on or after this date. */
  startsOn: string;
}

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => { const x = utc(d); x.setUTCDate(x.getUTCDate() + n); return fmt(x); };
const monthsOf: Record<InvoiceFrequency, number> = { week: 0, two_weeks: 0, month: 1, quarter: 3, half_year: 6, year: 12 };
export const isWeekly = (f: InvoiceFrequency) => f === "week" || f === "two_weeks";

/** The given day of the month that `d` is in (0 = last day). */
function dayInMonth(y: number, m: number, day: number) {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(y, m, day === 0 ? last : Math.min(day, last))));
}

/** The first invoice date of a schedule. */
export function firstRun(s: InvoiceSchedule): string {
  if (isWeekly(s.frequency)) {
    const wd = s.weekday ?? utc(s.startsOn).getUTCDay();
    return plusDays(s.startsOn, (wd - utc(s.startsOn).getUTCDay() + 7) % 7);
  }
  const st = utc(s.startsOn);
  const day = s.monthDay ?? st.getUTCDate();
  const here = dayInMonth(st.getUTCFullYear(), st.getUTCMonth(), day);
  return here >= s.startsOn ? here : dayInMonth(st.getUTCFullYear(), st.getUTCMonth() + 1, day);
}

/** The invoice date after `run` (which should itself be a run of the schedule). */
export function nextRun(s: InvoiceSchedule, run: string): string {
  if (isWeekly(s.frequency)) return plusDays(run, s.frequency === "week" ? 7 : 14);
  const r = utc(run);
  return dayInMonth(r.getUTCFullYear(), r.getUTCMonth() + monthsOf[s.frequency], s.monthDay ?? utc(firstRun(s)).getUTCDate());
}

/** The invoice date before `run`. */
export function prevRun(s: InvoiceSchedule, run: string): string {
  if (isWeekly(s.frequency)) return plusDays(run, s.frequency === "week" ? -7 : -14);
  const r = utc(run);
  return dayInMonth(r.getUTCFullYear(), r.getUTCMonth() - monthsOf[s.frequency], s.monthDay ?? utc(firstRun(s)).getUTCDate());
}

/** The next `count` invoice dates on or after `from`. */
export function upcomingRuns(s: InvoiceSchedule, count = 4, from?: string): string[] {
  let d = firstRun(s);
  const out: string[] = [];
  for (let guard = 0; guard < 600 && out.length < count; guard++) { if (!from || d >= from) out.push(d); d = nextRun(s, d); }
  return out;
}

/**
 * How many of the project's billing-cap periods fit in one invoice period, for prepaid blocks:
 * a weekly cap invoiced every 2 weeks is 2 caps; a monthly cap invoiced quarterly is 3. Null when they don't line up.
 */
export function capPeriodsPerInvoice(capPeriod: "week" | "month" | null | undefined, f: InvoiceFrequency): number | null {
  if (!capPeriod) return 1;
  if (capPeriod === "week") return f === "week" ? 1 : f === "two_weeks" ? 2 : null;
  return isWeekly(f) ? null : monthsOf[f];
}

/** "Every month on the 1st", "Every week on Monday". */
export function describeSchedule(s: Pick<InvoiceSchedule, "frequency" | "weekday" | "monthDay">): string {
  if (isWeekly(s.frequency)) return `${FREQUENCY_LABEL[s.frequency]} on ${WEEKDAYS[s.weekday ?? 1]}`;
  const d = s.monthDay ?? 1;
  const nth = d === 0 ? "the last day" : `the ${d}${d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}`;
  return `${FREQUENCY_LABEL[s.frequency]} on ${nth}`;
}
