import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, put, qs } from "../lib/api";
import { useSession } from "../lib/session";
import { RankList } from "../components/Charts";
import { Button, Card, DataTable, DateRange, MoneyInput, PageHeader, Pill, Spinner, Stat, StatGrid, Tabs, hrs, useRange, useToast } from "../components/ui";

export { Reporting as Reports, Exports } from "./Reporting";

export function Performance() {
  const { can, has, money } = useSession();
  const nav = useNavigate();
  const [tab, setTab] = useState("people");
  const [range, setRange] = useRange("month");
  const r = qs({ from: range.from, to: range.to });
  const people = useQuery({ queryKey: ["perf-people", r], queryFn: () => get(`/performance/people${r}`), enabled: tab === "people" });
  const teams = useQuery({ queryKey: ["perf-teams", r], queryFn: () => get(`/performance/teams${r}`), enabled: tab === "teams" });
  const sales = useQuery({ queryKey: ["perf-sales", r], queryFn: () => get(`/performance/sales${r}`), enabled: tab === "sales" });
  const m = can("money.view");
  const list = people.data?.people ?? [];
  return (
    <>
      <PageHeader title="Performance" sub={m ? "Rate = revenue ÷ approved hours. Employee rate = Σ(hours × project rate) ÷ hours." : "Approved hours for your team."} actions={<DateRange value={range} onChange={setRange} />} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "people", label: "People" }, { id: "teams", label: "Teams" }, { id: "sales", label: "Sales and pre-sales", hide: !(has("sales_crm") && can("performance.view", "leads.view_all")) }]} />
      {tab === "people" && (people.isLoading ? <Spinner /> : (
        <>
          <StatGrid cols={4}>
            <Stat label="Approved hours" value={hrs(list.reduce((a: number, p: any) => a + p.minutes, 0))} sub={`${list.length} people`} />
            <Stat label="Billable" value={hrs(list.reduce((a: number, p: any) => a + p.billable_minutes, 0))} tone="brand" />
            <Stat label="Non-billable" value={hrs(list.reduce((a: number, p: any) => a + p.non_billable_minutes, 0))} />
            {m ? <Stat label="Revenue" value={money(list.reduce((a: number, p: any) => a + Number(p.revenue_minor), 0))} tone="paid" /> : <Stat label="Average a day" value={hrs(Math.round(list.reduce((a: number, p: any) => a + p.daily_average_minutes, 0) / Math.max(1, list.length)))} />}
          </StatGrid>
          <DataTable dateFilter={false} rows={list} rowKey={(p: any) => p.user_id} onRowClick={(p: any) => nav(`/people/${p.user_id}`)} exportName="performance-people" initialSort={{ key: m ? "rate" : "a", dir: "desc" }}
            columns={[
              { key: "n", header: "Person", cell: (p: any) => <span className="font-semibold">{p.name}</span>, sort: (p: any) => p.name, text: (p: any) => p.name },
              { key: "a", header: "Approved", cell: (p: any) => hrs(p.minutes), align: "right", sort: (p: any) => p.minutes, text: (p: any) => String(p.minutes / 60) },
              { key: "b", header: "Billable", cell: (p: any) => hrs(p.billable_minutes), align: "right", sort: (p: any) => p.billable_minutes, text: (p: any) => String(p.billable_minutes / 60) },
              { key: "nb", header: "Non-billable", cell: (p: any) => hrs(p.non_billable_minutes), align: "right", sort: (p: any) => p.non_billable_minutes },
              { key: "d", header: "Daily average", cell: (p: any) => hrs(p.daily_average_minutes), align: "right", sort: (p: any) => p.daily_average_minutes },
              { key: "rate", header: "Rate", cell: (p: any) => (p.rate_minor ? `${money(p.rate_minor)}/h` : "—"), align: "right", sort: (p: any) => Number(p.rate_minor ?? 0), hide: !m, text: (p: any) => String(Number(p.rate_minor ?? 0) / 100) },
              { key: "rev", header: "Revenue", cell: (p: any) => money(p.revenue_minor), align: "right", sort: (p: any) => Number(p.revenue_minor), hide: !m, text: (p: any) => String(Number(p.revenue_minor) / 100) },
              { key: "c", header: "Cost", cell: (p: any) => money(p.cost_minor), align: "right", sort: (p: any) => Number(p.cost_minor), hide: !m, text: (p: any) => String(Number(p.cost_minor) / 100) },
            ]} />
        </>
      ))}
      {tab === "teams" && (teams.isLoading ? <Spinner /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(teams.data?.teams ?? []).map((t: any) => (
            <Card key={t.id} title={t.name} sub={`TL: ${t.lead_name ?? "none"} · ${t.members} people`}>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Approved hours" value={hrs(t.minutes)} sub={`${hrs(t.billable_minutes)} billable`} />
                <Stat label="Daily average" value={hrs(t.daily_minutes)} />
                {m && <><Stat label="Team revenue" value={money(t.revenue_minor)} sub={`${money(t.daily_revenue_minor)} a day`} /><Stat label="Team rate" value={t.rate_minor ? `${money(t.rate_minor)}/h` : "—"} tone="brand" /></>}
              </div>
            </Card>
          ))}
          {!teams.data?.teams?.length && <p className="text-[var(--muted)]">No teams yet.</p>}
        </div>
      ))}
      {tab === "sales" && (sales.isLoading ? <Spinner /> : (
        <DataTable dateFilter={false} rows={sales.data?.people} rowKey={(p: any) => p.user_id} exportName="performance-sales" empty="No sales activity in these dates."
          columns={[
            { key: "n", header: "Person", cell: (p: any) => <span className="font-semibold">{p.name}</span>, sort: (p: any) => p.name, text: (p: any) => p.name },
            { key: "lb", header: "Leads brought", cell: (p: any) => p.leads_brought, align: "right", sort: (p: any) => p.leads_brought },
            { key: "lc", header: "Converted", cell: (p: any) => p.leads_converted, align: "right", sort: (p: any) => p.leads_converted },
            { key: "cp", header: "Conversion", cell: (p: any) => (p.conversion_pct != null ? `${p.conversion_pct}%` : "—"), align: "right", sort: (p: any) => p.conversion_pct ?? -1 },
            { key: "cm", header: "Calls made", cell: (p: any) => p.calls_made, align: "right", sort: (p: any) => p.calls_made },
            { key: "cc", header: "Won on calls", cell: (p: any) => p.calls_converted, align: "right", sort: (p: any) => p.calls_converted },
            { key: "ccp", header: "Call conversion", cell: (p: any) => (p.call_conversion_pct != null ? `${p.call_conversion_pct}%` : "—"), align: "right", sort: (p: any) => p.call_conversion_pct ?? -1 },
            { key: "rv", header: "Revenue from leads", cell: (p: any) => money(p.revenue_from_leads_minor), align: "right", hide: !m, sort: (p: any) => Number(p.revenue_from_leads_minor) },
          ]} />
      ))}
    </>
  );
}

