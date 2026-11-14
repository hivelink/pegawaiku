import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { monitorOnce, processCommands, executeCommand, parseRouterKey, resetCounters, type Probe } from "../src/lib/network/monitor";
import { classifyTool } from "../src/lib/autopilot/risk";
import { runTool, type ToolCtx } from "../src/lib/agent-tools";
import { fakeSupabase, type Row } from "./fake-supabase";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; resetCounters(); });

type Call = { path: string; method: string; body?: string };
function router(over: Record<string, unknown> = {}, fail: Record<string, number> = {}) {
  const calls: Call[] = [];
  let rx = 1_000_000;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace("https://192.168.10.1/rest", ""); const method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body as string | undefined });
    if (path === "/interface") rx += 1_500_000; // penghitung byte naik sekali per putaran pemantauan
    if (fail[path]) return new Response('{"message":"no such command"}', { status: fail[path] });
    const data: Record<string, unknown> = {
      "/system/resource": { version: "7.16.1 (stable)", "board-name": "RB4011iGS+", uptime: "3d4h", "cpu-load": "7", "free-memory": "750000000", "total-memory": "1000000000" },
      "/system/identity": { name: "Rumah" },
      "/interface": [
        { ".id": "*1", name: "ether1", type: "ether", running: "true", disabled: "false", "rx-byte": String(rx), "tx-byte": "500", "mac-address": "AA:BB" },
        { ".id": "*3", name: "ether3", type: "ether", running: "false", disabled: "false", "rx-byte": "0", "tx-byte": "0" },
      ],
      "/ip/dhcp-server/lease": [{ ".id": "*A", address: "192.168.10.50", "mac-address": "11:22", "host-name": "laptop", server: "dhcp-rumah", status: "bound", dynamic: "true" }, { ".id": "*B", address: "192.168.30.9", server: "dhcp-cctv", status: "waiting", dynamic: "false" }],
      "/ip/arp": [{ address: "192.168.10.2", "mac-address": "CC:DD", complete: "true" }, { address: "192.168.10.9", complete: "false" }],
      "/ip/hotspot/active": [{ ".id": "*7", user: "tamu1", address: "192.168.20.5", uptime: "10m", "bytes-in": "1000", "bytes-out": "9000" }],
      ...over,
    };
    return new Response(JSON.stringify(path in data ? data[path] : []), { status: 200 });
  }) as typeof fetch;
  return calls;
}
const dev = (o: Row) => ({ org_id: "org-1", kind: "switch", driver: "generic", mgmt_port: 80, monitor: true, sort: 10, vendor: null, model: null, notes: null, ...o });
const db = (extra: Record<string, Row[]> = {}) => fakeSupabase({
  org_api_keys: [{ org_id: "org-1", provider: "mikrotik", secret: "https://192.168.10.1|asisten|ra|ha|sia" }],
  net_devices: [dev({ id: "r1", name: "RB4011", kind: "router", driver: "mikrotik", mgmt_ip: "192.168.10.1" }), dev({ id: "s1", name: "Ruijie", mgmt_ip: "192.168.10.2" }), dev({ id: "s2", name: "HSAirPo", mgmt_ip: "192.168.10.5" }), dev({ id: "a1", name: "AP", kind: "ap", mgmt_ip: null })],
  ...extra,
});
const statusOf = (f: ReturnType<typeof fakeSupabase>, id: string) => [...f.writes].reverse().find((w) => w.table === "net_status" && (w.payload as Row).device_id === id)!.payload as Row;

test("jaringan: kunci router dengan kata sandi berisi '|' terbaca utuh", () => {
  assert.deepEqual(parseRouterKey("https://192.168.10.1/|asisten|ra|ha|sia"), { base: "https://192.168.10.1", user: "asisten", pass: "ra|ha|sia" });
  assert.equal(parseRouterKey("192.168.10.1|a|b"), null);
  assert.equal(parseRouterKey(undefined), null);
});

