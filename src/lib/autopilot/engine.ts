import type { AutoStore } from "./types";
import { nextRunAt } from "./schedule";
import { executeRun, type RunnerDeps } from "./runner";

/** Persetujuan yang tidak diputuskan selama ini dianggap kedaluwarsa (aksi tidak dijalankan). */
export const APPROVAL_TTL_MS = 72 * 3600_000;
/** Run "running" tanpa heartbeat selama ini dianggap ditinggal pekerjanya. */
export const STALE_RUN_MS = 15 * 60_000;

export type TickOpts = { deadline?: number; maxRuns?: number; signal?: AbortSignal };
export type TickResult = { scheduled: number; resumed: number; processed: number; statuses: string[] };

/** Bagian ringan: heartbeat, jadwalkan misi jatuh tempo, bangunkan run yang keputusannya sudah ada. */
export async function housekeeping(store: AutoStore, now = Date.now()): Promise<{ scheduled: number; resumed: number }> {
  await store.heartbeat();
  await store.reclaimStale(new Date(now - STALE_RUN_MS).toISOString());
  await store.expireApprovals(new Date(now - APPROVAL_TTL_MS).toISOString());

  let scheduled = 0;
  for (const m of await store.dueMissions(new Date(now).toISOString())) {
    const next = nextRunAt(m.schedule_kind, m.schedule, m.tz, new Date(now));
    if (!(await store.advanceMission(m, next ? next.toISOString() : null))) continue; // pekerja lain sudah mengambil
    if (await store.hasOpenRun(m.id)) continue; // run sebelumnya belum tuntas (mis. masih menunggu persetujuan) → jangan menumpuk
    if (await store.createRun(m, "schedule")) scheduled++;
  }

  let resumed = 0;
  for (const r of await store.waitingRuns()) {
    const gated = new Set(r.state?.pending?.gated ?? []);
    const aps = (await store.getApprovals(r.id)).filter((a) => gated.has(a.call_id));
    if (aps.length >= gated.size && aps.every((a) => a.status !== "pending")) { await store.requeue(r.id); resumed++; }
  }
  return { scheduled, resumed };
}

/** Satu putaran penuh: housekeeping lalu kerjakan antrean sampai kosong / jatah habis. */
export async function tick(deps: RunnerDeps, opts: TickOpts = {}): Promise<TickResult> {
  const now = deps.now ?? Date.now;
  const { scheduled, resumed } = await housekeeping(deps.store, now());
  const statuses: string[] = [];
  const max = opts.maxRuns ?? 5;
  while (statuses.length < max && !opts.signal?.aborted && !(opts.deadline && now() > opts.deadline)) {
    const run = await deps.store.claimNextRun();
    if (!run) break;
    statuses.push(await executeRun(deps, run, { deadline: opts.deadline, signal: opts.signal }));
  }
  return { scheduled, resumed, processed: statuses.length, statuses };
}
