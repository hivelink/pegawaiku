import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { ChatPanel } from "./chat-panel";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getContext();
  const { data: conv } = await supabase
    .from("conversations")
    .select("id,title,agent:agents(slug,display_name,title,avatar_url)")
    .eq("id", id)
    .single();
  if (!conv) notFound();
  const agent = conv.agent as unknown as { slug: string; display_name: string; title: string; avatar_url: string };
  const { data: messages } = await supabase.from("messages").select("id,role,content,credit_cost").eq("conversation_id", id).order("created_at");

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <Link href={`/app/agent/${agent.slug}`}><Image src={agent.avatar_url} alt="" width={40} height={40} className="rounded-full" /></Link>
        <div>
          <div className="font-bold">{agent.display_name} <span className="font-normal text-muted">· {agent.title}</span></div>
          <div className="text-xs text-muted">{conv.title}</div>
        </div>
      </div>
      <ChatPanel conversationId={id} agentName={agent.display_name} initial={(messages ?? []).filter((m) => m.role !== "system") as { id: string; role: "user" | "assistant"; content: string }[]} />
    </div>
  );
}
