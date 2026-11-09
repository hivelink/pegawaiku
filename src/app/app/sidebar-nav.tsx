"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, HardDrive, KanbanSquare, CreditCard, FolderOpen, Folder, Settings, Bot } from "lucide-react";

const TOP = [
  { href: "/app", label: "Home", icon: Home, exact: true },
  { href: "/app/projects", label: "Project", icon: Folder },
  { href: "/app/agent", label: "Agent", icon: Users },
  { href: "/app/drive", label: "Drive", icon: HardDrive, exact: true },
  { href: "/app/billing", label: "Billing", icon: CreditCard },
  { href: "/app/settings/model", label: "Pengaturan", icon: Settings, match: "/app/settings" },
];

/** Navigasi sidebar: menu utama + pohon project aktif (Agent, Task, Drive) tepat di bawah menu Project. */
export function SidebarNav({ projectName }: { projectName: string | null }) {
  const path = usePathname();
  const isOn = (href: string, exact?: boolean, match?: string) => (exact ? path === href : path.startsWith(match ?? href));
  const item = (on: boolean) => `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${on ? "bg-sky-50 text-primary" : "hover:bg-slate-100"}`;
  const sub = (on: boolean) => `flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${on ? "bg-sky-50 font-semibold text-primary" : "text-slate-600 hover:bg-slate-100"}`;
  return (
    <nav className="mt-6 space-y-1">
      {TOP.map(({ href, label, icon: Icon, exact, match }) => (
        <div key={href}>
          <Link href={href} className={item(isOn(href, exact, match))}><Icon size={18} className="text-primary" /> {label}</Link>
          {href === "/app/projects" && projectName && (
            <div className="ml-5 mt-1 space-y-0.5 border-l border-border pl-2">
              <Link href="/app/project" className={sub(path === "/app/project" || /^\/app\/project\/(settings|ai|tools|landing|users)/.test(path) || path.startsWith("/app/chat"))} title={projectName}>
                <FolderOpen size={15} className="shrink-0 text-accent" /><span className="truncate">{projectName}</span>
              </Link>
              <div className="ml-4 space-y-0.5">
                <Link href="/app/project/agents" className={sub(path.startsWith("/app/project/agents"))}><Bot size={14} /> Agent</Link>
                <Link href="/app/tasks" className={sub(path.startsWith("/app/tasks"))}><KanbanSquare size={14} /> Task</Link>
                <Link href="/app/project/drive" className={sub(path.startsWith("/app/project/drive"))}><HardDrive size={14} /> Drive</Link>
              </div>
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

export const MOBILE_NAV = TOP.map(({ href, label }) => ({ href, label }));
