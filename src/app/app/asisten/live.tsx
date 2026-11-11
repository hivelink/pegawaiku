"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";

/** Muat ulang data halaman secara berkala: cepat saat ada run berjalan, lambat saat diam. */
export function AutoRefresh({ fast }: { fast: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, fast ? 6000 : 30000);
    return () => clearInterval(t);
  }, [fast, router]);
  return null;
}

/** Kerjakan antrean di server aplikasi (tanpa pekerja NAS) — cocok untuk riset, konten, dan presentasi. */
export function ProcessQueueButton({ label = "Kerjakan di server ini" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function go() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/autopilot/tick", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { error?: string; processed?: number; statuses?: string[] };
      setMsg(!r.ok ? j.error ?? `Gagal (HTTP ${r.status})` : j.processed ? `${j.processed} run dikerjakan (${(j.statuses ?? []).join(", ")}).` : "Antrean kosong.");
    } catch (e) {
      setMsg(`Gagal: ${(e as Error).message}`);
    }
    setBusy(false);
    router.refresh();
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={go} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 disabled:opacity-60">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {busy ? "Sedang mengerjakan… (bisa beberapa menit)" : label}
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </span>
  );
}
