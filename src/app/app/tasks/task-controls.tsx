"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Trash2, Loader2 } from "lucide-react";
import { deleteTask, dedupeTasks } from "../actions";

/** Tombol kirim yang terkunci selama proses — mencegah klik ganda membuat tugas dobel. */
export function SubmitOnce({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`inline-flex items-center gap-1 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${className}`}>
      {pending && <Loader2 size={14} className="animate-spin" />}{children}
    </button>
  );
}

function ConfirmBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} className="rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-60">{pending ? "Menghapus…" : label}</button>;
}

/** Hapus satu tugas dengan konfirmasi dua langkah. */
export function DeleteTask({ id }: { id: string }) {
  const [ask, setAsk] = useState(false);
  if (!ask) return <button type="button" onClick={() => setAsk(true)} className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Hapus tugas" title="Hapus tugas"><Trash2 size={13} /></button>;
  return (
    <form action={deleteTask} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <ConfirmBtn label="Hapus" />
      <button type="button" onClick={() => setAsk(false)} className="rounded-md border border-border px-2 py-0.5 text-[11px]">Batal</button>
    </form>
  );
}

/** Hapus semua tugas ganda sekaligus (yang paling lama dibuat dipertahankan). */
export function DedupeAll({ count }: { count: number }) {
  const [ask, setAsk] = useState(false);
  if (!ask) return <button type="button" onClick={() => setAsk(true)} className="rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50">Hapus {count} tugas ganda</button>;
  return (
    <form action={dedupeTasks} className="flex items-center gap-2 text-xs">
      <span>Hapus {count} tugas ganda? Yang paling awal dibuat tetap disimpan.</span>
      <ConfirmBtn label="Ya, hapus" />
      <button type="button" onClick={() => setAsk(false)} className="rounded-md border border-border px-2 py-0.5">Batal</button>
    </form>
  );
}
