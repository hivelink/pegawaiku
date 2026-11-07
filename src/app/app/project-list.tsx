"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Folder, FolderOpen, MoreHorizontal, Pencil, Trash2, Settings, Loader2 } from "lucide-react";
import { switchProject, renameProject, deleteProject, openProjectSettings } from "./actions";

type P = { id: string; name: string };

export function ProjectList({ projects, activeId }: { projects: P[]; activeId: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "<id>:<aksi>"
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (wrap.current && !wrap.current.contains(e.target as Node)) { setOpen(null); setConfirming(null); } }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  /** Jalankan aksi server dengan status "sibuk" dan tangkap error agar tidak menjatuhkan halaman. */
  function run(key: string, fd: FormData, action: (fd: FormData) => Promise<unknown>) {
    setErr(null); setBusy(key); setOpen(null); setConfirming(null);
    startTransition(async () => {
      try {
        await action(fd); // redirect dari server action ditangani Next secara otomatis
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        if (!/NEXT_REDIRECT/.test(msg)) setErr(msg);
      } finally {
        setBusy(null);
      }
    });
  }

  if (projects.length === 0) return <div className="px-3 text-sm text-muted">Belum ada project.</div>;

  return (
    <div ref={wrap} className="space-y-1">
      {err && <div className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{err}</div>}
      {projects.map((p) => {
        const active = p.id === activeId;
        const Icon = active ? FolderOpen : Folder;
        const isBusy = busy?.startsWith(p.id + ":");
        return (
          <div key={p.id} className="relative">
            {editing === p.id ? (
              <form
                onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); setEditing(null); run(p.id + ":rename", fd, renameProject); }}
                className="flex items-center gap-1 px-1"
              >
                <input type="hidden" name="project_id" value={p.id} />
                <input name="name" defaultValue={p.name} autoFocus className="h-8 w-full rounded-lg border border-border px-2 text-sm" onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); }} />
                <button className="rounded-lg bg-primary px-2 py-1 text-xs font-semibold text-white">OK</button>
              </form>
            ) : (
              <div className={`group flex items-center rounded-lg ${active ? "bg-sky-50 text-primary" : "hover:bg-slate-100"}`}>
                <button
                  type="button" disabled={!!busy}
                  onClick={() => { if (!active) { const fd = new FormData(); fd.set("project_id", p.id); run(p.id + ":switch", fd, switchProject); } }}
                  className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm ${active ? "font-semibold" : ""}`}
                >
                  {isBusy ? <Loader2 size={15} className="shrink-0 animate-spin text-accent" /> : <Icon size={15} className={`shrink-0 ${active ? "text-accent" : "text-slate-400"}`} />}
                  <span className="truncate">{p.name}</span>
                </button>
                <button
                  type="button" aria-label="Menu project" disabled={!!busy}
                  onClick={() => { setConfirming(null); setOpen(open === p.id ? null : p.id); }}
                  className={`mr-1 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 ${open === p.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            )}

            {open === p.id && (
              <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-white py-1 shadow-lg">
                {confirming === p.id ? (
                  <div className="p-3 text-xs">
                    <div className="font-semibold text-red-700">Hapus project &ldquo;{p.name}&rdquo;?</div>
                    <div className="mt-1 text-muted">Semua percakapan, tugas, dan file di dalamnya ikut terhapus dan tidak bisa dikembalikan.</div>
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => { const fd = new FormData(); fd.set("project_id", p.id); run(p.id + ":delete", fd, deleteProject); }} className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700">Ya, hapus</button>
                      <button type="button" onClick={() => setConfirming(null)} className="rounded-lg border border-border px-3 py-1.5 hover:bg-slate-50">Batal</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button type="button" onClick={() => { const fd = new FormData(); fd.set("project_id", p.id); run(p.id + ":settings", fd, openProjectSettings); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                      <Settings size={14} /> Pengaturan
                    </button>
                    <button type="button" onClick={() => { setEditing(p.id); setOpen(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                      <Pencil size={14} /> Ubah nama
                    </button>
                    <button type="button" onClick={() => setConfirming(p.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
                      <Trash2 size={14} /> Hapus project
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
