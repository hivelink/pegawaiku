import type { SupabaseClient } from "@supabase/supabase-js";
import type { Approval, AutoStore, Mission, NewApproval, Run, RunPatch } from "./types";

const OPEN = ["queued", "running", "waiting_approval"];
const TERMINAL = new Set(["done", "failed", "cancelled"]);

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

/**
 * Penyimpanan Asisten Otonom di Supabase.
 * - Pekerja NAS memakai klien service role (melewati RLS) — batasi ke satu organisasi lewat `orgId`.
 * - Route /api/autopilot/tick memakai klien milik user (RLS berlaku) dengan `orgId` organisasi aktif.
 */
export class SupabaseStore implements AutoStore {
  constructor(private sb: SupabaseClient, private opts: { workerName: string; orgId?: string | null; heartbeat?: boolean; info?: Record<string, unknown> }) {}

  private get org() { return this.opts.orgId || null; }

  async heartbeat(info?: Record<string, unknown>): Promise<void> {
    if (this.opts.heartbeat === false) return;
    const r = await this.sb.from("auto_workers").upsert({ name: this.opts.workerName, org_id: this.org, last_seen_at: new Date().toISOString(), info: { ...this.opts.info, ...info } }, { onConflict: "name" });
    if (r.error) throw new Error(`heartbeat: ${r.error.message}`);
  }

  async reclaimStale(olderThanIso: string): Promise<number> {
    let q = this.sb.from("auto_runs").update({ status: "queued", worker: null }).eq("status", "running").lt("heartbeat_at", olderThanIso);
    if (this.org) q = q.eq("org_id", this.org);
    return (must(await q.select("id"), "reclaimStale") ?? []).length;
  }

  async expireApprovals(olderThanIso: string): Promise<number> {
    let q = this.sb.from("auto_approvals").update({ status: "expired", decided_at: new Date().toISOString() }).eq("status", "pending").lt("created_at", olderThanIso);
    if (this.org) q = q.eq("org_id", this.org);
    return (must(await q.select("id"), "expireApprovals") ?? []).length;
  }

  async dueMissions(nowIso: string): Promise<Mission[]> {
    let q = this.sb.from("auto_missions").select("*").eq("status", "active").not("next_run_at", "is", null).lte("next_run_at", nowIso).order("next_run_at").limit(20);
    if (this.org) q = q.eq("org_id", this.org);
    return (must(await q, "dueMissions") ?? []) as Mission[];
  }

  async advanceMission(m: Mission, nextRunAt: string | null): Promise<boolean> {
    if (!m.next_run_at) return false;
    const rows = must(await this.sb.from("auto_missions").update({ next_run_at: nextRunAt }).eq("id", m.id).eq("status", "active").eq("next_run_at", m.next_run_at).select("id"), "advanceMission");
    return (rows ?? []).length > 0;
  }

  async hasOpenRun(missionId: string): Promise<boolean> {
    const r = await this.sb.from("auto_runs").select("id", { count: "exact", head: true }).eq("mission_id", missionId).in("status", OPEN);
    if (r.error) throw new Error(`hasOpenRun: ${r.error.message}`);
    return (r.count ?? 0) > 0;
  }

  async createRun(m: Mission, trigger: Run["trigger"]): Promise<Run | null> {
    return must(await this.sb.from("auto_runs").insert({ mission_id: m.id, org_id: m.org_id, project_id: m.project_id, trigger, status: "queued" }).select("*").single(), "createRun") as Run;
  }

  async waitingRuns(): Promise<Run[]> {
    let q = this.sb.from("auto_runs").select("*").eq("status", "waiting_approval").order("created_at").limit(50);
    if (this.org) q = q.eq("org_id", this.org);
    return (must(await q, "waitingRuns") ?? []) as Run[];
  }

  async requeue(runId: string): Promise<void> {
    must(await this.sb.from("auto_runs").update({ status: "queued" }).eq("id", runId).eq("status", "waiting_approval").select("id"), "requeue");
  }

  async claimNextRun(): Promise<Run | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let q = this.sb.from("auto_runs").select("id").eq("status", "queued").order("created_at").limit(1);
      if (this.org) q = q.eq("org_id", this.org);
      const next = (must(await q, "claimNextRun") ?? [])[0] as { id: string } | undefined;
      if (!next) return null;
      const now = new Date().toISOString();
      // atomik: hanya satu pekerja yang berhasil mengubah queued → running
      const got = must(await this.sb.from("auto_runs").update({ status: "running", worker: this.opts.workerName, heartbeat_at: now }).eq("id", next.id).eq("status", "queued").select("*"), "claimNextRun");
      const run = (got ?? [])[0] as Run | undefined;
      if (run) {
        if (!run.started_at) { await this.sb.from("auto_runs").update({ started_at: now }).eq("id", run.id); run.started_at = now; }
        return run;
      }
    }
    return null;
  }

  async getMission(id: string): Promise<Mission | null> {
    return (must(await this.sb.from("auto_missions").select("*").eq("id", id).maybeSingle(), "getMission") as Mission | null) ?? null;
  }

  async updateMission(id: string, patch: Partial<Pick<Mission, "status" | "last_run_at" | "conversation_id">>): Promise<void> {
    must(await this.sb.from("auto_missions").update(patch).eq("id", id).select("id"), "updateMission");
  }

  async saveRun(id: string, patch: RunPatch): Promise<void> {
    must(await this.sb.from("auto_runs").update(patch).eq("id", id).select("id"), "saveRun");
    // run berakhir → keputusan yang belum diambil tidak berlaku lagi
    if (patch.status && TERMINAL.has(patch.status)) await this.sb.from("auto_approvals").update({ status: "expired", decided_at: new Date().toISOString() }).eq("run_id", id).eq("status", "pending");
  }

  async addEvent(runId: string, kind: string, label: string, detail?: Record<string, unknown>): Promise<void> {
    const r = await this.sb.from("auto_run_events").insert({ run_id: runId, kind, label: label.slice(0, 500), detail: detail ?? null });
    if (r.error) console.warn(`[asisten] gagal mencatat jurnal: ${r.error.message}`); // jurnal tidak boleh menggagalkan run
  }

  async createApproval(a: NewApproval): Promise<Approval> {
    return must(await this.sb.from("auto_approvals").insert(a).select("*").single(), "createApproval") as Approval;
  }

  async getApprovals(runId: string): Promise<Approval[]> {
    return (must(await this.sb.from("auto_approvals").select("*").eq("run_id", runId).order("created_at"), "getApprovals") ?? []) as Approval[];
  }

  async markApprovalExecuted(id: string): Promise<boolean> {
    const rows = must(await this.sb.from("auto_approvals").update({ executed_at: new Date().toISOString() }).eq("id", id).eq("status", "approved").is("executed_at", null).select("id"), "markApprovalExecuted");
    return (rows ?? []).length > 0;
  }
}
