import type { ToolDef } from "./tools";
import dns from "node:dns";
import { env } from "../../lib/env";

/** One conversation format for all providers; each adapter converts it to that provider's API. */
export type ToolCall = { id: string; name: string; args: any; sig?: string };
export type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; raw?: any[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };
export type Provider = "anthropic" | "openai" | "gemini";
export type ChatIn = { provider: Provider; key: string; model: string; system: string; messages: Msg[]; tools: ToolDef[] };
/** `raw` is the provider's own reply, kept when the provider needs it sent back unchanged (Gemini's thought signatures). */
export type ChatOut = { text: string; toolCalls: ToolCall[]; raw?: any[] };

export const DEFAULT_MODELS: Record<Provider, string> = { anthropic: "claude-sonnet-5-5", openai: "gpt-4.1-mini", gemini: "gemini-2.5-flash" };
export const PROVIDER_LABEL: Record<Provider, string> = { anthropic: "Claude (Anthropic)", openai: "OpenAI", gemini: "Gemini (Google)" };

export class ProviderError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

// Docker often has no working IPv6 route; trying IPv6 first makes calls hang until they time out.
dns.setDefaultResultOrder("ipv4first");

/** Turns a low-level network failure into a sentence that says what to check. */
function networkMessage(e: any, host: string) {
  const code: string = e?.cause?.code ?? e?.code ?? "";
  if (e?.name === "TimeoutError") return `Couldn't reach the AI provider: ${host} didn't answer within 60 seconds. The server running eszy probably can't reach the internet (check Docker's network, a firewall, VPN or proxy).`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `Couldn't reach the AI provider: the server running eszy couldn't look up ${host}. Check its internet connection or DNS.`;
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT" || code === "ENETUNREACH")
    return `Couldn't reach the AI provider: the connection to ${host} was blocked (${code}). A firewall, VPN or proxy may be stopping it.`;
  if (/CERT|SSL|TLS/i.test(code)) return `Couldn't reach the AI provider: the secure connection to ${host} failed (${code}). Antivirus or a company proxy that inspects HTTPS can cause this.`;
  return `Couldn't reach the AI provider (${code || e?.message || "network error"}).`;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const host = new URL(url).host;
  let r: Response | undefined;
  // One retry for a dropped connection; never for a timeout, which has already waited long enough.
  for (let attempt = 0; attempt < 2 && !r; attempt++) {
    try {
      r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    } catch (e: any) {
      console.error(`[assistant] request to ${host} failed:`, e?.name, e?.cause?.code ?? e?.code ?? "", e?.cause?.message ?? e?.message);
      if (attempt === 1 || e?.name === "TimeoutError") throw new ProviderError(networkMessage(e, host));
    }
  }
  if (!r) throw new ProviderError(`Couldn't reach the AI provider (${host}).`);
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message ?? j?.message ?? r.statusText;
    if (r.status === 401 || r.status === 403) throw new ProviderError(`The AI provider refused the API key: ${msg}`, r.status);
    if (r.status === 429) throw new ProviderError("The AI provider's rate limit or credit was reached. Try again in a minute.", r.status);
    throw new ProviderError(`The AI provider returned an error: ${msg}`, r.status);
  }
  return j;
}

// ------------------------------------------------------------------------------------------------ Anthropic
async function anthropic(i: ChatIn): Promise<ChatOut> {
  const messages: any[] = [];
  for (const m of i.messages) {
    if (m.role === "user") messages.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const content: any[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const t of m.toolCalls ?? []) content.push({ type: "tool_use", id: t.id, name: t.name, input: t.args ?? {} });
      if (content.length) messages.push({ role: "assistant", content });
    } else {
      // Consecutive tool results go into one user turn.
      const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      const last = messages[messages.length - 1];
      if (last?.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "tool_result") last.content.push(block);
      else messages.push({ role: "user", content: [block] });
    }
  }
  const j = await postJson("https://api.anthropic.com/v1/messages", { "x-api-key": i.key, "anthropic-version": "2023-06-01" }, {
    model: i.model, max_tokens: 1500, system: i.system, messages,
    tools: i.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
  });
  const blocks: any[] = j.content ?? [];
  return {
    text: blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(),
    toolCalls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} })),
  };
}

// ------------------------------------------------------------------------------------------------ OpenAI
async function openai(i: ChatIn): Promise<ChatOut> {
  const messages: any[] = [{ role: "system", content: i.system }];
  for (const m of i.messages) {
    if (m.role === "user") messages.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      messages.push({ role: "assistant", content: m.content || null, ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) } })) } : {}) });
    } else messages.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
  }
  const j = await postJson("https://api.openai.com/v1/chat/completions", { authorization: `Bearer ${i.key}` }, {
    model: i.model, messages, tools: i.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
  });
  const msg = j.choices?.[0]?.message ?? {};
  return {
    text: (msg.content ?? "").trim(),
    toolCalls: (msg.tool_calls ?? []).map((t: any) => ({ id: t.id, name: t.function?.name, args: safeJson(t.function?.arguments) })),
  };
}

