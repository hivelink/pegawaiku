"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { logEvent, describeError, isNextSignal } from "@/lib/log";
import { normalizeSchedule, nextRunAt, isValidTz, DEFAULT_TZ } from "@/lib/autopilot/schedule";
import { MISSION_TEMPLATES } from "@/lib/autopilot/templates";
import type { Mission } from "@/lib/autopilot/types";

/** Sama seperti pembungkus di ../actions.ts: error dicatat ke app_logs lalu diteruskan ke error boundary. */
function guarded(name: string, fn: (fd: FormData) => Promise<void>) {
  return async (fd: FormData): Promise<void> => {
    try { await fn(fd); }
    catch (e) {
      if (isNextSignal(e)) throw e;
      const { message, detail } = describeError(e);
      await logEvent("error", `action:asisten.${name}`, message, detail);
      throw new Error(/auto_(missions|runs|approvals|memory)/.test(message) ? "Fitur Asisten belum terpasang — jalankan migrasi 0015_autopilot.sql di Pengaturan → Pembaruan." : `${name} gagal: ${message}`);
    }
  };
}

async function ctxOrg() {
  const ctx = await getContext();
  if (!ctx.org) throw new Error("Organisasi tidak ditemukan");
  return ctx as typeof ctx & { org: NonNullable<typeof ctx.org> };
}

/** Memutuskan persetujuan = memberi wewenang. Hanya owner/admin organisasi (RLS menegakkan hal yang sama). */
async function ctxAdmin() {
  const ctx = await ctxOrg();
  const { data: m } = await ctx.supabase.from("org_members").select("role").eq("org_id", ctx.org.id).eq("user_id", ctx.user.id).maybeSingle();
  if (!m || !["owner", "admin"].includes(m.role)) throw new Error("Hanya owner/admin organisasi yang bisa memberi persetujuan");
  return ctx;
}

const done = () => { revalidatePath("/app/asisten"); revalidatePath("/app", "layout"); };
const firstRun = (kind: Mission["schedule_kind"], schedule: Mission["schedule"], tz: string) => (kind === "once" ? new Date() : nextRunAt(kind, schedule, tz, new Date()))?.toISOString() ?? null;

async function _createMission(fd: FormData) {
  const { supabase, org, project, user } = await ctxOrg();
  if (!project) throw new Error("Buat project dulu — hasil misi disimpan di Drive project.");
  const instructions = String(fd.get("instructions") ?? "").trim().slice(0, 6000);
  if (instructions.length < 8) throw new Error("Tulis apa yang harus dikerjakan.");
  const title = (String(fd.get("title") ?? "").trim() || instructions.replace(/\s+/g, " ")).slice(0, 120);
  const kind = String(fd.get("schedule_kind") ?? "once");
  const sched = normalizeSchedule(kind, {
    every_minutes: Math.round(Number(fd.get("every_hours") ?? 0) * 60),
    time: String(fd.get("time") ?? ""),
    days: fd.getAll("days").map(Number),
  });
  if (typeof sched === "string") throw new Error(sched);
  const tz = isValidTz(String(fd.get("tz") ?? "")) ? String(fd.get("tz")) : DEFAULT_TZ;
  const agentId = String(fd.get("agent_id") ?? "") || null;
  const once = sched.kind === "once";
  const { data: m, error } = await supabase.from("auto_missions").insert({
    org_id: org.id, project_id: project.id, agent_id: agentId, kind: "task", title, instructions,
    schedule_kind: sched.kind, schedule: sched.schedule, tz,
    approval_mode: fd.get("approval_mode") === "all_writes" ? "all_writes" : "sensitive",
    status: "active", source: "user", next_run_at: once ? null : firstRun(sched.kind, sched.schedule, tz), created_by: user.id,
  }).select("id").single();
  if (error || !m) throw new Error(error?.message ?? "Misi tidak tersimpan");
  // misi sekali jalan langsung masuk antrean (terlihat di riwayat walau belum ada pekerja yang aktif)
  if (once) {
    const { error: rErr } = await supabase.from("auto_runs").insert({ mission_id: m.id, org_id: org.id, project_id: project.id, trigger: "manual", status: "queued" });
    if (rErr) throw new Error(rErr.message);
  }
  done();
}

async function _applyTemplate(fd: FormData) {
  const { supabase, org, project, user } = await ctxOrg();
  if (!project) throw new Error("Buat project dulu.");
  const t = MISSION_TEMPLATES.find((x) => x.key === String(fd.get("key")));
  if (!t) throw new Error("Templat tidak dikenal");
  const { data: same } = await supabase.from("auto_missions").select("id").eq("org_id", org.id).eq("title", t.title).in("status", ["active", "paused", "proposed"]).limit(1);
  if (same?.length) throw new Error(`Misi "${t.title}" sudah ada.`);
  let agentId: string | null = null;
  if (t.agentSlug) {
    const { data: a } = await supabase.from("agents").select("id").eq("slug", t.agentSlug).maybeSingle();
    agentId = a?.id ?? null;
  }
  const { error } = await supabase.from("auto_missions").insert({
    org_id: org.id, project_id: project.id, agent_id: agentId, kind: t.kind, title: t.title, instructions: t.instructions,
    schedule_kind: t.schedule_kind, schedule: t.schedule, tz: DEFAULT_TZ, status: "active", source: "user",
    next_run_at: firstRun(t.schedule_kind, t.schedule, DEFAULT_TZ), created_by: user.id,
  });
  if (error) throw new Error(error.message);
  done();
}

