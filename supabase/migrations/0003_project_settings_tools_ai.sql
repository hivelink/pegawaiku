-- 0003: pengaturan project (gambar, brand), katalog tools, katalog model AI, kunci API organisasi

-- ---------- Project: kolom tambahan ----------
alter table public.projects
  add column if not exists tagline text,
  add column if not exists image_url text,
  add column if not exists website text,
  add column if not exists category text,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();

-- ---------- Bucket publik untuk gambar project & aset brand ----------
insert into storage.buckets (id, name, public) values ('brand', 'brand', true)
  on conflict (id) do nothing;
drop policy if exists "brand baca publik" on storage.objects;
create policy "brand baca publik" on storage.objects for select using (bucket_id = 'brand');
drop policy if exists "brand tulis anggota" on storage.objects;
create policy "brand tulis anggota" on storage.objects for insert
  with check (bucket_id = 'brand' and public.is_org_member(public.project_org((storage.foldername(name))[1]::uuid)));
drop policy if exists "brand ubah anggota" on storage.objects;
create policy "brand ubah anggota" on storage.objects for update
  using (bucket_id = 'brand' and public.is_org_member(public.project_org((storage.foldername(name))[1]::uuid)));
drop policy if exists "brand hapus anggota" on storage.objects;
create policy "brand hapus anggota" on storage.objects for delete
  using (bucket_id = 'brand' and public.is_org_member(public.project_org((storage.foldername(name))[1]::uuid)));

-- ---------- Katalog tools (alat bantu yang bisa diaktifkan per project) ----------
create table if not exists public.tools (
  key text primary key,                 -- nama yang dirujuk agent di requires_tools
  name text not null,
  description text not null,
  category text not null,               -- riset | media | publikasi | integrasi | internal
  icon text not null default 'wrench',  -- nama ikon lucide
  requires_key text,                    -- provider kunci API yang dibutuhkan (null = tidak perlu)
  is_available boolean not null default true,
  sort int not null default 100
);
alter table public.tools enable row level security;
drop policy if exists "tools publik" on public.tools;
create policy "tools publik" on public.tools for select using (true);

insert into public.tools (key,name,description,category,icon,requires_key,is_available,sort) values
 ('ask_user','Tanya Pengguna','Agent bisa mengajukan pertanyaan pilihan (tombol) ke pengguna sebelum bekerja.','internal','message-circle-question',null,true,10),
 ('delegate_agent','Delegasi ke Agent Lain','Manajer AI (Bimo) dapat meneruskan sub-tugas ke pegawai AI lain di project.','internal','git-branch',null,true,20),
 ('task_create','Buat Task','Agent membuat kartu tugas di board project secara otomatis.','internal','list-checks',null,true,30),
 ('drive_save','Simpan ke Drive','Agent menyimpan hasil kerja (docx, md, gambar) langsung ke Drive project.','internal','hard-drive',null,true,40),
 ('web_search','Pencarian Web','Mencari informasi terkini di internet untuk riset pasar, SEO, dan kompetitor.','riset','globe','tavily',true,50),
 ('web_fetch','Pembaca Halaman Web','Mengambil dan membaca isi sebuah URL (artikel, landing page kompetitor).','riset','file-search',null,true,60),
 ('meta_ads_library','Riset Iklan Meta','Telusuri arsip iklan Facebook/Instagram yang sedang tayang berdasarkan kata kunci atau merek.','riset','megaphone','meta',false,70),
 ('tiktok_ads_search','Riset Iklan TikTok','Cari advertiser dan iklan TikTok yang sedang aktif untuk referensi kreatif.','riset','music',null,false,80),
 ('keyword_research','Riset Keyword','Ide keyword, volume perkiraan, dan keyword terkait untuk SEO/SEM.','riset','search','serp',false,90),
 ('instagram_media_fetch','Pengambil Media Instagram','Ambil media dan metadata dari post/reel Instagram publik untuk referensi.','media','instagram',null,false,100),
 ('image_generate','Generator Gambar','Buat gambar dari prompt memakai model gambar yang dipilih (Nano Banana, Imagen, Flux, dsb.).','media','image','ai_image',true,110),
 ('video_generate','Generator Video','Buat klip video dari prompt/gambar memakai model video (Seedance, Veo, Kling, dsb.).','media','clapperboard','ai_video',true,120),
 ('voice_generate','Generator Suara','Teks ke suara (voice-over) dengan pilihan suara Indonesia.','media','mic','ai_audio',false,130),
 ('landing_save','Simpan Landing Page','Vera menyimpan draf landing page HTML untuk pratinjau.','publikasi','layout-template',null,true,140),
 ('landing_publish','Publikasikan Landing Page','Terbitkan landing page ke subdomain project.','publikasi','rocket',null,false,150),
 ('meta_ads_api','Meta Ads Manager','Baca & ubah campaign Meta Ads akun Anda (butuh koneksi akun iklan).','integrasi','facebook','meta',false,160),
 ('google_drive','Google Drive','Baca/tulis file di Google Drive Anda.','integrasi','cloud',null,false,170),
 ('notion','Notion','Simpan hasil ke halaman atau database Notion.','integrasi','notebook',null,false,180)
