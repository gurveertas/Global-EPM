import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { del, get, post, put, qs } from "../lib/api";
import { useSession } from "../lib/session";
import { Avatar } from "../components/Avatar";
import { Button, Card, DataTable, Empty, ErrorNote, Field, Input, Modal, MoneyInput, PageHeader, Pill, Select, Spinner, Table, Tabs, Textarea, cx, useToast } from "../components/ui";
export { StandupPage, AccessoriesPage } from "./Workspace2";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIso = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

// ---------- calendar ----------
const KIND_COLOR: Record<string, string> = {
  holiday: "bg-[#fff3c4] text-[#6a5200] dark:bg-[#6a5200]/35 dark:text-[#f2db7d]", event: "bg-[#e5eefb] text-[#24529a] dark:bg-[#24529a]/35 dark:text-[#9fc1f2]",
  meeting: "bg-[#e5eefb] text-[#24529a] dark:bg-[#24529a]/35 dark:text-[#9fc1f2]", celebration: "bg-[#fdf0d9] text-[#7d4c00] dark:bg-[#7d4c00]/35 dark:text-[#f5c879]",
  training: "bg-[#e2f3ea] text-[#17623f] dark:bg-[#17623f]/35 dark:text-[#8fd8b2]", other: "bg-black/5 dark:bg-white/10", leave: "bg-[#efe8f8] text-[#5b3290] dark:bg-[#5b3290]/35 dark:text-[#cdb3ef]",
  wfh: "bg-[#edf0ee] text-[#4d5955] dark:bg-white/10 dark:text-[#c5cfcb]", birthday: "bg-[#fcefee] text-[#8a2f2a] dark:bg-[#8a2f2a]/35 dark:text-[#f3b1ac]",
};
const KIND_LABEL: Record<string, string> = { holiday: "Holiday", event: "Event", meeting: "Meeting", celebration: "Celebration", training: "Training", leave: "Leave", wfh: "WFH", birthday: "Birthday", other: "Other" };

