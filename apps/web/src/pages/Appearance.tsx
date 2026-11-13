import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { applyColors } from "../lib/session";
import { Button, Card, ErrorNote, Field, Select, cx } from "../components/ui";

/** Settings → Appearance: the company's colours for buttons, tables, the sidebar, the page and charts, with a live preview. */
const GROUPS: { title: string; sub: string; keys: [string, string, string][] }[] = [
  { title: "Buttons", sub: "Main action buttons. Leave the end colour empty for a solid button.", keys: [["button", "Button colour", "#6d28d9"], ["buttonEnd", "Gradient end", "#a855f7"], ["buttonText", "Button text", "#ffffff"]] },
  { title: "Tables", sub: "Every list in the panel. Used in the light theme; the dark theme keeps its own table colours.", keys: [["tableHeader", "Header background", "#f6f5fa"], ["tableHeaderText", "Header text", "#6b6880"], ["tableRow", "Row background", "#ffffff"], ["tableRowAlt", "Every other row", "#ffffff"], ["tableText", "Row text", "#0b0a10"], ["tableHover", "Row under the pointer", "#f8f5ff"]] },
  { title: "Sidebar and page", sub: "The menu on the left and the page behind the cards. Page, card and sidebar text colours are for the light theme.", keys: [["sidebar", "Sidebar", "#09080d"], ["sidebarText", "Sidebar text", "#d9d6e6"], ["page", "Page background", "#f7f7fa"], ["card", "Cards", "#ffffff"]] },
  { title: "Charts", sub: "The first three colours charts use, in order.", keys: [["chart1", "Chart colour 1", "#7c3aed"], ["chart2", "Chart colour 2", "#e06c12"], ["chart3", "Chart colour 3", "#129a74"]] },
];
const PRESETS: { name: string; colors: Record<string, string> }[] = [
  { name: "eszy violet (default)", colors: {} },
  { name: "Striped tables", colors: { tableHeader: "#ede7fb", tableHeaderText: "#4c1d95", tableRowAlt: "#faf8ff" } },
  { name: "Midnight", colors: { button: "#111018", buttonEnd: "#3b2a66", tableHeader: "#111018", tableHeaderText: "#e9e5f5", sidebar: "#000000" } },
  { name: "Ocean", colors: { button: "#1d4ed8", buttonEnd: "#06b6d4", tableHeader: "#eaf2fe", tableHeaderText: "#1e3a8a", tableHover: "#f1f7ff", sidebar: "#0b1324", chart1: "#1d4ed8" } },
  { name: "Forest", colors: { button: "#166534", buttonEnd: "#22c55e", tableHeader: "#e9f6ee", tableHeaderText: "#14532d", tableHover: "#f2fbf5", sidebar: "#07140c", chart1: "#15803d" } },
  { name: "Monochrome", colors: { button: "#0b0a10", buttonEnd: "#0b0a10", tableHeader: "#f4f4f5", tableHeaderText: "#3f3f46", tableHover: "#fafafa", sidebar: "#0b0a10", chart1: "#3f3f46", chart2: "#a1a1aa", chart3: "#18181b" } },
];

