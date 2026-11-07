import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolDef } from "./llm";

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
};

export const TOOL_DEFS: Record<string, ToolDef> = {
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
    description: "Simpan teks (markdown/txt/html/csv) sebagai file ke Drive project. Gunakan untuk hasil kerja panjang: ebook, skrip, laporan, landing page.",
    input_schema: { type: "object", properties: { filename: { type: "string", description: "Nama file dengan ekstensi, mis. outline-ebook.md" }, content: { type: "string" } }, required: ["filename", "content"] },
  },
  read_drive_file: {
    name: "read_drive_file",
    description: "Baca isi file teks (md/txt/csv/html/json) dari Drive project berdasarkan nama atau id. Tanpa argumen: daftar file.",
    input_schema: { type: "object", properties: { name: { type: "string", description: "Nama file (sebagian boleh) atau kosong untuk daftar" } } },
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
      case "save_to_drive": return await saveToDrive(String(input.filename ?? "hasil.md"), String(input.content ?? ""), ctx);
      case "read_drive_file": return await readDriveFile(input.name ? String(input.name) : "", ctx);
      case "create_task": return await createTask(input, ctx);
      case "learn_skill": return await learnSkill(input, ctx);
      default: return `Tool ${name} tidak dikenal.`;
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

async function saveToDrive(filename: string, content: string, ctx: ToolCtx): Promise<string> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ext = (safe.split(".").pop() || "md").toLowerCase();
  const mime = ext === "html" ? "text/html" : ext === "csv" ? "text/csv" : ext === "json" ? "application/json" : ext === "txt" ? "text/plain" : "text/markdown";
  const path = `${ctx.projectId}/${Date.now()}-${safe}`;
  const bytes = Buffer.from(content, "utf8");
  const { error: upErr } = await ctx.supabase.storage.from("drive").upload(path, bytes, { contentType: mime });
  if (upErr) throw new Error(upErr.message);
  const { error } = await ctx.supabase.from("files").insert({ project_id: ctx.projectId, owner_id: ctx.userId, title: safe, storage_path: path, mime_type: mime, size_bytes: bytes.length, kind: "text" });
  if (error) throw new Error(error.message);
  return `Tersimpan di Drive project sebagai "${safe}" (${bytes.length} byte).`;
}

async function readDriveFile(name: string, ctx: ToolCtx): Promise<string> {
  const { data: files } = await ctx.supabase.from("files").select("id,title,storage_path,mime_type,size_bytes").eq("project_id", ctx.projectId).order("created_at", { ascending: false }).limit(50);
  if (!files?.length) return "Drive project kosong.";
  if (!name) return `File di Drive:\n${files.map((f) => `- ${f.title} (${f.mime_type ?? "?"}, ${f.size_bytes ?? 0} byte)`).join("\n")}`;
  const f = files.find((x) => x.title.toLowerCase().includes(name.toLowerCase()) || x.id === name);
  if (!f) return `File "${name}" tidak ditemukan. Tersedia: ${files.map((x) => x.title).join(", ")}`;
  if (f.mime_type && !/^(text\/|application\/json)/.test(f.mime_type)) return `File "${f.title}" bukan teks (${f.mime_type}); tidak bisa dibaca di sini.`;
  const { data, error } = await ctx.supabase.storage.from("drive").download(f.storage_path);
  if (error || !data) throw new Error(error?.message ?? "gagal unduh");
  return clip(await data.text(), 12000);
}

async function createTask(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const title = String(input.title ?? "").trim();
  if (!title) return "Judul tugas kosong.";
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
