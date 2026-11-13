import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Network, UserPlus } from "lucide-react";
import { get, post } from "../lib/api";
import { useSession } from "../lib/session";
import { useAction, useUsers, userOpts } from "../lib/hooks";
import { Button, CapBar, Combobox, DataTable, Empty, ErrorNote, Field, Modal, PageHeader, Pill, Segmented, Select, Spinner, Stat, StatGrid, Tabs, hrs, useToast, type Column } from "../components/ui";
import { TeamDrawer } from "./Projects";

/**
 * The old EPM's assignment chain on one page.
 *  - Admin / PM: give each project its Team Leads ("Assign project to Team Leaders").
 *  - TL: give their projects the members who will log hours.
 * Unassigned = no TL yet (PM view) or no members yet (TL view).
 */
export function Assignments() {
  const { me, can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["assignments"], queryFn: () => get<any>("/assignments") });
  const [view, setView] = useState<"pm" | "tl">(can("projects.manage") ? "pm" : "tl");
  const [tab, setTab] = useState("unassigned");
  const [edit, setEdit] = useState<any | null>(null);
  const [transfer, setTransfer] = useState(false);
  if (q.isLoading || !q.data) return <Spinner />;
  const uid = me!.user.id;
  const all: any[] = q.data.projects;
  const asPm = all.filter((p) => can("projects.manage") || p.pm_user_id === uid);
  const asTl = all.filter((p) => p.i_am_tl);
  const hasPm = asPm.length > 0, hasTl = asTl.length > 0;
  const mode = hasPm && hasTl ? view : hasPm ? "pm" : "tl";
  const list = mode === "pm" ? asPm : asTl;
  const isUnassigned = (p: any) => (mode === "pm" ? p.tls.length === 0 : p.members.length === 0);
  const rows = list.filter((p) => (tab === "unassigned" ? isUnassigned(p) : !isUnassigned(p)));
  const cols: Column<any>[] = [
    { key: "n", header: "Project", cell: (p) => <><Link to={`/projects/${p.id}?tab=team`} className="font-semibold hover:underline">{p.name}</Link><div className="text-[12.5px] text-[var(--muted)]">{p.client_name}</div></>, sort: (p) => p.name, text: (p) => `${p.name} ${p.client_name}` },
    { key: "t", header: "Type", cell: (p) => <span className="text-[13px]">{p.type === "fixed" ? "Fixed price" : `Hourly, ${p.billing_type}`}</span> },
    { key: "pm", header: "Project Manager", cell: (p) => p.pm_name ?? <span className="text-[var(--muted)]">None</span>, sort: (p) => p.pm_name ?? "", text: (p) => p.pm_name ?? "" },
    { key: "tl", header: "Team Leads", cell: (p) => (p.tls.length ? p.tls.map((t: any) => t.name).join(", ") : <Pill status="unassigned">No TL yet</Pill>), text: (p) => p.tls.map((t: any) => t.name).join(" ") },
    { key: "m", header: "Members", cell: (p) => (p.members.length ? <span className="text-[13px]">{p.members.map((t: any) => t.name).join(", ")}</span> : <Pill status="unassigned">No members</Pill>), text: (p) => p.members.map((t: any) => t.name).join(" ") },
    { key: "h", header: "Hours", cell: (p) => (p.cap_minutes ? <CapBar used={p.logged_minutes} cap={p.cap_minutes} /> : hrs(p.logged_minutes)), className: "min-w-40", sort: (p) => p.logged_minutes },
    { key: "tk", header: "Open tasks", cell: (p) => p.open_tasks, align: "right", sort: (p) => p.open_tasks },
    { key: "a", header: "", cell: (p) => <Button size="sm" variant={isUnassigned(p) ? "primary" : "secondary"} onClick={(e) => { e.stopPropagation(); setEdit(p); }}><UserPlus />{mode === "pm" ? "Assign TLs" : "Assign members"}</Button> },
  ];
  return (
    <>
      <PageHeader title="Project assignments" sub={mode === "pm" ? "Give each project its Team Leads. Each TL then assigns the members who log hours." : "Assign members to the projects you lead. Only members can log hours on a project."}
        actions={<>
          {hasPm && hasTl && <Segmented value={view} onChange={setView} options={[{ id: "pm", label: "As Project Manager" }, { id: "tl", label: "As Team Lead" }]} />}
          {can("projects.manage") && <Button variant="secondary" onClick={() => setTransfer(true)}><ArrowRightLeft />Transfer projects</Button>}
        </>} />
      {!list.length ? (
        <Empty icon={<Network />} title="No projects to assign">{mode === "pm" ? "Projects you manage appear here." : "Projects where you're a Team Lead appear here."}</Empty>
      ) : (
        <>
          <StatGrid cols={3}>
            <Stat label="Projects" value={list.length} />
            <Stat label={mode === "pm" ? "Without a Team Lead" : "Without members"} value={list.filter(isUnassigned).length} tone={list.some(isUnassigned) ? "amber" : undefined} onClick={() => setTab("unassigned")} active={tab === "unassigned"} />
            <Stat label="Assigned" value={list.filter((p) => !isUnassigned(p)).length} onClick={() => setTab("assigned")} active={tab === "assigned"} />
          </StatGrid>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: "unassigned", label: "Unassigned", count: list.filter(isUnassigned).length }, { id: "assigned", label: "Assigned", count: list.filter((p) => !isUnassigned(p)).length }]} />
          <DataTable rows={rows} columns={cols} rowKey={(p) => p.id} searchPlaceholder="Search projects, clients, people" empty={tab === "unassigned" ? "Everything is assigned." : "Nothing assigned yet."} />
        </>
      )}
      {edit && <TeamDrawer open project={edit} canSetTl={can("projects.assign")} onClose={() => setEdit(null)} onDone={() => qc.invalidateQueries({ queryKey: ["assignments"] })} />}
      <TransferModal open={transfer} onClose={() => setTransfer(false)} projects={all} />
    </>
  );
}

