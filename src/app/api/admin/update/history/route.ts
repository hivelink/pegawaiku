import { adminRoute } from "../../_guard";
import { gh, repoOf } from "@/lib/platform";

export const runtime = "nodejs";

export const GET = adminRoute("update.history", async (ctx) => {
  const { repo, branch } = repoOf(ctx);
  const list = await gh<{ sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } } }[]>(ctx, `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=15`);
  return { repo, branch, commits: list.map((c) => ({ sha: c.sha, url: c.html_url, message: c.commit.message.split("\n")[0], author: c.commit.author?.name, date: c.commit.author?.date })) };
});
