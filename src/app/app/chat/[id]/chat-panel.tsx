"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SendHorizonal, Paperclip, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Markdown } from "@/components/markdown";
import { feed, type StreamState } from "@/lib/stream-parse";
import { shortName } from "@/lib/mentions";
import { splitChoices, decisionText, DECISION_PREFIX } from "@/lib/choices";
import { ChoiceCard } from "./choice-card";
import { createClient } from "@/lib/supabase/client";

export type ChatAgent = { id: string; slug: string; display_name: string; title: string; avatar_url: string };
type Msg = { id: string; role: "user" | "assistant"; content: string; agentId?: string | null };

export function ChatPanel({ conversationId, owner, agents, known, multiReady, initial, projectId }: { conversationId: string; owner: ChatAgent; agents: ChatAgent[]; known?: ChatAgent[]; multiReady: boolean; initial: Msg[]; projectId: string }) {
  const router = useRouter();
  const agentName = owner.display_name;
  const byId = (id?: string | null) => (known ?? agents).find((a) => a.id === id) ?? owner;
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [extraAgents, setExtraAgents] = useState<ChatAgent[]>([]); // agent yang baru bergabung saat streaming
  const agentOf = (id?: string | null) => extraAgents.find((a) => a.id === id) ?? byId(id);
  const showNames = multiReady && (agents.length > 1 || messages.some((m) => m.agentId && m.agentId !== owner.id));
  // autocomplete @mention
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ q: string; start: number } | null>(null);
  const [mi, setMi] = useState(0);
  const suggestions = mention ? agents.filter((a) => {
    const q = mention.q.toLowerCase();
    return shortName(a.display_name).startsWith(q) || a.display_name.toLowerCase().includes(q) || a.slug.startsWith(q);
  }).slice(0, 6) : [];
  function onInput(v: string, caret: number) {
    setInput(v);
    if (!multiReady) return;
    const before = v.slice(0, caret);
    const m = /(^|[\s(])@([\w-]{0,30})$/.exec(before);
    if (m) { setMention({ q: m[2], start: caret - m[2].length - 1 }); setMi(0); } else setMention(null);
  }
  function pick(a: ChatAgent) {
    if (!mention) return;
    const name = shortName(a.display_name);
    const caret = taRef.current?.selectionStart ?? input.length;
    const next = input.slice(0, mention.start) + "@" + name + " " + input.slice(caret);
    setInput(next); setMention(null);
    requestAnimationFrame(() => { const pos = mention.start + name.length + 2; taRef.current?.focus(); taRef.current?.setSelectionRange(pos, pos); });
  }
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
  // ---- Lanjut otomatis saat waktu/langkah habis (maks 3x berturut-turut) ----
  const AUTO_MAX = 3;
  const autoCountRef = useRef(0);       // jumlah lanjut otomatis berturut-turut
  const stoppedRef = useRef(false);     // user menekan Stop → jangan lanjut otomatis
  const [autoNext, setAutoNext] = useState<{ n: number; secs: number } | null>(null);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  function cancelAuto() { if (autoTimer.current) clearInterval(autoTimer.current); autoTimer.current = null; setAutoNext(null); }
  function scheduleAuto(n: number) {
    cancelAuto();
    let secs = 5;
    setAutoNext({ n, secs });
    autoTimer.current = setInterval(() => {
      secs -= 1;
      if (secs <= 0) {
        cancelAuto();
        send(`▶️ Lanjutkan (otomatis ${n}/${AUTO_MAX}) — teruskan pekerjaan dari titik terakhir, jangan ulangi yang sudah selesai.`, true);
      } else setAutoNext({ n, secs });
    }, 1000);
  }
  useEffect(() => () => { if (autoTimer.current) clearInterval(autoTimer.current); }, []);
  function stop() { stoppedRef.current = true; cancelAuto(); abortRef.current?.abort(); setStatus((s) => ({ ...(s ?? { type: "stop" }), label: "Menghentikan…" })); }
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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: busy ? "auto" : "smooth", block: "end" }); }, [messages, busy]);

  // ---- Sinkron antar-perangkat: realtime Supabase + polling cadangan ----
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  const knownIds = useRef(new Set(agents.map((a) => a.id)));
  const [remoteWorking, setRemoteWorking] = useState(false);
  useEffect(() => {
    const sb = createClient();
    let stopped = false;
    let syncing = false;
    async function resync() {
      if (stopped || syncing || busyRef.current) return; // saat perangkat ini sedang streaming, jangan timpa
      syncing = true;
      try {
        let rows: { id: string; role: string; content: string; agent_id?: string | null; created_at: string }[] | null = null;
        const r1 = await sb.from("messages").select("id,role,content,agent_id,created_at").eq("conversation_id", conversationId).order("created_at");
        if (!r1.error) rows = r1.data;
        else rows = ((await sb.from("messages").select("id,role,content,created_at").eq("conversation_id", conversationId).order("created_at")).data ?? null) as typeof rows;
        if (!rows || stopped || busyRef.current) return;
        const next: Msg[] = rows.filter((m) => m.role !== "system").map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content, agentId: m.role === "assistant" ? (m.agent_id ?? owner.id) : null }));
        setMessages((cur) => {
          const same = cur.length === next.length && cur.every((x, i) => x.id === next[i].id && x.content === next[i].content);
          return same ? cur : next;
        });
        // pesan terakhir dari user & belum ada balasan → agent mungkin sedang bekerja di perangkat lain
        const last = rows[rows.length - 1];
        setRemoteWorking(!!last && last.role === "user" && Date.now() - new Date(last.created_at).getTime() < 5 * 60_000);
        // agent baru muncul (mis. hasil delegasi/mention dari perangkat lain) → segarkan header peserta
        const fresh = rows.some((m) => m.agent_id && !knownIds.current.has(m.agent_id));
        if (fresh) { rows.forEach((m) => m.agent_id && knownIds.current.add(m.agent_id)); router.refresh(); }
      } finally { syncing = false; }
    }
    const ch = sb.channel(`chat-${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, () => { resync(); })
      .subscribe();
    const poll = setInterval(() => { if (document.visibilityState === "visible") resync(); }, 8000);
    const onFocus = () => resync();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { stopped = true; clearInterval(poll); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); sb.removeChannel(ch); };
  }, [conversationId, owner.id, router]);

  async function send(override?: string, auto = false) {
    const content = (override ?? input).trim();
    if (!content || busy) return;
    cancelAuto();
    if (!auto) autoCountRef.current = 0; // pesan dari user mengatur ulang hitungan
    stoppedRef.current = false;
    let endReason = "";
    if (override === undefined) setInput("");
    setBusy(true);
    setActivity([]);
    setStatus({ type: "thinking", step: 1, label: "Mengirim…" });
    startRef.current = Date.now();
    const ac = new AbortController();
    abortRef.current = ac;
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content }, { id: "pending", role: "assistant", content: "", agentId: owner.id }]);
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
      let offset = 0;      // awal teks milik agent yang sedang menjawab
      let started = false; // sudah menerima frame "agent" pertama
      let lastPaint = 0;
      const paint = (force = false) => {
        const now = Date.now();
        if (!force && now - lastPaint < 60) return; // batasi render saat streaming
        lastPaint = now;
        const shown = st.text.slice(offset).replace(/\n+$/, "");
        setMessages((m) => m.map((x) => (x.id === "pending" ? { ...x, content: shown } : x)));
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        feed(st, dec.decode(value, { stream: true }),
          (ev) => {
            if (ev.type === "agent") {
              const ag = ev.agent as { id: string; name: string; avatar: string; slug: string };
              if (!agents.some((a) => a.id === ag.id)) setExtraAgents((xs) => xs.some((x) => x.id === ag.id) ? xs : [...xs, { id: ag.id, slug: ag.slug, display_name: ag.name, title: "", avatar_url: ag.avatar }]);
              if (started) {
                // tutup gelembung agent sebelumnya, buka gelembung baru
                const prevText = st.text.slice(offset).replace(/\n+$/, "");
                offset = st.text.length;
                setMessages((m) => [...m.map((x) => (x.id === "pending" ? { ...x, id: crypto.randomUUID(), content: prevText } : x)), { id: "pending", role: "assistant", content: "", agentId: ag.id }]);
              } else {
                offset = st.text.length;
                setMessages((m) => m.map((x) => (x.id === "pending" ? { ...x, agentId: ag.id } : x)));
              }
              started = true;
              setActivity([]);
              return;
            }
            setStatus(ev as Status); if (ev.type === "tool" && ev.label) setActivity((a) => [...a.slice(-5), String(ev.label)]);
          },
          (sum) => { setLastCost(Number(sum.cost ?? 0).toFixed(4)); endReason = String(sum.reason ?? ""); });
        paint();
      }
      paint(true);
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      setMessages((m) => m.map((x) => (x.id === "pending" ? { ...x, content: (x.content || "") + (aborted ? "\n\n_⏹ Dihentikan oleh pengguna._" : `\n\n⚠️ Koneksi terputus: ${(e as Error).message}`) } : x)));
    } finally {
      setMessages((m) => m.map((x) => (x.id === "pending" ? { ...x, id: crypto.randomUUID() } : x)));
      setBusy(false);
      setStatus(null);
      abortRef.current = null;
      if (multiReady) router.refresh(); // perbarui daftar peserta di header (agent yang baru di-mention)
      setTimeout(() => window.dispatchEvent(new Event("focus")), 300); // sinkronkan ID pesan dengan database
      // waktu/langkah habis → lanjut otomatis (bisa dibatalkan), kecuali user menekan Stop
      if ((endReason === "batas_waktu" || endReason === "batas_langkah") && !stoppedRef.current && autoCountRef.current < AUTO_MAX) {
        autoCountRef.current += 1;
        scheduleAuto(autoCountRef.current);
      }
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
        {messages.map((m, idx) => {
          const ag = m.role === "assistant" ? agentOf(m.agentId) : null;
          return (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[85%]">
                {ag && showNames && (
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ag.avatar_url} alt="" width={20} height={20} className="rounded-full" />
                    {ag.display_name}
                  </div>
                )}
                <div className={`rounded-2xl px-4 py-3 text-sm ${m.role === "user" ? "bg-primary text-white" : "bg-card border border-border"}`}>
                  {m.role === "user" ? <p className="whitespace-pre-wrap">{m.content}</p> : m.content ? splitChoices(m.content).map((part, pi) => {
                    if (part.kind === "text") return part.text.trim() ? <Markdown key={pi} text={part.text} /> : null;
                    // sudah dijawab bila ada pesan user setelah pesan ini
                    const next = messages.slice(idx + 1).find((x) => x.role === "user");
                    const chosen = next?.content.startsWith(DECISION_PREFIX) ? next.content.slice(DECISION_PREFIX.length).split("\n")[0].trim() : null;
                    return (
                      <ChoiceCard key={part.choice.id + pi} choice={part.choice} answered={!!next} chosen={chosen} disabled={busy}
                        onPick={(label) => send(decisionText(part.choice.q, label))}
                        onOther={() => { setInput(`Untuk "${part.choice.q}": `); taRef.current?.focus(); }} />
                    );
                  }) : <span className="animate-pulse text-muted">{ag?.display_name ?? agentName} sedang mengetik…</span>}
                </div>
              </div>
            </div>
          );
        })}
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
        {autoNext && !busy && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 p-2 text-xs text-primary">
            <Loader2 size={13} className="animate-spin" />
            <span className="flex-1">Waktu kerja habis — melanjutkan otomatis dalam <b>{autoNext.secs}</b> detik ({autoNext.n}/{AUTO_MAX}).</span>
            <button type="button" onClick={() => { cancelAuto(); send(`▶️ Lanjutkan (otomatis ${autoNext.n}/${AUTO_MAX}) — teruskan pekerjaan dari titik terakhir, jangan ulangi yang sudah selesai.`, true); }} className="rounded-lg bg-primary px-2.5 py-1 font-semibold text-white">Lanjut sekarang</button>
            <button type="button" onClick={cancelAuto} className="rounded-lg border border-border bg-white px-2.5 py-1 font-semibold text-slate-700">Batalkan</button>
          </div>
        )}
        {!busy && remoteWorking && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            <Loader2 size={13} className="animate-spin" /> Agent sedang mengerjakan pesan dari perangkat lain — jawabannya akan muncul otomatis di sini.
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
          <div className="relative flex-1">
            {mention && suggestions.length > 0 && (
              <div className="absolute bottom-full left-0 z-20 mb-1 w-72 overflow-hidden rounded-xl border border-border bg-white py-1 shadow-lg">
                <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Panggil agent</div>
                {suggestions.map((a, i) => (
                  <button key={a.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(a); }} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === mi ? "bg-sky-50" : "hover:bg-slate-50"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.avatar_url} alt="" width={22} height={22} className="rounded-full" />
                    <b>{a.display_name}</b><span className="text-xs text-muted">@{shortName(a.display_name)}</span>
                  </button>
                ))}
              </div>
            )}
            <Textarea
              ref={taRef}
              value={input}
              onChange={(e) => onInput(e.target.value, e.target.selectionStart ?? e.target.value.length)}
              onBlur={() => { setTimeout(() => setMention(null), 150); }}
              onKeyDown={(e) => {
                if (mention && suggestions.length) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setMi((i) => (i + 1) % suggestions.length); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setMi((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
                  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(suggestions[mi]); return; }
                  if (e.key === "Escape") { setMention(null); return; }
                }
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              rows={2}
              placeholder={multiReady ? "Tulis brief… ketik @ untuk memanggil agent lain (Enter kirim, Shift+Enter baris baru)" : "Tulis brief atau pertanyaan… (Enter untuk kirim, Shift+Enter baris baru)"}
            />
          </div>
          <Button onClick={() => send()} disabled={busy || !input.trim()} aria-label="Kirim"><SendHorizonal size={18} /></Button>
        </div>
      </div>
    </>
  );
}
