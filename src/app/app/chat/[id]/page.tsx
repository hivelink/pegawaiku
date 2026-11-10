import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { ChatPanel, type ChatAgent } from "./chat-panel";
import { Participants } from "./participants";

type Row = { id: string; role: "user" | "assistant"; content: string; agent_id?: string | null };

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getContext();
  // percakapan, pesan, dan peserta diambil bersamaan (sebelumnya berurutan)
  const [{ data: conv }, r1, partRes] = await Promise.all([
    supabase.from("conversations").select("id,title,project_id,agent_id,agent:agents!agent_id(id,slug,display_name,title,avatar_url)").eq("id", id).single(),
    supabase.from("messages").select("id,role,content,agent_id").eq("conversation_id", id).order("created_at"),
    supabase.from("conversation_agents").select("agent:agents(id,slug,display_name,title,avatar_url)").eq("conversation_id", id).order("added_at"),
  ]);
  if (!conv) notFound();
  const owner = conv.agent as unknown as ChatAgent | null;
  if (!owner) return <div className="rounded-2xl border border-border bg-card p-8 text-sm text-muted">Agent pemilik percakapan ini sudah tidak aktif.</div>;

  // pesan (dengan agent_id bila migrasi 0011 sudah jalan)
  let rows: Row[] = [];
  if (!r1.error) rows = (r1.data ?? []) as Row[];
  else rows = ((await supabase.from("messages").select("id,role,content").eq("conversation_id", id).order("created_at")).data ?? []) as Row[];

  const { data: hired } = await supabase.from("project_agents").select("agent:agents(id,slug,display_name,title,avatar_url)").eq("project_id", conv.project_id);
  const multiReady = !partRes.error;
  const participants: ChatAgent[] = [owner];
  for (const p of (partRes.data ?? []) as unknown as { agent: ChatAgent | null }[]) if (p.agent && !participants.some((x) => x.id === p.agent!.id)) participants.push(p.agent);
  const hiredList = ((hired ?? []) as unknown as { agent: ChatAgent | null }[]).map((h) => h.agent).filter(Boolean) as ChatAgent[];
  // agent yang pernah menjawab tapi sudah dikeluarkan tetap bisa ditampilkan nama/avatarnya di riwayat
  const answered = new Set(rows.map((m) => m.agent_id).filter(Boolean) as string[]);
  const missing = [...answered].filter((aid) => !participants.some((p) => p.id === aid) && !hiredList.some((h) => h.id === aid));
  const { data: extra } = missing.length ? await supabase.from("agents").select("id,slug,display_name,title,avatar_url").in("id", missing) : { data: [] };
  const mentionable = [...participants, ...hiredList.filter((h) => !participants.some((p) => p.id === h.id))];
  const display = [...mentionable, ...((extra ?? []) as ChatAgent[])];

  return (
    <div className="flex h-[calc(100dvh-10rem)] min-h-[20rem] flex-col md:h-[calc(100dvh-6.5rem)]">
      <Participants conversationId={id} title={conv.title ?? ""} owner={owner} participants={participants} candidates={hiredList.filter((h) => !participants.some((p) => p.id === h.id))} multiReady={multiReady} />
      <ChatPanel
        conversationId={id}
        projectId={conv.project_id}
        owner={owner}
        agents={mentionable}
        known={display}
        multiReady={multiReady}
        initial={rows.filter((m) => m.role !== ("system" as string)).map((m) => ({ id: m.id, role: m.role, content: m.content, agentId: m.role === "assistant" ? (m.agent_id ?? owner.id) : null }))}
      />
    </div>
  );
}
