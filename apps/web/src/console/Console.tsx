import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FEATURES } from "@eszy/shared";
import { api } from "../lib/api";
import { Button, Card, Checkbox, ErrorNote, Field, Input, Modal, MoneyInput, PageHeader, Pill, Select, Spinner, Stat, Table, cx, useToast } from "../components/ui";

/** eszy platform console at admin.<domain>: companies, plans, payment keys and sales enquiries. */
const KEY = "eszy_platform_token";
const store = {
  get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: (t: string | null) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ } },
};
const papi = <T = any,>(path: string, opts: { method?: string; body?: unknown } = {}) => api<T>(`/api/v1/platform${path}`, { ...opts, token: store.get() }).catch((e) => {
  if (e.status === 401) { store.set(null); window.location.reload(); }
  throw e;
});

export function ConsoleApp() {
  const [token, setTok] = useState(store.get());
  if (!token) return <ConsoleLogin onIn={(t) => { store.set(t); setTok(t); }} />;
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 bg-[#121317] p-4 text-white md:flex">
        <div className="mb-4 px-2 font-display text-xl font-extrabold">eszy console</div>
        {[["/", "Overview"], ["/companies", "Companies"], ["/plans", "Plans"], ["/payments", "Payment keys"], ["/billing", "eszy billing details"], ["/enquiries", "Sales enquiries"], ["/account", "My account"]].map(([to, l]) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => cx("rounded-lg px-3 py-2", isActive ? "bg-white/15" : "text-white/80 hover:bg-white/10")}>{l}</NavLink>
        ))}
        <button className="mt-auto rounded-lg px-3 py-2 text-left text-white/70 hover:bg-white/10" onClick={() => { store.set(null); setTok(null); }}>Sign out</button>
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8">
        <Routes>
          <Route index element={<Overview />} />
          <Route path="companies" element={<Companies />} />
          <Route path="companies/:id" element={<Company />} />
          <Route path="plans" element={<Plans />} />
          <Route path="payments" element={<PaymentKeys />} />
          <Route path="enquiries" element={<Enquiries />} />
          <Route path="billing" element={<BillingProfile />} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

function ConsoleLogin({ onIn }: { onIn: (t: string) => void }) {
  const [f, setF] = useState({ email: "", password: "" });
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const gref = useRef<HTMLDivElement>(null);
  const done = (r: any) => (r.twoFactor ? setChallenge(r.challenge) : onIn(r.accessToken));
  useEffect(() => {
    let t: any;
    api("/api/v1/platform/auth-config", { token: null }).then((cfg: any) => {
      if (!cfg.googleClientId) return;
      let tries = 0;
      t = setInterval(() => {
        const g = (window as any).google;
        if (g?.accounts?.id && gref.current) {
          clearInterval(t);
          g.accounts.id.initialize({ client_id: cfg.googleClientId, callback: async (r: any) => { try { done(await api("/api/v1/platform/google", { body: { credential: r.credential }, token: null })); } catch (x) { setErr(x); } } });
          g.accounts.id.renderButton(gref.current, { theme: "outline", size: "large", width: 320 });
        } else if (++tries > 40) clearInterval(t);
      }, 150);
    }).catch(() => {});
    return () => clearInterval(t);
  }, []); // eslint-disable-line
  return (
    <div className="grid min-h-screen place-items-center bg-[#121317] p-6">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--card)] p-6">
        <h1 className="mb-5 text-2xl font-extrabold">eszy console</h1>
        {challenge ? (
          <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); try { done(await api("/api/v1/platform/2fa", { body: { challenge, code }, token: null })); } catch (x) { setErr(x); } }}>
            <Field label="Code from your authenticator app"><Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></Field>
            <ErrorNote error={err} />
            <Button type="submit">Continue</Button>
          </form>
        ) : (
          <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); try { done(await api("/api/v1/platform/login", { body: f, token: null })); } catch (x) { setErr(x); } }}>
            <div ref={gref} className="flex justify-center" />
            <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Password"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
            <ErrorNote error={err} />
            <Button type="submit">Sign in</Button>
          </form>
        )}
      </div>
    </div>
  );
}

