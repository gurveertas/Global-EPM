import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Laptop, Plus, Wrench } from "lucide-react";
import { formatMinutes } from "@eszy/shared";
import { del, get, post, put, qs } from "../lib/api";
import { useSession } from "../lib/session";
import { useAction, useTeams, useUsers, userOpts } from "../lib/hooks";
import { Avatar } from "../components/Avatar";
import { CATS } from "../components/Charts";
import {
  Button, Card, Combobox, DataTable, Empty, ErrorNote, Field, Input, Modal, MoneyInput, PageHeader, Pill, Segmented, Select, Spinner, Stat, StatGrid, Tabs, Textarea, cx, fmtDate, fmtDateTime, useToast,
  Pager, usePaged, Drawer, DetailList, RichText, plainText } from "../components/ui";
import { motion } from "../components/magic";

const todayIso = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

// ------------------------------------------------------------------------------------------------ standup
export function StandupPage() {
  const { me, can } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "mine";
  const lead = can("time.approve_team") || can("time.approve_all") || can("standup.view_all");
  return (
    <>
      <PageHeader title="Standup" sub="Yesterday, today and what's in your way. Blockers go straight to your TL. Team Leads also get a morning report built from yesterday's sheets." />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ id: "mine", label: "Daily standup" }, { id: "report", label: "Morning report", hide: !lead }]} />
      {tab === "mine" ? <Standups /> : <MorningReport />}
      {void me}
    </>
  );
}

