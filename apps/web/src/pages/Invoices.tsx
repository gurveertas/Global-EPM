import { ActivityLog } from "../components/ActivityLog";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Hourglass, Plus, Receipt, Trash2, Wallet } from "lucide-react";
import { formatMinutes } from "@eszy/shared";
import { del, get, openFile, post, put, qs } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, Card, DataTable, ErrorNote, Field, HoursInput, Input, Modal, MoneyInput, PageHeader, Pill, Select, Spinner, Stat, StatGrid, Table, Tabs, Textarea, fmtDate, useToast } from "../components/ui";

const TABS = [
  { id: "all", label: "All" }, { id: "unpaid", label: "Unpaid" }, { id: "partially_paid", label: "Partially paid" }, { id: "paid", label: "Paid" },
  { id: "due_soon", label: "Due soon" }, { id: "overdue", label: "Overdue" }, { id: "refunded", label: "Refunded" }, { id: "cancelled", label: "Cancelled" },
];

const KIND_LABEL: Record<string, string> = { postpaid: "Postpaid", prepaid: "Prepaid", fixed: "Fixed price", manual: "Manual", extra: "Extra hours" };
const STATUS_NAME = (s: string) => TABS.find((t) => t.id === s)?.label ?? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function Invoices() {
  const { can, money } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "all";
  const q = useQuery({ queryKey: ["invoices", tab, params.get("clientId")], queryFn: () => get(`/invoices${qs({ tab, clientId: params.get("clientId") })}`) });
  const moneyOn = can("money.view");
  return (
    <>
      <PageHeader title="Invoices" actions={can("invoices.manage") ? <Link to="/invoices/new"><Button>New invoice</Button></Link> : undefined} />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={TABS.map((t) => ({ ...t, count: q.data?.counts?.[t.id] ?? 0 }))} />
      <DataTable rows={q.data?.invoices} loading={q.isLoading} rowKey={(i: any) => i.id} rowHref={(i: any) => `/invoices/${i.id}`} searchPlaceholder="Search number, project or client" exportName={`invoices-${tab}`} tableId="invoices"
        empty="No invoices in this tab." initialSort={{ key: "d", dir: "desc" }} dateFilter="d"
        columns={[
          { key: "n", header: "Number", cell: (i: any) => <>{i.number}<div className="text-[12px] font-normal text-[var(--muted)]">{KIND_LABEL[i.kind] ?? i.kind}</div></>, sort: (i: any) => i.number, text: (i: any) => i.number, filter: false },
          { key: "c", header: "Client", cell: (i: any) => i.client_name, sort: (i: any) => i.client_name ?? "", text: (i: any) => i.client_name ?? "" },
          { key: "p", header: "Project", cell: (i: any) => i.project_name ?? "—", sort: (i: any) => i.project_name ?? "", text: (i: any) => i.project_name ?? "" },
          { key: "k", header: "Type", cell: (i: any) => KIND_LABEL[i.kind] ?? i.kind, filter: (i: any) => KIND_LABEL[i.kind] ?? i.kind, optional: true },
          { key: "d", header: "Date", cell: (i: any) => fmtDate(i.issue_date), sort: (i: any) => i.issue_date },
          { key: "due", header: "Due", cell: (i: any) => fmtDate(i.due_date), sort: (i: any) => i.due_date ?? "" },
          ...(moneyOn ? [
            { key: "t", header: "Total", cell: (i: any) => money(i.total_minor), sort: (i: any) => i.total_minor, align: "right" as const },
            { key: "pd", header: "Paid", cell: (i: any) => money(i.paid_minor), sort: (i: any) => i.paid_minor, align: "right" as const },
          ] : []),
          { key: "s", header: "Status", cell: (i: any) => <Pill status={i.display_status} />, sort: (i: any) => i.display_status, filter: (i: any) => STATUS_NAME(i.display_status) },
        ]} />
    </>
  );
}

