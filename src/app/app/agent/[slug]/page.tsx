import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bookmark, BadgeCheck, Briefcase, Clock } from "lucide-react";
import { getContext } from "@/lib/context";
import { categoryLabel } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { hireAgent, toggleBookmark, startConversation } from "../../actions";

export default async function AgentProfile({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string; hired?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { supabase, project, user } = await getContext();
  const { data: agent } = await supabase.from("agents").select("*").eq("slug", slug).single();
  if (!agent) notFound();

  const [{ data: hired }, { data: bm }, { data: convs }] = await Promise.all([
    project ? supabase.from("project_agents").select("agent_id").eq("project_id", project.id).eq("agent_id", agent.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("agent_bookmarks").select("agent_id").eq("user_id", user.id).eq("agent_id", agent.id).maybeSingle(),
    project ? supabase.from("conversations").select("id,title,updated_at").eq("project_id", project.id).eq("agent_id", agent.id).order("updated_at", { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
  ]);
  const isHired = !!hired;
  const tab = sp.tab ?? "feed";

  return (
    <div>
      <div className="h-40 rounded-3xl bg-gradient-to-r from-primary via-primary-2 to-accent" />
      <Card className="-mt-12 mx-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-end gap-4">
            <Image src={agent.avatar_url} alt={agent.display_name} width={96} height={96} className="-mt-16 rounded-full ring-4 ring-white" />
            <div>
              <h1 className="flex items-center gap-1 text-2xl font-extrabold">{agent.display_name} <BadgeCheck className="text-accent" size={20} /></h1>
              <div className="text-sm text-muted">@{agent.handle}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <form action={toggleBookmark}>
              <input type="hidden" name="agent_id" value={agent.id} /><input type="hidden" name="slug" value={agent.slug} />
              <Button variant="outline" type="submit" aria-label="Simpan"><Bookmark size={16} className={bm ? "fill-primary text-primary" : ""} /></Button>
            </form>
            {isHired ? (
              <form action={startConversation}>
                <input type="hidden" name="agent_id" value={agent.id} />
                <Button type="submit" variant="accent">Mulai bekerja</Button>
              </form>
            ) : (
              <form action={hireAgent}>
                <input type="hidden" name="agent_id" value={agent.id} /><input type="hidden" name="slug" value={agent.slug} />
                <Button type="submit">+ Rekrut</Button>
              </form>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted">
          <span className="flex items-center gap-1"><Briefcase size={14} /> {agent.title}</span>
          <span>{categoryLabel(agent.category)}</span>
          <span className="flex items-center gap-1"><Clock size={14} /> Selalu aktif</span>
        </div>
        <div className="mt-3 flex gap-6 text-sm">
          <span><b>{agent.stats?.projects ?? 0}</b> Project</span>
          <span><b>{agent.stats?.tasks ?? 0}</b> Tasks</span>
        </div>
        {sp.hired && <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-primary">{agent.display_name} sudah bergabung ke project <b>{project?.name}</b>. Klik &ldquo;Mulai bekerja&rdquo; untuk memberi brief.</p>}

        <div className="mt-6 flex border-b border-border">
          {[["feed", "Feed"], ["jobdesk", "Job desk"]].map(([k, label]) => (
            <Link key={k} href={`/app/agent/${agent.slug}?tab=${k}`} className={`px-5 py-2 text-sm font-semibold ${tab === k ? "border-b-2 border-accent text-primary" : "text-muted"}`}>{label}</Link>
          ))}
        </div>

        {tab === "feed" ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase text-muted">Tersemat</div>
              <p className="mt-1 text-sm">{agent.description}</p>
              {agent.requires_tools?.length > 0 && <p className="mt-2 text-xs text-muted">Butuh tool: {agent.requires_tools.join(", ")}</p>}
            </div>
            {(convs ?? []).length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase text-muted">Percakapan di project ini</div>
                <ul className="mt-2 space-y-1">
                  {(convs ?? []).map((c) => <li key={c.id}><Link className="text-sm text-primary hover:underline" href={`/app/chat/${c.id}`}>{c.title}</Link></li>)}
                </ul>
              </div>
            )}
            {!isHired && (
              <div className="rounded-2xl border border-dashed border-border p-6 text-center">
                <div className="font-bold">Tertarik merekrut {agent.display_name}?</div>
                <p className="mt-1 text-sm text-muted">Tambahkan ke project-mu dan langsung mulai bekerja sama.</p>
                <form action={hireAgent} className="mt-3">
                  <input type="hidden" name="agent_id" value={agent.id} /><input type="hidden" name="slug" value={agent.slug} />
                  <Button type="submit">+ Rekrut Sekarang</Button>
                </form>
              </div>
            )}
          </div>
        ) : (
          <pre className="mt-5 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm leading-relaxed">{agent.system_prompt}</pre>
        )}
      </Card>
    </div>
  );
}
