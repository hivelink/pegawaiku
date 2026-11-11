import type { SupabaseClient } from "@supabase/supabase-js";

export type DriveCtx = { supabase: SupabaseClient; projectId: string; userId: string };
export type DriveFile = { id: string; title: string; storage_path: string; mime_type: string | null; size_bytes: number | null };

/** Simpan file biner ke Drive project (bucket `drive` + baris di tabel files). Mengembalikan nama file yang dipakai. */
export async function putToDrive(ctx: DriveCtx, filename: string, bytes: Buffer, mime: string, kind: "file" | "image" | "video" | "text"): Promise<string> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${ctx.projectId}/${Date.now()}-${safe}`;
  const { error: upErr } = await ctx.supabase.storage.from("drive").upload(path, bytes, { contentType: mime });
  if (upErr) throw new Error(upErr.message);
  const { error } = await ctx.supabase.from("files").insert({ project_id: ctx.projectId, owner_id: ctx.userId, title: safe, storage_path: path, mime_type: mime, size_bytes: bytes.length, kind });
  if (error) throw new Error(error.message);
  return safe;
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

/** Cari satu gambar di Drive project berdasarkan nama (persis atau sebagian) dan unduh isinya. String = pesan error. */
export async function loadDriveImage(ctx: DriveCtx, name: string, maxBytes = 3_700_000): Promise<{ file: DriveFile; buf: Buffer; mime: string } | string> {
  const { data: files } = await ctx.supabase.from("files").select("id,title,storage_path,mime_type,size_bytes").eq("project_id", ctx.projectId).order("created_at", { ascending: false }).limit(300);
  const imgs = ((files ?? []) as DriveFile[]).filter((f) => (f.mime_type ?? "").startsWith("image/") || IMAGE_RE.test(f.title));
  if (!imgs.length) return "Tidak ada gambar di Drive project.";
  const q = name.toLowerCase().trim();
  const f = imgs.find((x) => x.title.toLowerCase() === q) ?? imgs.find((x) => x.title.toLowerCase().includes(q));
  if (!q || !f) return `Gambar "${name}" tidak ditemukan. Tersedia: ${imgs.slice(0, 30).map((x) => x.title).join(", ")}`;
  const { data, error } = await ctx.supabase.storage.from("drive").download(f.storage_path);
  if (error || !data) return `Gagal mengunduh "${f.title}": ${error?.message ?? "tidak diketahui"}`;
  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.length > maxBytes) return `Gambar "${f.title}" terlalu besar (${(buf.length / 1024 / 1024).toFixed(1)} MB, maks ${(maxBytes / 1024 / 1024).toFixed(1)} MB).`;
  const ext = (f.title.split(".").pop() ?? "").toLowerCase();
  const mime = (f.mime_type && f.mime_type.startsWith("image/") ? f.mime_type : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`).replace("image/jpg", "image/jpeg");
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime)) return `Format ${mime} belum didukung (pakai png/jpg/webp/gif).`;
  return { file: f, buf, mime };
}
