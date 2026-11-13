import { ActivityLog } from "../components/ActivityLog";
import { useEffect, useRef, useState } from "react";
import { AssistantSettings } from "./AssistantSettings";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMinutes, type Permission } from "@eszy/shared";
import { api, del, download, get, post, put } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, Card, Checkbox, ErrorNote, Field, HoursInput, Input, Modal, PageHeader, Pill, Select, SideNavLayout, Spinner, Table, Tabs, Textarea, useToast } from "../components/ui";
import { Appearance } from "./Appearance";
import { ArrowDownUp, BellRing, Building2, CalendarDays, Clock3, CreditCard, DatabaseBackup, History, Palette, Receipt, ShieldCheck, Sparkles } from "lucide-react";
import { Exports } from "./Insights";
import { AlertsTab, DangerZone, EszyInvoices, LeaveTypesTab, ListsTab, PolicyExtras, RestoreCard, SecurityFields } from "./SettingsExtra";
import { BACKUP_HINTS } from "./backupHints";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SettingsPage() {
  const { tab: t } = useParams();
  const nav = useNavigate();
  const { can } = useSession();
  // Masters and roles have their own pages now; old links still work.
  useEffect(() => { if (t === "lists") nav("/masters", { replace: true }); if (t === "permissions") nav("/roles", { replace: true }); }, [t, nav]);
  const sm = can("settings.manage");
  const groups = [
    { label: "Company", items: [...(sm ? [{ id: "general", label: "Company and brand", icon: <Building2 /> }, { id: "appearance", label: "Appearance", icon: <Palette /> }, { id: "policies", label: "Work policies", icon: <Clock3 /> }, { id: "billing", label: "Tax and invoices", icon: <Receipt /> }] : [])] },
    { label: "Security and assistant", items: [...(sm ? [{ id: "signin", label: "Sign-in and security", icon: <ShieldCheck /> }, { id: "assistant", label: "Assistant", icon: <Sparkles /> }, { id: "alerts", label: "Alerts", icon: <BellRing /> }] : [])] },
    { label: "People", items: [...(can("leave.manage") ? [{ id: "leave", label: "Leave types", icon: <CalendarDays /> }] : [])] },
    { label: "Data", items: [...(can("import_export") ? [{ id: "data", label: "Import and export", icon: <ArrowDownUp /> }] : []), ...(sm ? [{ id: "backups", label: "Backups", icon: <DatabaseBackup /> }] : []), ...(can("audit.view") ? [{ id: "audit", label: "Change history", icon: <History /> }] : [])] },
    { label: "Account", items: [...(can("subscription.manage") ? [{ id: "subscription", label: "Subscription", icon: <CreditCard /> }] : [])] },
  ].filter((g) => g.items.length);
  const all = groups.flatMap((g) => g.items);
  const tab = t && all.some((x) => x.id === t) ? t : all[0]?.id;
  const title = all.find((x) => x.id === tab)?.label;
  return (
    <>
      <PageHeader title="Settings" sub="Company-wide choices. Masters, and roles and permissions, have their own pages in the menu." />
      <SideNavLayout groups={groups} value={tab} onChange={(id) => nav(`/settings/${id}`)}>
        <h2 className="mb-4 text-[18px] font-bold">{title}</h2>
        {["general", "appearance", "policies", "billing", "signin", "backups"].includes(tab) && <CompanySettings section={tab} />}
        {tab === "leave" && <LeaveTypesTab />}
        {tab === "assistant" && <AssistantSettings />}
        {tab === "alerts" && <AlertsTab />}
        {tab === "data" && <><ImportCsv /><div className="mt-5"><Exports /></div></>}
        {tab === "subscription" && <Subscription />}
        {tab === "audit" && <Audit />}
      </SideNavLayout>
    </>
  );
}

