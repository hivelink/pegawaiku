import Link from "next/link";
import { Network, Router, Server, Wifi, HardDrive, Cctv, Box, Trash2, Power, PowerOff, Pin, UserX, Save, ExternalLink, ArrowDown, ArrowUp, History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FormPending } from "@/components/ui/form-pending";
import { KIND_LABEL, STATUS_STALE_MS, type DeviceKind, type NetCommand, type NetDevice, type NetPort, type NetStatus } from "@/lib/network/types";
import { addDevice, deleteDevice, deletePort, importPorts, queueCommand } from "./actions";
import { ConfirmButton } from "./confirm";
import { AutoRefresh } from "../asisten/live";

const ICON: Record<DeviceKind, React.ComponentType<{ size?: number; className?: string }>> = { router: Router, switch: Network, ap: Wifi, nas: HardDrive, camera: Cctv, other: Box };
const btn = "inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold hover:bg-slate-100";
const field = "h-9 rounded-lg border border-border bg-card px-2 text-sm";
const CMD_BADGE: Record<string, [string, string]> = { queued: ["Antre", "bg-slate-100 text-slate-700"], running: ["Berjalan", "bg-sky-100 text-sky-800"], done: ["Selesai", "bg-emerald-100 text-emerald-700"], failed: ["Gagal", "bg-red-100 text-red-700"] };

