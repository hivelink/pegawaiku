import Link from "next/link";
import Image from "next/image";
import {
  Briefcase, ListChecks, Bot, Sparkles, Clapperboard, Wrench, HardDrive, LayoutTemplate, Users as UsersIcon, Lock,
} from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProjectMeta } from "../actions";

const STATUS_LABEL: Record<string, string> = { active: "Aktif", on_hold: "Ditunda", done: "Selesai", archived: "Arsip" };
const TASK_LABEL: Record<string, string> = { todo: "Antre", in_progress: "Berjalan", review: "Review", done: "Selesai", blocked: "Terhambat" };
const TASK_COLOR: Record<string, string> = {
  todo: "bg-slate-100 text-slate-700", in_progress: "bg-sky-100 text-sky-800", review: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-800", blocked: "bg-red-100 text-red-700",
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function Panel({
  icon: Icon, title, subtitle, children, className = "", locked = false, href,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>; title: string; subtitle: string;
  children: React.ReactNode; className?: string; locked?: boolean; href?: string;
}) {
  const head = (
    <div className="flex items-center gap-3">
      <span className={`grid h-11 w-11 place-items-center rounded-xl ${locked ? "bg-slate-200 text-slate-400" : "bg-gradient-to-br from-primary to-accent text-white"}`}>
        <Icon size={20} />
      </span>
      <div className="min-w-0">
        <div className={`font-bold ${locked ? "text-slate-400" : ""}`}>{title}</div>
        <div className="text-xs text-muted">{subtitle}</div>
      </div>
      {locked && <Lock size={14} className="ml-auto text-slate-400" />}
    </div>
  );
  return (
    <Card className={`flex flex-col p-5 ${className}`}>
      {href && !locked ? <Link href={href} className="hover:opacity-80">{head}</Link> : head}
      <div className="mt-4 flex-1">{children}</div>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full min-h-24 place-items-center text-center text-sm text-muted">{children}</div>;
}

export default async function ProjectWorkspacePage() {
  const { supabase, user, org, project } = await getContext();
  if (!org || !project) {
    return <Card className="p-8 text-sm text-muted">Belum ada project. Buat project baru lewat sidebar.</Card>;
  }

  const [{ data: tasks }, { data: hired }, { data: convs }, { data: files }, { data: members }, { data: owner }] = await Promise.all([
    supabase.from("tasks").select("id,title,status,agent:agents(display_name)").eq("project_id", project.id).order("updated_at", { ascending: false }),
    supabase.from("project_agents").select("agent:agents(slug,display_name,title,avatar_url)").eq("project_id", project.id).order("hired_at", { ascending: false }),
    supabase.from("conversations").select("id,title,updated_at,agent:agents(display_name,avatar_url)").eq("project_id", project.id).order("updated_at", { ascending: false }).limit(4),
    supabase.from("files").select("id,title,kind,size_bytes,created_at").eq("project_id", project.id).order("created_at", { ascending: false }).limit(5),
    supabase.from("org_members").select("role,user_id,profile:profiles(full_name,email,avatar_url)").eq("org_id", org.id),
    supabase.from("profiles").select("full_name,email").eq("id", project.created_by ?? org.owner_id).maybeSingle(),
  ]);

  type Task = { id: string; title: string; status: string; agent: { display_name: string } | null };
  type Hired = { agent: { slug: string; display_name: string; title: string; avatar_url: string } };
  type Conv = { id: string; title: string; updated_at: string; agent: { display_name: string; avatar_url: string } };
  type Member = { role: string; user_id: string; profile: { full_name: string | null; email: string | null; avatar_url: string | null } | null };

  const taskList = (tasks ?? []) as unknown as Task[];
  const hiredList = (hired ?? []) as unknown as Hired[];
  const convList = (convs ?? []) as unknown as Conv[];
  const memberList = (members ?? []) as unknown as Member[];
  const done = taskList.filter((t) => t.status === "done").length;
  const progress = taskList.length ? Math.round((done / taskList.length) * 100) : 0;
  const ownerName = owner?.full_name || owner?.email || user.email;

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-gradient-to-br from-sky-200 via-blue-100 to-transparent opacity-70 blur-2xl" />
        <div className="pointer-events-none absolute right-40 top-10 h-40 w-40 rounded-full bg-gradient-to-br from-indigo-200 to-transparent opacity-60 blur-2xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted"><Sparkles size={14} className="text-accent" /> Workspace AI</div>
          <h1 className="mt-2 text-3xl font-extrabold text-primary">{project.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {project.description || "Semua yang dibutuhkan tim AI Anda — pegawai, tugas, file, dan percakapan — di satu tempat."}
          </p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span><span className="text-muted">Pemilik</span> <strong>{ownerName}</strong></span>
            <span><span className="text-muted">Dibuat</span> <strong>{fmtDate(project.created_at)}</strong></span>
            <span><span className="text-muted">Status</span> <strong>{STATUS_LABEL[project.status ?? "active"]}</strong></span>
          </div>
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {/* Project */}
        <Panel icon={Briefcase} title="Project" subtitle="Ringkasan & detail">
          <div className="flex items-center justify-between text-sm"><span className="text-muted">Progres</span><strong>{progress}%</strong></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] uppercase tracking-wide text-muted">Pemilik</div><div className="truncate font-semibold">{ownerName}</div></div>
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] uppercase tracking-wide text-muted">Anggota</div><div className="font-semibold">{memberList.length || 1}</div></div>
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] uppercase tracking-wide text-muted">Tenggat</div><div className="font-semibold">{fmtDate(project.due_date)}</div></div>
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] uppercase tracking-wide text-muted">Status</div><div className="font-semibold">{STATUS_LABEL[project.status ?? "active"]}</div></div>
          </div>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold text-primary">Ubah detail</summary>
            <form action={updateProjectMeta} className="mt-2 space-y-2">
              <Input name="description" placeholder="Deskripsi project" defaultValue={project.description ?? ""} />
              <div className="flex gap-2">
                <Input name="due_date" type="date" defaultValue={project.due_date ?? ""} />
                <select name="status" defaultValue={project.status ?? "active"} className="h-10 rounded-xl border border-border bg-white px-2 text-sm">
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <Button type="submit" size="sm">Simpan</Button>
            </form>
          </details>
        </Panel>

        {/* Tasks */}
        <Panel icon={ListChecks} title="Tugas" subtitle="Item pekerjaan" href="/app/tasks">
          {taskList.length === 0 ? <Empty>Belum ada tugas. <Link href="/app/tasks" className="ml-1 font-semibold text-primary">Buat tugas →</Link></Empty> : (
            <ul className="space-y-2">
              {taskList.slice(0, 5).map((t) => (
                <li key={t.id} className="rounded-xl border border-border bg-slate-50 p-3 text-sm">
                  <div className="truncate font-medium">{t.title}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${TASK_COLOR[t.status]}`}>{TASK_LABEL[t.status]}</span>
                    {t.agent && <span className="text-xs text-muted">{t.agent.display_name}</span>}
                  </div>
                </li>
              ))}
              {taskList.length > 5 && <Link href="/app/tasks" className="block text-xs font-semibold text-primary">+{taskList.length - 5} lainnya →</Link>}
            </ul>
          )}
        </Panel>

        {/* Agents */}
        <Panel icon={Bot} title="Pegawai AI" subtitle="Agen yang direkrut" href="/app/agent">
          {hiredList.length === 0 ? <Empty>Belum ada pegawai. <Link href="/app/agent" className="ml-1 font-semibold text-primary">Rekrut →</Link></Empty> : (
            <ul className="space-y-2">
              {hiredList.slice(0, 5).map(({ agent }) => (
                <li key={agent.slug}>
                  <Link href={`/app/agent/${agent.slug}`} className="flex items-center gap-3 rounded-xl border border-border bg-slate-50 p-2.5 hover:bg-sky-50">
                    <Image src={agent.avatar_url} alt="" width={36} height={36} className="rounded-full" />
                    <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{agent.display_name}</div><div className="truncate text-xs text-muted">{agent.title}</div></div>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">aktif</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* AI / percakapan */}
        <Panel icon={Sparkles} title="AI" subtitle="Percakapan & hasil">
          {convList.length === 0 ? <Empty>Belum ada hasil. Mulai bekerja dengan pegawai AI.</Empty> : (
            <ul className="space-y-2">
              {convList.map((c) => (
                <li key={c.id}>
                  <Link href={`/app/chat/${c.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-slate-50 p-2.5 hover:bg-sky-50">
                    <Image src={c.agent.avatar_url} alt="" width={30} height={30} className="rounded-full" />
                    <div className="min-w-0"><div className="truncate text-sm font-medium">{c.title}</div><div className="text-xs text-muted">{c.agent.display_name} · {fmtDate(c.updated_at)}</div></div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Avatar */}
        <Panel icon={Clapperboard} title="Avatar" subtitle="Video + klon suara" locked>
          <Empty><div><div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><Clapperboard size={20} /></div>Segera hadir</div></Empty>
        </Panel>

        {/* Tools */}
        <Panel icon={Wrench} title="Tools" subtitle="Modul yang diaktifkan">
          <Empty>Belum ada tool yang ditambahkan.</Empty>
        </Panel>

        {/* Drive */}
        <Panel icon={HardDrive} title="Drive" subtitle="Dokumen & file" href="/app/drive">
          {(files ?? []).length === 0 ? <Empty>Belum ada file di Drive. <Link href="/app/drive" className="ml-1 font-semibold text-primary">Unggah →</Link></Empty> : (
            <ul className="space-y-1.5 text-sm">
              {(files ?? []).map((f) => (
                <li key={f.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <span className="truncate">{f.title}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted">{f.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Landing */}
        <Panel icon={LayoutTemplate} title="Landing" subtitle="Landing page & domain">
          <Empty>Belum ada landing page. Minta <Link href="/app/agent/vera-landing-page-builder" className="mx-1 font-semibold text-primary">Vera</Link> membuatnya.</Empty>
        </Panel>

        {/* Users */}
        <Panel icon={UsersIcon} title="Anggota" subtitle="Pengguna di organisasi">
          <ul className="space-y-2">
            {(memberList.length ? memberList : [{ role: "owner", user_id: user.id, profile: { full_name: null, email: user.email ?? null, avatar_url: null } }]).map((m) => {
              const name = m.profile?.full_name || m.profile?.email || "Anggota";
              const initial = name.slice(0, 1).toUpperCase();
              return (
                <li key={m.user_id} className="flex items-center gap-3 rounded-xl border border-border bg-slate-50 p-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-bold text-white">{initial}</span>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{name}</div><div className="truncate text-xs text-muted">{m.profile?.email}</div></div>
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-primary">{m.role}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
