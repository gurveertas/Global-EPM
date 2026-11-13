import { describeSchedule } from "@eszy/shared";
import { InvoiceScheduleFields, scheduleBody, scheduleFromProject, type ScheduleValue } from "../components/InvoiceSchedule";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ProjectActivity, ProjectAbout } from "./ProjectExtras";
import { ProjectActivityFeed, ProjectBoard, ProjectDescription, ProjectFiles, ProjectPeople, RichText, StageSelect } from "./ProjectParts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Briefcase, Building2, CalendarClock, LayoutGrid, List, Pencil, Plus, Settings2, Timer, Upload, Users } from "lucide-react";
import { FIXED_OPTION_INFO, formatMinutes } from "@eszy/shared";
import { del, get, post, put } from "../lib/api";
import { useSession } from "../lib/session";
import { opts, useAction, useClients, useList, useUsers, userOpts } from "../lib/hooks";
import { BarChart, CATS, RankList, SplitBar } from "../components/Charts";
import { Person } from "../components/Avatar";
import {
  Button, Card, CapBar, Checkbox, Combobox, DataTable, DetailList, Drawer, Empty, ErrorNote, Field, HoursInput, Input, LinkButton, Modal, MoneyInput, MultiSelect,
  PageHeader, Pill, Progress, Segmented, Select, Spinner, Stat, StatGrid, Table, Tabs, Textarea, cx, fmtDate, fmtDateTime, hrs, useConfirm, useToast, type Column,
} from "../components/ui";
import { ImportModal } from "./People";

export const typeLabel = (p: any) => (p.type === "fixed" ? `Fixed price, ${FIXED_OPTION_INFO[p.fixed_option]?.label ?? ""}` : `Hourly, ${p.billing_type}, ${p.invoicing === "recurring" ? "recurring" : "one-time"}`);

export function Projects() {
  const { can, money } = useSession();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "active";
  const view = (params.get("view") ?? "list") as "list" | "board";
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(params); n.set(k, v); setParams(n); };
  const qc = useQueryClient();
  const { me } = useSession();
  const q = useQuery({ queryKey: ["projects", "all"], queryFn: () => get<any[]>("/projects") });
  const clients = useClients();
  const users = useUsers();
  const sources = useList("project-sources");
  const [type, setType] = useState("");
  const [client, setClient] = useState<string | null>(null);
  const [pm, setPm] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [mine, setMine] = useState(false);
  const [importing, setImporting] = useState(false);
  const all = q.data ?? [];
  const rows = all.filter((p) => (status === "all" || p.status === status) && (!type || (type === "internal" ? p.is_internal : type === "fixed" ? p.type === "fixed" : p.type === "hourly" && p.billing_type === type && !p.is_internal))
    && (!client || p.client_id === client) && (!pm || p.pm_user_id === pm) && (!source || p.source_id === source) && (!mine || p.is_member));
  const near = all.filter((p) => p.status === "active" && p.cap_minutes && p.logged_minutes / p.cap_minutes >= 0.8);
  const moneyOn = can("money.view");
  const cols: Column<any>[] = [
    { key: "n", header: "Project", cell: (p) => <><span className="font-semibold">{p.name}</span><div className="text-[12.5px] text-[var(--muted)]">{[p.code, p.client_name].filter(Boolean).join(" · ")}</div></>, sort: (p) => p.name.toLowerCase(), text: (p) => `${p.name} ${p.code} ${p.client_name} ${(p.tags ?? []).join(" ")}` },
    { key: "t", header: "Type", cell: (p) => <span className="text-[13px]">{p.is_internal ? "Internal (in-house)" : typeLabel(p)}</span>, sort: (p) => `${p.type}${p.billing_type}`, text: (p) => typeLabel(p) },
    { key: "team", header: "Team", cell: (p) => <div className="text-[13px]"><div>PM: {p.pm_name ?? <span className="text-[var(--muted)]">none</span>}</div><div className="text-[var(--muted)]">TL: {p.tls.length ? p.tls.map((t: any) => t.name).join(", ") : "none"} · {p.member_count} members</div></div>, text: (p) => `${p.pm_name ?? ""} ${p.tls.map((t: any) => t.name).join(" ")}` },
    { key: "s", header: "Source", cell: (p) => <span className="text-[13px]">{p.source_name ?? "—"}{p.account_name && <div className="text-[var(--muted)]">{p.account_name}</div>}</span>, sort: (p) => p.source_name ?? "", text: (p) => `${p.source_name ?? ""} ${p.account_name ?? ""}` },
    { key: "h", header: "Hours", cell: (p) => (p.line_count ? <CapBar used={p.logged_minutes} cap={p.cap_minutes} /> : <span className="tabnum">{hrs(p.logged_minutes)}</span>), sort: (p) => (p.cap_minutes ? p.logged_minutes / p.cap_minutes : 0), className: "min-w-44" },
    { key: "w", header: "Last 7 days", cell: (p) => hrs(p.week_minutes), sort: (p) => p.week_minutes, align: "right" },
    { key: "r", header: "Rate / price", cell: (p) => (p.type === "fixed" ? money(p.price_minor) : `${money(p.hourly_rate_minor)}/h`), align: "right", hide: !moneyOn },
    { key: "ar", header: "Average rate", cell: (p) => (p.avg_rate_minor != null ? `${money(p.avg_rate_minor)}/h` : <span className="text-[var(--muted)]">—</span>), sort: (p) => Number(p.avg_rate_minor ?? -1), align: "right", hide: !moneyOn },
    { key: "stg", header: "Stage", cell: (p) => <span className="text-[13px]">{p.stage_name ?? "—"}</span>, sort: (p) => p.stage_name ?? "" },
    { key: "st", header: "Status", cell: (p) => <Pill status={p.status} />, sort: (p) => p.status },
  ];
  const n = (s: string) => all.filter((p) => s === "all" || p.status === s).length;
  return (
    <>
      <PageHeader title="Projects" sub="Every project with its team, hours against the cap, and where it came from."
        actions={<>{can("import_export") && can("projects.manage") && <Button variant="secondary" onClick={() => setImporting(true)}><Upload />Import</Button>}{(can("projects.manage") || can("projects.billing")) && <LinkButton to="/projects/new" variant="primary"><Plus />New project</LinkButton>}</>} />
      <StatGrid cols={4}>
        <Stat label="Active" value={n("active")} onClick={() => setParam("status", "active")} active={status === "active"} />
        <Stat label="Paused" value={n("paused")} onClick={() => setParam("status", "paused")} active={status === "paused"} />
        <Stat label="Ended" value={n("ended")} onClick={() => setParam("status", "ended")} active={status === "ended"} />
        <Stat label="At 80% of the cap or more" value={near.length} tone={near.length ? "amber" : undefined} sub={near.slice(0, 2).map((p) => p.name).join(", ") || "None"} />
      </StatGrid>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented value={view} onChange={(v) => setParam("view", v)} options={[{ id: "list", label: <span className="inline-flex items-center gap-1.5"><List className="size-3.5" />List</span> }, { id: "board", label: <span className="inline-flex items-center gap-1.5"><LayoutGrid className="size-3.5" />Board by stage</span> }]} />
        {view === "board" && <p className="text-[13px] text-[var(--muted)]">Drag a project to another stage. PMs and Admins can move projects.</p>}
      </div>
      {view === "board" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select value={status} onChange={(e) => setParam("status", e.target.value)} className="w-32" aria-label="Status"><option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option><option value="all">All</option></Select>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-36" aria-label="Type"><option value="">All types</option><option value="prepaid">Hourly prepaid</option><option value="postpaid">Hourly postpaid</option><option value="fixed">Fixed price</option><option value="internal">Internal</option></Select>
          <div className="w-44"><Combobox value={client} onChange={setClient} options={opts(clients.data, "name", "company")} placeholder="Any client" /></div>
          <div className="w-44"><Combobox value={pm} onChange={setPm} options={userOpts(users.data)} placeholder="Any PM" /></div>
          <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-32" aria-label="Source"><option value="">Any source</option>{sources.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Checkbox label="Only mine" checked={mine} onChange={setMine} />
        </div>
          {q.isLoading ? <Spinner /> : <ProjectBoard projects={rows} canMove={(p) => can("projects.manage") || p.pm_user_id === me!.user.id || (p.pms ?? []).some((x: any) => x.id === me!.user.id)} onMoved={() => qc.invalidateQueries({ queryKey: ["projects"] })} />}
        </>
      ) : (
        <DataTable rows={rows} columns={cols} rowKey={(p) => p.id} loading={q.isLoading} onRowClick={(p) => nav(`/projects/${p.id}`)} exportName="projects" searchPlaceholder="Search project, code, client, tag"
          filters={<>
          <Select value={status} onChange={(e) => setParam("status", e.target.value)} className="w-32" aria-label="Status"><option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option><option value="all">All</option></Select>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-36" aria-label="Type"><option value="">All types</option><option value="prepaid">Hourly prepaid</option><option value="postpaid">Hourly postpaid</option><option value="fixed">Fixed price</option><option value="internal">Internal</option></Select>
          <div className="w-44"><Combobox value={client} onChange={setClient} options={opts(clients.data, "name", "company")} placeholder="Any client" /></div>
          <div className="w-44"><Combobox value={pm} onChange={setPm} options={userOpts(users.data)} placeholder="Any PM" /></div>
          <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-32" aria-label="Source"><option value="">Any source</option>{sources.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Checkbox label="Only mine" checked={mine} onChange={setMine} />
        </>} empty="No projects match these filters." />
      )}
      <ImportModal open={importing} onClose={() => setImporting(false)} entity="projects" title="Import projects" invalidate={["projects"]} />
    </>
  );
}

