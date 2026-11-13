import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Bot, Brain, Check, History, Orbit, Plus, Rocket, Sparkles, Star, Trash2, WandSparkles, X, Zap } from "lucide-react";
import { del, get, post } from "../lib/api";
import { useSession } from "../lib/session";
import { RichText } from "../pages/ProjectParts";
import { AnimatePresence, BorderBeam, motion } from "./magic";
import { cx } from "./ui";

export const ASSISTANT_ICONS = { sparkles: Sparkles, bot: Bot, brain: Brain, rocket: Rocket, star: Star, zap: Zap, wand: WandSparkles, orbit: Orbit } as const;
export type AssistantInfo = { enabled: boolean; ready: boolean; name: string; icon: keyof typeof ASSISTANT_ICONS; greeting?: string; providerLabel?: string };
export const AssistantIcon = ({ icon, className }: { icon: string; className?: string }) => {
  const I = ASSISTANT_ICONS[icon as keyof typeof ASSISTANT_ICONS] ?? Sparkles;
  return <I className={className} />;
};

/** The top-bar button that opens the assistant. */
export function AstraButton({ info, onClick }: { info: AssistantInfo; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={`Ask ${info.name}`}
      className="group relative inline-flex h-9 items-center gap-1.5 overflow-hidden rounded-xl bg-[#0b0a10] px-3 text-[13px] font-semibold text-white shadow-[0_0_0_1px_rgb(178_92_255/.5),0_4px_18px_-4px_rgb(168_85_247/.7)] transition hover:shadow-[0_0_0_1px_rgb(178_92_255/.8),0_6px_26px_-4px_rgb(168_85_247/.95)] dark:bg-white/5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[#b25cff]/40 to-transparent animate-shimmer" />
      <AssistantIcon icon={info.icon} className="relative size-4 text-[#d6a8ff] transition group-hover:rotate-12" />
      <span className="relative">Ask {info.name}</span>
    </button>
  );
}

type Msg = { id: string; role: "user" | "assistant"; content: string; actions?: Action[]; error?: boolean };
type Action = { id: string; summary: string; status: "pending" | "done" | "declined" | "failed"; message?: string };

const SUGGEST: Record<string, string[]> = {
  base: ["How many hours have I logged this month?", "What are my open tasks?", "How much leave do I have left?", "Who is out today?"],
  team: ["Whose sheets are waiting for me?", "Who in my team is below 60% utilization this month?"],
  billing: ["Which invoices are unpaid?"],
};

