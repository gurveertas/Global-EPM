import {
  Children, createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Columns3, Download, Info, Loader2, Plus, Search, X, CalendarDays, Filter as FilterIcon, ListFilter, Activity, AlertTriangle, BadgeDollarSign, Ban, Building, Building2, CheckCircle2, Clock, FileText, FolderKanban, Hourglass, ListChecks, Package, Plane, Target, Undo2, Users, Wallet, PlayCircle, PauseCircle, Archive, Gauge, BarChart3 } from "lucide-react";
import { formatMinutes, parseHours, INVOICE_STATUS_LABEL } from "@eszy/shared";
import { ApiError } from "../lib/api";
import { AnimatePresence, NumberTicker, motion } from "./magic";
import { RichEditor } from "./RichEditor";
export { RichText, plainText } from "./RichEditor";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// =====================================================================================================
// Buttons
// =====================================================================================================
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "accent" | "ghost" | "danger" | "outline"; size?: "sm" | "md"; busy?: boolean };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = "primary", size = "md", busy, className, children, disabled, type = "button", ...p }, ref) {
  const v = {
    primary: "btn-primary shadow-[0_6px_18px_-8px_rgb(109_40_217/.7)] hover:shadow-[0_0_0_1px_rgb(168_85_247/.4),0_8px_26px_-8px_rgb(168_85_247/.75)] hover:brightness-110 active:scale-[.98]",
    accent: "bg-[var(--text)] text-[var(--card)] shadow-sm hover:shadow-[0_0_0_1px_rgb(168_85_247/.5),0_6px_22px_-8px_rgb(168_85_247/.7)] active:scale-[.98]",
    secondary: "border border-[var(--line)] bg-[var(--card)] text-[var(--text)] shadow-sm hover:bg-[var(--bg)]",
    outline: "border border-[var(--line)] bg-[var(--card)] text-[var(--text)] shadow-sm hover:bg-[var(--bg)]",
    ghost: "text-[var(--text)] hover:bg-black/5 dark:hover:bg-white/10",
    danger: "bg-[#b4441f] text-white shadow-sm hover:brightness-110",
  }[variant];
  return (
    <button ref={ref} type={type} disabled={disabled || busy}
      className={cx("inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm", v, className)} {...p}>
      {busy && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
export function LinkButton({ to, children, variant = "secondary", size = "md" }: { to: string; children: ReactNode; variant?: BtnProps["variant"]; size?: "sm" | "md" }) {
  const v = variant === "primary" ? "btn-primary hover:brightness-110" : "border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--bg)]";
  return <Link to={to} className={cx("inline-flex items-center gap-2 whitespace-nowrap rounded-xl font-semibold shadow-sm [&_svg]:size-4", size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm", v)}>{children}</Link>;
}

// =====================================================================================================
// Form fields
// =====================================================================================================
export function Field({ label, hint, error, children, info, className, required }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; info?: string; className?: string; required?: boolean }) {
  // Picks up errors the server sent for this field (matched by its label), shown until the next save.
  const self = useRef<HTMLLabelElement>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  useEffect(() => {
    const h = (ev: Event) => {
      const { scope, fields } = (ev as CustomEvent).detail as { scope: Element | null; fields: { key: string; label: string; text: string }[] };
      if ((self.current?.closest("dialog, [role=dialog]") ?? null) !== scope) return;
      const me = norm(label);
      const hit = fields.find((f) => norm(f.label) === me || f.text.toLowerCase().startsWith(label.toLowerCase()) || (me.length > 3 && (me.endsWith(norm(f.label)) && norm(f.label).length > 4)));
      setApiError(hit ? hit.text : null);
    };
    window.addEventListener("eszy:field-errors", h);
    return () => window.removeEventListener("eszy:field-errors", h);
  }, [label]);
  error = error ?? apiError ?? undefined;
  return (
    <label ref={self} data-invalid={error ? "true" : undefined} className={cx("block min-w-0", error && "field-invalid", className)}>
      <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text)]">{label}{required && <span className="text-[#b4441f]" aria-hidden>*</span>}{info && <InfoTip text={info} />}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-[12.5px] text-[var(--muted)]">{hint}</span>}
      {error && <span className="mt-1 block text-[12.5px] font-semibold text-[#b4441f]">{error}</span>}
    </label>
  );
}
const inputBase = "rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 text-[14px] outline-none transition placeholder:text-[var(--muted)]/70 focus:border-[var(--brand-2)] focus:ring-[3px] focus:ring-[var(--brand-2)]/20 disabled:bg-[var(--bg)] disabled:text-[var(--muted)]";
const inputCls = (c?: string) => cx(inputBase, !/(^|\s)w-/.test(c ?? "") && "w-full", !/(^|\s)(h-|py-)/.test(c ?? "") && "h-10", c);
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={inputCls(className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return <select ref={ref} className={inputCls(cx("pr-8", className))} {...p}>{children}</select>;
});
/** Every text area has the formatting bar (bold, lists, links…). Pass `plain` for a bare box, e.g. very short notes. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { plain?: boolean }>(function Textarea({ className, plain, ...p }, ref) {
  if (plain) return <textarea ref={ref} className={inputCls(cx("min-h-24 py-2", className))} {...p} />;
  const minH = /min-h-\S+/.exec(className ?? "")?.[0];
  return <RichEditor ref={ref} {...p} className={cx(className?.replace(/min-h-\S+/g, ""))} inputClassName={minH ?? "min-h-24"} />;
});
export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--brand)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="text-[14px] font-medium">{label}</span>{hint && <span className="block text-[12.5px] text-[var(--muted)]">{hint}</span>}</span>
    </label>
  );
}
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2.5 text-[14px] font-medium">
      <span className={cx("relative h-5 w-9 rounded-full transition", checked ? "bg-[var(--brand)]" : "bg-black/15 dark:bg-white/20")}>
        <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}
export function SearchInput({ value, onChange, placeholder = "Search", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx("relative", className ?? "w-full sm:w-72", !/(^|\s)h-/.test(className ?? "") && "h-10")}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-full pl-9" aria-label={placeholder} />
      {value && <button onClick={() => onChange("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--muted)] hover:bg-black/5"><X className="size-3.5" /></button>}
    </div>
  );
}

/** Hours typed as "8:30" or "8.5", stored as minutes. */
export function HoursInput({ value, onChange, ...p }: { value: number | null | undefined; onChange: (m: number | null) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(value == null ? "" : toHm(value));
  useEffect(() => { if (value == null) setText(""); else if (parseHours(text) !== value) setText(toHm(value)); }, [value]); // eslint-disable-line
  return <Input inputMode="decimal" placeholder="h:mm" value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value.trim() ? parseHours(e.target.value) : null); }} {...p} />;
}
const toHm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
/** Money typed in major units (e.g. 1,500.50), stored as minor units. */
export function MoneyInput({ value, onChange, currency, ...p }: { value: number | null | undefined; onChange: (m: number | null) => void; currency?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(value == null ? "" : String(value / 100));
  useEffect(() => { const n = Math.round(Number(text.replace(/,/g, "")) * 100); if (value == null) setText(""); else if (n !== value) setText(String(value / 100)); }, [value]); // eslint-disable-line
  return (
    <div className="relative">
      {currency && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-[var(--muted)]">{currency}</span>}
      <Input inputMode="decimal" className={currency ? "pl-12" : ""} value={text} onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value.replace(/,/g, ""));
        onChange(e.target.value.trim() && Number.isFinite(n) ? Math.round(n * 100) : null);
      }} {...p} />
    </div>
  );
}

