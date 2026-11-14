-- 0017: model AI per misi Asisten Otonom.
-- null = pakai rekomendasi agent (src/lib/autopilot/models.ts). Nilai berformat "provider/model" seperti di ai_models.id.
alter table public.auto_missions add column if not exists model text;

notify pgrst, 'reload schema';
insert into public.schema_migrations (name) values ('0017_mission_model.sql') on conflict do nothing;
