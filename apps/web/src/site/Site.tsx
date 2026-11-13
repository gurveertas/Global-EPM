import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { motion, useInView, useReducedMotion, useScroll, useTransform, AnimatePresence } from "motion/react";
import {
  ArrowRight, BadgeIndianRupee, Bot, Building2, CalendarCheck, Check, ChevronDown, Clock3, FileText, Gauge, Lock, Menu, Network, Receipt,
  ShieldCheck, Sparkles, Timer, Users, X, Zap, KeyRound, DatabaseBackup, History, Scale, LogOut, Workflow,
} from "lucide-react";
import { LEGAL } from "./legal";
import { Aurora, BlurText, BorderBeam, GradientText, GridPattern, NumberTicker, Ring, ShimmerButton, Spotlight } from "../components/magic";

/*
  eszy.com, served by the same React app as the company panels.
  Design: a black canvas lit by a slow violet aurora, white type, and one neon accent saved for what matters.
  The product itself is the illustration: every "screen" on this page is a small live mock-up of eszy.
*/

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const SALES_EMAIL = "sales@eszy.com";
const EASE = [0.2, 0.7, 0.2, 1] as const;

export function Site() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    document.title = "eszy: run a service business from one panel";
    document.documentElement.classList.remove("dark");
    if (hash) setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" }), 50);
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return (
    <div className="min-h-screen overflow-x-clip bg-[#05040a] text-white antialiased selection:bg-[#b25cff]/40">
      <Routes>
        <Route path="/terms" element={<Legal id="terms" />} />
        <Route path="/privacy" element={<Legal id="privacy" />} />
        <Route path="/dpa" element={<Legal id="dpa" />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <Footer />
    </div>
  );
}

/** Fades and lifts in once it scrolls into view. */
function Reveal({ children, delay = 0, className, y = 18 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.6, delay, ease: EASE }}>
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------- nav
function Nav() {
  const [open, setOpen] = useState(false);
  const [signin, setSignin] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const on = () => setScrolled(window.scrollY > 12); on(); window.addEventListener("scroll", on, { passive: true }); return () => window.removeEventListener("scroll", on); }, []);
  const links = [["#product", "Product"], ["#astra", "Astra AI"], ["#billing", "Billing"], ["#security", "Security"], ["#pricing", "Pricing"], ["#faq", "FAQ"]];
  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 pt-3">
      <div className={cx("mx-auto flex max-w-[1180px] items-center justify-between gap-4 rounded-2xl px-4 py-2.5 transition-all duration-300",
        scrolled ? "border border-white/10 bg-[#0b0912]/75 shadow-[0_10px_40px_-15px_rgb(109_40_217/.5)] backdrop-blur-xl" : "border border-transparent")}>
        <Link to="/" className="flex items-center gap-2.5 font-display text-[22px] font-bold tracking-[-0.03em]"><Logo />eszy</Link>
        <nav aria-label="Main" className="hidden items-center gap-1 text-[14.5px] font-medium lg:flex">
          {links.map(([h, l]) => <a key={h} href={`/${h}`} className="rounded-lg px-3 py-1.5 text-white/65 transition hover:bg-white/5 hover:text-white">{l}</a>)}
        </nav>
        <div className="flex items-center gap-2">
          <button onClick={() => setSignin(true)} className="hidden rounded-xl px-4 py-2 text-[14.5px] font-semibold text-white/85 transition hover:bg-white/10 hover:text-white sm:block">Sign in</button>
          <a href="/#contact" className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-xl bg-white px-4 py-2 text-[14.5px] font-semibold text-[#0b0a10] transition hover:shadow-[0_0_30px_-4px_rgb(178_92_255/.9)]">
            Talk to sales<ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </a>
          <button className="rounded-lg p-2 lg:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="mx-auto mt-2 max-w-[1180px] rounded-2xl border border-white/10 bg-[#0b0912]/95 p-3 backdrop-blur-xl lg:hidden">
            {links.map(([h, l]) => <a key={h} href={`/${h}`} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 font-medium text-white/80 hover:bg-white/5">{l}</a>)}
            <button onClick={() => { setOpen(false); setSignin(true); }} className="block w-full rounded-lg px-3 py-2.5 text-left font-medium text-white/80 hover:bg-white/5">Sign in</button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{signin && <SignIn onClose={() => setSignin(false)} />}</AnimatePresence>
    </header>
  );
}
const Logo = () => (
  <span aria-hidden className="grid size-8 place-items-center rounded-[10px] bg-[linear-gradient(135deg,#6d28d9,#b25cff)] shadow-[0_0_22px_-4px_rgb(178_92_255/.9)]">
    <span className="h-3.5 w-3 rounded-[2px] bg-[linear-gradient(180deg,#fff_0_28%,transparent_28%_36%,#fff_36%_64%,transparent_64%_72%,#fff_72%)]" />
  </span>
);

/** Each company signs in at its own address; this sends people there. */
function SignIn({ onClose }: { onClose: () => void }) {
  const [slug, setSlug] = useState("");
  const host = window.location.host.replace(/^www\./, "");
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (!slug) return;
    window.location.href = `${window.location.protocol}//${slug}.${host}/login`;
  };
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-[#05040a]/70 p-4 backdrop-blur-md" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.form onSubmit={go} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Sign in to your company"
        initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }} transition={{ duration: 0.3, ease: EASE }}
        className="relative w-full max-w-[440px] overflow-hidden rounded-3xl border border-white/10 bg-[#0d0b14] p-7 shadow-[0_40px_120px_-30px_rgb(109_40_217/.8)]">
        <BorderBeam duration={8} />
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-[#7c3aed]/35 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <span className="grid size-11 place-items-center rounded-2xl bg-[linear-gradient(135deg,#6d28d9,#b25cff)] shadow-[0_0_30px_-6px_rgb(178_92_255/.9)]"><LogOut className="size-5 rotate-180" /></span>
            <h2 className="mt-5 font-display text-[26px] font-bold tracking-[-0.03em]">Sign in to your company</h2>
            <p className="mt-1 text-[15px] text-white/55">Every company has its own private address.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-xl text-white/60 hover:bg-white/10 hover:text-white"><X className="size-5" /></button>
        </div>
        <label className="relative mt-6 block text-[13.5px] font-semibold text-white/75" htmlFor="slug">Company address</label>
        <div className="relative mt-2 flex items-center rounded-2xl border border-white/15 bg-white/[.04] px-4 transition focus-within:border-[#b25cff] focus-within:shadow-[0_0_0_4px_rgb(178_92_255/.18)]">
          <input id="slug" autoFocus value={slug} autoComplete="off" spellCheck={false} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            className="min-w-0 flex-1 bg-transparent py-3.5 text-[18px] font-semibold text-white outline-none placeholder:text-white/30" placeholder="yourcompany" />
          <span className="shrink-0 text-[16px] font-semibold text-white/40">.{host}</span>
        </div>
        <p className="relative mt-2 flex items-center gap-1.5 text-[13px] text-white/45"><Lock className="size-3.5" />{slug ? <>You'll go to <b className="text-white/80">{slug}.{host}</b></> : "Use the name your admin gave you, e.g. acme"}</p>
        <ShimmerButton type="submit" disabled={!slug} className="relative mt-6 w-full">Continue to sign in<ArrowRight /></ShimmerButton>
        <p className="relative mt-4 text-center text-[13.5px] text-white/45">New to eszy? <a href="/#contact" onClick={onClose} className="font-semibold text-[#d6a8ff] hover:underline">Talk to sales</a></p>
      </motion.form>
    </motion.div>
  );
}

// ---------------------------------------------------------------- home
function Home() {
  return (
    <>
      <Nav />
      <Hero />
      <Marquee />
      <Flow />
      <Bento />
      <ProductTour />
      <AstraSection />
      <Billing />
      <Roles />
      <Security />
      <Pricing />
      <Faq />
      <Contact />
    </>
  );
}

const Section = ({ id, children, className }: { id?: string; children: ReactNode; className?: string }) => (
  <section id={id} className={cx("relative scroll-mt-24 py-24 sm:py-28", className)}><div className="relative mx-auto max-w-[1180px] px-5">{children}</div></section>
);
const Eyebrow = ({ icon, children }: { icon?: ReactNode; children: ReactNode }) => (
  <span className="inline-flex items-center gap-2 rounded-full border border-[#b25cff]/30 bg-[#b25cff]/10 px-3 py-1 text-[13px] font-semibold text-[#e0c2ff] [&_svg]:size-3.5">{icon}{children}</span>
);
const Head = ({ title, sub, eyebrow, center }: { title: ReactNode; sub?: string; eyebrow?: ReactNode; center?: boolean }) => (
  <Reveal className={cx("max-w-[760px]", center && "mx-auto text-center")}>
    {eyebrow && <div className="mb-5">{eyebrow}</div>}
    <h2 className="font-display text-[clamp(32px,3.8vw,50px)] font-bold leading-[1.05] tracking-[-0.035em] text-white">{title}</h2>
    {sub && <p className={cx("mt-5 text-[18px] leading-relaxed text-white/55", center && "mx-auto max-w-[60ch]")}>{sub}</p>}
  </Reveal>
);

// ---------------------------------------------------------------- hero
function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const rotate = useTransform(scrollYProgress, [0, 0.5], [reduce ? 0 : 18, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [reduce ? 1 : 0.94, 1]);
  return (
    <div ref={ref} className="relative overflow-hidden pb-20 pt-36 sm:pt-40">
      <Aurora className="opacity-90" />
      <GridPattern className="text-white/[.07]" size={44} />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-b from-transparent to-[#05040a]" />
      <div className="relative mx-auto max-w-[1180px] px-5 text-center">
        <motion.a href="/#astra" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.05] py-1 pl-1 pr-3 text-[13.5px] text-white/75 backdrop-blur transition hover:border-[#b25cff]/50">
          <span className="rounded-full bg-[linear-gradient(135deg,#6d28d9,#b25cff)] px-2 py-0.5 text-[12px] font-bold text-white">New</span>
          Meet Astra, the AI teammate that knows your company<ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
        </motion.a>
        <h1 className="mx-auto mt-8 max-w-[18ch] font-display text-[clamp(42px,6.4vw,86px)] font-bold leading-[0.98] tracking-[-0.045em]">
          <BlurText text="Every hour your team works," /> <GradientText>traced to the invoice that pays for it.</GradientText>
        </h1>
        <motion.p initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.6 }}
          className="mx-auto mt-7 max-w-[56ch] text-[clamp(17px,1.6vw,20px)] leading-relaxed text-white/60">
          Leads, projects, daily sheets, invoices and team performance in one panel at your own address. Hours past what the client paid for are stopped before they're worked.
        </motion.p>
        <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65, duration: 0.6 }} className="mt-10 flex flex-wrap justify-center gap-3">
          <a href="/#contact"><ShimmerButton className="h-12 px-6 text-[16px]">Talk to sales<ArrowRight /></ShimmerButton></a>
          <a href="/#product" className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/15 bg-white/[.04] px-6 text-[16px] font-semibold text-white backdrop-blur transition hover:border-white/30 hover:bg-white/[.08]">See the product</a>
        </motion.div>
        <motion.ul initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.85 }} className="mt-9 flex flex-wrap justify-center gap-x-7 gap-y-2 text-[14px] text-white/55">
          {["Your own company address", "GST, VAT and other taxes", "Google and two-step sign-in", "Backups to your own storage"].map((t) => <li key={t} className="flex items-center gap-1.5"><Check className="size-4 text-[#b25cff]" />{t}</li>)}
        </motion.ul>
      </div>
      <div className="relative mx-auto mt-16 max-w-[1120px] px-5 [perspective:1600px]">
        <motion.div style={{ rotateX: rotate, scale }} initial={reduce ? false : { opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.9, ease: EASE }} className="origin-top">
          <HeroScreen />
        </motion.div>
      </div>
    </div>
  );
}

