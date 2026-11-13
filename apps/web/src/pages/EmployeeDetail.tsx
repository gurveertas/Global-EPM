import { ActivityLog } from "../components/ActivityLog";
import { DeactivateButton } from "../components/Deactivate";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Wallet, Mail, Pencil, Phone, ShieldCheck } from "lucide-react";
import { AccessEditor } from "../components/AccessEditor";
import { RoleReport } from "./RoleReport";
import { formatMinutes } from "@eszy/shared";
import { get, qs } from "../lib/api";
import { useSession } from "../lib/session";
import { EMPLOYMENT } from "../lib/hooks";
import { BarChart, RankList, CATS, SplitBar } from "../components/Charts";
import { Avatar } from "../components/Avatar";
import { AttendanceLegend, HourCards, MonthCalendar } from "../components/Timesheets";
import { Button, Card, DataTable, LinkButton, DateRange, DetailList, PageHeader, Pill, Spinner, Stat, Tabs, fmtDate, hrs, plainText, rangeFor, useRange } from "../components/ui";
import { EmployeeForm } from "./People";

export function EmployeeDetail() {
  const { id } = useParams();
  const { can, me, money } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const [range, setRange] = useRange("month");
  const [edit, setEdit] = useState(false);
  const [access, setAccess] = useState(false);
  const q = useQuery({ queryKey: ["employee", id, range.from, range.to], queryFn: () => get(`/users/${id}/overview${qs({ from: range.from, to: range.to })}`) });
  const full = useQuery({ queryKey: ["user", id], queryFn: () => get(`/users/${id}`), enabled: can("users.view") });
  const [month, setMonth] = useState(() => rangeFor("month"));
  const att = useQuery({ queryKey: ["employee-att", id, month.from], queryFn: () => get(`/reporting/person/${id}${qs({ from: month.from, to: month.to })}`), enabled: tab === "attendance" });
  const sheets = useQuery({ queryKey: ["employee-entries", id, range.from, range.to], queryFn: () => get(`/reporting/person/${id}${qs({ from: range.from, to: range.to })}`), enabled: tab === "timesheet" });
  if (q.isLoading || !q.data) return <Spinner />;
  const d = q.data;
  const u = d.user;
  const emp = EMPLOYMENT.find((x) => x.id === u.employment_status)?.label;
  const byStatus = (s: string) => d.projects.filter((p: any) => p.status === s).length;
  const shiftMonth = (n: number) => { const f = new Date(`${month.from}T00:00:00`); f.setMonth(f.getMonth() + n); const t = new Date(f.getFullYear(), f.getMonth() + 1, 0); const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; setMonth({ from: iso(f), to: iso(t) }); };

  return (
    <>
      <PageHeader back={{ to: "/people", label: "Employees" }}
        title={<span className="flex items-center gap-3"><Avatar id={u.id} name={u.name} hasPhoto={u.has_photo} size={44} /><span>{u.name}</span></span>}
        meta={<>
          {u.employee_code && <span className="font-semibold text-[var(--text)]">{u.employee_code}</span>}
          {u.designation && <span>{u.designation}</span>}
          <Pill status={u.employment_status}>{emp}</Pill>
          {u.status !== "active" && <Pill status={u.status} />}
          {u.team_name && <span>Team: <b className="text-[var(--text)]">{u.team_name}</b></span>}
          {u.reporting_manager_name && <span>Reports to <b className="text-[var(--text)]">{u.reporting_manager_name}</b></span>}
        </>}
        actions={<>
          <a href={`mailto:${u.email}`}><Button variant="secondary" size="sm"><Mail />Email</Button></a>
          {u.phone && <a href={`tel:${u.phone}`}><Button variant="secondary" size="sm"><Phone />Call</Button></a>}
          {can("roles.manage") && <Button variant="secondary" size="sm" onClick={() => setAccess(true)}><ShieldCheck />Permissions</Button>}
          {(can("projects.assign") || can("users.manage")) && u.status !== "disabled" && <LinkButton size="sm" to={`/handover?from=${u.id}`}><ArrowLeftRight />Hand over</LinkButton>}
          {can("users.manage") && <DeactivateButton user={u} />}
          {can("users.manage") && <Button size="sm" onClick={() => setEdit(true)}><Pencil />Edit</Button>}
        </>} />
      {u.status === "disabled" && <div className="mb-5 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-4 py-3 text-[13.5px] text-[var(--muted)]"><b className="text-[var(--text)]">Deactivated</b>{u.last_working_day ? ` · last working day ${fmtDate(u.last_working_day)}` : ""}{u.deactivated_reason ? ` · ${u.deactivated_reason}` : ""}. They can't sign in. Their history is kept.</div>}
      <AccessEditor userId={u.id} open={access} onClose={() => setAccess(false)} />

      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { id: "overview", label: "Overview" }, { id: "projects", label: "Projects", count: d.projects.length }, { id: "timesheet", label: "Timesheet" },
        { id: "attendance", label: "Attendance" }, { id: "leave", label: "Leave and WFH", count: d.leaves.length }, { id: "profile", label: "Profile" },
        { id: "accessories", label: "Accessories", count: d.assets.length },
        { id: "activity", label: "Activity" },
      ]} />
      {tab === "activity" && <ActivityLog entity="user" id={u.id} />}

      {(tab === "overview" || tab === "timesheet") && <div className="mb-4 flex justify-end"><DateRange value={range} onChange={setRange} /></div>}

      {tab === "overview" && (
        <>
          {d.rate && <RateStrip rate={d.rate} />}
          <RoleReport userId={u.id} from={range.from} to={range.to} />
          {d.stats ? <HourCards s={d.stats} /> : <p className="mb-6 text-[var(--muted)]">This person doesn't fill timesheets.</p>}
          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Project overview" className="lg:col-span-1">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Total" value={d.projects.length} />
                <Stat label="Active" value={byStatus("active")} tone="paid" />
                <Stat label="Paused" value={byStatus("paused")} />
              </div>
              <div className="mt-4"><RankList format={hrs} rows={d.projects.filter((p: any) => p.period_minutes).map((p: any) => ({ key: p.id, label: <Link to={`/projects/${p.id}`} className="hover:underline">{p.name}</Link>, value: p.period_minutes }))} empty="No hours on projects in these dates." /></div>
            </Card>
            <Card title="Activity distribution" sub="Hours by work type in these dates" className="lg:col-span-1">
              <RankList format={hrs} color="var(--series-2)" rows={Object.values(d.activity.reduce((m: any, a: any) => { m[a.activity] ??= { key: a.activity, label: a.activity, value: 0, sub: CATS.find((c) => c.key === a.category)?.label }; m[a.activity].value += a.minutes; return m; }, {})).sort((a: any, b: any) => b.value - a.value) as any} />
            </Card>
            <Card title="Billable vs other hours" sub="Last 6 months" className="lg:col-span-1">
              <BarChart title="" data={d.months.map((m: any) => ({ ...m, other: m.minutes - (m.billable ?? 0) }))} x={(m) => new Date(`${m.month}-01T00:00:00`).toLocaleDateString(undefined, { month: "short" })} stacked
                series={[{ key: "billable", label: "Billable", color: "var(--series-1)" }, { key: "other", label: "In-house and no work", color: "var(--series-2)" }]} format={(v) => formatMinutes(v)} height={200} />
            </Card>
            <Card title="Leave this year" className="lg:col-span-2">
              <div className="grid gap-3 sm:grid-cols-4">
                <Stat label="Applied" value={d.leaves.length} />
                <Stat label="Approved" value={d.leaves.filter((l: any) => l.status === "approved").length} tone="paid" />
                <Stat label="Pending" value={d.leaves.filter((l: any) => l.status === "pending").length} tone="amber" />
                <Stat label="Rejected" value={d.leaves.filter((l: any) => l.status === "rejected").length} />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {d.balances.map((b: any) => {
                  const left = Number(b.credited_days) + Number(b.carried_days) - Number(b.used_days);
                  return <div key={b.name} className="rounded-lg border border-[var(--line)] p-3"><div className="text-[12.5px] text-[var(--muted)]">{b.name}</div><div className="mt-0.5 text-[18px] font-bold tabnum">{left} <span className="text-[13px] font-medium text-[var(--muted)]">of {Number(b.credited_days) + Number(b.carried_days)} days left</span></div></div>;
                })}
              </div>
            </Card>
            <Card title="Details">
              <DetailList cols={1} items={[["Email", u.email], ["Phone", u.phone], ["Joined", fmtDate(u.joined_on)], ["Department", u.department_name], ["Roles", u.roles.map((r: any) => r.name).join(", ")], ["Last sign-in", u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"]]} />
            </Card>
          </div>
        </>
      )}

      {tab === "projects" && (
        <DataTable dateFilter={false} rows={d.projects} rowKey={(p: any) => p.id} rowHref={(p: any) => `/projects/${p.id}`} exportName={`${u.name}-projects`}
          columns={[
            { key: "n", header: "Project", cell: (p: any) => p.name, sort: (p: any) => p.name, text: (p: any) => `${p.name} ${p.client_name}` },
            { key: "c", header: "Client", cell: (p: any) => p.client_name, sort: (p: any) => p.client_name },
            { key: "r", header: "Role", cell: (p: any) => (p.role === "pm" ? "Project Manager" : p.role === "tl" ? "Team Lead" : "Member"), sort: (p: any) => p.role },
            { key: "s", header: "Status", cell: (p: any) => <Pill status={p.status} />, sort: (p: any) => p.status },
            { key: "h", header: "Hours (all time)", cell: (p: any) => hrs(p.logged_minutes), sort: (p: any) => p.logged_minutes, align: "right" },
            { key: "t", header: "Open tasks", cell: (p: any) => p.open_tasks, sort: (p: any) => p.open_tasks, align: "right" },
            { key: "l", header: "Last worked", cell: (p: any) => fmtDate(p.last_on), sort: (p: any) => p.last_on ?? "" },
          ]} />
      )}

      {tab === "timesheet" && (sheets.isLoading || !sheets.data ? <Spinner /> : (
        <>
          <div className="mb-5 grid gap-5 lg:grid-cols-2">
            <Card title="By work type" sub="All hours logged in these dates"><RankList format={hrs} color="var(--series-2)" rows={sheets.data.byActivity.map((a: any) => ({ key: a.activity, label: a.activity, value: a.minutes }))} /></Card>
            <Card title="Kind of work" sub="Share of the hours logged">
              <SplitBar format={hrs} parts={CATS.map((c) => ({ key: c.key, label: c.label, value: sheets.data.byProject.reduce((a: number, p: any) => a + (p[c.key] ?? 0), 0), color: c.color }))} />
            </Card>
          </div>
          <div className="mb-5">
            <DataTable dateFilter={false} title="By project" rows={sheets.data.byProject} rowKey={(p: any) => p.project_id} rowHref={(p: any) => `/projects/${p.project_id}`} search={false} exportName={`${u.name}-by-project`} empty="No hours on projects in these dates."
              footer={<tr><td>Total</td>{(["minutes", "billable", "inhouse", "no_work", "approved", "refunded", "cancelled"] as const).map((k) => <td key={k} className="text-right tabnum">{hrs(sheets.data.byProject.reduce((a: number, p: any) => a + (p[k] ?? 0), 0))}</td>)}</tr>}
              columns={[
                { key: "p", header: "Project", cell: (p: any) => <>{p.project_name}<div className="text-[12.5px] font-normal text-[var(--muted)]">{p.client_name}</div></>, sort: (p: any) => p.project_name, text: (p: any) => `${p.project_name} ${p.client_name ?? ""}`, filter: false },
                { key: "m", header: "Logged", cell: (p: any) => <b>{hrs(p.minutes)}</b>, sort: (p: any) => p.minutes, align: "right" },
                { key: "b", header: "Billable", cell: (p: any) => hrs(p.billable), sort: (p: any) => p.billable, align: "right" },
                { key: "i", header: "In-house", cell: (p: any) => hrs(p.inhouse), sort: (p: any) => p.inhouse, align: "right" },
                { key: "n", header: "No work", cell: (p: any) => hrs(p.no_work), sort: (p: any) => p.no_work, align: "right" },
                { key: "a", header: "Approved", cell: (p: any) => hrs(p.approved), sort: (p: any) => p.approved, align: "right" },
                { key: "r", header: "Refunded", cell: (p: any) => <span className={p.refunded ? "font-semibold text-[#b4441f] dark:text-[#f3a98c]" : "text-[var(--muted)]"}>{hrs(p.refunded)}</span>, sort: (p: any) => p.refunded, align: "right" },
                { key: "c", header: "Cancelled", cell: (p: any) => <span className={p.cancelled ? "font-semibold text-[#8a5300] dark:text-[#f0a531]" : "text-[var(--muted)]"}>{hrs(p.cancelled)}</span>, sort: (p: any) => p.cancelled, align: "right" },
              ]} />
          </div>
          <EntriesTable rows={sheets.data.entries} name={`${u.name}-timesheet`} />
        </>
      ))}

      {tab === "attendance" && (
        <Card title={new Date(`${month.from}T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          actions={<><Button size="sm" variant="secondary" onClick={() => shiftMonth(-1)}>Previous month</Button><Button size="sm" variant="secondary" onClick={() => shiftMonth(1)}>Next month</Button></>}>
          {att.isLoading || !att.data ? <Spinner /> : (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-5">
                <Stat label="Present" value={att.data.stats.present_days} tone="paid" />
                <Stat label="Absent / no sheet" value={att.data.stats.absent_days} tone={att.data.stats.absent_days ? "late" : undefined} />
                <Stat label="Leave days" value={att.data.stats.leave_days} />
                <Stat label="WFH days" value={att.data.stats.wfh_days} />
                <Stat label="Logged" value={hrs(att.data.stats.logged)} sub={`of ${hrs(att.data.stats.expected)}`} />
              </div>
              <MonthCalendar days={att.data.stats.days} weekStartsOn={me!.settings.locale.weekStartsOn} />
              <div className="mt-4"><AttendanceLegend /></div>
            </>
          )}
        </Card>
      )}

      {tab === "leave" && (
        <div className="grid gap-5">
          <DataTable dateFilter={false} rows={d.leaves} rowKey={(l: any) => l.id} exportName={`${u.name}-leave`} searchPlaceholder="Search leave"
            columns={[
              { key: "d", header: "Dates", cell: (l: any) => <>{fmtDate(l.start_date)}{l.end_date !== l.start_date && ` – ${fmtDate(l.end_date)}`}</>, sort: (l: any) => l.start_date, text: (l: any) => l.start_date },
              { key: "t", header: "Type", cell: (l: any) => <>{l.leave_type}<div className="text-[12.5px] text-[var(--muted)]">{partLabel(l)}</div></>, sort: (l: any) => l.leave_type, text: (l: any) => l.leave_type },
              { key: "n", header: "Days", cell: (l: any) => <>{Number(l.days)}{Number(l.unpaid_days) > 0 && <div className="text-[12.5px] text-[#9c3a19]">{Number(l.unpaid_days)} unpaid</div>}</>, sort: (l: any) => Number(l.days), align: "right" },
              { key: "r", header: "Reason", cell: (l: any) => l.reason || "—", text: (l: any) => l.reason },
              { key: "s", header: "Status", cell: (l: any) => <Pill status={l.status} />, sort: (l: any) => l.status, text: (l: any) => l.status },
            ]} />
          <Card title="Work from home">
            <DataTable dateFilter={false} rows={d.wfh} rowKey={(w: any) => w.id} search={false} empty="No WFH requests."
              columns={[
                { key: "d", header: "Date", cell: (w: any) => fmtDate(w.date), sort: (w: any) => w.date },
                { key: "k", header: "Kind", cell: (w: any) => (w.kind === "full" ? "Full day" : w.kind === "half" ? "Half day" : `${formatMinutes(w.minutes ?? 0)} from home`) },
                { key: "r", header: "Reason", cell: (w: any) => w.reason || "—" },
                { key: "s", header: "Status", cell: (w: any) => <Pill status={w.status} /> },
              ]} />
          </Card>
        </div>
      )}

      {tab === "profile" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Employment">
            <DetailList items={[
              ["Employee ID", u.employee_code], ["Designation", u.designation], ["Employment status", emp], ["Joining date", fmtDate(u.joined_on)],
              ["Probation ends", fmtDate(u.probation_ends_on)], ["Notice started", fmtDate(u.notice_starts_on)], ["Last working day", fmtDate(u.last_working_day)], ["Inactive from", fmtDate(u.inactive_from)],
              ["Team", u.team_name], ["Team Lead", u.team_lead_name], ["Reporting manager", u.reporting_manager_name], ["Department", u.department_name],
              ...(can("money.view") ? [["Cost per hour", u.cost_per_hour_minor != null ? money(u.cost_per_hour_minor) : null] as [string, any]] : []),
            ]} />
          </Card>
          <Card title="Contact">
            <DetailList items={[["Email", u.email], ["Phone", u.phone], ["Date of birth", fmtDate(u.date_of_birth)], ["Address", u.address], ["Emergency contact", u.emergency_contact_name], ["Emergency phone", u.emergency_contact_phone]]} />
          </Card>
        </div>
      )}

      {tab === "accessories" && (
        <DataTable dateFilter={false} rows={d.assets} rowKey={(a: any) => a.id} search={false} empty="No accessories assigned."
          columns={[
            { key: "n", header: "Item", cell: (a: any) => <span className="font-semibold">{a.name}</span> },
            { key: "c", header: "Category", cell: (a: any) => a.category || "—" },
            { key: "s", header: "Serial", cell: (a: any) => a.serial_number || "—" },
            { key: "o", header: "Condition", cell: (a: any) => <Pill status={a.condition} /> },
            { key: "d", header: "Since", cell: (a: any) => fmtDate(a.assigned_on) },
          ]} />
      )}
      <EmployeeForm open={edit} user={full.data} onClose={() => setEdit(false)} />
    </>
  );
}

export const partLabel = (l: any) => (l.part === "first_half" ? "Half day, morning" : l.part === "second_half" ? "Half day, afternoon" : l.part === "short" ? `Short leave, ${formatMinutes(l.short_minutes ?? 0)}` : l.end_date !== l.start_date ? "Multiple days" : "Full day");

/** Sheet entries with filters by status and kind of work, used on the employee and reporting pages. */
const INV: Record<string, [string, string]> = { invoiced: ["paid", "Invoiced"], not_invoiced: ["draft", "Not invoiced"], refunded: ["refunded", "Refunded"], cancelled: ["cancelled", "Cancelled"] };
const STATUS_NAME: Record<string, string> = { approved: "Approved", submitted: "Waiting", draft: "Draft", rejected: "Sent back" };
export function EntriesTable({ rows, name, showPerson }: { rows: any[]; name: string; showPerson?: boolean }) {
  return (
    <DataTable dateFilter={false} rows={rows} rowKey={(r: any) => r.id} exportName={name} searchPlaceholder="Search projects, work types, notes" pageSize={50} tableId="entries"
      footer={<tr><td colSpan={showPerson ? 6 : 5}>Total</td><td className="text-right tabnum">{hrs(rows.reduce((a, r) => a + r.minutes, 0))}</td><td colSpan={3} /></tr>}
      columns={[
        { key: "d", header: "Date", cell: (r: any) => fmtDate(r.date, { weekday: "short", day: "numeric", month: "short" }), sort: (r: any) => r.date, text: (r: any) => r.date },
        ...(showPerson ? [{ key: "u", header: "Employee", cell: (r: any) => <Link to={`/people/${r.user_id}`} className="font-semibold hover:underline">{r.user_name}</Link>, sort: (r: any) => r.user_name, text: (r: any) => r.user_name }] : []),
        { key: "p", header: "Project", cell: (r: any) => <><Link to={`/projects/${r.project_id}`} className="font-semibold hover:underline">{r.project_name}</Link><div className="text-[12.5px] text-[var(--muted)]">{r.client_name}</div></>, sort: (r: any) => r.project_name, text: (r: any) => `${r.project_name} ${r.client_name}`, filter: (r: any) => r.project_name },
        { key: "a", header: "Kind of work", cell: (r: any) => <>{CATS.find((c) => c.key === r.category)?.label ?? "—"}{r.activity && <div className="text-[12.5px] text-[var(--muted)]">{r.activity}</div>}</>, sort: (r: any) => r.category ?? "", text: (r: any) => `${r.activity ?? ""} ${r.category}`, filter: (r: any) => CATS.find((c) => c.key === r.category)?.label },
        { key: "t", header: "Task", cell: (r: any) => r.task ?? "—", text: (r: any) => r.task ?? "", filter: (r: any) => r.task ?? "No task" },
        { key: "n", header: "Narration", cell: (r: any) => <span className="line-clamp-2 max-w-[38ch]">{plainText(r.description) || "—"}</span>, text: (r: any) => plainText(r.description), filter: false },
        { key: "m", header: "Time", cell: (r: any) => hrs(r.minutes), sort: (r: any) => r.minutes, align: "right", text: (r: any) => String(r.minutes / 60) },
        { key: "tr", header: "Tracking", cell: (r: any) => (r.offline ? <span title={r.offline_reason}>Offline</span> : r.tracker ?? (r.source === "eszy" ? "Here" : r.source)), text: (r: any) => (r.offline ? "offline" : r.source), filter: (r: any) => (r.offline ? "Offline" : "Tracked") },
        { key: "s", header: "Status", cell: (r: any) => <Pill status={r.status} />, sort: (r: any) => r.status, text: (r: any) => r.status, filter: (r: any) => STATUS_NAME[r.status] ?? r.status },
        { key: "i", header: "Invoice", cell: (r: any) => { const [st, l] = INV[r.invoice_state] ?? INV.not_invoiced; return <Pill status={st}>{l}</Pill>; }, sort: (r: any) => r.invoice_state ?? "", filter: (r: any) => (INV[r.invoice_state] ?? INV.not_invoiced)[1] },
      ]} />
  );
}

/** Average rate and what their hours earned, for money roles: these dates and all time. */
function RateStrip({ rate }: { rate: any }) {
  const { money } = useSession();
  const cell = (label: string, value: string, sub?: string) => (
    <div className="min-w-0 px-5 py-4"><div className="text-[12.5px] font-medium text-[var(--muted)]">{label}</div><div className="mt-1 whitespace-nowrap text-[19px] font-semibold tabnum">{value}</div>{sub && <div className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{sub}</div>}</div>
  );
  const p = rate.period, a = rate.all;
  return (
    <section className="mb-6 grid overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] sm:grid-cols-2 lg:grid-cols-5 [&>div:not(:last-child)]:border-b sm:[&>div:not(:last-child)]:border-r [&>div]:border-[var(--line)] lg:[&>div]:border-b-0">
      <div className="flex items-center gap-3 bg-[var(--brand-soft)]/50 px-5 py-4"><span className="grid size-10 place-items-center rounded-xl bg-brand-gradient text-white"><Wallet className="size-5" /></span><div><div className="text-[13.5px] font-bold">Average rate</div><div className="text-[12px] text-[var(--muted)]">Their hours × each project's rate</div></div></div>
      {cell("In these dates", p?.rate_minor != null ? `${money(p.rate_minor)}/h` : "—", p?.minutes ? `over ${hrs(p.minutes)} approved` : "No approved hours")}
      {cell("All time", a?.rate_minor != null ? `${money(a.rate_minor)}/h` : "—", a?.minutes ? `over ${hrs(a.minutes)} approved` : undefined)}
      {cell("Earned in these dates", p ? money(p.revenue_minor) : "—", p && p.cost_minor ? `cost ${money(p.cost_minor)}` : undefined)}
      {cell("Margin in these dates", p && p.revenue_minor ? `${Math.round(((p.revenue_minor - p.cost_minor) / p.revenue_minor) * 100)}%` : "—", p ? money(p.revenue_minor - p.cost_minor) : undefined)}
    </section>
  );
}
