"use client";
import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app error]", error);
    // kirim ke log server (best-effort)
    fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level: "error", source: "client:error-boundary", message: error.message, detail: { digest: error.digest, path: location.pathname, stack: error.stack?.split("\n").slice(0, 4).join("\n") } }) }).catch(() => {});
  }, [error]);
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-red-50 p-6">
      <div className="flex items-center gap-2 font-bold text-red-700"><AlertTriangle size={18} /> Terjadi kesalahan</div>
      <p className="mt-2 break-words text-sm text-red-800">{error.message || "Kesalahan tidak diketahui."}</p>
      {error.digest && <p className="mt-1 text-xs text-red-500">kode: {error.digest}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={reset} className="flex items-center gap-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"><RotateCcw size={14} /> Coba lagi</button>
        <Link href="/app" className="rounded-xl border border-border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">Ke beranda</Link>
        <Link href="/app/settings/logs" className="rounded-xl px-4 py-2 text-sm font-semibold text-primary">Lihat log</Link>
      </div>
    </div>
  );
}
