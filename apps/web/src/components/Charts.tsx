import { useEffect, useRef, useState, type ReactNode, useLayoutEffect } from "react";
import { cx } from "./ui";

/**
 * Small bar charts for the dashboard. Colours come from --series-1/--series-2 (validated for colour-blind
 * separation in light and dark). Every chart has a legend for 2+ series, a hover tooltip, and a table view.
 */
export interface Series { key: string; label: string; color: string }

export function BarChart({ data, x, series, format, stacked, height = 180, title }: {
  data: Record<string, any>[]; x: (d: any) => string; series: Series[]; format: (v: number) => string; stacked?: boolean; height?: number; title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  // Draw at the real width so labels stay 11px instead of growing with the card.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    if (el.clientWidth) setW(Math.max(240, el.clientWidth));
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, [table]);
  const totals = data.map((d) => (stacked ? series.reduce((a, s) => a + Number(d[s.key] ?? 0), 0) : Math.max(...series.map((s) => Number(d[s.key] ?? 0)))));
  const max = Math.max(1, ...totals);
  // Hours read best on whole-hour steps (100 h, not 133 h 20 m), so a chart of minutes rounds its scale in hours.
  const inHours = /^1\s?h$/.test(format(60));
  const nice = inHours ? niceMax(max / 60) * 60 : niceMax(max);
  const ticks = [0, nice / 2, nice];
  // Make room for the longest axis label so nothing is cut off.
  const padL = Math.max(40, Math.max(...ticks.map((t) => format(t).length)) * 6.8 + 14);
  const H = height, padB = 22, padT = 8;
  const innerW = W - padL - 8, innerH = H - padB - padT;
  const slot = innerW / Math.max(1, data.length);
  const groupW = Math.min(40, slot * 0.6);
  const barW = stacked ? groupW : Math.max(3, (groupW - 2 * (series.length - 1)) / series.length);
  const y = (v: number) => padT + innerH - (v / nice) * innerH;
  const labelEvery = Math.ceil(data.length / Math.max(3, Math.floor(W / 70)));

  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <figcaption className="font-semibold">{title}</figcaption>
        <div className="flex items-center gap-3 text-[13px] text-[var(--muted)]">
          {series.length > 1 && series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
          <button className="font-semibold text-[var(--text)] underline-offset-2 hover:underline" onClick={() => setTable((t) => !t)}>{table ? "Chart" : "Table"}</button>
        </div>
      </div>
      {table ? (
        <div className="max-h-56 overflow-auto rounded-lg border border-[var(--line)]">
          <table className="w-full text-[13.5px]"><thead><tr><th className="p-2 text-left text-[var(--muted)]"></th>{series.map((s) => <th key={s.key} className="p-2 text-right text-[var(--muted)]">{s.label}</th>)}</tr></thead>
            <tbody>{data.map((d, i) => <tr key={i} className="border-t border-[var(--line)]"><td className="p-2">{x(d)}</td>{series.map((s) => <td key={s.key} className="p-2 text-right tabnum">{format(Number(d[s.key] ?? 0))}</td>)}</tr>)}</tbody></table>
        </div>
      ) : (
        <div ref={box} className="relative">
          <svg width="100%" height={H} className="block overflow-visible" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
                <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{format(t)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx0 = padL + slot * i + slot / 2;
              let acc = 0;
              return (
                <g key={i}>
                  <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${x(d)}: ${series.map((s) => `${s.label} ${format(Number(d[s.key] ?? 0))}`).join(", ")}`} />
                  {series.map((s, si) => {
                    const v = Number(d[s.key] ?? 0);
                    if (v <= 0) return null;
                    const bx = stacked ? cx0 - barW / 2 : cx0 - groupW / 2 + si * (barW + 2);
                    const top = stacked ? y(acc + v) : y(v);
                    const bottom = stacked ? y(acc) : y(0);
                    const isTop = !stacked || series.slice(si + 1).every((n) => Number(d[n.key] ?? 0) <= 0);
                    acc += v;
                    const h = Math.max(1, bottom - top - (stacked && si > 0 ? 2 : 0));
                    return <path key={s.key} d={roundedTop(bx, top, barW, h, isTop ? Math.min(4, barW / 2) : 0)} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.55} pointerEvents="none" />;
                  })}
                  {i % labelEvery === 0 && <text x={cx0} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">{x(d)}</text>}
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-[var(--line)] bg-[var(--card)] p-2.5 text-[13px] shadow-lg"
              style={{ left: `${Math.min(80, ((padL + slot * hover + slot / 2) / W) * 100)}%` }}>
              <div className="mb-1 font-semibold">{x(data[hover])}</div>
              {series.map((s) => <div key={s.key} className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span><span className="tabnum font-semibold">{format(Number(data[hover][s.key] ?? 0))}</span></div>)}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

/** Horizontal bars for a short list of categories (invoice states, lead stages). Labels and values sit beside each bar. */
export function HBars({ rows, title, format = (v) => String(v), color = "var(--series-1)" }: { rows: { label: ReactNode; value: number; sub?: string; color?: string }[]; title: string; format?: (v: number) => string; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className="m-0">
      <figcaption className="mb-2 font-semibold">{title}</figcaption>
      <ul className="grid gap-2.5">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[120px_1fr_auto] items-center gap-3 text-[14px]">
            <span className="truncate">{r.label}</span>
            <span className="h-3 rounded-r-[4px] bg-black/5 dark:bg-white/10"><span className={cx("block h-3 rounded-r-[4px]")} style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? color }} /></span>
            <span className="tabnum font-semibold">{format(r.value)}{r.sub && <span className="ml-1 font-normal text-[var(--muted)]">{r.sub}</span>}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (!r) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Kinds of work, in a fixed colour order (series 1-3) so they look the same on every report. */
export const CATS = [
  { key: "billable", label: "Billable", color: "var(--series-1)" },
  { key: "inhouse", label: "In-house", color: "var(--series-2)" },
  { key: "no_work", label: "No work", color: "var(--series-3)" },
] as const;

/**
 * One horizontal bar split into parts (billable / in-house / no work / leave / unfilled). A 2px gap separates parts,
 * a legend with values always shows, and hovering a part shows its value and share.
 */
export function SplitBar({ parts, format, height = 14, legend = true }: { parts: { key: string; label: string; value: number; color: string }[]; format: (v: number) => string; height?: number; legend?: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  return (
    <div>
      <div className="relative flex w-full gap-[2px] overflow-hidden rounded-[4px] bg-black/[.06] dark:bg-white/10" style={{ height }} onMouseLeave={() => setHover(null)}>
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.key} onMouseEnter={() => setHover(p.key)} className="h-full transition-opacity" style={{ width: `${(p.value / total) * 100}%`, background: p.color, opacity: hover && hover !== p.key ? 0.5 : 1 }}
            title={`${p.label}: ${format(p.value)} (${Math.round((p.value / total) * 100)}%)`} />
        ))}
      </div>
      {legend && (
        <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
          {parts.map((p) => (
            <li key={p.key} className={cx("inline-flex items-center gap-1.5", hover === p.key && "font-semibold")}>
              <i className="inline-block size-2.5 rounded-sm" style={{ background: p.color }} /><span className="text-[var(--muted)]">{p.label}</span>
              <span className="font-semibold tabnum">{format(p.value)}</span>{total > 0 && <span className="text-[var(--muted)] tabnum">{Math.round((p.value / total) * 100)}%</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A ranked list with a thin bar per row (top projects, people, work types). */
export function RankList({ rows, format, color = "var(--series-1)", empty = "No data for these dates." }: { rows: { key: string; label: ReactNode; value: number; sub?: ReactNode; href?: string }[]; format: (v: number) => string; color?: string; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-6 text-center text-[13.5px] text-[var(--muted)]">{empty}</p>;
  return (
    <ul className="grid gap-3">
      {rows.map((r) => (
        <li key={r.key} className="text-[13.5px]">
          <div className="mb-1 flex items-baseline justify-between gap-3"><span className="min-w-0 truncate font-medium">{r.label}</span><span className="shrink-0 font-semibold tabnum">{format(r.value)}{r.sub && <span className="ml-1.5 font-normal text-[var(--muted)]">{r.sub}</span>}</span></div>
          <div className="h-1.5 rounded-full bg-black/[.06] dark:bg-white/10"><div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color }} /></div>
        </li>
      ))}
    </ul>
  );
}