function Standups() {
  const { me, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState(todayIso(me!.settings.locale.timezone));
  const [scope, setScope] = useState<"team" | "all">("team");
  const q = useQuery({ queryKey: ["standups", date, scope], queryFn: () => get(`/standups${qs({ date, scope })}`) });
  const mine = q.data?.people?.find((p: any) => p.user_id === me!.user.id);
  const [f, setF] = useState<any>(null);
  const v = f ?? { yesterday: mine?.yesterday ?? "", today: mine?.today ?? "", blockers: mine?.blockers ?? "" };
  const [err, setErr] = useState<unknown>(null);
  const others = (q.data?.people ?? []).filter((p: any) => p.user_id !== me!.user.id);
  return (
    <div className="grid gap-5 xl:grid-cols-[400px_1fr]">
      <Card title="Your standup" actions={<Input type="date" value={date} max={todayIso(me!.settings.locale.timezone)} onChange={(e) => { setDate(e.target.value); setF(null); }} className="h-8 w-40" />}>
        <div className="grid gap-3">
          <Field label="Yesterday"><Textarea value={v.yesterday} onChange={(e) => setF({ ...v, yesterday: e.target.value })} placeholder="What you finished" /></Field>
          <Field label="Today"><Textarea value={v.today} onChange={(e) => setF({ ...v, today: e.target.value })} placeholder="What you'll work on" /></Field>
          <Field label="Blockers" hint="Leave empty if nothing is in your way"><Textarea value={v.blockers} onChange={(e) => setF({ ...v, blockers: e.target.value })} className="min-h-16" /></Field>
          <ErrorNote error={err} />
          <Button onClick={async () => { setErr(null); try { await put("/standups", { date, ...v }); setF(null); toast("Standup saved"); qc.invalidateQueries({ queryKey: ["standups"] }); } catch (e) { setErr(e); } }}>Save standup</Button>
        </div>
      </Card>
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          {can("standup.view_all") ? <Segmented value={scope} onChange={setScope} options={[{ id: "team", label: "My team" }, { id: "all", label: "Everyone" }]} /> : <span className="text-[14px] font-semibold">My team</span>}
          <span className="text-[13px] text-[var(--muted)]">{others.filter((p: any) => p.id).length} of {others.length} written · {others.filter((p: any) => p.blockers).length} blocked</span>
        </div>
        {q.isLoading ? <Spinner /> : !others.length ? <Empty title="No one else in your team yet" /> : (
          <div className="grid gap-3">
            {others.map((p: any) => (
              <Card key={p.user_id} className="p-4">
                <div className="mb-2 flex items-center gap-3"><Avatar id={p.user_id} name={p.name} />
                  <div><b>{p.name}</b><div className="text-[12.5px] text-[var(--muted)]">{p.team ?? "No team"}{p.updated_at && ` · ${fmtDateTime(p.updated_at)}`}</div></div>
                  <span className="ml-auto">{!p.id ? <Pill status="none">Not written</Pill> : p.blockers ? <Pill status="high">Blocked</Pill> : null}</span></div>
                {p.id && (
                  <dl className="grid gap-3 text-[14px] sm:grid-cols-3">
                    <div><dt className="text-[12.5px] font-semibold text-[var(--muted)]">Yesterday</dt><dd className="mt-0.5">{p.yesterday ? <RichText text={p.yesterday} /> : "—"}</dd></div>
                    <div><dt className="text-[12.5px] font-semibold text-[var(--muted)]">Today</dt><dd className="mt-0.5">{p.today ? <RichText text={p.today} /> : "—"}</dd></div>
                    <div><dt className="text-[12.5px] font-semibold text-[var(--muted)]">Blockers</dt><dd className={cx("mt-0.5", p.blockers && "font-semibold text-[#9c3a19]")}>{p.blockers ? <RichText text={p.blockers} /> : "None"}</dd></div>
                  </dl>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** "Good morning to all": yesterday's work per person, grouped into billable, in-house and other, ready to paste into Slack or email. */
function MorningReport() {
  const toast = useToast();
  const teams = useTeams();
  const [date, setDate] = useState("");
  const [team, setTeam] = useState("");
  const q = useQuery({ queryKey: ["morning", date, team], queryFn: () => get(`/reporting/standup${qs({ date, teamId: team })}`) });
  const people = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of q.data?.rows ?? []) {
      const p = m.get(r.user_id) ?? { user_id: r.user_id, name: r.name, team: r.team_name, billable: [], inhouse: [], no_work: [], total: 0 };
      p[r.category].push(r); p.total += r.minutes; m.set(r.user_id, p);
    }
    return [...m.values()];
  }, [q.data]);
  const peoplePg = usePaged(people, 12);
  const plan = (uid: string) => q.data?.plans.find((x: any) => x.user_id === uid);
  const text = () => {
    const lines = [`Good morning to all,`, ``, `Work report for ${fmtDate(q.data.date, { weekday: "long", day: "numeric", month: "long" })}:`, ``];
    for (const p of people) {
      lines.push(`${p.name} (${formatMinutes(p.total)})`);
      for (const c of CATS) for (const r of p[c.key]) lines.push(`  • [${c.label}] ${r.project_name}${r.activity ? `, ${r.activity}` : ""}: ${formatMinutes(r.minutes)}${r.notes ? ` (${plainText(r.notes)})` : ""}`);
      const pl = plan(p.user_id);
      if (pl?.today) lines.push(`  Today: ${pl.today}`);
      if (pl?.blockers) lines.push(`  Blocked: ${pl.blockers}`);
      lines.push("");
    }
    return lines.join("\n");
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input type="date" value={date || q.data?.date || ""} onChange={(e) => setDate(e.target.value)} className="w-44" aria-label="Day" />
        <Select value={team} onChange={(e) => setTeam(e.target.value)} className="w-44" aria-label="Team"><option value="">All my people</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        {q.data && people.length > 0 && <Button variant="secondary" size="sm" onClick={async () => { await navigator.clipboard.writeText(text()); toast("Report copied"); }}><Copy />Copy report</Button>}
      </div>
      {q.isLoading || !q.data ? <Spinner /> : !people.length ? <Empty title="No sheets submitted for that day">The report fills in once people submit their sheets.</Empty> : (
        <>
          <StatGrid cols={4}>
            <Stat label="People reporting" value={people.length} />
            {CATS.map((c) => <Stat key={c.key} label={c.label} value={formatMinutes(people.reduce((a, p) => a + p[c.key].reduce((x: number, r: any) => x + r.minutes, 0), 0))} />)}
          </StatGrid>
          <div className="grid gap-4 lg:grid-cols-2">
            {peoplePg.rows.map((p) => (
              <Card key={p.user_id} title={p.name} sub={`${p.team ?? "No team"} · ${formatMinutes(p.total)}`}>
                <div className="grid gap-3">
                  {CATS.map((c) => p[c.key].length > 0 && (
                    <div key={c.key} className={cx("rounded-lg border-l-4 bg-[var(--bg)] p-3")} style={{ borderLeftColor: c.color }}>
                      <div className="mb-1 text-[12.5px] font-bold">{c.key === "no_work" ? "Others / no work / R&D" : c.label}</div>
                      <ul className="grid gap-1 text-[13.5px]">{p[c.key].map((r: any, i: number) => <li key={i} className="flex justify-between gap-3"><span><b>{r.project_name}</b>{r.activity && <span className="text-[var(--muted)]">, {r.activity}</span>}{r.notes && <span className="block text-[12.5px] text-[var(--muted)]">{plainText(r.notes)}</span>}</span><span className="shrink-0 tabnum">{formatMinutes(r.minutes)}</span></li>)}</ul>
                    </div>
                  ))}
                  {plan(p.user_id)?.today && <p className="text-[13.5px]"><b>Today:</b> {plan(p.user_id).today}</p>}
                  {plan(p.user_id)?.blockers && <p className="text-[13.5px] font-semibold text-[#9c3a19]">Blocked: {plan(p.user_id).blockers}</p>}
                </div>
              </Card>
            ))}
          </div>
          <Pager {...peoplePg} noun="people" />
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ accessories
export function AccessoriesPage() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const manage = can("assets.manage");
  const tab = params.get("tab") ?? (manage ? "inventory" : "mine");
  const req = useQuery({ queryKey: ["asset-requests"], queryFn: () => get<any[]>("/asset-requests") });
  return (
    <>
      <PageHeader title="Accessories" sub={manage ? "Company laptops, phones and other items: who has them, their condition and warranty, and requests from the team." : "Items assigned to you. Ask for something new or report a problem here."} />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { id: "inventory", label: "All items", hide: !manage }, { id: "vendors", label: "Vendors", hide: !manage }, { id: "mine", label: "My accessories" },
        { id: "requests", label: manage ? "Requests and issues" : "My requests", count: (req.data ?? []).filter((r) => ["open", "in_progress"].includes(r.status)).length },
      ]} />
      {tab === "inventory" && <Inventory />}
      {tab === "vendors" && manage && <Vendors />}
      {tab === "mine" && <Mine />}
      {tab === "requests" && <Requests rows={req.data} loading={req.isLoading} onChange={() => req.refetch()} />}
    </>
  );
}

function Inventory() {
  const { can, money, me } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["assets"], queryFn: () => get<any[]>("/assets") });
  const users = useUsers();
  const act = useAction();
  const [edit, setEdit] = useState<any>(null);
  const [assign, setAssign] = useState<any>(null);
  const [ret, setRet] = useState<any>(null);
  const [history, setHistory] = useState<any>(null);
  const [cat, setCat] = useState("");
  const [state, setState] = useState("");
  const hist = useQuery({ queryKey: ["asset-history", history?.id], queryFn: () => get<any[]>(`/assets/${history.id}/history`), enabled: !!history });
  const all = q.data ?? [];
  const cats = [...new Set(all.map((a) => a.category).filter(Boolean))].sort();
  const today = new Date().toISOString().slice(0, 10);
  const rows = all.filter((a) => (!cat || a.category === cat) && (!state || (state === "stock" ? !a.assigned_to && a.condition !== "retired" : state === "assigned" ? !!a.assigned_to : state === "warranty" ? a.warranty_ends_on && a.warranty_ends_on < today : a.condition === state)));
  const refresh = () => qc.invalidateQueries({ queryKey: ["assets"] });
  const vendors = useQuery({ queryKey: ["vendors"], queryFn: () => get<any[]>("/vendors") });
  const blank = { name: "", category: "", brand: "", vendor: "", vendorId: null, serialNumber: "", purchasedOn: "", warrantyMonths: null, costMinor: null, condition: "new", notes: "" };
  return (
    <>
      <StatGrid cols={4}>
        <Stat label="Items" value={all.length} onClick={() => setState("")} active={!state} />
        <Stat label="Assigned" value={all.filter((a) => a.assigned_to).length} onClick={() => setState("assigned")} active={state === "assigned"} />
        <Stat label="In stock" value={all.filter((a) => !a.assigned_to && a.condition !== "retired").length} tone="paid" onClick={() => setState("stock")} active={state === "stock"} />
        <Stat label="Out of warranty or damaged" value={all.filter((a) => (a.warranty_ends_on && a.warranty_ends_on < today) || a.condition === "damaged").length} tone="amber" onClick={() => setState("warranty")} active={state === "warranty"} />
      </StatGrid>
      <ErrorNote error={act.err} />
      <DataTable rows={rows} loading={q.isLoading} rowKey={(a) => a.id} exportName="accessories" searchPlaceholder="Search by item, brand, vendor, serial or person"
        filters={<>
          <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-40" aria-label="Category"><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</Select>
          <Select value={state} onChange={(e) => setState(e.target.value)} className="w-40" aria-label="State"><option value="">Any state</option><option value="assigned">Assigned</option><option value="stock">In stock</option><option value="damaged">Damaged</option><option value="retired">Retired</option><option value="warranty">Out of warranty</option></Select>
        </>}
        actions={<Button size="sm" onClick={() => setEdit(blank)}><Plus />Add item</Button>}
        columns={[
          { key: "n", header: "Item", cell: (a) => <><span className="font-semibold">{a.name}</span><div className="text-[12.5px] text-[var(--muted)]">{[a.brand, a.category].filter(Boolean).join(" · ") || "—"}</div></>, sort: (a) => a.name, text: (a) => `${a.name} ${a.brand} ${a.category} ${a.vendor}` },
          { key: "s", header: "Serial", cell: (a) => <span className="text-[13px]">{a.serial_number || "—"}</span>, text: (a) => a.serial_number },
          { key: "v", header: "Vendor and purchase", cell: (a) => <span className="text-[13px]">{a.vendor || "—"}<div className="text-[var(--muted)]">{fmtDate(a.purchased_on)}</div></span>, sort: (a) => a.purchased_on ?? "", text: (a) => `${a.vendor} ${a.purchased_on ?? ""}` },
          { key: "w", header: "Warranty", cell: (a) => (a.warranty_ends_on ? <span className={cx("text-[13px]", a.warranty_ends_on < today && "font-semibold text-[#9c3a19]")}>{a.warranty_ends_on < today ? "Ended " : "Until "}{fmtDate(a.warranty_ends_on)}</span> : "—"), sort: (a) => a.warranty_ends_on ?? "" },
          { key: "c", header: "Condition", cell: (a) => <Pill status={a.condition} />, sort: (a) => a.condition, text: (a) => a.condition },
          { key: "u", header: "With", cell: (a) => (a.assigned_name ? <span>{a.assigned_name}<div className="text-[12px] text-[var(--muted)]">since {fmtDate(a.assigned_on)}</div></span> : <span className="text-[var(--muted)]">In stock</span>), sort: (a) => a.assigned_name ?? "", text: (a) => a.assigned_name ?? "in stock" },
          { key: "m", header: "Cost", cell: (a) => (a.cost_minor != null ? money(a.cost_minor) : "—"), align: "right", hide: !can("money.view"), sort: (a) => Number(a.cost_minor ?? 0) },
          { key: "x", header: "", cell: (a) => <div className="flex justify-end gap-1 whitespace-nowrap">
            {a.assigned_to ? <Button size="sm" variant="secondary" onClick={() => setRet({ ...a, condition: "good", notes: "" })}>Take back</Button> : <Button size="sm" onClick={() => setAssign({ ...a, userId: null, notes: "" })} disabled={a.condition === "retired"}>Assign</Button>}
            <Button size="sm" variant="ghost" onClick={() => setHistory(a)}>History</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit({ id: a.id, name: a.name, category: a.category, brand: a.brand, vendor: a.vendor, vendorId: a.vendor_id ?? null, serialNumber: a.serial_number, purchasedOn: a.purchased_on ?? "", warrantyMonths: a.warranty_months, costMinor: a.cost_minor, condition: a.condition, notes: a.notes })}>Edit</Button>
          </div> },
        ]} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit item" : "Add item"} wide
        footer={<>{edit?.id && <Button variant="ghost" className="mr-auto text-[#9c3a19]" onClick={async () => { if (await act.run(() => del(`/assets/${edit.id}`), "Item deleted")) { setEdit(null); refresh(); } }}>Delete</Button>}
          <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit?.name} busy={!!act.busy} onClick={async () => { const b = { ...edit, purchasedOn: edit.purchasedOn || null }; if (await act.run(() => (edit.id ? put(`/assets/${edit.id}`, b) : post("/assets", b)), "Saved")) { setEdit(null); refresh(); } }}>Save item</Button></>}>
        {edit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Item name" required className="sm:col-span-2"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. MacBook Air M3" /></Field>
            <Field label="Category"><Input list="asset-cats" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} placeholder="Laptop, Phone, Monitor" /><datalist id="asset-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></Field>
            <Field label="Brand"><Input value={edit.brand} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} placeholder="e.g. Apple" /></Field>
            <Field label="Serial number"><Input value={edit.serialNumber} onChange={(e) => setEdit({ ...edit, serialNumber: e.target.value })} /></Field>
            <Field label="Vendor" hint="Type a new name to add a vendor; fill in their details under Vendors.">
              <Combobox value={edit.vendorId} onChange={(v) => setEdit({ ...edit, vendorId: v, vendor: v ? "" : edit.vendor })} placeholder={edit.vendor || "Where it was bought"}
                options={(vendors.data ?? []).filter((v) => v.active || v.id === edit.vendorId).map((v) => ({ value: v.id, label: v.name, sub: [v.contact_name, v.phone].filter(Boolean).join(" · ") }))}
                onCreate={async (name) => { const v = await post("/vendors", { name }); qc.invalidateQueries({ queryKey: ["vendors"] }); return v.id; }} />
            </Field>
            <Field label="Purchase date"><Input type="date" value={edit.purchasedOn} onChange={(e) => setEdit({ ...edit, purchasedOn: e.target.value })} /></Field>
            <Field label="Warranty (months)"><Input type="number" min={0} value={edit.warrantyMonths ?? ""} onChange={(e) => setEdit({ ...edit, warrantyMonths: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            {can("money.view") && <Field label="Cost"><MoneyInput currency={me!.settings.locale.currency} value={edit.costMinor} onChange={(m) => setEdit({ ...edit, costMinor: m })} /></Field>}
            <Field label="Condition"><Select value={edit.condition} onChange={(e) => setEdit({ ...edit, condition: e.target.value })}>{["new", "good", "fair", "damaged", "retired"].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</Select></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} className="min-h-16" /></Field>
            <div className="sm:col-span-2"><ErrorNote error={act.err} /></div>
          </div>
        )}
      </Modal>
      <Modal open={!!assign} onClose={() => setAssign(null)} title={`Assign ${assign?.name ?? ""}`}
        footer={<><Button variant="secondary" onClick={() => setAssign(null)}>Cancel</Button><Button disabled={!assign?.userId} busy={!!act.busy} onClick={async () => { if (await act.run(() => post(`/assets/${assign.id}/assign`, { userId: assign.userId, notes: assign.notes }), "Assigned")) { setAssign(null); refresh(); } }}>Assign</Button></>}>
        {assign && <div className="grid gap-4"><Field label="Person"><Combobox value={assign.userId} onChange={(x) => setAssign({ ...assign, userId: x })} options={userOpts(users.data)} /></Field><Field label="Notes"><Input value={assign.notes} onChange={(e) => setAssign({ ...assign, notes: e.target.value })} placeholder="e.g. with charger and bag" /></Field><ErrorNote error={act.err} /></div>}
      </Modal>
      <Modal open={!!ret} onClose={() => setRet(null)} title={`Take back ${ret?.name ?? ""} from ${ret?.assigned_name ?? ""}`}
        footer={<><Button variant="secondary" onClick={() => setRet(null)}>Cancel</Button><Button busy={!!act.busy} onClick={async () => { if (await act.run(() => post(`/assets/${ret.id}/return`, { condition: ret.condition, notes: ret.notes }), "Taken back")) { setRet(null); refresh(); } }}>Take back</Button></>}>
        {ret && <div className="grid gap-4"><Field label="Condition now"><Select value={ret.condition} onChange={(e) => setRet({ ...ret, condition: e.target.value })}>{["new", "good", "fair", "damaged", "retired"].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</Select></Field><Field label="Notes"><Input value={ret.notes} onChange={(e) => setRet({ ...ret, notes: e.target.value })} placeholder="e.g. screen scratched" /></Field></div>}
      </Modal>
      <Drawer open={!!history} onClose={() => setHistory(null)} title={history ? `${history.name}: history` : ""}>
        {history && (
          <div className="grid gap-5">
            <DetailList cols={2} items={[
              ["Category", history.category], ["Brand", history.brand], ["Serial", history.serial_number], ["Condition", history.condition],
              ["Vendor", history.vendor], ["Bought", fmtDate(history.purchased_on)], ["Warranty until", fmtDate(history.warranty_ends_on)], ["With", history.assigned_name ?? "In stock"],
            ]} />
            <div>
              <h3 className="mb-3 text-[14px] font-bold">Who had it</h3>
              {hist.isLoading ? <Spinner /> : !(hist.data ?? []).length ? <p className="text-[14px] text-[var(--muted)]">Never assigned.</p> : (
                <ol className="relative ml-3 border-l-2 border-[var(--line)]">
                  {(hist.data ?? []).map((h: any, i: number) => {
                    const days = Math.max(1, Math.round((new Date(h.returned_on ?? new Date()).getTime() - new Date(h.assigned_on).getTime()) / 86400000));
                    return (
                      <motion.li key={h.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="relative mb-5 pl-6 last:mb-0">
                        <span className={cx("absolute -left-[9px] top-1 size-4 rounded-full border-2 border-[var(--card)]", h.returned_on ? "bg-[var(--line)]" : "bg-brand-gradient shadow-[0_0_10px_rgb(168_85_247/.8)]")} />
                        <div className="flex items-center justify-between gap-2"><b>{h.user_name}</b>{!h.returned_on && <Pill status="active">Has it now</Pill>}</div>
                        <p className="text-[13px] text-[var(--muted)]">{fmtDate(h.assigned_on)} – {h.returned_on ? fmtDate(h.returned_on) : "today"} · {days} day{days === 1 ? "" : "s"}</p>
                        {h.returned_on && h.condition_on_return && <p className="mt-1 text-[13px]">Returned in <b>{h.condition_on_return}</b> condition</p>}
                        {h.notes && <RichText className="mt-1 rounded-lg bg-[var(--bg)] px-3 py-2 text-[13.5px]" text={h.notes} />}
                      </motion.li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}

function Mine() {
  const { me } = useSession();
  const q = useQuery({ queryKey: ["assets", "mine"], queryFn: () => get<any[]>("/assets") });
  const [ask, setAsk] = useState<any>(null);
  const qc = useQueryClient();
  const act = useAction();
  const mine = (q.data ?? []).filter((a) => a.assigned_to === me!.user.id);
  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => setAsk({ kind: "new", category: "", priority: "medium", details: "" })}><Plus />Request new accessory</Button></div>
      {q.isLoading ? <Spinner /> : !mine.length ? <Empty icon={<Laptop />} title="No accessories assigned to you" /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mine.map((a) => (
            <Card key={a.id} title={a.name} sub={[a.brand, a.category].filter(Boolean).join(" · ")} actions={<Pill status={a.condition} />}>
              <dl className="grid grid-cols-2 gap-3 text-[13.5px]">
                <div><dt className="text-[12px] text-[var(--muted)]">Serial</dt><dd className="font-medium">{a.serial_number || "—"}</dd></div>
                <div><dt className="text-[12px] text-[var(--muted)]">With you since</dt><dd className="font-medium">{fmtDate(a.assigned_on)}</dd></div>
                <div><dt className="text-[12px] text-[var(--muted)]">Warranty</dt><dd className="font-medium">{a.warranty_ends_on ? `Until ${fmtDate(a.warranty_ends_on)}` : "—"}</dd></div>
              </dl>
              <Button className="mt-4" size="sm" variant="secondary" onClick={() => setAsk({ kind: "issue", assetId: a.id, assetName: a.name, category: a.category, priority: "medium", details: "" })}><Wrench />Report an issue</Button>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!ask} onClose={() => setAsk(null)} title={ask?.kind === "issue" ? `Report an issue with ${ask.assetName}` : "Request a new accessory"}
        footer={<><Button variant="secondary" onClick={() => setAsk(null)}>Cancel</Button><Button busy={!!act.busy} disabled={(ask?.details ?? "").trim().length < 3} onClick={async () => { if (await act.run(() => post("/asset-requests", ask), "Sent to HR")) { setAsk(null); qc.invalidateQueries({ queryKey: ["asset-requests"] }); } }}>Send</Button></>}>
        {ask && (
          <div className="grid gap-4">
            {ask.kind === "new" && <Field label="What do you need?"><Input value={ask.category} onChange={(e) => setAsk({ ...ask, category: e.target.value })} placeholder="e.g. Monitor, Headphones, Keyboard" /></Field>}
            <Field label="How urgent"><Select value={ask.priority} onChange={(e) => setAsk({ ...ask, priority: e.target.value })}><option value="high">High: as soon as possible</option><option value="medium">Medium: within a week</option><option value="low">Low: within a month</option></Select></Field>
            <Field label={ask.kind === "issue" ? "Describe the issue" : "Why do you need it?"}><Textarea value={ask.details} onChange={(e) => setAsk({ ...ask, details: e.target.value })} placeholder={ask.kind === "issue" ? "What's wrong, since when" : "Any specific requirements"} /></Field>
            <ErrorNote error={act.err} />
          </div>
        )}
      </Modal>
    </>
  );
}

function Requests({ rows, loading, onChange }: { rows?: any[]; loading: boolean; onChange: () => void }) {
  const { can } = useSession();
  const manage = can("assets.manage");
  const act = useAction();
  const [decide, setDecide] = useState<any>(null);
  return (
    <>
      <ErrorNote error={act.err} />
      <DataTable rows={rows} loading={loading} rowKey={(r: any) => r.id} exportName="accessory-requests" empty="No requests yet."
        columns={[
          { key: "u", header: "From", cell: (r: any) => <span className="font-semibold">{r.user_name}</span>, sort: (r: any) => r.user_name, text: (r: any) => r.user_name, hide: !manage },
          { key: "k", header: "Request", cell: (r: any) => <>{r.kind === "new" ? `New ${r.category || "item"}` : `Issue with ${r.asset_name ?? "an item"}`}{r.serial_number && <span className="text-[12px] text-[var(--muted)]"> ({r.serial_number})</span>}<div className="line-clamp-2 max-w-[44ch] text-[12.5px] text-[var(--muted)]">{r.details}</div></>, text: (r: any) => `${r.kind} ${r.category} ${r.details}` },
          { key: "p", header: "Priority", cell: (r: any) => <Pill status={r.priority}>{r.priority}</Pill>, sort: (r: any) => ({ high: 0, medium: 1, low: 2 } as any)[r.priority] },
          { key: "d", header: "Asked", cell: (r: any) => fmtDateTime(r.created_at), sort: (r: any) => r.created_at },
          { key: "s", header: "Status", cell: (r: any) => <><Pill status={r.status} />{r.response && <div className="mt-0.5 text-[12px] text-[var(--muted)]">{r.response}</div>}</>, sort: (r: any) => r.status, text: (r: any) => r.status },
          { key: "x", header: "", cell: (r: any) => manage && ["open", "in_progress"].includes(r.status) && <Button size="sm" variant="secondary" onClick={() => setDecide({ ...r, next: r.status === "open" ? "in_progress" : "done", response: r.response ?? "" })}>Update</Button> },
        ]} />
      <Modal open={!!decide} onClose={() => setDecide(null)} title="Update request"
        footer={<><Button variant="secondary" onClick={() => setDecide(null)}>Cancel</Button><Button busy={!!act.busy} onClick={async () => { if (await act.run(() => post(`/asset-requests/${decide.id}/decide`, { status: decide.next, response: decide.response }), "Updated, and they were notified")) { setDecide(null); onChange(); } }}>Save</Button></>}>
        {decide && (
          <div className="grid gap-4">
            <Field label="Status"><Select value={decide.next} onChange={(e) => setDecide({ ...decide, next: e.target.value })}><option value="in_progress">Being handled</option><option value="done">Done</option><option value="rejected">Can't do it</option></Select></Field>
            <Field label="Reply"><Textarea value={decide.response} onChange={(e) => setDecide({ ...decide, response: e.target.value })} placeholder="e.g. Ordered, arriving Friday" /></Field>
            <ErrorNote error={act.err} />
          </div>
        )}
      </Modal>
    </>
  );
}

/** Vendors the company buys accessories from: contact details, tax ID, and how many items came from each. */
function Vendors() {
  const qc = useQueryClient();
  const act = useAction();
  const q = useQuery({ queryKey: ["vendors"], queryFn: () => get<any[]>("/vendors") });
  const [edit, setEdit] = useState<any>(null);
  const blank = { name: "", contactName: "", phone: "", email: "", taxId: "", address: "", website: "", notes: "", active: true };
  const refresh = () => { qc.invalidateQueries({ queryKey: ["vendors"] }); qc.invalidateQueries({ queryKey: ["assets"] }); };
  const set = (p: any) => setEdit({ ...edit, ...p });
  return (
    <>
      <DataTable rows={q.data} loading={q.isLoading} rowKey={(v) => v.id} exportName="vendors" searchPlaceholder="Search vendors" tableId="vendors"
        actions={<Button size="sm" onClick={() => setEdit(blank)}><Plus className="size-4" />Add vendor</Button>}
        empty="No vendors yet. Add the shops and suppliers you buy from."
        onRowClick={(v) => setEdit({ id: v.id, name: v.name, contactName: v.contact_name, phone: v.phone, email: v.email, taxId: v.tax_id, address: v.address, website: v.website, notes: v.notes, active: v.active })}
        columns={[
          { key: "n", header: "Vendor", cell: (v) => <><span className="font-semibold">{v.name}</span>{v.website && <div className="text-[12.5px] text-[var(--muted)]">{v.website}</div>}</>, sort: (v) => v.name, text: (v) => `${v.name} ${v.website}`, filter: false },
          { key: "c", header: "Contact", cell: (v) => <>{v.contact_name || "—"}<div className="text-[12.5px] text-[var(--muted)]">{[v.phone, v.email].filter(Boolean).join(" · ")}</div></>, text: (v) => `${v.contact_name} ${v.phone} ${v.email}`, filter: false },
          { key: "t", header: "Tax ID", cell: (v) => v.tax_id || "—", text: (v) => v.tax_id, filter: false, optional: true },
          { key: "i", header: "Items", cell: (v) => v.items, sort: (v) => v.items, align: "right" },
          { key: "l", header: "Last bought", cell: (v) => fmtDate(v.last_bought), sort: (v) => v.last_bought ?? "" },
          { key: "s", header: "Status", cell: (v) => <Pill status={v.active ? "active" : "inactive"} />, filter: (v) => (v.active ? "Active" : "Inactive") },
        ]} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name || "vendor"}` : "Add vendor"} wide
        footer={<>{edit?.id && <Button variant="ghost" className="mr-auto text-[#9c3a19]" onClick={async () => { if (await act.run(() => del(`/vendors/${edit.id}`), "Vendor removed")) { setEdit(null); refresh(); } }}>Delete</Button>}
          <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
          <Button busy={!!act.busy} onClick={async () => { if (await act.run(() => (edit.id ? put(`/vendors/${edit.id}`, edit) : post("/vendors", edit)), "Vendor saved")) { setEdit(null); refresh(); } }}>Save vendor</Button></>}>
        {edit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vendor name" required className="sm:col-span-2"><Input value={edit.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Croma Business, Indiranagar" /></Field>
            <Field label="Contact person"><Input value={edit.contactName} onChange={(e) => set({ contactName: e.target.value })} /></Field>
            <Field label="Phone"><Input value={edit.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+91 98765 43210" /></Field>
            <Field label="Email"><Input type="email" value={edit.email} onChange={(e) => set({ email: e.target.value })} /></Field>
            <Field label="Website"><Input value={edit.website} onChange={(e) => set({ website: e.target.value })} placeholder="vendor.com" /></Field>
            <Field label="GSTIN / Tax ID"><Input value={edit.taxId} onChange={(e) => set({ taxId: e.target.value })} /></Field>
            <Field label="Status"><Select value={edit.active ? "1" : "0"} onChange={(e) => set({ active: e.target.value === "1" })}><option value="1">Active</option><option value="0">Inactive (hidden when adding items)</option></Select></Field>
            <Field label="Address" className="sm:col-span-2"><Textarea plain value={edit.address} onChange={(e) => set({ address: e.target.value })} className="min-h-16" /></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea value={edit.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-16" /></Field>
            <div className="sm:col-span-2"><ErrorNote error={act.err} /></div>
          </div>
        )}
      </Modal>
    </>
  );
}
