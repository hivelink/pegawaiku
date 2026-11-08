import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** SQL migrasi 0009 (satu kali, dijalankan manual) — hanya untuk pengguna yang login. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const sql = await readFile(path.join(process.cwd(), "supabase/migrations/0009_capabilities_updates.sql"), "utf8");
    return new NextResponse(sql, { headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch {
    return NextResponse.json({ error: "File migrasi tidak ikut terbangun" }, { status: 500 });
  }
}
