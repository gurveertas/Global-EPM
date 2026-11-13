import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, RotateCcw } from "lucide-react";
import type { Access } from "@eszy/shared";
import { get, put } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Button, ErrorNote, Modal, Spinner, cx } from "./ui";

const LEVEL_LABEL: Record<Access, string> = { hidden: "Hidden", view: "View", edit: "Edit" };

/**
 * One person's access, module by module: Hidden, View or Edit. Starts from what their roles give; any change here is saved as
 * an override for this person only. "Reset" puts a module back to what the roles give.
 */
export function AccessEditor({ userId, open, onClose }: { userId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["user-access", userId], queryFn: () => get(`/users/${userId}/access`), enabled: open });
  const [o, setO] = useState<Record<string, Access>>({});
  const act = useAction();
  useEffect(() => { if (q.data) setO({ ...(q.data.overrides ?? {}) }); }, [q.data]);
  const d = q.data;
  const groups = d ? [...new Set<string>(d.modules.map((m: any) => m.group))] : [];
  const levels = (m: any): Access[] => (m.view.length && m.edit.length ? ["hidden", "view", "edit"] : m.view.length ? ["hidden", "view"] : ["hidden", "edit"]);
  const current = (m: any): Access => o[m.key] ?? m.fromRole;
  const changed = d ? d.modules.filter((m: any) => o[m.key] && o[m.key] !== m.fromRole).length : 0;
  const setLevel = (m: any, l: Access) => setO((x) => { const n = { ...x }; if (l === m.fromRole) delete n[m.key]; else n[m.key] = l; return n; });
  const close = () => { act.setErr(null); onClose(); };
  return (
    <Modal open={open} onClose={close} wide="xl" title={d ? `Access for ${d.name}` : "Access"}
      footer={<>
        {changed > 0 && <Button variant="ghost" className="mr-auto" onClick={() => setO({})}><RotateCcw />Reset all to role</Button>}
        <Button variant="secondary" onClick={close}>Cancel</Button>
        <Button busy={!!act.busy} disabled={!d || d.isOwner} onClick={async () => {
          const clean = Object.fromEntries(Object.entries(o).filter(([k, v]) => d.modules.find((m: any) => m.key === k)?.fromRole !== v));
          if (await act.run(() => put(`/users/${userId}/access`, { overrides: clean }), "Access saved")) {
            qc.invalidateQueries({ queryKey: ["user-access", userId] }); qc.invalidateQueries({ queryKey: ["users"] }); close();
          }
        }}>Save changes</Button>
      </>}>
      {q.isLoading || !d ? <Spinner /> : (
        <div className="grid gap-6">
          <div className="flex items-start gap-2 rounded-xl bg-[var(--bg)] p-3 text-[13.5px] text-[var(--muted)]">
            <Info className="mt-0.5 size-4 shrink-0" />
            <p>{d.isOwner ? "This is the company owner, who always has full access." : <>Starts from their role{d.roles.length > 1 ? "s" : ""} (<b className="text-[var(--text)]">{d.roles.join(", ") || "none"}</b>). Changes here apply to this person only; a dot marks a module that differs from the role. They take effect the next time this person loads a page.</>}</p>
          </div>
          {groups.map((g) => {
            const mods = d.modules.filter((m: any) => m.group === g);
            return (
              <section key={g}>
                <h3 className="mb-2 flex items-center justify-between border-b border-[var(--line)] pb-1.5 text-[14px] font-bold">{g}<span className="text-[12px] font-semibold text-[var(--muted)]">{mods.length}</span></h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {mods.map((m: any) => {
                    const cur = current(m);
                    const differs = !!o[m.key] && o[m.key] !== m.fromRole;
                    return (
                      <div key={m.key} className={cx("rounded-xl border p-3.5", differs ? "border-[var(--brand)]/50 bg-[var(--brand-soft)]/40" : "border-[var(--line)] bg-[var(--card)]")}>
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-[14px] font-semibold">{m.label}{differs && <span title="Different from the role" className="size-1.5 rounded-full bg-[var(--brand)]" />}</span>
                          {differs && <button className="text-[12px] font-semibold text-[var(--muted)] hover:text-[var(--text)]" onClick={() => setLevel(m, m.fromRole)}>Reset</button>}
                        </div>
                        <p className="mb-3 text-[12.5px] leading-snug text-[var(--muted)]">{m.info}</p>
                        <div role="radiogroup" aria-label={m.label} className="flex gap-1 rounded-lg bg-[var(--bg)] p-0.5">
                          {levels(m).map((l) => (
                            <button key={l} role="radio" aria-checked={cur === l} disabled={d.isOwner} onClick={() => setLevel(m, l)}
                              className={cx("flex-1 rounded-md px-2 py-1.5 text-[13px] font-semibold transition",
                                cur === l ? (l === "hidden" ? "bg-[#5c6b66] text-white" : "bg-[var(--brand)] text-white") : "text-[var(--muted)] hover:bg-black/5 hover:text-[var(--text)]")}>
                              {LEVEL_LABEL[l]}
                            </button>
                          ))}
                        </div>
                        <p className="mt-1.5 text-[11.5px] text-[var(--muted)]">Role gives: {LEVEL_LABEL[m.fromRole as Access]}</p>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
          <ErrorNote error={act.err} />
        </div>
      )}
    </Modal>
  );
}