export function ProjectDetail() {
  const { id } = useParams();
  const { can, money, me, has } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const setTab = (t: string) => setParams({ tab: t });
  const [modal, setModal] = useState<null | "extra" | "line" | "team" | "settings" | "edit">(null);
  const [err, setErr] = useState<unknown>(null);
  const q = useQuery({ queryKey: ["project", id], queryFn: () => get(`/projects/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <Empty icon={<Briefcase />} title="Project not found" />;
  const p = q.data;
  const refresh = () => {
    for (const k of [["project", id], ["projects"], ["invoices"], ["assignments"], ["activity", p.id], ["project-files", p.id]]) qc.invalidateQueries({ queryKey: k });
  };
  const run = async (fn: () => Promise<any>, msg: string) => { setErr(null); try { await fn(); toast(msg); refresh(); } catch (e) { setErr(e); } };
  const r = p.remaining;
  const billing = can("projects.billing") && has("projects_billing");
  const moneyOn = can("money.view");
  const meId = me!.user.id;
  const amTl = p.members.some((m: any) => m.id === meId && m.role === "tl");
  const amPm = can("projects.manage") || p.pm_user_id === meId || !!p.amPm;
  const canTeam = amPm || amTl;
  const tls = p.members.filter((m: any) => m.role === "tl");
  const pms = p.members.filter((m: any) => m.role === "pm" || m.id === p.pm_user_id);
  const cat = (k: string) => p.byActivity.filter((a: any) => a.category === k).reduce((x: number, a: any) => x + a.minutes, 0);
  const openTasks = p.tasks.filter((t: any) => t.status !== "done").length;

  return (
    <>
      <Link to="/projects" className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--muted)] hover:text-[var(--text)]"><ArrowLeft className="size-3.5" />Projects</Link>
      <ErrorNote error={err} />
      {/* Project header: who it's for, where it stands and the numbers that matter, in one card. */}
      <section className="mb-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-[0_1px_2px_rgba(16,24,40,.05)]">
        <div className="relative flex flex-wrap items-start justify-between gap-5 p-5 sm:p-6">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
          <div className="flex min-w-0 items-start gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-gradient font-display text-[19px] font-bold text-white shadow-[0_8px_24px_-10px_rgb(124_58_237/.8)]">
              {(p.code || p.name).replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em]">{p.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-[var(--muted)]">
                <Link to={`/clients/${p.client_id}`} className="inline-flex items-center gap-1.5 font-semibold text-[var(--text)] hover:underline"><Building2 className="size-3.5 text-[var(--muted)]" />{p.client_name}</Link>
                {p.code && <span className="rounded-md bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[12px] ring-1 ring-[var(--line)]">{p.code}</span>}
                <span>{p.is_internal ? "Internal project" : typeLabel(p)}</span>
                {p.delivery_date && <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" />Delivery {fmtDate(p.delivery_date)}{(() => { const d = Math.round((new Date(p.delivery_date).getTime() - Date.now()) / 86400000); return p.status === "active" ? <b className={cx("ml-1 font-semibold", d < 0 ? "text-[#b4441f]" : d <= 7 ? "text-[#8a5300] dark:text-[#f0a531]" : "text-[var(--text)]")}>{d < 0 ? `${-d} days late` : d === 0 ? "today" : `in ${d} days`}</b> : null; })()}</span>}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Pill status={p.status} />
                {p.stage && <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-soft)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--brand)] dark:text-white">{p.stage.name}</span>}
                {(p.tags ?? []).map((t: string) => <span key={t} className="rounded-full bg-[var(--bg)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--muted)] ring-1 ring-[var(--line)]">#{t}</span>)}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              {can("projects.manage") && <Button size="sm" variant="secondary" onClick={() => setModal("edit")}><Pencil />Edit</Button>}
              {billing && <Button size="sm" variant="secondary" onClick={() => setModal("settings")}><Settings2 />Billing settings</Button>}
              {billing && <Button size="sm" onClick={() => setModal("extra")}><Timer />Add hours</Button>}
            </div>
            {(amPm || can("projects.manage")) && (
              <div className="flex flex-wrap items-center gap-2">
                {amPm && <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--muted)]">Stage <StageSelect project={p} onChange={refresh} /></label>}
                {can("projects.manage") && (
                  <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--muted)]">Status
                    <Select value={p.status} onChange={(e) => run(() => post(`/projects/${p.id}/status`, { status: e.target.value }), "Status changed")} className="h-9 w-32 text-[13.5px] font-normal text-[var(--text)]" aria-label="Project status">
                      <option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option>
                    </Select>
                  </label>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-[var(--line)] bg-[var(--bg)]/50 sm:grid-cols-3 xl:grid-cols-6 [&>div]:border-[var(--line)] [&>div]:px-5 [&>div]:py-4 [&>div:not(:last-child)]:border-r">
          <div className="col-span-2 sm:col-span-3 xl:col-span-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-medium text-[var(--muted)]">Hours logged</span>
              {r.projectCap !== null && <span className="text-[12px] text-[var(--muted)] tabnum">{Math.round((r.projectUsed / r.projectCap) * 100)}% of cap</span>}
            </div>
            <div className="mt-1 flex items-baseline gap-2"><span className="text-[22px] font-semibold tracking-[-0.02em] tabnum">{hrs(r.projectUsed)}</span>{r.projectCap !== null && <span className="text-[13px] text-[var(--muted)] tabnum">of {hrs(r.projectCap)}</span>}</div>
            {r.projectCap !== null ? <div className="mt-2"><Progress pct={(r.projectUsed / r.projectCap) * 100} tone={r.projectUsed >= r.projectCap ? "late" : r.projectUsed >= r.projectCap * 0.8 ? "amber" : "brand"} /></div> : <p className="mt-1 text-[12px] text-[var(--muted)]">No cap on this project</p>}
          </div>
          <HeroStat label="Left on the cap" value={r.projectCap === null ? "No cap" : hrs(Math.max(0, r.projectLeft))} tone={r.projectLeft !== null && r.projectLeft <= 0 ? "late" : undefined} />
          <HeroStat label={`Billing cap this ${p.billing_period ?? "period"}`} value={r.periodCap === null ? "No cap" : hrs(r.periodCap)} sub={r.periodCap !== null ? `${hrs(Math.max(0, r.periodLeft))} left` : undefined} />
          {moneyOn ? <HeroStat label={p.type === "fixed" ? "Price" : "Hourly rate"} value={p.type === "fixed" ? money(p.price_minor) : `${money(p.hourly_rate_minor)}/h`} sub={p.type === "fixed" && p.estimated_minutes ? `${hrs(p.estimated_minutes)} estimated` : undefined} />
            : <HeroStat label="Open tasks" value={String(openTasks)} />}
          {moneyOn ? <HeroStat label="Average rate" value={p.rate?.rate_minor != null ? `${money(p.rate.rate_minor)}/h` : "—"} sub={p.rate?.minutes ? `${hrs(p.rate.minutes)} approved` : "No approved hours yet"} />
            : <div className="min-w-0"><span className="text-[12.5px] font-medium text-[var(--muted)]">Team</span><div className="mt-1.5 flex -space-x-2">{p.members.slice(0, 6).map((m: any) => <span key={m.id} title={m.name} className="grid size-8 place-items-center rounded-full bg-[var(--brand-soft)] text-[11.5px] font-bold text-[var(--brand)] ring-2 ring-[var(--card)] dark:text-white">{m.name.split(" ").map((x: string) => x[0]).slice(0, 2).join("")}</span>)}</div></div>}
        </div>
      </section>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "overview", label: "Overview" }, { id: "tasks", label: "Tasks", count: openTasks }, { id: "activity", label: "Activity" },
        { id: "team", label: "Team", count: p.members.length }, { id: "description", label: "Description" }, { id: "files", label: "Files", count: p.fileCount },
        { id: "billing", label: "Hours and payments" }, { id: "invoices", label: "Invoices", count: p.invoices.length, hide: !(can("invoices.view") && has("projects_billing")) },
        { id: "about", label: "Tracking" }, { id: "costs", label: "Profit", hide: !moneyOn },
      ]} />

      {tab === "overview" && (
        <div className="grid gap-5">
          <ProjectPeople project={p} onChange={refresh} />
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="grid gap-5">
              <Card title="Project details">
                <DetailList cols={3} items={[
                  ["Client", p.client_name], ["Project Managers", pms.map((t: any) => t.name).join(", ")], ["Team Leads", tls.map((t: any) => t.name).join(", ")],
                  ["Sales person", p.people.sales_name], ["Estimated by", p.people.estimator_name], ["Call person", p.people.caller_name],
                  ["Source", p.source_name], ["Account", p.account_name], ["Communication", p.communication_types?.join(", ")],
                  ["Start date", fmtDate(p.start_date)], ["Delivery date", fmtDate(p.delivery_date)], ["Offline hours", p.allow_offline_hours ? "Allowed" : "Not allowed"],
                  ["Stage", p.stage?.name], ["Created", `${fmtDate(p.created_at)}${p.people.created_by_name ? ` by ${p.people.created_by_name}` : ""}`],
                  ...(p.type === "hourly" ? [["Invoices", p.invoicing === "recurring"
                    ? `${p.invoice_frequency ? describeSchedule({ frequency: p.invoice_frequency, weekday: p.invoice_weekday, monthDay: p.invoice_month_day }) : `Every ${p.billing_period ?? "period"}`}${p.next_billing_date ? ` · next ${fmtDate(p.next_billing_date, { day: "numeric", month: "short" })}` : ""}`
                    : "One-time"] as [string, string]] : []),
                  ...(moneyOn ? [["Average rate", p.rate?.rate_minor != null ? `${money(p.rate.rate_minor)}/h` : "—"] as [string, string]] : []),
                ]} />
                {p.description && (
                  <div className="mt-5 border-t border-[var(--line)] pt-4">
                    <div className="mb-2 flex items-center justify-between"><h3 className="text-[14px] font-bold">Description</h3><button onClick={() => setTab("description")} className="text-[13px] font-semibold text-[var(--brand)] hover:underline">Open</button></div>
                    <div className="max-h-56 overflow-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent)]"><RichText text={p.description} /></div>
                  </div>
                )}
              </Card>
              <div className="grid gap-5 lg:grid-cols-2">
                <Card title="Kind of work" sub="All hours logged on this project">
                  <SplitBar format={hrs} parts={CATS.map((c) => ({ key: c.key, label: c.label, value: cat(c.key), color: c.color }))} />
                  <div className="mt-5"><RankList format={hrs} color="var(--series-2)" rows={p.byActivity.slice(0, 8).map((a: any) => ({ key: a.name, label: a.name, value: a.minutes }))} /></div>
                </Card>
                <Card title="Hours by person">
                  <RankList format={hrs} rows={p.byPerson.map((x: any) => ({ key: x.name, label: x.name, value: x.minutes, sub: `${hrs(x.approved_minutes ?? 0)} approved` }))} empty="No hours yet." />
                </Card>
              </div>
              <Card title="Hours per week" sub="Last 12 weeks">
                <BarChart title="" data={p.byWeek} x={(w) => new Date(`${w.week}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })} series={[{ key: "minutes", label: "Hours", color: "var(--series-1)" }]} format={(v) => formatMinutes(v)} height={200} />
              </Card>
            </div>
            <Card title="Activity" sub="Sheets, approvals, tasks and comments" actions={<button onClick={() => setTab("activity")} className="text-[13px] font-semibold text-[var(--brand)] hover:underline">See all</button>}>
              <ProjectActivityFeed project={p} compact limit={10} />
            </Card>
          </div>
        </div>
      )}

      {tab === "description" && <ProjectDescription project={p} onChange={refresh} canEdit={amPm} />}
      {tab === "files" && <ProjectFiles project={p} onChange={refresh} />}

      {tab === "team" && (
        <div className="grid gap-5">
          <ProjectPeople project={p} onChange={refresh} />
          <Card title="Everyone on the project" sub="PMs assign Team Leads; each TL assigns the employees who log hours."
            actions={canTeam && <Button size="sm" variant="secondary" onClick={() => setModal("team")}><Users />Edit in bulk</Button>}>
            <DataTable rows={p.members} rowKey={(m: any) => m.id} rowHref={(m: any) => `/people/${m.id}`} search={false} pageSize={100}
              columns={[
                { key: "n", header: "Person", cell: (m: any) => <Person id={m.id} name={m.name} hasPhoto={m.has_photo} sub={[m.employee_code, m.designation].filter(Boolean).join(" · ")} />, sort: (m: any) => m.name },
                { key: "r", header: "Role", cell: (m: any) => (m.role === "pm" || m.id === p.pm_user_id ? (m.id === p.pm_user_id && pms.length > 1 ? "Project Manager (main)" : "Project Manager") : m.role === "tl" ? "Team Lead" : "Employee"), sort: (m: any) => ({ pm: 0, tl: 1, member: 2 } as any)[m.role] },
                { key: "t", header: "Team", cell: (m: any) => m.team_name ?? "—" },
                { key: "h", header: "Hours", cell: (m: any) => hrs(m.logged_minutes), sort: (m: any) => m.logged_minutes, align: "right" },
                { key: "l", header: "Last worked", cell: (m: any) => fmtDate(m.last_on), sort: (m: any) => m.last_on ?? "" },
                { key: "a", header: "Added", cell: (m: any) => <span className="text-[13px]">{fmtDate(m.assigned_at)}{m.assigned_by_name && <span className="text-[var(--muted)]"> by {m.assigned_by_name}</span>}</span> },
              ]} />
          </Card>
          <RoleHistory projectId={p.id} />
        </div>
      )}

      {tab === "billing" && (
        <Card title="Billing lines" actions={billing ? <Button size="sm" variant="secondary" onClick={() => setModal("line")}><Plus />Add billing line</Button> : undefined}>
          <p className="mb-3 text-[13.5px] text-[var(--muted)]">Each line is what the client agreed: these hours{moneyOn ? ", for this amount" : ""}, by this date. Approved hours fill the lines in order. Lines at 0 are non-billable.</p>
          <Table head={["Line", "Hours", "Used", ...(moneyOn ? ["Amount", "Invoice"] : []), "Date", "Kind", ""]} empty="No billing lines yet.">
            {p.billingLines.map((l: any) => (
              <tr key={l.id}>
                <td className="font-semibold">{l.label}</td><td className="tabnum">{hrs(l.minutes)}</td>
                <td className="min-w-36"><CapBar used={l.used_minutes} cap={l.minutes} /></td>
                {moneyOn && <td className="tabnum">{l.amount_minor ? money(l.amount_minor) : <Pill status="draft">Non-billable</Pill>}</td>}
                {moneyOn && <td>{l.invoice_id ? <Link to={`/invoices/${l.invoice_id}`} className="font-semibold hover:underline">{l.invoice_number}</Link> : l.amount_minor ? <span className="text-[var(--muted)]">Not yet</span> : "—"} {l.invoice_status && <Pill status={l.invoice_status} />}</td>}
                <td className="whitespace-nowrap">{fmtDate(l.due_date)}</td><td>{l.kind === "extra" ? "Extra" : "Plan"}</td>
                <td className="text-right">{billing && !l.invoice_id && !l.used_minutes && <Button size="sm" variant="ghost" onClick={() => run(() => del(`/billing-lines/${l.id}`), "Line removed")}>Remove</Button>}</td>
              </tr>
            ))}
          </Table>
          {can("invoices.manage") && has("projects_billing") && <Button className="mt-4" size="sm" variant="secondary" onClick={() => run(async () => { const x = await post(`/projects/${p.id}/run-billing`); toast(`${x.invoices.length} invoice(s) created`); }, "Checked for invoices due today")}>Create invoices due today</Button>}
        </Card>
      )}

      {tab === "tasks" && <TaskBoard project={p} onChange={refresh} />}
      {tab === "activity" && <ProjectActivity project={p} />}
      {tab === "about" && <ProjectAbout project={p} onChange={refresh} />}

      {tab === "invoices" && (
        <Card title="Invoices" actions={can("invoices.manage") ? <LinkButton size="sm" to={`/invoices/new?projectId=${p.id}`}><Plus />New invoice</LinkButton> : undefined}>
          <Table head={["Number", "Kind", "Date", "Due", ...(moneyOn ? ["Total", "Paid"] : []), "Status"]} empty="No invoices yet.">
            {p.invoices.map((i: any) => (
              <tr key={i.id}><td><Link className="font-semibold hover:underline" to={`/invoices/${i.id}`}>{i.number}</Link></td><td className="capitalize">{i.kind}</td><td>{fmtDate(i.issue_date)}</td><td>{fmtDate(i.due_date)}</td>
                {moneyOn && <><td className="tabnum">{money(i.total_minor)}</td><td className="tabnum">{money(i.paid_minor)}</td></>}<td><Pill status={i.status} /></td></tr>
            ))}
          </Table>
        </Card>
      )}

      {tab === "costs" && <Costs project={p} onChange={refresh} />}

      <ExtraHoursModal open={modal === "extra"} onClose={() => setModal(null)} projectId={p.id} currency={me!.settings.locale.currency} onDone={refresh} />
      <LineModal open={modal === "line"} onClose={() => setModal(null)} projectId={p.id} currency={me!.settings.locale.currency} onDone={refresh} />
      <TeamDrawer open={modal === "team"} onClose={() => setModal(null)} project={p} onDone={refresh} canSetTl={can("projects.assign")} />
      <BillingSettingsModal open={modal === "settings"} onClose={() => setModal(null)} project={p} currency={me!.settings.locale.currency} onDone={refresh} />
      <ProjectEditDrawer open={modal === "edit"} onClose={() => setModal(null)} project={p} onDone={refresh} />
    </>
  );
}

