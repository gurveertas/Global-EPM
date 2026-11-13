/** Date helpers. All dates are "YYYY-MM-DD" strings in the company's time zone. */

export function todayIn(tz: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const toUtc = (d: string) => new Date(`${d}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(d: string, n: number): string {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fmt(x);
}
export function addMonths(d: string, n: number): string {
  const x = toUtc(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return fmt(x);
}
export const addPeriod = (d: string, period: "week" | "month", n = 1) => (period === "week" ? addDays(d, 7 * n) : addMonths(d, n));
export const dayOfWeek = (d: string) => toUtc(d).getUTCDay();
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86400000);

/** The billing period (week or month) that contains `d`. End is inclusive. */
export function periodBounds(d: string, period: "week" | "month", weekStartsOn = 1): { start: string; end: string } {
  if (period === "week") {
    const back = (dayOfWeek(d) - weekStartsOn + 7) % 7;
    const start = addDays(d, -back);
    return { start, end: addDays(start, 6) };
  }
  const start = `${d.slice(0, 8)}01`;
  return { start, end: addDays(addMonths(start, 1), -1) };
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
