/** Kartu pilihan keputusan (ask_user) yang disisipkan ke teks pesan agent sebagai satu baris penanda. */
export type ChoiceOption = { label: string; desc?: string };
export type Choice = { id: string; q: string; options: ChoiceOption[]; other?: boolean };

const MARK = ":::pilihan ";
export function encodeChoice(c: Choice): string {
  return `\n\n${MARK}${JSON.stringify(c)}\n\n`;
}

export type Part = { kind: "text"; text: string } | { kind: "choice"; choice: Choice };
/** Pecah teks pesan menjadi bagian teks biasa dan kartu pilihan. */
export function splitChoices(text: string): Part[] {
  const out: Part[] = [];
  let buf: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith(MARK)) {
      try {
        const c = JSON.parse(line.slice(MARK.length)) as Choice;
        if (c && Array.isArray(c.options)) {
          if (buf.length) out.push({ kind: "text", text: buf.join("\n") });
          buf = [];
          out.push({ kind: "choice", choice: c });
          continue;
        }
      } catch { /* baris belum lengkap saat streaming — tampilkan sebagai teks */ }
    }
    buf.push(line);
  }
  if (buf.length) out.push({ kind: "text", text: buf.join("\n") });
  return out;
}

export const DECISION_PREFIX = "✅ Keputusan:";
export function decisionText(q: string, label: string) {
  return `${DECISION_PREFIX} ${label}\n(untuk: ${q})`;
}
