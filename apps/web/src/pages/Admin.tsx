import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Columns3, IdCard, KeyRound, ListTree, MessagesSquare, Plus, Radar, Search, ShieldCheck, Trash2, UserCog, Users } from "lucide-react";
import type { Permission } from "@eszy/shared";
import { del, get, post, put } from "../lib/api";
import { useSession } from "../lib/session";
import { AccessEditor } from "../components/AccessEditor";
import { ActivityLog } from "../components/ActivityLog";
import { Person } from "../components/Avatar";
import { Button, Card, DataTable, ErrorNote, Input, PageHeader, Segmented, Select, SideNavLayout, Spinner, cx, useConfirm, useToast } from "../components/ui";
import { MASTER_INFO, MasterTable } from "./SettingsExtra";

// =====================================================================================================
// Masters and onboarding
// =====================================================================================================
const MASTERS = [
  { id: "activity-types", label: "Work types", icon: <ListTree /> },
  { id: "project-sources", label: "Onboarding sources", icon: <Radar /> },
  { id: "project-accounts", label: "Onboarding accounts", icon: <IdCard /> },
  { id: "communication-types", label: "Communication types", icon: <MessagesSquare /> },
  { id: "project-stages", label: "Project stages", icon: <Columns3 /> },
];
export function MastersPage() {
  const { list } = useParams();
  const nav = useNavigate();
  const id = MASTERS.some((m) => m.id === list) ? list! : MASTERS[0].id;
  const m = MASTERS.find((x) => x.id === id)!;
  return (
    <>
      <PageHeader title="Masters and onboarding" sub="The lists people pick from across eszy: on sheets, clients, projects and the project board." />
      <SideNavLayout groups={[{ label: "Lists", items: MASTERS }]} value={id} onChange={(x) => nav(`/masters/${x}`)}>
        <h2 className="mb-1 text-[18px] font-bold">{m.label}</h2>
        <MasterTable key={id} id={id} />
      </SideNavLayout>
    </>
  );
}
void MASTER_INFO;

// =====================================================================================================
// Roles and permissions
// =====================================================================================================
const GROUP_LABEL: Record<string, string> = {
  dashboard: "Dashboard", users: "People", roles: "Roles and permissions", teams: "Teams", settings: "Settings", masters: "Masters and onboarding", subscription: "Subscription",
  leads: "Leads", clients: "Clients", projects: "Projects", tasks: "Tasks", time: "Timesheets", leave: "Leave", invoices: "Invoices", payments: "Payments", refunds: "Refunds",
  money: "Amounts and rates", expenses: "Expenses", reports: "Reports", performance: "Performance", import_export: "Import and export", audit: "Change history",
  assets: "Accessories", events: "Calendar events", standup: "Standups",
};

export function RolesPage() {
  const { can } = useSession();
  const [view, setView] = useState<"roles" | "people">("roles");
  return (
    <>
      <PageHeader title="Roles and permissions" sub="Roles give a set of permissions. You can also change one person's access without changing their role."
        actions={<Segmented value={view} onChange={setView} options={[{ id: "roles", label: <span className="flex items-center gap-1.5"><ShieldCheck className="size-4" />By role</span> }, { id: "people", label: <span className="flex items-center gap-1.5"><Users className="size-4" />By person</span> }]} />} />
      {view === "roles" ? <ByRole editable={can("roles.manage")} /> : <ByPerson editable={can("roles.manage")} />}
    </>
  );
}

