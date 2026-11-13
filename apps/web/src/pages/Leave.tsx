import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Home, Plus, Trash2 } from "lucide-react";
import { formatMinutes } from "@eszy/shared";
import { del, get, post, qs } from "../lib/api";
import { useSession } from "../lib/session";
import { EMPLOYMENT, useAction } from "../lib/hooks";
import {
  Button, Card, Checkbox, DataTable, ErrorNote, Field, HoursInput, Input, Modal, PageHeader, Pill, Segmented, Select, Spinner, Stat, StatGrid, Tabs, Textarea, fmtDate, fmtDateTime, hrs, type Column,
} from "../components/ui";
import { partLabel } from "./EmployeeDetail";

export function Leave() {
  const { can, me } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "mine";
  const qc = useQueryClient();
  const isLead = can("leave.approve_team") || can("leave.manage");
  const scope = tab === "team" ? "team" : tab === "all" ? "all" : "mine";
  const leave = useQuery({ queryKey: ["leave", scope], queryFn: () => get<any[]>(`/leave/requests${qs({ scope })}`), enabled: ["mine", "team", "all"].includes(tab) });
  const wfh = useQuery({ queryKey: ["wfh", scope], queryFn: () => get<any[]>(`/wfh${qs({ scope })}`), enabled: ["mine", "team", "all"].includes(tab) });
  const balances = useQuery({ queryKey: ["balances"], queryFn: () => get<any[]>("/leave/balances") });
  const types = useQuery({ queryKey: ["leave-types"], queryFn: () => get<any[]>("/leave/types") });
  const [modal, setModal] = useState<"leave" | "wfh" | null>(null);
  const act = useAction();
  const refresh = () => ["leave", "wfh", "balances", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const decide = (kind: "leave" | "wfh", id: string, action: string, msg: string) => act.run(() => post(kind === "leave" ? `/leave/requests/${id}/${action}` : `/wfh/${id}/${action}`), msg).then(refresh);
  const pol = me!.settings.policies;
  const pendingFor = (rows?: any[]) => (rows ?? []).filter((r) => r.status === "pending").length;

  const leaveCols: Column<any>[] = [
    { key: "u", header: "Employee", cell: (r) => <Link to={`/people/${r.user_id}?tab=leave`} className="font-semibold hover:underline">{r.user_name}</Link>, sort: (r) => r.user_name, text: (r) => r.user_name, hide: scope === "mine" },
    { key: "d", header: "Dates", cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.start_date)}{r.end_date !== r.start_date && <> – {fmtDate(r.end_date)}</>}</span>, sort: (r) => r.start_date, text: (r) => `${r.start_date} ${r.end_date}` },
    { key: "t", header: "Type", cell: (r) => <>{r.leave_type}<div className="text-[12.5px] text-[var(--muted)]">{partLabel(r)}</div></>, sort: (r) => r.leave_type, text: (r) => `${r.leave_type} ${partLabel(r)}` },
    { key: "n", header: "Days", cell: (r) => <>{Number(r.days)}{Number(r.unpaid_days) > 0 && <div className="text-[12px] text-[#9c3a19]">{Number(r.unpaid_days)} unpaid</div>}{Number(r.sandwich_days) > 0 && <div className="text-[12px] text-[var(--muted)]">incl. {Number(r.sandwich_days)} sandwich</div>}</>, sort: (r) => Number(r.days), align: "right" },
    { key: "r", header: "Reason", cell: (r) => <span className="line-clamp-2 max-w-[32ch] text-[13px]">{r.reason || "—"}</span>, text: (r) => r.reason },
    { key: "c", header: "Asked", cell: (r) => <span className="text-[13px]">{fmtDateTime(r.created_at)}</span>, sort: (r) => r.created_at },
    { key: "s", header: "Status", cell: (r) => <Pill status={r.status} />, sort: (r) => r.status, text: (r) => r.status },
    { key: "x", header: "", cell: (r) => <div className="flex justify-end gap-1 whitespace-nowrap">
      {scope !== "mine" && r.status === "pending" && <><Button size="sm" variant="ghost" onClick={() => decide("leave", r.id, "reject", "Declined")}>Decline</Button><Button size="sm" onClick={() => decide("leave", r.id, "approve", "Leave approved")}>Approve</Button></>}
      {(scope === "mine" || can("leave.manage")) && ["pending", "approved"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => decide("leave", r.id, "cancel", "Cancelled")}>Cancel</Button>}
    </div> },
  ];
  const wfhCols: Column<any>[] = [
    { key: "u", header: "Employee", cell: (r) => <span className="font-semibold">{r.user_name}</span>, sort: (r) => r.user_name, text: (r) => r.user_name, hide: scope === "mine" },
    { key: "d", header: "Date", cell: (r) => fmtDate(r.date, { weekday: "short", day: "numeric", month: "short" }), sort: (r) => r.date, text: (r) => r.date },
    { key: "k", header: "Mode", cell: (r) => (r.kind === "full" ? "Full day" : r.kind === "half" ? "Half day" : `${formatMinutes(r.minutes ?? 0)} from home`), text: (r) => r.kind },
    { key: "r", header: "Reason", cell: (r) => <span className="text-[13px]">{r.reason || "—"}</span>, text: (r) => r.reason },
    { key: "s", header: "Status", cell: (r) => <Pill status={r.status} />, sort: (r) => r.status, text: (r) => r.status },
    { key: "x", header: "", cell: (r) => <div className="flex justify-end gap-1 whitespace-nowrap">
      {scope !== "mine" && r.status === "pending" && <><Button size="sm" variant="ghost" onClick={() => decide("wfh", r.id, "reject", "Declined")}>Decline</Button><Button size="sm" onClick={() => decide("wfh", r.id, "approve", "WFH approved")}>Approve</Button></>}
      {scope === "mine" && ["pending", "approved"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => decide("wfh", r.id, "cancel", "Cancelled")}>Cancel</Button>}
    </div> },
  ];

  return (
    <>
      <PageHeader title="Leave and work from home" sub={`A normal day needs ${formatMinutes(pol.dailyMinimumMinutes)}; an approved WFH day ${formatMinutes(pol.wfhFullDayMinutes)} (half day ${formatMinutes(pol.wfhHalfDayMinutes)}).${pol.sandwichRule ? " Weekends between two leave days count as leave." : ""}`}
        actions={can("leave.request") && <><Button variant="secondary" onClick={() => setModal("wfh")}><Home />Ask to work from home</Button><Button onClick={() => setModal("leave")}><CalendarPlus />Request leave</Button></>} />
      {can("leave.request") && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(balances.data ?? []).map((b) => {
            const total = Number(b.credited_days) + Number(b.carried_days ?? 0);
            return (
              <div key={b.leave_type_id} className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-4">
                <div className="flex items-center justify-between text-[13px] font-medium text-[var(--muted)]"><span>{b.name}</span>{!b.paid && <Pill status="unpaid">Unpaid</Pill>}</div>
                <div className="mt-1.5 text-[22px] font-bold tabnum">{Number(b.left_days)} <span className="text-[13px] font-medium text-[var(--muted)]">days left</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[.07] dark:bg-white/10"><div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${total ? Math.min(100, (Number(b.used_days) / total) * 100) : 0}%` }} /></div>
                <div className="mt-1.5 text-[12.5px] text-[var(--muted)]">{Number(b.used_days)} used of {total}{Number(b.carried_days) ? ` (${Number(b.carried_days)} carried forward)` : ""}</div>
              </div>
            );
          })}
        </div>
      )}
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { id: "mine", label: "My requests", hide: !can("leave.request") }, { id: "team", label: "My team", hide: !isLead, count: tab === "team" ? pendingFor(leave.data) + pendingFor(wfh.data) : undefined },
        { id: "all", label: "Everyone", hide: !can("leave.manage") }, { id: "credits", label: "Leave credits", hide: !can("leave.manage") }, { id: "holidays", label: "Holidays and non-working days" },
      ]} />
      <ErrorNote error={act.err} />
      {["mine", "team", "all"].includes(tab) && (
        <div className="grid gap-6">
          <section><h2 className="mb-3 text-[15.5px] font-bold">Leave</h2><DataTable rows={leave.data} loading={leave.isLoading} rowKey={(r) => r.id} columns={leaveCols} exportName={`leave-${scope}`} searchPlaceholder="Search by date, type, reason" empty="No leave requests." /></section>
          <section><h2 className="mb-3 text-[15.5px] font-bold">Work from home</h2><DataTable rows={wfh.data} loading={wfh.isLoading} rowKey={(r) => r.id} columns={wfhCols} exportName={`wfh-${scope}`} searchPlaceholder="Search" empty="No WFH requests." /></section>
        </div>
      )}
      {tab === "credits" && <Credits />}
      {tab === "holidays" && <Holidays />}
      <RequestModal kind={modal} onClose={() => setModal(null)} types={types.data ?? []} dailyMinutes={pol.dailyMinimumMinutes} onDone={() => { setModal(null); refresh(); }} />
    </>
  );
}

