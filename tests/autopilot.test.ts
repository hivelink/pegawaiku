import { test } from "node:test";
import assert from "node:assert/strict";
import type { LlmStep, ChatMsg } from "../src/lib/llm";
import type { Mission, Run, RunEnv, ToolCall } from "../src/lib/autopilot/types";
import { executeRun, type RunnerDeps } from "../src/lib/autopilot/runner";
import { tick, housekeeping, APPROVAL_TTL_MS } from "../src/lib/autopilot/engine";
import { classifyTool, needsApproval, withConfirmation, describeAction } from "../src/lib/autopilot/risk";
import { nextRunAt, normalizeSchedule, describeSchedule, zonedToUtc } from "../src/lib/autopilot/schedule";
import { parseTelegram, approvalButtons } from "../src/lib/autopilot/notify";
import { isRouterWrite } from "../src/lib/autopilot/mikrotik-guard";
import { imageSize } from "../src/lib/creative-tools";
import { MemoryStore } from "./memory-store";

// ---------- alat bantu: LLM berskrip + lingkungan tiruan ----------
type Script = (LlmStep | ((messages: ChatMsg[]) => LlmStep))[];
const say = (text: string): LlmStep => ({ text, toolCalls: [], usage: { input: 10, output: 5 }, stopReason: "end_turn" });
const call = (text: string, ...calls: [string, Record<string, unknown>][]): LlmStep => ({ text, toolCalls: calls.map(([name, input], i) => ({ id: `c${Math.random().toString(36).slice(2, 8)}${i}`, name, input })), usage: { input: 10, output: 5 }, stopReason: "tool_use" });

function harness(script: Script, over: Partial<RunEnv> = {}) {
  const store = new MemoryStore();
  const executed: ToolCall[] = [];
  const seen: ChatMsg[][] = [];
  const reports: { text: string; status: string }[] = [];
  const notes: string[] = [];
  let i = 0;
  const env: RunEnv = {
    system: "uji", tools: [], brief: "Kerjakan misi uji.", approvalMode: "sensitive", httpCapKeys: new Set(),
    async llm(messages) {
      seen.push(structuredClone(messages));
      const s = script[i++];
      if (!s) throw new Error("skrip LLM habis");
      return typeof s === "function" ? s(messages) : s;
    },
    async runTool(c) { executed.push(structuredClone(c)); return { output: `OK ${c.name}` }; },
    async account(inTok, outTok) { return (inTok + outTok) / 1000; },
    async report(text, status) { reports.push({ text, status }); },
    async notify(text) { notes.push(text); },
    ...over,
  };
  const deps: RunnerDeps = { store, buildEnv: async (_r: Run, m: Mission) => ({ ...env, approvalMode: over.approvalMode ?? m.approval_mode }) };
  return { store, deps, executed, seen, reports, notes, calls: () => i };
}
const lastResults = (msgs: ChatMsg[]) => { const m = [...msgs].reverse().find((x) => x.role === "tool_results"); return m && m.role === "tool_results" ? m.results : []; };

// ---------- klasifikasi risiko ----------
test("risiko: baca router aman, tulis router sensitif, tool asing gagal-aman", () => {
  assert.equal(classifyTool("mikrotik_rest", { path: "/interface" }), "safe");
  assert.equal(classifyTool("mikrotik_rest", { path: "/interface", method: "get" }), "safe");
  for (const method of ["POST", "PATCH", "PUT", "DELETE", "patch"]) assert.equal(classifyTool("mikrotik_rest", { path: "/ip/hotspot/user", method }), "sensitive");
  assert.equal(classifyTool("web_search", { query: "x" }), "safe");
  assert.equal(classifyTool("save_to_drive", {}), "write");
  assert.equal(classifyTool("landing_publish", {}), "sensitive");
  assert.equal(classifyTool("delete_drive_file", {}), "sensitive");
  assert.equal(classifyTool("tool_baru_tak_dikenal", {}), "sensitive");
  assert.equal(classifyTool("http_kirim_wa", {}, new Set(["http_kirim_wa"])), "sensitive");
  assert.equal(classifyTool("merge_drive_files", { delete_sources: true }), "sensitive");
  assert.equal(classifyTool("merge_drive_files", {}), "write");
  assert.equal(needsApproval("safe", "all_writes"), false);
  assert.equal(needsApproval("write", "sensitive"), false);
  assert.equal(needsApproval("write", "all_writes"), true);
  assert.equal(needsApproval("sensitive", "sensitive"), true);
  assert.deepEqual(withConfirmation("delete_drive_file", { name: "a" }), { name: "a", confirmed: true });
  assert.deepEqual(withConfirmation("save_to_drive", { filename: "a" }), { filename: "a" });
  assert.match(describeAction("mikrotik_rest", { method: "PATCH", path: "/ip/hotspot/user/profile/*1", body: { "rate-limit": "5M/5M" } }), /Router MikroTik — Ubah: PATCH \/ip\/hotspot\/user\/profile\/\*1.*5M\/5M/);
  assert.equal(isRouterWrite({ id: "1", name: "mikrotik_rest", input: { method: "POST" } }), true);
  assert.equal(isRouterWrite({ id: "1", name: "mikrotik_rest", input: {} }), false);
});

