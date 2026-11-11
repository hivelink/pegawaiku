import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolDef } from "./llm";
import { extractText } from "./extract";
import { DOMAIN_TOOL_DEFS, runDomainTool } from "./domain-tools";
import { BUILTIN_CAP_DEFS, ALWAYS_ON_CAPS, REQUEST_CAPABILITY_DEF, runBuiltinCap, runHttpCap, validateHttpSpec, type HttpSpec } from "./capabilities";
import { CREATIVE_TOOL_DEFS, runCreativeTool } from "./creative-tools";
import { ASSISTANT_TOOL_DEFS, runAssistantTool } from "./assistant-tools";
import { putToDrive } from "./drive-util";

/**
 * Tool yang bisa dipanggil pegawai AI saat bekerja.
 * Pencarian web: Tavily (jika kunci ada) → fallback gratis Jina Search. Baca halaman: Jina Reader (gratis).
 */

export type ToolCtx = {
  supabase: SupabaseClient;
  orgId: string;
  projectId: string;
  agentId: string;
  userId: string;
  conversationId: string;
  keys: Record<string, string>; // provider -> secret
  httpCaps?: Record<string, HttpSpec>; // kemampuan HTTP yang disetujui admin
  enabledCaps?: Set<string>;           // kemampuan builtin yang aktif untuk org
};

