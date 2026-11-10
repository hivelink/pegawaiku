import Link from "next/link";
import { Cpu, KeyRound } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { setChatModel, setFallbackModel } from "../../actions";
import { ModelGroups, groupModels } from "./model-groups";

export default async function ModelSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { supabase, org } = await getContext();
  if (!org) return <Card className="p-8 text-sm text-muted">Organisasi tidak ditemukan.</Card>;
  const [{ data: models }, { data: keyRows }, { data: orgRow }] = await Promise.all([
    supabase.from("ai_models").select("id,provider,name,pricing,price_usd,free_tier,key_provider,notes").eq("kind", "text").eq("is_active", true).order("sort"),
    supabase.from("org_api_keys").select("provider").eq("org_id", org.id),
    supabase.from("organizations").select("chat_model").eq("id", org.id).single(),
  ]);
  const keys = new Set((keyRows ?? []).map((k) => k.provider));
  const current = orgRow?.chat_model ?? "anthropic/claude-sonnet-5-5";
  const groups = groupModels(models ?? []);
  const fbRow = await supabase.from("organizations").select("fallback_model").eq("id", org.id).single();
  const fbReady = !fbRow.error;
  const fallbackId = (fbRow.data?.fallback_model as string | null) ?? "";
  const fbOptions = (models ?? []).filter((m) => m.id !== current && m.key_provider !== "cloudflare" && keys.has(m.key_provider));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-primary"><Cpu /> Model AI untuk Chat</h1>
        <p className="mt-1 text-sm text-muted">Model yang dipakai semua pegawai AI saat bekerja. Claude (bawaan) memakai kredit PegawaiKu; model lain memakai kunci API Anda sendiri — beberapa <b>gratis</b>.</p>
      </div>
      {sp.ok && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">Model chat diperbarui.</p>}
      {sp.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{sp.error}</p>}

      <form action={setChatModel} className="space-y-3">
        <ModelGroups groups={groups} keys={[...keys]} current={current} />
        <Button type="submit">Simpan pilihan</Button>
      </form>

      <form action={setFallbackModel} className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div>
          <h2 className="text-base font-bold text-primary">Model cadangan (otomatis)</h2>
          <p className="mt-1 text-xs text-muted">Bila model utama gagal karena kredit/kuota habis, kunci bermasalah, atau terkena limit, pegawai AI langsung pindah ke model ini dan melanjutkan pekerjaan tanpa terputus. Hanya model dari penyedia yang kuncinya sudah Anda pasang yang bisa dipilih.</p>
        </div>
        {!fbReady && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Fitur ini butuh migrasi 0013 — jalankan di Pengaturan → Pembaruan.</p>}
        <select name="fallback_id" defaultValue={fallbackId} disabled={!fbReady} className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm">
          <option value="">Tidak ada cadangan</option>
          {groups.map((g) => {
            const opts = fbOptions.filter((m) => m.key_provider === g.key);
            return opts.length ? <optgroup key={g.key} label={g.label}>{opts.map((m) => <option key={m.id} value={m.id}>{m.name}{m.free_tier ? " (gratis)" : ""} — {m.pricing}</option>)}</optgroup> : null;
          })}
        </select>
        {fbOptions.length === 0 && <Link href="/app/settings/api-keys" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><KeyRound size={11} /> Pasang kunci OpenAI/Gemini/Groq dulu agar bisa dipilih sebagai cadangan</Link>}
        <Button type="submit" disabled={!fbReady}>Simpan model cadangan</Button>
      </form>

      <Card className="p-4 text-xs text-muted">
        <b>Catatan kemampuan:</b> dukungan tool (cari web, simpan ke Drive, belajar mandiri) paling andal di Claude, Gemini, GPT, Groq Llama 3.3 70B, Mistral, dan Cerebras. Cloudflare Workers AI dan model gratis OpenRouter berjalan tanpa tool.
      </Card>
    </div>
  );
}
