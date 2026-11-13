import { Router } from "express";
import { z } from "zod";
import { can, h, userId } from "../lib/context";
import { requirePerm } from "../lib/auth";
import { badRequest, notFound } from "../lib/errors";
import { decrypt, encrypt } from "../lib/crypto";
import { getSettings } from "../lib/settings";
import { audit } from "../lib/audit";
import { env } from "../lib/env";
import { todayIn } from "../lib/dates";
import { selfCall } from "../lib/selfCall";
import { DEFAULT_MODELS, PROVIDER_LABEL, ProviderError, chat, type Msg, type Provider } from "../services/assistant/providers";
import { TOOLS, ToolError, prepareWrite, runRead, toolsFor } from "../services/assistant/tools";

/**
 * The in-app assistant (called Astra unless the company renames it). It answers from the company's data through tools that call
 * eszy's API as the person chatting, so it never sees more than they can. Anything that changes data becomes a pending action
 * that the person confirms in the chat first.
 */
export const assistantRouter = Router();
const uuid = z.string().uuid();
const PROVIDERS = ["anthropic", "openai", "gemini"] as const;
const ENV_KEY: Record<Provider, string> = { anthropic: env.ANTHROPIC_API_KEY, openai: env.OPENAI_API_KEY, gemini: env.GEMINI_API_KEY };

async function keyFor(db: any, provider: Provider): Promise<{ key: string; source: "company" | "platform" } | null> {
  const r = (await db.query("SELECT key_enc FROM ai_keys WHERE provider = $1", [provider])).rows[0];
  if (r) return { key: decrypt(r.key_enc), source: "company" };
  return ENV_KEY[provider] ? { key: ENV_KEY[provider], source: "platform" } : null;
}

/** What everyone needs to show the assistant: its name, icon, and whether it's ready. */
assistantRouter.get("/assistant/info", h(async (_req, db) => {
  const s = await getSettings(db);
  const a = s.assistant;
  const key = await keyFor(db, a.provider);
  return { enabled: a.enabled, ready: a.enabled && !!key, name: a.name, icon: a.icon, greeting: a.greeting, provider: a.provider, providerLabel: PROVIDER_LABEL[a.provider] };
}));

