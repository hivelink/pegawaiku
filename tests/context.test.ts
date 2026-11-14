import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildEnv, ARKA_SLUG } from "../src/lib/autopilot/context";
import { routerBackup, routerSnapshot } from "../src/lib/autopilot/mikrotik-guard";
import { TOOL_DEFS } from "../src/lib/agent-tools";
import { MISSION_TEMPLATES } from "../src/lib/autopilot/templates";
import { normalizeSchedule } from "../src/lib/autopilot/schedule";
import { parseCallback, handleUpdate } from "../src/lib/autopilot/telegram-bot";
import type { Mission, Run } from "../src/lib/autopilot/types";
import { fakeSupabase, type Row } from "./fake-supabase";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.AUTOPILOT_ROUTER_BACKUP; delete process.env.ANTHROPIC_API_KEY; });

const mission = (o: Partial<Mission> = {}): Mission => ({ id: "mis-1", org_id: "org-1", project_id: "proj-1", agent_id: null, kind: "task", title: "Cek jaringan", instructions: "Periksa router.", schedule_kind: "daily", schedule: { time: "07:00" }, tz: "Asia/Jakarta", approval_mode: "sensitive", status: "active", source: "user", reason: null, conversation_id: null, next_run_at: null, last_run_at: null, created_by: "user-1", created_at: "2026-11-11T00:00:00Z", ...o });
const run = (o: Partial<Run> = {}): Run => ({ id: "run-1", mission_id: "mis-1", org_id: "org-1", project_id: "proj-1", status: "running", trigger: "schedule", state: null, steps: 0, summary: null, error: null, input_tokens: 0, output_tokens: 0, credit_cost: 0, worker: "uji", heartbeat_at: null, created_at: "2026-11-11T00:00:00Z", started_at: null, finished_at: null, ...o });

function db(extra: Record<string, Row[]> = {}) {
  return fakeSupabase({
    organizations: [{ id: "org-1", owner_id: "owner-1", credit_balance: 3, chat_model: "anthropic/claude-sonnet-5-5", fallback_model: null }],
    org_api_keys: [{ org_id: "org-1", provider: "anthropic", secret: "sk-uji" }, { org_id: "org-1", provider: "mikrotik", secret: "https://192.168.10.1|asisten|rahasia" }, { org_id: "org-1", provider: "google", secret: "AIza-uji" }],
    projects: [{ id: "proj-1", org_id: "org-1", name: "Jaringan Rumah", tagline: null, description: "Jaringan rumah dengan VLAN", brand: {}, category: null, website: null }],
    agents: [
      { id: "ag-arka", slug: ARKA_SLUG, display_name: "Arka", title: "Asisten Pribadi Otonom", system_prompt: "PANDUAN ARKA", requires_tools: ["web_search", "mikrotik_rest", "remember", "propose_mission", "consult_agent", "make_presentation", "image_edit"], is_active: true },
      { id: "ag-satria", slug: "satria-network-engineer", display_name: "Satria", title: "Network Engineer", system_prompt: "PANDUAN SATRIA", requires_tools: ["mikrotik_rest", "subnet_calc", "view_image", "delegate_agent"], is_active: true },
    ],
    auto_memory: [{ org_id: "org-1", is_active: true, kind: "preference", content: "Laporan selalu berbentuk tabel ringkas." }],
    ...extra,
  });
}

test("konteks: prompt, tool, dan percakapan dirakit untuk Arka", async () => {
  const f = db();
  const env = await buildEnv(f.sb, run(), mission());
  assert.match(env.system, /MODE OTONOM/);
  assert.match(env.system, /=== PERAN: Arka ===\nPANDUAN ARKA/);
  assert.match(env.system, /Laporan selalu berbentuk tabel ringkas/);
  assert.match(env.system, /Satria — Network Engineer/);
  assert.match(env.brief, /MISI: Cek jaringan/); assert.match(env.brief, /Periksa router\./); assert.match(env.brief, /Asia\/Jakarta/);
  const names = env.tools.map((t) => t.name);
  for (const t of ["web_search", "mikrotik_rest", "make_presentation", "image_edit", "image_generate", "remember", "consult_agent", "ask_user", "view_image", "save_to_drive"]) assert.ok(names.includes(t), `tool ${t} harus tersedia`);
  // misi kerja tidak boleh "menjadwalkan dirinya sendiri" — walau agent-nya mendaftarkan propose_mission
  assert.ok(!names.includes("propose_mission"), "propose_mission hanya untuk misi belajar kebiasaan");
  assert.match(env.brief, /jadwalnya sudah diatur sistem\. Kerjakan isinya SEKARANG/);
  assert.match(env.system, /Laporan hanya boleh berisi hal yang benar-benar terjadi/);
  assert.ok(!names.includes("delegate_agent"));
  assert.ok(!names.includes("delete_drive_file"), "kemampuan yang belum disetujui admin tidak boleh muncul");
  assert.equal(new Set(names).size, names.length, "nama tool tidak boleh ganda (API menolak)");
  assert.ok(names.every((n) => n in TOOL_DEFS));
  // percakapan laporan dibuat sekali dan dicatat ke misi; pesan pembuka disimpan
  assert.ok(f.writes.some((w) => w.table === "conversations" && w.op === "insert" && (w.payload as Row).agent_id === "ag-arka" && (w.payload as Row).user_id === "user-1"));
  assert.ok(f.writes.some((w) => w.table === "auto_missions" && w.op === "update" && "conversation_id" in (w.payload as Row)));
  assert.ok(f.writes.some((w) => w.table === "messages" && String((w.payload as Row).content).includes("Misi otomatis — Cek jaringan")));
});

