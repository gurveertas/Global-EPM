import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api, get } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, ErrorNote, Field, Input } from "../components/ui";
import { Aurora, BlurText, BorderBeam, GradientText, GridPattern, NumberTicker, Ring, ShimmerButton, motion } from "../components/magic";
import { useReducedMotion } from "motion/react";

declare global { interface Window { google?: any } }

function Shell({ title, children }: { title: string; children: ReactNode }) {
  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: () => get("/auth/config"), retry: false });
  const name = cfg.data?.company?.name;
  const reduce = useReducedMotion();
  useEffect(() => {
    const c = cfg.data?.company?.primaryColor;
    if (c && !["#0f5f52", "#2563eb", "#1f2a37"].includes(c.toLowerCase())) document.documentElement.style.setProperty("--brand", c);
  }, [cfg.data]);
  if (cfg.isError) {
    const companyNotFound = cfg.error instanceof ApiError && cfg.error.status === 401 && cfg.error.message === "Company not found";
    return (
      <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#06050a] p-6 text-center text-white">
        <Aurora className="opacity-60" />
        <div className="relative">
          <h1 className="text-3xl font-extrabold">{companyNotFound ? "Company not found" : "Sign-in temporarily unavailable"}</h1>
          <p className="mt-2 text-white/60">
            {companyNotFound
              ? <>No company is configured for <b className="text-white">{window.location.hostname}</b>.</>
              : <>Could not load sign-in settings{cfg.error instanceof ApiError ? ` (HTTP ${cfg.error.status})` : ""}. Please try again later.</>}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#06050a] text-white">
      <Aurora />
      <GridPattern className="text-white/[.06]" />
      <div className="relative grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
        <div className="hidden flex-col justify-between p-12 lg:flex">
          <div className="flex items-center gap-3 font-display text-2xl font-extrabold">
            {cfg.data?.company?.logoUrl ? <img src={cfg.data.company.logoUrl} alt="" className="size-10 rounded-xl bg-white object-contain p-1" />
              : <span className="grid size-10 place-items-center rounded-xl bg-brand-gradient shadow-[0_0_30px_-4px_rgb(178_92_255/.9)]"><span className="h-4 w-3.5 rounded-[2px] bg-[linear-gradient(180deg,#fff_0_28%,transparent_28%_36%,#fff_36%_64%,transparent_64%_72%,#fff_72%)]" /></span>}
            {name ?? "eszy"}
          </div>
          <div>
            <h2 className="max-w-xl font-display text-[40px] font-bold leading-[1.08] tracking-[-0.035em]">
              <BlurText text="Every hour your team works," /><br /><GradientText>traced to the invoice that pays for it.</GradientText>
            </h2>
            <div className="relative mt-12 h-56 max-w-lg">
              <motion.div initial={reduce ? false : { opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.6 }}
                className="absolute left-0 top-0 w-64 animate-float rounded-2xl border border-white/10 bg-white/[.06] p-4 backdrop-blur-xl">
                <p className="text-[12px] text-white/55">Approved billable this month</p>
                <p className="mt-1 font-display text-[28px] font-bold"><NumberTicker value={174.5} format={(n) => `${n.toFixed(1)} h`} /></p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><motion.div className="h-full rounded-full bg-brand-gradient" initial={{ width: 0 }} animate={{ width: "78%" }} transition={{ delay: 0.8, duration: 1.2, ease: [0.16, 1, 0.3, 1] }} /></div>
              </motion.div>
              <motion.div initial={reduce ? false : { opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75, duration: 0.6 }}
                className="absolute right-0 top-16 flex animate-float items-center gap-4 rounded-2xl border border-white/10 bg-white/[.06] p-4 backdrop-blur-xl [animation-delay:-3s]">
                <Ring value={82} max={100} size={76} stroke={8}><span className="font-display text-[17px] font-bold">82%</span></Ring>
                <div><p className="text-[12px] text-white/55">Team utilization</p><p className="text-[14px] font-semibold">Web team</p><p className="text-[12px] text-[#7ee2b0]">+6% vs last month</p></div>
              </motion.div>
            </div>
          </div>
          <p className="text-sm text-white/45">Powered by eszy</p>
        </div>
        <div className="grid place-items-center p-6">
          <motion.div initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
            className="relative w-full max-w-[420px] rounded-3xl bg-white p-8 text-[#0b0a10] shadow-[0_30px_90px_-20px_rgb(109_40_217/.6)]">
            <BorderBeam size={120} duration={9} radius={24} />
            <div className="mb-6 flex items-center gap-2.5 lg:hidden"><span className="size-8 rounded-lg bg-brand-gradient" /><span className="font-display text-lg font-bold">{name ?? "eszy"}</span></div>
            <h1 className="font-display text-[30px] font-bold tracking-[-0.03em]">{title}</h1>
            {name && <p className="mt-1 text-[#646273]">{name}</p>}
            <div className="mt-6">{children}</div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function GoogleButton({ onToken }: { onToken: (credential: string) => void }) {
  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: () => get("/auth/config") });
  const ref = useRef<HTMLDivElement>(null);
  const g = cfg.data?.google;
  useEffect(() => {
    if (!g?.enabled || !ref.current) return;
    let tries = 0;
    const t = setInterval(() => {
      if (window.google?.accounts?.id) {
        clearInterval(t);
        window.google.accounts.id.initialize({ client_id: g.clientId, callback: (r: any) => onToken(r.credential) });
        window.google.accounts.id.renderButton(ref.current, { theme: "outline", size: "large", width: 360, text: "signin_with" });
      } else if (++tries > 40) clearInterval(t);
    }, 150);
    return () => clearInterval(t);
  }, [g?.enabled, g?.clientId]); // eslint-disable-line
  if (!g?.enabled) return null;
  return (
    <div className="mb-5">
      <div ref={ref} className="flex justify-center" />
      {!g.required && <div className="my-4 flex items-center gap-3 text-sm text-[var(--muted)]"><span className="h-px flex-1 bg-[var(--line)]" />or<span className="h-px flex-1 bg-[var(--line)]" /></div>}
    </div>
  );
}