const ageMs = (iso: string) => Date.now() - new Date(iso).getTime();
const when = (iso: string) => { try { return new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso.slice(0, 16); } };
function since(iso: string) { const m = Math.max(0, Math.round(ageMs(iso) / 60_000)); return m < 1 ? "baru saja" : m < 60 ? `${m} menit` : m < 1440 ? `${Math.round(m / 60)} jam` : `${Math.round(m / 1440)} hari`; }
export function rate(bps: number | null) { if (bps == null) return "—"; if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`; if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`; if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} kbps`; return `${bps} bps`; }
const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);

type State = "online" | "offline" | "unknown";
function stateOf(s: NetStatus | undefined): State { return !s || ageMs(s.checked_at) > STATUS_STALE_MS ? "unknown" : s.online ? "online" : "offline"; }
const DOT: Record<State, string> = { online: "bg-emerald-500", offline: "bg-red-500", unknown: "bg-slate-300" };
const STATE_TXT: Record<State, string> = { online: "Hidup", offline: "Mati", unknown: "Belum terpantau" };

/** Tombol yang mengantrekan satu perintah router untuk dijalankan pekerja. */
function Cmd({ routerId, kind, id, name, ask, children, title, danger }: { routerId: string; kind: string; id?: string; name?: string; ask?: string; children: React.ReactNode; title?: string; danger?: boolean }) {
  return (
    <form action={queueCommand} className="inline">
      <input type="hidden" name="device_id" value={routerId} /><input type="hidden" name="kind" value={kind} />
      {id && <input type="hidden" name="target_id" value={id} />}{name && <input type="hidden" name="target_name" value={name} />}
      {ask ? <ConfirmButton ask={ask} title={title} className={`${btn} ${danger ? "text-red-600" : ""}`}>{children}</ConfirmButton> : <button title={title} className={btn}><FormPending size={12} />{children}</button>}
    </form>
  );
}

export type JaringanViewProps = { isAdmin: boolean; workerOnline: boolean; hasRouterKey: boolean; devices: NetDevice[]; ports: NetPort[]; status: NetStatus[]; commands: NetCommand[] };

export function JaringanView({ isAdmin, workerOnline, hasRouterKey, devices, ports, status, commands }: JaringanViewProps) {
  const st = new Map(status.map((s) => [s.device_id, s]));
  const states = devices.map((d) => stateOf(st.get(d.id)));
  const up = states.filter((s) => s === "online").length, down = states.filter((s) => s === "offline").length;
  const router = devices.find((d) => d.driver === "mikrotik");
  const rs = router ? st.get(router.id) : undefined;
  const rd = rs && stateOf(rs) !== "unknown" ? rs.data : null;
  const routerPorts = new Map(ports.filter((p) => p.device_id === router?.id).map((p) => [p.name, p]));
  const bound = (rd?.leases ?? []).filter((l) => l.status === "bound");
  const servers = [...new Set((rd?.leases ?? []).map((l) => l.server))].sort();
  const busy = commands.some((c) => c.status === "queued" || c.status === "running");
  const memPct = rd?.mem_total ? Math.round((1 - (rd.mem_free ?? 0) / rd.mem_total) * 100) : null;

  return (
    <div className="space-y-6">
      <AutoRefresh fast={busy} />
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-primary"><Network /> Jaringan</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">Peta perangkat dan port, status terkini, dan pengaturan router. Data dikumpulkan pekerja di jaringan rumah tiap menit; perintah dari sini dijalankan pekerja yang sama.</p>
      </div>

      {!workerOnline && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Pekerja di NAS belum aktif, jadi status di bawah tidak diperbarui dan perintah tidak dijalankan. Server web ini tidak bisa menjangkau alamat 192.168.x.x Anda. Pasang pekerja lewat panduan di menu <Link href="/app/asisten" className="font-semibold underline">Asisten</Link>.
        </div>
      )}
      {router && !hasRouterKey && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Kunci <code>mikrotik</code> belum diisi. Isi di <Link href="/app/settings/api-keys" className="font-semibold underline">Pengaturan → Kunci API</Link> dengan format <code>https://IP-router|user|kata-sandi</code>.</div>
      )}

      {/* ---------- Ringkasan ---------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Perangkat hidup", devices.length ? `${up} / ${devices.length}` : "—", down ? `${down} mati` : devices.length - up - down ? `${devices.length - up - down} belum terpantau` : "semua hidup", down ? "text-red-600" : ""],
          ["Klien DHCP aktif", rd ? String(bound.length) : "—", rd ? `${servers.length} jaringan` : "butuh data router", ""],
          ["Pengguna hotspot", rd ? (rd.hotspot_available ? String(rd.hotspot.length) : "—") : "—", rd && !rd.hotspot_available ? "hotspot belum disiapkan" : "sedang tersambung", ""],
          ["Beban router", rd?.cpu != null ? `${rd.cpu}%` : "—", rd ? `memori ${memPct ?? "?"}% · hidup ${rd.uptime}` : "butuh data router", (rd?.cpu ?? 0) >= 85 ? "text-red-600" : ""],
        ].map(([label, value, sub, cls]) => (
          <Card key={label} className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
            <div className={`mt-1 text-2xl font-extrabold ${cls || "text-primary"}`}>{value}</div>
            <div className="text-xs text-muted">{sub}</div>
          </Card>
        ))}
      </div>

      {/* ---------- Perangkat ---------- */}
      <section className="space-y-2">
        <h2 className="font-bold">Perangkat ({devices.length})</h2>
        {devices.length === 0 && <Card className="p-5 text-sm text-muted">Belum ada perangkat. Tambahkan router, switch, dan AP Anda di bawah.</Card>}
        <div className="grid gap-3 md:grid-cols-2">
          {devices.map((d) => {
            const s = st.get(d.id), state = stateOf(s), Icon = ICON[d.kind] ?? Box;
            const pl = ports.filter((p) => p.device_id === d.id);
            const url = d.mgmt_ip ? `${d.mgmt_port === 443 ? "https" : "http"}://${d.mgmt_ip}${[80, 443].includes(d.mgmt_port) ? "" : `:${d.mgmt_port}`}` : null;
            return (
              <Card key={d.id} className="p-4 text-sm">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-primary"><Icon size={20} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><b className="truncate">{d.name}</b><span className="flex items-center gap-1 text-xs font-semibold"><span className={`h-2 w-2 rounded-full ${DOT[state]}`} />{STATE_TXT[state]}</span></div>
                    <div className="text-xs text-muted">{KIND_LABEL[d.kind]}{d.vendor || d.model ? ` · ${[d.vendor, d.model].filter(Boolean).join(" ")}` : ""}</div>
                    <div className="mt-1 text-xs text-slate-600">
                      {d.mgmt_ip ?? "IP belum diisi"}
                      {s && state !== "unknown" && <>{s.latency_ms != null && ` · ${s.latency_ms} ms`} · {state === "online" ? "hidup" : "mati"} sejak {since(s.changed_at)} lalu</>}
                      {d.driver === "generic" && s?.seen_by_router === false && state === "offline" && " · tidak terlihat router"}
                    </div>
                    {s?.error && state !== "unknown" && <div className="mt-1 text-xs text-amber-700">{s.error}</div>}
                  </div>
                  {url && <a href={url} target="_blank" rel="noopener" className={btn} title="Buka halaman pengaturan perangkat (hanya bisa dari jaringan rumah)"><ExternalLink size={12} /> Buka</a>}
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-primary">Peta port ({pl.length}){d.driver === "generic" ? " · diatur dari halaman perangkatnya" : ""}</summary>
                  {pl.length > 0 && (
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {pl.map((p) => (
                          <tr key={p.id} className="border-t border-border align-top">
                            <td className="py-1 pr-2 font-semibold whitespace-nowrap">{p.name}</td><td className="py-1 pr-2">{p.purpose ?? "—"}</td><td className="py-1 pr-2 text-muted">{p.config ?? ""}</td>
                            <td className="py-1 text-right"><form action={deletePort}><input type="hidden" name="id" value={p.id} /><button aria-label="Hapus port" className="text-slate-400 hover:text-red-600"><FormPending size={10} /><Trash2 size={12} /></button></form></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <form action={importPorts} className="mt-2 space-y-1">
                    <input type="hidden" name="device_id" value={d.id} />
                    <textarea name="lines" rows={3} required placeholder={"Satu port per baris: nama | kegunaan | konfigurasi\nether5 | Ke switch port 9 | Trunk · Native10 · 20,30"} className="w-full rounded-lg border border-border bg-card p-2 text-xs" />
                    <div className="flex items-center justify-between gap-2">
                      <button className={btn}><FormPending size={12} /> Simpan port</button>
                    </div>
                  </form>
                  <form action={deleteDevice} className="mt-2 text-right"><input type="hidden" name="id" value={d.id} /><ConfirmButton ask={`Hapus ${d.name} beserta peta port dan riwayatnya?`} className={`${btn} text-red-600`}><Trash2 size={12} /> Hapus perangkat</ConfirmButton></form>
                </details>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ---------- Router ---------- */}
      {router && rd && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-bold">Router {rd.identity || router.name}</h2>
            <span className="text-xs text-muted">{rd.board} · RouterOS {rd.version} · diperbarui {when(rs!.checked_at)}</span>
            {isAdmin && <span className="ml-auto"><Cmd routerId={router.id} kind="backup" title="Simpan backup konfigurasi di router"><Save size={12} /> Backup sekarang</Cmd></span>}
          </div>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="p-2 pl-4">Interface</th><th className="p-2">Kegunaan</th><th className="p-2">Status</th><th className="p-2 text-right">Unduh</th><th className="p-2 text-right">Unggah</th><th className="p-2 pr-4" /></tr></thead>
              <tbody>
                {rd.interfaces.map((i) => {
                  const p = routerPorts.get(i.name);
                  return (
                    <tr key={i.id} className="border-t border-border">
                      <td className="p-2 pl-4 font-semibold whitespace-nowrap">{i.name}<span className="ml-1 text-xs font-normal text-muted">{i.type}</span></td>
                      <td className="p-2 text-xs text-slate-600">{p?.purpose ?? i.comment ?? ""}{p?.config && <span className="block text-muted">{p.config}</span>}</td>
                      <td className="p-2 text-xs font-semibold whitespace-nowrap"><span className={`mr-1 inline-block h-2 w-2 rounded-full ${i.disabled ? "bg-slate-300" : i.running ? "bg-emerald-500" : "bg-red-500"}`} />{i.disabled ? "Dinonaktifkan" : i.running ? "Tersambung" : "Tanpa link"}</td>
                      <td className="p-2 text-right text-xs tabular-nums whitespace-nowrap"><ArrowDown size={11} className="inline text-slate-400" /> {rate(i.rx_bps)}</td>
                      <td className="p-2 text-right text-xs tabular-nums whitespace-nowrap"><ArrowUp size={11} className="inline text-slate-400" /> {rate(i.tx_bps)}</td>
                      <td className="p-2 pr-4 text-right">
                        {isAdmin && (i.disabled
                          ? <Cmd routerId={router.id} kind="interface_enable" id={i.id} name={i.name} title="Hidupkan interface"><Power size={12} /> Hidupkan</Cmd>
                          : <Cmd routerId={router.id} kind="interface_disable" id={i.id} name={i.name} danger ask={`Matikan ${i.name}${p?.purpose ? ` (${p.purpose})` : ""}?\n\nSemua yang tersambung lewat port ini akan terputus. Bila ini jalur pekerja ke router, Anda harus menghidupkannya lagi langsung dari router. Backup dibuat otomatis sebelum perubahan.`} title="Matikan interface"><PowerOff size={12} /> Matikan</Cmd>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="p-4 text-sm">
              <h3 className="font-bold">Klien DHCP ({bound.length} aktif)</h3>
              {servers.map((sv) => {
                const list = rd.leases.filter((l) => l.server === sv);
                return (
                  <details key={sv} className="mt-2" open={servers.length <= 2}>
                    <summary className="cursor-pointer text-xs font-semibold text-primary">{sv || "tanpa nama"} · {list.filter((l) => l.status === "bound").length} aktif dari {list.length}</summary>
                    <table className="mt-1 w-full text-xs">
                      <tbody>
                        {list.map((l) => (
                          <tr key={l.id} className="border-t border-border">
                            <td className="py-1 pr-2 tabular-nums whitespace-nowrap"><span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${l.status === "bound" ? "bg-emerald-500" : "bg-slate-300"}`} />{l.address}</td>
                            <td className="py-1 pr-2">{l.host || l.comment || "—"}<span className="block text-muted">{l.mac}</span></td>
                            <td className="py-1 text-right whitespace-nowrap">{l.dynamic ? (isAdmin && <Cmd routerId={router.id} kind="lease_make_static" id={l.id} name={l.address} title="Perangkat ini selalu mendapat alamat yang sama"><Pin size={11} /> Tetapkan</Cmd>) : <span className="text-muted">tetap</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                );
              })}
              {rd.leases.length === 0 && <p className="mt-2 text-xs text-muted">Belum ada lease.</p>}
            </Card>

            <Card className="p-4 text-sm">
              <h3 className="font-bold">Hotspot ({rd.hotspot.length} tersambung)</h3>
              {!rd.hotspot_available ? <p className="mt-2 text-xs text-muted">Hotspot belum disiapkan di router ini. Minta Satria menyusun rencananya lewat menu Asisten; perubahan router tetap menunggu persetujuan Anda.</p>
                : rd.hotspot.length === 0 ? <p className="mt-2 text-xs text-muted">Tidak ada pengguna yang sedang tersambung.</p> : (
                <table className="mt-2 w-full text-xs">
                  <tbody>
                    {rd.hotspot.map((h) => (
                      <tr key={h.id} className="border-t border-border">
                        <td className="py-1 pr-2 font-semibold">{h.user}<span className="block font-normal text-muted tabular-nums">{h.address}</span></td>
                        <td className="py-1 pr-2 text-muted whitespace-nowrap">{h.uptime}<span className="block">↓ {bytes(h.bytes_out)} · ↑ {bytes(h.bytes_in)}</span></td>
                        <td className="py-1 text-right">{isAdmin && <Cmd routerId={router.id} kind="hotspot_kick" id={h.id} name={h.user} danger ask={`Putuskan ${h.user} dari hotspot?`}><UserX size={11} /> Putuskan</Cmd>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </section>
      )}
      {router && !rd && <Card className="p-5 text-sm text-muted">Data router belum tersedia{rs?.error && stateOf(rs) !== "unknown" ? `: ${rs.error}` : ". Menunggu pekerja mengirim data pertama."}</Card>}

      {/* ---------- Riwayat perintah ---------- */}
      {commands.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 font-bold"><History size={18} /> Perintah terakhir</h2>
          <Card className="divide-y divide-border text-sm">
            {commands.map((c) => { const [label, cls] = CMD_BADGE[c.status] ?? [c.status, ""]; return (
              <div key={c.id} className="flex flex-wrap items-center gap-2 p-3">
                <span className={`rounded-md px-1.5 text-[10px] font-bold uppercase ${cls}`}>{label}</span>
                <b className="min-w-0 flex-1 basis-2/3 sm:basis-0">{c.label}</b>
                <span className="text-xs text-muted">{when(c.created_at)}</span>
                {c.result && <span className={`basis-full text-xs ${c.status === "failed" ? "text-red-600" : "text-slate-600"}`}>{c.result}</span>}
              </div>
            ); })}
          </Card>
        </section>
      )}

      {/* ---------- Tambah perangkat ---------- */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-bold"><Server size={18} /> Tambah perangkat</h2>
        <Card className="p-4">
          <form action={addDevice} className="flex flex-wrap items-end gap-3 text-xs font-semibold text-muted">
            <label className="grid gap-1">Nama<input name="name" required minLength={2} placeholder="Switch distribusi" className={`${field} w-44`} /></label>
            <label className="grid gap-1">Jenis<select name="kind" className={field} defaultValue="switch">{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="grid gap-1">Cara pantau<select name="driver" className={field} defaultValue="generic"><option value="generic">Cek hidup/mati (switch, AP, NAS)</option><option value="mikrotik">MikroTik RouterOS (REST)</option></select></label>
            <label className="grid gap-1">Alamat IP<input name="mgmt_ip" placeholder="192.168.10.2" className={`${field} w-36`} /></label>
            <label className="grid gap-1">Port<input name="mgmt_port" type="number" min={1} max={65535} defaultValue={80} className={`${field} w-20`} /></label>
            <label className="grid gap-1">Merek<input name="vendor" placeholder="Ruijie" className={`${field} w-28`} /></label>
            <label className="grid gap-1">Model<input name="model" placeholder="RG-ES209GC-P" className={`${field} w-36`} /></label>
            <button className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-sky-600"><FormPending /> Tambah</button>
          </form>
          <p className="mt-3 text-xs text-muted">Switch dan AP tanpa API dipantau hidup/matinya dan didokumentasikan port-nya di sini; pengaturannya tetap lewat halaman perangkat masing-masing (tombol Buka). Router MikroTik dipantau penuh dan bisa diatur dari tab ini.</p>
        </Card>
      </section>
    </div>
  );
}