export const TOOL_DEFS: Record<string, ToolDef> = {
  ...DOMAIN_TOOL_DEFS,
  ...BUILTIN_CAP_DEFS,
  ...CREATIVE_TOOL_DEFS,
  ...ASSISTANT_TOOL_DEFS,
  request_capability: REQUEST_CAPABILITY_DEF,
  web_search: {
    name: "web_search",
    description: "Cari informasi terkini di internet. Kembalikan daftar hasil (judul, url, cuplikan). Gunakan kueri spesifik, boleh bahasa Indonesia atau Inggris.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Kata kunci pencarian" }, max_results: { type: "integer", description: "Jumlah hasil (1-8)", default: 5 } }, required: ["query"] },
  },
  web_fetch: {
    name: "web_fetch",
    description: "Buka sebuah URL dan ambil isi teks utamanya (artikel, dokumentasi, halaman produk). Maks ~12.000 karakter.",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  save_to_drive: {
    name: "save_to_drive",
    description: "Simpan teks (markdown/txt/html/csv) ke Drive project. Mode: 'new' = file baru; 'replace' = TIMPA isi file bernama sama (untuk revisi — tetap satu versi terkini); 'append' = tambahkan ke akhir file. Untuk dokumen panjang simpan per bagian: bagian 1 'new' (atau 'replace' bila merevisi), bagian berikutnya 'append'. Maks ±6.000 kata per panggilan.",
    input_schema: { type: "object", properties: { filename: { type: "string", description: "Nama file dengan ekstensi, mis. bab-2.md" }, content: { type: "string" }, mode: { type: "string", enum: ["new", "replace", "append"], default: "new", description: "new = file baru; replace = timpa file bernama sama; append = tambahkan ke akhir file bernama sama" } }, required: ["filename", "content"] },
  },
  merge_drive_files: {
    name: "merge_drive_files",
    description: "Gabungkan beberapa file teks di Drive (md/txt/html/csv) menjadi satu file, berurutan sesuai daftar. Opsional menghapus file sumber setelah digabung (hanya bila user sudah setuju).",
    input_schema: { type: "object", properties: { sources: { type: "array", items: { type: "string" }, description: "Nama file sumber, berurutan" }, target: { type: "string", description: "Nama file hasil, mis. glosarium-lengkap.md" }, separator: { type: "string", description: "Pemisah antar file, default baris kosong + ---" }, delete_sources: { type: "boolean", description: "Hapus file sumber setelah berhasil digabung (butuh kemampuan Hapus file Drive + persetujuan user)" }, confirmed: { type: "boolean", description: "true hanya bila user sudah menyetujui penghapusan file sumber" } }, required: ["sources", "target"] },
  },
  view_image: {
    name: "view_image",
    description: "Lihat gambar dari Drive project (png/jpg/webp/gif, maks ±3,5 MB) agar kamu bisa memeriksa isinya: hasil render, ilustrasi, grafik, foto, screenshot. Tanpa argumen: daftar gambar.",
    input_schema: { type: "object", properties: { name: { type: "string", description: "Nama file gambar (sebagian boleh)" } } },
  },
  ask_user: {
    name: "ask_user",
    description: "Minta KEPUTUSAN user dengan tombol pilihan yang bisa diklik di chat (2-4 opsi). Pakai bila ada hal yang menunggu persetujuan/keputusan user (todo untuk user, pilihan arah, persetujuan rencana/anggaran, revisi mana yang dipakai). Tulis konsekuensi tiap opsi secara singkat. Setelah memanggil ini, giliranmu selesai — tunggu jawaban user.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Pertanyaan/keputusan yang diminta, singkat & jelas" },
        options: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", properties: { label: { type: "string", description: "Teks tombol (≤ 40 karakter)" }, consequence: { type: "string", description: "Dampak/konsekuensi bila opsi ini dipilih (1 kalimat)" } }, required: ["label"] } },
        allow_other: { type: "boolean", description: "Tampilkan opsi 'Lainnya' agar user bisa mengetik jawaban sendiri (default true)" },
      },
      required: ["question", "options"],
    },
  },
  delegate_agent: {
    name: "delegate_agent",
    description: "Delegasikan pekerjaan ke pegawai AI lain (mis. Maya, Yusuf, Bayu). Agent tujuan langsung bekerja dengan brief-mu, jawabannya tampil di chat dan dikembalikan kepadamu sebagai hasil tool, lalu kamu bisa melanjutkan (mis. mendelegasikan langkah berikutnya). Tulis brief yang lengkap: tujuan, konteks, file Drive yang dipakai, format & nama file hasil.",
    input_schema: { type: "object", properties: { agent: { type: "string", description: "Nama agent, mis. maya atau @yusuf" }, brief: { type: "string", description: "Instruksi lengkap untuk agent tujuan" } }, required: ["agent", "brief"] },
  },
  read_drive_file: {
    name: "read_drive_file",
    description: "Baca isi dokumen dari Drive project: PDF, Word (docx), PowerPoint (pptx, per slide + catatan), Excel/CSV, teks/markdown/html. Tanpa argumen: daftar file. Dokumen panjang dibagi per bagian 12.000 karakter — gunakan `part` untuk melanjutkan.",
    input_schema: { type: "object", properties: { name: { type: "string", description: "Nama file (sebagian boleh) atau kosong untuk daftar" }, part: { type: "integer", description: "Bagian ke-n (mulai 1) untuk dokumen panjang", default: 1 } } },
  },
  keyword_research: {
    name: "keyword_research",
    description: "Ide keyword terkait dari saran pencarian Google (gratis) dan, jika kunci SerpApi tersedia, hasil SERP teratas + pertanyaan terkait. Untuk SEO/iklan.",
    input_schema: { type: "object", properties: { keyword: { type: "string" }, country: { type: "string", description: "Kode negara, default id" } }, required: ["keyword"] },
  },
  voice_generate: {
    name: "voice_generate",
    description: "Ubah teks menjadi suara (voice-over) memakai ElevenLabs (butuh kunci elevenlabs). Hasil mp3 disimpan ke Drive.",
    input_schema: { type: "object", properties: { text: { type: "string" }, voice: { type: "string", description: "ID suara ElevenLabs; kosong = suara default multibahasa" }, filename: { type: "string" } }, required: ["text"] },
  },
  image_generate: {
    name: "image_generate",
    description: "Buat gambar dari prompt (Gemini Nano Banana; butuh kunci google) dan simpan ke Drive. Prompt bahasa Inggris, deskriptif.",
    input_schema: { type: "object", properties: { prompt: { type: "string" }, filename: { type: "string" } }, required: ["prompt"] },
  },
  landing_publish: {
    name: "landing_publish",
    description: "Publikasikan file landing page (.html di Drive) ke URL publik /p/<slug>. Hanya setelah user menyetujui pratinjau.",
    input_schema: { type: "object", properties: { filename: { type: "string", description: "Nama file .html di Drive" }, slug: { type: "string", description: "slug URL, huruf kecil-angka-tanda hubung" } }, required: ["filename", "slug"] },
  },
  create_task: {
    name: "create_task",
    description: "Buat kartu tugas di board project. Pakai setelah rencana disetujui user.",
    input_schema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, status: { type: "string", enum: ["todo", "in_progress", "review", "done", "blocked"] } }, required: ["title"] },
  },
  learn_skill: {
    name: "learn_skill",
    description: "Simpan pengetahuan/keahlian baru yang baru dipelajari dari internet agar bisa dipakai di percakapan berikutnya. Isi: panduan praktis (langkah, aturan, contoh) 300-800 kata.",
    input_schema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, sources: { type: "array", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } } } } }, required: ["title", "content"] },
  },
};

