import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "./magic";
import { useReducedMotion } from "motion/react";
import { AstraButton, AstraPanel } from "./Astra";
import { ThemeChoices, ThemeToggle } from "./ThemeToggle";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell, BarChart3, CalendarDays, Laptop, MessageSquare, Briefcase, CalendarCheck, CheckSquare, ClipboardList, Gauge, Home, LogOut, Menu, PhoneCall,
  Receipt, Settings, Users, Wallet, X, Building2, Percent, Network, StickyNote, ChevronsUpDown, CalendarRange, Activity, Sheet, PanelLeftClose, PanelLeftOpen, Timer, Workflow, ListTree, KeyRound, UserRound, History, Radar, IdCard, MessagesSquare, Columns3,
  ArrowLeftRight,
} from "lucide-react";
import type { Feature, Permission } from "@eszy/shared";
import { useSession } from "../lib/session";
import { get, post } from "../lib/api";
import { cx, fmtDateTime } from "./ui";
import { Avatar } from "./Avatar";

interface Item { to: string; label: string; icon: ReactNode; perms?: Permission[]; feature?: Feature; badge?: "approvals" }
const NAV: { group: string; items: Item[] }[] = [
  { group: "", items: [{ to: "/", label: "Dashboard", icon: <Home /> }] },
  {
    group: "My work",
    items: [
      { to: "/sheet", label: "Timesheet", icon: <ClipboardList />, perms: ["time.own"], feature: "people_time" },
      { to: "/standup", label: "Standup", icon: <MessageSquare />, feature: "people_time" },
      { to: "/leave", label: "Leave and WFH", icon: <CalendarCheck />, perms: ["leave.request", "leave.manage"], feature: "people_time" },
      { to: "/calendar", label: "Calendar", icon: <CalendarDays /> },
    ],
  },
  {
    group: "Team",
    items: [
      { to: "/approvals", label: "Sheet approvals", icon: <CheckSquare />, perms: ["time.approve_team", "time.approve_all"], feature: "people_time", badge: "approvals" },
      { to: "/assignments", label: "Project assignments", icon: <Network />, perms: ["projects.assign", "projects.manage", "time.approve_team", "projects.view_all"] },
      { to: "/handover", label: "Handover", icon: <ArrowLeftRight />, perms: ["projects.assign", "users.manage"] },
    ],
  },
  {
    group: "Sales and clients",
    items: [
      { to: "/leads", label: "Leads", icon: <PhoneCall />, feature: "sales_crm" },
      { to: "/clients", label: "Clients", icon: <Building2 />, perms: ["clients.view", "projects.view_all", "invoices.view"] },
      { to: "/projects", label: "Projects", icon: <Briefcase /> },
    ],
  },
  {
    group: "Billing",
    items: [
      { to: "/invoices", label: "Invoices", icon: <Receipt />, perms: ["invoices.view"], feature: "projects_billing" },
      { to: "/payments", label: "Pending payments", icon: <Wallet />, perms: ["payments.record"], feature: "projects_billing" },
    ],
  },
  {
    group: "Reports",
    items: [
      { to: "/reports?tab=teams", label: "Team reporting", icon: <BarChart3 />, perms: ["reports.view", "money.view", "time.approve_team", "time.approve_all"] },
      { to: "/reports?tab=leave", label: "Leave reporting", icon: <CalendarRange />, perms: ["reports.view", "leave.manage", "leave.approve_team", "time.approve_team", "time.approve_all"] },
      { to: "/reports?tab=sheets", label: "Sheet reporting", icon: <Activity />, perms: ["reports.view", "time.approve_team", "time.approve_all"] },
      { to: "/reports?tab=timesheets", label: "Timesheets", icon: <Sheet />, perms: ["reports.view", "time.approve_team", "time.approve_all"] },
      { to: "/performance", label: "Performance", icon: <Gauge />, perms: ["performance.view", "performance.view_team"], feature: "performance_rates" },
      { to: "/rates", label: "Rates and profit", icon: <Percent />, perms: ["money.view"], feature: "performance_rates" },
    ],
  },
  {
    group: "Company",
    items: [
      { to: "/people", label: "Employees and teams", icon: <Users />, perms: ["users.view"] },
      { to: "/org", label: "Org chart", icon: <Workflow /> },
      { to: "/accessories", label: "Accessories", icon: <Laptop /> },
      { to: "/notes", label: "Notes", icon: <StickyNote /> },
      { to: "/activity", label: "Activity", icon: <History />, perms: ["audit.view"] },
    ],
  },
  {
    group: "Masters and onboarding",
    items: [
      { to: "/masters/activity-types", label: "Work types", icon: <ListTree />, perms: ["masters.manage"] },
      { to: "/masters/project-sources", label: "Onboarding sources", icon: <Radar />, perms: ["masters.manage"] },
      { to: "/masters/project-accounts", label: "Onboarding accounts", icon: <IdCard />, perms: ["masters.manage"] },
      { to: "/masters/communication-types", label: "Communication types", icon: <MessagesSquare />, perms: ["masters.manage"] },
      { to: "/masters/project-stages", label: "Project stages", icon: <Columns3 />, perms: ["masters.manage"] },
    ],
  },
  {
    group: "Setup",
    items: [
      { to: "/roles", label: "Roles and permissions", icon: <KeyRound />, perms: ["roles.view", "roles.manage"] },
      { to: "/settings", label: "Settings", icon: <Settings />, perms: ["settings.manage", "subscription.manage", "leave.manage", "import_export", "audit.view"] },
    ],
  },
];

