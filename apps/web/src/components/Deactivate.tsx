import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UserCheck, UserX } from "lucide-react";
import { post } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Button, Checkbox, ErrorNote, Field, Input, Modal, Textarea, iso, useToast } from "./ui";

/**
 * Deactivate or reactivate someone. Deactivating ends their sessions, stops them signing in and takes them out of pickers and seat counts;
 * their sheets, hours, invoices and history stay. Reactivating gives them back their old roles and password.
 */
export function DeactivateButton({ user, size = "sm", iconOnly, onDone }: { user: { id: string; name: string; status: string; is_owner?: boolean }; size?: "sm" | "md"; iconOnly?: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const act = useAction();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ lastWorkingDay: iso(new Date()), reason: "", removeFromProjects: false });
  if (user.is_owner) return null;
  const refresh = () => ["users", "user", "people", "employee", "access-overview", "org-chart"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  if (user.status === "disabled") {
    return (
      <Button size={size} variant="secondary" busy={!!act.busy} title={iconOnly ? "Reactivate" : undefined} aria-label={`Reactivate ${user.name}`}
        onClick={async (e) => { e.stopPropagation(); try { await post(`/users/${user.id}/reactivate`); toast(`${user.name} can sign in again`); refresh(); onDone?.(); } catch (er: any) { toast(er?.message ?? "Couldn't reactivate"); } }}>
        <UserCheck />{!iconOnly && "Reactivate"}
      </Button>
    );
  }
  return (
    <>
      <Button size={size} variant={iconOnly ? "ghost" : "secondary"} title={iconOnly ? "Deactivate" : undefined} aria-label={`Deactivate ${user.name}`} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        <UserX />{!iconOnly && "Deactivate"}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Deactivate ${user.name}?`}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="danger" busy={!!act.busy} onClick={async () => { if (await act.run(() => post(`/users/${user.id}/deactivate`, f), `${user.name} is deactivated`)) { setOpen(false); refresh(); onDone?.(); } }}><UserX />Deactivate</Button></>}>
        <div className="grid gap-4">
          <p className="rounded-xl bg-[var(--bg)] p-3 text-[13.5px] text-[var(--muted)]">They're signed out everywhere straight away and can't sign in. They stop showing in pickers, approvals and your seat count. Their sheets, hours, invoices and history stay, and you can reactivate them later.</p>
          <Field label="Last working day"><Input type="date" value={f.lastWorkingDay} onChange={(e) => setF({ ...f, lastWorkingDay: e.target.value })} /></Field>
          <Field label="Reason" hint="Kept in their change history. Optional."><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Resigned, contract ended" /></Field>
          <Checkbox label="Also take them off every project team" checked={f.removeFromProjects} onChange={(v) => setF({ ...f, removeFromProjects: v })} hint="Their past hours on those projects stay." />
          <ErrorNote error={act.err} />
        </div>
      </Modal>
    </>
  );
}
