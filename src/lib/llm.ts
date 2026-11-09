import Anthropic from "@anthropic-ai/sdk";

/**
 * Lapisan LLM lintas provider dengan dukungan tool-calling.
 * - Anthropic: SDK resmi (streaming teks).
 * - OpenAI-compatible: Groq, OpenRouter, Mistral, Cerebras, Together, Hugging Face, Google (endpoint kompatibel OpenAI), OpenAI.
 */

export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };
export type ChatMsg =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant_tool_calls"; calls: { id: string; name: string; input: Record<string, unknown> }[]; text?: string }
  | { role: "tool_results"; results: ToolResult[] };

/** Gambar yang dilampirkan ke hasil tool (mis. view_image) agar model bisa melihatnya. */
export type ToolImage = { mime: string; b64: string };
export type ToolResult = { id: string; name: string; output: string; images?: ToolImage[] };

export type LlmStep = {
  text: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  usage: { input: number; output: number };
  stopReason?: string; // "end_turn" | "tool_use" | "max_tokens" | ...
};

export type ProviderCfg = { provider: string; model: string; apiKey: string; extra?: Record<string, string> };

const OPENAI_BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  mistral: "https://api.mistral.ai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  together: "https://api.together.xyz/v1",
  huggingface: "https://router.huggingface.co/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
};

/** Pecah "provider/model" dari katalog ai_models menjadi {provider, model} untuk pemanggilan. */
export function splitModelId(id: string): { keyProvider: string; model: string } {
  const [p, ...rest] = id.split("/");
  const m = rest.join("/");
  if (p === "openrouter" && m === "free") return { keyProvider: "openrouter", model: "deepseek/deepseek-chat-v3-0324:free" };
  if (p === "cloudflare") return { keyProvider: "cloudflare", model: `@cf/meta/${m}-instruct-fp8-fast` };
  if (p === "groq" || p === "cerebras" || p === "mistral" || p === "openai" || p === "google" || p === "anthropic") return { keyProvider: p, model: m };
  return { keyProvider: p, model: m };
}

/** Satu langkah percakapan (bisa berisi tool call). onText dipanggil untuk tiap potongan teks. */
export async function llmStep(
  cfg: ProviderCfg,
  system: string,
  messages: ChatMsg[],
  tools: ToolDef[],
  onText: (t: string) => void,
  maxTokens = 16000,
  signal?: AbortSignal
): Promise<LlmStep> {
  if (cfg.provider === "anthropic") return anthropicStep(cfg, system, messages, tools, onText, maxTokens, signal);
  if (cfg.provider === "cloudflare") return cloudflareStep(cfg, system, messages, onText);
  return openaiCompatStep(cfg, system, messages, tools, onText, Math.min(maxTokens, 8192), signal);
}

/** Bersihkan riwayat: buang pesan kosong & gabungkan peran berurutan yang sama (mencegah error 400 provider). */
export function sanitizeHistory(msgs: { role: "user" | "assistant"; content: string }[]): ChatMsg[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of msgs) {
    const c = (m.content ?? "").trim();
    if (!c) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + c;
    else out.push({ role: m.role, content: c });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function anthropicStep(cfg: ProviderCfg, system: string, messages: ChatMsg[], tools: ToolDef[], onText: (t: string) => void, maxTokens: number, signal?: AbortSignal): Promise<LlmStep> {
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const msgs: Anthropic.MessageParam[] = messages.map((m) => {
    if (m.role === "assistant_tool_calls") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const c of m.calls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      return { role: "assistant", content };
    }
    if (m.role === "tool_results") {
      return {
        role: "user",
        content: m.results.map((r) => ({
          type: "tool_result" as const,
          tool_use_id: r.id,
          content: r.images?.length
            ? [{ type: "text" as const, text: r.output }, ...r.images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.mime as "image/png", data: im.b64 } }))]
            : r.output,
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
  const stream = client.messages.stream({
    model: cfg.model, max_tokens: maxTokens, system, messages: msgs,
    tools: tools.length ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool["input_schema"] })) : undefined,
  }, { signal });
  let text = "";
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { text += ev.delta.text; onText(ev.delta.text); }
  }
  const final = await stream.finalMessage();
  const toolCalls = final.content.filter((c) => c.type === "tool_use").map((c) => {
    const t = c as Anthropic.ToolUseBlock;
    return { id: t.id, name: t.name, input: (t.input ?? {}) as Record<string, unknown> };
  });
  return { text, toolCalls, usage: { input: final.usage.input_tokens, output: final.usage.output_tokens }, stopReason: final.stop_reason ?? undefined };
}

async function openaiCompatStep(cfg: ProviderCfg, system: string, messages: ChatMsg[], tools: ToolDef[], onText: (t: string) => void, maxTokens: number, signal?: AbortSignal): Promise<LlmStep> {
  const base = OPENAI_BASES[cfg.provider] ?? cfg.extra?.base;
  if (!base) throw new Error(`Provider ${cfg.provider} belum didukung`);
  type OMsg = { role: string; content: string | null | unknown[]; tool_calls?: unknown[]; tool_call_id?: string; name?: string };
  const msgs: OMsg[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "assistant_tool_calls") {
      msgs.push({ role: "assistant", content: m.text || null, tool_calls: m.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })) });
    } else if (m.role === "tool_results") {
      for (const r of m.results) msgs.push({ role: "tool", tool_call_id: r.id, name: r.name, content: r.output });
      // pesan tool tidak bisa berisi gambar di API kompatibel OpenAI → kirim sebagai pesan user berisi gambar
      const imgs = m.results.flatMap((r) => r.images ?? []);
      if (imgs.length) msgs.push({ role: "user", content: [{ type: "text", text: "Gambar dari hasil tool view_image:" }, ...imgs.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.b64}` } }))] });
    } else msgs.push({ role: m.role, content: m.content });
  }
  const body: Record<string, unknown> = { model: cfg.model, messages: msgs, max_tokens: maxTokens, stream: false };
  if (tools.length) body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` };
  if (cfg.provider === "openrouter") { headers["HTTP-Referer"] = "https://pegawaiku.vercel.app"; headers["X-Title"] = "PegawaiKu"; }
  const r = await fetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? j.message ?? `HTTP ${r.status}`);
  const choice = j.choices?.[0];
  const text: string = choice?.message?.content ?? "";
  if (text) onText(text);
  const toolCalls = (choice?.message?.tool_calls ?? []).map((c: { id: string; function: { name: string; arguments: string } }) => {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(c.function.arguments || "{}"); } catch { /* abaikan */ }
    return { id: c.id, name: c.function.name, input };
  });
  const fr = choice?.finish_reason as string | undefined;
  return { text, toolCalls, usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 }, stopReason: fr === "length" ? "max_tokens" : fr };
}

async function cloudflareStep(cfg: ProviderCfg, system: string, messages: ChatMsg[], onText: (t: string) => void): Promise<LlmStep> {
  // Kunci disimpan sebagai "ACCOUNT_ID:API_TOKEN"
  const [account, token] = cfg.apiKey.split(":");
  if (!account || !token) throw new Error("Kunci Cloudflare harus berformat ACCOUNT_ID:API_TOKEN");
  const msgs = [{ role: "system", content: system }, ...messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: (m as { content: string }).content }))];
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${cfg.model}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ messages: msgs }),
  });
  const j = await r.json();
  if (!r.ok || !j.success) throw new Error(j.errors?.[0]?.message ?? `HTTP ${r.status}`);
  const text = j.result?.response ?? "";
  onText(text);
  return { text, toolCalls: [], usage: { input: 0, output: 0 } };
}
