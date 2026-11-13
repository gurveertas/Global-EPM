import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { formatMinutes } from "@eszy/shared";
import { download, get, qs } from "../lib/api";
import { useSession } from "../lib/session";
import { opts, pct, useClients, useDepartments, useList, useProjects, useTeams, useUsers, userOpts } from "../lib/hooks";
import { BarChart, CATS, RankList, SplitBar } from "../components/Charts";
import { AttendanceGrid, AttendanceLegend, HourCards } from "../components/Timesheets";
import {
  Button, Card, Checkbox, Combobox, DataTable, DateRange, ErrorNote, Input, PageHeader, Pill, Progress, Segmented, Select, Spinner, Stat, StatGrid, Tabs, fmtDate, hrs, iso, useRange, type Column, type Range,
} from "../components/ui";
import { EntriesTable } from "./EmployeeDetail";
import { LeaveReporting, TimesheetManager } from "./ReportingExtra";

export function Reporting() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const money = can("money.view");
  const tabs = [
    { id: "teams", label: "Team reporting" }, { id: "leave", label: "Leave reporting" }, { id: "sheets", label: "Sheet reporting" },
    { id: "timesheets", label: "Timesheets" }, { id: "attendance", label: "Attendance" }, { id: "unfilled", label: "Unfilled sheets" },
    { id: "hours", label: "Hours and payments", hide: !money }, { id: "revenue", label: "Revenue", hide: !money }, { id: "receivables", label: "Money owed", hide: !money },
    { id: "exports", label: "Exports", hide: !can("import_export") },
  ];
  const raw = params.get("tab") ?? "teams";
  const tab = raw === "master" ? "timesheets" : raw;
  return (
    <>
      <PageHeader title="Reporting" sub="Working hours, utilization and attendance for teams and people, plus billing reports. Click any team or person to drill down." />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={tabs} />
      {tab === "teams" && <TeamReporting />}
      {tab === "sheets" && <SheetReporting />}
      {tab === "attendance" && <Attendance />}
      {tab === "unfilled" && <Unfilled />}
      {tab === "timesheets" && <TimesheetManager />}
      {tab === "leave" && <LeaveReporting />}
      {tab === "hours" && <HoursPayments />}
      {tab === "revenue" && <Revenue />}
      {tab === "receivables" && <Receivables />}
      {tab === "exports" && <Exports />}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ shared filters
function ScopeFilters({ range, setRange, team, setTeam, dept, setDept, extra }: { range: Range; setRange: (r: Range) => void; team: string; setTeam: (v: string) => void; dept: string; setDept: (v: string) => void; extra?: React.ReactNode }) {
  const teams = useTeams();
  const depts = useDepartments();
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <DateRange value={range} onChange={setRange} />
      <Select value={team} onChange={(e) => setTeam(e.target.value)} className="w-40" aria-label="Team"><option value="">All teams</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
      <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-44" aria-label="Department"><option value="">All departments</option>{depts.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
      {extra}
    </div>
  );
}
const utilTone = (u: number | null) => (u == null ? "brand" : u >= 75 ? "paid" : u >= 50 ? "amber" : "late");
const Util = ({ v }: { v: number | null }) => (
  <div className="flex min-w-28 items-center gap-2"><span className="w-12 text-right font-semibold tabnum">{pct(v)}</span><div className="flex-1"><Progress pct={v ?? 0} tone={utilTone(v) as any} /></div></div>
);
const personCols = (nav: (s: string) => void): Column<any>[] => [
  { key: "n", header: "Employee", cell: (p) => <><Link to={`/people/${p.user_id}?tab=timesheet`} className="font-semibold hover:underline" onClick={(e) => e.stopPropagation()}>{p.name}</Link><div className="text-[12px] text-[var(--muted)]">{[p.employee_code, p.team_name].filter(Boolean).join(" · ")}</div></>, sort: (p) => p.name, text: (p) => `${p.name} ${p.team_name ?? ""} ${p.employee_code}` },
  { key: "e", header: "Expected", cell: (p) => hrs(p.expected), sort: (p) => p.expected, align: "right", text: (p) => String(p.expected / 60) },
  { key: "l", header: "Logged", cell: (p) => hrs(p.logged), sort: (p) => p.logged, align: "right", text: (p) => String(p.logged / 60) },
  { key: "b", header: "Billable", cell: (p) => hrs(p.billable), sort: (p) => p.billable, align: "right", text: (p) => String(p.billable / 60) },
  { key: "i", header: "In-house", cell: (p) => hrs(p.inhouse), sort: (p) => p.inhouse, align: "right", text: (p) => String(p.inhouse / 60) },
  { key: "w", header: "No work", cell: (p) => hrs(p.no_work), sort: (p) => p.no_work, align: "right", text: (p) => String(p.no_work / 60) },
  { key: "p", header: "Waiting", cell: (p) => hrs(p.pending), sort: (p) => p.pending, align: "right", text: (p) => String(p.pending / 60) },
  { key: "lv", header: "Leave", cell: (p) => hrs(p.leave), sort: (p) => p.leave, align: "right", text: (p) => String(p.leave / 60) },
  { key: "rf", header: "Refunded", cell: (p) => (p.refunded ? <span className="font-semibold text-[#b4441f] dark:text-[#f3a98c]">{hrs(p.refunded)}</span> : "—"), sort: (p) => p.refunded ?? 0, align: "right", text: (p) => String((p.refunded ?? 0) / 60) },
  { key: "cn", header: "Cancelled", cell: (p) => (p.cancelled ? <span className="font-semibold text-[#8a5300] dark:text-[#f0a531]">{hrs(p.cancelled)}</span> : "—"), sort: (p) => p.cancelled ?? 0, align: "right", text: (p) => String((p.cancelled ?? 0) / 60) },
  { key: "u", header: "Unfilled", cell: (p) => (p.unfilled ? <button className="font-semibold text-[#9c3a19] hover:underline tabnum" onClick={(e) => { e.stopPropagation(); nav(`/reports?tab=unfilled`); }}>{hrs(p.unfilled)} <span className="font-normal">({p.unfilled_days.length}d)</span></button> : "—"), sort: (p) => p.unfilled, align: "right", text: (p) => String(p.unfilled / 60) },
  { key: "ut", header: "Utilization", cell: (p) => <Util v={p.utilization} />, sort: (p) => p.utilization ?? -1, text: (p) => String(p.utilization ?? "") },
];

