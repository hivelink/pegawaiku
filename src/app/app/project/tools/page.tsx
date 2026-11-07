import Link from "next/link";
import { KeyRound, Trash2 } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { toggleProjectTool } from "../../actions";
import { AddToolButton, type Tool } from "./add-tool";
import { ToolIcon } from "./tool-icon";

export default async function ProjectToolsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const { supabase, org, project } = await getContext();
  if (!org || !project) return <Card className="p-8 text-sm text-muted">Belum ada project.</Card>;

  const [{ data: tools }, { data: enabledRows }, { data: keyRows }] = await Promise.all([
    supabase.from("tools").select("key,name,description,category,icon,requires_key,is_available").order("sort"),
    supabase.from("project_tools").select("tool_key,created_at").eq("project_id", project.id),
    supabase.from("org_api_keys").select("provider").eq("org_id", org.id),
  ]);
  const all = (tools ?? []) as Tool[];
  const enabled = (enabledRows ?? []).map((r) => r.tool_key);
  const keys = (keyRows ?? []).map((r) => r.provider);
  const active = all.filter((t) => enabled.includes(t.key)).filter((t) => !sp.q || t.name.toLowerCase().includes(sp.q.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <form className="flex-1">
          <input name="q" defaultValue={sp.q} placeholder="Cari tool aktif…" className="h-11 w-full rounded-xl border border-border bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-accent" />
        </form>
        <AddToolButton tools={all} enabled={enabled} keys={keys} />
      </div>

      {active.length === 0 ? (
        <Card className="grid place-items-center border-dashed p-16 text-center">
          <h2 className="font-bold">Belum ada tool yang ditambahkan</h2>
          <p className="mt-1 text-sm text-muted">Klik <b>Tambah Tool</b> untuk mengaktifkan alat bantu pertama di project ini.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((t) => {
            const needKey = !!t.requires_key && !keys.includes(t.requires_key);
            return (
              <Card key={t.key} className="flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent text-white"><ToolIcon name={t.icon} size={20} /></span>
                  <div className="min-w-0 flex-1"><div className="font-bold">{t.name}</div><div className="text-xs text-muted">{t.category}</div></div>
                  <form action={toggleProjectTool}>
                    <input type="hidden" name="tool_key" value={t.key} /><input type="hidden" name="enable" value="0" />
                    <button aria-label="Hapus dari project" className="rounded-md p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button>
                  </form>
                </div>
                <p className="mt-3 flex-1 text-sm text-slate-600">{t.description}</p>
                {needKey ? (
                  <Link href="/app/settings/api-keys" className="mt-3 flex items-center gap-1 text-xs font-semibold text-amber-700"><KeyRound size={12} /> Butuh kunci API {t.requires_key} — atur di Pengaturan</Link>
                ) : (
                  <span className="mt-3 text-xs font-semibold text-emerald-700">Siap dipakai</span>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted">Tool yang aktif akan ditawarkan ke pegawai AI yang membutuhkannya (lihat &ldquo;Butuh tool&rdquo; di profil agent). Tool bertanda <i>Segera hadir</i> sedang disiapkan.</p>
    </div>
  );
}
