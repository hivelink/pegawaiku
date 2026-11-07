import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { logEvent, describeError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Studio AI — generate hasil memakai kunci API milik organisasi (tabel org_api_keys).
 * Saat ini terhubung: teks (Anthropic, pakai kunci org atau env), gambar (Google Gemini image).
 * Provider lain disimpan sebagai riwayat dengan status 'failed' + pesan "belum terhubung".
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as { project_id: string; model_id: string; prompt: string; count?: number };
  if (!body.project_id || !body.model_id || !body.prompt?.trim()) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const [{ data: project }, { data: model }] = await Promise.all([
    supabase.from("projects").select("id,org_id").eq("id", body.project_id).single(),
    supabase.from("ai_models").select("*").eq("id", body.model_id).single(),
  ]);
  if (!project || !model) return NextResponse.json({ error: "project/model tidak ditemukan" }, { status: 404 });

  const { data: keyRow } = await supabase.from("org_api_keys").select("secret").eq("org_id", project.org_id).eq("provider", model.key_provider).maybeSingle();
  const apiKey = keyRow?.secret ?? (model.key_provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : undefined);
  if (!apiKey) return NextResponse.json({ error: `Kunci API ${model.key_provider} belum diatur. Buka Pengaturan → Kunci API.` }, { status: 400 });

  const { data: gen, error: insErr } = await supabase
    .from("generations")
    .insert({ project_id: project.id, user_id: user.id, model_id: model.id, kind: model.kind, prompt: body.prompt, status: "running" })
    .select("id").single();
  if (insErr || !gen) return NextResponse.json({ error: insErr?.message ?? "gagal" }, { status: 500 });

  async function finish(patch: Record<string, unknown>) {
    await supabase.from("generations").update(patch).eq("id", gen!.id);
  }

  try {
    if (model.kind === "text" && model.key_provider === "anthropic") {
      const client = new Anthropic({ apiKey });
      const res = await client.messages.create({ model: model.id.split("/")[1], max_tokens: 1024, messages: [{ role: "user", content: body.prompt }] });
      const text = res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n");
      await finish({ status: "done", output_url: text });
      return NextResponse.json({ ok: true });
    }

    if (model.kind === "image" && model.key_provider === "google") {
      const gm = model.id.split("/")[1]; // gemini-2.5-flash-image | imagen-4-fast ...
      if (!gm.startsWith("gemini")) throw new Error("Model Imagen belum terhubung; pilih Gemini Nano Banana.");
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${gm}:generateContent?key=${apiKey}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: body.prompt }] }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "Gemini gagal");
      const part = (j.candidates?.[0]?.content?.parts ?? []).find((p: { inlineData?: { data: string; mimeType: string } }) => p.inlineData);
      if (!part) throw new Error("Model tidak mengembalikan gambar (mungkin ditolak kebijakan).");
      const bytes = Buffer.from(part.inlineData.data, "base64");
      const ext = part.inlineData.mimeType.includes("jpeg") ? "jpg" : "png";
      const path = `${project.id}/gen-${gen.id}.${ext}`;
      const { error: upErr } = await supabase.storage.from("brand").upload(path, bytes, { contentType: part.inlineData.mimeType, upsert: true });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from("brand").getPublicUrl(path);
      await finish({ status: "done", output_url: pub.publicUrl, cost: model.price_usd ?? 0 });
      return NextResponse.json({ ok: true });
    }

    throw new Error(`Provider ${model.provider} (${model.key_provider}) belum terhubung ke Studio. Segera hadir.`);
  } catch (e) {
    const { message, detail } = describeError(e);
    await logEvent("error", "api:generate", message, { ...detail, model: model.id }, project.org_id);
    await finish({ status: "failed", error: message });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
