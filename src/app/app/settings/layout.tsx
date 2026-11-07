import Link from "next/link";
const TABS = [["/app/settings/model", "Model AI"], ["/app/settings/api-keys", "Kunci API"], ["/app/settings/logs", "Log"]];
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <nav className="flex gap-1 rounded-xl border border-border bg-card p-1 text-sm">
        {TABS.map(([href, label]) => <Link key={href} href={href} className="rounded-lg px-3 py-1.5 font-semibold hover:bg-slate-100">{label}</Link>)}
      </nav>
      {children}
    </div>
  );
}