export function Rates() {
  const { money } = useSession();
  const [tab, setTab] = useState("projects");
  const p = useQuery({ queryKey: ["rates-projects"], queryFn: () => get<any[]>("/rates/projects") });
  const c = useQuery({ queryKey: ["rates-clients"], queryFn: () => get<any[]>("/rates/clients"), enabled: tab === "clients" });
  const rows = p.data ?? [];
  const tot = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  return (
    <>
      <PageHeader title="Rates and profit" sub="Project rate = (invoiced − refunded) ÷ approved hours. Client rate = total revenue ÷ total hours across its projects. Profit takes off each person's cost per hour and expenses." />
      <StatGrid cols={4}>
        <Stat label="Revenue" value={money(tot("revenue_minor"))} />
        <Stat label="Team cost" value={money(tot("labour_cost_minor"))} />
        <Stat label="Expenses" value={money(tot("expenses_minor"))} />
        <Stat label="Profit" value={money(tot("profit_minor"))} tone={tot("profit_minor") < 0 ? "late" : "paid"} />
      </StatGrid>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "projects", label: "Projects" }, { id: "clients", label: "Clients" }, { id: "cost", label: "Staff cost" }]} />
      {tab === "cost" ? <StaffCost /> : tab === "projects" ? (p.isLoading ? <Spinner /> : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <DataTable dateFilter={false} rows={rows} rowKey={(r: any) => r.project_id} rowHref={(r: any) => `/projects/${r.project_id}`} exportName="project-rates" initialSort={{ key: "pr", dir: "desc" }}
            columns={[
              { key: "n", header: "Project", cell: (r: any) => <>{r.name} <Pill status={r.status} /></>, sort: (r: any) => r.name, text: (r: any) => r.name },
              { key: "t", header: "Type", cell: (r: any) => <span className="text-[13px]">{r.type === "fixed" ? "Fixed" : `Hourly, ${r.billing_type}`}</span> },
              { key: "rv", header: "Revenue", cell: (r: any) => money(r.revenue_minor), align: "right", sort: (r: any) => Number(r.revenue_minor), text: (r: any) => String(Number(r.revenue_minor) / 100) },
              { key: "h", header: "Approved hours", cell: (r: any) => hrs(r.minutes), align: "right", sort: (r: any) => r.minutes },
              { key: "r", header: "Rate", cell: (r: any) => <b>{r.rate_minor ? `${money(r.rate_minor)}/h` : "—"}</b>, align: "right", sort: (r: any) => Number(r.rate_minor ?? 0) },
              { key: "c", header: "Team cost", cell: (r: any) => money(r.labour_cost_minor), align: "right", sort: (r: any) => Number(r.labour_cost_minor) },
              { key: "e", header: "Expenses", cell: (r: any) => money(r.expenses_minor), align: "right", sort: (r: any) => Number(r.expenses_minor) },
              { key: "pr", header: "Profit", cell: (r: any) => <span className={`font-semibold ${r.profit_minor < 0 ? "text-[#9c3a19]" : "text-[#17623f] dark:text-[#8fd8b2]"}`}>{money(r.profit_minor)}</span>, align: "right", sort: (r: any) => Number(r.profit_minor), text: (r: any) => String(Number(r.profit_minor) / 100) },
            ]} />
          <Card title="Best rates"><RankList format={(v) => `${money(v)}/h`} rows={rows.filter((r) => r.rate_minor).sort((a, b) => b.rate_minor - a.rate_minor).slice(0, 8).map((r) => ({ key: r.project_id, label: <Link to={`/projects/${r.project_id}`} className="hover:underline">{r.name}</Link>, value: Number(r.rate_minor) }))} /></Card>
        </div>
      )) : (c.isLoading ? <Spinner /> : (
        <DataTable dateFilter={false} rows={c.data} rowKey={(r: any) => r.client_id} rowHref={(r: any) => `/clients/${r.client_id}`} exportName="client-rates"
          columns={[
            { key: "n", header: "Client", cell: (r: any) => r.name, sort: (r: any) => r.name, text: (r: any) => r.name },
            { key: "p", header: "Projects", cell: (r: any) => r.projects, align: "right", sort: (r: any) => r.projects },
            { key: "rv", header: "Revenue", cell: (r: any) => money(r.revenue_minor), align: "right", sort: (r: any) => Number(r.revenue_minor) },
            { key: "h", header: "Hours", cell: (r: any) => hrs(r.minutes), align: "right", sort: (r: any) => r.minutes },
            { key: "r", header: "Rate", cell: (r: any) => <b>{r.rate_minor ? `${money(r.rate_minor)}/h` : "—"}</b>, align: "right", sort: (r: any) => Number(r.rate_minor ?? 0) },
            { key: "c", header: "Cost", cell: (r: any) => money(r.cost_minor), align: "right", sort: (r: any) => Number(r.cost_minor) },
          ]} />
      ))}
    </>
  );
}

