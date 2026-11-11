"use client";
import { useMemo } from "react";

/** Renderer Markdown ringan tanpa dependensi: heading, bold, code, list, tabel, paragraf. */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => render(text), [text]);
  return <div className="prose-chat" onClick={onCopyCode} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Klik tombol "Salin" pada kotak kode → salin isi kode apa adanya (tanpa nama bahasa). */
async function onCopyCode(e: React.MouseEvent<HTMLDivElement>) {
  const btn = (e.target as HTMLElement).closest?.("[data-copy-code]") as HTMLButtonElement | null;
  if (!btn) return;
  const code = btn.closest(".code-box")?.querySelector("pre")?.textContent ?? "";
  let ok = false;
  try { await navigator.clipboard.writeText(code); ok = true; } catch {
    try { const ta = document.createElement("textarea"); ta.value = code; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); ok = document.execCommand("copy"); ta.remove(); } catch { ok = false; }
  }
  btn.textContent = ok ? "Tersalin ✓" : "Gagal";
  setTimeout(() => { btn.textContent = "Salin"; }, 1600);
}

function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function inline(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s"']+)\)/g, '<a class="underline" target="_blank" rel="noopener" href="$2">$1</a>');
}

function render(md: string) {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith("```")) {
      const lang = l.slice(3).trim().replace(/[^\w+#.-]/g, "").slice(0, 20);
      const buf: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      // kotak kode dengan tombol Salin (ditangani lewat klik terdelegasi di komponen Markdown)
      out.push(`<div class="code-box"><div class="code-bar"><span>${esc(lang || "kode")}</span><button type="button" data-copy-code>Salin</button></div><pre><code>${esc(buf.join("\n"))}</code></pre></div>`); continue;
    }
    if (/^\|.*\|\s*$/.test(l)) {
      const rows: string[] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      // baris pemisah = hanya berisi | : - dan spasi (bukan sel data yang kebetulan diawali "-")
      const cells = rows.filter((r) => !/^[\s|:-]+$/.test(r) || !/-/.test(r)).map((r) => r.trim().slice(1, -1).split("|").map((c) => c.trim()));
      if (!cells.length) { out.push(`<p>${rows.map(inline).join("<br/>")}</p>`); continue; }
      const [head, ...body] = cells;
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { const n = Math.min(h[1].length + 1, 4); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*[-*]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      out.push(`<ul class="list-disc pl-5">${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`); continue;
    }
    if (/^\s*\d+\.\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\.\s+/, ""));
      out.push(`<ol class="list-decimal pl-5">${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`); continue;
    }
    if (l.trim() === "") { i++; continue; }
    // baris pertama selalu dikonsumsi — mencegah loop tak berujung pada baris seperti "| a | b" (tabel terpotong saat streaming)
    const para: string[] = [lines[i++]];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,4}\s|```|\||\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join("\n")).replace(/\n/g, "<br/>")}</p>`);
  }
  return out.join("");
}
