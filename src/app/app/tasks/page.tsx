import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createTask, moveTask } from "../actions";

const COLS = [["todo", "Antre"], ["in_progress", "Berjalan"], ["review", "Review"], ["done", "Selesai"], ["blocked", "Terhambat"]] as const;

export default async function TasksPage() {
  const { supabase, project } = await getContext();
  if (!project) return <p className="text-muted">Buat project dulu di menu <a className="text-primary underline" href="/app/projects">Project</a>.</p>;
  const [{ data: tasks }, { data: hired }] = await Promise.all([
    supabase.from("tasks").select("id,title,status,agent:agents(display_name)").eq("project_id", project.id).order("created_at"),
    supabase.from("project_agents").select("agent:agents(id,display_name)").eq("project_id", project.id),
  ]);
  type T = { id: string; title: string; status: string; agent: { display_name: string } | null };
  const list = (tasks ?? []) as unknown as T[];
  const agents = ((hired ?? []) as unknown as { agent: { id: string; display_name: string } }[]).map((h) => h.agent);

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-primary">Task · {project.name}</h1>
      <form action={createTask} className="mt-4 flex flex-wrap gap-2">
        <Input name="title" placeholder="Task baru…" className="max-w-md" required />
        <select name="agent_id" className="h-10 rounded-xl border border-border bg-white px-3 text-sm">
          <option value="">Tanpa agent</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
        </select>
        <Button type="submit">Tambah</Button>
      </form>
      <div className="mt-6 grid gap-4 md:grid-cols-5">
        {COLS.map(([key, label]) => (
          <Card key={key} className="p-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{label}</div>
            <div className="space-y-2">
              {list.filter((t) => t.status === key).map((t) => (
                <div key={t.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="font-medium">{t.title}</div>
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
