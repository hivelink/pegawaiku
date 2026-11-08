import { NextResponse } from "next/server";
import { logEvent, describeError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { creditCost } from "@/lib/utils";
import { llmStep, splitModelId, sanitizeHistory, type ChatMsg } from "@/lib/llm";
import { TOOL_DEFS, runTool, type ToolCtx } from "@/lib/agent-tools";
import { BUILTIN_CAP_DEFS, httpCapToolDef, type HttpSpec } from "@/lib/capabilities";

export const runtime = "nodejs";
export const maxDuration = 300;

const BASE_SYSTEM = `Kamu adalah pegawai AI di platform PegawaiKu. Jawab dalam Bahasa Indonesia kecuali diminta lain.
Ikuti deskripsi peran di bawah ini secara ketat.
Kamu punya tool. Jika user menyebut bahan/materi/slide/PDF/dokumen/file yang mereka berikan, PANGGIL read_drive_file (tanpa argumen = daftar file; lalu baca filenya, lanjutkan dengan part 2,3,... bila panjang) — jangan minta user mengetik ulang. Pakai web_search/web_fetch untuk fakta terkini atau hal di luar pengetahuanmu; save_to_drive untuk hasil panjang; create_task bila user menyetujui rencana; learn_skill untuk menyimpan keahlian baru; image_generate/voice_generate bila diminta gambar/suara dan kuncinya tersedia.
Jika diminta sesuatu di luar keahlian utamamu, jangan menolak: pelajari dulu dari internet (cari, baca 2-3 sumber), simpan dengan learn_skill, lalu kerjakan. Sebutkan sumbernya.
Jangan mengklaim membuat gambar/video; kamu menghasilkan teks dan file teks.
Untuk dokumen panjang, simpan per bagian (save_to_drive mode "new" lalu "append"), jangan satu panggilan raksasa.
Jika kamu TIDAK punya tool untuk melakukan permintaan user (mis. menghapus file Drive), JANGAN hanya menolak: panggil request_capability agar admin bisa menyetujui kemampuan itu, lalu jelaskan ke user bahwa permintaan sudah diajukan dan cara alternatif sementara.
Aksi yang menghapus data (hapus file/tugas) wajib minta konfirmasi user dulu.
Jika setelah beberapa percobaan informasi tetap tidak ditemukan, BERHENTI memanggil tool dan jelaskan apa yang sudah dicoba, apa yang belum ditemukan, dan data apa yang dibutuhkan dari user.`;

const MAX_STEPS = 14;          // batas langkah tool per pesan
const TIME_BUDGET_MS = 240_000; // berhenti dengan rapi sebelum batas 300 dtk Vercel
const MAX_SAME_CALL = 2;        // panggilan tool identik berulang = indikasi looping
const MAX_TOOL_ERRORS = 3;      // tool gagal berturut-turut

/** Protokol stream: teks biasa = jawaban; baris "\u0001{json}\n" = event status; "\u0000{json}" = ringkasan akhir. */
function statusFrame(o: Record<string, unknown>) { return `\u0001${JSON.stringify(o)}\n`; }

function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "web_search": return `🔎 Mencari: ${input.query}`;
    case "web_fetch": return `📄 Membaca halaman: ${input.url}`;
    case "read_drive_file": return `📂 Membaca bahan: ${input.name ?? "daftar file"}${input.part && Number(input.part) > 1 ? ` (bagian ${input.part})` : ""}`;
    case "save_to_drive": return `💾 ${input.mode === "append" ? "Menambahkan ke" : "Menyimpan"}: ${input.filename}`;
    case "create_task": return `✅ Membuat tugas: ${input.title}`;
    case "learn_skill": return `🧠 Mempelajari: ${input.title}`;
    case "keyword_research": return `🔑 Riset keyword: ${input.keyword}`;
    case "image_generate": return "🖼 Membuat gambar";
    case "voice_generate": return "🔊 Membuat suara";
    case "landing_publish": return `🚀 Menerbitkan: /p/${input.slug}`;
    case "request_capability": return `🙋 Mengajukan kemampuan: ${input.title}`;
    case "delete_drive_file": return `🗑 Menghapus file: ${input.name}`;
    case "rename_drive_file": return `✏️ Ganti nama: ${input.name} → ${input.new_name}`;
    case "list_tasks": return "📋 Melihat tugas";
    case "update_task": return "📝 Mengubah tugas";
    case "delete_task": return "🗑 Menghapus tugas";
    case "update_project_info": return "🏷 Memperbarui info project";
    case "list_conversations": return "💬 Melihat percakapan lain";
    case "read_conversation": return "💬 Membaca percakapan lain";
    case "mikrotik_rest": return `📡 MikroTik ${input.method ?? "GET"} ${input.path}`;
    default:
      if (/^(ipr_vogel|esp_quick|srp_quick|oilfield_convert)$/.test(name)) return `🧮 Menghitung (${name})`;
      if (/^(subnet_calc|dns_lookup|http_check)$/.test(name)) return `🌐 Cek jaringan (${name})`;
      return `🛠 ${name}`;
  }
}

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

  const [{ data: org }, { data: keyRows }, { data: skillRows }, { data: knowledge }, { data: ptools }, { data: capRows }, { data: httpRows }] = await Promise.all([
    supabase.from("organizations").select("credit_balance,chat_model").eq("id", project.org_id).single(),
    supabase.from("org_api_keys").select("provider,secret").eq("org_id", project.org_id),
    supabase.from("agent_skills").select("skill:skills(key,name,instructions,requires_tools)").eq("org_id", project.org_id).eq("agent_id", agent.id),
    supabase.from("agent_knowledge").select("title,content").eq("org_id", project.org_id).eq("agent_id", agent.id).order("created_at", { ascending: false }).limit(8),
    supabase.from("project_tools").select("tool_key").eq("project_id", project.id),
    supabase.from("org_capabilities").select("capability_key").eq("org_id", project.org_id),
    supabase.from("capabilities").select("key,name,description,spec").eq("org_id", project.org_id).eq("kind", "http"),
  ]);
  // kemampuan yang disetujui admin (tabel bisa belum ada bila migrasi 0009 belum dijalankan → kosong)
  const enabledCaps = new Set((capRows ?? []).map((c) => c.capability_key as string));
  const httpCaps: Record<string, HttpSpec> = {};
  const httpDefs = (httpRows ?? []).filter((c) => enabledCaps.has(c.key) && c.spec).map((c) => { httpCaps[c.key] = c.spec as HttpSpec; return httpCapToolDef(c.key, c.name, c.description, c.spec as HttpSpec); });
  const capsReady = capRows !== null;
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
    capsReady ? `\n=== KEMAMPUAN YANG BISA DIMINTA (belum aktif) ===\n${Object.values(BUILTIN_CAP_DEFS).filter((d) => !enabledCaps.has(d.name)).map((d) => `- ${d.name}: ${d.description.split(".")[0]}`).join("\n") || "(semua sudah aktif)"}\nJika permintaan user butuh salah satu di atas, panggil request_capability dengan capability_key tersebut.` : "",
    (knowledge ?? []).length ? `\n=== PENGETAHUAN YANG SUDAH KAMU PELAJARI ===\n${(knowledge ?? []).map((k) => `## ${k.title}\n${k.content}`).join("\n\n")}` : "",
  ].join("\n");

  // Tool yang aktif: semua tool bawaan + yang diminta agent/skill; tool proyek (project_tools) sebagai whitelist tambahan
  const enabledKeys = new Set([
    "web_search", "web_fetch", "save_to_drive", "read_drive_file", "create_task", "learn_skill", "keyword_research",
    ...(ptools ?? []).map((t) => t.tool_key),
    ...(keys.google ? ["image_generate"] : []),
    ...(keys.elevenlabs ? ["voice_generate"] : []),
    ...(agent.requires_tools ?? []),
    ...(capsReady ? ["request_capability"] : []),
    ...[...enabledCaps].filter((k) => k in BUILTIN_CAP_DEFS),
  ]);
  const tools = [...Object.values(TOOL_DEFS).filter((t) => enabledKeys.has(t.name) && (!(t.name in BUILTIN_CAP_DEFS) || enabledCaps.has(t.name))), ...httpDefs];

  const ctx: ToolCtx = { supabase, orgId: project.org_id, projectId: project.id, agentId: agent.id, userId: user.id, conversationId, keys, enabledCaps, httpCaps };
  const messages: ChatMsg[] = sanitizeHistory((history ?? []).filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (t: string) => { if (!closed) { try { controller.enqueue(encoder.encode(t)); } catch { closed = true; } } };
      const status = (o: Record<string, unknown>) => emit(statusFrame({ ...o, elapsed: Math.round((Date.now() - t0) / 1000) }));
      const t0 = Date.now();
      let full = "";
      let inTok = 0, outTok = 0;
      let stopReason: "selesai" | "dihentikan" | "batas_waktu" | "batas_langkah" | "looping" | "tool_gagal" | "error" = "selesai";
      const seen = new Map<string, number>();
      let toolErrors = 0;
      let step = 0;
      try {
        for (step = 1; step <= MAX_STEPS; step++) {
          if (abort.signal.aborted) { stopReason = "dihentikan"; break; }
          if (Date.now() - t0 > TIME_BUDGET_MS) { stopReason = "batas_waktu"; break; }
          status({ type: "thinking", step, max: MAX_STEPS, label: step === 1 ? "Memahami permintaan…" : "Menyusun langkah berikutnya…" });
          const res = await llmStep({ provider: keyProvider, model, apiKey }, system, messages, tools, (t) => { full += t; emit(t); }, 16000, abort.signal);
          inTok += res.usage.input; outTok += res.usage.output;
          if (!res.toolCalls.length) {
            if (res.stopReason === "max_tokens") { const n = "\n\n_(Jawaban terpotong karena batas panjang — ketik \"lanjutkan\" untuk meneruskan.)_"; full += n; emit(n); }
            break;
          }
          messages.push({ role: "assistant_tool_calls", calls: res.toolCalls, text: res.text });
          const results: { id: string; name: string; output: string }[] = [];
          let loopHit = false;
          for (const call of res.toolCalls) {
            if (abort.signal.aborted) { results.push({ id: call.id, name: call.name, output: "Dihentikan pengguna." }); continue; }
            const label = toolLabel(call.name, call.input);
            status({ type: "tool", step, max: MAX_STEPS, label, tool: call.name });
            const line = `\n\n> _${label}_\n\n`;
            full += line; emit(line);
            // deteksi looping: panggilan identik
            const sig = call.name + ":" + JSON.stringify(call.input);
            const count = (seen.get(sig) ?? 0) + 1; seen.set(sig, count);
            let output: string;
            if (count > MAX_SAME_CALL) {
              loopHit = true;
              output = "DIHENTIKAN: panggilan ini sudah diulang tanpa hasil baru. Jangan panggil tool lagi; rangkum temuanmu sekarang.";
            } else if (res.stopReason === "max_tokens" && call.name === "save_to_drive") {
              output = "Gagal: isi terpotong karena terlalu panjang. Simpan ulang PER BAGIAN: bagian 1 mode 'new', bagian berikutnya mode 'append' dengan filename yang sama.";
            } else {
              output = await runTool(call.name, call.input, ctx);
            }
            const failed = /^(Gagal|DIHENTIKAN)/.test(output);
            toolErrors = failed ? toolErrors + 1 : 0;
            results.push({ id: call.id, name: call.name, output });
            supabase.from("tool_runs").insert({ conversation_id: conversationId, tool_key: call.name, input: call.input, output_preview: output.slice(0, 300), ok: !failed }).then(() => {}, () => {});
            if (failed) { const w = `> ⚠️ _${output.slice(0, 160)}_\n\n`; full += w; emit(w); }
          }
          messages.push({ role: "tool_results", results });
          if (abort.signal.aborted) { stopReason = "dihentikan"; break; }
          if (loopHit) { stopReason = "looping"; break; }
          if (toolErrors >= MAX_TOOL_ERRORS) { stopReason = "tool_gagal"; break; }
          if (step === MAX_STEPS) stopReason = "batas_langkah";
        }

        // Penutup terkendali: bila berhenti bukan karena selesai normal, minta agent merangkum TANPA tool
        if (stopReason !== "selesai" && stopReason !== "dihentikan" && !abort.signal.aborted) {
          const why = { batas_waktu: "waktu kerja habis", batas_langkah: "batas jumlah langkah tercapai", looping: "terdeteksi pengulangan tanpa kemajuan", tool_gagal: "beberapa tool gagal berturut-turut" }[stopReason as "batas_waktu"];
          status({ type: "wrapup", step, max: MAX_STEPS, label: `Merangkum hasil (${why})…` });
          const note = `\n\n---\n_⏸ Agent dihentikan otomatis: ${why}._\n\n`;
          full += note; emit(note);
          messages.push({ role: "user", content: `[SISTEM] Pekerjaan dihentikan karena ${why}. Jangan panggil tool. Tulis ringkasan singkat: (1) apa yang sudah berhasil dikerjakan/disimpan, (2) apa yang belum ditemukan atau gagal dan kemungkinan sebabnya, (3) apa yang dibutuhkan dari user untuk melanjutkan.` });
          try {
            const res = await llmStep({ provider: keyProvider, model, apiKey }, system, messages, [], (t) => { full += t; emit(t); }, 2000, abort.signal);
            inTok += res.usage.input; outTok += res.usage.output;
          } catch { /* abaikan */ }
        }
      } catch (e) {
        if (abort.signal.aborted || (e as Error)?.name === "AbortError" || /abort/i.test((e as Error)?.message ?? "")) {
          stopReason = "dihentikan";
        } else {
          stopReason = "error";
          const { message, detail } = describeError(e);
          await logEvent("error", "api:chat", message, { ...detail, conversationId, model: org.chat_model, provider: keyProvider, step }, project.org_id);
          const m = `\n\n[Gagal: ${message}]`; full += m; emit(m);
        }
      }

      // Simpan apa pun yang sudah dihasilkan (termasuk saat dihentikan) agar percakapan tetap utuh
      if (stopReason === "dihentikan") full += "\n\n_⏹ Dihentikan oleh pengguna._";
      if (stopReason !== "selesai") await logEvent(stopReason === "error" ? "error" : "warn", "api:chat", `agent berhenti: ${stopReason}`, { conversationId, step, ms: Date.now() - t0, agent: agent.display_name }, project.org_id);
      const cost = usesPlatformKey ? creditCost(inTok, outTok) : 0;
      try {
        if (full.trim()) {
          const { data: msg } = await supabase.from("messages").insert({ conversation_id: conversationId, role: "assistant", content: full, input_tokens: inTok, output_tokens: outTok, credit_cost: cost }).select("id").single();
          if (cost > 0) await supabase.rpc("apply_credit", { p_org: project.org_id, p_amount: -cost, p_kind: "usage", p_reference: msg?.id ?? null, p_note: `${agent.display_name}: ${inTok}+${outTok} token` });
        }
        await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
      } catch { /* abaikan */ }
      emit(statusFrame({ type: "done", reason: stopReason, step, elapsed: Math.round((Date.now() - t0) / 1000) }));
      emit(`\n\u0000${JSON.stringify({ cost, inTok, outTok, model: org.chat_model, reason: stopReason })}`);
      if (!closed) { try { controller.close(); } catch { /* sudah tertutup */ } }
    },
    cancel() { abort.abort(); },
  });

  return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
}