/** PM, Team Leads and members. A TL can only change members. */
export function TeamDrawer({ open, onClose, project: p, onDone, canSetTl }: { open: boolean; onClose: () => void; project: any; onDone: () => void; canSetTl: boolean }) {
  const users = useUsers(open);
  const { can, me } = useSession();
  const act = useAction();
  const [f, setF] = useState<any>(null);
  const canSetPm = can("projects.assign");
  // From the project page members carry a role; from the assignments page they come as separate pms/tls/members lists.
  const v = f ?? (p.tls ? {
    pmIds: (p.pms?.length ? p.pms.map((x: any) => x.id) : p.pm_user_id ? [p.pm_user_id] : []), tlIds: p.tls.map((t: any) => t.id), memberIds: p.members.map((m: any) => m.id),
  } : {
    pmIds: p.members.filter((m: any) => m.role === "pm" || m.id === p.pm_user_id).map((m: any) => m.id),
    tlIds: p.members.filter((m: any) => m.role === "tl").map((m: any) => m.id),
    memberIds: p.members.filter((m: any) => m.role === "member" && m.id !== p.pm_user_id).map((m: any) => m.id),
  });
  const close = () => { setF(null); act.setErr(null); onClose(); };
  const people = userOpts(users.data);
  const name = (i: string) => people.find((o) => o.value === i)?.label;
  return (
    <Drawer open={open} onClose={close} title={`Team for ${p.name}`}
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button busy={!!act.busy} onClick={async () => {
        const body: any = { memberIds: v.memberIds };
        if (canSetTl) body.tlIds = v.tlIds;
        if (canSetPm) body.pmIds = v.pmIds;
        if (await act.run(() => put(`/projects/${p.id}/members`, body), "Team saved")) { onDone(); close(); }
      }}>Save team</Button></>}>
      <div className="grid gap-5">
        <Field label="Project Managers" info="Plan the work and assign Team Leads. The first one is the main PM." hint={!canSetPm ? "Admin, Billing Manager or Sales assign Project Managers." : undefined}>
          {canSetPm ? <MultiSelect value={v.pmIds} onChange={(x) => setF({ ...v, pmIds: x, tlIds: v.tlIds.filter((t: string) => !x.includes(t)), memberIds: v.memberIds.filter((t: string) => !x.includes(t)) })} options={people} placeholder="Add a Project Manager" />
            : <div className="text-[14px]">{v.pmIds.map(name).join(", ") || "None"}</div>}
        </Field>
        <Field label="Team Leads" info="Assign members and approve their sheets for this project." hint={!canSetTl ? "Admin, Billing Manager or Sales assign Team Leads." : undefined}>
          {canSetTl ? <MultiSelect value={v.tlIds} onChange={(x) => setF({ ...v, tlIds: x, memberIds: v.memberIds.filter((t: string) => !x.includes(t)) })} options={people.filter((o) => !v.pmIds.includes(o.value))} placeholder="Add a Team Lead" />
            : <div className="text-[14px]">{v.tlIds.map(name).join(", ") || "None"}</div>}
        </Field>
        <Field label="Employees" hint="They can log hours on this project."><MultiSelect value={v.memberIds} onChange={(x) => setF({ ...v, memberIds: x })} options={people.filter((o) => !v.tlIds.includes(o.value) && !v.pmIds.includes(o.value))} placeholder="Search and add people" /></Field>
        <ErrorNote error={act.err} />
      </div>
    </Drawer>
  );
}