export function Login() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: () => get("/auth/config"), retry: false });
  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setErr(null);
    try {
      const r = await fn();
      if (r.twoFactor) setChallenge(r.challenge);
      else await signIn(r.accessToken);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  if (challenge) {
    return (
      <Shell title="Two-step sign-in">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); run(() => api("/auth/2fa", { body: { challenge, code }, token: null })); }}>
          <p className="text-[var(--muted)]">Enter the 6-digit code from your authenticator app.</p>
          <Field label="Code"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
          <ErrorNote error={err} />
          <Button type="submit" busy={busy} disabled={code.length !== 6}>Continue</Button>
          <button type="button" className="text-sm font-semibold" onClick={() => { setChallenge(null); setCode(""); }}>Use a different account</button>
        </form>
      </Shell>
    );
  }
  const submit = (e: FormEvent) => { e.preventDefault(); run(() => api("/auth/login", { body: { email, password }, token: null })); };
  const googleOnly = cfg.data?.google?.enabled && cfg.data?.google?.required;
  return (
    <Shell title="Sign in">
      <GoogleButton onToken={(credential) => run(() => api("/auth/google", { body: { credential }, token: null }))} />
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Work email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorNote error={err} />
        <ShimmerButton type="submit" busy={busy} className="w-full">Sign in{googleOnly ? " (company owner)" : ""}</ShimmerButton>
        <Link to="/forgot" className="text-center text-sm font-semibold text-[var(--brand)]">Forgot your password?</Link>
      </form>
    </Shell>
  );
}

export function Forgot() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  return (
    <Shell title="Reset your password">
      {done ? <p className="rounded-lg bg-[#dff3ea] p-4 text-[#1c5e44]">{done}</p> : (
        <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); try { const r = await api("/auth/forgot", { body: { email }, token: null }); setDone(r.message); } catch (x) { setErr(x); } }}>
          <Field label="Work email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <ErrorNote error={err} />
          <Button type="submit">Send reset link</Button>
        </form>
      )}
      <Link to="/" className="mt-4 block text-center text-sm font-semibold">Back to sign in</Link>
    </Shell>
  );
}

function SetPassword({ title, path, askName }: { title: string; path: string; askName?: boolean }) {
  const [params] = useSearchParams();
  const { signIn } = useSession();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Shell title={title}>
      <form className="grid gap-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try { const r = await api(path, { body: { token: params.get("token"), password, name: name || undefined }, token: null }); await signIn(r.accessToken); nav("/"); }
        catch (x) { setErr(x); } finally { setBusy(false); }
      }}>
        {askName && <Field label="Your name" hint="Leave blank to keep the name your Admin entered"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>}
        <Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorNote error={err} />
        <Button type="submit" busy={busy}>Save password and sign in</Button>
      </form>
    </Shell>
  );
}
export const Reset = () => <SetPassword title="Set a new password" path="/auth/reset" />;
export const AcceptInvite = () => <SetPassword title="Join your team" path="/auth/accept-invite" askName />;
