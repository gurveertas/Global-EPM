import { useSession } from "../lib/session";
import { opts, useAddToList, useList } from "../lib/hooks";
import { Combobox, MultiSelect } from "./ui";

/**
 * Pickers for the company's onboarding masters. Type a name that isn't there yet and choose "Add" to create it on the spot,
 * so nobody has to leave the form for Settings.
 */
const useCanAdd = () => {
  const { can } = useSession();
  return can("settings.manage") || can("projects.manage") || can("clients.manage");
};

export function SourcePicker({ value, onChange, disabled, placeholder = "e.g. Upwork, Referral" }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean; placeholder?: string }) {
  const list = useList("project-sources");
  const add = useAddToList("project-sources");
  const canAdd = useCanAdd();
  return <Combobox value={value} onChange={onChange} disabled={disabled} placeholder={placeholder} onCreate={canAdd ? add : undefined}
    options={opts((list.data ?? []).filter((s) => s.active || s.id === value))} />;
}

export function AccountPicker({ value, onChange, sourceId, disabled, placeholder = "Select" }: { value: string | null; onChange: (v: string | null) => void; sourceId?: string | null; disabled?: boolean; placeholder?: string }) {
  const list = useList("project-accounts");
  const add = useAddToList("project-accounts", () => ({ sourceId: sourceId ?? null }));
  const canAdd = useCanAdd();
  const options = (list.data ?? []).filter((a) => (a.active || a.id === value) && (!sourceId || !a.source_id || a.source_id === sourceId)).map((a) => ({ value: a.id, label: a.name, sub: a.source_name }));
  return <Combobox value={value} onChange={onChange} disabled={disabled} placeholder={placeholder} onCreate={canAdd ? add : undefined} options={options} />;
}

export function ChannelPicker({ value, onChange, placeholder = "e.g. Email, Slack, Microsoft Teams" }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const list = useList("communication-types");
  const add = useAddToList("communication-types");
  const canAdd = useCanAdd();
  return <MultiSelect value={value} onChange={onChange} placeholder={placeholder} onCreate={canAdd ? add : undefined}
    options={opts((list.data ?? []).filter((c) => c.active || value.includes(c.id)))} />;
}
