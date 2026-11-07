import { createClient } from "@/lib/supabase/server";

type Level = "info" | "warn" | "error";

/**
 * Catat kejadian ke tabel app_logs + console (muncul di log Vercel).
 * Tidak pernah melempar error — logging tidak boleh menjatuhkan aplikasi.
 */
export async function logEvent(level: Level, source: string, message: string, detail?: Record<string, unknown>, orgId?: string | null) {
  const line = `[${level}] ${source}: ${message}`;
  if (level === "error") console.error(line, detail ?? ""); else console.log(line, detail ?? "");
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("app_logs").insert({ org_id: orgId ?? null, user_id: user?.id ?? null, level, source, message: message.slice(0, 2000), detail: detail ?? null });
  } catch {
    /* abaikan */
  }
}

/** Ubah error apa pun menjadi pesan + detail yang aman disimpan. */
export function describeError(e: unknown): { message: string; detail: Record<string, unknown> } {
  if (e && typeof e === "object") {
    const o = e as { message?: string; code?: string; details?: string; hint?: string; name?: string; stack?: string; digest?: string };
    return {
      message: o.message ?? String(e),
      detail: { name: o.name, code: o.code, details: o.details, hint: o.hint, digest: o.digest, stack: o.stack?.split("\n").slice(0, 4).join("\n") },
    };
  }
  return { message: String(e), detail: {} };
}

/** Apakah error ini sinyal internal Next.js (redirect/notFound) yang harus diteruskan, bukan dicatat? */
export function isNextSignal(e: unknown): boolean {
  const d = (e as { digest?: string })?.digest;
  return typeof d === "string" && (d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_NOT_FOUND"));
}
