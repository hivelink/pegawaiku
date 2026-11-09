import type { ToolDef } from "./llm";
import type { ToolCtx } from "./agent-tools";

/**
 * Kemampuan dasar yang bisa diminta agent & disetujui admin organisasi.
 * - builtin: kode sudah ada di platform, tinggal diaktifkan per organisasi (org_capabilities).
 * - http: aksi HTTP yang diusulkan agent (spec) dan disetujui admin; dijalankan oleh runner aman.
 * - dev: butuh pengembangan kode → masuk backlog untuk admin platform.
 */

export type HttpSpec = {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  params?: Record<string, { type?: string; description?: string }>;
};

const CONFIRM_PROP = { confirmed: { type: "boolean", description: "WAJIB true hanya jika user SUDAH menyetujui secara eksplisit di chat untuk aksi ini. Jika belum, tanyakan dulu ke user." } };

export const BUILTIN_CAP_DEFS: Record<string, ToolDef> = {
  delete_drive_file: {
    name: "delete_drive_file",
    description: "Hapus file dari Drive project. Tanyakan konfirmasi user dulu; panggil dengan confirmed=true hanya setelah user setuju.",
    input_schema: { type: "object", properties: { name: { type: "string", description: "Nama file persis (atau sebagian yang unik)" }, ...CONFIRM_PROP }, required: ["name", "confirmed"] },
  },
  rename_drive_file: {
    name: "rename_drive_file",
    description: "Ganti nama file di Drive project.",
    input_schema: { type: "object", properties: { name: { type: "string" }, new_name: { type: "string" } }, required: ["name", "new_name"] },
  },
  list_tasks: {
    name: "list_tasks",
    description: "Lihat tugas di board project beserta status dan ID-nya.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["todo", "in_progress", "review", "done", "blocked"] } } },
  },
  update_task: {
    name: "update_task",
    description: "Ubah judul, deskripsi, atau status tugas di board. Cari ID lewat list_tasks.",
    input_schema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" }, status: { type: "string", enum: ["todo", "in_progress", "review", "done", "blocked"] } }, required: ["id"] },
  },
  delete_task: {
    name: "delete_task",
    description: "Hapus tugas dari board. Tanyakan konfirmasi user dulu.",
    input_schema: { type: "object", properties: { id: { type: "string" }, ...CONFIRM_PROP }, required: ["id", "confirmed"] },
  },
  update_project_info: {
    name: "update_project_info",
    description: "Perbarui info project: tagline, deskripsi, kategori, website, status, tenggat (YYYY-MM-DD).",
    input_schema: { type: "object", properties: { tagline: { type: "string" }, description: { type: "string" }, category: { type: "string" }, website: { type: "string" }, status: { type: "string", enum: ["active", "on_hold", "done", "archived"] }, due_date: { type: "string", description: "YYYY-MM-DD" } } },
  },
  list_conversations: {
    name: "list_conversations",
    description: "Lihat daftar percakapan lain di project (judul, agent, ID).",
    input_schema: { type: "object", properties: {} },
  },
  read_conversation: {
    name: "read_conversation",
    description: "Baca isi percakapan lain di project (mis. hasil kerja agent lain). ID dari list_conversations.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
};

export const REQUEST_CAPABILITY_DEF: ToolDef = {
  name: "request_capability",
  description:
    "Ajukan kemampuan baru ke admin bila kamu TIDAK BISA melakukan permintaan user karena tidak punya tool-nya (mis. hapus file Drive). " +
    "Jika kemampuan ada di daftar 'kemampuan yang bisa diminta', isi capability_key. Jika butuh memanggil API eksternal, isi http_spec. " +
    "Selain itu isi kind='dev' (butuh pengembangan). Setelah mengajukan, beri tahu user bahwa permintaan menunggu persetujuan admin di Pengaturan → Kemampuan.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Nama singkat kemampuan, mis. 'Hapus file Drive'" },
      reason: { type: "string", description: "Kenapa dibutuhkan & manfaatnya" },
      user_request: { type: "string", description: "Permintaan user yang memicu" },
      kind: { type: "string", enum: ["builtin", "http", "dev"] },
      capability_key: { type: "string", description: "Untuk kind=builtin: kunci dari daftar" },
      http_spec: {
        type: "object",
        description: "Untuk kind=http: {method,url,headers,body,params}. Gunakan {{nama_param}} di url/body; {{key:provider}} di header untuk kunci API org.",
        properties: { method: { type: "string" }, url: { type: "string" }, headers: { type: "object" }, body: { type: "string" }, params: { type: "object" } },
      },
    },
    required: ["title", "reason", "kind"],
  },
};

