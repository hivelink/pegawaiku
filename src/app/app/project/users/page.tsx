import { Users, Mail } from "lucide-react";
import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default async function ProjectUsersPage() {
  const { supabase, org, user } = await getContext();
  if (!org) return <Card className="p-8 text-sm text-muted">Organisasi tidak ditemukan.</Card>;
  const { data: members } = await supabase.from("org_members").select("role,user_id,created_at,profile:profiles(full_name,email)").eq("org_id", org.id);
  type M = { role: string; user_id: string; created_at: string; profile: { full_name: string | null; email: string | null } | null };
  const list = ((members ?? []) as unknown as M[]);
  const rows = list.length ? list : [{ role: "owner", user_id: user.id, created_at: "", profile: { full_name: null, email: user.email ?? null } }];

  return (
    <div className="space-y-5">
      <div><h1 className="flex items-center gap-2 text-2xl font-extrabold text-primary"><Users /> Anggota</h1><p className="text-sm text-muted">Pengguna di organisasi <b>{org.name}</b> yang bisa mengakses semua project.</p></div>
      <Card className="divide-y divide-border">
        {rows.map((m) => {
          const name = m.profile?.full_name || m.profile?.email || "Anggota";
          return (
            <div key={m.user_id} className="flex items-center gap-3 p-4">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-bold text-white">{name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1"><div className="truncate font-semibold">{name}</div><div className="truncate text-xs text-muted">{m.profile?.email}</div></div>
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold capitalize text-primary">{m.role}</span>
            </div>
          );
        })}
      </Card>
      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-bold"><Mail size={16} /> Undang anggota</h2>
        <p className="mt-1 text-xs text-muted">Undangan lewat email akan tersedia pada pembaruan berikutnya. Untuk sekarang, anggota baru bisa ditambahkan oleh admin lewat Supabase (tabel org_members).</p>
        <form className="mt-3 flex gap-2"><Input placeholder="email@contoh.com" disabled /><Button type="button" disabled>Kirim undangan</Button></form>
      </Card>
    </div>
  );
}
