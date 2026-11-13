import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatMinutes } from "@eszy/shared";
import { CATS, SplitBar } from "./Charts";
import { Card, Pager, Stat, cx, fmtDate, hrs, usePaged } from "./ui";

/** Attendance status colours and labels, shared by the grid and the month calendar. Colour is never the only signal: each cell also has a letter. */
export const ATT: Record<string, { label: string; short: string; cls: string }> = {
  present: { label: "Present", short: "P", cls: "bg-[#e2f3ea] text-[#17623f] dark:bg-[#17623f]/35 dark:text-[#8fd8b2]" },
  wfh: { label: "Work from home", short: "W", cls: "bg-[#e5eefb] text-[#24529a] dark:bg-[#24529a]/35 dark:text-[#9fc1f2]" },
  pending: { label: "Hours not submitted", short: "D", cls: "bg-[#fdf0d9] text-[#7d4c00] dark:bg-[#7d4c00]/35 dark:text-[#f5c879]" },
  absent: { label: "Absent / no sheet", short: "A", cls: "bg-[#fbe5dc] text-[#9c3a19] dark:bg-[#9c3a19]/35 dark:text-[#f3a98c]" },
  leave: { label: "Full-day leave", short: "L", cls: "bg-[#efe8f8] text-[#5b3290] dark:bg-[#5b3290]/35 dark:text-[#cdb3ef]" },
  half_leave: { label: "Half-day leave", short: "½", cls: "bg-[#efe8f8] text-[#5b3290] dark:bg-[#5b3290]/35 dark:text-[#cdb3ef]" },
  short_leave: { label: "Short leave", short: "S", cls: "bg-[#efe8f8] text-[#5b3290] dark:bg-[#5b3290]/35 dark:text-[#cdb3ef]" },
  holiday: { label: "Holiday", short: "H", cls: "bg-[#fff3c4] text-[#6a5200] dark:bg-[#6a5200]/35 dark:text-[#f2db7d]" },
  half_holiday: { label: "Half holiday", short: "h", cls: "bg-[#fff3c4] text-[#6a5200] dark:bg-[#6a5200]/35 dark:text-[#f2db7d]" },
  non_working: { label: "Weekend", short: "·", cls: "bg-black/[.03] text-[var(--muted)] dark:bg-white/5" },
  future: { label: "Not yet", short: "", cls: "bg-transparent text-[var(--muted)]" },
  not_employed: { label: "Not employed", short: "", cls: "bg-black/[.02] text-[var(--muted)] dark:bg-white/5" },
};
export function AttendanceLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-[var(--muted)]">
      {["present", "wfh", "pending", "absent", "leave", "half_leave", "short_leave", "holiday", "non_working"].map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5"><span className={cx("grid size-5 place-items-center rounded text-[11px] font-bold", ATT[k].cls)}>{ATT[k].short}</span>{ATT[k].label}</li>
      ))}
    </ul>
  );
}
const tip = (c: any) => `${fmtDate(c.date)}: ${ATT[c.status]?.label ?? c.status}${c.leave ? ` (${c.leave})` : ""}${c.holiday ? ` (${c.holiday})` : ""}${c.logged ? `, ${formatMinutes(c.logged)} logged` : ""}${c.expected ? ` of ${formatMinutes(c.expected)}` : ""}`;

