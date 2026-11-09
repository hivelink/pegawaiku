import Link from "next/link";
import { HardDrive, FolderOpen } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { UploadForm } from "./upload-form";
import { FileGrid, signFiles } from "./file-grid";

/** Drive global: semua file dari semua project di organisasi, dikelompokkan per project. */
export default async function DrivePage() {
  const { supabase, project, projects } = await getContext();
  if (!projects.length) return <Card className="p-8 text-sm text-muted">Belum ada project. Buat project di menu Project.</Card>;
  const { data } = await supabase.from("files").select("id,title,kind,size_bytes,storage_path,project_id").in("project_id", projects.map((p) => p.id)).order("created_at", { ascending: false }).limit(500);
  const rows = data ?? [];
  const signed = await signFiles(supabase, rows);
  const byProject = new Map<string, typeof signed>();
  rows.forEach((r, i) => { const list = byProject.get(r.project_id) ?? []; list.push(signed[i]); byProject.set(r.project_id, list); });
  // project aktif di atas, lalu project lain yang punya file
  const ordered = [...projects].sort((a, b) => (a.id === project?.id ? -1 : b.id === project?.id ? 1 : 0));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-primary"><HardDrive /> Drive</h1>
          <p className="text-sm text-muted">Semua file dari {projects.length} project, dikelompokkan per project ({rows.length} file).</p>
        </div>
        {project && <div className="flex items-center gap-2 text-xs text-muted">Unggah ke <b className="text-foreground">{project.name}</b> <UploadForm projectId={project.id} /></div>}
      </div>
      {ordered.map((p) => {
        const files = byProject.get(p.id) ?? [];
        if (!files.length && p.id !== project?.id) return null;
        return (
          <section key={p.id} className="space-y-3">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <FolderOpen size={18} className={p.id === project?.id ? "text-accent" : "text-slate-400"} />
              <h2 className="font-bold">{p.name}</h2>
              {p.id === project?.id && <span className="rounded-full bg-sky-100 px-2 text-[11px] font-semibold text-primary">aktif</span>}
              <span className="text-xs text-muted">{files.length} file</span>
              {p.id === project?.id && <Link href="/app/project/drive" className="ml-auto text-xs font-semibold text-primary">Buka Drive project →</Link>}
            </div>
            <FileGrid files={files} empty="Belum ada file di project ini." />
          </section>
        );
      })}
    </div>
  );
}
