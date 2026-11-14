import type { ToolDef } from "./llm";
import type { ToolCtx } from "./agent-tools";
import { putToDrive, loadDriveImage } from "./drive-util";

/**
 * Tool kreatif yang menghasilkan file siap pakai:
 * - make_presentation: dek PowerPoint (.pptx) dari kerangka slide.
 * - image_edit: mengedit gambar di Drive dengan instruksi teks (Gemini; butuh kunci google).
 */

export const CREATIVE_TOOL_DEFS: Record<string, ToolDef> = {
  make_presentation: {
    name: "make_presentation",
    description: "Buat file presentasi PowerPoint (.pptx, 16:9) dan simpan ke Drive project. Kamu menyusun isinya per slide; tool yang menata desainnya. Satu gagasan per slide, judul berupa kesimpulan (bukan label), maksimal 5 butir pendek per slide. Layout: 'bullets' (default), 'two_column' (perbandingan), 'stats' (2–4 angka besar), 'quote', 'image' (gambar dari Drive + butir), 'section' (pembatas bab).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Judul presentasi (slide pembuka)" },
        subtitle: { type: "string", description: "Subjudul / penyaji / tanggal" },
        filename: { type: "string", description: "Nama file, mis. proposal-jaringan.pptx" },
        theme: { type: "object", description: "Warna hex tanpa #; kosong = warna brand project", properties: { primary: { type: "string" }, accent: { type: "string" } } },
        slides: {
          type: "array", minItems: 1, maxItems: 40,
          items: {
            type: "object",
            properties: {
              layout: { type: "string", enum: ["bullets", "two_column", "stats", "quote", "image", "section"] },
              title: { type: "string" },
              bullets: { type: "array", items: { type: "string" }, description: "Butir isi (bullets, image)" },
              left_title: { type: "string" }, left: { type: "array", items: { type: "string" } },
              right_title: { type: "string" }, right: { type: "array", items: { type: "string" } },
              stats: { type: "array", items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" } }, required: ["value", "label"] } },
              quote: { type: "string" }, by: { type: "string" },
              image: { type: "string", description: "Nama file gambar di Drive (layout image)" },
              notes: { type: "string", description: "Catatan pembicara" },
            },
            required: ["title"],
          },
        },
      },
      required: ["title", "slides"],
    },
  },
  image_edit: {
    name: "image_edit",
    description: "Edit gambar yang ada di Drive project memakai instruksi teks (Gemini Nano Banana; butuh kunci google): ganti latar, hapus/tambah objek, ubah warna, gabungkan hingga 3 gambar, ubah gaya, tambahkan teks. Hasil disimpan sebagai file BARU di Drive (gambar asli tidak diubah). Instruksi bahasa Inggris yang spesifik; sebutkan apa yang harus tetap sama.",
    input_schema: {
      type: "object",
      properties: {
        source: { description: "Nama file gambar di Drive, atau daftar hingga 3 nama (gambar pertama = yang diedit)", anyOf: [{ type: "string" }, { type: "array", items: { type: "string" }, maxItems: 3 }] },
        instruction: { type: "string", description: "Perubahan yang diminta, mis. 'Replace the background with a clean white studio backdrop, keep the product and its shadow unchanged'" },
        filename: { type: "string", description: "Nama file hasil (opsional)" },
      },
      required: ["source", "instruction"],
    },
  },
};

export async function runCreativeTool(name: string, input: Record<string, unknown>, ctx: ToolCtx): Promise<string | null> {
  switch (name) {
    case "make_presentation": return makePresentation(input, ctx);
    case "image_edit": return imageEdit(input, ctx);
    default: return null;
  }
}

// ---------------- Presentasi ----------------

export type SlideSpec = {
  layout?: string; title?: string; bullets?: unknown; left_title?: string; left?: unknown; right_title?: string; right?: unknown;
  stats?: unknown; quote?: string; by?: string; image?: string; notes?: string;
};
export type DeckSpec = { title: string; subtitle?: string; theme?: { primary?: string; accent?: string }; slides: SlideSpec[] };
export type DeckImage = { data: string; w: number; h: number };