/** Cost per hour for each person, used for team cost and profit. Set here by finance, not on the employee form. */
function StaffCost() {
  const { money, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: ["users", "cost"], queryFn: () => get<any[]>("/users") });
  const [edit, setEdit] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const save = async (u: any) => {
    setBusy(u.id);
    try { await put(`/users/${u.id}/cost`, { costPerHourMinor: edit[u.id] ?? null }); toast(`Saved cost for ${u.name}`); setEdit((e) => { const n = { ...e }; delete n[u.id]; return n; }); qc.invalidateQueries({ queryKey: ["users"] }); qc.invalidateQueries({ queryKey: ["rates-projects"] }); }
    catch (e: any) { toast(e?.message ?? "Couldn't save", "err"); } finally { setBusy(null); }
  };
  return (
    <DataTable rows={users.data} loading={users.isLoading} rowKey={(u: any) => u.id} exportName="staff-cost" searchPlaceholder="Search people" dateFilter={false}
      empty="No people yet."
      columns={[
        { key: "n", header: "Employee", cell: (u: any) => <Link to={`/people/${u.id}`} className="font-semibold hover:underline">{u.name}</Link>, sort: (u: any) => u.name, text: (u: any) => `${u.name} ${u.designation ?? ""}`, filter: false },
        { key: "d", header: "Designation", cell: (u: any) => u.designation || "—", sort: (u: any) => u.designation ?? "" },
        { key: "t", header: "Team", cell: (u: any) => u.team_name ?? "—", sort: (u: any) => u.team_name ?? "", text: (u: any) => u.team_name ?? "" },
        { key: "c", header: "Current cost / hour", cell: (u: any) => (u.cost_per_hour_minor != null ? money(u.cost_per_hour_minor) : <span className="text-[var(--muted)]">Not set</span>), sort: (u: any) => Number(u.cost_per_hour_minor ?? -1), align: "right" },
        { key: "x", header: "", cell: (u: any) => (
          <span className="inline-flex items-center gap-2">
            <span className="w-36"><MoneyInput currency={me!.settings.locale.currency} value={u.id in edit ? edit[u.id] : u.cost_per_hour_minor} onChange={(m) => setEdit((e) => ({ ...e, [u.id]: m }))} aria-label={`Cost per hour for ${u.name}`} /></span>
            <Button size="sm" variant="secondary" disabled={!(u.id in edit)} busy={busy === u.id} onClick={() => save(u)}>Save</Button>
          </span>
        ) },
      ]} />
  );
}
