import Link from "next/link";
import Image from "next/image";
import { MessagesSquare, Plus } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { startGroupChat } from "../../actions";
import { SubmitOnce } from "../../tasks/task-controls";
import { DeleteChat } from "./delete-chat";

type A = { id: string; slug: string; display_name: string; title: string; avatar_url: string };

/** Semua diskusi (chat) di project aktif + mulai diskusi baru dengan satu atau beberapa agent. */
export default async function ProjectChatPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  const { supabase, project } = await getContext();
  if (!project) return <Card className="p-8 text-sm text-muted">Belum ada project. Buat project di menu <a className="text-primary underline" href="/app/projects">Project</a>.</Card>;

  const [{ data: convs }, { data: hired }] = await Promise.all([
    supabase.from("conversations").select("id,title,updated_at,agent:agents(id,slug,display_name,title,avatar_url)").eq("project_id", project.id).order("updated_at", { ascending: false }).limit(100),
    supabase.from("project_agents").select("agent:agents(id,slug,display_name,title,avatar_url)").eq("project_id", project.id),
  ]);
  type C = { id: string; title: string | null; updated_at: string; agent: A | null };
  const list = (convs ?? []) as unknown as C[];
  const ids = list.map((c) => c.id);
  const partRes = ids.length ? await supabase.from("conversation_agents").select("conversation_id,agent:agents(id,slug,display_name,title,avatar_url)").in("conversation_id", ids) : { data: [] as unknown[] };
  const parts = new Map<string, A[]>();
  for (const r of (partRes.data ?? []) as unknown as { conversation_id: string; agent: A | null }[]) {
    if (!r.agent) continue;
    const arr = parts.get(r.conversation_id) ?? []; arr.push(r.agent); parts.set(r.conversation_id, arr);
  }
  const agents = ((hired ?? []) as unknown as { agent: A | null }[]).map((h) => h.agent).filter(Boolean) as A[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-primary"><MessagesSquare /> Chat · {project.name}</h1>
        <p className="text-sm text-muted">Semua diskusi dengan pegawai AI di project ini. Di dalam chat, panggil agent lain dengan @nama.</p>
      </div>

      <Card className="p-5">
        <h2 className="mb-3 flex items-center gap-2 font-bold"><Plus size={18} /> Mulai diskusi baru</h2>
        {agents.length === 0 ? (
          <p className="text-sm text-muted">Belum ada agent di project ini. <Link href="/app/agent" className="text-primary underline">Rekrut agent</Link> dulu.</p>
        ) : (
          <form action={startGroupChat} className="space-y-3">
            <Input name="title" placeholder="Topik diskusi (opsional), mis. Persiapan seminar K3" maxLength={80} />
            <div className="flex flex-wrap gap-2">
              {agents.map((a, i) => (
                <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-sky-50">
                  <input type="checkbox" name="agent_id" value={a.id} defaultChecked={i === 0} className="sr-only" />
                  <Image src={a.avatar_url} alt="" width={26} height={26} className="rounded-full" />
                  <b>{a.display_name}</b>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted">Pilih satu agent untuk chat biasa, atau beberapa agent untuk diskusi bersama. Agent pertama yang dipilih menjadi pemimpin diskusi.</p>
            {sp.err === "agent" && <p className="text-sm text-red-600">Pilih minimal satu agent.</p>}
            <SubmitOnce>Mulai diskusi</SubmitOnce>
          </form>
        )}
      </Card>

      <Card className="divide-y divide-border">
        {list.length === 0 && <div className="p-6 text-sm text-muted">Belum ada percakapan di project ini.</div>}
        {list.map((c) => {
          const ps = parts.get(c.id) ?? (c.agent ? [c.agent] : []);
          return (
            <div key={c.id} className="flex items-center gap-3 p-3">
              <Link href={`/app/chat/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80">
                <div className="flex shrink-0 -space-x-2">
                  {ps.slice(0, 4).map((a) => <Image key={a.id} src={a.avatar_url} alt={a.display_name} width={32} height={32} className="rounded-full ring-2 ring-white" />)}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{c.title || "Percakapan baru"}</div>
                  <div className="truncate text-xs text-muted">{ps.map((a) => a.display_name).join(", ")} · {new Date(c.updated_at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              </Link>
              <DeleteChat id={c.id} />
            </div>
          );
        })}
      </Card>
    </div>
  );
}