export function PendingPayments() {
  const { money } = useSession();
  const q = useQuery({ queryKey: ["invoices", "pending"], queryFn: () => get<any[]>("/invoices/pending") });
  const [pay, setPay] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [client, setClient] = useState("");
  const [project, setProject] = useState("");
  const [due, setDue] = useState("");
  const all = q.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const rows = all.filter((i) => (!status || i.display_status === status) && (!client || i.client_name === client) && (!project || i.project_name === project)
    && (!due || (due === "past" ? i.due_date < today : due === "week" ? i.due_date >= today && i.due_date <= in7 : due === "month" ? i.due_date >= today && i.due_date <= in30 : i.due_date > in30)));
  const total = rows.reduce((a, i) => a + i.outstanding_minor, 0);
  const overdue = rows.filter((i) => i.display_status === "overdue").reduce((a, i) => a + i.outstanding_minor, 0);
  const soon = rows.filter((i) => i.display_status === "due_soon").reduce((a, i) => a + i.outstanding_minor, 0);
  const uniq = (k: string) => [...new Set(all.map((i) => i[k]).filter(Boolean))].sort() as string[];
  const statuses = [...new Set(all.map((i) => i.display_status))] as string[];
  const late = (d: string) => Math.round((Date.parse(today) - Date.parse(d)) / 864e5);
  return (
    <>
      <PageHeader title="Pending payments" sub="Every invoice with money still to come in, oldest due date first." />
      <StatGrid cols={4}>
        <Stat label="Outstanding" value={money(total)} tone="amber" icon={<Wallet />} />
        <Stat label="Overdue" value={money(overdue)} tone={overdue ? "late" : undefined} icon={<AlertTriangle />} />
        <Stat label="Due soon" value={money(soon)} icon={<Hourglass />} />
        <Stat label="Invoices" value={rows.length} sub={rows.length !== all.length ? `of ${all.length}` : undefined} icon={<Receipt />} />
      </StatGrid>
      <DataTable rows={rows} loading={q.isLoading} rowKey={(i: any) => i.id} exportName="pending-payments" searchPlaceholder="Search invoice, client or project" empty="Nothing outstanding. Everything is paid."
        initialSort={{ key: "due", dir: "asc" }}
        filters={<>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Status"><option value="">Any status</option>{statuses.map((x) => <option key={x} value={x}>{x.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</option>)}</Select>
          <Select value={due} onChange={(e) => setDue(e.target.value)} className="w-44" aria-label="Due"><option value="">Any due date</option><option value="past">Past due</option><option value="week">Due in 7 days</option><option value="month">Due in 30 days</option><option value="later">Due later</option></Select>
          <Select value={client} onChange={(e) => setClient(e.target.value)} className="w-44" aria-label="Client"><option value="">All clients</option>{uniq("client_name").map((x) => <option key={x}>{x}</option>)}</Select>
          <Select value={project} onChange={(e) => setProject(e.target.value)} className="w-48" aria-label="Project"><option value="">All projects</option>{uniq("project_name").map((x) => <option key={x}>{x}</option>)}</Select>
        </>}
        columns={[
          { key: "n", header: "Invoice", cell: (i: any) => <div><Link to={`/invoices/${i.id}`} className="font-semibold hover:underline">{i.number}</Link><div className="text-[12px] text-[var(--muted)]">{i.project_name}</div></div>, sort: (i: any) => i.number, text: (i: any) => `${i.number} ${i.project_name}` },
          { key: "c", header: "Client", cell: (i: any) => i.client_name, sort: (i: any) => i.client_name, text: (i: any) => i.client_name },
          { key: "due", header: "Due", cell: (i: any) => <div><div>{fmtDate(i.due_date)}</div>{i.due_date < today && <div className="text-[12px] font-semibold text-[#b4441f]">{late(i.due_date)} {late(i.due_date) === 1 ? "day" : "days"} late</div>}</div>, sort: (i: any) => i.due_date, text: (i: any) => i.due_date },
          { key: "o", header: "Outstanding", cell: (i: any) => <b>{money(i.outstanding_minor)}</b>, align: "right", sort: (i: any) => i.outstanding_minor, text: (i: any) => String(i.outstanding_minor / 100) },
          { key: "s", header: "Status", cell: (i: any) => <Pill status={i.display_status} />, sort: (i: any) => i.display_status, text: (i: any) => i.display_status },
          { key: "x", header: "", cell: (i: any) => <Button size="sm" onClick={() => setPay(i)}>Record payment</Button> },
        ]} />
      {pay && <PaymentModal invoice={pay} onClose={() => setPay(null)} />}
    </>
  );
}

