import type { Approval } from "./types";

/**
 * Notifikasi Telegram (opsional). Kunci organisasi `telegram` berformat BOT_TOKEN|CHAT_ID.
 * Hanya chat dengan CHAT_ID itu yang menerima pesan dan boleh menekan tombol persetujuan.
 */
export type Telegram = { token: string; chatId: string };

export function parseTelegram(cfg: string | undefined): Telegram | null {
  if (!cfg) return null;
  const i = cfg.lastIndexOf("|");
  if (i < 1) return null;
  const token = cfg.slice(0, i).trim(), chatId = cfg.slice(i + 1).trim();
  return /^\d+:[\w-]+$/.test(token) && /^-?\d+$/.test(chatId) ? { token, chatId } : null;
}

export type TgButton = { text: string; callback_data: string };

export async function tgCall<T = unknown>(tg: Telegram, method: string, body: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
  const r = await fetch(`https://api.telegram.org/bot${tg.token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!r.ok || !j.ok) throw new Error(`Telegram ${method}: ${j.description ?? `HTTP ${r.status}`}`);
  return j.result as T;
}

export function tgSend(tg: Telegram, text: string, buttons?: TgButton[][]) {
  return tgCall(tg, "sendMessage", { chat_id: tg.chatId, text: text.slice(0, 3900), ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) });
}

/** Tombol keputusan: ap:<id>:y|n untuk aksi, aq:<id>:<indeks opsi> untuk pertanyaan (≤ 64 byte). */
export function approvalButtons(a: Pick<Approval, "id" | "kind" | "options">): TgButton[][] {
  if (a.kind === "question") return (a.options ?? []).map((o, i) => [{ text: o.label.slice(0, 40), callback_data: `aq:${a.id}:${i}` }]);
  return [[{ text: "✅ Setujui", callback_data: `ap:${a.id}:y` }, { text: "⛔ Tolak", callback_data: `ap:${a.id}:n` }]];
}

export function approvalText(a: Pick<Approval, "kind" | "summary" | "reason" | "input" | "options">, missionTitle: string): string {
  const head = a.kind === "question" ? `🗳 ${missionTitle}\n\n${a.summary}` : `⏸ ${missionTitle} — butuh persetujuan\n\n${a.summary}`;
  const why = a.reason ? `\n\nAlasan agent:\n${a.reason.slice(0, 700)}` : "";
  const opts = a.kind === "question" ? `\n\n${(a.options ?? []).map((o) => `• ${o.label}${o.desc ? ` — ${o.desc}` : ""}`).join("\n")}` : `\n\nDetail:\n${JSON.stringify(a.input, null, 1).slice(0, 900)}`;
  return head + why + opts;
}

export async function notifyTelegram(tg: Telegram, missionTitle: string, text: string, approvals?: Approval[]): Promise<void> {
  if (!approvals?.length) { await tgSend(tg, text); return; }
  for (const a of approvals) await tgSend(tg, approvalText(a, missionTitle), approvalButtons(a));
}
