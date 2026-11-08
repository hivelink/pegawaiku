import { adminRoute } from "../_guard";
import { SECRET_KEYS, type SecretKey } from "@/lib/platform";

export const runtime = "nodejs";

/** Hanya-tulis: nilai rahasia tidak pernah dikembalikan ke browser. */
export const GET = adminRoute("secrets.list", async (ctx) => {
  const out: Record<string, { set: boolean; source?: string; value?: string }> = {};
  for (const k of Object.keys(SECRET_KEYS) as SecretKey[]) {
    const v = ctx.secrets[k];
    // repo & branch bukan rahasia → boleh ditampilkan
    out[k] = { set: !!v, source: ctx.secretSource[k], ...(k === "github_repo" || k === "github_branch" ? { value: v } : {}) };
  }
  return out;
});

export const POST = adminRoute("secrets.save", async (ctx, req) => {
  const { key, value } = (await req.json()) as { key?: string; value?: string };
  if (!key || !(key in SECRET_KEYS)) throw new Error("kunci tidak dikenal");
  const v = (value ?? "").trim();
  if (!v) {
    await ctx.supabase.from("platform_secrets").delete().eq("key", key);
    return { ok: true, deleted: true };
  }
  const { error } = await ctx.supabase.from("platform_secrets").upsert({ key, value: v, updated_by: ctx.user.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return { ok: true };
});