/** The assistant: a chat panel that slides in from the right. Changes it prepares wait for the person's confirmation. */
export function AstraPanel({ open, onClose, info }: { open: boolean; onClose: () => void; info: AssistantInfo }) {
  const { me, can } = useSession();
  const qc = useQueryClient();
  const [conv, setConv] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const history = useQuery({ queryKey: ["assistant-convs"], queryFn: () => get<any[]>("/assistant/conversations"), enabled: open && showHistory });
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 250); }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  const send = async (q: string) => {
    const message = q.trim();
    if (!message || busy) return;
    setText("");
    setMsgs((m) => [...m, { id: `u${Date.now()}`, role: "user", content: message }]);
    setBusy(true);
    try {
      const r = await post<any>("/assistant/chat", { message, conversationId: conv ?? undefined });
      setConv(r.conversationId);
      setMsgs((m) => [...m, { id: `a${Date.now()}`, role: "assistant", content: r.reply, error: r.error, actions: r.actions?.map((a: any) => ({ id: a.id, summary: a.summary, status: a.status })) }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { id: `e${Date.now()}`, role: "assistant", content: e?.message ?? "Something went wrong.", error: true }]);
    } finally { setBusy(false); }
  };
  const decide = async (a: Action, d: "confirm" | "decline") => {
    const set = (patch: Partial<Action>) => setMsgs((m) => m.map((x) => ({ ...x, actions: x.actions?.map((y) => (y.id === a.id ? { ...y, ...patch } : y)) })));
    set({ status: d === "confirm" ? "done" : "declined", message: d === "confirm" ? "Working on it…" : undefined });
    try {
      const r = await post<any>(`/assistant/actions/${a.id}/${d}`);
      set({ status: r.status, message: r.message });
      if (r.status === "done") qc.invalidateQueries();
    } catch (e: any) { set({ status: "failed", message: e?.message }); }
  };
  const openConv = async (id: string) => {
    const r = await get<any>(`/assistant/conversations/${id}`);
    const acts: Action[] = r.actions.map((a: any) => ({ id: a.id, summary: a.summary, status: a.status, message: a.result?.message }));
    const out: Msg[] = [];
    for (const m of r.messages) {
      if (m.data?.actionId) continue;
      out.push({ id: m.id, role: m.role, content: m.content, error: m.data?.error });
    }
    // Attach actions to the last assistant message before them.
    for (const a of acts) {
      const at = r.messages.filter((m: any) => m.role === "assistant" && !m.data?.actionId && new Date(m.created_at) >= new Date(r.actions.find((x: any) => x.id === a.id).created_at))[0];
      const target = out.find((m) => m.id === at?.id) ?? out.filter((m) => m.role === "assistant").pop();
      if (target) target.actions = [...(target.actions ?? []), a];
    }
    setConv(id); setMsgs(out); setShowHistory(false);
  };
  const fresh = () => { setConv(null); setMsgs([]); setShowHistory(false); setTimeout(() => input.current?.focus(), 50); };
  const suggestions = [...SUGGEST.base, ...(can("time.approve_team", "time.approve_all") ? SUGGEST.team : []), ...(can("invoices.view") ? SUGGEST.billing : [])];
  const first = me!.user.name.split(" ")[0];

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div className="absolute inset-0 bg-[#07050d]/40 backdrop-blur-[2px]" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside role="dialog" aria-label={info.name} initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 360, damping: 38 }}
            className="absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col overflow-hidden border-l border-[#2a1f40] bg-[#0b0910] text-[#ece9f5] shadow-[-20px_0_60px_-20px_rgb(109_40_217/.5)]">
            <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[#7c3aed]/30 blur-3xl" />
            <div aria-hidden className="pointer-events-none absolute -left-24 bottom-10 size-60 rounded-full bg-[#c026d3]/15 blur-3xl" />
            <header className="relative flex items-center gap-3 border-b border-white/10 px-5 py-4">
              <span className="relative grid size-10 place-items-center rounded-2xl bg-brand-gradient shadow-[0_0_24px_-2px_rgb(178_92_255/.9)]"><AssistantIcon icon={info.icon} className="size-5 text-white" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-[17px] font-bold text-white">{info.name}</h2>
                <p className="truncate text-[12px] text-[#a49fba]">{info.ready ? "Answers from your company's data, with your access" : "Not set up yet"}</p>
              </div>
              <button onClick={() => setShowHistory((s) => !s)} aria-label="Past chats" title="Past chats" className={cx("grid size-9 place-items-center rounded-lg hover:bg-white/10", showHistory && "bg-white/10")}><History className="size-4" /></button>
              <button onClick={fresh} aria-label="New chat" title="New chat" className="grid size-9 place-items-center rounded-lg hover:bg-white/10"><Plus className="size-4" /></button>
              <button onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-lg hover:bg-white/10"><X className="size-4" /></button>
            </header>

            {showHistory ? (
              <div className="relative flex-1 overflow-y-auto p-3">
                <h3 className="px-2 pb-2 text-[12px] font-semibold uppercase tracking-[.08em] text-[#8a859e]">Past chats</h3>
                {history.isLoading ? <p className="p-4 text-[13px] text-[#a49fba]">Loading…</p> : !history.data?.length ? <p className="p-4 text-[13px] text-[#a49fba]">No chats yet.</p> : (
                  <ul className="grid gap-1">
                    {history.data.map((c) => (
                      <li key={c.id} className="group flex items-center gap-1 rounded-xl hover:bg-white/5">
                        <button onClick={() => openConv(c.id)} className="min-w-0 flex-1 px-3 py-2.5 text-left">
                          <span className="block truncate text-[14px] font-medium text-white">{c.title ?? "Chat"}</span>
                          <span className="text-[12px] text-[#8a859e]">{new Date(c.last_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                        </button>
                        <button aria-label="Delete chat" onClick={async () => { await del(`/assistant/conversations/${c.id}`); history.refetch(); if (conv === c.id) fresh(); }} className="mr-2 hidden size-8 place-items-center rounded-lg text-[#8a859e] hover:text-white group-hover:grid"><Trash2 className="size-4" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div ref={list} className="relative flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {!info.ready ? (
                  <div className="mt-10 text-center">
                    <p className="text-[15px] font-semibold text-white">{info.name} needs an AI key</p>
                    <p className="mx-auto mt-1 max-w-xs text-[13.5px] text-[#a49fba]">{can("settings.manage") ? "Add a Claude, OpenAI or Gemini key and it's ready for everyone." : "Ask your admin to add an AI key under Settings → Assistant."}</p>
                    {can("settings.manage") && <Link to="/settings/assistant" onClick={onClose} className="mt-4 inline-flex h-10 items-center rounded-xl bg-brand-gradient px-4 text-[14px] font-semibold text-white neon-ring">Set up {info.name}</Link>}
                  </div>
                ) : !msgs.length ? (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="pt-6">
                    <p className="font-display text-[24px] font-bold leading-tight text-white">Hi {first}, <span className="text-brand-gradient animate-gradient">what do you need?</span></p>
                    <p className="mt-2 text-[13.5px] text-[#a49fba]">{info.greeting || "I can look up your hours, projects, tasks, leave and team, and prepare changes like logging time or requesting leave. You confirm before anything changes."}</p>
                    <div className="mt-6 grid gap-2">
                      {suggestions.slice(0, 6).map((s2, i) => (
                        <motion.button key={s2} onClick={() => send(s2)} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}
                          className="rounded-xl border border-white/10 bg-white/[.03] px-3.5 py-2.5 text-left text-[13.5px] text-[#ddd8ec] transition hover:border-[#b25cff]/60 hover:bg-[#b25cff]/10">{s2}</motion.button>
                      ))}
                    </div>
                  </motion.div>
                ) : msgs.map((m) => (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div className={cx("max-w-[88%] text-[14px]", m.role === "user" ? "rounded-2xl rounded-br-md bg-brand-gradient px-3.5 py-2.5 text-white shadow-[0_6px_20px_-8px_rgb(168_85_247/.8)]" : "w-full")}>
                      {m.role === "user" ? <p className="whitespace-pre-wrap">{m.content}</p> : (
                        <div className="flex gap-2.5">
                          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-white/5 ring-1 ring-white/10"><AssistantIcon icon={info.icon} className="size-3.5 text-[#d6a8ff]" /></span>
                          <div className="min-w-0 flex-1 space-y-2.5">
                            {m.content && <div className={cx("leading-relaxed [&_a]:text-[#d6a8ff]", m.error ? "text-[#ffb4a0]" : "text-[#e6e2f2]")}><RichText text={m.content} /></div>}
                            {m.actions?.map((a) => <ActionCard key={a.id} a={a} onDecide={(d) => decide(a, d)} />)}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
                {busy && (
                  <div className="flex items-center gap-2.5 text-[13px] text-[#a49fba]">
                    <span className="grid size-7 place-items-center rounded-lg bg-white/5 ring-1 ring-white/10"><AssistantIcon icon={info.icon} className="size-3.5 animate-pulse text-[#d6a8ff]" /></span>
                    <span className="flex gap-1">{[0, 1, 2].map((i) => <motion.span key={i} className="size-1.5 rounded-full bg-[#b25cff]" animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }} />)}</span>
                    Looking that up
                  </div>
                )}
              </div>
            )}

            {info.ready && !showHistory && (
              <form className="relative border-t border-white/10 p-4" onSubmit={(e) => { e.preventDefault(); send(text); }}>
                <div className="relative flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[.04] p-2 focus-within:border-[#b25cff]/60">
                  <BorderBeam size={60} duration={9} radius={16} />
                  <textarea ref={input} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Ask ${info.name} anything about your work`}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }}
                    className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[14px] text-white outline-none focus-visible:outline-none placeholder:text-[#7d7893]" />
                  <button type="submit" disabled={!text.trim() || busy} aria-label="Send" className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-gradient text-white transition disabled:opacity-40"><ArrowUp className="size-4" /></button>
                </div>
                <p className="mt-2 text-center text-[11.5px] text-[#7d7893]">{info.name} sees only what you can see. It asks before changing anything.</p>
              </form>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

function ActionCard({ a, onDecide }: { a: Action; onDecide: (d: "confirm" | "decline") => void }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[#b25cff]/40 bg-[#b25cff]/[.07] p-3">
      {a.status === "pending" && <BorderBeam size={50} duration={5} radius={12} />}
      <p className="text-[11.5px] font-semibold uppercase tracking-[.08em] text-[#cfa5ff]">{a.status === "pending" ? "Confirm this change" : a.status === "done" ? "Done" : a.status === "declined" ? "Cancelled" : "Didn't go through"}</p>
      <p className="mt-1 text-[14px] text-white">{a.summary}</p>
      {a.message && a.status !== "pending" && <p className={cx("mt-1.5 text-[13px]", a.status === "failed" ? "text-[#ffb4a0]" : "text-[#a49fba]")}>{a.message}</p>}
      {a.status === "pending" && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => onDecide("confirm")} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-gradient px-3 text-[13px] font-semibold text-white neon-ring"><Check className="size-4" />Confirm</button>
          <button onClick={() => onDecide("decline")} className="h-9 rounded-lg border border-white/15 px-3 text-[13px] font-semibold text-[#ddd8ec] hover:bg-white/5">Cancel</button>
        </div>
      )}
    </div>
  );
}
