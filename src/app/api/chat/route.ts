import { NextResponse } from "next/server";
import { logEvent, describeError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { creditCost } from "@/lib/utils";
import { llmStep, splitModelId, type ChatMsg } from "@/lib/llm";
import { TOOL_DEFS, runTool, type ToolCtx } from "@/lib/agent-tools";

export const runtime = "nodejs";
export const maxDuration = 300;

const BASE_SYSTEM = `Kamu adalah pegawai AI di platform PegawaiKu. Jawab dalam Bahasa Indonesia kecuali diminta lain.
Ikuti deskripsi peran di bawah ini secara ketat.
Kamu punya tool. Pakai web_search/web_fetch untuk fakta terkini atau hal di luar pengetahuanmu; pakai save_to_drive untuk hasil panjang; pakai create_task bila user menyetujui rencana; pakai learn_skill untuk menyimpan keahlian baru yang kamu pelajari dari internet.
Jika diminta sesuatu di luar keahlian utamamu, jangan menolak: pelajari dulu dari internet (cari, baca 2-3 sumber), simpan dengan learn_skill, lalu kerjakan. Sebutkan sumbernya.
Jangan mengklaim membuat gambar/video; kamu menghasilkan teks dan file teks.`;

const MAX_STEPS = 8;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { conversationId, content } = (await req.json()) as { conversationId: string; content: string };
  if (!conversationId || !content?.trim()) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const { data: conv } = await supabase
    .from("conversations")
    .select("id,project_id,title,agent:agents(id,display_name,system_prompt,requires_tools),project:projects(id,org_id,name,tagline,description,brand,category,website)")
    .eq("id", conversationId)
    .single();
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });
  const agent = conv.agent as unknown as { id: string; display_name: string; system_prompt: string; requires_tools: string[] };
  const project = conv.project as unknown as { id: string; org_id: string; name: string; tagline: string | null; description: string | null; brand: Record<string, unknown>; category: string | null; website: string | null };

  const [{ data: org }, { data: keyRows }, { data: skillRows }, { data: knowledge }, { data: ptools }] = await Promise.all([
    supabase.from("organizations").select("credit_balance,chat_model").eq("id", project.org_id).single(),
    supabase.from("org_api_keys").select("provider,secret").eq("org_id", project.org_id),
    supabase.from("agent_skills").select("skill:skills(key,name,instructions,requires_tools)").eq("org_id", project.org_id).eq("agent_id", agent.id),
    supabase.from("agent_knowledge").select("title,content").eq("org_id", project.org_id).eq("agent_id", agent.id).order("created_at", { ascending: false }).limit(8),
    supabase.from("project_tools").select("tool_key").eq("project_id", project.id),
  ]);
  if (!org) return NextResponse.json({ error: "org tidak ditemukan" }, { status: 404 });

  const keys: Record<string, string> = Object.fromEntries((keyRows ?? []).map((k) => [k.provider, k.secret]));
  const { keyProvider, model } = splitModelId(org.chat_model || "anthropic/claude-sonnet-5-5");
  const apiKey = keys[keyProvider] ?? (keyProvider === "anthropic" ? process.env.ANTHROPIC_API_KEY : undefined);
  if (!apiKey) return NextResponse.json({ error: `Kunci API ${keyProvider} belum diatur (Pengaturan → Kunci API), atau ganti model chat di Pengaturan → Model AI.` }, { status: 400 });
  const usesPlatformKey = keyProvider === "anthropic" && !keys.anthropic;
  if (usesPlatformKey && Number(org.credit_balance) <= 0) {
    return NextResponse.json({ error: "Kredit habis. Top up di menu Billing, atau pasang kunci API sendiri (gratis: Groq/Gemini) di Pengaturan." }, { status: 402 });
  }

  // simpan pesan user
  await supabase.from("messages").insert({ conversation_id: conversationId, role: "user", content });
  if (conv.title === "Percakapan baru") await supabase.from("conversations").update({ title: content.slice(0, 60) }).eq("id", conversationId);

  const { data: history } = await supabase.from("messages").select("role,content").eq("conversation_id", conversationId).order("created_at").limit(40);

  // Susun system prompt: peran + skill terpasang + pengetahuan hasil belajar + konteks project
  type SkillRow = { skill: { key: string; name: string; instructions: string; requires_tools: string[] } };
  const skills = ((skillRows ?? []) as unknown as SkillRow[]).map((s) => s.skill).filter(Boolean);
  const brandCtx = [project.tagline && `Tagline: ${project.tagline}`, project.description && `Deskripsi: ${project.description}`, project.category && `Kategori: ${project.category}`, project.website && `Website: ${project.website}`, Object.keys(project.brand ?? {}).length ? `Brand: ${JSON.stringify(project.brand)}` : ""].filter(Boolean).join("\n");
  const system = [
    BASE_SYSTEM,
    `\nProject aktif: ${project.name}${brandCtx ? `\n${brandCtx}` : ""}`,
    `\n=== PERAN: ${agent.display_name} ===\n${agent.system_prompt}`,
    skills.length ? `\n=== SKILL TAMBAHAN ===\n${skills.map((s) => `## ${s.name}\n${s.instructions}`).join("\n\n")}` : "",
    (knowledge ?? []).length ? `\n=== PENGETAHUAN YANG SUDAH KAMU PELAJARI ===\n${(knowledge ?? []).map((k) => `## ${k.title}\n${k.content}`).join("\n\n")}` : "",
  ].join("\n");

  // Tool yang aktif: semua tool bawaan + yang diminta agent/skill; tool proyek (project_tools) sebagai whitelist tambahan
  const enabledKeys = new Set([
    "web_search", "web_fetch", "save_to_drive", "read_drive_file", "create_task", "learn_skill",
    ...(ptools ?? []).map((t) => t.tool_key),
  ]);
  const tools = Object.values(TOOL_DEFS).filter((t) => enabledKeys.has(t.name));

  const ctx: ToolCtx = { supabase, orgId: project.org_id, projectId: project.id, agentId: agent.id, userId: user.id, conversationId, keys };
  const messages: ChatMsg[] = (history ?? []).filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const emit = (t: string) => controller.enqueue(encoder.encode(t));
      let full = "";
      let inTok = 0, outTok = 0;
      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const res = await llmStep({ provider: keyProvider, model, apiKey }, system, messages, tools, (t) => { full += t; emit(t); });
          inTok += res.usage.input; outTok += res.usage.output;
          if (!res.toolCalls.length) break;
          messages.push({ role: "assistant_tool_calls", calls: res.toolCalls, text: res.text });
          const results: { id: string; name: string; output: string }[] = [];
          for (const call of res.toolCalls) {
            const label = call.name === "web_search" ? `🔎 Mencari: ${call.input.query}` : call.name === "web_fetch" ? `📄 Membaca: ${call.input.url}` : call.name === "save_to_drive" ? `💾 Menyimpan: ${call.input.filename}` : call.name === "create_task" ? `✅ Membuat tugas: ${call.input.title}` : call.name === "learn_skill" ? `🧠 Mempelajari: ${call.input.title}` : `🛠 ${call.name}`;
            const line = `\n\n> _${label}_\n\n`;
            full += line; emit(line);
            const output = await runTool(call.name, call.input, ctx);
            results.push({ id: call.id, name: call.name, output });
            await supabase.from("tool_runs").insert({ conversation_id: conversationId, tool_key: call.name, input: call.input, output_preview: output.slice(0, 300), ok: !output.startsWith("Gagal") });
          }
          messages.push({ role: "tool_results", results });
        }
        const cost = usesPlatformKey ? creditCost(inTok, outTok) : 0;
        const { data: msg } = await supabase
          .from("messages")
          .insert({ conversation_id: conversationId, role: "assistant", content: full, input_tokens: inTok, output_tokens: outTok, credit_cost: cost })
          .select("id").single();
        if (cost > 0) await supabase.rpc("apply_credit", { p_org: project.org_id, p_amount: -cost, p_kind: "usage", p_reference: msg?.id ?? null, p_note: `${agent.display_name}: ${inTok}+${outTok} token` });
        await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
        emit(`\n\u0000${JSON.stringify({ cost, inTok, outTok, model: org.chat_model })}`);
      } catch (e) {
        const { message, detail } = describeError(e);
        await logEvent("error", "api:chat", message, { ...detail, conversationId, model: org.chat_model, provider: keyProvider }, project.org_id);
        emit(`\n\n[Gagal: ${message}]`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
}
