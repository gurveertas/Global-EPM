import { DeactivateButton } from "../components/Deactivate";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, ShieldCheck, Trash2, Upload, UserPlus, Users } from "lucide-react";
import { AccessEditor } from "../components/AccessEditor";
import { api, del, download, post, put } from "../lib/api";
import { useSession } from "../lib/session";
import { EMPLOYMENT, opts, useAction, useDepartments, useRoles, useTeams, useUsers, userOpts } from "../lib/hooks";
import {
  Button, Card, Combobox, DataTable, Drawer, Empty, ErrorNote, Field, Input, Modal, MoneyInput, MultiSelect, PageHeader, Pill, Segmented, Select, Spinner,
  Stat, StatGrid, Tabs, fmtDate, useConfirm, useToast, type Column,
} from "../components/ui";
import { Person } from "../components/Avatar";

export function People() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "people";
  const users = useUsers();
  const teams = useTeams();
  const depts = useDepartments();
  return (
    <>
      <PageHeader title="Employees and teams" sub="Everyone in the company, their teams and departments. Open a person to see their hours, projects, leave and accessories." />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { id: "people", label: "Employees", count: users.data?.filter((u) => u.status !== "disabled").length },
        { id: "teams", label: "Teams", count: teams.data?.length },
        { id: "departments", label: "Departments", count: depts.data?.length },
      ]} />
      {tab === "people" && <Employees />}
      {tab === "teams" && <Teams />}
      {tab === "departments" && <Departments />}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ employees
