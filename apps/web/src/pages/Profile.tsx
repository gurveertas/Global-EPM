import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, get, post } from "../lib/api";
import { useSession } from "../lib/session";
import { Avatar } from "../components/Avatar";
import { Button, Card, ErrorNote, Field, Input, Pill, Progress, SideNavLayout, Textarea, useToast } from "../components/ui";
import { CalendarDays, Camera, KeyRound, Laptop, ShieldCheck, SunMoon, UserRound } from "lucide-react";
import { ThemeChoices } from "../components/ThemeToggle";

export function Profile() {
  const { me, reload } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const u = me!.user as any;
  const balances = useQuery({ queryKey: ["balances"], queryFn: () => get<any[]>("/leave/balances") });
  const assets = useQuery({ queryKey: ["assets"], queryFn: () => get<any[]>("/assets") });
  const [f, setF] = useState({ name: u.name, phone: u.phone ?? "", address: u.address ?? "", emergencyContactName: u.emergency_contact_name ?? "", emergencyContactPhone: u.emergency_contact_phone ?? "", dateOfBirth: u.date_of_birth ?? "" });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [err, setErr] = useState<unknown>(null);
  const [section, setSection] = useState("details");
  const file = useRef<HTMLInputElement>(null);
  const [photoV, setPhotoV] = useState(0);
  const upload = async (fl: File) => {
    setErr(null);
    if (fl.size > 1024 * 1024) { setErr(new Error("Pick an image under 1 MB")); return; }
    try { await api(`/users/${u.id}/photo`, { method: "PUT", form: fl as any }); setPhotoV((v) => v + 1); reload(); qc.invalidateQueries({ queryKey: ["users"] }); toast("Photo saved"); } catch (e) { setErr(e); }
  };
  const leftDays = (balances.data ?? []).reduce((a, b) => a + Number(b.left_days), 0);
  const roles = (u.roles as string[]).map((r) => r.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
  return (
    <>
      <section className="glow-card relative mb-6 overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--card)]">
        <div className="relative h-28 overflow-hidden bg-[#0b0912]">
          <div aria-hidden className="absolute -right-10 -top-20 size-72 rounded-full bg-[#7c3aed]/50 blur-[80px]" />
          <div aria-hidden className="absolute -bottom-24 left-10 size-64 rounded-full bg-[#c026d3]/25 blur-[80px]" />
          <div aria-hidden className="absolute inset-0 opacity-[.08] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:32px_32px]" />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4 px-6 pb-5">
          <div className="flex min-w-0 items-end gap-4">
            <div className="group relative -mt-11 shrink-0 self-start rounded-full ring-4 ring-[var(--card)]">
              <Avatar id={u.id} name={u.name} hasPhoto={u.has_photo} size={88} version={photoV} />
              <button onClick={() => file.current?.click()} aria-label="Change photo" className="absolute inset-0 grid place-items-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"><Camera className="size-5" /></button>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </div>
            <div className="min-w-0 pt-3">
              <h1 className="truncate text-[22px] font-bold tracking-[-0.02em]">{u.name}</h1>
              <p className="truncate text-[13.5px] text-[var(--muted)]">{u.email}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">{roles.map((r) => <span key={r} className="rounded-md bg-[var(--brand-soft)] px-2 py-0.5 text-[12px] font-semibold text-[var(--brand)] dark:text-white">{r}</span>)}</div>
            </div>
          </div>
          <dl className="flex gap-2">
            {[["Leave left", `${leftDays} days`], ["Accessories", String(assets.data?.length ?? 0)], ["Two-step", u.totp_enabled ? "On" : "Off"]].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3.5 py-2"><dt className="text-[11.5px] text-[var(--muted)]">{l}</dt><dd className="whitespace-nowrap font-display text-[16px] font-bold">{v}</dd></div>
            ))}
          </dl>
        </div>
      </section>
      <SideNavLayout value={section} onChange={setSection} groups={[
        { label: "You", items: [{ id: "details", label: "Personal details", icon: <UserRound /> }, { id: "leave", label: "Leave balance", icon: <CalendarDays /> }, { id: "assets", label: "Accessories with you", icon: <Laptop /> }, { id: "theme", label: "Theme", icon: <SunMoon /> }] },
        { label: "Security", items: [{ id: "password", label: "Password", icon: <KeyRound /> }, { id: "2fa", label: "Two-step sign-in", icon: <ShieldCheck /> }] },
      ]}>
        {section === "details" && (
          <Card title="Personal details" sub="Your name and photo show across eszy. Your manager and HR see the rest.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
              <Field label="Date of birth" hint="Shown as a birthday on the calendar (day and month only)"><Input type="date" value={f.dateOfBirth ?? ""} onChange={(e) => setF({ ...f, dateOfBirth: e.target.value })} /></Field>
              <div />
              <Field label="Address" className="sm:col-span-2"><Textarea value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
              <Field label="Emergency contact"><Input value={f.emergencyContactName} onChange={(e) => setF({ ...f, emergencyContactName: e.target.value })} /></Field>
              <Field label="Emergency contact phone"><Input value={f.emergencyContactPhone} onChange={(e) => setF({ ...f, emergencyContactPhone: e.target.value })} /></Field>
            </div>
            <ErrorNote error={err} />
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={async () => { setErr(null); try { await api("/me", { method: "PATCH", body: { ...f, dateOfBirth: f.dateOfBirth || null } }); toast("Saved"); reload(); } catch (e) { setErr(e); } }}>Save details</Button>
              <Button variant="secondary" onClick={() => file.current?.click()}><Camera />Change photo</Button>
              {u.has_photo && <Button variant="ghost" onClick={async () => { await api(`/users/${u.id}/photo`, { method: "DELETE" }); reload(); }}>Remove photo</Button>}
            </div>
          </Card>
        )}
        {section === "password" && (
          <Card title="Password" sub="Use at least 8 characters. You stay signed in on this device.">
            <div className="grid max-w-xl gap-4">
              <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
              <Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
            </div>
            <ErrorNote error={err} />
            <Button className="mt-5" disabled={pw.newPassword.length < 8} onClick={async () => { setErr(null); try { await api("/me", { method: "PATCH", body: pw }); setPw({ currentPassword: "", newPassword: "" }); toast("Password changed"); } catch (e) { setErr(e); } }}>Change password</Button>
          </Card>
        )}
        {section === "2fa" && <TwoFactorCard />}
        {section === "theme" && (
          <Card title="Theme" sub="How eszy looks for you on this device. Everyone can choose their own.">
            <ThemeChoices />
          </Card>
        )}
        {section === "leave" && (
          <Card title="Leave balance" sub="Days left this year for each leave type.">
            {!(balances.data ?? []).length ? <p className="text-[var(--muted)]">No leave types yet.</p> : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {(balances.data ?? []).map((b) => {
                  const left = Number(b.left_days), used = Number(b.used_days), tot = left + used;
                  return (
                    <li key={b.leave_type_id} className="rounded-2xl border border-[var(--line)] p-4">
                      <div className="flex items-baseline justify-between gap-2"><span className="truncate font-semibold">{b.name}</span><span className="whitespace-nowrap font-display text-[20px] font-bold tabnum">{left}<span className="ml-1 text-[12.5px] font-medium text-[var(--muted)]">days left</span></span></div>
                      <div className="mt-2.5"><Progress pct={tot ? (used / tot) * 100 : 0} /></div>
                      <p className="mt-1.5 text-[12.5px] text-[var(--muted)]">{used} used{Number(b.carried_days) ? ` · ${Number(b.carried_days)} carried over` : ""}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}
        {section === "assets" && (
          <Card title="Accessories with you">
            {(assets.data ?? []).length === 0 ? <p className="text-[var(--muted)]">Nothing is assigned to you.</p> : (
              <ul className="-my-1 divide-y divide-[var(--line)]">{(assets.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="flex min-w-0 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)] dark:text-white"><Laptop className="size-4" /></span><span className="min-w-0"><b className="block truncate">{a.name}</b><span className="block truncate text-[12.5px] text-[var(--muted)]">{a.category}{a.serial_number && ` · ${a.serial_number}`}</span></span></span>
                  <span className="shrink-0 whitespace-nowrap text-[12.5px] text-[var(--muted)]">since {a.assigned_on}</span>
                </li>
              ))}</ul>
            )}
          </Card>
        )}
      </SideNavLayout>
    </>
  );
}

/** Set up or turn off two-step sign-in with an authenticator app (Google Authenticator, 1Password, Authy...). */
export function TwoFactorCard({ forced }: { forced?: boolean }) {
  const { me, reload } = useSession();
  const toast = useToast();
  const on = (me!.user as any).totp_enabled;
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<unknown>(null);
  return (
    <Card title="Two-step sign-in" actions={<Pill status={on ? "active" : "none"}>{on ? "On" : "Off"}</Pill>}>
      {forced && <p className="mb-3 rounded-lg bg-[#fff1d8] p-3 text-sm text-[#6b4100]">Your company requires two-step sign-in. Set it up to continue.</p>}
      {on ? (
        <div className="flex flex-wrap items-end gap-2">
          <p className="w-full text-sm text-[var(--muted)]">You enter a code from your authenticator app each time you sign in.</p>
          {me!.settings.auth?.twoFactor !== "required" && <>
            <Field label="Code to turn it off"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} className="w-36" /></Field>
            <Button variant="outline" onClick={async () => { setErr(null); try { await post("/me/2fa/disable", { code }); setCode(""); toast("Two-step sign-in is off"); reload(); } catch (e) { setErr(e); } }}>Turn off</Button>
          </>}
        </div>
      ) : setup ? (
        <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
          <img src={setup.qr} alt="QR code for your authenticator app" className="rounded-lg bg-white p-2" />
          <div className="grid content-start gap-3">
            <p className="text-sm">Scan this with your authenticator app, or enter this key: <code className="break-all rounded bg-black/5 px-1">{setup.secret}</code></p>
            <Field label="6-digit code from the app"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
            <Button disabled={code.length !== 6} onClick={async () => { setErr(null); try { await post("/me/2fa/enable", { code }); setSetup(null); setCode(""); toast("Two-step sign-in is on"); reload(); } catch (e) { setErr(e); } }}>Turn on</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-[var(--muted)]">Add a code from your phone to your password, so a stolen password isn't enough to sign in.</p>
          <Button onClick={async () => { setErr(null); try { setSetup(await post("/me/2fa/setup")); } catch (e) { setErr(e); } }}>Set up</Button>
        </>
      )}
      <ErrorNote error={err} />
    </Card>
  );
}
