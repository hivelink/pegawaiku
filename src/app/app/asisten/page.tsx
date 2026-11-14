import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import type { MemoryItem } from "@/lib/autopilot/types";
import { AsistenView, type ApprovalRow, type EventRow, type MissionRow, type RunRow, type WorkerRow } from "./view";

export default async function AsistenPage() {
  const { supabase, org, project, user } = await getContext();
  if (!org) return <Card className="p-8 text-sm text-muted">Organisasi tidak ditemukan.</Card>;

  const [mR, aR, rR, memR, wR, meR, hiredR, keyR] = await Promise.all([
    supabase.from("auto_missions").select("*,agent:agents(display_name)").eq("org_id", org.id).in("status", ["proposed", "active", "paused", "done"]).order("created_at", { ascending: false }).limit(60),
    supabase.from("auto_approvals").select("*,mission:auto_missions(title)").eq("org_id", org.id).eq("status", "pending").order("created_at").limit(30),
    supabase.from("auto_runs").select("id,mission_id,status,trigger,steps,summary,error,credit_cost,created_at,finished_at,mission:auto_missions(title,conversation_id)").eq("org_id", org.id).order("created_at", { ascending: false }).limit(15),
    supabase.from("auto_memory").select("id,kind,content,evidence,source,is_active,created_at").eq("org_id", org.id).eq("is_active", true).order("created_at", { ascending: false }).limit(100),
    supabase.from("auto_workers").select("name,last_seen_at,info").order("last_seen_at", { ascending: false }).limit(5),
    supabase.from("org_members").select("role").eq("org_id", org.id).eq("user_id", user.id).maybeSingle(),
    project ? supabase.from("project_agents").select("agent:agents(id,display_name,title)").eq("project_id", project.id) : Promise.resolve({ data: [] }),
    supabase.from("org_api_keys").select("provider").eq("org_id", org.id),
  ]);

  if (mR.error) {
    return (
      <Card className="space-y-2 p-6 text-sm">
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-primary"><Sparkles /> Asisten Otonom</h1>
        <p>Fitur ini belum terpasang di database. Jalankan migrasi <code>0015_autopilot.sql</code> sekali lewat <Link href="/app/settings/update" className="font-semibold text-primary underline">Pengaturan → Pembaruan</Link> (atau tempel isinya di Supabase → SQL Editor).</p>
        <p className="text-xs text-muted">{mR.error.message}</p>
      </Card>
    );
  }

  const isAdmin = !!meR.data && ["owner", "admin"].includes(meR.data.role);
  const missions = (mR.data ?? []) as unknown as MissionRow[];
  const approvals = (aR.data ?? []) as unknown as ApprovalRow[];
  const runs = (rR.data ?? []) as unknown as RunRow[];
  const memory = (memR.data ?? []) as MemoryItem[];
  const agents = ((hiredR.data ?? []) as unknown as { agent: { id: string; display_name: string; title: string } | null }[]).map((r) => r.agent).filter((a): a is NonNullable<typeof a> => !!a).map((a) => ({ id: a.id, name: a.display_name, title: a.title }));
  const { data: evData } = runs.length ? await supabase.from("auto_run_events").select("id,run_id,kind,label,created_at").in("run_id", runs.slice(0, 8).map((r) => r.id)).order("id").limit(400) : { data: [] };

  return (
    <AsistenView
      orgId={org.id} hasProject={!!project} isAdmin={isAdmin}
      missions={missions} approvals={approvals} runs={runs} events={(evData ?? []) as EventRow[]} memory={memory}
      agents={agents} keys={(keyR.data ?? []).map((k) => k.provider as string)} worker={(wR.data ?? [])[0] as WorkerRow | undefined}
    />
  );
}
