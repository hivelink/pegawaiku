import Link from "next/link";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/logo";
import { getContext } from "@/lib/context";
import { formatCredit } from "@/lib/utils";
import { signOut } from "@/app/(auth)/actions";
import { switchOrg } from "./actions";
import { Button } from "@/components/ui/button";
import { SidebarNav } from "./sidebar-nav";
import { MOBILE_NAV } from "./nav-items";
import { Breadcrumb } from "./breadcrumb";


export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user, org, orgs, project, projects } = await getContext();
  // jumlah permintaan kemampuan menunggu (tabel bisa belum ada → 0)
  const { count: pendingCaps } = org ? await supabase.from("capability_requests").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "pending") : { count: 0 };

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-card p-4 md:flex">
        <Logo href="/app" />

        <SidebarNav projectName={project?.name ?? null} />

        <div className="mt-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Organisasi</div>
          {orgs.length > 1 ? (
            <form action={switchOrg}>
              <select name="org_id" defaultValue={org?.id} className="h-9 w-full rounded-lg border border-border bg-white px-2 text-sm" onChange={undefined}>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <Button type="submit" size="sm" variant="outline" className="mt-1 w-full">Ganti</Button>
            </form>
          ) : (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">{org?.name ?? "—"}</div>
          )}
        </div>

        <div className="mt-auto rounded-2xl border border-border bg-slate-50 p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Kredit</div>
          <div className="text-2xl font-extrabold text-primary">{formatCredit(org?.credit_balance ?? 0)}</div>
          <Link href="/app/billing" className="mt-2 block rounded-lg bg-accent py-2 text-center text-sm font-semibold text-white hover:bg-sky-600">Top up</Link>
          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <span className="truncate">{user.email}</span>
            <form action={signOut}><button className="flex items-center gap-1 hover:text-red-600" title="Keluar"><LogOut size={14} /></button></form>
          </div>
        </div>
      </aside>

      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3 md:hidden">
          <Logo href="/app" size={28} />
          <nav className="flex gap-3 overflow-x-auto whitespace-nowrap text-sm">
            {MOBILE_NAV.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
          </nav>
        </header>
        <Breadcrumb projectName={project?.name ?? null} email={user.email ?? ""} pendingCaps={pendingCaps ?? 0} />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