// ---------- keys (settings.manage) ----------
assistantRouter.get("/assistant/keys", requirePerm("settings.manage"), h(async (_req, db) => {
  const rows = (await db.query("SELECT k.provider, k.last4, k.updated_at, u.name AS updated_by_name FROM ai_keys k LEFT JOIN users u ON u.id = k.updated_by")).rows;
  return PROVIDERS.map((p) => {
    const r = rows.find((x: any) => x.provider === p);
    return { provider: p, label: PROVIDER_LABEL[p], defaultModel: DEFAULT_MODELS[p], hasKey: !!r, last4: r?.last4 ?? null, updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by_name ?? null, platformKey: !!ENV_KEY[p] };
  });
}));
assistantRouter.put("/assistant/keys/:provider", requirePerm("settings.manage"), h(async (req, db) => {
  const provider = z.enum(PROVIDERS).parse(req.params.provider);
  const { key } = z.object({ key: z.string().trim().min(10, "That doesn't look like an API key").max(400) }).parse(req.body);
  await db.query(
    `INSERT INTO ai_keys (tenant_id, provider, key_enc, last4, updated_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id, provider) DO UPDATE SET key_enc = EXCLUDED.key_enc, last4 = EXCLUDED.last4, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [req.tenant!.id, provider, encrypt(key), key.slice(-4), userId(req)]);
  await audit(db, req, "assistant.key", "settings", null, { provider, last4: key.slice(-4) });
  return { ok: true };
}));
assistantRouter.delete("/assistant/keys/:provider", requirePerm("settings.manage"), h(async (req, db) => {
  const provider = z.enum(PROVIDERS).parse(req.params.provider);
  await db.query("DELETE FROM ai_keys WHERE provider = $1", [provider]);
  await audit(db, req, "assistant.key_removed", "settings", null, { provider });
  return { ok: true };
}));
/** Sends one short message to check that the key and model work. */
assistantRouter.post("/assistant/test", requirePerm("settings.manage"), h(async (req, db) => {
  const b = z.object({ provider: z.enum(PROVIDERS), model: z.string().optional() }).parse(req.body);
  const k = await keyFor(db, b.provider);
  if (!k) throw badRequest(`Add a ${PROVIDER_LABEL[b.provider]} key first`);
  const model = b.model || DEFAULT_MODELS[b.provider];
  try {
    const out = await chat({ provider: b.provider, key: k.key, model, system: "Reply with the single word OK.", messages: [{ role: "user", content: "Say OK" }], tools: [] });
    return { ok: true, model, reply: out.text.slice(0, 80) };
  } catch (e: any) {
    throw badRequest(e instanceof ProviderError ? e.message : "The test failed");
  }
}));

// ---------- conversations ----------
assistantRouter.get("/assistant/conversations", h(async (req, db) => (await db.query(
  `SELECT conversation_id AS id, min(created_at) AS started_at, max(created_at) AS last_at,
     (array_agg(content ORDER BY created_at) FILTER (WHERE role = 'user'))[1] AS title
   FROM ai_messages WHERE user_id = $1 GROUP BY conversation_id ORDER BY max(created_at) DESC LIMIT 30`, [userId(req)])).rows));

assistantRouter.get("/assistant/conversations/:id", h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const messages = (await db.query("SELECT id, role, content, data, created_at FROM ai_messages WHERE user_id = $1 AND conversation_id = $2 AND role <> 'tool' ORDER BY created_at", [userId(req), id])).rows;
  const actions = (await db.query("SELECT id, tool, summary, status, result, created_at FROM ai_actions WHERE user_id = $1 AND conversation_id = $2 ORDER BY created_at", [userId(req), id])).rows;
  return { id, messages: messages.filter((m: any) => m.content || m.data?.actionId), actions };
}));
assistantRouter.delete("/assistant/conversations/:id", h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  await db.query("DELETE FROM ai_messages WHERE user_id = $1 AND conversation_id = $2", [userId(req), id]);
  await db.query("DELETE FROM ai_actions WHERE user_id = $1 AND conversation_id = $2", [userId(req), id]);
  return { ok: true };
}));

function systemPrompt(name: string, company: string, me: any, today: string, tz: string, currency: string, extra: string, canWrite: string[]) {
  return [
    `You are ${name}, the assistant inside ${company}'s eszy workspace (timesheets, projects, leave, clients, invoices and reports).`,
    `You are talking to ${me.name} (${me.roles.join(", ") || "employee"}). Today is ${today} (${tz}).`,
    "Rules:",
    "- Answer only from what the tools return. If a tool says something isn't allowed or doesn't exist, say so plainly. Never guess numbers, names or dates.",
    "- You can only see what this person can see in the app. Don't offer to look up things outside their access.",
    canWrite.length
      ? `- To change something use the matching tool (${canWrite.join(", ")}). It does NOT happen straight away: the app shows the person a confirmation card. Tell them to confirm it below. Ask first if anything needed is missing (date, project, hours, reason).`
      : "- You can't change anything for this person; explain how they can do it in the app.",
    `- Amounts ending in _minor are in the smallest currency unit: divide by 100 and show them in ${currency}.`,
    "- Be brief and friendly. Use short lists for several items. Use the person's words for dates (convert to YYYY-MM-DD for tools).",
    extra ? `Company notes:\n${extra}` : "",
  ].filter(Boolean).join("\n");
}

const toMsg = (r: any): Msg => (r.role === "tool"
  ? { role: "tool", toolCallId: r.data?.toolCallId, name: r.data?.name, content: r.content }
  : r.role === "assistant" ? { role: "assistant", content: r.content, toolCalls: r.data?.toolCalls, raw: r.data?.raw } : { role: "user", content: r.content });

assistantRouter.post("/assistant/chat", h(async (req, db) => {
  const b = z.object({ conversationId: uuid.optional(), message: z.string().trim().min(1).max(4000) }).parse(req.body);
  const s = await getSettings(db);
  const a = s.assistant;
  if (!a.enabled) throw badRequest(`${a.name} is switched off for this company`);
  const k = await keyFor(db, a.provider);
  if (!k) throw badRequest(`${a.name} isn't set up yet. An admin adds an AI key under Settings → Assistant.`);
  const conv = b.conversationId ?? crypto.randomUUID();
  const me = { name: req.user!.name, roles: (req.user as any).roleNames ?? (req.user as any).roleKeys ?? [] };
  const canFn = (p: string) => can(req, p as any);
  const tools = toolsFor(canFn);
  const today = todayIn(s.locale.timezone);
  const ctx = { req, can: canFn, today, meId: userId(req) };
  const save = (role: string, content: string, data?: unknown) =>
    db.query("INSERT INTO ai_messages (tenant_id, user_id, conversation_id, role, content, data, created_at) VALUES ($1,$2,$3,$4,$5,$6, clock_timestamp())", [req.tenant!.id, userId(req), conv, role, content, data ? JSON.stringify(data) : null]);

  const history = (await db.query("SELECT role, content, data FROM ai_messages WHERE user_id = $1 AND conversation_id = $2 ORDER BY created_at DESC LIMIT 40", [userId(req), conv])).rows.reverse();
  // Never start the history with orphan tool results.
  while (history.length && history[0].role !== "user") history.shift();
  const messages: Msg[] = history.map(toMsg);
  messages.push({ role: "user", content: b.message });
  await save("user", b.message);

  const system = systemPrompt(a.name, s.branding.displayName || req.tenant!.name, me, today, s.locale.timezone, s.locale.currency, a.instructions, tools.filter((t) => t.kind === "write").map((t) => t.name));
  const model = a.model || DEFAULT_MODELS[a.provider];
  const actions: any[] = [];
  let reply = "";
  const used: string[] = [];
  for (let step = 0; step < 6; step++) {
    let out;
    try {
      out = await chat({ provider: a.provider, key: k.key, model, system, messages, tools });
    } catch (e: any) {
      const msg = e instanceof ProviderError ? e.message : "Something went wrong talking to the AI provider.";
      await save("assistant", msg, { error: true });
      return { conversationId: conv, reply: msg, error: true, actions };
    }
    messages.push({ role: "assistant", content: out.text, toolCalls: out.toolCalls.length ? out.toolCalls : undefined, raw: out.raw });
    await save("assistant", out.toolCalls.length ? "" : out.text, out.toolCalls.length || out.raw ? { ...(out.toolCalls.length ? { toolCalls: out.toolCalls, text: out.text } : {}), ...(out.raw ? { raw: out.raw } : {}) } : undefined);
    if (!out.toolCalls.length) { reply = out.text; break; }
    for (const tc of out.toolCalls) {
      const def = tools.find((t) => t.name === tc.name);
      let result: unknown;
      used.push(tc.name);
      try {
        if (!def) throw new ToolError(TOOLS.some((t) => t.name === tc.name) ? "This person isn't allowed to do that." : "No such tool.");
        if (def.kind === "read") result = await runRead(ctx, tc.name, tc.args ?? {});
        else {
          const p = await prepareWrite(ctx, tc.name, tc.args ?? {});
          const row = (await db.query(
            "INSERT INTO ai_actions (tenant_id, user_id, conversation_id, tool, args, summary) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, tool, summary, status, created_at",
            [req.tenant!.id, userId(req), conv, tc.name, JSON.stringify({ method: p.method, path: p.path, body: p.body, done: p.done }), p.summary])).rows[0];
          actions.push(row);
          result = { status: "waiting_for_confirmation", summary: p.summary, note: "The person sees a Confirm button for this. Don't call this tool again for the same change." };
        }
      } catch (e: any) {
        result = { error: e instanceof ToolError ? e.message : "That didn't work." };
      }
      const content = JSON.stringify(result).slice(0, 12000);
      messages.push({ role: "tool", toolCallId: tc.id, name: tc.name, content });
      await save("tool", content, { toolCallId: tc.id, name: tc.name });
    }
    if (step === 5) reply = "I couldn't finish that in one go. Try asking in smaller steps.";
  }
  if (!reply && actions.length) reply = actions.length === 1 ? `I've prepared this for you. Confirm it below and I'll do it.` : `I've prepared ${actions.length} changes. Confirm each one below.`;
  if (reply && !messages.some((m) => m.role === "assistant" && m.content === reply)) await save("assistant", reply);
  return { conversationId: conv, reply, actions, tools: used };
}));

/** The person confirms (or declines) a change the assistant prepared; it then runs with their own access. */
assistantRouter.post("/assistant/actions/:id/:decision", h(async (req, db) => {
  const id = uuid.parse(req.params.id);
  const decision = z.enum(["confirm", "decline"]).parse(req.params.decision);
  const a = (await db.query("SELECT * FROM ai_actions WHERE id = $1 AND user_id = $2", [id, userId(req)])).rows[0];
  if (!a) throw notFound("Action not found");
  if (a.status !== "pending") throw badRequest("This was already handled");
  if (Date.now() - new Date(a.created_at).getTime() > 24 * 3600e3) throw badRequest("This is more than a day old. Ask again so the details are fresh.");
  const save = (content: string, data: unknown) =>
    db.query("INSERT INTO ai_messages (tenant_id, user_id, conversation_id, role, content, data, created_at) VALUES ($1,$2,$3,'assistant',$4,$5, clock_timestamp())", [req.tenant!.id, userId(req), a.conversation_id, content, JSON.stringify(data)]);
  if (decision === "decline") {
    await db.query("UPDATE ai_actions SET status = 'declined', decided_at = now() WHERE id = $1", [id]);
    await save("OK, I won't do that.", { actionId: id });
    return { status: "declined", message: "OK, I won't do that." };
  }
  const r = await selfCall(req, a.args.method, a.args.path, a.args.body);
  if (r.status >= 400) {
    const msg = r.body?.error?.message ?? r.body?.message ?? "That didn't work.";
    await db.query("UPDATE ai_actions SET status = 'failed', decided_at = now(), result = $2 WHERE id = $1", [id, JSON.stringify({ status: r.status, message: msg })]);
    await save(`That didn't go through: ${msg}`, { actionId: id, failed: true });
    return { status: "failed", message: msg };
  }
  await db.query("UPDATE ai_actions SET status = 'done', decided_at = now(), result = $2 WHERE id = $1", [id, JSON.stringify({ status: r.status })]);
  await audit(db, req, "assistant.action", "assistant", id, { tool: a.tool, summary: a.summary });
  await save(a.args.done, { actionId: id, done: true });
  return { status: "done", message: a.args.done };
}));
