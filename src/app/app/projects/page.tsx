import Link from "next/link";
import Image from "next/image";
import { FolderOpen, Plus, ArrowRight, CalendarDays } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { createProject } from "../actions";
import { ProjectList } from "../project-list";

const STATUS_LABEL: Record<string, string> = { active: "Aktif", on_hold: "Ditunda", done: "Selesai", archived: "Arsip" };

/** Halaman Project: project yang sedang aktif, daftar semua project, dan isian membuat project baru. */
export default async function ProjectsPage() {
  const { supabase, project, projects } = await getContext();
  const [{ count: tasks }, { count: agents }, { count: files }] = project
    ? await Promise.all([
        supabase.from("tasks").select("id", { count: "exact", head: true }).eq("project_id", project.id),
        supabase.from("project_agents").select("agent_id", { count: "exact", head: true }).eq("project_id", project.id),
        supabase.from("files").select("id", { count: "exact", head: true }).eq("project_id", project.id),
      ])
    : [{ count: 0 }, { count: 0 }, { count: 0 }];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-primary"><FolderOpen /> Project</h1>
        <p className="text-sm text-muted">Pilih project untuk dikerjakan, atau buat project baru.</p>
      </div>

      {project ? (
        <Card className="flex flex-wrap items-center gap-4 p-5">
          {project.image_url
            ? <Image src={project.image_url} alt="" width={64} height={64} className="h-16 w-16 rounded-2xl object-cover" />
            : <span className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent text-2xl font-extrabold text-white">{project.name.slice(0, 1).toUpperCase()}</span>}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-accent">Project aktif</div>
            <div className="truncate text-xl font-extrabold">{project.name}</div>
            {project.tagline && <div className="truncate text-sm text-muted">{project.tagline}</div>}
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
              <span>{STATUS_LABEL[project.status ?? "active"] ?? project.status}</span>
              {project.due_date && <span className="flex items-center gap-1"><CalendarDays size={12} /> {new Date(project.due_date).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</span>}
              <Link href="/app/project/agents" className="hover:text-primary">{agents ?? 0} agent</Link>
              <Link href="/app/tasks" className="hover:text-primary">{tasks ?? 0} tugas</Link>
              <Link href="/app/project/drive" className="hover:text-primary">{files ?? 0} file</Link>
            </div>
          </div>
          <Link href="/app/project" className={buttonVariants({})}>Buka workspace <ArrowRight size={16} /></Link>
        </Card>
      ) : (
        <Card className="p-5 text-sm text-muted">Belum ada project. Buat project pertama di bawah.</Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-bold">Semua project ({projects.length})</h2>
          <p className="mb-3 text-xs text-muted">Klik nama untuk menjadikannya project aktif. Menu ⋯ untuk pengaturan, ubah nama, atau hapus.</p>
          <ProjectList projects={projects.map((p) => ({ id: p.id, name: p.name }))} activeId={project?.id ?? null} />
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 font-bold"><Plus size={18} /> Buat project baru</h2>
          <form action={createProject} className="space-y-3">
            <Input name="name" placeholder="Nama project, mis. Ebook Cerita Anak" required maxLength={80} />
            <Textarea name="description" placeholder="Deskripsi singkat (opsional) — tujuan, produk, target audiens" rows={3} />
            <Button type="submit">Buat project</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
