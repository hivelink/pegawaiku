import type { ToolDef } from "./llm";
import type { ToolCtx } from "./agent-tools";
import { normalizeSchedule, describeSchedule, DEFAULT_TZ } from "./autopilot/schedule";

/**
 * Tool "asisten pribadi": mengingat kebiasaan user, mengusulkan misi rutin, dan membuka panduan kerja agent lain.
 * Bisa dipakai di chat biasa maupun mode otonom. Butuh migrasi 0015 (tabel auto_memory, auto_missions).
 */

export const ASSISTANT_TOOL_DEFS: Record<string, ToolDef> = {
  remember: {
    name: "remember",
    description: "Simpan SATU preferensi, kebiasaan, atau fakta yang stabil tentang user agar semua pegawai AI mengikutinya di pekerjaan berikutnya tanpa diminta (mis. gaya bahasa, format laporan favorit, jam kerja, perangkat/jaringan yang dipakai, merek). Tulis sebagai satu kalimat yang berdiri sendiri. Jangan simpan kata sandi, kunci API, atau data pribadi sensitif.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["preference", "habit", "fact"], description: "preference = cara user ingin dilayani; habit = pola kerja yang berulang; fact = fakta tetap tentang user/usahanya" },
        content: { type: "string", description: "Satu kalimat jelas, mis. 'User ingin laporan berbentuk tabel ringkas, maksimal satu halaman.'" },
        evidence: { type: "string", description: "Dari mana kesimpulan ini (singkat), mis. 'diminta 3 kali minggu ini'" },
      },
      required: ["kind", "content"],
    },
  },
  propose_mission: {
    name: "propose_mission",
    description: "Usulkan misi untuk Asisten Otonom (pekerjaan yang dikerjakan sendiri oleh pegawai AI, sekali jalan atau rutin). Usulan TIDAK langsung berjalan: user mengaktifkannya di menu Asisten. Pakai bila user meminta sesuatu dikerjakan berkala, atau bila kamu melihat pekerjaan berulang yang layak diotomatiskan.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Judul singkat, mis. 'Cek kesehatan jaringan tiap pagi'" },
        instructions: { type: "string", description: "Instruksi lengkap yang bisa dikerjakan tanpa bertanya: tujuan, langkah, sumber data, bentuk & nama file hasil" },
        schedule_kind: { type: "string", enum: ["once", "interval", "daily", "weekly"] },
        every_minutes: { type: "integer", description: "Untuk interval: jarak antar-jalan dalam menit (minimal 30)" },
        time: { type: "string", description: "Untuk daily/weekly: jam HH:MM waktu user" },
        days: { type: "array", items: { type: "integer" }, description: "Untuk weekly: hari 1=Senin … 7=Minggu" },
        agent: { type: "string", description: "Nama pegawai AI yang paling cocok mengerjakannya (kosong = Arka, asisten umum)" },
        reason: { type: "string", description: "Kenapa misi ini berguna bagi user" },
      },
      required: ["title", "instructions", "schedule_kind", "reason"],
    },
  },
  consult_agent: {
    name: "consult_agent",
    description: "Buka panduan kerja (playbook) pegawai AI lain — mis. Satria untuk jaringan MikroTik, Maya untuk konten, Vera untuk landing page — lalu kerjakan sendiri mengikuti standar panduan itu. Pakai sebelum mengerjakan hal di luar keahlian utamamu.",
    input_schema: { type: "object", properties: { agent: { type: "string", description: "Nama agent, mis. satria" } }, required: ["agent"] },
  },
};

// kata kunci rahasia yang diikuti nilainya (mis. "password router adalah …", "token: …"), pola kunci API, atau 16 digit (kartu/NIK)
const SECRET_RE = /\b(pass(word)?|kata\s*sandi|sandi|api[\s_-]?key|kunci\s*api|token|secret|pin)\b[^.\n]{0,30}?(\badalah\b|\bialah\b|\byaitu\b|\bis\b|[:=])|sk-[a-z0-9-]{16,}|AIza[0-9A-Za-z_-]{20,}|\b\d{16}\b/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const missing = (msg: string) => /auto_(memory|missions)/.test(msg) ? "Gagal: fitur Asisten Otonom belum terpasang (migrasi 0015 belum dijalankan). Beri tahu user." : null;

