# PegawaiKu

Platform "pegawai AI": marketplace 28 agent spesialis (marketing, desain, video, HR, finance, builder) yang bisa direkrut ke project, diberi brief lewat chat, dengan Drive, task board, dan kredit prabayar.

Stack: **Next.js 16 (App Router) · Tailwind 4 · Supabase (Postgres, Auth, Storage) · Claude API**.

## Fitur versi 1 (MVP inti)

- Auth email/password + Google (Supabase Auth); organisasi & project otomatis dibuat saat daftar, bonus 2 kredit.
- Multi-tenant: organisasi → project; switcher di sidebar.
- Marketplace agent: 28 agent dari folder `skills/` (SKILL.md), filter kategori, pencarian, halaman profil ala sosmed (Feed / Job desk), bookmark, **Rekrut** ke project.
- Chat dengan agent: streaming dari Claude, SKILL.md menjadi system prompt, riwayat tersimpan, biaya dipotong dari kredit per pesan (token × harga × margin).
- Drive per project (Supabase Storage bucket `drive`, signed URL).
- Task board kanban sederhana (antre → berjalan → review → selesai / terhambat).
- Billing: saldo kredit, riwayat transaksi, redeem voucher. Payment gateway belum dipasang (lihat Roadmap).
- **Asisten Otonom** (menu Asisten): beri satu tujuan, lalu pegawai AI mengerjakannya sendiri — sekali jalan atau terjadwal — lewat pekerja di NAS/server rumah. Aksi berisiko (mengubah router, menerbitkan, menghapus) selalu menunggu persetujuan Anda di aplikasi atau Telegram. Asisten mempelajari kebiasaan Anda dan mengusulkan pekerjaan rutin. Lihat `worker/README.md`.

## Menjalankan secara lokal

### 1. Supabase

1. Buat project di https://supabase.com (gratis).
2. Buka **SQL Editor**, tempel isi `supabase/migrations/0001_init.sql`, jalankan. Ini membuat tabel, RLS, trigger `handle_new_user`, fungsi kredit, bucket `drive`, dan voucher uji `PEGAWAIKU-TRIAL`.
3. **Authentication → Providers**: aktifkan Email. Untuk Google, isi Client ID/Secret dari Google Cloud Console dan tambahkan redirect `https://<project>.supabase.co/auth/v1/callback`.
4. **Authentication → URL Configuration**: Site URL `http://localhost:3000`, tambahkan `http://localhost:3000/auth/callback` ke Redirect URLs.
5. **Project Settings → API**: salin `Project URL`, `anon public`, dan `service_role` (rahasia).

### 2. Anthropic

Buat API key di https://console.anthropic.com → API Keys.

### 3. Env & jalankan

```bash
cp .env.example .env.local   # isi semua nilainya
npm install
npm run seed:agents          # isi tabel agents dari folder skills/ (pakai service role key)
npm run dev                  # http://localhost:3000
```

Daftar akun baru → organisasi, project pertama, dan 2 kredit dibuat otomatis → buka **Agent**, rekrut, lalu **Mulai bekerja**.

## Struktur

```
skills/<slug>/SKILL.md     28 agent (frontmatter metadata + system prompt)
skills/agents.json         katalog hasil generate (dipakai landing page)
supabase/migrations/       skema database
scripts/seed-agents.ts     seed katalog ke Supabase
src/app/(auth)/            login, register, actions
src/app/app/               area aplikasi (layout sidebar, home, agent, chat, drive, tasks, billing)
src/app/api/chat           streaming Claude + potong kredit
src/app/api/drive/upload   unggah file ke Storage
src/lib/context.ts         user/org/project aktif (cookie pk_org, pk_project)
src/lib/autopilot/         mesin Asisten Otonom: jadwal, klasifikasi risiko, runner, penyimpanan, pengaman router
src/app/app/asisten/       halaman misi, persetujuan, riwayat, memori
worker/                    pekerja untuk NAS/server (Docker) + panduan
tests/                     uji mesin Asisten (npm test)
src/lib/supabase/          klien browser, server, proxy (auth guard)
public/brand/              logo (mark, horizontal light/dark)
public/agents/             avatar agent
```

## Menambah agent

Buat folder `skills/<slug>/SKILL.md` mengikuti format yang ada (lihat `skills/README` di repo katalog), jalankan `npm run seed:agents`, tambahkan avatar `public/agents/<slug>.svg`.

## Harga kredit

`src/lib/utils.ts` → `PRICING`: harga input/output per juta token (USD) dan `markup`. 1 kredit = 1 USD. Kurs rupiah tampilan: env `NEXT_PUBLIC_IDR_PER_CREDIT` (default 17000).

## Roadmap (belum ada di versi ini)

- Payment gateway (Midtrans/Xendit) → otomatis `apply_credit` lewat webhook.
- MCP server (`/api/mcp`) agar agent bisa dipakai dari Claude Desktop/Claude Code.
- Image/Video Studio lewat API model pihak ketiga, job queue.
- Konektor aplikasi (Composio/Pipedream), tool per agent (landing page publish, riset iklan).
- Undang anggota organisasi, peran admin.
- Avatar/cover agent hasil desain (saat ini inisial).

## Deploy

Vercel: import repo, isi env yang sama, set `NEXT_PUBLIC_SITE_URL` ke domain produksi dan tambahkan `https://<domain>/auth/callback` ke Redirect URLs Supabase.
