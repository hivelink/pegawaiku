import Link from "next/link";
import { Sparkles, ShieldCheck, Check, X, Play, Pause, Trash2, Brain, CalendarClock, Server, History, Lightbulb, MessagesSquare, Ban } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FormPending } from "@/components/ui/form-pending";
import { describeSchedule } from "@/lib/autopilot/schedule";
import { MISSION_TEMPLATES } from "@/lib/autopilot/templates";
import type { Approval, MemoryItem, Mission, Run } from "@/lib/autopilot/types";
import { addMemory, cancelRun, decideApproval, deleteMemory, missionAction, applyTemplate, setMissionModel } from "./actions";
import { MissionForm, type ModelOption } from "./mission-form";
import { recommendedModel, MODEL_TIERS } from "@/lib/autopilot/models";
import { AutoRefresh, ProcessQueueButton } from "./live";

const RUN_BADGE: Record<string, [string, string]> = {
  queued: ["Antre", "bg-slate-100 text-slate-700"], running: ["Berjalan", "bg-sky-100 text-sky-800"], waiting_approval: ["Menunggu Anda", "bg-amber-100 text-amber-800"],
  done: ["Selesai", "bg-emerald-100 text-emerald-700"], failed: ["Gagal", "bg-red-100 text-red-700"], cancelled: ["Dibatalkan", "bg-slate-100 text-slate-500"],
};
const MISSION_BADGE: Record<string, [string, string]> = { active: ["Aktif", "bg-emerald-100 text-emerald-700"], paused: ["Dijeda", "bg-slate-100 text-slate-600"], done: ["Selesai", "bg-slate-100 text-slate-500"] };
const MEMORY_LABEL: Record<string, string> = { preference: "Preferensi", habit: "Kebiasaan", fact: "Fakta" };
const btn = "inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-slate-100";

const when = (iso: string | null | undefined, tz = "Asia/Jakarta") => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("id-ID", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso.slice(0, 16).replace("T", " "); }
};

/** pekerja dianggap aktif bila heartbeat terakhirnya kurang dari 90 detik lalu */
const isFresh = (iso: string) => Date.now() - new Date(iso).getTime() < 90_000;


export type MissionRow = Mission & { agent: { display_name: string; slug: string } | null };
const ARKA = "arka-asisten-otonom";
export type ApprovalRow = Approval & { mission: { title: string } | null };
export type RunRow = Pick<Run, "id" | "mission_id" | "status" | "trigger" | "steps" | "summary" | "error" | "credit_cost" | "created_at" | "finished_at"> & { mission: { title: string; conversation_id: string | null } | null };
export type EventRow = { id: number; run_id: string; kind: string; label: string; created_at: string };
export type WorkerRow = { name: string; last_seen_at: string; info: Record<string, unknown> | null };

export type AsistenViewProps = {
  orgId: string; hasProject: boolean; isAdmin: boolean;
  missions: MissionRow[]; approvals: ApprovalRow[]; runs: RunRow[]; events: EventRow[]; memory: MemoryItem[];
  agents: { id: string; slug: string; name: string; title: string }[]; keys: string[]; worker?: WorkerRow;
  models: ModelOption[];
  /** semua agent aktif, untuk tabel rekomendasi model */
  catalog: { slug: string; name: string; title: string }[];
};

