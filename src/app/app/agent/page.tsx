import Link from "next/link";
import Image from "next/image";
import { getContext } from "@/lib/context";
import { CATEGORIES } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function AgentMarketplace({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string }> }) {
  const sp = await searchParams;
  const { supabase, project } = await getContext();
  let query = supabase.from("agents").select("id,slug,display_name,title,category,description,avatar_url,stats").eq("is_active", true).order("display_name");
  if (sp.cat && sp.cat !== "all") query = query.eq("category", sp.cat);
  if (sp.q) query = query.or(`display_name.ilike.%${sp.q}%,title.ilike.%${sp.q}%,description.ilike.%${sp.q}%`);
  const [{ data: agents }, { data: hired }] = await Promise.all([
    query,
    project ? supabase.from("project_agents").select("agent_id").eq("project_id", project.id) : Promise.resolve({ data: [] as { agent_id: string }[] }),
  ]);
  const hiredSet = new Set((hired ?? []).map((h) => h.agent_id));

  return (
    <div>
      <h1 className="text-center text-4xl font-extrabold tracking-tight text-primary">Temukan Pegawai AI</h1>
      <form className="mx-auto mt-6 max-w-2xl">
        <input type="hidden" name="cat" value={sp.cat ?? "all"} />
        <input name="q" defaultValue={sp.q} placeholder="Cari pegawai AI apa saja" className="h-12 w-full rounded-2xl border border-border bg-card px-5 shadow-sm outline-none focus:ring-2 focus:ring-accent" />
      </form>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {CATEGORIES.map((c) => {
          const active = (sp.cat ?? "all") === c.key;
          return (
            <Link key={c.key} href={`/app/agent?cat=${c.key}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}
              className={`rounded-full border px-4 py-1.5 text-sm ${active ? "border-primary bg-primary text-white" : "border-border bg-card hover:bg-slate-50"}`}>
              {c.emoji} {c.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {(agents ?? []).map((a) => (
          <Card key={a.id} className="flex flex-col overflow-hidden">
            <Link href={`/app/agent/${a.slug}`} className="block bg-gradient-to-br from-slate-100 to-sky-50 p-6">
              <div className="flex items-center gap-3">
                <Image src={a.avatar_url} alt={a.display_name} width={56} height={56} className="rounded-full ring-4 ring-white" />
                <div>
                  <div className="text-lg font-bold">{a.display_name}</div>
                  <div className="text-sm text-muted">{a.title}</div>
                </div>
              </div>
            </Link>
            <div className="flex flex-1 flex-col p-5">
              <p className="line-clamp-3 flex-1 text-sm text-slate-600">{a.description.split(". Trigger")[0]}.</p>
              <div className="mt-4 flex items-center justify-between">
                <Badge>{CATEGORIES.find((c) => c.key === a.category)?.label}</Badge>
                <Link href={`/app/agent/${a.slug}`} className={`rounded-xl px-4 py-2 text-sm font-semibold ${hiredSet.has(a.id) ? "bg-sky-50 text-primary" : "bg-primary text-white hover:bg-primary-2"}`}>
                  {hiredSet.has(a.id) ? "Sudah direkrut" : "+ Rekrut"}
                </Link>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {(agents ?? []).length === 0 && (
        <p className="mt-10 text-center text-sm text-muted">Belum ada agent. Jalankan <code>npm run seed:agents</code> untuk mengisi katalog.</p>
      )}
    </div>
  );
}