/** Everyone × every day. Rows scroll sideways on narrow screens; the name column stays put. */
export function AttendanceGrid({ days, people }: { days: string[]; people: any[] }) {
  const pg = usePaged(people, 25);
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
    <div className="overflow-x-auto scrollbar-thin">
      <table className="border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-[var(--th-bg)]">
            <th className="sticky left-0 z-10 min-w-52 border-b border-r border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-left font-semibold text-[var(--muted)]">Employee</th>
            {days.map((d) => { const dt = new Date(`${d}T00:00:00`); return <th key={d} className={cx("border-b border-[var(--line)] px-0.5 py-1 text-center font-semibold", [0, 6].includes(dt.getDay()) ? "text-[var(--muted)]/60" : "text-[var(--muted)]")}><div className="text-[10.5px] font-medium">{dt.toLocaleDateString(undefined, { weekday: "narrow" })}</div>{dt.getDate()}</th>; })}
            {["P", "A", "L", "W"].map((h) => <th key={h} className="border-b border-l border-[var(--line)] px-2 text-center font-semibold text-[var(--muted)]">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {pg.rows.map((p) => (
            <tr key={p.user_id} className="hover:bg-[var(--bg)]/50">
              <td className="sticky left-0 z-10 border-b border-r border-[var(--line)] bg-[var(--card)] px-3 py-1.5">
                <Link to={`/people/${p.user_id}?tab=attendance`} className="font-semibold hover:underline">{p.name}</Link>
                <div className="text-[11.5px] text-[var(--muted)]">{[p.employee_code, p.team_name].filter(Boolean).join(" · ")}</div>
              </td>
              {p.days.map((c: any) => (
                <td key={c.date} className="border-b border-[var(--line)] p-[2px]">
                  <span title={tip(c)} className={cx("grid size-[26px] place-items-center rounded text-[11px] font-bold", ATT[c.status]?.cls)}>{ATT[c.status]?.short}</span>
                </td>
              ))}
              <td className="border-b border-l border-[var(--line)] px-2 text-center font-semibold tabnum">{p.present_days}</td>
              <td className="border-b border-[var(--line)] px-2 text-center font-semibold tabnum text-[#9c3a19]">{p.absent_days}</td>
              <td className="border-b border-[var(--line)] px-2 text-center font-semibold tabnum">{p.leave_days}</td>
              <td className="border-b border-[var(--line)] px-2 text-center font-semibold tabnum">{p.wfh_days}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {people.length > 10 && <div className="border-t border-[var(--line)]"><Pager {...pg} noun="people" /></div>}
    </div>
  );
}

/** One person's month as a calendar. */
export function MonthCalendar({ days, weekStartsOn = 1 }: { days: any[]; weekStartsOn?: number }) {
  if (!days.length) return null;
  const first = new Date(`${days[0].date}T00:00:00`);
  const pad = (first.getDay() - weekStartsOn + 7) % 7;
  const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + ((i + weekStartsOn) % 7)).toLocaleDateString(undefined, { weekday: "short" }));
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-[12px] font-semibold text-[var(--muted)]">{names.map((n) => <div key={n}>{n}</div>)}</div>
      <div className="mt-1.5 grid grid-cols-7 gap-1.5">
        {Array.from({ length: pad }).map((_, i) => <div key={`p${i}`} />)}
        {days.map((c) => (
          <div key={c.date} title={tip(c)} className={cx("min-h-16 rounded-lg p-1.5 text-left", ATT[c.status]?.cls)}>
            <div className="flex items-center justify-between text-[12px] font-bold"><span>{new Date(`${c.date}T00:00:00`).getDate()}</span><span>{ATT[c.status]?.short}</span></div>
            {c.logged > 0 && <div className="mt-1 text-[11.5px] font-semibold tabnum">{formatMinutes(c.logged)}</div>}
            {(c.leave || c.holiday) && <div className="mt-0.5 truncate text-[10.5px]">{c.leave ?? c.holiday}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The standard hour cards for a person or team (expected, logged, billable, in-house, no work, leave, unfilled, utilization). */
export function HourCards({ s, extra }: { s: any; extra?: ReactNode }) {
  if (!s) return null;
  const minor: [string, number, string?][] = [
    ["Leave", s.leave ?? 0], ["Holidays", s.holiday ?? 0], ["Offline", s.offline ?? 0], ["Filled late", s.backdated ?? 0],
    ["Refunded", s.refunded ?? 0, "Hours on invoices that were refunded to the client."], ["Invoice cancelled", s.cancelled ?? 0, "Hours that were on a cancelled invoice and haven't been billed again yet."],
  ];
  return (
    <Card className="mb-6" title="Hours in these dates" sub={`${s.working_days ?? 0} working days`}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Expected hours" value={hrs(s.expected)} sub="After holidays and leave" />
        <Stat label="Logged hours" value={hrs(s.logged)} sub={`${hrs(s.approved)} approved, ${hrs(s.pending)} waiting`} />
        <Stat label="Utilization" value={s.utilization == null ? "—" : `${s.utilization}%`} tone={s.utilization == null ? "brand" : s.utilization >= 75 ? "paid" : s.utilization >= 50 ? "amber" : "late"} sub="Approved billable ÷ expected" />
        <Stat label="Unfilled" value={hrs(s.unfilled)} tone={s.unfilled > 0 ? "late" : "paid"} sub={`${s.unfilled_days?.length ?? s.unfilled_sheets ?? 0} day(s) without a sheet`} />
      </div>
      <div className="mt-5">
        <p className="mb-2.5 text-[13px] font-semibold">Approved hours by kind of work</p>
        <SplitBar format={hrs} parts={[...CATS.map((c) => ({ key: c.key, label: c.label, value: s[c.key] ?? 0, color: c.color })), { key: "pending", label: "Waiting for approval", value: s.pending ?? 0, color: "var(--series-4)" }]} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
        {minor.map(([label, v, tip]) => (
          <div key={label} className="bg-[var(--card)] px-3.5 py-2.5" title={tip}>
            <div className="text-[12px] font-medium text-[var(--muted)]">{label}</div>
            <div className={cx("mt-0.5 text-[15px] font-bold tabnum", v > 0 && label === "Refunded" && "text-[#b4441f] dark:text-[#f3a98c]", v > 0 && label === "Invoice cancelled" && "text-[#8a5300] dark:text-[#f0a531]")}>{hrs(v)}</div>
          </div>
        ))}
      </div>
      {extra}
    </Card>
  );
}