function clip(s: string, n: number) { return s.length > n ? s.slice(0, n) + "\n…[dipotong]" : s; }

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  try {
    switch (name) {
      case "web_search": return await webSearch(String(input.query ?? ""), Number(input.max_results ?? 5), ctx);
      case "web_fetch": return await webFetch(String(input.url ?? ""), ctx);
      case "save_to_drive": return await saveToDrive(String(input.filename ?? "hasil.md"), String(input.content ?? ""), ctx, String(input.mode ?? "new"));
      case "merge_drive_files": return await mergeDriveFiles(input, ctx);
      case "read_drive_file": return await readDriveFile(input.name ? String(input.name) : "", Number(input.part ?? 1), ctx);
      case "keyword_research": return await keywordResearch(String(input.keyword ?? ""), String(input.country ?? "id"), ctx);
      case "voice_generate": return await voiceGenerate(input, ctx);
      case "image_generate": return await imageGenerate(input, ctx);
      case "landing_publish": return await landingPublish(String(input.filename ?? ""), String(input.slug ?? ""), ctx);
      case "create_task": return await createTask(input, ctx);
      case "learn_skill": return await learnSkill(input, ctx);
      case "request_capability": return await requestCapability(input, ctx);
      default: {
        if (name in BUILTIN_CAP_DEFS) {
          if (!ALWAYS_ON_CAPS.has(name) && !ctx.enabledCaps?.has(name)) return `Gagal: kemampuan ${name} belum diaktifkan admin. Ajukan dengan request_capability.`;
          return (await runBuiltinCap(name, input, ctx)) ?? `Tool ${name} tidak dikenal.`;
        }
        if (ctx.httpCaps?.[name]) return await runHttpCap(ctx.httpCaps[name], input, ctx.keys);
        const r = (await runCreativeTool(name, input, ctx)) ?? (await runAssistantTool(name, input, ctx)) ?? (await runDomainTool(name, input, ctx.keys));
        return r ?? `Tool ${name} tidak dikenal.`;
      }
    }
  } catch (e) {
    return `Gagal menjalankan ${name}: ${(e as Error).message}`;
  }
}

async function webSearch(query: string, n: number, ctx: ToolCtx): Promise<string> {
  if (!query) return "Kueri kosong.";
  const max = Math.max(1, Math.min(8, n || 5));
  if (ctx.keys.tavily) {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: ctx.keys.tavily, query, max_results: max, include_answer: true }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail?.error ?? j.error ?? `Tavily HTTP ${r.status}`);
    const lines = (j.results ?? []).map((x: { title: string; url: string; content: string }, i: number) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${clip(x.content ?? "", 300)}`);
    return `${j.answer ? `Ringkasan: ${j.answer}\n\n` : ""}Hasil untuk "${query}":\n${lines.join("\n")}`;
  }
  // Fallback gratis tanpa kunci: Jina Search (dibatasi laju)
  const r = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, { headers: { Accept: "application/json", "X-Respond-With": "no-content" } });
  if (!r.ok) throw new Error(`Pencarian gratis gagal (HTTP ${r.status}). Tambahkan kunci Tavily di Pengaturan → Kunci API untuk pencarian yang stabil.`);
  const j = await r.json();
  const items = (j.data ?? []).slice(0, max) as { title: string; url: string; description?: string }[];
  if (!items.length) return `Tidak ada hasil untuk "${query}".`;
  return `Hasil untuk "${query}":\n${items.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${clip(x.description ?? "", 300)}`).join("\n")}`;
}

async function webFetch(url: string, _ctx: ToolCtx): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return "URL harus diawali http(s)://";
  const r = await fetch(`https://r.jina.ai/${url}`, { headers: { Accept: "text/plain", "X-Return-Format": "markdown" } });
  if (!r.ok) throw new Error(`Tidak bisa membuka halaman (HTTP ${r.status})`);
  const t = await r.text();
  return clip(t, 12000);
}

