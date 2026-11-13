import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pin, Trash2 } from "lucide-react";
import { formatMinutes } from "@eszy/shared";
import { del, get, post, put } from "../lib/api";
import { useSession } from "../lib/session";
import { AccountPicker, ChannelPicker, SourcePicker } from "../components/Masters";
import { ProjectActivityFeed } from "./ProjectParts";
import { Button, Card, Checkbox, ErrorNote, Field, Input, Pill, Select, Table, Textarea, useToast, RichText } from "../components/ui";

const ACTION_LABEL: Record<string, string> = {
  "project.create": "created the project", "project.update": "changed the project", "project.status": "changed the status",
  "billing_line.create": "added a billing line", "billing_line.update": "changed a billing line", "billing_line.delete": "removed a billing line",
  "extra_hours.add": "added extra hours", "note.create": "added a note", "invoice.cancel": "cancelled an invoice", "invoice.refund": "refunded an invoice",
  "invoice.correct": "issued a corrected invoice", "payment.record": "recorded a payment", "invoice.update": "changed an invoice", "invoice.send": "emailed an invoice",
};

/** The activity timeline (sheets, approvals, comments, changes) next to the project notes (pinned first). */
export function ProjectActivity({ project }: { project: any }) {
  const { me, can } = useSession();
  const qc = useQueryClient();
  const notes = useQuery({ queryKey: ["notes", project.id], queryFn: () => get<any[]>(`/projects/${project.id}/notes`) });
  const [note, setNote] = useState({ title: "", body: "", pinned: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["notes", project.id] }); qc.invalidateQueries({ queryKey: ["activity", project.id] }); };
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <ProjectActivityFeed project={project} />
      <div className="xl:sticky xl:top-20"><Card title="Notes" sub="Pinned notes stay at the top.">
        <div className="mb-4 grid gap-2">
          <Input placeholder="Title" value={note.title} onChange={(e) => setNote({ ...note, title: e.target.value })} />
          <Textarea placeholder="Logins, decisions, client preferences…" value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} />
          <div className="flex items-center justify-between"><Checkbox label="Pin to top" checked={note.pinned} onChange={(v) => setNote({ ...note, pinned: v })} />
            <Button size="sm" disabled={!note.title} onClick={async () => { await post(`/projects/${project.id}/notes`, note); setNote({ title: "", body: "", pinned: false }); refresh(); }}>Add note</Button></div>
        </div>
        <ul className="-mr-2 grid max-h-[calc(100vh-24rem)] min-h-24 gap-3 overflow-y-auto pr-2 scrollbar-thin">
          {(notes.data ?? []).map((n) => (
            <li key={n.id} className="rounded-xl border border-[var(--line)] p-3">
              <div className="flex items-start justify-between gap-2">
                <b className="flex items-center gap-1.5">{n.pinned && <Pin className="size-3.5 text-[var(--accent)]" />}{n.title}</b>
                <span className="flex gap-1">
                  <button className="text-[13px] font-semibold" onClick={async () => { await put(`/notes/${n.id}`, { pinned: !n.pinned }); refresh(); }}>{n.pinned ? "Unpin" : "Pin"}</button>
                  {(n.created_by === me!.user.id || can("projects.manage")) && <button aria-label="Delete note" onClick={async () => { await del(`/notes/${n.id}`); refresh(); }}><Trash2 className="size-3.5" /></button>}
                </span>
              </div>
              {n.body && <RichText className="mt-1 text-[14px]" text={n.body} />}
              <div className="mt-1 text-[12px] text-[var(--muted)]">{n.author} · {new Date(n.updated_at).toLocaleDateString()}</div>
            </li>
          ))}
        </ul>
      </Card></div>
    </div>
  );
}
const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") || "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Where the project came from, how the client talks to us, tracking IDs, offline hours. */
export function ProjectAbout({ project: p, onChange }: { project: any; onChange: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const edit = can("projects.manage", "projects.billing");
  const [f, setF] = useState<any>(null);
  const v = f ?? { sourceId: p.source_id ?? null, accountId: p.account_id ?? null, communicationTypeIds: p.communication_type_ids ?? [], allowOfflineHours: p.allow_offline_hours };
  const [tr, setTr] = useState({ label: "", externalId: "" });
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="Onboarding and communication">
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Source"><SourcePicker disabled={!edit} value={v.sourceId} onChange={(x) => setF({ ...v, sourceId: x, accountId: null })} /></Field>
            <Field label="Account" hint="e.g. the Upwork profile the contract is on"><AccountPicker disabled={!edit} value={v.accountId} sourceId={v.sourceId} onChange={(x) => setF({ ...v, accountId: x })} /></Field>
          </div>
          <Field label="Communication channels">{edit ? <ChannelPicker value={v.communicationTypeIds} onChange={(x) => setF({ ...v, communicationTypeIds: x })} /> : <div className="text-[14px]">{p.communication_types?.join(", ") || "—"}</div>}</Field>
          <Checkbox label="Allow offline hours" hint="Hours worked but not tracked in the client's tracker, with a reason" checked={v.allowOfflineHours} onChange={(x) => edit && setF({ ...v, allowOfflineHours: x })} />
          <ErrorNote error={err} />
          {edit && <div><Button disabled={!f} onClick={async () => { setErr(null); try { await put(`/projects/${p.id}`, v); setF(null); toast("Saved"); onChange(); } catch (e) { setErr(e); } }}>Save</Button></div>}
        </div>
      </Card>
      <div className="grid content-start gap-5">
        <Card title="Tracking IDs">
          <p className="mb-3 text-sm text-[var(--muted)]">Contracts or tracker IDs (e.g. Upwork contracts). People pick one on each sheet entry, so you can match hours to the client's tracker.</p>
          <Table head={["Label", "ID", "Account", ""]} empty="No tracking IDs yet.">
            {p.trackers.map((t: any) => <tr key={t.id}><td className="font-semibold">{t.label}</td><td>{t.external_id || "—"}</td><td>{t.account_name ?? "—"}</td>
              <td className="text-right">{edit && <Button size="sm" variant="ghost" onClick={async () => { await put(`/trackers/${t.id}`, { active: !t.active }); onChange(); }}>{t.active ? "Turn off" : "Turn on"}</Button>}{!t.active && <Pill status="ended">Off</Pill>}</td></tr>)}
          </Table>
          {edit && <div className="mt-3 flex flex-wrap gap-2"><Input placeholder="Label, e.g. Contract March" value={tr.label} onChange={(e) => setTr({ ...tr, label: e.target.value })} className="min-w-48 flex-1" /><Input placeholder="ID" value={tr.externalId} onChange={(e) => setTr({ ...tr, externalId: e.target.value })} className="w-32" />
            <Button disabled={!tr.label} onClick={async () => { await post(`/projects/${p.id}/trackers`, tr); setTr({ label: "", externalId: "" }); onChange(); }}>Add</Button></div>}
        </Card>
        <Card title="Tracked and offline hours">
          <div className="grid grid-cols-2 gap-3 text-[14px]">
            <div><div className="text-[var(--muted)]">Tracked outside eszy</div><div className="text-xl font-bold tabnum">{formatMinutes(p.hoursSplit.tracked)}</div></div>
            <div><div className="text-[var(--muted)]">Offline</div><div className="text-xl font-bold tabnum">{formatMinutes(p.hoursSplit.offline)}</div></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