function Employees() {
  const { can } = useSession();
  const nav = useNavigate();
  const users = useUsers();
  const teams = useTeams();
  const depts = useDepartments();
  const roles = useRoles();
  const [status, setStatus] = useState("active");
  const [emp, setEmp] = useState("");
  const [team, setTeam] = useState("");
  const [dept, setDept] = useState("");
  const [role, setRole] = useState("");
  const [edit, setEdit] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);
  const [accessFor, setAccessFor] = useState<string | null>(null);
  const all = users.data ?? [];
  const rows = all.filter((u) =>
    (status === "all" || (status === "active" ? u.status !== "disabled" : u.status === status)) &&
    (!emp || u.employment_status === emp) && (!team || u.team_id === team) && (!dept || u.department_id === dept) && (!role || u.roles?.some((r: any) => r.id === role)));
  const count = (f: (u: any) => boolean) => all.filter(f).length;
  const cols: Column<any>[] = [
    { key: "name", header: "Employee", cell: (u) => <Person id={u.id} name={u.name} sub={u.email} hasPhoto={u.has_photo} />, sort: (u) => u.name.toLowerCase(), text: (u) => `${u.name} ${u.email} ${u.phone}` },
    { key: "code", header: "Employee ID", cell: (u) => u.employee_code || <span className="text-[var(--muted)]">—</span>, sort: (u) => u.employee_code, text: (u) => u.employee_code },
    { key: "designation", header: "Designation", cell: (u) => <>{u.designation || "—"}{u.department_name && <div className="text-[12.5px] text-[var(--muted)]">{u.department_name}</div>}</>, sort: (u) => u.designation, text: (u) => `${u.designation} ${u.department_name ?? ""}` },
    { key: "team", header: "Team", cell: (u) => u.team_name ?? <span className="text-[var(--muted)]">No team</span>, sort: (u) => u.team_name ?? "", text: (u) => u.team_name ?? "" },
    { key: "manager", header: "Reporting manager", cell: (u) => u.reporting_manager_name ?? "—", sort: (u) => u.reporting_manager_name ?? "", text: (u) => u.reporting_manager_name ?? "" },
    { key: "roles", header: "Roles", cell: (u) => <div className="flex flex-wrap gap-1">{u.roles.map((r: any) => <span key={r.id} className="rounded-md bg-black/5 px-1.5 py-0.5 text-[12px] font-medium dark:bg-white/10">{r.name}</span>)}</div>, text: (u) => u.roles.map((r: any) => r.name).join(" ") },
    { key: "joined", header: "Joined", cell: (u) => fmtDate(u.joined_on), sort: (u) => u.joined_on ?? "", text: (u) => u.joined_on ?? "" },
    { key: "status", header: "Status", cell: (u) => <div className="flex flex-wrap gap-1"><Pill status={u.employment_status} />{u.status !== "active" && <Pill status={u.status} />}</div>, sort: (u) => u.employment_status, text: (u) => `${u.employment_status} ${u.status}` },
    { key: "act", header: "", cell: (u) => <span className="inline-flex">
      {can("roles.manage") && !u.is_owner && <Button size="sm" variant="ghost" title="Permissions" onClick={(e) => { e.stopPropagation(); setAccessFor(u.id); }} aria-label={`Permissions for ${u.name}`}><ShieldCheck /></Button>}
      {can("users.manage") && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEdit(u); }} aria-label={`Edit ${u.name}`}><Pencil /></Button>}
      {can("users.manage") && <DeactivateButton user={u} iconOnly />}
    </span> },
  ];
  return (
    <>
      <StatGrid cols={5}>
        <Stat label="Active employees" value={count((u) => u.status === "active")} onClick={() => { setStatus("active"); setEmp(""); }} active={status === "active" && !emp} />
        <Stat label="Provisional" value={count((u) => u.employment_status === "provisional" && u.status !== "disabled")} onClick={() => { setStatus("active"); setEmp("provisional"); }} active={emp === "provisional"} />
        <Stat label="Serving notice" value={count((u) => u.employment_status === "notice" && u.status !== "disabled")} tone="amber" onClick={() => { setStatus("active"); setEmp("notice"); }} active={emp === "notice"} />
        <Stat label="Invited, not joined yet" value={count((u) => u.status === "invited")} onClick={() => { setStatus("invited"); setEmp(""); }} active={status === "invited"} />
        <Stat label="Inactive" value={count((u) => u.status === "disabled")} onClick={() => { setStatus("disabled"); setEmp(""); }} active={status === "disabled"} />
      </StatGrid>
      <DataTable rows={rows} columns={cols} rowKey={(u) => u.id} loading={users.isLoading} searchPlaceholder="Search name, email, ID, phone" exportName="employees"
        onRowClick={(u) => nav(`/people/${u.id}`)} empty="No employees match these filters."
        filters={<>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36" aria-label="Account"><option value="active">Not inactive</option><option value="invited">Invited</option><option value="disabled">Inactive</option><option value="all">Everyone</option></Select>
          <Select value={emp} onChange={(e) => setEmp(e.target.value)} className="w-40" aria-label="Employment"><option value="">Any employment</option>{EMPLOYMENT.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
          <Select value={team} onChange={(e) => setTeam(e.target.value)} className="w-36" aria-label="Team"><option value="">All teams</option>{teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-40" aria-label="Department"><option value="">All departments</option>{depts.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          <div className="w-48"><Combobox value={role || null} onChange={(x) => setRole(x ?? "")} options={opts(roles.data)} placeholder="All roles" /></div>
        </>}
        actions={can("users.manage") && <>
          {can("import_export") && <Button variant="secondary" size="sm" onClick={() => setImporting(true)}><Upload />Import</Button>}
          <Button size="sm" onClick={() => setEdit({})}><UserPlus />Add employee</Button>
        </>} />
      <EmployeeForm open={!!edit} user={edit} onClose={() => setEdit(null)} />
      <ImportModal open={importing} onClose={() => setImporting(false)} entity="users" title="Import employees" invalidate={["users"]} />
      {accessFor && <AccessEditor userId={accessFor} open onClose={() => setAccessFor(null)} />}
    </>
  );
}

/** Add or edit an employee. New people get an invite email, or the admin sets their password straight away. */
export function EmployeeForm({ open, user, onClose }: { open: boolean; user: any; onClose: () => void }) {
  const { can, me } = useSession();
  const roles = useRoles(open);
  const teams = useTeams(open);
  const depts = useDepartments(open);
  const users = useUsers(open);
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = !user?.id;
  const [f, setF] = useState<any>(null);
  const [mode, setMode] = useState<"invite" | "password">("invite");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const v = f ?? {
    name: user?.name ?? "", email: user?.email ?? "", phone: user?.phone ?? "", employeeCode: user?.employee_code ?? "", designation: user?.designation ?? "",
    roleIds: user?.roles?.map((r: any) => r.id) ?? (roles.data ? [roles.data.find((r) => r.key === "employee")?.id].filter(Boolean) : []),
    teamId: user?.team_id ?? null, departmentId: user?.department_id ?? null, reportingManagerId: user?.reporting_manager_id ?? null,
    joinedOn: user?.joined_on ?? "", employmentStatus: user?.employment_status ?? "provisional", probationEndsOn: user?.probation_ends_on ?? "",
    noticeStartsOn: user?.notice_starts_on ?? "", lastWorkingDay: user?.last_working_day ?? "", inactiveFrom: user?.inactive_from ?? "",
    costPerHourMinor: user?.cost_per_hour_minor ?? null, dateOfBirth: user?.date_of_birth ?? "", address: user?.address ?? "",
    emergencyContactName: user?.emergency_contact_name ?? "", emergencyContactPhone: user?.emergency_contact_phone ?? "", password: "",
  };
  const set = (patch: any) => setF({ ...v, ...patch });
  const close = () => { setF(null); setErr(null); setInvite(null); setMode("invite"); onClose(); };
  const [anyManager, setAnyManager] = useState(false);
  const team = (teams.data ?? []).find((t: any) => t.id === v.teamId);
  // With a team picked, only that team's lead, manager and members are offered as reporting manager.
  const managerOpts = userOpts(users.data).filter((o) => o.value !== user?.id && (anyManager || !team || o.value === team.lead_user_id || o.value === team.manager_user_id || (users.data ?? []).find((u: any) => u.id === o.value)?.team_id === team.id || o.value === v.reportingManagerId));
  const addRole = async (name: string) => {
    const emp = roles.data?.find((r: any) => r.key === "employee");
    try {
      const r = await post<any>("/roles", { name, permissions: emp?.permissions ?? ["dashboard.view", "time.own", "leave.request"] });
      await qc.invalidateQueries({ queryKey: ["roles"] });
      toast(`Role “${r.name}” added`);
      return r.id as string;
    } catch (e: any) { toast(e?.message ?? "Couldn't add the role", "err"); return null; }
  };
  const save = async () => {
    setErr(null); setBusy(true);
    try {
      const body: any = { ...v };
      for (const k of ["joinedOn", "probationEndsOn", "noticeStartsOn", "lastWorkingDay", "inactiveFrom", "dateOfBirth"]) body[k] = body[k] || null;
      delete body.costPerHourMinor; // set by finance on Rates and profit → Staff cost
      if (isNew && mode === "invite") delete body.password;
      if (!isNew && !body.password) delete body.password;
      if (isNew) {
        const r = await post("/users", body);
        toast(`${v.name} added`);
        qc.invalidateQueries({ queryKey: ["users"] });
        if (r.inviteUrl) { setInvite(r.inviteUrl); setBusy(false); return; }
      } else {
        await put(`/users/${user.id}`, body);
        toast("Saved");
        qc.invalidateQueries({ queryKey: ["users"] }); qc.invalidateQueries({ queryKey: ["employee", user.id] });
      }
      close();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Drawer open={open} onClose={close} title={isNew ? "Add employee" : `Edit ${user?.name}`} width="max-w-2xl"
      footer={invite ? <Button onClick={close}>Done</Button> : <><Button variant="secondary" onClick={close}>Cancel</Button><Button busy={busy} onClick={save} disabled={!v.name || !v.email}>{isNew ? "Add employee" : "Save changes"}</Button></>}>
      {invite ? (
        <div className="grid gap-3">
          <p className="text-[14px]">We emailed {v.email} an invite. You can also send them this link (it works for 7 days):</p>
          <Input readOnly value={invite} onFocus={(e) => e.target.select()} />
        </div>
      ) : (
        <div className="grid gap-6">
          <section className="grid gap-4">
            <h3 className="text-[13px] font-bold text-[var(--muted)]">Basic details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" required><Input value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Jane Doe" /></Field>
              <Field label="Work email" required><Input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} placeholder="jane@company.com" /></Field>
              <Field label="Employee ID"><Input value={v.employeeCode} onChange={(e) => set({ employeeCode: e.target.value })} placeholder="e.g. TAS-042" /></Field>
              <Field label="Phone"><Input value={v.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="e.g. 98765 43210" /></Field>
              <Field label="Designation"><Input value={v.designation} onChange={(e) => set({ designation: e.target.value })} placeholder="e.g. Senior Developer" /></Field>
              <Field label="Date of birth"><Input type="date" value={v.dateOfBirth} onChange={(e) => set({ dateOfBirth: e.target.value })} /></Field>
            </div>
          </section>
          <section className="grid gap-4">
            <h3 className="text-[13px] font-bold text-[var(--muted)]">Role and reporting</h3>
            <Field label="Roles" hint={can("roles.manage") ? "Type a new role name and press Enter to add it (it starts with Employee access; set its permissions in Settings → Roles and permissions)." : "Roles decide what someone can see and do."}>
              <MultiSelect value={v.roleIds} onChange={(x) => set({ roleIds: x })} options={opts(roles.data)} placeholder="Add a role" onCreate={can("roles.manage") ? addRole : undefined} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Team"><Combobox value={v.teamId} onChange={(x) => set({ teamId: x })} options={opts(teams.data, "name", "lead_name")} placeholder="No team" /></Field>
              <Field label="Department"><Combobox value={v.departmentId} onChange={(x) => set({ departmentId: x })} options={opts(depts.data)} placeholder="No department" /></Field>
              <Field label="Reporting manager" info="Approves this person's sheets and leave. Blank uses the team's TL." hint={v.teamId ? (anyManager ? <button type="button" className="font-semibold text-[var(--brand)]" onClick={() => setAnyManager(false)}>Show only this team</button> : <>Showing this team's people. <button type="button" className="font-semibold text-[var(--brand)]" onClick={() => setAnyManager(true)}>Show everyone</button></>) : undefined}>
                <Combobox value={v.reportingManagerId} onChange={(x) => set({ reportingManagerId: x })} options={managerOpts} placeholder="The team's TL" />
              </Field>
            </div>
          </section>
          <section className="grid gap-4">
            <h3 className="text-[13px] font-bold text-[var(--muted)]">Employment</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Joining date"><Input type="date" value={v.joinedOn} onChange={(e) => set({ joinedOn: e.target.value })} /></Field>
              <Field label="Employment status"><Select value={v.employmentStatus} onChange={(e) => set({ employmentStatus: e.target.value })}>{EMPLOYMENT.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
              {v.employmentStatus === "provisional" && <Field label="Probation ends" hint={`Blank = ${me!.settings.policies.probationMonths} months after joining`}><Input type="date" value={v.probationEndsOn} onChange={(e) => set({ probationEndsOn: e.target.value })} /></Field>}
              {v.employmentStatus === "notice" && <Field label="Notice started"><Input type="date" value={v.noticeStartsOn} onChange={(e) => set({ noticeStartsOn: e.target.value })} /></Field>}
              {(v.employmentStatus === "notice" || v.employmentStatus === "inactive") && <Field label="Last working day"><Input type="date" value={v.lastWorkingDay} onChange={(e) => set({ lastWorkingDay: e.target.value })} /></Field>}
              {v.employmentStatus === "inactive" && <Field label="Inactive from" hint="They can't sign in from this date"><Input type="date" value={v.inactiveFrom} onChange={(e) => set({ inactiveFrom: e.target.value })} /></Field>}
            </div>
          </section>
          <section className="grid gap-4">
            <h3 className="text-[13px] font-bold text-[var(--muted)]">Contact and emergency</h3>
            <Field label="Address"><Input value={v.address} onChange={(e) => set({ address: e.target.value })} placeholder="Full address" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Emergency contact"><Input value={v.emergencyContactName} onChange={(e) => set({ emergencyContactName: e.target.value })} placeholder="Name and relation" /></Field>
              <Field label="Emergency phone"><Input value={v.emergencyContactPhone} onChange={(e) => set({ emergencyContactPhone: e.target.value })} /></Field>
            </div>
          </section>
          <section className="grid gap-3">
            <h3 className="text-[13px] font-bold text-[var(--muted)]">Sign-in</h3>
            {isNew && <Segmented value={mode} onChange={setMode} options={[{ id: "invite", label: "Email an invite" }, { id: "password", label: "Set a password now" }]} />}
            {(mode === "password" || !isNew) && (
              <Field label={isNew ? "Password" : "Set a new password"} hint={isNew ? "At least 8 characters. Share it with them safely." : "Leave blank to keep their current password."}>
                <Input type="password" autoComplete="new-password" value={v.password} onChange={(e) => set({ password: e.target.value })} placeholder="At least 8 characters" />
              </Field>
            )}
          </section>
          <ErrorNote error={err} />
        </div>
      )}
    </Drawer>
  );
}

/** CSV or Google Sheet import with a dry run first, for employees, clients and projects. */
export function ImportModal({ open, onClose, entity, title, invalidate }: { open: boolean; onClose: () => void; entity: string; title: string; invalidate: string[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [src, setSrc] = useState<"csv" | "sheet">("csv");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const send = async (dry: boolean) => {
    setErr(null); setBusy(true);
    try {
      let r;
      if (src === "csv") { const fd = new FormData(); fd.append("file", file!); r = await api(`/import/${entity}?dryRun=${dry ? 1 : 0}`, { method: "POST", form: fd }); }
      else r = await api(`/import/${entity}?dryRun=${dry ? 1 : 0}`, { method: "POST", body: { sheetUrl: url } });
      setResult({ ...r, dry });
      if (!dry) { toast(`${r.created} imported`); invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const close = () => { setFile(null); setUrl(""); setResult(null); setErr(null); onClose(); };
  const ready = src === "csv" ? !!file : /docs\.google\.com\/spreadsheets/.test(url);
  return (
    <Modal open={open} onClose={close} title={title} wide
      footer={<><Button variant="secondary" onClick={close}>Close</Button><Button variant="secondary" busy={busy} disabled={!ready} onClick={() => send(true)}>Check first</Button><Button busy={busy} disabled={!ready || (result?.dry && result.errors?.length > 0)} onClick={() => send(false)}>Import</Button></>}>
      <div className="grid gap-4">
        <Segmented value={src} onChange={(x) => { setSrc(x); setResult(null); }} options={[{ id: "csv", label: "CSV file" }, { id: "sheet", label: "Google Sheet" }]} />
        {src === "csv" ? (
          <Field label="CSV file" hint={<>Use the template's columns. <button className="font-semibold underline" onClick={() => download(`/import/templates/${entity}`, `${entity}-template.csv`)}>Download the template</button></>}>
            <Input type="file" accept=".csv,text/csv" className="py-2" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
          </Field>
        ) : (
          <Field label="Google Sheet link" hint={<>Share the sheet as "Anyone with the link can view". The first row must have the template's columns. <button className="font-semibold underline" onClick={() => download(`/import/templates/${entity}`, `${entity}-template.csv`)}>Download the template</button></>}>
            <Input value={url} onChange={(e) => { setUrl(e.target.value); setResult(null); }} placeholder="https://docs.google.com/spreadsheets/d/…" />
          </Field>
        )}
        {result && (
          <div className="rounded-lg border border-[var(--line)] p-4 text-[14px]">
            <p className="font-semibold">{result.dry ? `${result.rows} rows checked: ${result.rows - result.errors.length} ready to import.` : `${result.created} imported.`}</p>
            {result.errors?.length > 0 && <ul className="mt-2 max-h-48 list-disc overflow-y-auto pl-5 text-[13px] text-[#9c3a19]">{result.errors.map((e: any) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>}
          </div>
        )}
        <ErrorNote error={err} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ teams
function Teams() {
  const { can } = useSession();
  const teams = useTeams();
  const [edit, setEdit] = useState<any | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const confirm = useConfirm();
  const act = useAction();
  if (teams.isLoading) return <Spinner />;
  const list = teams.data ?? [];
  const current = list.find((t) => t.id === sel) ?? list[0];
  if (!list.length) return <Empty icon={<Users />} title="No teams yet" action={can("teams.manage") && <Button onClick={() => setEdit({})}><Plus />Create a team</Button>}>A team has a Team Lead who approves its members' sheets and leave.</Empty>;
  return (
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <Card pad={false} className="h-fit overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3"><span className="text-[13px] font-semibold text-[var(--muted)]">{list.length} teams</span>{can("teams.manage") && <Button size="sm" onClick={() => setEdit({})}><Plus />New team</Button>}</div>
        <ul>
          {list.map((t) => (
            <li key={t.id}><button onClick={() => setSel(t.id)} className={`flex w-full items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3 text-left last:border-0 hover:bg-[var(--bg)] ${current?.id === t.id ? "bg-[var(--brand-soft)]/60" : ""}`}>
              <span className="min-w-0"><span className="block truncate font-semibold">{t.name}</span><span className="block truncate text-[12.5px] text-[var(--muted)]">TL: {t.lead_name ?? "none"}{t.department_name ? ` · ${t.department_name}` : ""}</span></span>
              <span className="rounded-md bg-black/5 px-1.5 text-[12px] font-semibold tabnum dark:bg-white/10">{t.member_count}</span>
            </button></li>
          ))}
        </ul>
      </Card>
      {current && (
        <Card title={current.name} sub={[current.department_name, current.manager_name && `Reporting manager: ${current.manager_name}`].filter(Boolean).join(" · ") || undefined}
          actions={can("teams.manage") && <>
            <Button size="sm" variant="secondary" onClick={() => setEdit(current)}><Pencil />Edit team</Button>
            <Button size="sm" variant="ghost" aria-label="Delete team" onClick={async () => { if (await confirm({ title: `Delete ${current.name}?`, body: "Members stay in the company without a team.", confirm: "Delete team", danger: true }) !== false) act.run(() => del(`/teams/${current.id}`), "Team deleted", ["teams", "users"]); }}><Trash2 /></Button>
          </>}>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Stat label="Team Lead" value={<span className="text-[16px]">{current.lead_name ?? "—"}</span>} />
            <Stat label="Reporting manager" value={<span className="text-[16px]">{current.manager_name ?? "—"}</span>} />
            <Stat label="Members" value={current.member_count} />
          </div>
          <DataTable rows={current.members} rowKey={(m: any) => m.id} search={false} pageSize={50} rowHref={(m: any) => `/people/${m.id}`} empty="No members yet."
            columns={[
              { key: "n", header: "Name", cell: (m: any) => <>{m.name}{m.id === current.lead_user_id && <span className="ml-2 text-[12px] font-semibold text-[var(--brand)]">Team Lead</span>}</>, sort: (m: any) => m.name },
              { key: "c", header: "Employee ID", cell: (m: any) => m.employee_code || "—" },
              { key: "e", header: "Email", cell: (m: any) => m.email },
              { key: "p", header: "Phone", cell: (m: any) => m.phone || "—" },
            ]} />
          <ErrorNote error={act.err} />
        </Card>
      )}
      <TeamForm team={edit} onClose={() => setEdit(null)} />
    </div>
  );
}
function TeamForm({ team, onClose }: { team: any; onClose: () => void }) {
  const users = useUsers(!!team);
  const depts = useDepartments(!!team);
  const act = useAction();
  const [f, setF] = useState<any>(null);
  const v = f ?? { name: team?.name ?? "", leadUserId: team?.lead_user_id ?? null, managerUserId: team?.manager_user_id ?? null, departmentId: team?.department_id ?? null, memberIds: team?.members?.map((m: any) => m.id) ?? [] };
  const close = () => { setF(null); act.setErr(null); onClose(); };
  return (
    <Drawer open={!!team} onClose={close} title={team?.id ? `Edit ${team.name}` : "New team"}
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button busy={!!act.busy} disabled={!v.name} onClick={async () => { const ok = await act.run(() => (team?.id ? put(`/teams/${team.id}`, v) : post("/teams", v)), "Team saved", ["teams", "users"]); if (ok) close(); }}>Save team</Button></>}>
      <div className="grid gap-4">
        <Field label="Team name" required><Input value={v.name} onChange={(e) => setF({ ...v, name: e.target.value })} /></Field>
        <Field label="Team Lead" info="Approves the team's sheets, leave and WFH."><Combobox value={v.leadUserId} onChange={(x) => setF({ ...v, leadUserId: x })} options={userOpts(users.data)} /></Field>
        <Field label="Reporting manager" info="The person the TL reports to."><Combobox value={v.managerUserId} onChange={(x) => setF({ ...v, managerUserId: x })} options={userOpts(users.data)} /></Field>
        <Field label="Department"><Combobox value={v.departmentId} onChange={(x) => setF({ ...v, departmentId: x })} options={opts(depts.data)} /></Field>
        <Field label="Members" hint="Someone can be in one team; adding them here moves them from their old team."><MultiSelect value={v.memberIds} onChange={(x) => setF({ ...v, memberIds: x })} options={userOpts(users.data)} placeholder="Search and add people" /></Field>
        <ErrorNote error={act.err} />
      </div>
    </Drawer>
  );
}

// ------------------------------------------------------------------------------------------------ departments
function Departments() {
  const { can } = useSession();
  const depts = useDepartments();
  const users = useUsers();
  const act = useAction();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<any | null>(null);
  const [f, setF] = useState<any>({});
  return (
    <>
      <DataTable rows={depts.data} rowKey={(d) => d.id} loading={depts.isLoading} searchPlaceholder="Search departments"
        actions={can("teams.manage") && <Button size="sm" onClick={() => { setF({ name: "", headUserId: null }); setEdit({}); }}><Plus />New department</Button>}
        columns={[
          { key: "n", header: "Department", cell: (d) => <span className="font-semibold">{d.name}</span>, sort: (d) => d.name, text: (d) => d.name },
          { key: "h", header: "Head", cell: (d) => d.head_name ?? "—", text: (d) => d.head_name ?? "" },
          { key: "p", header: "People", cell: (d) => d.people, sort: (d) => d.people, align: "right" },
          { key: "t", header: "Teams", cell: (d) => d.teams, sort: (d) => d.teams, align: "right" },
          { key: "a", header: "", cell: (d) => can("teams.manage") && <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => { setF({ name: d.name, headUserId: d.head_user_id }); setEdit(d); }}><Pencil /></Button>
            <Button size="sm" variant="ghost" aria-label="Delete" onClick={async () => { if (await confirm({ title: `Delete ${d.name}?`, body: "People and teams in it stay, without a department.", danger: true, confirm: "Delete" }) !== false) act.run(() => del(`/departments/${d.id}`), "Deleted", ["departments"]); }}><Trash2 /></Button>
          </div> },
        ]} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit department" : "New department"}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!f.name} onClick={async () => { const ok = await act.run(() => (edit?.id ? put(`/departments/${edit.id}`, f) : post("/departments", f)), "Saved", ["departments"]); if (ok) setEdit(null); }}>Save</Button></>}>
        <div className="grid gap-4">
          <Field label="Name"><Input value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Head of department"><Combobox value={f.headUserId} onChange={(x) => setF({ ...f, headUserId: x })} options={userOpts(users.data)} /></Field>
          <ErrorNote error={act.err} />
        </div>
      </Modal>
    </>
  );
}

export const usePeopleIndex = () => { const u = useUsers(); return useMemo(() => new Map((u.data ?? []).map((x) => [x.id, x])), [u.data]); };