function clip(s: string, n: number) { return s.length > n ? s.slice(0, n) + "\n…[dipotong]" : s; }

export async function runBuiltinCap(name: string, input: Record<string, unknown>, ctx: ToolCtx): Promise<string | null> {
  const sb = ctx.supabase;
  switch (name) {
    case "delete_drive_file": {
      if (input.confirmed !== true) return "Belum dikonfirmasi. Tanyakan ke user: 'Yakin hapus file ini?' lalu panggil lagi dengan confirmed=true.";
      const f = await findFile(ctx, String(input.name ?? ""));
      if (typeof f === "string") return f;
      const { error: sErr } = await sb.storage.from("drive").remove([f.storage_path]);
      if (sErr) throw new Error(sErr.message);
      const { error } = await sb.from("files").delete().eq("id", f.id);
      if (error) throw new Error(error.message);
      return `File "${f.title}" dihapus dari Drive.`;
    }
    case "rename_drive_file": {
      const f = await findFile(ctx, String(input.name ?? ""));
      if (typeof f === "string") return f;
      const nn = String(input.new_name ?? "").trim().replace(/[\\/]/g, "_");
      if (!nn) return "Nama baru kosong.";
      const { error } = await sb.from("files").update({ title: nn }).eq("id", f.id);
      if (error) throw new Error(error.message);
      return `File "${f.title}" diganti nama menjadi "${nn}".`;
    }
    case "list_tasks": {
      let q = sb.from("tasks").select("id,title,status,description").eq("project_id", ctx.projectId).order("created_at", { ascending: false }).limit(60);
      if (input.status) q = q.eq("status", String(input.status));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      if (!data?.length) return "Belum ada tugas.";
      return data.map((t) => `- [${t.status}] ${t.title} (id: ${t.id})${t.description ? ` — ${String(t.description).slice(0, 120)}` : ""}`).join("\n");
    }
    case "update_task": {
      const patch: Record<string, unknown> = {};
      for (const k of ["title", "description", "status"]) if (input[k] != null && input[k] !== "") patch[k] = input[k];
      if (!Object.keys(patch).length) return "Tidak ada perubahan.";
      const { data, error } = await sb.from("tasks").update(patch).eq("id", String(input.id)).eq("project_id", ctx.projectId).select("title");
      if (error) throw new Error(error.message);
      if (!data?.length) return "Tugas tidak ditemukan di project ini.";
      return `Tugas "${data[0].title}" diperbarui.`;
    }
    case "delete_task": {
      if (input.confirmed !== true) return "Belum dikonfirmasi. Tanyakan ke user dulu, lalu panggil lagi dengan confirmed=true.";
      const { data, error } = await sb.from("tasks").delete().eq("id", String(input.id)).eq("project_id", ctx.projectId).select("title");
      if (error) throw new Error(error.message);
      if (!data?.length) return "Tugas tidak ditemukan di project ini.";
      return `Tugas "${data[0].title}" dihapus.`;
    }
    case "update_project_info": {
      const patch: Record<string, unknown> = {};
      for (const k of ["tagline", "description", "category", "website", "status", "due_date"]) if (input[k] != null && input[k] !== "") patch[k] = input[k];
      if (!Object.keys(patch).length) return "Tidak ada perubahan.";
      const { error } = await sb.from("projects").update(patch).eq("id", ctx.projectId);
      if (error) throw new Error(error.message);
      return `Info project diperbarui: ${Object.keys(patch).join(", ")}.`;
    }
    case "list_conversations": {
      const { data, error } = await sb.from("conversations").select("id,title,updated_at,agent:agents!agent_id(display_name)").eq("project_id", ctx.projectId).order("updated_at", { ascending: false }).limit(30);
      if (error) throw new Error(error.message);
      return (data ?? []).filter((c) => c.id !== ctx.conversationId).map((c) => `- ${c.title} · ${(c.agent as unknown as { display_name?: string } | null)?.display_name ?? "?"} (id: ${c.id})`).join("\n") || "Tidak ada percakapan lain.";
    }
    case "read_conversation": {
      const { data: c } = await sb.from("conversations").select("id,title").eq("id", String(input.id)).eq("project_id", ctx.projectId).maybeSingle();
      if (!c) return "Percakapan tidak ditemukan di project ini.";
      const { data } = await sb.from("messages").select("role,content").eq("conversation_id", c.id).order("created_at").limit(40);
      return clip(`# ${c.title}\n\n` + (data ?? []).map((m) => `**${m.role}**: ${m.content}`).join("\n\n"), 14000);
    }
  }
  return null;
}

