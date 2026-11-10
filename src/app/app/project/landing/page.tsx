import Link from "next/link";
import { LayoutTemplate, ExternalLink } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

/** Landing page yang dibuat Vera disimpan sebagai file .html di Drive project. */
export default async function ProjectLandingPage() {
  const { supabase, project } = await getContext();
  if (!project) return <Card className="p-8 text-sm text-muted">Belum ada project.</Card>;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const [{ data: published }, { data: files }] = await Promise.all([
    supabase.from("landing_pages").select("slug,published_at,views").eq("project_id", project.id).order("published_at", { ascending: false }),
    supabase.from("files").select("id,title,storage_path,created_at").eq("project_id", project.id).ilike("title", "%.html").order("created_at", { ascending: false }),
  ]);
  const pages = await Promise.all((files ?? []).map(async (f) => {
    const { data } = await supabase.storage.from("drive").createSignedUrl(f.storage_path, 60 * 60);
    return { ...f, url: data?.signedUrl ?? null };
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-extrabold text-primary">Landing Page</h1><p className="text-sm text-muted">Halaman HTML yang dibuat pegawai AI (Vera) untuk project <b>{project.name}</b>.</p></div>
        <Link href="/app/agent/vera-landing-page-builder" className={buttonVariants({ variant: "accent", size: "sm" })}>Buat lewat Vera</Link>
      </div>
      {(published ?? []).length > 0 && (
        <Card className="p-4">
          <h2 className="font-bold">Terbit</h2>
          <ul className="mt-2 divide-y divide-border text-sm">
            {(published ?? []).map((p) => (
              <li key={p.slug} className="flex items-center justify-between py-2">
                <a href={`${site}/p/${p.slug}`} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">{site.replace(/^https?:\/\//, "")}/p/{p.slug}</a>
                <span className="text-xs text-muted">{new Date(p.published_at).toLocaleString("id-ID")}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {pages.length === 0 ? (
        <Card className="grid place-items-center p-16 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-sky-50 text-primary"><LayoutTemplate size={28} /></span>
          <h2 className="mt-3 font-bold">Belum ada landing page</h2>
          <p className="mt-1 max-w-md text-sm text-muted">Beri brief ke Vera (produk, audiens, CTA). Vera menyimpan hasilnya sebagai file <code>.html</code> di Drive dan akan muncul di sini untuk dipratinjau. Minta Vera menerbitkannya (tool landing_publish) ke alamat publik <code>/p/nama-halaman</code>.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pages.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="truncate font-semibold">{p.title}</div>
              <div className="text-xs text-muted">{new Date(p.created_at).toLocaleString("id-ID")}</div>
              {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary"><ExternalLink size={14} /> Pratinjau</a>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