function BillingProfile() {
  const toast = useToast();
  const q = useQuery({ queryKey: ["p-billing"], queryFn: () => papi("/billing-profile") });
  const [b, setB] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  if (!q.data) return <Spinner />;
  const v = b ?? { legalName: "", address: "", country: "IN", state: "", taxId: "", rates: [{ name: "GST", rateBp: 1800 }], indiaGstSplit: true, exportRateBp: 0, ...q.data };
  return (
    <>
      <PageHeader title="eszy billing details" sub="Printed on eszy's invoices to companies. Tax is worked out with the same engine companies use: CGST + SGST, IGST or the export rate from each company's country and state." />
      <Card className="max-w-3xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal name"><Input value={v.legalName} onChange={(e) => setB({ ...v, legalName: e.target.value })} /></Field>
          <Field label="Tax ID (GSTIN)"><Input value={v.taxId} onChange={(e) => setB({ ...v, taxId: e.target.value })} /></Field>
          <Field label="Country"><Input maxLength={2} value={v.country} onChange={(e) => setB({ ...v, country: e.target.value.toUpperCase() })} /></Field>
          <Field label="State"><Input value={v.state} onChange={(e) => setB({ ...v, state: e.target.value })} /></Field>
          <Field label="Address" className="sm:col-span-2"><Input value={v.address} onChange={(e) => setB({ ...v, address: e.target.value })} /></Field>
          <Field label="GST / VAT rate (%)"><Input type="number" step="0.01" value={(v.rates[0]?.rateBp ?? 0) / 100} onChange={(e) => setB({ ...v, rates: [{ name: v.rates[0]?.name ?? "GST", rateBp: Math.round(Number(e.target.value) * 100) }] })} /></Field>
          <Field label="Rate for companies abroad (%)"><Input type="number" step="0.01" value={v.exportRateBp / 100} onChange={(e) => setB({ ...v, exportRateBp: Math.round(Number(e.target.value) * 100) })} /></Field>
          <Checkbox label="Split GST for India (CGST + SGST / IGST)" checked={v.indiaGstSplit} onChange={(x) => setB({ ...v, indiaGstSplit: x })} />
        </div>
        <ErrorNote error={err} />
        <Button className="mt-5" disabled={!b} onClick={async () => { setErr(null); try { await papi("/billing-profile", { method: "PUT", body: v }); toast("Saved"); setB(null); q.refetch(); } catch (e) { setErr(e); } }}>Save</Button>
      </Card>
    </>
  );
}

function Account() {
  const q = useQuery({ queryKey: ["p-me"], queryFn: () => papi("/me") });
  const [setup, setSetup] = useState<any>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<unknown>(null);
  if (!q.data) return <Spinner />;
  return (
    <>
      <PageHeader title="My account" sub={q.data.email} />
      <Card title="Two-step sign-in" className="max-w-xl" actions={<Pill status={q.data.totp_enabled ? "active" : "none"}>{q.data.totp_enabled ? "On" : "Off"}</Pill>}>
        {q.data.totp_enabled ? <p>Your console sign-in asks for a code from your authenticator app.</p> : setup ? (
          <div className="grid gap-3">
            <p className="text-sm">Scan this with Google Authenticator, 1Password or similar, then type the 6-digit code.</p>
            {setup.qr && <img src={setup.qr} alt="QR code for your authenticator app" className="size-48" />}
            <p className="break-all text-[13px] text-[var(--muted)]">Or enter this key: {setup.secret}</p>
            <Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
            <ErrorNote error={err} />
            <Button onClick={async () => { setErr(null); try { await papi("/me/2fa/enable", { method: "POST", body: { code } }); setSetup(null); q.refetch(); } catch (e) { setErr(e); } }}>Turn on</Button>
          </div>
        ) : <Button onClick={async () => setSetup(await papi("/me/2fa/setup", { method: "POST", body: {} }))}>Set up two-step sign-in</Button>}
      </Card>
    </>
  );
}

function Overview() {
  const q = useQuery({ queryKey: ["p-stats"], queryFn: () => papi("/stats") });
  if (!q.data) return <Spinner />;
  const s = q.data;
  return (
    <>
      <PageHeader title="Overview" />
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Companies" value={s.companies} /><Stat label="On trial" value={s.trials} /><Stat label="Paying" value={s.active} tone="paid" />
        <Stat label="At risk" value={s.at_risk} tone={s.at_risk ? "amber" : undefined} /><Stat label="Suspended or cancelled" value={s.ended} /><Stat label="Enquiries, 30 days" value={s.enquiries_30d} />
      </div>
    </>
  );
}

