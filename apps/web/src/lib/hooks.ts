import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, post, qs } from "./api";
import type { Opt } from "../components/ui";
import { useToast } from "../components/ui";

/** Shared lists, cached, used by forms and filters across the app. */
export const useUsers = (enabled = true) => useQuery({ queryKey: ["users"], queryFn: () => get<any[]>("/users"), enabled, staleTime: 60_000 });
export const useTeams = (enabled = true) => useQuery({ queryKey: ["teams"], queryFn: () => get<any[]>("/teams"), enabled, staleTime: 60_000 });
export const useDepartments = (enabled = true) => useQuery({ queryKey: ["departments"], queryFn: () => get<any[]>("/departments"), enabled, staleTime: 60_000 });
export const useRoles = (enabled = true) => useQuery({ queryKey: ["roles"], queryFn: () => get<any[]>("/roles"), enabled, staleTime: 60_000 });
export const useClients = (enabled = true) => useQuery({ queryKey: ["clients"], queryFn: () => get<any[]>("/clients"), enabled, staleTime: 30_000 });
export const useProjects = (status = "", enabled = true) => useQuery({ queryKey: ["projects", status], queryFn: () => get<any[]>(`/projects${qs({ status })}`), enabled, staleTime: 30_000 });
export type ListName = "project-sources" | "project-accounts" | "communication-types" | "activity-types" | "project-stages";
export const useList = (list: ListName, enabled = true) =>
  useQuery({ queryKey: ["list", list], queryFn: () => get<any[]>(`/lists/${list}`), enabled, staleTime: 60_000 });

/** Returns an onCreate for a Combobox/MultiSelect that adds a new item to a company list and refreshes it. */
export function useAddToList(list: ListName, extra?: () => Record<string, unknown>) {
  const qc = useQueryClient();
  const toast = useToast();
  return async (name: string) => {
    try {
      const row = await post<any>(`/lists/${list}`, { name, ...(extra?.() ?? {}) });
      await qc.invalidateQueries({ queryKey: ["list", list] });
      toast(`Added “${row.name}”`);
      return row.id as string;
    } catch (e: any) {
      toast(e?.message ?? "Couldn't add it", "err");
      return null;
    }
  };
}

export const userOpts = (u?: any[], activeOnly = true): Opt[] => (u ?? []).filter((x) => !activeOnly || x.status !== "disabled").map((x) => ({ value: x.id, label: x.name, sub: [x.employee_code, x.team_name].filter(Boolean).join(" · ") || x.email }));
export const opts = (rows?: any[], label = "name", sub?: string): Opt[] => (rows ?? []).map((r) => ({ value: r.id, label: r[label], sub: sub ? r[sub] : undefined }));

/** Runs an API call with a toast on success and the error kept for an ErrorNote. */
export function useAction() {
  const toast = useToast();
  const qc = useQueryClient();
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>, msg?: string, invalidate: string[] = [], key = "x"): Promise<T | undefined> => {
    setErr(null); setBusy(key);
    try {
      const r = await fn();
      if (msg) toast(msg);
      for (const k of invalidate) qc.invalidateQueries({ queryKey: [k] });
      return r;
    } catch (e) { setErr(e); return undefined; } finally { setBusy(null); }
  };
  return { run, err, setErr, busy };
}

export const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);
export const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
export const EMPLOYMENT = [
  { id: "provisional", label: "Provisional" }, { id: "appointed", label: "Appointed" }, { id: "notice", label: "Serving notice" }, { id: "inactive", label: "Inactive" },
];
