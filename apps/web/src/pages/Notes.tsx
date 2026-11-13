import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pin, PinOff, Plus, StickyNote, Trash2, Users } from "lucide-react";
import { del, get, post, put } from "../lib/api";
import { useSession } from "../lib/session";
import { useAction } from "../lib/hooks";
import { Button, Empty, ErrorNote, Field, Input, Modal, PageHeader, SearchInput, Segmented, Select, Spinner, Textarea, cx, fmtDateTime, useConfirm , Pager, usePaged, RichText } from "../components/ui";

const COLORS: Record<string, string> = {
  plain: "bg-[var(--card)] border-[var(--line)]", amber: "bg-[#fff6e3] border-[#f3dcaa] dark:bg-[#3a2c10] dark:border-[#5c4718]",
  green: "bg-[#eaf6ef] border-[#c4e5d2] dark:bg-[#123124] dark:border-[#1d4d38]", blue: "bg-[#ecf2fc] border-[#c9daf5] dark:bg-[#132339] dark:border-[#1f3a5e]",
  rose: "bg-[#fcefee] border-[#f2cfcc] dark:bg-[#3a1715] dark:border-[#5e2622]",
};

/** Private notes for yourself, and notes Admin/HR share with everyone. */
export function NotesPage() {
  const { can, me } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const act = useAction();
  const q = useQuery({ queryKey: ["notes"], queryFn: () => get<any[]>("/notes") });
  const [edit, setEdit] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<"all" | "mine" | "shared">("all");
  const canShare = can("settings.manage") || can("events.manage");
  const list = (q.data ?? []).filter((n) => (show === "all" || (show === "mine" ? n.created_by === me!.user.id : n.visibility === "everyone")) && (!search || `${n.title} ${n.body}`.toLowerCase().includes(search.toLowerCase())));
  const pg = usePaged(list, 18);
  const refresh = () => qc.invalidateQueries({ queryKey: ["notes"] });
  return (
    <>
      <PageHeader title="Notes" sub="Jot things down for yourself. Admin and HR can also share notes with everyone." actions={<Button onClick={() => setEdit({ title: "", body: "", visibility: "private", color: "plain", pinned: false })}><Plus />New note</Button>} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search notes" />
        <Segmented value={show} onChange={setShow} options={[{ id: "all", label: "All" }, { id: "mine", label: "Mine" }, { id: "shared", label: "Shared with everyone" }]} />
      </div>
      <ErrorNote error={act.err} />
      {q.isLoading ? <Spinner /> : !list.length ? (
        <Empty icon={<StickyNote />} title={q.data?.length ? "No notes match" : "No notes yet"} action={<Button onClick={() => setEdit({ title: "", body: "", visibility: "private", color: "plain", pinned: false })}><Plus />Write a note</Button>}>Notes are private unless you share them.</Empty>
      ) : (
        <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
          {pg.rows.map((n) => {
            const mine = n.created_by === me!.user.id || can("settings.manage");
            return (
              <article key={n.id} className={cx("mb-4 break-inside-avoid rounded-xl border p-4 shadow-[0_1px_2px_rgba(16,24,20,.04)]", COLORS[n.color] ?? COLORS.plain)}>
                <div className="flex items-start justify-between gap-2">
                  <button className="min-w-0 text-left" onClick={() => mine && setEdit(n)}>{n.title && <h3 className="text-[15px] font-bold">{n.title}</h3>}</button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {n.visibility === "everyone" && <span title="Shared with everyone" className="text-[var(--muted)]"><Users className="size-4" /></span>}
                    {mine && <button aria-label={n.pinned ? "Unpin" : "Pin"} className="rounded p-1 text-[var(--muted)] hover:bg-black/5" onClick={() => act.run(() => put(`/notes/${n.id}`, { pinned: !n.pinned })).then(refresh)}>{n.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}</button>}
                    {mine && <button aria-label="Delete" className="rounded p-1 text-[var(--muted)] hover:bg-black/5" onClick={async () => { if (await confirm({ title: "Delete this note?", danger: true, confirm: "Delete" }) !== false) act.run(() => del(`/notes/${n.id}`), "Note deleted").then(refresh); }}><Trash2 className="size-4" /></button>}
                  </div>
                </div>
                <button className="mt-1 block w-full text-left" onClick={() => mine && setEdit(n)}><RichText className="text-[14px]" text={n.body} /></button>
                <div className="mt-3 text-[12px] text-[var(--muted)]">{n.author} · {fmtDateTime(n.updated_at)}{n.pinned && " · Pinned"}</div>
              </article>
            );
          })}
        </div>
      )}
      <Pager {...pg} noun="notes" />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit note" : "New note"}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button busy={!!act.busy} disabled={!edit?.body?.trim()} onClick={async () => {
          const body = { title: edit.title, body: edit.body, visibility: edit.visibility, color: edit.color, pinned: edit.pinned };
          if (await act.run(() => (edit.id ? put(`/notes/${edit.id}`, body) : post("/notes", body)), "Note saved")) { refresh(); setEdit(null); }
        }}>Save note</Button></>}>
        {edit && (
          <div className="grid gap-4">
            <Field label="Title (optional)"><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Note"><Textarea autoFocus className="min-h-40" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} placeholder="Write your note here" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Colour"><Select value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })}>{Object.keys(COLORS).map((c) => <option key={c} value={c}>{c === "plain" ? "Plain" : c[0].toUpperCase() + c.slice(1)}</option>)}</Select></Field>
              <Field label="Who can see it" hint={canShare ? undefined : "Only Admin and HR can share with everyone."}><Select value={edit.visibility} disabled={!canShare} onChange={(e) => setEdit({ ...edit, visibility: e.target.value })}><option value="private">Only me</option><option value="everyone">Everyone</option></Select></Field>
            </div>
            <ErrorNote error={act.err} />
          </div>
        )}
      </Modal>
    </>
  );
}
