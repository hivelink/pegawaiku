import type { SupabaseClient } from "@supabase/supabase-js";
import { COMMAND_KINDS, type NetCommand, type NetDevice, type RouterData, type RouterIface } from "./types";

/**
 * Pemantau jaringan — dijalankan pekerja di jaringan rumah (bukan di server web, yang tidak bisa menjangkau LAN).
 * - Router MikroTik: REST RouterOS v7 (hanya GET) → resource, interface + laju, lease DHCP, hotspot aktif.
 * - Perangkat lain (switch, AP, NAS, NVR): tidak punya API → cek hidup lewat koneksi TCP ke port manajemennya,
 *   ditambah tanda "terlihat router" dari tabel ARP.
 * - Perintah dari web (tabel net_commands): daftar tertutup, tiap jenis dipetakan ke satu panggilan REST.
 */

export type Probe = (host: string, port: number, timeoutMs: number) => Promise<{ ok: boolean; ms: number; error?: string }>;
export type RouterCfg = { base: string; user: string; pass: string };
export type MonitorDeps = { sb: SupabaseClient; probe: Probe; orgId?: string | null; log?: (m: string) => void; now?: () => number };

export function parseRouterKey(cfg: string | undefined): RouterCfg | null {
  if (!cfg) return null;
  const [base, user, ...rest] = cfg.split("|");
  return base && user && /^https?:\/\//i.test(base) ? { base: base.replace(/\/$/, ""), user, pass: rest.join("|") } : null;
}

