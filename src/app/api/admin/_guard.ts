import { NextResponse } from "next/server";
import { getAdminCtx, type AdminCtx } from "@/lib/platform";
import { logEvent, describeError } from "@/lib/log";

/** Bungkus handler admin: cek admin platform, tangkap error → JSON + log. */
export function adminRoute(name: string, fn: (ctx: AdminCtx, req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    let ctx: AdminCtx | null = null;
    try {
      ctx = await getAdminCtx();
      if (!ctx) return NextResponse.json({ error: "Hanya admin platform. Jalankan migrasi 0009 (pengguna pertama otomatis jadi admin) atau atur PLATFORM_ADMIN_EMAILS di Vercel." }, { status: 403 });
      const out = await fn(ctx, req);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e) {
      const { message, detail } = describeError(e);
      await logEvent("error", `api:admin:${name}`, message, detail);
      return NextResponse.json({ error: message }, { status: 400 });
    }
  };
}