function ProjectEditDrawer({ open, onClose, project: p, onDone }: { open: boolean; onClose: () => void; project: any; onDone: () => void }) {
  const users = useUsers(open);
  const act = useAction();
  const [f, setF] = useState<any>(null);
  const [tag, setTag] = useState("");
  const v = f ?? { name: p.name, code: p.code ?? "", description: p.description ?? "", startDate: p.start_date ?? "", deliveryDate: p.delivery_date ?? "", salesUserId: p.sales_user_id ?? null,
    estimatorUserId: p.estimator_user_id ?? null, callerUserId: p.caller_user_id ?? null, tags: p.tags ?? [], isInternal: !!p.is_internal };
  const close = () => { setF(null); act.setErr(null); onClose(); };
  const people = userOpts(users.data);
  return (
    <Drawer open={open} onClose={close} title={`Edit ${p.name}`}
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button busy={!!act.busy} disabled={!v.name} onClick={async () => { if (await act.run(() => put(`/projects/${p.id}`, { ...v, startDate: v.startDate || null, deliveryDate: v.deliveryDate || null }), "Project saved")) { onDone(); close(); } }}>Save</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
          <Field label="Project name" required><Input value={v.name} onChange={(e) => setF({ ...v, name: e.target.value })} /></Field>
          <Field label="Code"><Input value={v.code} onChange={(e) => setF({ ...v, code: e.target.value })} /></Field>
        </div>
        <Field label="Description"><Textarea value={v.description} onChange={(e) => setF({ ...v, description: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date"><Input type="date" value={v.startDate} onChange={(e) => setF({ ...v, startDate: e.target.value })} /></Field>
          <Field label="Delivery date"><Input type="date" value={v.deliveryDate} onChange={(e) => setF({ ...v, deliveryDate: e.target.value })} /></Field>
          <Field label="Sales person"><Combobox value={v.salesUserId} onChange={(x) => setF({ ...v, salesUserId: x })} options={people} /></Field>
          <Field label="Estimated by" info="Who estimated the hours or price."><Combobox value={v.estimatorUserId} onChange={(x) => setF({ ...v, estimatorUserId: x })} options={people} /></Field>
          <Field label="Call person" info="Who handled the pre-sales calls."><Combobox value={v.callerUserId} onChange={(x) => setF({ ...v, callerUserId: x })} options={people} /></Field>
        </div>
        <Field label="Tags" hint="Press Enter to add a tag.">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--line)] p-1.5">
            {v.tags.map((t: string) => <span key={t} className="inline-flex items-center gap-1 rounded-md bg-black/5 px-2 py-0.5 text-[13px] dark:bg-white/10">#{t}<button aria-label={`Remove ${t}`} onClick={() => setF({ ...v, tags: v.tags.filter((x: string) => x !== t) })}>×</button></span>)}
            <input value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tag.trim()) { e.preventDefault(); setF({ ...v, tags: [...new Set([...v.tags, tag.trim().toLowerCase()])] }); setTag(""); } }} className="min-w-24 flex-1 bg-transparent px-1 text-[14px] outline-none" placeholder="e.g. shopify" />
          </div>
        </Field>
        <Checkbox label="Internal project" hint="Company work (training, hiring, meetings). Its hours count as in-house, never billable." checked={v.isInternal} onChange={(x) => setF({ ...v, isInternal: x })} />
        <ErrorNote error={act.err} />
      </div>
    </Drawer>
  );
}

