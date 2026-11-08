/**
 * Parser stream chat: teks biasa = jawaban; "\u0001{json}\n" = event status; "\u0000{json}" = ringkasan akhir.
 * Aman terhadap frame yang terpotong di antara chunk jaringan.
 */
export type StreamState = { text: string; buf: string };
export function feed(state: StreamState, chunk: string, onStatus: (s: Record<string, unknown>) => void, onSummary: (s: Record<string, unknown>) => void) {
  state.buf += chunk;
  for (;;) {
    const a = state.buf.indexOf("\u0001");
    const z = state.buf.indexOf("\u0000");
    if (z !== -1 && (a === -1 || z < a)) {
      state.text += state.buf.slice(0, z);
      state.buf = state.buf.slice(z);
      try { onSummary(JSON.parse(state.buf.slice(1))); } catch { /* belum lengkap */ }
      return;
    }
    if (a === -1) { state.text += state.buf; state.buf = ""; return; }
    const nl = state.buf.indexOf("\n", a);
    state.text += state.buf.slice(0, a);
    if (nl === -1) { state.buf = state.buf.slice(a); return; }
    try { onStatus(JSON.parse(state.buf.slice(a + 1, nl))); } catch { /* abaikan frame rusak */ }
    state.buf = state.buf.slice(nl + 1);
  }
}