export function Appearance({ s, up, save, busy, err }: { s: any; up: (sec: string, patch: any) => void; save: () => void; busy: boolean; err: unknown }) {
  const colors: Record<string, string> = s.branding.colors ?? {};
  const set = (next: Record<string, string>) => up("branding", { colors: Object.fromEntries(Object.entries(next).filter(([, v]) => v)) });
  // Preview the colours across the whole panel while choosing; going back without saving restores the saved ones.
  useEffect(() => { applyColors(colors); }, [JSON.stringify(colors)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { window.dispatchEvent(new Event("eszy:restore-colors")); }, []);
  const preset = PRESETS.find((p) => JSON.stringify(p.colors) === JSON.stringify(colors))?.name ?? "";
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid content-start gap-5">
        <Card title="Start from a look" sub="Pick one, then change any colour below.">
          <div className="grid gap-2 sm:grid-cols-2">
            {PRESETS.map((p) => (
              <button key={p.name} onClick={() => set(p.colors)} className={cx("flex items-center gap-3 rounded-xl border p-3 text-left text-[13.5px] font-semibold transition", preset === p.name ? "border-[var(--brand)] bg-[var(--brand-soft)] neon-ring" : "border-[var(--line)] hover:border-[var(--brand-2)]/50")}>
                <span className="flex shrink-0 -space-x-1.5">
                  {[p.colors.button ?? "#6d28d9", p.colors.tableHeader ?? "#f6f5fa", p.colors.sidebar ?? "#09080d"].map((c, i) => <i key={i} className="block size-5 rounded-full ring-2 ring-[var(--card)]" style={{ background: c }} />)}
                </span>
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </Card>
        {GROUPS.map((g) => (
          <Card key={g.title} title={g.title} sub={g.sub}>
            <div className="grid gap-4 sm:grid-cols-2">
              {g.keys.map(([k, label, def]) => (
                <Field key={k} label={label}>
                  <div className="flex h-10 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--card)] pl-1.5 pr-1">
                    <input type="color" aria-label={label} value={colors[k] || def} onChange={(e) => set({ ...colors, [k]: e.target.value })} className="size-7 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0" />
                    <input value={colors[k] ?? ""} placeholder={`Default ${def}`} onChange={(e) => set({ ...colors, [k]: e.target.value.trim() })} className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-[var(--muted)]" />
                    {colors[k] && <button aria-label={`Reset ${label}`} onClick={() => set({ ...colors, [k]: "" })} className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--bg)]"><RotateCcw className="size-3.5" /></button>}
                  </div>
                </Field>
              ))}
            </div>
          </Card>
        ))}
        <Card title="Default theme" sub="What people see until they pick their own with the sun and moon button at the top.">
          <Field label="Light or dark"><Select value={s.branding.theme} onChange={(e) => up("branding", { theme: e.target.value })} className="max-w-xs"><option value="light">Light</option><option value="dark">Dark</option><option value="system">Follow each person's device</option></Select></Field>
        </Card>
        <ErrorNote error={err} />
        <div className="flex gap-2"><Button busy={busy} onClick={save}>Save colours</Button><Button variant="secondary" onClick={() => set({})}>Back to default</Button></div>
      </div>
      <div className="xl:sticky xl:top-24 xl:self-start">
        <Card title="Preview" sub="The whole panel shows your colours while you choose. Nothing changes for others until you save.">
          <div className="overflow-hidden rounded-xl border border-[var(--line)]">
            <div className="flex">
              <div className="w-24 space-y-1.5 p-2.5" style={{ background: "var(--side)" }}>
                {["Dashboard", "Timesheet", "Projects"].map((x, i) => <div key={x} className={cx("truncate rounded-md px-2 py-1 text-[11px]", i === 0 && "bg-brand-gradient text-white")} style={i ? { color: "var(--side-text)" } : undefined}>{x}</div>)}
              </div>
              <div className="flex-1 space-y-2.5 p-3" style={{ background: "var(--bg)" }}>
                <div className="flex gap-1.5"><span className="btn-primary rounded-lg px-2.5 py-1 text-[11.5px] font-semibold">Save</span><span className="rounded-lg border border-[var(--line)] bg-[var(--card)] px-2.5 py-1 text-[11.5px] font-semibold">Cancel</span></div>
                <table className="eszy-table overflow-hidden rounded-lg border border-[var(--line)] !text-[11.5px]">
                  <thead><tr><th className="!px-2 !py-1.5">Project</th><th className="!px-2 !py-1.5 !text-right">Hours</th></tr></thead>
                  <tbody>{[["BrightCart", "42 h"], ["Fernwood", "18 h"], ["Nimbus", "27 h"]].map(([a, b]) => <tr key={a}><td className="!px-2 !py-1.5">{a}</td><td className="!px-2 !py-1.5 text-right">{b}</td></tr>)}</tbody>
                </table>
                <div className="flex h-14 items-end gap-1.5 rounded-lg p-2" style={{ background: "var(--card)" }}>
                  {[60, 85, 45, 70, 95, 55].map((h, i) => <i key={i} className="block flex-1 rounded-t" style={{ height: `${h}%`, background: `var(--series-${(i % 3) + 1})` }} />)}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
