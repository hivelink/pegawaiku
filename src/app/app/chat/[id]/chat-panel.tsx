"use client";

import { useEffect, useRef, useState } from "react";
import { SendHorizonal, Paperclip, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Markdown } from "@/components/markdown";
import { feed, type StreamState } from "@/lib/stream-parse";

type Msg = { id: string; role: "user" | "assistant"; content: string };

export function ChatPanel({ conversationId, agentName, initial, projectId }: { conversationId: string; agentName: string; initial: Msg[]; projectId: string }) {
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastCost, setLastCost] = useState<string | null>(null);
  type Status = { type: string; step?: number; max?: number; label?: string; elapsed?: number; reason?: string };
  const [status, setStatus] = useState<Status | null>(null);
  const [activity, setActivity] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const startRef = useRef<number>(0);
  useEffect(() => { if (!busy) return; const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, [busy]);
  function stop() { abortRef.current?.abort(); setStatus((s) => ({ ...(s ?? { type: "stop" }), label: "Menghentikan…" })); }
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
    setActivity([]);
    setStatus({ type: "thinking", step: 1, label: "Mengirim…" });
    startRef.current = Date.now();
    const ac = new AbortController();
    abortRef.current = ac;
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content }, { id: "pending", role: "assistant", content: "" }]);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, content }), signal: ac.signal });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `Gagal (HTTP ${res.status})` }));
        setMessages((m) => m.map((x) => (x.id === "pending" ? { ...x, id: crypto.randomUUID(), content: `⚠️ ${err.error}` } : x)));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      const st: StreamState = { text: "", buf: "" };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        feed(st, dec.decode(value, { stream: true }),
          (ev) => { setStatus(ev as Status); if (ev.type === "tool" && ev.label) setActivity((a) => [...a.slice(-5), String(ev.label)]); },
          (sum) => setLastCost(Number(sum.cost ?? 0).toFixed(4)));
        const shown = st.text.replace(/\n+$/, "");
        setMessages((m) => m.map((x) => (x.id === "pending" ? { ...x, content: shown } : x)));
      }
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      setMessages((m) => m.map((x) => (x.id === "pending" ? { ...x, content: (x.content || "") + (aborted ? "\n\n_⏹ Dihentikan oleh pengguna._" : `\n\n⚠️ Koneksi terputus: ${(e as Error).message}`) } : x)));
    } finally {
      setMessages((m) => m.map((x) => (x.id === "pending" ? { ...x, id: crypto.randomUUID() } : x)));
      setBusy(false);
      setStatus(null);
      abortRef.current = null;
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
        {busy && (
          <div className="mb-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs">
            <div className="flex items-center gap-2">
              <Loader2 size={14} className="shrink-0 animate-spin text-primary" />
              <span className="min-w-0 flex-1 truncate font-semibold text-primary">{status?.label ?? `${agentName} sedang bekerja…`}</span>
              <span className="shrink-0 tabular-nums text-muted" data-tick={tick}>
                {status?.step ? `Langkah ${status.step}/${status.max ?? "?"} · ` : ""}{Math.floor((Date.now() - startRef.current) / 1000)} dtk
              </span>
              <button onClick={stop} className="flex shrink-0 items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1 font-semibold text-white hover:bg-red-700" title="Hentikan agent">
                <Square size={11} fill="currentColor" /> Stop
              </button>
            </div>
            {status?.step && status?.max ? (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-sky-100"><div className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all" style={{ width: `${Math.min(100, (status.step / status.max) * 100)}%` }} /></div>
            ) : null}
            {activity.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-slate-600">
                {activity.map((a, i) => <li key={i} className={i === activity.length - 1 ? "font-medium text-slate-800" : "opacity-70"}>{i === activity.length - 1 ? "▸ " : "✓ "}{a}</li>)}
              </ul>
            )}
            {Math.floor((Date.now() - startRef.current) / 1000) > 90 && <div className="mt-2 text-[11px] text-amber-700">Tugas ini cukup lama. Jika agent tampak berputar-putar, tekan <b>Stop</b> — hasil yang sudah ada tetap tersimpan.</div>}
          </div>
        )}
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
