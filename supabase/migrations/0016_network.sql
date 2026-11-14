-- 0016: Jaringan — inventaris perangkat & port, status pemantauan (ditulis pekerja NAS), dan antrean perintah router.

create table if not exists public.net_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null default 'other' check (kind in ('router','switch','ap','nas','camera','other')),
  driver text not null default 'generic' check (driver in ('mikrotik','generic')), -- mikrotik = REST RouterOS (kunci organisasi `mikrotik`); generic = cek hidup/mati
  vendor text,
  model text,
  mgmt_ip text,
  mgmt_port int not null default 80,          -- port yang dicek untuk perangkat generic (80/443/8080 …)
  notes text,
  monitor boolean not null default true,
  sort int not null default 100,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists net_devices_org_idx on public.net_devices(org_id, sort, created_at);

create table if not exists public.net_ports (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.net_devices(id) on delete cascade,
  name text not null,                          -- mis. ether5, 9, LAN1
  purpose text,                                -- kegunaan
  config text,                                 -- VLAN / catatan konfigurasi
  sort int not null default 100,
  unique (device_id, name)
);

-- status terakhir tiap perangkat (satu baris per perangkat; ditulis pekerja dengan service role)
create table if not exists public.net_status (
  device_id uuid primary key references public.net_devices(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  online boolean not null default false,
  latency_ms int,
  seen_by_router boolean,                      -- alamat IP-nya ada di tabel ARP router
  error text,
  data jsonb,                                  -- khusus router: resource, interface, lease, hotspot
  checked_at timestamptz not null default now(),
  changed_at timestamptz not null default now() -- kapan terakhir berganti hidup/mati
);

-- perintah pengaturan dari web → dijalankan pekerja di jaringan rumah
create table if not exists public.net_commands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.net_devices(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  label text not null,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  result text,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists net_commands_queue_idx on public.net_commands(status, created_at);
create index if not exists net_commands_org_idx on public.net_commands(org_id, created_at desc);

alter table public.net_devices enable row level security;
alter table public.net_ports enable row level security;
alter table public.net_status enable row level security;
alter table public.net_commands enable row level security;

drop policy if exists "nd anggota" on public.net_devices;
create policy "nd anggota" on public.net_devices for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
drop policy if exists "np anggota" on public.net_ports;
create policy "np anggota" on public.net_ports for all
  using (exists (select 1 from public.net_devices d where d.id = device_id and public.is_org_member(d.org_id)))
  with check (exists (select 1 from public.net_devices d where d.id = device_id and public.is_org_member(d.org_id)));
drop policy if exists "ns baca" on public.net_status;
create policy "ns baca" on public.net_status for select using (public.is_org_member(org_id));
-- perintah: semua anggota melihat; hanya owner/admin yang boleh memerintah router, dan hanya berstatus antre
drop policy if exists "nc baca" on public.net_commands;
create policy "nc baca" on public.net_commands for select using (public.is_org_member(org_id));
drop policy if exists "nc perintah" on public.net_commands;
create policy "nc perintah" on public.net_commands for insert
  with check (public.is_org_admin(org_id) and status = 'queued' and result is null and finished_at is null);

insert into public.tools (key,name,description,category,icon,requires_key,is_available,sort) values
 ('network_overview','Ringkasan Jaringan','Agent membaca inventaris perangkat, peta port, dan status terakhir jaringan Anda (dari tab Jaringan).','jaringan','globe',null,true,195)
on conflict (key) do update set name=excluded.name, description=excluded.description, category=excluded.category, icon=excluded.icon, requires_key=excluded.requires_key, is_available=excluded.is_available, sort=excluded.sort;

-- Satria & Arka boleh membaca ringkasan jaringan
update public.agents set requires_tools = array_append(requires_tools, 'network_overview')
 where slug in ('satria-network-engineer','arka-asisten-otonom') and not ('network_overview' = any(requires_tools));

notify pgrst, 'reload schema';
insert into public.schema_migrations (name) values ('0016_network.sql') on conflict do nothing;