async function saveToDrive(filename: string, content: string, ctx: ToolCtx, mode = "new"): Promise<string> {
  if (!content.trim()) return "Isi kosong — tidak ada yang disimpan. Jika isinya panjang, kirim per bagian (mode append).";
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ext = (safe.split(".").pop() || "md").toLowerCase();
  const mime = ext === "html" ? "text/html" : ext === "csv" ? "text/csv" : ext === "json" ? "application/json" : ext === "txt" ? "text/plain" : "text/markdown";
  if (mode === "replace" || mode === "new") {
    const { data: prev } = await ctx.supabase.from("files").select("id,storage_path").eq("project_id", ctx.projectId).eq("title", safe).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (prev && mode === "new") return `Gagal: file "${safe}" sudah ada. Untuk merevisi pakai mode "replace" (menimpa, tetap satu versi), atau pakai nama lain bila memang file berbeda.`;
    if (prev && mode === "replace") {
      const bytes = Buffer.from(content, "utf8");
      const { error: upErr } = await ctx.supabase.storage.from("drive").upload(prev.storage_path, bytes, { contentType: mime, upsert: true });
      if (upErr) throw new Error(upErr.message);
      await ctx.supabase.from("files").update({ size_bytes: bytes.length, mime_type: mime }).eq("id", prev.id);
      return `File "${safe}" ditimpa dengan versi baru (${bytes.length} byte).`;
    }
  }
  if (mode === "append") {
    const { data: prev } = await ctx.supabase.from("files").select("id,storage_path,size_bytes").eq("project_id", ctx.projectId).eq("title", safe).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (prev) {
      const { data: dl, error: dErr } = await ctx.supabase.storage.from("drive").download(prev.storage_path);
      if (dErr || !dl) throw new Error(dErr?.message ?? "gagal membaca file lama");
      const merged = Buffer.from((await dl.text()) + "\n\n" + content, "utf8");
      const { error: upErr } = await ctx.supabase.storage.from("drive").upload(prev.storage_path, merged, { contentType: mime, upsert: true });
      if (upErr) throw new Error(upErr.message);
      await ctx.supabase.from("files").update({ size_bytes: merged.length }).eq("id", prev.id);
      return `Ditambahkan ke "${safe}" (total ${Math.round(merged.length / 1024)} KB).`;
    }
  }
  const path = `${ctx.projectId}/${Date.now()}-${safe}`;
  const bytes = Buffer.from(content, "utf8");
  const { error: upErr } = await ctx.supabase.storage.from("drive").upload(path, bytes, { contentType: mime });
  if (upErr) throw new Error(upErr.message);
  const { error } = await ctx.supabase.from("files").insert({ project_id: ctx.projectId, owner_id: ctx.userId, title: safe, storage_path: path, mime_type: mime, size_bytes: bytes.length, kind: "text" });
  if (error) throw new Error(error.message);
  return `Tersimpan di Drive project sebagai "${safe}" (${bytes.length} byte).`;
}

async function readDriveFile(name: string, part: number, ctx: ToolCtx): Promise<string> {
  const { data: files } = await ctx.supabase.from("files").select("id,title,storage_path,mime_type,size_bytes").eq("project_id", ctx.projectId).order("created_at", { ascending: false }).limit(100);
  if (!files?.length) return "Drive project kosong. Minta user mengunggah bahan lewat menu Drive atau tombol lampiran di chat.";
  if (!name) return `File di Drive project:\n${files.map((f) => `- ${f.title} (${f.mime_type ?? "?"}, ${Math.round((f.size_bytes ?? 0) / 1024)} KB)`).join("\n")}`;
  const q = name.toLowerCase();
  const f = files.find((x) => x.title.toLowerCase() === q) ?? files.find((x) => x.title.toLowerCase().includes(q)) ?? files.find((x) => x.id === name);
  if (!f) return `File "${name}" tidak ditemukan. Tersedia: ${files.map((x) => x.title).join(", ")}`;
  const { data, error } = await ctx.supabase.storage.from("drive").download(f.storage_path);
  if (error || !data) throw new Error(error?.message ?? "gagal unduh");
  const buf = Buffer.from(await data.arrayBuffer());
  const ex = await extractText(buf, f.mime_type ?? "", f.title);
  if (!ex.text) return ex.note ?? `File "${f.title}" tidak berisi teks yang bisa dibaca.`;
  const SIZE = 12000;
  const total = Math.max(1, Math.ceil(ex.text.length / SIZE));
  const p = Math.min(Math.max(1, part || 1), total);
  const chunk = ex.text.slice((p - 1) * SIZE, p * SIZE);
  const head = `[${f.title}${ex.pages ? ` · ${ex.pages} halaman/slide` : ""} · bagian ${p}/${total}${ex.note ? ` · ${ex.note}` : ""}]`;
  return `${head}\n\n${chunk}${p < total ? `\n\n…[lanjutan ada di part ${p + 1}]` : ""}`;
}

