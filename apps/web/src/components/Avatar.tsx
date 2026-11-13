import { useEffect, useState } from "react";
import { getToken } from "../lib/api";

/** A person's photo, or their initials. Photos load with the sign-in token, so they're never public. */
export function Avatar({ id, name, hasPhoto, size = 32, version = 0 }: { id: string; name: string; hasPhoto?: boolean; size?: number; version?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!hasPhoto) { setSrc(null); return; }
    let url: string | null = null, live = true;
    fetch(`/api/v1/users/${id}/photo`, { headers: { Authorization: `Bearer ${getToken()}` }, credentials: "include" })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b && live) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [id, hasPhoto, version]);
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const style = { width: size, height: size, fontSize: size * 0.38 };
  return src
    ? <img src={src} alt="" style={style} className="shrink-0 rounded-full object-cover" />
    : <span aria-hidden style={style} className="grid shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] font-bold text-[var(--brand)] dark:text-white">{initials}</span>;
}

/** Avatar with name and a second line, for table cells. */
export function Person({ id, name, sub, hasPhoto, size = 30 }: { id: string; name: string; sub?: string | null; hasPhoto?: boolean; size?: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar id={id} name={name} hasPhoto={hasPhoto} size={size} />
      <span className="min-w-0"><span className="block truncate font-semibold">{name}</span>{sub && <span className="block truncate text-[12.5px] text-[var(--muted)]">{sub}</span>}</span>
    </span>
  );
}
