import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Bold, Code, Eye, Heading2, Italic, Link2, List, ListOrdered, Pencil, Quote, Strikethrough } from "lucide-react";

/**
 * Text areas with a small formatting bar: bold, italic, strike, heading, bullet and numbered lists, quote, code and links,
 * plus a Preview. Text is kept as light markdown (**bold**, _italic_, - lists…), so it stays readable anywhere
 * (emails, exports, Astra) and shows formatted wherever eszy displays it (see RichText).
 */
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { inputClassName?: string };

export const RichEditor = forwardRef<HTMLTextAreaElement, Props>(function RichEditor({ className, inputClassName, value, onChange, disabled, rows, ...p }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ta.current!);
  const [preview, setPreview] = useState(false);
  const text = String(value ?? "");
  const emit = (next: string, selStart: number, selEnd = selStart) => {
    onChange?.({ target: { value: next }, currentTarget: { value: next } } as any);
    requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.setSelectionRange(selStart, selEnd); } });
  };
  /** Wrap the selection, e.g. **bold**; with nothing selected, insert the markers around a placeholder. */
  const wrap = (before: string, after = before, placeholder = "text") => {
    const el = ta.current; if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const sel = text.slice(s, e) || placeholder;
    emit(text.slice(0, s) + before + sel + after + text.slice(e), s + before.length, s + before.length + sel.length);
  };
  /** Prefix each selected line, e.g. "- " for bullets or "1. " for a numbered list. */
  const lines = (prefix: (i: number) => string) => {
    const el = ta.current; if (!el) return;
    const s = text.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const eIdx = text.indexOf("\n", el.selectionEnd);
    const e = eIdx === -1 ? text.length : eIdx;
    const block = text.slice(s, e).split("\n").map((l, i) => prefix(i) + l.replace(/^(\s*([-*]|\d+\.)\s+|>\s?|#{1,3}\s)/, "")).join("\n");
    emit(text.slice(0, s) + block + text.slice(e), s + block.length);
  };
  const link = () => {
    const el = ta.current; if (!el) return;
    const url = window.prompt("Link address", "https://");
    if (!url) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const label = text.slice(s, e) || "link";
    const md = `[${label}](${url})`;
    emit(text.slice(0, s) + md + text.slice(e), s + md.length);
  };
  // Continue lists when pressing Enter inside one; keyboard shortcuts for bold, italic and link.
  const onKeyDown = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    p.onKeyDown?.(ev);
    if (ev.defaultPrevented) return;
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === "b") { ev.preventDefault(); wrap("**"); return; }
    if (mod && ev.key.toLowerCase() === "i") { ev.preventDefault(); wrap("_"); return; }
    if (mod && ev.key.toLowerCase() === "k") { ev.preventDefault(); link(); return; }
    if (ev.key === "Enter" && !ev.shiftKey) {
      const el = ev.currentTarget; const pos = el.selectionStart;
      const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
      const line = text.slice(lineStart, pos);
      const m = /^(\s*)([-*]|(\d+)\.)\s+(.*)$/.exec(line);
      if (m) {
        ev.preventDefault();
        if (!m[4].trim()) { emit(text.slice(0, lineStart) + text.slice(pos), lineStart); return; }
        const next = m[3] ? `${m[1]}${Number(m[3]) + 1}. ` : `${m[1]}${m[2]} `;
        emit(text.slice(0, pos) + "\n" + next + text.slice(pos), pos + 1 + next.length);
      }
    }
  };
  const tools: [ReactNode, string, () => void][] = [
    [<Bold key="b" />, "Bold (Ctrl+B)", () => wrap("**")], [<Italic key="i" />, "Italic (Ctrl+I)", () => wrap("_")], [<Strikethrough key="s" />, "Strikethrough", () => wrap("~~")],
    [<Heading2 key="h" />, "Heading", () => lines(() => "## ")], [<List key="ul" />, "Bullet list", () => lines(() => "- ")], [<ListOrdered key="ol" />, "Numbered list", () => lines((i) => `${i + 1}. `)],
    [<Quote key="q" />, "Quote", () => lines(() => "> ")], [<Code key="c" />, "Code", () => wrap("`")], [<Link2 key="l" />, "Link (Ctrl+K)", link],
  ];
  return (
    <div className={cx("rich-editor w-full min-w-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)] transition focus-within:border-[var(--brand-2)] focus-within:ring-[3px] focus-within:ring-[var(--brand-2)]/20", disabled && "opacity-70", className)}>
      {!disabled && (
        <div className="flex items-center gap-0.5 border-b border-[var(--line)] bg-[var(--bg)]/60 px-1.5 py-1">
          {!preview && tools.map(([icon, label, fn], i) => (
            <button key={i} type="button" tabIndex={-1} title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={fn}
              className="grid size-7 place-items-center rounded-md text-[var(--muted)] transition hover:bg-[var(--card)] hover:text-[var(--text)] [&_svg]:size-[15px]">{icon}</button>
          ))}
          <button type="button" onClick={() => setPreview((x) => !x)} className="ml-auto flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--text)]">
            {preview ? <><Pencil className="size-3.5" />Write</> : <><Eye className="size-3.5" />Preview</>}
          </button>
        </div>
      )}
      {preview ? (
        <div className="min-h-24 px-3 py-2 text-[14px]">{text.trim() ? <RichText text={text} /> : <p className="text-[var(--muted)]">Nothing to preview yet.</p>}</div>
      ) : (
        <textarea ref={ta} value={value} onChange={onChange} disabled={disabled} rows={rows ?? 4} {...p} onKeyDown={onKeyDown}
          className={cx("block w-full resize-y bg-transparent px-3 py-2 text-[14px] leading-relaxed outline-none placeholder:text-[var(--muted)]/70", inputClassName)} />
      )}
    </div>
  );
});