function ByRole({ editable }: { editable: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => get<any[]>("/roles") });
  const catalog = useQuery({ queryKey: ["permissions"], queryFn: () => get("/permissions") });
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; permissions: string[] } | null>(null);
  const [newName, setNewName] = useState("");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "on" | "off">("all");
  const [err, setErr] = useState<unknown>(null);
  const role = roles.data?.find((r) => r.id === (sel ?? roles.data?.[0]?.id));
  useEffect(() => { if (role) setDraft({ name: role.name, permissions: role.permissions }); }, [role?.id, roles.data]); // eslint-disable-line
  const groups = useMemo(() => Object.entries((catalog.data?.permissions ?? {}) as Record<string, string>).reduce<Record<string, [string, string][]>>((a, [k, v]) => { const g = k.split(".")[0]; (a[g] ??= []).push([k, v]); return a; }, {}), [catalog.data]);
  if (!roles.data || !catalog.data || !role || !draft) return <Spinner />;
  const isAdmin = role.key === "admin";
  const locked = !editable || isAdmin;
  const has = (k: string) => isAdmin || draft.permissions.includes(k);
  const setMany = (ks: string[], on: boolean) => setDraft({ ...draft, permissions: on ? [...new Set([...draft.permissions, ...ks])] : draft.permissions.filter((x) => !ks.includes(x)) });
  const t = q.trim().toLowerCase();
  const shownGroups = Object.entries(groups).map(([g, items]) => [g, items.filter(([k, label]) => (!t || `${label} ${GROUP_LABEL[g] ?? g} ${k}`.toLowerCase().includes(t)) && (only === "all" || (only === "on") === has(k)))] as const).filter(([, items]) => items.length);
  const total = Object.values(groups).flat().length;
  const dirty = draft.name !== role.name || JSON.stringify([...draft.permissions].sort()) !== JSON.stringify([...role.permissions].sort());
  const save = async () => { setErr(null); try { await put(`/roles/${role.id}`, isAdmin ? { name: draft.name } : draft); toast("Role saved"); qc.invalidateQueries({ queryKey: ["roles"] }); } catch (e) { setErr(e); } };
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8">
      <div className="lg:sticky lg:top-24 lg:self-start">
        <Card pad={false} className="p-2.5">
          <p className="px-3 pb-1.5 pt-1 text-[12px] font-semibold text-[var(--muted)]">Roles</p>
          <ul className="grid max-h-[calc(100vh-16rem)] gap-0.5 overflow-y-auto scrollbar-thin">
            {roles.data.map((r) => (
              <li key={r.id}>
                <button onClick={() => setSel(r.id)} className={cx("flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-[14px] font-medium transition", r.id === role.id ? "bg-[var(--brand-soft)] text-[var(--brand)] ring-1 ring-[var(--brand-2)]/25 dark:text-white" : "text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]")}>
                  <span className="truncate">{r.name}</span>
                  <span className="flex items-center gap-1 text-[12px] tabnum opacity-80"><Users className="size-3.5" />{r.user_count}</span>
                </button>
              </li>
            ))}
          </ul>
          {editable && (
            <form className="mt-2 flex gap-2 border-t border-[var(--line)] px-1 pt-3" onSubmit={async (e) => { e.preventDefault(); if (!newName.trim()) return; const r = await post("/roles", { name: newName.trim(), permissions: ["dashboard.view", "time.own", "leave.request"] }); setNewName(""); await qc.invalidateQueries({ queryKey: ["roles"] }); setSel(r.id); }}>
              <Input placeholder="New role name" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-9" />
              <Button size="sm" type="submit" disabled={!newName.trim()} className="h-9"><Plus />Add</Button>
            </form>
          )}
        </Card>
      </div>
      <div className="min-w-0">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)] dark:text-white"><KeyRound className="size-5" /></span>
              <div className="min-w-0">
                <Input value={draft.name} disabled={!editable} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-9 w-64 max-w-full text-[16px] font-bold" aria-label="Role name" />
                <p className="mt-1 text-[12.5px] text-[var(--muted)]">{isAdmin ? "Admin always has every permission. You can rename it." : `${draft.permissions.length} of ${total} permissions · ${role.user_count} ${role.user_count === 1 ? "person" : "people"}`}</p>
              </div>
            </div>
            {editable && (
              <div className="flex gap-2">
                {!role.is_system && <Button variant="ghost" onClick={async () => { if (await confirm({ title: `Delete ${role.name}?`, body: "People with only this role lose its permissions.", confirm: "Delete role" }) === false) return; try { await del(`/roles/${role.id}`); setSel(null); qc.invalidateQueries({ queryKey: ["roles"] }); } catch (e) { setErr(e); } }}><Trash2 />Delete</Button>}
                <Button onClick={save} disabled={!dirty}>Save role</Button>
              </div>
            )}
          </div>
          <ErrorNote error={err} />
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <label className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search permissions" className="pl-9" /></label>
            <Select value={only} onChange={(e) => setOnly(e.target.value as any)} className="w-44" aria-label="Show"><option value="all">All permissions</option><option value="on">Only what it has</option><option value="off">Only what it lacks</option></Select>
          </div>
        </Card>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {shownGroups.map(([g, items]) => {
            const ks = items.map(([k]) => k);
            const n = ks.filter(has).length;
            return (
              <Card key={g} pad={false}>
                <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
                  <h3 className="text-[14px] font-bold">{GROUP_LABEL[g] ?? g}<span className="ml-2 text-[12px] font-semibold text-[var(--muted)] tabnum">{n}/{ks.length}</span></h3>
                  {!locked && <div className="flex gap-1 text-[12.5px] font-semibold"><button className="rounded-md px-2 py-0.5 text-[var(--brand)] hover:bg-[var(--brand-soft)] dark:text-[var(--accent)]" onClick={() => setMany(ks, true)}>All</button><button className="rounded-md px-2 py-0.5 text-[var(--muted)] hover:bg-[var(--bg)]" onClick={() => setMany(ks, false)}>None</button></div>}
                </div>
                <ul className="grid gap-0.5 p-2">
                  {items.map(([k, label]) => (
                    <li key={k}>
                      <label className={cx("flex items-start gap-3 rounded-lg px-2.5 py-2 text-[13.5px] transition", locked ? "cursor-default" : "cursor-pointer hover:bg-[var(--bg)]")}>
                        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" disabled={locked} checked={has(k)} onChange={(e) => setMany([k], e.target.checked)} />
                        <span className="min-w-0"><span className="block">{label}</span>{k === "money.view" && <span className="block text-[12px] text-[var(--muted)]">Amounts, rates, revenue, costs and payment status</span>}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
          {!shownGroups.length && <p className="text-[14px] text-[var(--muted)]">No permission matches.</p>}
        </div>
        {editable && dirty && (
          <div className="sticky bottom-4 z-20 mt-5 flex items-center justify-between gap-3 rounded-2xl border border-[var(--brand-2)]/30 bg-[var(--card)]/95 px-4 py-3 shadow-[0_20px_40px_-20px_rgb(109_40_217/.5)] backdrop-blur">
            <span className="text-[13.5px] font-semibold">Unsaved changes to {draft.name}</span>
            <div className="flex gap-2"><Button variant="secondary" size="sm" onClick={() => setDraft({ name: role.name, permissions: role.permissions })}>Discard</Button><Button size="sm" onClick={save}>Save role</Button></div>
          </div>
        )}
      </div>
    </div>
  );
}

const LEVEL: Record<string, { label: string; cls: string }> = {
  edit: { label: "Edit", cls: "bg-[var(--brand-soft)] text-[var(--brand)] dark:text-white" },
  view: { label: "View", cls: "bg-[#e5eefb] text-[#24529a] dark:bg-[#24529a]/30 dark:text-[#9fc1f2]" },
  hidden: { label: "Hidden", cls: "bg-black/5 text-[var(--muted)] dark:bg-white/10" },
};
function ByPerson({ editable }: { editable: boolean }) {
  const q = useQuery({ queryKey: ["access-overview"], queryFn: () => get<any>("/access/overview") });
  const [role, setRole] = useState("");
  const [team, setTeam] = useState("");
  const [mod, setMod] = useState("");
  const [level, setLevel] = useState("");
  const [changed, setChanged] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading || !q.data) return <Spinner />;
  const { modules, people } = q.data as { modules: any[]; people: any[] };
  const roleOpts: [string, string][] = [...new Map<string, string>(people.flatMap((p) => p.roles.map((r: any) => [r.id, r.name] as [string, string]))).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const teams = [...new Set(people.map((p) => p.team_name).filter(Boolean))].sort() as string[];
  const m = modules.find((x) => x.key === mod);
  const rows = people.filter((p) => (!role || p.roles.some((r: any) => r.id === role)) && (!team || p.team_name === team) && (!m || !level || p.access[m.key] === level) && (!changed || (changed === "yes") === p.overrides > 0));
  const groups = [...new Set<string>(modules.map((x) => x.group))];
  return (
    <>
      <DataTable rows={rows} rowKey={(p: any) => p.id} exportName="access-by-person" searchPlaceholder="Search name, email or role" tableId="access-by-person"
        filters={<>
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-44" aria-label="Role"><option value="">Any role</option>{roleOpts.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
          <Select value={team} onChange={(e) => setTeam(e.target.value)} className="w-40" aria-label="Team"><option value="">Any team</option>{teams.map((t) => <option key={t}>{t}</option>)}</Select>
          <Select value={mod} onChange={(e) => { setMod(e.target.value); if (!e.target.value) setLevel(""); }} className="w-52" aria-label="Module">
            <option value="">Access to… (pick a module)</option>
            {groups.map((g) => <optgroup key={g} label={g}>{modules.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>)}
          </Select>
          {m && <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-32" aria-label="Level"><option value="">Any level</option>{m.edit && <option value="edit">Edit</option>}{m.view && <option value="view">View</option>}<option value="hidden">Hidden</option></Select>}
          <Select value={changed} onChange={(e) => setChanged(e.target.value)} className="w-48" aria-label="Personal changes"><option value="">With or without changes</option><option value="yes">Changed for this person</option><option value="no">Exactly as their role</option></Select>
        </>}
        columns={[
          { key: "n", header: "Person", cell: (p: any) => <Person id={p.id} name={p.name} sub={p.designation || p.email} size={30} />, sort: (p: any) => p.name, text: (p: any) => `${p.name} ${p.email} ${p.roles.map((r: any) => r.name).join(" ")}` },
          { key: "r", header: "Roles", cell: (p: any) => p.is_owner ? <span className="rounded-md bg-[var(--brand-soft)] px-2 py-0.5 text-[12px] font-semibold text-[var(--brand)] dark:text-white">Owner</span> : <span className="flex gap-1">{p.roles.map((r: any) => <span key={r.id} className="rounded-md bg-black/5 px-2 py-0.5 text-[12px] font-semibold dark:bg-white/10">{r.name}</span>)}</span>, sort: (p: any) => p.roles.map((r: any) => r.name).join(","), text: (p: any) => p.roles.map((r: any) => r.name).join(", ") },
          { key: "t", header: "Team", cell: (p: any) => p.team_name ?? "—", sort: (p: any) => p.team_name ?? "", text: (p: any) => p.team_name ?? "" },
          ...(m ? [{ key: "lvl", header: m.label, cell: (p: any) => <span className={cx("rounded-md px-2 py-0.5 text-[12px] font-semibold", LEVEL[p.access[m.key]].cls)}>{LEVEL[p.access[m.key]].label}</span>, sort: (p: any) => p.access[m.key], text: (p: any) => p.access[m.key] }] : []),
          { key: "edit", header: "Can edit", cell: (p: any) => { const n = modules.filter((x) => p.access[x.key] === "edit").length; return <span className="tabnum">{n} of {modules.filter((x) => x.edit).length} modules</span>; }, sort: (p: any) => modules.filter((x) => p.access[x.key] === "edit").length },
          { key: "o", header: "Personal changes", cell: (p: any) => p.overrides ? <span className="rounded-md bg-[#fdf0d9] px-2 py-0.5 text-[12px] font-semibold text-[#7d4c00] dark:bg-[#7d4c00]/30 dark:text-[#f5c879]">{p.overrides} changed</span> : <span className="text-[var(--muted)]">As role</span>, sort: (p: any) => p.overrides },
          { key: "x", header: "", cell: (p: any) => <Button size="sm" variant="secondary" disabled={p.is_owner} onClick={() => setOpen(p.id)}><UserCog />{editable ? "Change access" : "See access"}</Button> },
        ]} />
      {open && <AccessEditor userId={open} open onClose={() => { setOpen(null); q.refetch(); }} />}
    </>
  );
}
export type { Permission };

/** Everything everyone did, newest first, with filters. */
export function ActivityPage() {
  return (
    <>
      <PageHeader title="Activity" sub="Who did what and when, across the company. Open any line to see exactly what changed." />
      <ActivityLog />
    </>
  );
}
