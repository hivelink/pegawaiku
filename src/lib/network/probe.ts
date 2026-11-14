import net from "node:net";
import type { Probe } from "./monitor";

/** Cek hidup: coba buka koneksi TCP ke port manajemen perangkat. Hanya dipakai pekerja (butuh akses LAN). */
export const tcpProbe: Probe = (host, port, timeoutMs) => new Promise((resolve) => {
  const t0 = Date.now();
  const s = net.connect({ host, port });
  const done = (ok: boolean, error?: string) => { s.destroy(); resolve({ ok, ms: Date.now() - t0, error }); };
  s.setTimeout(timeoutMs, () => done(false, "tidak menjawab (timeout)"));
  s.once("connect", () => done(true));
  // ditolak (RST) berarti perangkatnya hidup, hanya port itu yang tertutup
  s.once("error", (e: NodeJS.ErrnoException) => (e.code === "ECONNREFUSED" ? done(true) : done(false, e.code ?? e.message)));
});