on conflict (key) do update set name=excluded.name, description=excluded.description, category=excluded.category, icon=excluded.icon, requires_key=excluded.requires_key, is_available=excluded.is_available, sort=excluded.sort;

create table if not exists public.project_tools (
  project_id uuid not null references public.projects(id) on delete cascade,
  tool_key text not null references public.tools(key) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  enabled_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (project_id, tool_key)
);
alter table public.project_tools enable row level security;
drop policy if exists "project_tools anggota" on public.project_tools;
create policy "project_tools anggota" on public.project_tools for all
  using (public.is_org_member(public.project_org(project_id)))
  with check (public.is_org_member(public.project_org(project_id)));

-- ---------- Katalog model AI (referensi; harga per 1 hasil / per 1M token) ----------
create table if not exists public.ai_models (
  id text primary key,                  -- mis. google/gemini-2.5-flash-image
  provider text not null,               -- Google, ByteDance, Black Forest Labs, Anthropic, OpenAI, ...
  name text not null,
  kind text not null check (kind in ('image','video','text','audio')),
  pricing text not null,                -- teks harga, mis. "$0.039 / gambar" atau "gratis (kuota)"
  price_usd numeric(10,4),              -- perkiraan harga per 1 hasil (image/video) atau per 1M token output
  free_tier boolean not null default false,
  key_provider text not null,           -- provider kunci API yang dipakai: google | anthropic | openai | fal | replicate | ...
  notes text,
  is_active boolean not null default true,
  sort int not null default 100
);
alter table public.ai_models enable row level security;
drop policy if exists "ai_models publik" on public.ai_models;
create policy "ai_models publik" on public.ai_models for select using (true);

