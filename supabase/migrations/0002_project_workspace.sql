-- 0002: kolom untuk halaman Project Workspace + profil anggota org bisa dibaca sesama anggota

alter table public.projects
  add column if not exists status text not null default 'active'
    check (status in ('active','on_hold','done','archived')),
  add column if not exists due_date date;

-- Anggota org boleh membaca profil (nama/email) sesama anggota org — untuk kartu "Users".
drop policy if exists "profil sesama anggota" on public.profiles;
create policy "profil sesama anggota" on public.profiles for select
  using (
    exists (
      select 1 from public.org_members a
      join public.org_members b on a.org_id = b.org_id
      where a.user_id = auth.uid() and b.user_id = public.profiles.id
    )
  );