async function findFile(ctx: ToolCtx, name: string) {
  const { data: files } = await ctx.supabase.from("files").select("id,title,storage_path").eq("project_id", ctx.projectId).limit(200);
  if (!files?.length) return "Drive project kosong.";
  const q = name.toLowerCase().trim();
  if (!q) return "Nama file kosong.";
  const exact = files.filter((x) => x.title.toLowerCase() === q);
  const part = exact.length ? exact : files.filter((x) => x.title.toLowerCase().includes(q));
  if (!part.length) return `File "${name}" tidak ditemukan. Tersedia: ${files.slice(0, 30).map((x) => x.title).join(", ")}`;
  if (part.length > 1) return `Ada ${part.length} file cocok: ${part.map((x) => x.title).join(", ")}. Sebutkan nama persis.`;
  return part[0];
}

// ---------------- HTTP capability ----------------

export function httpCapToolDef(key: string, name: string, description: string, spec: HttpSpec): ToolDef {
  const props: Record<string, unknown> = {};
  for (const [p, d] of Object.entries(spec.params ?? {})) props[p] = { type: d.type ?? "string", description: d.description ?? p };
  return { name: key, description: `${name}: ${description} (aksi HTTP disetujui admin)`, input_schema: { type: "object", properties: props, required: Object.keys(props) } };
}

function isPrivateHost(h: string) {
  const host = h.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return host.startsWith("[") || host.includes(":");
}

export function validateHttpSpec(spec: unknown): string | null {
  const s = spec as HttpSpec;
  if (!s || typeof s.url !== "string") return "spec.url wajib diisi";
  let u: URL;
  try { u = new URL(s.url.replace(/\{\{[^}]+\}\}/g, "x")); } catch { return "URL tidak valid"; }
  if (u.protocol !== "https:") return "Hanya URL https yang diizinkan";
  if (isPrivateHost(u.hostname)) return "Alamat jaringan privat/lokal tidak diizinkan";
  const m = (s.method ?? "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(m)) return "Metode HTTP tidak didukung";
  return null;
}

export async function runHttpCap(spec: HttpSpec, input: Record<string, unknown>, keys: Record<string, string>): Promise<string> {
  const err = validateHttpSpec(spec);
  if (err) return `Gagal: ${err}`;
  const fill = (t: string, enc: boolean) => t.replace(/\{\{([^}]+)\}\}/g, (_, raw: string) => {
    const k = raw.trim();
    if (k.startsWith("key:")) return keys[k.slice(4)] ?? "";
    const v = input[k] == null ? "" : String(input[k]);
    return enc ? encodeURIComponent(v) : v;
  });
  const url = fill(spec.url, true);
  const u = new URL(url);
  if (u.protocol !== "https:" || isPrivateHost(u.hostname)) return "Gagal: URL tujuan tidak diizinkan.";
  const headers: Record<string, string> = {};
  for (const [h, v] of Object.entries(spec.headers ?? {})) headers[h] = fill(String(v), false);
  const method = (spec.method ?? "GET").toUpperCase();
  const body = spec.body && method !== "GET" ? fill(spec.body, false) : undefined;
  if (body && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
  const r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20000), redirect: "error" });
  const t = await r.text();
  return clip(`HTTP ${r.status}\n${t}`, 8000);
}
