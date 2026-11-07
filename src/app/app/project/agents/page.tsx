import Link from "next/link";
import Image from "next/image";
import { Sparkles, Bot, Plus, X } from "lucide-react";
import { getContext } from "@/lib/context";
import { CATEGORIES } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { removeAgentFromProject, startConversation } from "../../actions";

export default async function ProjectAgentsPage({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  const sp = await searchParams;
  const { supabase, project } = await getContext();
  if (!project) return <Card className="p-8 text-sm text-muted">Belum ada project.</Card>;

  const { data } = await supabase
    .from("project_agents")
    .select("hired_at,agent:agents(id,slug,display_name,title,category,description,avatar_url,model_hint)")
    .eq("project_id", project.id)
    .order("hired_at", { ascending: false });
  type Row = { hired_at: string; agent: { id: string; slug: string; display_name: string; title: string; category: string; description: string; avatar_url: string; model_hint: string | null } };
  let rows = (data ?? []) as unknown as Row[];
  const cat = sp.cat ?? "all";
  if (cat !== "all") rows = rows.filter((r) => r.agent.category === cat);
  const cats = ["all", ...Array.from(new Set(((data ?? []) as unknown as Row[]).map((r) => r.agent.category)))];

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-sky-200 to-transparent opacity-70 blur-2xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted"><Sparkles size={14} className="text-accent" /> Tim AI</div>
          <h1 className="mt-2 text-3xl font-extrabold text-primary">Pegawai AI</h1>
          <p className="mt-1 text-sm text-muted">{(data ?? []).length} pegawai AI siap mengerjakan tugas di project <b>{project.name}</b>.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-border bg-white p-1 text-sm">
              {cats.map((c) => (
                <Link key={c} href={`/app/project/agents${c === "all" ? "" : `?cat=${c}`}`}
                  className={`rounded-lg px-3 py-1.5 ${cat === c ? "bg-primary text-white" : "hover:bg-slate-100"}`}>
                  {c === "all" ? "Semua" : CATEGORIES.find((x) => x.key === c)?.label ?? c}
                </Link>
              ))}
            </div>
            <Link href="/app/agent" className={buttonVariants({ variant: "accent", size: "sm" })}><Plus size={14} /> Tambah pegawai</Link>
          </div>
        </div>
      </section>

      {rows.length === 0 ? (
        <Card className="grid place-items-center p-16 text-center">
          <span className="grid h-20 w-20 place-items-center rounded-full bg-sky-50 text-primary"><Bot size={34} /></span>
          <h2 className="mt-4 font-bold">Belum ada pegawai</h2>
          <p className="mt-1 max-w-sm text-sm text-muted">Rekrut pegawai AI ke project ini supaya mereka muncul di sini dan bisa diberi tugas.</p>
          <Link href="/app/agent" className={buttonVariants({ className: "mt-5" })}>Cari pegawai</Link>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ agent, hired_at }) => (
            <Card key={agent.id} className="group relative flex flex-col p-5">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">✦ Claude{agent.model_hint ? ` · ${agent.model_hint}` : ""}</span>
                <form action={removeAgentFromProject}>
                  <input type="hidden" name="agent_id" value={agent.id} />
                  <button aria-label="Keluarkan dari project" title="Keluarkan dari project" className="rounded-md p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"><X size={16} /></button>
                </form>
              </div>
              <Link href={`/app/agent/${agent.slug}`} className="mt-3 flex items-center gap-3">
                <Image src={agent.avatar_url} alt={agent.display_name} width={64} height={64} className="rounded-full ring-2 ring-slate-100" />
                <div><div className="text-lg font-bold">{agent.display_name}</div><div className="text-sm text-muted">{agent.title}</div></div>
              </Link>
              <p className="mt-3 line-clamp-3 flex-1 text-sm text-slate-600">{agent.description.split(". Trigger")[0]}.</p>
              <div className="mt-4 flex items-center justify-between text-xs text-muted">
                <span>Bergabung {new Date(hired_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</span>
                <form action={startConversation}>
                  <input type="hidden" name="agent_id" value={agent.id} />
                  <button className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-2">Beri tugas</button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
