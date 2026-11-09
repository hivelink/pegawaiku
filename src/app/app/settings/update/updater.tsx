"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, CheckCircle2, XCircle, Loader2, Database, History, KeyRound, RotateCcw, Rocket } from "lucide-react";

type Secrets = Record<string, { set: boolean; source?: string; value?: string }>;
type Preview = { head: { sha: string; message: string; date: string; repo: string; branch: string }; files: { path: string; size: number; status: "new" | "changed" | "same" }[]; skipped: string[]; migrations: string[] };
type Mig = { name: string; applied: boolean };
type Commit = { sha: string; url: string; message: string; author: string; date: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

const box = "rounded-2xl border border-border bg-card p-4";
const btn = "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50";

export function Updater({ supabaseRef }: { supabaseRef: string }) {
  const [secrets, setSecrets] = useState<Secrets | null>(null);
  const [err, setErr] = useState("");
  const loadSecrets = useCallback(() => api<Secrets>("/api/admin/secrets").then(setSecrets).catch((e) => setErr(e.message)), []);
  useEffect(() => { loadSecrets(); }, [loadSecrets]);
  const ghReady = !!secrets?.github_token?.set;
  const sbReady = !!secrets?.supabase_access_token?.set;

  return (
    <div className="space-y-4">
      {err && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      <Setup secrets={secrets} onSaved={loadSecrets} supabaseRef={supabaseRef} />
      {ghReady ? <><Deploy /><Migrations sbReady={sbReady} supabaseRef={supabaseRef} /><Rollback /></> : secrets && <div className={`${box} text-sm text-muted`}>Isi token GitHub di atas untuk mengaktifkan unggah pembaruan.</div>}
    </div>
  );
}

// ---------------- Token & koneksi ----------------
function Setup({ secrets, onSaved, supabaseRef }: { secrets: Secrets | null; onSaved: () => void; supabaseRef: string }) {
  const [manual, setOpen] = useState<boolean | null>(null);
  const open = manual ?? (!!secrets && !secrets.github_token?.set); // otomatis terbuka bila token GitHub belum ada
  const items: { key: string; label: string; secret: boolean; help: React.ReactNode; placeholder: string }[] = [
    { key: "github_token", label: "Token GitHub", secret: true, placeholder: "github_pat_…", help: <>Buat di <a className="text-primary underline" target="_blank" rel="noreferrer" href="https://github.com/settings/personal-access-tokens/new">GitHub → Fine-grained token</a>: Repository access = hanya repo aplikasi; Permissions → <b>Contents: Read and write</b>, <b>Commit statuses: Read</b>.</> },
    { key: "supabase_access_token", label: "Supabase access token", secret: true, placeholder: "sbp_…", help: <>Untuk menjalankan migrasi dengan 1 klik. Buat di <a className="text-primary underline" target="_blank" rel="noreferrer" href="https://supabase.com/dashboard/account/tokens">Supabase → Account → Access Tokens</a>. Opsional — tanpa ini kamu tetap bisa menyalin SQL.</> },
    { key: "github_repo", label: "Repo (owner/nama)", secret: false, placeholder: "hivelink/pegawaiku", help: "Kosongkan untuk deteksi otomatis dari Vercel." },
    { key: "github_branch", label: "Branch", secret: false, placeholder: "main", help: "Kosongkan = main / branch produksi Vercel." },
  ];
  return (
    <div className={box}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left font-bold"><KeyRound size={16} /> Koneksi
        <span className="ml-auto flex gap-2 text-xs font-normal">
          <Dot ok={!!secrets?.github_token?.set} label="GitHub" /><Dot ok={!!secrets?.supabase_access_token?.set} label="Supabase" />
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted">Token disimpan di database dengan akses khusus admin platform dan tidak pernah ditampilkan lagi. Token yang diatur lewat env Vercel otomatis diutamakan. Project Supabase: <code>{supabaseRef}</code></p>
          {items.map((it) => <SecretRow key={it.key} k={it.key} label={it.label} secret={it.secret} help={it.help} placeholder={it.placeholder} state={secrets?.[it.key]} onSaved={onSaved} />)}
        </div>
      )}
    </div>
  );
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`rounded-full px-2 py-0.5 ${ok ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{ok ? "●" : "○"} {label}</span>;
}

function SecretRow({ k, label, secret, help, placeholder, state, onSaved }: { k: string; label: string; secret: boolean; help: React.ReactNode; placeholder: string; state?: { set: boolean; source?: string; value?: string }; onSaved: () => void }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function save(value: string) {
    setBusy(true); setMsg("");
    try { await api("/api/admin/secrets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: k, value }) }); setV(""); setMsg(value ? "Tersimpan" : "Dihapus"); onSaved(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-2"><b>{label}</b>{state?.set && <span className="text-xs text-emerald-700">✓ terpasang{state.source === "env" ? " (env Vercel)" : ""}{!secret && state.value ? `: ${state.value}` : ""}</span>}</div>
      <div className="flex gap-2">
        <input type={secret ? "password" : "text"} autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} placeholder={state?.set && secret ? "•••••••• (isi untuk mengganti)" : placeholder} className="min-w-0 flex-1 rounded-lg border border-border px-2 py-1.5" />
        <button type="button" disabled={busy || !v.trim()} onClick={() => save(v)} className={`${btn} bg-primary text-white`}>Simpan</button>
        {state?.set && state.source !== "env" && <button type="button" disabled={busy} onClick={() => save("")} className={`${btn} border border-border text-red-600`}>Hapus</button>}
      </div>
      <p className="text-xs text-muted">{help} {msg && <b className="ml-1">{msg}</b>}</p>
    </div>
  );
}

// ---------------- Unggah & terapkan ----------------
function Deploy() {
  const [file, setFile] = useState<File | null>(null);
  const [prev, setPrev] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "apply">("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [deployed, setDeployed] = useState<{ sha: string; count: number } | null>(null);
  const inp = useRef<HTMLInputElement>(null);

  async function preview(f: File) {
    setFile(f); setPrev(null); setErr(""); setDeployed(null); setBusy("preview");
    try { const fd = new FormData(); fd.append("file", f); setPrev(await api<Preview>("/api/admin/update/preview", { method: "POST", body: fd })); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  async function apply() {
    if (!file || !prev) return;
    setBusy("apply"); setErr("");
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("expected_head", prev.head.sha); fd.append("message", msg || `Pembaruan dari aplikasi: ${file.name}`);
      const r = await api<{ sha: string; count: number; unchanged?: boolean }>("/api/admin/update/apply", { method: "POST", body: fd });
      if (r.unchanged) setErr("Tidak ada file yang berubah — repo sudah sama dengan paket ini.");
      else { setDeployed({ sha: r.sha, count: r.count }); setPrev(null); setFile(null); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  const changed = prev?.files.filter((f) => f.status !== "same") ?? [];
  return (
    <div className={`${box} space-y-3`}>
      <div className="flex items-center gap-2 font-bold"><Upload size={16} /> Unggah paket pembaruan</div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) preview(f); }}
        onClick={() => inp.current?.click()}
        className="cursor-pointer rounded-xl border-2 border-dashed border-border p-6 text-center text-sm text-muted hover:border-primary hover:bg-sky-50"
      >
        {busy === "preview" ? <span className="inline-flex items-center gap-2"><Loader2 className="animate-spin" size={16} /> Membaca paket & membandingkan dengan repo…</span> : file ? <b>{file.name}</b> : <>Seret file <b>pegawaiku-update-XX.zip</b> ke sini atau klik untuk memilih</>}
        <input ref={inp} type="file" accept=".zip,application/zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) preview(f); e.target.value = ""; }} />
      </div>
      {err && <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</div>}
      {prev && (
        <div className="space-y-2 text-sm">
          <div className="text-xs text-muted">Repo <code>{prev.head.repo}</code> · branch <code>{prev.head.branch}</code> · versi sekarang <code>{prev.head.sha.slice(0, 7)}</code> “{prev.head.message.split("\n")[0]}”</div>
          <div className="flex gap-3 text-xs"><span className="text-emerald-700">{prev.files.filter((f) => f.status === "new").length} baru</span><span className="text-amber-700">{prev.files.filter((f) => f.status === "changed").length} berubah</span><span className="text-muted">{prev.files.filter((f) => f.status === "same").length} sama</span>{prev.skipped.length > 0 && <span className="text-muted">{prev.skipped.length} dilewati</span>}</div>
          <div className="max-h-56 overflow-auto rounded-lg bg-slate-50 p-2 font-mono text-xs">
            {changed.map((f) => <div key={f.path}><span className={f.status === "new" ? "text-emerald-700" : "text-amber-700"}>{f.status === "new" ? "+ " : "~ "}</span>{f.path}</div>)}
            {!changed.length && <div>Tidak ada perubahan.</div>}
          </div>
          {prev.migrations.length > 0 && <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Paket ini berisi migrasi database: <b>{prev.migrations.join(", ")}</b>. Setelah deploy selesai, jalankan di bagian Migrasi di bawah.</div>}
          {changed.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Catatan pembaruan (opsional)" className="min-w-40 flex-1 rounded-lg border border-border px-2 py-1.5" />
              <button type="button" onClick={apply} disabled={!!busy} className={`${btn} bg-emerald-600 text-white`}>{busy === "apply" ? <Loader2 className="animate-spin" size={14} /> : <Rocket size={14} />} Terapkan {changed.length} file</button>
            </div>
          )}
        </div>
      )}
      {deployed && <DeployStatus sha={deployed.sha} count={deployed.count} />}
    </div>
  );
}

function DeployStatus({ sha, count }: { sha: string; count: number }) {
  const [st, setSt] = useState<{ overall: string; items: { name: string; state: string; description: string; url: string }[] } | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try { const r = await api<typeof st & object>(`/api/admin/update/status?sha=${sha}`); if (!stop) setSt(r); if (r.overall === "success" || r.overall === "failure") return; } catch { /* coba lagi */ }
      if (!stop) { setTries((t) => t + 1); setTimeout(tick, 8000); }
    };
    tick();
    return () => { stop = true; };
  }, [sha]);
  const overall = st?.overall ?? "pending";
  return (
    <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
      <div className="flex items-center gap-2">
        {overall === "success" ? <CheckCircle2 className="text-emerald-600" size={18} /> : overall === "failure" ? <XCircle className="text-red-600" size={18} /> : <Loader2 className="animate-spin text-primary" size={18} />}
        <b>{overall === "success" ? "Deploy selesai — muat ulang halaman untuk memakai versi baru." : overall === "failure" ? "Deploy gagal — periksa log build di Vercel, atau kembalikan ke versi sebelumnya." : `${count} file tersimpan ke GitHub (${sha.slice(0, 7)}). Vercel sedang membangun…`}</b>
      </div>
      {st?.items.map((i) => <div key={i.name} className="text-xs text-muted">• {i.name}: {i.state}{i.description ? ` — ${i.description}` : ""} {i.url && <a className="text-primary underline" href={i.url} target="_blank" rel="noreferrer">detail</a>}</div>)}
      {overall === "unknown" && tries > 4 && <div className="text-xs text-muted">Status deploy tidak terbaca (token perlu izin Commit statuses: Read). Cek manual di dashboard Vercel; biasanya selesai dalam 1–3 menit.</div>}
      {overall === "success" && <button type="button" onClick={() => location.reload()} className={`${btn} bg-primary text-white`}>Muat ulang</button>}
    </div>
  );
}

// ---------------- Migrasi database ----------------
function Migrations({ sbReady, supabaseRef }: { sbReady: boolean; supabaseRef: string }) {
  const [list, setList] = useState<Mig[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(() => api<{ migrations: Mig[] }>("/api/admin/migrations").then((r) => setList(r.migrations)).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const pending = (list ?? []).filter((m) => !m.applied);
  async function run(name: string) {
    if (!confirm(`Jalankan migrasi ${name} di database produksi?`)) return;
    setBusy(name); setErr(""); setNote("");
    try { await api("/api/admin/migrations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }); setNote(`✅ ${name} berhasil dijalankan.`); load(); }
    catch (e) { setErr(`${name}: ${(e as Error).message}`); } finally { setBusy(""); }
  }
  async function copy(name: string) {
    try { const r = await api<{ sql: string }>(`/api/admin/migrations?sql=${encodeURIComponent(name)}`); await navigator.clipboard.writeText(r.sql); setNote(`SQL ${name} tersalin — tempel di Supabase SQL Editor lalu Run.`); }
    catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className={`${box} space-y-2`}>
      <div className="flex items-center gap-2 font-bold"><Database size={16} /> Migrasi database <span className="text-xs font-normal text-muted">{list ? `${pending.length} belum dijalankan` : "memuat…"}</span></div>
      {err && <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</div>}
      {note && <div className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{note}</div>}
      {list && pending.length === 0 && <div className="text-sm text-muted">Database sudah mutakhir.</div>}
      {pending.map((m) => (
        <div key={m.name} className="flex flex-wrap items-center gap-2 text-sm">
          <code className="flex-1">{m.name}</code>
          {sbReady && <button type="button" disabled={!!busy} onClick={() => run(m.name)} className={`${btn} bg-emerald-600 text-white`}>{busy === m.name ? <Loader2 className="animate-spin" size={14} /> : null} Jalankan</button>}
          <button type="button" onClick={() => copy(m.name)} className={`${btn} border border-border`}>Salin SQL</button>
        </div>
      ))}
      {!sbReady && pending.length > 0 && <p className="text-xs text-muted">Tanpa Supabase access token: salin SQL lalu jalankan di <a className="text-primary underline" target="_blank" rel="noreferrer" href={`https://supabase.com/dashboard/project/${supabaseRef}/sql/new`}>SQL Editor</a>. Setelah itu tandai dengan menjalankan <code>insert into schema_migrations(name) values (&apos;nama.sql&apos;);</code> atau pasang token agar otomatis.</p>}
    </div>
  );
}

