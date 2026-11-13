import { ActivityLog } from "../components/ActivityLog";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { leadInputSchema } from "@eszy/shared";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { get, post, put, qs } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, Card, Combobox, cx, DataTable, ErrorNote, Field, Input, Modal, MoneyInput, PageHeader, Pill, Select, Spinner, Table, Tabs, Textarea, fmtDate, fmtDateTime, useToast, RichText } from "../components/ui";

const STATUS_TABS = ["all", "new", "contacted", "follow_up", "converted", "onboarded", "lost"];

export function Leads() {
  const { can } = useSession();
  const [tab, setTab] = useState("all");
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["leads", tab], queryFn: () => get<any[]>(`/leads${qs({ status: tab === "all" ? "" : tab })}`) });
  return (
    <>
      <PageHeader title="Leads" sub={can("leads.view_all") ? "Every lead in the company." : "Leads you brought in, and leads assigned to you to call."}
        actions={can("leads.create") ? <Button onClick={() => setOpen(true)}>New lead</Button> : undefined} />
      <Tabs value={tab} onChange={setTab} tabs={STATUS_TABS.map((s) => ({ id: s, label: s === "all" ? "All" : s === "follow_up" ? "Follow-up" : s[0].toUpperCase() + s.slice(1) }))} />
      <DataTable rows={q.data} loading={q.isLoading} rowKey={(l: any) => l.id} rowHref={(l: any) => `/leads/${l.id}`} searchPlaceholder="Search title, company or contact" exportName="leads" tableId="leads" empty="No leads here yet."
        initialSort={{ key: "c", dir: "desc" }} dateFilter="c"
        columns={[
          { key: "l", header: "Lead", cell: (l: any) => <>{l.title}<div className="text-[12.5px] font-normal text-[var(--muted)]">{[l.contact_name, l.company].filter(Boolean).join(", ")}</div></>, sort: (l: any) => l.title, text: (l: any) => `${l.title} ${l.contact_name ?? ""} ${l.company ?? ""}`, filter: false },
          { key: "b", header: "Brought by", cell: (l: any) => l.bringer_name ?? "—", sort: (l: any) => l.bringer_name ?? "", text: (l: any) => l.bringer_name ?? "" },
          { key: "cl", header: "Caller", cell: (l: any) => l.caller_name ?? <span className="text-[var(--muted)]">Not assigned</span>, sort: (l: any) => l.caller_name ?? "", filter: (l: any) => l.caller_name ?? "Not assigned" },
          { key: "cv", header: "Converted by", cell: (l: any) => l.converter_name ?? "—", sort: (l: any) => l.converter_name ?? "", optional: true },
          { key: "cli", header: "Client", cell: (l: any) => (l.client_id ? <Link to={`/clients/${l.client_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-[var(--brand)] hover:underline dark:text-[var(--accent)]">{l.client_name}</Link> : <span className="text-[var(--muted)]">—</span>), sort: (l: any) => l.client_name ?? "", text: (l: any) => l.client_name ?? "", filter: false, optional: true },
          { key: "n", header: "Calls", cell: (l: any) => l.call_count, sort: (l: any) => l.call_count, align: "right" },
          { key: "f", header: "Next follow-up", cell: (l: any) => (l.next_follow_up_at ? fmtDateTime(l.next_follow_up_at) : "—"), sort: (l: any) => l.next_follow_up_at ?? "" },
          { key: "c", header: "Added", cell: (l: any) => fmtDate(l.created_at), sort: (l: any) => l.created_at ?? "", optional: true },
          { key: "s", header: "Status", cell: (l: any) => <Pill status={l.status} />, sort: (l: any) => l.status, filter: (l: any) => (l.status === "follow_up" ? "Follow-up" : l.status[0].toUpperCase() + l.status.slice(1)) },
        ]} />
      <LeadForm open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function LeadForm({ open, onClose, lead }: { open: boolean; onClose: () => void; lead?: any }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const { me } = useSession();
  const users = useQuery({ queryKey: ["users"], queryFn: () => get<any[]>("/users") });
  const form = useForm({
    resolver: zodResolver(leadInputSchema),
    values: lead ? { title: lead.title, contactName: lead.contact_name, email: lead.email, phone: lead.phone, company: lead.company, country: lead.country, source: lead.source, notes: lead.notes, estimatedValueMinor: lead.estimated_value_minor, callerId: lead.caller_id } : undefined,
    defaultValues: { title: "", contactName: "", email: "", phone: "", company: "", country: "", source: "", notes: "", callerId: null, estimatedValueMinor: null },
  });
  const [err, setErr] = useState<unknown>(null);
  const submit = form.handleSubmit(async (v) => {
    setErr(null);
    try {
      if (lead) { await put(`/leads/${lead.id}`, v); toast("Lead saved"); qc.invalidateQueries({ queryKey: ["lead", lead.id] }); onClose(); }
      else { const l = await post("/leads", { ...v, callerId: v.callerId || null }); qc.invalidateQueries({ queryKey: ["leads"] }); onClose(); nav(`/leads/${l.id}`); }
    } catch (e) { setErr(e); }
  });
  const e = form.formState.errors;
  return (
    <Modal open={open} onClose={onClose} title={lead ? "Edit lead" : "New lead"} wide>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="What's the lead" error={e.title?.message} className="sm:col-span-2"><Input {...form.register("title")} placeholder="e.g. Shopify store rebuild" /></Field>
        <Field label="Contact name"><Input {...form.register("contactName")} /></Field>
        <Field label="Company"><Input {...form.register("company")} /></Field>
        <Field label="Email"><Input type="email" {...form.register("email")} /></Field>
        <Field label="Phone"><Input {...form.register("phone")} /></Field>
        <Field label="Country"><Input {...form.register("country")} placeholder="e.g. US" /></Field>
        <Field label="Source"><Input {...form.register("source")} placeholder="e.g. Upwork, referral" /></Field>
        <Field label="Estimated value"><MoneyInput currency={me!.settings.locale.currency} value={form.watch("estimatedValueMinor") ?? null} onChange={(m) => form.setValue("estimatedValueMinor", m)} /></Field>
        {!lead && (
          <Field label="Caller" hint="Who will make the calls. You can do it yourself or assign anyone.">
            <Select {...form.register("callerId")}><option value="">Me / decide later</option>{(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          </Field>
        )}
        <Field label="Notes" className="sm:col-span-2"><Textarea {...form.register("notes")} /></Field>
        <div className="sm:col-span-2"><ErrorNote error={err} /></div>
        <div className="sm:col-span-2"><Button type="submit" busy={form.formState.isSubmitting}>{lead ? "Save" : "Create lead"}</Button></div>
      </form>
    </Modal>
  );
}

export function LeadDetail() {
  const { id } = useParams();
  const { me, can, money } = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const q = useQuery({ queryKey: ["lead", id], queryFn: () => get(`/leads/${id}`) });
  const users = useQuery({ queryKey: ["users"], queryFn: () => get<any[]>("/users") });
  const [call, setCall] = useState({ outcome: "interested", notes: "", nextFollowUpAt: "" });
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (q.isLoading || !q.data) return <Spinner />;
  const l = q.data;
  const uid = me!.user.id;
  const isBringer = l.bringer_id === uid;
  const canAssign = isBringer || can("leads.assign");
  const canCall = (l.caller_id === uid || isBringer || can("leads.manage")) && !["converted", "onboarded", "lost"].includes(l.status);
  const name = (x: string | null) => l.people.find((p: any) => p.id === x)?.name ?? "—";
  const refresh = () => { qc.invalidateQueries({ queryKey: ["lead", id] }); qc.invalidateQueries({ queryKey: ["leads"] }); };
  const run = async (fn: () => Promise<any>, msg: string) => { setBusy(true); setErr(null); try { await fn(); toast(msg); refresh(); } catch (e) { setErr(e); } finally { setBusy(false); } };

  return (
    <>
      <PageHeader title={l.title} sub={[l.contact_name, l.company, l.email, l.phone].filter(Boolean).join(" · ")}
        actions={<>{(isBringer || can("leads.manage")) && <Button variant="outline" onClick={() => setEdit(true)}>Edit</Button>}<Pill status={l.status} /></>} />
      <ErrorNote error={err} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-5">
          {["converted", "onboarded"].includes(l.status) && <OnboardingCard lead={l} canAct={isBringer || can("clients.manage")} onChange={refresh} />}
          {canCall && (
            <Card title="Log a call">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Outcome"><Select value={call.outcome} onChange={(e) => setCall({ ...call, outcome: e.target.value })}>
                  <option value="no_answer">No answer</option><option value="interested">Interested</option><option value="follow_up">Call back later</option><option value="not_interested">Not interested</option><option value="converted">Converted: they said yes</option>
                </Select></Field>
                <Field label="Next follow-up"><Input type="datetime-local" value={call.nextFollowUpAt} onChange={(e) => setCall({ ...call, nextFollowUpAt: e.target.value })} /></Field>
                <Field label="Notes" className="sm:col-span-2"><Textarea value={call.notes} onChange={(e) => setCall({ ...call, notes: e.target.value })} /></Field>
              </div>
              <Button className="mt-3" busy={busy} onClick={() => run(() => post(`/leads/${l.id}/calls`, { ...call, nextFollowUpAt: call.nextFollowUpAt ? new Date(call.nextFollowUpAt).toISOString() : null }).then(() => setCall({ outcome: "interested", notes: "", nextFollowUpAt: "" })), "Call logged")}>Save call</Button>
              {call.outcome === "converted" && <p className="mt-2 text-sm text-[var(--muted)]">You'll be recorded as the person who converted this lead.</p>}
            </Card>
          )}
          <Card title="Call history">
            {l.calls.length === 0 ? <p className="text-[var(--muted)]">No calls yet.</p> : (
              <ol className="grid gap-3">
                {l.calls.map((c: any) => (
                  <li key={c.id} className="rounded-xl border border-[var(--line)] p-3">
                    <div className="flex flex-wrap justify-between gap-2"><span><b>{c.caller_name}</b> · {new Date(c.called_at).toLocaleString()}</span><Pill status={c.outcome === "no_answer" ? "draft" : c.outcome === "not_interested" ? "lost" : c.outcome}>{c.outcome.replace(/_/g, " ")}</Pill></div>
                    {c.notes && <RichText className="mt-1 text-[14px]" text={c.notes} />}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
        <div className="grid content-start gap-5">
          <Card title="People">
            <dl className="grid gap-3 text-[14.5px]">
              <div><dt className="text-[var(--muted)]">Brought by</dt><dd className="font-semibold">{name(l.bringer_id)}</dd></div>
              <div>
                <dt className="text-[var(--muted)]">Caller</dt>
                {canAssign && !["converted", "onboarded"].includes(l.status) ? (
                  <Select className="mt-1" value={l.caller_id ?? ""} onChange={(e) => run(() => post(`/leads/${l.id}/assign`, { callerId: e.target.value || null }), "Caller assigned")}>
                    <option value="">Not assigned</option>{(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                ) : <dd className="font-semibold">{name(l.caller_id)}</dd>}
              </div>
              <div><dt className="text-[var(--muted)]">Converted by</dt><dd className="font-semibold">{name(l.converter_id)}</dd></div>
            </dl>
          </Card>
          <Card title="Details">
            <dl className="grid gap-2 text-[14.5px]">
              <div><dt className="text-[var(--muted)]">Source</dt><dd>{l.source || "—"}</dd></div>
              <div><dt className="text-[var(--muted)]">Country</dt><dd>{l.country || "—"}</dd></div>
              {l.estimated_value_minor != null && <div><dt className="text-[var(--muted)]">Estimated value</dt><dd>{money(l.estimated_value_minor)}</dd></div>}
              {l.notes && <div><dt className="text-[var(--muted)]">Notes</dt><dd><RichText text={l.notes} /></dd></div>}
            </dl>
            {(isBringer || can("leads.manage")) && !["converted", "onboarded", "lost"].includes(l.status) && (
              <Button variant="ghost" size="sm" className="mt-3" onClick={() => run(() => put(`/leads/${l.id}`, { status: "lost" }), "Marked as lost")}>Mark as lost</Button>
            )}
          </Card>
        </div>
      </div>
      <Card className="mt-5" title="Activity" sub="Calls, assignments and changes to this lead."><ActivityLog entity="lead" id={l.id} compact /></Card>
      <LeadForm open={edit} onClose={() => setEdit(false)} lead={l} />
    </>
  );
}

/** A converted lead's path to a client and projects: create the client, or link one that exists, then set up the project. */
function OnboardingCard({ lead: l, canAct, onChange }: { lead: any; canAct: boolean; onChange: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useSession();
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const clients = useQuery({ queryKey: ["clients"], queryFn: () => get<any[]>("/clients"), enabled: canAct && !l.client && can("clients.manage") });
  const newProject = (clientId: string) => nav(`/projects/new?clientId=${clientId}&leadId=${l.id}&salesUserId=${l.bringer_id}`);
  const steps = [
    { done: true, label: "Lead converted" },
    { done: !!l.client, label: l.client ? <>Client <Link className="font-semibold text-[var(--brand)] hover:underline dark:text-[var(--accent)]" to={`/clients/${l.client.id}`}>{l.client.name}</Link></> : "Client created or linked" },
    { done: l.projects.length > 0, label: l.projects.length ? <>Project{l.projects.length > 1 ? "s" : ""} {l.projects.map((p: any, i: number) => <span key={p.id}>{i > 0 && ", "}<Link className="font-semibold text-[var(--brand)] hover:underline dark:text-[var(--accent)]" to={`/projects/${p.id}`}>{p.name}</Link></span>)}</> : "Project set up" },
  ];
  return (
    <Card title="Onboarding" sub="From converted lead to client and project.">
      <ErrorNote error={err} />
      <ol className="grid gap-2.5">
        {steps.map((st, i) => (
          <li key={i} className="flex items-center gap-3 text-[14px]">
            <span className={cx("grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold", st.done ? "bg-[#e2f3ea] text-[#17623f] dark:bg-[#17623f]/30 dark:text-[#8fd8b2]" : "bg-[var(--bg)] text-[var(--muted)] ring-1 ring-[var(--line)]")}>{st.done ? "✓" : i + 1}</span>
            <span className={st.done ? "" : "text-[var(--muted)]"}>{st.label}</span>
          </li>
        ))}
      </ol>
      {canAct && !l.client && (
        <div className="mt-4 grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg)]/60 p-4 sm:grid-cols-[auto_1fr] sm:items-end">
          <Button busy={busy} onClick={async () => { setBusy(true); try { const c = await post(`/leads/${l.id}/client`, {}); newProject(c.id); } catch (e) { setErr(e); setBusy(false); } }}>Create client and project</Button>
          {can("clients.manage") && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1"><Field label="Or link a client that already exists"><Combobox value={pick} onChange={setPick} options={(clients.data ?? []).map((c: any) => ({ value: c.id, label: c.name, sub: c.company }))} placeholder="Search clients" /></Field></div>
              <Button variant="secondary" disabled={!pick || busy} onClick={async () => { setBusy(true); setErr(null); try { await post(`/leads/${l.id}/link-client`, { clientId: pick }); toast("Client linked"); onChange(); } catch (e) { setErr(e); } finally { setBusy(false); } }}>Link</Button>
            </div>
          )}
        </div>
      )}
      {canAct && l.client && <div className="mt-4"><Button variant={l.projects.length ? "secondary" : "primary"} onClick={() => newProject(l.client.id)}>{l.projects.length ? "Add another project" : "Set up the project"}</Button></div>}
    </Card>
  );
}
