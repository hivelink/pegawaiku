"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Item = { id: string; name: string; size: number; pct: number; status: "antri" | "unggah" | "simpan" | "sukses" | "gagal"; error?: string };

function fmt(b: number) { return b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`; }

/** Unggah langsung browser → Supabase Storage (URL bertanda tangan) dengan progres per file, lalu catat ke DB. */
export function UploadForm({ projectId }: { projectId: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const busy = items.some((i) => i.status === "antri" || i.status === "unggah" || i.status === "simpan");

  const update = (id: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  function notify(ok: boolean, text: string) {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 4500);
  }

  async function uploadOne(file: File, id: string) {
    try {
      update(id, { status: "unggah", pct: 0 });
      const signRes = await fetch("/api/drive/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: projectId, filename: file.name, size: file.size }) });
      const sign = await signRes.json().catch(() => ({}));
      if (!signRes.ok) throw new Error(sign.error ?? `Gagal menyiapkan unggahan (HTTP ${signRes.status})`);

      // PUT langsung ke Storage dengan progres
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", sign.signedUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.setRequestHeader("x-upsert", "false");
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) update(id, { pct: Math.round((e.loaded / e.total) * 100) }); };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage menolak (HTTP ${xhr.status}): ${xhr.responseText.slice(0, 160)}`)));
        xhr.onerror = () => reject(new Error("Koneksi ke Storage terputus"));
        xhr.send(file);
      });

      update(id, { status: "simpan", pct: 100 });
      const done = await fetch("/api/drive/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: projectId, path: sign.path, title: file.name, mime: file.type, size: file.size }) });
      const dj = await done.json().catch(() => ({}));
      if (!done.ok) throw new Error(dj.error ?? `Gagal mencatat file (HTTP ${done.status})`);
      update(id, { status: "sukses" });
      return true;
    } catch (e) {
      const msg = (e as Error).message;
      update(id, { status: "gagal", error: msg });
      fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level: "error", source: "client:drive-upload", message: msg, detail: { name: file.name, size: file.size, type: file.type } }) }).catch(() => {});
      return false;
    }
  }

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const queue = files.map((f) => ({ id: crypto.randomUUID(), file: f }));
    setItems(queue.map(({ id, file }) => ({ id, name: file.name, size: file.size, pct: 0, status: "antri" as const })));
    let ok = 0;
    for (const { id, file } of queue) if (await uploadOne(file, id)) ok++;
    if (ref.current) ref.current.value = "";
    router.refresh();
    if (ok === files.length) notify(true, files.length === 1 ? `"${files[0].name}" berhasil diunggah.` : `${ok} file berhasil diunggah.`);
    else notify(false, `${ok} dari ${files.length} file berhasil; ${files.length - ok} gagal (lihat detail di bawah).`);
    if (ok === files.length) setTimeout(() => setItems([]), 3000);
  }

  return (
    <div className="relative">
      <input ref={ref} type="file" multiple className="hidden" onChange={onChange} />
      <Button onClick={() => ref.current?.click()} disabled={busy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {busy ? "Mengunggah…" : "Unggah file"}
      </Button>

      {items.length > 0 && (
        <div className="absolute right-0 top-12 z-20 w-80 space-y-2 rounded-2xl border border-border bg-white p-3 shadow-xl">
          {items.map((i) => (
            <div key={i.id} className="text-xs">
              <div className="flex items-center gap-2">
                {i.status === "sukses" ? <CheckCircle2 size={14} className="text-emerald-600" /> : i.status === "gagal" ? <XCircle size={14} className="text-red-600" /> : <Loader2 size={14} className="animate-spin text-primary" />}
                <span className="min-w-0 flex-1 truncate font-medium" title={i.name}>{i.name}</span>
                <span className="text-muted">{fmt(i.size)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full transition-all ${i.status === "gagal" ? "bg-red-500" : i.status === "sukses" ? "bg-emerald-500" : "bg-gradient-to-r from-primary to-accent"}`} style={{ width: `${i.status === "sukses" ? 100 : i.pct}%` }} />
              </div>
              <div className="mt-0.5 text-[11px] text-muted">
                {i.status === "antri" && "Menunggu…"}{i.status === "unggah" && `Mengunggah ${i.pct}%`}{i.status === "simpan" && "Menyimpan ke Drive…"}{i.status === "sukses" && "Selesai"}{i.status === "gagal" && <span className="text-red-600">{i.error}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}>
          {toast.ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />} {toast.text}
        </div>
      )}
    </div>
  );
}
