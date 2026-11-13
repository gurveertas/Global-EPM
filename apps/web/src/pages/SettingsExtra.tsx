import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, openFile, post, put } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, Card, Checkbox, DataTable, ErrorNote, Field, Input, Modal, Pill, Select, Spinner, Table, Tabs, useToast } from "../components/ui";
import { formatMinutes } from "@eszy/shared";

/** Extra work-policy settings: approved-sheet edits, reminders, backdate requests, standups, leave rules. */
export function PolicyExtras({ p, up }: { p: any; up: (sec: string, patch: any) => void }) {
  const set = (patch: any) => up("policies", patch);
  return (
    <div className="mt-6 grid gap-5 border-t border-[var(--line)] pt-5">
      <h3 className="text-base font-bold">Sheets</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Changing approved sheets" info="Hours on an issued invoice stay locked until that invoice is cancelled, whatever you pick.">
          <Select value={p.approvedSheetEdit} onChange={(e) => set({ approvedSheetEdit: e.target.value })}>
            <option value="none">Not allowed</option>
            <option value="tl_until_invoiced">TL can reopen until invoiced</option>
            <option value="admin">Admin only</option>
          </Select>
        </Field>
        <Field label="Remind the TL after (days)" hint="About sheets still waiting. 0 = off"><Input type="number" min={0} max={30} value={p.pendingReminderDays} onChange={(e) => set({ pendingReminderDays: Number(e.target.value) })} /></Field>
        <Field label="Backdate request open for (hours)" hint="After a TL approves filling an old day"><Input type="number" min={1} max={720} value={p.backdateRequestHours} onChange={(e) => set({ backdateRequestHours: Number(e.target.value) })} /></Field>
      </div>
      <h3 className="text-base font-bold">Sheet entries</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Work type on each entry" hint={p.workTypeMode === "detailed" ? "People pick a work type from Masters (Development, Meeting…)." : "People pick Billable or In-house (In-house or No work on internal projects)."}>
          <Select value={p.workTypeMode ?? "simple"} onChange={(e) => set({ workTypeMode: e.target.value })}><option value="simple">Simple: Billable, In-house, No work</option><option value="detailed">Detailed: work types from Masters</option></Select>
        </Field>
      </div>
      <div>
        <div className="mb-1.5 text-[13px] font-semibold">Reasons for offline hours</div>
        <p className="mb-2 text-[12.5px] text-[var(--muted)]">On hourly projects that allow offline hours, people pick one of these when they switch tracking off.</p>
        <div className="grid gap-2">
          {(p.offlineReasons ?? []).map((r: string, i: number) => (
            <div key={i} className="flex gap-2">
              <Input value={r} onChange={(e) => set({ offlineReasons: p.offlineReasons.map((x: string, j: number) => (j === i ? e.target.value : x)) })} />
              <button type="button" aria-label={`Remove ${r}`} onClick={() => set({ offlineReasons: p.offlineReasons.filter((_: string, j: number) => j !== i) })} className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--line)] text-[var(--muted)] hover:text-[#b4441f]">×</button>
            </div>
          ))}
          {(p.offlineReasons ?? []).length < 12 && <button type="button" onClick={() => set({ offlineReasons: [...(p.offlineReasons ?? []), ""] })} className="h-10 rounded-xl border-2 border-dashed border-[var(--line)] text-[13.5px] font-semibold text-[var(--muted)] hover:border-[var(--brand-2)] hover:text-[var(--brand)]">+ Add a reason</button>}
        </div>
        <div className="mt-3"><Checkbox label="Let people type their own reason too" checked={p.offlineReasonOther !== false} onChange={(v) => set({ offlineReasonOther: v })} /></div>
      </div>
      <div className="grid gap-3">
        {p.workTypeMode === "detailed" && <Checkbox label="Every sheet entry needs a work type" checked={p.requireActivityType} onChange={(v) => set({ requireActivityType: v })} />}
        <Checkbox label="Daily standup is turned on" checked={p.standupEnabled} onChange={(v) => set({ standupEnabled: v })} />
      </div>
      <h3 className="text-base font-bold">Leave rules</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Probation (months)" hint="Leave types can be blocked during probation"><Input type="number" min={0} max={24} value={p.probationMonths} onChange={(e) => set({ probationMonths: Number(e.target.value) })} /></Field>
        <Field label="Notice period (days)" hint="Leave types can be blocked during notice"><Input type="number" min={0} max={180} value={p.noticeDays} onChange={(e) => set({ noticeDays: Number(e.target.value) })} /></Field>
      </div>
      <div className="grid gap-3">
        <Checkbox label="Sandwich rule" hint="Weekends and holidays between two leave days count as leave" checked={p.sandwichRule} onChange={(v) => set({ sandwichRule: v })} />
        <Checkbox label="Days past the balance become unpaid" hint="Untick to refuse requests that go past the balance" checked={p.unpaidWhenNoBalance} onChange={(v) => set({ unpaidWhenNoBalance: v })} />
      </div>
    </div>
  );
}