export interface Opt { value: string; label: string; sub?: string }
/** A dropdown with a search box, for long lists of people, projects or clients. */
/** Type a name that isn't in the list and press "Add" to create it (when onCreate is given). */
type CreateFn = (label: string) => Promise<string | null | undefined>;
function CreateRow({ q, options, onCreate, onCreated, busy, setBusy }: { q: string; options: Opt[]; onCreate?: CreateFn; onCreated: (v: string) => void; busy: boolean; setBusy: (b: boolean) => void }) {
  const label = q.trim();
  if (!onCreate || !label || options.some((o) => o.label.toLowerCase() === label.toLowerCase())) return null;
  return (
    <li className="border-t border-[var(--line)]">
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const v = await onCreate(label); if (v) onCreated(v); } finally { setBusy(false); } }}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[14px] font-semibold text-[var(--brand)] hover:bg-[var(--bg)] disabled:opacity-60">
        <Plus className="size-4" />{busy ? "Adding…" : <>Add “{label}”</>}
      </button>
    </li>
  );
}
export function Combobox({ value, onChange, options, placeholder = "Select", clearable = true, disabled, onCreate }: { value: string | null | undefined; onChange: (v: string | null) => void; options: Opt[]; placeholder?: string; clearable?: boolean; disabled?: boolean; onCreate?: CreateFn }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), pop);
  const sel = options.find((o) => o.value === value);
  const list = options.filter((o) => !q || `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 100);
  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className={cx(inputBase, "flex h-10 w-full items-center justify-between gap-2 text-left")}>
        <span className={cx("truncate", !sel && "text-[var(--muted)]")}>{sel?.label ?? placeholder}</span>
        <span className="flex items-center gap-1">
          {clearable && sel && <span role="button" tabIndex={0} aria-label="Clear" onClick={(e) => { e.stopPropagation(); onChange(null); }} className="rounded p-0.5 text-[var(--muted)] hover:bg-black/5"><X className="size-3.5" /></span>}
          <ChevronDown className="size-4 text-[var(--muted)]" />
        </span>
      </button>
      {open && (
        <Floating anchor={ref} pop={pop} match minWidth={224} className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)] shadow-[0_18px_50px_-12px_rgba(20,10,50,.35)]">
          <div className="border-b border-[var(--line)] p-2"><Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={onCreate ? "Search or type a new name" : "Type to search"} className="h-9"
            onKeyDown={async (e) => { if (e.key === "Enter" && onCreate && q.trim() && !list.length && !busy) { e.preventDefault(); setBusy(true); try { const v = await onCreate(q.trim()); if (v) { onChange(v); setOpen(false); setQ(""); } } finally { setBusy(false); } } }} /></div>
          <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
            {list.map((o) => (
              <li key={o.value}>
                <button type="button" onClick={() => { onChange(o.value); setOpen(false); setQ(""); }} className={cx("flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[14px] hover:bg-[var(--bg)]", o.value === value && "font-semibold")}>
                  <span className="min-w-0"><span className="block truncate">{o.label}</span>{o.sub && <span className="block truncate text-[12.5px] text-[var(--muted)]">{o.sub}</span>}</span>
                  {o.value === value && <Check className="size-4 text-[var(--brand)]" />}
                </button>
              </li>
            ))}
            {!list.length && !(onCreate && q.trim()) && <li className="px-3 py-4 text-center text-[13px] text-[var(--muted)]">No matches</li>}
            <CreateRow q={q} options={options} onCreate={onCreate} busy={busy} setBusy={setBusy} onCreated={(v) => { onChange(v); setOpen(false); setQ(""); }} />
          </ul>
        </Floating>
      )}
    </div>
  );
}
/** Pick several from a long list; picked items show as removable chips. */
export function MultiSelect({ value, onChange, options, placeholder = "Add", onCreate }: { value: string[]; onChange: (v: string[]) => void; options: Opt[]; placeholder?: string; onCreate?: CreateFn }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), pop);
  const picked = value.map((v) => options.find((o) => o.value === v)).filter(Boolean) as Opt[];
  const list = options.filter((o) => !value.includes(o.value) && (!q || `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 100);
  return (
    <div ref={ref} className="relative">
      <div className={cx(inputBase, "flex min-h-10 w-full flex-wrap items-center gap-1.5 py-1.5")} onClick={() => setOpen(true)}>
        {picked.map((o) => (
          <span key={o.value} className="inline-flex items-center gap-1 rounded-md bg-[var(--brand-soft)] px-2 py-0.5 text-[13px] font-semibold text-[var(--brand)] dark:text-white">
            {o.label}<button type="button" aria-label={`Remove ${o.label}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((v) => v !== o.value)); }}><X className="size-3" /></button>
          </span>
        ))}
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={picked.length ? "" : placeholder} className="min-w-24 flex-1 bg-transparent text-[14px] outline-none"
          onKeyDown={async (e) => {
            if (e.key === "Backspace" && !q && value.length) onChange(value.slice(0, -1));
            if (e.key === "Enter" && q.trim()) {
              e.preventDefault();
              const hit = list.find((o) => o.label.toLowerCase() === q.trim().toLowerCase()) ?? (list.length === 1 ? list[0] : null);
              if (hit) { onChange([...value, hit.value]); setQ(""); return; }
              if (onCreate && !busy) { setBusy(true); try { const v = await onCreate(q.trim()); if (v) { onChange([...value, v]); setQ(""); } } finally { setBusy(false); } }
            }
          }} />
      </div>
      {open && (
        <Floating anchor={ref} pop={pop} match minWidth={224}><ul className="max-h-64 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--card)] py-1 shadow-[0_18px_50px_-12px_rgba(20,10,50,.35)]">
          {list.map((o) => (
            <li key={o.value}><button type="button" onClick={() => { onChange([...value, o.value]); setQ(""); }} className="block w-full px-3 py-2 text-left text-[14px] hover:bg-[var(--bg)]">{o.label}{o.sub && <span className="ml-1.5 text-[12.5px] text-[var(--muted)]">{o.sub}</span>}</button></li>
          ))}
          {!list.length && !(onCreate && q.trim()) && <li className="px-3 py-3 text-center text-[13px] text-[var(--muted)]">{q ? "No matches" : "Nothing more to add"}</li>}
          <CreateRow q={q} options={options} onCreate={onCreate} busy={busy} setBusy={setBusy} onCreated={(v) => { onChange([...value, v]); setQ(""); }} />
        </ul></Floating>
      )}
    </div>
  );
}
function useOutside(ref: React.RefObject<HTMLElement | null>, fn: () => void, pop?: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && !pop?.current?.contains(t)) fn();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, fn, pop]);
}

/**
 * Dropdown layer drawn on top of the whole page (in a portal), so cards, tables and scroll boxes below can never cover
 * or clip it. Sits under its anchor and flips above when there isn't room; follows the anchor on scroll and resize.
 */
export function Floating({ anchor, pop, children, align = "left", match, minWidth, className }: {
  anchor: React.RefObject<HTMLElement | null>; pop: React.RefObject<HTMLDivElement | null>; children: ReactNode; align?: "left" | "right"; match?: boolean; minWidth?: number; className?: string;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current, p = pop.current; if (!a) return;
      const r = a.getBoundingClientRect();
      const h = p?.offsetHeight ?? 0, w = Math.max(p?.offsetWidth ?? 0, match ? r.width : 0);
      const below = window.innerHeight - r.bottom, above = r.top;
      const up = h + 12 > below && above > below;
      let left = align === "right" ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      const top = up ? Math.max(8, r.top - h - 6) : r.bottom + 6;
      setPos((o) => (o && o.top === top && o.left === left && o.width === r.width && o.up === up ? o : { top, left, width: r.width, up }));
    };
    place();
    const ro = new ResizeObserver(place);
    if (pop.current) ro.observe(pop.current);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { ro.disconnect(); window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [anchor, pop, align, match]);
  return createPortal(
    <div ref={pop} style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: match ? pos?.width : undefined, minWidth, zIndex: 95, visibility: pos ? "visible" : "hidden" }}
      className={cx("animate-pop", className)}>{children}</div>,
    // Inside a modal the layer has to live in the modal too, or the modal (drawn on top of the page) would cover it.
    anchor.current?.closest("dialog") ?? document.body,
  );
}

export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={text} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }} className="text-[var(--muted)] hover:text-[var(--text)]">
        <Info className="size-3.5" />
      </button>
      {open && <span role="tooltip" className="absolute left-1/2 top-5 z-50 w-64 -translate-x-1/2 rounded-lg bg-[#12201c] p-3 text-[12.5px] font-normal leading-snug text-white shadow-xl">{text}</span>}
    </span>
  );
}

// =====================================================================================================
// Layout
// =====================================================================================================
/** Stat tiles inside a card drop their own border so cards don't nest boxes in boxes. */
const InCard = createContext(false);
export function Card({ children, className, title, sub, actions, pad = true }: { children: ReactNode; className?: string; title?: ReactNode; sub?: ReactNode; actions?: ReactNode; pad?: boolean }) {
  return (
    <section className={cx("glow-card animate-fade-up rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-[0_1px_2px_rgba(16,24,40,.05)] dark:shadow-[0_1px_2px_rgba(0,0,0,.3)] transition-[border-color] duration-300", pad && "p-5", className)}>
      {(title || actions) && (
        <div className={cx("mb-4 flex flex-wrap items-center justify-between gap-3", !pad && "border-b border-[var(--line)] px-5 py-3.5 mb-0")}>
          <div className="min-w-0"><h2 className="text-[15px] font-bold tracking-[-0.01em]">{title}</h2>{sub && <p className="mt-0.5 text-[13px] text-[var(--muted)]">{sub}</p>}</div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <InCard.Provider value={true}>{children}</InCard.Provider>
    </section>
  );
}
export function PageHeader({ title, sub, actions, back, meta }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { to: string; label: string }; meta?: ReactNode }) {
  return (
    <div className="mb-6">
      {back && <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--muted)] hover:text-[var(--text)]"><ArrowLeft className="size-3.5" />{back.label}</Link>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
          {sub && <p className="mt-1 max-w-[75ch] text-[14px] text-[var(--muted)]">{sub}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-[var(--muted)]">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
/** Animates a stat's number the first time it shows: plain numbers, "12h 30m", "₹1,200.00", "45%". */
function AnimatedValue({ value }: { value: ReactNode }) {
  if (typeof value === "number") return <NumberTicker value={value} />;
  if (typeof value !== "string") return <>{value}</>;
  const hm = /^(\d+)\s*h(?:\s*(\d+)\s*m)?$/.exec(value.trim());
  if (hm) { const total = Number(hm[1]) * 60 + Number(hm[2] ?? 0); return <NumberTicker value={total} format={(n) => formatMinutes(Math.round(n))} />; }
  const m = /^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/.exec(value);
  if (!m) return <>{value}</>;
  const num = Number(m[2].replace(/,/g, ""));
  const dec = (m[2].split(".")[1] ?? "").length;
  const grouped = m[2].includes(",");
  const indian = /\d,\d\d,\d{3}/.test(m[2]);
  return <NumberTicker value={num} format={(n) => `${m[1]}${n.toLocaleString(indian ? "en-IN" : "en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: grouped || num >= 10000 })}${m[3]}`} />;
}
/** Picks an icon from the tile's label, so every stat has one without each page choosing. */
const STAT_ICONS: [RegExp, typeof Clock][] = [
  [/^active|running|open\b/i, PlayCircle], [/paused|on hold/i, PauseCircle], [/ended|closed|archived/i, Archive], [/cap\b|limit|threshold/i, Gauge],
  [/refund/i, Undo2], [/cancel/i, Ban], [/overdue|late|risk|missing|unfilled|reject|sent back/i, AlertTriangle], [/non.?billable|in.?house|internal/i, Building], [/billable/i, BadgeDollarSign],
  [/invoic|billed|bill/i, FileText], [/paid|revenue|received|collect|amount|earn|income|value|outstanding|due|balance|cost|price|budget/i, Wallet],
  [/approv|done|complete|present/i, CheckCircle2], [/pending|wait|submit|review|draft/i, Hourglass], [/leave|holiday|absent/i, Plane],
  [/hour|time|tracked|logged|offline|minutes|capacity|util/i, Clock], [/people|employee|member|team|user|staff|headcount/i, Users],
  [/project/i, FolderKanban], [/client|customer|account/i, Building2], [/lead|deal|pipeline|convert/i, Target], [/task|todo/i, ListChecks], [/asset/i, Package],
];
const TONE_CHIP: Record<string, string> = {
  brand: "bg-[var(--brand-soft)] text-[var(--brand)] dark:text-[#cdb3ef]", late: "bg-[#fbe5dc] text-[#9c3a19] dark:bg-[#9c3a19]/25 dark:text-[#f3a98c]",
  paid: "bg-[#e2f3ea] text-[#17623f] dark:bg-[#17623f]/30 dark:text-[#8fd8b2]", amber: "bg-[#fdf0d9] text-[#7d4c00] dark:bg-[#7d4c00]/30 dark:text-[#f5c879]",
};
/** Long values (₹10,00,000.00) get a smaller size instead of being cut off or wrapped. */
const valueSize = (v: ReactNode, flat: boolean) => {
  const n = typeof v === "string" || typeof v === "number" ? String(v).length : 0;
  if (n > 15) return "text-[15px]";
  if (n > 11) return flat ? "text-[16px]" : "text-[17px]";
  return flat ? "text-[18px]" : "text-[20px]";
};
export function Stat({ label, value, tone, sub, icon, onClick, active, info }: { label: string; value: ReactNode; tone?: "late" | "paid" | "amber" | "brand"; sub?: ReactNode; icon?: ReactNode | false; onClick?: () => void; active?: boolean; info?: string }) {
  const flat = useContext(InCard);
  const Tag = onClick ? "button" : "div";
  const Auto = STAT_ICONS.find(([re]) => re.test(label))?.[1] ?? BarChart3;
  const glyph = icon === false ? null : icon ?? <Auto />;
  return (
    <Tag onClick={onClick} className={cx("group/stat relative min-w-0 text-left transition duration-300",
      flat ? "rounded-xl border border-transparent bg-[var(--bg)]/70 p-3.5 hover:border-[var(--line)]" : "glow-card animate-fade-up rounded-2xl border bg-[var(--card)] p-4 shadow-[0_1px_2px_rgba(16,24,40,.05)] dark:shadow-[0_1px_2px_rgba(0,0,0,.3)]",
      !flat && (active ? "border-[var(--brand)] neon-ring" : "border-[var(--line)]"), flat && active && "!border-[var(--brand-2)] bg-[var(--brand-soft)]", onClick && "cursor-pointer hover:-translate-y-0.5")}>
      <div className="flex items-start gap-3">
        {glyph && <span className={cx("grid shrink-0 place-items-center rounded-xl [&_svg]:size-[18px]", flat ? "size-9" : "size-10", TONE_CHIP[tone ?? "brand"])}>{glyph}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1 text-[13px] font-medium text-[var(--muted)]"><span className="truncate">{label}</span>{info && <InfoTip text={info} />}</div>
          <div className={cx("mt-1 whitespace-nowrap font-semibold leading-tight tracking-[-0.02em] text-[var(--text)] tabnum", valueSize(value, flat))}><AnimatedValue value={value} /></div>
          {sub && <div className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{sub}</div>}
        </div>
      </div>
    </Tag>
  );
}
export const StatGrid = ({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 | 5 | 6 }) => (
  <div className={cx("mb-6 grid gap-3 sm:grid-cols-2", { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" }[cols])}>{children}</div>
);
/** Label/value pairs for detail pages. */
export function DetailList({ items, cols = 2 }: { items: [string, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx("grid gap-x-6 gap-y-4", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-3")}>
      {items.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[12.5px] font-medium text-[var(--muted)]">{k}</dt><dd className="mt-0.5 break-words text-[14px] font-medium">{v === null || v === undefined || v === "" ? "—" : v}</dd></div>)}
    </dl>
  );
}
export const Toolbar = ({ children, right }: { children?: ReactNode; right?: ReactNode }) => (
  <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2">{children}</div>{right && <div className="flex flex-wrap items-center gap-2">{right}</div>}</div>
);

// =====================================================================================================
// Status pills
// =====================================================================================================
const G = "bg-[#e2f3ea] text-[#17623f] dark:bg-[#17623f]/30 dark:text-[#8fd8b2]";
const A = "bg-[#fdf0d9] text-[#7d4c00] dark:bg-[#7d4c00]/30 dark:text-[#f5c879]";
const R = "bg-[#fbe5dc] text-[#9c3a19] dark:bg-[#9c3a19]/30 dark:text-[#f3a98c]";
const B = "bg-[#e5eefb] text-[#24529a] dark:bg-[#24529a]/30 dark:text-[#9fc1f2]";
const N = "bg-[#edf0ee] text-[#4d5955] dark:bg-white/10 dark:text-[#c5cfcb]";
const V = "bg-[#efe8f8] text-[#5b3290] dark:bg-[#5b3290]/30 dark:text-[#cdb3ef]";
const PILL: Record<string, string> = {
  paid: G, partially_paid: A, unpaid: N, overdue: R, due_soon: A, refunded: V, cancelled: `${N} line-through`,
  approved: G, submitted: B, draft: N, rejected: R, none: N, pending: A, active: G, paused: A, ended: N,
  new: B, contacted: N, follow_up: A, converted: G, lost: N, onboarded: G, invited: B, disabled: N,
  trial: B, past_due: A, read_only: R, suspended: R, done: G, running: B, failed: R, open: B, todo: N, in_progress: B, review: V,
  provisional: B, appointed: G, notice: A, inactive: N, present: G, absent: R, leave: A, holiday: V, wfh: B, used: N, expired: N,
  billable: G, inhouse: B, no_work: A, high: R, medium: A, low: N, upwork: G, direct: B, other: N, unassigned: A, assigned: G, good: G, fair: A, damaged: R, retired: N,
};
const LABEL: Record<string, string> = {
  ...INVOICE_STATUS_LABEL, follow_up: "Follow-up", none: "Not started", read_only: "Read-only", past_due: "Past due", in_progress: "In progress", todo: "To do",
  inhouse: "In-house", no_work: "No work", wfh: "WFH", upwork: "Upwork",
};
export function Pill({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-semibold", PILL[status] ?? N)}>{children ?? LABEL[status] ?? String(status ?? "—").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</span>;
}

// =====================================================================================================
// Tables
// =====================================================================================================
/** Splits a list into pages and gives the controls for it. People can pick how many rows a page shows. */
export function usePaged<T>(rows: T[], size = 25) {
  const [page, setPage] = useState(0);
  const [per, setPer] = useState(size);
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const p = Math.min(page, pages - 1);
  useEffect(() => { if (page > pages - 1) setPage(0); }, [pages]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows: rows.slice(p * per, p * per + per), page: p, pages, setPage, total: rows.length, size: per, setSize: (n: number) => { setPer(n); setPage(0); } };
}
export function Pager({ page, pages, setPage, total, size, setSize, noun = "rows" }: { page: number; pages: number; setPage: (n: number) => void; total: number; size: number; setSize?: (n: number) => void; noun?: string }) {
  if (total <= Math.min(size, 10)) return null;
  const nums = Array.from({ length: pages }, (_, i) => i).filter((i) => i === 0 || i === pages - 1 || Math.abs(i - page) <= 1);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[13px] text-[var(--muted)]">
      <div className="flex items-center gap-3">
        <span className="tabnum">{total ? page * size + 1 : 0}–{Math.min(total, page * size + size)} of {total} {noun}</span>
        {setSize && (
          <label className="flex items-center gap-1.5">Show
            <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="h-7 rounded-lg border border-[var(--line)] bg-[var(--card)] px-1.5 text-[12.5px] font-semibold text-[var(--text)]">
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)} className="grid size-8 place-items-center rounded-lg hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"><ChevronLeft className="size-4" /></button>
          {nums.map((n, i) => (
            <span key={n} className="flex items-center">
              {i > 0 && n - nums[i - 1] > 1 && <span className="px-1">…</span>}
              <button aria-current={n === page ? "page" : undefined} onClick={() => setPage(n)} className={cx("h-8 min-w-8 rounded-lg px-2 font-semibold tabnum transition", n === page ? "bg-brand-gradient text-white shadow-[0_4px_14px_-6px_rgb(124_58_237/.8)]" : "hover:bg-black/5 dark:hover:bg-white/10")}>{n + 1}</button>
            </span>
          ))}
          <button aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="grid size-8 place-items-center rounded-lg hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"><ChevronRight className="size-4" /></button>
        </div>
      )}
    </div>
  );
}
const TABLE_BOX = "glow-card overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-[0_1px_2px_rgba(12,8,24,.04)] scrollbar-thin";
/** A simple table. Long tables page automatically (25 rows a page). */
export function Table({ head, children, empty, dense, pageSize = 25 }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode; dense?: boolean; pageSize?: number }) {
  const all = Children.toArray(children).filter(Boolean);
  const pg = usePaged(all, pageSize);
  return (
    <div className={TABLE_BOX}>
      <table className={cx("eszy-table", dense && "dense")}>
        <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>{pg.rows}</tbody>
      </table>
      {!all.length && <div className="p-10 text-center text-[14px] text-[var(--muted)]">{empty ?? "Nothing here yet."}</div>}
      {all.length > 10 && <div className="border-t border-[var(--line)]"><Pager {...pg} /></div>}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sort?: (row: T) => string | number | null | undefined;
  align?: "right" | "left";
  className?: string;
  /** Text for search and CSV export. */
  text?: (row: T) => string;
  hide?: boolean;
  /** Hidden until someone turns it on from "Columns". */
  optional?: boolean;
  /** Let this column's text wrap instead of ending in "…". */
  wrap?: boolean;
  /** Value used by "+ Filter". Columns with a handful of different values get a filter by themselves; `false` turns that off. */
  filter?: ((row: T) => string | string[] | null | undefined) | false;
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
const plainVal = (v: unknown) => (v == null ? "" : String(v).trim());
/** Server-paged lists pass this: the page shown and the total kept on the server. */
export interface RemotePaging { total: number; page: number; size: number; onPage: (n: number) => void; onSize: (n: number) => void }
/**
 * The standard list: search, a date range and "+ Filter" chips worked out from the columns, sortable columns, paging,
 * optional row selection and CSV download. Extra filters go in `filters`. With more than five columns people can choose which to see.
 * Everything sits inside one card: toolbar, active filter chips, the table and the pager.
 */
export function DataTable<T>({ rows, columns, rowKey, search = true, searchPlaceholder = "Search", filters, actions, pageSize = 25, onRowClick, rowHref, empty, selectable, selected, onSelect, exportName, initialSort, loading, footer, tableId, dateFilter, autoFilters = true, remote, title }: {
  rows: T[] | undefined; columns: Column<T>[]; rowKey: (r: T) => string; search?: boolean; searchPlaceholder?: string; filters?: ReactNode; actions?: ReactNode;
  pageSize?: number; onRowClick?: (r: T) => void; rowHref?: (r: T) => string; empty?: ReactNode; selectable?: boolean; selected?: string[]; onSelect?: (ids: string[]) => void;
  exportName?: string; initialSort?: { key: string; dir: "asc" | "desc" }; loading?: boolean; footer?: ReactNode; tableId?: string;
  /** Which column the date range filters on. Found by itself (the first column holding dates); `false` hides it. */
  dateFilter?: string | false; autoFilters?: boolean; remote?: RemotePaging; title?: ReactNode;
}) {
  const nested = useContext(InCard);
  const visible = columns.filter((c) => !c.hide);
  const storeKey = `eszy.cols.${tableId ?? exportName ?? visible.map((c) => c.key).join("-")}`;
  const [shownCols, setShownCols] = useState<string[] | null>(() => { try { return JSON.parse(localStorage.getItem(storeKey) ?? "null"); } catch { return null; } });
  const isOn = (c: Column<T>) => (shownCols ? shownCols.includes(c.key) || typeof c.header !== "string" || !c.header : !c.optional);
  const cols = visible.filter(isOn);
  const pickable = visible.filter((c) => typeof c.header === "string" && c.header);
  const setCol = (key: string, on: boolean) => {
    const base = shownCols ?? visible.filter((c) => !c.optional).map((c) => c.key);
    const next = on ? [...new Set([...base, key])] : base.filter((k) => k !== key);
    setShownCols(next);
    try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [per, setPer] = useState(pageSize);
  const [range, setRange] = useState<Range>(ANY_RANGE);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [openChip, setOpenChip] = useState<string | null>(null);
  const all = rows ?? [];
  const local = !remote;

  // The date column: named, or the first one whose sort value is a date for most rows.
  const dateCol = useMemo(() => {
    if (dateFilter === false || !local) return null;
    if (dateFilter) return visible.find((c) => c.key === dateFilter) ?? null;
    if (all.length < 2) return null;
    const sample = all.slice(0, 60);
    return visible.find((c) => {
      if (!c.sort || c.filter === false) return false;
      const vals = sample.map((r) => c.sort!(r)).filter((v) => v != null && v !== "");
      return vals.length >= Math.ceil(sample.length * 0.5) && vals.every((v) => typeof v === "string" && ISO_DAY.test(v));
    }) ?? null;
  }, [dateFilter, local, all, columns]); // eslint-disable-line react-hooks/exhaustive-deps
  const valuesOf = (c: Column<T>, r: T): string[] => {
    const v = typeof c.filter === "function" ? c.filter(r) : c.text ? c.text(r) : typeof c.sort?.(r) === "string" ? (c.sort(r) as string) : null;
    return (Array.isArray(v) ? v : [v]).map(plainVal).filter(Boolean);
  };
  // Columns worth a "+ Filter" entry: a few distinct short values (status, type, owner, project…).
  const filterable = useMemo(() => {
    if (!autoFilters || !local || !all.length) return [] as { col: Column<T>; options: { value: string; count: number }[] }[];
    return visible.flatMap((c) => {
      if (c.filter === false || c === dateCol || typeof c.header !== "string" || !c.header) return [];
      if (c.filter === undefined && (all.length < 4 || c.align === "right" || (!c.text && typeof c.sort?.(all[0]) !== "string"))) return [];
      const counts = new Map<string, number>();
      for (const r of all) for (const v of valuesOf(c, r)) counts.set(v, (counts.get(v) ?? 0) + 1);
      const n = counts.size;
      const vals = [...counts.keys()];
      if (vals.some((v) => ISO_DAY.test(v) || v.length > 48)) return [];
      const fits = typeof c.filter === "function" ? n >= 1 : n >= 2 && n <= 30 && n <= Math.max(4, all.length * 0.6);
      if (!fits) return [];
      return [{ col: c, options: [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value)) }];
    });
  }, [autoFilters, local, all, columns, dateCol]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeFilters = Object.entries(picked).filter(([, v]) => v.length);
  useEffect(() => setPage(0), [q, rows?.length, range, picked]);

  const textOf = (r: T) => visible.map((c) => (c.text ? c.text(r) : typeof c.sort?.(r) === "string" ? String(c.sort(r)) : "")).join(" ").toLowerCase();
  const filtered = useMemo(() => {
    let list = all;
    if (q.trim()) { const t = q.toLowerCase(); list = list.filter((r) => textOf(r).includes(t)); }
    if (dateCol && range.from) list = list.filter((r) => { const d = String(dateCol.sort!(r) ?? "").slice(0, 10); return !!d && d >= range.from && d <= range.to; });
    for (const [key, vals] of activeFilters) {
      const c = visible.find((x) => x.key === key); if (!c) continue;
      const want = new Set(vals);
      list = list.filter((r) => valuesOf(c, r).some((v) => want.has(v)));
    }
    if (sort) {
      const c = visible.find((x) => x.key === sort.key);
      if (c?.sort) list = [...list].sort((a, b) => { const x = c.sort!(a) ?? "", y = c.sort!(b) ?? ""; const r = x < y ? -1 : x > y ? 1 : 0; return sort.dir === "asc" ? r : -r; });
    }
    return list;
  }, [rows, q, sort, range, picked, dateCol]); // eslint-disable-line
  const pages = Math.max(1, Math.ceil(filtered.length / per));
  const shown = local ? filtered.slice(page * per, page * per + per) : filtered;
  const sel = new Set(selected ?? []);
  const allOnPage = shown.length > 0 && shown.every((r) => sel.has(rowKey(r)));
  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [cols.map((c) => esc(typeof c.header === "string" ? c.header : c.key)).join(","), ...filtered.map((r) => cols.map((c) => esc(c.text ? c.text(r) : String(c.sort?.(r) ?? ""))).join(","))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `${exportName}.csv`;
    a.click();
  };
  const narrowed = !!q.trim() || !!range.from || activeFilters.length > 0;
  const clearAll = () => { setQ(""); setRange(ANY_RANGE); setPicked({}); };
  const unused = filterable.filter((f) => !(f.col.key in picked));
  const toolbar = search || filters || actions || exportName || pickable.length > 5 || dateCol || filterable.length > 0 || title;
  const total = remote ? remote.total : filtered.length;
  return (
    <div className={cx(nested ? "overflow-visible rounded-xl border border-[var(--line)]" : "glow-card rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-[0_1px_2px_rgba(16,24,40,.05)] dark:shadow-[0_1px_2px_rgba(0,0,0,.3)]")}>
      {toolbar && (
        <div className="relative z-10 border-b border-[var(--line)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {title && <h2 className="mr-2 text-[15px] font-bold">{title}</h2>}
              {search && <SearchInput value={q} onChange={setQ} placeholder={searchPlaceholder} className="w-full sm:w-64" />}
              {dateCol && <DateRange value={range} onChange={setRange} allowAll label={typeof dateCol.header === "string" ? dateCol.header : "Date"} />}
              {filters}
              {unused.length > 0 && <AddFilter options={unused.map((f) => ({ key: f.col.key, label: f.col.header as string }))} onPick={(k) => { setPicked((p) => ({ ...p, [k]: [] })); setOpenChip(k); }} />}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {actions}
              {pickable.length > 5 && <ColumnPicker cols={pickable.map((c) => ({ key: c.key, label: c.header as string, on: isOn(c) }))} onChange={setCol} />}
              {exportName && <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!filtered.length}><Download />CSV</Button>}
            </div>
          </div>
          {(Object.keys(picked).length > 0 || narrowed) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {Object.keys(picked).map((k) => {
                const f = filterable.find((x) => x.col.key === k); if (!f) return null;
                return <FilterChip key={k} label={f.col.header as string} options={f.options} value={picked[k]} open={openChip === k} setOpen={(o) => setOpenChip(o ? k : null)}
                  onChange={(v) => setPicked((p) => ({ ...p, [k]: v }))} onRemove={() => setPicked((p) => { const n = { ...p }; delete n[k]; return n; })} />;
              })}
              {narrowed && <span className="text-[12.5px] text-[var(--muted)] tabnum">{filtered.length} of {all.length} shown</span>}
              {narrowed && <button type="button" onClick={clearAll} className="text-[12.5px] font-semibold text-[var(--brand)] hover:underline dark:text-[var(--accent)]">Clear all</button>}
            </div>
          )}
        </div>
      )}
      <div className={cx("overflow-x-auto scrollbar-thin", nested ? "rounded-b-xl" : "rounded-b-2xl", !toolbar && (nested ? "rounded-t-xl" : "rounded-t-2xl"))}>
        <table className="eszy-table">
          <thead>
            <tr>
              {selectable && <th className="w-10"><input type="checkbox" aria-label="Select all on this page" className="size-4 accent-[var(--brand)]" checked={allOnPage}
                onChange={(e) => { const ids = shown.map(rowKey); onSelect?.(e.target.checked ? [...new Set([...sel, ...ids])] : [...sel].filter((x) => !ids.includes(x))); }} /></th>}
              {cols.map((c) => (
                <th key={c.key} scope="col" className={cx(c.align === "right" && "!text-right")}>
                  {c.sort ? (
                    <button className={cx("inline-flex items-center gap-1 hover:text-[var(--text)]", c.align === "right" && "flex-row-reverse")} onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: "desc" }))}>
                      {c.header}{sort?.key === c.key ? (sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowDown className="size-3 opacity-0" />}
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const k = rowKey(r);
              const href = rowHref?.(r);
              return (
                <tr key={k} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx((onRowClick || href) && "cursor-pointer", sel.has(k) && "[&>td]:!bg-[var(--brand-soft)]/60")}>
                  {selectable && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label="Select row" className="size-4 accent-[var(--brand)]" checked={sel.has(k)} onChange={(e) => onSelect?.(e.target.checked ? [...sel, k] : [...sel].filter((x) => x !== k))} /></td>}
                  {cols.map((c, i) => (
                    <td key={c.key} className={cx(c.align === "right" && "text-right tabnum", c.wrap && "wrap", !c.header && "actions", c.className)}>
                      {href && i === 0 ? <Link to={href} className="font-semibold hover:text-[var(--brand)] hover:underline dark:hover:text-[var(--accent)]">{c.cell(r)}</Link> : c.cell(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {footer && <tfoot className="bg-[var(--th-bg)] font-semibold [&_td]:border-t [&_td]:border-[var(--line)] [&_td]:px-4 [&_td]:py-2.5 [&_td]:whitespace-nowrap">{footer}</tfoot>}
        </table>
        {loading && <Spinner />}
        {!loading && !filtered.length && (
          <div className="grid place-items-center gap-2 p-12 text-center text-[14px] text-[var(--muted)]">
            <ListFilter className="size-6 opacity-50" />
            {narrowed ? <>Nothing matches these filters.<button type="button" onClick={clearAll} className="font-semibold text-[var(--brand)] hover:underline dark:text-[var(--accent)]">Clear filters</button></> : empty ?? "Nothing here yet."}
          </div>
        )}
        {(remote ? remote.total > 10 : filtered.length > 10) && (
          <div className="border-t border-[var(--line)]">
            {remote ? <Pager page={remote.page} pages={Math.max(1, Math.ceil(remote.total / remote.size))} setPage={remote.onPage} total={total} size={remote.size} setSize={remote.onSize} />
              : <Pager page={page} pages={pages} setPage={setPage} total={filtered.length} size={per} setSize={(n) => { setPer(n); setPage(0); }} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** "+ Filter": pick a column to filter by. */
export function AddFilter({ options, onPick, label = "Filter" }: { options: { key: string; label: string }[]; onPick: (key: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), pop);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-10 items-center gap-1.5 rounded-xl border border-dashed border-[var(--line)] px-3 text-[13.5px] font-semibold text-[var(--muted)] transition hover:border-[var(--brand-2)] hover:text-[var(--brand)] dark:hover:text-white"><Plus className="size-4" />{label}</button>
      {open && (
        <Floating anchor={ref} pop={pop} className="w-52 rounded-xl border border-[var(--line)] bg-[var(--card)] p-1.5 shadow-[0_18px_50px_-12px_rgba(20,10,50,.35)]">
          <p className="px-2 pb-1 pt-1 text-[12px] font-semibold text-[var(--muted)]">Filter by</p>
          {options.map((o) => <button key={o.key} type="button" onClick={() => { onPick(o.key); setOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px] hover:bg-[var(--bg)]"><FilterIcon className="size-3.5 text-[var(--muted)]" />{o.label}</button>)}
        </Floating>
      )}
    </div>
  );
}
/** One active filter: "Status: Paid, Overdue ×". Clicking it opens a searchable list of values to tick. */
export function FilterChip({ label, options, value, onChange, onRemove, open, setOpen }: {
  label: string; options: { value: string; label?: string; count?: number }[]; value: string[]; onChange: (v: string[]) => void; onRemove: () => void; open: boolean; setOpen: (o: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useOutside(ref, () => { if (open) setOpen(false); }, pop);
  const name = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const list = options.filter((o) => !q || (o.label ?? o.value).toLowerCase().includes(q.toLowerCase()));
  const shownVal = value.length === 0 ? "any" : value.length <= 2 ? value.map(name).join(", ") : `${name(value[0])} +${value.length - 1}`;
  return (
    <div ref={ref} className="relative">
      <div className={cx("flex h-8 items-center overflow-hidden rounded-lg border text-[13px] transition", value.length ? "border-[var(--brand-2)]/50 bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--bg)]")}>
        <button type="button" onClick={() => setOpen(!open)} className="flex h-full max-w-[18rem] items-center gap-1 pl-2.5 pr-1.5">
          <span className="text-[var(--muted)]">{label}:</span><span className="truncate font-semibold">{shownVal}</span><ChevronDown className="size-3.5 opacity-60" />
        </button>
        <button type="button" aria-label={`Remove ${label} filter`} onClick={onRemove} className="grid h-full w-7 place-items-center border-l border-[var(--line)] text-[var(--muted)] hover:bg-black/5 hover:text-[var(--text)] dark:hover:bg-white/10"><X className="size-3.5" /></button>
      </div>
      
        {open && (
          <Floating anchor={ref} pop={pop} className="w-64 rounded-xl border border-[var(--line)] bg-[var(--card)] p-2 shadow-[0_18px_50px_-12px_rgba(20,10,50,.35)]">
            {options.length > 6 && <SearchInput value={q} onChange={setQ} placeholder={`Search ${label.toLowerCase()}`} className="mb-1.5 h-8" />}
            <div className="max-h-64 overflow-y-auto scrollbar-thin">
              {list.map((o) => (
                <label key={o.value} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-[var(--bg)]">
                  <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={value.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((x) => x !== o.value))} />
                  <span className="min-w-0 flex-1 truncate">{o.label ?? o.value}</span>{o.count !== undefined && <span className="text-[12px] text-[var(--muted)] tabnum">{o.count}</span>}
                </label>
              ))}
              {!list.length && <p className="px-2 py-3 text-center text-[13px] text-[var(--muted)]">No matches</p>}
            </div>
            <div className="mt-1.5 flex justify-between border-t border-[var(--line)] pt-1.5">
              <button type="button" onClick={() => onChange([])} className="rounded-md px-2 py-1 text-[12.5px] font-semibold text-[var(--muted)] hover:text-[var(--text)]">Clear</button>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-[12.5px] font-semibold text-[var(--brand)] dark:text-[var(--accent)]">Done</button>
            </div>
          </Floating>
        )}
    </div>
  );
}

/** "Columns" menu: tick the columns to show. */
function ColumnPicker({ cols, onChange }: { cols: { key: string; label: string; on: boolean }[]; onChange: (key: string, on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), pop);
  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}><Columns3 />Columns</Button>
      {open && (
        <Floating anchor={ref} pop={pop} align="right" className="w-56 rounded-xl border border-[var(--line)] bg-[var(--card)] p-1.5 shadow-[0_18px_50px_-12px_rgba(20,10,50,.35)]">
          <p className="px-2 pb-1 pt-1 text-[12px] font-semibold text-[var(--muted)]">Show columns</p>
          {cols.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-[var(--bg)]">
              <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={c.on} onChange={(e) => onChange(c.key, e.target.checked)} />{c.label}
            </label>
          ))}
        </Floating>
      )}
    </div>
  );
}

// =====================================================================================================
// Navigation inside a page
// =====================================================================================================
/** Underlined tabs. When there are more than fit, the row scrolls sideways with faded edges and arrows, never a scroll bar. */
export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: ReactNode; count?: number; hide?: boolean }[]; value: string; onChange: (id: string) => void }) {
  const group = useMemo(() => `tabs-${Math.random().toString(36).slice(2)}`, []);
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  const measure = useCallback(() => { const el = ref.current; if (!el) return; setEdge({ l: el.scrollLeft > 2, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 }); }, []);
  useEffect(() => { measure(); const ro = new ResizeObserver(measure); if (ref.current) ro.observe(ref.current); return () => ro.disconnect(); }, [measure, tabs.length]);
  useEffect(() => { ref.current?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [value]);
  const nudge = (d: number) => ref.current?.scrollBy({ left: d * 240, behavior: "smooth" });
  return (
    <div className="relative mb-5 border-b border-[var(--line)]">
      <div ref={ref} role="tablist" onScroll={measure} className="no-scrollbar flex gap-1 overflow-x-auto">
        {tabs.filter((t) => !t.hide).map((t) => (
          <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
            className={cx("relative shrink-0 whitespace-nowrap px-3 py-2.5 text-[14px] font-semibold transition", value === t.id ? "text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]")}>
            {t.label}{t.count !== undefined && <span className={cx("ml-1.5 rounded-md px-1.5 py-px text-[11.5px] tabnum", value === t.id ? "bg-[var(--brand-soft)] text-[var(--brand)] dark:text-white" : "bg-black/5 dark:bg-white/10")}>{t.count}</span>}
            {value === t.id && <motion.span layoutId={group} className="absolute inset-x-1 -bottom-px h-[2.5px] rounded-full bg-brand-gradient shadow-[0_0_12px_rgb(168_85_247/.7)]" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          </button>
        ))}
      </div>
      {edge.l && <button aria-label="Scroll tabs left" onClick={() => nudge(-1)} className="absolute inset-y-0 left-0 flex w-12 items-center bg-gradient-to-r from-[var(--bg)] via-[var(--bg)] to-transparent text-[var(--muted)] hover:text-[var(--text)]"><ChevronLeft className="size-4" /></button>}
      {edge.r && <button aria-label="Scroll tabs right" onClick={() => nudge(1)} className="absolute inset-y-0 right-0 flex w-12 items-center justify-end bg-gradient-to-l from-[var(--bg)] via-[var(--bg)] to-transparent text-[var(--muted)] hover:text-[var(--text)]"><ChevronRight className="size-4" /></button>}
    </div>
  );
}

/**
 * A page with a section list on the left that stays put while the right side scrolls (settings, masters, roles).
 * On small screens the list becomes a drop-down above the content.
 */
export function SideNavLayout({ groups, value, onChange, children }: {
  groups: { label?: string; items: { id: string; label: ReactNode; icon?: ReactNode; count?: number }[] }[]; value: string; onChange: (id: string) => void; children: ReactNode;
}) {
  const items = groups.flatMap((g) => g.items);
  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
      <div className="lg:hidden">
        <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Section">
          {groups.map((g, i) => <optgroup key={i} label={g.label ?? ""}>{g.items.map((it) => <option key={it.id} value={it.id}>{typeof it.label === "string" ? it.label : it.id}</option>)}</optgroup>)}
        </Select>
      </div>
      <nav aria-label="Sections" className="hidden lg:block">
        <div className="sticky top-24 grid max-h-[calc(100vh-7rem)] gap-5 overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--card)] p-2.5 scrollbar-thin">
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.label && <p className="px-3 pb-1.5 pt-1 text-[12px] font-semibold text-[var(--muted)]">{g.label}</p>}
              <ul className="grid gap-0.5">
                {g.items.map((it) => {
                  const on = it.id === value;
                  return (
                    <li key={it.id}>
                      <button onClick={() => onChange(it.id)} aria-current={on ? "page" : undefined}
                        className={cx("relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] font-medium transition [&_svg]:size-4 [&_svg]:shrink-0", on ? "text-[var(--brand)] dark:text-white" : "text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]")}>
                        {on && <motion.span layoutId="side-nav-pill" className="absolute inset-0 rounded-xl bg-[var(--brand-soft)] ring-1 ring-[var(--brand-2)]/25" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                        {on && <motion.span layoutId="side-nav-bar" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand-gradient" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                        <span className="relative flex min-w-0 flex-1 items-center gap-2.5">{it.icon}<span className="truncate">{it.label}</span></span>
                        {it.count !== undefined && <span className="relative rounded-md bg-black/5 px-1.5 text-[11.5px] tabnum dark:bg-white/10">{it.count}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
      <div className="min-w-0">{items.some((i) => i.id === value) ? children : null}</div>
    </div>
  );
}
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode }[] }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-xl border border-[var(--line)] bg-[var(--bg)] p-0.5">
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className={cx("relative h-8 rounded-lg px-3 text-[13px] font-semibold transition", value === o.id ? "text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]")}>
          {value === o.id && <motion.span layoutId={`seg-${options.map((x) => x.id).join("")}`} className="absolute inset-0 rounded-lg bg-[var(--card)] shadow-sm ring-1 ring-[var(--brand-2)]/25" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// =====================================================================================================
// Dates
// =====================================================================================================
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDaysIso = (s: string, n: number) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return iso(d); };
export function rangeFor(preset: string, weekStartsOn = 1): { from: string; to: string } {
  const t = new Date(); const today = iso(t);
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") { const y = addDaysIso(today, -1); return { from: y, to: y }; }
  if (preset === "week") { const d = new Date(t); d.setDate(d.getDate() - ((d.getDay() - weekStartsOn + 7) % 7)); return { from: iso(d), to: today }; }
  if (preset === "last_week") { const d = new Date(t); d.setDate(d.getDate() - ((d.getDay() - weekStartsOn + 7) % 7) - 7); return { from: iso(d), to: addDaysIso(iso(d), 6) }; }
  if (preset === "month") return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: today };
  if (preset === "last_month") return { from: iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: iso(new Date(t.getFullYear(), t.getMonth(), 0)) };
  if (preset === "quarter") return { from: iso(new Date(t.getFullYear(), t.getMonth() - 2, 1)), to: today };
  if (preset === "year") return { from: iso(new Date(t.getFullYear(), 0, 1)), to: today };
  return { from: addDaysIso(today, -29), to: today };
}
export interface Range { preset: string; from: string; to: string }
export const useRange = (preset = "month") => useState<Range>(() => ({ preset, ...rangeFor(preset) }));
export const ANY_RANGE: Range = { preset: "all", from: "", to: "" };
const RANGE_NAMES: Record<string, string> = { all: "Any date", today: "Today", yesterday: "Yesterday", week: "This week", last_week: "Last week", month: "This month", last_month: "Last month", quarter: "Last 3 months", year: "This year", last30: "Last 30 days", custom: "Custom dates" };
const WD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
/**
 * Date range picker: one button that opens quick ranges (Today, Yesterday, This week…), two date boxes and a calendar,
 * with Clear and Apply. `allowAll` adds "Any date", which is also what Clear picks (used for list filters).
 */
export function DateRange({ value, onChange, presets = ["today", "yesterday", "week", "last_week", "month", "last_month", "quarter", "year"], allowAll, label = "Date" }: {
  value: Range; onChange: (r: Range) => void; presets?: string[]; allowAll?: boolean; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Range>(value);
  const [month, setMonth] = useState(() => (value.from || iso(new Date())).slice(0, 7));
  const [picking, setPicking] = useState<"from" | "to">("from");
  const [alignRight, setAlignRight] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), pop);
  const show = () => {
    setDraft(value); setPicking("from"); setMonth((value.from || iso(new Date())).slice(0, 7));
    const r = ref.current?.getBoundingClientRect(); setAlignRight(!!r && r.left + 600 > window.innerWidth);
    setOpen(true);
  };
  const list = allowAll ? ["all", ...presets] : presets;
  const pick = (p: string) => { const r = p === "all" ? ANY_RANGE : { preset: p, ...rangeFor(p) }; setDraft(r); if (r.from) setMonth(r.from.slice(0, 7)); };
  const apply = (r = draft) => { if (r.from && r.to && r.from > r.to) r = { ...r, from: r.to, to: r.from }; onChange(r); setOpen(false); };
  const clickDay = (d: string) => {
    if (picking === "from" || !draft.from || d < draft.from) { setDraft({ preset: "custom", from: d, to: d }); setPicking("to"); }
    else { setDraft({ preset: "custom", from: draft.from, to: d }); setPicking("from"); }
  };
  // calendar grid for the shown month, weeks starting Monday
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(new Date(y, m - 1, i + 1)))];
  while (cells.length % 7) cells.push(null);
  const shift = (n: number) => { const d = new Date(y, m - 1 + n, 1); setMonth(iso(d).slice(0, 7)); };
  const today = iso(new Date());
  const end = picking === "to" && hover && draft.from && hover >= draft.from ? hover : draft.to;
  const text = value.preset === "all" || !value.from ? RANGE_NAMES.all : value.preset !== "custom" && RANGE_NAMES[value.preset] ? RANGE_NAMES[value.preset]
    : value.from === value.to ? fmtDate(value.from) : `${fmtDate(value.from, { day: "numeric", month: "short" })} – ${fmtDate(value.to)}`;
  const active = value.preset !== "all" && !!value.from;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => (open ? setOpen(false) : show())} aria-expanded={open} aria-label={`${label}: ${text}`}
        className={cx("flex h-10 items-center gap-2 rounded-xl border px-3 text-[13.5px] font-medium transition", active && allowAll ? "border-[var(--brand-2)]/50 bg-[var(--brand-soft)] text-[var(--brand)] dark:text-white" : "border-[var(--line)] bg-[var(--card)] hover:border-[var(--brand-2)]/50")}>
        <CalendarDays className="size-4 shrink-0 opacity-70" />
        {allowAll && <span className="text-[var(--muted)]">{label}:</span>}
        <span className="whitespace-nowrap tabnum">{text}</span>
        {!allowAll && value.preset !== "custom" && value.from && <span className="hidden whitespace-nowrap text-[12px] text-[var(--muted)] tabnum xl:inline">{fmtDate(value.from, { day: "numeric", month: "short" })} – {fmtDate(value.to, { day: "numeric", month: "short" })}</span>}
        <ChevronDown className={cx("size-3.5 shrink-0 opacity-60 transition", open && "rotate-180")} />
      </button>
      
        {open && (
          <Floating anchor={ref} pop={pop} align={alignRight ? "right" : "left"}
            className="w-[min(590px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-[0_24px_60px_-20px_rgba(30,10,70,.45)]">
            <div className="grid sm:grid-cols-[170px_minmax(0,1fr)]">
              <div className="flex flex-wrap gap-1.5 border-b border-[var(--line)] bg-[var(--bg)]/60 p-3 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r">
                {list.map((p) => (
                  <button key={p} type="button" onClick={() => pick(p)}
                    className={cx("rounded-lg px-3 py-1.5 text-left text-[13px] font-medium transition", draft.preset === p ? "bg-brand-gradient text-white shadow-[0_4px_14px_-6px_rgb(124_58_237/.8)]" : "text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--text)]")}>{RANGE_NAMES[p] ?? p}</button>
                ))}
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[12px] font-semibold text-[var(--muted)]">From
                    <Input type="date" value={draft.from} max={draft.to || undefined} onFocus={() => setPicking("from")} onChange={(e) => { setDraft({ ...draft, preset: "custom", from: e.target.value, to: draft.to || e.target.value }); if (e.target.value) setMonth(e.target.value.slice(0, 7)); }} className="mt-1 h-9" />
                  </label>
                  <label className="text-[12px] font-semibold text-[var(--muted)]">To
                    <Input type="date" value={draft.to} min={draft.from || undefined} onFocus={() => setPicking("to")} onChange={(e) => setDraft({ ...draft, preset: "custom", to: e.target.value, from: draft.from || e.target.value })} className="mt-1 h-9" />
                  </label>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="grid size-8 place-items-center rounded-lg hover:bg-[var(--bg)]"><ChevronLeft className="size-4" /></button>
                  <span className="text-[13.5px] font-bold">{first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
                  <button type="button" aria-label="Next month" onClick={() => shift(1)} className="grid size-8 place-items-center rounded-lg hover:bg-[var(--bg)]"><ChevronRight className="size-4" /></button>
                </div>
                <div className="mt-1 grid grid-cols-7 text-center text-[11.5px] font-semibold text-[var(--muted)]">{WD.map((d) => <span key={d} className="py-1">{d}</span>)}</div>
                <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHover(null)}>
                  {cells.map((d, i) => {
                    if (!d) return <span key={i} />;
                    const inRange = !!draft.from && !!end && d >= draft.from && d <= end;
                    const edge = d === draft.from || d === end;
                    return (
                      <button key={d} type="button" onClick={() => clickDay(d)} onMouseEnter={() => setHover(d)}
                        className={cx("relative h-8 text-[13px] tabnum transition", inRange && !edge && "bg-[var(--brand-soft)] text-[var(--brand)] dark:text-white", edge && "rounded-lg bg-brand-gradient font-bold text-white", !inRange && "rounded-lg hover:bg-[var(--bg)]", d === today && !edge && "font-bold underline decoration-[var(--brand-2)] decoration-2 underline-offset-4")}>
                        {Number(d.slice(8))}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 h-4 text-[12px] text-[var(--muted)]">{picking === "to" ? "Now pick the last day." : draft.from ? `${fmtDate(draft.from)}${draft.to && draft.to !== draft.from ? ` – ${fmtDate(draft.to)}` : ""}` : "Pick the first day."}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => apply(allowAll ? ANY_RANGE : { preset: "month", ...rangeFor("month") })}>Clear</Button>
              <Button size="sm" onClick={() => apply()} disabled={!allowAll && (!draft.from || !draft.to)}>Apply</Button>
            </div>
          </Floating>
        )}
    </div>
  );
}
export const fmtDate = (s: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => {
  if (!s) return "—";
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, opts);
};
export const fmtDay = (s: string) => fmtDate(s, { weekday: "short", day: "numeric", month: "short" });
export const fmtDateTime = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");

// =====================================================================================================
// Overlays
// =====================================================================================================
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean | "xl"; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  // Rendered at the end of the page so styles of whatever opened it (a table cell, a card) never leak into it.
  return createPortal(
    <dialog ref={ref} onClose={onClose} onCancel={onClose} className={cx("m-auto max-h-[92vh] w-[calc(100%-32px)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] p-0 text-[var(--text)] shadow-2xl backdrop:bg-[#07050d]/60 backdrop:backdrop-blur-sm open:animate-[fade-up_.25s_cubic-bezier(.2,.7,.2,1)]", wide === "xl" ? "max-w-5xl" : wide ? "max-w-3xl" : "max-w-lg")}>
      {open && (
        <div className="flex max-h-[92vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-6 py-4"><h2 className="text-[17px] font-bold">{title}</h2><button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-[var(--muted)] hover:bg-black/5"><X className="size-5" /></button></div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-[var(--line)] bg-[var(--bg)]/60 px-6 py-3">{footer}</div>}
        </div>
      )}
    </dialog>, document.body);
}
/** A panel that slides in from the right, for forms and details that shouldn't leave the list. */
export function Drawer({ open, onClose, title, children, footer, width = "max-w-xl" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div className="absolute inset-0 bg-[#07050d]/50 backdrop-blur-[2px]" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <motion.aside role="dialog" aria-modal className={cx("absolute inset-y-0 right-0 flex w-full flex-col border-l border-[var(--line)] bg-[var(--card)] shadow-2xl", width)}
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 380, damping: 40 }}>
            <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-6 py-4"><h2 className="text-[17px] font-bold">{title}</h2><button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-[var(--muted)] hover:bg-black/5"><X className="size-5" /></button></div>
            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-[var(--line)] bg-[var(--bg)]/60 px-6 py-3">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>, document.body);
}
const ConfirmCtx = createContext<(o: { title: string; body?: ReactNode; confirm?: string; danger?: boolean; reason?: string }) => Promise<string | false>>(async () => false);
/** `await confirm({...})` returns false, or the typed reason (or "" when no reason is asked). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<{ o: any; res: (v: string | false) => void } | null>(null);
  const [reason, setReason] = useState("");
  const ask = useCallback((o: any) => new Promise<string | false>((res) => { setReason(""); setSt({ o, res }); }), []);
  const close = (v: string | false) => { st?.res(v); setSt(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal open={!!st} onClose={() => close(false)} title={st?.o.title ?? ""}
        footer={<><Button variant="secondary" onClick={() => close(false)}>Cancel</Button><Button variant={st?.o.danger ? "danger" : "primary"} disabled={!!st?.o.reason && reason.trim().length < 3} onClick={() => close(reason)}>{st?.o.confirm ?? "Confirm"}</Button></>}>
        {st?.o.body && <div className="text-[14px] text-[var(--muted)]">{st.o.body}</div>}
        {st?.o.reason && <Field label={st.o.reason} className="mt-4"><Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// =====================================================================================================
// Small pieces
// =====================================================================================================
export function Spinner({ label = "Loading" }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 p-10 text-[14px] text-[var(--muted)]"><Loader2 className="size-5 animate-spin" /> {label}…</div>;
}
/** Turns an API field name into words: "hourlyRateMinor" → "Hourly rate", "clientId" → "Client". */
const fieldWords = (k: string) => {
  const w = k.replace(/\.\d+\./g, " ").replace(/(Minor|Id|Ids|Minutes)$/, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();
  return w.charAt(0).toUpperCase() + w.slice(1);
};
const plainMsg = (m: string) =>
  /^(Required|Invalid uuid|Expected .* received (null|undefined))$/i.test(m) ? "is required"
    : /^Invalid email/i.test(m) ? "isn't a valid email address"
    : /at least 1 character/i.test(m) ? "can't be empty"
    : /^String must contain at least (\d+)/i.test(m) ? `needs at least ${/(\d+)/.exec(m)![1]} characters`
    : /^Number must be greater than or equal to 0/i.test(m) ? "can't be negative"
    : /^Expected number/i.test(m) ? "must be a number" : m;
/** Each problem as one readable line: the field name, then what's wrong (unless the message already names the field). */
const fieldLines = (fields: Record<string, string[]>) => Object.entries(fields).map(([k, v]) => {
  const label = fieldWords(k), msg = plainMsg(v[0] ?? "");
  return { key: k, label, text: /^[A-Z]/.test(msg) && msg.split(" ").length > 2 ? msg : `${label} ${msg}` };
});
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
/** Tells the Fields next to an error which of them are wrong, so they can show it in red right under the box. */
function announceFieldErrors(el: HTMLElement | null, fields: Record<string, string[]> | null) {
  const scope = el?.closest("dialog, [role=dialog]") ?? null;
  window.dispatchEvent(new CustomEvent("eszy:field-errors", { detail: { scope, fields: fields ? fieldLines(fields) : [] } }));
}
export function ErrorNote({ error }: { error: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const e = error as ApiError;
  const fieldsObj = e instanceof ApiError ? e.fields : {};
  const lines = fieldLines(fieldsObj);
  useEffect(() => {
    announceFieldErrors(ref.current, lines.length ? fieldsObj : null);
    if (error && !lines.length) requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    if (lines.length) requestAnimationFrame(() => {
      const scope = ref.current?.closest("dialog, [role=dialog]") ?? document;
      const bad = scope.querySelector<HTMLElement>("[data-invalid=true]");
      (bad ?? ref.current)?.scrollIntoView({ behavior: "smooth", block: "center" });
      bad?.querySelector<HTMLElement>("input,select,textarea,button")?.focus({ preventScroll: true });
    });
    return () => announceFieldErrors(ref.current, null);
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!error) return null;
  const problems = e instanceof ApiError ? e.problems : [];
  return (
    <div ref={ref} role="alert" className="rounded-lg border border-[#f3c3b0] bg-[#fdf1ec] p-3 text-[13.5px] text-[#7a2b10] dark:border-[#7a2b10] dark:bg-[#7a2b10]/20 dark:text-[#f3a98c]">
      <strong>{lines.length ? (lines.length === 1 ? "One thing needs fixing:" : `${lines.length} things need fixing:`) : e.message}</strong>
      {problems.length > 0 && <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {lines.length > 0 && <ul className="mt-1 list-disc pl-5">{lines.map((l) => <li key={l.key}>{l.text}</li>)}</ul>}
    </div>
  );
}
export const Hours = ({ m, zero = "0 h" }: { m: number | null | undefined; zero?: string }) => <span className="tabnum">{m == null ? "—" : m === 0 ? zero : formatMinutes(m)}</span>;
export const hrs = (m: number | null | undefined) => (m == null ? "—" : m === 0 ? "0 h" : formatMinutes(m));

/** Capacity bar: amber while within the cap, red when full. */
export function CapBar({ used, cap, label }: { used: number; cap: number | null; label?: string }) {
  if (!cap) return <span className="text-[13px] text-[var(--muted)]">No cap</span>;
  const pct = Math.min(100, (used / cap) * 100);
  return (
    <div className="min-w-36">
      <div className="flex justify-between gap-2 text-[12.5px] text-[var(--muted)] tabnum"><span>{label ?? `${formatMinutes(used)} of ${formatMinutes(cap)}`}</span><span>{Math.round(pct)}%</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[.07] dark:bg-white/10"><div className={cx("h-full rounded-full", pct >= 100 ? "bg-[#b4441f]" : pct >= 80 ? "bg-[#e08a1e]" : "bg-[var(--accent)]")} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
export function Progress({ pct, tone = "brand" }: { pct: number; tone?: "brand" | "amber" | "late" | "paid" }) {
  const c = { brand: "bg-[var(--brand)]", amber: "bg-[var(--accent)]", late: "bg-[#b4441f]", paid: "bg-[#1c7a4f]" }[tone];
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[.07] dark:bg-white/10"><div className={cx("h-full rounded-full", c)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;
}
export function Empty({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--card)] p-10 text-center">
      {icon && <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)] [&_svg]:size-5">{icon}</div>}
      <h3 className="text-[15.5px] font-bold">{title}</h3>
      {children && <p className="mx-auto mt-1 max-w-md text-[14px] text-[var(--muted)]">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export const Muted = ({ children }: { children: ReactNode }) => <span className="text-[13px] text-[var(--muted)]">{children}</span>;
export const Sub = ({ children }: { children: ReactNode }) => <div className="text-[12.5px] text-[var(--muted)]">{children}</div>;

// =====================================================================================================
// Toasts
// =====================================================================================================
const ToastCtx = createContext<(msg: string, tone?: "ok" | "err") => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; tone: "ok" | "err" }[]>([]);
  const push = useCallback((msg: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      <ConfirmProvider>{children}</ConfirmProvider>
      <div aria-live="polite" className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {items.map((t) => <div key={t.id} className={cx("flex max-w-sm items-center gap-2 rounded-xl px-4 py-3 text-[13.5px] font-semibold text-white shadow-xl", t.tone === "ok" ? "bg-[#12201c]" : "bg-[#b4441f]")}>{t.tone === "ok" && <Check className="size-4 text-[#8fd8b2]" />}{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
