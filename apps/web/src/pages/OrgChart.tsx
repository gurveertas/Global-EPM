import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronRight, Expand, LayoutGrid, List, Minus, Network, Pencil, Plus, Search, Unlink, UserMinus, UserPlus } from "lucide-react";
import { get, post, put } from "../lib/api";
import { useDepartments, useRoles, useTeams } from "../lib/hooks";
import { useSession } from "../lib/session";
import { Button, Card, Combobox, Drawer, Empty, ErrorNote, Field, Input, PageHeader, Segmented, Select, Spinner, cx, useConfirm, useToast } from "../components/ui";

/**
 * The company as a tree: who reports to whom (reporting manager, else the team's lead). Drawn on a canvas you can drag and zoom,
 * with branches that fold, a search that flies to a person, and a plain list view for keyboards and screen readers.
 */
type P = { id: string; name: string; designation?: string; team_id?: string | null; team_name?: string; department_id?: string | null; department_name?: string; reporting_manager_id?: string | null; roles: string[]; role_keys: string[]; manager_id: string | null; is_owner: boolean; leads_team: boolean };
type N = { p: P | null; label: string; sub: string; kids: N[]; x: number; y: number; w: number; depth: number; count: number; tone: Tone; id: string };
type Tone = { key: string; label: string; color: string };

const TONES: Tone[] = [
  { key: "admin", label: "Admin", color: "#a855f7" },
  { key: "hr", label: "HR", color: "#e879f9" },
  { key: "pm", label: "Project Manager", color: "#22d3ee" },
  { key: "tl", label: "Team Lead", color: "#60a5fa" },
  { key: "sales", label: "Sales", color: "#fbbf24" },
  { key: "billing", label: "Billing", color: "#34d399" },
  { key: "emp", label: "Employee", color: "#a1a1b5" },
];
const toneOf = (p: P): Tone => {
  const k = p.role_keys ?? [];
  const pick = (key: string) => TONES.find((t) => t.key === key)!;
  if (p.is_owner || k.includes("admin")) return pick("admin");
  if (k.includes("hr")) return pick("hr");
  if (k.includes("project_manager")) return pick("pm");
  if (k.includes("team_lead") || p.leads_team) return pick("tl");
  if (k.some((x) => x.startsWith("sales"))) return pick("sales");
  if (k.includes("billing_manager")) return pick("billing");
  return pick("emp");
};
const NODE_W = 232, NODE_H = 78, GAP_X = 26, GAP_Y = 72;
const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();

function buildTree(people: P[], company: string): N {
  const byId = new Map(people.map((p) => [p.id, p]));
  const kids = new Map<string | null, P[]>();
  for (const p of people) { const m = p.manager_id && byId.has(p.manager_id) ? p.manager_id : null; kids.set(m, [...(kids.get(m) ?? []), p]); }
  const rank = (p: P) => { const t = toneOf(p).key; return ["admin", "hr", "pm", "billing", "sales", "tl", "emp"].indexOf(t); };
  const make = (p: P, depth: number): N => {
    const ch = (kids.get(p.id) ?? []).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map((c) => make(c, depth + 1));
    return { p, id: p.id, label: p.name, sub: p.designation || p.roles.join(", ") || "Employee", kids: ch, x: 0, y: 0, w: 0, depth, count: ch.reduce((a, c) => a + 1 + c.count, 0), tone: toneOf(p) };
  };
  const roots = (kids.get(null) ?? []).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  if (roots.length === 1) return make(roots[0], 0);
  const top = roots.map((r) => make(r, 1));
  return { p: null, id: "__company", label: company, sub: `${people.length} people`, kids: top, x: 0, y: 0, w: 0, depth: 0, count: people.length, tone: { key: "co", label: "Company", color: "#7c3aed" } };
}

