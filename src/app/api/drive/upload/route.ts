import { NextResponse } from "next/server";
import { logEvent, describeError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const projectId = String(form.get("project_id") ?? "");
  if (!file || !projectId) return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Maksimal 25 MB" }, { status: 413 });

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${projectId}/${Date.now()}-${safe}`;
  const { error: upErr } = await supabase.storage.from("drive").upload(path, file, { contentType: file.type || undefined });
  if (upErr) { await logEvent("error", "api:drive-upload", upErr.message, { path }); return NextResponse.json({ error: upErr.message }, { status: 500 }); }

  const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("text/") ? "text" : "file";
  const { error } = await supabase.from("files").insert({ project_id: projectId, owner_id: user.id, title: file.name, storage_path: path, mime_type: file.type, size_bytes: file.size, kind });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
