import Link from "next/link";
import { Network } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import type { NetCommand, NetDevice, NetPort, NetStatus } from "@/lib/network/types";
import { JaringanView } from "./view";

const fresh = (iso: string | undefined) => !!iso && Date.now() - new Date(iso).getTime() < 90_000;

export default async function JaringanPage() {
  const { supabase, org, user } = await getContext();
  if (!org) return <Card className="p-8 text-sm text-muted">Organisasi tidak ditemukan.</Card>;
  const [dR, sR, cR, wR, meR, kR] = await Promise.all([
    supabase.from("net_devices").select("*").eq("org_id", org.id).order("sort").order("created_at"),
    supabase.from("net_status").select("*").eq("org_id", org.id),
    supabase.from("net_commands").select("id,org_id,device_id,kind,payload,label,status,result,created_at,finished_at").eq("org_id", org.id).order("created_at", { ascending: false }).limit(8),
    supabase.from("auto_workers").select("last_seen_at").order("last_seen_at", { ascending: false }).limit(1),
    supabase.from("org_members").select("role").eq("org_id", org.id).eq("user_id", user.id).maybeSingle(),
    supabase.from("org_api_keys").select("provider").eq("org_id", org.id).eq("provider", "mikrotik"),
  ]);
  if (dR.error) {
    return (
      <Card className="space-y-2 p-6 text-sm">
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-primary"><Network /> Jaringan</h1>
        <p>Tab ini belum terpasang di database. Jalankan migrasi <code>0015_autopilot.sql</code> lalu <code>0016_network.sql</code> lewat <Link href="/app/settings/update" className="font-semibold text-primary underline">Pengaturan → Pembaruan</Link>.</p>
        <p className="text-xs text-muted">{dR.error.message}</p>
      </Card>
    );
  }
  const devices = (dR.data ?? []) as NetDevice[];
  const { data: ports } = devices.length ? await supabase.from("net_ports").select("*").in("device_id", devices.map((d) => d.id)).order("sort") : { data: [] };
  return (
    <JaringanView
      isAdmin={!!meR.data && ["owner", "admin"].includes(meR.data.role)}
      workerOnline={fresh((wR.data ?? [])[0]?.last_seen_at as string | undefined)}
      hasRouterKey={(kR.data ?? []).length > 0}
      devices={devices} ports={(ports ?? []) as NetPort[]} status={(sR.data ?? []) as NetStatus[]} commands={(cR.data ?? []) as NetCommand[]}
    />
  );
}