// ------------------------------------------------------------------------------------------------ showing it
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function inline(s: string) {
  let h = esc(s);
  h = h.replace(/`([^`]+)`/g, '<code class="rounded bg-black/5 px-1 py-px text-[0.92em] dark:bg-white/10">$1</code>');
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="font-semibold text-[var(--brand)] underline dark:text-[var(--accent)]">$1</a>');
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer" class="font-semibold text-[var(--brand)] underline break-all dark:text-[var(--accent)]">$2</a>');
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^\w])_([^_]+)_(?!\w)/g, "$1<em>$2</em>").replace(/~~([^~]+)~~/g, "<s>$1</s>");
  return h;
}
/** Shows text written with the editor: headings, lists, quotes, bold, italic, code and links. Safe: everything else is escaped. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trimEnd();
    const ul = /^\s*[-*]\s+(.*)$/.exec(line), ol = /^\s*\d+\.\s+(.*)$/.exec(line), q = /^>\s?(.*)$/.exec(line), hd = /^(#{1,3})\s+(.*)$/.exec(line);
    if (ul || ol) {
      const want = ul ? "ul" : "ol";
      if (list !== want) { close(); out.push(want === "ul" ? '<ul class="my-1 list-disc pl-5">' : '<ol class="my-1 list-decimal pl-5">'); list = want; }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
      continue;
    }
    close();
    if (hd) out.push(`<p class="mt-2 font-bold ${hd[1].length === 1 ? "text-[17px]" : "text-[15px]"}">${inline(hd[2])}</p>`);
    else if (q) out.push(`<blockquote class="my-1 border-l-2 border-[var(--brand-2)]/50 pl-3 text-[var(--muted)]">${inline(q[1])}</blockquote>`);
    else if (!line.trim()) out.push('<div class="h-2"></div>');
    else out.push(`<p>${inline(line)}</p>`);
  }
  close();
  return <div className={cx("rich-text break-words leading-relaxed", className)} dangerouslySetInnerHTML={{ __html: out.join("") }} />;
}
/** The same text without formatting marks, for one-line places (table cells, notifications). */
export const plainText = (s: string | null | undefined) =>
  String(s ?? "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/(\*\*|~~|`)/g, "").replace(/(^|[^\w])_([^_]+)_(?!\w)/g, "$1$2").replace(/^\s*([-*]|\d+\.|>|#{1,3})\s+/gm, "").replace(/\n+/g, " · ").trim();