/** Move projects from one person to another (someone leaves, changes team or goes on long leave). */
function TransferModal({ open, onClose, projects }: { open: boolean; onClose: () => void; projects: any[] }) {
  const users = useUsers(open);
  const qc = useQueryClient();
  const act = useAction();
  const toast = useToast();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [role, setRole] = useState<"pm" | "tl" | "member">("pm");
  const [sel, setSel] = useState<string[]>([]);
  const theirs = projects.filter((p) => from && (role === "pm" ? p.pm_user_id === from : role === "tl" ? p.tls.some((t: any) => t.id === from) : p.members.some((m: any) => m.id === from)));
  const close = () => { setFrom(null); setTo(null); setSel([]); act.setErr(null); onClose(); };
  return (
    <Modal open={open} onClose={close} title="Transfer projects" wide
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button busy={!!act.busy} disabled={!from || !to || !sel.length} onClick={async () => {
        const r: any = await act.run(() => post("/assignments/transfer", { fromUserId: from, toUserId: to, role, projectIds: sel }));
        if (r) { qc.invalidateQueries({ queryKey: ["assignments"] }); qc.invalidateQueries({ queryKey: ["projects"] }); toast(`${r.moved} project(s) moved`); close(); }
      }}>Transfer {sel.length || ""} project(s)</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="As"><Select value={role} onChange={(e) => { setRole(e.target.value as any); setSel([]); }}><option value="pm">Project Manager</option><option value="tl">Team Lead</option><option value="member">Member</option></Select></Field>
          <Field label="From"><Combobox value={from} onChange={(x) => { setFrom(x); setSel([]); }} options={userOpts(users.data, false)} /></Field>
          <Field label="To"><Combobox value={to} onChange={setTo} options={userOpts(users.data).filter((o) => o.value !== from)} /></Field>
        </div>
        {from && (
          <DataTable rows={theirs} rowKey={(p) => p.id} selectable selected={sel} onSelect={setSel} search={false} pageSize={50} empty="This person has no projects in that role."
            columns={[{ key: "n", header: "Project", cell: (p) => <span className="font-semibold">{p.name}</span> }, { key: "c", header: "Client", cell: (p) => p.client_name }, { key: "h", header: "Hours", cell: (p) => hrs(p.logged_minutes), align: "right" }]} />
        )}
        <ErrorNote error={act.err} />
      </div>
    </Modal>
  );
}
