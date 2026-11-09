/** Utilitas @mention agent di chat (dipakai server & klien). */

export type MentionAgent = { id: string; slug: string; display_name: string; handle?: string | null; avatar_url?: string | null; title?: string | null };

const TITLES = new Set(["ustadz", "ustad", "ustadzah", "pak", "bu", "ibu", "bapak", "dr", "kak", "mas", "mbak"]);

function words(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter(Boolean);
}

/** Nama panggilan untuk @mention: kata pertama nama, melewati gelar (mis. "Ustadz Hasan" → "hasan"). */
export function shortName(displayName: string): string {
  const w = words(displayName);
  if (w.length > 1 && TITLES.has(w[0])) return w[1];
  return w[0] ?? "";
}

/** Semua alias yang diterima untuk satu agent: nama panggilan, tiap kata nama, awal slug, handle. */
function aliases(a: MentionAgent): string[] {
  const set = new Set<string>([shortName(a.display_name), ...words(a.display_name), a.slug.toLowerCase(), a.slug.split("-")[0].toLowerCase()]);
  if (a.handle) { set.add(a.handle.toLowerCase()); set.add(a.handle.split("-")[0].toLowerCase()); }
  set.delete("");
  return [...set];
}

/** Cari agent dari teks @token. Cocok persis didahulukan, lalu awalan yang unik. */
export function findAgent(token: string, agents: MentionAgent[]): MentionAgent | null {
  const t = token.toLowerCase();
  if (!t) return null;
  const exact = agents.filter((a) => aliases(a).includes(t));
  if (exact.length) return exact[0];
  const prefix = agents.filter((a) => aliases(a).some((x) => x.startsWith(t)));
  return prefix.length === 1 ? prefix[0] : null;
}

/** Ambil agent yang di-mention berurutan (unik), maksimal `max`. */
export function parseMentions(text: string, agents: MentionAgent[], max = 3): MentionAgent[] {
  const out: MentionAgent[] = [];
  const re = /(^|[\s(,.;:!?])@([a-zA-Z][\w-]{0,40})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = findAgent(m[2], agents);
    if (a && !out.some((x) => x.id === a.id)) out.push(a);
    if (out.length >= max) break;
  }
  return out;
}