insert into public.ai_models (id,provider,name,kind,pricing,price_usd,free_tier,key_provider,notes,sort) values
 -- Teks
 ('anthropic/claude-sonnet-4-5','Anthropic','Claude Sonnet 4.5','text','$3 / $15 per 1M token',15,false,'anthropic','Model utama pegawai AI (chat).',10),
 ('anthropic/claude-haiku-4-5','Anthropic','Claude Haiku 4.5','text','$1 / $5 per 1M token',5,false,'anthropic','Cepat & murah untuk tugas ringan.',11),
 ('google/gemini-2.5-flash','Google','Gemini 2.5 Flash','text','gratis (kuota) · $0.30 / $2.50 per 1M',2.5,true,'google','Ada kuota gratis di Google AI Studio.',12),
 ('google/gemini-2.5-pro','Google','Gemini 2.5 Pro','text','$1.25 / $10 per 1M token',10,false,'google',null,13),
 ('openai/gpt-4.1-mini','OpenAI','GPT-4.1 mini','text','$0.40 / $1.60 per 1M token',1.6,false,'openai',null,14),
 -- Gambar
 ('google/gemini-2.5-flash-image','Google','Gemini Nano Banana','image','≈ $0.039 / gambar',0.039,true,'google','Kuota gratis terbatas di AI Studio; andalan Kira/Arya/Luna.',20),
 ('google/imagen-4-fast','Google','Imagen 4 Fast','image','≈ $0.02 / gambar',0.02,false,'google',null,21),
 ('google/imagen-4-ultra','Google','Imagen 4 Ultra','image','≈ $0.06 / gambar',0.06,false,'google',null,22),
 ('bytedance/seedream-4','ByteDance','Seedream 4.0','image','≈ $0.03 / gambar',0.03,false,'fal','Via fal.ai / Replicate.',23),
 ('bfl/flux-1.1-pro','Black Forest Labs','Flux 1.1 Pro','image','≈ $0.04 / gambar',0.04,false,'fal',null,24),
 ('bfl/flux-kontext-pro','Black Forest Labs','Flux Kontext Pro (edit)','image','≈ $0.04 / gambar',0.04,false,'fal','Edit gambar dengan referensi.',25),
 ('openai/gpt-image-1','OpenAI','GPT Image 1','image','≈ $0.04–0.17 / gambar',0.08,false,'openai',null,26),
 ('stability/sd-3.5','Stability AI','Stable Diffusion 3.5','image','gratis (self-host) · ≈ $0.035 via API',0.035,true,'fal','Bisa dijalankan sendiri tanpa biaya API.',27),
 -- Video
 ('bytedance/seedance-1-pro','ByteDance','Seedance 1.0 Pro','video','≈ $0.30–0.60 / klip 5 d',0.5,false,'fal','Andalan Vika/Hani/Dian.',30),
 ('google/veo-3-fast','Google','Veo 3 Fast','video','≈ $0.40 / detik',2,false,'google','Termasuk audio.',31),
 ('kling/kling-2.1','Kuaishou','Kling 2.1','video','≈ $0.25–0.50 / klip 5 d',0.4,false,'fal',null,32),
 ('minimax/hailuo-02','MiniMax','Hailuo 02','video','≈ $0.28 / klip 6 d',0.28,false,'fal',null,33),
 ('wan/wan-2.2','Alibaba','Wan 2.2','video','gratis (self-host) · ≈ $0.20 via API',0.2,true,'fal','Open-weights.',34),
 -- Audio
 ('elevenlabs/multilingual-v2','ElevenLabs','Multilingual v2','audio','gratis 10k karakter/bln · $5/bln',0,true,'elevenlabs','Suara Indonesia natural.',40),
 ('google/gemini-tts','Google','Gemini TTS','audio','gratis (kuota) · $10 per 1M karakter',0,true,'google',null,41),
 ('openai/gpt-4o-mini-tts','OpenAI','GPT-4o mini TTS','audio','≈ $0.015 / menit',0.015,false,'openai',null,42)
on conflict (id) do update set provider=excluded.provider, name=excluded.name, kind=excluded.kind, pricing=excluded.pricing, price_usd=excluded.price_usd, free_tier=excluded.free_tier, key_provider=excluded.key_provider, notes=excluded.notes, sort=excluded.sort;

-- ---------- Kunci API per organisasi ----------
-- Catatan: disimpan sebagai teks di tabel dengan RLS (hanya owner/admin org). Enkripsi at-rest
-- (pgsodium/Vault) masuk roadmap; sementara ini jangan taruh kunci produksi bernilai besar.
create table if not exists public.org_api_keys (
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,               -- anthropic | google | openai | fal | elevenlabs | tavily | serp | meta
  label text,
  secret text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);
alter table public.org_api_keys enable row level security;
drop policy if exists "api keys owner/admin" on public.org_api_keys;
create policy "api keys owner/admin" on public.org_api_keys for all
  using (exists (select 1 from public.org_members m where m.org_id = org_api_keys.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')))
  with check (exists (select 1 from public.org_members m where m.org_id = org_api_keys.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')));
drop trigger if exists org_api_keys_touch on public.org_api_keys;
create trigger org_api_keys_touch before update on public.org_api_keys for each row execute function public.touch_updated_at();

-- ---------- Hasil generate AI (riwayat) ----------
create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid references auth.users(id),
  model_id text references public.ai_models(id),
  kind text not null,
  prompt text not null,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  output_url text,
  error text,
  cost numeric(14,6) not null default 0,
  created_at timestamptz not null default now()
);
alter table public.generations enable row level security;
drop policy if exists "generations anggota" on public.generations;
create policy "generations anggota" on public.generations for all
  using (public.is_org_member(public.project_org(project_id)))
  with check (public.is_org_member(public.project_org(project_id)));