const hex = (v: unknown, fallback: string) => { const s = String(v ?? "").replace(/^#/, "").trim(); return /^[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : fallback; };
const list = (v: unknown, max: number, len = 220) => (Array.isArray(v) ? v : []).map((x) => String(x ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, max).map((x) => (x.length > len ? x.slice(0, len - 1) + "…" : x));

/** Ukuran gambar dari header PNG/JPEG/GIF/WebP (untuk menjaga rasio di slide). */
export function imageSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG") return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 10 && buf.toString("ascii", 0, 3) === "GIF") return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const fmt = buf.toString("ascii", 12, 16);
    if (fmt === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (fmt === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (fmt === "VP8L") { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** Susun dek .pptx dari kerangka. `images` = gambar yang sudah diunduh, dikunci nama file-nya. */
export async function buildDeck(spec: DeckSpec, images: Record<string, DeckImage> = {}): Promise<Buffer> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 inci
  pptx.title = spec.title;
  const W = 13.33, H = 7.5, MX = 0.7;
  const primary = hex(spec.theme?.primary, "1E3A8A"), accent = hex(spec.theme?.accent, "0EA5E9");
  const INK = "0F172A", BODY = "334155", MUTED = "64748B", SOFT = "F1F5F9";
  const FONT = "Calibri";
  const bulletRuns = (items: string[], size: number) => items.map((t) => ({ text: t, options: { bullet: { indent: 18 }, breakLine: true, fontSize: size, color: BODY, paraSpaceAfter: 12 } }));
  const bodySize = (items: string[]) => { const chars = items.join("").length; return items.length > 5 || chars > 520 ? 22 : items.length > 3 || chars > 300 ? 25 : 28; };

  // pembuka
  const cover = pptx.addSlide();
  cover.background = { color: primary };
  cover.addShape("rect", { x: MX, y: 2.55, w: 1.1, h: 0.09, fill: { color: accent }, line: { color: accent, width: 0 } });
  cover.addText(spec.title, { x: MX, y: 2.75, w: W - 2 * MX, h: 1.7, fontFace: FONT, fontSize: spec.title.length > 60 ? 40 : 48, bold: true, color: "FFFFFF", valign: "top" });
  if (spec.subtitle) cover.addText(spec.subtitle, { x: MX, y: 4.55, w: W - 2 * MX, h: 0.8, fontFace: FONT, fontSize: 24, color: "DBEAFE", valign: "top" });

  spec.slides.forEach((s, idx) => {
    const slide = pptx.addSlide();
    const layout = s.layout ?? (s.stats ? "stats" : s.quote ? "quote" : s.image ? "image" : s.left || s.right ? "two_column" : "bullets");
    const title = String(s.title ?? "").trim();
    if (s.notes) slide.addNotes(String(s.notes));

    if (layout === "section") {
      slide.background = { color: SOFT };
      slide.addShape("rect", { x: 0, y: 0, w: 0.28, h: H, fill: { color: primary }, line: { color: primary, width: 0 } });
      slide.addText(title, { x: 1.1, y: 2.6, w: W - 2.2, h: 1.4, fontFace: FONT, fontSize: 44, bold: true, color: primary, valign: "middle", fit: "shrink" });
      const sub = list(s.bullets, 1, 160)[0];
      if (sub) slide.addText(sub, { x: 1.1, y: 4.0, w: W - 2.2, h: 0.7, fontFace: FONT, fontSize: 22, color: MUTED });
      return;
    }

    slide.background = { color: "FFFFFF" };
    slide.addText(title, { x: MX, y: 0.45, w: W - 2 * MX, h: 1.05, fontFace: FONT, fontSize: title.length > 90 ? 26 : title.length > 48 ? 30 : 36, bold: true, color: INK, valign: "middle", fit: "shrink" });
    slide.addShape("rect", { x: MX, y: 1.62, w: 0.9, h: 0.06, fill: { color: accent }, line: { color: accent, width: 0 } });
    slide.addText(String(idx + 2), { x: W - MX - 0.8, y: H - 0.55, w: 0.8, h: 0.3, fontFace: FONT, fontSize: 12, color: MUTED, align: "right" });
    const top = 2.0, bottom = H - 0.85, bodyH = bottom - top;

    if (layout === "two_column") {
      const colW = (W - 2 * MX - 0.5) / 2;
      [[s.left_title, s.left, MX], [s.right_title, s.right, MX + colW + 0.5]].forEach(([t, items, x]) => {
        const rows = list(items, 6);
        slide.addShape("rect", { x: x as number, y: top, w: colW, h: bodyH, fill: { color: SOFT }, line: { color: SOFT, width: 0 } });
        let y = top + 0.25;
        if (t) { slide.addText(String(t), { x: (x as number) + 0.3, y, w: colW - 0.6, h: 0.55, fontFace: FONT, fontSize: 22, bold: true, color: primary }); y += 0.7; }
        if (rows.length) slide.addText(bulletRuns(rows, Math.min(22, bodySize(rows))), { x: (x as number) + 0.3, y, w: colW - 0.6, h: bottom - y - 0.2, fontFace: FONT, valign: "top" });
      });
    } else if (layout === "stats") {
      const stats = (Array.isArray(s.stats) ? s.stats : []).slice(0, 4).map((x) => ({ value: String((x as Record<string, unknown>)?.value ?? "").slice(0, 14), label: String((x as Record<string, unknown>)?.label ?? "").slice(0, 90) })).filter((x) => x.value);
      const n = Math.max(1, stats.length), gap = 0.35, cardW = (W - 2 * MX - gap * (n - 1)) / n;
      stats.forEach((st, i) => {
        const x = MX + i * (cardW + gap);
        slide.addShape("rect", { x, y: top + 0.2, w: cardW, h: 2.9, fill: { color: SOFT }, line: { color: SOFT, width: 0 } });
        slide.addText(st.value, { x, y: top + 0.45, w: cardW, h: 1.4, fontFace: FONT, fontSize: n > 3 ? 44 : 60, bold: true, color: primary, align: "center", valign: "middle", fit: "shrink" });
        slide.addText(st.label, { x: x + 0.25, y: top + 1.95, w: cardW - 0.5, h: 0.95, fontFace: FONT, fontSize: 20, color: BODY, align: "center", valign: "top" });
      });
      const rows = list(s.bullets, 3);
      if (rows.length) slide.addText(bulletRuns(rows, 22), { x: MX, y: top + 3.35, w: W - 2 * MX, h: bottom - top - 3.35, fontFace: FONT, valign: "top" });
    } else if (layout === "quote") {
      slide.addShape("rect", { x: MX, y: top + 0.3, w: 0.09, h: 2.6, fill: { color: accent }, line: { color: accent, width: 0 } });
      slide.addText(`“${String(s.quote ?? list(s.bullets, 1, 400)[0] ?? "").slice(0, 400)}”`, { x: MX + 0.4, y: top + 0.3, w: W - 2 * MX - 0.4, h: 2.6, fontFace: FONT, fontSize: 32, italic: true, color: INK, valign: "middle", fit: "shrink" });
      if (s.by) slide.addText(`— ${String(s.by).slice(0, 120)}`, { x: MX + 0.4, y: top + 3.05, w: W - 2 * MX - 0.4, h: 0.5, fontFace: FONT, fontSize: 18, color: MUTED });
    } else {
      const rows = list(s.bullets, 7);
      const img = layout === "image" && s.image ? images[String(s.image)] : undefined;
      let textW = W - 2 * MX;
      if (img) {
        const boxW = 5.6, boxH = bodyH, r = img.w / img.h;
        const w = r > boxW / boxH ? boxW : boxH * r, h = r > boxW / boxH ? boxW / r : boxH;
        slide.addImage({ data: img.data, x: W - MX - boxW + (boxW - w) / 2, y: top + (boxH - h) / 2, w, h });
        textW = W - 2 * MX - boxW - 0.5;
      }
      if (rows.length) slide.addText(bulletRuns(rows, bodySize(rows)), { x: MX, y: top, w: textW, h: bodyH, fontFace: FONT, valign: "top" });
    }
  });

  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}

async function makePresentation(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const title = String(input.title ?? "").trim().slice(0, 140);
  const slides = (Array.isArray(input.slides) ? input.slides : []).slice(0, 40) as SlideSpec[];
  if (!title || !slides.length) return "Gagal: butuh judul dan minimal satu slide.";
  if (slides.some((s) => !String(s?.title ?? "").trim())) return "Gagal: setiap slide wajib punya judul.";

  // warna: argumen theme → warna brand project → bawaan
  let theme = (input.theme ?? {}) as { primary?: string; accent?: string };
  if (!theme.primary) {
    const { data: p } = await ctx.supabase.from("projects").select("brand").eq("id", ctx.projectId).maybeSingle();
    const colors = ((p?.brand as { colors?: unknown } | null)?.colors ?? []) as unknown[];
    if (Array.isArray(colors) && colors.length) theme = { primary: String(colors[0]), accent: String(colors[1] ?? theme.accent ?? "") };
  }

  const images: Record<string, DeckImage> = {};
  const notes: string[] = [];
  for (const s of slides) {
    const name = s.image ? String(s.image) : "";
    if (!name || images[name]) continue;
    const got = await loadDriveImage(ctx, name, 6_000_000);
    if (typeof got === "string") { notes.push(`gambar "${name}" dilewati (${got})`); continue; }
    const size = imageSize(got.buf);
    if (!size || !["image/png", "image/jpeg", "image/gif"].includes(got.mime)) { notes.push(`gambar "${name}" dilewati (format ${got.mime} tidak didukung PowerPoint — pakai png/jpg)`); continue; }
    images[name] = { data: `${got.mime};base64,${got.buf.toString("base64")}`, ...size };
  }

  const bytes = await buildDeck({ title, subtitle: input.subtitle ? String(input.subtitle).slice(0, 200) : undefined, theme, slides }, images);
  const base = String(input.filename || title).replace(/\.pptx$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "presentasi";
  const name = await putToDrive(ctx, `${base}.pptx`, bytes, "application/vnd.openxmlformats-officedocument.presentationml.presentation", "file");
  return `Presentasi "${title}" (${slides.length + 1} slide, ${Math.round(bytes.length / 1024)} KB) disimpan di Drive sebagai "${name}".${notes.length ? ` Catatan: ${notes.join("; ")}.` : ""}`;
}

// ---------------- Edit gambar ----------------

async function imageEdit(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const instruction = String(input.instruction ?? "").trim();
  const sources = (Array.isArray(input.source) ? input.source : [input.source]).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 3);
  if (!instruction || !sources.length) return "Gagal: butuh nama gambar sumber dan instruksi edit.";
  if (!ctx.keys.google) return "Kunci Google AI Studio belum diatur (Pengaturan → Kunci API, gratis) — edit gambar belum bisa dijalankan.";
  const parts: Record<string, unknown>[] = [];
  let first = "";
  for (const name of sources) {
    const got = await loadDriveImage(ctx, name);
    if (typeof got === "string") return `Gagal: ${got}`;
    if (!first) first = got.file.title;
    parts.push({ inlineData: { mimeType: got.mime, data: got.buf.toString("base64") } });
  }
  parts.push({ text: instruction });
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent", {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": ctx.keys.google },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }),
    signal: AbortSignal.timeout(110_000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? `Gemini HTTP ${r.status}`);
  const img = (j.candidates?.[0]?.content?.parts ?? []).find((p: { inlineData?: { data: string; mimeType: string } }) => p.inlineData);
  if (!img) return "Gagal: model tidak mengembalikan gambar (instruksi mungkin ditolak kebijakan). Ubah instruksinya.";
  const bytes = Buffer.from(img.inlineData.data, "base64");
  const ext = img.inlineData.mimeType.includes("jpeg") ? "jpg" : "png";
  const stem = String(input.filename || `${first.replace(/\.[a-z0-9]+$/i, "")}-edit-${Date.now()}`).replace(/\.(png|jpe?g|webp)$/i, "");
  const name = await putToDrive(ctx, `${stem}.${ext}`, bytes, img.inlineData.mimeType, "image");
  await ctx.supabase.from("generations").insert({ project_id: ctx.projectId, user_id: ctx.userId, model_id: "google/gemini-2.5-flash-image", kind: "image", prompt: `[edit ${sources.join(", ")}] ${instruction}`.slice(0, 2000), status: "done", output_url: null, cost: 0.039 }).then(() => {}, () => {});
  return `Gambar hasil edit disimpan di Drive sebagai "${name}" (asli "${first}" tidak diubah). Periksa dengan view_image sebelum melaporkan.`;
}