// ------------------------------------------------------------------------------------------------ Gemini
async function gemini(i: ChatIn): Promise<ChatOut> {
  const contents: any[] = [];
  for (const m of i.messages) {
    if (m.role === "user") contents.push({ role: "user", parts: [{ text: m.content }] });
    else if (m.role === "assistant") {
      // Gemini needs its earlier turns back exactly as it sent them, thought signatures included.
      if (Array.isArray(m.raw) && m.raw.length) { contents.push({ role: "model", parts: m.raw }); continue; }
      const parts: any[] = [];
      if (m.content) parts.push({ text: m.content });
      (m.toolCalls ?? []).forEach((t, n) => parts.push({
        functionCall: { name: t.name, args: t.args ?? {} },
        // Calls saved before signatures were kept (or made by another provider) use Google's documented placeholder.
        ...(n === 0 ? { thoughtSignature: t.sig ?? "skip_thought_signature_validator" } : t.sig ? { thoughtSignature: t.sig } : {}),
      }));
      if (parts.length) contents.push({ role: "model", parts });
    } else {
      const part = { functionResponse: { name: m.name, response: { content: safeJson(m.content) ?? m.content } } };
      const last = contents[contents.length - 1];
      if (last?.role === "user" && last.parts[0]?.functionResponse) last.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
    }
  }
  const decl = i.tools.map((t) => ({ name: t.name, description: t.description, ...(Object.keys(t.parameters.properties).length ? { parameters: t.parameters } : {}) }));
  const j = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(i.model)}:generateContent`, { "x-goog-api-key": i.key }, {
    systemInstruction: { parts: [{ text: i.system }] }, contents, tools: [{ functionDeclarations: decl }],
  });
  const parts: any[] = j.candidates?.[0]?.content?.parts ?? [];
  if (!parts.length && j.candidates?.[0]?.finishReason && j.candidates[0].finishReason !== "STOP") throw new ProviderError(`Gemini stopped without an answer (${j.candidates[0].finishReason}). Try asking another way.`);
  return {
    text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("\n").trim(),
    toolCalls: parts.filter((p) => p.functionCall).map((p, n) => ({ id: `g${Date.now()}${n}`, name: p.functionCall.name, args: p.functionCall.args ?? {}, ...(p.thoughtSignature ? { sig: p.thoughtSignature } : {}) })),
    raw: parts,
  };
}

// ------------------------------------------------------------------------------------------------ test double
/**
 * A key starting with "test-" uses a tiny rule-based stand-in, so the chat, tools and confirmations can be tested
 * without a real provider. It is never used for a real key.
 */
function fake(i: ChatIn): ChatOut {
  const last = i.messages[i.messages.length - 1];
  if (last.role === "tool") return { text: `Here's what I found: ${last.content.slice(0, 400)}`, toolCalls: [] };
  const text = last.role === "user" ? last.content.toLowerCase() : "";
  const call = (name: string, args: any = {}) => ({ text: "", toolCalls: [{ id: `t${Date.now()}`, name, args }] });
  const has = (n: string) => i.tools.some((t) => t.name === n);
  if (text.includes("leave") && text.includes("apply") && has("request_leave")) {
    const d = /(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
    return call("request_leave", { leave_type: "Casual", start_date: d, reason: "Family function" });
  }
  if (/\blog \d/.test(text) && has("log_time")) {
    const p = /on (.+?) for/.exec(text)?.[1] ?? "";
    return call("log_time", { project: p, hours: Number(/(\d+(?:\.\d+)?) ?h/.exec(text)?.[1] ?? 1), description: "Logged from chat" });
  }
  if (text.includes("approvals") && has("pending_approvals")) return call("pending_approvals");
  if (text.includes("hours")) return call("person_hours", {});
  if (text.includes("project")) return call("list_projects", {});
  if (text.includes("who am i")) return call("my_profile");
  return { text: "Hi! Ask me about your hours, projects, leave or team.", toolCalls: [] };
}

const safeJson = (s: any) => { if (typeof s !== "string") return s; try { return JSON.parse(s); } catch { return null; } };

export async function chat(i: ChatIn): Promise<ChatOut> {
  if (i.key.startsWith("test-") && env.NODE_ENV !== "production") return fake(i);
  if (i.provider === "anthropic") return anthropic(i);
  if (i.provider === "openai") return openai(i);
  return gemini(i);
}
