# Pekerja Asisten Otonom

Program kecil yang berjalan terus di NAS atau server rumah. Ia mengambil **misi** dari aplikasi PegawaiKu, mengerjakannya dengan Claude dan tool yang ada (riset web, Drive, presentasi, gambar, router MikroTik), lalu melapor. Aksi berisiko tidak pernah dijalankan sebelum Anda menyetujuinya.

```
Anda (HP / laptop)                Supabase (cloud)                 NAS di rumah
┌──────────────────┐  misi   ┌────────────────────┐  ambil   ┌──────────────────────┐
│ menu Asisten     │ ──────► │ auto_missions      │ ◄─────── │ pekerja (Docker)     │
│ Telegram (ops.)  │ ◄────── │ auto_runs          │ ───────► │  ├─ Claude API       │
│ Setujui / Tolak  │ setuju  │ auto_approvals     │  hasil   │  ├─ web, Drive       │
└──────────────────┘ ──────► │ auto_memory        │          │  └─ router 192.168.x │
                             └────────────────────┘          └──────────────────────┘
```

Pekerja hanya membuat koneksi **keluar** (Supabase, penyedia model, Telegram) dan ke perangkat di LAN. Tidak ada port yang dibuka ke internet.

## 1. Pasang di database (sekali)

Jalankan migrasi `supabase/migrations/0015_autopilot.sql` lewat **Pengaturan → Pembaruan**, atau tempel isinya di Supabase → SQL Editor. Migrasi ini menambah tabel misi, persetujuan, memori, agent **Arka**, dan tool baru.

## 2. Jalankan pekerja

```bash
cp worker/env.example worker/.env      # isi nilainya (lihat komentar di file)
docker compose -f worker/docker-compose.yml up -d --build
docker logs -f pegawaiku-asisten       # harus muncul: pekerja "…" mulai
```

Synology: **Container Manager → Project → Create**, pilih folder repo ini dan file `worker/docker-compose.yml`.

Tanpa Docker (butuh Node.js 22):

```bash
npm ci && npm run worker               # membaca .env.local bila ada
```

Nilai yang wajib diisi di `worker/.env`:

| Variabel | Dari mana |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (rahasia) |
| `AUTOPILOT_ORG_ID` | Aplikasi → menu **Asisten** → "Menyiapkan pekerja" |

Kunci model (Claude) dibaca dari **Pengaturan → Kunci API** organisasi. Bila kosong, pekerja memakai `ANTHROPIC_API_KEY` dari `.env` dan memotong kredit seperti chat.

Setelah berjalan, halaman **Asisten** menampilkan "Pekerja … aktif".

## 3. Apa yang butuh persetujuan

| Jenis aksi | Contoh | Perilaku |
|---|---|---|
| Membaca | cari web, baca Drive, `GET` ke router | Langsung jalan |
| Menulis di dalam aplikasi | simpan file, buat presentasi/gambar, buat tugas, catat memori | Langsung jalan (atau minta izin bila misi diset "semua perubahan") |
| Berisiko | `POST/PATCH/DELETE` ke router, menerbitkan landing page, menghapus file/tugas, API luar | **Selalu berhenti** sampai Anda menekan Setujui |
| Tool yang tidak dikenal | — | Dianggap berisiko |

Jaminan yang ditegakkan kode dan diuji (`npm test`):

- Yang dijalankan adalah **persis** input yang tampil di kartu persetujuan.
- Aksi yang disetujui dijalankan **paling banyak sekali**, walau pekerja mati di tengah jalan.
- Aksi yang ditolak atau kedaluwarsa (72 jam) tidak dijalankan.
- Hanya owner/admin organisasi yang bisa menyetujui (ditegakkan RLS database).
- Misi yang **diusulkan** asisten tidak berjalan sebelum Anda mengaktifkannya.

## 4. Router MikroTik

Pekerja memanggil REST API RouterOS v7 lewat kunci organisasi `mikrotik` (Pengaturan → Kunci API) berformat:

```
https://192.168.10.1|asisten|KATA_SANDI
```