export function SecurityFields({ a, up }: { a: any; up: (sec: string, patch: any) => void }) {
  return (
    <div className="mt-6 grid gap-4 border-t border-[var(--line)] pt-5 sm:grid-cols-2">
      <h3 className="text-base font-bold sm:col-span-2">Security</h3>
      <Field label="Two-step sign-in" hint="With an authenticator app such as Google Authenticator">
        <Select value={a.twoFactor} onChange={(e) => up("auth", { twoFactor: e.target.value })}>
          <option value="off">Off</option><option value="optional">Each person can turn it on</option><option value="required">Required for everyone</option>
        </Select>
      </Field>
      <Field label="Stay signed in for (days)" hint="After this, people sign in again"><Input type="number" min={1} max={90} value={a.sessionDays} onChange={(e) => up("auth", { sessionDays: Number(e.target.value) })} /></Field>
    </div>
  );
}

// ---------- company lists ----------
const LISTS = [
  { id: "activity-types", label: "Work types", hint: "Picked on each sheet entry, e.g. Development, Meeting." },
  { id: "project-sources", label: "Project sources", hint: "Where projects come from, e.g. Upwork, Direct." },
  { id: "project-accounts", label: "Source accounts", hint: "Accounts on a source, e.g. your Upwork agency profiles." },
  { id: "communication-types", label: "Communication types", hint: "How you talk to clients, e.g. Slack, Email." },
];
export function ListsTab() {
  const [tab, setTab] = useState("activity-types");
  return (
    <>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "activity-types", label: "Work types" }, { id: "project-sources", label: "Onboarding sources" },
        { id: "project-accounts", label: "Onboarding accounts" }, { id: "communication-types", label: "Communication types" }, { id: "project-stages", label: "Project stages" },
      ]} />
      <MasterTable key={tab} id={tab} />
    </>
  );
}
export const MASTER_INFO: Record<string, { hint: string; noun: string; placeholder: string }> = {
  "activity-types": { noun: "work type", placeholder: "e.g. Development", hint: "Picked on each sheet entry. The kind of work decides how reports count it: billable client work, in-house work, or no work (idle, waiting for the client)." },
  "project-sources": { noun: "source", placeholder: "e.g. Upwork", hint: "Where clients and projects come from (Upwork, Direct, Referral…)." },
  "project-accounts": { noun: "account", placeholder: "e.g. Agency profile", hint: "Your accounts on each source, e.g. your Upwork agency or freelancer profiles. Clients and projects record which account they came through." },
  "communication-types": { noun: "communication type", placeholder: "e.g. Slack", hint: "How each client talks to you." },
  "project-stages": { noun: "stage", placeholder: "e.g. Awaiting feedback", hint: "The columns of the project board, in order. PMs drag projects between them. Mark the last one as done so finished work is easy to spot." },
};
export function MasterTable({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["list", id], queryFn: () => get<any[]>(`/lists/${id}`) });
  const sources = useQuery({ queryKey: ["list", "project-sources"], queryFn: () => get<any[]>("/lists/project-sources"), enabled: id === "project-accounts" });
  const [edit, setEdit] = useState<any | null>(null);
  const [show, setShow] = useState<"active" | "all">("active");
  const [err, setErr] = useState<unknown>(null);
  const info = MASTER_INFO[id];
  const refresh = () => { qc.invalidateQueries({ queryKey: ["list", id] }); };
  const save = async () => {
    setErr(null);
    try {
      const b = { name: edit.name, sourceId: edit.sourceId || null, profileUrl: edit.profileUrl ?? "", category: edit.category, ...(id === "project-stages" ? { position: Number(edit.position) || undefined, isDone: !!edit.isDone } : {}), ...(edit.id ? { active: edit.active } : {}) };
      if (edit.id) await put(`/lists/${id}/${edit.id}`, b); else await post(`/lists/${id}`, b);
      setEdit(null); refresh();
    } catch (e) { setErr(e); }
  };
  const rows = (q.data ?? []).filter((x) => show === "all" || x.active);
  const cat: Record<string, string> = { billable: "Billable", inhouse: "In-house", no_work: "No work" };
  return (
    <>
      <p className="mb-4 max-w-[80ch] text-[13.5px] text-[var(--muted)]">{info.hint}</p>
      <DataTable rows={rows} loading={q.isLoading} rowKey={(x: any) => x.id} searchPlaceholder={`Search ${info.noun}s`} exportName={id}
        filters={<Select value={show} onChange={(e) => setShow(e.target.value as any)} className="w-36" aria-label="Show"><option value="active">In use</option><option value="all">Including hidden</option></Select>}
        actions={<Button size="sm" onClick={() => setEdit({ name: "", category: "billable", sourceId: "", profileUrl: "" })}>Add {info.noun}</Button>}
        columns={[
          { key: "n", header: "Name", cell: (x: any) => <span className={x.active ? "font-semibold" : "text-[var(--muted)] line-through"}>{x.name}</span>, sort: (x: any) => x.name, text: (x: any) => x.name },
          ...(id === "activity-types" ? [
            { key: "c", header: "Kind of work", cell: (x: any) => <Pill status={x.category}>{cat[x.category]}</Pill>, sort: (x: any) => x.category, text: (x: any) => x.category },
            { key: "h", header: "Hours logged", cell: (x: any) => formatMinutes(x.logged_minutes ?? 0), align: "right" as const, sort: (x: any) => x.logged_minutes },
          ] : []),
          ...(id === "project-accounts" ? [
            { key: "s", header: "Source", cell: (x: any) => x.source_name ?? "—", sort: (x: any) => x.source_name ?? "", text: (x: any) => x.source_name ?? "" },
            { key: "u", header: "Profile", cell: (x: any) => (x.profile_url ? <a className="font-semibold text-[var(--brand)] underline" href={x.profile_url} target="_blank" rel="noreferrer">Open</a> : "—") },
          ] : []),
          ...(id === "project-stages" ? [
            { key: "o", header: "Order", cell: (x: any) => <span className="tabnum">{x.position}</span>, align: "right" as const, sort: (x: any) => x.position },
            { key: "d", header: "Counts as done", cell: (x: any) => (x.is_done ? "Yes" : "—") },
            { key: "p", header: "Projects", cell: (x: any) => x.project_count, align: "right" as const, sort: (x: any) => x.project_count },
          ] : []),
          ...(id === "project-sources" ? [{ key: "a", header: "Accounts", cell: (x: any) => x.account_count, align: "right" as const, sort: (x: any) => x.account_count }] : []),
          ...(id === "project-sources" || id === "project-accounts" ? [
            { key: "cl", header: "Clients", cell: (x: any) => x.client_count, align: "right" as const, sort: (x: any) => x.client_count },
            { key: "p", header: "Projects", cell: (x: any) => x.project_count, align: "right" as const, sort: (x: any) => x.project_count },
          ] : []),
          { key: "st", header: "Status", cell: (x: any) => <Pill status={x.active ? "active" : "disabled"}>{x.active ? "In use" : "Hidden"}</Pill> },
          { key: "x", header: "", cell: (x: any) => <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEdit({ id: x.id, name: x.name, category: x.category, sourceId: x.source_id ?? "", profileUrl: x.profile_url ?? "", active: x.active, position: x.position, isDone: x.is_done })}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={async () => { await put(`/lists/${id}/${x.id}`, { active: !x.active }); refresh(); }}>{x.active ? "Hide" : "Show"}</Button>
          </div> },
        ]} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${info.noun}` : `Add ${info.noun}`}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit?.name} onClick={save}>Save</Button></>}>
        {edit && (
          <div className="grid gap-4">
            <Field label="Name"><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={info.placeholder} /></Field>
            {id === "activity-types" && <Field label="Kind of work" hint="Decides how this work type counts in utilization and sheet reports."><Select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}><option value="billable">Billable (client work)</option><option value="inhouse">In-house (meetings, training, internal)</option><option value="no_work">No work (idle, waiting)</option></Select></Field>}
            {id === "project-stages" && <>
              <Field label="Order" hint="Lower numbers come first on the board."><Input type="number" min={0} value={edit.position ?? ""} onChange={(e) => setEdit({ ...edit, position: e.target.value })} placeholder="Next after the last" /></Field>
              <Checkbox label="This stage means the work is done" checked={!!edit.isDone} onChange={(v) => setEdit({ ...edit, isDone: v })} />
            </>}
            {id === "project-accounts" && <>
              <Field label="Source"><Select value={edit.sourceId} onChange={(e) => setEdit({ ...edit, sourceId: e.target.value })}><option value="">None</option>{(sources.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label="Profile link or account ID"><Input value={edit.profileUrl} onChange={(e) => setEdit({ ...edit, profileUrl: e.target.value })} placeholder="e.g. https://www.upwork.com/agencies/…" /></Field>
            </>}
            <ErrorNote error={err} />
          </div>
        )}
      </Modal>
    </>
  );
}

// ---------- alert rules ----------
const ROLE_CHOICES = [["admin", "Admin"], ["billing_manager", "Billing Manager"], ["project_manager", "Project Manager"], ["team_lead", "Team Lead"], ["hr", "HR"], ["sales_tl", "Sales TL"]];
export function AlertsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["alert-rules"], queryFn: () => get("/alert-rules") });
  const users = useQuery({ queryKey: ["users"], queryFn: () => get<any[]>("/users") });
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  if (!q.data) return <Spinner />;
  const events: Record<string, { label: string; threshold?: string }> = q.data.events;
  const save = async () => {
    setErr(null);
    try {
      const { id, ...body } = edit;
      if (id) await put(`/alert-rules/${id}`, body); else await post("/alert-rules", body);
      setEdit(null); qc.invalidateQueries({ queryKey: ["alert-rules"] });
    } catch (e) { setErr(e); }
  };
  return (
    <>
      <Card title="Alerts" actions={<Button onClick={() => setEdit({ event: Object.keys(events)[0], threshold: null, roleKeys: [], userIds: [], notifyOwner: false, inApp: true, email: false, active: true })}>New alert</Button>}>
        <p className="mb-4 text-sm text-[var(--muted)]">eszy always tells the people directly involved, such as the TL about a submitted sheet. Add alerts here to tell more people, by email too, or at your own thresholds.</p>
        <Table head={["When", "Threshold", "Who", "How", ""]} empty="No extra alerts yet.">
          {q.data.rules.map((r: any) => (
            <tr key={r.id}>
              <td className="font-semibold">{events[r.event]?.label ?? r.event}{!r.active && <Pill status="ended">Off</Pill>}</td>
              <td className="tabnum">{r.threshold ?? "—"}</td>
              <td className="text-[14px]">{[...r.role_keys.map((k: string) => ROLE_CHOICES.find((x) => x[0] === k)?.[1] ?? k), ...(r.notify_owner ? ["Owner"] : []), ...r.user_ids.map((u: string) => users.data?.find((x) => x.id === u)?.name ?? "")].filter(Boolean).join(", ") || "—"}</td>
              <td>{[r.in_app && "In app", r.email && "Email"].filter(Boolean).join(" + ")}</td>
              <td className="whitespace-nowrap text-right">
                <Button size="sm" variant="ghost" onClick={() => setEdit({ id: r.id, event: r.event, threshold: r.threshold, roleKeys: r.role_keys, userIds: r.user_ids, notifyOwner: r.notify_owner, inApp: r.in_app, email: r.email, active: r.active })}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={async () => { await del(`/alert-rules/${r.id}`); qc.invalidateQueries({ queryKey: ["alert-rules"] }); }}>Remove</Button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? "Edit alert" : "New alert"} wide>
          <div className="grid gap-4">
            <Field label="When"><Select value={edit.event} onChange={(e) => setEdit({ ...edit, event: e.target.value })}>{Object.entries(events).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
            {events[edit.event]?.threshold && <Field label={events[edit.event].threshold!}><Input type="number" min={0} value={edit.threshold ?? ""} onChange={(e) => setEdit({ ...edit, threshold: e.target.value === "" ? null : Number(e.target.value) })} /></Field>}
            <div><div className="mb-2 text-sm font-semibold">Tell these roles</div><div className="grid gap-2 sm:grid-cols-3">{ROLE_CHOICES.map(([k, l]) => <Checkbox key={k} label={l} checked={edit.roleKeys.includes(k)} onChange={(v) => setEdit({ ...edit, roleKeys: v ? [...edit.roleKeys, k] : edit.roleKeys.filter((x: string) => x !== k) })} />)}</div></div>
            <div><div className="mb-2 text-sm font-semibold">And these people</div><div className="grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-3">{(users.data ?? []).map((u) => <Checkbox key={u.id} label={u.name} checked={edit.userIds.includes(u.id)} onChange={(v) => setEdit({ ...edit, userIds: v ? [...edit.userIds, u.id] : edit.userIds.filter((x: string) => x !== u.id) })} />)}</div></div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Checkbox label="Also tell the company owner" checked={edit.notifyOwner} onChange={(v) => setEdit({ ...edit, notifyOwner: v })} />
              <Checkbox label="In the app" checked={edit.inApp} onChange={(v) => setEdit({ ...edit, inApp: v })} />
              <Checkbox label="By email" checked={edit.email} onChange={(v) => setEdit({ ...edit, email: v })} />
              <Checkbox label="Alert is on" checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
            </div>
            <ErrorNote error={err} />
            <Button onClick={save}>Save alert</Button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------- leave types with policy ----------
export function LeaveTypesTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["leave-types"], queryFn: () => get<any[]>("/leave/types") });
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const blank = { name: "", yearlyDays: 12, paid: true, active: true, accrual: "yearly", carryForwardMax: 0, allowedInProbation: true, allowedInNotice: true, maxPerRequest: null };
  return (
    <>
      <Card title="Leave types" className="max-w-4xl" actions={<Button onClick={() => setEdit(blank)}>New leave type</Button>}>
        <p className="mb-4 text-sm text-[var(--muted)]">Monthly accrual adds a twelfth of the yearly days on the first of each month. At the new year, unused days carry over up to the limit.</p>
        <Table head={["Type", "Days a year", "Credited", "Carry over", "Probation", "Notice", "Paid", ""]}>
          {(q.data ?? []).map((t) => (
            <tr key={t.id}>
              <td className="font-semibold">{t.name} {!t.active && <Pill status="ended">Off</Pill>}</td><td className="tabnum">{Number(t.yearly_days)}</td>
              <td>{t.accrual === "monthly" ? "Monthly" : "Yearly"}</td><td className="tabnum">{Number(t.carry_forward_max)}</td>
              <td>{t.allowed_in_probation ? "Allowed" : "Not allowed"}</td><td>{t.allowed_in_notice ? "Allowed" : "Not allowed"}</td><td>{t.paid ? "Yes" : "No"}</td>
              <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEdit({ id: t.id, name: t.name, yearlyDays: Number(t.yearly_days), paid: t.paid, active: t.active, accrual: t.accrual, carryForwardMax: Number(t.carry_forward_max), allowedInProbation: t.allowed_in_probation, allowedInNotice: t.allowed_in_notice, maxPerRequest: t.max_per_request == null ? null : Number(t.max_per_request) })}>Edit</Button></td>
            </tr>
          ))}
        </Table>
      </Card>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.name}` : "New leave type"} wide>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Days a year"><Input type="number" min={0} step="0.5" value={edit.yearlyDays} onChange={(e) => setEdit({ ...edit, yearlyDays: Number(e.target.value) })} /></Field>
            <Field label="Credited"><Select value={edit.accrual} onChange={(e) => setEdit({ ...edit, accrual: e.target.value })}><option value="yearly">All at the start of the year</option><option value="monthly">A part each month</option></Select></Field>
            <Field label="Carry over to next year (max days)"><Input type="number" min={0} step="0.5" value={edit.carryForwardMax} onChange={(e) => setEdit({ ...edit, carryForwardMax: Number(e.target.value) })} /></Field>
            <Field label="Most days in one request" hint="Blank = no limit"><Input type="number" min={0.5} step="0.5" value={edit.maxPerRequest ?? ""} onChange={(e) => setEdit({ ...edit, maxPerRequest: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <div className="grid content-end gap-2">
              <Checkbox label="Paid leave" checked={edit.paid} onChange={(v) => setEdit({ ...edit, paid: v })} />
              <Checkbox label="Allowed during probation" checked={edit.allowedInProbation} onChange={(v) => setEdit({ ...edit, allowedInProbation: v })} />
              <Checkbox label="Allowed during notice" checked={edit.allowedInNotice} onChange={(v) => setEdit({ ...edit, allowedInNotice: v })} />
              <Checkbox label="Turned on" checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
            </div>
            <div className="sm:col-span-2"><ErrorNote error={err} /></div>
            <div><Button disabled={!edit.name} onClick={async () => { setErr(null); try { const { id, ...b } = edit; if (id) await put(`/leave/types/${id}`, b); else await post("/leave/types", b); setEdit(null); qc.invalidateQueries({ queryKey: ["leave-types"] }); } catch (e) { setErr(e); } }}>Save</Button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------- restore from backup ----------
export function RestoreCard() {
  const { me } = useSession();
  const toast = useToast();
  const files = useQuery({ queryKey: ["backup-files"], queryFn: () => get("/backups/files"), retry: false });
  const restores = useQuery({ queryKey: ["restores"], queryFn: () => get<any[]>("/backups/restores"), refetchInterval: 10_000 });
  const [pick, setPick] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const slug = me!.tenant.slug;
  return (
    <Card title="Restore from a backup">
      <p className="mb-3 text-sm text-[var(--muted)]">Replaces all of this company's data with the chosen backup. Everyone is signed out while it runs. Take a fresh backup first if you may want today's data back.</p>
      {files.isError ? <ErrorNote error={files.error} /> : !files.data ? <Spinner /> : (
        <Table head={["Backup file", "Size", ""]} empty="No backups found in your bucket.">
          {files.data.files.map((f: any) => (
            <tr key={f.key}><td className="max-w-md truncate text-[13px]">{f.key}</td><td className="tabnum">{f.size ? `${Math.round(f.size / 1024)} KB` : "—"}</td><td className="text-right"><Button size="sm" variant="outline" onClick={() => { setPick(f.key); setConfirm(""); }}>Restore</Button></td></tr>
          ))}
        </Table>
      )}
      {(restores.data ?? []).length > 0 && (
        <div className="mt-4"><div className="mb-2 text-sm font-semibold">Recent restores</div>
          <ul className="grid gap-1 text-sm">{restores.data!.map((r) => <li key={r.id}>{new Date(r.started_at ?? r.created_at).toLocaleString()} · <Pill status={r.status} /> {r.error ?? ""}</li>)}</ul>
        </div>
      )}
      <Modal open={!!pick} onClose={() => setPick(null)} title="Restore this backup?">
        <p className="mb-3 text-sm">All current data in <b>{slug}</b> is replaced by <span className="break-all">{pick}</span>. Type the company address <b>{slug}</b> to confirm.</p>
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <ErrorNote error={err} />
        <Button variant="danger" className="mt-4" disabled={confirm !== slug} onClick={async () => { setErr(null); try { await post("/backups/restore", { key: pick, confirm }); toast("Restore started. It shows in the list when done."); setPick(null); restores.refetch(); } catch (e) { setErr(e); } }}>Restore</Button>
      </Modal>
    </Card>
  );
}

// ---------- eszy invoices and deleting the company ----------
export function EszyInvoices({ invoices }: { invoices: any[] }) {
  return (
    <Card title="eszy invoices">
      <Table head={["Number", "Date", "Amount", "Tax", "Status", ""]} empty="No eszy invoices yet.">
        {invoices.map((x) => (
          <tr key={x.id}><td className="font-semibold">{x.number ?? "—"}</td><td>{new Date(x.created_at).toLocaleDateString()}</td>
            <td className="tabnum">{(x.amount_minor / 100).toFixed(2)} {x.currency}</td><td className="tabnum">{((x.tax_minor ?? 0) / 100).toFixed(2)}</td><td><Pill status={x.status} /></td>
            <td className="text-right">{x.number && <Button size="sm" variant="outline" onClick={() => openFile(`/subscription/invoices/${x.id}/pdf`)}>PDF</Button>}</td></tr>
        ))}
      </Table>
    </Card>
  );
}

export function DangerZone() {
  const { me, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ confirm: "", password: "" });
  const [err, setErr] = useState<unknown>(null);
  if (!me!.user.isOwner) return null;
  const slug = me!.tenant.slug;
  return (
    <Card title="Delete this company now" className="border-[#b4441f]/40">
      <p className="mb-3 text-sm">Deletes every person, project, sheet, invoice and setting in {me!.tenant.name} straight away, and ends the eszy plan. This can't be undone. Export your data first from Import and export.</p>
      <Button variant="danger" onClick={() => setOpen(true)}>Delete company and all data</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Delete everything?">
        <div className="grid gap-4">
          <Field label={`Type ${slug} to confirm`}><Input value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
          <Field label="Your password"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <ErrorNote error={err} />
          <Button variant="danger" disabled={f.confirm !== slug || !f.password} onClick={async () => { setErr(null); try { await post("/subscription/delete-now", f); await signOut(); window.location.href = "/"; } catch (e) { setErr(e); } }}>Delete everything now</Button>
        </div>
      </Modal>
    </Card>
  );
}
