import type { ChatMsg, ToolDef, LlmStep, ToolImage } from "../llm";

/**
 * Asisten Otonom — tipe data bersama (dipakai pekerja NAS, route tick, dan halaman /app/asisten).
 * Misi  = perintah dari user (sekali jalan atau rutin).
 * Run   = satu kali pengerjaan misi; state-nya disimpan agar bisa dijeda (menunggu persetujuan) lalu dilanjutkan.
 * Approval = aksi berisiko / pertanyaan yang menunggu keputusan user.
 */

export type ScheduleKind = "once" | "interval" | "daily" | "weekly";
export type Schedule = { every_minutes?: number; time?: string; days?: number[] };
export type ApprovalMode = "sensitive" | "all_writes";
export type MissionStatus = "proposed" | "active" | "paused" | "done" | "rejected";

export type Mission = {
  id: string;
  org_id: string;
  project_id: string;
  agent_id: string | null;
  kind: "task" | "reflect";
  title: string;
  instructions: string;
  schedule_kind: ScheduleKind;
  schedule: Schedule;
  tz: string;
  approval_mode: ApprovalMode;
  /** model khusus untuk misi ini ("provider/model"); null = rekomendasi agent. Kolom dari migrasi 0017 (bisa belum ada). */
  model?: string | null;
  status: MissionStatus;
  source: "user" | "assistant";
  reason: string | null;
  conversation_id: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type RunStatus = "queued" | "running" | "waiting_approval" | "done" | "failed" | "cancelled";
export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export type RunState = {
  messages: ChatMsg[];
  /** tanda tangan panggilan tool → jumlah pengulangan (deteksi looping) */
  seen: Record<string, number>;
  /** teks yang terlihat user: jawaban agent + label langkah */
  transcript: string;
  /** langkah yang tertahan menunggu keputusan user */
  pending?: { calls: ToolCall[]; results: Record<string, string>; gated: string[] };
};

export type Run = {
  id: string;
  mission_id: string;
  org_id: string;
  project_id: string;
  status: RunStatus;
  trigger: "manual" | "schedule";
  state: RunState | null;
  steps: number;
  summary: string | null;
  error: string | null;
  input_tokens: number;
  output_tokens: number;
  credit_cost: number;
  worker: string | null;
  heartbeat_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type Approval = {
  id: string;
  run_id: string;
  org_id: string;
  mission_id: string | null;
  kind: "action" | "question";
  call_id: string;
  tool_key: string;
  input: Record<string, unknown>;
  summary: string;
  reason: string | null;
  detail: Record<string, unknown> | null;
  risk: string;
  options: { label: string; desc?: string }[] | null;
  answer: string | null;
  status: ApprovalStatus;
  note: string | null;
  executed_at: string | null;
  created_at: string;
};
export type NewApproval = Pick<Approval, "run_id" | "org_id" | "mission_id" | "kind" | "call_id" | "tool_key" | "input" | "summary" | "reason" | "detail" | "risk" | "options">;

export type MemoryItem = { id: string; kind: "preference" | "habit" | "fact"; content: string; evidence: string | null; source: "assistant" | "user"; is_active: boolean; created_at: string };

export type RunPatch = Partial<Pick<Run, "status" | "state" | "steps" | "summary" | "error" | "input_tokens" | "output_tokens" | "credit_cost" | "heartbeat_at" | "started_at" | "finished_at" | "worker">>;

/** Penyimpanan yang dibutuhkan mesin — implementasi Supabase untuk produksi, in-memory untuk uji. */
export interface AutoStore {
  heartbeat(info?: Record<string, unknown>): Promise<void>;
  /** run "running" yang pekerjanya mati (heartbeat lama) dikembalikan ke antrean */
  reclaimStale(olderThanIso: string): Promise<number>;
  expireApprovals(olderThanIso: string): Promise<number>;
  dueMissions(nowIso: string): Promise<Mission[]>;
  /** geser jadwal misi secara atomik; false = sudah diambil pekerja lain */
  advanceMission(m: Mission, nextRunAt: string | null): Promise<boolean>;
  hasOpenRun(missionId: string): Promise<boolean>;
  createRun(m: Mission, trigger: Run["trigger"]): Promise<Run | null>;
  waitingRuns(): Promise<Run[]>;
  requeue(runId: string): Promise<void>;
  /** ambil satu run dari antrean secara atomik (queued → running) */
  claimNextRun(): Promise<Run | null>;
  getMission(id: string): Promise<Mission | null>;
  updateMission(id: string, patch: Partial<Pick<Mission, "status" | "last_run_at" | "conversation_id">>): Promise<void>;
  saveRun(id: string, patch: RunPatch): Promise<void>;
  addEvent(runId: string, kind: string, label: string, detail?: Record<string, unknown>): Promise<void>;
  createApproval(a: NewApproval): Promise<Approval>;
  getApprovals(runId: string): Promise<Approval[]>;
  /** tandai aksi yang disetujui sebagai "sedang dieksekusi" — true hanya untuk pemanggil pertama (maksimal sekali jalan) */
  markApprovalExecuted(id: string): Promise<boolean>;
}

/** Lingkungan satu run: prompt, tool, dan efek samping. Dibangun dari Supabase (context.ts) atau tiruan (uji). */
export type RunEnv = {
  system: string;
  tools: ToolDef[];
  brief: string;
  approvalMode: ApprovalMode;
  /** model yang dipakai run ini beserta asal pilihannya, untuk jurnal */
  modelLabel?: string;
  /** kunci tool yang merupakan aksi HTTP organisasi (selalu dianggap sensitif) */
  httpCapKeys: Set<string>;
  llm(messages: ChatMsg[], tools: ToolDef[], maxTokens: number, signal: AbortSignal): Promise<LlmStep>;
  runTool(call: ToolCall): Promise<{ output: string; images?: ToolImage[] }>;
  /** konteks tambahan untuk kartu persetujuan (mis. nilai router sebelum diubah) */
  snapshotBefore?(call: ToolCall): Promise<Record<string, unknown> | null>;
  /** pengaman tepat sebelum aksi sensitif yang sudah disetujui (mis. backup router). String = batalkan dengan alasan itu. */
  beforeApproved?(call: ToolCall): Promise<string | null>;
  /** catat pemakaian token; mengembalikan biaya kredit */
  account?(inputTokens: number, outputTokens: number): Promise<number>;
  /** dipanggil saat run selesai/gagal: simpan laporan ke percakapan */
  report?(text: string, status: RunStatus): Promise<void>;
  notify?(text: string, approvals?: Approval[]): Promise<void>;
};