function Companies() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["p-tenants", search], queryFn: () => papi<any[]>(`/tenants?search=${encodeURIComponent(search)}`) });
  return (
    <>
      <PageHeader title="Companies" actions={<Button onClick={() => setOpen(true)}>Add company</Button>} />
      <Input placeholder="Search name or address" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-4 max-w-sm" />
      <Table head={["Company", "Address", "Plan", "Seats", "Renews", "Status"]} empty="No companies yet.">
        {(q.data ?? []).map((t) => (
          <tr key={t.id}><td><NavLink to={`/companies/${t.id}`} className="font-semibold hover:underline">{t.name}</NavLink></td><td className="text-[14px]">{t.slug}</td><td>{t.plan_name}</td><td className="tabnum">{t.seats}</td>
            <td className="whitespace-nowrap">{t.status === "trial" ? `Trial to ${new Date(t.trial_ends_at).toLocaleDateString()}` : t.current_period_end ? new Date(t.current_period_end).toLocaleDateString() : "—"}</td><td><Pill status={t.status} /></td></tr>
        ))}
      </Table>
      <NewCompany open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function NewCompany({ open, onClose }: { open: boolean; onClose: () => void }) {
  const plans = useQuery({ queryKey: ["p-plans"], queryFn: () => papi<any[]>("/plans"), enabled: open });
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", slug: "", planCode: "business", ownerName: "", ownerEmail: "", currency: "INR", country: "IN", active: true });
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  return (
    <Modal open={open} onClose={() => { setRes(null); onClose(); }} title="Add a company" wide>
      {res ? <div className="grid gap-3"><p>Created. The owner got an email to set their password. You can also send this link:</p><Input readOnly value={res.inviteUrl} onFocus={(e) => e.target.select()} /><Button onClick={() => { setRes(null); onClose(); }}>Done</Button></div> : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: f.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) })} /></Field>
          <Field label="Address" hint={`${f.slug || "name"}.eszy.com`}><Input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} /></Field>
          <Field label="Owner name"><Input value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></Field>
          <Field label="Owner email"><Input type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} /></Field>
          <Field label="Plan"><Select value={f.planCode} onChange={(e) => setF({ ...f, planCode: e.target.value })}>{(plans.data ?? []).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select></Field>
          <Field label="Currency"><Input maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
          <Field label="Country"><Input maxLength={2} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} /></Field>
          <div className="self-end"><Checkbox label="Active now (no trial)" checked={f.active} onChange={(v) => setF({ ...f, active: v })} /></div>
          <div className="sm:col-span-2"><ErrorNote error={err} /></div>
          <div className="sm:col-span-2"><Button onClick={async () => { setErr(null); try { setRes(await papi("/tenants", { method: "POST", body: f })); qc.invalidateQueries({ queryKey: ["p-tenants"] }); } catch (e) { setErr(e); } }}>Create company</Button></div>
        </div>
      )}
    </Modal>
  );
}

