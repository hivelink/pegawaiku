import { Image as ImageIcon, Type, AlignLeft, Palette, Box, Globe, Users, Trash2 } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProjectSettings, removeBrandAsset } from "../../actions";
import { ProjectImageUploader, BrandAssetUploader } from "./uploaders";

const STATUS: [string, string][] = [["active", "Aktif"], ["on_hold", "Ditunda"], ["done", "Selesai"], ["archived", "Arsip"]];

function Head({ icon: Icon, title, subtitle }: { icon: React.ComponentType<{ size?: number }>; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-5 py-4">
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent text-white"><Icon size={20} /></span>
      <div><div className="font-bold">{title}</div><div className="text-xs text-muted">{subtitle}</div></div>
    </div>
  );
}

function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export default async function ProjectSettingsPage() {
  const { supabase, org, project, user } = await getContext();
  if (!org || !project) return <Card className="p-8 text-sm text-muted">Belum ada project.</Card>;
  const brand = (project.brand ?? {}) as { primary?: string; secondary?: string; assets?: { name: string; path: string; url: string }[] };
  const primary = brand.primary ?? "#1E3A8A";
  const secondary = brand.secondary ?? "#0EA5E9";
  const { data: owner } = await supabase.from("profiles").select("full_name,email").eq("id", project.created_by ?? org.owner_id).maybeSingle();
  const ownerName = owner?.full_name || owner?.email || user.email;

  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      <Card className="overflow-hidden">
        <Head icon={ImageIcon} title="Gambar Project" subtitle="Thumbnail kartu & detail" />
        <div className="p-5"><ProjectImageUploader projectId={project.id} imageUrl={project.image_url ?? null} /></div>
      </Card>

      <Card className="overflow-hidden">
        <Head icon={Type} title="Judul" subtitle="Nama tampilan & tagline" />
        <form action={updateProjectSettings} className="space-y-3 p-5">
          <label className="block text-sm"><span className="mb-1 block text-muted">Judul project</span><Input name="name" defaultValue={project.name} required /></label>
          <label className="block text-sm"><span className="mb-1 block text-muted">Tagline</span><Input name="tagline" defaultValue={project.tagline ?? ""} placeholder="Satu kalimat pendek" /></label>
          <Button type="submit" size="sm">Simpan</Button>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <Head icon={AlignLeft} title="Deskripsi" subtitle="Tentang project ini" />
        <form action={updateProjectSettings} className="space-y-3 p-5">
          <textarea name="description" defaultValue={project.description ?? ""} maxLength={500} rows={6} placeholder="Jelaskan tujuan, cakupan, atau target project…"
            className="w-full rounded-xl border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent" />
          <div className="flex items-center justify-between"><span className="text-xs text-muted">maks. 500 karakter</span><Button type="submit" size="sm">Simpan</Button></div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <Head icon={Palette} title="Warna Brand" subtitle="Primer & sekunder" />
        <form action={updateProjectSettings} className="space-y-3 p-5">
          {[["primary", "Primer", primary], ["secondary", "Sekunder", secondary]].map(([k, label, val]) => (
            <label key={k} className="block text-sm">
              <span className="mb-1 block text-muted">{label}</span>
              <span className="flex items-center gap-2">
                <input type="color" name={k} defaultValue={val} className="h-10 w-12 cursor-pointer rounded-lg border border-border bg-white p-1" />
                <Input defaultValue={val} readOnly className="font-mono uppercase" />
              </span>
            </label>
          ))}
          <div className="h-12 rounded-xl text-center text-sm font-semibold leading-[3rem] text-white" style={{ background: `linear-gradient(90deg, ${primary}, ${secondary})` }}>Pratinjau gradien</div>
          <Button type="submit" size="sm">Simpan</Button>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <Head icon={Box} title="Aset Brand" subtitle="Logo & media" />
        <div className="space-y-4 p-5">
          {(brand.assets ?? []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted">Belum ada aset brand.</div>
          ) : (
            <ul className="grid grid-cols-3 gap-2">
              {brand.assets!.map((a) => (
                <li key={a.path} className="group relative rounded-xl border border-border bg-slate-50 p-2 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={a.name} className="mx-auto h-14 w-full object-contain" />
                  <div className="mt-1 truncate text-xs">{a.name}</div>
                  <form action={removeBrandAsset} className="absolute right-1 top-1 opacity-0 group-hover:opacity-100">
                    <input type="hidden" name="path" value={a.path} />
                    <button aria-label="Hapus" className="rounded-full bg-white p-1 text-red-600 shadow"><Trash2 size={12} /></button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <BrandAssetUploader projectId={project.id} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <Head icon={Globe} title="Detail" subtitle="Website, kategori & status" />
        <form action={updateProjectSettings} className="space-y-3 p-5">
          <label className="block text-sm"><span className="mb-1 block text-muted">Website</span><Input name="website" type="url" defaultValue={project.website ?? ""} placeholder="https://contoh.com" /></label>
          <label className="block text-sm"><span className="mb-1 block text-muted">Kategori</span><Input name="category" defaultValue={project.category ?? ""} placeholder="mis. Marketing, Ebook, Toko online" /></label>
          <label className="block text-sm"><span className="mb-1 block text-muted">Status</span>
            <select name="status" defaultValue={project.status ?? "active"} className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm">
              {STATUS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="block text-sm"><span className="mb-1 block text-muted">Tenggat</span><Input name="due_date" type="date" defaultValue={project.due_date ?? ""} /></label>
          <Button type="submit" size="sm">Simpan</Button>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <Head icon={Users} title="Akses" subtitle="Pemilik, editor & penonton" />
        <dl className="divide-y divide-border p-5 text-sm">
          <div className="py-2"><dt className="text-muted">Pemilik</dt><dd className="font-semibold">{ownerName}</dd></div>
          <div className="py-2"><dt className="text-muted">Dibuat</dt><dd className="font-semibold">{fmt(project.created_at)}</dd></div>
          <div className="py-2"><dt className="text-muted">Terakhir diubah</dt><dd className="font-semibold">{fmt((project as { updated_at?: string }).updated_at ?? project.created_at)}</dd></div>
        </dl>
        <p className="px-5 pb-5 text-xs text-muted">Undang anggota tim (editor/penonton) akan tersedia pada pembaruan berikutnya.</p>
      </Card>
    </div>
  );
}
