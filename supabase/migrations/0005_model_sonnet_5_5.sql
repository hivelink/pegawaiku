-- 0005: Claude Sonnet 4.5 dideprekasi (pensiun 30 Nov 2026) -> ganti ke Sonnet 5.5 / Haiku 5.5
update public.organizations set chat_model = 'anthropic/claude-sonnet-5-5' where chat_model in ('anthropic/claude-sonnet-4-5','anthropic/claude-sonnet-4-5-20250929');
alter table public.organizations alter column chat_model set default 'anthropic/claude-sonnet-5-5';
delete from public.ai_models where id in ('anthropic/claude-sonnet-4-5','anthropic/claude-haiku-4-5');
insert into public.ai_models (id,provider,name,kind,pricing,price_usd,free_tier,key_provider,notes,sort) values
 ('anthropic/claude-sonnet-5-5','Anthropic','Claude Sonnet 5.5','text','$2 / $10 per 1M token',10,false,'anthropic','Model utama pegawai AI (chat) — dukungan tool terbaik.',10),
 ('anthropic/claude-haiku-5-5','Anthropic','Claude Haiku 5.5','text','mulai $0.10 / $0.50 per 1M token',0.5,false,'anthropic','Cepat & murah untuk tugas ringan.',11)
on conflict (id) do update set name=excluded.name, pricing=excluded.pricing, price_usd=excluded.price_usd, notes=excluded.notes, sort=excluded.sort;
