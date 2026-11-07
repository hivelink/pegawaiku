import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/log";

export const runtime = "nodejs";

/** Langkah 2 unggah: file sudah ada di Storage → catat ke tabel files. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json()) as { project_id: string; path: string; title: string; mime: string; size: number };
  if (!b.project_id || !b.path || !b.title) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const mime = b.mime || "application/octet-stream";
  const kind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : /^text\/|json|markdown/.test(mime) ? "text" : "file";
  const { error } = await supabase.from("files").insert({ project_id: b.project_id, owner_id: user.id, title: b.title, storage_path: b.path, mime_type: mime, size_bytes: b.size, kind });
  if (error) {
    await logEvent("error", "api:drive-complete", error.message, { path: b.path, code: error.code });
    // bersihkan objek yang sudah terunggah agar tidak yatim
    await supabase.storage.from("drive").remove([b.path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
