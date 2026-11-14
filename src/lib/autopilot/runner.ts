import type { ChatMsg, ToolResult, ToolImage } from "../llm";
import type { Approval, AutoStore, Mission, NewApproval, Run, RunEnv, RunState, RunStatus, ToolCall } from "./types";
import { classifyTool, describeAction, needsApproval, toolLabel, withConfirmation } from "./risk";

/**
 * Mesin pengerjaan satu run tanpa user di depan layar.
 * Berbeda dari /api/chat: tidak ada stream ke browser, state disimpan tiap langkah, dan aksi berisiko
 * DITAHAN menjadi "persetujuan" — run berhenti (waiting_approval) lalu dilanjutkan setelah user memutuskan.
 * Aksi yang disetujui dijalankan persis dengan input yang dilihat user, dan maksimal satu kali.
 */

export type Limits = { maxSteps: number; maxSameCall: number; maxToolErrors: number; toolTimeoutMs: number; llmTimeoutMs: number };
export const DEFAULT_LIMITS: Limits = { maxSteps: 40, maxSameCall: 2, maxToolErrors: 4, toolTimeoutMs: 120_000, llmTimeoutMs: 600_000 };

export type RunnerDeps = {
  store: AutoStore;
  buildEnv(run: Run, mission: Mission): Promise<RunEnv>;
  limits?: Partial<Limits>;
  now?: () => number;
};
export type ExecOpts = { deadline?: number; signal?: AbortSignal };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((r) => { timer = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(timer));
}

/** Gambar (base64) tidak ikut disimpan ke database — cukup untuk langkah LLM berikutnya saja. */
function persistable(state: RunState): RunState {
  return {
    ...state,
    messages: state.messages.map((m) => m.role === "tool_results" ? { role: "tool_results" as const, results: m.results.map((r) => ({ id: r.id, name: r.name, output: r.images?.length ? r.output + "\n(gambar tidak disimpan di riwayat — panggil view_image lagi bila perlu)" : r.output })) } : m),
  };
}

function parseQuestion(input: Record<string, unknown>): { q: string; options: { label: string; desc?: string }[] } | null {
  const q = String(input.question ?? "").trim().slice(0, 300);
  const options = (Array.isArray(input.options) ? input.options : []).slice(0, 4).map((o) => {
    const r = (o ?? {}) as Record<string, unknown>;
    return { label: String(r.label ?? "").trim().slice(0, 60), desc: r.consequence ? String(r.consequence).slice(0, 240) : undefined };
  }).filter((o) => o.label);
  return q && options.length >= 2 ? { q, options } : null;
}

