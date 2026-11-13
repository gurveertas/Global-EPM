import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatMinutes } from "@eszy/shared";
import { get, qs } from "../lib/api";
import { useSession } from "../lib/session";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, CalendarCheck, CheckSquare, ClipboardList, Hourglass, Receipt, Wallet } from "lucide-react";
import { Ring } from "../components/magic";
import { Card, CapBar, DateRange, LinkButton, Pill, Progress, Spinner, Stat, StatGrid, cx, useRange } from "../components/ui";
import { BarChart, CATS, HBars, SplitBar } from "../components/Charts";
import { Person } from "../components/Avatar";

export function Dashboard() {
  const { me, money, can, has } = useSession();
  const [range, setRange] = useRange("month");
  const rq = qs({ from: range.from, to: range.to });
  const q = useQuery({ queryKey: ["dashboard", range.from, range.to], queryFn: () => get(`/dashboard${rq}`), placeholderData: (p: any) => p });
  const x = useQuery({ queryKey: ["dashboard", "extra", range.from, range.to], queryFn: () => get(`/dashboard/extra${rq}`), placeholderData: (p: any) => p });
  const perf = useQuery({ queryKey: ["perf-me", "month"], queryFn: () => get("/performance/me?period=month"), enabled: has("performance_rates") });
  const charts = useQuery({ queryKey: ["charts", range.from, range.to], queryFn: () => get(`/charts${range.preset === "month" ? "" : rq}`), placeholderData: (p: any) => p });
  const period = RANGE_WORD[range.preset] ?? "in these dates";
  if (q.isLoading) return <Spinner />;
  const d = q.data ?? {};
  const e = x.data ?? {};
  const first = me!.user.name.split(" ")[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const status = d.mySheet?.status ?? "none";
  const statusText: Record<string, string> = { none: "Today's sheet isn't started", draft: "Today's sheet is a draft", submitted: "Today's sheet is waiting for approval", approved: "Today's sheet is approved", rejected: "Today's sheet was sent back" };
  const monthPct = e.me?.expected ? Math.round((e.me.logged / e.me.expected) * 100) : null;
  return (
    <>
      {/* welcome */}
      <section className="relative mb-6 overflow-hidden rounded-3xl border border-transparent bg-[#0b0912] p-6 text-white dark:border-white/10 dark:bg-[linear-gradient(135deg,#120d1f,#0b0912)] shadow-[0_30px_80px_-40px_rgb(109_40_217/.9)] sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 size-96 rounded-full bg-[#7c3aed]/45 blur-[100px]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/3 size-80 rounded-full bg-[#c026d3]/20 blur-[100px]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:36px_36px] [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[13.5px] text-white/55">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
            <h1 className="mt-1 font-display text-[clamp(26px,3vw,34px)] font-bold tracking-[-0.03em]">{greet}, {first}</h1>
            <p className="mt-2 flex items-center gap-2 text-[14px] text-white/70"><span className={cx("size-2 rounded-full", status === "approved" ? "bg-[#34d399]" : status === "submitted" ? "bg-[#b25cff]" : status === "rejected" ? "bg-[#fb923c]" : "bg-white/40")} />{statusText[status] ?? statusText.none}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {can("time.own") && has("people_time") && <LinkButton to="/sheet" variant="primary"><ClipboardList />{status === "none" ? "Fill today's sheet" : "Open today's sheet"}</LinkButton>}
              {d.sheetsToApprove > 0 && <Link to="/approvals" className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/[.06] px-4 text-sm font-semibold backdrop-blur transition hover:bg-white/[.12]"><CheckSquare className="size-4" />{d.sheetsToApprove} sheets to approve</Link>}
              {d.requestsToApprove > 0 && <Link to="/leave?tab=team" className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/[.06] px-4 text-sm font-semibold backdrop-blur transition hover:bg-white/[.12]"><CalendarCheck className="size-4" />{d.requestsToApprove} leave requests</Link>}
            </div>
          </div>
          {e.me && (
            <div className="flex items-center gap-5 rounded-2xl border border-white/10 bg-white/[.04] p-4 backdrop-blur">
              <Ring value={e.me.logged} max={e.me.expected || 1} size={104} stroke={10}><div className="text-center"><div className="font-display text-[20px] font-bold">{monthPct ?? 0}%</div><div className="text-[10.5px] text-white/50">of the month</div></div></Ring>
              <dl className="grid gap-1.5 text-[13px]">
                <div className="flex justify-between gap-6"><dt className="text-white/55">Logged</dt><dd className="font-semibold tabnum">{hrs2(e.me.logged)}</dd></div>
                <div className="flex justify-between gap-6"><dt className="text-white/55">Expected</dt><dd className="font-semibold tabnum">{hrs2(e.me.expected)}</dd></div>
                <div className="flex justify-between gap-6"><dt className="text-white/55">This week</dt><dd className="font-semibold tabnum">{hrs2(d.myWeekMinutes ?? 0)}</dd></div>
                <div className="flex justify-between gap-6"><dt className="text-white/55">Unfilled days</dt><dd className={cx("font-semibold tabnum", e.me.unfilled_days.length ? "text-[#fdba74]" : "text-[#6ee7b7]")}>{e.me.unfilled_days.length}</dd></div>
              </dl>
            </div>
          )}
        </div>
        {d.missingDays?.length > 0 && (
          <p className="relative mt-5 rounded-xl border border-[#f0a531]/30 bg-[#f0a531]/10 px-4 py-2.5 text-[13.5px] text-[#ffd08a]">
            <b>Not submitted:</b>{" "}{d.missingDays.map((dd: string, i: number) => <span key={dd}>{i > 0 && ", "}<Link className="font-semibold underline underline-offset-2" to={`/sheet?date=${dd}`}>{day(dd)}</Link></span>)}
          </p>
        )}
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[16px] font-bold">Overview <span className="font-medium text-[var(--muted)]">{period}</span></h2>
        <DateRange value={range} onChange={setRange} presets={["today", "week", "last_week", "month", "last_month", "quarter", "year"]} />
      </div>
      {d.money && (
        <StatGrid cols={4}>
          <Stat label={`Invoiced ${period}`} value={money(d.money.invoiced_month)} sub="Before tax" icon={<Receipt />} />
          <Stat label={`Collected ${period}`} value={money(d.money.collected_month)} tone="paid" icon={<Wallet />} />
          <Stat label="Outstanding" value={money(d.money.outstanding)} sub={`${d.money.due_soon_count} due soon`} tone="amber" icon={<Hourglass />} />
          <Stat label="Overdue" value={money(d.money.overdue)} sub={`${d.money.overdue_count} invoices`} tone={d.money.overdue_count ? "late" : undefined} icon={<AlertTriangle />} />
        </StatGrid>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-5">
          {e.me && (
            <Card title={range.preset === "month" ? "My month so far" : `My hours ${period}`} sub="Expected hours follow your working days, leave, WFH and holidays.">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                {[["Approved billable", hrs2(e.me.billable), "text-brand-gradient"], ["Waiting for approval", hrs2(e.me.pending), ""], ["Working days", String(e.me.working_days), ""], ["Unfilled days", String(e.me.unfilled_days.length), e.me.unfilled_days.length ? "text-[#b4441f]" : "text-[#1c7a4f]"]].map(([l, v, c]) => (
                  <div key={l} className="min-w-0"><div className="truncate text-[12.5px] text-[var(--muted)]">{l}</div><div className={cx("mt-0.5 whitespace-nowrap font-display text-[20px] font-bold tabnum", c)}>{v}</div></div>
                ))}
              </div>
              <div className="mt-5"><SplitBar format={hrs2} parts={[...CATS.map((c) => ({ key: c.key, label: c.label, value: e.me[c.key], color: c.color })), { key: "p", label: "Waiting", value: e.me.pending, color: "var(--series-4)" }]} /></div>
            </Card>
          )}
          <Charts data={charts.data} label={range.preset === "month" ? "last 14 days" : period} />
          {(e.myProjects?.length > 0 || e.myTasks?.length > 0) && (
            <div className={cx("grid gap-5", e.myProjects?.length > 0 && e.myTasks?.length > 0 && "lg:grid-cols-2")}>
              {e.myProjects?.length > 0 && (
                <Card title="My projects" actions={<CardLink to="/projects?status=active">All projects</CardLink>}>
                  <ul className={cx("grid gap-4", !(e.myTasks?.length > 0) && e.myProjects.length > 1 && "sm:grid-cols-2 sm:gap-x-8")}>
                    {e.myProjects.map((p: any) => (
                      <li key={p.id}>
                        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13.5px]"><Link to={`/projects/${p.id}`} className="truncate font-semibold hover:underline">{p.name}</Link><span className="shrink-0 whitespace-nowrap text-[12px] text-[var(--muted)]">me {hrs2(p.my_month_minutes)} this month</span></div>
                        {p.cap_minutes ? <CapBar used={p.logged_minutes} cap={p.cap_minutes} /> : <span className="text-[12.5px] text-[var(--muted)]">{hrs2(p.logged_minutes)} logged, no cap</span>}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {e.myTasks?.length > 0 && (
                <Card title="My open tasks">
                  <ul className="-my-1 divide-y divide-[var(--line)]">
                    {e.myTasks.map((t: any) => (
                      <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]">
                        <span className="min-w-0"><Link to={`/projects/${t.project_id}?tab=tasks`} className="block truncate font-semibold hover:underline">{t.title}</Link><span className="block truncate text-[12px] text-[var(--muted)]">{t.project_name}{t.due_date && ` · due ${day(t.due_date)}`}</span></span>
                        <span className="flex shrink-0 gap-1"><Pill status={t.priority}>{t.priority}</Pill><Pill status={t.status} /></span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
          {d.projectsNearCap && (
            <Card title="Projects near their cap" sub="Active projects above 85% of their hours" actions={<CardLink to="/projects">All projects</CardLink>}>
              {d.projectsNearCap.length === 0 ? <p className="text-[13.5px] text-[var(--muted)]">No active project is above 85% of its hours.</p> : (
                <ul className="grid gap-4 sm:grid-cols-2">
                  {d.projectsNearCap.map((p: any) => <li key={p.id} className="min-w-0"><Link to={`/projects/${p.id}`} className="mb-1.5 block truncate text-[13.5px] font-semibold hover:underline">{p.name}</Link><CapBar used={Number(p.used_minutes)} cap={Number(p.cap_minutes)} /></li>)}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="grid content-start gap-5">
          {e.teamWeek && (
            <Card title="Team this week" sub={`${hrs2(e.teamWeek.logged)} of ${hrs2(e.teamWeek.expected)} · ${e.teamWeek.unfilled} unfilled`} actions={<CardLink to="/approvals?tab=team">Team today</CardLink>}>
              <ul className="grid gap-3">
                {e.teamWeek.low.map((p: any) => (
                  <li key={p.user_id} className="text-[13px]"><div className="mb-1 flex justify-between gap-2"><Link to={`/people/${p.user_id}?tab=timesheet`} className="truncate font-medium hover:underline">{p.name}</Link><span className="shrink-0 whitespace-nowrap tabnum text-[var(--muted)]">{p.fill == null ? "—" : `${Math.round(p.fill)}%`}{p.unfilled ? ` · ${p.unfilled} missing` : ""}</span></div><Progress pct={p.fill ?? 0} tone={(p.fill ?? 0) < 60 ? "late" : (p.fill ?? 0) < 90 ? "amber" : "paid"} /></li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Who's out today">
            {!(e.onLeaveToday?.length || e.wfhToday?.length) ? <p className="text-[13.5px] text-[var(--muted)]">Everyone is in the office today.</p> : (
              <ul className="grid gap-2.5 text-[13.5px]">
                {e.onLeaveToday?.map((p: any) => <li key={`l${p.id}`} className="flex items-center justify-between gap-2"><Person id={p.id} name={p.name} size={28} /><Pill status="leave">{p.part === "full" ? p.leave_type : p.part === "short" ? "Short leave" : "Half day"}</Pill></li>)}
                {e.wfhToday?.map((p: any) => <li key={`w${p.id}`} className="flex items-center justify-between gap-2"><Person id={p.id} name={p.name} size={28} /><Pill status="wfh">WFH {p.kind === "full" ? "" : p.kind === "half" ? "half day" : "hours"}</Pill></li>)}
              </ul>
            )}
          </Card>
          <Card title="Coming up" actions={<CardLink to="/calendar">Calendar</CardLink>}>
            {!e.upcoming?.length ? <p className="text-[13.5px] text-[var(--muted)]">Nothing in the next 30 days.</p> : (
              <ul className="grid gap-3 text-[13.5px]">
                {e.upcoming.slice(0, 6).map((u: any, i: number) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className="grid w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] py-1 text-center leading-tight text-[var(--brand)] dark:text-white"><span className="text-[10.5px] font-semibold">{new Date(`${u.date}T00:00:00`).toLocaleDateString(undefined, { month: "short" })}</span><span className="font-display text-[16px] font-bold">{new Date(`${u.date}T00:00:00`).getDate()}</span></span>
                    <span className="min-w-0"><span className="block truncate font-semibold">{u.kind === "birthday" ? `${u.title}'s birthday` : u.title}</span><span className="text-[12px] capitalize text-[var(--muted)]">{u.kind}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {d.myLeads && (d.myLeads.to_call > 0 || d.myLeads.brought > 0 || can("leads.create")) && (
            <Card title="Leads" actions={<CardLink to="/leads">Open leads</CardLink>}>
              <dl className="grid grid-cols-3 gap-3 text-center">
                {[["To call", d.myLeads.to_call], ["Follow-ups", d.myLeads.follow_ups_due], ["Brought", d.myLeads.brought]].map(([l, v]) => <div key={l} className="rounded-xl bg-[var(--bg)] py-2.5"><dd className="font-display text-[20px] font-bold tabnum">{v}</dd><dt className="text-[12px] text-[var(--muted)]">{l}</dt></div>)}
              </dl>
              {perf.data?.sales && <p className="mt-3 text-[12.5px] text-[var(--muted)]">This month: {perf.data.sales.leads_converted} of {perf.data.sales.leads_brought} of your leads converted; {perf.data.sales.calls_converted} conversions from {perf.data.sales.calls_made} calls.</p>}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
const CardLink = ({ to, children }: { to: string; children: ReactNode }) => <Link to={to} className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--brand)] hover:underline dark:text-[var(--accent)]">{children}<ArrowRight className="size-3.5" /></Link>;
const RANGE_WORD: Record<string, string> = { today: "today", week: "this week", last_week: "last week", month: "this month", last_month: "last month", quarter: "in the last 3 months", year: "this year" };
const hrs2 = (m: number | null | undefined) => (m ? formatMinutes(m) : "0 h");

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
const hrs = (m: number) => `${Math.round(m / 6) / 10}h`;
const STATUS_ORDER: [string, string, string][] = [["paid", "Paid", "#1c7a4f"], ["partially_paid", "Partially paid", "#e08a1e"], ["unpaid", "Unpaid", "#7d8a85"], ["overdue", "Overdue", "#b4441f"], ["refunded", "Refunded", "#6b4fa0"], ["cancelled", "Cancelled", "#b5bdb9"]];
const FUNNEL: [string, string][] = [["new", "New"], ["contacted", "Contacted"], ["follow_up", "Follow-up"], ["converted", "Converted"], ["onboarded", "Onboarded"], ["lost", "Lost"]];

function Charts({ data, label = "last 14 days" }: { data: any; label?: string }) {
  const { money } = useSession();
  if (!data) return null;
  const cards = [];
  if (data.myHours?.some((d: any) => d.approved + d.other > 0)) cards.push(
    <Card key="mine"><BarChart title={`My hours, ${label}`} data={data.myHours} x={(d) => day(d.date)} stacked format={hrs}
      series={[{ key: "approved", label: "Approved", color: "var(--series-1)" }, { key: "other", label: "Not approved yet", color: "var(--series-2)" }]} /></Card>);
  if (data.teamHours) cards.push(
    <Card key="team"><BarChart title={`Team hours, ${label}`} data={data.teamHours} x={(d) => day(d.date)} format={hrs} series={[{ key: "minutes", label: "Hours", color: "var(--series-1)" }]} /></Card>);
  if (data.revenue) cards.push(
    <Card key="rev"><BarChart title={`Invoiced and collected, last ${(data.range?.monthsBack ?? 5) + 1} months`} data={data.revenue} x={(d) => new Date(`${d.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })}
      format={(v) => money(v).replace(/\.00$/, "")} series={[{ key: "invoiced", label: "Invoiced (before tax)", color: "var(--series-1)" }, { key: "collected", label: "Collected", color: "var(--series-2)" }]} /></Card>);
  if (data.invoiceStatus?.length) cards.push(
    <Card key="st"><HBars title="Invoices by status" format={(v) => String(v)} rows={STATUS_ORDER.filter(([k]) => data.invoiceStatus.some((s: any) => s.status === k)).map(([k, l, c]) => {
      const s = data.invoiceStatus.find((x: any) => x.status === k);
      return { label: l, value: s.n, color: c, sub: ["paid", "refunded", "cancelled"].includes(k) ? undefined : money(s.amount) };
    })} /></Card>);
  if (data.funnel?.length) cards.push(
    <Card key="funnel"><HBars title="Leads by stage" rows={FUNNEL.map(([k, l]) => ({ label: l, value: data.funnel.find((f: any) => f.status === k)?.n ?? 0 }))} /></Card>);
  if (!cards.length) return null;
  // With an odd number of charts the last one takes the full width, so there's no empty hole in the grid.
  return <div className="grid gap-5 lg:grid-cols-2">{cards.map((c, i) => (cards.length % 2 && i === cards.length - 1 ? <div key={`w${i}`} className="lg:col-span-2">{c}</div> : c))}</div>;
}
