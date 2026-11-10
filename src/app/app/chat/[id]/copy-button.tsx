"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cleanAnswer, toPlainText } from "@/lib/copy-text";

async function writeClipboard(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* lanjut ke cara lama */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

/** Tombol salin di bawah jawaban agent: teks polos (untuk Word/WhatsApp) atau Markdown. */
export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState<"" | "teks" | "md" | "gagal">("");
  const clean = cleanAnswer(text);
  if (!clean) return null;
  const copy = async (kind: "teks" | "md") => {
    const ok = await writeClipboard(kind === "teks" ? toPlainText(clean) : clean);
    setDone(ok ? kind : "gagal");
    setTimeout(() => setDone(""), 1800);
  };
  const cls = "flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-slate-100 hover:text-primary";
  return (
    <div className="mt-1 flex items-center gap-1 text-[11px] text-muted">
      <button type="button" onClick={() => copy("teks")} className={cls} title="Salin sebagai teks polos">
        {done === "teks" ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />} {done === "teks" ? "Tersalin" : "Salin"}
      </button>
      <button type="button" onClick={() => copy("md")} className={cls} title="Salin dengan format Markdown">
        {done === "md" ? <Check size={12} className="text-emerald-600" /> : null} {done === "md" ? "Tersalin" : "Salin Markdown"}
      </button>
      {done === "gagal" && <span className="text-red-600">Gagal menyalin — pilih teksnya lalu salin manual.</span>}
    </div>
  );
}
