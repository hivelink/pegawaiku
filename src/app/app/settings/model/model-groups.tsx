import Link from "next/link";
import { Gift, KeyRound, Check, ChevronRight } from "lucide-react";

export type ModelRow = { id: string; provider: string; name: string; pricing: string | null; price_usd?: number | null; free_tier: boolean | null; key_provider: string; notes: string | null };
export type ModelGroup = { key: string; label: string; models: ModelRow[] };

const LABELS: Record<string, string> = { anthropic: "Claude (Anthropic)", openai: "GPT (OpenAI)", google: "Gemini (Google)", groq: "Groq", openrouter: "OpenRouter", mistral: "Mistral", cerebras: "Cerebras", cloudflare: "Cloudflare Workers AI", together: "Together AI", huggingface: "Hugging Face" };

/** Kelompokkan model per penyedia AI; urutan kelompok mengikuti urutan model pertama tiap penyedia. */
export function groupModels(models: ModelRow[]): ModelGroup[] {
  const groups: ModelGroup[] = [];
  for (const m of models) {
    let g = groups.find((x) => x.key === m.key_provider);
    if (!g) { g = { key: m.key_provider, label: LABELS[m.key_provider] ?? m.provider, models: [] }; groups.push(g); }
    g.models.push(m);
  }
  return groups;
}

/** Daftar model bertingkat: penyedia AI (bisa dibuka-tutup) → Berbayar / Gratis → model + estimasi biaya. */
export function ModelGroups({ groups, keys: keyList, current }: { groups: ModelGroup[]; keys: string[]; current: string }) {
  const keys = new Set(keyList);
  return (
    <>
        {groups.map((g) => {
          const available = g.key === "anthropic" || keys.has(g.key);
          const hasSelected = g.models.some((m) => m.id === current);
          const paid = g.models.filter((m) => !m.free_tier);
          const free = g.models.filter((m) => m.free_tier);
          return (
            <details key={g.key} open={hasSelected} className={`group rounded-2xl border bg-card ${hasSelected ? "border-primary" : "border-border"}`}>
              <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <ChevronRight size={16} className="shrink-0 text-muted transition-transform group-open:rotate-90" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
                    {g.label}
                    <span className="text-xs font-normal text-muted">{g.models.length} model</span>
                    {free.length > 0 && <span className="flex items-center gap-0.5 rounded-md bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-700"><Gift size={10} /> {paid.length ? `${free.length} gratis` : "gratis"}</span>}
                    {hasSelected && <span className="flex items-center gap-0.5 rounded-md bg-primary px-1.5 text-[10px] font-semibold text-white"><Check size={10} /> dipakai</span>}
                  </div>
                  <div className="text-xs text-muted">
                    {g.key === "anthropic" && !keys.has("anthropic") ? "Memakai kredit PegawaiKu" : available ? "Kunci API terpasang" : "Kunci API belum dipasang"}
                    {hasSelected ? ` · aktif: ${g.models.find((m) => m.id === current)?.name}` : ""}
                  </div>
                </div>
                {!available && <Link href="/app/settings/api-keys" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-700"><KeyRound size={11} /> Pasang kunci</Link>}
              </summary>
              <div className="space-y-3 border-t border-border p-3 pl-6">
                {[["Berbayar", paid] as const, ["Gratis", free] as const].map(([title, list]) => list.length > 0 && (
                  <div key={title}>
                    <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</div>
                    <div className="space-y-1.5">
                      {list.map((m) => {
                        const selected = m.id === current;
                        return (
                          <label key={m.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${selected ? "border-primary bg-sky-50" : "border-border"} ${!available ? "opacity-70" : "hover:bg-slate-50"}`}>
                            <input type="radio" name="model_id" value={m.id} defaultChecked={selected} disabled={!available} className="h-4 w-4" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                                {m.name}
                                {selected && <span className="flex items-center gap-0.5 rounded-md bg-primary px-1.5 text-[10px] font-semibold text-white"><Check size={10} /> aktif</span>}
                              </div>
                              <div className="text-xs text-muted">{m.pricing}{m.notes ? ` — ${m.notes}` : ""}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
    </>
  );
}