/** Classic tidy layout: each subtree is as wide as its children; parents sit centred above them. */
function layout(root: N, folded: Set<string>) {
  const visit = (n: N, depth: number, left: number): number => {
    n.depth = depth;
    n.y = depth * (NODE_H + GAP_Y);
    const kids = folded.has(n.id) ? [] : n.kids;
    if (!kids.length) { n.w = NODE_W; n.x = left; return NODE_W; }
    let cursor = left;
    for (const k of kids) cursor += visit(k, depth + 1, cursor) + GAP_X;
    const width = Math.max(NODE_W, cursor - left - GAP_X);
    const first = kids[0], last = kids[kids.length - 1];
    n.x = (first.x + last.x) / 2;
    n.w = width;
    return width;
  };
  visit(root, 0, 0);
  const all: N[] = [];
  const walk = (n: N) => { all.push(n); if (!folded.has(n.id)) n.kids.forEach(walk); };
  walk(root);
  return all;
}

export function OrgChart() {
  const { me, can } = useSession();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["org-chart"], queryFn: () => get<P[]>("/org-chart") });
  const [view, setView] = useState<"chart" | "teams" | "list">("chart");
  const [search, setSearch] = useState("");
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [editMode, setEditMode] = useState(false);
  const [editing, setEditing] = useState<P | null>(null);
  const canEdit = can("users.manage");
  const root = useMemo(() => (q.data?.length ? buildTree(q.data, me!.settings.branding.displayName || me!.tenant.name) : null), [q.data, me]);
  const open = (id: string) => { const p = q.data?.find((x) => x.id === id); if (editMode && p) setEditing(p); else nav(`/people/${id}`); };

  return (
    <>
      <PageHeader title="Org chart" sub={editMode ? "Edit mode: click a person to change who they report to, their team or department." : "Who reports to whom. Drag to move around, scroll or pinch to zoom, and click a person to open their page."}
        actions={<>
          {canEdit && <Button variant={editMode ? "primary" : "secondary"} size="sm" onClick={() => setEditMode(!editMode)}>{editMode ? <><Check className="size-4" />Done editing</> : <><Pencil className="size-4" />Edit hierarchy</>}</Button>}
          <Segmented value={view} onChange={setView} options={[
            { id: "chart", label: <span className="inline-flex items-center gap-1.5"><Network className="size-3.5" />Chart</span> },
            { id: "teams", label: <span className="inline-flex items-center gap-1.5"><LayoutGrid className="size-3.5" />Teams</span> },
            { id: "list", label: <span className="inline-flex items-center gap-1.5"><List className="size-3.5" />List</span> },
          ]} />
        </>} />
      {/* What the colours mean. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TONES.filter((t) => q.data?.some((p) => toneOf(p).key === t.key)).map((t) => (
          <span key={t.key} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--card)] px-2.5 py-1 text-[12.5px] font-medium ring-1 ring-[var(--line)]">
            <i className="size-2.5 rounded-full" style={{ background: t.color }} />{t.label}<b className="tabnum text-[var(--muted)]">{q.data?.filter((p) => toneOf(p).key === t.key).length}</b>
          </span>
        ))}
        {editMode && <span className="ml-auto rounded-full bg-[var(--brand-soft)] px-3 py-1 text-[12.5px] font-semibold text-[var(--brand)] dark:text-white">Editing: changes save straight away and everyone sees them</span>}
      </div>
      {q.isLoading ? <Spinner /> : !root ? <Empty title="Nobody here yet">Add people and set their reporting manager or team.</Empty> : view === "chart" ? (
        <ChartCanvas root={root} folded={folded} setFolded={setFolded} search={search} setSearch={setSearch} onOpen={open} meId={me!.user.id} />
      ) : view === "teams" ? (
        <TeamsView people={q.data!} onOpen={open} editMode={editMode} />
      ) : (
        <Card><OrgList node={root} onOpen={editMode ? open : undefined} /></Card>
      )}
      {editing && <EditPlacement person={editing} people={q.data ?? []} onClose={() => setEditing(null)} />}
    </>
  );
}

/** People grouped by department, then team, with who each reports to. */
function TeamsView({ people, onOpen, editMode }: { people: P[]; onOpen: (id: string) => void; editMode: boolean }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const depts = new Map<string, Map<string, P[]>>();
  for (const p of people) {
    const d = p.department_name || "No department", t = p.team_name || "No team";
    if (!depts.has(d)) depts.set(d, new Map());
    const teams = depts.get(d)!;
    teams.set(t, [...(teams.get(t) ?? []), p]);
  }
  const sorted = [...depts.entries()].sort(([a], [b]) => (a === "No department" ? 1 : b === "No department" ? -1 : a.localeCompare(b)));
  return (
    <div className="grid gap-6">
      {sorted.map(([dept, teams]) => (
        <section key={dept}>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold"><Building2 className="size-4 text-[var(--muted)]" />{dept}<span className="text-[13px] font-medium text-[var(--muted)]">{[...teams.values()].reduce((a, l) => a + l.length, 0)} people</span></h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[...teams.entries()].sort(([a], [b]) => (a === "No team" ? 1 : b === "No team" ? -1 : a.localeCompare(b))).map(([team, list]) => {
              const lead = list.find((p) => p.leads_team);
              return (
                <Card key={team} pad={false}>
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
                    <div className="min-w-0"><div className="truncate text-[14.5px] font-bold">{team}</div>{lead && <div className="text-[12px] text-[var(--muted)]">Led by {lead.name}</div>}</div>
                    <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-[12px] font-semibold text-[var(--muted)] ring-1 ring-[var(--line)] tabnum">{list.length}</span>
                  </div>
                  <ul className="divide-y divide-[var(--line)]">
                    {list.sort((a, b) => Number(b.leads_team) - Number(a.leads_team) || a.name.localeCompare(b.name)).map((p) => {
                      const t = toneOf(p);
                      const mgr = p.manager_id ? byId.get(p.manager_id) : null;
                      return (
                        <li key={p.id}>
                          <button onClick={() => onOpen(p.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--bg)]/60">
                            <span className="grid size-8 shrink-0 place-items-center rounded-full text-[11.5px] font-bold text-white" style={{ background: t.color }}>{initials(p.name)}</span>
                            <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-semibold">{p.name}</span><span className="block truncate text-[12px] text-[var(--muted)]">{p.designation || t.label}{mgr ? ` · reports to ${mgr.name}` : ""}</span></span>
                            {editMode && <Pencil className="size-3.5 shrink-0 text-[var(--muted)]" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Change who someone reports to, and their team, department and designation. */
function EditPlacement({ person, people, onClose }: { person: P; people: P[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const teams = useTeams();
  const depts = useDepartments();
  const [v, setV] = useState({ reportingManagerId: person.reporting_manager_id ?? null as string | null, teamId: person.team_id ?? "", departmentId: person.department_id ?? "", designation: person.designation ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  // Can't report to themselves or anyone below them.
  const below = useMemo(() => {
    const out = new Set<string>([person.id]);
    let grew = true;
    while (grew) { grew = false; for (const p of people) if (p.manager_id && out.has(p.manager_id) && !out.has(p.id)) { out.add(p.id); grew = true; } }
    return out;
  }, [person, people]);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await put(`/users/${person.id}`, { reportingManagerId: v.reportingManagerId, teamId: v.teamId || null, departmentId: v.departmentId || null, designation: v.designation });
      toast(`Saved ${person.name}'s place in the chart`);
      for (const k of [["org-chart"], ["users"], ["user", person.id]]) qc.invalidateQueries({ queryKey: k });
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const team = teams.data?.find((t: any) => t.id === v.teamId);
  return (
    <Drawer open onClose={onClose} title={`Edit ${person.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
      <ErrorNote error={err} />
      <div className="grid gap-4">
        <Field label="Reports to" hint={!v.reportingManagerId && team?.lead_name ? `Empty means their team lead, ${team.lead_name}.` : "Their reporting manager approves their sheets and leave."}>
          <Combobox value={v.reportingManagerId} onChange={(x) => setV({ ...v, reportingManagerId: x })} placeholder="Their team lead"
            options={people.filter((p) => !below.has(p.id)).map((p) => ({ value: p.id, label: p.name, sub: [p.designation, p.team_name].filter(Boolean).join(" · ") }))} />
        </Field>
        <Field label="Team">
          <Select value={v.teamId} onChange={(e) => setV({ ...v, teamId: e.target.value })}><option value="">No team</option>{(teams.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        </Field>
        <Field label="Department">
          <Select value={v.departmentId} onChange={(e) => setV({ ...v, departmentId: e.target.value })}><option value="">No department</option>{(depts.data ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        </Field>
        <Field label="Designation"><Input value={v.designation} onChange={(e) => setV({ ...v, designation: e.target.value })} /></Field>
        <p className="text-[12.5px] text-[var(--muted)]">People who report to {person.name.split(" ")[0]} move with them.</p>
      </div>
      <AddUnder person={person} onDone={onClose} />
      <RemoveNode person={person} people={people} onDone={onClose} />
    </Drawer>
  );
}

function OrgList({ node, depth = 0, onOpen }: { node: N; depth?: number; onOpen?: (id: string) => void }) {
  const [open, setOpen] = useState(depth < 2);
  return (
    <div className={cx(depth > 0 && "ml-5 border-l border-[var(--line)] pl-4")}>
      <div className="flex items-center gap-2 py-1.5">
        {node.kids.length ? <button aria-expanded={open} aria-label={open ? "Fold" : "Unfold"} onClick={() => setOpen(!open)} className="grid size-6 place-items-center rounded-md hover:bg-black/5"><ChevronRight className={cx("size-4 transition", open && "rotate-90")} /></button> : <span className="size-6" />}
        <span className="size-2.5 rounded-full" style={{ background: node.tone.color }} />
        {node.p ? (onOpen ? <button onClick={() => onOpen(node.p!.id)} className="inline-flex items-center gap-1 font-semibold hover:underline">{node.label}<Pencil className="size-3 text-[var(--muted)]" /></button> : <Link to={`/people/${node.p.id}`} className="font-semibold hover:underline">{node.label}</Link>) : <b>{node.label}</b>}
        <span className="text-[13px] text-[var(--muted)]">{node.sub}{node.p?.team_name ? ` · ${node.p.team_name}` : ""}</span>
        {node.count > 0 && <span className="rounded-md bg-black/5 px-1.5 text-[12px] font-semibold tabnum dark:bg-white/10">{node.count}</span>}
      </div>
      {open && node.kids.map((k) => <OrgList key={k.id} node={k} depth={depth + 1} onOpen={onOpen} />)}
    </div>
  );
}

function ChartCanvas({ root, folded, setFolded, search, setSearch, onOpen, meId }: { root: N; folded: Set<string>; setFolded: (s: Set<string>) => void; search: string; setSearch: (s: string) => void; onOpen: (id: string) => void; meId: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ x: 0, y: 40, k: 0.9 });
  const anim = useRef<{ from: typeof view.current; to: typeof view.current; t0: number } | null>(null);
  const appear = useRef(performance.now());
  const [hover, setHover] = useState<N | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const nodes = useMemo(() => layout(root, folded), [root, folded]);
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const matches = useMemo(() => { const s = search.trim().toLowerCase(); return s ? nodes.filter((n) => n.p && `${n.label} ${n.sub} ${n.p.team_name ?? ""}`.toLowerCase().includes(s)) : []; }, [search, nodes]);

  const fit = useCallback((animate = true) => {
    const minX = Math.min(...nodes.map((n) => n.x)), maxX = Math.max(...nodes.map((n) => n.x + NODE_W)), maxY = Math.max(...nodes.map((n) => n.y + NODE_H));
    // Fit everything when it's readable; otherwise open at a readable zoom centred on the top of the tree.
    const fitK = Math.min((size.w - 60) / (maxX - minX), (size.h - 140) / (maxY + 20));
    const k = Math.min(1.05, Math.max(0.62, fitK));
    const top = nodes[0];
    const cxw = fitK >= 0.62 ? (minX + maxX) / 2 : top.x + NODE_W / 2;
    const to = { k, x: size.w / 2 - cxw * k, y: 92 };
    if (animate) anim.current = { from: { ...view.current }, to, t0: performance.now() }; else view.current = to;
  }, [nodes, size]);
  const flyTo = (n: N) => { const k = Math.max(view.current.k, 0.95); anim.current = { from: { ...view.current }, to: { k, x: size.w / 2 - (n.x + NODE_W / 2) * k, y: size.h / 2 - (n.y + NODE_H / 2) * k }, t0: performance.now() }; setFocus(n.id); };

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fitted = useRef(false);
  useEffect(() => { if (!wrap.current || size.w !== wrap.current.clientWidth) return; fit(fitted.current); fitted.current = true; }, [size.w, size.h, root]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (matches.length === 1 || (matches.length && search.length > 2)) flyTo(matches[0]); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw loop.
  useEffect(() => {
    let raf = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = (now: number) => {
      const c = canvas.current; if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== size.w * dpr || c.height !== size.h * dpr) { c.width = size.w * dpr; c.height = size.h * dpr; }
      if (anim.current) {
        const t = Math.min(1, (now - anim.current.t0) / (reduce ? 1 : 450)), e = 1 - Math.pow(1 - t, 3);
        const { from, to } = anim.current;
        view.current = { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
        if (t >= 1) anim.current = null;
      }
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      // Dotted backdrop.
      const { x: vx, y: vy, k } = view.current;
      ctx.fillStyle = dark ? "rgba(255,255,255,.06)" : "rgba(40,20,80,.08)";
      const step = 28 * k;
      if (step > 8) for (let gx = (vx % step); gx < size.w; gx += step) for (let gy = (vy % step); gy < size.h; gy += step) ctx.fillRect(gx, gy, 1.2, 1.2);
      ctx.save();
      ctx.translate(vx, vy); ctx.scale(k, k);
      const since = reduce ? 1e9 : now - appear.current;
      // Edges.
      for (const n of nodes) {
        if (folded.has(n.id)) continue;
        for (const ch of n.kids) {
          const p = Math.min(1, Math.max(0, (since - ch.depth * 90) / 380));
          if (p <= 0) continue;
          const x1 = n.x + NODE_W / 2, y1 = n.y + NODE_H, x2 = ch.x + NODE_W / 2, y2 = ch.y;
          const g = ctx.createLinearGradient(x1, y1, x2, y2);
          g.addColorStop(0, n.tone.color + "cc"); g.addColorStop(1, ch.tone.color + "99");
          ctx.strokeStyle = g; ctx.lineWidth = focus && (ch.id === focus || n.id === focus) ? 2.6 : 1.6;
          ctx.globalAlpha = p;
          ctx.beginPath();
          const my = y1 + (y2 - y1) / 2;
          ctx.moveTo(x1, y1); ctx.bezierCurveTo(x1, my, x2, my, x2, y1 + (y2 - y1) * p);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      // Nodes.
      for (const n of nodes) {
        const p = Math.min(1, Math.max(0, (since - n.depth * 90) / 380));
        if (p <= 0) continue;
        const s = 0.92 + 0.08 * p;
        const isHover = hover?.id === n.id, isFocus = focus === n.id, isMe = n.p?.id === meId, isMatch = matches.some((m) => m.id === n.id);
        ctx.save();
        ctx.globalAlpha = p;
        ctx.translate(n.x + NODE_W / 2, n.y + NODE_H / 2); ctx.scale(s, s); ctx.translate(-NODE_W / 2, -NODE_H / 2);
        if (isHover || isFocus || isMatch) { ctx.shadowColor = n.tone.color; ctx.shadowBlur = 24; }
        else { ctx.shadowColor = dark ? "rgba(0,0,0,.5)" : "rgba(40,20,80,.12)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4; }
        roundRect(ctx, 0, 0, NODE_W, NODE_H, 16);
        ctx.fillStyle = n.p ? (dark ? "#14111d" : "#ffffff") : "#0b0a10";
        ctx.fill();
        ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.lineWidth = isFocus || isMatch ? 2 : 1;
        ctx.strokeStyle = isFocus || isMatch || isHover ? n.tone.color : dark ? "#2a2536" : "#e7e6ef";
        ctx.stroke();
        // Role stripe.
        ctx.fillStyle = n.tone.color; roundRect(ctx, 0, 14, 4, NODE_H - 28, 2); ctx.fill();
        // Avatar.
        const ax = 34, ay = NODE_H / 2;
        const ag = ctx.createLinearGradient(ax - 18, ay - 18, ax + 18, ay + 18);
        ag.addColorStop(0, n.tone.color); ag.addColorStop(1, n.p ? "#6d28d9" : "#c026d3");
        ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(ax, ay, 18, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "700 13px 'Sora Variable', system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(n.p ? initials(n.label) : "◆", ax, ay + 0.5);
        // Text.
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        ctx.fillStyle = n.p ? (dark ? "#f1effa" : "#0b0a10") : "#fff";
        ctx.font = "700 14px 'Plus Jakarta Sans Variable', system-ui";
        ctx.fillText(clip(ctx, n.label + (isMe ? " (you)" : ""), NODE_W - 70 - (n.count ? 30 : 0)), 62, 32);
        ctx.fillStyle = n.p ? (dark ? "#a19db3" : "#646273") : "#c9c4dc";
        ctx.font = "500 12px 'Plus Jakarta Sans Variable', system-ui";
        ctx.fillText(clip(ctx, n.sub, NODE_W - 72), 62, 50);
        if (n.p?.team_name) { ctx.fillStyle = n.tone.color; ctx.font = "600 11px 'Plus Jakarta Sans Variable', system-ui"; ctx.fillText(clip(ctx, n.p.team_name, NODE_W - 72), 62, 65); }
        // Reports count / fold toggle.
        if (n.kids.length) {
          const bx = NODE_W - 22, by = NODE_H / 2;
          ctx.fillStyle = folded.has(n.id) ? n.tone.color : dark ? "#221d2e" : "#f3ecff";
          ctx.beginPath(); ctx.arc(bx, by, 13, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = folded.has(n.id) ? "#fff" : dark ? "#e3c6ff" : "#6d28d9"; ctx.font = "700 11px 'Plus Jakarta Sans Variable', system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(folded.has(n.id) ? `+${n.count}` : String(n.count), bx, by + 0.5);
        }
        ctx.restore();
      }
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [nodes, size, hover, focus, matches, folded, dark, meId]);

  // Interaction.
  const toWorld = (cx2: number, cy2: number) => ({ x: (cx2 - view.current.x) / view.current.k, y: (cy2 - view.current.y) / view.current.k });
  const hit = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    const w = toWorld(e.clientX - r.left, e.clientY - r.top);
    const n = nodes.find((n2) => w.x >= n2.x && w.x <= n2.x + NODE_W && w.y >= n2.y && w.y <= n2.y + NODE_H);
    const onToggle = n && n.kids.length && Math.hypot(w.x - (n.x + NODE_W - 22), w.y - (n.y + NODE_H / 2)) < 15;
    return { n, onToggle };
  };
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number } | null>(null);
  const zoomAt = (px: number, py: number, factor: number) => {
    const k = Math.min(2.2, Math.max(0.2, view.current.k * factor));
    const w = toWorld(px, py);
    view.current = { k, x: px - w.x * k, y: py - w.y * k };
    anim.current = null;
  };
  useEffect(() => {
    const c = canvas.current!;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = c.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018))); };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  });

  return (
    <div ref={wrap} className="relative h-[calc(100vh-210px)] min-h-[520px] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
      <canvas ref={canvas} style={{ width: size.w, height: size.h, touchAction: "none" }} className={cx("block", hover ? "cursor-pointer" : drag.current ? "cursor-grabbing" : "cursor-grab")}
        role="img" aria-label={`Org chart with ${nodes.length} people. Use the list view for a text version.`}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.current.k }; } drag.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false }; anim.current = null; }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current && pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()]; const r = canvas.current!.getBoundingClientRect();
            zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, (pinch.current.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d) / view.current.k); return;
          }
          if (drag.current) {
            const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true;
            if (drag.current.moved) { view.current = { ...view.current, x: drag.current.vx + dx, y: drag.current.vy + dy }; return; }
          }
          setHover(hit(e).n ?? null);
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null;
          const d = drag.current; drag.current = null;
          if (d?.moved) return;
          const { n, onToggle } = hit(e);
          if (!n) return;
          if (onToggle) { const f = new Set(folded); f.has(n.id) ? f.delete(n.id) : f.add(n.id); setFolded(f); return; }
          if (n.p) onOpen(n.p.id);
        }}
        onPointerLeave={() => setHover(null)} />
      {/* Controls */}
      <div className="absolute left-4 top-4 flex w-[min(320px,calc(100%-32px))] items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--card)]/90 p-1.5 shadow-lg backdrop-blur">
        <Search className="ml-1.5 size-4 shrink-0 text-[var(--muted)]" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a person or team" className="h-8 border-0 bg-transparent shadow-none focus:ring-0" aria-label="Find a person" />
        {search && <span className="shrink-0 pr-2 text-[12px] text-[var(--muted)] tabnum">{matches.length}</span>}
      </div>
      {matches.length > 1 && (
        <ul className="absolute left-4 top-[66px] max-h-60 w-[min(320px,calc(100%-32px))] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--card)] shadow-lg">
          {matches.slice(0, 12).map((m) => <li key={m.id}><button onClick={() => flyTo(m)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13.5px] hover:bg-[var(--bg)]"><span className="size-2 rounded-full" style={{ background: m.tone.color }} /><b>{m.label}</b><span className="truncate text-[var(--muted)]">{m.sub}</span></button></li>)}
        </ul>
      )}
      <div className="absolute bottom-4 right-4 flex flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)]/90 shadow-lg backdrop-blur">
        <button aria-label="Zoom in" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.2)} className="grid size-10 place-items-center hover:bg-[var(--bg)]"><Plus className="size-4" /></button>
        <button aria-label="Zoom out" onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.2)} className="grid size-10 place-items-center border-t border-[var(--line)] hover:bg-[var(--bg)]"><Minus className="size-4" /></button>
        <button aria-label="Fit to screen" onClick={() => fit()} className="grid size-10 place-items-center border-t border-[var(--line)] hover:bg-[var(--bg)]"><Expand className="size-4" /></button>
      </div>
      <div className="absolute bottom-4 left-4 flex flex-wrap gap-x-3 gap-y-1 rounded-xl border border-[var(--line)] bg-[var(--card)]/90 px-3 py-2 text-[12px] shadow-lg backdrop-blur">
        {TONES.map((t) => <span key={t.key} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: t.color }} />{t.label}</span>)}
        <span className="text-[var(--muted)]">· Click a number to fold a branch</span>
      </div>
      {hover?.p && (
        <div className="pointer-events-none absolute right-4 top-4 w-64 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 shadow-xl">
          <p className="font-semibold">{hover.label}</p>
          <p className="text-[13px] text-[var(--muted)]">{hover.p.roles.join(", ") || "Employee"}{hover.p.team_name ? ` · ${hover.p.team_name}` : ""}</p>
          <p className="mt-1 text-[12.5px]">{hover.count ? `${hover.kids.length} direct, ${hover.count} in total` : "No one reports to them"}</p>
        </div>
      )}
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function clip(ctx: CanvasRenderingContext2D, s: string, max: number) {
  if (ctx.measureText(s).width <= max) return s;
  let t = s; while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Add a new person straight into the chart, reporting to this one. They get an invite email to set a password. */
function AddUnder({ person, onDone }: { person: P; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useRoles();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: "", email: "", designation: "", roleId: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const roleId = v.roleId || roles.data?.find((r: any) => r.key === "employee")?.id || "";
  const add = async () => {
    setBusy(true); setErr(null);
    try {
      await post("/users", { name: v.name, email: v.email, designation: v.designation, roleIds: roleId ? [roleId] : [], reportingManagerId: person.id, teamId: person.team_id ?? null, departmentId: person.department_id ?? null });
      toast(`Added ${v.name}. They'll get an email to set their password.`);
      for (const k of [["org-chart"], ["users"]]) qc.invalidateQueries({ queryKey: k });
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <section className="mt-6 rounded-xl border border-[var(--line)] p-4">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
        <span><span className="block text-[14px] font-bold">Add someone under {person.name.split(" ")[0]}</span><span className="block text-[12.5px] text-[var(--muted)]">A new person who reports to them, in their team and department.</span></span>
        <UserPlus className="size-4 text-[var(--muted)]" />
      </button>
      {open && (
        <div className="mt-4 grid gap-3">
          <ErrorNote error={err} />
          <Field label="Name" required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label="Email" required><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Designation"><Input value={v.designation} onChange={(e) => setV({ ...v, designation: e.target.value })} /></Field>
            <Field label="Role"><Select value={roleId} onChange={(e) => setV({ ...v, roleId: e.target.value })}>{(roles.data ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          </div>
          <div className="flex justify-end"><Button busy={busy} disabled={!v.name.trim() || !v.email.trim()} onClick={add}><UserPlus className="size-4" />Add to the chart</Button></div>
        </div>
      )}
    </section>
  );
}

/** Take someone out of the chart: make them top level, or deactivate them. Their reports move up to their manager. */
function RemoveNode({ person, people, onDone }: { person: P; people: P[]; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { me } = useSession();
  const [err, setErr] = useState<unknown>(null);
  const reports = people.filter((p) => p.manager_id === person.id);
  const up = people.find((p) => p.id === person.manager_id);
  const refresh = () => { for (const k of [["org-chart"], ["users"]]) qc.invalidateQueries({ queryKey: k }); };
  const moveReports = async () => { for (const r of reports.filter((r) => r.reporting_manager_id === person.id)) await put(`/users/${r.id}`, { reportingManagerId: up?.id ?? null }); };
  const detach = async () => {
    setErr(null);
    try { await moveReports(); await put(`/users/${person.id}`, { reportingManagerId: null }); toast(`${person.name} no longer reports to anyone`); refresh(); onDone(); } catch (e) { setErr(e); }
  };
  const deactivate = async () => {
    if (!(await confirm({ title: `Deactivate ${person.name}?`, body: `They can't sign in any more and leave the org chart.${reports.length ? ` The ${reports.length} people who report to them will report to ${up?.name ?? "nobody (top level)"}.` : ""} You can reactivate them later from their page.`, confirm: "Deactivate", danger: true }))) return;
    setErr(null);
    try { await post(`/users/${person.id}/deactivate`, { reason: "Removed from the org chart" }); toast(`${person.name} was deactivated`); refresh(); onDone(); } catch (e) { setErr(e); }
  };
  if (person.is_owner || person.id === me!.user.id) return null;
  return (
    <section className="mt-4 rounded-xl border border-[#f3c3b0] p-4 dark:border-[#7a2b10]">
      <span className="block text-[14px] font-bold">Remove from the chart</span>
      <span className="block text-[12.5px] text-[var(--muted)]">{reports.length ? `${reports.length} ${reports.length === 1 ? "person reports" : "people report"} to them; they'll report to ${up?.name ?? "nobody (top level)"} instead.` : "Nobody reports to them."}</span>
      <div className="mt-3"><ErrorNote error={err} /></div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={detach}><Unlink className="size-4" />Make top level</Button>
        <Button size="sm" variant="danger" onClick={deactivate}><UserMinus className="size-4" />Deactivate</Button>
      </div>
    </section>
  );
}
