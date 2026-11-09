-- 0013: model AI cadangan — dipakai otomatis saat model utama gagal (kredit/kuota habis, kunci bermasalah, limit)
alter table public.organizations add column if not exists fallback_model text;
notify pgrst, 'reload schema';
insert into public.schema_migrations (name) values ('0013_fallback_model.sql') on conflict do nothing;
