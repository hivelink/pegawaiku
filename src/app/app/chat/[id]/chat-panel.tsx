"use client";

import { useEffect, useRef, useState } from "react";
import { SendHorizonal, Paperclip, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Markdown } from "@/components/markdown";

type Msg = { id: string; role: "user" | "assistant"; content: string };

export function ChatPanel({ conversationId, agentName, initial, projectId }: { conversationId: string; agentName: string; initial: Msg[]; projectId: string }) {
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastCost, setLastCost] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ name: string; pct: number; status: string } | null>(null);

  /** Lampirkan bahan: unggah ke Drive (langsung ke Storage, dengan progres) lalu sisipkan instruksi baca ke pesan. */
  async function attach(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUpload({ name: file.name, pct: 0, status: "Menyiapkan…" });
    try {
      const signRes = await fetch("/api/drive/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: projectId, filename: file.name, size: file.size }) });
      const sign = await signRes.json().catch(() => ({}));
      if (!signRes.ok) throw new Error(sign.error ?? "Gagal menyiapkan unggahan");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", sign.signedUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) setUpload({ name: file.name, pct: Math.round((ev.loaded / ev.total) * 100), status: "Mengunggah" }); };
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Storage menolak (HTTP ${xhr.status})`)));
        xhr.onerror = () => reject(new Error("Koneksi terputus"));
        xhr.send(file);
      });
      const done = await fetch("/api/drive/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: projectId, path: sign.path, title: file.name, mime: file.type, size: file.size }) });
      if (!done.ok) throw new Error((await done.json().catch(() => ({}))).error ?? "Gagal mencatat file");
      setUpload({ name: file.name, pct: 100, status: "Terunggah ✓" });
      setInput((v) => `${v ? v + "\n\n" : ""}Saya mengunggah bahan "${file.name}" ke Drive. Baca seluruh isinya (read_drive_file, lanjutkan semua part) sebelum mengerjakan.`);
      setTimeout(() => setUpload(null), 3000);
    } catch (err) {
      setUpload({ name: file.name, pct: 0, status: `Gagal: ${(err as Error).message}` });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

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
        {upload && (
          <div className="mb-2 rounded-xl border border-border bg-slate-50 p-2 text-xs">
            <div className="flex items-center justify-between"><span className="truncate font-medium">{upload.name}</span><span className={upload.status.startsWith("Gagal") ? "text-red-600" : "text-muted"}>{upload.status}{upload.status === "Mengunggah" ? ` ${upload.pct}%` : ""}</span></div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-gradient-to-r from-primary to-accent transition-all" style={{ width: `${upload.pct}%` }} /></div>
          </div>
        )}
        <div className="flex gap-2">
          <input ref={fileRef} type="file" className="hidden" onChange={attach} accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.html,.json,image/*" />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy || (!!upload && upload.status === "Mengunggah")} aria-label="Lampirkan bahan" title="Lampirkan bahan (PDF, PPT, Word, Excel)">
            {upload && upload.status === "Mengunggah" ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
          </Button>
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