test("konteks: agent pilihan misi dipakai; view_image tidak ganda; run lanjutan tidak menulis pesan pembuka lagi", async () => {
  const f = db();
  const env = await buildEnv(f.sb, run({ state: { messages: [], seen: {}, transcript: "" } }), mission({ agent_id: "ag-satria", conversation_id: "conv-lama" }));
  assert.match(env.system, /=== PERAN: Satria ===\nPANDUAN SATRIA/);
  const names = env.tools.map((t) => t.name);
  assert.equal(names.filter((n) => n === "view_image").length, 1);
  assert.ok(!names.includes("delegate_agent"));
  assert.ok(!f.writes.some((w) => w.table === "conversations"));
  assert.ok(!f.writes.some((w) => w.table === "messages"));
});

test("konteks: misi 'belajar kebiasaan' hanya boleh mengingat dan mengusulkan", async () => {
  const f = db({
    conversations: [{ id: "c1", title: "Konten promo", project_id: "proj-1", agent: { display_name: "Maya" } }],
    messages: [{ conversation_id: "c1", role: "user", content: "Tolong buat caption promo, bentuk tabel ya", created_at: "2026-11-10T02:00:00Z" }, { conversation_id: "c1", role: "user", content: "🤖 **Misi otomatis — x**", created_at: "2026-11-10T03:00:00Z" }],
    auto_missions: [{ id: "lain", org_id: "org-1", title: "Ide konten mingguan", schedule_kind: "weekly", schedule: {}, status: "rejected" }],
  });
  const env = await buildEnv(f.sb, run(), mission({ kind: "reflect", title: "Belajar kebiasaan saya" }));
  assert.deepEqual(env.tools.map((t) => t.name).sort(), ["propose_mission", "remember"]);
  assert.match(env.brief, /bentuk tabel ya/);
  assert.match(env.brief, /\[rejected\] Ide konten mingguan/);
  assert.ok(!env.brief.includes("Misi otomatis — x"), "pesan otomatis bukan kebiasaan user");
});

test("konteks: tanpa kunci model → pesan yang bisa ditindaklanjuti; kunci platform → kredit ditagih", async () => {
  const f = db(); f.fixtures.org_api_keys = [];
  await assert.rejects(buildEnv(f.sb, run(), mission()), /Belum ada kunci API model/);
  process.env.ANTHROPIC_API_KEY = "sk-platform";
  const env = await buildEnv(f.sb, run(), mission());
  const cost = await env.account!(1_000_000, 100_000);
  assert.ok(cost > 0);
  assert.equal(f.rpcs[0].fn, "apply_credit");
  assert.equal((f.rpcs[0].args as Row).p_amount, -cost);
  // kunci milik organisasi → tidak memotong kredit
  const g = db(); const env2 = await buildEnv(g.sb, run(), mission());
  assert.equal(await env2.account!(1_000_000, 100_000), 0); assert.equal(g.rpcs.length, 0);
});