test("jaringan: pemantauan hanya membaca router, menghitung laju, dan menilai switch/AP", async () => {
  const calls = router();
  const f = db();
  const probe: Probe = async (host) => (host === "192.168.10.2" ? { ok: true, ms: 4 } : { ok: false, ms: 3000, error: "tidak menjawab (timeout)" });
  let now = 1_000_000;
  assert.equal(await monitorOnce({ sb: f.sb, probe, now: () => now }), 4);
  assert.ok(calls.every((c) => c.method === "GET"), "pemantauan tidak boleh mengubah router");

  const r = statusOf(f, "r1"); const data = r.data as { identity: string; cpu: number; interfaces: Row[]; leases: Row[]; hotspot: Row[]; hotspot_available: boolean };
  assert.equal(r.online, true); assert.equal(data.identity, "Rumah"); assert.equal(data.cpu, 7);
  assert.deepEqual(data.interfaces.map((i) => [i.name, i.running, i.rx_bps]), [["ether1", true, null], ["ether3", false, null]]);
  assert.equal(data.leases.length, 2); assert.equal(data.leases[0].dynamic, true); assert.equal(data.hotspot[0].user, "tamu1");

  assert.deepEqual([statusOf(f, "s1").online, statusOf(f, "s1").latency_ms, statusOf(f, "s1").seen_by_router], [true, 4, true]);
  assert.deepEqual([statusOf(f, "s2").online, statusOf(f, "s2").seen_by_router], [false, false]);
  assert.match(String(statusOf(f, "a1").error), /Alamat IP belum diisi/);

  // putaran kedua, 60 detik kemudian: 1.500.000 byte → 200 kbps
  now += 60_000;
  await monitorOnce({ sb: f.sb, probe, now: () => now });
  assert.equal(((statusOf(f, "r1").data as { interfaces: Row[] }).interfaces[0]).rx_bps, 200_000);
});

test("jaringan: router mati atau hotspot belum ada tidak menjatuhkan pemantauan", async () => {
  router({}, { "/ip/hotspot/active": 400 });
  let f = db();
  const probe: Probe = async () => ({ ok: false, ms: 1, error: "EHOSTUNREACH" });
  await monitorOnce({ sb: f.sb, probe });
  const d = statusOf(f, "r1").data as { hotspot_available: boolean; hotspot: Row[] };
  assert.equal(d.hotspot_available, false); assert.deepEqual(d.hotspot, []);
  // switch yang port web-nya mati tetapi masih ada di ARP router dianggap hidup, dengan catatan
  assert.equal(statusOf(f, "s1").online, true); assert.match(String(statusOf(f, "s1").error), /router masih melihat/);

  globalThis.fetch = (async () => { throw new Error("connect ETIMEDOUT"); }) as typeof fetch;
  f = db();
  await monitorOnce({ sb: f.sb, probe });
  assert.equal(statusOf(f, "r1").online, false); assert.match(String(statusOf(f, "r1").error), /router tidak bisa dijangkau/);
  assert.equal(statusOf(f, "s1").seen_by_router, null);

  f = db(); f.fixtures.org_api_keys = [];
  await monitorOnce({ sb: f.sb, probe });
  assert.match(String(statusOf(f, "r1").error), /Kunci mikrotik belum diisi/);
});

test("jaringan: perintah dari web — daftar tertutup, ID tervalidasi, backup sebelum mematikan interface", async () => {
  const cfg = parseRouterKey("https://192.168.10.1|a|b")!;
  let calls = router();
  assert.match(await executeCommand(cfg, "interface_disable", { id: "*3" }), /dimatikan\. Backup sebelum perubahan: pegawaiku-/);
  assert.deepEqual(calls.map((c) => [c.method, c.path]), [["POST", "/system/backup/save"], ["PATCH", "/interface/*3"]]);
  assert.equal(calls[1].body, '{"disabled":"yes"}');

  calls = router({}, { "/system/backup/save": 403 });
  await assert.rejects(executeCommand(cfg, "interface_disable", { id: "*3" }), /RouterOS HTTP 403/);
  assert.equal(calls.length, 1, "backup gagal → interface tidak disentuh");

  calls = router();
  await executeCommand(cfg, "hotspot_kick", { id: "*7" });
  await executeCommand(cfg, "lease_make_static", { id: "*A" });
  assert.deepEqual(calls.map((c) => [c.method, c.path, c.body]), [["DELETE", "/ip/hotspot/active/*7", undefined], ["POST", "/ip/dhcp-server/lease/make-static", '{".id":"*A"}']]);

  calls = router();
  for (const bad of ["*3/../../system/reset-configuration", "ether1", "", "*3?x=1"]) await assert.rejects(executeCommand(cfg, "interface_disable", { id: bad }), /ID objek router tidak valid/);
  for (const kind of ["reboot", "reset", "system/reset-configuration", "run_script"]) await assert.rejects(executeCommand(cfg, kind, { id: "*1" }), /tidak dikenal/);
  assert.equal(calls.length, 0, "perintah yang ditolak tidak mengirim apa pun ke router");
});

