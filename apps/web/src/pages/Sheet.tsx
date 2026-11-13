import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Check, ChevronLeft, ChevronRight, Clock3, FileText, ListChecks, Pin, Plus, Radar, Send, StickyNote, Tag, Trash2, Undo2, Users } from "lucide-react";
import { AnimatePresence, Ring, motion } from "../components/magic";
import { formatMinutes } from "@eszy/shared";
import { get, post, put, qs } from "../lib/api";
import { useSession } from "../lib/session";
import { Stat, Button, Card, CapBar, ErrorNote, HoursInput, Input, PageHeader, Pill, Select, Spinner, Table, Tabs, Textarea, cx, fmtDate, hrs, plainText, useRange, DateRange, useToast, RichText } from "../components/ui";
import { EntriesTable } from "./EmployeeDetail";
import { CATS } from "../components/Charts";

interface Row { key: number; projectId: string; taskId: string | null; minutes: number | null; description: string; source: string; activityTypeId: string | null; category: "billable" | "inhouse" | "no_work" | null; trackerId: string | null; offline: boolean; offlineReason: string; open?: boolean; existing?: boolean }
const SOURCES = ["eszy", "Upwork", "Toggl", "Jira", "Other"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return iso(x); };

export function MySheet() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "day";
  const { me } = useSession();
  return (
    <>
      <PageHeader title="Timesheet" sub="Log the hours you worked each day. Your Team Lead approves the whole day." />
      <Tabs value={tab} onChange={(t) => setParams(t === "day" ? {} : { tab: t })} tabs={[{ id: "day", label: "Daily timesheet" }, { id: "week", label: "This week" }, { id: "history", label: "My sheet history" }]} />
      {tab === "day" && <DaySheet />}
      {tab === "week" && <WeekView userId={me!.user.id} onOpen={(d) => setParams({ date: d })} />}
      {tab === "history" && <History userId={me!.user.id} />}
    </>
  );
}

/** Week table like the old EPM: billable, non-billable and leave hours, available or overtime, and the day's total. */
function WeekView({ userId, onOpen }: { userId: string; onOpen: (d: string) => void }) {
  const { me } = useSession();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: me!.settings.locale.timezone }).format(new Date());
  const [start, setStart] = useState(() => { const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); return shift(today, -((dow - me!.settings.locale.weekStartsOn + 7) % 7)); });
  const q = useQuery({ queryKey: ["my-week", start], queryFn: () => get(`/reporting/person/${userId}${qs({ from: start, to: shift(start, 6) })}`) });
  if (q.isLoading || !q.data) return <Spinner />;
  const days = q.data.stats.days as any[];
  const byDay = (d: string, cat?: string) => q.data.entries.filter((e: any) => e.date === d && (!cat || e.category === cat)).reduce((a: number, e: any) => a + e.minutes, 0);
  const sum = (f: (d: any) => number) => days.reduce((a, d) => a + f(d), 0);
  const leaveOf = (d: any) => (["leave"].includes(d.status) ? me!.settings.policies.dailyMinimumMinutes : d.status === "half_leave" ? Math.round(me!.settings.policies.dailyMinimumMinutes / 2) : 0);
  return (
    <Card title={`Week of ${fmtDate(start)}`} actions={<><Button size="sm" variant="secondary" onClick={() => setStart(shift(start, -7))} aria-label="Previous week"><ChevronLeft className="size-4" /></Button><Button size="sm" variant="secondary" onClick={() => setStart(shift(start, 7))} disabled={shift(start, 7) > today} aria-label="Next week"><ChevronRight className="size-4" /></Button></>}>
      <Table head={["Date", "Day", "Bill hrs", "Non-bill hrs", "Leave hrs", "Avail / OT", "Day total", "Status", ""]}>
        {days.map((d) => {
          const total = byDay(d.date), bill = byDay(d.date, "billable");
          const diff = total - d.expected;
          return (
            <tr key={d.date} className={cx(d.date === today && "bg-[var(--brand-soft)]/50")}>
              <td className="font-semibold">{fmtDate(d.date, { day: "numeric", month: "short" })}</td>
              <td className="text-[var(--muted)]">{fmtDate(d.date, { weekday: "long" })}{d.wfh && <span className="ml-1.5 text-[12px]">(WFH)</span>}{d.holiday && <span className="ml-1.5 text-[12px]">({d.holiday})</span>}</td>
              <td className="tabnum">{hrs(bill)}</td><td className="tabnum">{hrs(total - bill)}</td><td className="tabnum">{hrs(leaveOf(d))}</td>
              <td className={cx("tabnum font-semibold", d.expected && diff < 0 ? "text-[#9c3a19]" : diff > 0 ? "text-[#17623f]" : "")}>{d.expected || total ? `${diff >= 0 ? "+" : "−"}${formatMinutes(Math.abs(diff))}` : "—"}</td>
              <td className="font-bold tabnum">{hrs(total)}<span className="font-normal text-[var(--muted)]"> / {hrs(d.expected)}</span></td>
              <td><Pill status={d.sheet ?? (d.status === "non_working" || d.status === "holiday" ? "none" : d.status === "future" ? "none" : "none")}>{d.sheet ? undefined : ({ non_working: "Weekend", holiday: "Holiday", leave: "On leave", future: "—" } as any)[d.status] ?? "Not filled"}</Pill></td>
              <td className="text-right">{d.date <= today && <Button size="sm" variant="ghost" onClick={() => onOpen(d.date)}>Open</Button>}</td>
            </tr>
          );
        })}
        <tr className="bg-[var(--bg)] font-bold"><td colSpan={2}>Week total</td><td className="tabnum">{hrs(sum((d) => byDay(d.date, "billable")))}</td><td className="tabnum">{hrs(sum((d) => byDay(d.date) - byDay(d.date, "billable")))}</td><td className="tabnum">{hrs(sum(leaveOf))}</td><td className="tabnum">{(() => { const v = sum((d) => byDay(d.date) - d.expected); return `${v >= 0 ? "+" : "−"}${formatMinutes(Math.abs(v))}`; })()}</td><td className="tabnum">{hrs(sum((d) => byDay(d.date)))} / {hrs(sum((d) => d.expected))}</td><td colSpan={2} /></tr>
      </Table>
      <p className="mt-3 text-[12.5px] text-[var(--muted)]">Bill hrs are hours on billable work types for clients. Non-bill hrs are in-house and no-work hours. {CATS.length} kinds of work are set per work type in Settings.</p>
    </Card>
  );
}

