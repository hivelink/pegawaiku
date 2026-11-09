"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import { deleteConversation } from "../../actions";

function Yes() { const { pending } = useFormStatus(); return <button disabled={pending} className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-60">{pending ? "Menghapus…" : "Hapus"}</button>; }

export function DeleteChat({ id }: { id: string }) {
  const [ask, setAsk] = useState(false);
  if (!ask) return <button type="button" onClick={() => setAsk(true)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Hapus percakapan" title="Hapus percakapan"><Trash2 size={15} /></button>;
  return (
    <form action={deleteConversation} className="flex items-center gap-1 text-xs">
      <input type="hidden" name="id" value={id} />
      <span className="text-red-700">Hapus percakapan ini beserta isinya?</span>
      <Yes />
      <button type="button" onClick={() => setAsk(false)} className="rounded-md border border-border px-2 py-0.5">Batal</button>
    </form>
  );
}
