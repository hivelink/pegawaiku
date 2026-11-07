"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Plus, X } from "lucide-react";

async function upload(file: File, projectId: string, kind: "image" | "asset", name?: string) {
  const fd = new FormData();
  fd.append("file", file); fd.append("project_id", projectId); fd.append("kind", kind);
  if (name) fd.append("name", name);
  const res = await fetch("/api/brand/upload", { method: "POST", body: fd });
  if (!res.ok) throw new Error((await res.json()).error ?? "Gagal unggah");
}

export function ProjectImageUploader({ projectId, imageUrl }: { projectId: string; imageUrl: string | null }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true);
    try { await upload(f, projectId, "image"); router.refresh(); } catch (err) { alert((err as Error).message); }
    setBusy(false);
  }
  return (
    <div className="flex items-start gap-4">
      <button type="button" onClick={() => ref.current?.click()} disabled={busy}
        className="relative grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-border bg-slate-50 text-slate-400 hover:border-accent hover:text-accent">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : <ImagePlus size={26} />}
        {busy && <span className="absolute inset-0 grid place-items-center bg-white/70 text-xs font-semibold text-primary">Mengunggah…</span>}
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={onChange} />
      <p className="text-sm text-muted">Unggah gambar untuk thumbnail project — dipakai di kartu project dan halaman detail. Klik kotak untuk memilih file (maks. 5 MB).</p>
    </div>
  );
}

export function BrandAssetUploader({ projectId }: { projectId: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function add() {
    if (!file) { ref.current?.click(); return; }
    setBusy(true);
    try { await upload(file, projectId, "asset", name); setFile(null); setName(""); router.refresh(); } catch (err) { alert((err as Error).message); }
    setBusy(false);
  }
  return (
    <div className="flex gap-3">
      <button type="button" onClick={() => ref.current?.click()}
        className="relative grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-border bg-slate-50 text-slate-400 hover:border-accent hover:text-accent">
        {file ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={URL.createObjectURL(file)} alt="" className="h-full w-full object-contain" />
            <span onClick={(e) => { e.stopPropagation(); setFile(null); }} className="absolute right-1 top-1 rounded-full bg-white p-0.5 shadow"><X size={12} /></span>
          </>
        ) : <ImagePlus size={22} />}
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div className="flex flex-1 flex-col gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama aset (mis. Logo)" className="h-10 rounded-xl border border-border px-3 text-sm outline-none focus:ring-2 focus:ring-accent" />
        <button type="button" onClick={add} disabled={busy} className="flex h-10 items-center justify-center gap-1 rounded-xl border border-border text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
          <Plus size={14} /> {busy ? "Mengunggah…" : file ? "Tambah" : "Pilih file"}
        </button>
      </div>
    </div>
  );
}