function CompanySettings({ section }: { section: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { reload } = useSession();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => get("/settings") });
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setS(structuredClone(q.data)); }, [q.data]);
  if (!s) return <Spinner />;
  const up = (sec: string, patch: any) => setS((x: any) => ({ ...x, [sec]: { ...x[sec], ...patch } }));
  const save = async (sections: string[]) => {
    setBusy(true); setErr(null);
    try { await put("/settings", Object.fromEntries(sections.map((k) => [k, s[k]]))); toast("Settings saved"); qc.invalidateQueries({ queryKey: ["settings"] }); reload(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const b = s.branding, l = s.locale, p = s.policies, t = s.tax, i = s.invoices, a = s.auth, k = s.backups;

  if (section === "general") return (
    <Card title="Company and brand" className="max-w-3xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name"><Input value={b.displayName} onChange={(e) => up("branding", { displayName: e.target.value })} /></Field>
        <Field label="Logo URL" hint="A square PNG or SVG works best"><Input value={b.logoUrl} onChange={(e) => up("branding", { logoUrl: e.target.value })} /></Field>
        <Field label="Main colour"><div className="flex gap-2"><input type="color" value={b.primaryColor} onChange={(e) => up("branding", { primaryColor: e.target.value })} className="h-11 w-14 rounded border border-[var(--line)]" /><Input value={b.primaryColor} onChange={(e) => up("branding", { primaryColor: e.target.value })} /></div></Field>
        <Field label="Accent colour"><div className="flex gap-2"><input type="color" value={b.accentColor} onChange={(e) => up("branding", { accentColor: e.target.value })} className="h-11 w-14 rounded border border-[var(--line)]" /><Input value={b.accentColor} onChange={(e) => up("branding", { accentColor: e.target.value })} /></div></Field>
        <Field label="Email sender name"><Input value={b.emailSenderName} onChange={(e) => up("branding", { emailSenderName: e.target.value })} /></Field>
        <Field label="Currency" hint="Three letters, e.g. INR, USD, EUR. Used for every amount."><Input maxLength={3} value={l.currency} onChange={(e) => up("locale", { currency: e.target.value.toUpperCase() })} /></Field>
        <Field label="Time zone" hint="Decides what 'today' is for sheets and invoices"><Select value={l.timezone} onChange={(e) => up("locale", { timezone: e.target.value })}>{Intl.supportedValuesOf("timeZone").map((z) => <option key={z}>{z}</option>)}</Select></Field>
        <Field label="Date format"><Select value={l.dateFormat} onChange={(e) => up("locale", { dateFormat: e.target.value })}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></Select></Field>
        <Field label="Week starts on"><Select value={l.weekStartsOn} onChange={(e) => up("locale", { weekStartsOn: Number(e.target.value) })}>{DAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}</Select></Field>
      </div>
      <ErrorNote error={err} />
      <Button className="mt-5" busy={busy} onClick={() => save(["branding", "locale"])}>Save</Button>
    </Card>
  );

  if (section === "appearance") return <Appearance s={s} up={up} save={() => save(["branding"])} busy={busy} err={err} />;

  if (section === "policies") return (
    <Card title="Work policies" className="max-w-3xl">
      <div className="mb-5"><div className="mb-2 text-sm font-semibold">Working days</div>
        <div className="flex flex-wrap gap-2">{DAYS.map((d, n) => <button key={d} type="button" onClick={() => up("policies", { workingDays: p.workingDays.includes(n) ? p.workingDays.filter((x: number) => x !== n) : [...p.workingDays, n].sort() })} className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${p.workingDays.includes(n) ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[var(--line)]"}`}>{d}</button>)}</div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Daily minimum" hint="Hours needed to submit a normal day"><HoursInput value={p.dailyMinimumMinutes} onChange={(m) => up("policies", { dailyMinimumMinutes: m ?? 0 })} /></Field>
        <Field label="WFH full day" hint="Hours needed on an approved full WFH day"><HoursInput value={p.wfhFullDayMinutes} onChange={(m) => up("policies", { wfhFullDayMinutes: m ?? 0 })} /></Field>
        <Field label="WFH half day"><HoursInput value={p.wfhHalfDayMinutes} onChange={(m) => up("policies", { wfhHalfDayMinutes: m ?? 0 })} /></Field>
        <Field label="Edit window (days)" hint="How far back people can change their sheets"><Input type="number" min={0} value={p.sheetEditDays} onChange={(e) => up("policies", { sheetEditDays: Number(e.target.value) })} /></Field>
      </div>
      <div className="mt-4"><Checkbox label="WFH needs TL approval" checked={p.wfhNeedsApproval} onChange={(v) => up("policies", { wfhNeedsApproval: v })} /></div>
      <PolicyExtras p={p} up={up} />
      <p className="mt-3 text-sm text-[var(--muted)]">Now: normal day {formatMinutes(p.dailyMinimumMinutes)}, WFH {formatMinutes(p.wfhFullDayMinutes)} (half {formatMinutes(p.wfhHalfDayMinutes)}). Holidays and leave types are under Leave and WFH, and Leave types.</p>
      <ErrorNote error={err} />
      <Button className="mt-5" busy={busy} onClick={() => save(["policies"])}>Save</Button>
    </Card>
  );

  if (section === "billing") return (
    <div className="grid max-w-3xl gap-5">
      <Card title="Tax">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal name (on invoices)"><Input value={t.legalName} onChange={(e) => up("tax", { legalName: e.target.value })} /></Field>
          <Field label="Tax ID" hint="GSTIN, VAT number or similar"><Input value={t.taxId} onChange={(e) => up("tax", { taxId: e.target.value })} /></Field>
          <Field label="Country code" hint="Two letters, e.g. IN, US, GB"><Input maxLength={2} value={t.country} onChange={(e) => up("tax", { country: e.target.value.toUpperCase() })} /></Field>
          <Field label="State" hint="For GST: same state as the client means CGST + SGST, else IGST"><Input value={t.state} onChange={(e) => up("tax", { state: e.target.value })} /></Field>
          <Field label="Address" className="sm:col-span-2"><Textarea value={t.address} onChange={(e) => up("tax", { address: e.target.value })} /></Field>
        </div>
        <div className="mt-4"><div className="mb-2 text-sm font-semibold">Tax rates</div>
          {t.rates.map((r: any, n: number) => (
            <div key={n} className="mb-2 flex gap-2">
              <Input value={r.name} onChange={(e) => up("tax", { rates: t.rates.map((x: any, j: number) => (j === n ? { ...x, name: e.target.value } : x)) })} placeholder="Name, e.g. GST" />
              <Input type="number" step="0.01" className="w-32" value={r.rateBp / 100} onChange={(e) => up("tax", { rates: t.rates.map((x: any, j: number) => (j === n ? { ...x, rateBp: Math.round(Number(e.target.value) * 100) } : x)) })} />
              <span className="self-center">%</span>
              <Button variant="ghost" size="sm" onClick={() => up("tax", { rates: t.rates.filter((_: any, j: number) => j !== n) })}>Remove</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => up("tax", { rates: [...t.rates, { name: "", rateBp: 0 }] })}>Add rate</Button>
        </div>
        <div className="mt-4 grid gap-3">
          <Checkbox label="Split GST for India (CGST + SGST within the state, IGST across states)" checked={t.indiaGstSplit} onChange={(v) => up("tax", { indiaGstSplit: v })} />
          <Checkbox label="Prices already include tax" checked={t.pricesIncludeTax} onChange={(v) => up("tax", { pricesIncludeTax: v })} />
          <Field label="Rate for clients in other countries (%)" hint="e.g. 0 for exports under LUT"><Input type="number" step="0.01" className="w-40" value={t.exportRateBp / 100} onChange={(e) => up("tax", { exportRateBp: Math.round(Number(e.target.value) * 100) })} /></Field>
        </div>
      </Card>
      <Card title="Invoices and reminders">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Number prefix"><Input value={i.numberPrefix} onChange={(e) => up("invoices", { numberPrefix: e.target.value })} /></Field>
          <Field label="Default due days"><Input type="number" min={0} value={i.defaultDueDays} onChange={(e) => up("invoices", { defaultDueDays: Number(e.target.value) })} /></Field>
          <Field label="Invoice design"><Select value={i.template} onChange={(e) => up("invoices", { template: e.target.value })}><option value="classic">Classic: coloured header bar</option><option value="modern">Modern: large title and accent band</option><option value="minimal">Minimal: black and white</option></Select></Field>
          <Field label="Due soon (days before)" hint="Each project can override this"><Input type="number" min={0} max={60} value={i.dueSoonDays} onChange={(e) => up("invoices", { dueSoonDays: Number(e.target.value) })} /></Field>
        </div>
        <div className="mt-4 grid gap-3">
          <Checkbox label="Email the client a reminder when an invoice is due soon" checked={i.dueSoonClientEmail} onChange={(v) => up("invoices", { dueSoonClientEmail: v })} />
          <Checkbox label="Email new invoices to the client automatically" checked={i.emailInvoicesToClient} onChange={(v) => up("invoices", { emailInvoicesToClient: v })} />
          <div><div className="mb-1 text-sm font-semibold">Who is told about due soon and overdue invoices</div>
            <div className="flex flex-wrap gap-4">{[["billing_manager", "Billing Manager"], ["admin", "Admin"], ["project_manager", "Project Manager"]].map(([key, label]) => <Checkbox key={key} label={label} checked={i.dueSoonNotifyRoles.includes(key)} onChange={(v) => up("invoices", { dueSoonNotifyRoles: v ? [...i.dueSoonNotifyRoles, key] : i.dueSoonNotifyRoles.filter((x: string) => x !== key) })} />)}</div>
          </div>
          <Field label="Invoice footer"><Textarea value={i.footer} onChange={(e) => up("invoices", { footer: e.target.value })} placeholder="Bank details, payment terms" /></Field>
        </div>
      </Card>
      <ErrorNote error={err} />
      <div><Button busy={busy} onClick={() => save(["tax", "invoices"])}>Save</Button></div>
    </div>
  );

  if (section === "signin") return (
    <Card title="Sign-in and security" className="max-w-3xl">
      <p className="mb-4 text-sm text-[var(--muted)]">Create an OAuth client ID (type: Web application) in Google Cloud Console and add <b>{window.location.origin}</b> as an authorised JavaScript origin. Paste the keys here and it works.</p>
      <div className="grid gap-4">
        <Checkbox label="Turn on Sign in with Google" checked={a.googleEnabled} onChange={(v) => up("auth", { googleEnabled: v })} />
        <Checkbox label="Require Google (password sign-in only for the company owner)" checked={a.googleRequired} onChange={(v) => up("auth", { googleRequired: v })} />
        <Field label="Client ID"><Input value={a.googleClientId} onChange={(e) => up("auth", { googleClientId: e.target.value })} /></Field>
        <Field label="Client secret" hint="Stored encrypted"><Input type="password" value={a.googleClientSecret} onChange={(e) => up("auth", { googleClientSecret: e.target.value })} /></Field>
        <Field label="Allowed email domains" hint="Comma separated, e.g. acme.com. Blank = any invited email."><Input value={a.allowedEmailDomains.join(", ")} onChange={(e) => up("auth", { allowedEmailDomains: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></Field>
      </div>
      <SecurityFields a={a} up={up} />
      <ErrorNote error={err} />
      <Button className="mt-5" busy={busy} onClick={() => save(["auth"])}>Save</Button>
    </Card>
  );

  return <Backups s={s} up={up} save={() => save(["backups"])} busy={busy} err={err} />;
}

function Backups({ s, up, save, busy, err }: any) {
  const k = s.backups;
  const toast = useToast();
  const list = useQuery({ queryKey: ["backups"], queryFn: () => get<any[]>("/backups"), refetchInterval: 10_000 });
  const [e2, setE2] = useState<unknown>(null);
  return (
    <div className="grid max-w-3xl gap-5">
      <Card title="Backups to your own storage">
        <p className="mb-4 text-sm text-[var(--muted)]">Paste the keys of any S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, Wasabi). eszy sends a compressed copy of all your company's data on schedule, encrypted with your passphrase.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Checkbox label="Turn on scheduled backups" checked={k.enabled} onChange={(v) => up("backups", { enabled: v })} /></div>
          <Field label="Storage provider" hint={BACKUP_HINTS[k.provider]}><Select value={k.provider} onChange={(e) => up("backups", { provider: e.target.value })}><option value="s3">AWS S3</option><option value="r2">Cloudflare R2</option><option value="b2">Backblaze B2</option><option value="wasabi">Wasabi</option><option value="gcs">Google Cloud Storage</option><option value="other">Other S3-compatible</option></Select></Field>
          <Field label="Bucket"><Input value={k.bucket} onChange={(e) => up("backups", { bucket: e.target.value })} /></Field>
          <Field label="Region"><Input value={k.region} onChange={(e) => up("backups", { region: e.target.value })} /></Field>
          <Field label="Endpoint" hint="Blank for AWS S3. Google Cloud Storage: https://storage.googleapis.com"><Input value={k.endpoint} onChange={(e) => up("backups", { endpoint: e.target.value })} placeholder="https://<account>.r2.cloudflarestorage.com" /></Field>
          <Field label="Schedule"><Select value={k.schedule} onChange={(e) => up("backups", { schedule: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option></Select></Field>
          <Field label="Access key ID"><Input value={k.accessKeyId} onChange={(e) => up("backups", { accessKeyId: e.target.value })} /></Field>
          <Field label="Secret access key" hint="Stored encrypted"><Input type="password" value={k.secretAccessKey} onChange={(e) => up("backups", { secretAccessKey: e.target.value })} /></Field>
          <Field label="Encryption passphrase" hint="Keep it safe: you need it to restore. Stored encrypted." className="sm:col-span-2"><Input type="password" value={k.encryptionPassphrase} onChange={(e) => up("backups", { encryptionPassphrase: e.target.value })} /></Field>
        </div>
        <ErrorNote error={err ?? e2} />
        <div className="mt-5 flex flex-wrap gap-2">
          <Button busy={busy} onClick={save}>Save</Button>
          <Button variant="outline" onClick={async () => { setE2(null); try { const r = await post("/backups/test"); toast(r.message); } catch (x) { setE2(x); } }}>Test connection</Button>
          <Button variant="outline" onClick={async () => { setE2(null); try { const r = await post("/backups/run"); toast(r.message); list.refetch(); } catch (x) { setE2(x); } }}>Back up now</Button>
        </div>
      </Card>
      <RestoreCard />
      <Card title="Recent backups">
        <Table head={["Started", "Status", "File", "Size"]} empty="No backups yet.">
          {(list.data ?? []).map((b) => <tr key={b.id}><td>{new Date(b.started_at).toLocaleString()}</td><td><Pill status={b.status} /></td><td className="max-w-xs truncate text-[13px]">{b.object_key ?? b.error ?? "—"}</td><td className="tabnum">{b.size_bytes ? `${(b.size_bytes / 1024).toFixed(0)} KB` : "—"}</td></tr>)}
        </Table>
      </Card>
    </div>
  );
}

export function Permissions() {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => get<any[]>("/roles") });
  const catalog = useQuery({ queryKey: ["permissions"], queryFn: () => get("/permissions") });
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; permissions: string[] } | null>(null);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const role = roles.data?.find((r) => r.id === (sel ?? roles.data?.[0]?.id));
  useEffect(() => { if (role) setDraft({ name: role.name, permissions: role.permissions }); }, [role?.id, roles.data]); // eslint-disable-line
  if (!roles.data || !catalog.data || !role || !draft) return <Spinner />;
  const groups = Object.entries(catalog.data.permissions as Record<string, string>).reduce<Record<string, [string, string][]>>((a, [k, v]) => { const g = k.split(".")[0]; (a[g] ??= []).push([k, v]); return a; }, {});
  const save = async () => { setErr(null); try { await put(`/roles/${role.id}`, role.key === "admin" ? { name: draft.name } : draft); toast("Role saved"); qc.invalidateQueries({ queryKey: ["roles"] }); } catch (e) { setErr(e); } };
  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <Card title="Roles">
        <ul className="grid gap-1">
          {roles.data.map((r) => <li key={r.id}><button onClick={() => setSel(r.id)} className={`flex w-full justify-between rounded-lg px-3 py-2 text-left ${r.id === role.id ? "bg-[var(--brand)] text-white" : "hover:bg-black/5"}`}><span>{r.name}</span><span className="text-sm opacity-70">{r.user_count}</span></button></li>)}
        </ul>
        <div className="mt-4 flex gap-2"><Input placeholder="New role name" value={newName} onChange={(e) => setNewName(e.target.value)} /><Button size="sm" disabled={!newName} onClick={async () => { const r = await post("/roles", { name: newName, permissions: ["dashboard.view", "time.own", "leave.request"] }); setNewName(""); await qc.invalidateQueries({ queryKey: ["roles"] }); setSel(r.id); }}>Add</Button></div>
      </Card>
      <Card title={<Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="text-lg font-bold" />} actions={<div className="flex gap-2"><Button onClick={save}>Save role</Button>{!role.is_system && <Button variant="ghost" onClick={async () => { try { await del(`/roles/${role.id}`); setSel(null); qc.invalidateQueries({ queryKey: ["roles"] }); } catch (e) { setErr(e); } }}>Delete</Button>}</div>}>
        {role.key === "admin" && <p className="mb-3 rounded-lg bg-[#e3ecff] p-3 text-sm text-[#2747a8]">Admin always has every permission. You can rename it.</p>}
        <ErrorNote error={err} />
        <div className="grid gap-5 md:grid-cols-2">
          {Object.entries(groups).map(([g, items]) => (
            <fieldset key={g}><legend className="mb-2 text-sm font-bold capitalize">{g.replace("_", " ")}</legend>
              <div className="grid gap-2">{items.map(([k, label]) => <Checkbox key={k} label={label} hint={k === "money.view" ? "Amounts, rates, revenue, costs and payment status" : undefined} checked={draft.permissions.includes(k)} onChange={(v) => role.key !== "admin" && setDraft({ ...draft, permissions: v ? [...draft.permissions, k] : draft.permissions.filter((x) => x !== (k as Permission)) })} />)}</div>
            </fieldset>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ImportCsv() {
  const [entity, setEntity] = useState("clients");
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const run = async (dry: boolean) => {
    const f = file.current?.files?.[0];
    if (!f) return;
    setBusy(true); setErr(null);
    const form = new FormData(); form.append("file", f);
    try { setRes(await api(`/import/${entity}${dry ? "?dryRun=1" : ""}`, { form })); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Card title="Import from CSV" className="max-w-3xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What to import"><Select value={entity} onChange={(e) => { setEntity(e.target.value); setRes(null); }}><option value="users">People (sent invites)</option><option value="teams">Teams</option><option value="clients">Clients</option><option value="projects">Projects</option><option value="billing_lines">Billing lines</option><option value="tasks">Tasks</option><option value="leads">Leads</option><option value="holidays">Holidays</option><option value="leave_balances">Leave balances</option><option value="time">Past hours (approved)</option></Select></Field>
        <Field label="CSV file"><Input type="file" accept=".csv,text/csv" ref={file} /></Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => download(`/import/templates/${entity}`, `${entity}-template.csv`)}>Download template</Button>
        <Button variant="outline" busy={busy} onClick={() => run(true)}>Check file</Button>
        <Button busy={busy} onClick={() => run(false)}>Import</Button>
      </div>
      <ErrorNote error={err} />
      {res && (
        <div className="mt-4 rounded-xl border border-[var(--line)] p-4">
          <p className="font-semibold">{res.dryRun ? "Check:" : "Imported:"} {res.created} of {res.rows} rows {res.dryRun ? "are ready" : "added"}.</p>
          {res.errors.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-[#b4441f]">{res.errors.slice(0, 50).map((e: any) => <li key={e.row}>Line {e.row}: {e.message}</li>)}</ul>}
        </div>
      )}
    </Card>
  );
}

function Subscription() {
  const [params] = useSearchParams();
  const { money } = useSession();
  const q = useQuery({ queryKey: ["subscription"], queryFn: () => get("/subscription") });
  const [f, setF] = useState({ planCode: "", interval: "month", seats: 5, provider: "" });
  const [err, setErr] = useState<unknown>(null);
  const [cancel, setCancel] = useState(false);
  if (!q.data) return <Spinner />;
  const d = q.data;
  const sub = d.subscription;
  const priced = d.plans.filter((p: any) => p.price_month_minor > 0 || p.price_year_minor > 0);
  const online = d.providers.stripe || d.providers.razorpay;
  return (
    <div className="grid max-w-4xl gap-5">
      {params.get("paid") && <p className="rounded-lg bg-[#dff3ea] p-3 text-[#1c5e44]">Thanks. Your payment is being confirmed; the plan updates in a minute.</p>}
      <Card title="Your plan" actions={<Pill status={sub.tenant_status} />}>
        <div className="grid gap-3 sm:grid-cols-4">
          <div><div className="text-sm text-[var(--muted)]">Plan</div><div className="text-lg font-bold">{sub.plan_name}</div></div>
          <div><div className="text-sm text-[var(--muted)]">Seats</div><div className="text-lg font-bold">{sub.seats}</div></div>
          <div><div className="text-sm text-[var(--muted)]">Billed</div><div className="text-lg font-bold">{sub.interval === "year" ? "Yearly" : "Monthly"}</div></div>
          <div><div className="text-sm text-[var(--muted)]">{sub.status === "trialing" ? "Trial ends" : "Renews"}</div><div className="text-lg font-bold">{sub.status === "trialing" ? new Date(sub.trial_ends_at).toLocaleDateString() : sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : "—"}</div></div>
        </div>
        <p className="mt-4 text-sm text-[var(--muted)]">If a renewal fails you keep full access for 7 days, then the panel is read-only for 14 days, then suspended. After cancelling, your data is kept for 3 months so you can export it.</p>
      </Card>
      {priced.length > 0 && online ? (
        <Card title="Change or renew">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Plan"><Select value={f.planCode} onChange={(e) => setF({ ...f, planCode: e.target.value })}><option value="">Pick…</option>{priced.map((p: any) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select></Field>
            <Field label="Billing"><Select value={f.interval} onChange={(e) => setF({ ...f, interval: e.target.value })}><option value="month">Monthly</option><option value="year">Yearly</option></Select></Field>
            <Field label="Seats"><Input type="number" min={1} value={f.seats} onChange={(e) => setF({ ...f, seats: Number(e.target.value) })} /></Field>
            <Field label="Pay with"><Select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}><option value="">Best for my country</option>{d.providers.razorpay && <option value="razorpay">Razorpay</option>}{d.providers.stripe && <option value="stripe">Stripe</option>}</Select></Field>
          </div>
          {f.planCode && (() => { const p = priced.find((x: any) => x.code === f.planCode); const unit = f.interval === "year" ? p.price_year_minor : p.price_month_minor; return <p className="mt-3 font-semibold tabnum">{money(unit * f.seats)} per {f.interval} ({money(unit)} × {f.seats} seats), plus tax</p>; })()}
          <ErrorNote error={err} />
          <Button className="mt-4" disabled={!f.planCode} onClick={async () => { setErr(null); try { const r = await post("/subscription/checkout", { ...f, provider: f.provider || undefined }); window.location.href = r.url; } catch (e) { setErr(e); } }}>Continue to payment</Button>
        </Card>
      ) : (
        <Card title="Change your plan">
          <p>Plans are priced by our team for now. Write to <a className="font-semibold underline" href={`mailto:${d.salesEmail}?subject=${encodeURIComponent("eszy plan change")}`}>{d.salesEmail}</a> with the features and number of seats you need.</p>
        </Card>
      )}
      <EszyInvoices invoices={d.invoices} />
      {sub.tenant_status !== "cancelled" && <div><Button variant="ghost" onClick={() => setCancel(true)}>Cancel subscription</Button></div>}
      <Modal open={cancel} onClose={() => setCancel(false)} title="Cancel your eszy plan?">
        <p className="mb-4">Your plan ends at the end of the period you've paid for. Your data is kept for 3 months after that, so you can export it or come back.</p>
        <Button variant="danger" onClick={async () => { await post("/subscription/cancel"); setCancel(false); q.refetch(); }}>Cancel subscription</Button>
      </Modal>
      <DangerZone />
    </div>
  );
}

function Audit() {
  return <ActivityLog />;
}