test("konteks: tool yang dijalankan lewat env tercatat dan laporan masuk ke percakapan", async () => {
  const f = db();
  const env = await buildEnv(f.sb, run(), mission({ conversation_id: "conv-1" }));
  const r = await env.runTool({ id: "c1", name: "remember", input: { kind: "habit", content: "User memeriksa jaringan setiap pagi sebelum bekerja." } });
  assert.match(r.output, /^Diingat \(habit\)/);
  assert.ok(f.writes.some((w) => w.table === "auto_memory" && (w.payload as Row).source === "assistant"));
  assert.match((await env.runTool({ id: "c2", name: "remember", input: { kind: "fact", content: "password router adalah hunter2 rahasia" } })).output, /^Gagal: terlihat seperti rahasia/);
  const p = await env.runTool({ id: "c3", name: "propose_mission", input: { title: "Laporan hotspot mingguan", instructions: "Baca pemakaian hotspot lalu simpan tabelnya ke Drive.", schedule_kind: "weekly", time: "16:00", days: [5], agent: "satria", reason: "diminta berulang" } });
  assert.match(p.output, /diusulkan \(Jum 16:00, dikerjakan Satria\)/);
  const w = f.writes.find((x) => x.table === "auto_missions" && x.op === "insert")!.payload as Row;
  assert.equal(w.status, "proposed"); assert.equal(w.source, "assistant"); assert.equal(w.agent_id, "ag-satria"); assert.equal(w.next_run_at, undefined, "usulan tidak boleh terjadwal sebelum diaktifkan user");
  assert.match((await env.runTool({ id: "c4", name: "consult_agent", input: { agent: "Satria" } })).output, /Panduan kerja Satria[\s\S]*PANDUAN SATRIA/);
  await env.report!("Laporan akhir", "done");
  assert.ok(f.writes.some((x) => x.table === "messages" && (x.payload as Row).role === "assistant" && (x.payload as Row).content === "Laporan akhir" && (x.payload as Row).conversation_id === "conv-1"));
});

test("router: potret 'sebelum' dan backup wajib sebelum perubahan", async () => {
  const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
  let backupStatus = 200;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url); const method = init?.method ?? "GET";
    calls.push({ url: u, method, body: init?.body as string | undefined, auth: (init?.headers as Record<string, string>)?.authorization });
    if (u.endsWith("/rest/system/backup/save")) return new Response(backupStatus === 200 ? "[]" : '{"error":403,"message":"not enough permissions"}', { status: backupStatus });
    return new Response(JSON.stringify({ ".id": "*2", name: "tamu", "rate-limit": "10M/10M" }), { status: 200 });
  }) as typeof fetch;
  const f = db();
  const env = await buildEnv(f.sb, run(), mission({ conversation_id: "conv-1" }));
  const patch = { id: "c1", name: "mikrotik_rest", input: { path: "/ip/hotspot/user/profile/*2", method: "PATCH", body: { "rate-limit": "5M/5M" } } };

  assert.deepEqual(await env.snapshotBefore!(patch), { sebelum: { ".id": "*2", name: "tamu", "rate-limit": "10M/10M" } });
  assert.equal(calls[0].url, "https://192.168.10.1/rest/ip/hotspot/user/profile/*2"); assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].auth, "Basic " + Buffer.from("asisten:rahasia").toString("base64"));
  assert.equal(await env.snapshotBefore!({ id: "c0", name: "save_to_drive", input: {} }), null);

  // backup gagal → perubahan dibatalkan
  backupStatus = 403;
  assert.match((await env.beforeApproved!(patch)) ?? "", /backup otomatis router gagal[\s\S]*Perubahan dibatalkan/);
  // backup berhasil → lanjut; perubahan berikutnya di run yang sama tidak membuat backup lagi
  backupStatus = 200;
  const before = calls.length;
  assert.equal(await env.beforeApproved!(patch), null);
  assert.equal(await env.beforeApproved!(patch), null);
  const backups = calls.slice(before).filter((c) => c.url.endsWith("/rest/system/backup/save"));
  assert.equal(backups.length, 1); assert.equal(backups[0].method, "POST"); assert.match(backups[0].body ?? "", /"name":"pegawaiku-\d{8}-\d{6}"/);
  assert.equal(await env.beforeApproved!({ id: "c9", name: "landing_publish", input: {} }), null, "pengaman router tidak berlaku untuk tool lain");

  // fungsi dasar: router tak terjangkau & saklar mati
  globalThis.fetch = (async () => { throw new Error("connect ETIMEDOUT"); }) as typeof fetch;
  assert.match((await routerBackup({ mikrotik: "https://192.168.10.1|a|b" })) ?? "", /Router tidak bisa dijangkau/);
  assert.match(JSON.stringify(await routerSnapshot(patch, { mikrotik: "https://192.168.10.1|a|b" })), /tidak bisa dibaca/);
  process.env.AUTOPILOT_ROUTER_BACKUP = "off";
  assert.equal(await routerBackup({ mikrotik: "https://192.168.10.1|a|b" }), null);
});

test("templat: jadwal valid dan agent yang dirujuk memang ada di katalog", async () => {
  const fs = await import("node:fs");
  for (const t of MISSION_TEMPLATES) {
    assert.equal(typeof normalizeSchedule(t.schedule_kind, t.schedule), "object", t.key);
    if (t.agentSlug) assert.ok(fs.existsSync(`skills/${t.agentSlug}/SKILL.md`), `agent ${t.agentSlug} tidak ada`);
  }
  assert.ok(fs.existsSync(`skills/${ARKA_SLUG}/SKILL.md`));
  assert.equal(new Set(MISSION_TEMPLATES.map((t) => t.title)).size, MISSION_TEMPLATES.length);
});

