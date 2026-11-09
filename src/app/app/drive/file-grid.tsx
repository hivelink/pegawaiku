import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileIcon, Image as ImageIcon, Video, FileText, Trash2 } from "lucide-react";
import { deleteFile } from "../actions";

const icons = { image: ImageIcon, video: Video, text: FileText, file: FileIcon } as const;
export type DriveFile = { id: string; title: string; kind: string | null; size_bytes: number | null; url: string };

export function FileGrid({ files, empty }: { files: DriveFile[]; empty: string }) {
  if (!files.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {files.map((f) => {
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
    </div>
  );
}

/** Buat URL bertanda tangan sekaligus (satu panggilan) untuk banyak file. */
export async function signFiles(supabase: import("@supabase/supabase-js").SupabaseClient, rows: { id: string; title: string; kind: string | null; size_bytes: number | null; storage_path: string }[]): Promise<DriveFile[]> {
  if (!rows.length) return [];
  const { data } = await supabase.storage.from("drive").createSignedUrls(rows.map((r) => r.storage_path), 3600);
  return rows.map((r, i) => ({ id: r.id, title: r.title, kind: r.kind, size_bytes: r.size_bytes, url: data?.[i]?.signedUrl ?? "#" }));
}
