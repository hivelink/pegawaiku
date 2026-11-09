-- 0011: chat kolaborasi multi-agent (@mention) — peserta percakapan & penanda agent per pesan

create table if not exists public.conversation_agents (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  added_by uuid references auth.users(id),
  added_at timestamptz not null default now(),
  primary key (conversation_id, agent_id)
);
alter table public.conversation_agents enable row level security;
drop policy if exists "ca anggota" on public.conversation_agents;
create policy "ca anggota" on public.conversation_agents for all
  using (exists (select 1 from public.conversations c where c.id = conversation_id and public.is_org_member(public.project_org(c.project_id))))
  with check (exists (select 1 from public.conversations c where c.id = conversation_id and public.is_org_member(public.project_org(c.project_id))));

-- agent pemilik percakapan otomatis menjadi peserta
insert into public.conversation_agents (conversation_id, agent_id)
select id, agent_id from public.conversations
on conflict do nothing;

-- pesan asisten mencatat agent yang menjawab (null = agent pemilik percakapan, untuk pesan lama)
alter table public.messages add column if not exists agent_id uuid references public.agents(id) on delete set null;


-- ---------- Perbaikan hasil audit ----------
-- (a) save_to_drive mode "append" menimpa objek Storage → butuh izin UPDATE di bucket drive
drop policy if exists "drive ubah anggota" on storage.objects;
create policy "drive ubah anggota" on storage.objects for update
  using (bucket_id = 'drive' and public.is_org_member(public.project_org((storage.foldername(name))[1]::uuid)))
  with check (bucket_id = 'drive' and public.is_org_member(public.project_org((storage.foldername(name))[1]::uuid)));

-- (b) pemakaian yang melebihi sisa kredit tetap ditagih sampai saldo 0 (sebelumnya gagal diam-diam = gratis)
create or replace function public.apply_credit(p_org uuid, p_amount numeric, p_kind text, p_reference text, p_note text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_balance numeric; v_amount numeric := p_amount;
begin
  select credit_balance into v_balance from public.organizations where id = p_org for update;
  if v_balance is null then raise exception 'org not found'; end if;
  if v_balance + v_amount < 0 then
    if p_kind = 'usage' then v_amount := -v_balance; else raise exception 'insufficient credit'; end if;
  end if;
  update public.organizations set credit_balance = credit_balance + v_amount where id = p_org returning credit_balance into v_balance;
  insert into public.credit_transactions (org_id, user_id, amount, kind, reference, note)
  values (p_org, auth.uid(), v_amount, p_kind, p_reference, p_note);
  return v_balance;
end $$;

-- (c) relasi org_members → profiles agar daftar anggota tim bisa dimuat (embed PostgREST)
insert into public.profiles (id, email)
select u.id, u.email from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'org_members_user_profile_fk') then
    alter table public.org_members add constraint org_members_user_profile_fk foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;
notify pgrst, 'reload schema';

insert into public.schema_migrations (name) values ('0011_chat_multi_agent.sql') on conflict do nothing;
