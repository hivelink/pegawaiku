"use client";
import { useState } from "react";
import { CheckCircle2, Circle, PencilLine } from "lucide-react";
import type { Choice } from "@/lib/choices";

/** Kartu keputusan: 2-4 tombol opsi (+ konsekuensi) dan opsi "Lainnya". Terkunci setelah dijawab. */
export function ChoiceCard({ choice, answered, chosen, disabled, onPick, onOther }: {
  choice: Choice; answered: boolean; chosen: string | null; disabled: boolean;
  onPick: (label: string) => void; onOther: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const done = answered || !!picked;
  const sel = chosen ?? picked;
  return (
    <div className="my-2 rounded-2xl border-2 border-sky-200 bg-sky-50/60 p-3">
      <div className="mb-2 flex items-start gap-2 text-sm font-bold text-slate-800">
        <span className="mt-0.5 rounded-md bg-primary px-1.5 text-[10px] font-bold uppercase tracking-wide text-white">{done ? "Diputuskan" : "Perlu keputusan"}</span>
        <span>{choice.q}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {choice.options.map((o) => {
          const isSel = sel === o.label;
          return (
            <button
              key={o.label}
              type="button"
              disabled={done || disabled}
              onClick={() => { setPicked(o.label); onPick(o.label); }}
              className={`flex items-start gap-2 rounded-xl border p-3 text-left text-sm transition ${isSel ? "border-emerald-500 bg-emerald-50" : done ? "border-border bg-white opacity-50" : "border-border bg-white hover:border-primary hover:shadow-sm"} disabled:cursor-default`}
            >
              {isSel ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" /> : <Circle size={18} className="mt-0.5 shrink-0 text-slate-300" />}
              <span>
                <span className="block font-semibold">{o.label}</span>
                {o.desc && <span className="mt-0.5 block text-xs text-muted">{o.desc}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {choice.other !== false && !done && (
        <button type="button" disabled={disabled} onClick={onOther} className="mt-2 flex items-center gap-1 text-xs font-semibold text-primary hover:underline disabled:opacity-50">
          <PencilLine size={13} /> Lainnya — tulis jawaban sendiri
        </button>
      )}
      {done && !sel && <div className="mt-2 text-xs text-muted">Sudah dijawab di pesan berikutnya.</div>}
    </div>
  );
}
