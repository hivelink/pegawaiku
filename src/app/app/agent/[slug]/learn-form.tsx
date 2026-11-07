"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrainCircuit, Loader2 } from "lucide-react";

export function LearnForm({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function learn() {
    if (!topic.trim() || busy) return;
    setBusy(true); setMsg(null);
    const res = await fetch("/api/learn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: agentId, topic }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg(`⚠️ ${j.error ?? "Gagal"}`); return; }
    setMsg(`✅ ${agentName} selesai belajar. ${j.summary ?? ""}`);
    setTopic("");
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-dashed border-accent/50 bg-sky-50/50 p-4">
      <div className="flex items-center gap-2 font-semibold text-primary"><BrainCircuit size={18} /> Minta {agentName} mempelajari keahlian baru</div>
      <p className="mt-1 text-xs text-muted">{agentName} akan mencari di internet, membaca beberapa sumber, lalu menyimpan panduan praktisnya sebagai pengetahuan tetap. Butuh 30–90 detik.</p>
      <div className="mt-3 flex gap-2">
        <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") learn(); }} placeholder="mis. cara menulis deskripsi produk Shopee yang ranking" className="h-10 flex-1 rounded-xl border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-accent" />
        <button onClick={learn} disabled={busy || !topic.trim()} className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-2 disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <BrainCircuit size={16} />} {busy ? "Belajar…" : "Pelajari"}
        </button>
      </div>
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </div>
  );
}