// ---------- jadwal ----------
test("jadwal: harian & mingguan dihitung di zona waktu user", () => {
  // 07:00 WIB = 00:00 UTC
  assert.equal(new Date(zonedToUtc(2026, 11, 12, 7, 0, "Asia/Jakarta")).toISOString(), "2026-11-12T00:00:00.000Z");
  const after = new Date("2026-11-11T21:20:00Z"); // Kamis 12 Nov 04:20 WIB
  assert.equal(nextRunAt("daily", { time: "07:00" }, "Asia/Jakarta", after)!.toISOString(), "2026-11-12T00:00:00.000Z");
  assert.equal(nextRunAt("daily", { time: "04:00" }, "Asia/Jakarta", after)!.toISOString(), "2026-11-12T21:00:00.000Z"); // sudah lewat hari ini → besok
  // mingguan Senin (1) 08:00 WIB → Senin 16 Nov 01:00 UTC
  assert.equal(nextRunAt("weekly", { time: "08:00", days: [1] }, "Asia/Jakarta", after)!.toISOString(), "2026-11-16T01:00:00.000Z");
  assert.equal(nextRunAt("weekly", { time: "08:00", days: [4, 1] }, "Asia/Jakarta", after)!.toISOString(), "2026-11-12T01:00:00.000Z"); // Kamis ini
  assert.equal(nextRunAt("interval", { every_minutes: 120 }, "Asia/Jakarta", after)!.toISOString(), "2026-11-11T23:20:00.000Z");
  assert.equal(nextRunAt("interval", { every_minutes: 1 }, "Asia/Jakarta", after)!.getTime() - after.getTime(), 30 * 60_000); // dipaksa minimal 30 menit
  assert.equal(nextRunAt("once", {}, "Asia/Jakarta", after), null);
  // zona dengan DST: 07:00 New York = 12:00 UTC (musim dingin), 11:00 UTC (musim panas)
  assert.equal(nextRunAt("daily", { time: "07:00" }, "America/New_York", new Date("2026-12-01T00:00:00Z"))!.toISOString(), "2026-12-01T12:00:00.000Z");
  assert.equal(nextRunAt("daily", { time: "07:00" }, "America/New_York", new Date("2026-07-01T00:00:00Z"))!.toISOString(), "2026-07-01T11:00:00.000Z");
  assert.equal(nextRunAt("daily", { time: "07:00" }, "Zona/Ngawur", after)!.toISOString(), "2026-11-12T00:00:00.000Z"); // zona tak valid → WIB
});

test("jadwal: validasi masukan", () => {
  assert.deepEqual(normalizeSchedule("daily", { time: "7:05" }), { kind: "daily", schedule: { time: "07:05" } });
  assert.deepEqual(normalizeSchedule("weekly", { time: "08:00", days: [5, 1, 1, 9] }), { kind: "weekly", schedule: { time: "08:00", days: [1, 5] } });
  assert.equal(typeof normalizeSchedule("weekly", { time: "08:00", days: [] }), "string");
  assert.equal(typeof normalizeSchedule("interval", { every_minutes: 5 }), "string");
  assert.equal(typeof normalizeSchedule("daily", { time: "25:00" }), "string");
  assert.equal(typeof normalizeSchedule("tiap-detik", {}), "string");
  assert.equal(describeSchedule("interval", { every_minutes: 120 }), "Tiap 2 jam");
  assert.equal(describeSchedule("weekly", { time: "08:00", days: [1, 5] }), "Sen, Jum 08:00");
});

