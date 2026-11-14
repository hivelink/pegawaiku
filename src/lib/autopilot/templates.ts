import type { Schedule, ScheduleKind } from "./types";

/** Misi siap pakai — satu ketukan di halaman Asisten. `agentSlug` kosong = Arka. */
export type MissionTemplate = {
  key: string; emoji: string; title: string; description: string; instructions: string;
  kind: "task" | "reflect"; schedule_kind: ScheduleKind; schedule: Schedule; agentSlug?: string; needs?: string;
};

export const MISSION_TEMPLATES: MissionTemplate[] = [
  {
    key: "belajar-kebiasaan", emoji: "🧠", title: "Belajar kebiasaan saya",
    description: "Tiap malam membaca cara Anda memakai aplikasi, mencatat preferensi, dan mengusulkan pekerjaan yang layak diotomatiskan.",
    instructions: "Pelajari percakapan user 7 hari terakhir, simpan preferensi dan kebiasaan yang stabil, lalu usulkan paling banyak 3 misi rutin yang benar-benar menghemat waktunya.",
    kind: "reflect", schedule_kind: "daily", schedule: { time: "21:00" },
  },
  {
    key: "cek-jaringan", emoji: "📡", title: "Cek kesehatan jaringan tiap pagi",
    description: "Membaca router MikroTik (hanya baca) dan melaporkan yang berubah atau janggal. Butuh kunci mikrotik dan pekerja di jaringan rumah.",
    instructions: [
      "1. Mulai dengan network_overview: daftar perangkat, peta port (kegunaan tiap port), dan status hidup/mati terakhir dari tab Jaringan. Ini acuan keadaan yang seharusnya.",
      "2. Periksa router lewat mikrotik_rest dengan metode GET saja:",
      "- /system/resource: CPU, memori bebas, uptime, versi RouterOS.",
      "- /interface: port mana yang tersambung; bandingkan dengan peta port (port berisi perangkat tetapi tanpa link = masalah; port kosong tanpa link = normal). Perhatikan kecepatan link WAN dan uplink: 100M pada port gigabit biasanya tanda kabel/konektor bermasalah.",
      "- /ip/route: default route yang aktif untuk tiap WAN.",
      "- /ip/dhcp-server/lease: perangkat baru sejak laporan sebelumnya, per VLAN.",
      "- /log: error, critical, login gagal, dan link down. Hitung kejadian per tanggal dari stempel waktu log. Kolom link-downs di /interface adalah total sejak router menyala, BUKAN jumlah hari ini.",
      "Laporkan hanya yang berubah atau janggal, dengan angka yang bisa dicek (tanggal, jam, jumlah). Bila semua normal, cukup satu kalimat.",
      "Jangan mengubah pengaturan apa pun. Perbaikan yang kamu sarankan ditulis sebagai saran di laporan.",
    ].join("\n"),
    kind: "task", schedule_kind: "daily", schedule: { time: "07:00" }, agentSlug: "satria-network-engineer", needs: "mikrotik",
  },
  {
    key: "ide-konten", emoji: "💡", title: "Ide konten mingguan",
    description: "Tiap Senin pagi meriset topik yang sedang ramai dan menyiapkan lima ide konten di Drive.",
    instructions: "Riset topik yang sedang ramai dan relevan dengan project ini (web_search, baca 2–3 sumber). Tulis 5 ide konten: judul, hook pembuka, format (reel/carousel/artikel), poin isi, dan ajakan bertindak. Ikuti gaya dan preferensi user yang sudah tercatat. Simpan ke Drive sebagai ide-konten-TAHUN-BULAN-TANGGAL.md dan sebutkan sumbernya.",
    kind: "task", schedule_kind: "weekly", schedule: { time: "08:00", days: [1] },
  },
  {
    key: "rangkuman-mingguan", emoji: "🗂", title: "Rangkuman pekerjaan mingguan",
    description: "Tiap Jumat sore merangkum papan tugas dan file baru, lalu menandai keputusan yang menunggu Anda.",
    instructions: "Baca papan tugas (list_tasks) dan daftar file Drive (read_drive_file tanpa argumen). Buat rangkuman satu halaman: yang selesai minggu ini, yang tertunda beserta sebabnya, dan keputusan yang menunggu user. Simpan ke Drive sebagai rangkuman-TAHUN-BULAN-TANGGAL.md.",
    kind: "task", schedule_kind: "weekly", schedule: { time: "16:00", days: [5] },
  },
];
