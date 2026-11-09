import { HardDrive } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { UploadForm } from "../../drive/upload-form";
import { FileGrid, signFiles } from "../../drive/file-grid";

/** Drive project aktif: hanya file milik project ini. */
export default async function ProjectDrivePage() {
  const { supabase, project } = await getContext();
  if (!project) return <Card className="p-8 text-sm text-muted">Belum ada project. Buat project di menu Project.</Card>;
  const { data } = await supabase.from("files").select("id,title,kind,size_bytes,storage_path").eq("project_id", project.id).order("created_at", { ascending: false });
  const files = await signFiles(supabase, data ?? []);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-primary"><HardDrive /> Drive · {project.name}</h1>
          <p className="text-sm text-muted">{files.length} file di project ini. Semua file dari semua project ada di menu Drive di atas.</p>
        </div>
        <UploadForm projectId={project.id} />
      </div>
      <FileGrid files={files} empty="Belum ada file. Unggah gambar, video, atau dokumen untuk project ini." />
    </div>
  );
}