export async function routerRest<T = unknown>(cfg: RouterCfg, path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${cfg.base}/rest${path}`, {
      method: init.method ?? "GET",
      headers: { authorization: "Basic " + Buffer.from(`${cfg.user}:${cfg.pass}`).toString("base64"), "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    });
  } catch (e) { throw new Error(`router tidak bisa dijangkau (${(e as Error).message})`); }
  const text = await r.text();
  if (!r.ok) throw new Error(`RouterOS HTTP ${r.status}: ${text.slice(0, 200)}`);
  try { return (text ? JSON.parse(text) : null) as T; } catch { return text as unknown as T; }
}

type Raw = Record<string, string | undefined>;
const yes = (v: string | undefined) => v === "true" || v === "yes";
const num = (v: string | undefined) => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) ? n : null; };

/** penghitung byte sebelumnya per interface → laju (bit/detik) */
const counters = new Map<string, { rx: number; tx: number; t: number }>();
export function resetCounters() { counters.clear(); }

export async function readRouter(cfg: RouterCfg, deviceId: string, now: number): Promise<{ data: RouterData; arp: Set<string> }> {
  const [res, ident, ifaces, leases, arp] = await Promise.all([
    routerRest<Raw>(cfg, "/system/resource"),
    routerRest<Raw>(cfg, "/system/identity").catch(() => ({}) as Raw),
    routerRest<Raw[]>(cfg, "/interface"),
    routerRest<Raw[]>(cfg, "/ip/dhcp-server/lease").catch(() => [] as Raw[]),
    routerRest<Raw[]>(cfg, "/ip/arp").catch(() => [] as Raw[]),
  ]);
  let hotspotRaw: Raw[] = [], hotspotAvailable = true;
  try { hotspotRaw = await routerRest<Raw[]>(cfg, "/ip/hotspot/active"); } catch { hotspotAvailable = false; } // paket/menu hotspot belum dipakai

  const interfaces: RouterIface[] = (Array.isArray(ifaces) ? ifaces : []).map((i) => {
    const id = i[".id"] ?? i.name ?? "";
    const rx = num(i["rx-byte"]), tx = num(i["tx-byte"]);
    const key = `${deviceId}:${id}`, prev = counters.get(key);
    let rx_bps: number | null = null, tx_bps: number | null = null;
    if (rx != null && tx != null) {
      if (prev && now > prev.t && rx >= prev.rx && tx >= prev.tx) { const dt = (now - prev.t) / 1000; rx_bps = Math.round(((rx - prev.rx) * 8) / dt); tx_bps = Math.round(((tx - prev.tx) * 8) / dt); }
      counters.set(key, { rx, tx, t: now });
    }
    return { id, name: i.name ?? "", type: i.type ?? "", running: yes(i.running), disabled: yes(i.disabled), comment: i.comment ?? "", mac: i["mac-address"] ?? "", rx_bps, tx_bps };
  });
  const data: RouterData = {
    identity: ident?.name ?? "", version: res?.version ?? "", board: res?.["board-name"] ?? "", uptime: res?.uptime ?? "",
    cpu: num(res?.["cpu-load"]), mem_free: num(res?.["free-memory"]), mem_total: num(res?.["total-memory"]),
    interfaces,
    leases: (Array.isArray(leases) ? leases : []).slice(0, 400).map((l) => ({ id: l[".id"] ?? "", address: l.address ?? "", mac: l["mac-address"] ?? "", host: l["host-name"] ?? "", server: l.server ?? "", status: l.status ?? "", dynamic: yes(l.dynamic), comment: l.comment ?? "" })),
    hotspot: hotspotRaw.slice(0, 300).map((h) => ({ id: h[".id"] ?? "", user: h.user ?? "", address: h.address ?? "", uptime: h.uptime ?? "", bytes_in: num(h["bytes-in"]) ?? 0, bytes_out: num(h["bytes-out"]) ?? 0 })),
    hotspot_available: hotspotAvailable,
  };
  const seen = new Set((Array.isArray(arp) ? arp : []).filter((a) => a.address && a["mac-address"] && a.complete !== "false").map((a) => a.address as string));
  return { data, arp: seen };
}

async function orgKeys(sb: SupabaseClient, orgId: string): Promise<RouterCfg | null> {
  const { data } = await sb.from("org_api_keys").select("secret").eq("org_id", orgId).eq("provider", "mikrotik").maybeSingle();
  return parseRouterKey(data?.secret as string | undefined);
}

async function saveStatus(d: MonitorDeps, dev: NetDevice, s: { online: boolean; latency_ms: number | null; seen_by_router: boolean | null; error: string | null; data: RouterData | null }) {
  const nowIso = new Date((d.now ?? Date.now)()).toISOString();
  const { data: prev } = await d.sb.from("net_status").select("online,changed_at").eq("device_id", dev.id).maybeSingle();
  const changed_at = prev && prev.online === s.online ? (prev.changed_at as string) : nowIso;
  const { error } = await d.sb.from("net_status").upsert({ device_id: dev.id, org_id: dev.org_id, ...s, error: s.error ? s.error.slice(0, 300) : null, checked_at: nowIso, changed_at }, { onConflict: "device_id" });
  if (error) throw new Error(`net_status: ${error.message}`);
}

/** Satu putaran pemantauan semua perangkat. Mengembalikan jumlah perangkat yang diperiksa. */
export async function monitorOnce(d: MonitorDeps): Promise<number> {
  const now = (d.now ?? Date.now)();
  let q = d.sb.from("net_devices").select("*").eq("monitor", true);
  if (d.orgId) q = q.eq("org_id", d.orgId);
  const { data: rows, error } = await q;
  if (error) throw new Error(`net_devices: ${error.message}`);
  const devices = (rows ?? []) as NetDevice[];
  const byOrg = new Map<string, NetDevice[]>();
  for (const dev of devices) byOrg.set(dev.org_id, [...(byOrg.get(dev.org_id) ?? []), dev]);

  for (const [orgId, list] of byOrg) {
    // router dulu: tabel ARP-nya dipakai sebagai tanda "terlihat" untuk perangkat lain
    let arp: Set<string> | null = null;
    for (const dev of list.filter((x) => x.driver === "mikrotik")) {
      const cfg = await orgKeys(d.sb, orgId);
      if (!cfg) { await saveStatus(d, dev, { online: false, latency_ms: null, seen_by_router: null, data: null, error: "Kunci mikrotik belum diisi (Pengaturan → Kunci API)." }); continue; }
      const t0 = Date.now();
      try {
        const r = await readRouter(cfg, dev.id, now);
        arp = r.arp;
        await saveStatus(d, dev, { online: true, latency_ms: Date.now() - t0, seen_by_router: null, data: r.data, error: null });
      } catch (e) {
        await saveStatus(d, dev, { online: false, latency_ms: null, seen_by_router: null, data: null, error: (e as Error).message });
      }
    }
    await Promise.all(list.filter((x) => x.driver !== "mikrotik").map(async (dev) => {
      if (!dev.mgmt_ip) { await saveStatus(d, dev, { online: false, latency_ms: null, seen_by_router: null, data: null, error: "Alamat IP belum diisi." }); return; }
      const p = await d.probe(dev.mgmt_ip, dev.mgmt_port || 80, 3000);
      const seen = arp ? arp.has(dev.mgmt_ip) : null;
      // hidup bila port manajemen menjawab, atau router masih melihat alamatnya (port web bisa saja dimatikan)
      await saveStatus(d, dev, { online: p.ok || seen === true, latency_ms: p.ok ? p.ms : null, seen_by_router: seen, data: null, error: p.ok ? null : seen ? `Port ${dev.mgmt_port} tidak menjawab, tetapi router masih melihat perangkat ini.` : p.error ?? "tidak menjawab" });
    }));
  }
  return devices.length;
}

// ---------------- Perintah dari web ----------------

const ID_RE = /^\*[0-9A-Fa-f]+$/;

/** Jalankan satu perintah. Melempar error dengan pesan yang layak ditampilkan. */
export async function executeCommand(cfg: RouterCfg, kind: string, payload: Record<string, unknown>): Promise<string> {
  if (!(COMMAND_KINDS as readonly string[]).includes(kind)) throw new Error(`Jenis perintah "${kind}" tidak dikenal.`);
  const backup = async () => {
    const name = `pegawaiku-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`;
    await routerRest(cfg, "/system/backup/save", { method: "POST", body: { name }, timeoutMs: 30_000 });
    return name;
  };
  if (kind === "backup") return `Backup tersimpan di router: ${await backup()}.backup`;
  const id = String(payload.id ?? "");
  if (!ID_RE.test(id)) throw new Error("ID objek router tidak valid.");
  switch (kind) {
    case "interface_disable":
    case "interface_enable": {
      const name = await backup(); // perubahan interface bisa memutus jaringan → selalu ada titik kembali
      await routerRest(cfg, `/interface/${id}`, { method: "PATCH", body: { disabled: kind === "interface_disable" ? "yes" : "no" } });
      return `Interface ${kind === "interface_disable" ? "dimatikan" : "dihidupkan"}. Backup sebelum perubahan: ${name}.backup`;
    }
    case "lease_make_static":
      await routerRest(cfg, "/ip/dhcp-server/lease/make-static", { method: "POST", body: { ".id": id } });
      return "Alamat dijadikan tetap (static lease).";
    case "hotspot_kick":
      await routerRest(cfg, `/ip/hotspot/active/${id}`, { method: "DELETE" });
      return "Pengguna hotspot diputus.";
  }
  throw new Error("Perintah tidak ditangani.");
}

/** Ambil dan jalankan perintah yang antre. Mengembalikan jumlah yang dijalankan. */
export async function processCommands(d: MonitorDeps): Promise<number> {
  let q = d.sb.from("net_commands").select("*").eq("status", "queued").order("created_at").limit(5);
  if (d.orgId) q = q.eq("org_id", d.orgId);
  const { data: rows, error } = await q;
  if (error) throw new Error(`net_commands: ${error.message}`);
  let ran = 0;
  for (const c of (rows ?? []) as NetCommand[]) {
    // klaim atomik: hanya satu pekerja yang mengubah queued → running
    const { data: got } = await d.sb.from("net_commands").update({ status: "running" }).eq("id", c.id).eq("status", "queued").select("id");
    if (!got?.length) continue;
    let status: "done" | "failed" = "done", result: string;
    try {
      if (Date.now() - new Date(c.created_at).getTime() > 10 * 60_000) throw new Error("Perintah kedaluwarsa (lebih dari 10 menit menunggu pekerja) — tidak dijalankan.");
      const cfg = await orgKeys(d.sb, c.org_id);
      if (!cfg) throw new Error("Kunci mikrotik belum diisi.");
      result = await executeCommand(cfg, c.kind, c.payload ?? {});
    } catch (e) { status = "failed"; result = (e as Error).message; }
    await d.sb.from("net_commands").update({ status, result: result.slice(0, 500), finished_at: new Date().toISOString() }).eq("id", c.id);
    d.log?.(`perintah jaringan ${c.kind}: ${status} — ${result.slice(0, 120)}`);
    ran++;
  }
  return ran;
}

/** Putaran tanpa henti untuk pekerja: perintah tiap beberapa detik, pemantauan tiap `everyMs`. */
export async function runNetworkLoop(d: MonitorDeps, opts: { signal: AbortSignal; everyMs?: number; commandMs?: number }): Promise<void> {
  const every = Math.max(20_000, opts.everyMs ?? 60_000), cmdMs = Math.max(2000, opts.commandMs ?? 5000);
  const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); opts.signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });
  let last = 0, warned = false;
  while (!opts.signal.aborted) {
    try {
      const ran = await processCommands(d);
      if (ran || Date.now() - last >= every) { await monitorOnce(d); last = Date.now(); } // setelah perintah, status langsung disegarkan
      warned = false;
    } catch (e) {
      const msg = (e as Error).message;
      if (!warned) d.log?.(`pemantau jaringan: ${msg}${/net_(devices|commands|status)/.test(msg) ? " — sudahkah migrasi 0016_network.sql dijalankan?" : ""}`);
      warned = true; last = Date.now();
    }
    await sleep(cmdMs);
  }
}
