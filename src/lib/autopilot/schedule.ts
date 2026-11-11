import type { Schedule, ScheduleKind } from "./types";

/** Interval tersingkat misi rutin (menit) — mencegah misi menghabiskan kredit tanpa disadari. */
export const MIN_INTERVAL_MINUTES = 30;
export const DEFAULT_TZ = "Asia/Jakarta";

type Local = { y: number; m: number; d: number; hh: number; mm: number };

function localParts(t: number, tz: string): Local {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(t))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mm: p.minute };
}

/** Jam dinding (y-m-d hh:mm) di zona `tz` → waktu UTC (ms). */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 2; i++) { // dua putaran agar benar di sekitar pergantian DST
    const l = localParts(guess, tz);
    guess = wall - (Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mm) - guess);
  }
  return guess;
}

export function isValidTz(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return true; } catch { return false; }
}

export function parseTime(s: string | undefined): { hh: number; mm: number } | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  return hh > 23 || mm > 59 ? null : { hh, mm };
}

/** Rapikan jadwal dari form / tool; mengembalikan pesan error bila tidak valid. */
export function normalizeSchedule(kind: string, raw: Schedule): { kind: ScheduleKind; schedule: Schedule } | string {
  if (kind === "once") return { kind, schedule: {} };
  if (kind === "interval") {
    const n = Math.round(Number(raw.every_minutes));
    if (!Number.isFinite(n) || n < MIN_INTERVAL_MINUTES) return `Interval minimal ${MIN_INTERVAL_MINUTES} menit.`;
    return { kind, schedule: { every_minutes: Math.min(n, 60 * 24 * 30) } };
  }
  if (kind === "daily" || kind === "weekly") {
    const t = parseTime(raw.time);
    if (!t) return "Jam harus berformat HH:MM (mis. 07:00).";
    const time = `${String(t.hh).padStart(2, "0")}:${String(t.mm).padStart(2, "0")}`;
    if (kind === "daily") return { kind, schedule: { time } };
    const days = [...new Set((raw.days ?? []).map(Number).filter((d) => d >= 1 && d <= 7))].sort();
    if (!days.length) return "Pilih minimal satu hari (1=Senin … 7=Minggu).";
    return { kind, schedule: { time, days } };
  }
  return "Jenis jadwal tidak dikenal (once, interval, daily, weekly).";
}

/**
 * Waktu jalan berikutnya SETELAH `after`. null = tidak ada lagi (misi sekali jalan).
 * days: 1=Senin … 7=Minggu, dihitung di zona waktu misi.
 */
export function nextRunAt(kind: ScheduleKind, schedule: Schedule, tz: string, after: Date): Date | null {
  if (kind === "once") return null;
  if (kind === "interval") {
    const n = Math.max(MIN_INTERVAL_MINUTES, Math.round(Number(schedule.every_minutes) || 0));
    return new Date(after.getTime() + n * 60_000);
  }
  const t = parseTime(schedule.time) ?? { hh: 7, mm: 0 };
  const zone = isValidTz(tz) ? tz : DEFAULT_TZ;
  const days = kind === "weekly" && schedule.days?.length ? new Set(schedule.days) : null;
  const l = localParts(after.getTime(), zone);
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.UTC(l.y, l.m - 1, l.d + i)); // tanggal kalender ke-i (normalisasi akhir bulan)
    const isoDow = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    if (days && !days.has(isoDow)) continue;
    const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), t.hh, t.mm, zone);
    if (at > after.getTime()) return new Date(at);
  }
  return null;
}

const DAY = ["", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
export function describeSchedule(kind: ScheduleKind, s: Schedule): string {
  if (kind === "once") return "Sekali jalan";
  if (kind === "interval") { const n = Number(s.every_minutes) || 0; return n % 60 === 0 ? `Tiap ${n / 60} jam` : `Tiap ${n} menit`; }
  if (kind === "daily") return `Setiap hari ${s.time}`;
  return `${(s.days ?? []).map((d) => DAY[d]).join(", ")} ${s.time}`;
}
