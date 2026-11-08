"use client";
import { useState } from "react";
import { Plus, Search, X, Check, KeyRound } from "lucide-react";
import { toggleProjectTool } from "../../actions";
import { ToolIcon } from "./tool-icon";

export type Tool = { key: string; name: string; description: string; category: string; icon: string; requires_key: string | null; is_available: boolean };
const CAT: Record<string, string> = { internal: "Bawaan", riset: "Riset", media: "Media", publikasi: "Publikasi", integrasi: "Integrasi", jaringan: "Jaringan", perminyakan: "Perminyakan" };

export function AddToolButton({ tools, enabled, keys }: { tools: Tool[]; enabled: string[]; keys: string[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = tools.filter((t) => !q || (t.name + t.description + t.category).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700">
        <Plus size={16} /> Tambah Tool
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={() => setOpen(false)}>
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 pb-3">
              <div><h2 className="text-lg font-bold">Tambah Tool</h2><p className="text-sm text-muted">Pilih alat bantu yang boleh dipakai pegawai AI di project ini.</p></div>
              <button onClick={() => setOpen(false)} aria-label="Tutup" className="rounded-lg p-1 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="px-5"><div className="flex items-center gap-2 rounded-xl border border-border px-3"><Search size={16} className="text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari tool…" className="h-11 w-full text-sm outline-none" /></div></div>
            <ul className="mt-3 flex-1 space-y-2 overflow-y-auto px-5 pb-5">
              {list.map((t) => {
                const on = enabled.includes(t.key);
                const needKey = !!t.requires_key && !keys.includes(t.requires_key);
                return (
                  <li key={t.key} className={`flex items-center gap-3 rounded-xl border border-border p-3 ${!t.is_available ? "opacity-60" : ""}`}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-primary"><ToolIcon name={t.icon} size={18} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{t.name}</span><span className="rounded-md bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-600">{CAT[t.category] ?? t.category}</span></div>
                      <div className="truncate text-xs text-muted">{t.description}</div>
                      {needKey && t.is_available && <div className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700"><KeyRound size={11} /> Butuh kunci API {t.requires_key}</div>}
                      {!t.is_available && <div className="mt-0.5 text-[11px] text-slate-500">Segera hadir</div>}
                    </div>
                    <form action={toggleProjectTool}>
                      <input type="hidden" name="tool_key" value={t.key} /><input type="hidden" name="enable" value={on ? "0" : "1"} />
                      <button disabled={!t.is_available} className={`grid h-9 w-9 place-items-center rounded-lg border ${on ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border hover:bg-slate-50"} disabled:cursor-not-allowed`} aria-label={on ? "Nonaktifkan" : "Aktifkan"}>
                        {on ? <Check size={16} /> : <Plus size={16} />}
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
