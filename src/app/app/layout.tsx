import Link from "next/link";
import { Home, Users, HardDrive, KanbanSquare, CreditCard, LogOut, Plus } from "lucide-react";
import { Logo } from "@/components/logo";
import { getContext } from "@/lib/context";
import { formatCredit } from "@/lib/utils";
import { signOut } from "@/app/(auth)/actions";
import { switchProject, createProject, switchOrg } from "./actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/app", label: "Home", icon: Home },
  { href: "/app/agent", label: "Agent", icon: Users },
  { href: "/app/tasks", label: "Task", icon: KanbanSquare },
  { href: "/app/drive", label: "Drive", icon: HardDrive },
  { href: "/app/billing", label: "Billing", icon: CreditCard },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, org, orgs, project, projects } = await getContext();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-card p-4 md:flex">
        <Logo href="/app" />

        <nav className="mt-6 space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium hover:bg-slate-100">
              <Icon size={18} className="text-primary" /> {label}
            </Link>
          ))}
        </nav>

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

        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Project</div>
          <div className="space-y-1">
            {projects.map((p) => (
              <form key={p.id} action={switchProject}>
                <input type="hidden" name="project_id" value={p.id} />
                <button className={`w-full rounded-lg px-3 py-1.5 text-left text-sm ${p.id === project?.id ? "bg-sky-50 font-semibold text-primary" : "hover:bg-slate-100"}`}>
                  {p.name}
                </button>
              </form>
            ))}
            {projects.length === 0 && <div className="px-3 text-sm text-muted">Belum ada project.</div>}
          </div>
          <form action={createProject} className="mt-2 flex gap-1">
            <Input name="name" placeholder="Project baru" className="h-8 text-xs" required />
            <Button type="submit" size="sm" variant="outline" aria-label="Tambah project"><Plus size={14} /></Button>
          </form>
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
          <nav className="flex gap-3 text-sm">
            {NAV.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