// ---------- mesin run ----------
test("run: tool aman langsung jalan sampai laporan akhir", async () => {
  const h = harness([call("Saya cari dulu.", ["web_search", { query: "harga RB4011" }], ["mikrotik_rest", { path: "/system/resource" }]), say("Laporan: selesai.")]);
  const run = (await h.store.createRun(h.store.addMission(), "manual"))!;
  assert.equal(await executeRun(h.deps, run), "done");
  assert.deepEqual(h.executed.map((c) => c.name), ["web_search", "mikrotik_rest"]);
  const r = h.store.run(run.id);
  assert.equal(r.status, "done"); assert.equal(r.summary, "Laporan: selesai."); assert.equal(r.steps, 2);
  assert.equal(r.input_tokens, 20); assert.equal(r.output_tokens, 10); assert.equal(r.credit_cost, 0.03);
  assert.equal(h.store.approvals.length, 0);
  assert.equal(h.reports.length, 1); assert.equal(h.reports[0].status, "done"); assert.match(h.reports[0].text, /Mencari: harga RB4011/);
  assert.equal(h.store.missions.get(run.mission_id)!.status, "done"); // misi sekali jalan selesai
});

test("run: perubahan router DITAHAN, lalu dijalankan persis sekali setelah disetujui", async () => {
  const body = { "rate-limit": "5M/5M" };
  const h = harness([
    call("Saya akan membatasi profil tamu menjadi 5 Mbps. Batalkan dengan mengembalikan rate-limit lama.", ["mikrotik_rest", { path: "/ip/hotspot/user/profile" }], ["mikrotik_rest", { path: "/ip/hotspot/user/profile/*1", method: "PATCH", body }]),
    say("Profil tamu sekarang 5 Mbps."),
  ], { snapshotBefore: async () => ({ sebelum: { "rate-limit": "10M/10M" } }) });
  const run = (await h.store.createRun(h.store.addMission({ schedule_kind: "daily", schedule: { time: "07:00" } }), "manual"))!;

  assert.equal(await executeRun(h.deps, run), "waiting_approval");
  assert.deepEqual(h.executed.map((c) => String(c.input.method ?? "GET")), ["GET"], "hanya pembacaan yang boleh jalan sebelum disetujui");
  const [ap] = h.store.approvals;
  assert.equal(ap.status, "pending"); assert.equal(ap.tool_key, "mikrotik_rest"); assert.equal(ap.risk, "sensitive");
  assert.deepEqual(ap.input, { path: "/ip/hotspot/user/profile/*1", method: "PATCH", body });
  assert.match(ap.reason ?? "", /membatasi profil tamu/);
  assert.deepEqual(ap.detail, { sebelum: { "rate-limit": "10M/10M" } });
  assert.equal(h.store.run(run.id).status, "waiting_approval");
  assert.equal(h.notes.length, 1);

  // dipanggil lagi sebelum ada keputusan → tetap menunggu, tidak ada yang dijalankan
  assert.equal(await executeRun(h.deps, h.store.run(run.id)), "waiting_approval");
  assert.equal(h.executed.length, 1); assert.equal(h.calls(), 1);

  h.store.decide(ap.id, "approved");
  assert.equal(await executeRun(h.deps, h.store.run(run.id)), "done");
  assert.equal(h.executed.length, 2);
  assert.deepEqual(h.executed[1].input, { path: "/ip/hotspot/user/profile/*1", method: "PATCH", body });
  const results = lastResults(h.seen[1]);
  assert.equal(results.length, 2, "model menerima hasil kedua tool call");
  assert.ok(h.store.approvals[0].executed_at);
  assert.equal(h.store.missions.get(run.mission_id)!.status, "active", "misi rutin tetap aktif");
  assert.match(h.reports[0].text, /Disetujui & dijalankan/);
});

test("run: aksi yang sudah dieksekusi tidak pernah dijalankan ulang (pekerja mati di tengah jalan)", async () => {
  const h = harness([call("Hapus aturan lama.", ["mikrotik_rest", { path: "/ip/firewall/filter/*7", method: "DELETE" }]), say("ok"), say("ok lagi")]);
  const run = (await h.store.createRun(h.store.addMission(), "manual"))!;
  await executeRun(h.deps, run);
  const waiting = h.store.run(run.id); // state saat menunggu persetujuan
  h.store.decide(h.store.approvals[0].id, "approved");
  assert.equal(await executeRun(h.deps, structuredClone(waiting)), "done");
  assert.equal(h.executed.length, 1);
  // pekerja lain mengulang dari state lama (seolah hasil pertama tidak tersimpan)
  h.store.runs.get(run.id)!.status = "running";
  assert.equal(await executeRun(h.deps, structuredClone(waiting)), "done");
  assert.equal(h.executed.length, 1, "DELETE tidak boleh terkirim dua kali");
  assert.match(lastResults(h.seen[2])[0].output, /sudah pernah dieksekusi/);
});

