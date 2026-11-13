import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, CheckCheck, ChevronDown, ClipboardCheck, Clock3, Undo2, Users } from "lucide-react";
import { Avatar } from "../components/Avatar";
import { AnimatePresence, motion } from "../components/magic";
import { formatMinutes } from "@eszy/shared";
import { get, post, qs } from "../lib/api";
import { useSession } from "../lib/session";
import { useAction } from "../lib/hooks";
import { CATS } from "../components/Charts";
import {
  Button, Card, DataTable, DateRange, Empty, ErrorNote, PageHeader, Pager, Pill, SearchInput, Select, Spinner, Stat, StatGrid, Table, Tabs, cx, fmtDate, fmtDateTime, hrs, rangeFor, useConfirm, usePaged, useRange, RichText } from "../components/ui";

/** Sheet approvals: waiting sheets grouped by person, history, backdate requests, not-tracked hours and unfilled sheets. */
export function Approvals() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "submitted";
  const { can } = useSession();
  const pending = useQuery({ queryKey: ["approvals", "submitted"], queryFn: () => get<any[]>("/approvals/sheets?status=submitted") });
  const requests = useQuery({ queryKey: ["sheet-requests", "pending"], queryFn: () => get<any[]>(`/sheet-requests?scope=${can("time.approve_all") ? "all" : "team"}&status=pending`) });
  const offline = useMemo(() => (pending.data ?? []).flatMap((s) => s.entries.filter((e: any) => e.offline).map((e: any) => ({ ...e, sheet: s }))), [pending.data]);
  return (
    <>
      <PageHeader title="Sheet approvals" sub="Approve each person's whole day. Sending a sheet back lets them fix it and submit again." />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { id: "submitted", label: "Pending for approval", count: pending.data?.length }, { id: "offline", label: "Not tracked hours", count: offline.length },
        { id: "requests", label: "Old sheet requests", count: requests.data?.length }, { id: "history", label: "Approved and sent back" }, { id: "team", label: "Team today" },
      ]} />
      {tab === "submitted" && <Pending sheets={pending.data} loading={pending.isLoading} />}
      {tab === "offline" && <Offline rows={offline} />}
      {tab === "requests" && <Requests rows={requests.data} loading={requests.isLoading} />}
      {tab === "history" && <History />}
      {tab === "team" && <TeamToday />}
    </>
  );
}