// ---------------- Riwayat & kembalikan ----------------
function Rollback() {
  const [data, setData] = useState<{ commits: Commit[] } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => api<{ commits: Commit[] }>("/api/admin/update/history").then(setData).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  async function rollback(c: Commit) {
    if (!confirm(`Kembalikan kode aplikasi ke versi ${c.sha.slice(0, 7)} “${c.message}”?\n\nCatatan: perubahan database (migrasi) TIDAK ikut dikembalikan.`)) return;
    setBusy(c.sha); setErr("");
    try { await api("/api/admin/update/rollback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha: c.sha }) }); await load(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  return (
    <details className={box}>
      <summary className="flex cursor-pointer items-center gap-2 font-bold"><History size={16} /> Riwayat versi & kembalikan</summary>
      {err && <div className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</div>}
      <div className="mt-2 divide-y divide-border text-sm">
        {data?.commits.map((c, i) => (
          <div key={c.sha} className="flex flex-wrap items-center gap-2 py-2">
            <a href={c.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-primary">{c.sha.slice(0, 7)}</a>
            <span className="min-w-0 flex-1 truncate">{c.message}</span>
            <span className="text-xs text-muted">{c.date ? new Date(c.date).toLocaleString("id-ID") : ""}</span>
            {i === 0 ? <span className="rounded-full bg-emerald-100 px-2 text-xs text-emerald-700">aktif</span> : <button type="button" disabled={!!busy} onClick={() => rollback(c)} className={`${btn} border border-border text-xs`}>{busy === c.sha ? <Loader2 className="animate-spin" size={12} /> : <RotateCcw size={12} />} Kembalikan</button>}
          </div>
        ))}
      </div>
    </details>
  );
}
