/**
 * Model AI untuk Asisten Otonom: setiap agent punya rekomendasi, dan misi boleh memilih model sendiri.
 *
 * Urutan pemilihan untuk satu run (model yang kuncinya tidak tersedia dilewati):
 *   1. model yang dipilih di misi (kolom auto_missions.model)
 *   2. rekomendasi agent di bawah
 *   3. AUTOPILOT_MODEL di pekerja (bawaan pekerja)
 *   4. model chat organisasi (Pengaturan → Model AI)
 *
 * Tingkat:
 *   hemat  — Claude Haiku 5.5: murah dan tetap andal memakai tool. Untuk pemantauan rutin dan menyusun prompt.
 *   standar — Claude Sonnet 5.5: tulisan, riset, strategi, dan pekerjaan banyak langkah.
 * Model gratis (Gemini 2.0 Flash, Llama di Groq) tidak dijadikan rekomendasi: kuotanya terbatas dan
 * pemakaian tool-nya kurang andal untuk kerja tanpa diawasi. Tetap bisa dipilih per misi.
 */

export const MODEL_TIERS = {
  hemat: "anthropic/claude-haiku-5-5",
  standar: "anthropic/claude-sonnet-5-5",
} as const;
export type ModelTier = keyof typeof MODEL_TIERS;

type Rec = { tier: ModelTier; why: string };

/** Rekomendasi per agent (slug). Agent yang tidak tercantum memakai tingkat standar. */
export const AGENT_MODEL_RECS: Record<string, Rec> = {
  // pemantauan & pekerjaan terstruktur
  "satria-network-engineer": { tier: "hemat", why: "Pemantauan jaringan rutin: membaca data router dan merangkum. Untuk merancang konfigurasi baru, pilih Sonnet di misinya." },
  // menyusun prompt gambar/video: pendek, berpola
  "kira-image-prompt-engineer": { tier: "hemat", why: "Menyusun prompt gambar berpola tetap." },
  "arya-image-prompt-orchestrator": { tier: "hemat", why: "Menyusun prompt gambar berpola tetap." },
  "luna-ai-pose-director": { tier: "hemat", why: "Menyusun prompt pose berpola tetap." },
  "bejo-image-poster-specialist": { tier: "hemat", why: "Menyusun prompt poster berpola tetap." },
  "rama-image-ad-template-cloner": { tier: "hemat", why: "Mengisi templat iklan gambar." },
  "yusuf-seedance-art-specialist": { tier: "hemat", why: "Menyusun prompt video berpola tetap." },
  "vika-seedance-video-director": { tier: "hemat", why: "Menyusun prompt video berpola tetap." },
  "dian-cinematic-broll-director": { tier: "hemat", why: "Menyusun daftar shot dan prompt b-roll." },
  "hani-video-ad-generator": { tier: "hemat", why: "Menyusun prompt video iklan." },
  "wahyu-motion-graphics-specialist": { tier: "hemat", why: "Menyusun spesifikasi motion graphic." },
  "alex-storyboard-specialist": { tier: "hemat", why: "Memecah naskah menjadi panel storyboard." },
  "eka-event-expert": { tier: "hemat", why: "Rundown dan daftar periksa acara." },
  // menulis, riset, strategi, teknik — butuh penalaran dan bahasa yang baik
  "arka-asisten-otonom": { tier: "standar", why: "Asisten umum banyak langkah: merencanakan, mencari, dan memutuskan sendiri." },
  "bimo-ai-project-manager": { tier: "standar", why: "Memecah proyek dan mengoordinasi agent lain." },
  "spencer-strategic-planner": { tier: "standar", why: "Analisis strategi butuh penalaran panjang." },
  "maya-ebook-content-writer": { tier: "standar", why: "Tulisan panjang dengan gaya bahasa yang terjaga." },
  "sari-meta-sales-copywriter": { tier: "standar", why: "Copywriting penjualan butuh nuansa bahasa." },
  "zara-ad-script-specialist": { tier: "standar", why: "Naskah iklan butuh nuansa bahasa." },
  "hadi-instagram-scripting-specialist": { tier: "standar", why: "Naskah konten butuh nuansa bahasa." },
  "bram-direct-response-marketer": { tier: "standar", why: "Copy direct response butuh nuansa bahasa." },
  "aldi-market-research-strategist": { tier: "standar", why: "Riset pasar: membaca banyak sumber lalu menyimpulkan." },
  "rifqy-seo-specialist": { tier: "standar", why: "Riset kata kunci dan penulisan SEO." },
  "fani-finance-analyst": { tier: "standar", why: "Angka keuangan harus teliti." },
  "bayu-production-engineer": { tier: "standar", why: "Perhitungan teknik harus teliti." },
  "supri-srp-specialist": { tier: "standar", why: "Perhitungan teknik harus teliti." },
  "borry-pcp-specialist": { tier: "standar", why: "Perhitungan teknik harus teliti." },
  "matthew-simulation-engineer": { tier: "standar", why: "Diagnosis simulasi butuh penalaran panjang." },
  "hasan-ustadz-muslim": { tier: "standar", why: "Jawaban keagamaan harus cermat dan bersumber." },
};

export function recommendedModel(agentSlug: string | null | undefined): { model: string; tier: ModelTier; why: string } {
  const rec = (agentSlug && AGENT_MODEL_RECS[agentSlug]) || { tier: "standar" as const, why: "Bawaan untuk pekerjaan umum." };
  return { model: MODEL_TIERS[rec.tier], ...rec };
}

export type ModelSource = "misi" | "rekomendasi agent" | "bawaan pekerja" | "model chat organisasi";

/**
 * Urutan kandidat model untuk satu run, tanpa duplikat. Pemanggil memilih kandidat pertama yang kuncinya tersedia.
 */
export function modelCandidates(o: { missionModel?: string | null; agentSlug?: string | null; workerDefault?: string | null; orgChatModel?: string | null; fallback: string }): { model: string; source: ModelSource }[] {
  const list: { model: string; source: ModelSource }[] = [];
  const push = (m: string | null | undefined, source: ModelSource) => { const v = (m ?? "").trim(); if (v && !list.some((x) => x.model === v)) list.push({ model: v, source }); };
  push(o.missionModel, "misi");
  push(recommendedModel(o.agentSlug).model, "rekomendasi agent");
  push(o.workerDefault, "bawaan pekerja");
  push(o.orgChatModel || o.fallback, "model chat organisasi");
  return list;
}