test("run: aksi yang ditolak tidak dijalankan dan model diberi tahu", async () => {
  const h = harness([call("Terbitkan halaman.", ["landing_publish", { filename: "promo.html", slug: "promo" }]), say("Baik, tidak saya terbitkan.")]);
  const run = (await h.store.createRun(h.store.addMission(), "manual"))!;
  await executeRun(h.deps, run);
  h.store.decide(h.store.approvals[0].id, "rejected", { note: "belum final" });
  assert.equal(await executeRun(h.deps, h.store.run(run.id)), "done");
  assert.equal(h.executed.length, 0);
  assert.match(lastResults(h.seen[1])[0].output, /DITOLAK oleh user dengan catatan: belum final/);
});

test("run: yang dieksekusi adalah input di kartu persetujuan, bukan input lain", async () => {
  const h = harness([call("Hapus file lama.", ["delete_drive_file", { name: "draft-lama.md", confirmed: false }]), say("selesai")]);
  const run = (await h.store.createRun(h.store.addMission(), "manual"))!;
  await executeRun(h.deps, run);
  // state run dirusak (mis. bug/penyusup mengubah nama file) — persetujuan tetap mengikat ke input yang dilihat user
  const tampered = h.store.run(run.id);
  tampered.state!.pending!.calls[0].input = { name: "SEMUA-FILE" };
  h.store.decide(h.store.approvals[0].id, "approved");
  await executeRun(h.deps, tampered);
  assert.deepEqual(h.executed[0].input, { name: "draft-lama.md", confirmed: true });
});

test("run: pengaman (backup router) yang gagal membatalkan perubahan", async () => {
  const h = harness([call("Ubah DNS.", ["mikrotik_rest", { path: "/ip/dns", method: "POST", body: { servers: "1.1.1.1" } }]), say("Perubahan batal karena backup gagal.")], { beforeApproved: async () => "backup otomatis router gagal (HTTP 403)" });
  const run = (await h.store.createRun(h.store.addMission(), "manual"))!;
  await executeRun(h.deps, run);
  h.store.decide(h.store.approvals[0].id, "approved");
  assert.equal(await executeRun(h.deps, h.store.run(run.id)), "done");
  assert.equal(h.executed.length, 0);
  assert.match(lastResults(h.seen[1])[0].output, /^Gagal: aksi TIDAK dijalankan — backup otomatis router gagal/);
});

test("run: mode 'all_writes' juga menahan penulisan ke Drive", async () => {
  const h = harness([call("Simpan laporan.", ["web_search", { query: "a" }], ["save_to_drive", { filename: "laporan.md", content: "isi" }]), say("selesai")]);
  const run = (await h.store.createRun(h.store.addMission({ approval_mode: "all_writes" }), "manual"))!;
  assert.equal(await executeRun(h.deps, run), "waiting_approval");
  assert.deepEqual(h.executed.map((c) => c.name), ["web_search"]);
  assert.equal(h.store.approvals[0].risk, "write");
});

test("run: ask_user menjadi pertanyaan di kotak persetujuan dan jawabannya kembali ke model", async () => {
  const h = harness([call("Butuh arah.", ["ask_user", { question: "Pakai gaya mana?", options: [{ label: "Formal", consequence: "cocok untuk investor" }, { label: "Santai" }] }]), say("Saya pakai gaya formal.")]);
  const run = (await h.store.createRun(h.store.addMission(), "manual"))!;
  assert.equal(await executeRun(h.deps, run), "waiting_approval");
  const q = h.store.approvals[0];
  assert.equal(q.kind, "question"); assert.equal(q.summary, "Pakai gaya mana?");
  assert.deepEqual(q.options, [{ label: "Formal", desc: "cocok untuk investor" }, { label: "Santai", desc: undefined }]);
  h.store.decide(q.id, "approved", { answer: "Formal" });
  assert.equal(await executeRun(h.deps, h.store.run(run.id)), "done");
  assert.equal(lastResults(h.seen[1])[0].output, "User memilih: Formal");
  assert.equal(h.executed.length, 0);
});

