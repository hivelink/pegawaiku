import { NextResponse } from "next/server";
import { logEvent } from "@/lib/log";
export const runtime = "nodejs";
/** Terima log dari sisi klien (error boundary). */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { level?: "info" | "warn" | "error"; source?: string; message?: string; detail?: Record<string, unknown> };
  await logEvent(b.level ?? "error", String(b.source ?? "client").slice(0, 80), String(b.message ?? "").slice(0, 2000), b.detail);
  return NextResponse.json({ ok: true });
}
