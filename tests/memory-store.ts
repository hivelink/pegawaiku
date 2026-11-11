import type { Approval, AutoStore, Mission, NewApproval, Run, RunPatch } from "../src/lib/autopilot/types";

/** Penyimpanan di memori untuk menguji mesin Asisten Otonom tanpa database. */
export class MemoryStore implements AutoStore {
  missions = new Map<string, Mission>();
  runs = new Map<string, Run>();
  approvals: Approval[] = [];
  events: { runId: string; kind: string; label: string }[] = [];
  beats = 0;
  private n = 0;
  private id(p: string) { return `${p}-${++this.n}`; }
  clock = () => new Date().toISOString();

  addMission(p: Partial<Mission> = {}): Mission {
    const m: Mission = {
      id: this.id("mis"), org_id: "org-1", project_id: "proj-1", agent_id: null, kind: "task", title: "Uji", instructions: "Kerjakan uji.",
      schedule_kind: "once", schedule: {}, tz: "Asia/Jakarta", approval_mode: "sensitive", status: "active", source: "user", reason: null,
      conversation_id: null, next_run_at: null, last_run_at: null, created_by: "user-1", created_at: this.clock(), ...p,
    };
    this.missions.set(m.id, m);
    return m;
  }
  /** salinan seperti hasil baca database (bukan referensi hidup) */
  run(id: string): Run { return structuredClone(this.runs.get(id)!); }

  async heartbeat() { this.beats++; }
  async reclaimStale(older: string) {
    let c = 0;
    for (const r of this.runs.values()) if (r.status === "running" && (r.heartbeat_at ?? "") < older) { r.status = "queued"; r.worker = null; c++; }
    return c;
  }
  async expireApprovals(older: string) {
    let c = 0;
    for (const a of this.approvals) if (a.status === "pending" && a.created_at < older) { a.status = "expired"; c++; }
    return c;
  }
  async dueMissions(now: string) { return [...this.missions.values()].filter((m) => m.status === "active" && m.next_run_at && m.next_run_at <= now).map((m) => structuredClone(m)); }
  async advanceMission(m: Mission, next: string | null) {
    const cur = this.missions.get(m.id);
    if (!cur || cur.status !== "active" || cur.next_run_at !== m.next_run_at) return false;
    cur.next_run_at = next;
    return true;
  }
  async hasOpenRun(missionId: string) { return [...this.runs.values()].some((r) => r.mission_id === missionId && ["queued", "running", "waiting_approval"].includes(r.status)); }
  async createRun(m: Mission, trigger: Run["trigger"]) {
    const r: Run = { id: this.id("run"), mission_id: m.id, org_id: m.org_id, project_id: m.project_id, status: "queued", trigger, state: null, steps: 0, summary: null, error: null, input_tokens: 0, output_tokens: 0, credit_cost: 0, worker: null, heartbeat_at: null, created_at: this.clock(), started_at: null, finished_at: null };
    this.runs.set(r.id, r);
    return structuredClone(r);
  }
  async waitingRuns() { return [...this.runs.values()].filter((r) => r.status === "waiting_approval").map((r) => structuredClone(r)); }
  async requeue(id: string) { const r = this.runs.get(id); if (r?.status === "waiting_approval") r.status = "queued"; }
  async claimNextRun() {
    const r = [...this.runs.values()].find((x) => x.status === "queued");
    if (!r) return null;
    r.status = "running"; r.worker = "uji"; r.heartbeat_at = this.clock(); r.started_at ??= this.clock();
    return structuredClone(r);
  }
  async getMission(id: string) { const m = this.missions.get(id); return m ? structuredClone(m) : null; }
  async updateMission(id: string, patch: Partial<Mission>) { Object.assign(this.missions.get(id)!, patch); }
  async saveRun(id: string, patch: RunPatch) {
    Object.assign(this.runs.get(id)!, structuredClone(patch));
    if (patch.status && ["done", "failed", "cancelled"].includes(patch.status)) for (const a of this.approvals) if (a.run_id === id && a.status === "pending") a.status = "expired";
  }
  async addEvent(runId: string, kind: string, label: string) { this.events.push({ runId, kind, label }); }
  async createApproval(a: NewApproval) {
    const row: Approval = { ...structuredClone(a), id: this.id("ap"), answer: null, status: "pending", note: null, executed_at: null, created_at: this.clock() };
    this.approvals.push(row);
    return structuredClone(row);
  }
  async getApprovals(runId: string) { return this.approvals.filter((a) => a.run_id === runId).map((a) => structuredClone(a)); }
  async markApprovalExecuted(id: string) {
    const a = this.approvals.find((x) => x.id === id);
    if (!a || a.status !== "approved" || a.executed_at) return false;
    a.executed_at = this.clock();
    return true;
  }
  /** keputusan user (di aplikasi ini dilakukan lewat halaman Asisten / Telegram) */
  decide(id: string, status: "approved" | "rejected", extra: Partial<Approval> = {}) { Object.assign(this.approvals.find((a) => a.id === id)!, { status, ...extra }); }
}
