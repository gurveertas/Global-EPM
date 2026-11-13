import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Briefcase, CheckSquare, FolderKanban, History, PhoneCall, Users, UsersRound } from "lucide-react";
import { get, post } from "../lib/api";
import { useUsers, userOpts } from "../lib/hooks";
import { Button, Card, Checkbox, Combobox, DataTable, Empty, ErrorNote, Field, PageHeader, Pill, Spinner, Textarea, cx, fmtDateTime, useConfirm, useToast } from "../components/ui";

type Resp = { projects: any[]; teams: any[]; reports: any[]; tasks: any[]; leads: any[]; pendingSheets: number };
type Picked = { projectIds: string[]; teamIds: string[]; reportIds: string[]; taskIds: string[]; leadIds: string[] };
const NONE: Picked = { projectIds: [], teamIds: [], reportIds: [], taskIds: [], leadIds: [] };

/**
 * Hand one person's responsibilities to another: projects they're PM or Team Lead of, teams they lead, people who report to
 * them, their open tasks and the leads they call. History stays: approvals, sheets and activity keep the old name, and each
 * project keeps a record of its past PMs and Team Leads.
 */
export function Handover() {
  const [params] = useSearchParams();
  const users = useUsers();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [from, setFrom] = useState<string | null>(params.get("from"));
  const [to, setTo] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>(NONE);
  const [keep, setKeep] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const r = useQuery({ queryKey: ["responsibilities", from], queryFn: () => get<Resp>(`/handovers/responsibilities/${from}`), enabled: !!from });
  const history = useQuery({ queryKey: ["handovers"], queryFn: () => get<any[]>("/handovers") });
  // Everything is ticked by default; untick what should stay.
  useEffect(() => {
    if (!r.data) return;
    setPicked({ projectIds: r.data.projects.map((x) => x.id), teamIds: r.data.teams.map((x) => x.id), reportIds: r.data.reports.filter((x) => x.id !== to).map((x) => x.id), taskIds: r.data.tasks.map((x) => x.id), leadIds: r.data.leads.map((x) => x.id) });
  }, [r.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string | null) => users.data?.find((u: any) => u.id === id)?.name ?? "";
  const total = Object.values(picked).reduce((a, l) => a + l.length, 0);
  const toggle = (k: keyof Picked, id: string, on: boolean) => setPicked((p) => ({ ...p, [k]: on ? [...p[k], id] : p[k].filter((x) => x !== id) }));
  const all = (k: keyof Picked, ids: string[], on: boolean) => setPicked((p) => ({ ...p, [k]: on ? ids : [] }));
  const opts = useMemo(() => userOpts(users.data), [users.data]);
  const run = async () => {
    if (!(await confirm({ title: `Hand ${total} item${total === 1 ? "" : "s"} to ${name(to)}?`, body: `${name(from)}'s past work stays on record under their name. ${name(to)} and the project teams are told.`, confirm: "Hand over" }))) return;
    setBusy(true); setErr(null);
    try {
      const res = await post("/handovers", { fromUserId: from, toUserId: to, ...picked, keepOnProjects: keep, note });
      const c = res.counts;
      toast(`Handed over: ${[c.projects && `${c.projects} projects`, c.teams && `${c.teams} teams`, c.reports && `${c.reports} reports`, c.tasks && `${c.tasks} tasks`, c.leads && `${c.leads} leads`].filter(Boolean).join(", ")}`);
      for (const k of [["responsibilities"], ["handovers"], ["projects"], ["org-chart"], ["users"], ["assignments"]]) qc.invalidateQueries({ queryKey: k });
      setNote("");
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const d = r.data;
  const empty = d && !d.projects.length && !d.teams.length && !d.reports.length && !d.tasks.length && !d.leads.length;
  return (
    <>
      <PageHeader title="Handover" sub="Move someone's projects, teams, reports, tasks and leads to another person, e.g. when a PM or Team Lead changes role or leaves. What they did before stays on record." />
      <Card className="mb-5">
        <div className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Field label="Hand over from"><Combobox value={from} onChange={(v) => { setFrom(v); setPicked(NONE); }} options={opts} placeholder="Who is handing over" /></Field>
          <ArrowRight className="mb-2.5 hidden size-5 text-[var(--muted)] md:block" />
          <Field label="To"><Combobox value={to} onChange={setTo} options={opts.filter((o: any) => o.value !== from)} placeholder="Who takes over" /></Field>
        </div>
      </Card>
      {!from ? <Empty icon={<UsersRound />} title="Pick who is handing over">You'll see everything they're responsible for, and choose what moves.</Empty> : r.isLoading ? <Spinner /> : empty ? (
        <Empty icon={<CheckSquare />} title={`${name(from)} has nothing to hand over`}>They aren't PM or Team Lead of any project, don't lead a team, have no direct reports, open tasks or leads to call.</Empty>
      ) : d && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid min-w-0 gap-5">
            <Group icon={<FolderKanban />} title="Projects" sub="They become PM or Team Lead in the same role." items={d.projects} k="projectIds" picked={picked} toggle={toggle} all={all}
              row={(p) => <><span className="font-semibold">{p.name}</span><span className="text-[12.5px] text-[var(--muted)]"> · {p.client_name}</span><span className="ml-2"><Pill status={p.role === "pm" ? "brand" : "wfh"}>{p.role === "pm" ? "Project Manager" : "Team Lead"}</Pill></span>{p.status !== "active" && <span className="ml-1"><Pill status={p.status} /></span>}</>} />
            <Group icon={<Users />} title="Teams" sub="Team lead or manager of the team." items={d.teams} k="teamIds" picked={picked} toggle={toggle} all={all}
              row={(t) => <><span className="font-semibold">{t.name}</span><span className="text-[12.5px] text-[var(--muted)]"> · {[t.is_lead && "Team lead", t.is_manager && "Manager"].filter(Boolean).join(" and ")} · {t.people} people</span></>} />
            <Group icon={<UsersRound />} title="Direct reports" sub="They'll report to the new person, who approves their sheets and leave from now on." items={d.reports.filter((x) => x.id !== to)} k="reportIds" picked={picked} toggle={toggle} all={all}
              row={(u) => <><span className="font-semibold">{u.name}</span><span className="text-[12.5px] text-[var(--muted)]"> · {u.designation || "—"}</span></>} />
            <Group icon={<CheckSquare />} title="Open tasks" sub="Assigned to the new person. Hours already logged stay with whoever logged them." items={d.tasks} k="taskIds" picked={picked} toggle={toggle} all={all}
              row={(t) => <><span className="font-semibold">{t.title}</span><span className="text-[12.5px] text-[var(--muted)]"> · {t.project_name}</span></>} />
            <Group icon={<PhoneCall />} title="Leads to call" sub="Open leads where they're the caller." items={d.leads} k="leadIds" picked={picked} toggle={toggle} all={all}
              row={(l) => <><span className="font-semibold">{l.title}</span><span className="text-[12.5px] text-[var(--muted)]"> · {l.company || "—"}</span><span className="ml-2"><Pill status={l.status} /></span></>} />
          </div>
          <div className="xl:sticky xl:top-20">
            <Card title="Hand over">
              <div className="grid gap-4">
                <div className="rounded-xl bg-[var(--bg)] p-3 text-[13.5px]">
                  <div className="flex items-center gap-2 font-semibold">{name(from)}<ArrowRight className="size-4 text-[var(--muted)]" />{name(to) || <span className="text-[var(--muted)]">pick someone</span>}</div>
                  <ul className="mt-2 grid gap-0.5 text-[13px] text-[var(--muted)]">
                    <li>{picked.projectIds.length} projects · {picked.teamIds.length} teams</li>
                    <li>{picked.reportIds.length} direct reports · {picked.taskIds.length} tasks · {picked.leadIds.length} leads</li>
                    {d.pendingSheets > 0 && <li className="text-[#8a5300] dark:text-[#f0a531]">{d.pendingSheets} sheets waiting for their approval move with the reports and teams.</li>}
                  </ul>
                </div>
                {picked.projectIds.length > 0 && <Checkbox label={`Keep ${name(from).split(" ")[0] || "them"} on the projects as a member`} hint="Otherwise they leave those projects." checked={keep} onChange={setKeep} />}
                <Field label="Note (optional)"><Textarea plain value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" placeholder="e.g. Moving to the mobile team from 1 December" /></Field>
                <ErrorNote error={err} />
                <Button busy={busy} disabled={!to || !total} onClick={run}><Briefcase className="size-4" />Hand over {total ? `${total} item${total === 1 ? "" : "s"}` : ""}</Button>
                <p className="text-[12.5px] text-[var(--muted)]">Past approvals, sheets, comments and activity keep {from ? `${name(from)}'s` : "their"} name. Each project lists its past PMs and Team Leads on its Team tab.</p>
              </div>
            </Card>
          </div>
        </div>
      )}
      <h2 className="mb-3 mt-8 flex items-center gap-2 text-[16px] font-bold"><History className="size-4 text-[var(--muted)]" />Past handovers</h2>
      <DataTable rows={history.data} loading={history.isLoading} rowKey={(h) => h.id} search searchPlaceholder="Search people" exportName="handovers" empty="No handovers yet."
        columns={[
          { key: "w", header: "When", cell: (h) => fmtDateTime(h.created_at), sort: (h) => h.created_at },
          { key: "f", header: "From", cell: (h) => <Link to={`/people/${h.from_user_id}`} className="font-semibold hover:underline">{h.from_name}</Link>, sort: (h) => h.from_name, text: (h) => h.from_name },
          { key: "t", header: "To", cell: (h) => <Link to={`/people/${h.to_user_id}`} className="font-semibold hover:underline">{h.to_name}</Link>, sort: (h) => h.to_name, text: (h) => h.to_name },
          { key: "m", header: "What moved", wrap: true, cell: (h) => <span className="text-[13px]">{summary(h.moved)}</span>, text: (h) => summary(h.moved), filter: false },
          { key: "n", header: "Note", cell: (h) => h.note || "—", text: (h) => h.note, filter: false },
          { key: "b", header: "By", cell: (h) => h.created_by_name ?? "—", sort: (h) => h.created_by_name ?? "" },
        ]} />
    </>
  );
}

const summary = (m: any) => {
  if (!m) return "—";
  const parts: string[] = [];
  if (m.projects?.length) parts.push(`${m.projects.length} project${m.projects.length > 1 ? "s" : ""} (${m.projects.map((p: any) => p.name).join(", ")})`);
  if (m.teams?.length) parts.push(`${m.teams.length} team${m.teams.length > 1 ? "s" : ""}`);
  if (m.reports?.length) parts.push(`${m.reports.length} report${m.reports.length > 1 ? "s" : ""}`);
  if (m.tasks?.length) parts.push(`${m.tasks.length} task${m.tasks.length > 1 ? "s" : ""}`);
  if (m.leads?.length) parts.push(`${m.leads.length} lead${m.leads.length > 1 ? "s" : ""}`);
  return parts.join(" · ") || "Nothing";
};

function Group({ icon, title, sub, items, k, picked, toggle, all, row }: {
  icon: React.ReactNode; title: string; sub: string; items: any[]; k: keyof Picked; picked: Picked;
  toggle: (k: keyof Picked, id: string, on: boolean) => void; all: (k: keyof Picked, ids: string[], on: boolean) => void; row: (x: any) => React.ReactNode;
}) {
  if (!items.length) return null;
  const n = picked[k].length;
  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)] dark:text-white [&_svg]:size-4">{icon}</span>
          <div><div className="text-[14.5px] font-bold">{title} <span className="font-medium text-[var(--muted)] tabnum">{n} of {items.length}</span></div><div className="text-[12.5px] text-[var(--muted)]">{sub}</div></div>
        </div>
        <button type="button" onClick={() => all(k, items.map((x) => x.id), n < items.length)} className="text-[13px] font-semibold text-[var(--brand)] hover:underline dark:text-[var(--accent)]">{n < items.length ? "Select all" : "Select none"}</button>
      </div>
      <ul className="max-h-80 divide-y divide-[var(--line)] overflow-y-auto scrollbar-thin">
        {items.map((x) => (
          <li key={x.id}>
            <label className={cx("flex cursor-pointer items-center gap-3 px-5 py-2.5 text-[13.5px] hover:bg-[var(--bg)]/60", !picked[k].includes(x.id) && "opacity-60")}>
              <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={picked[k].includes(x.id)} onChange={(e) => toggle(k, x.id, e.target.checked)} />
              <span className="min-w-0 flex-1 truncate">{row(x)}</span>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}
