-- 0009: kemampuan agent yang bisa diminta & disetujui admin (self-learning fungsi dasar),
--       admin platform, rahasia platform, dan catatan migrasi (untuk pembaruan dari dalam aplikasi).

-- ---------- Admin platform (boleh menjalankan pembaruan aplikasi) ----------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
drop policy if exists "pa baca diri" on public.platform_admins;
create policy "pa baca diri" on public.platform_admins for select using (user_id = auth.uid());
-- pengguna pertama yang mendaftar otomatis jadi admin platform
insert into public.platform_admins (user_id)
select id from auth.users order by created_at asc limit 1
on conflict do nothing;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- ---------- Rahasia platform (GitHub token, Supabase access token) ----------
create table if not exists public.platform_secrets (
  key text primary key,            -- github_token | supabase_access_token | github_repo | github_branch
  value text not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.platform_secrets enable row level security;
drop policy if exists "ps admin" on public.platform_secrets;
create policy "ps admin" on public.platform_secrets for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- ---------- Catatan migrasi ----------
create table if not exists public.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now(),
  applied_by uuid references auth.users(id)
);
alter table public.schema_migrations enable row level security;
drop policy if exists "sm baca" on public.schema_migrations;
create policy "sm baca" on public.schema_migrations for select using (auth.uid() is not null);
drop policy if exists "sm admin" on public.schema_migrations;
create policy "sm admin" on public.schema_migrations for insert with check (public.is_platform_admin());
insert into public.schema_migrations (name) values
 ('0001_init.sql'),('0002_project_workspace.sql'),('0003_project_settings_tools_ai.sql'),('0004_skills_knowledge_models.sql'),
 ('0005_model_sonnet_5_5.sql'),('0006_app_logs.sql'),('0007_landing_publish_docs.sql'),('0008_agents_engineering.sql'),
 ('0009_capabilities_updates.sql')
on conflict do nothing;

-- ---------- Katalog kemampuan dasar ----------
create table if not exists public.capabilities (
  key text primary key,
  name text not null,
  description text not null,
  kind text not null default 'builtin' check (kind in ('builtin','http')),
  risk text not null default 'low' check (risk in ('low','medium','high')),
  org_id uuid references public.organizations(id) on delete cascade,  -- null = bawaan platform; terisi = kemampuan HTTP milik org
  spec jsonb,                       -- untuk kind=http: {method,url,headers,body,params:{nama:{type,description}}}
  created_at timestamptz not null default now()
);
alter table public.capabilities enable row level security;
drop policy if exists "cap baca" on public.capabilities;
create policy "cap baca" on public.capabilities for select using (org_id is null or public.is_org_member(org_id));
drop policy if exists "cap org tulis" on public.capabilities;
create policy "cap org tulis" on public.capabilities for all
  using (org_id is not null and exists (select 1 from public.org_members m where m.org_id = capabilities.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')))
  with check (org_id is not null and exists (select 1 from public.org_members m where m.org_id = capabilities.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')));

insert into public.capabilities (key,name,description,kind,risk) values
 ('delete_drive_file','Hapus file Drive','Agent menghapus file di Drive project (setelah user mengonfirmasi).','builtin','high'),
 ('rename_drive_file','Ganti nama file Drive','Agent mengganti nama file di Drive project.','builtin','medium'),
 ('list_tasks','Lihat daftar tugas','Agent membaca tugas di board project beserta statusnya.','builtin','low'),
 ('update_task','Ubah tugas','Agent mengubah judul, deskripsi, atau status tugas di board.','builtin','medium'),
 ('delete_task','Hapus tugas','Agent menghapus tugas dari board (setelah user mengonfirmasi).','builtin','high'),
 ('update_project_info','Ubah info project','Agent memperbarui tagline, deskripsi, kategori, website, status, atau tenggat project.','builtin','medium'),
 ('list_conversations','Lihat riwayat percakapan','Agent membaca judul percakapan lain di project untuk konteks.','builtin','low'),
 ('read_conversation','Baca percakapan lain','Agent membaca isi percakapan lain di project (mis. hasil kerja agent lain).','builtin','medium')
on conflict (key) do update set name=excluded.name, description=excluded.description, risk=excluded.risk;

-- Kemampuan yang diaktifkan per organisasi
create table if not exists public.org_capabilities (
  org_id uuid not null references public.organizations(id) on delete cascade,
  capability_key text not null references public.capabilities(key) on delete cascade,
  approved_by uuid references auth.users(id),
  approved_at timestamptz not null default now(),
  primary key (org_id, capability_key)
);
alter table public.org_capabilities enable row level security;
drop policy if exists "oc baca" on public.org_capabilities;
create policy "oc baca" on public.org_capabilities for select using (public.is_org_member(org_id));
drop policy if exists "oc admin" on public.org_capabilities;
create policy "oc admin" on public.org_capabilities for all
  using (exists (select 1 from public.org_members m where m.org_id = org_capabilities.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')))
  with check (exists (select 1 from public.org_members m where m.org_id = org_capabilities.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')));

-- Permintaan kemampuan dari agent
create table if not exists public.capability_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  requested_by uuid references auth.users(id),
  title text not null,
  reason text not null,
  user_request text,
  kind text not null check (kind in ('builtin','http','dev')),
  capability_key text,             -- untuk builtin
  spec jsonb,                      -- untuk http
  status text not null default 'pending' check (status in ('pending','approved','rejected','needs_dev','done')),
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists capreq_org_idx on public.capability_requests(org_id, status, created_at desc);
alter table public.capability_requests enable row level security;
drop policy if exists "cr anggota baca" on public.capability_requests;
create policy "cr anggota baca" on public.capability_requests for select using (public.is_org_member(org_id));
drop policy if exists "cr anggota buat" on public.capability_requests;
create policy "cr anggota buat" on public.capability_requests for insert with check (public.is_org_member(org_id));
drop policy if exists "cr admin ubah" on public.capability_requests;
create policy "cr admin ubah" on public.capability_requests for update
  using (exists (select 1 from public.org_members m where m.org_id = capability_requests.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')));