const COLS = [{ id: "todo", label: "To do" }, { id: "in_progress", label: "In progress" }, { id: "review", label: "In review" }, { id: "done", label: "Done" }];
/** Tasks as a board (drag-free: change the status from the card) or a list, with details, assignee, priority and due date. */
function TaskBoard({ project, onChange }: { project: any; onChange: () => void }) {
  const { can, me } = useSession();
  const [view, setView] = useState<"board" | "list">("board");
  const [open, setOpen] = useState<any | null>(null);
  const [who, setWho] = useState("");
  const tasks = project.tasks.filter((t: any) => !who || (who === "me" ? t.assignee_id === me!.user.id : t.assignee_id === who));
  const canAdd = can("tasks.manage") || can("projects.manage") || project.pm_user_id === me!.user.id;
  const budget = useQuery({ queryKey: ["task-budget", project.id], queryFn: () => get<any>(`/projects/${project.id}/task-budget`) });
  const [extra, setExtra] = useState(false);
  const qc = useQueryClient();
  const b = budget.data;
  return (
    <>
      {b && b.cap === null && (
        <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-[var(--brand)]/40 bg-[var(--brand-soft)]/40 p-4">
          <div>
            <h3 className="text-[14.5px] font-bold">Set this project's hours first</h3>
            <p className="text-[12.5px] text-[var(--muted)]">Tasks are made from the project's hours: e.g. 50 h split into 5 tasks of 10 h. This project has no billed hours, so set how many hours the work has.</p>
          </div>
          {b.canAddHours ? <Button size="sm" onClick={() => setExtra(true)}><Timer />Set project hours</Button> : <span className="text-[12.5px] text-[var(--muted)]">Ask the project's PM to set them.</span>}
        </section>
      )}
      {b && b.cap !== null && (
        <section className="mb-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[14.5px] font-bold">Hours split into tasks</h3>
              <p className="text-[12.5px] text-[var(--muted)]">Each task gets part of the project's {hrs(b.cap)}. People can only log a task's hours up to what it was given.</p>
            </div>
            {b.canAddHours && <Button size="sm" variant="secondary" onClick={() => setExtra(true)}><Timer />{b.source === "budget" ? "Add hours" : "Add extra hours"}</Button>}
          </div>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/10">
            <span className="h-full bg-[var(--series-1)]" style={{ width: `${Math.min(100, (b.allocated / Math.max(1, b.cap)) * 100)}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
            <span><span className="text-[var(--muted)]">Project hours </span><b className="tabnum">{hrs(b.cap)}</b></span>
            <span><span className="inline-block size-2 rounded-full bg-[var(--series-1)] align-middle" /> <span className="text-[var(--muted)]">Given to tasks </span><b className="tabnum">{hrs(b.allocated)}</b></span>
            <span><span className="text-[var(--muted)]">Left to give out </span><b className={cx("tabnum", !b.available && "text-[#b4441f]")}>{hrs(b.available)}</b></span>
            <span><span className="text-[var(--muted)]">Logged so far </span><b className="tabnum">{hrs(b.logged)}</b></span>
          </div>
        </section>
      )}
      {b?.source === "budget"
        ? <BudgetHoursModal open={extra} onClose={() => setExtra(false)} projectId={project.id} budget={b} onDone={() => { qc.invalidateQueries({ queryKey: ["task-budget"] }); onChange(); }} />
        : <ExtraHoursModal open={extra} onClose={() => setExtra(false)} projectId={project.id} currency={me!.settings.locale.currency} onDone={() => { qc.invalidateQueries({ queryKey: ["task-budget", project.id] }); onChange(); }} />}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Segmented value={view} onChange={setView} options={[{ id: "board", label: <span className="inline-flex items-center gap-1.5"><LayoutGrid className="size-3.5" />Board</span> }, { id: "list", label: <span className="inline-flex items-center gap-1.5"><List className="size-3.5" />List</span> }]} />
          <Select value={who} onChange={(e) => setWho(e.target.value)} className="h-9 w-44" aria-label="Assignee"><option value="">Everyone's tasks</option><option value="me">My tasks</option>{project.members.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
        </div>
        {canAdd && <Button size="sm" onClick={() => setOpen({})}><Plus />New task</Button>}
      </div>
      {view === "board" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLS.map((c) => {
            const list = tasks.filter((t: any) => t.status === c.id);
            return (
              <div key={c.id} className="rounded-xl bg-black/[.03] p-3 dark:bg-white/5">
                <div className="mb-3 flex items-center justify-between px-1"><span className="text-[13px] font-bold">{c.label}</span><span className="text-[12px] font-semibold text-[var(--muted)] tabnum">{list.length}</span></div>
                <div className="grid gap-2">
                  {list.map((t: any) => (
                    <button key={t.id} onClick={() => setOpen(t)} className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-3 text-left shadow-sm hover:border-[var(--brand)]/50">
                      <div className="flex items-start justify-between gap-2"><span className={cx("text-[14px] font-semibold", t.status === "done" && "text-[var(--muted)] line-through")}>{t.title}</span><Pill status={t.priority}>{t.priority}</Pill></div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--muted)]">
                        <span>{t.assignee_name ?? "Unassigned"}</span>
                        {t.due_date && <span className={cx("inline-flex items-center gap-1", t.status !== "done" && t.due_date < new Date().toISOString().slice(0, 10) && "font-semibold text-[#9c3a19]")}><CalendarClock className="size-3" />{fmtDate(t.due_date, { day: "numeric", month: "short" })}</span>}
                        {!t.estimated_minutes && t.logged_minutes > 0 && <span>{hrs(t.logged_minutes)} logged</span>}
                        {t.log_count > 0 && <span>{t.log_count} sheet notes</span>}
                        {t.comment_count > 0 && <span>{t.comment_count} comments</span>}
                      </div>
                      {t.estimated_minutes > 0 && (
                        <div className="mt-2.5">
                          <div className="flex justify-between text-[11.5px] text-[var(--muted)] tabnum"><span>{hrs(t.logged_minutes)} of {hrs(t.estimated_minutes)}</span><span className={cx(t.logged_minutes >= t.estimated_minutes && "font-semibold text-[#b4441f]")}>{t.logged_minutes >= t.estimated_minutes ? "No hours left" : `${hrs(t.estimated_minutes - t.logged_minutes)} left`}</span></div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[.07] dark:bg-white/10"><div className={cx("h-full rounded-full", t.logged_minutes >= t.estimated_minutes ? "bg-[#b4441f]" : t.logged_minutes >= t.estimated_minutes * 0.8 ? "bg-[#e08a1e]" : "bg-[var(--series-1)]")} style={{ width: `${Math.min(100, (t.logged_minutes / t.estimated_minutes) * 100)}%` }} /></div>
                        </div>
                      )}
                    </button>
                  ))}
                  {!list.length && <p className="px-1 py-4 text-center text-[12.5px] text-[var(--muted)]">Nothing here</p>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <DataTable rows={tasks} rowKey={(t: any) => t.id} onRowClick={setOpen} searchPlaceholder="Search tasks" pageSize={50}
          columns={[
            { key: "t", header: "Task", cell: (t: any) => <span className="font-semibold">{t.title}</span>, sort: (t: any) => t.title, text: (t: any) => `${t.title} ${t.description}` },
            { key: "a", header: "Assignee", cell: (t: any) => t.assignee_name ?? "—", sort: (t: any) => t.assignee_name ?? "", text: (t: any) => t.assignee_name ?? "" },
            { key: "p", header: "Priority", cell: (t: any) => <Pill status={t.priority}>{t.priority}</Pill>, sort: (t: any) => ({ high: 0, medium: 1, low: 2 } as any)[t.priority] },
            { key: "d", header: "Due", cell: (t: any) => fmtDate(t.due_date), sort: (t: any) => t.due_date ?? "9" },
            { key: "e", header: "Hours given", cell: (t: any) => hrs(t.estimated_minutes), align: "right", sort: (t: any) => t.estimated_minutes ?? 0 },
            { key: "h", header: "Logged", cell: (t: any) => hrs(t.logged_minutes), align: "right", sort: (t: any) => t.logged_minutes },
            { key: "l", header: "Left", cell: (t: any) => (t.estimated_minutes ? <span className={cx(t.logged_minutes >= t.estimated_minutes && "font-semibold text-[#b4441f]")}>{hrs(Math.max(0, t.estimated_minutes - t.logged_minutes))}</span> : "—"), align: "right", sort: (t: any) => (t.estimated_minutes ?? 0) - t.logged_minutes },
            { key: "s", header: "Status", cell: (t: any) => <Pill status={t.status} />, sort: (t: any) => t.status },
          ]} />
      )}
      <TaskDrawer task={open} project={project} onClose={() => setOpen(null)} onDone={onChange} />
    </>
  );
}
function TaskDrawer({ task, project, onClose, onDone }: { task: any; project: any; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const confirm = useConfirm();
  const { can, me } = useSession();
  const qc = useQueryClient();
  const budget = useQuery({ queryKey: ["task-budget", project.id, task?.id ?? "new"], queryFn: () => get<any>(`/projects/${project.id}/task-budget${task?.id ? `?exclude=${task.id}` : ""}`), enabled: !!task });
  const [extra, setExtra] = useState(false);
  const isNew = task && !task.id;
  const [f, setF] = useState<any>(null);
  const v = f ?? { title: task?.title ?? "", description: task?.description ?? "", assigneeId: task?.assignee_id ?? null, status: task?.status ?? "todo", priority: task?.priority ?? "medium", dueDate: task?.due_date ?? "", estimatedMinutes: task?.estimated_minutes ?? null, links: task?.links ?? [] };
  const close = () => { setF(null); act.setErr(null); onClose(); };
  return (
    <Drawer open={!!task} onClose={close} title={isNew ? "New task" : "Task"} width="max-w-2xl"
      footer={<>
        {task?.id && (can("tasks.manage") || can("projects.manage")) && <Button variant="ghost" className="mr-auto text-[#9c3a19]" onClick={async () => { if (await confirm({ title: "Delete this task?", danger: true, confirm: "Delete" }) !== false && await act.run(() => del(`/tasks/${task.id}`), "Task deleted")) { onDone(); close(); } }}>Delete</Button>}
        <Button variant="secondary" onClick={close}>Cancel</Button>
        <Button busy={!!act.busy} disabled={!v.title} onClick={async () => { const body = { ...v, dueDate: v.dueDate || null }; if (await act.run(() => (isNew ? post(`/projects/${project.id}/tasks`, body) : put(`/tasks/${task.id}`, body)), "Task saved")) { qc.invalidateQueries({ queryKey: ["task-budget", project.id] }); onDone(); close(); } }}>Save task</Button>
      </>}>
      <div className="grid gap-4">
        <Field label="Task" required><Input value={v.title} onChange={(e) => setF({ ...v, title: e.target.value })} placeholder="What needs doing" /></Field>
        <Field label="Details"><Textarea value={v.description} onChange={(e) => setF({ ...v, description: e.target.value })} className="min-h-32" placeholder="Steps, acceptance criteria, links" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assignee"><Combobox value={v.assigneeId} onChange={(x) => setF({ ...v, assigneeId: x })} options={project.members.map((m: any) => ({ value: m.id, label: m.name }))} placeholder="Unassigned" /></Field>
          <Field label="Status"><Select value={v.status} onChange={(e) => setF({ ...v, status: e.target.value })}>{COLS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
          <Field label="Priority"><Select value={v.priority} onChange={(e) => setF({ ...v, priority: e.target.value })}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select></Field>
          <Field label="Due date"><Input type="date" value={v.dueDate} onChange={(e) => setF({ ...v, dueDate: e.target.value })} /></Field>
          <Field label="Hours for this task" required
            hint={budget.data?.cap != null ? `${hrs(budget.data.available)} of the project's ${hrs(budget.data.cap)} left to give out` : "Set the project's hours first; tasks share them out."}>
            <HoursInput value={v.estimatedMinutes} onChange={(m) => setF({ ...v, estimatedMinutes: m })} />
          </Field>
          {task?.id && <Field label="Logged so far"><div className="flex h-10 items-center text-[14px] font-semibold tabnum">{hrs(task.logged_minutes)}{task.estimated_minutes ? <span className="ml-1 font-normal text-[var(--muted)]">of {hrs(task.estimated_minutes)}</span> : null}</div></Field>}
        </div>
        {budget.data && budget.data.cap === null && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#f0a531]/50 bg-[#fdf3e1] px-4 py-3 text-[13.5px] text-[#6b4100] dark:bg-[#7d4c00]/20 dark:text-[#f5c879]">
            <span><b>Hours balance is 0.</b> This project has no hours to share out yet.</span>
            {budget.data.canAddHours ? <Button size="sm" onClick={() => setExtra(true)}><Timer />Set project hours</Button> : <span className="text-[12.5px]">Ask the project's PM to set them.</span>}
          </div>
        )}
        {budget.data?.cap != null && (!budget.data.available || (v.estimatedMinutes ?? 0) > budget.data.available) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#f0a531]/50 bg-[#fdf3e1] px-4 py-3 text-[13.5px] text-[#6b4100] dark:bg-[#7d4c00]/20 dark:text-[#f5c879]">
            <span>{!budget.data.available ? <><b>Hours balance is 0.</b> All of the project's {hrs(budget.data.cap)} is given to tasks already.</> : <><b>Only {hrs(budget.data.available)} left</b> to give out; this task needs {hrs((v.estimatedMinutes ?? 0) - budget.data.available)} more.</>}</span>
            {budget.data.canAddHours ? <Button size="sm" onClick={() => setExtra(true)}><Timer />{budget.data.source === "budget" ? "Add hours" : "Add extra hours"}</Button> : <span className="text-[12.5px]">{budget.data.source === "budget" ? "Ask the project's PM to add hours." : "Ask the Billing Manager to add extra hours."}</span>}
          </div>
        )}
        {budget.data?.source === "budget" ? (
          <BudgetHoursModal open={extra} onClose={() => setExtra(false)} projectId={project.id} budget={budget.data} reason={v.title ? `For task: ${v.title}` : ""}
            minutes={Math.max(60, (v.estimatedMinutes ?? 0) - (budget.data.available ?? 0))}
            onDone={() => { qc.invalidateQueries({ queryKey: ["task-budget"] }); onDone(); }} />
        ) : (
        <ExtraHoursModal open={extra} onClose={() => setExtra(false)} projectId={project.id} currency={me!.settings.locale.currency} label={v.title ? `Extra hours: ${v.title}` : undefined}
          minutes={budget.data ? Math.max(60, (v.estimatedMinutes ?? 0) - (budget.data.available ?? 0)) : null}
          onDone={() => { qc.invalidateQueries({ queryKey: ["task-budget", project.id] }); onDone(); }} />
        )}
        <Field label="Links" hint="One per line (designs, tickets, documents)"><Textarea plain value={v.links.join("\n")} onChange={(e) => setF({ ...v, links: e.target.value.split("\n").map((x) => x.trim()).filter((x) => /^https?:\/\//.test(x)) })} className="min-h-16" placeholder="https://" /></Field>
        {v.links.length > 0 && <ul className="-mt-2 grid gap-1 text-[13px]">{v.links.map((l: string) => <li key={l}><a href={l} target="_blank" rel="noreferrer" className="font-semibold text-[var(--brand)] underline">{l}</a></li>)}</ul>}
        <ErrorNote error={act.err} />
        {task?.id && (
          <div className="border-t border-[var(--line)] pt-4">
            <h3 className="text-[14px] font-bold">Task activity</h3>
            <p className="mb-3 text-[13px] text-[var(--muted)]">What people wrote on their sheets for this task, who approved them, changes and comments.</p>
            <ProjectActivityFeed project={project} taskId={task.id} />
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** Hours for a project with no billing: the PM sets them once, then adds more when a task needs it. */
function BudgetHoursModal({ open, onClose, projectId, budget, onDone, minutes, reason }: { open: boolean; onClose: () => void; projectId: string; budget: any; onDone: () => void; minutes?: number; reason?: string }) {
  const toast = useToast();
  const first = budget?.cap == null;
  const [f, setF] = useState({ minutes: (minutes ?? null) as number | null, reason: reason ?? "" });
  useEffect(() => { if (open) setF({ minutes: minutes ?? null, reason: reason ?? "" }); }, [open, minutes, reason]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const after = (budget?.cap ?? 0) + (f.minutes ?? 0);
  return (
    <Modal open={open} onClose={onClose} title={first ? "Set project hours" : "Add hours"}>
      <p className="mb-4 text-sm text-[var(--muted)]">{first ? "How many hours the work on this project has in total. Tasks then share them out, each with its own cap." : `The project has ${hrs(budget?.cap)}; ${hrs(budget?.allocated)} is given to tasks. Add hours so new or bigger tasks fit.`}</p>
      <div className="grid gap-4">
        <Field label={first ? "Project hours" : "Hours to add"} required><HoursInput value={f.minutes} onChange={(m) => setF({ ...f, minutes: m })} /></Field>
        <Field label="Reason" hint="Shown in the project's activity"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={first ? "e.g. Estimate agreed with the client" : "e.g. New screens added to scope"} /></Field>
        {!first && !!f.minutes && <p className="text-[13px] text-[var(--muted)]">The project will have <b className="text-[var(--text)] tabnum">{hrs(after)}</b>, with <b className="text-[var(--text)] tabnum">{hrs(after - (budget?.allocated ?? 0))}</b> left to give to tasks.</p>}
        <ErrorNote error={err} />
        <Button busy={busy} disabled={!f.minutes} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            await put(`/projects/${projectId}/task-budget`, first ? { minutes: f.minutes, reason: f.reason } : { addMinutes: f.minutes, reason: f.reason });
            toast(first ? "Project hours set" : "Hours added"); onDone(); onClose();
          } catch (e) { setErr(e); } finally { setBusy(false); }
        }}>{first ? "Set hours" : "Add hours"}</Button>
      </div>
    </Modal>
  );
}

function ExtraHoursModal({ open, onClose, projectId, currency, onDone, minutes, label }: { open: boolean; onClose: () => void; projectId: string; currency: string; onDone: () => void; minutes?: number | null; label?: string }) {
  const toast = useToast();
  const [f, setF] = useState({ label: label ?? "Extra hours", minutes: minutes ?? (null as number | null), amountMinor: 0 as number | null, paidNowMinor: null as number | null });
  useEffect(() => { if (open) setF((x) => ({ ...x, minutes: minutes ?? x.minutes, label: label ?? x.label })); }, [open, minutes, label]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Add extra hours">
      <p className="mb-4 text-sm text-[var(--muted)]">Leave the amount at 0 when the team needs more time at no charge (non-billable). Add an amount when the client pays for new work; eszy creates the invoice now.</p>
      <div className="grid gap-4">
        <Field label="Label"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hours"><HoursInput value={f.minutes} onChange={(m) => setF({ ...f, minutes: m })} /></Field>
          <Field label="Amount" hint="0 = non-billable"><MoneyInput currency={currency} value={f.amountMinor} onChange={(m) => setF({ ...f, amountMinor: m })} /></Field>
        </div>
        {!!f.amountMinor && <Field label="Already received (optional)"><MoneyInput currency={currency} value={f.paidNowMinor} onChange={(m) => setF({ ...f, paidNowMinor: m })} /></Field>}
        <ErrorNote error={err} />
        <Button busy={busy} disabled={!f.minutes} onClick={async () => {
          setBusy(true); setErr(null);
          try { const r = await post(`/projects/${projectId}/extra-hours`, { label: f.label, minutes: f.minutes, amountMinor: f.amountMinor ?? 0, paidNowMinor: f.paidNowMinor ?? 0 }); toast(r.invoices.length ? `Hours added and invoice ${r.invoices[0].number} created` : "Non-billable hours added"); onDone(); onClose(); }
          catch (e) { setErr(e); } finally { setBusy(false); }
        }}>Add hours</Button>
      </div>
    </Modal>
  );
}

function LineModal({ open, onClose, projectId, currency, onDone }: { open: boolean; onClose: () => void; projectId: string; currency: string; onDone: () => void }) {
  const [f, setF] = useState({ label: "", minutes: null as number | null, amountMinor: null as number | null, dueDate: "" });
  const [err, setErr] = useState<unknown>(null);
  return (
    <Modal open={open} onClose={onClose} title="Add billing line">
      <div className="grid gap-4">
        <Field label="Label"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. Next 50 hours" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hours"><HoursInput value={f.minutes} onChange={(m) => setF({ ...f, minutes: m })} /></Field>
          <Field label="Amount"><MoneyInput currency={currency} value={f.amountMinor} onChange={(m) => setF({ ...f, amountMinor: m })} /></Field>
        </div>
        <Field label="Date" hint="Invoiced on this date. Blank = today."><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <ErrorNote error={err} />
        <Button disabled={!f.label || f.minutes == null} onClick={async () => { try { await post(`/projects/${projectId}/billing-lines`, { ...f, amountMinor: f.amountMinor ?? 0, dueDate: f.dueDate || null }); onDone(); onClose(); } catch (e) { setErr(e); } }}>Add line</Button>
      </div>
    </Modal>
  );
}

function BillingSettingsModal({ open, onClose, project: p, currency, onDone }: { open: boolean; onClose: () => void; project: any; currency: string; onDone: () => void }) {
  const [f, setF] = useState<any>(null);
  const v = f ?? { hourlyRateMinor: p.hourly_rate_minor, billingCapMinutes: p.billing_cap_minutes, billingPeriod: p.billing_period ?? "week", dueDays: p.due_days, dueSoonDays: p.due_soon_days, dueSoonClientEmail: p.due_soon_client_email, invoicing: p.invoicing };
  const [sch, setSch] = useState<ScheduleValue | null>(null);
  const schedule = sch ?? scheduleFromProject(p);
  const [err, setErr] = useState<unknown>(null);
  const recurring = p.type === "hourly" && v.invoicing === "recurring";
  return (
    <Modal open={open} onClose={() => { setF(null); setSch(null); onClose(); }} title="Billing settings" wide>
      <div className="grid gap-4">
        {p.type === "hourly" && <Field label="Hourly rate"><MoneyInput currency={currency} value={v.hourlyRateMinor} onChange={(m) => setF({ ...v, hourlyRateMinor: m })} /></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Billing cap"><HoursInput value={v.billingCapMinutes} onChange={(m) => setF({ ...v, billingCapMinutes: m })} /></Field>
          <Field label="Per"><Select value={v.billingPeriod} onChange={(e) => setF({ ...v, billingPeriod: e.target.value })}><option value="week">Week</option><option value="month">Month</option></Select></Field>
          <Field label="Due days"><Input type="number" value={v.dueDays ?? ""} onChange={(e) => setF({ ...v, dueDays: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
          <Field label="Due soon (days before)" hint="Blank = company setting"><Input type="number" value={v.dueSoonDays ?? ""} onChange={(e) => setF({ ...v, dueSoonDays: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        </div>
        {p.type === "hourly" && (
          <div className="rounded-2xl border border-[var(--line)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="text-[14.5px] font-bold">Invoicing</h3><p className="text-[12.5px] text-[var(--muted)]">{p.billing_type === "prepaid" ? "Prepaid hours are invoiced at the start of each period." : "Approved hours are invoiced after each period."}</p></div>
              <Select value={v.invoicing} onChange={(e) => setF({ ...v, invoicing: e.target.value })} className="w-48" aria-label="Invoicing"><option value="one_time">One-time</option><option value="recurring">Recurring</option></Select>
            </div>
            {recurring ? <InvoiceScheduleFields value={schedule} onChange={setSch} capPeriod={v.billingPeriod} prepaid={p.billing_type === "prepaid"} />
              : <p className="text-[13px] text-[var(--muted)]">{p.billing_type === "prepaid" ? "Invoices go out for each billing line on its date." : "One invoice for all approved hours when the project ends."} Switch to Recurring to invoice on a schedule.</p>}
          </div>
        )}
        <Field label="Client reminder email when due soon"><Select value={v.dueSoonClientEmail === null ? "" : String(v.dueSoonClientEmail)} onChange={(e) => setF({ ...v, dueSoonClientEmail: e.target.value === "" ? null : e.target.value === "true" })}><option value="">Use company setting</option><option value="true">Send</option><option value="false">Don't send</option></Select></Field>
        <ErrorNote error={err} />
        <Button onClick={async () => { setErr(null); try { const b: any = { ...v, ...(recurring ? scheduleBody(schedule) : { invoiceFrequency: null }) }; if (p.type !== "hourly") { delete b.hourlyRateMinor; delete b.invoicing; delete b.invoiceFrequency; } await put(`/projects/${p.id}`, b); onDone(); setF(null); setSch(null); onClose(); } catch (e) { setErr(e); } }}>Save</Button>
      </div>
    </Modal>
  );
}

function Costs({ project, onChange }: { project: any; onChange: () => void }) {
  const { money, me, can } = useSession();
  const rates = useQuery({ queryKey: ["rates-projects"], queryFn: () => get<any[]>("/rates/projects"), enabled: can("money.view") });
  const r = rates.data?.find((x) => x.project_id === project.id);
  const [f, setF] = useState({ date: "", description: "", amountMinor: null as number | null });
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="grid gap-5">
      {r && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Stat label="Revenue" value={money(r.revenue_minor)} sub="Invoiced, less refunds" />
          <Stat label="Project rate" value={r.rate_minor ? `${money(r.rate_minor)}/h` : "—"} sub={`${formatMinutes(r.minutes)} approved`} />
          <Stat label="Team cost" value={money(r.labour_cost_minor)} sub="Hours × cost per hour" />
          <Stat label="Expenses" value={money(r.expenses_minor)} />
          <Stat label="Profit" value={money(r.profit_minor)} tone={r.profit_minor < 0 ? "late" : "paid"} />
        </div>
      )}
      <Card title="Expenses">
        {can("expenses.manage") && (
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="What for" className="min-w-60 flex-1"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <Field label="Amount"><MoneyInput currency={me!.settings.locale.currency} value={f.amountMinor} onChange={(m) => setF({ ...f, amountMinor: m })} /></Field>
            <Button disabled={!f.date || !f.description || !f.amountMinor} onClick={async () => { try { await post("/expenses", { ...f, projectId: project.id }); setF({ date: "", description: "", amountMinor: null }); onChange(); rates.refetch(); } catch (e) { setErr(e); } }}>Add</Button>
          </div>
        )}
        <ErrorNote error={err} />
        <Table head={["Date", "Description", "Amount", ""]} empty="No expenses recorded.">
          {project.expenses.map((x: any) => <tr key={x.id}><td>{x.date}</td><td>{x.description}</td><td className="tabnum">{money(x.amount_minor)}</td><td className="text-right">{can("expenses.manage") && <Button size="sm" variant="ghost" onClick={async () => { await del(`/expenses/${x.id}`); onChange(); rates.refetch(); }}>Remove</Button>}</td></tr>)}
        </Table>
      </Card>
    </div>
  );
}

function HeroStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "late" }) {
  return (
    <div className="min-w-0">
      <span className="block truncate text-[12.5px] font-medium text-[var(--muted)]">{label}</span>
      <div className={cx("mt-1 whitespace-nowrap text-[18px] font-semibold tracking-[-0.02em] tabnum", tone === "late" && "text-[#b4441f] dark:text-[#f3a98c]")}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

/** Who has been PM and Team Lead of the project, when, and what they approved while in the role. Kept after a handover. */
function RoleHistory({ projectId }: { projectId: string }) {
  const q = useQuery({ queryKey: ["role-history", projectId], queryFn: () => get<any[]>(`/projects/${projectId}/role-history`) });
  const rows = q.data ?? [];
  return (
    <Card title="PMs and Team Leads over time" sub="Everyone who has led this project. Their approvals, comments and activity stay on the project after they hand over.">
      <DataTable rows={rows} loading={q.isLoading} rowKey={(r: any) => r.id} rowHref={(r: any) => `/people/${r.user_id}`} search={false} pageSize={50} empty="No PM or Team Lead yet."
        columns={[
          { key: "n", header: "Person", cell: (r: any) => <span className="font-semibold">{r.user_name}</span>, sort: (r: any) => r.user_name },
          { key: "r", header: "Role", cell: (r: any) => <Pill status={r.role === "pm" ? "brand" : "wfh"}>{r.role === "pm" ? "Project Manager" : "Team Lead"}</Pill>, text: (r: any) => (r.role === "pm" ? "Project Manager" : "Team Lead") },
          { key: "s", header: "From", cell: (r: any) => fmtDate(r.started_at), sort: (r: any) => r.started_at },
          { key: "e", header: "Until", cell: (r: any) => (r.ended_at ? fmtDate(r.ended_at) : <Pill status="active">Now</Pill>), sort: (r: any) => r.ended_at ?? "9999" },
          { key: "h", header: "Handed to", cell: (r: any) => r.handed_to_name ?? "—", text: (r: any) => r.handed_to_name ?? "" },
          { key: "a", header: "Sheets approved", cell: (r: any) => r.approvals, sort: (r: any) => r.approvals, align: "right" },
          { key: "l", header: "Last approval", cell: (r: any) => fmtDate(r.last_approval), sort: (r: any) => r.last_approval ?? "" },
        ]} />
    </Card>
  );
}