function RequestModal({ kind, onClose, types, onDone, dailyMinutes }: { kind: "leave" | "wfh" | null; onClose: () => void; types: any[]; onDone: () => void; dailyMinutes: number }) {
  const [mode, setMode] = useState<"full" | "multiple" | "half" | "short">("full");
  const [f, setF] = useState({ leaveTypeId: "", startDate: "", endDate: "", half: "first_half", shortMinutes: 120 as number | null, reason: "", date: "", wfhKind: "full", wfhMinutes: 120 as number | null });
  const act = useAction();
  const active = types.filter((t) => t.active);
  const submit = async () => {
    const leaveTypeId = f.leaveTypeId || active[0]?.id;
    const ok = kind === "leave"
      ? await act.run(() => post("/leave/requests", {
          leaveTypeId, startDate: f.startDate, endDate: mode === "multiple" ? f.endDate || f.startDate : f.startDate, reason: f.reason,
          part: mode === "half" ? f.half : mode === "short" ? "short" : "full", shortMinutes: mode === "short" ? f.shortMinutes : null,
        }), "Leave request sent")
      : await act.run(() => post("/wfh", { date: f.date, kind: f.wfhKind, minutes: f.wfhKind === "hours" ? f.wfhMinutes : null, reason: f.reason }), "WFH request sent");
    if (ok) onDone();
  };
  const ready = kind === "leave" ? !!f.startDate && (mode !== "multiple" || !!f.endDate) && (mode !== "short" || !!f.shortMinutes) : !!f.date;
  return (
    <Modal open={!!kind} onClose={onClose} title={kind === "leave" ? "Request leave" : "Ask to work from home"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={!!act.busy} disabled={!ready} onClick={submit}>Send to my TL</Button></>}>
      <div className="grid gap-4">
        {kind === "leave" ? (
          <>
            <Segmented value={mode} onChange={setMode} options={[{ id: "full", label: "Full day" }, { id: "multiple", label: "Multiple days" }, { id: "half", label: "Half day" }, { id: "short", label: "Short leave" }]} />
            <Field label="Leave type"><Select value={f.leaveTypeId || active[0]?.id || ""} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })}>{active.map((t) => <option key={t.id} value={t.id}>{t.name}{t.paid ? "" : " (unpaid)"}</option>)}</Select></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={mode === "multiple" ? "From" : "Date"}><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
              {mode === "multiple" && <Field label="To"><Input type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>}
              {mode === "half" && <Field label="Which half"><Select value={f.half} onChange={(e) => setF({ ...f, half: e.target.value })}><option value="first_half">Morning (first half)</option><option value="second_half">Afternoon (second half)</option></Select></Field>}
              {mode === "short" && <Field label="Hours off" hint={`Counted as part of a ${formatMinutes(dailyMinutes)} day`}><HoursInput value={f.shortMinutes} onChange={(m) => setF({ ...f, shortMinutes: m })} /></Field>}
            </div>
          </>
        ) : (
          <>
            <Segmented value={f.wfhKind as any} onChange={(x: string) => setF({ ...f, wfhKind: x })} options={[{ id: "full", label: "Full day" }, { id: "half", label: "Half day" }, { id: "hours", label: "A few hours" }]} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
              {f.wfhKind === "hours" && <Field label="Hours from home"><HoursInput value={f.wfhMinutes} onChange={(m) => setF({ ...f, wfhMinutes: m })} /></Field>}
            </div>
          </>
        )}
        <Field label="Reason"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="A short reason helps your TL decide" /></Field>
        <ErrorNote error={act.err} />
      </div>
    </Modal>
  );
}

