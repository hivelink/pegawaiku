import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bookmark, BadgeCheck, Briefcase, Clock, Check, Plus, Trash2, Sparkles } from "lucide-react";
import { getContext } from "@/lib/context";
import { categoryLabel } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { hireAgent, toggleBookmark, startConversation, toggleAgentSkill, deleteKnowledge, addKnowledgeManual } from "../../actions";
import { LearnForm } from "./learn-form";

export default async function AgentProfile({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string; hired?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { supabase, project, user, org } = await getContext();
  const { data: agent } = await supabase.from("agents").select("*").eq("slug", slug).single();
  if (!agent) notFound();

  const [{ data: hired }, { data: bm }, { data: convs }, { data: skills }, { data: attached }, { data: knowledge }] = await Promise.all([
    project ? supabase.from("project_agents").select("agent_id").eq("project_id", project.id).eq("agent_id", agent.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("agent_bookmarks").select("agent_id").eq("user_id", user.id).eq("agent_id", agent.id).maybeSingle(),
    project ? supabase.from("conversations").select("id,title,updated_at").eq("project_id", project.id).eq("agent_id", agent.id).order("updated_at", { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
    supabase.from("skills").select("key,name,description,category,requires_tools").order("category").order("name"),
    org ? supabase.from("agent_skills").select("skill_key").eq("org_id", org.id).eq("agent_id", agent.id) : Promise.resolve({ data: [] }),
    org ? supabase.from("agent_knowledge").select("id,title,content,sources,created_at").eq("org_id", org.id).eq("agent_id", agent.id).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const attachedSet = new Set((attached ?? []).map((a) => a.skill_key));
  const SKILL_CAT: Record<string, string> = { riset: "Riset", penulisan: "Penulisan", analisis: "Analisis", kreatif: "Kreatif", operasional: "Operasional" };
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
          {[["feed", "Feed"], ["jobdesk", "Job desk"], ["skill", `Skill${attachedSet.size + (knowledge ?? []).length ? ` (${attachedSet.size + (knowledge ?? []).length})` : ""}`]].map(([k, label]) => (
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
        ) : tab === "skill" ? (
          <div className="mt-5 space-y-6">
            <LearnForm agentId={agent.id} agentName={agent.display_name} />

            <section>
              <h3 className="flex items-center gap-2 font-bold"><Sparkles size={16} className="text-accent" /> Pengetahuan yang dipelajari</h3>
              <p className="text-xs text-muted">Panduan hasil belajar dari internet atau catatan Anda. Otomatis disertakan setiap kali {agent.display_name} bekerja.</p>
              {(knowledge ?? []).length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-muted">Belum ada. Minta {agent.display_name} mempelajari topik di atas, atau tambahkan catatan sendiri di bawah.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {(knowledge ?? []).map((k) => (
                    <li key={k.id} className="rounded-xl border border-border bg-slate-50 p-3">
                      <details>
                        <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold">
                          <span>{k.title}</span>
                          <span className="text-xs font-normal text-muted">{new Date(k.created_at).toLocaleDateString("id-ID")}</span>
                        </summary>
                        <div className="prose-chat mt-2 whitespace-pre-wrap text-sm text-slate-700">{k.content}</div>
                        {Array.isArray(k.sources) && k.sources.length > 0 && (
                          <div className="mt-2 text-xs text-muted">Sumber: {(k.sources as { title?: string; url: string }[]).map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer" className="mr-2 underline">{s.title || s.url}</a>)}</div>
                        )}
                        <form action={deleteKnowledge} className="mt-2">
                          <input type="hidden" name="id" value={k.id} /><input type="hidden" name="slug" value={agent.slug} />
                          <button className="flex items-center gap-1 text-xs text-red-600"><Trash2 size={12} /> Hapus</button>
                        </form>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold text-primary">+ Tambah catatan pengetahuan sendiri</summary>
                <form action={addKnowledgeManual} className="mt-2 space-y-2">
                  <input type="hidden" name="agent_id" value={agent.id} /><input type="hidden" name="slug" value={agent.slug} />
                  <input name="title" placeholder="Judul (mis. Aturan brand kami)" required className="h-10 w-full rounded-xl border border-border px-3 text-sm" />
                  <textarea name="content" rows={4} placeholder="Isi panduan/aturan yang harus diingat agent…" required className="w-full rounded-xl border border-border px-3 py-2 text-sm" />
                  <Button type="submit" size="sm">Simpan</Button>
                </form>
              </details>
            </section>

            <section>
              <h3 className="font-bold">Skill tambahan</h3>
              <p className="text-xs text-muted">Pasang kemampuan lintas bidang ke {agent.display_name}. Berlaku untuk semua project di organisasi Anda.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(skills ?? []).map((sk) => {
                  const on = attachedSet.has(sk.key);
                  return (
                    <div key={sk.key} className={`flex items-start gap-3 rounded-xl border p-3 ${on ? "border-emerald-200 bg-emerald-50/50" : "border-border"}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold">{sk.name} <span className="rounded-md bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-600">{SKILL_CAT[sk.category] ?? sk.category}</span></div>
                        <div className="text-xs text-muted">{sk.description}</div>
                        {sk.requires_tools?.length > 0 && <div className="mt-0.5 text-[10px] text-muted">tool: {sk.requires_tools.join(", ")}</div>}
                      </div>
                      <form action={toggleAgentSkill}>
                        <input type="hidden" name="agent_id" value={agent.id} /><input type="hidden" name="skill_key" value={sk.key} /><input type="hidden" name="slug" value={agent.slug} /><input type="hidden" name="enable" value={on ? "0" : "1"} />
                        <button aria-label={on ? "Lepas" : "Pasang"} className={`grid h-8 w-8 place-items-center rounded-lg border ${on ? "border-emerald-300 bg-emerald-100 text-emerald-700" : "border-border hover:bg-slate-50"}`}>{on ? <Check size={14} /> : <Plus size={14} />}</button>
                      </form>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ) : (
          <pre className="mt-5 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm leading-relaxed">{agent.system_prompt}</pre>
        )}
      </Card>
    </div>
  );
}
