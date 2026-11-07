-- PegawaiKu — skema inti
-- Jalankan di Supabase SQL Editor (atau `supabase db push`).

create extension if not exists "pgcrypto";

-- ---------- Profil pengguna ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ---------- Organisasi (tenant) ----------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  credit_balance numeric(14,4) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- ---------- Project (workspace kerja) ----------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  brand jsonb not null default '{}'::jsonb, -- {tagline, category, colors:[], website}
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists projects_org_idx on public.projects(org_id);

-- ---------- Katalog agent (marketplace) ----------
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  handle text not null unique,
  title text not null,
  category text not null,
  description text not null,
  system_prompt text not null,          -- isi SKILL.md (body)
  requires_tools text[] not null default '{}',
  model_hint text,
  avatar_url text,
  cover_url text,
  is_verified boolean not null default true,
  is_active boolean not null default true,
  stats jsonb not null default '{"projects":0,"tasks":0}'::jsonb,
  version text not null default '1.0.0',
  created_at timestamptz not null default now()
);

-- Agent yang direkrut ke sebuah project
create table if not exists public.project_agents (
  project_id uuid not null references public.projects(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  hired_by uuid references auth.users(id),
  hired_at timestamptz not null default now(),
  primary key (project_id, agent_id)
);

-- Bookmark agent per user
create table if not exists public.agent_bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, agent_id)
);

-- ---------- Percakapan dengan agent ----------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  agent_id uuid not null references public.agents(id),
  user_id uuid not null references auth.users(id),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_project_idx on public.conversations(project_id, updated_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  input_tokens int,
  output_tokens int,
  credit_cost numeric(14,6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages(conversation_id, created_at);

-- ---------- Task board ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  agent_id uuid references public.agents(id),
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo','in_progress','review','done','blocked')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Drive (file per project) ----------
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid references auth.users(id),
  title text not null,
  storage_path text not null,   -- path di bucket 'drive'
  mime_type text,
  size_bytes bigint,
  kind text not null default 'file' check (kind in ('file','image','video','text')),
  created_at timestamptz not null default now()
);
create index if not exists files_project_idx on public.files(project_id, created_at desc);

-- ---------- Kredit ----------
create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id),
  amount numeric(14,4) not null,          -- + topup, - pemakaian
  kind text not null check (kind in ('topup','usage','voucher','refund','adjust')),
  reference text,                          -- id pesan / id pembayaran / kode voucher
  note text,
  created_at timestamptz not null default now()
);
create index if not exists credit_tx_org_idx on public.credit_transactions(org_id, created_at desc);

create table if not exists public.vouchers (
  code text primary key,
  credits numeric(14,4) not null,
  max_uses int not null default 1,
  used_count int not null default 0,
  expires_at timestamptz
);

-- ---------- Trigger: buat profil + org pribadi saat user baru ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_slug text;
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          new.raw_user_meta_data->>'avatar_url');

  v_slug := lower(regexp_replace(split_part(new.email,'@',1), '[^a-z0-9]+', '-', 'g')) || '-' || substr(new.id::text,1,6);
  insert into public.organizations (name, slug, owner_id, credit_balance)
  values (coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), v_slug, new.id, 2)
  returning id into v_org;

  insert into public.org_members (org_id, user_id, role) values (v_org, new.id, 'owner');
  insert into public.credit_transactions (org_id, user_id, amount, kind, note)
  values (v_org, new.id, 2, 'topup', 'Kredit percobaan');
  insert into public.projects (org_id, name, description, created_by)
  values (v_org, 'Project Pertama', 'Workspace awal', new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Fungsi: potong / tambah kredit secara atomik ----------
create or replace function public.apply_credit(p_org uuid, p_amount numeric, p_kind text, p_reference text, p_note text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_balance numeric;
begin
  update public.organizations
     set credit_balance = credit_balance + p_amount
   where id = p_org
   returning credit_balance into v_balance;
  if v_balance is null then raise exception 'org not found'; end if;
  if v_balance < 0 then raise exception 'insufficient credit'; end if;
  insert into public.credit_transactions (org_id, user_id, amount, kind, reference, note)
  values (p_org, auth.uid(), p_amount, p_kind, p_reference, p_note);
  return v_balance;
end $$;

create or replace function public.redeem_voucher(p_org uuid, p_code text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from public.vouchers where code = upper(p_code) for update;
  if v is null then raise exception 'voucher tidak ditemukan'; end if;
  if v.expires_at is not null and v.expires_at < now() then raise exception 'voucher kedaluwarsa'; end if;
  if v.used_count >= v.max_uses then raise exception 'voucher sudah habis'; end if;
  update public.vouchers set used_count = used_count + 1 where code = v.code;
  return public.apply_credit(p_org, v.credits, 'voucher', v.code, 'Redeem voucher');
end $$;

-- ---------- Helper keanggotaan ----------
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_members where org_id = p_org and user_id = auth.uid());
$$;

create or replace function public.project_org(p_project uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.projects where id = p_project;
$$;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.projects enable row level security;
alter table public.agents enable row level security;
alter table public.project_agents enable row level security;
alter table public.agent_bookmarks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.tasks enable row level security;
alter table public.files enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.vouchers enable row level security;

create policy "profil sendiri" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "org anggota baca" on public.organizations for select using (public.is_org_member(id));
create policy "org owner ubah" on public.organizations for update using (owner_id = auth.uid());
create policy "member baca" on public.org_members for select using (public.is_org_member(org_id));
create policy "project anggota" on public.projects for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "agent publik" on public.agents for select using (is_active);
create policy "hire anggota" on public.project_agents for all
  using (public.is_org_member(public.project_org(project_id)))
  with check (public.is_org_member(public.project_org(project_id)));
create policy "bookmark sendiri" on public.agent_bookmarks for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "conv anggota" on public.conversations for all
  using (public.is_org_member(public.project_org(project_id)))
  with check (public.is_org_member(public.project_org(project_id)));
create policy "msg anggota" on public.messages for all
  using (exists (select 1 from public.conversations c where c.id = conversation_id and public.is_org_member(public.project_org(c.project_id))))
  with check (exists (select 1 from public.conversations c where c.id = conversation_id and public.is_org_member(public.project_org(c.project_id))));
create policy "task anggota" on public.tasks for all
  using (public.is_org_member(public.project_org(project_id)))
  with check (public.is_org_member(public.project_org(project_id)));
create policy "file anggota" on public.files for all
  using (public.is_org_member(public.project_org(project_id)))
  with check (public.is_org_member(public.project_org(project_id)));
create policy "tx anggota baca" on public.credit_transactions for select using (public.is_org_member(org_id));
-- vouchers: tidak bisa dibaca client; hanya lewat fungsi redeem_voucher

-- ---------- Storage bucket Drive ----------
insert into storage.buckets (id, name, public) values ('drive', 'drive', false)
on conflict (id) do nothing;

create policy "drive baca anggota" on storage.objects for select
  using (bucket_id = 'drive' and public.is_org_member(public.project_org((storage.foldername(name))[1]::uuid)));
create policy "drive tulis anggota" on storage.objects for insert
  with check (bucket_id = 'drive' and public.is_org_member(public.project_org((storage.foldername(name))[1]::uuid)));
create policy "drive hapus anggota" on storage.objects for delete
  using (bucket_id = 'drive' and public.is_org_member(public.project_org((storage.foldername(name))[1]::uuid)));

-- Voucher contoh untuk pengujian lokal
insert into public.vouchers (code, credits, max_uses) values ('PEGAWAIKU-TRIAL', 5, 100) on conflict do nothing;
