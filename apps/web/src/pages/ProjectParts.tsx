import { phrase } from "../components/ActivityLog";
import { Fragment, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, CircleDot, ExternalLink, FileText, FileUp, Link2, ListTodo, MessageSquare, MoveRight, Paperclip, Pencil, Plus, Send, Trash2, Undo2, Users, X,
} from "lucide-react";
import { api, del, download, get, post, put } from "../lib/api";
import { useSession } from "../lib/session";
import { useAction, useList, useTeams, useUsers, userOpts } from "../lib/hooks";
import { Avatar } from "../components/Avatar";
import { ANY_RANGE, Button, Card, Combobox, DateRange, Empty, ErrorNote, Field, Input, Modal, MultiSelect, Pill, Segmented, Select, Spinner, Textarea, cx, fmtDate, hrs, useConfirm, useToast, RichText, type Range } from "../components/ui";

// ------------------------------------------------------------------------------------------------ people cards
type Role = "pm" | "tl" | "member";
const ROLE: Record<Role, { title: string; empty: string; add: string; info: string }> = {
  pm: { title: "Project Managers", empty: "No PM yet", add: "Add Project Managers", info: "Plan the work, assign Team Leads and can change the whole team." },
  tl: { title: "Team Leads", empty: "No Team Lead yet", add: "Add Team Leads", info: "Assign members and approve their sheets for this project." },
  member: { title: "Employees", empty: "No one assigned yet", add: "Add employees", info: "Can log hours and be given tasks on this project." },
};

/** The project's PMs, Team Leads and employees as three cards, each with + to add people and × to remove them. */
export function ProjectPeople({ project: p, onChange }: { project: any; onChange: () => void }) {
  const { can, me } = useSession();
  const act = useAction();
  const confirm = useConfirm();
  const [adding, setAdding] = useState<Role | null>(null);
  const meId = me!.user.id;
  const pms = p.members.filter((m: any) => m.role === "pm" || m.id === p.pm_user_id);
  const tls = p.members.filter((m: any) => m.role === "tl" && m.id !== p.pm_user_id);
  const members = p.members.filter((m: any) => m.role === "member" && m.id !== p.pm_user_id);
  const amTl = tls.some((m: any) => m.id === meId);
  // Admin, Billing Manager and the sales team assign PMs and Team Leads; PMs and TLs add employees (a TL only from their own team).
  const assigner = can("projects.assign");
  const amPm = p.pm_user_id === meId || pms.some((m: any) => m.id === meId) || can("projects.manage");
  const canEdit: Record<Role, boolean> = { pm: assigner, tl: assigner, member: assigner || amPm || amTl };
  const tlOnly = !assigner && !amPm && amTl;
  const lists: Record<Role, any[]> = { pm: pms, tl: tls, member: members };

  const save = async (next: Record<Role, string[]>, msg: string) => {
    const body: any = { memberIds: next.member };
    if (canEdit.tl) body.tlIds = next.tl;
    if (canEdit.pm) body.pmIds = next.pm;
    if (await act.run(() => put(`/projects/${p.id}/members`, body), msg)) onChange();
  };
  const ids = (r: Role) => lists[r].map((m: any) => m.id);
  const current = (): Record<Role, string[]> => ({ pm: ids("pm"), tl: ids("tl"), member: ids("member") });

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        {(["pm", "tl", "member"] as Role[]).map((r) => (
          <section key={r} className="rounded-2xl border border-[var(--line)] bg-[var(--card)]">
            <header className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
              <div>
                <h3 className="text-[15px] font-bold">{ROLE[r].title}</h3>
                <p className="text-[12.5px] text-[var(--muted)]">{lists[r].length ? `${lists[r].length} ${lists[r].length === 1 ? "person" : "people"}` : ROLE[r].empty}</p>
              </div>
              {canEdit[r] && (
                <button aria-label={ROLE[r].add} title={ROLE[r].add} onClick={() => setAdding(r)}
                  className="grid size-9 place-items-center rounded-full text-[var(--brand)] hover:bg-[var(--brand-soft)]"><Plus className="size-5" /></button>
              )}
            </header>
            <div className="flex min-h-[88px] flex-wrap content-start gap-2.5 p-4">
              {lists[r].map((m: any) => (
                <span key={m.id} className="group relative">
                  <Link to={`/people/${m.id}`} title={`${m.name}${m.id === p.pm_user_id && r === "pm" ? " (main PM)" : ""}`} className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg)] py-1 pl-1 pr-3 text-[13.5px] font-semibold hover:border-[var(--brand)]/50">
                    <Avatar id={m.id} name={m.name} hasPhoto={m.has_photo} size={30} />
                    <span className="max-w-36 truncate">{m.name}</span>
                    {m.id === p.pm_user_id && r === "pm" && pms.length > 1 && <span className="rounded bg-[var(--brand-soft)] px-1 text-[10.5px] font-bold text-[var(--brand)]">Main</span>}
                  </Link>
                  {canEdit[r] && (
                    <button aria-label={`Remove ${m.name}`} onClick={async () => {
                      if (await confirm({ title: `Remove ${m.name} from ${ROLE[r].title.toLowerCase()}?`, body: r === "member" ? "They won't be able to log hours on this project." : "They stay on the project as an employee.", confirm: "Remove", danger: true }) === false) return;
                      const next = current();
                      next[r] = next[r].filter((x) => x !== m.id);
                      if (r !== "member") next.member = [...next.member, m.id];
                      await save(next, `${m.name} removed`);
                    }} className="absolute -right-1 -top-1 hidden size-5 place-items-center rounded-full border border-[var(--line)] bg-[var(--card)] text-[var(--muted)] shadow-sm hover:text-[#9c3a19] group-hover:grid group-focus-within:grid">
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              ))}
              {!lists[r].length && canEdit[r] && <button onClick={() => setAdding(r)} className="text-[13.5px] font-semibold text-[var(--brand)] hover:underline">{ROLE[r].add}</button>}
            </div>
          </section>
        ))}
      </div>
      <ErrorNote error={act.err} />
      <AddPeopleModal role={adding} project={p} taken={current()} teamOnly={tlOnly ? meId : null} onClose={() => setAdding(null)} onSave={async (picked) => {
        const r = adding!;
        const next = current();
        for (const k of ["pm", "tl", "member"] as Role[]) if (k !== r) next[k] = next[k].filter((x) => !picked.includes(x));
        next[r] = [...new Set([...next[r], ...picked])];
        await save(next, picked.length === 1 ? "Person added" : `${picked.length} people added`);
        setAdding(null);
      }} busy={!!act.busy} />
    </>
  );
}

