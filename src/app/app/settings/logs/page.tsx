import { ScrollText, Trash2 } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { clearLogs } from "../../actions";

const COLOR: Record<string, string> = { error: "bg-red-100 text-red-700", warn: "bg-amber-100 text-amber-800", info: "bg-sky-100 text-sky-800" };

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const sp = await searchParams;
  const { supabase, org, user } = await getContext();
  let q = supabase.from("app_logs").select("id,level,source,message,detail,created_at,user_id").order("created_at", { ascending: false }).limit(200);
  if (org) q = q.or(`org_id.eq.${org.id},and(org_id.is.null,user_id.eq.${user.id})`);
  if (sp.level) q = q.eq("level", sp.level);
  const { data: logs } = await q;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="flex items-center gap-2 text-2xl font-extrabold text-primary"><ScrollText /> Log Aplikasi</h1><p className="text-sm text-muted">Error dan kejadian penting dari aksi, API, dan sisi klien. Berguna untuk menelusuri kenapa sesuatu gagal.</p></div>
        <div className="flex items-center gap-2 text-sm">
          {["", "error", "warn", "info"].map((l) => <a key={l} href={`/app/settings/logs${l ? `?level=${l}` : ""}`} className={`rounded-lg border px-3 py-1 ${(sp.level ?? "") === l ? "border-primary bg-sky-50 text-primary" : "border-border"}`}>{l || "semua"}</a>)}
          {org?.owner_id === user.id && (logs ?? []).length > 0 && (
            <form action={clearLogs}><button className="flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-red-600 hover:bg-red-50"><Trash2 size={14} /> Bersihkan</button></form>
          )}
        </div>
      </div>
      {(logs ?? []).length === 0 ? <Card className="p-8 text-center text-sm text-muted">Belum ada log. Bagus — berarti tidak ada error yang tercatat.</Card> : (
        <Card className="divide-y divide-border">
          {(logs ?? []).map((l) => (
            <details key={l.id} className="p-3 text-sm">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className={`rounded-md px-1.5 text-[10px] font-bold uppercase ${COLOR[l.level] ?? ""}`}>{l.level}</span>
                <span className="font-mono text-xs text-muted">{l.source}</span>
                <span className="min-w-0 flex-1 truncate">{l.message}</span>
                <span className="text-xs text-muted">{new Date(l.created_at).toLocaleString("id-ID")}</span>
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">{l.message}{l.detail ? "\n\n" + JSON.stringify(l.detail, null, 2) : ""}</pre>
            </details>
          ))}
        </Card>
      )}
    </div>
  );
}
