import { InvoiceScheduleFields, emptySchedule, scheduleBody, type ScheduleValue } from "../components/InvoiceSchedule";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { FIXED_OPTION_INFO, formatMinutes, type ProjectInput } from "@eszy/shared";
import { get, post } from "../lib/api";
import { AccountPicker, ChannelPicker, SourcePicker } from "../components/Masters";
import { useSession } from "../lib/session";
import { Button, Card, Checkbox, Combobox, ErrorNote, Field, HoursInput, Input, MoneyInput, MultiSelect, PageHeader, Select, Textarea, cx, useToast } from "../components/ui";
import { userOpts } from "../lib/hooks";

const INFO = {
  hourly: "The client pays for the hours worked, at an hourly rate.",
  fixed: "The client pays an agreed price for the whole job, however long it takes.",
  prepaid: "The client pays for a block of hours before the work. The invoice goes out on the billing date.",
  postpaid: "The client pays after the work. eszy invoices the approved hours at the end of each billing period.",
  one_time: "One invoice for the agreed hours (prepaid) or when the project ends (postpaid).",
  recurring: "A new invoice every week or month, for as long as the project is active.",
  billingCap: "Most hours the team can log in each week or month. Past it, new hours are blocked.",
  projectCap: "The project cap is the total hours of all billing lines. Past it, new hours are blocked until the Billing Manager adds hours.",
  dueDays: "Days the client has to pay. Due date = invoice date + due days.",
  dueSoon: "How many days before the due date the invoice shows as Due soon. Leave blank to use the company setting.",
  initial: "Money the client already paid. The first invoice starts as Partially paid or Paid.",
};

type Line = { label: string; minutes: number | null; amountMinor: number | null; dueDate: string };

function Choice({ value, current, onPick, title, info }: { value: string; current: string; onPick: (v: string) => void; title: string; info: string }) {
  const on = value === current;
  return (
    <button type="button" onClick={() => onPick(value)} aria-pressed={on}
      className={cx("rounded-xl border-2 p-4 text-left transition", on ? "border-[var(--brand)] bg-[var(--brand)]/5 dark:border-[var(--accent)]" : "border-[var(--line)] hover:border-[var(--muted)]")}>
      <div className="font-bold">{title}</div><div className="mt-1 text-[13.5px] text-[var(--muted)]">{info}</div>
    </button>
  );
}