test("run: jatah waktu habis → kembali ke antrean dan dilanjutkan tanpa mengulang langkah", async () => {
  const h = harness([call("langkah 1", ["web_search", { query: "a" }]), call("langkah 2", ["web_search", { query: "b" }]), say("selesai")]);
  const run = (await h.store.createRun(h.store.addMission(), "manual"))!;
  let t = 1000; const deps = { ...h.deps, now: () => (t += 100) };
  assert.equal(await executeRun(deps, run, { deadline: 1250 }), "queued");
  assert.equal(h.executed.length, 1);
  const again = h.store.run(run.id); assert.equal(again.status, "queued"); assert.equal(again.steps, 1);
  assert.equal(await executeRun(h.deps, again), "done");
  assert.deepEqual(h.executed.map((c) => c.input.query), ["a", "b"]);
  assert.equal(h.store.run(run.id).steps, 3);
  assert.equal(h.store.run(run.id).input_tokens, 30);
});

test("run: pengulangan tanpa kemajuan dan batas langkah dihentikan dengan laporan", async () => {
  const same = () => call("coba lagi", ["web_search", { query: "sama" }]);
  const h = harness([same(), same(), same(), say("Rangkuman: buntu.")]);
  const run = (await h.store.createRun(h.store.addMission(), "manual"))!;
  assert.equal(await executeRun(h.deps, run), "done");
  assert.equal(h.executed.length, 2);
  assert.equal(h.store.run(run.id).summary, "Rangkuman: buntu.");
  assert.match(h.reports[0].text, /pengulangan tanpa kemajuan/);

  let n = 0;
  const h2 = harness(Array.from({ length: 5 }, () => () => (n < 3 ? call("lanjut", ["web_search", { query: `q${n++}` }]) : say("Rangkuman batas."))));
  const run2 = (await h2.store.createRun(h2.store.addMission(), "manual"))!;
  assert.equal(await executeRun({ ...h2.deps, limits: { maxSteps: 3 } }, run2), "done");
  assert.match(h2.reports[0].text, /batas langkah/);
});

test("run: error model → gagal, keputusan tertunda dibatalkan, user diberi tahu", async () => {
  const h = harness([call("ubah", ["mikrotik_rest", { path: "/ip/dns", method: "POST" }])]);
  const run = (await h.store.createRun(h.store.addMission(), "manual"))!;
  await executeRun(h.deps, run);
  h.store.decide(h.store.approvals[0].id, "approved");
  assert.equal(await executeRun(h.deps, h.store.run(run.id)), "failed"); // skrip LLM habis = error
  const r = h.store.run(run.id);
  assert.equal(r.status, "failed"); assert.match(r.error ?? "", /skrip LLM habis/);
  assert.equal(h.reports.at(-1)!.status, "failed");

  const h3 = harness([]);
  const run3 = (await h3.store.createRun(h3.store.addMission(), "manual"))!;
  assert.equal(await executeRun({ ...h3.deps, buildEnv: async () => { throw new Error("Belum ada kunci API"); } }, run3), "failed");
  assert.match(h3.store.run(run3.id).error ?? "", /Belum ada kunci API/);
});

test("run: tool yang melempar error atau macet tidak menjatuhkan run", async () => {
  const h = harness([call("coba", ["web_fetch", { url: "https://x" }], ["web_search", { query: "y" }]), say("Sebagian gagal.")], {
    runTool: async (c) => { if (c.name === "web_fetch") throw new Error("ECONNRESET"); return new Promise(() => {}); },
  });
  const run = (await h.store.createRun(h.store.addMission(), "manual"))!;
  assert.equal(await executeRun({ ...h.deps, limits: { toolTimeoutMs: 30 } }, run), "done");
  const res = lastResults(h.seen[1]);
  assert.match(res[0].output, /^Gagal menjalankan web_fetch: ECONNRESET/);
  assert.match(res[1].output, /tidak merespons dalam batas waktu/);
});

