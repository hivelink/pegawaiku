import Link from "next/link";
import { KeyRound, ShieldAlert, Trash2, Check } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveApiKey, deleteApiKey } from "../../actions";
import { FormPending } from "@/components/ui/form-pending";

const PROVIDERS: { key: string; name: string; hint: string; url: string; free?: string; group: "gratis" | "berbayar" }[] = [
  // ---- Punya tier GRATIS ----
  { key: "groq", name: "Groq (Llama 3.3 70B, sangat cepat)", hint: "gsk_…", url: "https://console.groq.com/keys", free: "Kuota harian gratis, cukup untuk chat harian", group: "gratis" },
  { key: "google", name: "Google AI Studio (Gemini, Nano Banana, Imagen, Veo)", hint: "AIza…", url: "https://aistudio.google.com/apikey", free: "Kuota gratis harian untuk Gemini & gambar", group: "gratis" },
  { key: "cerebras", name: "Cerebras (Llama 3.3 70B)", hint: "csk-…", url: "https://cloud.cerebras.ai/", free: "1 juta token/hari gratis", group: "gratis" },
  { key: "openrouter", name: "OpenRouter (ratusan model, ada :free)", hint: "sk-or-…", url: "https://openrouter.ai/settings/keys", free: "Model berakhiran :free tanpa biaya", group: "gratis" },
  { key: "mistral", name: "Mistral (La Plateforme)", hint: "…", url: "https://console.mistral.ai/api-keys", free: "Tier eksperimen gratis (dibatasi laju)", group: "gratis" },
  { key: "cloudflare", name: "Cloudflare Workers AI", hint: "ACCOUNT_ID:API_TOKEN", url: "https://dash.cloudflare.com/profile/api-tokens", free: "10.000 neuron/hari gratis", group: "gratis" },
  { key: "huggingface", name: "Hugging Face Inference", hint: "hf_…", url: "https://huggingface.co/settings/tokens", free: "Kuota gratis bulanan", group: "gratis" },
  { key: "tavily", name: "Tavily (pencarian web untuk agent)", hint: "tvly-…", url: "https://app.tavily.com/home", free: "1.000 pencarian/bulan", group: "gratis" },
  { key: "elevenlabs", name: "ElevenLabs (suara)", hint: "sk_…", url: "https://elevenlabs.io/app/settings/api-keys", free: "10.000 karakter/bulan", group: "gratis" },
  { key: "serp", name: "SerpApi (riset keyword/SERP)", hint: "…", url: "https://serpapi.com/manage-api-key", free: "100 pencarian/bulan", group: "gratis" },
  // ---- Berbayar ----
  { key: "anthropic", name: "Anthropic (Claude) — pakai kunci sendiri", hint: "sk-ant-…", url: "https://console.anthropic.com/settings/keys", free: "Tanpa kunci ini, chat memakai kredit PegawaiKu", group: "berbayar" },
  { key: "openai", name: "OpenAI (GPT, GPT Image, TTS)", hint: "sk-…", url: "https://platform.openai.com/api-keys", group: "berbayar" },
  { key: "fal", name: "fal.ai (Seedream, Seedance, Flux, Kling, Wan)", hint: "key_id:secret", url: "https://fal.ai/dashboard/keys", free: "Kredit uji coba kecil", group: "berbayar" },
  { key: "meta", name: "Meta (Ads Library / Marketing API)", hint: "token akses", url: "https://developers.facebook.com/tools/explorer/", group: "berbayar" },
  { key: "mikrotik", name: "MikroTik RouterOS (REST API v7)", hint: "https://host:port|user|password", url: "https://help.mikrotik.com/docs/display/ROS/REST+API", free: "Router sendiri — aktifkan www-ssl & buat user read-only", group: "gratis" },
  { key: "telegram", name: "Telegram (persetujuan & laporan Asisten Otonom)", hint: "BOT_TOKEN|CHAT_ID", url: "https://core.telegram.org/bots#how-do-i-create-a-bot", free: "Gratis — buat bot lewat @BotFather; pekerja NAS mengirim tombol Setujui/Tolak ke chat Anda", group: "gratis" },
  { key: "composio", name: "Composio (1.700+ aplikasi: Gmail, Slack, Notion, Sheets…)", hint: "ak_…", url: "https://app.composio.dev/settings", free: "Tier gratis tersedia — integrasi menyusul", group: "gratis" },
];

export default async function ApiKeysPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { supabase, org, user } = await getContext();
  if (!org) return <Card className="p-8 text-sm text-muted">Organisasi tidak ditemukan.</Card>;
  const { data: rows } = await supabase.from("org_api_keys").select("provider,label,updated_at").eq("org_id", org.id);
  const have = new Map((rows ?? []).map((r) => [r.provider, r]));
  const isOwner = org.owner_id === user.id;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-primary"><KeyRound /> Kunci API</h1>
        <p className="mt-1 text-sm text-muted">Kunci milik organisasi <b>{org.name}</b>. Dipakai Studio AI dan tool yang membutuhkannya. Nilai kunci tidak pernah ditampilkan kembali.</p>
      </div>
      {sp.ok && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">Kunci tersimpan.</p>}
      {sp.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{sp.error}</p>}
      <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <ShieldAlert size={16} className="mt-0.5 shrink-0" />
        <span>Kunci disimpan di database dengan akses terbatas untuk owner/admin organisasi. Enkripsi tambahan (Supabase Vault) masuk roadmap — untuk sekarang pakai kunci dengan batas pengeluaran (spending limit) di dashboard provider.</span>
      </div>
      {!isOwner && <p className="text-sm text-muted">Hanya owner/admin organisasi yang dapat mengubah kunci.</p>}

      <div className="flex items-center gap-2 text-sm"><Link href="/app/settings/model" className="font-semibold text-primary underline">Pilih model chat →</Link><span className="text-muted">setelah kunci terpasang, pilih model gratis (mis. Groq) agar chat tidak memakai kredit.</span></div>
      {(["gratis", "berbayar"] as const).map((g) => (
      <section key={g}>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">{g === "gratis" ? "Punya tier gratis" : "Berbayar"}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.filter((p) => p.group === g).map((p) => {
          const row = have.get(p.key);
          return (
            <Card key={p.key} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold">{p.name}</div>
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">Ambil kunci di sini</a>
                  {p.free && <div className="mt-1 text-xs text-emerald-700">Gratis: {p.free}</div>}
                </div>
                {row ? <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"><Check size={12} /> tersimpan</span>
                     : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">belum</span>}
              </div>
              {isOwner && (
                <form action={saveApiKey} className="mt-3 flex gap-2">
                  <input type="hidden" name="provider" value={p.key} />
                  <Input name="secret" type="password" placeholder={row ? "Ganti kunci…" : p.hint} autoComplete="off" className="font-mono" />
                  <Button type="submit" size="md">Simpan</Button>
                  {row && (
                    <button formAction={deleteApiKey} aria-label="Hapus" className="rounded-xl border border-border px-3 text-red-600 hover:bg-red-50"><FormPending size={12} /><Trash2 size={16} /></button>
                  )}
                </form>
              )}
              {row && <div className="mt-2 text-[11px] text-muted">Diperbarui {new Date(row.updated_at).toLocaleString("id-ID")}</div>}
            </Card>
          );
        })}
      </div>
      </section>
      ))}
    </div>
  );
}
