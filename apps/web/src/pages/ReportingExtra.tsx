import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, ListFilter, RotateCcw, Undo2, X } from "lucide-react";
import { formatMinutes } from "@eszy/shared";
import { download, get, post, qs } from "../lib/api";
import { useSession } from "../lib/session";
import { opts, pct, useAction, useClients, useDepartments, useList, useProjects, useTeams, useUsers, userOpts } from "../lib/hooks";
import { BarChart, CATS, RankList, SplitBar } from "../components/Charts";
import { Person } from "../components/Avatar";
import {
  AddFilter, Button, Card, Combobox, DataTable, DateRange, ErrorNote, cx, plainText, Pill, SearchInput, Segmented, Select, Spinner, Stat, StatGrid, fmtDate, hrs, useConfirm, useRange,
} from "../components/ui";

// ------------------------------------------------------------------------------------------------ timesheets manager
type FilterKey = "departmentId" | "teamId" | "clientId" | "projectId" | "activityTypeId" | "status" | "category" | "managerId" | "offline" | "invoiceState";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "departmentId", label: "Department" }, { key: "teamId", label: "Team" }, { key: "clientId", label: "Client" }, { key: "projectId", label: "Project" },
  { key: "activityTypeId", label: "Work type" }, { key: "status", label: "Sheet status" }, { key: "category", label: "Kind of work" },
  { key: "managerId", label: "Reporting manager" }, { key: "offline", label: "Tracking" }, { key: "invoiceState", label: "Invoice" },
];
const INVOICE_STATE_OPTS = [{ value: "invoiced", label: "Invoiced" }, { value: "not_invoiced", label: "Not invoiced yet" }, { value: "refunded", label: "Refunded" }, { value: "cancelled", label: "Invoice cancelled" }];
const INVOICE_STATE_PILL: Record<string, [string, string]> = { invoiced: ["paid", "Invoiced"], not_invoiced: ["draft", "Not invoiced"], refunded: ["refunded", "Refunded"], cancelled: ["cancelled", "Cancelled"] };
const STATUS_OPTS = [{ value: "approved", label: "Approved" }, { value: "submitted", label: "Waiting for approval" }, { value: "rejected", label: "Sent back" }, { value: "draft", label: "Draft (not submitted)" }];