export function NewProject() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { me, has, can, money } = useSession();
  const cur = me!.settings.locale.currency;
  const billing = has("projects_billing") && can("projects.billing", "projects.manage");
  const clients = useQuery({ queryKey: ["clients"], queryFn: () => get<any[]>("/clients") });
  const users = useQuery({ queryKey: ["users"], queryFn: () => get<any[]>("/users") });

  const [f, setF] = useState({
    clientId: params.get("clientId") ?? "", name: "", code: "", type: "hourly", billingType: "prepaid", invoicing: "recurring", fixedOption: "one_time",
    priceMinor: null as number | null, hourlyRateMinor: null as number | null, estimatedMinutes: null as number | null,
    installmentCount: 3, installmentInterval: "month", advancePercent: 50, advanceMinor: null as number | null, deliveryDate: "",
    billingCapMinutes: null as number | null, billingPeriod: "week", billingDate: "", dueDays: 7 as number | null, dueSoonDays: null as number | null, dueSoonClientEmail: null as boolean | null,
    pmIds: [] as string[], startDate: "", memberIds: [] as string[], initialPaymentMinor: null as number | null,
    sourceId: "", accountId: "", communicationTypeIds: [] as string[], allowOfflineHours: true, description: "",
    tlIds: [] as string[], salesUserId: params.get("salesUserId") ?? (null as string | null), estimatorUserId: null as string | null, callerUserId: null as string | null,
    tags: "", isInternal: false,
  });
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  // The invoice day: weekly cycles ask for a weekday, monthly ones for a date of the month.
  const [schedule, setSchedule] = useState<ScheduleValue>(() => ({ ...emptySchedule(), frequency: "week" }));
  const [inst, setInst] = useState<ScheduleValue>(() => ({ ...emptySchedule(), frequency: "month" }));
  const hourly = f.type === "hourly";
  const needsLines = (hourly && f.billingType === "prepaid") || (!hourly && f.fixedOption === "milestones");
  const linesTotal = lines.reduce((a, l) => ({ m: a.m + (l.minutes ?? 0), a: a.a + (l.amountMinor ?? 0) }), { m: 0, a: 0 });

  const submit = async () => {
    setBusy(true); setErr(null);
    const body: Partial<ProjectInput> & Record<string, unknown> = {
      clientId: f.clientId, name: f.name, code: f.code, type: f.type as any,
      billingType: hourly ? (f.billingType as any) : null, invoicing: f.invoicing as any, fixedOption: hourly ? null : (f.fixedOption as any),
      priceMinor: hourly ? null : f.priceMinor, hourlyRateMinor: hourly ? (billing ? f.hourlyRateMinor : 0) : null, estimatedMinutes: hourly ? null : f.estimatedMinutes,
      installmentCount: f.fixedOption === "installments" ? f.installmentCount : null, installmentInterval: f.fixedOption === "installments" ? (inst.frequency || "month") as any : null,
      ...(f.fixedOption === "installments" && inst.frequency ? { installmentWeekday: ["week", "two_weeks"].includes(inst.frequency) ? inst.weekday : null, installmentMonthDay: ["week", "two_weeks"].includes(inst.frequency) ? null : inst.monthDay, installmentStartsOn: inst.startsOn || null } : {}),
      advancePercent: f.fixedOption === "advance_balance" && f.advanceMinor == null ? f.advancePercent : null,
      advanceMinor: f.fixedOption === "advance_balance" ? f.advanceMinor ?? (f.priceMinor ? Math.round((f.priceMinor * f.advancePercent) / 100) : null) : null, deliveryDate: f.deliveryDate || null,
      billingCapMinutes: f.billingCapMinutes, billingPeriod: f.billingCapMinutes || f.invoicing === "recurring" ? (f.billingPeriod as any) : null,
      billingDate: hourly && f.billingType === "prepaid" ? f.billingDate || null : null, dueDays: f.dueDays, dueSoonDays: f.dueSoonDays, dueSoonClientEmail: f.dueSoonClientEmail,
      pmUserId: f.pmIds[0] ?? null, pmIds: f.pmIds, startDate: f.startDate || null, memberIds: f.memberIds,
      leadId: params.get("leadId") || null, salesUserId: f.salesUserId || null, estimatorUserId: f.estimatorUserId, callerUserId: f.callerUserId,
      tlIds: f.tlIds, isInternal: f.isInternal, tags: f.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
      billingLines: lines.filter((l) => l.label && l.minutes != null).map((l) => ({ label: l.label, minutes: l.minutes!, amountMinor: l.amountMinor ?? 0, dueDate: l.dueDate || null })),
      initialPaymentMinor: f.initialPaymentMinor ?? 0,
      ...(hourly && f.invoicing === "recurring" && schedule.frequency ? { ...scheduleBody({ ...schedule, startsOn: schedule.startsOn || f.startDate || "" }) } : {}),
      sourceId: f.sourceId || null, accountId: f.accountId || null, communicationTypeIds: f.communicationTypeIds, allowOfflineHours: f.allowOfflineHours, description: f.description,
    };
    try {
      const r = await post("/projects", body);
      toast(r.invoices?.length ? `Project created with ${r.invoices.length} invoice(s)` : "Project created");
      nav(`/projects/${r.project.id}`);
    } catch (e) { setErr(e); window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader back={{ to: "/projects", label: "Projects" }} title="New project" sub={params.get("leadId") ? "Onboarding a converted lead." : "Set up the work and how the client pays for it."} />
      <div className="grid max-w-4xl gap-5">
        <Card title="Basics">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client" required hint="Source, account and channels are copied from the client; change them if this project differs."><Combobox value={f.clientId || null} onChange={(x) => {
              const c = (clients.data ?? []).find((y) => y.id === x);
              set({ clientId: x ?? "", ...(c ? { sourceId: f.sourceId || c.source_id || "", accountId: f.accountId || c.account_id || "", communicationTypeIds: f.communicationTypeIds.length ? f.communicationTypeIds : c.communication_type_ids ?? [] } : {}) });
            }} options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name, sub: c.company }))} placeholder="Search clients" /></Field>
            <Field label="Project name"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Code (optional)"><Input value={f.code} onChange={(e) => set({ code: e.target.value })} /></Field>
            <Field label="Start date"><Input type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
{can("projects.assign") ? (<>
            <Field label="Project Managers" info="The first one is the main PM."><MultiSelect value={f.pmIds} onChange={(x) => set({ pmIds: x, tlIds: f.tlIds.filter((t) => !x.includes(t)), memberIds: f.memberIds.filter((t) => !x.includes(t)) })} options={userOpts(users.data)} placeholder="Add a Project Manager" /></Field>
            <Field label="Team Leads" info="They assign members and approve sheets for this project."><MultiSelect value={f.tlIds} onChange={(x) => set({ tlIds: x, memberIds: f.memberIds.filter((t) => !x.includes(t)) })} options={userOpts(users.data).filter((o) => !f.pmIds.includes(o.value))} placeholder="Add a Team Lead" /></Field>
            </>) : <p className="text-[13px] text-[var(--muted)] sm:col-span-2">Admin, Billing Manager or Sales assign the Project Managers and Team Leads after the project is created.</p>}
            <Field label="Sales person"><Combobox value={f.salesUserId} onChange={(x) => set({ salesUserId: x })} options={userOpts(users.data)} /></Field>
            <Field label="Estimated by"><Combobox value={f.estimatorUserId} onChange={(x) => set({ estimatorUserId: x })} options={userOpts(users.data)} /></Field>
            <Field label="Call person"><Combobox value={f.callerUserId} onChange={(x) => set({ callerUserId: x })} options={userOpts(users.data)} /></Field>
            <Field label="Tags" hint="Separate with commas, e.g. shopify, mobile"><Input value={f.tags} onChange={(e) => set({ tags: e.target.value })} /></Field>
            <Field label="Source"><SourcePicker value={f.sourceId || null} onChange={(x) => set({ sourceId: x ?? "", accountId: "" })} /></Field>
            <Field label="Account" hint="e.g. the Upwork profile"><AccountPicker value={f.accountId || null} sourceId={f.sourceId || null} onChange={(x) => set({ accountId: x ?? "" })} /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Checkbox label="Internal project" hint="The company's own work (training, hiring, meetings). Hours count as in-house and are never invoiced." checked={f.isInternal} onChange={(v) => set({ isInternal: v, ...(v ? { type: "hourly", billingType: "postpaid", hourlyRateMinor: 0 } : {}) })} /></div>
          </div>
          <div className="mt-4">
            <Field label="Communication channels" hint="Pick as many as apply, or type a new one and press Enter."><ChannelPicker value={f.communicationTypeIds} onChange={(x) => set({ communicationTypeIds: x })} /></Field>
            <div className="mt-3"><Checkbox label="Allow offline hours" hint="Hours worked but not tracked in the client's tracker, with a reason" checked={f.allowOfflineHours} onChange={(v) => set({ allowOfflineHours: v })} /></div>
          </div>
          <div className="mt-4">
            <Field label="Team members" hint="You can also leave this to the Team Leads; they assign members from Project assignments."><MultiSelect value={f.memberIds} onChange={(x) => set({ memberIds: x })} options={userOpts(users.data).filter((o) => !f.pmIds.includes(o.value) && !f.tlIds.includes(o.value))} placeholder="Search and add people" /></Field>
          </div>
        </Card>

        {billing && (
          <>
            <Card title="How the client pays">
              <div className="grid gap-3 sm:grid-cols-2">
                <Choice value="hourly" current={f.type} onPick={(v) => set({ type: v })} title="Hourly" info={INFO.hourly} />
                <Choice value="fixed" current={f.type} onPick={(v) => set({ type: v })} title="Fixed price" info={INFO.fixed} />
              </div>
              {hourly ? (
                <>
                  <div className="mt-5 mb-2 text-sm font-semibold">Billing type</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Choice value="prepaid" current={f.billingType} onPick={(v) => set({ billingType: v })} title="Prepaid" info={INFO.prepaid} />
                    <Choice value="postpaid" current={f.billingType} onPick={(v) => set({ billingType: v })} title="Postpaid" info={INFO.postpaid} />
                  </div>
                  <div className="mt-5 mb-2 text-sm font-semibold">Invoicing</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Choice value="one_time" current={f.invoicing} onPick={(v) => set({ invoicing: v })} title="One-time" info={INFO.one_time} />
                    <Choice value="recurring" current={f.invoicing} onPick={(v) => set({ invoicing: v })} title="Recurring" info={INFO.recurring} />
                  </div>
                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    <Field label="Hourly rate"><MoneyInput currency={cur} value={f.hourlyRateMinor} onChange={(m) => set({ hourlyRateMinor: m })} /></Field>
                    <Field label="Billing cap" info={INFO.billingCap}><HoursInput value={f.billingCapMinutes} onChange={(m) => set({ billingCapMinutes: m })} placeholder="e.g. 40" /></Field>
                    <Field label="Billing cycle" info="The billing cap and recurring invoices follow this."><Select value={f.billingPeriod} onChange={(e) => { set({ billingPeriod: e.target.value }); setSchedule((x) => ({ ...x, frequency: e.target.value as any })); }}><option value="week">Weekly</option><option value="month">Monthly</option></Select></Field>
                    {f.billingType === "prepaid" && f.invoicing !== "recurring" && <Field label="Billing date" hint="When the first invoice goes out. Blank = start date."><Input type="date" value={f.billingDate} onChange={(e) => set({ billingDate: e.target.value })} /></Field>}
                  </div>
                  {f.invoicing === "recurring" ? (
                    <div className="mt-5 rounded-2xl border border-[var(--line)] p-4">
                      <div className="mb-3"><h3 className="text-[14.5px] font-bold">When invoices are created</h3><p className="text-[12.5px] text-[var(--muted)]">{f.billingPeriod === "week" ? "Pick the day of the week" : "Pick the date of the month"} the invoice is created each {f.billingPeriod === "week" ? "week" : "month"}. You can also invoice every 2 weeks, 3 months and so on.</p></div>
                      <InvoiceScheduleFields value={schedule} onChange={setSchedule} capPeriod={f.billingPeriod as any} prepaid={f.billingType === "prepaid"} allowOff={false} />
                    </div>
                  ) : <p className="mt-4 rounded-xl bg-[var(--bg)] p-3 text-[13px] text-[var(--muted)]">{f.billingType === "prepaid" ? "One invoice on the billing date for the hours bought." : "One invoice for all approved hours when the project ends."} Pick Recurring to invoice every week or month on a set day.</p>}
                </>
              ) : (
                <>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Field label="Fixed price"><MoneyInput currency={cur} value={f.priceMinor} onChange={(m) => set({ priceMinor: m })} /></Field>
                    <Field label="Estimated hours" info={INFO.projectCap}><HoursInput value={f.estimatedMinutes} onChange={(m) => set({ estimatedMinutes: m })} /></Field>
                  </div>
                  <div className="mt-5 mb-2 text-sm font-semibold">Payment plan</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(FIXED_OPTION_INFO).map(([k, v]) => <Choice key={k} value={k} current={f.fixedOption} onPick={(x) => set({ fixedOption: x })} title={v.label} info={v.info} />)}
                  </div>
                  {f.fixedOption === "installments" && (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Field label="Number of installments"><Input type="number" min={2} max={120} value={f.installmentCount} onChange={(e) => set({ installmentCount: Number(e.target.value) })} /></Field>
                      <div className="sm:col-span-2">
                        <InvoiceScheduleFields value={inst} onChange={setInst} allowOff={false} label="Invoice an installment" startLabel="First installment from"
                          note={f.priceMinor ? `${f.installmentCount} invoices of about ${money(Math.floor(f.priceMinor / f.installmentCount))}, on the dates above and after.` : "Each installment is invoiced on these dates."} />
                      </div>
                    </div>
                  )}
                  {f.fixedOption === "advance_balance" && (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Field label="Advance amount" hint={f.priceMinor ? (() => { const adv = f.advanceMinor ?? Math.round((f.priceMinor * f.advancePercent) / 100); return `${Math.round((adv / f.priceMinor) * 1000) / 10}% of the price · balance ${money(f.priceMinor - adv)}`; })() : "Enter the fixed price first"}>
                        <MoneyInput currency={cur} value={f.advanceMinor ?? (f.priceMinor ? Math.round((f.priceMinor * f.advancePercent) / 100) : null)} onChange={(m) => set({ advanceMinor: m })} />
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {[25, 30, 40, 50, 60].map((pc) => {
                            const on = f.priceMinor ? (f.advanceMinor ?? Math.round((f.priceMinor * f.advancePercent) / 100)) === Math.round((f.priceMinor * pc) / 100) : f.advancePercent === pc;
                            return <button key={pc} type="button" onClick={() => set({ advancePercent: pc, advanceMinor: f.priceMinor ? Math.round((f.priceMinor * pc) / 100) : null })}
                              className={cx("rounded-lg px-2.5 py-1 text-[12.5px] font-semibold ring-1 transition", on ? "bg-[var(--brand-soft)] text-[var(--brand)] ring-[var(--brand-2)]/50 dark:text-white" : "text-[var(--muted)] ring-[var(--line)] hover:text-[var(--text)]")}>{pc}%</button>;
                          })}
                        </div>
                      </Field>
                      <Field label="Delivery date" hint="The balance is invoiced on this date"><Input type="date" value={f.deliveryDate} onChange={(e) => set({ deliveryDate: e.target.value })} /></Field>
                    </div>
                  )}
                </>
              )}
            </Card>

            {(needsLines || (hourly && f.billingType === "postpaid")) && (
              <Card title={!hourly ? "Milestones" : f.billingType === "prepaid" ? "Billing lines (prepaid blocks)" : "Hour budget (optional)"}
                actions={<Button variant="outline" size="sm" onClick={() => setLines([...lines, { label: "", minutes: null, amountMinor: null, dueDate: "" }])}><Plus className="size-4" /> Add line</Button>}>
                <p className="mb-3 text-sm text-[var(--muted)]">{INFO.projectCap}{hourly && f.billingType === "prepaid" && !lines.length ? " With no lines, eszy uses the billing cap × rate as the first block." : ""}</p>
                <div className="grid gap-2">
                  {lines.map((l, i) => (
                    <div key={i} className="grid gap-2 sm:grid-cols-[1.4fr_110px_160px_160px_auto]">
                      <Input placeholder="e.g. First 100 hours" value={l.label} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                      <HoursInput placeholder="Hours" value={l.minutes} onChange={(m) => setLines(lines.map((x, j) => (j === i ? { ...x, minutes: m } : x)))} />
                      <MoneyInput currency={cur} placeholder="Amount" value={l.amountMinor} onChange={(m) => setLines(lines.map((x, j) => (j === i ? { ...x, amountMinor: m } : x)))} />
                      <Input type="date" aria-label="Date" value={l.dueDate} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
                      <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                    </div>
                  ))}
                </div>
                {lines.length > 0 && <p className="mt-3 text-sm font-semibold tabnum">Project cap: {formatMinutes(linesTotal.m)} · {money(linesTotal.a)}</p>}
              </Card>
            )}

            <Card title="Due dates and money received">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Due days" info={INFO.dueDays}><Input type="number" min={0} value={f.dueDays ?? ""} onChange={(e) => set({ dueDays: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
                <Field label="Due soon (days before)" info={INFO.dueSoon}><Input type="number" min={0} placeholder={`Company: ${me!.settings.invoices.dueSoonDays}`} value={f.dueSoonDays ?? ""} onChange={(e) => set({ dueSoonDays: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
                <Field label="Already received" info={INFO.initial}><MoneyInput currency={cur} value={f.initialPaymentMinor} onChange={(m) => set({ initialPaymentMinor: m })} /></Field>
              </div>
              <div className="mt-4"><Checkbox label="Email the client a reminder when an invoice is due soon" hint="Leave unticked to use the company setting" checked={!!f.dueSoonClientEmail} onChange={(v) => set({ dueSoonClientEmail: v ? true : null })} /></div>
            </Card>
          </>
        )}
        <ErrorNote error={err} />
        <div><Button busy={busy} onClick={submit} disabled={!f.clientId || !f.name}>Create project</Button></div>
      </div>
    </>
  );
}