test("jaringan: antrean perintah diklaim, hasilnya dicatat, perintah basi tidak dijalankan", async () => {
  const calls = router();
  const fresh = new Date().toISOString(), old = new Date(Date.now() - 30 * 60_000).toISOString();
  const f = db({ net_commands: [
    { id: "c1", org_id: "org-1", device_id: "r1", kind: "backup", payload: {}, label: "Backup", status: "queued", created_at: fresh },
    { id: "c2", org_id: "org-1", device_id: "r1", kind: "interface_disable", payload: { id: "*1" }, label: "Matikan ether1", status: "queued", created_at: old },
    { id: "c3", org_id: "org-1", device_id: "r1", kind: "hotspot_kick", payload: { id: "*7" }, label: "x", status: "done", created_at: fresh },
  ] });
  assert.equal(await processCommands({ sb: f.sb, probe: async () => ({ ok: true, ms: 1 }) }), 2);
  const fin = f.writes.filter((w) => w.table === "net_commands" && (w.payload as Row).finished_at).map((w) => [w.filters[0][2], (w.payload as Row).status, String((w.payload as Row).result).slice(0, 30)]);
  assert.deepEqual(fin.map((x) => [x[0], x[1]]), [["c1", "done"], ["c2", "failed"]]);
  assert.match(String(fin[1][2]), /kedaluwarsa/);
  assert.deepEqual(calls.map((c) => c.path), ["/system/backup/save"], "perintah basi tidak boleh menyentuh router");
  assert.ok(f.writes.some((w) => w.table === "net_commands" && (w.payload as Row).status === "running" && w.filters.some(([k, c, v]) => k === "eq" && c === "status" && v === "queued")), "klaim hanya untuk yang masih antre");
});

test("jaringan: agent bisa membaca ringkasan jaringan (tool hanya-baca)", async () => {
  assert.equal(classifyTool("network_overview", {}), "safe");
  const f = db({
    net_ports: [{ device_id: "s1", name: "9", purpose: "Uplink ke MikroTik ether5", config: "Trunk · Native10", sort: 10 }],
    net_status: [{ device_id: "s1", online: true, latency_ms: 4, error: null, data: null, checked_at: "2026-11-14T01:00:00Z" }, { device_id: "r1", online: true, error: null, checked_at: "2026-11-14T01:00:00Z", data: { version: "7.16", cpu: 7, uptime: "3d", interfaces: [{ name: "ether1", running: true, disabled: false }, { name: "ether3", running: false, disabled: true }], leases: [{ server: "dhcp-rumah", status: "bound" }], hotspot: [] } }],
  });
  const ctx = { supabase: f.sb, orgId: "org-1", projectId: "p", agentId: "a", userId: "u", conversationId: "c", keys: {} } as ToolCtx;
  const out = await runTool("network_overview", {}, ctx);
  assert.match(out, /## Ruijie — switch[\s\S]*Status: HIDUP[\s\S]*- 9: Uplink ke MikroTik ether5 \(Trunk · Native10\)/);
  assert.match(out, /Interface hidup: ether1[\s\S]*ether3 \(dinonaktifkan\)[\s\S]*Klien DHCP aktif: 1 \(dhcp-rumah: 1\)/);
  assert.match(out, /## AP — ap[\s\S]*belum pernah dipantau/);
  assert.equal(f.writes.length, 0);
});
