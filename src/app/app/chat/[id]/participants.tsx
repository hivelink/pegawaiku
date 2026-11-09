"use client";
import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { UserPlus, X, Loader2, Users } from "lucide-react";
import { shortName } from "@/lib/mentions";
import { addConversationAgent, removeConversationAgent } from "../../actions";
import type { ChatAgent } from "./chat-panel";

export function Participants({ conversationId, title, owner, participants, candidates, multiReady }: { conversationId: string; title: string; owner: ChatAgent; participants: ChatAgent[]; candidates: ChatAgent[]; multiReady: boolean }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  function act(fn: (fd: FormData) => Promise<void>, agentId: string) {
    const fd = new FormData(); fd.set("conversation_id", conversationId); fd.set("agent_id", agentId);
    setErr(""); setOpen(false);
    start(async () => { try { await fn(fd); } catch (e) { setErr((e as Error).message.replace(/^\w+ gagal: /, "")); } });
  }
  return (
    <div className="border-b border-border pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted"><Users size={14} /> {participants.length > 1 ? "Diskusi:" : "Agent:"}</div>
        {participants.map((a) => (
          <span key={a.id} className="group flex items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-0.5 pr-2 text-sm">
            <Link href={`/app/agent/${a.slug}`}><Image src={a.avatar_url} alt="" width={26} height={26} className="rounded-full" /></Link>
            <span className="font-semibold">{a.display_name}</span>
            <span className="hidden text-xs text-muted sm:inline">@{shortName(a.display_name)}</span>
            {a.id !== owner.id && multiReady && (
              <button type="button" onClick={() => act(removeConversationAgent, a.id)} className="rounded-full p-0.5 text-slate-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100" aria-label={`Keluarkan ${a.display_name}`} title="Keluarkan dari diskusi"><X size={12} /></button>
            )}
          </span>
        ))}
        {multiReady && (
          <div className="relative">
            <button type="button" onClick={() => setOpen(!open)} disabled={pending} className="flex items-center gap-1 rounded-full border border-dashed border-primary px-2.5 py-1 text-xs font-semibold text-primary hover:bg-sky-50">
              {pending ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Tambah agent
            </button>
            {open && (
              <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-64 overflow-auto rounded-xl border border-border bg-white py-1 shadow-lg">
                {candidates.length === 0 ? (
                  <div className="p-3 text-xs text-muted">Semua agent di project sudah ikut. Rekrut agent lain di menu <Link className="text-primary underline" href="/app/agent">Agent</Link>, atau langsung ketik @nama di chat.</div>
                ) : candidates.map((c) => (
                  <button key={c.id} type="button" onClick={() => act(addConversationAgent, c.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50">
                    <Image src={c.avatar_url} alt="" width={24} height={24} className="rounded-full" />
                    <span className="min-w-0 flex-1 truncate"><b>{c.display_name}</b> <span className="text-xs text-muted">{c.title}</span></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mt-1 truncate text-xs text-muted">{title}{multiReady ? " · ketik @nama untuk memanggil agent tertentu, mis. @" + shortName(participants[participants.length - 1]?.display_name ?? owner.display_name) : ""}</div>
      {err && <div className="mt-1 text-xs text-red-600">{err}</div>}
    </div>
  );
}
