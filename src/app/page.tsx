import Link from "next/link";
import Image from "next/image";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { CATEGORIES } from "@/lib/utils";
import agentsJson from "../../skills/agents.json";

const agents = (agentsJson as { agents: { name: string; display_name: string; title: string; category: string; description: string }[] }).agents;

export default function Landing() {
  return (
    <main>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/login" className={buttonVariants({ variant: "ghost" })}>Masuk</Link>
          <Link href="/register" className={buttonVariants({ variant: "default" })}>Mulai gratis</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 text-center">
        <span className="inline-block rounded-full bg-sky-50 px-4 py-1 text-sm font-semibold text-primary">28 pegawai AI siap direkrut</span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold tracking-tight text-primary md:text-6xl">
          Bangun tim AI untuk bisnis Anda, hari ini.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">
          Rekrut spesialis marketing, desain, video, HR, finance, dan builder. Beri brief, terima hasil, semua dari satu workspace.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/register" className={buttonVariants({ size: "lg" })}>Mulai gratis — 2 kredit</Link>
          <Link href="#agents" className={buttonVariants({ variant: "outline", size: "lg" })}>Lihat pegawai</Link>
        </div>
      </section>

      <section id="agents" className="mx-auto max-w-6xl px-4 pb-20">
        <h2 className="text-2xl font-bold text-primary">Temukan pegawai AI</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <span key={c.key} className="rounded-full border border-border bg-card px-3 py-1 text-sm">{c.emoji} {c.label}</span>
          ))}
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {agents.map((a) => (
            <div key={a.name} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <Image src={`/agents/${a.name}.svg`} alt={a.display_name} width={44} height={44} className="rounded-full" />
                <div>
                  <div className="font-bold">{a.display_name}</div>
                  <div className="text-xs text-muted">{a.title}</div>
                </div>
              </div>
              <p className="mt-3 line-clamp-3 text-sm text-slate-600">{a.description.split(". Trigger")[0]}.</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted">
        © {new Date().getFullYear()} PegawaiKu
      </footer>
    </main>
  );
}