// ---------- penjadwal ----------
test("tick: misi jatuh tempo dijadwalkan sekali, tidak menumpuk, dan run dibangunkan setelah keputusan", async () => {
  const h = harness([call("ubah", ["mikrotik_rest", { path: "/ip/dns", method: "POST" }]), say("beres"), say("run kedua")]);
  const t0 = Date.parse("2026-11-12T00:00:30Z");
  let now = t0;
  const deps = { ...h.deps, now: () => now };
  const m = h.store.addMission({ schedule_kind: "daily", schedule: { time: "07:00" }, next_run_at: "2026-11-12T00:00:00.000Z" });
  h.store.addMission({ title: "dijeda", status: "paused", next_run_at: "2026-11-12T00:00:00.000Z" });
  h.store.addMission({ title: "belum waktunya", next_run_at: "2026-12-01T00:00:00.000Z" });

  let r = await tick(deps);
  assert.deepEqual([r.scheduled, r.processed, r.statuses], [1, 1, ["waiting_approval"]]);
  assert.equal(h.store.missions.get(m.id)!.next_run_at, "2026-11-13T00:00:00.000Z");
  assert.equal(h.store.runs.size, 1);

  now = Date.parse("2026-11-13T00:00:30Z"); // besoknya: run kemarin masih menunggu → tidak membuat run baru
  r = await tick(deps);
  assert.deepEqual([r.scheduled, r.resumed, r.processed], [0, 0, 0]);
  assert.equal(h.store.runs.size, 1);
  assert.equal(h.store.missions.get(m.id)!.next_run_at, "2026-11-14T00:00:00.000Z");

  h.store.decide(h.store.approvals[0].id, "approved");
  r = await tick(deps);
  assert.deepEqual([r.resumed, r.processed, r.statuses], [1, 1, ["done"]]);
  assert.equal(h.executed.length, 1);

  now = Date.parse("2026-11-14T00:00:30Z");
  r = await tick(deps);
  assert.deepEqual([r.scheduled, r.statuses], [1, ["done"]]);
  assert.equal(h.store.runs.size, 2);
  assert.ok(h.store.beats >= 4);
});

test("tick: persetujuan kedaluwarsa tidak mengeksekusi apa pun; run macet diambil alih", async () => {
  const h = harness([call("ubah", ["mikrotik_rest", { path: "/ip/dns", method: "POST" }]), say("Aksi tidak dijalankan karena kedaluwarsa.")]);
  const run = (await h.store.createRun(h.store.addMission(), "manual"))!;
  await tick(h.deps);
  assert.equal(h.store.run(run.id).status, "waiting_approval");
  const later = Date.now() + APPROVAL_TTL_MS + 60_000;
  const r = await tick({ ...h.deps, now: () => later });
  assert.deepEqual(r.statuses, ["done"]);
  assert.equal(h.store.approvals[0].status, "expired");
  assert.equal(h.executed.length, 0);
  assert.match(lastResults(h.seen[1])[0].output, /kedaluwarsa/);

  const h2 = harness([say("dilanjutkan pekerja baru")]);
  const run2 = (await h2.store.createRun(h2.store.addMission(), "manual"))!;
  Object.assign(h2.store.runs.get(run2.id)!, { status: "running", heartbeat_at: new Date(Date.now() - 3600_000).toISOString() });
  assert.equal((await housekeeping(h2.store)).resumed, 0);
  assert.equal(h2.store.run(run2.id).status, "queued");
  assert.deepEqual((await tick(h2.deps)).statuses, ["done"]);
});

// ---------- lain-lain ----------
test("telegram: format kunci dan tombol keputusan", () => {
  assert.deepEqual(parseTelegram("123456:ABC-def_ghi|-100987"), { token: "123456:ABC-def_ghi", chatId: "-100987" });
  assert.equal(parseTelegram("tanpa-pemisah"), null);
  assert.equal(parseTelegram("123:abc|bukan-angka"), null);
  const id = "0b9d3c1e-1111-2222-3333-444455556666";
  const b = approvalButtons({ id, kind: "action", options: null });
  assert.deepEqual(b[0].map((x) => x.callback_data), [`ap:${id}:y`, `ap:${id}:n`]);
  assert.ok(b[0].every((x) => Buffer.byteLength(x.callback_data) <= 64));
  assert.deepEqual(approvalButtons({ id, kind: "question", options: [{ label: "A" }, { label: "B" }] }).map((r) => r[0].callback_data), [`aq:${id}:0`, `aq:${id}:1`]);
});

test("gambar: ukuran terbaca dari header PNG/GIF/JPEG", () => {
  const png = Buffer.alloc(30); png.write("\x89PNG\r\n\x1a\n", 0, "latin1"); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20);
  assert.deepEqual(imageSize(png), { w: 640, h: 480 });
  const gif = Buffer.alloc(12); gif.write("GIF89a", 0, "ascii"); gif.writeUInt16LE(320, 6); gif.writeUInt16LE(200, 8);
  assert.deepEqual(imageSize(gif), { w: 320, h: 200 });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, 0x00, 0x00]);
  assert.deepEqual(imageSize(jpg), { w: 400, h: 300 });
  assert.equal(imageSize(Buffer.from("bukan gambar sama sekali........")), null);
});
