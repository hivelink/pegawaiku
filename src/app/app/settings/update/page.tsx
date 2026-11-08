import { CloudUpload } from "lucide-react";
import { getContext } from "@/lib/context";
import { isPlatformAdmin, supabaseRef } from "@/lib/platform";
import { Card } from "@/components/ui/card";
import { Updater } from "./updater";
import { BootstrapSql } from "./bootstrap-sql";

export default async function UpdatePage() {
  const { supabase, user } = await getContext();
  const [admin, { error: tblErr }] = await Promise.all([
    isPlatformAdmin(supabase, user),
    supabase.from("schema_migrations").select("name", { head: true, count: "exact" }),
  ]);
  const needsBootstrap = !!tblErr;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-primary"><CloudUpload /> Pembaruan Aplikasi</h1>
        <p className="text-sm text-muted">Unggah paket pembaruan (.zip) langsung dari sini — aplikasi menyimpannya ke GitHub dan Vercel otomatis men-deploy. Migrasi database bisa dijalankan dengan satu klik. Tidak perlu membuka GitHub lagi.</p>
      </div>
      {needsBootstrap && (
        <Card className="space-y-2 border-amber-300 bg-amber-50 p-4 text-sm">
          <b>Langkah satu kali: pasang fitur pembaruan di database</b>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Klik <b>Salin SQL</b> di bawah.</li>
            <li>Buka <a className="text-primary underline" target="_blank" rel="noreferrer" href={`https://supabase.com/dashboard/project/${supabaseRef()}/sql/new`}>Supabase → SQL Editor</a>, tempel, lalu klik <b>Run</b>.</li>
            <li>Muat ulang halaman ini. Pengguna pertama yang terdaftar otomatis menjadi admin platform.</li>
          </ol>
          <BootstrapSql />
        </Card>
      )}
      {!needsBootstrap && !admin && <Card className="p-5 text-sm text-muted">Hanya admin platform yang bisa memperbarui aplikasi.</Card>}
      {admin && <Updater supabaseRef={supabaseRef()} />}
    </div>
  );
}
