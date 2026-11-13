import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { setThemeChoice, themeChoice, type ThemeChoice } from "../lib/session";
import { AnimatePresence, motion } from "./magic";
import { cx } from "./ui";

const isDark = () => document.documentElement.classList.contains("dark");

/** Hook: the current look and this person's choice, kept in step when it changes anywhere. */
export function useTheme() {
  const [dark, setDark] = useState(isDark);
  const [choice, setChoice] = useState<ThemeChoice | null>(themeChoice);
  useEffect(() => {
    const mo = new MutationObserver(() => { setDark(isDark()); setChoice(themeChoice()); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return { dark, choice, set: (v: ThemeChoice | null) => { setThemeChoice(v); setChoice(v); } };
}

/** The sun/moon button in the top bar: one click switches between light and dark. */
export function ThemeToggle() {
  const { dark, set } = useTheme();
  return (
    <button onClick={() => set(dark ? "light" : "dark")} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title={dark ? "Light theme" : "Dark theme"}
      className="relative grid size-10 place-items-center overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)] text-[var(--text)] shadow-sm transition hover:border-[var(--brand-2)]/50 hover:shadow-[0_0_0_1px_rgb(168_85_247/.25),0_6px_20px_-10px_rgb(168_85_247/.7)]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={dark ? "moon" : "sun"} initial={{ y: 14, rotate: -60, opacity: 0 }} animate={{ y: 0, rotate: 0, opacity: 1 }} exit={{ y: -14, rotate: 60, opacity: 0 }} transition={{ duration: 0.22 }}>
          {dark ? <Moon className="size-[18px] text-[#c4a5ff]" /> : <Sun className="size-[18px] text-[#e08a1e]" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

/** Light, Dark or Match my device, as three choices (user menu and profile). */
export function ThemeChoices({ compact }: { compact?: boolean }) {
  const { choice, set } = useTheme();
  const opts: [ThemeChoice, string, typeof Sun][] = [["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "Match my device", Monitor]];
  if (compact) {
    return (
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--bg)] p-1">
        {opts.map(([v, l, I]) => (
          <button key={v} role="radio" aria-checked={choice === v} title={l} onClick={() => set(v)}
            className={cx("flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12.5px] font-semibold transition", choice === v ? "bg-[var(--card)] text-[var(--text)] shadow-sm ring-1 ring-[var(--brand-2)]/30" : "text-[var(--muted)] hover:text-[var(--text)]")}>
            <I className="size-3.5" />{v === "system" ? "Auto" : l}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-3">
      {opts.map(([v, l, I]) => (
        <button key={v} role="radio" aria-checked={choice === v} onClick={() => set(v)}
          className={cx("relative overflow-hidden rounded-2xl border p-3 text-left transition", choice === v ? "border-[var(--brand)] neon-ring" : "border-[var(--line)] hover:border-[var(--brand-2)]/50")}>
          <ThemePreview kind={v} />
          <span className="mt-3 flex items-center justify-between gap-2 text-[13.5px] font-semibold"><span className="flex items-center gap-2"><I className="size-4" />{l}</span>{choice === v && <Check className="size-4 text-[var(--brand)]" />}</span>
        </button>
      ))}
    </div>
  );
}

function ThemePreview({ kind }: { kind: ThemeChoice }) {
  const pane = (dark: boolean) => (
    <div className={cx("flex h-full", dark ? "bg-[#07060b]" : "bg-[#f7f7fa]")}>
      <div className="w-1/4 space-y-1 bg-[#09080d] p-1.5">{[0, 1, 2].map((i) => <i key={i} className={cx("block h-1.5 rounded-sm", i ? "bg-white/15" : "bg-[#8b5cf6]")} />)}</div>
      <div className="flex-1 space-y-1.5 p-2">
        <div className="grid grid-cols-3 gap-1">{[0, 1, 2].map((i) => <i key={i} className={cx("block h-4 rounded", dark ? "bg-[#14111d] ring-1 ring-white/5" : "bg-white ring-1 ring-black/5")} />)}</div>
        <div className={cx("flex h-7 items-end gap-0.5 rounded p-1", dark ? "bg-[#14111d]" : "bg-white")}>{[40, 70, 55, 90, 65].map((h, i) => <i key={i} className="block flex-1 rounded-t-sm bg-[#8b5cf6]" style={{ height: `${h}%` }} />)}</div>
      </div>
    </div>
  );
  return (
    <div className="h-20 overflow-hidden rounded-xl ring-1 ring-[var(--line)]">
      {kind === "system" ? <div className="grid h-full grid-cols-2">{pane(false)}{pane(true)}</div> : pane(kind === "dark")}
    </div>
  );
}
