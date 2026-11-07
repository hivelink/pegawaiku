import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { deleteFile } from "../actions";
import { UploadForm } from "./upload-form";
import { FileIcon, Image as ImageIcon, Video, FileText, Trash2 } from "lucide-react";

const icons = { image: ImageIcon, video: Video, text: FileText, file: FileIcon } as const;

export default async function DrivePage() {
  const { supabase, project } = await getContext();
  if (!project) return <p className="text-muted">Buat project dulu di sidebar.</p>;
  const { data: files } = await supabase.from("files").select("*").eq("project_id", project.id).order("created_at", { ascending: false });
  const withUrls = await Promise.all((files ?? []).map(async (f) => {
    const { data } = await supabase.storage.from("drive").createSignedUrl(f.storage_path, 3600);
    return { ...f, url: data?.signedUrl ?? "#" };
  }));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-primary">Drive · {project.name}</h1>
        <UploadForm projectId={project.id} />
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {withUrls.map((f) => {
          const Icon = icons[f.kind as keyof typeof icons] ?? FileIcon;
          return (
            <Card key={f.id} className="overflow-hidden">
              <a href={f.url} target="_blank" rel="noopener" className="block">
                {f.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt={f.title} className="h-36 w-full object-cover" />
                ) : (
                  <div className="flex h-36 items-center justify-center bg-slate-50"><Icon className="text-primary" size={36} /></div>
                )}
              </a>
              <div className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold" title={f.title}>{f.title}</div>
                  <div className="text-xs text-muted">{((f.size_bytes ?? 0) / 1024).toFixed(0)} KB</div>
                </div>
                <form action={deleteFile}><input type="hidden" name="id" value={f.id} /><Button variant="ghost" size="sm" aria-label="Hapus"><Trash2 size={14} /></Button></form>
              </div>
            </Card>
          );
        })}
        {withUrls.length === 0 && <p className="text-sm text-muted">Belum ada file. Unggah gambar, video, atau dokumen untuk project ini.</p>}
      </div>
    </div>
  );
}
