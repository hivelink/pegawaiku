import { adminRoute } from "../_guard";
import { migrationStatus, fetchRepoFile, runSql } from "@/lib/platform";
import { logEvent } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 120;

export const GET = adminRoute("migrations.list", async (ctx, req) => {
  const name = new URL(req.url).searchParams.get("sql");
  if (name) {
    if (!/^[\w.-]+\.sql$/.test(name)) throw new Error("nama tidak valid");
    return { name, sql: await fetchRepoFile(ctx, `supabase/migrations/${name}`) };
  }
  const s = await migrationStatus(ctx);
  return { tableMissing: s.tableMissing, canRun: !!ctx.secrets.supabase_access_token, migrations: s.names.map((n) => ({ name: n, applied: s.applied.has(n) })) };
});

export const POST = adminRoute("migrations.run", async (ctx, req) => {
  const { name } = (await req.json()) as { name?: string };
  if (!name || !/^[\w.-]+\.sql$/.test(name)) throw new Error("nama tidak valid");
  const s = await migrationStatus(ctx);
  if (!s.names.includes(name)) throw new Error("Migrasi tidak ada di repo");
  if (s.applied.has(name)) return { ok: true, already: true };
  const sql = await fetchRepoFile(ctx, `supabase/migrations/${name}`);
  await runSql(ctx, sql);
  // catat (tabel schema_migrations dibuat oleh 0009)
  const esc = name.replace(/'/g, "''");
  await runSql(ctx, `insert into public.schema_migrations (name, applied_by) values ('${esc}', '${ctx.user.id}') on conflict do nothing;`).catch(() => {});
  await logEvent("info", "api:admin:migrations.run", `Migrasi dijalankan: ${name}`, {});
  return { ok: true };
});
