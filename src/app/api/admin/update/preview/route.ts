import { adminRoute } from "../../_guard";
import { headInfo, treeMap, readUpdateZip } from "@/lib/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = adminRoute("update.preview", async (ctx, req) => {
  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) throw new Error("File zip tidak ada");
  if (file.size > 4_000_000) throw new Error("Zip terlalu besar (maks 4 MB). Kirim hanya file yang berubah.");
  const { files, skipped } = await readUpdateZip(await file.arrayBuffer());
  if (!files.length) throw new Error("Zip kosong atau tidak berisi file yang valid.");
  const head = await headInfo(ctx);
  const tree = await treeMap(ctx, head.repo, head.treeSha);
  const list = files.map((f) => ({ path: f.path, size: f.buf.length, status: !tree.has(f.path) ? "new" : tree.get(f.path) === f.sha ? "same" : "changed" }));
  list.sort((a, b) => (a.status === b.status ? a.path.localeCompare(b.path) : a.status === "same" ? 1 : b.status === "same" ? -1 : a.status.localeCompare(b.status)));
  const migrations = list.filter((f) => f.status !== "same" && /^supabase\/migrations\/.+\.sql$/.test(f.path)).map((f) => f.path.split("/").pop());
  return { head: { sha: head.sha, message: head.message, date: head.date, repo: head.repo, branch: head.branch }, files: list, skipped, migrations };
});
