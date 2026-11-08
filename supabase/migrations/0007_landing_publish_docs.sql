-- 0007: publikasi landing page, tool yang kini tersedia, skill "Baca Bahan"

create table if not exists public.landing_pages (
  slug text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  storage_path text not null,            -- path di bucket brand (publik)
  source_file_id uuid references public.files(id) on delete set null,
  published_by uuid references auth.users(id),
  published_at timestamptz not null default now(),
  views int not null default 0
);
alter table public.landing_pages enable row level security;
drop policy if exists "landing baca publik" on public.landing_pages;
create policy "landing baca publik" on public.landing_pages for select using (true);
drop policy if exists "landing tulis anggota" on public.landing_pages;
create policy "landing tulis anggota" on public.landing_pages for all
  using (public.is_org_member(public.project_org(project_id)))
  with check (public.is_org_member(public.project_org(project_id)));

-- Tool yang kini bisa dipakai
update public.tools set is_available = true, requires_key = null,
  description = 'Ide keyword & long-tail dari saran Google (gratis); dengan kunci SerpApi juga SERP teratas, People Also Ask, dan pencarian terkait.'
  where key = 'keyword_research';
update public.tools set is_available = true, requires_key = 'elevenlabs',
  description = 'Teks ke suara (voice-over) via ElevenLabs — hasil mp3 masuk Drive. Gratis 10.000 karakter/bulan.'
  where key = 'voice_generate';
update public.tools set is_available = true, requires_key = 'google',
  description = 'Agent membuat gambar dari prompt (Gemini Nano Banana, kuota gratis AI Studio) dan menyimpannya ke Drive.'
  where key = 'image_generate';
update public.tools set is_available = true, requires_key = null,
  description = 'Terbitkan landing page (.html di Drive) ke URL publik /p/<slug>.'
  where key = 'landing_publish';
update public.tools set is_available = true,
  description = 'Agent membaca dokumen di Drive: PDF, Word, PowerPoint (per slide + catatan), Excel/CSV, teks.'
  where key = 'drive_save';
insert into public.tools (key,name,description,category,icon,requires_key,is_available,sort) values
 ('read_drive_file','Baca Dokumen Drive','Agent membaca PDF, Word, PowerPoint (per slide + catatan pembicara), Excel/CSV, dan teks dari Drive project sebagai bahan kerja.','internal','file-search',null,true,45)
on conflict (key) do update set description=excluded.description, is_available=true;
-- yang masih menunggu penyedia data / OAuth: perjelas alasannya
update public.tools set description = 'Arsip iklan Meta. Menunggu penyedia data (Meta Ad Library API resmi hanya untuk iklan politik; alternatif berbayar: ScrapeCreators/Apify).' where key = 'meta_ads_library';
update public.tools set description = 'Iklan TikTok aktif. Menunggu penyedia data pihak ketiga (TikTok Creative Center tidak punya API publik).' where key = 'tiktok_ads_search';
update public.tools set description = 'Ambil media/metadata post Instagram publik. Menunggu penyedia data (Apify/RapidAPI) — pengambilan langsung diblokir Instagram.' where key = 'instagram_media_fetch';
update public.tools set description = 'Baca & ubah campaign Meta Ads. Butuh aplikasi Meta Developer + App Review (izin ads_management) sebelum bisa dipakai.' where key = 'meta_ads_api';
update public.tools set description = 'Baca/tulis Google Drive Anda. Butuh OAuth Google Cloud (client ID/secret) — menyusul.' where key = 'google_drive';
update public.tools set description = 'Simpan hasil ke Notion. Butuh OAuth integrasi Notion — menyusul.' where key = 'notion';

-- Skill baru: membaca bahan yang diberikan user
insert into public.skills (key,name,description,category,instructions,requires_tools) values
 ('baca-bahan','Baca Bahan dari Drive','Bekerja dari dokumen yang diunggah user (PDF, PPT, Word, Excel), bukan dari pengetahuan umum saja.','analisis',
  E'Jika user menyebut bahan, materi, slide, PDF, dokumen, atau file: JANGAN minta user mengetik ulang isinya. Panggil read_drive_file tanpa argumen untuk melihat daftar file, lalu baca file yang relevan (gunakan part 2, 3, ... untuk dokumen panjang sampai selesai). Catat struktur sumber (bab/slide, istilah, angka, gambar/grafik yang ditandai) dan rujuk nomor slide/halaman saat memakainya. Untuk grafik/tabel yang tidak terbaca, sebutkan letaknya dan minta user menjelaskan datanya saja. Semua isi ebook/tulisan harus bersumber dari bahan user; tambahan dari pengetahuan umum atau web diberi tanda.','{read_drive_file}')
on conflict (key) do update set name=excluded.name, description=excluded.description, instructions=excluded.instructions, requires_tools=excluded.requires_tools;

-- Pasang skill ini otomatis ke Maya untuk semua organisasi yang sudah ada
insert into public.agent_skills (org_id, agent_id, skill_key)
select o.id, a.id, 'baca-bahan' from public.organizations o cross join public.agents a where a.slug = 'maya-ebook-content-writer'
on conflict do nothing;
