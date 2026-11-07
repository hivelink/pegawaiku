"use client";

import { useEffect, useRef, useState } from "react";
import { SendHorizonal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Markdown } from "@/components/markdown";

type Msg = { id: string; role: "user" | "assistant"; content: string };

export function ChatPanel({ conversationId, agentName, initial }: { conversationId: string; agentName: string; initial: Msg[] }) {
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastCost, setLastCost] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content }, { id: "pending", role: "assistant", content: "" }]);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, content }) });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Gagal" }));
        setMessages((m) => m.map((x) => (x.id === "pending" ? { ...x, id: crypto.randomUUID(), content: `⚠️ ${err.error}` } : x)));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        const [text, meta] = acc.split("\u0000");
        if (meta) { try { const j = JSON.parse(meta); setLastCost(j.cost.toFixed(4)); } catch { /* belum lengkap */ } }
        setMessages((m) => m.map((x) => (x.id === "pending" ? { ...x, content: text.replace(/\n$/, "") } : x)));
      }
      setMessages((m) => m.map((x) => (x.id === "pending" ? { ...x, id: crypto.randomUUID() } : x)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages.length === 0 && (
          <div className="rounded-2xl bg-sky-50 p-5 text-sm text-primary">
            Beri brief ke <b>{agentName}</b>. Semakin lengkap konteksnya (produk, audiens, tujuan), semakin baik hasilnya.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${m.role === "user" ? "bg-primary text-white" : "bg-card border border-border"}`}>
              {m.role === "user" ? <p className="whitespace-pre-wrap">{m.content}</p> : m.content ? <Markdown text={m.content} /> : <span className="animate-pulse text-muted">{agentName} sedang mengetik…</span>}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-border pt-3">
        {lastCost && <div className="mb-1 text-right text-xs text-muted">Biaya pesan terakhir: {lastCost} kredit</div>}
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={2}
            placeholder="Tulis brief atau pertanyaan… (Enter untuk kirim, Shift+Enter baris baru)"
          />
          <Button onClick={send} disabled={busy || !input.trim()} aria-label="Kirim"><SendHorizonal size={18} /></Button>
        </div>
      </div>
    </>
  );
}
