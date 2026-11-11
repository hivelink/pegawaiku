"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, HardDrive, KanbanSquare, CreditCard, FolderOpen, Folder, Settings, Bot, MessagesSquare, ChevronDown, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { switchProject } from "./actions";

const TOP = [
  { href: "/app", label: "Home", icon: Home, exact: true },
  { href: "/app/asisten", label: "Asisten", icon: Sparkles },
  { href: "/app/projects", label: "Project", icon: Folder },
  { href: "/app/agent", label: "Agent", icon: Users },
  { href: "/app/drive", label: "Drive", icon: HardDrive, exact: true },
  { href: "/app/billing", label: "Billing", icon: CreditCard },
  { href: "/app/settings/model", label: "Pengaturan", icon: Settings, match: "/app/settings" },
];

type P = { id: string; name: string };

/**
 * Navigasi sidebar: menu utama + semua project di bawah menu Project.
 * Project yang dipilih terbuka (ikon folder terbuka) dan menampilkan Chat, Agent, Task, Drive.
 */
export function SidebarNav({ projects, activeId, pendingApprovals = 0 }: { projects: P[]; activeId: string | null; pendingApprovals?: number }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false); // project aktif boleh dilipat
  const [switching, setSwitching] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isOn = (href: string, exact?: boolean, match?: string) => (exact ? path === href : path.startsWith(match ?? href));
  const item = (on: boolean) => `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${on ? "bg-sky-50 text-primary" : "hover:bg-slate-100"}`;
  const sub = (on: boolean) => `flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${on ? "bg-sky-50 font-semibold text-primary" : "text-slate-600 hover:bg-slate-100"}`;
  const row = "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm";

  function pick(id: string) {
    if (pending) return;
    setSwitching(id);
    setCollapsed(false);
    const fd = new FormData();
    fd.set("project_id", id);
    start(async () => { await switchProject(fd); });
  }
  const busyId = pending ? switching : null;

  return (
    <nav className="mt-6 space-y-1">
      {TOP.map(({ href, label, icon: Icon, exact, match }) => (
        <div key={href}>
          <Link href={href} className={item(isOn(href, exact, match))}>
            <Icon size={18} className="text-primary" /> {label}
            {href === "/app/asisten" && pendingApprovals > 0 && <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white" title={`${pendingApprovals} keputusan menunggu Anda`}>{pendingApprovals}</span>}
          </Link>
          {href === "/app/projects" && projects.length > 0 && (
            <div className="ml-5 mt-1 max-h-[45vh] space-y-0.5 overflow-y-auto border-l border-border pl-2">
              {projects.map((p) => {
                const active = p.id === activeId;
                const open = active && !collapsed && !busyId;
                if (!active) {
                  return (
                    <button key={p.id} type="button" onClick={() => pick(p.id)} disabled={pending} title={p.name}
                      className={`${row} text-slate-600 hover:bg-slate-100 disabled:opacity-60`}>
                      <ChevronRight size={13} className="shrink-0 text-slate-400" />
                      {busyId === p.id ? <Loader2 size={15} className="shrink-0 animate-spin text-accent" /> : <Folder size={15} className="shrink-0 text-slate-400" />}
                      <span className="truncate">{p.name}</span>
                    </button>
                  );
                }
                return (
                  <div key={p.id}>
                    <div className={`${row} ${path === "/app/project" || /^\/app\/project\/(settings|ai|tools|landing|users)/.test(path) ? "bg-sky-50 font-semibold text-primary" : "font-semibold text-slate-700 hover:bg-slate-100"}`}>
                      <button type="button" onClick={() => setCollapsed((c) => !c)} aria-expanded={open} aria-label={open ? "Tutup project" : "Buka project"} className="shrink-0 rounded p-0.5 hover:bg-slate-200">
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      <Link href="/app/project" className="flex min-w-0 flex-1 items-center gap-2" title={p.name}>
                        {open ? <FolderOpen size={15} className="shrink-0 text-accent" /> : <Folder size={15} className="shrink-0 text-accent" />}
                        <span className="truncate">{p.name}</span>
                      </Link>
                    </div>
                    {open && (
                      <div className="ml-6 space-y-0.5">
                        <Link href="/app/project/chat" className={sub(path.startsWith("/app/project/chat") || path.startsWith("/app/chat"))}><MessagesSquare size={14} /> Chat</Link>
                        <Link href="/app/project/agents" className={sub(path.startsWith("/app/project/agents"))}><Bot size={14} /> Agent</Link>
                        <Link href="/app/tasks" className={sub(path.startsWith("/app/tasks"))}><KanbanSquare size={14} /> Task</Link>
                        <Link href="/app/project/drive" className={sub(path.startsWith("/app/project/drive"))}><HardDrive size={14} /> Drive</Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
