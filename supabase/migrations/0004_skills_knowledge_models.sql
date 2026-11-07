-- 0004: pustaka skill tambahan, pengetahuan hasil belajar agent, pilihan model chat per org, model AI gratis

-- ---------- Pustaka skill (bisa dipasang ke agent mana pun) ----------
create table if not exists public.skills (
  key text primary key,
  name text not null,
  description text not null,
  category text not null,            -- riset | penulisan | analisis | kreatif | operasional
  instructions text not null,        -- instruksi yang disuntikkan ke system prompt
  requires_tools text[] not null default '{}',
  is_builtin boolean not null default true,
  org_id uuid references public.organizations(id) on delete cascade,  -- null = bawaan platform
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.skills enable row level security;
drop policy if exists "skills baca" on public.skills;
create policy "skills baca" on public.skills for select using (org_id is null or public.is_org_member(org_id));
drop policy if exists "skills org tulis" on public.skills;
create policy "skills org tulis" on public.skills for all
  using (org_id is not null and public.is_org_member(org_id))
  with check (org_id is not null and public.is_org_member(org_id));

insert into public.skills (key,name,description,category,instructions,requires_tools) values
 ('riset-web','Riset Web Terkini','Mencari fakta, tren, dan referensi terbaru di internet sebelum menjawab.','riset',
  E'Saat pertanyaan menyangkut fakta terkini, angka, harga, tren, atau hal yang belum kamu ketahui pasti: gunakan tool web_search (2-4 kueri berbeda), buka 1-3 sumber terbaik dengan web_fetch, lalu jawab dengan ringkas dan sebutkan sumbernya (judul + URL). Jangan mengarang; jika sumber tidak ditemukan, katakan.','{web_search,web_fetch}'),
 ('belajar-mandiri','Belajar Mandiri (Expertise Baru)','Jika diminta sesuatu di luar keahlian, pelajari dulu dari internet lalu simpan sebagai pengetahuan.','riset',
  E'Jika user meminta hal di luar keahlian utamamu, JANGAN menolak. Lakukan: (1) cari 3-5 sumber tepercaya dengan web_search, (2) baca dengan web_fetch, (3) rangkum menjadi panduan praktis 300-600 kata (langkah, aturan, contoh), (4) simpan dengan tool learn_skill agar bisa dipakai lagi, (5) baru kerjakan permintaan user memakai panduan itu. Sebutkan ke user bahwa kamu baru mempelajarinya dan dari mana.','{web_search,web_fetch,learn_skill}'),
 ('analisis-kompetitor','Analisis Kompetitor','Membedah pesaing: positioning, penawaran, harga, kanal, dan celah.','analisis',
  E'Untuk analisis kompetitor: identifikasi 3-5 pesaing, untuk masing-masing catat positioning, penawaran utama, harga, kanal pemasaran, kekuatan, kelemahan (gunakan web_search/web_fetch bila tersedia). Tutup dengan tabel perbandingan dan 3 celah peluang yang bisa diambil user.','{web_search,web_fetch}'),
 ('penulisan-seo','Penulisan Ramah SEO','Struktur heading, keyword alami, meta title/description, FAQ.','penulisan',
  E'Saat menulis artikel/halaman: satu H1, H2 per subtopik yang menjawab intent, keyword utama muncul alami di 100 kata pertama, judul <=60 karakter, meta description <=155 karakter, tambahkan FAQ 3-5 pertanyaan nyata. Hindari keyword stuffing.','{}'),
 ('brand-voice','Konsistensi Brand Voice','Menjaga nada, kata ganti, dan istilah brand di semua output.','penulisan',
  E'Baca konteks brand project (nama, tagline, deskripsi, warna). Tentukan nada (formal/santai), kata ganti (Anda/kamu), dan 5 istilah khas; terapkan konsisten di seluruh output. Jika brand belum punya panduan, usulkan satu paragraf panduan nada dan pakai itu.','{}'),
 ('ringkas-dokumen','Ringkas & Ekstrak Dokumen','Merangkum dokumen panjang menjadi poin tindakan.','analisis',
  E'Jika user menempel teks panjang atau file dari Drive: buat ringkasan 5-8 poin, daftar keputusan/tindakan, risiko, dan pertanyaan terbuka. Kutip bagian penting apa adanya (<=25 kata per kutipan).','{read_drive_file}'),
 ('analisis-data','Analisis Data Tabel','Membaca CSV/tabel, menghitung ringkasan, menemukan anomali.','analisis',
  E'Untuk data tabel: validasi kolom dan baris, hitung total/rata-rata/median per kategori, deteksi pencilan dan duplikat dengan aturan eksplisit, sajikan tabel ringkas + 3 temuan utama + rekomendasi. Sebutkan asumsi.','{read_drive_file}'),
 ('simpan-hasil','Simpan Hasil ke Drive','Menyimpan output panjang sebagai file di Drive project.','operasional',
  E'Jika hasil kerja >400 kata atau user minta disimpan: simpan sebagai file markdown ke Drive memakai tool save_to_drive dengan nama file deskriptif, lalu beri tahu user nama filenya.','{save_to_drive}'),
 ('rencana-tugas','Pecah Jadi Tugas','Mengubah rencana menjadi kartu tugas di board project.','operasional',
  E'Jika user menyetujui sebuah rencana kerja, pecah menjadi 3-10 tugas konkret (judul kata kerja + hasil) dan buat di board dengan tool create_task. Laporkan daftar tugas yang dibuat.','{create_task}'),
 ('presentasi','Outline Presentasi','Menyusun outline slide dengan pesan per slide.','kreatif',
  E'Untuk permintaan presentasi: tentukan audiens dan satu pesan inti, lalu buat 8-15 slide: judul slide, 1 pesan utama, 2-4 poin pendukung, saran visual. Tutup dengan slide ajakan.','{}'),
 ('email-profesional','Email & Pesan Profesional','Menulis email/WhatsApp bisnis yang jelas dan sopan.','penulisan',
  E'Untuk email/pesan: subjek <=8 kata, pembuka 1 kalimat, inti 2-4 kalimat, satu permintaan jelas, penutup. Sediakan 2 versi (formal, santai) jika nada belum ditentukan.','{}'),
 ('terjemah-lokal','Terjemahan & Lokalisasi','Menerjemahkan ID<->EN dengan nuansa pasar Indonesia.','penulisan',
  E'Saat menerjemahkan, jaga makna dan nada; sesuaikan idiom, satuan, mata uang, dan contoh ke konteks Indonesia (atau target). Tandai istilah yang sengaja tidak diterjemahkan.','{}'),
 ('qa-kualitas','Pemeriksa Kualitas','Mengecek ulang output: fakta, konsistensi, batas karakter, klaim.','operasional',
  E'Sebelum menyerahkan hasil akhir, periksa: fakta/angka punya sumber atau ditandai asumsi; tidak ada klaim superlatif tanpa bukti; batas karakter/format terpenuhi; istilah konsisten. Perbaiki dulu baru kirim.','{}'),
 ('prompt-visual','Prompt Visual Konsisten','Menulis prompt gambar/video dengan style anchor yang sama.','kreatif',
  E'Untuk prompt gambar/video: tulis bahasa Inggris, 60-120 kata, urutan subjek->aksi->setting->komposisi->cahaya->gaya; gunakan style anchor identik di semua prompt satu seri; pindahkan larangan ke negative prompt.','{}')
on conflict (key) do update set name=excluded.name, description=excluded.description, category=excluded.category, instructions=excluded.instructions, requires_tools=excluded.requires_tools;

-- Skill yang dipasang ke agent (per organisasi)
create table if not exists public.agent_skills (
  org_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  skill_key text not null references public.skills(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (org_id, agent_id, skill_key)
);
alter table public.agent_skills enable row level security;
drop policy if exists "agent_skills anggota" on public.agent_skills;
create policy "agent_skills anggota" on public.agent_skills for all
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Pengetahuan yang dipelajari agent dari internet (per organisasi)
create table if not exists public.agent_knowledge (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  title text not null,
  content text not null,               -- panduan praktis hasil belajar (markdown)
  sources jsonb not null default '[]'::jsonb,  -- [{title,url}]
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists agent_knowledge_idx on public.agent_knowledge(org_id, agent_id, created_at desc);
alter table public.agent_knowledge enable row level security;
drop policy if exists "agent_knowledge anggota" on public.agent_knowledge;
create policy "agent_knowledge anggota" on public.agent_knowledge for all
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ---------- Model chat pilihan organisasi ----------
alter table public.organizations add column if not exists chat_model text not null default 'anthropic/claude-sonnet-5-5';

-- ---------- Model AI gratis / murah (chat) ----------
insert into public.ai_models (id,provider,name,kind,pricing,price_usd,free_tier,key_provider,notes,sort) values
 ('groq/llama-3.3-70b-versatile','Groq','Llama 3.3 70B (Groq)','text','GRATIS (kuota harian) · sangat cepat',0,true,'groq','Kunci gratis di console.groq.com. Cocok untuk chat pegawai AI tanpa biaya.',15),
 ('groq/llama-3.1-8b-instant','Groq','Llama 3.1 8B (Groq)','text','GRATIS (kuota harian)',0,true,'groq','Ringan & cepat untuk tugas sederhana.',16),
 ('google/gemini-2.0-flash','Google','Gemini 2.0 Flash','text','GRATIS (kuota AI Studio)',0,true,'google','Kuota gratis harian, konteks panjang.',17),
 ('openrouter/free','OpenRouter','Model gratis OpenRouter (auto)','text','GRATIS (rotasi model :free)',0,true,'openrouter','Pilih model berakhiran :free, mis. deepseek/deepseek-chat:free.',18),
 ('mistral/mistral-small-latest','Mistral','Mistral Small','text','GRATIS (tier eksperimen) · $0.1/$0.3 per 1M',0.3,true,'mistral','La Plateforme punya free tier dengan batas laju.',19),
 ('cerebras/llama-3.3-70b','Cerebras','Llama 3.3 70B (Cerebras)','text','GRATIS (1M token/hari)',0,true,'cerebras','Inference tercepat; kunci gratis di cloud.cerebras.ai.',19),
 ('cloudflare/llama-3.3-70b','Cloudflare Workers AI','Llama 3.3 70B (Cloudflare)','text','GRATIS 10k neuron/hari',0,true,'cloudflare','Butuh Account ID + API token.',19),
 ('pollinations/flux','Pollinations','Flux (Pollinations)','image','GRATIS tanpa kunci (ada watermark/antrian)',0,true,'none','Tanpa kunci API; kualitas dasar, cocok untuk draf.',28),
 ('huggingface/flux-schnell','Hugging Face','FLUX.1 schnell (HF Inference)','image','GRATIS (kuota) · lalu bayar per detik',0,true,'huggingface','Kunci gratis di huggingface.co/settings/tokens.',29)
on conflict (id) do update set provider=excluded.provider, name=excluded.name, kind=excluded.kind, pricing=excluded.pricing, price_usd=excluded.price_usd, free_tier=excluded.free_tier, key_provider=excluded.key_provider, notes=excluded.notes, sort=excluded.sort;

-- Riwayat pemakaian tool oleh agent (untuk audit & biaya)
create table if not exists public.tool_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  tool_key text not null,
  input jsonb,
  output_preview text,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.tool_runs enable row level security;
drop policy if exists "tool_runs anggota" on public.tool_runs;
create policy "tool_runs anggota" on public.tool_runs for all
  using (exists (select 1 from public.conversations c where c.id = tool_runs.conversation_id and public.is_org_member(public.project_org(c.project_id))))
  with check (exists (select 1 from public.conversations c where c.id = tool_runs.conversation_id and public.is_org_member(public.project_org(c.project_id))));