async function keywordResearch(keyword: string, country: string, ctx: ToolCtx): Promise<string> {
  if (!keyword) return "Keyword kosong.";
  const out: string[] = [];
  // Gratis: Google Suggest (autocomplete)
  try {
    const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=${country}&gl=${country}&q=${encodeURIComponent(keyword)}`);
    const j = (await r.json()) as [string, string[]];
    const sug = (j?.[1] ?? []).slice(0, 10);
    if (sug.length) out.push(`Saran pencarian Google untuk "${keyword}":\n${sug.map((x) => `- ${x}`).join("\n")}`);
    // variasi huruf awal untuk memperluas
    const extra: string[] = [];
    for (const suf of ["cara", "harga", "terbaik", "untuk"]) {
      const r2 = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=${country}&gl=${country}&q=${encodeURIComponent(keyword + " " + suf)}`);
      const j2 = (await r2.json()) as [string, string[]];
      extra.push(...(j2?.[1] ?? []).slice(0, 4));
    }
    if (extra.length) out.push(`Variasi long-tail:\n${Array.from(new Set(extra)).map((x) => `- ${x}`).join("\n")}`);
  } catch (e) { out.push(`Google Suggest tidak bisa diakses: ${(e as Error).message}`); }
  // Berbayar/free-tier: SerpApi untuk SERP + People Also Ask + related
  if (ctx.keys.serp) {
    try {
      const r = await fetch(`https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(keyword)}&hl=${country}&gl=${country}&api_key=${ctx.keys.serp}`);
      const j = await r.json();
      const org = (j.organic_results ?? []).slice(0, 8).map((x: { position: number; title: string; link: string }) => `${x.position}. ${x.title} — ${x.link}`);
      const paa = (j.related_questions ?? []).slice(0, 8).map((x: { question: string }) => `- ${x.question}`);
      const rel = (j.related_searches ?? []).slice(0, 8).map((x: { query: string }) => `- ${x.query}`);
      if (org.length) out.push(`SERP teratas (siapa yang ranking):\n${org.join("\n")}`);
      if (paa.length) out.push(`Pertanyaan terkait (People Also Ask):\n${paa.join("\n")}`);
      if (rel.length) out.push(`Pencarian terkait:\n${rel.join("\n")}`);
    } catch (e) { out.push(`SerpApi gagal: ${(e as Error).message}`); }
  } else {
    out.push("Catatan: volume pencarian & SERP tidak tersedia tanpa kunci SerpApi (Pengaturan → Kunci API). Beri perkiraan relatif (tinggi/sedang/rendah).");
  }
  return out.join("\n\n");
}

