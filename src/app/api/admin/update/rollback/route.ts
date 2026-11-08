import { adminRoute } from "../../_guard";
import { gh, headInfo } from "@/lib/platform";
import { logEvent } from "@/lib/log";

export const runtime = "nodejs";

/** Kembalikan kode ke versi commit tertentu dengan commit BARU (riwayat tidak dihapus). Database tidak ikut dikembalikan. */
export const POST = adminRoute("update.rollback", async (ctx, req) => {
  const { sha } = (await req.json()) as { sha?: string };
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error("sha tidak valid");
  const head = await headInfo(ctx);
  if (head.sha === sha) return { ok: true, unchanged: true };
  const target = await gh<{ tree: { sha: string }; message: string }>(ctx, `/repos/${head.repo}/git/commits/${sha}`);
  const commit = await gh<{ sha: string }>(ctx, `/repos/${head.repo}/git/commits`, { method: "POST", body: { message: `Kembalikan ke ${sha.slice(0, 7)}: ${target.message.split("\n")[0]}`, tree: target.tree.sha, parents: [head.sha] } });
  await gh(ctx, `/repos/${head.repo}/git/refs/heads/${encodeURIComponent(head.branch)}`, { method: "PATCH", body: { sha: commit.sha } });
  await logEvent("warn", "api:admin:update.rollback", `Kode dikembalikan ke ${sha.slice(0, 7)}`, { newCommit: commit.sha });
  return { ok: true, sha: commit.sha };
});