/** A link with a ?tab= is active only on that tab; /reports with no tab counts as its first tab. */
function itemActive(to: string, pathActive: boolean, loc: { pathname: string; search: string }) {
  const [path, query] = to.split("?");
  if (!query) return pathActive;
  if (loc.pathname !== path) return false;
  const want = new URLSearchParams(query).get("tab");
  const have = new URLSearchParams(loc.search).get("tab") ?? "teams";
  return want === (have === "master" ? "timesheets" : have) || (!NAV.some((g) => g.items.some((i) => i.to === `${path}?tab=${have}`)) && want === "teams");
}

const COLLAPSE_KEY = "eszy.sidebar.collapsed";
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } };

export function Layout() {
  const { me, can, has } = useSession();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [astra, setAstra] = useState(false);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* private mode */ } return !c; });
  const visible = NAV.map((g) => ({ ...g, items: g.items.filter((i) => (!i.perms || can(...i.perms)) && (!i.feature || has(i.feature))) })).filter((g) => g.items.length);
  const approvals = useQuery({ queryKey: ["approvals-count"], queryFn: () => get<any[]>("/approvals/sheets?status=submitted"), enabled: can("time.approve_team", "time.approve_all"), refetchInterval: 120_000 });
  const info = useQuery({ queryKey: ["assistant-info"], queryFn: () => get<any>("/assistant/info"), staleTime: 300_000 });
  const loc = useLocation();
  const reduce = useReducedMotion();

  const side = (mini: boolean, mobile = false) => (
    <nav aria-label="Main" className="flex h-full flex-col bg-[var(--side)] text-[var(--side-text)]">
      <div className={cx("flex h-16 items-center", mini ? "justify-center px-2" : "justify-between pl-5 pr-3")}>
        <Brand mini={mini} />
        {!mini && !mobile && <button onClick={toggle} aria-label="Collapse the menu" title="Collapse" className="grid size-8 place-items-center rounded-lg text-[var(--side-muted)] hover:bg-white/5 hover:text-white"><PanelLeftClose className="size-4" /></button>}
        {mobile && <button onClick={() => setOpen(false)} aria-label="Close menu" className="grid size-8 place-items-center rounded-lg text-[var(--side-muted)] hover:text-white"><X className="size-4" /></button>}
      </div>
      {mini && <button onClick={toggle} aria-label="Expand the menu" title="Expand" className="mx-auto mb-2 grid size-9 place-items-center rounded-lg text-[var(--side-muted)] hover:bg-white/5 hover:text-white"><PanelLeftOpen className="size-4" /></button>}
      <div className={cx("scrollbar-thin flex-1 space-y-4 overflow-y-auto overflow-x-hidden pb-4", mini ? "px-2" : "px-3")}>
        {visible.map((g) => (
          <div key={g.group}>
            {g.group && (mini ? <div className="mx-auto mb-1.5 h-px w-6 bg-[var(--side-line)]" /> : <div className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-[.08em] text-[var(--side-muted)]">{g.group}</div>)}
            <ul className="grid gap-0.5">
              {g.items.map((i) => (
                <li key={i.to}>
                  <NavLink to={i.to} end={i.to === "/"} onClick={() => setOpen(false)} title={mini ? i.label : undefined}
                    className={({ isActive: pathActive }) => cx("group relative flex items-center gap-2.5 rounded-xl py-2 text-[14px] font-medium transition-colors [&_svg]:relative [&_svg]:size-[18px] [&_svg]:shrink-0",
                      mini ? "justify-center px-0" : "px-2.5",
                      itemActive(i.to, pathActive, loc) ? "text-white" : "text-[var(--side-text)]/75 hover:bg-white/[.05] hover:text-white [&_svg]:text-[var(--side-muted)] hover:[&_svg]:text-white")}>
                    {({ isActive: pathActive }) => {
                      const on = itemActive(i.to, pathActive, loc);
                      return <>
                        {on && <motion.span layoutId={mobile ? "nav-active-m" : "nav-active"} className="absolute inset-0 rounded-xl bg-brand-gradient shadow-[0_0_0_1px_rgb(178_92_255/.45),0_6px_24px_-6px_rgb(168_85_247/.75)]" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }} />}
                        {i.icon}
                        {!mini && <span className="relative flex-1 truncate">{i.label}</span>}
                        {i.badge === "approvals" && !!approvals.data?.length && (mini
                          ? <span className="absolute right-1 top-1 size-2 rounded-full bg-[var(--neon)] shadow-[0_0_8px_var(--neon)]" />
                          : <span className={cx("relative rounded-md px-1.5 text-[11.5px] font-bold tabnum", on ? "bg-white/20 text-white" : "bg-[var(--neon)]/20 text-[#e3c6ff]")}>{approvals.data.length}</span>)}
                      </>;
                    }}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <UserMenu mini={mini} />
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <motion.aside initial={false} animate={{ width: collapsed ? 76 : 264 }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 38 }}
        className="sticky top-0 hidden h-screen shrink-0 overflow-hidden border-r border-[var(--side-line)] lg:block">{side(collapsed)}</motion.aside>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div className="absolute inset-y-0 left-0 w-72" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: "spring", stiffness: 400, damping: 40 }}>{side(false, true)}</motion.div>
          </div>
        )}
      </AnimatePresence>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[var(--line)] bg-[var(--card)]/80 px-4 backdrop-blur-xl lg:px-8">
          <button className="rounded-lg p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></button>
          <StatusBanner />
          <div className="ml-auto flex items-center gap-2">
            {can("time.own") && loc.pathname !== "/sheet" && <NavLink to="/sheet" className="hidden h-9 items-center gap-1.5 rounded-xl border border-[var(--line)] px-3 text-[13px] font-semibold transition hover:border-[var(--brand-2)]/60 hover:shadow-[0_0_0_3px_rgb(168_85_247/.12)] sm:inline-flex"><Timer className="size-4" />Fill today's sheet</NavLink>}
            {info.data?.enabled && <AstraButton info={info.data} onClick={() => setAstra(true)} />}
            <ThemeToggle />
            <Notifications />
          </div>
        </header>
        <AnimatePresence mode="wait">
          <motion.main key={loc.pathname} className="mx-auto max-w-[1380px] px-4 py-7 lg:px-8"
            initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -4 }} transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}>
            <Outlet />
          </motion.main>
        </AnimatePresence>
      </div>
      {info.data?.enabled && <AstraPanel open={astra} onClose={() => setAstra(false)} info={info.data} />}
    </div>
  );
}

