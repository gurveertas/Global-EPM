import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, History } from "lucide-react";
import { get, qs } from "../lib/api";
import { useSession } from "../lib/session";
import { Avatar } from "./Avatar";
import { ANY_RANGE, Button, Combobox, DateRange, Empty, SearchInput, Select, Spinner, cx, fmtDate, type Range } from "./ui";
import { AnimatePresence, motion } from "./magic";

/** What happened, in words: "submitted the sheet", "changed the project". Unknown actions read from their name. */
const PHRASE: Record<string, string> = {
  "user.create": "added", "user.invite": "invited", "user.update": "changed", "user.access": "changed the access of", "user.deactivate": "deactivated", "user.reactivate": "reactivated",
  "project.handover": "handed over a role on", "user.handover": "handed over the work of", "project.task_budget": "changed the task hours of",
  "project.create": "created the project", "project.update": "changed the project", "project.status": "changed the status of", "project.stage": "moved", "project.team": "changed the team of",
  "task.create": "added a task to", "task.update": "changed a task on", "file.add": "attached a file to", "file.remove": "removed a file from", "link.add": "added a link to", "note.create": "commented on",
  "billing_line.create": "added a billing line to", "billing_line.update": "changed a billing line on", "billing_line.delete": "removed a billing line from", "extra_hours.add": "added extra hours to",
  "invoice.create": "created invoice", "invoice.update": "changed invoice", "invoice.cancel": "cancelled invoice", "invoice.send": "sent invoice", "invoice.refund": "refunded invoice", "invoice.correct": "corrected invoice",
  "payment.record": "recorded a payment on", "payment.delete": "removed a payment from", "client.create": "added the client", "client.update": "changed the client",
  "lead.create": "added the lead", "lead.assign": "assigned the lead", "team.create": "created the team", "team.update": "changed the team", "role.create": "created the role", "role.update": "changed the role",
  "settings.update": "changed company settings", "asset.create": "added the accessory", "asset.assign": "handed over", "asset.return": "took back", "asset.update": "changed the accessory",
  "leave.adjust": "adjusted leave for", "assistant.key": "saved an AI key in company settings", "assistant.key_removed": "removed an AI key from company settings", "user.photo": "changed the photo of", "projects.transfer": "moved projects of", "sheet.reopen": "reopened a sheet", "backup.restore": "restored a backup", "assistant.action": "confirmed an assistant action",
  "lead.client": "created a client from the lead", "lead.link_client": "linked a client to the lead", "lead.call_create": "added a call to", "lead.calls": "added a call to",
  "sheet.day": "saved their timesheet", "sheet.day_update": "saved their timesheet", "sheet.submit": "submitted their timesheet", "sheet.approve": "approved a timesheet", "sheet.reject": "sent back a timesheet",
  "master.create": "added a master entry", "master.update": "changed a master entry", "user.cost": "changed the cost per hour of", "project.billing_lines": "added a billing line to", "project.run_billing": "ran billing for",
  "project.comments": "commented on", "project.files": "attached a file to", "project.links": "added a link to", "project.notes": "added a note to", "project.note_create": "added a note to", "project.members": "changed the team of",
};
const ENTITY_LINK: Record<string, (id: string) => string> = {
  project: (id) => `/projects/${id}`, client: (id) => `/clients/${id}`, user: (id) => `/people/${id}`, invoice: (id) => `/invoices/${id}`, lead: (id) => `/leads/${id}`,
};
const KINDS: [string, string][] = [["", "Everything"], ["project", "Projects"], ["task", "Tasks"], ["client", "Clients"], ["lead", "Leads"], ["invoice", "Invoices"], ["payment", "Payments"], ["sheet", "Timesheets"], ["leave", "Leave and WFH"], ["user", "People"], ["team", "Teams"], ["role", "Roles"], ["asset", "Accessories"], ["master", "Masters"], ["settings", "Settings"]];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const words = (s: string | null | undefined) => String(s ?? "").replace(/_minor$/, "").replace(/_id$/, "").replace(/[_.]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
/** Past tense for actions recorded automatically ("sheet.submit" → "submitted"). */
const PAST: Record<string, string> = {
  create: "added", update: "changed", delete: "removed", submit: "submitted", approve: "approved", reject: "sent back", cancel: "cancelled", reopen: "reopened",
  assign: "assigned", unassign: "unassigned", return: "returned", request: "requested", decide: "decided on", bulk: "approved or sent back", move: "moved", stage: "moved",
  status: "changed the status of", members: "changed the team of", photo: "changed the photo of", access: "changed the access of", key: "saved an AI key for", key_removed: "removed an AI key from",
  transfer: "moved", restore: "restored", run: "ran", send: "sent", refund: "refunded", correct: "corrected", pay: "recorded a payment on", import: "imported", convert: "converted",
};
const A = (w: string) => (/^[aeiou]/.test(w) ? `an ${w}` : `a ${w}`);
export function phrase(a: any) {
  if (a.action && PHRASE[a.action]) return PHRASE[a.action];
  const action = String(a.action ?? "");
  const verb = action.split(".").slice(1).join(".") || action;
  const thing = words(a.entity === "settings" ? "company settings" : a.entity ?? action.split(".")[0] ?? "item") || "item";
  const nested = /^(.+)_(create|update|delete)$/.exec(verb);
  if (nested) return `${PAST[nested[2]]} ${A(words(nested[1]))} ${nested[2] === "create" ? "to" : "on"}${a.entity_name ? "" : ` ${A(thing)}`}`;
  const past = PAST[verb] ?? `${words(verb)}`;
  if (a.entity === "settings") return `${past} company settings`;
  return `${past}${a.entity_name ? "" : ` ${["create", "update", "delete"].includes(verb) ? A(thing) : `(${thing})`}`}`;
}
function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string" && UUID.test(v)) return "another record";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return fmtDate(v.slice(0, 10));
  if (Array.isArray(v)) return v.length ? v.map(show).join(", ") : "none";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
const HIDE = new Set(["updated_at", "created_at", "tenant_id", "id", "search", "position"]);

function Details({ a }: { a: any }) {
  const d = a.data ?? {};
  const changes = Object.entries(d.changes ?? {}).filter(([k]) => !HIDE.has(k));
  const sent = d.sent && typeof d.sent === "object" ? Object.entries(d.sent).filter(([k, v]) => !HIDE.has(k) && v !== null && v !== "" && !(Array.isArray(v) && !v.length)) : [];
  const extra = Object.entries(d).filter(([k, v]) => !["changes", "sent", "auto", "route", "projectId"].includes(k) && v !== null && v !== "" && typeof v !== "object");
  if (!changes.length && !sent.length && !extra.length) return <p className="text-[12.5px] text-[var(--muted)]">No more detail recorded.</p>;
  return (
    <dl className="grid gap-1.5 text-[12.5px]">
      {changes.map(([k, v]: any) => <div key={k} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3"><dt className="truncate font-semibold capitalize text-[var(--muted)]">{words(k)}</dt><dd className="min-w-0 break-words"><span className="text-[var(--muted)] line-through decoration-[var(--muted)]/50">{show(v[0])}</span> → <b>{show(v[1])}</b></dd></div>)}
      {sent.map(([k, v]) => <div key={k} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3"><dt className="truncate font-semibold capitalize text-[var(--muted)]">{words(k)}</dt><dd className="min-w-0 break-words">{show(v)}</dd></div>)}
      {extra.map(([k, v]) => <div key={k} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3"><dt className="truncate font-semibold capitalize text-[var(--muted)]">{words(k)}</dt><dd className="min-w-0 break-words">{show(v)}</dd></div>)}
    </dl>
  );
}

/**
 * The activity history: who did what and when, newest first, grouped by day, with filters and "Show more".
 * Give `entity` and `id` to show one record's history (a client, person, invoice, lead or project); leave them out for the whole company.
 */
export function ActivityLog({ entity, id, compact }: { entity?: "client" | "user" | "invoice" | "lead" | "project"; id?: string; compact?: boolean }) {
  const { can } = useSession();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [kind, setKind] = useState("");
  const [by, setBy] = useState("");
  const [range, setRange] = useState<Range>(ANY_RANGE);
  const from = range.from, to = range.to;
  const [open, setOpen] = useState<Set<number>>(new Set());
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const people = useQuery({ queryKey: ["users"], queryFn: () => get<any[]>("/users"), enabled: !entity && can("users.view") });
  const feed = useInfiniteQuery({
    queryKey: ["activity", entity, id, term, kind, by, from, to],
    queryFn: ({ pageParam }) => get<any>(`/activity${qs({ entity, entityId: id, q: term || undefined, kind: kind || undefined, by: by || undefined, from: from || undefined, to: to || undefined, before: pageParam ?? undefined, limit: compact ? 15 : 40 })}`),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.more ? last.next : undefined),
  });
  const rows: any[] = feed.data?.pages.flatMap((p) => p.rows) ?? [];
  // Loads the next page when the bottom of the list scrolls into view.
  const box = useRef<HTMLDivElement>(null), more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = more.current; if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage(); }, { root: compact ? null : box.current, rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  });
  const days = [...new Map(rows.map((r) => [String(r.at).slice(0, 10), rows.filter((x) => String(x.at).slice(0, 10) === String(r.at).slice(0, 10))])).entries()];
  return (
    <div>
      {!compact && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Search activity" className="w-full sm:w-72" />
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-44" aria-label="Kind">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          {!entity && <div className="w-52"><Combobox value={by || null} onChange={(v) => setBy(v ?? "")} placeholder="Anyone" options={(people.data ?? []).map((u) => ({ value: u.id, label: u.name, sub: u.designation }))} /></div>}
          <DateRange value={range} onChange={setRange} allowAll />
          {(kind || by || from || q) && <Button size="sm" variant="ghost" onClick={() => { setKind(""); setBy(""); setRange(ANY_RANGE); setQ(""); }}>Clear</Button>}
        </div>
      )}
      {feed.isLoading ? <Spinner /> : !rows.length ? <Empty icon={<History />} title="No activity yet">Changes people make show up here.</Empty> : (
        <div ref={box} className={cx("grid gap-6", !compact && "h-[calc(100vh-15.5rem)] min-h-80 content-start overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 scrollbar-thin")}>
          {days.map(([day, items]) => (
            <section key={day}>
              <h3 className={cx("sticky z-[1] mb-2 inline-flex rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-[12px] font-semibold text-[var(--muted)]", compact ? "top-16" : "top-0")}>{fmtDate(day, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</h3>
              <ol className="relative grid gap-1.5 border-l border-[var(--line)] pl-5">
                {items.map((a) => {
                  const isOpen = open.has(a.id);
                  const link = a.entity_id && ENTITY_LINK[a.entity]?.(a.entity_id);
                  const showEntity = a.entity_name && !(entity && id && a.entity_id === id);
                  return (
                    <li key={a.id} className="relative">
                      <span className="absolute -left-[26px] top-3.5 size-2.5 rounded-full border-2 border-[var(--card)] bg-[var(--brand-2)]" />
                      <button onClick={() => setOpen((x) => { const n = new Set(x); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })} aria-expanded={isOpen}
                        className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-[var(--card)] hover:shadow-[0_1px_2px_rgba(12,8,24,.05)]">
                        {a.user_id ? <Avatar id={a.user_id} name={a.user_name ?? "?"} size={28} /> : <span className="grid size-7 shrink-0 place-items-center rounded-full bg-black/5 text-[11px] font-bold dark:bg-white/10">eszy</span>}
                        <span className="min-w-0 flex-1 text-[13.5px] leading-snug">
                          <b>{a.user_name ?? "eszy"}</b> {phrase(a)}{" "}
                          {showEntity && (link ? <Link to={link} onClick={(e) => e.stopPropagation()} className="font-semibold text-[var(--brand)] hover:underline dark:text-[var(--accent)]">{a.entity_name}</Link> : <b>{a.entity_name}</b>)}
                          {a.project_name && a.entity !== "project" && <span className="text-[var(--muted)]"> on {a.project_name}</span>}
                          <span className="mt-0.5 block text-[12px] text-[var(--muted)]">{new Date(a.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}{a.data?.changes && Object.keys(a.data.changes).length ? ` · ${Object.keys(a.data.changes).filter((k) => !HIDE.has(k)).length} field(s) changed` : ""}</span>
                        </span>
                        <ChevronDown className={cx("mt-1 size-4 shrink-0 text-[var(--muted)] transition", isOpen && "rotate-180")} />
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><div className="mb-2 ml-12 mr-3 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3"><Details a={a} /></div></motion.div>}
                      </AnimatePresence>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {feed.hasNextPage && <div ref={more} className="flex justify-center pb-2"><Button variant="secondary" busy={feed.isFetchingNextPage} onClick={() => feed.fetchNextPage()}>Show more</Button></div>}
        </div>
      )}
    </div>
  );
}
