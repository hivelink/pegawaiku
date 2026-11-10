"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, Check, TextSelect } from "lucide-react";
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
  const [done, setDone] = useState<"" | "teks" | "md" | "pilih" | "gagal">("");
  const [picked, setPicked] = useState(""); // teks yang sedang diseleksi user di dalam jawaban ini
  const ref = useRef<HTMLDivElement>(null);

  // pantau seleksi: hanya dihitung bila seluruhnya berada di gelembung jawaban tepat di atas tombol ini
  useEffect(() => {
    const onSel = () => {
      const bubble = ref.current?.previousElementSibling;
      const sel = document.getSelection();
      let t = "";
      if (bubble && sel && !sel.isCollapsed && sel.rangeCount && sel.anchorNode && sel.focusNode && bubble.contains(sel.anchorNode) && bubble.contains(sel.focusNode)) t = sel.toString().trim();
      setPicked((prev) => (prev === t ? prev : t));
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const clean = cleanAnswer(text);
  if (!clean) return null;
  const copy = async (kind: "teks" | "md" | "pilih") => {
    const ok = await writeClipboard(kind === "pilih" ? picked : kind === "teks" ? toPlainText(clean) : clean);
    setDone(ok ? kind : "gagal");
    setTimeout(() => setDone(""), 1800);
  };
  const keep = (e: React.MouseEvent) => e.preventDefault(); // klik tombol tidak membatalkan seleksi
  const cls = "flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-slate-100 hover:text-primary";
  return (
    <div ref={ref} className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted">
      {(picked || done === "pilih") && (
        <button type="button" onMouseDown={keep} onClick={() => copy("pilih")} className={`${cls} bg-sky-50 font-semibold text-primary`} title="Salin hanya teks yang Anda seleksi">
          {done === "pilih" ? <Check size={12} className="text-emerald-600" /> : <TextSelect size={12} />} {done === "pilih" ? "Tersalin" : `Salin yang dipilih (${picked.length} huruf)`}
        </button>
      )}
      <button type="button" onMouseDown={keep} onClick={() => copy("teks")} className={cls} title="Salin seluruh jawaban sebagai teks polos">
        {done === "teks" ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />} {done === "teks" ? "Tersalin" : "Salin semua"}
      </button>
      <button type="button" onMouseDown={keep} onClick={() => copy("md")} className={cls} title="Salin dengan format Markdown">
        {done === "md" ? <Check size={12} className="text-emerald-600" /> : null} {done === "md" ? "Tersalin" : "Salin Markdown"}
      </button>
      {done === "gagal" && <span className="text-red-600">Gagal menyalin — pilih teksnya lalu salin manual.</span>}
    </div>
  );
}
