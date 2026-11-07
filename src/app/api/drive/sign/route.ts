import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/log";

export const runtime = "nodejs";

/**
 * Langkah 1 unggah: buat URL unggah bertanda tangan agar browser mengirim file LANGSUNG ke Supabase Storage
 * (melewati batas 4,5 MB body request Vercel) dan bisa menampilkan progres.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { project_id, filename, size } = (await req.json()) as { project_id: string; filename: string; size: number };
  if (!project_id || !filename) return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (size > 50 * 1024 * 1024) return NextResponse.json({ error: "Maksimal 50 MB per file" }, { status: 413 });

  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${project_id}/${Date.now()}-${safe}`;
  const { data, error } = await supabase.storage.from("drive").createSignedUploadUrl(path);
  if (error || !data) {
    await logEvent("error", "api:drive-sign", error?.message ?? "gagal", { path, size });
    return NextResponse.json({ error: error?.message ?? "Gagal menyiapkan unggahan" }, { status: 500 });
  }
  return NextResponse.json({ path, token: data.token, signedUrl: data.signedUrl });
}
