import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { creditCost, PRICING } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 120;

const BASE_SYSTEM = `Kamu adalah pegawai AI di platform PegawaiKu. Jawab dalam Bahasa Indonesia kecuali diminta lain.
Ikuti deskripsi peran di bawah ini secara ketat. Jika ada tool yang disebut tetapi tidak tersedia di sini, nyatakan dan berikan hasil terbaik dalam bentuk teks.
Jangan pernah mengklaim telah membuat file, gambar, atau video; kamu hanya menghasilkan teks.`;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { conversationId, content } = (await req.json()) as { conversationId: string; content: string };
  if (!conversationId || !content?.trim()) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const { data: conv } = await supabase
    .from("conversations")
    .select("id,project_id,title,agent:agents(id,display_name,system_prompt),project:projects(org_id,name,brand)")
    .eq("id", conversationId)
    .single();
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });
  const agent = conv.agent as unknown as { id: string; display_name: string; system_prompt: string };
  const project = conv.project as unknown as { org_id: string; name: string; brand: Record<string, unknown> };

  const { data: org } = await supabase.from("organizations").select("credit_balance").eq("id", project.org_id).single();
  if (!org || Number(org.credit_balance) <= 0) {
    return NextResponse.json({ error: "Kredit habis. Top up dulu di menu Billing." }, { status: 402 });
  }

  // simpan pesan user
  await supabase.from("messages").insert({ conversation_id: conversationId, role: "user", content });
  if (conv.title === "Percakapan baru") {
    await supabase.from("conversations").update({ title: content.slice(0, 60) }).eq("id", conversationId);
  }

  const { data: history } = await supabase
    .from("messages")
    .select("role,content")
    .eq("conversation_id", conversationId)
    .order("created_at")
    .limit(40);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = `${BASE_SYSTEM}\n\nProject aktif: ${project.name}${Object.keys(project.brand ?? {}).length ? `\nBrand: ${JSON.stringify(project.brand)}` : ""}\n\n=== PERAN: ${agent.display_name} ===\n${agent.system_prompt}`;

  const stream = anthropic.messages.stream({
    model: PRICING.model,
    max_tokens: 4096,
    system,
    messages: (history ?? []).filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let full = "";
      try {
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            full += ev.delta.text;
            controller.enqueue(encoder.encode(ev.delta.text));
          }
        }
        const final = await stream.finalMessage();
        const inTok = final.usage.input_tokens;
        const outTok = final.usage.output_tokens;
        const cost = creditCost(inTok, outTok);
        const { data: msg } = await supabase
          .from("messages")
          .insert({ conversation_id: conversationId, role: "assistant", content: full, input_tokens: inTok, output_tokens: outTok, credit_cost: cost })
          .select("id")
          .single();
        await supabase.rpc("apply_credit", { p_org: project.org_id, p_amount: -cost, p_kind: "usage", p_reference: msg?.id ?? null, p_note: `${agent.display_name}: ${inTok}+${outTok} token` });
        await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
        controller.enqueue(encoder.encode(`\n\u0000${JSON.stringify({ cost, inTok, outTok })}`));
      } catch (e) {
        controller.enqueue(encoder.encode(`\n\n[Gagal: ${(e as Error).message}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
}
