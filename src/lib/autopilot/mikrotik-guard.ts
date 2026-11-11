import { runDomainTool } from "../domain-tools";
import type { ToolCall } from "./types";

/** Pengaman khusus perubahan router: potret "sebelum" untuk kartu persetujuan dan backup otomatis sebelum menulis. */

export function isRouterWrite(call: ToolCall): boolean {
  return call.name === "mikrotik_rest" && String(call.input.method ?? "GET").toUpperCase() !== "GET";
}

const FAILED = /^(RouterOS menjawab HTTP|Kunci 'mikrotik'|Format kunci)/;

async function rest(input: Record<string, unknown>, keys: Record<string, string>): Promise<{ ok: boolean; text: string }> {
  try {
    const text = (await runDomainTool("mikrotik_rest", input, keys)) ?? "";
    return { ok: !FAILED.test(text), text };
  } catch (e) {
    return { ok: false, text: (e as Error).message };
  }
}

/** Nilai objek router saat ini (sebelum PATCH/PUT/DELETE) agar user melihat apa yang akan berubah. */
export async function routerSnapshot(call: ToolCall, keys: Record<string, string>): Promise<Record<string, unknown> | null> {
  const method = String(call.input.method ?? "GET").toUpperCase();
  const path = String(call.input.path ?? "");
  if (!["PATCH", "PUT", "DELETE"].includes(method) || !path) return null;
  const r = await rest({ path, method: "GET" }, keys);
  if (!r.ok) return { sebelum: `(tidak bisa dibaca: ${r.text.slice(0, 200)})` };
  try { return { sebelum: JSON.parse(r.text) }; } catch { return { sebelum: r.text.slice(0, 2000) }; }
}

/**
 * Simpan backup biner di router sebelum perubahan pertama pada sebuah run.
 * Mengembalikan null bila aman lanjut, atau alasan pembatalan bila backup gagal (perubahan tidak dijalankan).
 * AUTOPILOT_ROUTER_BACKUP=off mematikan pengaman ini (tidak disarankan).
 */
export async function routerBackup(keys: Record<string, string>, now = new Date()): Promise<string | null> {
  if ((process.env.AUTOPILOT_ROUTER_BACKUP ?? "").toLowerCase() === "off") return null;
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const r = await rest({ path: "/system/backup/save", method: "POST", body: { name: `pegawaiku-${stamp}` } }, keys);
  if (r.ok) return null;
  return `backup otomatis router gagal (${r.text.slice(0, 200)}). Perubahan dibatalkan demi keamanan. Pastikan user REST di router punya izin policy "write,policy,sensitive" untuk /system backup, atau set AUTOPILOT_ROUTER_BACKUP=off di pekerja bila Anda menerima risikonya.`;
}
