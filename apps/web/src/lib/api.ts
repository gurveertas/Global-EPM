/** Small fetch wrapper. Keeps the access token in memory and refreshes it with the httpOnly cookie when it expires. */
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export const setToken = (t: string | null) => { accessToken = t; };
export const getToken = () => accessToken;
export const onSignedOut = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export class ApiError extends Error {
  constructor(public status: number, message: string, public code: string, public body: any) { super(message); }
  get problems(): string[] { return this.body?.error?.details?.problems ?? []; }
  get fields(): Record<string, string[]> { return this.body?.error?.fields ?? {}; }
}

export async function refresh(): Promise<boolean> {
  refreshing ??= fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" })
    .then(async (r) => {
      if (!r.ok) return false;
      const b = await r.json();
      accessToken = b.accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

const base = (path: string) => (path.startsWith("/api/") ? path : `/api/v1${path}`);

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData | Blob; raw?: boolean; token?: string | null } = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.form instanceof Blob) headers["Content-Type"] = opts.form.type || "application/octet-stream";
  const tok = opts.token !== undefined ? opts.token : accessToken;
  if (tok) headers.Authorization = `Bearer ${tok}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(base(path), {
    method: opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET"),
    headers, credentials: "include",
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  if (r.status === 401 && retry && opts.token === undefined && !path.startsWith("/auth/")) {
    if (await refresh()) return api<T>(path, opts, false);
    accessToken = null;
    listeners.forEach((l) => l());
  }
  if (opts.raw) {
    if (!r.ok) throw new ApiError(r.status, "Download failed", "error", null);
    return r as unknown as T;
  }
  const body = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new ApiError(r.status, body?.error?.message ?? "Something went wrong", body?.error?.code ?? "error", body);
  return body as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: "POST", body });
export const put = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: "PUT", body });
export const del = <T = any>(p: string) => api<T>(p, { method: "DELETE" });

/** Opens a file the API returns (CSV, PDF) with the auth header attached. */
export async function download(path: string, filename: string) {
  const r = await api<Response>(path, { raw: true });
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export async function openFile(path: string) {
  const r = await api<Response>(path, { raw: true });
  const url = URL.createObjectURL(await r.blob());
  window.open(url, "_blank", "noopener");
}

export const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