async function voiceGenerate(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const text = String(input.text ?? "").trim();
  if (!text) return "Teks kosong.";
  if (!ctx.keys.elevenlabs) return "Kunci ElevenLabs belum diatur (Pengaturan → Kunci API). Gratis 10.000 karakter/bulan.";
  if (text.length > 4000) return "Teks terlalu panjang (maks 4.000 karakter per panggilan). Pecah per bagian.";
  const voice = String(input.voice || "JBFqnCBsd6RMkjVDRZzb"); // suara default multibahasa
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST", headers: { "xi-api-key": ctx.keys.elevenlabs, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
  });
  if (!r.ok) throw new Error(`ElevenLabs HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  const name = await putToDrive(ctx, String(input.filename || `voice-${Date.now()}.mp3`).replace(/\.(?!mp3$)[a-z0-9]+$/i, "") + (String(input.filename || "").endsWith(".mp3") ? "" : ".mp3"), bytes, "audio/mpeg", "file");
  return `Suara dibuat (${Math.round(bytes.length / 1024)} KB) dan disimpan di Drive sebagai "${name}".`;
}

async function imageGenerate(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const prompt = String(input.prompt ?? "").trim();
  if (!prompt) return "Prompt kosong.";
  if (!ctx.keys.google) return "Kunci Google AI Studio belum diatur (Pengaturan → Kunci API, gratis). Berikan prompt gambarnya ke user agar dibuat di Studio AI.";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${ctx.keys.google}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? `Gemini HTTP ${r.status}`);
  const partImg = (j.candidates?.[0]?.content?.parts ?? []).find((p: { inlineData?: { data: string; mimeType: string } }) => p.inlineData);
  if (!partImg) return "Model tidak mengembalikan gambar (mungkin prompt ditolak kebijakan). Coba ubah prompt.";
  const bytes = Buffer.from(partImg.inlineData.data, "base64");
  const ext = partImg.inlineData.mimeType.includes("jpeg") ? "jpg" : "png";
  const name = await putToDrive(ctx, String(input.filename || `gambar-${Date.now()}.${ext}`), bytes, partImg.inlineData.mimeType, "image");
  await ctx.supabase.from("generations").insert({ project_id: ctx.projectId, user_id: ctx.userId, model_id: "google/gemini-2.5-flash-image", kind: "image", prompt, status: "done", output_url: null, cost: 0.039 }).then(() => {}, () => {});
  return `Gambar dibuat dan disimpan di Drive sebagai "${name}". User bisa melihatnya di menu Drive.`;
}

async function landingPublish(filename: string, slug: string, ctx: ToolCtx): Promise<string> {
  if (!filename || !slug) return "Butuh nama file .html dan slug.";
  const clean = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (clean.length < 3) return "Slug terlalu pendek.";
  const { data: f } = await ctx.supabase.from("files").select("id,title,storage_path").eq("project_id", ctx.projectId).ilike("title", `%${filename}%`).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!f) return `File "${filename}" tidak ditemukan di Drive.`;
  const { data: dl, error } = await ctx.supabase.storage.from("drive").download(f.storage_path);
  if (error || !dl) throw new Error(error?.message ?? "gagal unduh");
  const html = Buffer.from(await dl.arrayBuffer());
  const path = `${ctx.projectId}/landing/${clean}.html`;
  const { error: upErr } = await ctx.supabase.storage.from("brand").upload(path, html, { contentType: "text/html; charset=utf-8", upsert: true });
  if (upErr) throw new Error(upErr.message);
  const { error: lpErr } = await ctx.supabase.from("landing_pages").upsert({ project_id: ctx.projectId, slug: clean, storage_path: path, source_file_id: f.id, published_by: ctx.userId, published_at: new Date().toISOString() }, { onConflict: "slug" });
  if (lpErr) throw new Error(lpErr.message.includes("duplicate") ? `Slug "${clean}" sudah dipakai project lain.` : lpErr.message);
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return `Landing page terbit di ${base}/p/${clean}`;
}

async function createTask(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const title = String(input.title ?? "").trim();
  if (!title) return "Judul tugas kosong.";
  // cegah input ganda: tugas dengan judul sama yang belum selesai
  const { data: same } = await ctx.supabase.from("tasks").select("id,status").eq("project_id", ctx.projectId).ilike("title", title.replace(/[%_]/g, "\\$&")).neq("status", "done").limit(1);
  if (same?.length) return `Tugas "${title}" sudah ada di board (status ${same[0].status}) — tidak dibuat ulang. Gunakan update_task bila perlu mengubahnya.`;
  const { error } = await ctx.supabase.from("tasks").insert({
    project_id: ctx.projectId, title, description: input.description ? String(input.description) : null,
    status: (input.status as string) || "todo", agent_id: ctx.agentId, created_by: ctx.userId,
  });
  if (error) throw new Error(error.message);
  return `Tugas "${title}" dibuat di board.`;
}

async function learnSkill(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const title = String(input.title ?? "").trim();
  const content = String(input.content ?? "").trim();
  if (!title || content.length < 80) return "Judul/isi pengetahuan terlalu pendek.";
  const { error } = await ctx.supabase.from("agent_knowledge").insert({
    org_id: ctx.orgId, agent_id: ctx.agentId, title, content: clip(content, 8000), sources: input.sources ?? [], created_by: ctx.userId,
  });
  if (error) throw new Error(error.message);
  return `Pengetahuan "${title}" disimpan dan akan dipakai di percakapan berikutnya.`;
}

async function requestCapability(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const title = String(input.title ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  let kind = String(input.kind ?? "dev");
  if (!title || !reason) return "Judul dan alasan wajib diisi.";
  let capKey: string | null = input.capability_key ? String(input.capability_key) : null;
  let spec: unknown = null;
  if (capKey && capKey in BUILTIN_CAP_DEFS) kind = "builtin";
  if (kind === "builtin") {
    if (!capKey || !(capKey in BUILTIN_CAP_DEFS)) { kind = "dev"; capKey = null; }
    else if (ctx.enabledCaps?.has(capKey) || ALWAYS_ON_CAPS.has(capKey)) return `Kemampuan ${capKey} sudah aktif — langsung pakai tool ${capKey}.`;
  }
  if (kind === "http") {
    spec = input.http_spec ?? null;
    const err = validateHttpSpec(spec);
    if (err) return `Spesifikasi HTTP ditolak: ${err}. Perbaiki atau ajukan sebagai kind='dev'.`;
  }
  if (!["builtin", "http", "dev"].includes(kind)) kind = "dev";
  // hindari duplikat permintaan yang masih menunggu
  let dupQ = ctx.supabase.from("capability_requests").select("id").eq("org_id", ctx.orgId).eq("status", kind === "dev" ? "needs_dev" : "pending");
  dupQ = capKey ? dupQ.eq("capability_key", capKey) : dupQ.eq("title", title);
  const { data: dup } = await dupQ.limit(1);
  if (dup?.length) return `Permintaan "${title}" sudah diajukan dan masih menunggu admin (Pengaturan → Kemampuan). Beri tahu user.`;
  const { error } = await ctx.supabase.from("capability_requests").insert({
    org_id: ctx.orgId, agent_id: ctx.agentId, conversation_id: ctx.conversationId, requested_by: ctx.userId,
    title, reason, user_request: input.user_request ? String(input.user_request).slice(0, 2000) : null,
    kind, capability_key: capKey, spec, status: kind === "dev" ? "needs_dev" : "pending",
  });
  if (error) {
    if (/capability_requests/.test(error.message)) return "Gagal: fitur kemampuan belum terpasang (migrasi 0009 belum dijalankan). Beri tahu user/admin.";
    throw new Error(error.message);
  }
  return kind === "dev"
    ? `Permintaan "${title}" dicatat sebagai kebutuhan pengembangan. Admin akan melihatnya di Pengaturan → Kemampuan.`
    : `Permintaan "${title}" diajukan. Admin organisasi bisa menyetujuinya di Pengaturan → Kemampuan; setelah disetujui, kemampuan langsung tersedia di pesan berikutnya.`;
}

async function mergeDriveFiles(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const names = Array.isArray(input.sources) ? (input.sources as unknown[]).map(String).filter(Boolean) : [];
  const target = String(input.target ?? "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  if (names.length < 2 || !target) return "Butuh minimal 2 file sumber dan nama file hasil.";
  const { data: files } = await ctx.supabase.from("files").select("id,title,storage_path,mime_type").eq("project_id", ctx.projectId).order("created_at", { ascending: false }).limit(300);
  const picked: { id: string; title: string; storage_path: string }[] = [];
  for (const n of names) {
    const q = n.toLowerCase();
    const f = (files ?? []).find((x) => x.title.toLowerCase() === q) ?? (files ?? []).find((x) => x.title.toLowerCase().includes(q));
    if (!f) return `File "${n}" tidak ditemukan. Tersedia: ${(files ?? []).slice(0, 30).map((x) => x.title).join(", ")}`;
    if (!/\.(md|txt|html?|csv|json)$/i.test(f.title)) return `File "${f.title}" bukan file teks — hanya md/txt/html/csv/json yang bisa digabung.`;
    picked.push(f);
  }
  const parts: string[] = [];
  for (const f of picked) {
    const { data, error } = await ctx.supabase.storage.from("drive").download(f.storage_path);
    if (error || !data) throw new Error(`gagal membaca ${f.title}: ${error?.message ?? ""}`);
    parts.push((await data.text()).trim());
  }
  const sep = typeof input.separator === "string" ? input.separator : "\n\n---\n\n";
  const merged = parts.join(sep);
  const exists = (files ?? []).some((x) => x.title === target);
  const res = await saveToDrive(target, merged, ctx, exists ? "replace" : "new");
  let note = "";
  const saved = /^(Tersimpan|File ".*" ditimpa)/.test(res);
  if (!saved) return `Gagal menggabungkan: ${res}`;
  if (input.delete_sources === true && !(ctx.enabledCaps?.has("delete_drive_file") && input.confirmed === true)) {
    note = " File sumber TIDAK dihapus: butuh kemampuan 'Hapus file Drive' aktif dan konfirmasi user (confirmed=true).";
  } else if (input.delete_sources === true) {
    const del = picked.filter((f) => f.title !== target);
    await ctx.supabase.storage.from("drive").remove(del.map((f) => f.storage_path));
    await ctx.supabase.from("files").delete().in("id", del.map((f) => f.id));
    note = ` File sumber dihapus: ${del.map((f) => f.title).join(", ")}.`;
  }
  return `${picked.length} file digabung → "${target}" (${merged.length} karakter). ${res}${note}`;
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

/** Ambil gambar dari Drive untuk dilihat model. Dipanggil langsung oleh route chat (hasilnya berisi gambar). */
export async function viewImage(name: string, ctx: ToolCtx): Promise<{ output: string; images?: { mime: string; b64: string }[] }> {
  const { data: files } = await ctx.supabase.from("files").select("id,title,storage_path,mime_type,size_bytes").eq("project_id", ctx.projectId).order("created_at", { ascending: false }).limit(300);
  const imgs = (files ?? []).filter((f) => (f.mime_type ?? "").startsWith("image/") || IMAGE_RE.test(f.title));
  if (!imgs.length) return { output: "Tidak ada gambar di Drive project. Minta user mengunggah gambar lewat Drive atau tombol lampiran di chat." };
  if (!name) return { output: `Gambar di Drive:\n${imgs.map((f) => `- ${f.title} (${Math.round((f.size_bytes ?? 0) / 1024)} KB)`).join("\n")}` };
  const q = name.toLowerCase();
  const f = imgs.find((x) => x.title.toLowerCase() === q) ?? imgs.find((x) => x.title.toLowerCase().includes(q));
  if (!f) return { output: `Gambar "${name}" tidak ditemukan. Tersedia: ${imgs.map((x) => x.title).join(", ")}` };
  if ((f.size_bytes ?? 0) > 3_700_000) return { output: `Gagal: "${f.title}" terlalu besar (${Math.round((f.size_bytes ?? 0) / 1024 / 1024)} MB, maks 4 MB). Minta user mengunggah versi yang lebih kecil.` };
  const { data, error } = await ctx.supabase.storage.from("drive").download(f.storage_path);
  if (error || !data) return { output: `Gagal mengunduh gambar: ${error?.message ?? "tidak diketahui"}` };
  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.length > 3_700_000) return { output: `Gagal: "${f.title}" terlalu besar (${(buf.length / 1024 / 1024).toFixed(1)} MB). Batas untuk dilihat ±3,5 MB — minta user mengunggah versi yang lebih kecil/terkompres.` };
  const ext = (f.title.split(".").pop() ?? "").toLowerCase();
  const mime = (f.mime_type && f.mime_type.startsWith("image/") ? f.mime_type : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`).replace("image/jpg", "image/jpeg");
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime)) return { output: `Format ${mime} belum didukung untuk dilihat (pakai png/jpg/webp/gif).` };
  return { output: `Gambar "${f.title}" (${Math.round(buf.length / 1024)} KB) terlampir di bawah. Periksa dan jelaskan temuanmu.`, images: [{ mime, b64: buf.toString("base64") }] };
}
