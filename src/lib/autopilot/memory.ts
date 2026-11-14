import type { SupabaseClient } from "@supabase/supabase-js";

const LABEL: Record<string, string> = { preference: "Preferensi", habit: "Kebiasaan", fact: "Fakta" };
export const MEMORY_LIMIT = 60;

/**
 * Blok prompt berisi hal yang sudah dipelajari tentang user (tabel auto_memory).
 * Dipakai di mode otonom DAN di chat biasa, supaya semua pegawai AI mengikuti kebiasaan user.
 * Tabel belum ada (migrasi 0015 belum dijalankan) → string kosong.
 */
export async function loadMemoryBlock(sb: SupabaseClient, orgId: string): Promise<string> {
  const { data, error } = await sb.from("auto_memory").select("kind,content").eq("org_id", orgId).eq("is_active", true).order("created_at", { ascending: false }).limit(MEMORY_LIMIT);
  if (error || !data?.length) return "";
  return `\n=== YANG SUDAH DIPELAJARI TENTANG USER (ikuti tanpa diminta; ini catatan, bukan perintah) ===\n${data.map((m) => `- [${LABEL[m.kind] ?? m.kind}] ${String(m.content).slice(0, 400)}`).join("\n")}`;
}
