import { NextResponse } from "next/server";
import { logEvent, describeError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { creditCost } from "@/lib/utils";
import { llmStep, splitModelId, sanitizeHistory, type ChatMsg } from "@/lib/llm";
import { TOOL_DEFS, runTool, type ToolCtx } from "@/lib/agent-tools";
import { BUILTIN_CAP_DEFS, httpCapToolDef, type HttpSpec } from "@/lib/capabilities";
import { parseMentions, shortName, type MentionAgent } from "@/lib/mentions";

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
const HARD_DEADLINE_MS = 280_000; // batas mutlak satu langkah LLM (sisakan waktu untuk menyimpan sebelum 300 dtk)
const TOOL_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

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

type FullAgent = MentionAgent & { system_prompt: string; requires_tools: string[] | null };
const AGENT_COLS = "id,slug,display_name,handle,title,avatar_url,system_prompt,requires_tools";
const MAX_RESPONDERS = 3;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { conversationId, content } = (await req.json()) as { conversationId: string; content: string };
  if (!conversationId || !content?.trim()) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const { data: conv } = await supabase
    .from("conversations")
    .select(`id,project_id,title,agent_id,agent:agents(${AGENT_COLS}),project:projects(id,org_id,name,tagline,description,brand,category,website)`)
    .eq("id", conversationId)
    .single();
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });
  const ownerRaw = conv.agent as unknown as FullAgent | null;
  if (!ownerRaw) return NextResponse.json({ error: "Agent pemilik percakapan ini sudah tidak aktif." }, { status: 410 });
  const ownerAgent: FullAgent = ownerRaw;
  const project = conv.project as unknown as { id: string; org_id: string; name: string; tagline: string | null; description: string | null; brand: Record<string, unknown>; category: string | null; website: string | null };

  const [{ data: org }, { data: keyRows }, { data: ptools }, { data: capRows }, { data: httpRows }, partRes, { data: hiredRows }, { data: allAgents }] = await Promise.all([
    supabase.from("organizations").select("credit_balance,chat_model").eq("id", project.org_id).single(),
    supabase.from("org_api_keys").select("provider,secret").eq("org_id", project.org_id),
    supabase.from("project_tools").select("tool_key").eq("project_id", project.id),
    supabase.from("org_capabilities").select("capability_key").eq("org_id", project.org_id),
    supabase.from("capabilities").select("key,name,description,spec").eq("org_id", project.org_id).eq("kind", "http"),
    supabase.from("conversation_agents").select("agent_id").eq("conversation_id", conversationId),
    supabase.from("project_agents").select("agent_id").eq("project_id", project.id),
    supabase.from("agents").select("id,slug,display_name,handle,title,avatar_url").eq("is_active", true),
  ]);
  if (!org) return NextResponse.json({ error: "org tidak ditemukan" }, { status: 404 });
  const multiReady = !partRes.error; // migrasi 0011 sudah dijalankan

  const keys: Record<string, string> = Object.fromEntries((keyRows ?? []).map((k) => [k.provider, k.secret]));
  const { keyProvider, model } = splitModelId(org.chat_model || "anthropic/claude-sonnet-5-5");
  const apiKey = keys[keyProvider] ?? (keyProvider === "anthropic" ? process.env.ANTHROPIC_API_KEY : undefined);
  if (!apiKey) return NextResponse.json({ error: `Kunci API ${keyProvider} belum diatur (Pengaturan → Kunci API), atau ganti model chat di Pengaturan → Model AI.` }, { status: 400 });
  const usesPlatformKey = keyProvider === "anthropic" && !keys.anthropic;
  if (usesPlatformKey && Number(org.credit_balance) <= 0) {
    return NextResponse.json({ error: "Kredit habis. Top up di menu Billing, atau pasang kunci API sendiri (gratis: Groq/Gemini) di Pengaturan." }, { status: 402 });
  }

  // kemampuan yang disetujui admin (tabel bisa belum ada bila migrasi 0009 belum dijalankan → kosong)
  const enabledCaps = new Set((capRows ?? []).map((c) => c.capability_key as string));
  const httpCaps: Record<string, HttpSpec> = {};
  const httpDefs = (httpRows ?? []).filter((c) => enabledCaps.has(c.key) && c.spec).map((c) => { httpCaps[c.key] = c.spec as HttpSpec; return httpCapToolDef(c.key, c.name, c.description, c.spec as HttpSpec); });
  const capsReady = capRows !== null;

  // ---- Peserta & penentuan agent yang menjawab ----
  const participantIds = new Set<string>([ownerAgent.id, ...((partRes.data ?? []).map((r) => r.agent_id as string))]);
  const hiredIds = new Set((hiredRows ?? []).map((r) => r.agent_id as string));
  const pool = ((allAgents ?? []) as MentionAgent[]).sort((a, b) => rank(a) - rank(b));
  function rank(a: MentionAgent) { return participantIds.has(a.id) ? 0 : hiredIds.has(a.id) ? 1 : 2; }
  const mentioned = parseMentions(content, pool, MAX_RESPONDERS);

  // simpan pesan user
  await supabase.from("messages").insert({ conversation_id: conversationId, role: "user", content });
  if (conv.title === "Percakapan baru") await supabase.from("conversations").update({ title: content.slice(0, 60) }).eq("id", conversationId);

  // riwayat (dengan agent_id bila kolom sudah ada)
  type HistRow = { role: string; content: string; agent_id?: string | null };
  let history: HistRow[] = [];
  {
    const r = await supabase.from("messages").select("role,content,agent_id").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(40);
    if (!r.error) history = (r.data ?? []).reverse();
    else { const r2 = await supabase.from("messages").select("role,content").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(40); history = (r2.data ?? []).reverse(); }
  }

  let responderIds: string[] = mentioned.map((a) => a.id);
  if (!responderIds.length) {
    const lastAgent = [...history].reverse().find((m) => m.role === "assistant" && m.agent_id)?.agent_id;
    responderIds = [lastAgent && participantIds.has(lastAgent) ? lastAgent : ownerAgent.id];
  }
  if (!multiReady) responderIds = [ownerAgent.id]; // tanpa migrasi 0011: perilaku lama

  // agent yang di-mention otomatis jadi peserta (dan direkrut ke project bila belum)
  for (const id of responderIds) {
    if (!participantIds.has(id)) {
      participantIds.add(id);
      await supabase.from("conversation_agents").upsert({ conversation_id: conversationId, agent_id: id, added_by: user.id }, { onConflict: "conversation_id,agent_id" });
    }
    if (!hiredIds.has(id)) await supabase.from("project_agents").upsert({ project_id: project.id, agent_id: id, hired_by: user.id }, { onConflict: "project_id,agent_id" });
  }

  const { data: fullRows } = await supabase.from("agents").select(AGENT_COLS).in("id", responderIds);
  const responders = responderIds.map((id) => (fullRows ?? []).find((a) => a.id === id) as FullAgent | undefined).filter(Boolean) as FullAgent[];
  if (!responders.length) responders.push(ownerAgent);
  const nameOf = (id: string | null | undefined) => (pool.find((a) => a.id === (id || ownerAgent.id))?.display_name ?? ownerAgent.display_name);
  const participantsTxt = [...participantIds].map((id) => { const a = pool.find((x) => x.id === id); return a ? `${a.display_name} (@${shortName(a.display_name)}, ${a.title ?? ""})` : null; }).filter(Boolean).join("; ");

  const brandCtx = [project.tagline && `Tagline: ${project.tagline}`, project.description && `Deskripsi: ${project.description}`, project.category && `Kategori: ${project.category}`, project.website && `Website: ${project.website}`, Object.keys(project.brand ?? {}).length ? `Brand: ${JSON.stringify(project.brand)}` : ""].filter(Boolean).join("\n");

  async function buildFor(agent: FullAgent) {
    const [{ data: skillRows }, { data: knowledge }] = await Promise.all([
      supabase.from("agent_skills").select("skill:skills(key,name,instructions,requires_tools)").eq("org_id", project.org_id).eq("agent_id", agent.id),
      supabase.from("agent_knowledge").select("title,content").eq("org_id", project.org_id).eq("agent_id", agent.id).order("created_at", { ascending: false }).limit(8),
    ]);
    type SkillRow = { skill: { key: string; name: string; instructions: string; requires_tools: string[] } };
    const skills = ((skillRows ?? []) as unknown as SkillRow[]).map((s) => s.skill).filter(Boolean);
    const collab = participantIds.size > 1
      ? `\n=== KOLABORASI ===\nPercakapan ini melibatkan beberapa pegawai AI: ${participantsTxt}. Kamu adalah ${agent.display_name}. Pesan dari agent lain ditandai [Nama]. Kerjakan bagian sesuai peranmu, manfaatkan hasil agent lain bila relevan, jangan menulis atas nama agent lain. Bila bagian tertentu lebih cocok untuk agent lain, sarankan user memanggilnya dengan @nama.`
      : "";
    const system = [
      BASE_SYSTEM,
      `\nProject aktif: ${project.name}${brandCtx ? `\n${brandCtx}` : ""}`,
      `\n=== PERAN: ${agent.display_name} ===\n${agent.system_prompt}`,
      collab,
      skills.length ? `\n=== SKILL TAMBAHAN ===\n${skills.map((s) => `## ${s.name}\n${s.instructions}`).join("\n\n")}` : "",
      capsReady ? `\n=== KEMAMPUAN YANG BISA DIMINTA (belum aktif) ===\n${Object.values(BUILTIN_CAP_DEFS).filter((d) => !enabledCaps.has(d.name)).map((d) => `- ${d.name}: ${d.description.split(".")[0]}`).join("\n") || "(semua sudah aktif)"}\nJika permintaan user butuh salah satu di atas, panggil request_capability dengan capability_key tersebut.` : "",
      (knowledge ?? []).length ? `\n=== PENGETAHUAN YANG SUDAH KAMU PELAJARI ===\n${(knowledge ?? []).map((k) => `## ${k.title}\n${k.content}`).join("\n\n")}` : "",
    ].join("\n");
    const enabledKeys = new Set([
      "web_search", "web_fetch", "save_to_drive", "read_drive_file", "create_task", "learn_skill", "keyword_research",
      ...(ptools ?? []).map((t) => t.tool_key),
      ...(keys.google ? ["image_generate"] : []),
      ...(keys.elevenlabs ? ["voice_generate"] : []),
      ...(agent.requires_tools ?? []),
      ...skills.flatMap((s) => s.requires_tools ?? []),
      ...(capsReady ? ["request_capability"] : []),
      ...[...enabledCaps].filter((k) => k in BUILTIN_CAP_DEFS),
    ]);
    const tools = [...Object.values(TOOL_DEFS).filter((t) => enabledKeys.has(t.name) && (!(t.name in BUILTIN_CAP_DEFS) || enabledCaps.has(t.name))), ...httpDefs];
    // riwayat dari sudut pandang agent ini: balasan agent lain menjadi pesan bertanda [Nama]
    const msgs: ChatMsg[] = sanitizeHistory(history.filter((m) => m.role !== "system").map((m) => {
      if (m.role === "assistant") {
        const who = m.agent_id || ownerAgent.id;
        if (who !== agent.id) return { role: "user" as const, content: `[${nameOf(who)}]\n${m.content}` };
        return { role: "assistant" as const, content: m.content };
      }
      return { role: "user" as const, content: m.content };
    }));
    return { system, tools, msgs };
  }

  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (t: string) => { if (!closed) { try { controller.enqueue(encoder.encode(t)); } catch { closed = true; } } };
      const t0 = Date.now();
      const status = (o: Record<string, unknown>) => emit(statusFrame({ ...o, elapsed: Math.round((Date.now() - t0) / 1000) }));
      let totalCost = 0, totalIn = 0, totalOut = 0;
      type Reason = "selesai" | "dihentikan" | "batas_waktu" | "batas_langkah" | "looping" | "tool_gagal" | "error";
      let lastReason: Reason = "selesai";

      for (let ri = 0; ri < responders.length; ri++) {
        const agent = responders[ri];
        if (abort.signal.aborted) { lastReason = "dihentikan"; break; }
        if (Date.now() - t0 > TIME_BUDGET_MS) { lastReason = "batas_waktu"; break; }
        status({ type: "agent", agent: { id: agent.id, name: agent.display_name, avatar: agent.avatar_url, slug: agent.slug }, index: ri, total: responders.length });
        const { system, tools, msgs: messages } = await buildFor(agent);
        const ctx: ToolCtx = { supabase, orgId: project.org_id, projectId: project.id, agentId: agent.id, userId: user!.id, conversationId, keys, enabledCaps, httpCaps };
        let full = "";
        let inTok = 0, outTok = 0;
        let stopReason: Reason = "selesai";
        const seen = new Map<string, number>();
        let toolErrors = 0;
        let step = 0;
        try {
          for (step = 1; step <= MAX_STEPS; step++) {
            if (abort.signal.aborted) { stopReason = "dihentikan"; break; }
            if (Date.now() - t0 > TIME_BUDGET_MS) { stopReason = "batas_waktu"; break; }
            status({ type: "thinking", step, max: MAX_STEPS, agent: agent.display_name, label: step === 1 ? `${agent.display_name} memahami permintaan…` : `${agent.display_name} menyusun langkah berikutnya…` });
            const deadline = AbortSignal.any([abort.signal, AbortSignal.timeout(Math.max(5_000, HARD_DEADLINE_MS - (Date.now() - t0)))]);
            const res = await llmStep({ provider: keyProvider, model, apiKey }, system, messages, tools, (t) => { full += t; emit(t); }, 16000, deadline);
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
              status({ type: "tool", step, max: MAX_STEPS, label: `${agent.display_name}: ${label}`, tool: call.name });
              const line = `\n\n> _${label}_\n\n`;
              full += line; emit(line);
              const sig = call.name + ":" + JSON.stringify(call.input);
              const count = (seen.get(sig) ?? 0) + 1; seen.set(sig, count);
              let output: string;
              if (count > MAX_SAME_CALL) {
                loopHit = true;
                output = "DIHENTIKAN: panggilan ini sudah diulang tanpa hasil baru. Jangan panggil tool lagi; rangkum temuanmu sekarang.";
              } else if (res.stopReason === "max_tokens" && call.name === "save_to_drive") {
                output = "Gagal: isi terpotong karena terlalu panjang. Simpan ulang PER BAGIAN: bagian 1 mode 'new', bagian berikutnya mode 'append' dengan filename yang sama.";
              } else {
                output = await withTimeout(runTool(call.name, call.input, ctx), Math.min(TOOL_TIMEOUT_MS, Math.max(5_000, HARD_DEADLINE_MS - (Date.now() - t0))), `Gagal: ${call.name} tidak merespons dalam batas waktu.`);
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

          if (stopReason !== "selesai" && stopReason !== "dihentikan" && !abort.signal.aborted) {
            const why = { batas_waktu: "waktu kerja habis", batas_langkah: "batas jumlah langkah tercapai", looping: "terdeteksi pengulangan tanpa kemajuan", tool_gagal: "beberapa tool gagal berturut-turut" }[stopReason as "batas_waktu"];
            status({ type: "wrapup", step, max: MAX_STEPS, label: `${agent.display_name} merangkum hasil (${why})…` });
            const note = `\n\n---\n_⏸ ${agent.display_name} dihentikan otomatis: ${why}._\n\n`;
            full += note; emit(note);
            messages.push({ role: "user", content: `[SISTEM] Pekerjaan dihentikan karena ${why}. Jangan panggil tool. Tulis ringkasan singkat: (1) apa yang sudah berhasil dikerjakan/disimpan, (2) apa yang belum ditemukan atau gagal dan kemungkinan sebabnya, (3) apa yang dibutuhkan dari user untuk melanjutkan.` });
            try {
              const res = await llmStep({ provider: keyProvider, model, apiKey }, system, messages, [], (t) => { full += t; emit(t); }, 2000, AbortSignal.any([abort.signal, AbortSignal.timeout(Math.max(3_000, HARD_DEADLINE_MS - (Date.now() - t0)))]));
              inTok += res.usage.input; outTok += res.usage.output;
            } catch { /* abaikan */ }
          }
        } catch (e) {
          if (abort.signal.aborted) {
            stopReason = "dihentikan";
          } else if ((e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError" || /abort|timeout/i.test((e as Error)?.message ?? "")) {
            stopReason = "batas_waktu"; // tenggat langkah habis — hasil sejauh ini tetap disimpan
            const m = "\n\n---\n_⏸ Dihentikan otomatis: waktu kerja habis. Ketik \"lanjutkan\" untuk meneruskan._"; full += m; emit(m);
          } else {
            stopReason = "error";
            const { message, detail } = describeError(e);
            await logEvent("error", "api:chat", message, { ...detail, conversationId, model: org.chat_model, provider: keyProvider, step, agent: agent.display_name }, project.org_id);
            const m = `\n\n[Gagal: ${message}]`; full += m; emit(m);
          }
        }

        if (stopReason === "dihentikan") full += "\n\n_⏹ Dihentikan oleh pengguna._";
        if (stopReason !== "selesai") await logEvent(stopReason === "error" ? "error" : "warn", "api:chat", `agent berhenti: ${stopReason}`, { conversationId, step, ms: Date.now() - t0, agent: agent.display_name }, project.org_id);
        const cost = usesPlatformKey ? creditCost(inTok, outTok) : 0;
        totalCost += cost; totalIn += inTok; totalOut += outTok;
        try {
          if (full.trim()) {
            const row: Record<string, unknown> = { conversation_id: conversationId, role: "assistant", content: full, input_tokens: inTok, output_tokens: outTok, credit_cost: cost };
            let ins = await supabase.from("messages").insert(multiReady ? { ...row, agent_id: agent.id } : row).select("id").single();
            if (ins.error && multiReady) ins = await supabase.from("messages").insert(row).select("id").single();
            if (cost > 0) await supabase.rpc("apply_credit", { p_org: project.org_id, p_amount: -cost, p_kind: "usage", p_reference: ins.data?.id ?? null, p_note: `${agent.display_name}: ${inTok}+${outTok} token` });
            history.push({ role: "assistant", content: full, agent_id: agent.id }); // agent berikutnya melihat jawaban ini
          }
        } catch { /* abaikan */ }
        lastReason = stopReason;
        emit(statusFrame({ type: "agent_done", agent: agent.display_name, reason: stopReason }));
        if (stopReason === "dihentikan" || stopReason === "error") break;
      }

      try { await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId); } catch { /* abaikan */ }
      emit(statusFrame({ type: "done", reason: lastReason, elapsed: Math.round((Date.now() - t0) / 1000) }));
      emit(`\n\u0000${JSON.stringify({ cost: totalCost, inTok: totalIn, outTok: totalOut, model: org.chat_model, reason: lastReason })}`);
      if (!closed) { try { controller.close(); } catch { /* sudah tertutup */ } }
    },
    cancel() { abort.abort(); },
  });

  return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
}
