import { ActivityLog } from "../components/ActivityLog";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Globe, Mail, Pencil, Phone, Plus, Upload } from "lucide-react";
import { formatMinutes } from "@eszy/shared";
import { get, post, put } from "../lib/api";
import { useSession } from "../lib/session";
import { opts, useAction, useClients, useList } from "../lib/hooks";
import { BarChart, RankList } from "../components/Charts";
import {
  Button, Card, Combobox, DataTable, DetailList, Drawer, Empty, ErrorNote, Field, Input, LinkButton, MultiSelect, PageHeader, Pill, Segmented, Select, Spinner, Stat, StatGrid,
  Tabs, Textarea, fmtDate, fmtDateTime, hrs, useToast, type Column, RichText } from "../components/ui";
import { ImportModal } from "./People";
import { AccountPicker, ChannelPicker, SourcePicker } from "../components/Masters";

const TYPE: Record<string, string> = { upwork: "Hired on Upwork", direct: "Direct", other: "Other platform" };

export function Clients() {
  const { can, money } = useSession();
  const nav = useNavigate();
  const q = useClients();
  const sources = useList("project-sources");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("active");
  const [source, setSource] = useState("");
  const [edit, setEdit] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);
  const all = q.data ?? [];
  const rows = all.filter((c) => (!type || c.client_type === type) && (status === "all" || c.status === status) && (!source || c.source_id === source));
  const moneyOn = can("money.view");
  const cols: Column<any>[] = [
    { key: "n", header: "Client", cell: (c) => <><span className="font-semibold">{c.name}</span>{c.company && <div className="text-[12.5px] text-[var(--muted)]">{c.company}</div>}</>, sort: (c) => c.name.toLowerCase(), text: (c) => `${c.name} ${c.company}` },
    { key: "t", header: "Hiring", cell: (c) => <><Pill status={c.client_type}>{TYPE[c.client_type]}</Pill>{c.hiring_id && <div className="mt-0.5 text-[12px] text-[var(--muted)]">ID {c.hiring_id}</div>}</>, sort: (c) => c.client_type, text: (c) => `${c.client_type} ${c.hiring_id}` },
    { key: "c", header: "Contact", optional: true, cell: (c) => <>{c.contact_name || "—"}<div className="text-[12.5px] text-[var(--muted)]">{[c.email, c.phone].filter(Boolean).join(" · ")}</div></>, text: (c) => `${c.contact_name} ${c.email} ${c.phone}` },
    { key: "s", header: "Source", cell: (c) => <>{c.source_name ?? "—"}{c.account_name && <div className="text-[12.5px] text-[var(--muted)]">{c.account_name}</div>}</>, sort: (c) => c.source_name ?? "", text: (c) => `${c.source_name ?? ""} ${c.account_name ?? ""}` },
    { key: "ch", header: "Communication", optional: true, cell: (c) => c.communication_types?.length ? <span className="text-[13px]">{c.communication_types.join(", ")}</span> : "—", text: (c) => (c.communication_types ?? []).join(" ") },
    { key: "co", header: "Country", optional: true, cell: (c) => `${c.country}${c.state ? `, ${c.state}` : ""}`, sort: (c) => c.country, text: (c) => `${c.country} ${c.state}` },
    { key: "p", header: "Projects", cell: (c) => <>{c.active_projects}<span className="text-[var(--muted)]"> / {c.project_count}</span></>, sort: (c) => c.project_count, align: "right" },
    { key: "h", header: "Hours", cell: (c) => hrs(c.logged_minutes), sort: (c) => c.logged_minutes, align: "right" },
    { key: "r", header: "Revenue", cell: (c) => money(c.revenue_minor), sort: (c) => Number(c.revenue_minor), align: "right", hide: !moneyOn },
    { key: "ar", header: "Average rate", cell: (c) => (c.avg_rate_minor != null ? `${money(c.avg_rate_minor)}/h` : <span className="text-[var(--muted)]">—</span>), sort: (c) => Number(c.avg_rate_minor ?? -1), align: "right", hide: !moneyOn },
    { key: "o", header: "Outstanding", cell: (c) => (Number(c.outstanding_minor) ? <span className="font-semibold text-[#9c3a19]">{money(c.outstanding_minor)}</span> : "—"), sort: (c) => Number(c.outstanding_minor), align: "right", hide: !moneyOn },
  ];
  return (
    <>
      <PageHeader title="Clients" sub="Everyone you work for, how they hired you, and what they've paid."
        actions={can("clients.manage") && <>{can("import_export") && <Button variant="secondary" onClick={() => setImporting(true)}><Upload />Import</Button>}<Button onClick={() => setEdit({})}><Plus />Add client</Button></>} />
      <StatGrid cols={4}>
        <Stat label="Active clients" value={all.filter((c) => c.status === "active").length} onClick={() => setStatus("active")} active={status === "active" && !type} />
        <Stat label="Hired on Upwork" value={all.filter((c) => c.client_type === "upwork").length} onClick={() => setType(type === "upwork" ? "" : "upwork")} active={type === "upwork"} />
        <Stat label="Direct" value={all.filter((c) => c.client_type === "direct").length} onClick={() => setType(type === "direct" ? "" : "direct")} active={type === "direct"} />
        {moneyOn ? <Stat label="Outstanding" value={money(all.reduce((a, c) => a + Number(c.outstanding_minor ?? 0), 0))} tone="late" /> : <Stat label="With active projects" value={all.filter((c) => c.active_projects).length} />}
      </StatGrid>
      <DataTable rows={rows} columns={cols} rowKey={(c) => c.id} loading={q.isLoading} onRowClick={(c) => nav(`/clients/${c.id}`)} exportName="clients" searchPlaceholder="Search name, company, email, hiring ID"
        empty={all.length ? "No clients match these filters." : "No clients yet. Add one, or onboard a converted lead."}
        filters={<>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-32" aria-label="Status"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option></Select>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-40" aria-label="Hiring"><option value="">Any hiring</option>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-36" aria-label="Source"><option value="">Any source</option>{sources.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </>} />
      <ClientForm client={edit} onClose={() => setEdit(null)} />
      <ImportModal open={importing} onClose={() => setImporting(false)} entity="clients" title="Import clients" invalidate={["clients"]} />
    </>
  );
}

