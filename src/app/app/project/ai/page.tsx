import Link from "next/link";
import { Image as ImageIcon, Video, Type, AudioLines, Sparkles, KeyRound, Gift } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { Studio } from "./studio";

export type AiModel = {
  id: string; provider: string; name: string; kind: "image" | "video" | "text" | "audio";
  pricing: string; price_usd: number | null; free_tier: boolean; key_provider: string; notes: string | null;
};
const KIND: Record<string, { label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  image: { label: "Gambar", icon: ImageIcon }, video: { label: "Video", icon: Video }, text: { label: "Teks", icon: Type }, audio: { label: "Audio", icon: AudioLines },
};

export default async function ProjectAiPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const sp = await searchParams;
  const { supabase, org, project } = await getContext();
  if (!org || !project) return <Card className="p-8 text-sm text-muted">Belum ada project.</Card>;

  const [{ data: models }, { data: keyRows }, { data: gens }] = await Promise.all([
    supabase.from("ai_models").select("id,provider,name,kind,pricing,price_usd,free_tier,key_provider,notes").eq("is_active", true).order("sort"),
    supabase.from("org_api_keys").select("provider").eq("org_id", org.id),
    supabase.from("generations").select("id,kind,prompt,status,output_url,created_at,model_id").eq("project_id", project.id).order("created_at", { ascending: false }).limit(24),
  ]);
  const list = (models ?? []) as AiModel[];
  const keys = (keyRows ?? []).map((k) => k.provider);
  const kind = (sp.kind as string) || "all";
  const shown = kind === "all" ? list : list.filter((m) => m.kind === kind);
  const providers = Array.from(new Set(shown.map((m) => m.provider)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-primary">Studio AI</h1>
        <div className="flex rounded-xl border border-border bg-white p-1 text-sm">
          {[["all", "Semua", Sparkles], ...Object.entries(KIND).map(([k, v]) => [k, v.label, v.icon])].map(([k, label, Icon]) => {
            const I = Icon as React.ComponentType<{ size?: number }>;
            return (
              <Link key={k as string} href={`/app/project/ai${k === "all" ? "" : `?kind=${k}`}`} className={`flex items-center gap-1 rounded-lg px-3 py-1.5 ${kind === k ? "bg-primary text-white" : "hover:bg-slate-100"}`}>
                <I size={14} /> {label as string}
              </Link>
            );
          })}
        </div>
      </div>

      <Studio models={list} keys={keys} projectId={project.id} generations={(gens ?? []) as never} />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">Referensi model AI</h2>
          <Link href="/app/settings/api-keys" className="flex items-center gap-1 text-sm font-semibold text-primary"><KeyRound size={14} /> Atur kunci API</Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {providers.map((p) => (
            <Card key={p} className="p-4">
              <div className="mb-2 text-sm font-bold">{p}</div>
              <ul className="divide-y divide-border">
                {shown.filter((m) => m.provider === p).map((m) => {
                  const K = KIND[m.kind];
                  const hasKey = keys.includes(m.key_provider);
                  return (
                    <li key={m.id} className="flex items-center gap-3 py-2 text-sm">
                      <K.icon size={16} className="shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{m.name}</span>
                          {m.free_tier && <span className="flex items-center gap-0.5 rounded-md bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-700"><Gift size={10} /> ada gratis</span>}
                          <span className={`rounded-md px-1.5 text-[10px] font-semibold ${hasKey ? "bg-sky-50 text-primary" : "bg-slate-100 text-slate-500"}`}>{hasKey ? "kunci tersedia" : `kunci ${m.key_provider}`}</span>
                        </div>
                        {m.notes && <div className="truncate text-xs text-muted">{m.notes}</div>}
                      </div>
                      <span className="shrink-0 text-xs text-muted">{m.pricing}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Harga adalah perkiraan publik per November 2026 dan bisa berubah; biaya nyata dihitung dari tagihan provider masing-masing. Model dengan label <i>ada gratis</i> punya kuota gratis atau bisa dijalankan sendiri (open-weights).</p>
      </section>
    </div>
  );
}