/** A small, working picture of the eszy dashboard. */
function HeroScreen() {
  const bars = [52, 64, 58, 72, 68, 84, 79, 90, 76, 88, 94, 81];
  return (
    <div className="relative rounded-[22px] border border-white/10 bg-[#0d0b14]/90 p-2 shadow-[0_60px_160px_-40px_rgb(109_40_217/.85)] backdrop-blur">
      <BorderBeam duration={10} />
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="size-2.5 rounded-full bg-white/15" /><span className="size-2.5 rounded-full bg-white/15" /><span className="size-2.5 rounded-full bg-white/15" />
        <span className="mx-auto flex items-center gap-1.5 rounded-lg bg-white/[.05] px-3 py-1 text-[12px] text-white/50"><Lock className="size-3 text-[#7ee2b0]" />acme.eszy.com/dashboard</span>
      </div>
      <div className="grid gap-2 rounded-2xl bg-[#08070d] p-2 text-left md:grid-cols-[180px_1fr]">
        <aside className="hidden rounded-xl bg-[#0d0b14] p-3 md:block">
          <div className="mb-4 flex items-center gap-2"><Logo /><span className="font-display text-[14px] font-bold">Acme Studio</span></div>
          {[["Dashboard", Gauge, true], ["Timesheet", Clock3], ["Projects", Building2], ["Invoices", Receipt], ["Reports", FileText], ["Org chart", Network]].map(([l, I, on]: any) => (
            <div key={l} className={cx("mb-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px]", on ? "bg-[linear-gradient(135deg,#6d28d9,#a855f7)] text-white shadow-[0_0_18px_-4px_rgb(178_92_255/.9)]" : "text-white/55")}><I className="size-3.5" />{l}</div>
          ))}
        </aside>
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[["Approved billable", 1742, (n: number) => `${Math.round(n / 10)} h`, "text-white"], ["Collected", 897333, (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`, "text-[#7ee2b0]"], ["Utilization", 82, (n: number) => `${Math.round(n)}%`, "text-[#d6a8ff]"], ["Sheets to approve", 15, (n: number) => `${Math.round(n)}`, "text-[#ffd08a]"]].map(([l, v, f, c]: any) => (
              <div key={l} className="rounded-xl border border-white/[.06] bg-[#0d0b14] p-3.5">
                <div className="text-[11.5px] text-white/45">{l}</div>
                <div className={cx("mt-1 font-display text-[22px] font-bold tracking-[-0.02em]", c)}><NumberTicker value={v} format={f} duration={1.6} /></div>
              </div>
            ))}
          </div>
          <div className="grid gap-2 lg:grid-cols-[1.5fr_1fr]">
            <div className="rounded-xl border border-white/[.06] bg-[#0d0b14] p-4">
              <div className="flex items-center justify-between text-[12.5px]"><b>Hours per week</b><span className="text-white/45">Last 12 weeks</span></div>
              <div className="mt-4 flex h-32 items-end gap-1.5">
                {bars.map((h, i) => (
                  <motion.div key={i} className="flex-1 rounded-t-md bg-[linear-gradient(180deg,#b25cff,#6d28d9)]" initial={{ height: 0 }} whileInView={{ height: `${h}%` }} viewport={{ once: true }} transition={{ delay: 0.6 + i * 0.05, duration: 0.7, ease: EASE }} />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4 rounded-xl border border-white/[.06] bg-[#0d0b14] p-4">
              <Ring value={7.5} max={8.5} size={96} stroke={9}><div><div className="font-display text-[17px] font-bold">7h 30m</div><div className="text-[10.5px] text-white/45">of 8h 30m</div></div></Ring>
              <ul className="grid flex-1 gap-2 text-[12px]">
                {[["BrightCart store", "4h 30m", "#2a78d6"], ["Parkside support", "2h", "#eb6834"], ["Team meeting", "1h", "#1baf7a"]].map(([a, b, c]) => <li key={a} className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: c }} /><span className="flex-1 truncate text-white/70">{a}</span><b>{b}</b></li>)}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Marquee() {
  const items = ["Web agencies", "Mobile app studios", "Upwork and Fiverr teams", "Marketing agencies", "IT services", "Design studios", "Shopify partners", "Consultancies", "Staff augmentation"];
  return (
    <div className="relative border-y border-white/[.06] bg-white/[.015] py-6">
      <p className="mb-4 text-center text-[13px] font-medium text-white/40">Built for teams that sell their time</p>
      <div className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_15%,black_85%,transparent)]">
        <div className="flex w-max animate-[marquee_38s_linear_infinite] gap-3 motion-reduce:animate-none">
          {[...items, ...items].map((t, i) => <span key={i} className="whitespace-nowrap rounded-full border border-white/10 bg-white/[.03] px-4 py-2 text-[14.5px] font-medium text-white/70">{t}</span>)}
        </div>
      </div>
      <style>{"@keyframes marquee{to{transform:translateX(-50%)}}"}</style>
    </div>
  );
}

// ---------------------------------------------------------------- flow
function Flow() {
  const steps: [string, string, any][] = [
    ["Sales", "Leads and calls, with credit to whoever brought the lead and whoever converted it.", Users],
    ["Projects", "Hourly (prepaid or postpaid) or fixed price, with billing lines and two hour caps.", Building2],
    ["Time", "Daily sheets with work types and offline hours, approved by each person's own TL.", Timer],
    ["Invoices", "Created on their dates with tax, then paid, part-paid, refunded or corrected.", Receipt],
    ["Performance", "Rates per project, client, person and team, from real revenue and approved hours.", Gauge],
  ];
  const ref = useRef<HTMLOListElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <Section>
      <Head center title={<>From the first call to <GradientText>the last payment</GradientText></>} sub="Each step hands its data to the next, so nothing is typed twice and every approved hour ends up on an invoice." />
      <ol ref={ref} className="relative mt-16 grid gap-4 md:grid-cols-5">
        <div aria-hidden className="absolute left-[10%] right-[10%] top-7 hidden h-px bg-white/10 md:block">
          <motion.div className="h-full origin-left bg-[linear-gradient(90deg,#6d28d9,#b25cff,#e879f9)] shadow-[0_0_12px_#b25cff]" initial={{ scaleX: 0 }} animate={{ scaleX: inView ? 1 : 0 }} transition={{ duration: 1.6, ease: EASE }} />
        </div>
        {steps.map(([t, d, I], i) => (
          <motion.li key={t} initial={{ opacity: 0, y: 16 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ delay: 0.15 + i * 0.18, duration: 0.5 }} className="relative text-center">
            <div className="relative mx-auto grid size-14 place-items-center rounded-2xl border border-white/10 bg-[#0d0b14] shadow-[0_0_0_6px_#05040a]">
              <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-[linear-gradient(135deg,#6d28d9,#b25cff)] text-[11px] font-bold">{i + 1}</span>
              <I className="size-6 text-[#d6a8ff]" />
            </div>
            <h3 className="mt-5 font-display text-[19px] font-bold">{t}</h3>
            <p className="mx-auto mt-2 max-w-[26ch] text-[14.5px] leading-relaxed text-white/50">{d}</p>
          </motion.li>
        ))}
      </ol>
    </Section>
  );
}

// ---------------------------------------------------------------- bento
function Bento() {
  return (
    <Section>
      <Head eyebrow={<Eyebrow icon={<Zap />}>Everything in one panel</Eyebrow>} title="The whole agency, without the spreadsheets" sub="Eight things eszy does every day so your team doesn't have to chase them." />
      <div className="mt-14 grid gap-4 md:grid-cols-6">
        <Tile className="md:col-span-4" icon={<Timer />} title="Caps that stop unpaid work" body="A project cap and a weekly or monthly billing cap. Past either one, new hours can't be saved and the TL is told.">
          <div className="mt-6 grid gap-3">
            {[["BrightCart store", 96, "4h left this week", true], ["Ruiz Legal website", 71, "29h left"], ["Parkside support", 48, "21h left"]].map(([n, p, l, hot]: any) => (
              <div key={n}>
                <div className="mb-1.5 flex justify-between text-[13px]"><span className="text-white/75">{n}</span><span className={hot ? "font-semibold text-[#ffb08a]" : "text-white/45"}>{l}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-white/[.07]"><motion.div className={cx("h-full rounded-full", hot ? "bg-[linear-gradient(90deg,#f97316,#ef4444)]" : "bg-[linear-gradient(90deg,#6d28d9,#b25cff)]")} initial={{ width: 0 }} whileInView={{ width: `${p}%` }} viewport={{ once: true }} transition={{ duration: 1.1, ease: EASE }} /></div>
              </div>
            ))}
          </div>
        </Tile>
        <Tile className="md:col-span-2" icon={<Sparkles />} title="Astra answers" body="“How many hours did the web team log last week?” Ask in plain words.">
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[.03] p-3 text-[13px]"><span className="text-white/45">Astra</span><p className="mt-1">The web team logged <b className="text-[#d6a8ff]">142h 30m</b>, 84% of expected. Karan has 2 days unfilled.</p></div>
        </Tile>
        <Tile className="md:col-span-2" icon={<BadgeIndianRupee />} title="Invoices with tax" body="CGST + SGST or IGST in India, VAT or an export rate elsewhere, picked per client.">
          <div className="mt-6 flex flex-wrap gap-2">{["Unpaid", "Partially paid", "Paid", "Overdue"].map((t, i) => <span key={t} className={cx("rounded-full px-2.5 py-1 text-[12px] font-semibold", ["bg-white/10 text-white/70", "bg-[#f0a531]/15 text-[#ffd08a]", "bg-[#1c7a4f]/25 text-[#7ee2b0]", "bg-[#b4441f]/25 text-[#ffb08a]"][i])}>{t}</span>)}</div>
        </Tile>
        <Tile className="md:col-span-2" icon={<CalendarCheck />} title="Leave and WFH" body="Full, half-day and short leave, hourly WFH, holidays and credits, approved by each person's own lead." />
        <Tile className="md:col-span-2" icon={<Network />} title="Org chart" body="See who reports to whom as a live tree you can search, zoom and fold." >
          <svg viewBox="0 0 200 70" className="mt-5 w-full" aria-hidden>
            <g stroke="#b25cff" strokeOpacity=".6" fill="none" strokeWidth="1.2"><path d="M100 14 C100 30,40 26,40 44" /><path d="M100 14 C100 30,100 26,100 44" /><path d="M100 14 C100 30,160 26,160 44" /></g>
            {[[100, 10], [40, 50], [100, 50], [160, 50]].map(([x, y], i) => <rect key={i} x={x - 22} y={y - 8} width="44" height="16" rx="5" fill={i ? "#14111d" : "#6d28d9"} stroke="#b25cff" strokeOpacity=".5" />)}
          </svg>
        </Tile>
        <Tile className="md:col-span-3" icon={<Gauge />} title="Rates you can trust" body="Project rate = (invoiced − refunded) ÷ approved hours. Employee and team rates follow from it, with profit after costs.">
          <div className="mt-6 flex h-24 items-end gap-2">{[38, 52, 46, 61, 58, 74, 69, 82].map((h, i) => <motion.div key={i} className="flex-1 rounded-t-md bg-white/15" initial={{ height: 0 }} whileInView={{ height: `${h}%` }} viewport={{ once: true }} transition={{ delay: i * 0.06, duration: 0.6 }} style={i === 7 ? { background: "linear-gradient(180deg,#b25cff,#6d28d9)" } : undefined} />)}</div>
        </Tile>
        <Tile className="md:col-span-3" icon={<Workflow />} title="Reports for every role" body="Team, sheet and leave reporting, attendance, unfilled sheets, and a master timesheet with any filter you add. Export to Excel.">
          <div className="mt-6 grid grid-cols-3 gap-2">{[["Expected", "775h"], ["Approved", "174h"], ["Unfilled", "38"]].map(([a, b]) => <div key={a} className="rounded-xl border border-white/10 bg-white/[.03] p-3"><div className="text-[11.5px] text-white/45">{a}</div><div className="font-display text-[18px] font-bold">{b}</div></div>)}</div>
        </Tile>
      </div>
    </Section>
  );
}
function Tile({ icon, title, body, children, className }: { icon: ReactNode; title: string; body: string; children?: ReactNode; className?: string }) {
  return (
    <Reveal className={className}>
      <Spotlight color="rgb(178 92 255 / .16)" className="h-full rounded-3xl border border-white/[.08] bg-[linear-gradient(180deg,#0f0d17,#0a0910)] p-6 transition hover:border-white/15">
        <span className="relative grid size-10 place-items-center rounded-xl bg-white/[.06] text-[#d6a8ff] ring-1 ring-white/10 [&_svg]:size-5">{icon}</span>
        <h3 className="relative mt-5 font-display text-[20px] font-bold tracking-[-0.02em]">{title}</h3>
        <p className="relative mt-2 text-[15px] leading-relaxed text-white/55">{body}</p>
        <div className="relative">{children}</div>
      </Spotlight>
    </Reveal>
  );
}

// ---------------------------------------------------------------- product tour (live mock-ups)
const Tag = ({ tone, children }: { tone: "paid" | "part" | "unpaid" | "late" | "blue" | "grey"; children: ReactNode }) => (
  <span className={cx("inline-block w-fit justify-self-start whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold", {
    paid: "bg-[#1c7a4f]/25 text-[#7ee2b0]", part: "bg-[#f0a531]/15 text-[#ffd08a]", unpaid: "bg-white/10 text-white/70",
    late: "bg-[#b4441f]/25 text-[#ffb08a]", blue: "bg-[#b25cff]/20 text-[#e0c2ff]", grey: "bg-white/10 text-white/60",
  }[tone])}>{children}</span>
);
const Bar = ({ pct, tone = "brand" }: { pct: number; tone?: "brand" | "red" }) => (
  <div className="h-2 overflow-hidden rounded-full bg-white/[.07]"><div className={cx("h-full rounded-full", tone === "red" ? "bg-[#ef4444]" : "bg-[linear-gradient(90deg,#6d28d9,#b25cff)]")} style={{ width: `${pct}%` }} /></div>
);
function Window({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d0b14] shadow-[0_40px_100px_-40px_rgb(109_40_217/.7)]">
      <div className="flex items-center gap-2 border-b border-white/[.06] px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-white/15" /><span className="size-2.5 rounded-full bg-white/15" /><span className="size-2.5 rounded-full bg-white/15" />
        <span className="ml-3 truncate text-[12.5px] text-white/45">acme.eszy.com/{title}</span>
      </div>
      <div className="p-5 text-[14px] text-white/85 [&_.row]:border-t [&_.row]:border-white/[.06]">{children}</div>
    </div>
  );
}

const TOUR = [
  {
    id: "sales", label: "Sales", title: "Credit goes to the right people",
    points: ["The person who brings a lead is recorded for good", "They assign a caller; anyone can make pre-sales calls", "Whoever logs the successful call is the converter", "Onboard a won lead straight into a client and project"],
    screen: (
      <Window title="leads">
        <div className="mb-3 flex items-center justify-between"><b className="font-display text-lg">Leads</b><Tag tone="blue">12 to call</Tag></div>
        {[["Shopify rebuild · Parkside Co", "Rahul", "Neha", "Neha", "Converted", "paid"], ["Mobile app · Fernwood", "Rahul", "Esha", "—", "Follow-up", "part"], ["CRM migration · Ali Traders", "Sana", "Sana", "—", "New", "blue"]].map((r) => (
          <div key={r[0]} className="row grid grid-cols-[1.6fr_1fr] items-center gap-3 py-3 sm:grid-cols-[1.5fr_auto_auto_auto_auto]">
            <span className="font-semibold text-white">{r[0]}</span>
            <span className="hidden whitespace-nowrap text-white/50 sm:block">Brought: {r[1]}</span><span className="hidden whitespace-nowrap text-white/50 sm:block">Caller: {r[2]}</span><span className="hidden whitespace-nowrap text-white/50 sm:block">Won by: {r[3]}</span>
            <Tag tone={r[5] as any}>{r[4]}</Tag>
          </div>
        ))}
      </Window>
    ),
  },
  {
    id: "projects", label: "Projects", title: "Hours sold, hours used, at a glance",
    points: ["Billing lines: these hours, for this amount, by this date", "A project cap and a weekly or monthly billing cap", "Project Managers, Team Leads and employees on one card each", "A board of stages you drag projects across"],
    screen: (
      <Window title="projects/brightcart">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><b className="font-display text-lg text-white">BrightCart store</b><span className="text-white/50">Hourly · prepaid · Upwork</span></div>
        <div className="mb-4 grid grid-cols-3 gap-3">{[["Project cap", "120 h"], ["This week", "31 / 40 h"], ["Average rate", "$27/h"]].map(([a, b]) => <div key={a} className="rounded-xl bg-white/[.04] p-3"><div className="text-[12px] text-white/45">{a}</div><div className="font-display text-xl font-bold text-white">{b}</div></div>)}</div>
        {[["First 100 hours", "100 h", 86, "$2,500", "paid", "Paid"], ["Bug fixes (no charge)", "10 h", 40, "$0", "grey", "Non-billable"], ["New scope: blog", "10 h", 0, "$250", "unpaid", "Unpaid"]].map((r) => (
          <div key={r[0] as string} className="row grid grid-cols-[1.4fr_0.5fr_1fr_0.6fr_auto] items-center gap-3 py-3">
            <span className="font-semibold text-white">{r[0]}</span><span>{r[1]}</span><Bar pct={r[2] as number} /><span className="tabular-nums">{r[3]}</span><Tag tone={r[4] as any}>{r[5]}</Tag>
          </div>
        ))}
      </Window>
    ),
  },
  {
    id: "time", label: "Time", title: "Daily sheets that respect the caps",
    points: ["Hours past a cap can't be saved, so nothing is worked unpaid by accident", "Pick a project and only its tasks show, yours first", "Work type, tracker and offline hours on each entry", "Old days need a request your TL approves"],
    screen: (
      <Window title="sheet">
        <div className="mb-3 flex items-center justify-between"><b className="font-display text-lg text-white">Tuesday, 10 November</b><Tag tone="blue">Submitted</Tag></div>
        {[["BrightCart store", "Development", "Tracked in Upwork", "5 h 30 m", "#2a78d6"], ["BrightCart store", "Code review", "Offline", "1 h", "#2a78d6"], ["Team meeting", "Meeting", "Tracked here", "2 h", "#eb6834"]].map((r, i) => (
          <div key={i} className="row grid grid-cols-[auto_1.2fr_1fr_1fr_auto] items-center gap-3 py-3"><span className="h-6 w-1 rounded-full" style={{ background: r[4] }} /><span className="font-semibold text-white">{r[0]}</span><span className="text-white/50">{r[1]}</span><span className="text-white/50">{r[2]}</span><span className="font-semibold tabular-nums text-white">{r[3]}</span></div>
        ))}
        <div className="mt-3 flex items-center justify-between rounded-xl bg-white/[.04] px-4 py-3"><span><b className="font-display text-xl text-white">8 h 30 m</b> <span className="text-white/50">of 8 h 30 m needed</span></span><span className="text-[13px] font-semibold text-[#7ee2b0]">Waiting for Tara (TL)</span></div>
      </Window>
    ),
  },
  {
    id: "invoices", label: "Invoices", title: "Invoices that follow the agreement",
    points: ["Fixed price: one-time, milestones, installments, or advance + balance", "Prepaid on the billing date; postpaid after each period", "GST (CGST + SGST or IGST), VAT or export rate, by client", "Payments, whole-invoice refunds, and corrected invoices"],
    screen: (
      <Window title="invoices/INV-0042">
        <div className="mb-4 flex items-center justify-between"><b className="font-display text-lg text-white">INV-0042</b><Tag tone="part">Partially paid</Tag></div>
        <div className="row flex justify-between py-3"><span>BrightCart store: first 100 hours</span><span className="tabular-nums">₹2,00,000.00</span></div>
        <dl className="ml-auto grid max-w-[260px] gap-1.5 tabular-nums">
          <div className="flex justify-between"><dt className="text-white/55">Subtotal</dt><dd>₹2,00,000.00</dd></div>
          <div className="flex justify-between"><dt className="text-white/55">IGST 18%</dt><dd>₹36,000.00</dd></div>
          <div className="flex justify-between border-t border-white/10 pt-1.5 text-base font-bold text-white"><dt>Total</dt><dd>₹2,36,000.00</dd></div>
          <div className="flex justify-between text-[#7ee2b0]"><dt>Paid</dt><dd>₹1,00,000.00</dd></div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2"><Tag tone="unpaid">Due 16 Nov</Tag><Tag tone="part">Due soon in 3 days</Tag></div>
      </Window>
    ),
  },
  {
    id: "insights", label: "Insights", title: "Rates you can trust",
    points: ["Project rate = (invoiced − refunded) ÷ approved hours", "Employee and team rate = Σ(hours × project rate) ÷ hours", "Profit after each person's cost per hour and expenses", "Money is visible only to the roles you choose"],
    screen: (
      <Window title="rates">
        <div className="mb-4 flex h-28 items-end gap-2" aria-hidden>{[38, 52, 46, 61, 58, 74].map((h, i) => <div key={i} className="flex-1 rounded-t-md bg-[linear-gradient(180deg,#b25cff,#6d28d9)]" style={{ height: `${h * 1.3}%`, opacity: 0.45 + i * 0.1 }} />)}</div>
        {[["BrightCart store", "$27.40/h", "$1,820"], ["Ruiz Legal website", "$31.10/h", "$2,240"], ["Parkside support", "$22.00/h", "$610"]].map((r) => (
          <div key={r[0]} className="row grid grid-cols-[1.4fr_1fr_1fr] py-3"><span className="font-semibold text-white">{r[0]}</span><span className="tabular-nums">{r[1]}</span><span className="tabular-nums text-[#7ee2b0]">Profit {r[2]}</span></div>
        ))}
      </Window>
    ),
  },
];

function ProductTour() {
  const [tab, setTab] = useState(TOUR[0].id);
  const t = TOUR.find((x) => x.id === tab)!;
  return (
    <Section id="product">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-40 h-96 w-[60%] -translate-x-1/2 rounded-full bg-[#6d28d9]/20 blur-[120px]" />
      <Head eyebrow={<Eyebrow icon={<Gauge />}>The product</Eyebrow>} title="Built around how agencies actually work" sub="These are eszy's own screens, shown with sample data." />
      <div role="tablist" className="mt-10 inline-flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-white/[.03] p-1">
        {TOUR.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}
            className={cx("relative rounded-xl px-4 py-2 text-[14.5px] font-semibold transition", tab === x.id ? "text-white" : "text-white/50 hover:text-white")}>
            {tab === x.id && <motion.span layoutId="tour-tab" className="absolute inset-0 rounded-xl bg-[linear-gradient(135deg,#6d28d9,#a855f7)] shadow-[0_0_24px_-6px_rgb(178_92_255/.9)]" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
            <span className="relative">{x.label}</span>
          </button>
        ))}
      </div>
      <div className="relative mt-10 grid items-center gap-10 lg:grid-cols-[0.8fr_1.2fr] [&>*]:min-w-0">
        <AnimatePresence mode="wait">
          <motion.div key={t.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.3 }}>
            <h3 className="font-display text-[32px] font-bold leading-tight tracking-[-0.03em]">{t.title}</h3>
            <ul className="mt-7 grid gap-4">
              {t.points.map((p) => <li key={p} className="flex gap-3 text-[16.5px] leading-relaxed text-white/70"><span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-[#b25cff]/20"><Check className="size-3.5 text-[#d6a8ff]" /></span>{p}</li>)}
            </ul>
          </motion.div>
        </AnimatePresence>
        <AnimatePresence mode="wait">
          <motion.div key={t.id} initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35, ease: EASE }}>{t.screen}</motion.div>
        </AnimatePresence>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- astra
const CHAT: { who: "me" | "astra"; text: string; confirm?: string }[] = [
  { who: "me", text: "How many hours have I logged this month?" },
  { who: "astra", text: "You've logged 112h 30m of 127h 30m expected (88%). 96h are approved; Monday and Thursday are still waiting for Tara." },
  { who: "me", text: "Log 2 hours on BrightCart for the checkout fix" },
  { who: "astra", text: "I've prepared this for you. Confirm it and I'll add it to today's sheet.", confirm: "Log 2h on BrightCart store for today: “Checkout fix”" },
];
function AstraSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });
  const [shown, setShown] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!inView) return;
    if (shown >= CHAT.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 300 : 1300);
    return () => clearTimeout(t);
  }, [inView, shown]);
  return (
    <Section id="astra" className="overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -right-40 top-10 size-[520px] rounded-full bg-[#c026d3]/15 blur-[120px]" />
      <div className="grid items-center gap-14 lg:grid-cols-[1fr_1.05fr] [&>*]:min-w-0">
        <div>
          <Head eyebrow={<Eyebrow icon={<Sparkles />}>Astra AI</Eyebrow>} title={<>An assistant that knows <GradientText>your company</GradientText></>}
            sub="Ask about hours, projects, leave, approvals or unpaid invoices in plain words. Astra answers from your eszy data and only ever sees what the person asking can see." />
          <Reveal delay={0.1}>
            <ul className="mt-9 grid gap-4">
              {[["Permission-aware", "It uses each person's own access. An employee can't ask about someone else's pay.", ShieldCheck],
                ["Asks before it changes anything", "Logging time, requesting leave or approving a sheet always waits for a Confirm.", Check],
                ["Your name, your AI", "Rename it, pick its icon, and plug in Claude, OpenAI or Gemini with your own key.", KeyRound]].map(([t, d, I]: any) => (
                <li key={t} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[.05] text-[#d6a8ff] ring-1 ring-white/10"><I className="size-5" /></span>
                  <div><b className="text-[16px]">{t}</b><p className="mt-0.5 text-[15px] leading-relaxed text-white/55">{d}</p></div>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
        <div ref={ref} className="relative">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0910] shadow-[0_50px_140px_-40px_rgb(109_40_217/.9)]">
            <BorderBeam duration={9} />
            <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
              <span className="grid size-10 place-items-center rounded-2xl bg-[linear-gradient(135deg,#6d28d9,#b25cff)] shadow-[0_0_24px_-4px_rgb(178_92_255/.9)]"><Sparkles className="size-5" /></span>
              <div><b className="font-display text-[16px]">Astra</b><p className="text-[12px] text-white/45">Answers from your company's data, with your access</p></div>
            </div>
            <div className="grid min-h-[380px] content-start gap-4 p-5">
              <AnimatePresence>
                {CHAT.slice(0, shown).map((m, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cx("flex", m.who === "me" ? "justify-end" : "justify-start")}>
                    {m.who === "me" ? (
                      <p className="max-w-[80%] rounded-2xl rounded-br-md bg-[linear-gradient(135deg,#6d28d9,#a855f7)] px-4 py-2.5 text-[14.5px] shadow-[0_8px_24px_-10px_rgb(168_85_247/.9)]">{m.text}</p>
                    ) : (
                      <div className="flex max-w-[92%] gap-2.5">
                        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-white/5 ring-1 ring-white/10"><Bot className="size-3.5 text-[#d6a8ff]" /></span>
                        <div className="grid gap-2.5">
                          <p className="text-[14.5px] leading-relaxed text-white/85">{m.text}</p>
                          {m.confirm && (
                            <div className="relative overflow-hidden rounded-xl border border-[#b25cff]/40 bg-[#b25cff]/[.08] p-3">
                              {!done && <BorderBeam duration={5} />}
                              <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#cfa5ff]">{done ? "Done" : "Confirm this change"}</p>
                              <p className="mt-1 text-[14px]">{m.confirm}</p>
                              {done ? <p className="mt-1.5 text-[13px] text-[#7ee2b0]">Logged 2h on BrightCart store. Saved as a draft.</p> : (
                                <div className="mt-3 flex gap-2">
                                  <button onClick={() => setDone(true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[linear-gradient(135deg,#6d28d9,#a855f7)] px-3 text-[13px] font-semibold"><Check className="size-4" />Confirm</button>
                                  <button className="h-8 rounded-lg border border-white/15 px-3 text-[13px] font-semibold text-white/75">Cancel</button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {inView && shown < CHAT.length && shown % 2 === 1 && (
                <div className="flex items-center gap-1.5 pl-10">{[0, 1, 2].map((i) => <motion.span key={i} className="size-1.5 rounded-full bg-[#b25cff]" animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }} />)}</div>
              )}
            </div>
            <div className="border-t border-white/10 p-4"><div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[.03] px-4 py-3 text-[14px] text-white/35">Ask Astra anything about your work<span className="ml-auto grid size-8 place-items-center rounded-xl bg-[linear-gradient(135deg,#6d28d9,#a855f7)] text-white"><ArrowRight className="size-4 -rotate-90" /></span></div></div>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- billing
function Billing() {
  const rules: [string, string, any][] = [
    ["Two caps", "A project cap for the whole job and a billing cap for each week or month. Past either one, new hours are blocked and the TL is told.", Scale],
    ["Extra hours, free or paid", "The Billing Manager adds hours when more time is needed: free ones are non-billable, paid ones get their own invoice straight away.", Clock3],
    ["Money received first", "If the client paid before the invoice exists, it starts as Partially paid or Paid.", BadgeIndianRupee],
    ["Refunds and corrections", "A refund covers a whole invoice and marks its hours Refunded. A wrong invoice is cancelled with a reason and replaced by a linked correction.", History],
  ];
  return (
    <Section id="billing">
      <div className="grid gap-14 lg:grid-cols-[1fr_1fr] [&>*]:min-w-0">
        <div>
          <Head eyebrow={<Eyebrow icon={<Receipt />}>Billing</Eyebrow>} title="Billing that follows how you sell hours" sub="Record what the client agreed to pay, for how many hours and by when. eszy keeps the team inside those hours and the invoices in step with them." />
          <div className="mt-10 grid gap-6">
            {rules.map(([t, d, I], i) => (
              <Reveal key={t} delay={i * 0.06}>
                <div className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[.05] text-[#d6a8ff] ring-1 ring-white/10"><I className="size-5" /></span>
                  <div><h3 className="font-display text-[18px] font-bold">{t}</h3><p className="mt-1 text-[15px] leading-relaxed text-white/55">{d}</p></div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
        <Reveal className="grid content-center gap-4">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0d0b14] p-7">
            <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-[#7c3aed]/30 blur-3xl" />
            <div className="relative text-[14px] text-white/50">Every invoice has a clear state</div>
            <div className="relative mt-4 flex flex-wrap items-center gap-2"><Tag tone="unpaid">Unpaid</Tag><ArrowRight className="size-4 text-white/30" /><Tag tone="part">Partially paid</Tag><ArrowRight className="size-4 text-white/30" /><Tag tone="paid">Paid</Tag></div>
            <div className="relative mt-3 flex flex-wrap gap-2"><Tag tone="part">Due soon</Tag><Tag tone="late">Overdue</Tag><Tag tone="grey">Cancelled</Tag></div>
            <p className="relative mt-5 text-[15px] leading-relaxed text-white/60">Due date = invoice date + due days. "Due soon" starts a set number of days before, set for the company and changeable per project. Reminders can go to your team and the client.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[["Tax engine", "CGST + SGST or IGST in India, VAT or an export rate elsewhere"], ["Three invoice designs", "Classic, modern or minimal, with your logo and colours"]].map(([a, b]) => (
              <Spotlight key={a} className="rounded-3xl border border-white/10 bg-white/[.03] p-5"><div className="relative font-display text-[17px] font-bold">{a}</div><p className="relative mt-1 text-[14px] text-white/55">{b}</p></Spotlight>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-3xl border border-white/10 bg-white/[.03] p-5"><div className="text-[13px] text-white/45">Payment gateways</div><div className="mt-1 font-display text-[17px] font-bold">Stripe and Razorpay</div></div>
            <div className="rounded-3xl border border-white/10 bg-white/[.03] p-5"><div className="text-[13px] text-white/45">Installments</div><div className="mt-1 font-display text-[17px] font-bold">Advance + balance, milestones</div></div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- roles
function Roles() {
  const roles: [string, string, boolean, any][] = [
    ["Employee", "Daily sheet, standup, leave and WFH, hours left on each project, accessories they hold.", false, Users],
    ["Team Lead", "Approves the team's sheets, leave, WFH and requests to fill old days. Adds people from their own team to projects.", false, Network],
    ["Sales", "Leads, call log, follow-ups, conversion and onboarding. Assigns Project Managers and Team Leads.", false, Zap],
    ["Project Manager", "Projects, members, tasks, stages, attachments and the activity feed.", false, Building2],
    ["Billing Manager", "Billing set-up, extra hours, invoices, payments, refunds and rates.", true, Receipt],
    ["Admin", "Everything, including settings, roles, per-person permissions, backups and Astra.", true, ShieldCheck],
  ];
  return (
    <Section>
      <Head center title="Each role sees its own work" sub="Start with these roles, rename them, add your own, and fine-tune any one person with Hidden, View or Edit per module." />
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map(([t, d, m, I], i) => (
          <Reveal key={t} delay={(i % 3) * 0.06}>
            <Spotlight className="h-full rounded-3xl border border-white/[.08] bg-[#0b0a11] p-6 transition hover:border-white/15">
              <div className="relative flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-xl bg-white/[.05] text-[#d6a8ff] ring-1 ring-white/10"><I className="size-5" /></span>
                {m && <Tag tone="paid">Sees money</Tag>}
              </div>
              <h3 className="relative mt-5 font-display text-[19px] font-bold">{t}</h3>
              <p className="relative mt-2 text-[15px] leading-relaxed text-white/55">{d}</p>
            </Spotlight>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- security
function Security() {
  const items: [string, string, any][] = [
    ["Your data stays yours", "Each company's rows are kept apart inside the database itself, so one company can never read another's.", Lock],
    ["Two-step and Google sign-in", "Turn on an authenticator app for everyone, sign in with Google, and set how long sessions last.", KeyRound],
    ["Backups you hold", "Encrypted backups to your own S3, R2, B2, Wasabi or Google Cloud bucket, and restore when you need it.", DatabaseBackup],
    ["A full change history", "Who changed what and when, with the old and new values.", History],
    ["Fair for everyone", "Each company has its own limits and job queue, so a busy neighbour never slows you down.", Gauge],
    ["Leave whenever you like", "Export everything at any time. The owner can delete all company data at once.", LogOut],
  ];
  return (
    <Section id="security" className="border-y border-white/[.06] bg-[radial-gradient(ellipse_at_top,rgb(109_40_217/.18),transparent_60%)]">
      <Head eyebrow={<Eyebrow icon={<ShieldCheck />}>Security and control</Eyebrow>} title="Built to be trusted with your numbers" />
      <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(([t, d, I]) => (
          <div key={t} className="group bg-[#07060c] p-7 transition hover:bg-[#0d0b14]">
            <I className="size-6 text-[#b25cff] transition group-hover:drop-shadow-[0_0_10px_#b25cff]" />
            <h3 className="mt-5 font-display text-[18px] font-bold">{t}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-white/55">{d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- pricing
const FEATURES = [
  { id: "people_time", name: "People and Time", items: ["Daily sheets and TL approvals", "Leave, WFH, holidays, calendar", "Standups, accessories, org chart"] },
  { id: "projects_billing", name: "Projects and Billing", items: ["Billing lines and both caps", "Invoices with tax", "Payments, refunds, corrections"] },
  { id: "sales_crm", name: "Sales CRM", items: ["Leads and callers", "Call log and follow-ups", "Onboarding into projects"] },
  { id: "performance_rates", name: "Performance and Rates", items: ["Project, client and team rates", "People and sales performance", "Profit after costs"] },
];
function Pricing() {
  const [picked, setPicked] = useState<string[]>(["people_time", "projects_billing"]);
  const names = useMemo(() => FEATURES.filter((f) => picked.includes(f.id)).map((f) => f.name), [picked]);
  useEffect(() => { window.dispatchEvent(new CustomEvent("eszy:features", { detail: names.join(", ") })); }, [names]);
  return (
    <Section id="pricing">
      <Head center eyebrow={<Eyebrow icon={<BadgeIndianRupee />}>Pricing</Eyebrow>} title="Pay for the features you use" sub="Pick the parts of eszy your company needs and we'll send you a price per person, monthly or yearly. Astra is included." />
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => {
          const on = picked.includes(f.id);
          return (
            <button key={f.id} type="button" aria-pressed={on} onClick={() => setPicked(on ? picked.filter((x) => x !== f.id) : [...picked, f.id])}
              className={cx("relative flex flex-col items-start justify-start overflow-hidden rounded-3xl border p-6 text-left transition", on ? "border-[#b25cff]/60 bg-[#b25cff]/[.07] shadow-[0_0_0_1px_rgb(178_92_255/.3),0_20px_60px_-20px_rgb(168_85_247/.6)]" : "border-white/10 bg-white/[.02] hover:border-white/20")}>
              {on && <BorderBeam duration={7} />}
              <span className={cx("relative grid size-6 place-items-center rounded-lg border-2 transition", on ? "border-transparent bg-[linear-gradient(135deg,#6d28d9,#b25cff)]" : "border-white/25")}>{on && <Check className="size-4" />}</span>
              <h3 className="relative mt-5 font-display text-[19px] font-bold">{f.name}</h3>
              <ul className="relative mt-3 grid gap-2 text-[14.5px] text-white/60">{f.items.map((i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[#b25cff]" />{i}</li>)}</ul>
            </button>
          );
        })}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/[.03] px-7 py-5">
        <p className="text-[16px]"><b>{names.length} {names.length === 1 ? "feature" : "features"}</b> <span className="text-white/55">{names.length ? names.join(", ") : "Pick at least one"}</span></p>
        <a href="/#contact"><ShimmerButton>Get a price for these<ArrowRight /></ShimmerButton></a>
      </div>
      <p className="mt-5 text-center text-[14.5px] text-white/45">Every plan includes your own address, Google and two-step sign-in, roles and per-person permissions, CSV and Excel import and export, backups to your own storage, and a 14-day trial.</p>
    </Section>
  );
}

// ---------------------------------------------------------------- FAQ
function Faq() {
  const qs = [
    ["Can we keep tracking hours in Upwork?", "Yes. People log those hours in their eszy sheet and mark where they were tracked. They count toward the caps, invoices and rates like any other hours."],
    ["What happens when a project runs out of hours?", "New hours can't be saved past the project cap or the weekly or monthly billing cap. The Billing Manager can add hours, free or paid, and the team carries on."],
    ["Who can see rates and money?", "Only roles with the money permission, by default Admin and Billing Manager. Everyone else sees hours. You can change it for any one person too."],
    ["What does Astra see?", "Only what the person asking can see in eszy, because it looks things up through their own access. It never changes anything without them pressing Confirm, and your company chooses the AI provider and key."],
    ["Does it handle GST?", "Yes. Set your GSTIN and state; clients in your state get CGST + SGST, other states get IGST, and clients abroad get your export rate. VAT and other taxes work the same way."],
    ["Can we bring our existing data?", "Yes. Import people, teams, clients, projects, billing lines, tasks, leave balances and past hours from CSV or a Google Sheet, or ask us to move it from your current system."],
    ["What if we stop using eszy?", "Export everything at any time. After cancelling, your data is kept for 3 months so you can take it with you, then deleted. The owner can also delete it at once."],
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Section id="faq">
      <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <Head title="Questions teams ask us" sub="Can't find yours? Write to us and a person replies, usually within one working day." />
        <div className="divide-y divide-white/10 rounded-3xl border border-white/10 bg-white/[.02]">
          {qs.map(([q, a], i) => (
            <div key={q}>
              <button aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left font-display text-[17px] font-bold">
                {q}<ChevronDown className={cx("size-5 shrink-0 text-white/50 transition duration-300", open === i && "rotate-180 text-[#d6a8ff]")} />
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                    <p className="max-w-[70ch] px-6 pb-5 text-[15.5px] leading-relaxed text-white/60">{a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- contact
function Contact() {
  const [f, setF] = useState({ name: "", company: "", email: "", teamSize: "11 to 50", features: "People and Time, Projects and Billing", message: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");
  useEffect(() => {
    const on = (e: Event) => setF((x) => ({ ...x, features: (e as CustomEvent).detail }));
    window.addEventListener("eszy:features", on);
    return () => window.removeEventListener("eszy:features", on);
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || !f.company.trim() || !/^\S+@\S+\.\S+$/.test(f.email)) { setErr("Add your name, company and a valid work email."); return; }
    setErr(""); setState("sending");
    try {
      const r = await fetch("/api/v1/public/enquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      if (!r.ok) throw new Error();
      setState("sent");
    } catch { setState("error"); }
  };
  const mailto = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(`eszy pricing for ${f.company}`)}&body=${encodeURIComponent(`Name: ${f.name}\nCompany: ${f.company}\nEmail: ${f.email}\nTeam size: ${f.teamSize}\nFeatures: ${f.features}\n\n${f.message}`)}`;
  const input = "w-full rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-[#b25cff] focus:shadow-[0_0_0_4px_rgb(178_92_255/.15)] [&>option]:bg-[#0d0b14]";
  return (
    <Section id="contact" className="overflow-hidden bg-[radial-gradient(ellipse_at_bottom_left,rgb(109_40_217/.22),transparent_60%)]">
      <div className="relative grid gap-14 lg:grid-cols-[0.85fr_1.15fr] [&>*]:min-w-0">
        <div>
          <Head title={<>Talk to us about <GradientText>your team</GradientText></>} sub="Tell us how many people you have and which features you need. We'll reply with a price and set up your panel." />
          <Reveal delay={0.1}>
            <p className="mt-10 text-white/50">Prefer email? Write to</p>
            <a href={`mailto:${SALES_EMAIL}`} className="font-display text-[26px] font-bold text-white underline decoration-[#b25cff] decoration-2 underline-offset-[6px] hover:decoration-[#e879f9]">{SALES_EMAIL}</a>
          </Reveal>
        </div>
        <Reveal>
          {state === "sent" ? (
            <div className="grid min-h-[420px] place-content-center rounded-3xl border border-white/10 bg-[#0d0b14]/80 p-10 text-center backdrop-blur">
              <div className="mx-auto grid size-16 place-items-center rounded-full bg-[#1c7a4f]/25 text-[#7ee2b0]"><Check className="size-8" /></div>
              <h3 className="mt-5 font-display text-2xl font-bold">Thanks, we have your details.</h3>
              <p className="mt-2 text-white/55">We'll reply to {f.email} with a price and next steps, usually within one working day.</p>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="relative grid gap-4 overflow-hidden rounded-3xl border border-white/10 bg-[#0d0b14]/80 p-7 backdrop-blur">
              <BorderBeam duration={12} />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-[13.5px] font-semibold text-white/75">Your name<input className={input} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
                <label className="grid gap-1.5 text-[13.5px] font-semibold text-white/75">Company<input className={input} autoComplete="organization" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></label>
                <label className="grid gap-1.5 text-[13.5px] font-semibold text-white/75">Work email<input className={input} type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
                <label className="grid gap-1.5 text-[13.5px] font-semibold text-white/75">Team size<select className={input} value={f.teamSize} onChange={(e) => setF({ ...f, teamSize: e.target.value })}>{["1 to 10", "11 to 50", "51 to 200", "More than 200"].map((x) => <option key={x}>{x}</option>)}</select></label>
              </div>
              <label className="grid gap-1.5 text-[13.5px] font-semibold text-white/75">Features<input className={input} value={f.features} onChange={(e) => setF({ ...f, features: e.target.value })} /></label>
              <label className="grid gap-1.5 text-[13.5px] font-semibold text-white/75">Anything else<textarea className={cx(input, "min-h-28")} placeholder="How you bill clients today, what you want to change" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
              {err && <p role="alert" className="text-sm font-semibold text-[#ffb08a]">{err}</p>}
              {state === "error" && <p role="alert" className="text-sm text-white/75">We couldn't send the form. <a className="font-semibold text-[#d6a8ff] underline" href={mailto}>Send it by email instead</a>.</p>}
              <ShimmerButton type="submit" busy={state === "sending"} className="h-12 w-full">Send to sales<ArrowRight /></ShimmerButton>
            </form>
          )}
        </Reveal>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- legal + footer
/** Splits a legal document into its sections so the page can show a table of contents beside it. */
function parseLegal(html: string) {
  const draft = /<span class="draft">([^<]*)<\/span>/.exec(html)?.[1] ?? "";
  const updated = /Last updated ([^.<]+)/.exec(draft)?.[1] ?? "";
  const heads: { id: string; title: string }[] = [];
  const body = html
    .replace(/<span class="draft">[^<]*<\/span>/, "")
    .replace(/href="#(terms|privacy|dpa)"/g, 'href="/$1"')
    .replace(/<h2>([^<]*)<\/h2>/g, (_m, t: string) => {
      const id = t.toLowerCase().replace(/^\d+\.\s*/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      heads.push({ id, title: t.replace(/^\d+\.\s*/, "") });
      return `<h2 id="${id}">${t}</h2>`;
    });
  const words = body.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  return { body, heads, updated, isDraft: /draft/i.test(draft), minutes: Math.max(1, Math.round(words / 200)) };
}

function Legal({ id }: { id: string }) {
  const doc = LEGAL[id];
  const { body, heads, updated, isDraft, minutes } = useMemo(() => parseLegal(doc.html), [doc.html]);
  const [active, setActive] = useState(heads[0]?.id ?? "");
  const [tocOpen, setTocOpen] = useState(false);
  useEffect(() => {
    setActive(heads[0]?.id ?? "");
    const els = heads.map((h) => document.getElementById(h.id)).filter(Boolean) as HTMLElement[];
    // The section whose heading most recently passed the top third of the screen is the one being read.
    const on = () => {
      const line = window.innerHeight * 0.3;
      let cur = els[0]?.id ?? "";
      for (const el of els) if (el.getBoundingClientRect().top <= line) cur = el.id;
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = els[els.length - 1]?.id ?? cur;
      setActive(cur);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [heads]);
  const jump = (hid: string) => {
    const el = document.getElementById(hid);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 110, behavior: "smooth" });
    history.replaceState(null, "", `#${hid}`);
    setTocOpen(false);
  };
  const Toc = () => (
    <ul className="relative grid border-l border-white/10">
      {heads.map((h) => (
        <li key={h.id} className="relative">
          {active === h.id && <motion.span layoutId="legal-toc" className="absolute -left-px inset-y-1 w-[2px] rounded-full bg-[linear-gradient(180deg,#b25cff,#6d28d9)] shadow-[0_0_10px_#b25cff]" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
          <button onClick={() => jump(h.id)} aria-current={active === h.id ? "location" : undefined}
            className={cx("block w-full py-1.5 pl-5 pr-2 text-left text-[14.5px] leading-snug transition", active === h.id ? "font-semibold text-white" : "text-white/50 hover:text-white/85")}>{h.title}</button>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <Nav />
      <div className="relative overflow-x-clip">
        <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[80%] -translate-x-1/2 rounded-full bg-[#6d28d9]/25 blur-[140px]" />
        <div className="relative mx-auto grid max-w-[1240px] gap-12 px-5 pb-40 pt-32 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-16">
          {/* contents */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 grid gap-6">
              <div>
                <p className="mb-3 pl-5 text-[13px] font-semibold text-white/40">On this page</p>
                <Toc />
              </div>
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d0b14] p-5">
                <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-[#7c3aed]/30 blur-3xl" />
                <h2 className="relative font-display text-[18px] font-bold leading-tight tracking-[-0.02em]">Need a signed copy for your company?</h2>
                <p className="relative mt-1.5 text-[14px] leading-relaxed text-white/55">We'll send it with your price.</p>
                <a href="/#contact" className="relative mt-4 block"><ShimmerButton className="w-full">Talk to sales<ArrowRight /></ShimmerButton></a>
              </div>
            </div>
          </aside>

          {/* document */}
          <main className="min-w-0">
            <nav aria-label="Legal documents" className="flex flex-wrap gap-2">
              {(["terms", "privacy", "dpa"] as const).map((k) => (
                <NavLink key={k} to={`/${k}`} className={({ isActive }) => cx("rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold transition", isActive ? "border-transparent bg-white text-[#0b0a10]" : "border-white/15 text-white/65 hover:border-white/30 hover:text-white")}>{LEGAL[k].title}</NavLink>
              ))}
            </nav>
            <motion.h1 key={id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}
              className="mt-8 max-w-[16ch] font-display text-[clamp(40px,5.6vw,72px)] font-bold leading-[1.02] tracking-[-0.045em]">{doc.title}</motion.h1>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3 text-[15px] text-white/55">
              <span className="flex items-center gap-2.5"><Logo /><span>By <b className="text-white">eszy</b></span></span>
              {updated && <span>Updated {updated}</span>}
              <span>{minutes} min read</span>
              {isDraft && <span className="rounded-full bg-[#f0a531]/15 px-3 py-1 text-[13px] font-semibold text-[#ffd08a]">Draft for legal review</span>}
            </div>

            {/* contents on small screens */}
            <div className="mt-8 rounded-2xl border border-white/10 bg-[#0d0b14] lg:hidden">
              <button onClick={() => setTocOpen(!tocOpen)} aria-expanded={tocOpen} className="flex w-full items-center justify-between px-5 py-4 font-semibold">
                On this page<ChevronDown className={cx("size-5 text-white/50 transition", tocOpen && "rotate-180")} />
              </button>
              <AnimatePresence initial={false}>
                {tocOpen && <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden px-3 pb-4"><Toc /></motion.div>}
              </AnimatePresence>
            </div>

            <article className="mt-10 max-w-[72ch] border-t border-white/10 pt-4 text-[17.5px] leading-[1.8] text-white/70 [&_a]:font-semibold [&_a]:text-[#d6a8ff] [&_a]:underline [&_a]:decoration-[#b25cff]/50 [&_a]:underline-offset-4 [&_h2]:mt-14 [&_h2]:scroll-mt-28 [&_h2]:font-display [&_h2]:text-[27px] [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:tracking-[-0.025em] [&_h2]:text-white [&_li]:mt-2.5 [&_li]:pl-1 [&_li]:marker:text-[#b25cff] [&_p]:mt-4 [&_strong]:text-white [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6"
              dangerouslySetInnerHTML={{ __html: body }} />

            <div className="mt-16 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[.03] p-6 lg:hidden">
              <p className="font-display text-[18px] font-bold">Need a signed copy for your company?</p>
              <a href="/#contact"><ShimmerButton>Talk to sales<ArrowRight /></ShimmerButton></a>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

function Footer() {
  return (
    <footer className="relative border-t border-white/[.06] bg-[#05040a]">
      <div className="mx-auto grid max-w-[1180px] gap-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5 font-display text-[22px] font-bold"><Logo />eszy</div>
          <p className="mt-4 max-w-[36ch] text-[15px] leading-relaxed text-white/50">Run a service business from one panel: leads, projects, timesheets, invoices, people and an AI assistant that knows them all.</p>
          <a href="/#contact" className="mt-6 inline-flex items-center gap-1.5 text-[15px] font-semibold text-[#d6a8ff] hover:text-white">Talk to sales<ArrowRight className="size-4" /></a>
        </div>
        <nav aria-label="Product" className="grid content-start gap-2.5 text-[15px]">
          <span className="mb-1 text-[13px] font-semibold text-white/40">Product</span>
          {[["#product", "Product tour"], ["#astra", "Astra AI"], ["#billing", "Billing"], ["#security", "Security"], ["#pricing", "Pricing"]].map(([h, l]) => <a key={h} href={`/${h}`} className="text-white/65 hover:text-white">{l}</a>)}
        </nav>
        <nav aria-label="Legal" className="grid content-start gap-2.5 text-[15px]">
          <span className="mb-1 text-[13px] font-semibold text-white/40">Company</span>
          <NavLink to="/terms" className="text-white/65 hover:text-white">Terms of Service</NavLink>
          <NavLink to="/privacy" className="text-white/65 hover:text-white">Privacy Policy</NavLink>
          <NavLink to="/dpa" className="text-white/65 hover:text-white">Data Processing Terms</NavLink>
          <a href={`mailto:${SALES_EMAIL}`} className="text-white/65 hover:text-white">{SALES_EMAIL}</a>
        </nav>
      </div>
      <div className="border-t border-white/[.06]">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-[13.5px] text-white/40">
          <span>© {new Date().getFullYear()} eszy. All rights reserved.</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#34d399] shadow-[0_0_8px_#34d399]" />All systems normal</span>
        </div>
      </div>
    </footer>
  );
}