function Brand({ mini }: { mini?: boolean }) {
  const { me } = useSession();
  const b = me!.settings.branding;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {b.logoUrl ? <img src={b.logoUrl} alt="" className="size-8 rounded-lg object-contain" /> : (
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-gradient shadow-[0_0_18px_-2px_rgb(168_85_247/.8)]"><span className="h-3.5 w-3 rounded-[2px] bg-[linear-gradient(180deg,#fff_0_28%,transparent_28%_36%,#fff_36%_64%,transparent_64%_72%,#fff_72%)]" /></span>
      )}
      {!mini && <span className="truncate font-display text-[16px] font-bold tracking-[-0.02em] text-white">{b.displayName || me!.tenant.name}</span>}
    </div>
  );
}

function UserMenu({ mini }: { mini?: boolean }) {
  const { me, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null);
  // The sidebar clips anything wider than itself, so the menu is placed on the page, beside or above the button.
  const place = () => { const r = btn.current!.getBoundingClientRect(); setPos(mini ? { left: r.right + 10, bottom: window.innerHeight - r.bottom, width: 270 } : { left: r.left, bottom: window.innerHeight - r.top + 6, width: r.width }); };
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k); window.addEventListener("resize", place);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); window.removeEventListener("resize", place); };
  }, [open, mini]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative border-t border-[var(--side-line)] p-3">
      <button ref={btn} onClick={() => { place(); setOpen((o) => !o); }} aria-expanded={open} title={mini ? me!.user.name : undefined} className={cx("flex w-full items-center gap-2.5 rounded-xl py-1.5 text-left hover:bg-white/5", mini ? "justify-center px-0" : "px-2")}>
        <Avatar id={me!.user.id} name={me!.user.name} hasPhoto={(me!.user as any).has_photo} />
        {!mini && <><span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-semibold text-white">{me!.user.name}</span><span className="block truncate text-[12px] text-[var(--side-muted)]">{me!.user.email}</span></span>
        <ChevronsUpDown className="size-4 text-[var(--side-muted)]" /></>}
      </button>
      {createPortal(<AnimatePresence>
        {open && pos && (
          <motion.div ref={menu} initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }} transition={{ duration: 0.15 }}
            style={{ left: pos.left, bottom: pos.bottom, width: pos.width }}
            className="fixed z-50 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] text-[var(--text)] shadow-[0_24px_60px_-20px_rgb(20_10_40/.5)]">
            <div className="flex items-center gap-2.5 border-b border-[var(--line)] px-3.5 py-3">
              <Avatar id={me!.user.id} name={me!.user.name} hasPhoto={(me!.user as any).has_photo} size={34} />
              <span className="min-w-0"><span className="block truncate text-[13.5px] font-semibold">{me!.user.name}</span><span className="block truncate text-[12px] text-[var(--muted)]">{me!.user.email}</span></span>
            </div>
            <div className="border-b border-[var(--line)] px-2.5 py-2.5"><p className="mb-1.5 px-1 text-[12px] font-semibold text-[var(--muted)]">Theme</p><ThemeChoices compact /></div>
            <NavLink to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3.5 py-2.5 text-[14px] hover:bg-[var(--bg)]"><UserRound className="size-4 text-[var(--muted)]" />My profile</NavLink>
            <button onClick={signOut} className="flex w-full items-center gap-2.5 border-t border-[var(--line)] px-3.5 py-2.5 text-left text-[14px] hover:bg-[var(--bg)]"><LogOut className="size-4 text-[var(--muted)]" />Sign out</button>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  );
}

