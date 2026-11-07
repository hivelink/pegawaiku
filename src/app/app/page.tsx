import Link from "next/link";
import Image from "next/image";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export default async function AppHome() {
  const { supabase, project, org } = await getContext();

  if (!org) {
    return (
      <Card className="p-8">
        <h1 className="text-xl font-bold">Database belum siap</h1>
        <p className="mt-2 text-sm text-muted">
          Organisasi untuk akun ini belum dibuat. Pastikan migrasi <code>supabase/migrations/0001_init.sql</code> sudah dijalankan
          sebelum akun dibuat (trigger <code>handle_new_user</code>), lalu daftar ulang.
        </p>
      </Card>
    );
  }

  const [{ data: hired }, { data: convs }, { data: tasks }] = await Promise.all([
    project ? supabase.from("project_agents").select("agent:agents(slug,display_name,title,avatar_url)").eq("project_id", project.id) : Promise.resolve({ data: [] }),
    project ? supabase.from("conversations").select("id,title,updated_at,agent:agents(display_name,avatar_url)").eq("project_id", project.id).order("updated_at", { ascending: false }).limit(6) : Promise.resolve({ data: [] }),
    project ? supabase.from("tasks").select("id,title,status").eq("project_id", project.id).neq("status", "done").limit(6) : Promise.resolve({ data: [] }),
  ]);

  type Hired = { agent: { slug: string; display_name: string; title: string; avatar_url: string } };
  type Conv = { id: string; title: string; updated_at: string; agent: { display_name: string; avatar_url: string } };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-br from-primary to-primary-2 p-8 text-white">
        <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">Workspace: {project?.name ?? "—"}</span>
        <h1 className="mt-3 text-3xl font-extrabold">Bangun tim AI pertamamu hari ini.</h1>
        <p className="mt-2 max-w-xl text-white/80">Rekrut agen, beri brief, dan jalankan pekerjaan — semua dari satu workspace.</p>
        <Link href="/app/agent" className={buttonVariants({ variant: "accent", className: "mt-5" })}>Temukan pegawai AI →</Link>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <h2 className="font-bold">Pegawai di project ini</h2>
          <div className="mt-3 space-y-2">
            {((hired ?? []) as unknown as Hired[]).map(({ agent }) => (
              <Link key={agent.slug} href={`/app/agent/${agent.slug}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-slate-50">
                <Image src={agent.avatar_url} alt="" width={36} height={36} className="rounded-full" />
                <div><div className="text-sm font-semibold">{agent.display_name}</div><div className="text-xs text-muted">{agent.title}</div></div>
              </Link>
            ))}
            {(hired ?? []).length === 0 && <p className="text-sm text-muted">Belum ada yang direkrut. Mulai dari tab Agent.</p>}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-bold">Percakapan terbaru</h2>
          <div className="mt-3 space-y-2">
            {((convs ?? []) as unknown as Conv[]).map((c) => (
              <Link key={c.id} href={`/app/chat/${c.id}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-slate-50">
                <Image src={c.agent.avatar_url} alt="" width={32} height={32} className="rounded-full" />
                <div className="min-w-0"><div className="truncate text-sm font-semibold">{c.title}</div><div className="text-xs text-muted">{c.agent.display_name}</div></div>
              </Link>
            ))}
            {(convs ?? []).length === 0 && <p className="text-sm text-muted">Belum ada percakapan.</p>}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-bold">Task terbuka</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(tasks ?? []).map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"><span className="truncate">{t.title}</span><span className="text-xs text-muted">{t.status}</span></li>
            ))}
            {(tasks ?? []).length === 0 && <p className="text-sm text-muted">Tidak ada task terbuka.</p>}
          </ul>
          <Link href="/app/tasks" className="mt-3 inline-block text-sm font-semibold text-primary">Buka board →</Link>
        </Card>
      </div>
    </div>
  );
}
