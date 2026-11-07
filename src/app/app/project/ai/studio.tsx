"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Image as ImageIcon, Video, Type, AudioLines, Sparkles, Loader2, AlertCircle } from "lucide-react";
import type { AiModel } from "./page";

type Gen = { id: string; kind: string; prompt: string; status: string; output_url: string | null; created_at: string; model_id: string | null };
const KINDS = [
  { key: "image", label: "Gambar AI", icon: ImageIcon }, { key: "video", label: "Video AI", icon: Video },
  { key: "text", label: "Teks AI", icon: Type }, { key: "audio", label: "Suara AI", icon: AudioLines },
] as const;

export function Studio({ models, keys, projectId, generations }: { models: AiModel[]; keys: string[]; projectId: string; generations: Gen[] }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("image");
  const [modelId, setModelId] = useState<string>(() => models.find((m) => m.kind === "image")?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const options = useMemo(() => models.filter((m) => m.kind === kind), [models, kind]);
  const model = options.find((m) => m.id === modelId) ?? options[0];
  const hasKey = model ? keys.includes(model.key_provider) || (model.key_provider === "anthropic") : false;
  const price = model?.price_usd ?? 0;
  const est = model?.kind === "text" ? "≈ token" : `$${(price * count).toFixed(4)}`;

  function pickKind(k: typeof kind) { setKind(k); setModelId(models.find((m) => m.kind === k)?.id ?? ""); }

  async function generate() {
    if (!model || !prompt.trim()) return;
    setBusy(true); setErr(null);
    const res = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: projectId, model_id: model.id, prompt, count }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(j.error ?? "Gagal"); return; }
    setPrompt("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Galeri hasil */}
      <div className="min-h-56 rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 text-sm font-bold">Hasil generate</div>
        {generations.length === 0 ? (
          <div className="grid h-40 place-items-center text-center text-sm text-muted"><div><ImageIcon className="mx-auto mb-2 text-slate-300" size={36} />Belum ada hasil. Tulis deskripsi di bawah lalu klik Generate.</div></div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {generations.map((g) => (
              <div key={g.id} className="overflow-hidden rounded-xl border border-border bg-slate-50 text-xs">
                {g.kind === "image" && g.output_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.output_url} alt="" className="aspect-square w-full object-cover" />
                ) : g.kind === "text" && g.output_url ? (
                  <div className="h-32 overflow-y-auto p-2 text-[11px] leading-snug whitespace-pre-wrap">{g.output_url}</div>
                ) : (
                  <div className="grid aspect-square place-items-center text-muted">{g.status === "failed" ? <span className="flex items-center gap-1 text-red-600"><AlertCircle size={14} /> gagal</span> : g.status}</div>
                )}
                <div className="truncate p-2 text-muted" title={g.prompt}>{g.prompt}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Komposer */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Gambarkan adegan yang Anda bayangkan…" className="w-full resize-none rounded-xl border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent" />
        {err && <div className="mt-2 flex items-center gap-1 rounded-lg bg-red-50 p-2 text-xs text-red-700"><AlertCircle size={14} /> {err}</div>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-border p-1 text-xs">
            {KINDS.map((k) => (
              <button key={k.key} type="button" onClick={() => pickKind(k.key)} className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 ${kind === k.key ? "bg-primary text-white" : "hover:bg-slate-100"}`}><k.icon size={13} /> {k.label}</button>
            ))}
          </div>
          <select value={model?.id ?? ""} onChange={(e) => setModelId(e.target.value)} className="h-9 rounded-xl border border-border bg-white px-2 text-xs">
            {Array.from(new Set(options.map((o) => o.provider))).map((p) => (
              <optgroup key={p} label={p}>
                {options.filter((o) => o.provider === p).map((o) => <option key={o.id} value={o.id}>{o.name} — {o.pricing}{o.free_tier ? " · gratis" : ""}</option>)}
              </optgroup>
            ))}
          </select>
          {kind !== "text" && (
            <label className="flex h-9 items-center gap-1 rounded-xl border border-border px-2 text-xs">Jumlah
              <input type="number" min={1} max={4} value={count} onChange={(e) => setCount(Math.max(1, Math.min(4, Number(e.target.value) || 1)))} className="w-10 bg-transparent text-center outline-none" />
            </label>
          )}
          <div className="ml-auto flex items-center gap-2">
            {!hasKey && model && <span className="text-xs text-amber-700">Butuh kunci API {model.key_provider}</span>}
            <button type="button" onClick={generate} disabled={busy || !prompt.trim() || !model || !hasKey} className="flex h-10 items-center gap-2 rounded-xl bg-amber-400 px-4 text-sm font-bold text-slate-900 hover:bg-amber-300 disabled:opacity-50">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Generate <span className="font-semibold">{est}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
