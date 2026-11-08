import { adminRoute } from "../../_guard";
import { gh, headInfo, treeMap, readUpdateZip } from "@/lib/platform";
import { logEvent } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = adminRoute("update.apply", async (ctx, req) => {
  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) throw new Error("File zip tidak ada");
  const expected = String(fd.get("expected_head") ?? "");
  const message = String(fd.get("message") ?? "").trim() || `Pembaruan dari aplikasi: ${file.name}`;
  const { files } = await readUpdateZip(await file.arrayBuffer());
  const head = await headInfo(ctx);
  if (expected && expected !== head.sha) throw new Error("Repo berubah sejak pratinjau. Ulangi pratinjau dulu.");
  const tree = await treeMap(ctx, head.repo, head.treeSha);
  const changed = files.filter((f) => tree.get(f.path) !== f.sha);
  if (!changed.length) return { ok: true, unchanged: true, sha: head.sha };

  // unggah blob (paralel terbatas)
  const entries: { path: string; mode: string; type: string; sha: string }[] = [];
  const queue = [...changed];
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const f = queue.shift()!;
      const b = await gh<{ sha: string }>(ctx, `/repos/${head.repo}/git/blobs`, { method: "POST", body: { content: f.buf.toString("base64"), encoding: "base64" } });
      entries.push({ path: f.path, mode: /^scripts\/.+\.(sh|py)$/.test(f.path) ? "100755" : "100644", type: "blob", sha: b.sha });
    }
  }));
  const newTree = await gh<{ sha: string }>(ctx, `/repos/${head.repo}/git/trees`, { method: "POST", body: { base_tree: head.treeSha, tree: entries } });
  const author = ctx.user.email ? { name: ctx.user.email.split("@")[0], email: ctx.user.email, date: new Date().toISOString() } : undefined;
  const commit = await gh<{ sha: string; html_url: string }>(ctx, `/repos/${head.repo}/git/commits`, { method: "POST", body: { message, tree: newTree.sha, parents: [head.sha], ...(author ? { author } : {}) } });
  await gh(ctx, `/repos/${head.repo}/git/refs/heads/${encodeURIComponent(head.branch)}`, { method: "PATCH", body: { sha: commit.sha, force: false } });
  await logEvent("info", "api:admin:update.apply", `Pembaruan diterapkan: ${changed.length} file`, { commit: commit.sha, files: changed.map((f) => f.path).slice(0, 200) });
  return { ok: true, sha: commit.sha, url: commit.html_url, count: changed.length };
});
