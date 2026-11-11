import type { ApprovalMode } from "./types";

/**
 * Tingkat risiko tiap tool saat dijalankan TANPA user di depan layar.
 * - safe      : hanya membaca → langsung jalan.
 * - write     : membuat/mengubah isi di dalam aplikasi (Drive, tugas, memori) → jalan, kecuali misi bermode "all_writes".
 * - sensitive : mengubah dunia luar atau menghapus (router, publikasi, hapus data, API luar) → SELALU menunggu persetujuan.
 * Tool yang tidak dikenal dianggap sensitive (gagal-aman).
 */
export type Risk = "safe" | "write" | "sensitive";

const SAFE = new Set([
  "web_search", "web_fetch", "read_drive_file", "view_image", "keyword_research", "list_tasks", "list_conversations", "read_conversation",
  "subnet_calc", "dns_lookup", "http_check", "consult_agent",
  "oilfield_convert", "ipr_vogel", "esp_quick", "srp_quick", "pcp_quick",
]);
const WRITE = new Set([
  "save_to_drive", "create_task", "update_task", "learn_skill", "rename_drive_file", "update_project_info", "request_capability",
  "image_generate", "image_edit", "voice_generate", "make_presentation", "remember", "propose_mission",
]);

export function classifyTool(name: string, input: Record<string, unknown>, httpCapKeys?: Set<string>): Risk {
  if (httpCapKeys?.has(name)) return "sensitive";
  if (name === "mikrotik_rest") return String(input.method ?? "GET").toUpperCase() === "GET" ? "safe" : "sensitive";
  if (name === "merge_drive_files") return input.delete_sources ? "sensitive" : "write";
  if (SAFE.has(name)) return "safe";
  if (WRITE.has(name)) return "write";
  return "sensitive";
}

export function needsApproval(risk: Risk, mode: ApprovalMode): boolean {
  return risk === "sensitive" || (risk === "write" && mode === "all_writes");
}

/** Tool yang memakai argumen `confirmed` — persetujuan user di kotak persetujuan ADALAH konfirmasinya. */
const CONFIRM_TOOLS = new Set(["delete_drive_file", "delete_task", "merge_drive_files"]);
export function withConfirmation(name: string, input: Record<string, unknown>): Record<string, unknown> {
  return CONFIRM_TOOLS.has(name) ? { ...input, confirmed: true } : input;
}

function short(v: unknown, n = 400): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return !s ? "" : s.length > n ? s.slice(0, n) + "…" : s;
}

/** Kalimat ringkas untuk kartu persetujuan: apa persisnya yang akan dilakukan. */
export function describeAction(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "mikrotik_rest": {
      const m = String(input.method ?? "GET").toUpperCase();
      const verb = m === "POST" ? "Tambah / jalankan perintah" : m === "PATCH" || m === "PUT" ? "Ubah" : m === "DELETE" ? "Hapus" : "Baca";
      return `Router MikroTik — ${verb}: ${m} ${input.path}${input.body ? ` → ${short(input.body)}` : ""}`;
    }
    case "landing_publish": return `Terbitkan landing page "${input.filename}" ke alamat publik /p/${input.slug}`;
    case "delete_drive_file": return `Hapus file Drive: ${input.name}`;
    case "delete_task": return `Hapus tugas (id ${input.id})`;
    case "merge_drive_files": return `Gabungkan ${Array.isArray(input.sources) ? input.sources.length : "beberapa"} file menjadi "${input.target}"${input.delete_sources ? " lalu HAPUS file sumbernya" : ""}`;
    case "save_to_drive": return `Simpan file "${input.filename}" ke Drive (${input.mode ?? "new"})`;
    case "create_task": return `Buat tugas: ${input.title}`;
    case "update_task": return `Ubah tugas ${input.id ?? input.find ?? ""}: ${short({ title: input.title, status: input.status, description: input.description }, 200)}`;
    case "image_generate": return `Buat gambar: ${short(input.prompt, 200)}`;
    case "image_edit": return `Edit gambar "${input.source}": ${short(input.instruction, 200)}`;
    case "voice_generate": return `Buat suara dari teks (${String(input.text ?? "").length} karakter)`;
    case "make_presentation": return `Buat presentasi "${input.title}" (${Array.isArray(input.slides) ? input.slides.length : 0} slide)`;
    case "learn_skill": return `Simpan pengetahuan: ${input.title}`;
    case "remember": return `Ingat tentang Anda: ${short(input.content, 200)}`;
    case "propose_mission": return `Usulkan misi rutin: ${input.title}`;
    case "update_project_info": return `Ubah info project: ${short(input, 200)}`;
    case "rename_drive_file": return `Ganti nama file "${input.name}" → "${input.new_name}"`;
    case "request_capability": return `Ajukan kemampuan baru: ${input.title}`;
    default: return `Jalankan ${name}: ${short(input)}`;
  }
}

export function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "web_search": return `🔎 Mencari: ${input.query}`;
    case "web_fetch": return `📄 Membaca halaman: ${input.url}`;
    case "read_drive_file": return `📂 Membaca bahan: ${input.name ?? "daftar file"}`;
    case "view_image": return `👁 Melihat gambar: ${input.name ?? "daftar gambar"}`;
    case "consult_agent": return `📘 Membuka panduan kerja ${input.agent}`;
    case "ask_user": return `🗳 Meminta keputusan: ${short(input.question, 80)}`;
    case "mikrotik_rest": return `📡 MikroTik ${String(input.method ?? "GET").toUpperCase()} ${input.path}`;
    default: return /^(subnet_calc|dns_lookup|http_check)$/.test(name) ? `🌐 Cek jaringan (${name})` : `🛠 ${describeAction(name, input)}`;
  }
}
