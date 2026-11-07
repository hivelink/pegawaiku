import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Unggah gambar project (kind=image) atau aset brand (kind=asset) ke bucket publik `brand`. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const projectId = String(form.get("project_id") ?? "");
  const kind = String(form.get("kind") ?? "image");
  const assetName = String(form.get("name") ?? "").trim();
  if (!file || !projectId) return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Hanya file gambar" }, { status: 415 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "Maksimal 5 MB" }, { status: 413 });

  const { data: project } = await supabase.from("projects").select("id,brand,image_url").eq("id", projectId).single();
  if (!project) return NextResponse.json({ error: "project tidak ditemukan" }, { status: 404 });

  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${projectId}/${kind}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from("brand").upload(path, file, { contentType: file.type, upsert: true });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  const { data: pub } = supabase.storage.from("brand").getPublicUrl(path);
  const url = pub.publicUrl;

  if (kind === "image") {
    const { error } = await supabase.from("projects").update({ image_url: url }).eq("id", projectId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const brand = { ...(project.brand ?? {}) } as { assets?: { name: string; path: string; url: string }[] };
    brand.assets = [...(brand.assets ?? []), { name: assetName || file.name, path, url }];
    const { error } = await supabase.from("projects").update({ brand }).eq("id", projectId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, url });
}
