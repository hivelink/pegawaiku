import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin, supabaseRef } from "@/lib/platform";
import { Updater } from "@/app/app/settings/update/updater";

export const dynamic = "force-dynamic";

/**
 * Halaman pembaruan DARURAT — di luar layout /app, jadi tetap bisa dibuka walau
 * tampilan utama aplikasi sedang error. Hanya untuk admin platform.
 */
export default async function EmergencyUpdatePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/darurat/update");
  const admin = await isPlatformAdmin(supabase, user);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-extrabold text-primary">Pembaruan Darurat</h1>
      <p className="text-sm text-muted">
        Halaman ini berdiri sendiri, di luar tampilan utama aplikasi. Gunakan bila aplikasi sedang error: unggah paket perbaikan, atau kembalikan ke versi sebelumnya lewat “Riwayat versi”.
        Setelah pulih, kembali ke <a className="text-primary underline" href="/app">aplikasi</a>.
      </p>
      {admin ? <Updater supabaseRef={supabaseRef()} /> : <div className="rounded-xl border border-border bg-card p-5 text-sm">Hanya admin platform yang bisa membuka halaman ini.</div>}
    </main>
  );
}
