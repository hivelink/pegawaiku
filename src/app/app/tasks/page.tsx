import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createTask, moveTask } from "../actions";
import { SubmitOnce, DeleteTask, DedupeAll } from "./task-controls";

const COLS = [["todo", "Antre"], ["in_progress", "Berjalan"], ["review", "Review"], ["done", "Selesai"], ["blocked", "Terhambat"]] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ dup?: string; agent?: string }> }) {
  const sp = await searchParams;
  const { supabase, project } = await getContext();
  if (!project) return <p className="text-muted">Buat project dulu di menu <a className="text-primary underline" href="/app/projects">Project</a>.</p>;
  const [{ data: tasks }, { data: hired }] = await Promise.all([
    supabase.from("tasks").select("id,title,status,created_at,agent:agents(display_name)").eq("project_id", project.id).order("created_at"),
    supabase.from("project_agents").select("agent:agents(id,display_name)").eq("project_id", project.id),
  ]);
  type T = { id: string; title: string; status: string; created_at: string; agent: { display_name: string } | null };
  const list = (tasks ?? []) as unknown as T[];
  const agents = ((hired ?? []) as unknown as { agent: { id: string; display_name: string } }[]).map((h) => h.agent).filter(Boolean);
  // tandai tugas ganda (judul sama, abaikan huruf besar/spasi); yang pertama dibuat = asli
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const firstOf = new Map<string, string>();
  for (const t of list) if (!firstOf.has(norm(t.title))) firstOf.set(norm(t.title), t.id);
  const isDup = (t: T) => firstOf.get(norm(t.title)) !== t.id;
  const dupCount = list.filter(isDup).length;

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-primary">Task · {project.name}</h1>
      <form action={createTask} className="mt-4 flex flex-wrap gap-2">
        <Input name="title" placeholder="Task baru…" className="max-w-md" required defaultValue={sp.dup ?? ""} key={sp.dup ?? "new"} />
        <select name="agent_id" defaultValue={sp.agent ?? ""} className="h-10 rounded-xl border border-border bg-white px-3 text-sm">
          <option value="">Tanpa agent</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
        </select>
        {sp.dup && <input type="hidden" name="force" value="1" />}
        <SubmitOnce>{sp.dup ? "Tetap tambahkan" : "Tambah"}</SubmitOnce>
        {sp.dup && <a href="/app/tasks" className="self-center text-sm text-muted underline">Batal</a>}
      </form>
      {sp.dup && <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Tugas <b>&ldquo;{sp.dup}&rdquo;</b> sudah ada dan belum selesai. Tidak ditambahkan agar tidak dobel. Klik <b>Tetap tambahkan</b> bila memang perlu tugas kedua dengan judul sama.</div>}
      {dupCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span>Ada <b>{dupCount}</b> tugas ganda (judul sama), ditandai <span className="rounded bg-amber-200 px-1 text-[11px] font-bold">GANDA</span>.</span>
          <DedupeAll count={dupCount} />
        </div>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-5">
        {COLS.map(([key, label]) => (
          <Card key={key} className="p-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{label}</div>
            <div className="space-y-2">
              {list.filter((t) => t.status === key).map((t) => (
                <div key={t.id} className={`rounded-xl p-3 text-sm ${isDup(t) ? "bg-amber-50 ring-1 ring-amber-300" : "bg-slate-50"}`}>
                  <div className="flex items-start gap-1">
                    <div className="min-w-0 flex-1 font-medium">{t.title} {isDup(t) && <span className="ml-1 rounded bg-amber-200 px-1 text-[10px] font-bold text-amber-900">GANDA</span>}</div>
                    <DeleteTask id={t.id} />
                  </div>
                  {t.agent && <div className="text-xs text-muted">{t.agent.display_name}</div>}
                  <form action={moveTask} className="mt-2">
                    <input type="hidden" name="id" value={t.id} />
                    <select name="status" defaultValue={t.status} className="h-7 w-full rounded-lg border border-border bg-white px-1 text-xs">
                      {COLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    <button className="mt-1 text-xs font-semibold text-primary">Pindah</button>
                  </form>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
