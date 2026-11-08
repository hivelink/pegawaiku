import { adminRoute } from "../../_guard";
import { gh, repoOf } from "@/lib/platform";

export const runtime = "nodejs";

type St = { state: string; statuses: { context: string; state: string; description: string; target_url: string }[] };
type Runs = { check_runs: { name: string; status: string; conclusion: string | null; html_url: string }[] };

export const GET = adminRoute("update.status", async (ctx, req) => {
  const sha = new URL(req.url).searchParams.get("sha");
  if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) throw new Error("sha tidak valid");
  const { repo } = repoOf(ctx);
  const [st, runs] = await Promise.all([
    gh<St>(ctx, `/repos/${repo}/commits/${sha}/status`).catch(() => null),
    gh<Runs>(ctx, `/repos/${repo}/commits/${sha}/check-runs`).catch(() => null),
  ]);
  const items = [
    ...(st?.statuses ?? []).map((s) => ({ name: s.context, state: s.state, description: s.description, url: s.target_url })),
    ...(runs?.check_runs ?? []).map((c) => ({ name: c.name, state: c.status !== "completed" ? "pending" : c.conclusion === "success" ? "success" : c.conclusion ?? "failure", description: c.status, url: c.html_url })),
  ];
  const overall = !items.length ? "unknown" : items.some((i) => ["failure", "error", "cancelled", "timed_out"].includes(i.state)) ? "failure" : items.some((i) => i.state === "pending") ? "pending" : "success";
  return { overall, items };
});