function Company() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["p-tenant", id], queryFn: () => papi(`/tenants/${id}`) });
  const plans = useQuery({ queryKey: ["p-plans"], queryFn: () => papi<any[]>("/plans") });
  const [f, setF] = useState<any>(null);
  const [domain, setDomain] = useState("");
  const [err, setErr] = useState<unknown>(null);
  if (!q.data || !plans.data) return <Spinner />;
  const t = q.data;
  const plan = plans.data.find((p) => p.id === t.plan_id);
  const v = f ?? {
    planCode: plan?.code, status: t.status, seats: t.seats, interval: t.interval, periodEnd: t.current_period_end?.slice(0, 10) ?? "", trialEndsAt: t.trial_ends_at?.slice(0, 10) ?? "",
    features: Object.fromEntries(Object.keys(FEATURES).map((k) => { const o = t.featureOverrides.find((x: any) => x.feature_code === k); return [k, o ? (o.enabled ? "on" : "off") : "plan"]; })),
  };
  const save = async () => {
    setErr(null);
    try { await papi(`/tenants/${t.id}`, { method: "PUT", body: { ...v, periodEnd: v.periodEnd || undefined, trialEndsAt: v.trialEndsAt || undefined } }); toast("Saved"); setF(null); qc.invalidateQueries({ queryKey: ["p-tenant", id] }); qc.invalidateQueries({ queryKey: ["p-tenants"] }); }
    catch (e) { setErr(e); }
  };
  return (
    <>
      <PageHeader title={t.name} sub={t.domains.map((d: any) => d.host).join(" · ")} actions={<Pill status={t.status} />} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Plan and status">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan"><Select value={v.planCode} onChange={(e) => setF({ ...v, planCode: e.target.value })}>{plans.data.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select></Field>
            <Field label="Status"><Select value={v.status} onChange={(e) => setF({ ...v, status: e.target.value })}>{["trial", "active", "past_due", "read_only", "suspended", "cancelled"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select></Field>
            <Field label="Seats"><Input type="number" min={1} value={v.seats} onChange={(e) => setF({ ...v, seats: Number(e.target.value) })} /></Field>
            <Field label="Billing"><Select value={v.interval} onChange={(e) => setF({ ...v, interval: e.target.value })}><option value="month">Monthly</option><option value="year">Yearly</option></Select></Field>
            <Field label="Paid until" hint="For plans you invoice yourself"><Input type="date" value={v.periodEnd} onChange={(e) => setF({ ...v, periodEnd: e.target.value })} /></Field>
            <Field label="Trial ends"><Input type="date" value={v.trialEndsAt} onChange={(e) => setF({ ...v, trialEndsAt: e.target.value })} /></Field>
          </div>
        </Card>
        <Card title="Features">
          <p className="mb-3 text-sm text-[var(--muted)]">Follow the plan, or switch a feature on (add-on) or off for this company only.</p>
          <div className="grid gap-3">
            {Object.entries(FEATURES).map(([k, label]) => (
              <div key={k} className="flex items-center justify-between gap-3"><span className="font-semibold">{label}{plan?.features.includes(k) ? <span className="ml-2 text-[12px] text-[var(--muted)]">in plan</span> : null}</span>
                <Select className="w-40 py-1.5" value={v.features[k]} onChange={(e) => setF({ ...v, features: { ...v.features, [k]: e.target.value } })}><option value="plan">Follow plan</option><option value="on">Always on</option><option value="off">Off</option></Select></div>
            ))}
          </div>
        </Card>
        <Card title="Addresses">
          <ul className="mb-3 grid gap-1">{t.domains.map((d: any) => <li key={d.id}>{d.host} <span className="text-[12px] text-[var(--muted)]">{d.kind}</span></li>)}</ul>
          <div className="flex gap-2"><Input placeholder="app.theircompany.com" value={domain} onChange={(e) => setDomain(e.target.value)} /><Button variant="outline" disabled={!domain} onClick={async () => { await papi(`/tenants/${t.id}/domains`, { method: "POST", body: { host: domain } }); setDomain(""); q.refetch(); }}>Add custom domain</Button></div>
          <p className="mt-2 text-[13px] text-[var(--muted)]">Point the domain's CNAME at eszy before adding it.</p>
        </Card>
        <CompanyInvoices tenantId={t.id} invoices={t.invoices} onChange={() => q.refetch()} />
        <Card title="People">
          <p>{t.users.n} people, {t.users.active} active.</p>
          <p className="mt-2 text-sm text-[var(--muted)]">Created {new Date(t.created_at).toLocaleDateString()}{t.delete_after ? `. Data will be deleted after ${new Date(t.delete_after).toLocaleDateString()}.` : "."}</p>
        </Card>
      </div>
      <ErrorNote error={err} />
      <Button className="mt-5" onClick={save} disabled={!f}>Save changes</Button>
    </>
  );
}

function Plans() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["p-plans"], queryFn: () => papi<any[]>("/plans") });
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  return (
    <>
      <PageHeader title="Plans" sub="Plans are built from features. A price of 0 shows Contact sales instead of online payment." actions={<Button onClick={() => setEdit({ code: "", name: "", description: "", sort: 10, priceMonthMinor: 0, priceYearMinor: 0, currency: "USD", maxUsers: null, maxProjects: null, rateLimitPerMinute: 600, public: true, active: true, features: [] })}>New plan</Button>} />
      <Table head={["Plan", "Features", "Per user / month", "Per user / year", "Companies", ""]}>
        {(q.data ?? []).map((p) => (
          <tr key={p.id}><td className="font-semibold">{p.name} {!p.active && <Pill status="ended">Hidden</Pill>}</td><td className="text-[14px]">{p.features.map((f: string) => (FEATURES as any)[f]).join(", ")}</td>
            <td className="tabnum">{p.price_month_minor ? `${(p.price_month_minor / 100).toFixed(2)} ${p.currency}` : "Contact sales"}</td><td className="tabnum">{p.price_year_minor ? `${(p.price_year_minor / 100).toFixed(2)} ${p.currency}` : "—"}</td><td className="tabnum">{p.tenant_count}</td>
            <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEdit({ id: p.id, code: p.code, name: p.name, description: p.description, sort: p.sort, priceMonthMinor: p.price_month_minor, priceYearMinor: p.price_year_minor, currency: p.currency, maxUsers: p.max_users, maxProjects: p.max_projects, rateLimitPerMinute: p.rate_limit_per_minute, public: p.public, active: p.active, features: p.features })}>Edit</Button></td></tr>
        ))}
      </Table>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.name}` : "New plan"} wide>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Code"><Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Order"><Input type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) })} /></Field>
            <Field label="Description" className="sm:col-span-3"><Input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field label="Currency"><Input maxLength={3} value={edit.currency} onChange={(e) => setEdit({ ...edit, currency: e.target.value.toUpperCase() })} /></Field>
            <Field label="Per user / month"><MoneyInput value={edit.priceMonthMinor} onChange={(m) => setEdit({ ...edit, priceMonthMinor: m ?? 0 })} /></Field>
            <Field label="Per user / year"><MoneyInput value={edit.priceYearMinor} onChange={(m) => setEdit({ ...edit, priceYearMinor: m ?? 0 })} /></Field>
            <Field label="Max people" hint="Blank = no limit"><Input type="number" value={edit.maxUsers ?? ""} onChange={(e) => setEdit({ ...edit, maxUsers: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <Field label="Max projects" hint="Blank = no limit"><Input type="number" value={edit.maxProjects ?? ""} onChange={(e) => setEdit({ ...edit, maxProjects: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <Field label="Requests per minute"><Input type="number" value={edit.rateLimitPerMinute} onChange={(e) => setEdit({ ...edit, rateLimitPerMinute: Number(e.target.value) })} /></Field>
            <div className="grid gap-2 sm:col-span-3">{Object.entries(FEATURES).map(([k, l]) => <Checkbox key={k} label={l} checked={edit.features.includes(k)} onChange={(v) => setEdit({ ...edit, features: v ? [...edit.features, k] : edit.features.filter((x: string) => x !== k) })} />)}</div>
            <Checkbox label="Shown on the pricing page" checked={edit.public} onChange={(v) => setEdit({ ...edit, public: v })} />
            <Checkbox label="Active" checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
          </div>
          <ErrorNote error={err} />
          <Button className="mt-4" onClick={async () => { setErr(null); try { const { id: pid, ...body } = edit; await papi(pid ? `/plans/${pid}` : "/plans", { method: pid ? "PUT" : "POST", body }); setEdit(null); qc.invalidateQueries({ queryKey: ["p-plans"] }); } catch (e) { setErr(e); } }}>Save plan</Button>
        </Modal>
      )}
    </>
  );
}

function PaymentKeys() {
  const toast = useToast();
  const q = useQuery({ queryKey: ["p-keys"], queryFn: () => papi("/payment-keys") });
  const [k, setK] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  if (!q.data) return <Spinner />;
  const v = k ?? q.data;
  const origin = window.location.origin.replace("admin.", "");
  return (
    <>
      <PageHeader title="Payment keys" sub="Paste each provider's keys and it works. A provider without keys is hidden from companies." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Razorpay" actions={<Pill status={v.razorpay.keyId ? "active" : "none"}>{v.razorpay.keyId ? "Set up" : "Not set up"}</Pill>}>
          <div className="grid gap-4">
            <Field label="Key ID"><Input value={v.razorpay.keyId} onChange={(e) => setK({ ...v, razorpay: { ...v.razorpay, keyId: e.target.value } })} /></Field>
            <Field label="Key secret"><Input type="password" value={v.razorpay.keySecret} onChange={(e) => setK({ ...v, razorpay: { ...v.razorpay, keySecret: e.target.value } })} /></Field>
            <Field label="Webhook secret" hint={`Webhook URL: ${origin}/api/v1/webhooks/razorpay`}><Input type="password" value={v.razorpay.webhookSecret} onChange={(e) => setK({ ...v, razorpay: { ...v.razorpay, webhookSecret: e.target.value } })} /></Field>
          </div>
        </Card>
        <Card title="Stripe" actions={<Pill status={v.stripe.secretKey ? "active" : "none"}>{v.stripe.secretKey ? "Set up" : "Not set up"}</Pill>}>
          <div className="grid gap-4">
            <Field label="Publishable key"><Input value={v.stripe.publishableKey} onChange={(e) => setK({ ...v, stripe: { ...v.stripe, publishableKey: e.target.value } })} /></Field>
            <Field label="Secret key"><Input type="password" value={v.stripe.secretKey} onChange={(e) => setK({ ...v, stripe: { ...v.stripe, secretKey: e.target.value } })} /></Field>
            <Field label="Webhook signing secret" hint={`Webhook URL: ${origin}/api/v1/webhooks/stripe`}><Input type="password" value={v.stripe.webhookSecret} onChange={(e) => setK({ ...v, stripe: { ...v.stripe, webhookSecret: e.target.value } })} /></Field>
          </div>
        </Card>
      </div>
      <ErrorNote error={err} />
      <Button className="mt-5" disabled={!k} onClick={async () => { setErr(null); try { await papi("/payment-keys", { method: "PUT", body: v }); toast("Keys saved"); setK(null); q.refetch(); } catch (e) { setErr(e); } }}>Save keys</Button>
    </>
  );
}

function Enquiries() {
  const q = useQuery({ queryKey: ["p-enq"], queryFn: () => papi<any[]>("/enquiries") });
  return (
    <>
      <PageHeader title="Sales enquiries" sub="Sent from the Contact sales form on eszy.com." />
      <Table head={["When", "Name", "Company", "Team size", "Features", "Message"]} empty="No enquiries yet.">
        {(q.data ?? []).map((e) => <tr key={e.id}><td className="whitespace-nowrap text-[13px]">{new Date(e.created_at).toLocaleString()}</td><td><a className="font-semibold underline" href={`mailto:${e.email}`}>{e.name}</a></td><td>{e.company}</td><td>{e.team_size}</td><td className="text-[13px]">{e.features}</td><td className="max-w-sm text-[13px]">{e.message}</td></tr>)}
      </Table>
    </>
  );
}

function CompanyInvoices({ tenantId, invoices, onChange }: { tenantId: string; invoices: any[]; onChange: () => void }) {
  const [f, setF] = useState({ amountMinor: null as number | null, currency: "INR", periodStart: "", periodEnd: "", description: "" });
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <Card title="eszy invoices to this company" actions={<Button size="sm" variant="outline" onClick={() => setOpen(true)}>Create invoice</Button>}>
      <Table head={["Number", "Date", "Amount", "Status", ""]} empty="No invoices yet.">
        {invoices.map((x) => <tr key={x.id}><td className="font-semibold">{x.number ?? "—"}</td><td>{new Date(x.created_at).toLocaleDateString()}</td><td className="tabnum">{(x.amount_minor / 100).toFixed(2)} {x.currency}</td><td><Pill status={x.status} /></td>
          <td className="text-right">{x.number && <Button size="sm" variant="ghost" onClick={async () => { const r = await api<Response>(`/api/v1/platform/tenants/${tenantId}/invoices/${x.id}/pdf`, { raw: true, token: store.get() }); window.open(URL.createObjectURL(await r.blob()), "_blank", "noopener"); }}>PDF</Button>}</td></tr>)}
      </Table>
      <Modal open={open} onClose={() => setOpen(false)} title="Invoice for a plan paid offline">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount before tax"><MoneyInput value={f.amountMinor} onChange={(m) => setF({ ...f, amountMinor: m })} /></Field>
          <Field label="Currency"><Input maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
          <Field label="Period from"><Input type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} /></Field>
          <Field label="Period to"><Input type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></Field>
          <Field label="Description" className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="eszy Business plan, 25 seats" /></Field>
          <div className="sm:col-span-2"><ErrorNote error={err} /></div>
          <Button disabled={!f.amountMinor} onClick={async () => { setErr(null); try { await papi(`/tenants/${tenantId}/invoices`, { method: "POST", body: { ...f, periodStart: f.periodStart || undefined, periodEnd: f.periodEnd || undefined } }); setOpen(false); onChange(); } catch (e) { setErr(e); } }}>Create invoice</Button>
        </div>
      </Modal>
    </Card>
  );
}
