"use client";
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { createMission } from "./actions";
import { FormPending } from "@/components/ui/form-pending";
import { recommendedModel } from "@/lib/autopilot/models";

const DAYS = [[1, "Sen"], [2, "Sel"], [3, "Rab"], [4, "Kam"], [5, "Jum"], [6, "Sab"], [7, "Min"]] as const;
const field = "h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-accent";
const ARKA = "arka-asisten-otonom";

export type ModelOption = { id: string; name: string; pricing: string };

export function MissionForm({ agents, models }: { agents: { id: string; slug: string; name: string; title: string }[]; models: ModelOption[] }) {
  const [kind, setKind] = useState("once");
  const [agentId, setAgentId] = useState("");
  const slug = agents.find((a) => a.id === agentId)?.slug ?? ARKA;
  const rec = recommendedModel(slug);
  const recName = models.find((m) => m.id === rec.model)?.name ?? rec.model;
  // zona waktu perangkat user (jam jadwal ditafsirkan di zona ini); diisi setelah halaman tampil di browser
  const tzRef = useRef<HTMLInputElement>(null);
  useEffect(() => { try { if (tzRef.current) tzRef.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jakarta"; } catch { /* pakai WIB */ } }, []);
  return (
    <form action={createMission} className="space-y-3">
      <input ref={tzRef} type="hidden" name="tz" defaultValue="Asia/Jakarta" />
      <textarea name="instructions" required minLength={8} rows={3} placeholder="Apa yang harus dikerjakan? Mis. “Riset 5 kompetitor terdekat, bandingkan harga dan promonya, simpan ringkasannya sebagai tabel di Drive.”"
        className="w-full rounded-xl border border-border bg-card p-3 text-sm outline-none focus:ring-2 focus:ring-accent" />
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold text-muted">Dikerjakan oleh
          <select name="agent_id" className={field} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Arka (asisten umum)</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.title}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted">Model AI
          <select name="model" className={`${field} max-w-64`} defaultValue="">
            <option value="">Rekomendasi agent: {recName}</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.pricing}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted">Kapan
          <select name="schedule_kind" value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
            <option value="once">Sekarang, sekali</option>
            <option value="daily">Setiap hari</option>
            <option value="weekly">Hari tertentu</option>
            <option value="interval">Tiap beberapa jam</option>
          </select>
        </label>
        {(kind === "daily" || kind === "weekly") && (
          <label className="grid gap-1 text-xs font-semibold text-muted">Jam
            <input type="time" name="time" defaultValue="07:00" required className={field} />
          </label>
        )}
        {kind === "interval" && (
          <label className="grid gap-1 text-xs font-semibold text-muted">Tiap (jam)
            <input type="number" name="every_hours" min={0.5} step={0.5} defaultValue={6} required className={`${field} w-24`} />
          </label>
        )}
        <label className="grid gap-1 text-xs font-semibold text-muted">Minta persetujuan untuk
          <select name="approval_mode" className={field} defaultValue="sensitive">
            <option value="sensitive">Aksi berisiko saja</option>
            <option value="all_writes">Semua perubahan, termasuk menyimpan file</option>
          </select>
        </label>
        <button className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-sky-600">
          <FormPending /><Send size={15} /> {kind === "once" ? "Kerjakan" : "Jadwalkan"}
        </button>
      </div>
      <p className="text-xs text-muted">Model rekomendasi {agents.find((a) => a.id === agentId)?.name ?? "Arka"}: <b>{recName}</b> — {rec.why}</p>
      {kind === "weekly" && (
        <div className="flex flex-wrap gap-2 text-sm">
          {DAYS.map(([n, label]) => (
            <label key={n} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1">
              <input type="checkbox" name="days" value={n} defaultChecked={n === 1} /> {label}
            </label>
          ))}
        </div>
      )}
    </form>
  );
}
