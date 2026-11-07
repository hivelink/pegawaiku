import { NextResponse } from "next/server";
import { logEvent, describeError } from "@/lib/log";
import { getContext } from "@/lib/context";
import { llmStep, splitModelId, type ChatMsg } from "@/lib/llm";
import { TOOL_DEFS, runTool, type ToolCtx } from "@/lib/agent-tools";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Minta seorang agent mempelajari topik dari internet dan menyimpannya sebagai pengetahuan. */
export async function POST(req: Request) {
  const { supabase, org, project, user } = await getContext();
  if (!org || !project) return NextResponse.json({ error: "project tidak ditemukan" }, { status: 400 });
  const { agent_id, topic } = (await req.json()) as { agent_id: string; topic: string };
  if (!agent_id || !topic?.trim()) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const [{ data: agent }, { data: orgRow }, { data: keyRows }] = await Promise.all([
    supabase.from("agents").select("id,display_name,title,system_prompt").eq("id", agent_id).single(),
    supabase.from("organizations").select("chat_model").eq("id", org.id).single(),
    supabase.from("org_api_keys").select("provider,secret").eq("org_id", org.id),
  ]);
  if (!agent) return NextResponse.json({ error: "agent tidak ditemukan" }, { status: 404 });
  const keys: Record<string, string> = Object.fromEntries((keyRows ?? []).map((k) => [k.provider, k.secret]));
  const { keyProvider, model } = splitModelId(orgRow?.chat_model || "anthropic/claude-sonnet-5-5");
  const apiKey = keys[keyProvider] ?? (keyProvider === "anthropic" ? process.env.ANTHROPIC_API_KEY : undefined);
  if (!apiKey) return NextResponse.json({ error: `Kunci API ${keyProvider} belum diatur.` }, { status: 400 });

  const system = `Kamu adalah ${agent.display_name} (${agent.title}). Tugasmu sekarang: MEMPELAJARI topik baru dari internet agar menjadi keahlian tambahanmu.
Langkah wajib: (1) web_search 2-4 kueri berbeda (ID dan EN), (2) web_fetch 2-3 sumber terbaik, (3) susun panduan praktis 400-800 kata dalam Bahasa Indonesia: definisi singkat, langkah kerja, aturan/praktik terbaik, kesalahan umum, contoh, (4) panggil learn_skill dengan judul singkat, isi panduan, dan daftar sumber (judul+url). Setelah learn_skill berhasil, balas satu paragraf ringkasan apa yang kamu pelajari.`;
  const tools = ["web_search", "web_fetch", "learn_skill"].map((k) => TOOL_DEFS[k]);
  const ctx: ToolCtx = { supabase, orgId: org.id, projectId: project.id, agentId: agent.id, userId: user.id, conversationId: "", keys };
  const messages: ChatMsg[] = [{ role: "user", content: `Pelajari topik ini: ${topic}` }];

  let summary = "";
  let learned = false;
  try {
    for (let step = 0; step < 8; step++) {
      const res = await llmStep({ provider: keyProvider, model, apiKey }, system, messages, tools, (t) => { summary += t; });
      if (!res.toolCalls.length) break;
      messages.push({ role: "assistant_tool_calls", calls: res.toolCalls, text: res.text });
      const results = [];
      for (const call of res.toolCalls) {
        const output = await runTool(call.name, call.input, ctx);
        if (call.name === "learn_skill" && !output.startsWith("Gagal")) learned = true;
        results.push({ id: call.id, name: call.name, output });
      }
      messages.push({ role: "tool_results", results });
      summary = "";
    }
  } catch (e) {
    const { message, detail } = describeError(e);
    await logEvent("error", "api:learn", message, { ...detail, topic, agent: agent.display_name }, org.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  if (!learned) return NextResponse.json({ error: "Agent tidak berhasil menyimpan pengetahuan. Coba topik yang lebih spesifik." }, { status: 500 });
  return NextResponse.json({ ok: true, summary });
}
