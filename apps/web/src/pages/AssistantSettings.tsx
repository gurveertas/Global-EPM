import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Trash2 } from "lucide-react";
import { del, get, post, put } from "../lib/api";
import { useAction } from "../lib/hooks";
import { ASSISTANT_ICONS, AssistantIcon } from "../components/Astra";
import { BorderBeam } from "../components/magic";
import { Button, Card, ErrorNote, Field, Input, Pill, Select, Spinner, Textarea, Toggle, cx, fmtDateTime, useConfirm, useToast } from "../components/ui";

const PROVIDERS = [
  { id: "anthropic", label: "Claude (Anthropic)", hint: "Key starts with sk-ant-. From console.anthropic.com → API keys." },
  { id: "openai", label: "OpenAI", hint: "Key starts with sk-. From platform.openai.com → API keys." },
  { id: "gemini", label: "Gemini (Google)", hint: "From aistudio.google.com → Get API key." },
] as const;

/** Settings → Assistant: its name and icon, which AI provider and model it uses, and the company's API keys. */
export function AssistantSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => get<any>("/settings") });
  const keys = useQuery({ queryKey: ["assistant-keys"], queryFn: () => get<any[]>("/assistant/keys") });
  const [v, setV] = useState<any>(null);
  const [newKey, setNewKey] = useState<Record<string, string>>({});
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const act = useAction();
  useEffect(() => { if (settings.data && !v) setV(settings.data.assistant); }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v || !keys.data) return <Spinner />;
  const cur = keys.data.find((k) => k.provider === v.provider);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["assistant-keys"] }); qc.invalidateQueries({ queryKey: ["assistant-info"] }); qc.invalidateQueries({ queryKey: ["settings"] }); };
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid gap-5">
        <Card title="The assistant" sub="Everyone sees it in the top bar. It answers from your company's data with each person's own access, and asks before changing anything.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" hint="What people call it, e.g. Astra, Nova, Ask HR."><Input value={v.name} maxLength={30} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field label="Switched on"><Toggle checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })} label={v.enabled ? "On for everyone" : "Off"} /></Field>
            <Field label="Icon" className="sm:col-span-2">
              <div className="flex flex-wrap gap-2">
                {Object.keys(ASSISTANT_ICONS).map((k) => (
                  <button key={k} type="button" onClick={() => setV({ ...v, icon: k })} aria-label={k} aria-pressed={v.icon === k}
                    className={cx("grid size-12 place-items-center rounded-xl border transition", v.icon === k ? "border-transparent bg-brand-gradient text-white neon-ring" : "border-[var(--line)] hover:border-[var(--brand-2)]/60")}>
                    <AssistantIcon icon={k} className="size-5" />
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Greeting" className="sm:col-span-2" hint="Shown when someone opens a new chat. Leave empty for the default."><Input value={v.greeting} maxLength={200} onChange={(e) => setV({ ...v, greeting: e.target.value })} placeholder="I can look up your hours, projects, leave and team." /></Field>
            <Field label="Company notes for the assistant" className="sm:col-span-2" hint="Policies or wording it should know, e.g. 'Leave needs 3 days notice. Call Team Leads TLs.' Don't put secrets here.">
              <Textarea value={v.instructions} maxLength={2000} onChange={(e) => setV({ ...v, instructions: e.target.value })} className="min-h-24" />
            </Field>
          </div>
        </Card>
        <Card title="AI provider" sub="Pick the provider and, if you like, a specific model. The key you add is stored encrypted and only its last four characters are shown.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider"><Select value={v.provider} onChange={(e) => { setV({ ...v, provider: e.target.value, model: "" }); setTest(null); }}>{PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
            <Field label="Model" hint={`Leave empty for ${cur?.defaultModel}.`}><Input value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} placeholder={cur?.defaultModel} /></Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" disabled={!cur?.hasKey && !cur?.platformKey} onClick={async () => {
              setTest(null);
              try { const r = await post<any>("/assistant/test", { provider: v.provider, model: v.model || undefined }); setTest({ ok: true, text: `Working. ${r.model} replied “${r.reply}”.` }); }
              catch (e: any) { setTest({ ok: false, text: e?.message ?? "The test failed" }); }
            }}>Test the connection</Button>
            {test && <span className={cx("text-[13.5px] font-semibold", test.ok ? "text-[#1c7a4f]" : "text-[#b4441f]")}>{test.text}</span>}
          </div>
        </Card>
        <ErrorNote error={act.err} />
        <div><Button busy={!!act.busy} onClick={async () => { if (await act.run(() => put("/settings", { assistant: v }), "Assistant saved")) refresh(); }}>Save assistant settings</Button></div>
      </div>

      <Card title="API keys" sub="One key per provider. Only admins can see this.">
        <ul className="grid gap-3">
          {keys.data.map((k) => (
            <li key={k.provider} className={cx("relative overflow-hidden rounded-xl border p-3.5", k.provider === v.provider ? "border-[var(--brand-2)]/50" : "border-[var(--line)]")}>
              {k.provider === v.provider && k.hasKey && <BorderBeam size={60} duration={8} radius={12} />}
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[14px] font-semibold"><KeyRound className="size-4 text-[var(--muted)]" />{k.label}</span>
                {k.hasKey ? <Pill status="paid">•••• {k.last4}</Pill> : k.platformKey ? <Pill status="info">Platform key</Pill> : <Pill status="draft">No key</Pill>}
              </div>
              {k.hasKey && <p className="mt-1 text-[12px] text-[var(--muted)]">Added {fmtDateTime(k.updatedAt)}{k.updatedBy ? ` by ${k.updatedBy}` : ""}</p>}
              <p className="mt-1 text-[12px] text-[var(--muted)]">{PROVIDERS.find((p) => p.id === k.provider)?.hint}</p>
              <div className="mt-2.5 flex gap-2">
                <Input type="password" autoComplete="off" placeholder={k.hasKey ? "Paste a new key to replace it" : "Paste the API key"} value={newKey[k.provider] ?? ""} onChange={(e) => setNewKey({ ...newKey, [k.provider]: e.target.value })} className="h-9" />
                <Button size="sm" disabled={!(newKey[k.provider] ?? "").trim()} onClick={async () => {
                  if (await act.run(() => put(`/assistant/keys/${k.provider}`, { key: newKey[k.provider].trim() }), "Key saved")) { setNewKey({ ...newKey, [k.provider]: "" }); refresh(); }
                }}>Save</Button>
                {k.hasKey && <Button size="sm" variant="ghost" aria-label={`Remove ${k.label} key`} onClick={async () => {
                  if (await confirm({ title: `Remove the ${k.label} key?`, body: "The assistant stops working with this provider until a new key is added.", confirm: "Remove", danger: true }) === false) return;
                  await del(`/assistant/keys/${k.provider}`); toast("Key removed"); refresh();
                }}><Trash2 className="size-4" /></Button>}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex items-start gap-2 text-[12.5px] text-[var(--muted)]"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#1c7a4f]" />Usage is billed by the provider to whoever owns the key. Each chat sends the person's question and only the data the tools fetched for it.</p>
      </Card>
    </div>
  );
}