export function CalendarPage() {
  const { me, can } = useSession();
  const [month, setMonth] = useState(() => todayIso(me!.settings.locale.timezone).slice(0, 7));
  const [edit, setEdit] = useState<any>(null);
  const [show, setShow] = useState({ holiday: true, events: true, leave: true, wfh: true, birthday: true });
  const first = new Date(`${month}-01T00:00:00Z`);
  const wk = me!.settings.locale.weekStartsOn;
  const start = new Date(first); start.setUTCDate(1 - ((first.getUTCDay() - wk + 7) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); return iso(d); });
  const q = useQuery({ queryKey: ["calendar", month], queryFn: () => get(`/calendar${qs({ from: days[0], to: days[41] })}`) });
  const today = todayIso(me!.settings.locale.timezone);
  const items = useMemo(() => {
    const m = new Map<string, { kind: string; label: string; ev?: any }[]>();
    const add = (d: string, x: { kind: string; label: string; ev?: any }) => m.set(d, [...(m.get(d) ?? []), x]);
    if (!q.data) return m;
    for (const h of q.data.holidays) if (show.holiday) add(h.date, { kind: "holiday", label: `${h.name}${h.half_day ? " (half day)" : ""}` });
    if (show.events) for (const e of q.data.events) for (const d of days) if (d >= e.start_date && d <= e.end_date) add(d, { kind: e.kind, label: `${e.start_time ? e.start_time.slice(0, 5) + " " : ""}${e.title}`, ev: e });
    if (show.leave) for (const l of q.data.leave) for (const d of days) if (d >= l.start_date && d <= l.end_date) add(d, { kind: "leave", label: `${l.user_name}: ${l.half_day ? "half day" : "leave"}` });
    if (show.wfh) for (const w of q.data.wfh) add(w.date, { kind: "wfh", label: `${w.user_name}: WFH` });
    if (show.birthday) for (const b of q.data.birthdays) for (const d of days) if (d.slice(5) === b.md) add(d, { kind: "birthday", label: `${b.name}'s birthday` });
    return m;
  }, [q.data, show]); // eslint-disable-line
  const shift = (n: number) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(iso(d).slice(0, 7)); };
  const dayNames = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 7 + ((i + wk) % 7))).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }));
  return (
    <>
      <PageHeader title="Calendar" sub="Holidays, company events, who's on leave or working from home, and birthdays."
        actions={<>
          <Button variant="secondary" size="sm" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="size-4" /></Button>
          <span className="self-center px-2 font-semibold">{first.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}</span>
          <Button variant="secondary" size="sm" onClick={() => shift(1)} aria-label="Next month"><ChevronRight className="size-4" /></Button>
          {can("events.manage") && <Button onClick={() => setEdit({ title: "", description: "", kind: "event", startDate: today, endDate: today, startTime: "", endTime: "", audience: "everyone" })}>Add event</Button>}
        </>} />
      <div className="mb-4 flex flex-wrap items-center gap-4 text-[13px]">
        {([["holiday", "Holidays"], ["events", "Events"], ["leave", "Leave"], ["wfh", "Work from home"], ["birthday", "Birthdays"]] as const).map(([k, l]) => (
          <label key={k} className="inline-flex cursor-pointer items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--brand)]" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />
            <span className={cx("rounded px-1.5 py-0.5 font-semibold", KIND_COLOR[k === "events" ? "event" : k])}>{l}</span></label>
        ))}
      </div>
      {q.isLoading ? <Spinner /> : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-7 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)]">
            {dayNames.map((d) => <div key={d} className="border-b border-[var(--line)] p-2 text-center text-[13px] font-semibold text-[var(--muted)]">{d}</div>)}
            {days.map((d) => (
              <div key={d} className={cx("min-h-28 border-b border-r border-[var(--line)] p-1.5", d.slice(0, 7) !== month && "bg-black/[.02] opacity-60")}>
                <div className={cx("mb-1 inline-grid size-6 place-items-center rounded-full text-[13px] tabnum", d === today && "bg-[var(--brand)] font-bold text-white")}>{Number(d.slice(8))}</div>
                <ul className="grid gap-0.5">
                  {(items.get(d) ?? []).slice(0, 4).map((x, i) => (
                    <li key={i}><button disabled={!x.ev || !can("events.manage")} onClick={() => x.ev && setEdit({ id: x.ev.id, title: x.ev.title, description: x.ev.description, kind: x.ev.kind, startDate: x.ev.start_date, endDate: x.ev.end_date, startTime: x.ev.start_time?.slice(0, 5) ?? "", endTime: x.ev.end_time?.slice(0, 5) ?? "", audience: x.ev.audience })}
                      className={cx("block w-full truncate rounded px-1.5 py-0.5 text-left text-[12px] font-medium", KIND_COLOR[x.kind] ?? KIND_COLOR.other)} title={x.label}>{x.label}</button></li>
                  ))}
                  {(items.get(d)?.length ?? 0) > 4 && <li className="px-1.5 text-[12px] text-[var(--muted)]">+{items.get(d)!.length - 4} more</li>}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
      {q.data && (
        <Card title="This month's events and holidays" className="mt-6">
          <DataTable search={false} pageSize={40} rowKey={(r: any) => r.key} empty="Nothing planned this month."
            rows={[...q.data.holidays.filter((h: any) => h.date.slice(0, 7) === month).map((h: any) => ({ key: `h${h.id}`, date: h.date, end: h.date, title: h.name, kind: "holiday", who: h.half_day ? "Half day" : "Everyone" })),
              ...q.data.events.filter((e: any) => e.start_date.slice(0, 7) <= month && e.end_date.slice(0, 7) >= month).map((e: any) => ({ key: `e${e.id}`, date: e.start_date, end: e.end_date, title: e.title, kind: e.kind, who: e.audience === "everyone" ? "Everyone" : e.audience === "team" ? "A team" : "A department", time: e.start_time, ev: e }))].sort((a, b) => (a.date < b.date ? -1 : 1))}
            columns={[
              { key: "d", header: "Date", cell: (r: any) => <span className="font-semibold">{new Date(`${r.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}{r.end !== r.date && ` – ${new Date(`${r.end}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`}</span> },
              { key: "t", header: "What", cell: (r: any) => <>{r.title}{r.time && <span className="ml-1.5 text-[var(--muted)]">{r.time.slice(0, 5)}</span>}</> },
              { key: "k", header: "Type", cell: (r: any) => <span className={cx("rounded px-1.5 py-0.5 text-[12px] font-semibold", KIND_COLOR[r.kind] ?? KIND_COLOR.other)}>{KIND_LABEL[r.kind] ?? r.kind}</span> },
              { key: "w", header: "For", cell: (r: any) => r.who },
              { key: "x", header: "", cell: (r: any) => r.ev && can("events.manage") && <Button size="sm" variant="ghost" onClick={() => setEdit({ id: r.ev.id, title: r.ev.title, description: r.ev.description, kind: r.ev.kind, startDate: r.ev.start_date, endDate: r.ev.end_date, startTime: r.ev.start_time?.slice(0, 5) ?? "", endTime: r.ev.end_time?.slice(0, 5) ?? "", audience: r.ev.audience, team_id: r.ev.team_id, department_id: r.ev.department_id })}>Edit</Button> },
            ]} />
        </Card>
      )}
      {edit && <EventModal ev={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function EventModal({ ev, onClose }: { ev: any; onClose: () => void }) {
  const qc = useQueryClient();
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => get<any[]>("/teams") });
  const depts = useQuery({ queryKey: ["departments"], queryFn: () => get<any[]>("/departments") });
  const [f, setF] = useState({ ...ev, teamId: ev.team_id ?? "", departmentId: ev.department_id ?? "" });
  const [err, setErr] = useState<unknown>(null);
  const body = () => ({ ...f, startTime: f.startTime || null, endTime: f.endTime || null, teamId: f.audience === "team" ? f.teamId || null : null, departmentId: f.audience === "department" ? f.departmentId || null : null });
  return (
    <Modal open onClose={onClose} title={ev.id ? "Edit event" : "Add event"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="event">Event</option><option value="meeting">Meeting</option><option value="celebration">Celebration</option><option value="training">Training</option><option value="other">Other</option></Select></Field>
        <Field label="For"><Select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="everyone">Everyone</option><option value="team">A team</option><option value="department">A department</option></Select></Field>
        {f.audience === "team" && <Field label="Team" className="sm:col-span-2"><Select value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}><option value="">Pick…</option>{(teams.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>}
        {f.audience === "department" && <Field label="Department" className="sm:col-span-2"><Select value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}><option value="">Pick…</option>{(depts.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>}
        <Field label="From"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate })} /></Field>
        <Field label="To"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        <Field label="Starts at (optional)"><Input type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></Field>
        <Field label="Ends at (optional)"><Input type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></Field>
        <Field label="Details" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="sm:col-span-2"><ErrorNote error={err} /></div>
        <div className="flex gap-2 sm:col-span-2">
          <Button disabled={!f.title} onClick={async () => { setErr(null); try { if (ev.id) await put(`/events/${ev.id}`, body()); else await post("/events", body()); qc.invalidateQueries({ queryKey: ["calendar"] }); onClose(); } catch (e) { setErr(e); } }}>{ev.id ? "Save" : "Add and notify people"}</Button>
          {ev.id && <Button variant="ghost" onClick={async () => { await del(`/events/${ev.id}`); qc.invalidateQueries({ queryKey: ["calendar"] }); onClose(); }}>Delete</Button>}
        </div>
      </div>
    </Modal>
  );
}

