import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BadgeIndianRupee, Briefcase, PhoneCall, UserCog, Users } from "lucide-react";
import { get, qs } from "../lib/api";
import { useSession } from "../lib/session";
import { pct } from "../lib/hooks";
import { Person } from "../components/Avatar";
import { Card, DataTable, Pill, Spinner, Stat, cx, fmtDate, hrs } from "../components/ui";
import { motion } from "../components/magic";

const ICON: Record<string, any> = { team: Users, projects: Briefcase, sales: PhoneCall, billing: BadgeIndianRupee, hr: UserCog };
const OUTCOME: Record<string, string> = { no_answer: "No answer", interested: "Interested", not_interested: "Not interested", follow_up: "Follow up", converted: "Converted" };

/** The part of a person's page that depends on what they do: their team, the projects they run, their sales, billing or HR work. */
export function RoleReport({ userId, from, to }: { userId: string; from: string; to: string }) {
  const { money } = useSession();
  const q = useQuery({ queryKey: ["role-report", userId, from, to], queryFn: () => get(`/reporting/person/${userId}/role${qs({ from, to })}`) });
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data?.sections?.length) return null;
  const d = q.data;
  return (
    <div className="mb-6 grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-[18px] font-bold">Report for their role</h2>
        {d.user.roles.map((r: string) => <span key={r} className="rounded-full bg-[var(--brand-soft)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--brand)] dark:text-white">{r}</span>)}
      </div>
      {d.sections.map((s: any, i: number) => {
        const I = ICON[s.kind] ?? Users;
        return (
          <motion.div key={s.kind} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card title={<span className="inline-flex items-center gap-2"><span className="grid size-7 place-items-center rounded-lg bg-brand-gradient text-white"><I className="size-4" /></span>{s.title}</span>}>
              {s.kind === "team" && <TeamSection s={s} />}
              {s.kind === "projects" && <ProjectsSection s={s} />}
              {s.kind === "sales" && <SalesSection s={s} money={money} />}
              {s.kind === "billing" && (
                <div className="grid gap-3 sm:grid-cols-4">
                  <Stat label="Invoices raised" value={s.totals.invoices} />
                  <Stat label="Payments recorded" value={s.totals.payments} />
                  <Stat label="Collected" value={s.totals.collected_minor == null ? "—" : money(s.totals.collected_minor)} tone="paid" />
                  <Stat label="Overdue in the company" value={s.totals.overdue_company} tone={s.totals.overdue_company ? "late" : undefined} />
                </div>
              )}
              {s.kind === "hr" && (
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat label="Headcount" value={s.totals.headcount} />
                  <Stat label="Joined in these dates" value={s.totals.joined} />
                  <Stat label="Provisional" value={s.totals.provisional} />
                  <Stat label="Serving notice" value={s.totals.on_notice} tone={s.totals.on_notice ? "amber" : undefined} />
                  <Stat label="Leave waiting" value={s.totals.leave_pending} tone={s.totals.leave_pending ? "amber" : undefined} />
                  <Stat label="Leave they decided" value={s.totals.leave_decided} />
                </div>
              )}
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}

function TeamSection({ s }: { s: any }) {
  const t = s.totals;
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="People" value={s.people.length} />
        <Stat label="Expected" value={hrs(t.expected)} />
        <Stat label="Approved billable" value={hrs(t.billable)} tone="paid" />
        <Stat label="Team utilization" value={pct(t.utilization)} tone={t.utilization == null ? undefined : t.utilization >= 75 ? "paid" : t.utilization >= 50 ? "amber" : "late"} />
        <Stat label="Sheets waiting" value={s.pendingSheets} tone={s.pendingSheets ? "amber" : undefined} />
        <Stat label="Leave waiting" value={s.pendingLeave} tone={s.pendingLeave ? "amber" : undefined} />
      </div>
      <DataTable rows={s.people} rowKey={(p: any) => p.user_id} rowHref={(p: any) => `/people/${p.user_id}`} pageSize={10} searchPlaceholder="Search their team" initialSort={{ key: "u", dir: "asc" }}
        columns={[
          { key: "n", header: "Person", cell: (p: any) => <Person id={p.user_id} name={p.name} sub={p.designation ?? p.team_name} size={28} />, sort: (p: any) => p.name, text: (p: any) => p.name },
          { key: "e", header: "Expected", cell: (p: any) => hrs(p.expected), sort: (p: any) => p.expected, align: "right" },
          { key: "b", header: "Billable approved", cell: (p: any) => hrs(p.billable), sort: (p: any) => p.billable, align: "right" },
          { key: "i", header: "In-house", cell: (p: any) => hrs(p.inhouse), sort: (p: any) => p.inhouse, align: "right" },
          { key: "p", header: "Waiting", cell: (p: any) => (p.pending ? <span className="text-[#8a5300]">{hrs(p.pending)}</span> : "—"), sort: (p: any) => p.pending, align: "right" },
          { key: "f", header: "Unfilled days", cell: (p: any) => (p.unfilled_sheets ? <span className="font-semibold text-[#b4441f]">{p.unfilled_sheets}</span> : "—"), sort: (p: any) => p.unfilled_sheets, align: "right" },
          { key: "u", header: "Utilization", cell: (p: any) => <Util v={p.utilization} />, sort: (p: any) => p.utilization ?? -1, align: "right" },
        ]} />
    </>
  );
}
const Util = ({ v }: { v: number | null }) => (
  <span className="inline-flex items-center gap-2">
    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-black/5 dark:bg-white/10"><span className={cx("block h-full rounded-full", v == null ? "" : v >= 75 ? "bg-[#1c7a4f]" : v >= 50 ? "bg-[#eda100]" : "bg-[#b4441f]")} style={{ width: `${Math.min(100, v ?? 0)}%` }} /></span>
    <b className="w-10 text-right tabnum">{pct(v)}</b>
  </span>
);

function ProjectsSection({ s }: { s: any }) {
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Projects they run" value={s.totals.projects} />
        <Stat label="Hours on them" value={hrs(s.totals.minutes)} />
        <Stat label="Open tasks" value={s.totals.open_tasks} />
        <Stat label="Late tasks" value={s.totals.late_tasks} tone={s.totals.late_tasks ? "late" : "paid"} />
      </div>
      <DataTable rows={s.rows} rowKey={(p: any) => p.id} rowHref={(p: any) => `/projects/${p.id}`} pageSize={10} search={false}
        columns={[
          { key: "n", header: "Project", cell: (p: any) => <><b>{p.name}</b><div className="text-[12.5px] text-[var(--muted)]">{p.client_name}</div></>, sort: (p: any) => p.name },
          { key: "r", header: "As", cell: (p: any) => (p.as_role === "pm" ? "Project Manager" : "Team Lead") },
          { key: "s", header: "Stage", cell: (p: any) => p.stage_name ?? "—" },
          { key: "h", header: "Hours", cell: (p: any) => <>{hrs(p.minutes)}<div className="text-[12px] text-[var(--muted)]">{hrs(p.approved)} approved</div></>, sort: (p: any) => p.minutes, align: "right" },
          { key: "t", header: "Open tasks", cell: (p: any) => <>{p.open_tasks}{p.late_tasks > 0 && <span className="ml-1 text-[12px] font-semibold text-[#b4441f]">{p.late_tasks} late</span>}</>, sort: (p: any) => p.open_tasks, align: "right" },
          { key: "d", header: "Delivery", cell: (p: any) => fmtDate(p.delivery_date), sort: (p: any) => p.delivery_date ?? "" },
        ]} />
    </>
  );
}

function SalesSection({ s, money }: { s: any; money: (n: number) => string }) {
  const t = s.totals;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
      <div>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Leads brought" value={t.brought} />
          <Stat label="Converted" value={t.converted} tone="paid" sub={t.converted_value_minor != null && t.converted_value_minor > 0 ? `${money(t.converted_value_minor)} estimated` : undefined} />
          <Stat label="Calls made" value={t.calls} />
          <Stat label="Open leads assigned" value={t.open_assigned} />
          <Stat label="Follow-ups overdue" value={t.overdue} tone={t.overdue ? "late" : undefined} />
          <Stat label="Conversion" value={t.brought ? pct((t.converted / t.brought) * 100) : "—"} />
        </div>
        {s.calls.length > 0 && (
          <div className="flex flex-wrap gap-2">{s.calls.map((c: any) => <span key={c.outcome} className="rounded-lg bg-[var(--bg)] px-2.5 py-1 text-[13px]"><b className="tabnum">{c.n}</b> {OUTCOME[c.outcome] ?? c.outcome}</span>)}</div>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-[13.5px] font-bold">Recent leads</h3>
        <ul className="divide-y divide-[var(--line)]">
          {s.recent.map((l: any) => (
            <li key={l.id} className="flex items-center justify-between gap-2 py-2">
              <Link to={`/leads/${l.id}`} className="min-w-0"><span className="block truncate font-semibold hover:underline">{l.title}</span><span className="text-[12.5px] text-[var(--muted)]">{l.company || "—"} · {l.how}</span></Link>
              <Pill status={l.status} />
            </li>
          ))}
          {!s.recent.length && <li className="py-3 text-[13.5px] text-[var(--muted)]">No leads yet.</li>}
        </ul>
      </div>
    </div>
  );
}