function useDecide() {
  const qc = useQueryClient();
  const act = useAction();
  const decide = (ids: string[], action: "approve" | "reject") => act.run(() => post("/approvals/sheets/bulk", { ids, action }), action === "approve" ? `${ids.length} sheet(s) approved` : `${ids.length} sheet(s) sent back`).then((r) => {
    ["approvals", "approvals-count", "dashboard", "team-today", "rep-util"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    return r;
  });
  return { ...act, decide };
}

function Pending({ sheets, loading }: { sheets?: any[]; loading: boolean }) {
  const { decide, err, busy } = useDecide();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [person, setPerson] = useState("");
  const [project, setProject] = useState("");
  const [order, setOrder] = useState<"old" | "new">("old");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const all = sheets ?? [];
  const t = search.toLowerCase();
  const matches = (s: any) => (!project || s.entries.some((e: any) => e.project_id === project))
    && (!t || `${s.user_name} ${s.date} ${s.entries.map((e: any) => `${e.project_name} ${e.description} ${e.activity_type ?? ""} ${e.client_name ?? ""}`).join(" ")}`.toLowerCase().includes(t));
  const base = all.filter(matches);
  const list = base.filter((s) => !person || s.user_id === person).sort((a, b) => (order === "old" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  const pg = usePaged(list, 10);
  if (loading) return <Spinner />;
  if (!all.length) return <Empty icon={<CheckCheck />} title="Nothing waiting">Sheets your team submits show up here.</Empty>;
  const people = [...new Map(base.map((s) => [s.user_id, { id: s.user_id, name: s.user_name, sheets: base.filter((x) => x.user_id === s.user_id) }])).values()]
    .map((p) => ({ ...p, minutes: p.sheets.reduce((a: number, s: any) => a + s.minutes, 0), oldest: p.sheets.reduce((a: string, s: any) => (s.date < a ? s.date : a), p.sheets[0].date) }))
    .sort((a, b) => a.oldest.localeCompare(b.oldest));
  const projects = [...new Map<string, string>(all.flatMap((s) => s.entries.map((e: any) => [e.project_id as string, e.project_name as string] as [string, string]))).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const toggle = (ids: string[], on: boolean) => setSel((x) => { const n = new Set(x); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });
  const total = list.reduce((a, s) => a + s.minutes, 0);
  const weekStart = rangeFor("week").from;
  const reject = async (ids: string[]) => { if (await confirm({ title: `Send ${ids.length} sheet(s) back?`, body: "They'll be able to change the entries and submit again.", confirm: "Send back" }) !== false) { await decide(ids, "reject"); setSel(new Set()); } };
  const approve = async (ids: string[]) => { await decide(ids, "approve"); setSel((x) => { const n = new Set(x); ids.forEach((i) => n.delete(i)); return n; }); };
  const allIds = list.map((s) => s.id);
  const allOn = allIds.length > 0 && allIds.every((i) => sel.has(i));
  const oldest = list.reduce((a, s) => (s.date < a ? s.date : a), list[0]?.date ?? "");
  return (
    <>
      <StatGrid cols={4}>
        <Stat label="Sheets waiting" value={list.length} icon={<ClipboardCheck />} />
        <Stat label="People" value={person ? 1 : people.length} icon={<Users />} />
        <Stat label="Hours waiting" value={hrs(total)} icon={<Clock3 />} />
        <Stat label="Oldest" value={oldest ? fmtDate(oldest, { day: "numeric", month: "short" }) : "—"} tone={oldest && oldest < weekStart ? "amber" : undefined} icon={<CalendarClock />} sub={oldest && oldest < weekStart ? "From before this week" : undefined} />
      </StatGrid>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search person, project, client, work type or date" className="w-full sm:w-96" />
        <Select value={project} onChange={(e) => setProject(e.target.value)} className="w-52" aria-label="Project"><option value="">All projects</option>{projects.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
        <Select value={order} onChange={(e) => setOrder(e.target.value as any)} className="w-40" aria-label="Order"><option value="old">Oldest first</option><option value="new">Newest first</option></Select>
      </div>
      <ErrorNote error={err} />
      <div className="grid gap-5 lg:grid-cols-[270px_minmax(0,1fr)]">
        {/* people */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card pad={false} className="p-2">
            <p className="px-3 pb-1.5 pt-1.5 text-[12px] font-semibold text-[var(--muted)]">People</p>
            <ul className="grid max-h-[calc(100vh-14rem)] gap-0.5 overflow-y-auto scrollbar-thin">
              {[{ id: "", name: "Everyone", sheets: base, minutes: base.reduce((a, s) => a + s.minutes, 0), oldest: "" }, ...people].map((p) => {
                const on = person === p.id;
                const late = p.oldest && p.oldest < weekStart;
                return (
                  <li key={p.id || "all"}>
                    <button onClick={() => { setPerson(p.id); pg.setPage(0); }} className={cx("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition", on ? "bg-[var(--brand-soft)] ring-1 ring-[var(--brand-2)]/25" : "hover:bg-[var(--bg)]")}>
                      {p.id ? <Avatar id={p.id} name={p.name} size={32} /> : <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-gradient text-white"><Users className="size-4" /></span>}
                      <span className="min-w-0 flex-1">
                        <span className={cx("block truncate text-[13.5px] font-semibold", on && "text-[var(--brand)] dark:text-white")}>{p.name}</span>
                        <span className="block truncate text-[12px] text-[var(--muted)] tabnum">{p.sheets.length} {p.sheets.length === 1 ? "sheet" : "sheets"} · {hrs(p.minutes)}</span>
                      </span>
                      {late && <span title={`Oldest sheet ${fmtDate(p.oldest)}`} className="size-2 shrink-0 rounded-full bg-[#f0a531]" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </aside>

        {/* sheets */}
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2.5 text-[13.5px] font-semibold">
              <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={allOn} onChange={(e) => toggle(allIds, e.target.checked)} aria-label="Select every sheet shown" />
              {person ? people.find((p) => p.id === person)?.name : "All sheets"}<span className="font-normal text-[var(--muted)]">{list.length} waiting · {hrs(total)}</span>
            </label>
            {list.length > 0 && <div className="flex gap-2"><Button size="sm" variant="secondary" busy={!!busy} onClick={() => reject(allIds)}><Undo2 />Send all back</Button><Button size="sm" busy={!!busy} onClick={() => approve(allIds)}><CheckCheck />Approve all {list.length}</Button></div>}
          </div>
          {!list.length ? <Empty title="Nothing matches">Try another search or project.</Empty> : (
            <div className="grid gap-3">
              {pg.rows.map((s) => (
                <SheetCard key={s.id} s={s} showName={!person} open={!closed.has(s.id)} late={s.date < weekStart}
                  onToggle={() => setClosed((x) => { const n = new Set(x); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}
                  selected={sel.has(s.id)} onSelect={(v: boolean) => toggle([s.id], v)} onApprove={() => approve([s.id])} onReject={() => reject([s.id])} busy={!!busy} />
              ))}
              <Pager {...pg} noun="sheets" />
            </div>
          )}
        </div>
      </div>
      <AnimatePresence>
        {sel.size > 0 && (
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
            className="fixed inset-x-0 bottom-5 z-30 mx-auto flex w-fit items-center gap-3 rounded-2xl border border-[var(--brand-2)]/30 bg-[#0d0b14] px-4 py-2.5 text-white shadow-[0_24px_60px_-20px_rgb(109_40_217/.8)]">
            <span className="text-[13.5px] font-semibold tabnum">{sel.size} selected · {hrs(all.filter((s) => sel.has(s.id)).reduce((a, s) => a + s.minutes, 0))}</span>
            <button className="text-[13px] text-white/60 hover:text-white" onClick={() => setSel(new Set())}>Clear</button>
            <Button size="sm" variant="secondary" busy={!!busy} onClick={() => reject([...sel])}><Undo2 />Send back</Button>
            <Button size="sm" busy={!!busy} onClick={() => approve([...sel])}><Check />Approve {sel.size}</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const PROJECT_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];
const colorFor = (id: string) => PROJECT_COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % PROJECT_COLORS.length];

function SheetCard({ s, showName, open, late, onToggle, selected, onSelect, onApprove, onReject, busy }: any) {
  const d = new Date(`${s.date}T00:00:00`);
  const cats = CATS.map((c) => ({ ...c, m: s.entries.filter((e: any) => (e.category ?? "billable") === c.key).reduce((a: number, e: any) => a + e.minutes, 0) })).filter((c) => c.m > 0);
  const offline = s.entries.filter((e: any) => e.offline).length;
  const noNotes = s.entries.filter((e: any) => !String(e.description ?? "").trim()).length;
  return (
    <section className={cx("overflow-hidden rounded-2xl border bg-[var(--card)] shadow-[0_1px_2px_rgba(16,24,40,.05)] transition", selected ? "border-[var(--brand-2)] ring-2 ring-[var(--brand-2)]/25" : "border-[var(--line)] hover:border-[var(--brand-2)]/40")}>
      {/* Who, which day, how long, and the two actions. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <input type="checkbox" className="size-4 shrink-0 accent-[var(--brand)]" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${s.user_name}'s sheet for ${s.date}`} />
        <span className={cx("grid w-[52px] shrink-0 place-items-center rounded-xl py-1.5 leading-none", late ? "bg-[#fdf0d9] text-[#7d4c00] dark:bg-[#7d4c00]/25 dark:text-[#f5c879]" : "bg-[var(--brand-soft)] text-[var(--brand)] dark:text-white")}>
          <span className="text-[10.5px] font-semibold uppercase tracking-wide opacity-80">{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
          <span className="mt-0.5 font-display text-[20px] font-bold">{d.getDate()}</span>
          <span className="text-[10.5px] font-semibold opacity-80">{d.toLocaleDateString(undefined, { month: "short" })}</span>
        </span>
        <button onClick={onToggle} className="min-w-[12rem] flex-1 text-left" aria-expanded={open}>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15.5px] font-bold">{showName ? s.user_name : fmtDate(s.date, { weekday: "long", day: "numeric", month: "long" })}</span>
            {s.wfh && <Pill status="wfh">WFH {s.wfh === "full" ? "full day" : s.wfh === "half" ? "half day" : "hours"}</Pill>}
            {late && <Pill status="amber">From an earlier week</Pill>}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[var(--muted)]">
            <span>{s.entries.length} {s.entries.length === 1 ? "entry" : "entries"}</span>
            <span>Submitted {fmtDateTime(s.submitted_at)}</span>
            {offline > 0 && <span className="font-semibold text-[#9c3a19] dark:text-[#f3a98c]">{offline} offline</span>}
            {noNotes > 0 && <span className="font-semibold text-[#8a5300] dark:text-[#f0a531]">{noNotes} without narration</span>}
          </span>
        </button>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right">
            <div className="whitespace-nowrap font-display text-[20px] font-bold leading-none tabnum">{formatMinutes(s.minutes)}</div>
            <div className="mt-1 text-[11.5px] text-[var(--muted)]">logged</div>
          </div>
          <span className="h-9 w-px bg-[var(--line)]" />
          <Button size="sm" variant="secondary" disabled={busy} onClick={onReject}><Undo2 />Send back</Button>
          <Button size="sm" disabled={busy} onClick={onApprove}><Check />Approve</Button>
          <button onClick={onToggle} aria-label={open ? "Hide entries" : "Show entries"} className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--bg)]"><ChevronDown className={cx("size-4 transition", open && "rotate-180")} /></button>
        </div>
      </div>
      {/* Split of the day by kind of work. */}
      <div className="flex items-center gap-3 px-4 pb-3.5 sm:pl-[6.6rem]">
        <div className="flex h-2 min-w-0 flex-1 gap-0.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">{cats.map((c) => <span key={c.key} className="h-full rounded-full" style={{ width: `${(c.m / Math.max(1, s.minutes)) * 100}%`, background: c.color }} title={`${c.label} ${formatMinutes(c.m)}`} />)}</div>
        <div className="flex shrink-0 flex-wrap gap-x-3 text-[12px] text-[var(--muted)]">{cats.map((c) => <span key={c.key} className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ background: c.color }} />{c.label} <b className="font-semibold text-[var(--text)] tabnum">{formatMinutes(c.m)}</b></span>)}</div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            <ul className="grid gap-2 border-t border-[var(--line)] bg-[var(--bg)]/50 p-3 sm:pl-[6.6rem]">
              {s.entries.map((e: any) => (
                <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 rounded-xl border border-[var(--line)] bg-[var(--card)] px-3.5 py-2.5 text-[13.5px]">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <i className="block size-2 shrink-0 rounded-full" style={{ background: colorFor(e.project_id) }} />
                      <span className="font-semibold">{e.project_name}</span>
                      {e.task_title && <span className="text-[12.5px] text-[var(--muted)]">· {e.task_title}</span>}
                      {e.activity_type && <span className="whitespace-nowrap rounded-md bg-[var(--bg)] px-1.5 py-0.5 text-[11.5px] font-semibold ring-1 ring-[var(--line)]">{e.activity_type}</span>}
                      {e.tracker_label && <span className="max-w-48 truncate rounded-md bg-[#e5eefb] px-1.5 py-0.5 text-[11.5px] font-semibold text-[#24529a] dark:bg-[#24529a]/30 dark:text-[#9fc1f2]">{e.tracker_label}</span>}
                      {!e.tracker_label && e.source !== "eszy" && <span className="whitespace-nowrap rounded-md bg-[#fdf0d9] px-1.5 py-0.5 text-[11.5px] font-semibold text-[#7d4c00]">Tracked in {e.source}</span>}
                      {e.offline && <span className="rounded-md bg-[#fbe5dc] px-1.5 py-0.5 text-[11.5px] font-semibold text-[#9c3a19] dark:bg-[#9c3a19]/25 dark:text-[#f3a98c]">Offline: {e.offline_reason}</span>}
                    </div>
                    <div className="mt-1 text-[13px] text-[var(--muted)]">{e.description ? <RichText text={e.description} /> : <i>No narration</i>}</div>
                  </div>
                  <span className="whitespace-nowrap text-right text-[14px] font-bold tabnum">{formatMinutes(e.minutes)}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Offline({ rows }: { rows: any[] }) {
  const { decide, err, busy } = useDecide();
  return (
    <>
      <p className="mb-4 text-[13.5px] text-[var(--muted)]">Hours people worked but didn't track in the client's tracker, in sheets waiting for you. Approving or sending back applies to the whole day's sheet.</p>
      <ErrorNote error={err} />
      <DataTable dateFilter={false} rows={rows} rowKey={(r: any) => r.id} exportName="not-tracked-hours" empty="No offline hours waiting."
        columns={[
          { key: "u", header: "Employee", cell: (r: any) => <span className="font-semibold">{r.sheet.user_name}</span>, sort: (r: any) => r.sheet.user_name, text: (r: any) => r.sheet.user_name },
          { key: "d", header: "Date", cell: (r: any) => fmtDate(r.sheet.date), sort: (r: any) => r.sheet.date, text: (r: any) => r.sheet.date },
          { key: "p", header: "Project", cell: (r: any) => r.project_name, sort: (r: any) => r.project_name, text: (r: any) => r.project_name },
          { key: "r", header: "Why it wasn't tracked", cell: (r: any) => r.offline_reason, text: (r: any) => r.offline_reason },
          { key: "n", header: "Narration", cell: (r: any) => r.description || "—", text: (r: any) => r.description },
          { key: "h", header: "Time", cell: (r: any) => hrs(r.minutes), align: "right", sort: (r: any) => r.minutes },
          { key: "a", header: "", cell: (r: any) => <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" disabled={!!busy} onClick={() => decide([r.sheet.id], "reject")}>Send back</Button><Button size="sm" disabled={!!busy} onClick={() => decide([r.sheet.id], "approve")}>Approve day</Button></div> },
        ]} />
    </>
  );
}

function Requests({ rows, loading }: { rows?: any[]; loading: boolean }) {
  const qc = useQueryClient();
  const act = useAction();
  const done = () => qc.invalidateQueries({ queryKey: ["sheet-requests"] });
  return (
    <>
      <p className="mb-4 text-[13.5px] text-[var(--muted)]">Days outside the edit window need your OK before someone can fill them. Allowing opens that day for them for a limited time.</p>
      <ErrorNote error={act.err} />
      <DataTable dateFilter={false} rows={rows} loading={loading} rowKey={(r: any) => r.id} empty="No requests waiting."
        columns={[
          { key: "u", header: "Employee", cell: (r: any) => <span className="font-semibold">{r.user_name}</span>, sort: (r: any) => r.user_name, text: (r: any) => r.user_name },
          { key: "d", header: "Day to fill", cell: (r: any) => fmtDate(r.date, { weekday: "short", day: "numeric", month: "short" }), sort: (r: any) => r.date, text: (r: any) => r.date },
          { key: "r", header: "Reason", cell: (r: any) => r.reason, text: (r: any) => r.reason },
          { key: "a", header: "Asked", cell: (r: any) => fmtDateTime(r.created_at), sort: (r: any) => r.created_at },
          { key: "x", header: "", cell: (r: any) => <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => act.run(() => post(`/sheet-requests/${r.id}/reject`), "Declined").then(done)}>Decline</Button><Button size="sm" onClick={() => act.run(() => post(`/sheet-requests/${r.id}/approve`), "They can fill that day now").then(done)}>Allow</Button></div> },
        ]} />
    </>
  );
}

function History() {
  const { can, me } = useSession();
  const [status, setStatus] = useState<"approved" | "rejected">("approved");
  const [range, setRange] = useRange("week");
  const q = useQuery({ queryKey: ["approvals", status, range.from, range.to], queryFn: () => get<any[]>(`/approvals/sheets${qs({ status, from: range.from, to: range.to })}`) });
  const act = useAction();
  const canReopen = me!.settings.policies.approvedSheetEdit !== "none" && (can("time.approve_all") || me!.settings.policies.approvedSheetEdit === "tl_until_invoiced");
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value as any)} className="w-40" aria-label="Status"><option value="approved">Approved</option><option value="rejected">Sent back</option></Select>
        <DateRange value={range} onChange={setRange} />
      </div>
      <ErrorNote error={act.err} />
      <DataTable dateFilter={false} rows={q.data} loading={q.isLoading} rowKey={(s: any) => s.id} exportName={`sheets-${status}`} searchPlaceholder="Search employee, project or date"
        columns={[
          { key: "d", header: "Date", cell: (s: any) => fmtDate(s.date, { weekday: "short", day: "numeric", month: "short" }), sort: (s: any) => s.date, text: (s: any) => s.date },
          { key: "u", header: "Employee", cell: (s: any) => <Link to={`/people/${s.user_id}?tab=timesheet`} className="font-semibold hover:underline">{s.user_name}</Link>, sort: (s: any) => s.user_name, text: (s: any) => s.user_name },
          { key: "p", header: "Projects", cell: (s: any) => <span className="text-[13px]">{[...new Set(s.entries.map((e: any) => e.project_name))].join(", ")}</span>, text: (s: any) => s.entries.map((e: any) => `${e.project_name} ${e.description}`).join(" ") },
          { key: "w", header: "Work types", cell: (s: any) => <span className="text-[13px] text-[var(--muted)]">{[...new Set(s.entries.map((e: any) => e.activity_type).filter(Boolean))].join(", ") || "—"}</span> },
          { key: "sub", header: "Submitted", cell: (s: any) => fmtDateTime(s.submitted_at), sort: (s: any) => s.submitted_at ?? "" },
          { key: "dec", header: status === "approved" ? "Approved" : "Sent back", cell: (s: any) => fmtDateTime(s.decided_at), sort: (s: any) => s.decided_at ?? "" },
          { key: "h", header: "Total", cell: (s: any) => <b>{hrs(s.minutes)}</b>, align: "right", sort: (s: any) => s.minutes, text: (s: any) => String(s.minutes / 60) },
          { key: "x", header: "", cell: (s: any) => status === "approved" && canReopen && <Button size="sm" variant="ghost" onClick={() => act.run(() => post(`/sheets/${s.id}/reopen`), "Sheet reopened").then(() => q.refetch())}>Reopen</Button> },
        ]} />
    </>
  );
}

function TeamToday() {
  const team = useQuery({ queryKey: ["team-today"], queryFn: () => get("/sheets/team") });
  if (team.isLoading) return <Spinner />;
  const people = team.data?.people ?? [];
  return (
    <>
      <StatGrid cols={4}>
        <Stat label="People" value={people.length} />
        <Stat label="Submitted today" value={people.filter((p: any) => p.status === "submitted" || p.status === "approved").length} tone="paid" />
        <Stat label="Started, not submitted" value={people.filter((p: any) => p.status === "draft").length} tone="amber" />
        <Stat label="Not started" value={people.filter((p: any) => !p.status).length} />
      </StatGrid>
      <Table head={["Employee", "Logged today", "Status"]} empty="No one reports to you yet.">
        {people.map((p: any) => (
          <tr key={p.id}><td><Link to={`/people/${p.id}?tab=timesheet`} className="font-semibold hover:underline">{p.name}</Link></td><td className="tabnum">{hrs(p.minutes)}{p.expected ? <span className="text-[var(--muted)]"> of {hrs(p.expected)}</span> : null}</td><td><Pill status={p.status ?? "none"} /></td></tr>
        ))}
      </Table>
    </>
  );
}