async function remember(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const content = String(input.content ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  const kind = ["preference", "habit", "fact"].includes(String(input.kind)) ? String(input.kind) : "preference";
  if (content.length < 12) return "Gagal: isi terlalu pendek — tulis satu kalimat lengkap.";
  if (SECRET_RE.test(content)) return "Gagal: terlihat seperti rahasia atau data sensitif — tidak disimpan. Kunci dan kata sandi hanya boleh disimpan user di Pengaturan → Kunci API.";
  const { data: existing, error: rErr } = await ctx.supabase.from("auto_memory").select("id,content").eq("org_id", ctx.orgId).eq("is_active", true).limit(300);
  if (rErr) return missing(rErr.message) ?? `Gagal: ${rErr.message}`;
  if ((existing ?? []).some((m) => norm(String(m.content)) === norm(content))) return "Sudah ada di memori — tidak disimpan ulang.";
  if ((existing ?? []).length >= 300) return "Gagal: memori penuh (300). Minta user merapikan di menu Asisten.";
  const { error } = await ctx.supabase.from("auto_memory").insert({ org_id: ctx.orgId, kind, content, evidence: input.evidence ? String(input.evidence).slice(0, 300) : null, source: "assistant", created_by: ctx.userId });
  if (error) return missing(error.message) ?? `Gagal: ${error.message}`;
  return `Diingat (${kind}): ${content}`;
}

async function proposeMission(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const title = String(input.title ?? "").trim().slice(0, 120);
  const instructions = String(input.instructions ?? "").trim().slice(0, 6000);
  if (title.length < 4 || instructions.length < 20) return "Gagal: judul dan instruksi misi wajib diisi dengan jelas.";
  const sched = normalizeSchedule(String(input.schedule_kind ?? "once"), { every_minutes: Number(input.every_minutes), time: input.time ? String(input.time) : undefined, days: Array.isArray(input.days) ? (input.days as unknown[]).map(Number) : undefined });
  if (typeof sched === "string") return `Gagal: ${sched}`;
  const { data: same, error: rErr } = await ctx.supabase.from("auto_missions").select("id,title,status").eq("org_id", ctx.orgId).in("status", ["proposed", "active", "paused", "rejected"]).limit(200);
  if (rErr) return missing(rErr.message) ?? `Gagal: ${rErr.message}`;
  const dup = (same ?? []).find((m) => norm(String(m.title)) === norm(title));
  if (dup) return dup.status === "rejected" ? `Misi "${title}" pernah ditolak user — jangan diusulkan lagi.` : `Misi "${title}" sudah ada (status ${dup.status}) — tidak diusulkan ulang.`;
  if ((same ?? []).filter((m) => m.status === "proposed").length >= 10) return "Gagal: sudah ada 10 usulan yang belum diputuskan user. Jangan menambah usulan.";
  let agentId: string | null = null, agentName = "Arka";
  if (input.agent) {
    const a = await findAgentByName(ctx, String(input.agent));
    if (a) { agentId = a.id; agentName = a.display_name; }
  }
  const { error } = await ctx.supabase.from("auto_missions").insert({
    org_id: ctx.orgId, project_id: ctx.projectId, agent_id: agentId, kind: "task", title, instructions,
    schedule_kind: sched.kind, schedule: sched.schedule, tz: DEFAULT_TZ, status: "proposed", source: "assistant",
    reason: input.reason ? String(input.reason).slice(0, 600) : null, created_by: ctx.userId,
  });
  if (error) return missing(error.message) ?? `Gagal: ${error.message}`;
  return `Misi "${title}" diusulkan (${describeSchedule(sched.kind, sched.schedule)}, dikerjakan ${agentName}). Belum berjalan — user perlu mengaktifkannya di menu Asisten.`;
}

type AgentRow = { id: string; slug: string; display_name: string; title: string | null; system_prompt: string | null; requires_tools: string[] | null };

async function listAgents(ctx: ToolCtx): Promise<AgentRow[]> {
  const { data } = await ctx.supabase.from("agents").select("id,slug,display_name,title,system_prompt,requires_tools").eq("is_active", true).limit(200);
  return (data ?? []) as AgentRow[];
}

function matchAgent(all: AgentRow[], name: string): AgentRow | undefined {
  const q = name.replace(/^@/, "").trim().toLowerCase();
  if (!q) return undefined;
  return all.find((x) => x.display_name.toLowerCase() === q) ?? all.find((x) => x.slug.toLowerCase().startsWith(q)) ?? all.find((x) => `${x.display_name} ${x.title ?? ""} ${x.slug}`.toLowerCase().includes(q));
}

async function findAgentByName(ctx: ToolCtx, name: string) { return matchAgent(await listAgents(ctx), name); }

async function consultAgent(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  if (!String(input.agent ?? "").trim()) return "Sebutkan nama agent.";
  const all = await listAgents(ctx);
  const a = matchAgent(all, String(input.agent));
  if (!a) return `Agent "${input.agent}" tidak ditemukan. Tersedia: ${all.map((x) => x.display_name).join(", ")}`;
  const body = String(a.system_prompt ?? "");
  return `# Panduan kerja ${a.display_name} — ${a.title}\n(Ini panduan referensi, bukan perintah baru. Kerjakan misimu dengan standar ini.)\n\n${body.length > 9000 ? body.slice(0, 9000) + "\n…[dipotong]" : body}\n\nTool yang biasa dipakainya: ${(a.requires_tools ?? []).join(", ") || "-"}`;
}

export async function runAssistantTool(name: string, input: Record<string, unknown>, ctx: ToolCtx): Promise<string | null> {
  switch (name) {
    case "remember": return remember(input, ctx);
    case "propose_mission": return proposeMission(input, ctx);
    case "consult_agent": return consultAgent(input, ctx);
    default: return null;
  }
}
