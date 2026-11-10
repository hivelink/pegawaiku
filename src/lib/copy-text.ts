import { splitChoices } from "./choices";

/** Buang catatan sistem dari jawaban agent (catatan tool, pindah model, jeda otomatis, kartu pilihan). */
export function cleanAnswer(content: string): string {
  const text = splitChoices(content).filter((p) => p.kind === "text").map((p) => (p.kind === "text" ? p.text : "")).join("\n");
  const lines = text.split("\n").filter((l) => {
    const t = l.trim();
    if (/^>\s*_.*_$/.test(t)) return false;                 // > _Mencari di web…_
    if (/^_(🔁|⏸|⏹|\().*_$/u.test(t)) return false;          // catatan otomatis
    if (/^\[Gagal: .*\]$/.test(t)) return false;
    return true;
  });
  return lines.join("\n").replace(/\n-{3,}\n(?=\s*(\n|$))/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Ubah Markdown menjadi teks polos yang enak ditempel ke Word, WhatsApp, email, dsb. */
export function toPlainText(md: string): string {
  let inCode = false;
  const out: string[] = [];
  for (const raw of md.split("\n")) {
    if (/^\s*```/.test(raw)) { inCode = !inCode; continue; }
    if (inCode) { out.push(raw); continue; }
    let l = raw;
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-") && l.includes("|")) continue; // garis pemisah tabel
    if (/^\s*\|.*\|\s*$/.test(l)) l = l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()).join("\t");
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { out.push(""); continue; }
    l = l.replace(/^(\s*)#{1,6}\s+/, "$1").replace(/^(\s*)>\s?/, "$1").replace(/^(\s*)[*+]\s+/, "$1- ");
    l = l.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, "$1 ($2)");
    l = l.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1$2").replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, "$1$2").replace(/`([^`]+)`/g, "$1");
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
