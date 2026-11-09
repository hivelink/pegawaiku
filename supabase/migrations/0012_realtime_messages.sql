-- 0012: sinkron chat antar-perangkat — aktifkan Supabase Realtime untuk tabel messages
-- (RLS tetap berlaku: hanya anggota organisasi yang menerima perubahan percakapannya)
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

insert into public.schema_migrations (name) values ('0012_realtime_messages.sql') on conflict do nothing;
