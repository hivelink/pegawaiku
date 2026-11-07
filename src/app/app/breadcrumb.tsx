"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Bell, Settings } from "lucide-react";

const LABEL: Record<string, string> = {
  app: "home", project: "project", agent: "agent", tasks: "task", drive: "drive", billing: "billing", chat: "chat",
  settings: "setting", agents: "agent", ai: "ai", tools: "tool", "api-keys": "kunci api", model: "model ai", logs: "log", landing: "landing", users: "anggota",
};

export function Breadcrumb({ projectName, email, agentName }: { projectName: string | null; email: string; agentName?: string }) {
  const path = usePathname();
  const segs = path.split("/").filter(Boolean); // ["app","project","settings"]
  const crumbs: { label: string; href: string }[] = [{ label: "home", href: "/app" }];

  if (segs[1] === "project") {
    crumbs.push({ label: "project", href: "/app/project" });
    if (projectName) crumbs.push({ label: projectName, href: "/app/project" });
    if (segs[2]) crumbs.push({ label: LABEL[segs[2]] ?? segs[2], href: path });
  } else if (segs[1] === "agent") {
    crumbs.push({ label: "agent", href: "/app/agent" });
    if (segs[2]) crumbs.push({ label: agentName ?? segs[2].split("-")[0], href: path });
  } else if (segs[1] === "chat") {
    if (projectName) crumbs.push({ label: projectName, href: "/app/project" });
    crumbs.push({ label: "chat", href: path });
  } else if (segs[1] === "settings") {
    crumbs.push({ label: "setting", href: "/app/settings/model" });
    if (segs[2]) crumbs.push({ label: LABEL[segs[2]] ?? segs[2], href: path });
  } else if (segs[1]) {
    if (projectName && ["tasks", "drive"].includes(segs[1])) crumbs.push({ label: projectName, href: "/app/project" });
    crumbs.push({ label: LABEL[segs[1]] ?? segs[1], href: path });
  }

  const initial = (email || "?").slice(0, 1).toUpperCase();
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/90 px-4 py-2.5 backdrop-blur md:px-6">
      <nav className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight size={14} className="shrink-0 text-slate-400" />}
              {last ? <span className="truncate font-semibold text-foreground">{c.label}</span>
                    : <Link href={c.href} className="truncate text-muted hover:text-primary">{c.label}</Link>}
            </span>
          );
        })}
      </nav>
      <div className="flex items-center gap-2">
        <Link href="/app/settings/model" aria-label="Pengaturan" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Settings size={18} /></Link>
        <button type="button" aria-label="Notifikasi" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Bell size={18} /></button>
        <span title={email} className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-bold text-white">{initial}</span>
      </div>
    </div>
  );
}
