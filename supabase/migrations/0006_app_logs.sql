-- 0006: log aplikasi (error & aksi penting) agar masalah bisa ditelusuri dari dalam aplikasi
create table if not exists public.app_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  level text not null default 'error' check (level in ('info','warn','error')),
  source text not null,                 -- nama aksi/route, mis. action:deleteProject, api:chat
  message text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists app_logs_org_idx on public.app_logs(org_id, created_at desc);
alter table public.app_logs enable row level security;
drop policy if exists "logs baca anggota" on public.app_logs;
create policy "logs baca anggota" on public.app_logs for select using (org_id is null and user_id = auth.uid() or public.is_org_member(org_id));
drop policy if exists "logs tulis login" on public.app_logs;
create policy "logs tulis login" on public.app_logs for insert with check (auth.uid() is not null);
drop policy if exists "logs hapus owner" on public.app_logs;
create policy "logs hapus owner" on public.app_logs for delete using (exists (select 1 from public.organizations o where o.id = app_logs.org_id and o.owner_id = auth.uid()));