/** Every sheet entry in one place, like EPM's Manage Timesheets: search, add any filter, see the totals, approve or send back, export to Excel. */
export function TimesheetManager() {
  const { can } = useSession();
  const [range, setRange] = useRange("month");
  const [search, setSearch] = useState("");
  const q2 = useDeferredValue(search.trim());
  const [userId, setUserId] = useState<string | null>(null);
  const [f, setF] = useState<Partial<Record<FilterKey, string | null>>>({});
  const [shown, setShown] = useState<FilterKey[]>([]);
  const [menu, setMenu] = useState(false);
  const [view, setView] = useState<"sheets" | "analytics">("sheets");
  const [group, setGroup] = useState<"person" | "project" | "client" | "team" | "activity">("project");
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const users = useUsers();
  const projects = useProjects("");
  const clients = useClients(can("clients.view") || can("projects.view_all") || can("invoices.view"));
  const teams = useTeams();
  const depts = useDepartments();
  const acts = useList("activity-types");
  const qc = useQueryClient();
  const act = useAction();
  const confirm = useConfirm();
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(50);
  const params = { from: range.from, to: range.to, userId, search: q2 || undefined, ...f };
  useEffect(() => setPage(0), [JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery({ queryKey: ["rep-master", params, page, size], queryFn: () => get(`/reporting/entries${qs({ ...params, page, size })}`), placeholderData: (prev: any) => prev });
  const d = q.data;
  const sum = (pred: (s: any) => boolean, field: "minutes" | "refunded" | "cancelled" | "offline" = "minutes") => (d?.sums ?? []).filter(pred).reduce((a: number, s: any) => a + (s[field] ?? 0), 0);
  const managers = userOpts(users.data).filter((o) => (users.data ?? []).some((u) => u.reporting_manager_id === o.value || u.team_lead_id === o.value));
  const canApprove = can("time.approve_all") || can("time.approve_team");
  const optionsFor = (k: FilterKey) => ({
    departmentId: opts(depts.data), teamId: opts(teams.data), clientId: opts(clients.data, "name", "company"), projectId: opts(projects.data, "name", "client_name"),
    activityTypeId: opts(acts.data), status: STATUS_OPTS, category: CATS.map((c) => ({ value: c.key, label: c.label })), managerId: managers,
    offline: [{ value: "1", label: "Offline (not tracked)" }, { value: "0", label: "Tracked" }], invoiceState: INVOICE_STATE_OPTS,
  }[k]);
  const setFilter = (k: FilterKey, v: string | null) => setF((x) => ({ ...x, [k]: v }));
  const removeFilter = (k: FilterKey) => { setShown((s) => s.filter((x) => x !== k)); setF((x) => { const n = { ...x }; delete n[k]; return n; }); };
  const reset = () => { setF({}); setShown([]); setUserId(null); setSearch(""); };
  const anyFilter = !!(userId || search || Object.values(f).some(Boolean));
  const decide = async (r: any, action: "approve" | "reject") => {
    if (action === "reject" && await confirm({ title: `Send back ${r.user_name}'s sheet for ${fmtDate(r.date)}?`, body: "The whole day goes back to them to fix and submit again.", confirm: "Send back", danger: true }) === false) return;
    if (await act.run(() => post(`/approvals/sheets/${r.sheet_id}/${action}`), action === "approve" ? "Sheet approved" : "Sheet sent back")) {
      qc.invalidateQueries({ queryKey: ["rep-master"] }); qc.invalidateQueries({ queryKey: ["approvals"] });
    }
  };
  const approvedOf = (cat: string) => sum((s) => s.status === "approved" && s.category === cat);
  const st = d?.stats;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, project, client or notes" className="w-full sm:w-72" />
        <AddFilter options={FILTERS.filter((x) => !shown.includes(x.key))} onPick={(k) => setShown((s) => [...s, k as FilterKey])} />
        <div className="w-56"><Combobox value={userId} onChange={setUserId} options={userOpts(users.data, false)} placeholder="Employee" /></div>
        <DateRange value={range} onChange={setRange} />
        {anyFilter && <Button variant="ghost" onClick={reset}><RotateCcw />Reset</Button>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={() => download(`/reporting/entries${qs({ ...params, format: "xlsx" })}`, `timesheets-${range.from}-to-${range.to}.xlsx`)}><Download />Export to Excel</Button>
          <Segmented value={view} onChange={setView} options={[{ id: "sheets", label: "Sheets" }, { id: "analytics", label: "Analytics" }]} />
        </div>
      </div>
      {shown.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {shown.map((k) => (
            <div key={k} className={cx("flex items-center gap-1 rounded-xl border p-1 pl-3", f[k] ? "border-[var(--brand-2)]/50 bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--card)]")}>
              <span className="text-[12.5px] font-semibold text-[var(--muted)]">{FILTERS.find((x) => x.key === k)!.label}</span>
              <div className="w-52"><Combobox value={f[k] ?? null} onChange={(v) => setFilter(k, v)} options={optionsFor(k)} placeholder="Any" clearable={false} /></div>
              <button aria-label={`Remove ${k} filter`} onClick={() => removeFilter(k)} className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-black/5"><X className="size-4" /></button>
            </div>
          ))}
        </div>
      )}

      {q.isLoading || !d ? <Spinner /> : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            <Stat label="Expected hours" value={hrs(st?.expected ?? 0)} info="Working hours for the people in this filter after holidays, leave and half days." sub={`${st?.people ?? 0} people`} />
            <Stat label="Approved billable" value={hrs(approvedOf("billable"))} tone="paid" info="Approved hours on client work types." />
            <Stat label="Actual hours" value={hrs(sum(() => true))} sub={`${(d.total ?? d.rows.length).toLocaleString()} entries`} info="Everything logged, whatever its status." />
            <Stat label="Approved in-house" value={hrs(approvedOf("inhouse"))} info="Approved hours on internal projects or in-house work types (meetings, research, training)." />
            <Stat label="Approved no work" value={hrs(approvedOf("no_work"))} info="Approved hours with no work to do, such as waiting for the client." />
            <Stat label="Pending hours" value={hrs(sum((s) => s.status === "submitted"))} tone="amber" info="Submitted and waiting for the Team Lead." />
            <Stat label="Sent back hours" value={hrs(sum((s) => s.status === "rejected"))} tone={sum((s) => s.status === "rejected") ? "late" : undefined} info="Sheets the approver sent back to be fixed." />
            <Stat label="Unfilled sheets" value={st?.unfilled_sheets ?? 0} tone={st?.unfilled_sheets ? "late" : "paid"} info="Working days with no sheet submitted." sub={st?.unfilled_minutes ? `${hrs(st.unfilled_minutes)} missing` : undefined} />
            <Stat label="Leave hours" value={hrs(st?.leave ?? 0)} info="Approved leave, as working hours." />
            <Stat label="Refunded hours" value={hrs(sum(() => true, "refunded"))} tone={sum(() => true, "refunded") ? "late" : undefined} info="Hours on invoices that were refunded to the client." onClick={() => { setShown((x) => x.includes("invoiceState") ? x : [...x, "invoiceState"]); setFilter("invoiceState", "refunded"); }} active={f.invoiceState === "refunded"} />
            <Stat label="Cancelled hours" value={hrs(sum(() => true, "cancelled"))} tone={sum(() => true, "cancelled") ? "amber" : undefined} info="Hours that were on an invoice that was cancelled and haven't been billed again yet." onClick={() => { setShown((x) => x.includes("invoiceState") ? x : [...x, "invoiceState"]); setFilter("invoiceState", "cancelled"); }} active={f.invoiceState === "cancelled"} />
            <Stat label="Utilization" value={pct(st?.utilization)} tone={st?.utilization == null ? undefined : st.utilization >= 75 ? "paid" : st.utilization >= 50 ? "amber" : "late"} info="Approved billable ÷ expected hours." />
          </div>
          <ErrorNote error={act.err} />
          {view === "analytics" ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_1.2fr]">
              <Card title="Kind of work"><SplitBar format={hrs} parts={CATS.map((c) => ({ key: c.key, label: c.label, value: sum((s) => s.category === c.key), color: c.color }))} />
                <div className="mt-5"><BarChart title="Hours per day" data={d.groups.date} x={(x) => fmtDate(x.label, { day: "numeric", month: "short" })} series={[{ key: "minutes", label: "Hours", color: "var(--series-1)" }]} format={(v) => formatMinutes(v)} height={190} /></div>
              </Card>
              <Card title="Top" actions={<Segmented value={group} onChange={setGroup} options={[{ id: "project", label: "Projects" }, { id: "person", label: "People" }, { id: "client", label: "Clients" }, { id: "team", label: "Teams" }, { id: "activity", label: "Work types" }]} />}>
                <RankList format={hrs} rows={d.groups[group].map((g: any) => ({ key: g.key, label: g.label, value: g.minutes, sub: g.billable ? `${hrs(g.billable)} billable approved` : undefined }))} />
              </Card>
            </div>
          ) : (
            <DataTable dateFilter={false} autoFilters={false} rows={d.rows} rowKey={(r: any) => r.id} search={false} tableId="timesheet-master" loading={q.isFetching && q.isPlaceholderData}
              remote={{ total: d.total ?? d.rows.length, page, size, onPage: setPage, onSize: (n) => { setSize(n); setPage(0); } }} empty={anyFilter ? "No entries match these filters." : "No sheet entries in these dates."}
              footer={<tr><td colSpan={3}>Total for all {(d.total ?? 0).toLocaleString()} entries</td><td className="text-right tabnum">{hrs(sum(() => true))}</td><td colSpan={3} /></tr>}
              columns={[
                { key: "u", header: "Employee", cell: (r: any) => <Link to={`/people/${r.user_id}`} className="hover:underline"><Person id={r.user_id} name={r.user_name} sub={r.team_name ?? r.department_name} size={28} /></Link>, sort: (r: any) => r.user_name },
                { key: "p", header: "Project", cell: (r: any) => <><Link to={`/projects/${r.project_id}`} className="font-semibold hover:underline">{r.project_name}</Link><div className="text-[12.5px] text-[var(--muted)]">{r.client_name}</div></>, sort: (r: any) => r.project_name },
                { key: "n", header: "Work done", wrap: true, cell: (r: any) => <div className="min-w-[16ch] max-w-[30ch]"><span className="line-clamp-2 text-[13px]">{plainText(r.description) || <span className="italic text-[var(--muted)]">No notes</span>}{r.offline && <span className="ml-1"><Pill status="amber">Offline</Pill></span>}</span><div className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{[r.activity, r.task ?? CATS.find((c) => c.key === r.category)?.label].filter(Boolean).join(" · ")}</div></div>, sort: (r: any) => r.activity ?? "" },
                { key: "m", header: "Hours", cell: (r: any) => <b className="tabnum">{hrs(r.minutes)}</b>, sort: (r: any) => r.minutes, align: "right" },
                { key: "d", header: "Date", cell: (r: any) => <span className="whitespace-nowrap">{fmtDate(r.date, { weekday: "short", day: "numeric", month: "short" })}</span>, sort: (r: any) => r.date },
                { key: "s", header: "Sheet / invoice", cell: (r: any) => { const [st, label] = INVOICE_STATE_PILL[r.invoice_state] ?? INVOICE_STATE_PILL.not_invoiced; return <div className="flex flex-col items-start gap-1"><span title={r.decided_by_name && r.status !== "submitted" ? `by ${r.decided_by_name}` : undefined}><Pill status={r.status} /></span><Pill status={st}>{label}</Pill></div>; }, sort: (r: any) => r.status },
                { key: "x", header: "", align: "right", cell: (r: any) => canApprove && r.status === "submitted" ? (
                  <span className="inline-flex gap-1">
                    <Button size="sm" variant="ghost" title="Send the whole day back" onClick={(e) => { e.stopPropagation(); decide(r, "reject"); }}><Undo2 className="size-4" /></Button>
                    <Button size="sm" title="Approve the whole day" aria-label="Approve the whole day" onClick={(e) => { e.stopPropagation(); decide(r, "approve"); }}><Check className="size-4" /></Button>
                  </span>
                ) : null },
              ]} />
          )}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ leave reporting
const KIND_LABEL: Record<string, string> = { full: "Full day", half: "Half day", short: "Short leave" };
const days = (n: number) => `${Math.round(n * 10) / 10} ${Math.abs(n - 1) < 0.001 ? "day" : "days"}`;

/** Leave taken per person and type, half and short leave, WFH, pending requests and unpaid days, with every request. */
export function LeaveReporting() {
  const [range, setRange] = useRange("year");
  const [team, setTeam] = useState("");
  const [dept, setDept] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<"people" | "requests">("people");
  const teams = useTeams();
  const depts = useDepartments();
  const users = useUsers();
  const q = useQuery({
    queryKey: ["rep-leave", range.from, range.to, team, dept, userId, type, status],
    queryFn: () => get(`/reporting/leave${qs({ from: range.from, to: range.to, teamId: team, departmentId: dept, userId, leaveTypeId: type, leaveStatus: status })}`),
  });
  const d = q.data;
  const types = d?.types ?? [];
  const series = types.map((t: any, i: number) => ({ key: t.id, label: t.name, color: `var(--series-${(i % 6) + 1})` }));
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <DateRange value={range} onChange={setRange} />
        <Select value={team} onChange={(e) => setTeam(e.target.value)} className="w-40" aria-label="Team"><option value="">All teams</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-44" aria-label="Department"><option value="">All departments</option>{depts.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <div className="w-52"><Combobox value={userId} onChange={setUserId} options={userOpts(users.data, false)} placeholder="Employee" /></div>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-40" aria-label="Leave type"><option value="">All leave types</option>{types.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36" aria-label="Status"><option value="">Any status</option><option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></Select>
      </div>
      {q.isLoading || !d ? <Spinner /> : (
        <>
          <StatGrid cols={6}>
            <Stat label="Leave taken" value={days(d.totals.days)} sub={`${d.totals.people_on_leave} people`} />
            <Stat label="Half days" value={d.totals.half} />
            <Stat label="Short leave" value={d.totals.short} />
            <Stat label="Pending requests" value={d.totals.pending} tone={d.totals.pending ? "amber" : undefined} />
            <Stat label="Unpaid" value={days(d.totals.unpaid)} tone={d.totals.unpaid ? "late" : undefined} info="Days taken after the balance ran out, or on an unpaid leave type." />
            <Stat label="Work from home" value={days(d.totals.wfh_days)} info="Approved full and half WFH days." />
          </StatGrid>
          <div className="mb-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Card title="Leave days per month" sub="Approved leave, by the month it starts">
              {d.byMonth.length ? <BarChart title="" stacked data={d.byMonth} x={(m) => new Date(`${m.month}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "2-digit" })} series={series} format={(v) => `${Math.round(v * 10) / 10}`} height={200} />
                : <p className="py-10 text-center text-[14px] text-[var(--muted)]">No approved leave in these dates.</p>}
            </Card>
            <Card title="Most leave" sub="Approved days in these dates">
              <RankList format={(v) => days(v)} rows={[...d.people].filter((p: any) => p.days > 0).sort((a: any, b: any) => b.days - a.days).slice(0, 8).map((p: any) => ({ key: p.id, label: <Link to={`/people/${p.id}?tab=leave`} className="hover:underline">{p.name}</Link>, value: p.days, sub: p.team_name ?? undefined }))} empty="Nobody has taken leave in these dates." />
            </Card>
          </div>
          <div className="mb-3"><Segmented value={view} onChange={setView} options={[{ id: "people", label: "By person" }, { id: "requests", label: `Requests (${d.requests.length})` }]} /></div>
          {view === "people" ? (
            <DataTable dateFilter={false} rows={d.people} rowKey={(p: any) => p.id} rowHref={(p: any) => `/people/${p.id}?tab=leave`} exportName="leave-report" searchPlaceholder="Search people" pageSize={50} initialSort={{ key: "total", dir: "desc" }}
              columns={[
                { key: "n", header: "Employee", cell: (p: any) => <Person id={p.id} name={p.name} sub={[p.employee_code, p.team_name].filter(Boolean).join(" · ")} size={28} />, sort: (p: any) => p.name, text: (p: any) => `${p.name} ${p.employee_code ?? ""} ${p.team_name ?? ""}` },
                { key: "m", header: "Reporting manager", cell: (p: any) => p.manager_name ?? "—", text: (p: any) => p.manager_name ?? "" },
                ...types.map((t: any) => ({ key: `t${t.id}`, header: t.name, cell: (p: any) => (p.by_type[t.id] ? <span className="tabnum">{Math.round(p.by_type[t.id] * 10) / 10}</span> : <span className="text-[var(--muted)]">—</span>), sort: (p: any) => p.by_type[t.id] ?? 0, align: "right" as const, text: (p: any) => String(p.by_type[t.id] ?? 0) })),
                { key: "total", header: "Total days", cell: (p: any) => <b className="tabnum">{Math.round(p.days * 10) / 10}</b>, sort: (p: any) => p.days, align: "right", text: (p: any) => String(p.days) },
                { key: "h", header: "Half / short", cell: (p: any) => <span className="tabnum">{p.half} / {p.short}</span>, sort: (p: any) => p.half + p.short, align: "right", text: (p: any) => `${p.half}/${p.short}` },
                { key: "u", header: "Unpaid", cell: (p: any) => (p.unpaid ? <span className="font-semibold text-[#9c3a19] tabnum">{p.unpaid}</span> : "—"), sort: (p: any) => p.unpaid, align: "right", text: (p: any) => String(p.unpaid) },
                { key: "w", header: "WFH", cell: (p: any) => <span className="tabnum">{p.wfh_days || "—"}{p.wfh_hours ? <span className="text-[var(--muted)]"> + {hrs(p.wfh_hours)}</span> : null}</span>, sort: (p: any) => p.wfh_days, align: "right", text: (p: any) => String(p.wfh_days) },
                { key: "p", header: "Pending", cell: (p: any) => (p.pending ? <Pill status="pending">{p.pending}</Pill> : "—"), sort: (p: any) => p.pending, align: "right", text: (p: any) => String(p.pending) },
              ]} />
          ) : (
            <DataTable dateFilter={false} rows={d.requests} rowKey={(r: any) => r.id} exportName="leave-requests" searchPlaceholder="Search people, type or reason" pageSize={50}
              columns={[
                { key: "n", header: "Employee", cell: (r: any) => <Link to={`/people/${r.user_id}?tab=leave`} className="font-semibold hover:underline">{r.user_name}</Link>, sort: (r: any) => r.user_name, text: (r: any) => `${r.user_name} ${r.team_name ?? ""}` },
                { key: "t", header: "Type", cell: (r: any) => <>{r.type_name}{!r.paid && <span className="ml-1 text-[12px] text-[var(--muted)]">unpaid</span>}</>, sort: (r: any) => r.type_name, text: (r: any) => r.type_name },
                { key: "k", header: "Kind", cell: (r: any) => <>{KIND_LABEL[r.kind]}{r.kind === "half" && r.part !== "full" && <div className="text-[12px] text-[var(--muted)]">{r.part === "first_half" ? "First half" : r.part === "second_half" ? "Second half" : ""}</div>}{r.kind === "short" && <div className="text-[12px] text-[var(--muted)]">{hrs(r.short_minutes)}</div>}</>, sort: (r: any) => r.kind, text: (r: any) => KIND_LABEL[r.kind] },
                { key: "d", header: "Dates", cell: (r: any) => <span className="whitespace-nowrap">{fmtDate(r.start_date)}{r.end_date !== r.start_date && <> – {fmtDate(r.end_date)}</>}</span>, sort: (r: any) => r.start_date, text: (r: any) => r.start_date },
                { key: "days", header: "Days", cell: (r: any) => <span className="tabnum">{Number(r.days)}</span>, sort: (r: any) => Number(r.days), align: "right", text: (r: any) => String(r.days) },
                { key: "r", header: "Reason", cell: (r: any) => <span className="line-clamp-2 max-w-[34ch] text-[13.5px]">{r.reason || "—"}</span>, text: (r: any) => r.reason },
                { key: "s", header: "Status", cell: (r: any) => <><Pill status={r.status} />{r.decided_by_name && <div className="mt-0.5 text-[12px] text-[var(--muted)]">by {r.decided_by_name}</div>}</>, sort: (r: any) => r.status, text: (r: any) => r.status },
                { key: "a", header: "Applied", cell: (r: any) => fmtDate(r.created_at), sort: (r: any) => r.created_at, text: () => "" },
              ]} />
          )}
        </>
      )}
    </>
  );
}