/** Tampilan halaman Asisten — murni dari props, agar bisa dirender tanpa database. */
export function AsistenView({ orgId, hasProject, isAdmin, missions, approvals, runs, events: eventRows, memory, agents, keys: keyList, worker, models, catalog }: AsistenViewProps) {
  const keys = new Set(keyList);
  const modelName = (id: string) => models.find((x) => x.id === id)?.name ?? id;
  const online = !!worker && isFresh(worker.last_seen_at);
  const proposed = missions.filter((m) => m.status === "proposed");
  const current = missions.filter((m) => m.status === "active" || m.status === "paused");
  const open = runs.filter((r) => ["queued", "running", "waiting_approval"].includes(r.status));
  const queued = open.filter((r) => r.status === "queued").length;
  const lastRun = new Map<string, RunRow>();
  for (const r of runs) if (!lastRun.has(r.mission_id)) lastRun.set(r.mission_id, r);
  const usedTemplates = new Set(missions.filter((m) => m.status !== "done").map((m) => m.title));

  const events = new Map<string, EventRow[]>();
  for (const e of eventRows) events.set(e.run_id, [...(events.get(e.run_id) ?? []), e]);

  return (
    <div className="space-y-6">
      <AutoRefresh fast={open.length > 0} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-primary"><Sparkles /> Asisten Otonom</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">Beri satu tujuan, lalu pegawai AI mengerjakannya sendiri: mencari bahan, membuat file, memeriksa jaringan. Aksi berisiko selalu berhenti di sini sampai Anda menyetujuinya.</p>
        </div>
        <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${online ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-slate-50 text-slate-600"}`}>
          <Server size={14} />
          {online ? <>Pekerja <b>{worker!.name}</b> aktif</> : worker ? <>Pekerja {worker.name} terakhir aktif {when(worker.last_seen_at)}</> : "Belum ada pekerja NAS yang tersambung"}
        </div>
      </div>

      {!hasProject && <Card className="p-5 text-sm text-muted">Buat project dulu — hasil misi disimpan di Drive project.</Card>}

      {/* ---------- Persetujuan ---------- */}
      {approvals.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 font-bold text-amber-800"><ShieldCheck size={18} /> Menunggu keputusan Anda ({approvals.length})</h2>
          {approvals.map((a) => (
            <Card key={a.id} className="space-y-3 border-amber-200 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-1.5 text-[10px] font-bold uppercase ${a.kind === "question" ? "bg-sky-100 text-sky-800" : a.risk === "sensitive" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{a.kind === "question" ? "Pertanyaan" : a.risk === "sensitive" ? "Aksi berisiko" : "Perubahan"}</span>
                <span className="text-xs text-muted">{a.mission?.title ?? "Misi"} · {when(a.created_at)}</span>
              </div>
              <p className="font-semibold">{a.summary}</p>
              {a.reason && <p className="whitespace-pre-wrap text-slate-600">{a.reason}</p>}
              {a.kind === "action" && (
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-primary">Lihat persisnya apa yang akan dijalankan</summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 text-xs">{JSON.stringify({ tool: a.tool_key, input: a.input, ...(a.detail ?? {}) }, null, 2)}</pre>
                </details>
              )}
              {!isAdmin ? <p className="text-xs text-muted">Hanya owner/admin organisasi yang bisa memutuskan.</p> : a.kind === "question" ? (
                <form action={decideApproval} className="space-y-2">
                  <input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="answer" />
                  <div className="flex flex-wrap gap-2">
                    {(a.options ?? []).map((o) => (
                      <button key={o.label} name="answer" value={o.label} title={o.desc} formNoValidate className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-left text-sm font-semibold text-primary hover:bg-sky-100">
                        {o.label}{o.desc && <span className="block text-xs font-normal text-slate-600">{o.desc}</span>}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input name="note" required minLength={2} placeholder="Jawaban lain" className="min-w-40 flex-1 rounded-lg border border-border bg-card px-2 py-1" />
                    <button className={btn}><FormPending size={12} /> Kirim jawaban lain</button>
                  </div>
                </form>
              ) : (
                <form action={decideApproval} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={a.id} />
                  <input name="note" placeholder="Catatan untuk agent (opsional)" className="min-w-40 flex-1 rounded-lg border border-border bg-card px-2 py-1" />
                  <button name="decision" value="approve" className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white"><FormPending size={12} /><Check size={14} /> Setujui</button>
                  <button name="decision" value="reject" className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-red-600"><FormPending size={12} /><X size={14} /> Tolak</button>
                </form>
              )}
            </Card>
          ))}
        </section>
      )}

      {/* ---------- Usulan asisten ---------- */}
      {proposed.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 font-bold"><Lightbulb size={18} className="text-amber-500" /> Usulan dari asisten ({proposed.length})</h2>
          {proposed.map((m) => (
            <Card key={m.id} className="space-y-2 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2"><b>{m.title}</b><span className="rounded-md bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600">{describeSchedule(m.schedule_kind, m.schedule)}</span><span className="text-xs text-muted">oleh {m.agent?.display_name ?? "Arka"}</span></div>
              {m.reason && <p className="text-slate-600">{m.reason}</p>}
              <details><summary className="cursor-pointer text-xs font-semibold text-primary">Lihat instruksi</summary><p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{m.instructions}</p></details>
              <form action={missionAction} className="flex gap-2">
                <input type="hidden" name="id" value={m.id} />
                <button name="op" value="activate" className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"><FormPending size={12} /><Check size={14} /> Aktifkan</button>
                <button name="op" value="reject" className={`${btn} text-red-600`}><FormPending size={12} /><X size={14} /> Tidak perlu</button>
              </form>
            </Card>
          ))}
        </section>
      )}

      {/* ---------- Misi baru ---------- */}
      {hasProject && (
        <section className="space-y-3">
          <h2 className="font-bold">Beri misi baru</h2>
          <Card className="p-4"><MissionForm agents={agents} models={models} /></Card>
          <div className="grid gap-3 sm:grid-cols-2">
            {MISSION_TEMPLATES.filter((t) => !usedTemplates.has(t.title)).map((t) => (
              <Card key={t.key} className="flex items-start gap-3 p-4 text-sm">
                <span className="text-2xl leading-none">{t.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{t.title} <span className="ml-1 rounded-md bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600">{describeSchedule(t.schedule_kind, t.schedule)}</span></div>
                  <p className="mt-0.5 text-xs text-muted">{t.description}</p>
                  {t.needs && !keys.has(t.needs) && <p className="mt-1 text-xs text-amber-700">Butuh kunci <code>{t.needs}</code> — isi di <Link href="/app/settings/api-keys" className="underline">Pengaturan → Kunci API</Link>.</p>}
                </div>
                <form action={applyTemplate}><input type="hidden" name="key" value={t.key} /><button className={btn}><FormPending size={12} /> Pakai</button></form>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* ---------- Misi aktif ---------- */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-bold"><CalendarClock size={18} /> Misi ({current.length})</h2>
        {current.length === 0 ? <Card className="p-5 text-sm text-muted">Belum ada misi. Tulis satu tujuan di atas atau pakai salah satu templat.</Card> : (
          <Card className="divide-y divide-border">
            {current.map((m) => {
              const lr = lastRun.get(m.id);
              const busy = lr && ["queued", "running", "waiting_approval"].includes(lr.status);
              const [label, cls] = MISSION_BADGE[m.status] ?? [m.status, ""];
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <div className="min-w-0 flex-1 basis-full sm:basis-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="truncate">{m.title}</b>
                      <span className={`rounded-md px-1.5 text-[10px] font-bold uppercase ${cls}`}>{label}</span>
                      {lr && <span className={`rounded-md px-1.5 text-[10px] font-bold uppercase ${RUN_BADGE[lr.status]?.[1] ?? ""}`}>{RUN_BADGE[lr.status]?.[0] ?? lr.status}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {m.agent?.display_name ?? "Arka"} · {describeSchedule(m.schedule_kind, m.schedule)}
                      {m.status === "active" && m.next_run_at && <> · berikutnya {when(m.next_run_at, m.tz)}</>}
                      {m.last_run_at && <> · terakhir {when(m.last_run_at, m.tz)}</>}
                      {m.approval_mode === "all_writes" && " · semua perubahan minta izin"}
                    </div>
                    <form action={setMissionModel} className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <input type="hidden" name="id" value={m.id} />
                      <span className="text-muted">Model:</span>
                      <select name="model" defaultValue={m.model ?? ""} className="h-7 max-w-56 rounded-md border border-border bg-card px-1.5 text-xs" aria-label={`Model AI untuk ${m.title}`}>
                        <option value="">Rekomendasi: {modelName(recommendedModel(m.agent?.slug ?? ARKA).model)}</option>
                        {models.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                      <button className="rounded-md border border-border px-1.5 py-0.5 font-semibold hover:bg-slate-100"><FormPending size={10} />Simpan</button>
                    </form>
                  </div>
                  <form action={missionAction} className="flex flex-wrap items-center gap-1.5">
                    <input type="hidden" name="id" value={m.id} />
                    {m.conversation_id && <Link href={`/app/chat/${m.conversation_id}`} className={btn} title="Buka laporan di chat"><MessagesSquare size={13} /> Laporan</Link>}
                    {!busy && <button name="op" value="run" className={btn} title="Jalankan sekarang"><FormPending size={12} /><Play size={13} /> Jalankan</button>}
                    {m.status === "active" ? <button name="op" value="pause" className={btn} title="Jeda"><Pause size={13} /></button> : <button name="op" value="resume" className={btn} title="Lanjutkan"><Play size={13} /> Lanjut</button>}
                    <button name="op" value="delete" className={`${btn} text-red-600`} title="Hapus misi dan riwayatnya"><Trash2 size={13} /></button>
                  </form>
                </div>
              );
            })}
          </Card>
        )}
        {queued > 0 && !online && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <span>{queued} run menunggu dikerjakan, tetapi tidak ada pekerja NAS yang aktif. Misi tanpa akses jaringan rumah bisa dikerjakan di sini:</span>
            {isAdmin && <ProcessQueueButton />}
          </div>
        )}
      </section>

      {/* ---------- Riwayat ---------- */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-bold"><History size={18} /> Riwayat pengerjaan</h2>
        {runs.length === 0 ? <Card className="p-5 text-sm text-muted">Belum ada yang dikerjakan.</Card> : (
          <Card className="divide-y divide-border">
            {runs.map((r) => {
              const [label, cls] = RUN_BADGE[r.status] ?? [r.status, ""];
              const ev = events.get(r.id) ?? [];
              return (
                <details key={r.id} className="p-3 text-sm">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <span className={`rounded-md px-1.5 text-[10px] font-bold uppercase ${cls}`}>{label}</span>
                    <b className="min-w-0 flex-1 basis-2/3 truncate sm:basis-0">{r.mission?.title ?? "Misi dihapus"}</b>
                    <span className="text-xs text-muted">{when(r.created_at)} · {r.steps} langkah{Number(r.credit_cost) > 0 && ` · ${Number(r.credit_cost).toFixed(3)} kredit`}</span>
                  </summary>
                  <div className="mt-2 space-y-2">
                    {r.error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{r.error}</p>}
                    {r.summary && <p className="whitespace-pre-wrap text-slate-700">{r.summary}</p>}
                    {ev.length > 0 && <ol className="space-y-0.5 border-l-2 border-border pl-3 text-xs text-slate-600">{ev.map((e) => <li key={e.id} className={e.kind === "error" ? "text-red-600" : e.kind === "approval" ? "text-amber-700" : ""}>{e.label}</li>)}</ol>}
                    <div className="flex gap-2">
                      {r.mission?.conversation_id && <Link href={`/app/chat/${r.mission.conversation_id}`} className={btn}><MessagesSquare size={13} /> Buka laporan lengkap</Link>}
                      {["queued", "waiting_approval"].includes(r.status) && <form action={cancelRun}><input type="hidden" name="id" value={r.id} /><button className={`${btn} text-red-600`}><FormPending size={12} /><Ban size={13} /> Batalkan</button></form>}
                    </div>
                  </div>
                </details>
              );
            })}
          </Card>
        )}
      </section>

      {/* ---------- Rekomendasi model per agent ---------- */}
      <details className="rounded-2xl border border-border bg-card p-4 text-sm">
        <summary className="cursor-pointer font-bold">Model AI tiap agent</summary>
        <p className="mt-2 text-xs text-muted">
          Setiap misi memakai model rekomendasi agent-nya, kecuali Anda memilih model lain di misi itu. <b>{modelName(MODEL_TIERS.hemat)}</b> untuk pekerjaan rutin dan berpola (paling hemat yang tetap andal memakai tool); <b>{modelName(MODEL_TIERS.standar)}</b> untuk tulisan, riset, strategi, dan perhitungan. Model gratis bisa dipilih per misi, tetapi kuotanya terbatas dan kurang andal untuk kerja tanpa diawasi.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs">
            <thead><tr className="text-left text-muted"><th className="py-1 pr-2">Agent</th><th className="py-1 pr-2">Model</th><th className="py-1">Alasan</th></tr></thead>
            <tbody>
              {catalog.map((a) => { const r = recommendedModel(a.slug); return (
                <tr key={a.slug} className="border-t border-border align-top">
                  <td className="py-1 pr-2 font-semibold whitespace-nowrap">{a.name}<span className="block font-normal text-muted">{a.title}</span></td>
                  <td className="py-1 pr-2 whitespace-nowrap"><span className={`rounded-md px-1.5 text-[10px] font-bold uppercase ${r.tier === "hemat" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-800"}`}>{r.tier}</span> {modelName(r.model)}</td>
                  <td className="py-1 text-slate-600">{r.why}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      </details>

      {/* ---------- Memori ---------- */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-bold"><Brain size={18} /> Yang dipelajari tentang Anda ({memory.length})</h2>
        <p className="text-xs text-muted">Semua pegawai AI membaca catatan ini di setiap pekerjaan dan chat. Hapus yang keliru; tambahkan sendiri hal yang ingin selalu diikuti.</p>
        <Card className="divide-y divide-border">
          {memory.map((m) => (
            <div key={m.id} className="flex items-start gap-3 p-3 text-sm">
              <span className="mt-0.5 shrink-0 rounded-md bg-slate-100 px-1.5 text-[10px] font-bold uppercase text-slate-600">{MEMORY_LABEL[m.kind] ?? m.kind}</span>
              <div className="min-w-0 flex-1">{m.content}{m.evidence && <span className="block text-xs text-muted">{m.source === "user" ? "Ditulis Anda" : `Dasar: ${m.evidence}`}</span>}</div>
              <form action={deleteMemory}><input type="hidden" name="id" value={m.id} /><button aria-label="Hapus" className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><FormPending size={12} /><Trash2 size={15} /></button></form>
            </div>
          ))}
          <form action={addMemory} className="flex flex-wrap items-center gap-2 p-3">
            <select name="kind" className="h-9 rounded-lg border border-border bg-card px-2 text-sm"><option value="preference">Preferensi</option><option value="habit">Kebiasaan</option><option value="fact">Fakta</option></select>
            <input name="content" required minLength={8} placeholder="Mis. “Laporan untuk saya selalu berbentuk tabel ringkas.”" className="h-9 min-w-48 flex-1 rounded-lg border border-border bg-card px-3 text-sm" />
            <button className={btn}><FormPending size={12} /> Tambah</button>
          </form>
        </Card>
      </section>

      {/* ---------- Panduan pekerja ---------- */}
      <details className="rounded-2xl border border-border bg-card p-4 text-sm">
        <summary className="flex cursor-pointer items-center gap-2 font-bold"><Server size={16} /> Menyiapkan pekerja di NAS / server rumah</summary>
        <div className="mt-3 space-y-2 text-slate-700">
          <p>Pekerja adalah program kecil yang berjalan terus di jaringan rumah Anda. Ia mengambil misi dari sini, mengerjakannya, dan bisa menjangkau router di alamat lokal. Tidak ada port yang dibuka ke internet.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Salin repo aplikasi ini ke NAS, lalu salin <code>worker/env.example</code> menjadi <code>worker/.env</code>.</li>
            <li>Isi <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>, dan <code>AUTOPILOT_ORG_ID={orgId}</code>.</li>
            <li>Jalankan <code>docker compose -f worker/docker-compose.yml up -d --build</code> (Synology: Container Manager → Project).</li>
            <li>Status di kanan atas halaman ini berubah menjadi <b>aktif</b> dalam beberapa detik.</li>
          </ol>
          <p className="text-xs text-muted">Panduan lengkap, termasuk akses router yang aman dan persetujuan lewat Telegram, ada di <code>worker/README.md</code>.</p>
          {isAdmin && <p className="pt-1"><ProcessQueueButton label="Kerjakan antrean di server ini sekarang" /></p>}
        </div>
      </details>
    </div>
  );
}