function PaymentModal({ invoice, onClose }: { invoice: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me, money } = useSession();
  const outstanding = invoice.total_minor - invoice.paid_minor;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: me!.settings.locale.timezone }).format(new Date());
  const [f, setF] = useState({ amountMinor: outstanding as number | null, receivedOn: today, method: "bank_transfer", reference: "" });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Record payment on ${invoice.number}`}>
      <p className="mb-4 text-sm text-[var(--muted)]">{money(outstanding)} is outstanding. Enter what the client paid. Less than the full amount makes the invoice Partially paid.</p>
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount received"><MoneyInput currency={invoice.currency} value={f.amountMinor} onChange={(m) => setF({ ...f, amountMinor: m })} /></Field>
          <Field label="Received on"><Input type="date" value={f.receivedOn} onChange={(e) => setF({ ...f, receivedOn: e.target.value })} /></Field>
          <Field label="Method"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="card">Card</option><option value="paypal">PayPal</option><option value="upwork">Upwork</option><option value="cash">Cash</option><option value="other">Other</option></Select></Field>
          <Field label="Reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        </div>
        <ErrorNote error={err} />
        <Button busy={busy} disabled={!f.amountMinor} onClick={async () => {
          setBusy(true); setErr(null);
          try { const r = await post(`/invoices/${invoice.id}/payments`, f); toast(`Payment recorded. ${invoice.number} is now ${r.status.replace("_", " ")}.`); qc.invalidateQueries(); onClose(); }
          catch (e) { setErr(e); } finally { setBusy(false); }
        }}>Save payment</Button>
      </div>
    </Modal>
  );
}

export function InvoiceDetail() {
  const { id } = useParams();
  const { can, money, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["invoice", id], queryFn: () => get(`/invoices/${id}`) });
  const [modal, setModal] = useState<null | "pay" | "refund" | "cancel" | "due">(null);
  const [err, setErr] = useState<unknown>(null);
  const [reason, setReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const nav = useNavigate();
  const [due, setDue] = useState("");
  if (q.isLoading || !q.data) return <Spinner />;
  const i = q.data;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: me!.settings.locale.timezone }).format(new Date());
  const open = ["unpaid", "partially_paid"].includes(i.status);
  const run = async (fn: () => Promise<any>, msg: string) => { setErr(null); try { await fn(); toast(msg); qc.invalidateQueries(); setModal(null); } catch (e) { setErr(e); } };

  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3">{i.number} <Pill status={i.display_status} /></span>} sub={<><Link to={`/projects/${i.project.id}`} className="underline">{i.project.name}</Link> · {i.client.name} · {i.kind}</>}
        actions={<>
          <Button variant="outline" onClick={() => openFile(`/invoices/${i.id}/pdf`)}>PDF</Button>
          {can("invoices.manage") && i.status !== "cancelled" && <Button variant="outline" onClick={() => run(() => post(`/invoices/${i.id}/send`), `Sent to ${i.client.email}`)} disabled={!i.client.email}>Email to client</Button>}
          {can("payments.record") && open && <Button onClick={() => setModal("pay")}>Record payment</Button>}
        </>} />
      <ErrorNote error={err} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-5">
          <Card title="Lines">
            <Table head={["Description", "Hours", "Amount"]}>
              {i.lines.map((l: any) => <tr key={l.id}><td>{l.description}</td><td className="tabnum">{l.minutes ? formatMinutes(l.minutes) : ""}</td><td className="tabnum text-right">{money(l.amount_minor)}</td></tr>)}
            </Table>
            <dl className="ml-auto mt-4 grid max-w-xs gap-1.5 tabnum">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(i.subtotal_minor)}</dd></div>
              {i.taxes.map((t: any) => <div key={t.id} className="flex justify-between"><dt>{t.name} {t.rate_bp / 100}%</dt><dd>{money(t.amount_minor)}</dd></div>)}
              <div className="flex justify-between border-t border-[var(--line)] pt-1.5 text-lg font-bold"><dt>Total</dt><dd>{money(i.total_minor)}</dd></div>
              <div className="flex justify-between text-[#23845f]"><dt>Paid</dt><dd>{money(i.paid_minor)}</dd></div>
              {open && <div className="flex justify-between font-semibold"><dt>Balance</dt><dd>{money(i.total_minor - i.paid_minor)}</dd></div>}
            </dl>
          </Card>
          <Card title="Payments">
            <Table head={["Date", "Amount", "Method", "Reference", "Recorded by", ""]} empty="No payments yet.">
              {i.payments.map((p: any) => (
                <tr key={p.id}><td>{p.received_on}</td><td className="tabnum">{money(p.amount_minor)}</td><td>{p.method.replace(/_/g, " ")}</td><td>{p.reference || "—"}</td><td>{p.recorded_by_name ?? "—"}</td>
                  <td className="text-right">{can("payments.record") && open && <Button size="sm" variant="ghost" onClick={() => run(() => del(`/payments/${p.id}`), "Payment removed")}><Trash2 className="size-4" /></Button>}</td></tr>
              ))}
            </Table>
            {i.refund && <p className="mt-3 rounded-lg bg-[#f0e6f7] p-3 text-sm text-[#4a1f5e]">Refunded {money(i.refund.amount_minor)} on {i.refund.refunded_on}. {i.refund.reason}</p>}
          </Card>
          {i.hours.length > 0 && (
            <Card title="Hours on this invoice">
              <Table head={["Person", "Hours"]}>{i.hours.map((h: any, n: number) => <tr key={n}><td>{h.user_name}</td><td className="tabnum">{formatMinutes(h.minutes)}</td></tr>)}</Table>
            </Card>
          )}
        </div>
        <div className="grid content-start gap-5">
          <Card title="Dates">
            <dl className="grid gap-2 text-[14.5px]">
              <div className="flex justify-between"><dt className="text-[var(--muted)]">Invoice date</dt><dd>{i.issue_date}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--muted)]">Due date</dt><dd className={i.due_date < today && open ? "font-bold text-[#b4441f]" : ""}>{i.due_date}</dd></div>
              {i.period_start && <div className="flex justify-between"><dt className="text-[var(--muted)]">Period</dt><dd>{i.period_start} to {i.period_end}</dd></div>}
            </dl>
            {can("invoices.manage") && open && <Button size="sm" variant="ghost" className="mt-2" onClick={() => { setDue(i.due_date); setModal("due"); }}>Change due date</Button>}
          </Card>
          <Card title="Bill to">
            <p className="font-semibold">{i.client.company || i.client.name}</p>
            <p className="whitespace-pre-wrap text-sm text-[var(--muted)]">{[i.client.company ? i.client.name : "", i.client.email, i.client.address, i.client.tax_id && `Tax ID ${i.client.tax_id}`].filter(Boolean).join("\n")}</p>
          </Card>
          {(i.status === "cancelled" || i.corrects_invoice_id || i.correctedBy) && (
            <Card title="Corrections">
              {i.status === "cancelled" && <p className="mb-2 text-sm"><b>Cancelled:</b> {i.cancel_reason || "no reason given"}</p>}
              {i.corrects_invoice_id && <p className="mb-2 text-sm">Corrects <Link className="font-semibold underline" to={`/invoices/${i.corrects_invoice_id}`}>{i.corrects_number ?? "the cancelled invoice"}</Link></p>}
              {i.correctedBy && <p className="mb-2 text-sm">Corrected by <Link className="font-semibold underline" to={`/invoices/${i.correctedBy.id}`}>{i.correctedBy.number}</Link></p>}
              {i.status === "cancelled" && !i.correctedBy && can("invoices.manage") && <CorrectButton invoice={i} onDone={(id) => nav(`/invoices/${id}`)} />}
            </Card>
          )}
          {(can("refunds.manage") || can("invoices.manage")) && !["refunded", "cancelled"].includes(i.status) && (
            <Card title="Refund or cancel">
              <p className="mb-3 text-sm text-[var(--muted)]">A refund always covers this whole invoice and marks its hours Refunded. Cancelling keeps the number and frees its hours to be invoiced again; only possible before any payment.</p>
              <div className="flex flex-wrap gap-2">
                {can("refunds.manage") && i.paid_minor > 0 && <Button variant="danger" size="sm" onClick={() => setModal("refund")}>Refund invoice</Button>}
                {can("invoices.manage") && i.paid_minor === 0 && <Button variant="outline" size="sm" onClick={() => setModal("cancel")}>Cancel invoice</Button>}
              </div>
            </Card>
          )}
        </div>
      </div>
      {modal === "pay" && <PaymentModal invoice={i} onClose={() => setModal(null)} />}
      <Modal open={modal === "refund"} onClose={() => setModal(null)} title={`Refund ${i.number}`}>
        <p className="mb-3">This refunds the {money(i.paid_minor)} received, and the invoice's hours show as Refunded in reports.</p>
        <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Button variant="danger" className="mt-4" onClick={() => run(() => post(`/invoices/${i.id}/refund`, { refundedOn: today, reason }), "Invoice refunded")}>Refund {money(i.paid_minor)}</Button>
      </Modal>
      <Modal open={modal === "cancel"} onClose={() => setModal(null)} title={`Cancel ${i.number}`}>
        <p className="mb-4">The invoice keeps its number and shows as Cancelled. Its billing lines and hours go back to be invoiced again, and you can issue a corrected invoice next.</p>
        <Field label="Why is it cancelled?"><Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Wrong hourly rate" /></Field>
        <Button variant="danger" className="mt-4" disabled={cancelReason.trim().length < 3} onClick={() => run(() => post(`/invoices/${i.id}/cancel`, { reason: cancelReason }), "Invoice cancelled")}>Cancel invoice</Button>
      </Modal>
      <Modal open={modal === "due"} onClose={() => setModal(null)} title="Change due date">
        <Field label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Button className="mt-4" onClick={() => run(() => put(`/invoices/${i.id}`, { dueDate: due }), "Due date changed")}>Save</Button>
      </Modal>
      <Card className="mt-5" title="Activity" sub="Everything done to this invoice: created, sent, paid, changed or cancelled."><ActivityLog entity="invoice" id={i.id} compact /></Card>
    </>
  );
}

export function NewInvoice() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { me, money } = useSession();
  const projects = useQuery({ queryKey: ["projects", "all"], queryFn: () => get<any[]>("/projects") });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: me!.settings.locale.timezone }).format(new Date());
  const [f, setF] = useState({ projectId: params.get("projectId") ?? "", issueDate: today, dueDays: "" as string, notes: "", initialPaymentMinor: null as number | null });
  const [lines, setLines] = useState([{ description: "", minutes: null as number | null, amountMinor: null as number | null }]);
  const [err, setErr] = useState<unknown>(null);
  const total = lines.reduce((a, l) => a + (l.amountMinor ?? 0), 0);
  return (
    <>
      <PageHeader title="New invoice" sub="For one-off charges. Project invoices are created on their own from the billing set-up." />
      <Card className="max-w-3xl">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Project" className="sm:col-span-3"><Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">Pick a project…</option>{(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.client_name})</option>)}</Select></Field>
          <Field label="Invoice date"><Input type="date" value={f.issueDate} onChange={(e) => setF({ ...f, issueDate: e.target.value })} /></Field>
          <Field label="Due days" hint="Blank = project or company default"><Input type="number" value={f.dueDays} onChange={(e) => setF({ ...f, dueDays: e.target.value })} /></Field>
          <Field label="Already received"><MoneyInput currency={me!.settings.locale.currency} value={f.initialPaymentMinor} onChange={(m) => setF({ ...f, initialPaymentMinor: m })} /></Field>
        </div>
        <div className="mt-5 grid gap-2">
          {lines.map((l, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_170px_auto]">
              <Input placeholder="Description" value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              <HoursInput placeholder="Hours" value={l.minutes} onChange={(m) => setLines(lines.map((x, j) => (j === i ? { ...x, minutes: m } : x)))} />
              <MoneyInput currency={me!.settings.locale.currency} placeholder="Amount" value={l.amountMinor} onChange={(m) => setLines(lines.map((x, j) => (j === i ? { ...x, amountMinor: m } : x)))} />
              <Button variant="ghost" size="sm" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setLines([...lines, { description: "", minutes: null, amountMinor: null }])}><Plus className="size-4" /> Add line</Button>
        </div>
        <Field label="Notes" hint="Printed on the invoice as written." className="mt-4"><Textarea plain value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <p className="mt-4 font-semibold tabnum">Subtotal {money(total)} · tax is added from your tax settings</p>
        <ErrorNote error={err} />
        <Button className="mt-4" disabled={!f.projectId || !total} onClick={async () => {
          try {
            const r = await post("/invoices", { projectId: f.projectId, issueDate: f.issueDate, dueDays: f.dueDays === "" ? undefined : Number(f.dueDays), notes: f.notes, initialPaymentMinor: f.initialPaymentMinor ?? 0, lines: lines.filter((l) => l.description && l.amountMinor).map((l) => ({ description: l.description, minutes: l.minutes ?? 0, amountMinor: l.amountMinor! })) });
            nav(`/invoices/${r.id}`);
          } catch (e) { setErr(e); }
        }}>Create invoice</Button>
      </Card>
    </>
  );
}

/** Issues a new invoice for the same work, linked to the cancelled one. Lines start as a copy and can be changed. */
function CorrectButton({ invoice, onDone }: { invoice: any; onDone: (id: string) => void }) {
  const { me } = useSession();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: me!.settings.locale.timezone }).format(new Date());
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState(invoice.lines.map((l: any) => ({ description: l.description, minutes: l.minutes, amountMinor: l.amount_minor as number | null })));
  const [err, setErr] = useState<unknown>(null);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Issue corrected invoice</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Correct ${invoice.number}`} wide>
        <p className="mb-3 text-sm text-[var(--muted)]">The new invoice gets a new number and is linked to {invoice.number}. Tax is worked out again.</p>
        <div className="grid gap-2">
          {lines.map((l: any, n: number) => (
            <div key={n} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_170px]">
              <Input value={l.description} onChange={(e) => setLines(lines.map((x: any, j: number) => (j === n ? { ...x, description: e.target.value } : x)))} />
              <HoursInput value={l.minutes} onChange={(m) => setLines(lines.map((x: any, j: number) => (j === n ? { ...x, minutes: m ?? 0 } : x)))} />
              <MoneyInput currency={invoice.currency} value={l.amountMinor} onChange={(m) => setLines(lines.map((x: any, j: number) => (j === n ? { ...x, amountMinor: m } : x)))} />
            </div>
          ))}
        </div>
        <ErrorNote error={err} />
        <Button className="mt-4" onClick={async () => { setErr(null); try { const r = await post(`/invoices/${invoice.id}/correct`, { issueDate: today, lines: lines.map((l: any) => ({ ...l, amountMinor: l.amountMinor ?? 0 })) }); onDone(r.id); setOpen(false); } catch (e) { setErr(e); } }}>Create corrected invoice</Button>
      </Modal>
    </>
  );
}
