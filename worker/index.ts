/**
 * Pekerja Asisten Otonom — jalankan di NAS/server yang berada di jaringan rumah:
 *   npm run worker            (butuh .env.local / env: lihat worker/.env.example)
 *   docker compose -f worker/docker-compose.yml up -d --build
 *
 * Pekerja hanya membuat koneksi KELUAR (ke Supabase, penyedia model, Telegram) dan ke perangkat LAN (router).
 * Tidak ada port yang dibuka ke internet.
 */
import os from "node:os";
import { createClient } from "@supabase/supabase-js";
import { SupabaseStore } from "../src/lib/autopilot/supabase-store";
import { buildEnv } from "../src/lib/autopilot/context";
import { tick } from "../src/lib/autopilot/engine";
import { runTelegramBot } from "../src/lib/autopilot/telegram-bot";
import { runNetworkLoop } from "../src/lib/network/monitor";
import { tcpProbe } from "../src/lib/network/probe";

const VERSION = "1.0.0";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const orgId = process.env.AUTOPILOT_ORG_ID || null;
const name = process.env.AUTOPILOT_WORKER_NAME || `nas-${os.hostname()}`;
const pollMs = Math.max(3, Number(process.env.AUTOPILOT_POLL_SECONDS) || 10) * 1000;

const log = (m: string) => console.log(`${new Date().toISOString()} [asisten] ${m}`);

if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY (lihat worker/.env.example).");
  process.exit(1);
}
if (!orgId) log("PERINGATAN: AUTOPILOT_ORG_ID kosong — pekerja ini melayani SEMUA organisasi di database. Isi dengan ID organisasi Anda bila database dipakai bersama.");

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const store = new SupabaseStore(sb, { workerName: name, orgId, info: { version: VERSION, host: os.hostname(), platform: `${os.platform()}/${os.arch()}`, node: process.version } });
const deps = { store, buildEnv: (run: Parameters<typeof buildEnv>[1], mission: Parameters<typeof buildEnv>[2]) => buildEnv(sb, run, mission) };

const stop = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { log(`${sig} diterima — menyelesaikan langkah berjalan lalu berhenti…`); stop.abort(); });
const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); stop.signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });

async function main() {
  log(`pekerja "${name}" v${VERSION} mulai · organisasi: ${orgId ?? "semua"} · cek tiap ${pollMs / 1000} dtk`);
  void runTelegramBot(sb, { orgId, signal: stop.signal, log });
  // pemantau jaringan: status perangkat tiap menit + perintah router dari tab Jaringan
  void runNetworkLoop({ sb, probe: tcpProbe, orgId, log }, { signal: stop.signal, everyMs: (Number(process.env.NETWORK_MONITOR_SECONDS) || 60) * 1000 });
  let failures = 0;
  while (!stop.signal.aborted) {
    try {
      const r = await tick(deps, { signal: stop.signal });
      if (r.scheduled || r.resumed || r.processed) log(`dijadwalkan ${r.scheduled} · dilanjutkan ${r.resumed} · dikerjakan ${r.processed}${r.statuses.length ? ` (${r.statuses.join(", ")})` : ""}`);
      failures = 0;
    } catch (e) {
      failures++;
      const msg = (e as Error).message ?? String(e);
      log(`gagal: ${msg}${/auto_(workers|runs|missions)/.test(msg) ? " — sudahkah migrasi 0015_autopilot.sql dijalankan?" : ""}`);
    }
    await sleep(Math.min(pollMs * (1 + failures), 120_000)); // mundur perlahan bila database/jaringan bermasalah
  }
  log("berhenti.");
}

main().catch((e) => { console.error(e); process.exit(1); });
