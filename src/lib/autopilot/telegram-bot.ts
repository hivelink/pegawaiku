import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTelegram, tgCall, tgSend, type Telegram } from "./notify";

/**
 * Bot Telegram dua arah untuk pekerja NAS: user menyetujui/menolak aksi dengan tombol, dan bisa mengirim misi
 * baru dengan "/misi <perintah>". Hanya chat dengan CHAT_ID yang terdaftar di kunci `telegram` yang dilayani.
 */

export type Decision = { kind: "action"; id: string; approve: boolean } | { kind: "question"; id: string; option: number };

export function parseCallback(data: string | undefined): Decision | null {
  const m = /^(ap|aq):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(y|n|\d)$/.exec(data ?? "");
  if (!m) return null;
  if (m[1] === "ap") return m[3] === "y" || m[3] === "n" ? { kind: "action", id: m[2], approve: m[3] === "y" } : null;
  return /^\d$/.test(m[3]) ? { kind: "question", id: m[2], option: Number(m[3]) } : null;
}

type TgUpdate = {
  update_id: number;
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number } } };
  message?: { text?: string; chat: { id: number } };
};

async function decide(sb: SupabaseClient, orgId: string, d: Decision): Promise<string> {
  const { data: ap } = await sb.from("auto_approvals").select("id,kind,status,summary,options").eq("id", d.id).eq("org_id", orgId).maybeSingle();
  if (!ap) return "Persetujuan tidak ditemukan.";
  if (ap.status !== "pending") return `Sudah diputuskan sebelumnya (${ap.status}).`;
  const patch: Record<string, unknown> = { decided_via: "telegram", decided_at: new Date().toISOString() };
  let reply: string;
  if (d.kind === "question") {
    const opt = ((ap.options ?? []) as { label: string }[])[d.option];
    if (ap.kind !== "question" || !opt) return "Pilihan tidak valid.";
    Object.assign(patch, { status: "approved", answer: opt.label });
    reply = `🗳 Dijawab: ${opt.label}`;
  } else {
    if (ap.kind !== "action") return "Tombol tidak cocok dengan permintaan ini.";
    patch.status = d.approve ? "approved" : "rejected";
    reply = d.approve ? `✅ Disetujui: ${ap.summary}` : `⛔ Ditolak: ${ap.summary}`;
  }
  const { data: rows, error } = await sb.from("auto_approvals").update(patch).eq("id", d.id).eq("org_id", orgId).eq("status", "pending").select("id");
  if (error) return `Gagal menyimpan keputusan: ${error.message}`;
  return rows?.length ? reply : "Sudah diputuskan sebelumnya.";
}

async function newMission(sb: SupabaseClient, orgId: string, text: string): Promise<string> {
  const instructions = text.trim();
  if (instructions.length < 8) return "Tulis perintahnya setelah /misi, mis. /misi cek router dan laporkan WAN yang mati";
  const { data: org } = await sb.from("organizations").select("owner_id").eq("id", orgId).single();
  const pid = process.env.AUTOPILOT_PROJECT_ID;
  const { data: proj } = pid
    ? await sb.from("projects").select("id,name").eq("org_id", orgId).eq("id", pid).maybeSingle()
    : await sb.from("projects").select("id,name").eq("org_id", orgId).order("created_at").limit(1).maybeSingle();
  if (!org || !proj) return "Project tujuan tidak ditemukan. Buat project dulu di aplikasi (atau set AUTOPILOT_PROJECT_ID).";
  const { error } = await sb.from("auto_missions").insert({
    org_id: orgId, project_id: proj.id, kind: "task", title: instructions.replace(/\s+/g, " ").slice(0, 80), instructions: instructions.slice(0, 6000),
    schedule_kind: "once", schedule: {}, status: "active", source: "user", next_run_at: new Date().toISOString(), created_by: org.owner_id,
  });
  return error ? `Gagal membuat misi: ${error.message}` : `🤖 Misi diterima (project ${proj.name}). Saya kerjakan sekarang; aksi berisiko akan saya mintakan persetujuan di sini.`;
}

export async function handleUpdate(sb: SupabaseClient, orgId: string, tg: Telegram, u: TgUpdate): Promise<void> {
  const cq = u.callback_query;
  if (cq) {
    const allowed = String(cq.message?.chat.id ?? "") === tg.chatId;
    const d = allowed ? parseCallback(cq.data) : null;
    const reply = !allowed ? "Chat ini tidak berwenang." : !d ? "Tombol tidak dikenali." : await decide(sb, orgId, d);
    await tgCall(tg, "answerCallbackQuery", { callback_query_id: cq.id, text: reply.slice(0, 190) }).catch(() => {});
    if (allowed && d && cq.message) {
      await tgCall(tg, "editMessageReplyMarkup", { chat_id: tg.chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      await tgSend(tg, reply).catch(() => {});
    }
    return;
  }
  const msg = u.message;
  if (!msg?.text || String(msg.chat.id) !== tg.chatId) return; // chat lain diabaikan tanpa balasan
  const m = /^\/misi(?:@\w+)?\s+([\s\S]+)/.exec(msg.text);
  await tgSend(tg, m ? await newMission(sb, orgId, m[1]) : "Kirim /misi <perintah> untuk memberi pekerjaan baru. Persetujuan aksi akan muncul di sini dengan tombol Setujui / Tolak.").catch(() => {});
}

/** Long-polling untuk semua organisasi yang punya kunci `telegram` (atau satu organisasi bila orgId diisi). */
export async function runTelegramBot(sb: SupabaseClient, opts: { orgId?: string | null; signal: AbortSignal; log?: (m: string) => void }): Promise<void> {
  const log = opts.log ?? (() => {});
  const offsets = new Map<string, number>();
  const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); opts.signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });
  while (!opts.signal.aborted) {
    let q = sb.from("org_api_keys").select("org_id,secret").eq("provider", "telegram");
    if (opts.orgId) q = q.eq("org_id", opts.orgId);
    const { data: rows, error } = await q;
    const bots = (rows ?? []).map((r) => ({ orgId: r.org_id as string, tg: parseTelegram(r.secret as string) })).filter((b): b is { orgId: string; tg: Telegram } => !!b.tg);
    if (error || !bots.length) { await sleep(60_000); continue; } // belum ada kunci telegram → cek lagi nanti
    await Promise.all(bots.map(async ({ orgId, tg }) => {
      try {
        const updates = await tgCall<TgUpdate[]>(tg, "getUpdates", { offset: offsets.get(tg.token) ?? 0, timeout: 25, allowed_updates: ["message", "callback_query"] }, 40_000);
        for (const u of updates) {
          offsets.set(tg.token, u.update_id + 1);
          await handleUpdate(sb, orgId, tg, u).catch((e: Error) => log(`telegram: ${e.message}`));
        }
      } catch (e) {
        if (!opts.signal.aborted) { log(`telegram: ${(e as Error).message}`); await sleep(15_000); }
      }
    }));
  }
}
