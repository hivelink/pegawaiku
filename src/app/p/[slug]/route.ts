export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Halaman landing publik: /p/<slug> → HTML dari bucket brand (publik). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  // landing_pages bisa dibaca publik (RLS select true) — pakai anon fetch REST agar tidak butuh service role
  const r = await fetch(`${url}/rest/v1/landing_pages?slug=eq.${encodeURIComponent(slug)}&select=storage_path`, { headers: { apikey: anon, authorization: `Bearer ${anon}` }, cache: "no-store" });
  const rows = (await r.json().catch(() => [])) as { storage_path: string }[];
  if (!rows?.[0]) return new Response("<h1>Halaman tidak ditemukan</h1>", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  const file = await fetch(`${url}/storage/v1/object/public/brand/${rows[0].storage_path}`, { cache: "no-store" });
  if (!file.ok) return new Response("<h1>File landing tidak ditemukan</h1>", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  const html = await file.text();
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
}