export async function executeRun(deps: RunnerDeps, run: Run, opts: ExecOpts = {}): Promise<RunStatus> {
  const { store } = deps;
  const L = { ...DEFAULT_LIMITS, ...deps.limits };
  const now = deps.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  const signal = opts.signal ?? new AbortController().signal;

  const mission = await store.getMission(run.mission_id);
  if (!mission) { await store.saveRun(run.id, { status: "failed", error: "Misi sudah dihapus.", finished_at: iso() }); return "failed"; }

  let env: RunEnv;
  try { env = await deps.buildEnv(run, mission); }
  catch (e) {
    const msg = (e as Error).message ?? String(e);
    await store.addEvent(run.id, "error", `Gagal menyiapkan run: ${clip(msg, 300)}`);
    await store.saveRun(run.id, { status: "failed", error: clip(msg, 1000), finished_at: iso() });
    return "failed";
  }

  const state: RunState = run.state ?? { messages: [{ role: "user", content: env.brief }], seen: {}, transcript: "" };
  let steps = run.steps ?? 0;
  let inTok = 0, outTok = 0;
  let toolErrors = 0;
  let lastText = "";
  const say = (t: string) => { state.transcript += t; };

  /** simpan pemakaian token segmen ini (dipanggil di setiap jalur keluar) */
  async function settle(patch: Parameters<AutoStore["saveRun"]>[1]) {
    let cost = 0;
    if (inTok || outTok) { try { cost = (await env.account?.(inTok, outTok)) ?? 0; } catch { /* penagihan tidak boleh menggagalkan run */ } }
    await store.saveRun(run.id, { ...patch, steps, input_tokens: (run.input_tokens ?? 0) + inTok, output_tokens: (run.output_tokens ?? 0) + outTok, credit_cost: Number(run.credit_cost ?? 0) + cost, heartbeat_at: iso() });
    inTok = 0; outTok = 0;
  }
  async function finish(status: "done" | "failed", summary: string, error?: string): Promise<RunStatus> {
    delete state.pending;
    await settle({ status, summary: clip(summary, 4000), error: error ? clip(error, 1000) : null, state: persistable(state), finished_at: iso() });
    await store.updateMission(mission!.id, { last_run_at: iso(), ...(mission!.schedule_kind === "once" && status === "done" ? { status: "done" as const } : {}) });
    try { await env.report?.(state.transcript.trim() || summary, status); } catch { /* abaikan */ }
    try { await env.notify?.(`${status === "done" ? "✅ Selesai" : "⚠️ Gagal"}: ${mission!.title}\n${clip(summary || error || "", 500)}`); } catch { /* abaikan */ }
    return status;
  }
  async function runCall(call: ToolCall): Promise<{ output: string; images?: ToolImage[] }> {
    try { return await withTimeout(env.runTool(call), L.toolTimeoutMs, { output: `Gagal: ${call.name} tidak merespons dalam batas waktu.` }); }
    catch (e) { return { output: `Gagal menjalankan ${call.name}: ${(e as Error).message}` }; }
  }
  const track = (output: string) => { toolErrors = /^(Gagal|DIHENTIKAN)/.test(output) ? toolErrors + 1 : 0; };

  /** hasil untuk satu aksi yang tadinya ditahan, berdasarkan keputusan user */
  async function resolveGated(call: ToolCall, ap: Approval | undefined): Promise<string> {
    if (!ap) return "Gagal: data persetujuan untuk aksi ini tidak ditemukan. Jangan ulangi; laporkan ke user.";
    if (ap.kind === "question") {
      if (ap.status === "approved" && ap.answer) { say(`\n\n> _🗳 Jawaban user: ${ap.answer}_\n\n`); return `User memilih: ${ap.answer}${ap.note ? `\nCatatan user: ${ap.note}` : ""}`; }
      return "User tidak menjawab pertanyaan ini. Lanjutkan dengan pilihan paling aman, atau hentikan bagian ini dan laporkan.";
    }
    if (ap.status === "rejected") { say(`\n\n> _⛔ Ditolak user: ${ap.summary}${ap.note ? ` — ${ap.note}` : ""}_\n\n`); return `DITOLAK oleh user${ap.note ? ` dengan catatan: ${ap.note}` : ""}. Jangan ulangi aksi ini dan jangan mencari jalan lain untuk melakukan hal yang sama. Lanjutkan bagian lain dari misi atau akhiri dengan laporan.`; }
    if (ap.status !== "approved") return "Persetujuan kedaluwarsa (user tidak memutuskan). Aksi TIDAK dijalankan. Laporkan bahwa aksi ini masih menunggu keputusan.";
    if (!(await store.markApprovalExecuted(ap.id))) return "Aksi ini sudah pernah dieksekusi pada percobaan sebelumnya (hasilnya tidak tercatat). TIDAK dijalankan ulang — periksa keadaan terkini dengan tool baca sebelum melanjutkan.";
    const approved: ToolCall = { id: call.id, name: ap.tool_key, input: withConfirmation(ap.tool_key, ap.input) }; // persis yang dilihat user
    const blocked = await env.beforeApproved?.(approved).catch((e: Error) => `pengaman gagal dijalankan (${e.message})`);
    if (blocked) { await store.addEvent(run.id, "error", `Aksi dibatalkan pengaman: ${clip(blocked, 200)}`); say(`\n\n> ⚠️ _Aksi dibatalkan pengaman: ${clip(blocked, 200)}_\n\n`); return `Gagal: aksi TIDAK dijalankan — ${blocked}`; }
    const r = await runCall(approved);
    await store.addEvent(run.id, "tool", `✅ Disetujui & dijalankan: ${ap.summary}`, { tool: ap.tool_key, ok: !/^Gagal/.test(r.output), output: clip(r.output, 300) });
    say(`\n\n> _✅ Disetujui & dijalankan: ${ap.summary}_\n\n`);
    return r.output;
  }

  try {
    // ---- 1) lanjutkan langkah yang tertahan ----
    if (state.pending) {
      const all = await store.getApprovals(run.id);
      const byCall = new Map<string, Approval>();
      for (const a of all) if (state.pending.gated.includes(a.call_id)) byCall.set(a.call_id, a); // getApprovals urut naik → yang terbaru menang
      if (state.pending.gated.some((id) => byCall.get(id)?.status === "pending")) {
        await store.saveRun(run.id, { status: "waiting_approval", heartbeat_at: iso() });
        return "waiting_approval";
      }
      const results: ToolResult[] = [];
      for (const call of state.pending.calls) {
        const output = state.pending.gated.includes(call.id) ? await resolveGated(call, byCall.get(call.id)) : state.pending.results[call.id] ?? "(hasil tidak tercatat)";
        results.push({ id: call.id, name: call.name, output });
      }
      state.messages.push({ role: "tool_results", results });
      delete state.pending;
      await store.saveRun(run.id, { state: persistable(state), heartbeat_at: iso() });
    } else if (!run.state) {
      await store.addEvent(run.id, "info", `Mulai mengerjakan: ${mission.title}${env.modelLabel ? ` · model ${env.modelLabel}` : ""}`);
    }

    // ---- 2) putaran agent ----
    let stop: "" | "batas langkah" | "pengulangan tanpa kemajuan" | "beberapa tool gagal berturut-turut" = "";
    for (;;) {
      if (signal.aborted || (opts.deadline && now() > opts.deadline)) {
        // pekerja dimatikan / jatah waktu habis: state sudah konsisten, kembalikan ke antrean
        await settle({ status: "queued", state: persistable(state) });
        return "queued";
      }
      if (steps >= L.maxSteps) { stop = "batas langkah"; break; }

      const res = await env.llm(state.messages, env.tools, 16000, AbortSignal.any([signal, AbortSignal.timeout(L.llmTimeoutMs)]));
      steps++; inTok += res.usage.input; outTok += res.usage.output;
      if (res.text) { say(res.text); lastText = res.text; }
      if (!res.toolCalls.length) {
        if (res.stopReason === "max_tokens") say("\n\n_(Laporan terpotong karena batas panjang.)_");
        return await finish("done", lastText || "(selesai tanpa laporan)");
      }

      state.messages.push({ role: "assistant_tool_calls", calls: res.toolCalls, text: res.text });
      const results: Record<string, string> = {};
      const images: Record<string, ToolImage[]> = {};
      const gated: ToolCall[] = [];
      const news: NewApproval[] = [];
      let loopHit = false;

      for (const call of res.toolCalls) {
        const sig = call.name + ":" + JSON.stringify(call.input);
        const count = (state.seen[sig] ?? 0) + 1; state.seen[sig] = count;
        if (count > L.maxSameCall) { loopHit = true; results[call.id] = "DIHENTIKAN: panggilan ini sudah diulang tanpa hasil baru. Jangan panggil tool lagi; tulis laporanmu sekarang."; continue; }
        if (res.stopReason === "max_tokens" && call.name === "save_to_drive") { results[call.id] = "Gagal: isi terpotong karena terlalu panjang. Simpan ulang PER BAGIAN: bagian 1 mode 'new'/'replace', berikutnya mode 'append'."; track(results[call.id]); continue; }

        const base = { run_id: run.id, org_id: run.org_id, mission_id: mission.id, call_id: call.id, reason: res.text ? clip(res.text.trim(), 1200) : null };
        if (call.name === "ask_user") {
          const q = parseQuestion(call.input);
          if (!q) { results[call.id] = "Gagal: ask_user butuh pertanyaan dan minimal 2 opsi."; continue; }
          gated.push(call);
          news.push({ ...base, kind: "question", tool_key: call.name, input: call.input, summary: q.q, detail: null, risk: "question", options: q.options });
          continue;
        }
        const risk = classifyTool(call.name, call.input, env.httpCapKeys);
        if (needsApproval(risk, env.approvalMode)) {
          gated.push(call);
          let detail: Record<string, unknown> | null = null;
          try { detail = (await env.snapshotBefore?.(call)) ?? null; } catch { /* konteks tambahan bersifat opsional */ }
          news.push({ ...base, kind: "action", tool_key: call.name, input: call.input, summary: clip(describeAction(call.name, call.input), 600), detail, risk, options: null });
          continue;
        }
        const label = toolLabel(call.name, call.input);
        say(`\n\n> _${label}_\n\n`);
        const r = await runCall(call);
        results[call.id] = r.output;
        if (r.images?.length) images[call.id] = r.images;
        track(r.output);
        await store.addEvent(run.id, "tool", label, { tool: call.name, ok: !/^Gagal/.test(r.output), output: clip(r.output, 300) });
        await store.saveRun(run.id, { heartbeat_at: iso() }); // tanda hidup per tool, agar langkah panjang tidak dianggap macet
      }

      if (gated.length) {
        const created: Approval[] = [];
        for (const n of news) created.push(await store.createApproval(n));
        state.pending = { calls: res.toolCalls, results, gated: gated.map((c) => c.id) };
        for (const a of created) {
          say(`\n\n> _⏸ Menunggu ${a.kind === "question" ? "jawaban" : "persetujuan"} Anda: ${a.summary}_\n\n`);
          await store.addEvent(run.id, "approval", `Menunggu ${a.kind === "question" ? "jawaban" : "persetujuan"}: ${a.summary}`, { approval_id: a.id, tool: a.tool_key });
        }
        await settle({ status: "waiting_approval", state: persistable(state) });
        try { await env.notify?.(`⏸ ${mission.title} menunggu ${created.length} keputusan Anda:\n${created.map((a) => `• ${a.summary}`).join("\n")}`, created); } catch { /* abaikan */ }
        return "waiting_approval";
      }

      state.messages.push({ role: "tool_results", results: res.toolCalls.map((c) => ({ id: c.id, name: c.name, output: results[c.id] ?? "(tanpa hasil)", images: images[c.id] })) });
      await store.saveRun(run.id, { state: persistable(state), steps, heartbeat_at: iso() });
      if (loopHit) { stop = "pengulangan tanpa kemajuan"; break; }
      if (toolErrors >= L.maxToolErrors) { stop = "beberapa tool gagal berturut-turut"; break; }
    }

    // ---- 3) berhenti sebelum tuntas: minta rangkuman tanpa tool ----
    say(`\n\n---\n_⏸ Dihentikan otomatis: ${stop}._\n\n`);
    const wrap: ChatMsg[] = [...state.messages, { role: "user", content: `[SISTEM] Pekerjaan dihentikan karena ${stop}. Jangan panggil tool. Tulis laporan singkat: (1) yang sudah berhasil dikerjakan/disimpan, (2) yang belum selesai atau gagal dan kemungkinan sebabnya, (3) apa yang perlu diputuskan atau disediakan user.` }];
    try {
      const res = await env.llm(wrap, [], 2000, AbortSignal.any([signal, AbortSignal.timeout(120_000)]));
      inTok += res.usage.input; outTok += res.usage.output;
      if (res.text) { say(res.text); lastText = res.text; }
    } catch { /* laporan akhir bersifat opsional */ }
    return await finish("done", lastText || `Dihentikan: ${stop}.`);
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    if (signal.aborted) { await settle({ status: "queued", state: persistable(state) }).catch(() => {}); return "queued"; }
    await store.addEvent(run.id, "error", clip(msg, 300)).catch(() => {});
    say(`\n\n[Gagal: ${clip(msg, 300)}]`);
    return await finish("failed", lastText || "Run gagal sebelum selesai.", msg);
  }
}
