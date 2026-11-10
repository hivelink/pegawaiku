import { ShieldCheck, Check, X, Wrench, Globe, Code2 } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { reviewCapabilityRequest, toggleCapability, deleteHttpCapability } from "../../actions";
import { ALWAYS_ON_CAPS } from "@/lib/capabilities";
import { FormPending } from "@/components/ui/form-pending";

const RISK: Record<string, string> = { low: "bg-emerald-100 text-emerald-700", medium: "bg-amber-100 text-amber-800", high: "bg-red-100 text-red-700" };
const STATUS: Record<string, string> = { pending: "Menunggu", approved: "Disetujui", rejected: "Ditolak", needs_dev: "Perlu pengembangan", done: "Selesai" };

type Req = { id: string; title: string; reason: string; user_request: string | null; kind: string; capability_key: string | null; spec: unknown; status: string; review_note: string | null; created_at: string; conversation_id: string | null; agent: { display_name: string } | null };

export default async function CapabilitiesPage() {
  const { supabase, org, user } = await getContext();
  if (!org) return null;
  const [{ data: me }, { data: caps, error: capErr }, { data: enabled }, { data: reqs }] = await Promise.all([
    supabase.from("org_members").select("role").eq("org_id", org.id).eq("user_id", user.id).maybeSingle(),
    supabase.from("capabilities").select("key,name,description,kind,risk,org_id,spec").order("risk"),
    supabase.from("org_capabilities").select("capability_key,approved_at").eq("org_id", org.id),
    supabase.from("capability_requests").select("id,title,reason,user_request,kind,capability_key,spec,status,review_note,created_at,conversation_id,agent:agents(display_name)").eq("org_id", org.id).order("created_at", { ascending: false }).limit(100),
  ]);
  if (capErr) {
    return (
      <Card className="space-y-2 p-6 text-sm">
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-primary"><ShieldCheck /> Kemampuan Agent</h1>
        <p>Fitur ini belum terpasang di database. Jalankan migrasi <code>0009_capabilities_updates.sql</code> sekali di Supabase → SQL Editor (lihat Pengaturan → Pembaruan untuk menyalin SQL-nya).</p>
      </Card>
    );
  }
  const isAdmin = !!me && ["owner", "admin"].includes(me.role);
  const on = new Set((enabled ?? []).map((e) => e.capability_key));
  const requests = (reqs ?? []) as unknown as Req[];
  const pending = requests.filter((r) => r.status === "pending");
  const devs = requests.filter((r) => r.status === "needs_dev");
  const history = requests.filter((r) => !["pending", "needs_dev"].includes(r.status)).slice(0, 30);
  const builtins = (caps ?? []).filter((c) => c.kind === "builtin");
  const https = (caps ?? []).filter((c) => c.kind === "http" && c.org_id === org.id);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-primary"><ShieldCheck /> Kemampuan Agent</h1>
        <p className="text-sm text-muted">Saat agent tidak bisa melakukan sesuatu (mis. menghapus file Drive), ia mengajukan kemampuan di sini. Owner/admin organisasi menyetujui atau menolak; setelah disetujui, kemampuan langsung tersedia di pesan berikutnya.{!isAdmin && " Kamu bukan admin — hanya bisa melihat."}</p>
      </div>

      <section className="space-y-2">
        <h2 className="font-bold">Permintaan menunggu ({pending.length})</h2>
        {pending.length === 0 ? <Card className="p-5 text-sm text-muted">Tidak ada permintaan baru.</Card> : pending.map((r) => (
          <Card key={r.id} className="space-y-2 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-sky-100 px-1.5 text-[10px] font-bold uppercase text-sky-800">{r.kind}</span>
              <b>{r.title}</b>
              {r.capability_key && <code className="text-xs text-muted">{r.capability_key}</code>}
              <span className="ml-auto text-xs text-muted">{r.agent?.display_name ?? "Agent"} · {new Date(r.created_at).toLocaleString("id-ID")}</span>
            </div>
            <p>{r.reason}</p>
            {r.user_request && <p className="text-xs text-muted">Permintaan user: “{r.user_request}”</p>}
            {r.spec != null && <pre className="max-h-48 overflow-auto rounded-lg bg-slate-50 p-2 text-xs">{JSON.stringify(r.spec, null, 2)}</pre>}
            {r.kind === "http" && <p className="text-xs text-amber-700">Periksa URL & header sebelum menyetujui — aksi ini akan memanggil layanan luar atas nama organisasi.</p>}
            {isAdmin && (
              <form action={reviewCapabilityRequest} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={r.id} />
                <input name="note" placeholder="Catatan (opsional)" className="min-w-40 flex-1 rounded-lg border border-border px-2 py-1" />
                <button name="decision" value="approve" className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 font-semibold text-white"><FormPending size={12} /><Check size={14} /> Setujui</button>
                <button name="decision" value="reject" className="flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-red-600"><FormPending size={12} /><X size={14} /> Tolak</button>
              </form>
            )}
          </Card>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-bold"><Wrench size={16} /> Kemampuan dasar</h2>
        <Card className="divide-y divide-border">
          {builtins.map((c) => (
            <div key={c.key} className="flex items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><b>{c.name}</b><span className={`rounded-md px-1.5 text-[10px] font-bold uppercase ${RISK[c.risk] ?? ""}`}>{c.risk}</span></div>
                <p className="text-xs text-muted">{c.description}</p>
              </div>
              {ALWAYS_ON_CAPS.has(c.key) ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Selalu aktif</span> : isAdmin ? (
                <form action={toggleCapability}>
                  <input type="hidden" name="key" value={c.key} /><input type="hidden" name="enable" value={on.has(c.key) ? "0" : "1"} />
                  <button className={`rounded-full px-3 py-1 text-xs font-bold ${on.has(c.key) ? "bg-emerald-600 text-white" : "border border-border"}`}><FormPending size={12} />{on.has(c.key) ? "Aktif" : "Nonaktif"}</button>
                </form>
              ) : <span className="text-xs">{on.has(c.key) ? "Aktif" : "Nonaktif"}</span>}
            </div>
          ))}
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-bold"><Globe size={16} /> Aksi HTTP organisasi ({https.length})</h2>
        {https.length === 0 ? <Card className="p-5 text-sm text-muted">Belum ada. Agent bisa mengusulkan aksi HTTP (mis. memanggil API layanan yang kuncinya sudah kamu simpan).</Card> : (
          <Card className="divide-y divide-border">
            {https.map((c) => (
              <details key={c.key} className="p-3 text-sm">
                <summary className="flex cursor-pointer items-center gap-2"><b>{c.name}</b><code className="text-xs text-muted">{c.key}</code><span className="ml-auto text-xs">{on.has(c.key) ? "Aktif" : "Nonaktif"}</span></summary>
                <p className="mt-1 text-xs text-muted">{c.description}</p>
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-50 p-2 text-xs">{JSON.stringify(c.spec, null, 2)}</pre>
                {isAdmin && (
                  <div className="mt-2 flex gap-2">
                    <form action={toggleCapability}><input type="hidden" name="key" value={c.key} /><input type="hidden" name="enable" value={on.has(c.key) ? "0" : "1"} /><button className="rounded-lg border border-border px-3 py-1 text-xs"><FormPending size={12} />{on.has(c.key) ? "Nonaktifkan" : "Aktifkan"}</button></form>
                    <form action={deleteHttpCapability}><input type="hidden" name="key" value={c.key} /><button className="rounded-lg border border-border px-3 py-1 text-xs text-red-600"><FormPending size={12} />Hapus</button></form>
                  </div>
                )}
              </details>
            ))}
          </Card>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-bold"><Code2 size={16} /> Butuh pengembangan ({devs.length})</h2>
        <p className="text-xs text-muted">Kemampuan yang tidak bisa diaktifkan tanpa menulis kode baru. Kirim daftar ini ke pengembang; setelah fitur dipasang lewat Pengaturan → Pembaruan, tandai selesai.</p>
        {devs.map((r) => (
          <Card key={r.id} className="flex flex-wrap items-start gap-2 p-3 text-sm">
            <div className="min-w-0 flex-1"><b>{r.title}</b><p className="text-xs text-muted">{r.reason}</p>{r.user_request && <p className="text-xs text-muted">“{r.user_request}”</p>}</div>
            {isAdmin && <form action={reviewCapabilityRequest}><input type="hidden" name="id" value={r.id} /><button name="decision" value="done" className="rounded-lg border border-border px-3 py-1 text-xs"><FormPending size={12} />Tandai selesai</button> <button name="decision" value="reject" className="rounded-lg border border-border px-3 py-1 text-xs text-red-600"><FormPending size={12} />Tolak</button></form>}
          </Card>
        ))}
      </section>

      {history.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold">Riwayat</h2>
          <Card className="divide-y divide-border text-sm">
            {history.map((r) => <div key={r.id} className="flex flex-wrap gap-2 p-2"><span className="w-32 text-xs text-muted">{STATUS[r.status]}</span><span className="flex-1">{r.title}</span>{r.review_note && <span className="text-xs text-muted">{r.review_note}</span>}</div>)}
          </Card>
        </section>
      )}
    </div>
  );
}