function History({ userId }: { userId: string }) {
  const [range, setRange] = useRange("month");
  const q = useQuery({ queryKey: ["my-history", range.from, range.to], queryFn: () => get(`/reporting/person/${userId}${qs({ from: range.from, to: range.to })}`) });
  return (
    <>
      <div className="mb-4"><DateRange value={range} onChange={setRange} /></div>
      {q.isLoading || !q.data ? <Spinner /> : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Stat label="Logged" value={hrs(q.data.stats.logged)} sub={`${hrs(q.data.stats.expected ?? 0)} expected`} />
            <Stat label="Approved" value={hrs(q.data.stats.approved)} tone="paid" />
            <Stat label="Waiting for approval" value={hrs(q.data.stats.pending ?? 0)} tone="amber" />
            <Stat label="Billable (approved)" value={hrs(q.data.stats.billable)} />
            <Stat label="In-house (approved)" value={hrs(q.data.stats.inhouse)} />
            <Stat label="Leave" value={hrs(q.data.stats.leave ?? 0)} />
          </div>
          <EntriesTable rows={q.data.entries} name="my-sheet-history" />
        </>
      )}
    </>
  );
}

function DaySheet() {
  const [params, setParams] = useSearchParams();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const date = params.get("date") ?? new Intl.DateTimeFormat("en-CA", { timeZone: me!.settings.locale.timezone }).format(new Date());
  const q = useQuery({ queryKey: ["sheet", date], queryFn: () => get(`/sheets/day${qs({ date })}`) });
  const weekStart = useMemo(() => { const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); return shift(date, -((dow - me!.settings.locale.weekStartsOn + 7) % 7)); }, [date, me]);
  const week = useQuery({ queryKey: ["sheet-week", weekStart], queryFn: () => get<any[]>(`/sheets/mine${qs({ from: weekStart, to: shift(weekStart, 6) })}`) });

  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  useEffect(() => {
    if (!q.data) return;
    setRows(q.data.entries.map((e: any, i: number) => ({ key: i, projectId: e.project_id, taskId: e.task_id, minutes: e.minutes, description: e.description, source: e.source,
      activityTypeId: e.activity_type_id, category: e.chosen_category ?? e.category ?? null, trackerId: e.tracker_id, offline: e.offline, offlineReason: e.offline_reason, open: false, existing: true })));
    setErr(null);
    if (!q.data.entries.length && !(q.data.sheet && ["submitted", "approved"].includes(q.data.sheet.status)) && q.data.editable && q.data.projects?.length) {
      setRows([{ key: Date.now(), projectId: q.data.projects[0]?.id ?? "", taskId: null, minutes: null, description: "", source: "eszy", activityTypeId: null, category: null, trackerId: null, offline: false, offlineReason: "", open: true }]);
    }
  }, [q.data]);

  if (q.isLoading || !q.data) return <Spinner />;
  const d = q.data;
  const locked = (d.sheet && ["submitted", "approved"].includes(d.sheet.status)) || !d.editable;
  const total = rows.reduce((a, r) => a + (r.minutes ?? 0), 0);
  const expected = d.expected.minutes as number;
  const projects = d.projects as any[];
  const go = (n: number) => setParams({ date: shift(date, n) });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: me!.settings.locale.timezone }).format(new Date());

  const save = async (andSubmit: boolean) => {
    setErr(null); setBusy(andSubmit ? "submit" : "save");
    try {
      const entries = rows.filter((r) => r.projectId && r.minutes).map((r) => ({ projectId: r.projectId, taskId: r.taskId, minutes: r.minutes!, description: r.description, source: r.source,
        activityTypeId: r.activityTypeId, category: simple ? r.category ?? defaultCat(r.projectId) : null, trackerId: r.trackerId, offline: r.offline, offlineReason: r.offlineReason }));
      if (andSubmit) {
        const missing = rows.filter((r) => r.projectId && r.minutes && !r.description.trim()).length;
        if (missing) throw new Error(`Add a narration (what you did) to ${missing === 1 ? "the entry" : `all ${missing} entries`} before submitting.`);
        const noReason = rows.filter((r) => r.offline && !r.offlineReason.trim()).length;
        if (noReason) throw new Error("Pick a reason for every entry that wasn't tracked.");
      }
      await put("/sheets/day", { date, entries });
      if (andSubmit) { await post("/sheets/day/submit", { date }); toast("Sheet submitted to your TL"); } else toast("Saved");
      qc.invalidateQueries({ queryKey: ["sheet", date] }); qc.invalidateQueries({ queryKey: ["sheet-week"] }); qc.invalidateQueries({ queryKey: ["dashboard"] });
      setRows((rs) => rs.filter((r) => r.projectId && r.minutes).map((r) => ({ ...r, open: false, existing: true })));
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const set = (k: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));

  const simple = d.workTypeMode !== "detailed";
  const defaultCat = (pid: string) => (projects.find((x) => x.id === pid)?.isInternal ? "inhouse" : "billable") as Row["category"];
  /** The kinds of work a project allows: client projects are billable (or in-house); internal ones are in-house or no work. */
  const catsFor = (pid: string) => (projects.find((x) => x.id === pid)?.isInternal ? ["inhouse", "no_work"] : ["billable", "inhouse"]);
  const catOf = (r: Row) => {
    if (simple) return r.category ?? defaultCat(r.projectId) ?? "billable";
    const p = projects.find((x) => x.id === r.projectId);
    if (p?.isInternal) return "inhouse";
    return d.activityTypes.find((a: any) => a.id === r.activityTypeId)?.category ?? "billable";
  };
  const byCat = CATS.map((c) => ({ ...c, minutes: rows.filter((r) => catOf(r) === c.key).reduce((x, r) => x + (r.minutes ?? 0), 0) }));
  const tone = expected && total > expected + 60 ? "over" : expected && total >= expected ? "ok" : undefined;
  const addRow = () => setRows((rs) => [...rs, { key: Date.now(), projectId: projects[0]?.id ?? "", taskId: null, minutes: null, description: "", source: "eszy", activityTypeId: null, category: null, trackerId: null, offline: false, offlineReason: "", open: true }]);
  const status = d.sheet?.status ?? "none";
  const saved = rows.filter((r) => locked || !r.open);
  const editing = locked ? [] : rows.filter((r) => r.open);

  return (
    <>
      {/* Day header: date, week strip and the day's progress ring. */}
      <section className="relative mb-5 overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-[0_8px_30px_-20px_rgba(40,20,80,.35)] animate-fade-up">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-[var(--brand-2)]/15 blur-3xl" />
        <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => go(-1)} aria-label="Previous day"><ChevronLeft className="size-4" /></Button>
              <Button variant="secondary" size="sm" onClick={() => go(1)} disabled={date >= today} aria-label="Next day"><ChevronRight className="size-4" /></Button>
              <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setParams({ date: e.target.value })} className="h-8 w-40" aria-label="Pick a day" />
              {date !== today && <Button variant="ghost" size="sm" onClick={() => setParams({ date: today })}>Today</Button>}
            </div>
            <h2 className="mt-3 font-display text-[28px] font-bold leading-tight tracking-[-0.03em]">
              {new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" })}<span className="text-[var(--muted)]">, {new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: "UTC" })}</span>
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Pill status={status}>{status === "none" ? "Not started" : undefined}</Pill>
              <span className="rounded-full bg-[var(--brand-soft)] px-2.5 py-0.5 text-[12.5px] font-semibold text-[var(--brand)] dark:text-white">{d.expected.reason}{d.expected.reason.startsWith("WFH") ? "" : d.expected.minutes ? " · work from office" : ""}</span>
            </div>
            <div className="mt-5 grid grid-cols-7 gap-1.5">
              {(week.data ?? []).map((w) => {
                const on = w.date === date, isToday = w.date === today;
                const fill = w.expected ? Math.min(1, w.minutes / w.expected) : w.minutes ? 1 : 0;
                return (
                  <button key={w.date} onClick={() => setParams({ date: w.date })} disabled={w.date > today}
                    className={cx("relative rounded-xl border px-2 py-2 text-left transition disabled:opacity-40", on ? "border-transparent bg-brand-gradient text-white neon-ring" : "border-[var(--line)] bg-[var(--bg)]/60 hover:border-[var(--brand-2)]/60")}>
                    <div className={cx("text-[11.5px] font-semibold", on ? "text-white/80" : "text-[var(--muted)]")}>{new Date(`${w.date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })} {new Date(`${w.date}T00:00:00Z`).getUTCDate()}{isToday && !on && <span className="ml-1 inline-block size-1.5 rounded-full bg-[var(--neon)] align-middle" />}</div>
                    <div className="mt-0.5 text-[13.5px] font-bold tabnum">{w.minutes ? formatMinutes(w.minutes) : "—"}</div>
                    <div className={cx("mt-1.5 h-1 overflow-hidden rounded-full", on ? "bg-white/25" : "bg-black/10 dark:bg-white/10")}>
                      <div className={cx("h-full rounded-full", on ? "bg-white" : w.status === "approved" ? "bg-[#1c7a4f]" : w.status === "submitted" ? "bg-[var(--brand-2)]" : w.status === "rejected" ? "bg-[#b4441f]" : "bg-[var(--muted)]/50")} style={{ width: `${fill * 100}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-5 justify-self-center lg:justify-self-end">
            <Ring value={total} max={expected} size={148} stroke={13} tone={tone}>
              <div><div className="font-display text-[26px] font-bold leading-none tabnum">{formatMinutes(total)}</div><div className="mt-1 text-[12px] text-[var(--muted)]">{expected ? `of ${formatMinutes(expected)}` : "no hours needed"}</div></div>
            </Ring>
            <ul className="grid gap-2 text-[13px]">
              {byCat.map((c) => <li key={c.key} className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: c.color }} /><span className="w-24 text-[var(--muted)]">{c.label}</span><b className="tabnum">{formatMinutes(c.minutes)}</b></li>)}
              <li className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[var(--series-4)]" /><span className="w-24 text-[var(--muted)]">Leave</span><b className="tabnum">{formatMinutes(d.away?.leaveMinutes ?? 0)}</b></li>
              {(d.away?.holidayMinutes ?? 0) > 0 && <li className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[var(--series-6)]" /><span className="w-24 truncate text-[var(--muted)]" title={d.away.holiday}>Holiday</span><b className="tabnum">{formatMinutes(d.away.holidayMinutes)}</b></li>}
              <li className="flex items-center gap-2" title={(d.away?.events ?? []).map((e: any) => `${e.title}${e.minutes ? ` (${formatMinutes(e.minutes)})` : " (all day)"}`).join("\n") || undefined}><span className="size-2.5 rounded-full bg-[var(--series-5)]" /><span className="w-24 text-[var(--muted)]">Events{(d.away?.events?.length ?? 0) > 0 ? ` (${d.away.events.length})` : ""}</span><b className="tabnum">{formatMinutes(d.away?.eventMinutes ?? 0)}</b></li>
              <li className="mt-1 border-t border-[var(--line)] pt-2 text-[12.5px]">{expected > total ? <span className="text-[#9c3a19]">{formatMinutes(expected - total)} still to log</span> : expected ? <span className="text-[#1c7a4f]">Day complete{total > expected ? ` (+${formatMinutes(total - expected)})` : ""}</span> : <span className="text-[var(--muted)]">Day off</span>}</li>
            </ul>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="grid min-w-0 gap-5">
          {!d.editable && !(d.sheet && ["submitted", "approved"].includes(d.sheet.status)) && <BackdateRequest date={date} request={d.request} onDone={() => qc.invalidateQueries({ queryKey: ["sheet", date] })} />}
          {status === "rejected" && <Notice tone="late" icon={<Undo2 />}>Your TL sent this sheet back. Fix the entries and submit again.</Notice>}
          {!d.hasApprover && <p className="flex items-start gap-2 rounded-xl border border-[#f3d39a] bg-[#fff7e6] p-3 text-sm text-[#6b4100]"><Users className="mt-0.5 size-4 shrink-0" />You're not in a team with a Team Lead yet, so nobody can approve your sheet. Ask HR to add you to a team or set your reporting manager.</p>}
          {projects.length === 0 ? (
            <Card>
              <div className="grid place-items-center px-6 py-10 text-center">
                <span className="grid size-14 place-items-center rounded-2xl bg-brand-gradient text-white neon-ring"><Briefcase className="size-6" /></span>
                <p className="mt-4 font-display text-[17px] font-bold">You're not on any active project yet</p>
                <p className="mt-1 max-w-md text-[14px] text-[var(--muted)]">Your Project Manager or Team Lead adds you to the projects you work on. Once they do, they show up here and you can log hours against them and their tasks.</p>
              </div>
            </Card>
          ) : (
            <>
              {/* New entries and the one being edited, kept apart from the saved list. */}
              {!locked && d.editable && (
                <Card title={editing.some((r) => r.existing) ? "Edit entry" : "New entry"} sub="Pick the project first; its tasks appear in the task list.">
                  <div className="grid gap-3">
                    <AnimatePresence initial={false}>
                      {editing.map((r) => {
                        const p = projects.find((x) => x.id === r.projectId);
                        const c = CATS.find((x) => x.key === catOf(r))!;
                        const mine = (p?.tasks ?? []).filter((t: any) => t.assignee_id === me!.user.id);
                        const others = (p?.tasks ?? []).filter((t: any) => t.assignee_id !== me!.user.id);
                        const ready = !!(r.projectId && r.minutes && r.description.trim());
                        return (
                          <motion.div key={r.key} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30, transition: { duration: 0.18 } }}
                            className="relative overflow-hidden rounded-xl border border-[var(--brand-2)]/40 bg-[var(--card)] p-4 pl-5">
                            <span aria-hidden className="absolute inset-y-3 left-0 w-1 rounded-r-full" style={{ background: c.color }} />
                            <EntryFields r={r} p={p} mine={mine} others={others} locked={false} set={(patch) => set(r.key, patch)} projects={projects}
                              simple={simple} cats={catsFor(r.projectId)} cat={catOf(r)} activityTypes={d.activityTypes} requireType={d.requireActivityType}
                              reasons={d.offlineReasons ?? []} otherReason={d.offlineReasonOther !== false} />
                            <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] pt-3">
                              <Button size="sm" variant="ghost" onClick={() => setRows((rs) => (r.existing ? rs.map((x) => (x.key === r.key ? { ...x, open: false } : x)) : rs.filter((x) => x.key !== r.key)))}>{r.existing ? "Close" : "Clear"}</Button>
                              <Button size="sm" disabled={!ready} title={ready ? undefined : "Fill in the project, time and narration"} onClick={() => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, open: false, existing: true } : x)))}><Check className="size-4" />{r.existing ? "Update entry" : "Add to sheet"}</Button>
                            </div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                    {!editing.length && (
                      <button onClick={addRow} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--brand-2)]/50 bg-[var(--brand-soft)]/40 text-[14px] font-semibold text-[var(--brand)] transition hover:bg-[var(--brand-soft)] dark:text-white"><Plus className="size-4" />Add an entry</button>
                    )}
                  </div>
                  <p className="mt-3 text-[12.5px] text-[var(--muted)]">"Add to sheet" moves the entry into the sheet below. Save draft or Submit saves everything, including an entry still open here.</p>
                </Card>
              )}

              {/* The day's sheet: what's already in it, and where it stands. */}
              <Card title={<span className="flex items-center gap-2">{status === "none" ? "This day's sheet" : status === "draft" ? "Draft sheet" : status === "submitted" ? "Submitted sheet" : status === "approved" ? "Approved sheet" : "Sheet sent back"}{saved.length > 0 && <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-[12px] font-semibold text-[var(--muted)] ring-1 ring-[var(--line)] tabnum">{saved.length}</span>}</span>}
                sub={locked ? (status === "approved" ? "Approved. Ask your TL if something needs changing." : status === "submitted" ? "Submitted and waiting for your TL." : undefined) : status === "draft" ? "Only you can see a draft. Submit it when the day is done." : "Entries you add show up here."}
                actions={<SheetSteps status={status} />}>
                {d.selfApprove && <Notice tone="brand" icon={<Users />}>Nobody is above you, so you approve your own sheet in Sheet approvals after submitting it.</Notice>}
                {saved.length ? (
                  <ul className="grid gap-2">
                    {saved.map((r) => {
                      const p = projects.find((x) => x.id === r.projectId);
                      const c = CATS.find((x) => x.key === catOf(r))!;
                      return (
                        <li key={r.key} className="group relative rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 pr-10 transition hover:border-[var(--brand-2)]/40 hover:bg-[var(--bg)]/40">
                          <EntrySummary r={r} p={p} cat={c} task={(p?.tasks ?? []).find((t: any) => t.id === r.taskId)?.title} activity={d.activityTypes.find((a: any) => a.id === r.activityTypeId)?.name}
                            onEdit={locked ? undefined : () => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, open: true } : x)))} />
                          {!locked && <button aria-label="Remove entry" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-[var(--muted)] opacity-60 hover:bg-[#fbe4da] hover:text-[#9c3a19] hover:opacity-100"><Trash2 className="size-4" /></button>}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="grid place-items-center rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)]/40 px-6 py-7 text-center">
                    <Clock3 className="size-6 text-[var(--muted)]" />
                    <p className="mt-2 text-[14px] font-semibold">Nothing in this sheet yet</p>
                    <p className="mt-0.5 text-[13px] text-[var(--muted)]">{locked ? "No entries on this sheet." : "Fill in a new entry above and press Add to sheet."}</p>
                  </div>
                )}
                <div className="-mx-5 -mb-5 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-[var(--line)] bg-[var(--bg)]/40 px-5 py-4">
                  <div className="min-w-[14rem] flex-1">
                    <div className="tabnum"><span className="font-display text-[22px] font-bold">{formatMinutes(total)}</span> <span className="text-[13.5px] text-[var(--muted)]">logged{expected ? ` of ${formatMinutes(expected)}` : ""}{expected > total ? ` · ${formatMinutes(expected - total)} to go` : ""}</span></div>
                    {expected > 0 && <div className="mt-1.5 h-1.5 max-w-sm overflow-hidden rounded-full bg-black/[.07] dark:bg-white/10"><div className={cx("h-full rounded-full transition-all", total >= expected ? "bg-[#1c7a4f]" : "bg-brand-gradient")} style={{ width: `${Math.min(100, (total / expected) * 100)}%` }} /></div>}
                  </div>
                  {!locked && <div className="flex gap-2"><Button variant="secondary" busy={busy === "save"} onClick={() => save(false)}>Save draft</Button><Button busy={busy === "submit"} onClick={() => save(true)} disabled={!d.hasApprover}><Send className="size-4" />Submit for approval</Button></div>}
                </div>
                {err ? <div className="mt-6"><ErrorNote error={err} /></div> : null}
              </Card>
            </>
          )}
        </div>

        <div className="grid gap-5">
          <Card title="Hours left" sub="Caps on the projects you're on">
            {!projects.length ? <p className="text-[13.5px] text-[var(--muted)]">No projects yet.</p> : (
              <ul className="grid gap-4">
                {projects.map((p) => (
                  <li key={p.id}>
                    <div className="mb-1 flex items-center justify-between gap-2"><span className="truncate font-semibold">{p.name}</span>{p.isInternal && <span className="text-[11.5px] text-[var(--muted)]">In-house</span>}</div>
                    {p.remaining.projectCap !== null ? <CapBar used={p.remaining.projectUsed} cap={p.remaining.projectCap} label={`${formatMinutes(Math.max(0, p.remaining.projectLeft))} left on the project`} /> : <span className="text-sm text-[var(--muted)]">No project cap</span>}
                    {p.remaining.periodCap !== null && <div className="mt-2"><CapBar used={p.remaining.periodUsed} cap={p.remaining.periodCap} label={`${formatMinutes(Math.max(0, p.remaining.periodLeft))} left this period`} /></div>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-[13px] text-[var(--muted)]">Hours past a cap can't be saved. If you need more time, ask the Billing Manager to add hours.</p>
          </Card>
          <SheetNotes />
        </div>
      </div>
    </>
  );
}

/** Days older than the edit window need the TL's OK first. */
function BackdateRequest({ date, request, onDone }: { date: string; request: any; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<unknown>(null);
  if (request?.status === "pending") return <p className="mb-4 rounded-lg bg-[#e3ecff] p-3 text-sm text-[#2747a8]">You asked to fill this day. Waiting for your TL.</p>;
  return (
    <div className="mb-4 rounded-xl border border-[var(--line)] p-4">
      <p className="mb-2 font-semibold">This day is outside the edit window.</p>
      <p className="mb-3 text-sm text-[var(--muted)]">{request?.status === "rejected" ? "Your last request was declined. You can ask again." : request?.status === "approved" ? "Your approval has expired. Ask again." : "Ask your TL to let you fill it."}</p>
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Why is it late?" value={reason} onChange={(e) => setReason(e.target.value)} className="min-w-60 flex-1" />
        <Button disabled={reason.length < 3} onClick={async () => { setErr(null); try { await post("/sheet-requests", { date, reason }); onDone(); } catch (e) { setErr(e); } }}>Ask to fill this day</Button>
      </div>
      <ErrorNote error={err} />
    </div>
  );
}


// =====================================================================================================
// One entry on the daily sheet
// =====================================================================================================
const CAT_LABEL: Record<string, { label: string; hint: string }> = {
  billable: { label: "Billable", hint: "Work for the client" },
  inhouse: { label: "In-house", hint: "Meetings, training, internal work" },
  no_work: { label: "No work", hint: "Waiting, no task, idle" },
};

function Label({ icon, children, required }: { icon: React.ReactNode; children: React.ReactNode; required?: boolean }) {
  return <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--muted)] [&_svg]:size-3.5">{icon}{children}{required && <span className="text-[#b4441f]" aria-hidden>*</span>}</span>;
}

/**
 * The fields of one entry, each labelled so nobody has to guess: project and time, task and kind of work, tracking, and narration.
 * Tracking depends on the project: fixed-price projects aren't tracked; hourly ones are, and if the project allows offline hours
 * the person can switch tracking off and pick why.
 */
function EntryFields({ r, p, mine, others, locked, set, projects, simple, cats, cat, activityTypes, requireType, reasons, otherReason }: {
  r: Row; p: any; mine: any[]; others: any[]; locked: boolean; set: (patch: Partial<Row>) => void; projects: any[]; simple: boolean; cats: string[]; cat: string;
  activityTypes: any[]; requireType: boolean; reasons: string[]; otherReason: boolean;
}) {
  // Only client work on hourly projects is tracked; internal projects and fixed-price ones aren't.
  const hourly = p?.type === "hourly" && !p?.isInternal;
  const tracked = !r.offline;
  const types = activityTypes.filter((a: any) => cats.includes(a.category ?? "billable"));
  const usingOther = r.offline && r.offlineReason && !reasons.includes(r.offlineReason);
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
        <label className="block min-w-0"><Label icon={<Briefcase />} required>Project</Label>
          <Select aria-label="Project" value={r.projectId} disabled={locked} onChange={(e) => set({ projectId: e.target.value, taskId: null, category: null, activityTypeId: null, offline: false, offlineReason: "", trackerId: null })} className="font-semibold">
            <option value="">Pick a project…</option>
            {projects.map((x) => <option key={x.id} value={x.id}>{x.name}{x.isInternal ? " (in-house)" : ""}</option>)}
          </Select>
        </label>
        <label className="block"><Label icon={<Clock3 />} required>Time spent</Label><HoursInput aria-label="Time spent" value={r.minutes} disabled={locked} onChange={(m) => set({ minutes: m })} /></label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block min-w-0"><Label icon={<ListChecks />}>Task</Label>
          <Select value={r.taskId ?? ""} disabled={locked || !p?.tasks?.length} onChange={(e) => set({ taskId: e.target.value || null })}>
            <option value="">{p?.tasks?.length ? "No particular task" : "This project has no open tasks"}</option>
            {mine.length > 0 && <optgroup label="Assigned to you">{mine.map((t: any) => <option key={t.id} value={t.id} disabled={taskLeft(t) === 0 && t.id !== r.taskId}>{taskLabel(t)}</option>)}</optgroup>}
            {others.length > 0 && <optgroup label={mine.length ? "Other tasks on this project" : "Tasks on this project"}>{others.map((t: any) => <option key={t.id} value={t.id} disabled={taskLeft(t) === 0 && t.id !== r.taskId}>{taskLabel(t)}</option>)}</optgroup>}
          </Select>
          {(() => { const t = p?.tasks?.find((x: any) => x.id === r.taskId); if (!t || t.estimated_minutes == null) return null; const left = taskLeft(t)!; const over = (r.minutes ?? 0) > left;
            return <span className={cx("mt-1 block text-[12.5px]", over ? "font-semibold text-[#b4441f]" : "text-[var(--muted)]")}>{over ? `This task has only ${formatMinutes(left)} left of its ${formatMinutes(t.estimated_minutes)}. Ask your PM for more hours.` : `${formatMinutes(left)} left on this task (of ${formatMinutes(t.estimated_minutes)})`}</span>; })()}
        </label>
        <div className="min-w-0"><Label icon={<Tag />} required={simple || requireType}>Work type</Label>
          {simple ? (
            <div role="radiogroup" aria-label="Work type" className="grid h-10 grid-cols-2 gap-1 rounded-xl border border-[var(--line)] bg-[var(--card)] p-1">
              {cats.map((k) => {
                const on = cat === k;
                const c = CATS.find((x) => x.key === k)!;
                return (
                  <button key={k} type="button" role="radio" aria-checked={on} disabled={locked} title={CAT_LABEL[k].hint} onClick={() => set({ category: k as Row["category"] })}
                    className={cx("flex items-center justify-center gap-2 rounded-lg text-[13.5px] font-semibold transition disabled:cursor-default", on ? "bg-[var(--brand-soft)] text-[var(--text)] ring-1 ring-[var(--brand-2)]/30" : "text-[var(--muted)] hover:text-[var(--text)]")}>
                    <i className="block size-2 rounded-full" style={{ background: c.color }} />{CAT_LABEL[k].label}
                  </button>
                );
              })}
            </div>
          ) : (
            <Select aria-label="Work type" value={r.activityTypeId ?? ""} disabled={locked} onChange={(e) => set({ activityTypeId: e.target.value || null })}>
              <option value="">{requireType ? "Pick a work type…" : "No particular work type"}</option>
              {types.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          )}
        </div>
      </div>

      {hourly && (
        <div className="grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--muted)]"><Radar className="size-3.5" />Tracking<span className="text-[#b4441f]" aria-hidden>*</span></span>
            {p.allowOffline ? (
              <button type="button" role="switch" aria-checked={tracked} aria-label="Tracked" disabled={locked} onClick={() => set(tracked ? { offline: true, trackerId: null, source: "eszy", offlineReason: "" } : { offline: false, offlineReason: "" })}
                className="flex items-center gap-2.5 text-[13.5px] font-semibold">
                <span className={tracked ? "text-[var(--text)]" : "text-[var(--muted)]"}>{tracked ? "Tracked" : "Not tracked (offline)"}</span>
                <span className={cx("relative h-6 w-11 rounded-full transition", tracked ? "bg-brand-gradient" : "bg-black/15 dark:bg-white/15")}><span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", tracked ? "left-[22px]" : "left-0.5")} /></span>
              </button>
            ) : <span className="text-[12.5px] text-[var(--muted)]">Hours on this project must be tracked.</span>}
          </div>
          {tracked ? (
            <label className="block"><span className="sr-only">Tracked in</span>
              <Select aria-label="Tracked in" value={r.trackerId ? `t:${r.trackerId}` : r.source} disabled={locked}
                onChange={(e) => { const v = e.target.value; if (v.startsWith("t:")) set({ trackerId: v.slice(2), source: "Upwork" }); else set({ trackerId: null, source: v }); }}>
                {SOURCES.map((s2) => <option key={s2} value={s2}>{s2 === "eszy" ? "Tracked here in eszy" : `Tracked in ${s2}`}</option>)}
                {p.trackers?.map((t: any) => <option key={t.id} value={`t:${t.id}`}>Tracking ID: {t.label}</option>)}
              </Select>
            </label>
          ) : (
            <fieldset>
              <legend className="mb-1.5 text-[12.5px] font-semibold">Reason for offline tracking<span className="text-[#b4441f]" aria-hidden>*</span></legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {reasons.map((x) => (
                  <label key={x} className={cx("flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13.5px] transition", r.offlineReason === x ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] hover:border-[var(--brand-2)]/50")}>
                    <input type="radio" name={`reason-${r.key}`} className="size-4 accent-[var(--brand)]" checked={r.offlineReason === x} disabled={locked} onChange={() => set({ offlineReason: x })} />{x}
                  </label>
                ))}
                {otherReason && (
                  <label className={cx("flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13.5px] transition", usingOther ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] hover:border-[var(--brand-2)]/50")}>
                    <input type="radio" name={`reason-${r.key}`} className="size-4 accent-[var(--brand)]" checked={!!usingOther} disabled={locked} onChange={() => set({ offlineReason: " " })} />Something else
                  </label>
                )}
              </div>
              {usingOther && <Input className="mt-2" autoFocus placeholder="Why it wasn't tracked" value={r.offlineReason.trim() ? r.offlineReason : ""} disabled={locked} onChange={(e) => set({ offlineReason: e.target.value || " " })} />}
            </fieldset>
          )}
        </div>
      )}

      <label className="block"><Label icon={<FileText />} required>Narration</Label>
        <Textarea rows={2} placeholder="What you did, e.g. built the checkout validation and fixed two layout bugs" value={r.description} disabled={locked} onChange={(e) => set({ description: e.target.value })} className="min-h-[64px]" />
      </label>
    </div>
  );
}

/** A saved entry folded to one line: project, task, kind of work, time and the start of the narration. Click to edit. */
function EntrySummary({ r, p, cat, task, activity, onEdit }: { r: Row; p: any; cat: { label: string; color: string }; task?: string; activity?: string; onEdit?: () => void }) {
  const Tag = onEdit ? "button" : "div";
  return (
    <Tag type={onEdit ? "button" : undefined} onClick={onEdit} className={cx("flex w-full min-w-0 items-center gap-3.5 text-left", onEdit && "cursor-pointer")}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl text-[13px] font-bold text-white" style={{ background: cat.color }}>{(p?.name ?? "?").split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-semibold">{p?.name ?? "Pick a project"}</span>
          {task && <span className="truncate text-[13px] text-[var(--muted)]">· {task}</span>}
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--card)] px-2 py-0.5 text-[12px] font-semibold ring-1 ring-[var(--line)]"><i className="size-2 rounded-full" style={{ background: cat.color }} />{activity ?? cat.label}</span>
          {r.offline && <Pill status="amber">Offline</Pill>}
        </div>
        <p className={cx("mt-1 truncate text-[13px]", r.description.trim() ? "text-[var(--muted)]" : "italic text-[#9c3a19]")}>{r.description.trim() ? plainText(r.description) : "No narration yet"}</p>
      </div>
      <span className="shrink-0 font-display text-[17px] font-bold tabnum">{r.minutes ? formatMinutes(r.minutes) : "—"}</span>
      {onEdit && <span className="shrink-0 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-[var(--brand)] dark:text-[var(--accent)]">Edit</span>}
    </Tag>
  );
}

/** Where the day's sheet is: Draft → Submitted → Approved (or Sent back). */
function SheetSteps({ status }: { status: string }) {
  const steps = [{ id: "draft", label: "Draft" }, { id: "submitted", label: "Submitted" }, { id: "approved", label: status === "rejected" ? "Sent back" : "Approved" }];
  const at = status === "approved" || status === "rejected" ? 2 : status === "submitted" ? 1 : status === "draft" ? 0 : -1;
  return (
    <ol className="flex items-center gap-1.5 text-[12px] font-semibold" aria-label="Sheet status">
      {steps.map((st, i) => (
        <li key={st.id} className="flex items-center gap-1.5">
          {i > 0 && <span className={cx("h-px w-4", i <= at ? "bg-[var(--brand-2)]" : "bg-[var(--line)]")} />}
          <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
            i === at ? (status === "rejected" ? "bg-[#fbe5dc] text-[#9c3a19]" : status === "approved" ? "bg-[#e2f3ea] text-[#17623f]" : "bg-[var(--brand-soft)] text-[var(--brand)] dark:text-white") : i < at ? "text-[var(--text)]" : "text-[var(--muted)]")}>
            <i className={cx("size-1.5 rounded-full", i <= at ? "bg-current" : "bg-[var(--line)]")} />{st.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
function Notice({ tone, icon, children }: { tone: "brand" | "late"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className={cx("mb-4 flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[13.5px] [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
      tone === "late" ? "bg-[#fbe5dc] text-[#7a2b10] dark:bg-[#9c3a19]/25 dark:text-[#f3a98c]" : "bg-[var(--brand-soft)] text-[var(--brand)] dark:text-white")}>{icon}<span>{children}</span></p>
  );
}

/** Shared and personal notes (from Notes) beside the sheet, pinned first, so company notices are seen while filling the day. */
function SheetNotes() {
  const q = useQuery({ queryKey: ["notes", "sheet-side"], queryFn: () => get<any[]>("/notes"), retry: false });
  const list = (q.data ?? []).slice(0, 5);
  if (!list.length) return null;
  return (
    <Card title={<span className="flex items-center gap-2"><StickyNote className="size-4 text-[var(--muted)]" />Notes</span>} actions={<Link to="/notes" className="text-[13px] font-semibold text-[var(--brand)] hover:underline dark:text-[var(--accent)]">All notes</Link>}>
      <ul className="grid gap-2.5">
        {list.map((n: any) => (
          <li key={n.id} className="rounded-xl border border-[var(--line)] bg-[var(--bg)]/50 p-3">
            <div className="flex items-center gap-1.5 text-[13.5px] font-semibold">{n.pinned && <Pin className="size-3.5 text-[var(--accent)]" />}<span className="min-w-0 truncate">{n.title}</span>{n.visibility === "everyone" && <span className="ml-auto shrink-0 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand)] dark:text-white">Everyone</span>}</div>
            {n.body && <RichText className="mt-1 line-clamp-4 text-[13px] text-[var(--muted)]" text={n.body} />}
            <div className="mt-1.5 text-[11.5px] text-[var(--muted)]">{n.author}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Hours a task has left (its given hours minus what's logged on other sheets); null when it has no limit. */
const taskLeft = (t: any) => (t.estimated_minutes == null ? null : Math.max(0, t.estimated_minutes - (t.logged_minutes ?? 0)));
const taskLabel = (t: any) => { const l = taskLeft(t); return l == null ? t.title : l === 0 ? `${t.title} (no hours left)` : `${t.title} (${formatMinutes(l)} left)`; };