async function _missionAction(fd: FormData) {
  const { supabase, org } = await ctxOrg();
  const id = String(fd.get("id"));
  const op = String(fd.get("op"));
  const { data: m, error: mErr } = await supabase.from("auto_missions").select("*").eq("id", id).eq("org_id", org.id).single();
  if (mErr || !m) throw new Error(mErr?.message ?? "Misi tidak ditemukan");
  const mission = m as Mission;
  if (op === "delete") {
    const { error } = await supabase.from("auto_missions").delete().eq("id", id);
    if (error) throw new Error(error.message);
  } else if (op === "pause" || op === "reject") {
    const { error } = await supabase.from("auto_missions").update({ status: op === "pause" ? "paused" : "rejected", next_run_at: null }).eq("id", id);
    if (error) throw new Error(error.message);
  } else if (op === "resume" || op === "activate") {
    // mengaktifkan usulan asisten = memberi wewenang misi itu berjalan
    const { error } = await supabase.from("auto_missions").update({ status: "active", next_run_at: firstRun(mission.schedule_kind, mission.schedule, mission.tz) }).eq("id", id);
    if (error) throw new Error(error.message);
  } else if (op === "run") {
    if (!["active", "paused", "done"].includes(mission.status)) throw new Error("Aktifkan misi ini dulu.");
    const { count } = await supabase.from("auto_runs").select("id", { count: "exact", head: true }).eq("mission_id", id).in("status", ["queued", "running", "waiting_approval"]);
    if (count) throw new Error("Misi ini masih berjalan atau menunggu keputusan Anda.");
    const { error } = await supabase.from("auto_runs").insert({ mission_id: id, org_id: org.id, project_id: mission.project_id, trigger: "manual", status: "queued" });
    if (error) throw new Error(error.message);
  } else throw new Error("Perintah tidak dikenal");
  done();
}

async function _cancelRun(fd: FormData) {
  const { supabase, org } = await ctxOrg();
  const id = String(fd.get("id"));
  const now = new Date().toISOString();
  const { error } = await supabase.from("auto_runs").update({ status: "cancelled", finished_at: now, error: "Dibatalkan pengguna." }).eq("id", id).eq("org_id", org.id).in("status", ["queued", "waiting_approval"]);
  if (error) throw new Error(error.message);
  await supabase.from("auto_approvals").update({ status: "expired", decided_at: now }).eq("run_id", id).eq("status", "pending");
  done();
}

async function _decideApproval(fd: FormData) {
  const { supabase, org, user } = await ctxAdmin();
  const id = String(fd.get("id"));
  const decision = String(fd.get("decision")); // approve | reject | answer
  const note = String(fd.get("note") ?? "").trim().slice(0, 500) || null;
  const { data: ap, error: aErr } = await supabase.from("auto_approvals").select("id,kind,status,options").eq("id", id).eq("org_id", org.id).single();
  if (aErr || !ap) throw new Error(aErr?.message ?? "Persetujuan tidak ditemukan");
  if (ap.status !== "pending") { done(); return; } // sudah diputuskan (mis. lewat Telegram)
  const patch: Record<string, unknown> = { note, decided_by: user.id, decided_via: "web", decided_at: new Date().toISOString() };
  if (ap.kind === "question") {
    const labels = ((ap.options ?? []) as { label: string }[]).map((o) => o.label);
    const answer = String(fd.get("answer") ?? "").trim().slice(0, 300) || note;
    if (decision === "reject" || !answer) patch.status = "rejected";
    else Object.assign(patch, { status: "approved", answer: labels.includes(answer) ? answer : `Lainnya: ${answer}` });
  } else {
    if (decision !== "approve" && decision !== "reject") throw new Error("Keputusan tidak dikenal");
    patch.status = decision === "approve" ? "approved" : "rejected";
  }
  const { data: rows, error } = await supabase.from("auto_approvals").update(patch).eq("id", id).eq("status", "pending").select("id");
  if (error) throw new Error(error.message);
  if (!rows?.length) throw new Error("Keputusan tidak tersimpan — pastikan Anda owner/admin organisasi.");
  done();
}

async function _addMemory(fd: FormData) {
  const { supabase, org, user } = await ctxOrg();
  const content = String(fd.get("content") ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (content.length < 8) throw new Error("Tulis satu kalimat yang jelas.");
  const kind = ["preference", "habit", "fact"].includes(String(fd.get("kind"))) ? String(fd.get("kind")) : "preference";
  const { error } = await supabase.from("auto_memory").insert({ org_id: org.id, kind, content, source: "user", created_by: user.id });
  if (error) throw new Error(error.message);
  done();
}

async function _deleteMemory(fd: FormData) {
  const { supabase, org } = await ctxOrg();
  const { error } = await supabase.from("auto_memory").delete().eq("id", String(fd.get("id"))).eq("org_id", org.id);
  if (error) throw new Error(error.message);
  done();
}

export const createMission = guarded("createMission", _createMission);
export const applyTemplate = guarded("applyTemplate", _applyTemplate);
export const missionAction = guarded("missionAction", _missionAction);
export const cancelRun = guarded("cancelRun", _cancelRun);
export const decideApproval = guarded("decideApproval", _decideApproval);
export const addMemory = guarded("addMemory", _addMemory);
export const deleteMemory = guarded("deleteMemory", _deleteMemory);