function StatusBanner() {
  const { me, can } = useSession();
  const st = me!.tenant.status;
  const sub = me!.subscription;
  let msg: string | null = null;
  if (st === "trial" && sub?.trial_ends_at) msg = `Free trial until ${new Date(sub.trial_ends_at).toLocaleDateString()}.`;
  if (st === "past_due") msg = "The eszy plan payment didn't go through. Renew soon to keep full access.";
  if (st === "read_only") msg = "This company is read-only until the eszy plan is renewed.";
  if (!msg) return null;
  return (
    <div className={cx("min-w-0 truncate rounded-lg px-3 py-1.5 text-[13px] font-semibold", st === "trial" ? "bg-[#e5eefb] text-[#24529a]" : "bg-[#fbe5dc] text-[#7a2b10]")}>
      {msg} {can("subscription.manage") && <NavLink to="/settings/subscription" className="underline">Manage plan</NavLink>}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me } = useSession();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => get<any[]>("/notifications"), refetchInterval: 60_000 });
  const unread = q.data?.filter((n) => !n.read_at).length ?? me?.unreadNotifications ?? 0;
  const markAll = async () => { await post("/notifications/read"); qc.invalidateQueries({ queryKey: ["notifications"] }); };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label={`Notifications, ${unread} unread`} className="relative grid size-9 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10">
        <Bell className="size-[18px]" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-[#b4441f] px-1 text-center text-[10.5px] font-bold leading-[18px] text-white tabnum">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-40 w-[min(400px,92vw)] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3"><strong className="text-[14.5px]">Notifications</strong>{unread > 0 && <button className="text-[13px] font-semibold text-[var(--brand)] dark:text-[var(--accent)]" onClick={markAll}>Mark all as read</button>}</div>
            <ul className="max-h-[65vh] overflow-y-auto">
              {(q.data ?? []).slice(0, 50).map((n) => (
                <li key={n.id}>
                  <button onClick={() => { setOpen(false); post("/notifications/read", { ids: [n.id] }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] })); if (n.link) nav(n.link); }}
                    className={cx("flex w-full gap-3 border-b border-[var(--line)] px-4 py-3 text-left hover:bg-[var(--bg)]", !n.read_at && "bg-[var(--brand-soft)]/50")}>
                    <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-[var(--brand)]")} />
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-semibold">{n.title}</span>
                      {n.body && <span className="block text-[12.5px] text-[var(--muted)]">{n.body}</span>}
                      <span className="mt-0.5 block text-[12px] text-[var(--muted)]">{fmtDateTime(n.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
              {!q.data?.length && <li className="p-8 text-center text-[13.5px] text-[var(--muted)]">You're all caught up.</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
