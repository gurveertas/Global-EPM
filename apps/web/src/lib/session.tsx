import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, type Permission, type Feature } from "@eszy/shared";
import { get, onSignedOut, post, refresh, setToken } from "./api";

export interface Me {
  user: { id: string; name: string; email: string; isOwner: boolean; teamId: string | null; roles: string[]; leadsTeamIds: string[] };
  permissions: Permission[];
  tenant: { id: string; slug: string; name: string; status: string; features: Feature[] };
  subscription: any;
  settings: { branding: any; locale: { currency: string; timezone: string; dateFormat: string; weekStartsOn: number }; policies: any; invoices: { dueSoonDays: number }; auth?: { twoFactor: string } };
  unreadNotifications: number;
}

interface Session {
  me: Me | null;
  ready: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (...p: Permission[]) => boolean;
  has: (f: Feature) => boolean;
  money: (minor: number | null | undefined) => string;
  reload: () => void;
}
const Ctx = createContext<Session | null>(null);

function applyBranding(me: Me | null) {
  const b = me?.settings.branding;
  const root = document.documentElement;
  // Companies still on the earlier default colours get the current eszy violet and neon.
  const old = (c?: string, ...prev: string[]) => !c || prev.includes(c.toLowerCase());
  root.style.setProperty("--brand", old(b?.primaryColor, "#0f5f52", "#2563eb", "#1f2a37") ? "#6d28d9" : b!.primaryColor);
  root.style.setProperty("--accent", old(b?.accentColor, "#f2a93b", "#f0a531") ? "#c026d3" : b!.accentColor);
  // Each person can pick light, dark or their device's setting; until they do, the company's default applies.
  const mode = themeChoice() ?? b?.theme ?? "light";
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", !!dark);
  applyColors(b?.colors ?? {}, root, !!dark);
  document.title = me ? `${b?.displayName || me.tenant.name} · eszy` : "eszy";
}

/** Company colour choices for parts of the panel (Settings → Appearance). An empty value keeps the default. */
export const COLOR_VARS: Record<string, string[]> = {
  button: ["--btn"], buttonEnd: ["--btn-2"], buttonText: ["--btn-text"],
  tableHeader: ["--th-bg"], tableHeaderText: ["--th-text"], tableRow: ["--td-bg"], tableRowAlt: ["--td-alt"], tableText: ["--td-text"], tableHover: ["--td-hover"],
  sidebar: ["--side"], sidebarText: ["--side-text"], page: ["--bg"], card: ["--card"],
  chart1: ["--series-1"], chart2: ["--series-2"], chart3: ["--series-3"],
};
/** Colours of surfaces (page, cards, tables, sidebar text) are chosen for the light theme; dark keeps its own so text stays readable. */
export const LIGHT_ONLY = new Set(["tableHeader", "tableHeaderText", "tableRow", "tableRowAlt", "tableText", "tableHover", "page", "card", "sidebarText"]);
export type ThemeChoice = "light" | "dark" | "system";
export function themeChoice(): ThemeChoice | null {
  try { const v = localStorage.getItem("eszy.theme"); return v === "light" || v === "dark" || v === "system" ? v : null; } catch { return null; }
}
/** Switch theme for this person on this device, with a short cross-fade. */
export function setThemeChoice(v: ThemeChoice | null) {
  try { v ? localStorage.setItem("eszy.theme", v) : localStorage.removeItem("eszy.theme"); } catch { /* private mode */ }
  const root = document.documentElement;
  root.classList.add("theme-fade");
  window.dispatchEvent(new Event("eszy:restore-colors"));
  setTimeout(() => root.classList.remove("theme-fade"), 400);
}
export function applyColors(colors: Record<string, string | undefined>, root: HTMLElement = document.documentElement, dark = root.classList.contains("dark")) {
  for (const [k, vars] of Object.entries(COLOR_VARS)) {
    const v = dark && LIGHT_ONLY.has(k) ? undefined : colors[k];
    for (const name of vars) v ? root.style.setProperty(name, v) : root.style.removeProperty(name);
  }
  // A button colour without an end colour is a solid button.
  if (colors.button && !colors.buttonEnd) root.style.setProperty("--btn-2", colors.button);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    refresh().then((ok) => setAuthed(ok));
    return onSignedOut(() => { setAuthed(false); qc.clear(); });
  }, [qc]);

  const meQ = useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/me"), enabled: authed === true, staleTime: 60_000 });
  const me = authed ? (meQ.data ?? null) : null;
  useEffect(() => applyBranding(me), [me]);
  useEffect(() => {
    const h = () => applyBranding(me);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("eszy:restore-colors", h); mq.addEventListener("change", h);
    return () => { window.removeEventListener("eszy:restore-colors", h); mq.removeEventListener("change", h); };
  }, [me]);

  const signIn = useCallback(async (token: string) => {
    setToken(token);
    setAuthed(true);
    await qc.invalidateQueries({ queryKey: ["me"] });
  }, [qc]);
  const signOut = useCallback(async () => {
    await post("/auth/logout").catch(() => {});
    setToken(null);
    setAuthed(false);
    qc.clear();
  }, [qc]);

  const perms = new Set(me?.permissions ?? []);
  const feats = new Set(me?.tenant.features ?? []);
  const value: Session = {
    me,
    ready: authed === false || (authed === true && !meQ.isLoading),
    signIn, signOut,
    can: (...p) => p.some((x) => perms.has(x)),
    has: (f) => feats.has(f),
    money: (m) => (m == null && !perms.has("money.view") ? "—" : formatMoney(m ?? 0, me?.settings.locale.currency ?? "USD")),
    reload: () => qc.invalidateQueries({ queryKey: ["me"] }),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("SessionProvider missing");
  return s;
};
