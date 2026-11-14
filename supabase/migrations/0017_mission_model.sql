-- 0017: model AI per misi Asisten Otonom, dan pembaruan katalog model Gemini.

-- null = pakai rekomendasi agent (src/lib/autopilot/models.ts). Nilai berformat "provider/model" seperti di ai_models.id.
alter table public.auto_missions add column if not exists model text;

-- Google memensiunkan Gemini 2.0 Flash, dan Gemini 2.5 Flash tidak lagi tersedia untuk pengguna baru
-- (pesan API: "no longer available ... use models/gemini-3.8-flash"). Tambah penggantinya, nonaktifkan yang lama.
insert into public.ai_models (id,provider,name,kind,pricing,price_usd,free_tier,key_provider,notes,sort) values
 ('google/gemini-3.8-flash','Google','Gemini 3.8 Flash','text','lihat ai.google.dev/pricing (ada kuota AI Studio)',null,true,'google','Pengganti Gemini 2.0/2.5 Flash yang sudah pensiun.',12)
on conflict (id) do update set name=excluded.name, pricing=excluded.pricing, notes=excluded.notes, is_active=true;
update public.ai_models set is_active = false where id in ('google/gemini-2.0-flash','google/gemini-2.5-flash');

-- Pengaturan organisasi yang masih menunjuk model pensiun dialihkan ke penggantinya (sebelumnya selalu gagal 404).
update public.organizations set fallback_model = 'google/gemini-3.8-flash' where fallback_model in ('google/gemini-2.0-flash','google/gemini-2.5-flash');
update public.organizations set chat_model = 'google/gemini-3.8-flash' where chat_model in ('google/gemini-2.0-flash','google/gemini-2.5-flash');

notify pgrst, 'reload schema';
insert into public.schema_migrations (name) values ('0017_mission_model.sql') on conflict do nothing;