// ------------------------------------------------------------------------------------------------ team reporting
function TeamReporting() {
  const nav = useNavigate();
  const [range, setRange] = useRange("month");
  const [team, setTeam] = useState("");
  const [dept, setDept] = useState("");
  const q = useQuery({ queryKey: ["rep-util", range.from, range.to, team, dept], queryFn: () => get(`/reporting/utilization${qs({ from: range.from, to: range.to, teamId: team, departmentId: dept })}`) });
  const trend = useQuery({ queryKey: ["rep-trend", range.from, range.to, team, dept], queryFn: () => get(`/reporting/trend${qs({ from: range.from, to: range.to, teamId: team, departmentId: dept })}`) });
  const d = q.data;
  return (
    <>
      <ScopeFilters range={range} setRange={setRange} team={team} setTeam={setTeam} dept={dept} setDept={setDept} />
      {q.isLoading || !d ? <Spinner /> : (
        <>
          <HourCards s={d.totals} />
          <Card title="Working hours per day" sub="Expected vs logged, approved and waiting" className="mb-6">
            {trend.data && <BarChart title="" data={trend.data.days.filter((x: any) => x.expected || x.logged)} x={(x) => fmtDate(x.date, { day: "numeric", month: "short" })} height={210}
              series={[{ key: "expected", label: "Expected", color: "var(--series-6)" }, { key: "approved", label: "Approved", color: "var(--series-1)" }, { key: "pending", label: "Waiting", color: "var(--series-4)" }]} format={(v) => formatMinutes(v)} />}
          </Card>
          {!team && (
            <Card title="Teams" sub="Click a team to see its people" className="mb-6" pad={false}>
              <div className="p-5 pt-0">
                <DataTable dateFilter={false} rows={d.teams} rowKey={(t: any) => t.team_id ?? "none"} search={false} onRowClick={(t: any) => t.team_id && setTeam(t.team_id)} exportName="team-reporting"
                  columns={[
                    { key: "n", header: "Team", cell: (t: any) => <><span className="font-semibold">{t.team_name}</span><div className="text-[12px] text-[var(--muted)]">TL: {t.lead_name ?? "—"} · {t.people} people</div></>, sort: (t: any) => t.team_name, text: (t: any) => t.team_name },
                    { key: "e", header: "Expected", cell: (t: any) => hrs(t.expected), align: "right", sort: (t: any) => t.expected, text: (t: any) => String(t.expected / 60) },
                    { key: "l", header: "Actual", cell: (t: any) => hrs(t.logged), align: "right", sort: (t: any) => t.logged, text: (t: any) => String(t.logged / 60) },
                    { key: "s", header: "Split", cell: (t: any) => <div className="w-48"><SplitBar legend={false} height={10} format={hrs} parts={CATS.map((c) => ({ key: c.key, label: c.label, value: t[c.key], color: c.color }))} /></div> },
                    { key: "u", header: "Unfilled sheets", cell: (t: any) => t.unfilled_sheets || "—", align: "right", sort: (t: any) => t.unfilled_sheets, text: (t: any) => String(t.unfilled_sheets) },
                    { key: "f", header: "Filled", cell: (t: any) => pct(t.fill_rate), align: "right", sort: (t: any) => t.fill_rate ?? -1, text: (t: any) => String(t.fill_rate ?? "") },
                    { key: "ut", header: "Utilization", cell: (t: any) => <Util v={t.utilization} />, sort: (t: any) => t.utilization ?? -1, text: (t: any) => String(t.utilization ?? "") },
                  ]} />
              </div>
            </Card>
          )}
          <Card title={team ? `${d.teams[0]?.team_name ?? "Team"}: people` : "People"} actions={team && <Button size="sm" variant="secondary" onClick={() => setTeam("")}>All teams</Button>} pad={false}>
            <div className="p-5 pt-0"><DataTable dateFilter={false} rows={d.people} rowKey={(p: any) => p.user_id} columns={personCols(nav)} exportName="people-reporting" searchPlaceholder="Search people" onRowClick={(p: any) => nav(`/people/${p.user_id}?tab=timesheet`)} /></div>
          </Card>
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ sheet reporting
function SheetReporting() {
  const nav = useNavigate();
  const [range, setRange] = useRange("month");
  const [team, setTeam] = useState("");
  const [dept, setDept] = useState("");
  const q = useQuery({ queryKey: ["rep-util", range.from, range.to, team, dept], queryFn: () => get(`/reporting/utilization${qs({ from: range.from, to: range.to, teamId: team, departmentId: dept })}`) });
  const d = q.data;
  const attention = useMemo(() => (d?.teams ?? []).filter((t: any) => t.expected).map((t: any) => ({ ...t, noWorkShare: t.logged ? (t.no_work / t.logged) * 100 : 0 })).sort((a: any, b: any) => b.noWorkShare - a.noWorkShare || (a.utilization ?? 0) - (b.utilization ?? 0)).slice(0, 4), [d]);
  return (
    <>
      <ScopeFilters range={range} setRange={setRange} team={team} setTeam={setTeam} dept={dept} setDept={setDept} />
      {q.isLoading || !d ? <Spinner /> : (
        <>
          <StatGrid cols={5}>
            <Stat label="Total expected hours" value={hrs(d.totals.expected)} sub={`${d.totals.people} people`} />
            <Stat label="Approved billable" value={hrs(d.totals.billable)} tone="brand" />
            <Stat label="Approved in-house" value={hrs(d.totals.inhouse)} />
            <Stat label="Approved no work" value={hrs(d.totals.no_work)} tone={d.totals.no_work ? "amber" : undefined} />
            <Stat label="Approved leaves" value={hrs(d.totals.leave)} sub={`${d.totals.leave_days} days`} />
            <Stat label="Sheets waiting for approval" value={hrs(d.totals.pending)} onClick={() => nav("/approvals")} />
            <Stat label="Unfilled sheets" value={d.totals.unfilled_sheets} sub={hrs(d.totals.unfilled)} tone={d.totals.unfilled_sheets ? "late" : undefined} onClick={() => nav("/reports?tab=unfilled")} />
            <Stat label="Overall utilization" value={pct(d.totals.utilization)} tone={utilTone(d.totals.utilization) as any} />
            <Stat label="Refunded hours" value={hrs(d.totals.refunded ?? 0)} tone={d.totals.refunded ? "late" : undefined} info="Hours on invoices that were refunded to the client." onClick={() => nav("/reports?tab=timesheets")} />
            <Stat label="Cancelled invoice hours" value={hrs(d.totals.cancelled ?? 0)} tone={d.totals.cancelled ? "amber" : undefined} info="Hours that were on a cancelled invoice and haven't been billed again yet." onClick={() => nav("/reports?tab=timesheets")} />
          </StatGrid>
          <div className="mb-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Card title="Hours by team" sub="Approved hours by kind of work">
              <ul className="grid gap-4">
                {d.teams.map((t: any) => (
                  <li key={t.team_id ?? "none"}>
                    <div className="mb-1.5 flex items-baseline justify-between text-[13.5px]"><button className="font-semibold hover:underline" onClick={() => setTeam(t.team_id ?? "")}>{t.team_name}</button><span className="text-[var(--muted)] tabnum">{hrs(t.approved)} of {hrs(t.expected)} · {pct(t.utilization)}</span></div>
                    <SplitBar legend={false} height={12} format={hrs} parts={[...CATS.map((c) => ({ key: c.key, label: c.label, value: t[c.key], color: c.color })), { key: "u", label: "Unfilled", value: t.unfilled, color: "var(--series-5)" }]} />
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t border-[var(--line)] pt-3"><SplitBar format={hrs} height={0} parts={[...CATS.map((c) => ({ key: c.key, label: c.label, value: d.totals[c.key], color: c.color })), { key: "u", label: "Unfilled", value: d.totals.unfilled, color: "var(--series-5)" }]} /></div>
            </Card>
            <Card title={<span className="inline-flex items-center gap-2"><AlertTriangle className="size-4 text-[#b4441f]" />Teams needing attention</span>} sub="Highest share of no-work hours, then lowest utilization">
              <ul className="grid gap-3">
                {attention.map((t: any) => (
                  <li key={t.team_id ?? "none"} className="rounded-lg border border-[var(--line)] p-3">
                    <div className="flex items-center justify-between"><span className="font-semibold">{t.team_name}</span><Pill status={t.noWorkShare > 15 ? "high" : t.noWorkShare > 5 ? "medium" : "low"}>{Math.round(t.noWorkShare)}% no work</Pill></div>
                    <div className="mt-1 text-[12.5px] text-[var(--muted)]">Utilization {pct(t.utilization)} · {t.unfilled_sheets} unfilled sheet(s) · TL {t.lead_name ?? "—"}</div>
                  </li>
                ))}
                {!attention.length && <li className="py-6 text-center text-[13.5px] text-[var(--muted)]">No teams with expected hours.</li>}
              </ul>
            </Card>
          </div>
          <DataTable dateFilter={false} rows={d.people} rowKey={(p: any) => p.user_id} columns={[...personCols(nav).slice(0, 7), { key: "of", header: "Offline", cell: (p: any) => hrs(p.offline), align: "right", sort: (p: any) => p.offline }, { key: "h", header: "Holiday", cell: (p: any) => hrs(p.holiday), align: "right" }, ...personCols(nav).slice(7)]}
            exportName="sheet-reporting" searchPlaceholder="Search people" onRowClick={(p: any) => nav(`/people/${p.user_id}?tab=timesheet`)} />
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ attendance
function Attendance() {
  const { me } = useSession();
  const [month, setMonth] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); });
  const [team, setTeam] = useState("");
  const [dept, setDept] = useState("");
  const [search, setSearch] = useState("");
  const teams = useTeams();
  const depts = useDepartments();
  const from = iso(month), to = iso(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const q = useQuery({ queryKey: ["rep-att", from, team, dept], queryFn: () => get(`/reporting/attendance${qs({ from, to, teamId: team, departmentId: dept })}`) });
  const days: string[] = []; for (let d = new Date(month); d.getMonth() === month.getMonth(); d.setDate(d.getDate() + 1)) days.push(iso(d));
  const people = (q.data?.people ?? []).filter((p: any) => !search || p.name.toLowerCase().includes(search.toLowerCase()));
  const totals = people.reduce((a: any, p: any) => ({ present: a.present + p.present_days, absent: a.absent + p.absent_days, leave: a.leave + p.leave_days, wfh: a.wfh + p.wfh_days }), { present: 0, absent: 0, leave: 0, wfh: 0 });
  void me;
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></Button>
        <span className="min-w-36 text-center text-[15px] font-bold">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <Button variant="secondary" size="sm" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></Button>
        <Select value={team} onChange={(e) => setTeam(e.target.value)} className="w-40" aria-label="Team"><option value="">All teams</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-44" aria-label="Department"><option value="">All departments</option>{depts.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee" className="w-52" />
      </div>
      {q.isLoading || !q.data ? <Spinner /> : (
        <>
          <StatGrid cols={4}>
            <Stat label="Present days" value={totals.present} tone="paid" />
            <Stat label="Absent / no sheet" value={totals.absent} tone={totals.absent ? "late" : undefined} />
            <Stat label="Leave days" value={totals.leave} />
            <Stat label="Work from home days" value={totals.wfh} />
          </StatGrid>
          <div className="mb-3"><AttendanceLegend /></div>
          <AttendanceGrid days={days} people={people} />
          {q.data.events.length > 0 && <p className="mt-3 text-[13px] text-[var(--muted)]">Events this month: {q.data.events.map((e: any) => `${e.title} (${fmtDate(e.start_date, { day: "numeric", month: "short" })})`).join(", ")}</p>}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ unfilled
function Unfilled() {
  const [range, setRange] = useRange("month");
  const [team, setTeam] = useState("");
  const [dept, setDept] = useState("");
  const [view, setView] = useState<"days" | "people">("days");
  const q = useQuery({ queryKey: ["rep-unfilled", range.from, range.to, team, dept], queryFn: () => get(`/reporting/unfilled${qs({ from: range.from, to: range.to, teamId: team, departmentId: dept })}`) });
  return (
    <>
      <ScopeFilters range={range} setRange={setRange} team={team} setTeam={setTeam} dept={dept} setDept={setDept} extra={<Segmented value={view} onChange={setView} options={[{ id: "days", label: "Each day" }, { id: "people", label: "By person" }]} />} />
      {q.isLoading || !q.data ? <Spinner /> : (
        <>
          <StatGrid cols={3}>
            <Stat label="Unfilled sheets" value={q.data.rows.length} tone={q.data.rows.length ? "late" : "paid"} />
            <Stat label="Missing hours" value={hrs(q.data.rows.reduce((a: number, r: any) => a + r.missing, 0))} />
            <Stat label="People with gaps" value={q.data.people.length} />
          </StatGrid>
          {view === "days" ? (
            <DataTable dateFilter={false} rows={q.data.rows} rowKey={(r: any) => `${r.user_id}${r.date}`} exportName="unfilled-sheets" searchPlaceholder="Search employee, TL, team" empty="Everyone has submitted their sheets."
              columns={[
                { key: "d", header: "Date", cell: (r: any) => fmtDate(r.date, { weekday: "short", day: "numeric", month: "short" }), sort: (r: any) => r.date, text: (r: any) => r.date },
                { key: "n", header: "Employee", cell: (r: any) => <Link to={`/people/${r.user_id}?tab=attendance`} className="font-semibold hover:underline">{r.name}</Link>, sort: (r: any) => r.name, text: (r: any) => r.name },
                { key: "tl", header: "TL / reporting manager", cell: (r: any) => r.lead_name ?? "—", sort: (r: any) => r.lead_name ?? "", text: (r: any) => r.lead_name ?? "" },
                { key: "t", header: "Team", cell: (r: any) => r.team_name ?? "—", sort: (r: any) => r.team_name ?? "", text: (r: any) => r.team_name ?? "" },
                { key: "dp", header: "Department", cell: (r: any) => r.department_name ?? "—", text: (r: any) => r.department_name ?? "" },
                { key: "s", header: "Sheet", cell: (r: any) => <Pill status={r.sheet ?? "none"}>{r.sheet === "draft" ? "Saved, not submitted" : r.sheet === "rejected" ? "Sent back" : "Not filled"}</Pill>, text: (r: any) => r.sheet ?? "none" },
                { key: "m", header: "Missing", cell: (r: any) => <span className="font-semibold text-[#9c3a19]">{hrs(r.missing)}</span>, align: "right", sort: (r: any) => r.missing, text: (r: any) => String(r.missing / 60) },
              ]} />
          ) : (
            <DataTable dateFilter={false} rows={q.data.people} rowKey={(r: any) => r.user_id} exportName="unfilled-by-person" empty="Everyone has submitted their sheets."
              columns={[
                { key: "n", header: "Employee", cell: (r: any) => <Link to={`/people/${r.user_id}?tab=attendance`} className="font-semibold hover:underline">{r.name}</Link>, sort: (r: any) => r.name, text: (r: any) => r.name },
                { key: "tl", header: "TL / reporting manager", cell: (r: any) => r.lead_name ?? "—", text: (r: any) => r.lead_name ?? "" },
                { key: "t", header: "Team", cell: (r: any) => r.team_name ?? "—", text: (r: any) => r.team_name ?? "" },
                { key: "d", header: "Days", cell: (r: any) => r.days, align: "right", sort: (r: any) => r.days, text: (r: any) => String(r.days) },
                { key: "m", header: "Missing hours", cell: (r: any) => hrs(r.missing), align: "right", sort: (r: any) => r.missing, text: (r: any) => String(r.missing / 60) },
              ]} />
          )}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ master report
// ------------------------------------------------------------------------------------------------ billing reports (moved from the old Reports page)
function HoursPayments() {
  const [range, setRange] = useRange("month");
  const q = useQuery({ queryKey: ["rep-hours", range.from, range.to], queryFn: () => get<any[]>(`/reports/hours${qs({ from: range.from, to: range.to })}`) });
  const status = { Paid: "paid", "Partially paid": "partially_paid", Unpaid: "unpaid", Refunded: "refunded", "Non-billable": "draft", "Not approved": "pending", "Not invoiced yet": "none" } as Record<string, string>;
  const by = (k: string) => (q.data ?? []).filter((h) => h.payment_status === k).reduce((a, h) => a + h.minutes, 0);
  return (
    <>
      <div className="mb-5"><DateRange value={range} onChange={setRange} /></div>
      <p className="mb-4 text-[13.5px] text-[var(--muted)]">Each hour's payment status comes from the invoice it's on. Hours on a line at 0 are non-billable.</p>
      <StatGrid cols={5}>
        <Stat label="Paid" value={hrs(by("Paid"))} tone="paid" /><Stat label="Unpaid or part-paid" value={hrs(by("Unpaid") + by("Partially paid"))} tone="amber" />
        <Stat label="Not invoiced yet" value={hrs(by("Not invoiced yet"))} /><Stat label="Not approved" value={hrs(by("Not approved"))} /><Stat label="Non-billable" value={hrs(by("Non-billable"))} />
      </StatGrid>
      <DataTable dateFilter={false} rows={q.data} loading={q.isLoading} rowKey={(h: any) => `${h.date}${h.user_name}${h.project_name}${h.minutes}${h.billing_line}${h.description}`} exportName="hours-payment-status" searchPlaceholder="Search person, project, invoice" pageSize={50}
        columns={[
          { key: "d", header: "Date", cell: (h: any) => fmtDate(h.date), sort: (h: any) => h.date, text: (h: any) => h.date },
          { key: "u", header: "Person", cell: (h: any) => h.user_name, sort: (h: any) => h.user_name, text: (h: any) => h.user_name },
          { key: "p", header: "Project", cell: (h: any) => h.project_name, sort: (h: any) => h.project_name, text: (h: any) => h.project_name },
          { key: "h", header: "Hours", cell: (h: any) => hrs(h.minutes), align: "right", sort: (h: any) => h.minutes, text: (h: any) => String(h.minutes / 60) },
          { key: "l", header: "Billing line", cell: (h: any) => h.billing_line ?? "—", text: (h: any) => h.billing_line ?? "" },
          { key: "i", header: "Invoice", cell: (h: any) => h.invoice_number ?? "—", text: (h: any) => h.invoice_number ?? "" },
          { key: "s", header: "Payment status", cell: (h: any) => <Pill status={status[h.payment_status] ?? "none"}>{h.payment_status}</Pill>, sort: (h: any) => h.payment_status, text: (h: any) => h.payment_status },
        ]} />
    </>
  );
}
function Revenue() {
  const { money } = useSession();
  const q = useQuery({ queryKey: ["rep-revenue"], queryFn: () => get<any[]>("/reports/revenue") });
  const rows = [...(q.data ?? [])].reverse();
  return q.isLoading ? <Spinner /> : (
    <>
      <Card title="Invoiced and collected by month" className="mb-5">
        <BarChart title="" data={rows} x={(r) => new Date(`${r.month}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "2-digit" })} height={220}
          series={[{ key: "invoiced_minor", label: "Invoiced (before tax)", color: "var(--series-1)" }, { key: "collected_minor", label: "Collected", color: "var(--series-2)" }]} format={(v) => money(v)} />
      </Card>
      <DataTable dateFilter={false} rows={q.data} rowKey={(r: any) => r.month} search={false} exportName="revenue-by-month"
        columns={[
          { key: "m", header: "Month", cell: (r: any) => <span className="font-semibold">{new Date(`${r.month}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>, sort: (r: any) => r.month, text: (r: any) => r.month },
          { key: "i", header: "Invoiced (before tax)", cell: (r: any) => money(r.invoiced_minor), align: "right", text: (r: any) => String(Number(r.invoiced_minor ?? 0) / 100) },
          { key: "t", header: "Tax", cell: (r: any) => money(r.tax_minor), align: "right", text: (r: any) => String(Number(r.tax_minor ?? 0) / 100) },
          { key: "c", header: "Collected", cell: (r: any) => money(r.collected_minor), align: "right", text: (r: any) => String(Number(r.collected_minor ?? 0) / 100) },
          { key: "r", header: "Refunded", cell: (r: any) => money(r.refunded_minor), align: "right", text: (r: any) => String(Number(r.refunded_minor ?? 0) / 100) },
          { key: "n", header: "Invoices", cell: (r: any) => r.invoices, align: "right", text: (r: any) => String(r.invoices) },
        ]} />
    </>
  );
}
function Receivables() {
  const { money } = useSession();
  const q = useQuery({ queryKey: ["rep-recv"], queryFn: () => get("/reports/receivables") });
  if (q.isLoading || !q.data) return <Spinner />;
  const b = q.data.buckets;
  return (
    <>
      <StatGrid cols={5}>
        <Stat label="Not yet due" value={money(b.current)} /><Stat label="1–30 days late" value={money(b.d1_30)} tone="amber" />
        <Stat label="31–60 days late" value={money(b.d31_60)} tone="late" /><Stat label="61–90 days late" value={money(b.d61_90)} tone="late" /><Stat label="Over 90 days" value={money(b.d90_plus)} tone="late" />
      </StatGrid>
      <DataTable dateFilter={false} rows={q.data.invoices} rowKey={(i: any) => i.id} rowHref={(i: any) => `/invoices/${i.id}`} exportName="money-owed"
        columns={[
          { key: "n", header: "Invoice", cell: (i: any) => i.number, sort: (i: any) => i.number, text: (i: any) => i.number },
          { key: "c", header: "Client", cell: (i: any) => i.client_name, sort: (i: any) => i.client_name, text: (i: any) => i.client_name },
          { key: "p", header: "Project", cell: (i: any) => i.project_name, text: (i: any) => i.project_name },
          { key: "d", header: "Due", cell: (i: any) => fmtDate(i.due_date), sort: (i: any) => i.due_date, text: (i: any) => i.due_date },
          { key: "o", header: "Outstanding", cell: (i: any) => money(i.total_minor - i.paid_minor), align: "right", sort: (i: any) => i.total_minor - i.paid_minor, text: (i: any) => String((i.total_minor - i.paid_minor) / 100) },
          { key: "s", header: "Status", cell: (i: any) => <Pill status={i.display_status} />, sort: (i: any) => i.display_status, text: (i: any) => i.display_status },
        ]} />
    </>
  );
}
export function Exports() {
  const { can } = useSession();
  const lists = [["users", "Employees"], ["clients", "Clients"], ["projects", "Projects"], ["leads", "Leads"], ["time", "Time entries"], ["holidays", "Holidays"], ...(can("invoices.view") ? [["invoices", "Invoices"]] : []), ...(can("money.view") ? [["billing_lines", "Billing lines"], ["payments", "Payments"]] : [])];
  return (
    <Card title="Download your data" sub="Any list as CSV or Excel, or everything as one JSON file.">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {lists.map(([k, label]) => (
          <div key={k} className="flex items-center justify-between rounded-lg border border-[var(--line)] px-4 py-3">
            <span className="font-semibold">{label}</span>
            <span className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => download(`/export/${k}.csv`, `${k}.csv`)}>CSV</Button><Button size="sm" variant="secondary" onClick={() => download(`/export/${k}.xlsx`, `${k}.xlsx`)}>Excel</Button></span>
          </div>
        ))}
      </div>
      {can("money.view") && <Button className="mt-4" onClick={() => download("/export/all", "eszy-export.json")}>Download everything (JSON)</Button>}
    </Card>
  );
}