function AddPeopleModal({ role, project, taken, onClose, onSave, busy, teamOnly }: { role: Role | null; project: any; taken: Record<Role, string[]>; onClose: () => void; onSave: (ids: string[]) => void; busy: boolean; teamOnly: string | null }) {
  const users = useUsers(!!role);
  const teams = useTeams();
  const [picked, setPicked] = useState<string[]>([]);
  if (!role) return null;
  const already = taken[role];
  const elsewhere = (id: string) => (["pm", "tl", "member"] as Role[]).find((k) => k !== role && taken[k].includes(id));
  // A Team Lead (who isn't also a PM or assigner) only sees people from the teams they lead or who report to them.
  const myTeams = new Set((teams.data ?? []).filter((t: any) => t.lead_user_id === teamOnly || t.manager_user_id === teamOnly).map((t: any) => t.id));
  const inMyTeam = (id: string) => { const u = (users.data ?? []).find((x: any) => x.id === id); return !!u && (myTeams.has(u.team_id) || u.reporting_manager_id === teamOnly); };
  const options = userOpts(users.data).filter((o) => !already.includes(o.value) && (!teamOnly || inMyTeam(o.value))).map((o) => {
    const e = elsewhere(o.value);
    return e ? { ...o, sub: `Now ${e === "pm" ? "a PM" : e === "tl" ? "a Team Lead" : "an employee"} here · moves` } : o;
  });
  const close = () => { setPicked([]); onClose(); };
  return (
    <Modal open onClose={close} title={ROLE[role].add}
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button busy={busy} disabled={!picked.length} onClick={() => { onSave(picked); setPicked([]); }}>{picked.length > 1 ? `Add ${picked.length} people` : "Add"}</Button></>}>
      <p className="mb-4 text-[14px] text-[var(--muted)]">{project.name}. {ROLE[role].info}</p>
      {teamOnly && <p className="mb-3 rounded-xl bg-[var(--brand-soft)] px-3 py-2 text-[13px] text-[var(--brand)] dark:text-white">Showing people from your team only. Ask the PM to add someone from another team.</p>}
      <Field label="People" hint="Search by name, employee code or team. Someone who already has another role here moves to this one.">
        <MultiSelect value={picked} onChange={setPicked} options={options} placeholder="Search people" />
      </Field>
      <div aria-hidden className="h-64" />
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ description
export { RichText };

export function ProjectDescription({ project: p, onChange, canEdit }: { project: any; onChange: () => void; canEdit: boolean }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState("");
  const act = useAction();
  const template = "- Client is hired over: \n- Client communication: \n- Call taken by: \n- Hours estimated: \n- Project understanding given to: \n- Client website: ";
  return (
    <Card title="Description" sub="What the project is, how the client was hired and anything the team needs to know."
      actions={canEdit && !edit ? <Button size="sm" variant="secondary" onClick={() => { setV(p.description ?? ""); setEdit(true); }}><Pencil />Edit</Button> : undefined}>
      {edit ? (
        <div className="grid gap-3">
          <Textarea value={v} onChange={(e) => setV(e.target.value)} className="min-h-72 font-[inherit] leading-relaxed" placeholder={template} autoFocus />
          <p className="text-[12.5px] text-[var(--muted)]">Start a line with “- ” for a bullet or “1.” for a numbered list. Links become clickable. Wrap words in **double stars** for bold.</p>
          {!v && <div><Button size="sm" variant="ghost" onClick={() => setV(template)}>Use the hiring details template</Button></div>}
          <ErrorNote error={act.err} />
          <div className="flex gap-2">
            <Button busy={!!act.busy} onClick={async () => { if (await act.run(() => put(`/projects/${p.id}`, { description: v }), "Description saved")) { setEdit(false); onChange(); } }}>Save description</Button>
            <Button variant="secondary" onClick={() => setEdit(false)}>Cancel</Button>
          </div>
        </div>
      ) : p.description ? <RichText text={p.description} /> : (
        <Empty icon={<FileText />} title="No description yet"
          action={canEdit ? <Button size="sm" onClick={() => { setV(template); setEdit(true); }}><Plus />Add description</Button> : undefined}>
          {canEdit ? "Add how the client hired you, who took the call, the estimate and the links the team needs." : "The PM hasn't added one yet."}
        </Empty>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ attachments
const size = (b?: number | null) => (b == null ? "" : b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 102.4) / 10} KB` : `${Math.round(b / 104857.6) / 10} MB`);

export function ProjectFiles({ project: p, onChange }: { project: any; onChange?: () => void }) {
  const { me, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ["project-files", p.id], queryFn: () => get<any[]>(`/projects/${p.id}/files`) });
  const [link, setLink] = useState({ url: "", name: "" });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["project-files", p.id] }); qc.invalidateQueries({ queryKey: ["activity", p.id] }); onChange?.(); };
  const upload = async (files: FileList | File[]) => {
    setErr(null); setBusy(true);
    try {
      for (const f of Array.from(files)) {
        if (f.size > 10 * 1024 * 1024) throw new Error(`${f.name} is over 10 MB`);
        await api(`/projects/${p.id}/files?name=${encodeURIComponent(f.name)}&type=${encodeURIComponent(f.type || "application/octet-stream")}`, { form: new Blob([f], { type: "application/octet-stream" }) });
      }
      toast(files.length === 1 ? "File added" : `${files.length} files added`);
      refresh();
    } catch (e) { setErr(e); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  const addLink = async () => {
    setErr(null);
    let url = link.url.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    try { await post(`/projects/${p.id}/links`, { url, name: link.name.trim() || undefined }); setLink({ url: "", name: "" }); toast("Link added"); refresh(); } catch (e) { setErr(e); }
  };
  const rows = q.data ?? [];
  const files = rows.filter((r) => r.kind === "file"), links = rows.filter((r) => r.kind === "link");
  const canRemove = (r: any) => r.created_by === me!.user.id || can("projects.manage") || p.pm_user_id === me!.user.id;
  const remove = async (r: any) => { if (await confirm({ title: `Remove ${r.name}?`, confirm: "Remove", danger: true }) === false) return; await del(`/project-files/${r.id}`); toast("Removed"); refresh(); };
  return (
    <div className="grid gap-5">
      <Card title="Add attachments" sub="Files up to 10 MB each, or links to designs, documents and folders.">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,300px)_1fr]">
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}
            className={cx("flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 text-center text-[14px] font-semibold transition", drag ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] hover:border-[var(--brand)]/60")}>
            <FileUp className="size-5 text-[var(--brand)]" />{busy ? "Uploading…" : "Upload files"}
            <span className="text-[12px] font-normal text-[var(--muted)]">or drop them here</span>
          </button>
          <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files?.length && upload(e.target.files)} />
          <div className="grid content-center gap-2">
            <div className="flex flex-wrap gap-2">
              <Input value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} onKeyDown={(e) => e.key === "Enter" && link.url.trim() && addLink()} placeholder="Paste a link (https://…)" className="min-w-56 flex-[2]" />
              <Input value={link.name} onChange={(e) => setLink({ ...link, name: e.target.value })} placeholder="Name (optional)" className="min-w-40 flex-1" />
              <Button variant="secondary" disabled={!link.url.trim()} onClick={addLink}><Link2 />Add link</Button>
            </div>
          </div>
        </div>
        <div className="mt-3"><ErrorNote error={err} /></div>
      </Card>
      {q.isLoading ? <Spinner /> : !rows.length ? (
        <Empty icon={<Paperclip />} title="No attachments yet">Add the brief, designs or any link the team keeps asking for.</Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title={`Files (${files.length})`}>
            {!files.length ? <p className="text-[14px] text-[var(--muted)]">No files yet.</p> : (
              <ul className="divide-y divide-[var(--line)]">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 py-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]"><FileText className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <button onClick={() => download(`/project-files/${f.id}/download`, f.name)} className="block max-w-full truncate text-left text-[14px] font-semibold hover:underline">{f.name}</button>
                      <span className="text-[12px] text-[var(--muted)]">{size(f.size_bytes)} · {f.created_by_name ?? "Someone"} · {fmtDate(f.created_at)}</span>
                    </span>
                    {canRemove(f) && <Button size="sm" variant="ghost" aria-label={`Remove ${f.name}`} onClick={() => remove(f)}><Trash2 className="size-4" /></Button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={`Links (${links.length})`}>
            {!links.length ? <p className="text-[14px] text-[var(--muted)]">No links yet.</p> : (
              <ul className="divide-y divide-[var(--line)]">
                {links.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 py-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-black/5 text-[var(--text)] dark:bg-white/10"><Link2 className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[14px] font-semibold hover:underline"><span className="truncate">{f.name}</span><ExternalLink className="size-3 shrink-0" /></a>
                      <span className="block truncate text-[12px] text-[var(--muted)]">{f.url}</span>
                    </span>
                    {canRemove(f) && <Button size="sm" variant="ghost" aria-label={`Remove ${f.name}`} onClick={() => remove(f)}><Trash2 className="size-4" /></Button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ activity
const CHANGE_LABEL: Record<string, string> = {
  "project.handover": "handed over a role", "project.task_budget": "changed the project's task hours",
  "project.create": "created the project", "project.update": "edited the project", "project.status": "changed the status", "project.stage": "moved the project",
  "billing_line.create": "added a billing line", "billing_line.update": "changed a billing line", "billing_line.delete": "removed a billing line",
  "extra_hours.add": "added extra hours", "note.create": "added a note", "invoice.cancel": "cancelled an invoice", "invoice.refund": "refunded an invoice",
  "invoice.correct": "issued a corrected invoice", "payment.record": "recorded a payment", "invoice.update": "changed an invoice", "invoice.send": "emailed an invoice",
  "file.add": "added a file", "link.add": "added a link", "file.remove": "removed an attachment", "task.create": "added a task", "task.update": "updated a task", "project.team": "changed the team",
  // Recorded automatically from the request when a route doesn't log itself.
  "project.billing_lines": "added a billing line", "project.run_billing": "ran billing for the project", "project.extra_hours": "added extra hours", "project.files": "added a file",
  "project.links": "added a link", "project.note_create": "added a note", "project.notes": "added a note", "project.trackers": "added a tracker", "project.members": "changed the team",
  "project.task_create": "added a task", "project.stage_update": "moved the project", "project.status_update": "changed the status",
};
const FIELD: Record<string, string> = { pm_user_id: "main PM", delivery_date: "delivery date", start_date: "start date", hourly_rate_minor: "hourly rate", billing_cap_minutes: "billing cap", assignee: "assignee" };
const STATUS_WORD: Record<string, string> = { todo: "To do", in_progress: "In progress", review: "In review", done: "Done" };
const val = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") || "—" : typeof v === "object" ? JSON.stringify(v) : STATUS_WORD[String(v)] ?? String(v));
const dayKey = (at: string) => new Date(at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const time = (at: string) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Sheets submitted on the project with what people wrote, who approved or sent them back, task and team changes, and comments. */
export function ActivityFeed({ items: all, compact, onDelete, taskView }: { items: any[]; compact?: boolean; onDelete?: (a: any) => void; taskView?: boolean }) {
  const { me, can } = useSession();
  const [shown, setShown] = useState(30);
  const items = compact ? all : all.slice(0, shown);
  if (!all.length) return <p className="py-6 text-center text-[14px] text-[var(--muted)]">Nothing here for these filters. Sheets, comments and changes show up here.</p>;
  let last = "";
  return (
    <div className="grid gap-1">
      {items.map((a) => {
        const d = dayKey(a.at);
        const sep = d !== last ? (last = d) : null;
        return (
          <Fragment key={a.id}>
            {sep && <div className="mb-1 mt-4 first:mt-0"><span className="inline-flex rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-[12px] font-semibold text-[var(--muted)]">{sep}</span></div>}
            <div className="relative flex gap-3 pb-1 pl-1">
              <span aria-hidden className="absolute bottom-0 left-[20px] top-10 w-px bg-[var(--line)]" />
              <Icon a={a} />
              <div className="min-w-0 flex-1 rounded-xl px-2 py-1.5 text-[13.5px] transition hover:bg-[var(--bg)]/70">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 leading-snug"><b>{a.who ?? "eszy"}</b> <Headline a={a} taskView={taskView} /></span>
                  <span className="flex shrink-0 items-center gap-2 pt-0.5 text-[12px] text-[var(--muted)] tabnum">{time(a.at)}
                    {a.kind === "comment" && onDelete && (a.created_by === me!.user.id || can("projects.manage")) && <button aria-label="Delete comment" onClick={() => onDelete(a)} className="hover:text-[#9c3a19]"><Trash2 className="size-3.5" /></button>}
                  </span>
                </div>
                <Body a={a} compact={compact} taskView={taskView} />
              </div>
            </div>
          </Fragment>
        );
      })}
      {!compact && all.length > shown && <div className="flex justify-center pt-2"><Button variant="secondary" size="sm" onClick={() => setShown((n) => n + 30)}>Show more ({all.length - shown} older)</Button></div>}
    </div>
  );
}
function Icon({ a }: { a: any }) {
  const [I, tone] = a.kind === "sheet"
    ? a.action === "approved" ? [CheckCircle2, "bg-[#e3f3ea] text-[#1c6b3f]"] : a.action === "rejected" ? [Undo2, "bg-[#fbe9e2] text-[#9c3a19]"] : [Send, "bg-[#e8f0fb] text-[#2a5db0]"]
    : a.kind === "comment" ? [MessageSquare, "bg-[var(--brand-soft)] text-[var(--brand)]"]
      : a.action === "project.team" ? [Users, "bg-[#f1ecfb] text-[#5b3fb0]"] : a.action?.startsWith("task.") ? [ListTodo, "bg-[#fdf3e1] text-[#8a5a00]"]
        : a.action === "project.stage" ? [MoveRight, "bg-[#fdf3e1] text-[#8a5a00]"] : a.action?.startsWith("file") || a.action === "link.add" ? [Paperclip, "bg-black/5 text-[var(--text)]"] : [CircleDot, "bg-black/5 text-[var(--muted)]"];
  return <span className={cx("relative z-[1] mt-1 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-[var(--card)]", tone)}><I className="size-4" /></span>;
}
function Headline({ a, taskView }: { a: any; taskView?: boolean }) {
  if (a.kind === "sheet") {
    if (a.action === "submitted") return <span className="text-[var(--muted)]">submitted the sheet for {fmtDate(a.date)} with <b className="text-[var(--text)] tabnum">{hrs(a.minutes)}</b> {taskView ? "on this task" : "here"}</span>;
    return <span className="text-[var(--muted)]">{a.action === "approved" ? "approved" : "sent back"} <b className="text-[var(--text)]">{a.for}</b>’s sheet for {fmtDate(a.date)} ({hrs(a.minutes)})</span>;
  }
  if (a.kind === "comment") return <span className="text-[var(--muted)]">{a.task && !taskView ? <>commented on <b className="text-[var(--text)]">{a.task}</b></> : "commented"}</span>;
  const d = a.data ?? {};
  if (a.action === "project.stage" && d.changes?.stage) return <span className="text-[var(--muted)]">moved the project from <b className="text-[var(--text)]">{val(d.changes.stage[0])}</b> to <b className="text-[var(--text)]">{val(d.changes.stage[1])}</b></span>;
  if (a.action === "project.handover") return <span className="text-[var(--muted)]">handed the {d.role ?? "lead"} role from <b className="text-[var(--text)]">{d.from ?? "someone"}</b> to <b className="text-[var(--text)]">{d.to ?? "someone"}</b></span>;
  if (a.action === "project.task_budget" && d.to != null) return <span className="text-[var(--muted)]">{d.from ? <>changed the project's task hours from <b className="text-[var(--text)] tabnum">{hrs(d.from)}</b> to</> : "set the project's task hours to"} <b className="text-[var(--text)] tabnum">{hrs(d.to)}</b>{d.reason ? <> · {d.reason}</> : null}</span>;
  if (a.action === "task.create") return <span className="text-[var(--muted)]">added the task <b className="text-[var(--text)]">{d.title}</b></span>;
  if (a.action === "task.update") return <span className="text-[var(--muted)]">updated <b className="text-[var(--text)]">{d.title}</b></span>;
  if ((a.action === "file.add" || a.action === "link.add" || a.action === "file.remove") && d.name) return <span className="text-[var(--muted)]">{CHANGE_LABEL[a.action]} <b className="text-[var(--text)]">{d.name}</b></span>;
  return <span className="text-[var(--muted)]">{CHANGE_LABEL[a.action] ?? phrase({ ...a, entity_name: "x" })}</span>;
}
function Body({ a, compact, taskView }: { a: any; compact?: boolean; taskView?: boolean }) {
  if (a.kind === "comment") return <RichText className="mt-1" text={a.body} />;
  if (a.kind === "sheet" && a.action === "submitted" && a.entries?.length) {
    const list = compact ? a.entries.slice(0, 2) : a.entries;
    return (
      <ul className="mt-2 grid gap-1.5">
        {list.map((e: any) => (
          <li key={e.id} className="rounded-lg border-l-2 border-[var(--brand-2)]/40 bg-[var(--bg)]/70 px-3 py-1.5 text-[13.5px]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-[var(--muted)]">
              <b className="text-[var(--text)] tabnum">{hrs(e.minutes)}</b>
              {e.task && !taskView && <span className="inline-flex items-center gap-1"><ListTodo className="size-3" />{e.task}</span>}
              {(e.activity || e.category) && <span>{e.activity ?? ({ billable: "Billable", inhouse: "In-house", no_work: "No work" } as any)[e.category]}</span>}
              {e.offline && <Pill status="amber">Offline</Pill>}
            </div>
            {e.description ? <RichText className="mt-0.5" text={e.description} /> : <p className="mt-0.5 italic text-[var(--muted)]">No notes written</p>}
          </li>
        ))}
        {compact && a.entries.length > 2 && <li className="text-[12.5px] text-[var(--muted)]">+{a.entries.length - 2} more</li>}
      </ul>
    );
  }
  const d = a.data ?? {};
  if (a.action === "project.team") {
    return (
      <ul className="mt-1 grid gap-0.5 text-[13px]">
        {(d.added ?? []).map((x: any) => <li key={`a${x.name}`}>Added <b>{x.name}</b> as {x.role}</li>)}
        {(d.changed ?? []).map((x: any) => <li key={`c${x.name}`}><b>{x.name}</b> is now {x.role}</li>)}
        {(d.removed ?? []).map((x: string) => <li key={`r${x}`} className="text-[var(--muted)]">Removed <b className="text-[var(--text)]">{x}</b></li>)}
      </ul>
    );
  }
  if (d.changes && a.action !== "project.stage") {
    const long = (v: unknown) => typeof v === "string" && v.length > 60;
    return (
      <ul className="mt-1 text-[13px]">
        {Object.entries(d.changes).slice(0, 6).map(([k, v]: any) => (
          <li key={k}>
            <span className="text-[var(--muted)]">{FIELD[k] ?? k.replace(/_/g, " ")}:</span>{" "}
            {k === "assignee" ? <b>{val(v[1])}</b> : long(v[0]) || long(v[1]) ? <span>updated</span> : <>{val(v[0])} → <b>{val(v[1])}</b></>}
          </li>
        ))}
      </ul>
    );
  }
  return null;
}

/** Activity tab: the feed with filters and a comment box. */
export function ProjectActivityFeed({ project: p, taskId, compact, limit }: { project: any; taskId?: string; compact?: boolean; limit?: number }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"all" | "sheets" | "comments" | "changes">("all");
  const [comment, setComment] = useState("");
  const [about, setAbout] = useState(taskId ?? "");
  const act = useAction();
  const [range, setRange] = useState<Range>(ANY_RANGE);
  const [person, setPerson] = useState<string | null>(null);
  const filters = { ...(taskId ? { taskId } : {}), ...(limit ? { limit: String(limit) } : {}), ...(range.from ? { from: range.from, to: range.to } : {}), ...(person ? { userId: person } : {}) };
  const key = ["activity", p.id, taskId ?? null, limit ?? null, range.from, range.to, person];
  const q = useQuery({ queryKey: key, queryFn: () => get<any[]>(`/projects/${p.id}/activity?${new URLSearchParams(filters)}`), placeholderData: (prev: any) => prev });
  const items = useMemo(() => (q.data ?? []).filter((a) => kind === "all" || (kind === "sheets" ? a.kind === "sheet" : kind === "comments" ? a.kind === "comment" : a.kind === "change")), [q.data, kind]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["activity", p.id] }); qc.invalidateQueries({ queryKey: ["project", p.id] }); };
  if (compact) return q.isLoading ? <Spinner /> : <ActivityFeed items={(q.data ?? []).slice(0, limit ?? 8)} compact />;
  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3">
        <Textarea placeholder={`Write a comment. Mention someone with @Name, e.g. @${p.members[0]?.name ?? "Name"}`} value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className="min-h-16" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!taskId ? (
            <Select className="h-9 w-60" value={about} onChange={(e) => setAbout(e.target.value)} aria-label="About"><option value="">About the project</option>{p.tasks.map((t: any) => <option key={t.id} value={t.id}>Task: {t.title}</option>)}</Select>
          ) : <span />}
          <Button size="sm" busy={!!act.busy} disabled={!comment.trim()} onClick={async () => { if (await act.run(() => post(`/projects/${p.id}/comments`, { body: comment, taskId: about || null }), "Comment posted")) { setComment(""); refresh(); } }}><MessageSquare />Comment</Button>
        </div>
        <ErrorNote error={act.err} />
      </div>
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-3">
          <Segmented value={kind} onChange={setKind} options={[{ id: "all", label: "Everything" }, { id: "sheets", label: "Sheets" }, { id: "comments", label: "Comments" }, { id: "changes", label: "Changes" }]} />
          <DateRange value={range} onChange={setRange} allowAll />
          <div className="w-52"><Combobox value={person} onChange={setPerson} options={p.members.map((m: any) => ({ value: m.id, label: m.name }))} placeholder="Anyone" /></div>
          {(range.from || person) && <button type="button" onClick={() => { setRange(ANY_RANGE); setPerson(null); }} className="text-[12.5px] font-semibold text-[var(--brand)] hover:underline dark:text-[var(--accent)]">Clear filters</button>}
          <span className="ml-auto text-[12.5px] text-[var(--muted)] tabnum">{items.length} {items.length === 1 ? "item" : "items"}</span>
        </div>
        <div className={cx("p-4", !compact && "max-h-[calc(100vh-13rem)] min-h-64 overflow-y-auto scrollbar-thin")}>{q.isLoading ? <Spinner /> : <ActivityFeed items={items} taskView={!!taskId} onDelete={async (a) => { await del(`/comments/${a.id}`); refresh(); }} />}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ stages
export function StageSelect({ project: p, onChange, disabled }: { project: any; onChange: () => void; disabled?: boolean }) {
  const stages = useList("project-stages");
  const act = useAction();
  const list = (stages.data ?? []).filter((s) => s.active || s.id === p.stage_id);
  return (
    <Select value={p.stage_id ?? ""} disabled={disabled || !list.length} className="h-9 w-44 text-[13.5px] font-normal text-[var(--text)]" aria-label="Stage"
      onChange={async (e) => { if (e.target.value && await act.run(() => put(`/projects/${p.id}/stage`, { stageId: e.target.value }), "Stage changed")) onChange(); }}>
      {!p.stage_id && <option value="">No stage</option>}
      {list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </Select>
  );
}

/** Projects as a board, one column per stage. Drag a card to another column or position; the change is saved straight away. */
export function ProjectBoard({ projects, canMove, onMoved }: { projects: any[]; canMove: (p: any) => boolean; onMoved: () => void }) {
  const stages = useList("project-stages");
  const nav = useNavigate();
  const toast = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ stage: string; index: number } | null>(null);
  const [local, setLocal] = useState<Record<string, { stage: string; pos: number }>>({});
  const cols = (stages.data ?? []).filter((s) => s.active);
  if (stages.isLoading) return <Spinner />;
  if (!cols.length) return <Empty title="No stages yet">Add stages under Settings → Masters and onboarding → Project stages.</Empty>;
  const where = (p: any) => local[p.id] ?? { stage: p.stage_id ?? cols[0].id, pos: p.stage_position ?? 0 };
  const inCol = (sid: string) => projects.filter((p) => where(p).stage === sid).sort((a, b) => where(a).pos - where(b).pos);
  const drop = async (sid: string, index: number) => {
    const p = projects.find((x) => x.id === dragId);
    setDragId(null); setOver(null);
    if (!p) return;
    const from = where(p);
    if (from.stage === sid && inCol(sid).findIndex((x) => x.id === p.id) === index) return;
    setLocal((m) => ({ ...m, [p.id]: { stage: sid, pos: index - 0.5 } }));
    try { await put(`/projects/${p.id}/stage`, { stageId: sid, position: index }); onMoved(); }
    catch (e: any) { toast(e?.message ?? "Couldn't move it", "err"); setLocal((m) => { const n = { ...m }; delete n[p.id]; return n; }); }
  };
  return (
    <div className="-mx-1 overflow-x-auto pb-3">
      <div className="flex min-w-max gap-4 px-1">
        {cols.map((c) => {
          const list = inCol(c.id);
          return (
            <section key={c.id} className={cx("flex w-[300px] shrink-0 flex-col rounded-2xl bg-black/[.035] dark:bg-white/5", over?.stage === c.id && "ring-2 ring-[var(--brand)]/40")}
              onDragOver={(e) => { if (!dragId) return; e.preventDefault(); if (!list.length || over?.stage !== c.id) setOver({ stage: c.id, index: list.length }); }}
              onDrop={(e) => { e.preventDefault(); drop(c.id, over?.stage === c.id ? over!.index : list.length); }}>
              <header className="flex items-center justify-between px-4 pb-2 pt-3.5">
                <h3 className="text-[14.5px] font-bold">{c.name}</h3>
                <span className="rounded-full bg-[var(--card)] px-2 py-0.5 text-[12px] font-bold tabnum text-[var(--muted)] ring-1 ring-[var(--line)]">{list.length}</span>
              </header>
              <div className="grid max-h-[calc(100vh-280px)] content-start gap-2 overflow-y-auto px-2.5 pb-3">
                {list.map((p, i) => {
                  const movable = canMove(p);
                  return (
                    <Fragment key={p.id}>
                      {over?.stage === c.id && over?.index === i && dragId && dragId !== p.id && <div className="h-1 rounded bg-[var(--brand)]/50" />}
                      <article draggable={movable} onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDragId(null); setOver(null); }}
                        onDragOver={(e) => { if (!dragId) return; e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setOver({ stage: c.id, index: e.clientY < r.top + r.height / 2 ? i : i + 1 }); }}
                        onClick={() => nav(`/projects/${p.id}`)}
                        className={cx("cursor-pointer rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 shadow-sm transition hover:border-[var(--brand)]/50", movable && "active:cursor-grabbing", dragId === p.id && "opacity-40")}>
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="line-clamp-2 text-[14px] font-semibold leading-snug">{p.name}</h4>
                          {p.status !== "active" && <Pill status={p.status} />}
                        </div>
                        <p className="mt-0.5 truncate text-[12.5px] text-[var(--muted)]">{p.client_name}{p.code ? ` · ${p.code}` : ""}</p>
                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          <div className="flex -space-x-1.5">
                            {[...(p.pms ?? []), ...(p.tls ?? [])].slice(0, 4).map((u: any) => <span key={u.id} title={u.name} className="rounded-full ring-2 ring-[var(--card)]"><Avatar id={u.id} name={u.name} size={24} /></span>)}
                          </div>
                          <span className="text-[12px] text-[var(--muted)]">{p.is_internal ? "Internal" : p.type === "fixed" ? "Fixed" : "Hourly"} · <span className="tabnum">{hrs(p.logged_minutes)}</span></span>
                        </div>
                        {p.open_tasks > 0 && <p className="mt-1.5 text-[12px] text-[var(--muted)]">{p.open_tasks} open task{p.open_tasks === 1 ? "" : "s"}</p>}
                      </article>
                    </Fragment>
                  );
                })}
                {over?.stage === c.id && over?.index === list.length && dragId && <div className="h-1 rounded bg-[var(--brand)]/50" />}
                {!list.length && <p className="rounded-xl border border-dashed border-[var(--line)] px-3 py-6 text-center text-[12.5px] text-[var(--muted)]">Drop a project here</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