/** Upwork hiring form or Direct hiring form, like the old EPM. */
export function ClientForm({ client, onClose }: { client: any; onClose: () => void }) {
  const open = !!client;
  const sources = useList("project-sources", open);
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const isNew = !client?.id;
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const upworkSource = sources.data?.find((s) => s.name.toLowerCase() === "upwork")?.id ?? null;
  const v = f ?? {
    clientType: client?.client_type ?? "direct", name: client?.name ?? "", company: client?.company ?? "", contactName: client?.contact_name ?? "", email: client?.email ?? "",
    phone: client?.phone ?? "", website: client?.website ?? "", hiringId: client?.hiring_id ?? "", sourceId: client?.source_id ?? null, accountId: client?.account_id ?? null,
    communicationTypeIds: client?.communication_type_ids ?? [], country: client?.country ?? "IN", state: client?.state ?? "", taxId: client?.tax_id ?? "", address: client?.address ?? "",
    preferredBilling: client?.preferred_billing ?? null, notes: client?.notes ?? "", status: client?.status ?? "active", leadId: client?.lead_id ?? null,
  };
  const leads = useQuery({ queryKey: ["leads", "converted-for-client"], queryFn: () => get<any[]>("/leads?status=converted"), enabled: open, retry: false });
  const leadOpts = (leads.data ?? []).filter((l: any) => !l.client_id || l.client_id === client?.id || l.id === v.leadId)
    .map((l: any) => ({ value: l.id, label: l.title, sub: [l.contact_name, l.company].filter(Boolean).join(", ") }));
  const pickLead = (id: string | null) => {
    const l = (leads.data ?? []).find((x: any) => x.id === id);
    if (!l) return set({ leadId: id });
    // Fill empty fields from the lead so nobody types them twice.
    set({ leadId: id, name: v.name || l.contact_name || l.company || l.title, company: v.company || l.company || "", email: v.email || l.email || "", phone: v.phone || l.phone || "", contactName: v.contactName || l.contact_name || "", country: v.country || l.country || "IN" });
  };
  const set = (p: any) => setF({ ...v, ...p });
  const close = () => { setF(null); setErr(null); onClose(); };
  const upwork = v.clientType === "upwork";
  const save = async () => {
    setErr(null); setBusy(true);
    try {
      const body = { ...v, sourceId: v.sourceId ?? (upwork ? upworkSource : null) };
      if (isNew) { const c = await post("/clients", body); toast("Client added"); qc.invalidateQueries({ queryKey: ["clients"] }); close(); nav(`/clients/${c.id}`); return; }
      await put(`/clients/${client.id}`, body); toast("Saved");
      qc.invalidateQueries({ queryKey: ["clients"] }); qc.invalidateQueries({ queryKey: ["client", client.id] }); close();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Drawer open={open} onClose={close} title={isNew ? "Add client" : `Edit ${client?.name}`} width="max-w-2xl"
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button busy={busy} disabled={!v.name} onClick={save}>{isNew ? "Add client" : "Save changes"}</Button></>}>
      <div className="grid gap-6">
        <Segmented value={v.clientType} onChange={(x) => set({ clientType: x, sourceId: x === "upwork" ? upworkSource : v.sourceId })} options={[{ id: "upwork", label: "Upwork hiring form" }, { id: "direct", label: "Direct hiring form" }, { id: "other", label: "Other platform" }]} />
        {(leadOpts.length > 0 || v.leadId) && (
          <Field label="From lead" info="Link the converted lead this client came from. The lead shows as onboarded once a project is set up." hint="Picking a lead fills in the contact details that are still empty.">
            <Combobox value={v.leadId} onChange={pickLead} options={leadOpts.length ? leadOpts : v.leadId ? [{ value: v.leadId, label: client?.lead_title ?? "Linked lead" }] : []} placeholder="Not from a lead" />
          </Field>
        )}
        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Client name" required><Input value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Mia Chen" /></Field>
          <Field label="Company"><Input value={v.company} onChange={(e) => set({ company: e.target.value })} placeholder="e.g. BrightCart" /></Field>
          <Field label="Contact person"><Input value={v.contactName} onChange={(e) => set({ contactName: e.target.value })} placeholder="Who you talk to day to day" /></Field>
          <Field label="Contact email"><Input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Contact number"><Input value={v.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Website"><Input value={v.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://" /></Field>
        </section>
        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="text-[13px] font-bold text-[var(--muted)] sm:col-span-2">{upwork ? "Upwork details" : "How they hired you"}</h3>
          <Field label={upwork ? "Upwork hiring ID" : "Contract or reference ID"} info={upwork ? "The client or contract ID on Upwork, so anyone can find them there." : undefined}><Input value={v.hiringId} onChange={(e) => set({ hiringId: e.target.value })} placeholder={upwork ? "e.g. 01a2b3c4d5e6" : "Optional"} /></Field>
          <Field label="Project type they prefer"><Select value={v.preferredBilling ?? ""} onChange={(e) => set({ preferredBilling: e.target.value || null })}><option value="">Not set</option><option value="hourly">Hourly</option><option value="fixed">Fixed price</option></Select></Field>
          <Field label="Onboarding source" hint="Not in the list? Type it and choose Add."><SourcePicker value={v.sourceId} onChange={(x) => set({ sourceId: x, accountId: null })} /></Field>
          <Field label="Onboarding account" info="Which of your accounts on that source they hired (e.g. your Upwork agency profile)." hint="New accounts are added under the source picked."><AccountPicker value={v.accountId} sourceId={v.sourceId} onChange={(x) => set({ accountId: x })} /></Field>
          <Field label="Communication channels" className="sm:col-span-2" hint="Pick as many as apply, or type a new one and press Enter."><ChannelPicker value={v.communicationTypeIds} onChange={(x) => set({ communicationTypeIds: x })} placeholder={upwork ? "e.g. Upwork messages, Zoom" : "e.g. Email, Slack, Microsoft Teams"} /></Field>
        </section>
        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="text-[13px] font-bold text-[var(--muted)] sm:col-span-2">Billing address and tax</h3>
          <Field label="Country code" hint="Two letters, e.g. IN, US, GB"><Input value={v.country} maxLength={2} onChange={(e) => set({ country: e.target.value.toUpperCase() })} /></Field>
          <Field label="State" hint="For GST: same state gets CGST + SGST, other states IGST"><Input value={v.state} onChange={(e) => set({ state: e.target.value })} /></Field>
          <Field label="GSTIN / VAT number"><Input value={v.taxId} onChange={(e) => set({ taxId: e.target.value })} /></Field>
          <Field label="Status"><Select value={v.status} onChange={(e) => set({ status: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></Select></Field>
          <Field label="Address" className="sm:col-span-2"><Textarea plain value={v.address} onChange={(e) => set({ address: e.target.value })} className="min-h-16" /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={v.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Anything the team should know about this client" /></Field>
        </section>
        <ErrorNote error={err} />
      </div>
    </Drawer>
  );
}

export function ClientDetail() {
  const { id } = useParams();
  const { can, money } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const [edit, setEdit] = useState(false);
  const [comment, setComment] = useState("");
  const act = useAction();
  const q = useQuery({ queryKey: ["client", id], queryFn: () => get(`/clients/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <Empty icon={<Building2 />} title="Client not found" />;
  const c = q.data;
  const moneyOn = can("money.view");
  return (
    <>
      <PageHeader back={{ to: "/clients", label: "Clients" }} title={c.name}
        meta={<>{c.company && <span className="font-semibold text-[var(--text)]">{c.company}</span>}<Pill status={c.client_type}>{TYPE[c.client_type]}</Pill>{c.status !== "active" && <Pill status="inactive" />}{c.hiring_id && <span>Hiring ID {c.hiring_id}</span>}{c.source_name && <span>via {c.source_name}{c.account_name ? ` · ${c.account_name}` : ""}</span>}</>}
        actions={<>
          {c.email && <a href={`mailto:${c.email}`}><Button variant="secondary" size="sm"><Mail />Email</Button></a>}
          {c.phone && <a href={`tel:${c.phone}`}><Button variant="secondary" size="sm"><Phone />Call</Button></a>}
          {c.website && <a href={c.website} target="_blank" rel="noreferrer"><Button variant="secondary" size="sm"><Globe />Website</Button></a>}
          {can("projects.manage") && <LinkButton size="sm" to={`/projects/new?clientId=${c.id}`}><Plus />New project</LinkButton>}
          {can("clients.manage") && <Button size="sm" onClick={() => setEdit(true)}><Pencil />Edit</Button>}
        </>} />
      <StatGrid cols={moneyOn ? 6 : 3}>
        <Stat label="Active projects" value={c.projects.filter((p: any) => p.status === "active").length} sub={`${c.projects.length} in total`} />
        <Stat label="Hours worked" value={hrs(c.totals.logged_minutes)} />
        <Stat label="People on their work" value={c.people.length} />
        {moneyOn && <Stat label="Invoiced" value={money(c.totals.invoiced_minor)} />}
        {moneyOn && <Stat label="Outstanding" value={money(c.totals.outstanding_minor)} tone={c.totals.outstanding_minor > 0 ? "late" : "paid"} sub={`${money(c.totals.paid_minor)} received`} />}
        {moneyOn && <Stat label="Average rate" info="Invoiced before tax (minus refunds and cancellations) across their projects ÷ approved hours."
          value={c.totals.avg_rate_minor != null ? `${money(c.totals.avg_rate_minor)}/h` : "—"} sub={c.totals.approved_minutes ? `${hrs(c.totals.approved_minutes)} approved` : "No approved hours yet"} />}
      </StatGrid>
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { id: "overview", label: "Overview" }, { id: "projects", label: "Projects", count: c.projects.length },
        { id: "invoices", label: "Invoices", count: c.invoices.length, hide: !can("invoices.view") }, { id: "notes", label: "Notes", count: c.comments.length },
        { id: "activity", label: "Activity" },
      ]} />
      {tab === "activity" && <ActivityLog entity="client" id={c.id} />}
      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card title="Client details" className="lg:col-span-2">
            <DetailList items={[
              ["Contact person", c.contact_name], ["Email", c.email], ["Phone", c.phone], ["Website", c.website],
              ["Hiring", TYPE[c.client_type]], ["Hiring ID", c.hiring_id], ["Onboarding source", c.source_name], ["Onboarding account", c.account_name],
              ["Communication", c.communication_types?.join(", ")], ["Prefers", c.preferred_billing === "hourly" ? "Hourly" : c.preferred_billing === "fixed" ? "Fixed price" : null],
              ["Country", `${c.country}${c.state ? `, ${c.state}` : ""}`], ["GSTIN / VAT", c.tax_id], ["Address", c.address], ["From lead", c.lead_id ? <Link to={`/leads/${c.lead_id}`} className="font-semibold text-[var(--brand)] hover:underline dark:text-[var(--accent)]">{c.lead_title ?? "Open lead"}</Link> : null],
              ["Added", `${fmtDate(c.created_at)}${c.created_by_name ? ` by ${c.created_by_name}` : ""}`],
            ]} />
            {c.notes && <RichText className="mt-5 rounded-lg bg-[var(--bg)] p-3 text-[14px]" text={c.notes} />}
          </Card>
          <Card title="Who works for them" sub="All-time hours">
            <RankList format={hrs} rows={c.people.map((p: any) => ({ key: p.id, label: <Link to={`/people/${p.id}`} className="hover:underline">{p.name}</Link>, value: p.minutes, sub: `last ${fmtDate(p.last_on, { day: "numeric", month: "short" })}` }))} empty="Nobody has logged hours yet." />
          </Card>
          <Card title="Hours by month" className="lg:col-span-3">
            <BarChart title="" data={c.months} x={(m) => new Date(`${m.month}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "2-digit" })} series={[{ key: "minutes", label: "Hours", color: "var(--series-1)" }]} format={(v) => formatMinutes(v)} height={190} />
          </Card>
        </div>
      )}
      {tab === "projects" && (
        <DataTable rows={c.projects} rowKey={(p: any) => p.id} rowHref={(p: any) => `/projects/${p.id}`} search={false}
          columns={[
            { key: "n", header: "Project", cell: (p: any) => p.name, sort: (p: any) => p.name },
            { key: "t", header: "Type", cell: (p: any) => (p.type === "fixed" ? "Fixed price" : `Hourly, ${p.billing_type}`) },
            { key: "pm", header: "PM", cell: (p: any) => p.pm_name ?? "—" },
            { key: "s", header: "Status", cell: (p: any) => <Pill status={p.status} /> },
            { key: "h", header: "Hours", cell: (p: any) => <>{hrs(p.logged_minutes)}{p.cap_minutes ? <span className="text-[var(--muted)]"> of {hrs(p.cap_minutes)}</span> : null}</>, align: "right", sort: (p: any) => p.logged_minutes },
            { key: "r", header: "Rate / price", cell: (p: any) => (p.type === "fixed" ? money(p.price_minor) : `${money(p.hourly_rate_minor)}/h`), align: "right", hide: !moneyOn },
            { key: "ar", header: "Average rate", cell: (p: any) => (p.avg_rate_minor != null ? `${money(p.avg_rate_minor)}/h` : "—"), sort: (p: any) => Number(p.avg_rate_minor ?? -1), align: "right", hide: !moneyOn },
          ]} />
      )}
      {tab === "invoices" && (
        <DataTable rows={c.invoices} rowKey={(i: any) => i.id} rowHref={(i: any) => `/invoices/${i.id}`} search={false} empty="No invoices yet."
          columns={[
            { key: "n", header: "Number", cell: (i: any) => i.number, sort: (i: any) => i.number },
            { key: "p", header: "Project", cell: (i: any) => i.project_name },
            { key: "d", header: "Date", cell: (i: any) => fmtDate(i.issue_date), sort: (i: any) => i.issue_date },
            { key: "due", header: "Due", cell: (i: any) => fmtDate(i.due_date), sort: (i: any) => i.due_date },
            { key: "t", header: "Total", cell: (i: any) => money(i.total_minor), align: "right", hide: !moneyOn },
            { key: "pd", header: "Paid", cell: (i: any) => money(i.paid_minor), align: "right", hide: !moneyOn },
            { key: "s", header: "Status", cell: (i: any) => <Pill status={i.status} /> },
          ]} />
      )}
      {tab === "notes" && (
        <Card title="Notes about this client">
          <div className="mb-4 flex gap-2"><Textarea className="min-h-16" placeholder="Write a note for the team" value={comment} onChange={(e) => setComment(e.target.value)} /><Button disabled={!comment.trim()} busy={!!act.busy} onClick={async () => { if (await act.run(() => post(`/clients/${c.id}/comments`, { body: comment }), "Note added")) { setComment(""); q.refetch(); } }}>Add</Button></div>
          <ErrorNote error={act.err} />
          <ul className="grid gap-3">
            {c.comments.map((m: any) => <li key={m.id} className="rounded-lg border border-[var(--line)] p-3"><div className="text-[12.5px] text-[var(--muted)]"><b className="text-[var(--text)]">{m.author}</b> · {fmtDateTime(m.created_at)}</div><RichText className="mt-1 text-[14px]" text={m.body} /></li>)}
            {!c.comments.length && <li className="py-6 text-center text-[13.5px] text-[var(--muted)]">No notes yet.</li>}
          </ul>
        </Card>
      )}
      <ClientForm client={edit ? c : null} onClose={() => setEdit(false)} />
    </>
  );
}