Saran pengamanan (contoh perintah RouterOS — sesuaikan alamat dan nama dengan jaringan Anda, jalankan di Safe Mode):

```routeros
# User khusus, bukan admin. Mulai dengan hanya-baca; tambahkan write bila ingin asisten bisa mengubah.
/user group add name=asisten-baca policy=read,api,rest-api
/user add name=asisten group=asisten-baca password="GANTI" address=192.168.50.10

# REST lewat HTTPS, hanya dari NAS
/ip service set www-ssl disabled=no address=192.168.50.10/32
/ip firewall filter add chain=input src-address=192.168.50.10 protocol=tcp dst-port=443 action=accept comment="PegawaiKu asisten"
```

Agar asisten bisa **mengubah** pengaturan (setelah Anda menyetujui tiap perubahan), beri grup dengan `write`. Sebelum perubahan pertama di setiap run, pekerja menyimpan backup (`/system backup save name=pegawaiku-TANGGAL-JAM`). Bila backup gagal, perubahan **dibatalkan**; biasanya grup user perlu tambahan policy `policy,sensitive`. Backup lama di router perlu Anda bersihkan sesekali.

**Sertifikat.** Sertifikat buatan router tidak dipercaya Node.js. Jangan mematikan verifikasi TLS; ekspor sertifikatnya dan pasang sebagai CA tepercaya:

1. Di router: buat sertifikat dengan subject-alt-name `IP:192.168.10.1`, pasang ke `www-ssl`, lalu ekspor (`/certificate export-certificate …`).
2. Salin file `.crt` ke `worker/certs/router.crt`.
3. Aktifkan bagian `NODE_EXTRA_CA_CERTS` dan `volumes` di `worker/docker-compose.yml`, lalu `up -d` lagi.

Switch Ruijie dan HSAirPo tidak punya API resmi, jadi tidak dikendalikan pekerja. Simpan dokumentasi port dan VLAN-nya di Drive project; misi "Cek kesehatan jaringan" membandingkannya dengan keadaan router.

## 5. Persetujuan lewat Telegram (opsional)

1. Buat bot lewat **@BotFather**, salin token-nya.
2. Kirim pesan apa saja ke bot itu, lalu cari `chat.id` Anda (mis. lewat **@userinfobot**).
3. Simpan di Pengaturan → Kunci API → Telegram dengan format `TOKEN|CHAT_ID`.

Pekerja lalu mengirim setiap permintaan persetujuan dengan tombol **Setujui / Tolak**, serta laporan selesai/gagal. Kirim `/misi <perintah>` ke bot untuk memberi pekerjaan baru dari HP. Hanya chat dengan `CHAT_ID` tersebut yang dilayani.

## 6. Belajar kebiasaan

- Semua pegawai AI membaca tabel `auto_memory` di setiap chat dan misi.
- Templat **Belajar kebiasaan saya** (tiap malam) membaca pesan Anda 7 hari terakhir, mencatat preferensi yang stabil, dan mengusulkan misi rutin.
- Anda bisa melihat, menghapus, dan menambah catatan di menu **Asisten**. Kata sandi dan kunci ditolak masuk memori.

## 7. Batasan yang perlu diketahui

- Asisten membaca halaman web. Halaman bisa berisi teks yang mencoba mengarahkan AI. Aksi berisiko tetap tertahan di persetujuan, jadi **baca kartu persetujuan sebelum menekan Setujui**.
- Aksi "menulis di dalam aplikasi" berjalan tanpa izin secara default. Pakai mode "semua perubahan" untuk misi yang ingin Anda awasi penuh.
- Kunci `service_role` memberi akses penuh ke database. Simpan `worker/.env` hanya di NAS dan isi `AUTOPILOT_ORG_ID`.
- Setiap run memakai token model. Interval misi rutin dibatasi minimal 30 menit.

## Variabel lain

Lihat `worker/env.example`: `AUTOPILOT_MODEL`, `AUTOPILOT_POLL_SECONDS`, `AUTOPILOT_PROJECT_ID`, `AUTOPILOT_ROUTER_BACKUP`, `AUTOPILOT_WORKER_NAME`.
