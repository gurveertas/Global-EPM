import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "motion/react";

/**
 * Motion pieces in the spirit of Magic UI and React Bits, written for eszy's tokens so they follow the company's brand colour
 * and dark mode, and stay still for people who ask for reduced motion.
 */
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Counts up to a number the first time it scrolls into view (Magic UI "Number Ticker"). */
export function NumberTicker({ value, format = (n) => Math.round(n).toLocaleString(), className, duration = 0.9 }: { value: number; format?: (n: number) => string; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20px" });
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => format(v));
  const [shown, setShown] = useState(format(reduce ? value : 0));
  useEffect(() => text.on("change", setShown), [text]);
  useEffect(() => {
    if (!inView) return;
    if (reduce) { mv.set(value); setShown(format(value)); return; }
    const c = animate(mv, value, { duration, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [inView, value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref} className={cx("tabnum", className)}>{shown}</span>;
}

/** A light that follows the pointer across a card (React Bits "Spotlight Card"). */
export function Spotlight({ children, className, color = "rgb(168 85 247 / .14)", as: Tag = "div", ...rest }: { children: ReactNode; className?: string; color?: string; as?: any } & Record<string, any>) {
  const ref = useRef<HTMLElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <Tag ref={ref} {...rest} className={cx("relative overflow-hidden", className)}
      onPointerMove={(e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); setPos({ x: e.clientX - r.left, y: e.clientY - r.top }); rest.onPointerMove?.(e); }}
      onPointerLeave={(e: React.PointerEvent) => { setPos(null); rest.onPointerLeave?.(e); }}>
      <span aria-hidden className="pointer-events-none absolute inset-0 transition-opacity duration-300" style={{ opacity: pos ? 1 : 0, background: pos ? `radial-gradient(280px circle at ${pos.x}px ${pos.y}px, ${color}, transparent 70%)` : undefined }} />
      {children}
    </Tag>
  );
}

/** A glowing light travelling around the border (Magic UI "Border Beam"). Put inside a relative, rounded element. */
export function BorderBeam({ duration = 7, from = "var(--brand-2)", to = "var(--accent)", width = 1.5 }: { size?: number; duration?: number; radius?: number; from?: string; to?: string; width?: number }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
      style={{ padding: width, WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)", WebkitMaskComposite: "xor", mask: "linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)" } as CSSProperties}>
      <span className="absolute left-1/2 top-1/2 aspect-square w-[max(200%,600px)] -translate-x-1/2 -translate-y-1/2 animate-spin"
        style={{ animationDuration: `${duration}s`, background: `conic-gradient(from 0deg, transparent 0deg 290deg, ${from} 320deg, ${to} 350deg, transparent 360deg)` }} />
    </span>
  );
}

/** A primary button with a moving shine (Magic UI "Shimmer Button"). */
export function ShimmerButton({ children, className, busy, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || busy}
      className={cx("group relative inline-flex h-11 items-center justify-center gap-2 overflow-hidden rounded-xl px-5 text-[15px] font-semibold text-white bg-brand-gradient neon-ring transition active:scale-[.98] disabled:opacity-60 [&_svg]:size-4", className)}>
      <span aria-hidden className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent animate-shimmer" />
      <span className="relative inline-flex items-center gap-2">{busy ? "Please wait…" : children}</span>
    </button>
  );
}

/** Text whose gradient slowly moves (Magic UI "Animated Gradient Text"). */
export const GradientText = ({ children, className }: { children: ReactNode; className?: string }) => <span className={cx("text-brand-gradient animate-gradient", className)}>{children}</span>;

/** Words that fade in from a blur one after another (React Bits "Blur Text"). */
export function BlurText({ text, className, delay = 0.06 }: { text: string; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <span className={className} aria-label={text}>
      {text.split(" ").map((w, i) => (
        <motion.span key={i} aria-hidden className="inline-block whitespace-pre" initial={reduce ? false : { opacity: 0, filter: "blur(8px)", y: 8 }} animate={{ opacity: 1, filter: "blur(0px)", y: 0 }} transition={{ delay: i * delay, duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}>
          {w}{i < text.split(" ").length - 1 ? " " : ""}
        </motion.span>
      ))}
    </span>
  );
}

/** Slow-moving coloured light behind a page (React Bits "Aurora"). */
export function Aurora({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cx("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className="absolute -left-1/4 -top-1/3 size-[70vmax] animate-aurora rounded-full opacity-60 blur-3xl" style={{ background: "radial-gradient(closest-side, rgb(109 40 217 / .75), transparent)" }} />
      <div className="absolute -bottom-1/3 -right-1/4 size-[60vmax] animate-aurora rounded-full opacity-50 blur-3xl [animation-delay:-6s]" style={{ background: "radial-gradient(closest-side, rgb(192 38 211 / .6), transparent)" }} />
      <div className="absolute left-1/3 top-1/4 size-[40vmax] animate-aurora rounded-full opacity-40 blur-3xl [animation-delay:-11s]" style={{ background: "radial-gradient(closest-side, rgb(168 85 247 / .55), transparent)" }} />
    </div>
  );
}

/** A faint grid that fades out towards the edges (Magic UI "Grid Pattern"). */
export function GridPattern({ className, size = 36 }: { className?: string; size?: number }) {
  return (
    <svg aria-hidden className={cx("pointer-events-none absolute inset-0 size-full [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_72%)]", className)}>
      <defs><pattern id="eszy-grid" width={size} height={size} patternUnits="userSpaceOnUse"><path d={`M${size} 0H0V${size}`} fill="none" stroke="currentColor" strokeWidth="1" /></pattern></defs>
      <rect width="100%" height="100%" fill="url(#eszy-grid)" />
    </svg>
  );
}

/** An animated ring for progress against a target (hours logged against hours needed). */
export function Ring({ value, max, size = 132, stroke = 12, children, tone }: { value: number; max: number; size?: number; stroke?: number; children?: ReactNode; tone?: "ok" | "over" | "short" }) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pctv = max > 0 ? Math.min(1, value / max) : value > 0 ? 1 : 0;
  const color = tone === "over" ? "#b4441f" : tone === "ok" ? "url(#ring-ok)" : "url(#ring-brand)";
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring-brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="var(--brand)" /><stop offset="100%" stopColor="var(--brand-2)" /></linearGradient>
          <linearGradient id="ring-ok" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#1c7a4f" /><stop offset="100%" stopColor="#34d399" /></linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
          initial={reduce ? false : { strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pctv) }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

/** Fades and lifts its children in, in order (for lists and grids on page load). */
export function Stagger({ children, className, gap = 0.04 }: { children: ReactNode[]; className?: string; gap?: number }) {
  const reduce = useReducedMotion();
  return (
    <div className={className}>
      {children.map((ch, i) => (
        <motion.div key={i} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * gap, duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}>{ch}</motion.div>
      ))}
    </div>
  );
}

export { motion, AnimatePresence } from "motion/react";