/** HR's leave credits view, like the old EPM's Leave Credit Management. */
function Credits() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["leave-credits", year], queryFn: () => get(`/reporting/leave-credits?year=${year}`) });
  const types = useQuery({ queryKey: ["leave-types"], queryFn: () => get<any[]>("/leave/types") });
  const [edit, setEdit] = useState<any | null>(null);
  const act = useAction();
  if (q.isLoading || !q.data) return <Spinner />;
  const people = q.data.people.filter((p: any) => !status || p.employment_status === status);
  const day = q.data.dailyMinutes;
  const paidTypes = (types.data ?? []).filter((t) => t.paid && t.active);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" aria-label="Year">{[0, 1, 2].map((i) => <option key={i} value={new Date().getFullYear() - i}>{new Date().getFullYear() - i}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" aria-label="Employment"><option value="">Everyone</option>{EMPLOYMENT.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
      </div>
      <StatGrid cols={4}>
        <Stat label="Employees" value={people.length} />
        <Stat label="Provisional" value={people.filter((p: any) => p.employment_status === "provisional").length} />
        <Stat label="Serving notice" value={people.filter((p: any) => p.employment_status === "notice").length} tone="amber" />
        <Stat label="Leave days taken" value={people.reduce((a: number, p: any) => a + Number(p.taken_days), 0)} sub={`${people.reduce((a: number, p: any) => a + Number(p.unpaid_days), 0)} unpaid`} />
      </StatGrid>
      <ErrorNote error={act.err} />
      <DataTable rows={people} rowKey={(p: any) => p.id} exportName={`leave-credits-${year}`} searchPlaceholder="Search by name or status"
        columns={[
          { key: "n", header: "Employee", cell: (p: any) => <><Link to={`/people/${p.id}?tab=leave`} className="font-semibold hover:underline">{p.name}</Link><div className="text-[12px] text-[var(--muted)]">{[p.employee_code, p.team_name].filter(Boolean).join(" · ")}</div></>, sort: (p: any) => p.name, text: (p: any) => `${p.name} ${p.employment_status}` },
          { key: "s", header: "Status", cell: (p: any) => <Pill status={p.employment_status} />, sort: (p: any) => p.employment_status, text: (p: any) => p.employment_status },
          { key: "j", header: "Joined", cell: (p: any) => fmtDate(p.joined_on), sort: (p: any) => p.joined_on ?? "" },
          { key: "pr", header: "Probation / notice", cell: (p: any) => <span className="text-[13px]">{p.employment_status === "notice" ? `Notice from ${fmtDate(p.notice_starts_on)}${p.last_working_day ? `, leaving ${fmtDate(p.last_working_day)}` : ""}` : p.probation_ends_on ? `Probation until ${fmtDate(p.probation_ends_on)}` : "—"}</span> },
          ...paidTypes.map((t) => ({
            key: t.id, header: t.name, align: "right" as const,
            cell: (p: any) => { const b = p.balances.find((x: any) => x.leave_type_id === t.id); if (!b) return "—"; const left = Number(b.credited) + Number(b.carried) - Number(b.used); return <><b>{left}</b><span className="text-[var(--muted)]"> / {Number(b.credited) + Number(b.carried)}</span>{Number(b.carried) > 0 && <div className="text-[11.5px] text-[var(--muted)]">{Number(b.carried)} carried</div>}</>; },
            text: (p: any) => { const b = p.balances.find((x: any) => x.leave_type_id === t.id); return b ? String(Number(b.credited) + Number(b.carried) - Number(b.used)) : ""; },
          })),
          { key: "t", header: "Taken", cell: (p: any) => <>{Number(p.taken_days)}{Number(p.unpaid_days) > 0 && <div className="text-[12px] text-[#9c3a19]">{Number(p.unpaid_days)} unpaid</div>}</>, align: "right", sort: (p: any) => Number(p.taken_days), text: (p: any) => String(p.taken_days) },
          { key: "lh", header: "Leave hrs", cell: (p: any) => hrs(p.leave_minutes), align: "right", sort: (p: any) => p.leave_minutes ?? 0 },
          { key: "w", header: "Worked / expected", cell: (p: any) => (p.expected == null ? "—" : <span className="tabnum">{hrs(p.logged)} / {hrs(p.expected)}</span>), sort: (p: any) => (p.expected ? p.logged / p.expected : 0) },
          { key: "pd", header: "Pending", cell: (p: any) => p.pending_requests || "—", align: "right" },
          { key: "x", header: "", cell: (p: any) => <Button size="sm" variant="ghost" onClick={() => setEdit({ ...p, leaveTypeId: paidTypes[0]?.id, credited: null })}>Edit credits</Button> },
        ]} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Leave credits for ${edit?.name ?? ""}`}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button busy={!!act.busy} disabled={edit?.credited == null} onClick={async () => { if (await act.run(() => post("/leave/balances/adjust", { userId: edit.id, leaveTypeId: edit.leaveTypeId, year, creditedDays: Number(edit.credited) }), "Credits saved")) { setEdit(null); q.refetch(); } }}>Save</Button></>}>
        {edit && (
          <div className="grid gap-4">
            <Field label="Leave type"><Select value={edit.leaveTypeId} onChange={(e) => setEdit({ ...edit, leaveTypeId: e.target.value, credited: null })}>{paidTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            <Field label={`Days credited for ${year}`} hint={(() => { const b = edit.balances.find((x: any) => x.leave_type_id === edit.leaveTypeId); return b ? `Now ${Number(b.credited)} credited, ${Number(b.used)} used, ${Number(b.carried)} carried forward.` : "No balance yet for this type."; })()}>
              <Input type="number" step="0.5" min="0" value={edit.credited ?? ""} onChange={(e) => setEdit({ ...edit, credited: e.target.value === "" ? null : e.target.value })} />
            </Field>
            <p className="text-[12.5px] text-[var(--muted)]">One day is {formatMinutes(day)}.</p>
            <ErrorNote error={act.err} />
          </div>
        )}
      </Modal>
    </>
  );
}

function Holidays() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const q = useQuery({ queryKey: ["holidays", year], queryFn: () => get<any[]>(`/holidays?year=${year}`) });
  const [f, setF] = useState({ date: "", name: "", halfDay: false, kind: "holiday", description: "" });
  const act = useAction();
  const add = async () => { if (await act.run(() => post("/holidays", f), "Saved")) { setF({ date: "", name: "", halfDay: false, kind: "holiday", description: "" }); qc.invalidateQueries({ queryKey: ["holidays"] }); } };
  const list = q.data ?? [];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        <div className="mb-3 flex items-center gap-2"><Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" aria-label="Year">{[-1, 0, 1].map((i) => <option key={i} value={new Date().getFullYear() + i}>{new Date().getFullYear() + i}</option>)}</Select><span className="text-[13px] text-[var(--muted)]">{list.filter((h) => h.kind !== "non_working").length} holidays · {list.filter((h) => h.kind === "non_working").length} non-working days</span></div>
        <DataTable rows={list} loading={q.isLoading} rowKey={(h) => h.id} search={false} pageSize={60} empty="No holidays added for this year."
          columns={[
            { key: "d", header: "Date", cell: (h) => <span className="font-semibold">{fmtDate(h.date, { weekday: "short", day: "numeric", month: "short" })}</span>, sort: (h) => h.date },
            { key: "n", header: "Name", cell: (h) => <>{h.name}{h.description && <div className="text-[12.5px] text-[var(--muted)]">{h.description}</div>}</> },
            { key: "k", header: "Kind", cell: (h) => <Pill status={h.kind === "non_working" ? "pending" : "holiday"}>{h.kind === "non_working" ? "Non-working day" : "Holiday"}</Pill> },
            { key: "l", header: "Length", cell: (h) => (h.half_day ? "Half day" : "Full day") },
            { key: "x", header: "", cell: (h) => can("leave.manage") && <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => act.run(() => del(`/holidays/${h.id}`), "Removed").then(() => qc.invalidateQueries({ queryKey: ["holidays"] }))}><Trash2 /></Button> },
          ]} />
      </div>
      {can("leave.manage") && (
        <Card title="Add a day off" sub="Holidays and non-working days lower everyone's expected hours.">
          <div className="grid gap-3">
            <Segmented value={f.kind as any} onChange={(x: string) => setF({ ...f, kind: x })} options={[{ id: "holiday", label: "Holiday" }, { id: "non_working", label: "Non-working day" }]} />
            <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === "holiday" ? "e.g. Diwali" : "e.g. Company offsite"} /></Field>
            <Field label="Reason (optional)"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <Checkbox label="Half day" hint="Half the usual hours are expected" checked={f.halfDay} onChange={(v) => setF({ ...f, halfDay: v })} />
            <ErrorNote error={act.err} />
            <Button onClick={add} disabled={!f.date || !f.name}><Plus />Add</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
