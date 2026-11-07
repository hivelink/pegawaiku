"use client";
import { useEffect, useRef, useState } from "react";
import { Folder, FolderOpen, MoreHorizontal, Pencil, Trash2, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { switchProject, renameProject, deleteProject } from "./actions";

type P = { id: string; name: string };

export function ProjectList({ projects, activeId }: { projects: P[]; activeId: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(null); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (projects.length === 0) return <div className="px-3 text-sm text-muted">Belum ada project.</div>;

  return (
    <div ref={wrap} className="space-y-1">
      {projects.map((p) => {
        const active = p.id === activeId;
        const Icon = active ? FolderOpen : Folder;
        return (
          <div key={p.id} className="relative">
            {editing === p.id ? (
              <form
                action={async (fd) => { await renameProject(fd); setEditing(null); router.refresh(); }}
                className="flex items-center gap-1 px-1"
              >
                <input type="hidden" name="project_id" value={p.id} />
                <input name="name" defaultValue={p.name} autoFocus className="h-8 w-full rounded-lg border border-border px-2 text-sm" onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); }} />
                <button className="rounded-lg bg-primary px-2 py-1 text-xs font-semibold text-white">OK</button>
              </form>
            ) : (
              <div className={`group flex items-center rounded-lg ${active ? "bg-sky-50 text-primary" : "hover:bg-slate-100"}`}>
                <form action={switchProject} className="min-w-0 flex-1">
                  <input type="hidden" name="project_id" value={p.id} />
                  <button className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${active ? "font-semibold" : ""}`}>
                    <Icon size={15} className={`shrink-0 ${active ? "text-accent" : "text-slate-400"}`} />
                    <span className="truncate">{p.name}</span>
                  </button>
                </form>
                <button
                  type="button" aria-label="Menu project"
                  onClick={() => setOpen(open === p.id ? null : p.id)}
                  className={`mr-1 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 ${open === p.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            )}

            {open === p.id && (
              <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-white py-1 shadow-lg">
                <form action={switchProject}>
                  <input type="hidden" name="project_id" value={p.id} />
                  <button formAction={async (fd) => { await switchProject(fd); router.push("/app/project/settings"); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <Settings size={14} /> Pengaturan
                  </button>
                </form>
                <button type="button" onClick={() => { setEditing(p.id); setOpen(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <Pencil size={14} /> Ubah nama
                </button>
                <form
                  action={deleteProject}
                  onSubmit={(e) => { if (!confirm(`Hapus project "${p.name}"? Semua percakapan, tugas, dan file di dalamnya ikut terhapus dan tidak bisa dikembalikan.`)) e.preventDefault(); }}
                >
                  <input type="hidden" name="project_id" value={p.id} />
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
                    <Trash2 size={14} /> Hapus project
                  </button>
                </form>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