test("telegram: hanya chat terdaftar yang bisa memutuskan; keputusan mengikat ke persetujuan yang masih menunggu", async () => {
  const id = "0b9d3c1e-1111-2222-3333-444455556666";
  assert.deepEqual(parseCallback(`ap:${id}:y`), { kind: "action", id, approve: true });
  assert.deepEqual(parseCallback(`aq:${id}:1`), { kind: "question", id, option: 1 });
  for (const bad of [`ap:${id}:2`, `aq:${id}:y`, "ap:bukan-uuid:y", `xx:${id}:y`, undefined, `ap:${id}:y; drop table`]) assert.equal(parseCallback(bad), null);

  const sent: { method: string; body: Row }[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => { sent.push({ method: String(url).split("/").pop()!, body: JSON.parse(String(init?.body ?? "{}")) }); return new Response('{"ok":true,"result":{}}'); }) as typeof fetch;
  const tg = { token: "1:abc", chatId: "777" };
  const mk = () => fakeSupabase({ auto_approvals: [{ id, org_id: "org-1", kind: "action", status: "pending", summary: "Ubah router", options: null }], organizations: [{ id: "org-1", owner_id: "owner-1" }], projects: [{ id: "proj-1", org_id: "org-1", name: "Rumah" }] });

  // chat asing menekan tombol → ditolak, tidak ada tulisan ke database
  let f = mk();
  await handleUpdate(f.sb, "org-1", tg, { update_id: 1, callback_query: { id: "q", data: `ap:${id}:y`, message: { message_id: 5, chat: { id: 999 } } } });
  assert.equal(f.writes.length, 0);
  assert.match(String(sent.at(-1)!.body.text), /tidak berwenang/);

  // chat terdaftar menyetujui
  f = mk();
  await handleUpdate(f.sb, "org-1", tg, { update_id: 2, callback_query: { id: "q", data: `ap:${id}:y`, message: { message_id: 5, chat: { id: 777 } } } });
  const w = f.writes.find((x) => x.table === "auto_approvals")!;
  assert.equal((w.payload as Row).status, "approved"); assert.equal((w.payload as Row).decided_via, "telegram");
  assert.ok(w.filters.some(([k, c, v]) => k === "eq" && c === "status" && v === "pending"), "hanya persetujuan yang masih menunggu");
  assert.ok(w.filters.some(([k, c, v]) => k === "eq" && c === "org_id" && v === "org-1"));

  // persetujuan milik organisasi lain tidak tersentuh
  f = mk();
  await handleUpdate(f.sb, "org-LAIN", tg, { update_id: 3, callback_query: { id: "q", data: `ap:${id}:y`, message: { message_id: 5, chat: { id: 777 } } } });
  assert.equal(f.writes.length, 0);

  // /misi dari chat terdaftar → misi sekali jalan; dari chat asing → diabaikan
  f = mk();
  await handleUpdate(f.sb, "org-1", tg, { update_id: 4, message: { text: "/misi cek router dan laporkan WAN yang mati", chat: { id: 777 } } });
  const m = f.writes.find((x) => x.table === "auto_missions")!.payload as Row;
  assert.equal(m.schedule_kind, "once"); assert.equal(m.status, "active"); assert.equal(m.created_by, "owner-1"); assert.equal(m.project_id, "proj-1");
  f = mk();
  await handleUpdate(f.sb, "org-1", tg, { update_id: 5, message: { text: "/misi hapus semua aturan firewall", chat: { id: 123 } } });
  assert.equal(f.writes.length, 0);
});

test("memori: rahasia ditolak, kalimat biasa yang menyebut kata serupa tetap boleh", async () => {
  const f = db();
  const env = await buildEnv(f.sb, run(), mission({ conversation_id: "conv-1" }));
  const tryRemember = async (content: string) => (await env.runTool({ id: "x", name: "remember", input: { kind: "fact", content } })).output;
  for (const secret of ["password router adalah hunter2 rahasia", "Kata sandi WiFi tamu: tamu12345", "API key Tavily = tvly-abcdef", "kunci sk-ant-api03-abcdefghijklmnop", "Nomor kartu user 4111111111111111 untuk langganan"]) assert.match(await tryRemember(secret), /^Gagal: terlihat seperti rahasia/, secret);
  for (const fine of ["User ingin laporan jaringan memakai tabel ringkas.", "Hotspot tamu memakai voucher, bukan kata sandi bersama.", "User lebih suka presentasi berlatar gelap dengan sedikit teks."]) assert.match(await tryRemember(fine), /^Diingat/, fine);
});
