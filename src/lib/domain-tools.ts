/**
 * Tool domain untuk agent: jaringan (subnet, DNS, cek HTTP, MikroTik REST) dan
 * perminyakan/produksi (konversi satuan oilfield, IPR Vogel, ESP, SRP).
 * Semua perhitungan memakai korelasi standar industri yang dipakai umum; hasil = estimasi awal, bukan desain final.
 */
import type { ToolDef } from "./llm";

export const DOMAIN_TOOL_DEFS: Record<string, ToolDef> = {
  subnet_calc: {
    name: "subnet_calc",
    description: "Kalkulator subnet IPv4: network, broadcast, rentang host, jumlah host, wildcard; opsi memecah menjadi N subnet (VLSM sederhana).",
    input_schema: { type: "object", properties: { cidr: { type: "string", description: "mis. 192.168.10.0/24" }, split_into: { type: "integer", description: "Pecah menjadi n subnet sama besar (opsional)" } }, required: ["cidr"] },
  },
  dns_lookup: {
    name: "dns_lookup",
    description: "Lookup DNS publik (A, AAAA, MX, TXT, CNAME, NS) via DNS-over-HTTPS Cloudflare.",
    input_schema: { type: "object", properties: { name: { type: "string" }, type: { type: "string", enum: ["A", "AAAA", "MX", "TXT", "CNAME", "NS"], default: "A" } }, required: ["name"] },
  },
  http_check: {
    name: "http_check",
    description: "Cek apakah sebuah URL/host publik bisa diakses: status HTTP, waktu respons, header server. Tidak bisa menjangkau IP privat (LAN).",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  mikrotik_rest: {
    name: "mikrotik_rest",
    description: "Panggil REST API RouterOS v7 pada router MikroTik milik user (butuh kunci 'mikrotik' berformat https://host[:port]|user|password; router harus bisa dijangkau dari internet/VPN). Default hanya GET (baca). Perubahan (POST/PATCH/DELETE) hanya jika user minta eksplisit.",
    input_schema: { type: "object", properties: { path: { type: "string", description: "mis. /interface, /ip/address, /ip/dhcp-server/lease, /system/resource" }, method: { type: "string", enum: ["GET", "POST", "PATCH", "DELETE"], default: "GET" }, body: { type: "object" } }, required: ["path"] },
  },
  oilfield_convert: {
    name: "oilfield_convert",
    description: "Konversi satuan oilfield: psi<->bar<->kPa, bbl<->m3<->liter, bpd<->m3/d, ft<->m, °F<->°C, cp<->Pa.s, API<->SG, hp<->kW, psi/ft<->kPa/m, scf<->m3.",
    input_schema: { type: "object", properties: { value: { type: "number" }, from: { type: "string" }, to: { type: "string" } }, required: ["value", "from", "to"] },
  },
  ipr_vogel: {
    name: "ipr_vogel",
    description: "Kurva IPR sumur minyak: Vogel (reservoir jenuh) atau komposit (Pr di atas bubble point, PI linear di atas Pb). Input dari satu titik uji (Pwf, Q). Keluaran: qmax, tabel Pwf vs Q, PI.",
    input_schema: { type: "object", properties: { pr_psi: { type: "number", description: "Tekanan reservoir rata-rata (psi)" }, pwf_test_psi: { type: "number" }, q_test_bpd: { type: "number" }, pb_psi: { type: "number", description: "Bubble point (psi); kosong = reservoir jenuh (Vogel murni)" }, points: { type: "integer", default: 8 } }, required: ["pr_psi", "pwf_test_psi", "q_test_bpd"] },
  },
  esp_quick: {
    name: "esp_quick",
    description: "Perkiraan awal desain ESP: TDH (vertical lift + friksi Hazen-Williams + tekanan kepala sumur), jumlah stage dari head/stage, daya pompa & motor (hp), arus di permukaan. Bukan desain final; pakai kurva pompa vendor untuk hasil akhir.",
    input_schema: { type: "object", properties: { q_bpd: { type: "number" }, pump_depth_ft: { type: "number" }, fluid_level_ft: { type: "number", description: "Kedalaman dynamic fluid level dari permukaan (ft)" }, tubing_id_in: { type: "number", default: 2.441 }, whp_psi: { type: "number", default: 100 }, sg: { type: "number", default: 0.9 }, head_per_stage_ft: { type: "number", description: "Dari kurva pompa pada laju tsb" }, pump_eff: { type: "number", default: 0.6 }, motor_volt: { type: "number", default: 1500 }, motor_pf_eff: { type: "number", default: 0.75 } }, required: ["q_bpd", "pump_depth_ft", "fluid_level_ft", "head_per_stage_ft"] },
  },
  srp_quick: {
    name: "srp_quick",
    description: "Perkiraan awal sucker rod pump (metode konvensional/Mills): PPRL, MPRL, counterbalance ideal, torsi puncak, laju produksi teoretis dan efisiensi volumetrik, tegangan rod. Untuk pemilihan unit pumping awal; verifikasi dengan API RP 11L/software.",
    input_schema: { type: "object", properties: { plunger_d_in: { type: "number" }, stroke_in: { type: "number" }, spm: { type: "number" }, pump_depth_ft: { type: "number" }, fluid_level_ft: { type: "number" }, rod_string: { type: "string", description: "mis. '76' (7/8+3/4), '86', '75', '65', '77', '88'", default: "76" }, sg: { type: "number", default: 1.0 }, tubing_anchored: { type: "boolean", default: true }, measured_q_bpd: { type: "number", description: "Laju aktual (untuk efisiensi), opsional" } }, required: ["plunger_d_in", "stroke_in", "spm", "pump_depth_ft", "fluid_level_ft"] },
  },
  pcp_quick: {
    name: "pcp_quick",
    description: "Perkiraan awal progressive cavity pump (PCP): net lift, displacement minimum (bpd/rpm & m3/d/rpm) pada kecepatan & efisiensi volumetrik tertentu, torsi hidraulik + friksi, daya polished rod, tegangan efektif (Von Mises) rod, serta tabel sensitivitas kecepatan. Bukan desain final; verifikasi dengan kurva uji pompa vendor/software.",
    input_schema: { type: "object", properties: { q_bpd: { type: "number", description: "Laju cairan target (bpd)" }, pump_depth_ft: { type: "number" }, fluid_level_ft: { type: "number", description: "Dynamic fluid level dari permukaan (ft)" }, rpm: { type: "number", description: "Kecepatan rencana (rpm)", default: 250 }, vol_eff: { type: "number", description: "Efisiensi volumetrik 0-1", default: 0.85 }, sg: { type: "number", default: 0.95 }, whp_psi: { type: "number", default: 100 }, chp_psi: { type: "number", description: "Tekanan casing (psi)", default: 0 }, friction_psi: { type: "number", description: "Rugi friksi aliran di tubing (psi) — besar pada minyak berat; 0 bila belum dihitung", default: 0 }, friction_torque_frac: { type: "number", description: "Torsi friksi pompa sebagai fraksi torsi hidraulik (pompa kecil ±0,3–0,4; besar ±0,1–0,15)", default: 0.2 }, rod_d_in: { type: "number", description: "Diameter rod (in): 0.75, 0.875, 1, 1.125", default: 0.875 }, rod_yield_psi: { type: "number", description: "Yield strength rod (psi) dari data pabrikan", default: 85000 }, pump_disp_bpd_per_rpm: { type: "number", description: "Displacement pompa yang sudah ada/dipilih (bpd/rpm), opsional — untuk menghitung rpm & torsi aktualnya" } }, required: ["q_bpd", "pump_depth_ft", "fluid_level_ft"] },
  },
};

export async function runDomainTool(name: string, input: Record<string, unknown>, keys: Record<string, string>): Promise<string | null> {
  switch (name) {
    case "subnet_calc": return subnetCalc(String(input.cidr ?? ""), input.split_into ? Number(input.split_into) : undefined);
    case "dns_lookup": return dnsLookup(String(input.name ?? ""), String(input.type ?? "A"));
    case "http_check": return httpCheck(String(input.url ?? ""));
    case "mikrotik_rest": return mikrotikRest(String(input.path ?? ""), String(input.method ?? "GET"), input.body as Record<string, unknown> | undefined, keys);
    case "oilfield_convert": return oilfieldConvert(Number(input.value), String(input.from), String(input.to));
    case "ipr_vogel": return iprVogel(input);
    case "esp_quick": return espQuick(input);
    case "srp_quick": return srpQuick(input);
    case "pcp_quick": return pcpQuick(input);
    default: return null;
  }
}

// ---------------- Jaringan ----------------
function ip2n(ip: string) { return ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0; }
function n2ip(n: number) { return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join("."); }

function subnetCalc(cidr: string, splitInto?: number): string {
  const m = cidr.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m) return "Format harus a.b.c.d/prefix, mis. 192.168.10.0/24";
  const prefix = Number(m[2]); if (prefix < 0 || prefix > 32) return "Prefix 0–32.";
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const net = (ip2n(m[1]) & mask) >>> 0;
  const bc = (net | (~mask >>> 0)) >>> 0;
  const hosts = prefix >= 31 ? (prefix === 31 ? 2 : 1) : bc - net - 1;
  const lines = [
    `Network: ${n2ip(net)}/${prefix}`, `Netmask: ${n2ip(mask)} (wildcard ${n2ip(~mask >>> 0)})`, `Broadcast: ${n2ip(bc)}`,
    `Host pertama–terakhir: ${prefix >= 31 ? `${n2ip(net)}–${n2ip(bc)}` : `${n2ip(net + 1)}–${n2ip(bc - 1)}`}`, `Jumlah host usable: ${hosts}`,
  ];
  if (splitInto && splitInto > 1) {
    const bits = Math.ceil(Math.log2(splitInto)); const np = prefix + bits;
    if (np > 30) lines.push(`Tidak bisa dipecah menjadi ${splitInto}: prefix hasil /${np} terlalu kecil.`);
    else {
      const size = 2 ** (32 - np);
      lines.push(`\nDipecah menjadi ${2 ** bits} subnet /${np} (${size - 2} host usable masing-masing):`);
      for (let i = 0; i < 2 ** bits; i++) { const s = net + i * size; lines.push(`  ${i + 1}. ${n2ip(s)}/${np}  host ${n2ip(s + 1)}–${n2ip(s + size - 2)}  bc ${n2ip(s + size - 1)}`); }
    }
  }
  return lines.join("\n");
}

async function dnsLookup(name: string, type: string): Promise<string> {
  if (!name) return "Nama host kosong.";
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: "application/dns-json" } });
  const j = await r.json();
  if (!j.Answer?.length) return `Tidak ada record ${type} untuk ${name} (status ${j.Status}).`;
  return `${type} ${name}:\n${j.Answer.map((a: { name: string; data: string; TTL: number }) => `- ${a.data} (TTL ${a.TTL}s)`).join("\n")}`;
}

async function httpCheck(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const host = new URL(url).hostname;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$)/.test(host)) return "Alamat privat/LAN tidak bisa dijangkau dari server. Gunakan IP publik, DDNS, atau VPN.";
  const t0 = Date.now();
  try {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(url, { method: "GET", redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "PegawaiKu-Check/1.0" } });
    clearTimeout(to);
    const hdr = ["server", "content-type", "location", "x-powered-by"].map((h) => (r.headers.get(h) ? `${h}: ${r.headers.get(h)}` : null)).filter(Boolean);
    return `${url} → HTTP ${r.status} ${r.statusText} dalam ${Date.now() - t0} ms\n${hdr.join("\n")}`;
  } catch (e) {
    return `${url} tidak bisa diakses setelah ${Date.now() - t0} ms: ${(e as Error).message}`;
  }
}

async function mikrotikRest(path: string, method: string, body: Record<string, unknown> | undefined, keys: Record<string, string>): Promise<string> {
  const cfg = keys.mikrotik;
  if (!cfg) return "Kunci 'mikrotik' belum diatur. Isi di Pengaturan → Kunci API dengan format https://host:port|username|password (REST API RouterOS v7 harus aktif: /ip/service www-ssl).";
  const [base, user, pass] = cfg.split("|");
  if (!base || !user) return "Format kunci mikrotik salah. Gunakan https://host:port|username|password";
  if (!path.startsWith("/")) path = "/" + path;
  const r = await fetch(`${base.replace(/\/$/, "")}/rest${path}`, {
    method, headers: { authorization: "Basic " + Buffer.from(`${user}:${pass ?? ""}`).toString("base64"), "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  }).catch((e) => { throw new Error(`Router tidak bisa dijangkau: ${e.message}`); });
  const text = await r.text();
  if (!r.ok) return `RouterOS menjawab HTTP ${r.status}: ${text.slice(0, 300)}`;
  return text.length > 12000 ? text.slice(0, 12000) + "\n…[dipotong]" : text;
}

// ---------------- Perminyakan ----------------
const UNIT: Record<string, [string, number]> = {
  psi: ["p", 6894.757], bar: ["p", 1e5], kpa: ["p", 1000], mpa: ["p", 1e6], atm: ["p", 101325],
  bbl: ["v", 0.158987], m3: ["v", 1], liter: ["v", 0.001], l: ["v", 0.001], gal: ["v", 0.00378541], scf: ["v", 0.0283168], ft3: ["v", 0.0283168],
  bpd: ["q", 0.158987], "m3/d": ["q", 1], "m3/h": ["q", 24], "l/s": ["q", 86.4], mscfd: ["q", 28.3168],
  ft: ["L", 0.3048], m: ["L", 1], in: ["L", 0.0254], mm: ["L", 0.001], km: ["L", 1000], mile: ["L", 1609.34],
  cp: ["mu", 0.001], "pa.s": ["mu", 1], "mpa.s": ["mu", 0.001],
  hp: ["P", 745.7], kw: ["P", 1000], w: ["P", 1],
  "psi/ft": ["g", 22620.6], "kpa/m": ["g", 1000], "bar/m": ["g", 1e5],
  lb: ["m", 0.453592], kg: ["m", 1], ton: ["m", 1000],
};
function oilfieldConvert(v: number, from: string, to: string): string {
  const f = from.toLowerCase().trim(), t = to.toLowerCase().trim();
  if (!Number.isFinite(v)) return "Nilai tidak valid.";
  // suhu
  if (["f", "°f", "c", "°c", "k"].includes(f) && ["f", "°f", "c", "°c", "k"].includes(t)) {
    const toC = f.includes("f") ? (v - 32) * 5 / 9 : f === "k" ? v - 273.15 : v;
    const out = t.includes("f") ? toC * 9 / 5 + 32 : t === "k" ? toC + 273.15 : toC;
    return `${v} ${from} = ${out.toFixed(3)} ${to}`;
  }
  // API gravity <-> SG
  if ((f === "api" && t === "sg") || (f === "sg" && t === "api")) {
    const out = f === "api" ? 141.5 / (v + 131.5) : 141.5 / v - 131.5;
    return `${v} ${from} = ${out.toFixed(4)} ${to}`;
  }
  const a = UNIT[f], b = UNIT[t];
  if (!a || !b) return `Satuan tidak dikenal. Didukung: ${Object.keys(UNIT).join(", ")}, F/C/K, API/SG.`;
  if (a[0] !== b[0]) return `Tidak bisa mengonversi ${from} (${a[0]}) ke ${to} (${b[0]}) — besaran berbeda.`;
  const out = v * a[1] / b[1];
  return `${v} ${from} = ${Number(out.toPrecision(6))} ${to}`;
}

function iprVogel(i: Record<string, unknown>): string {
  const pr = Number(i.pr_psi), pwf = Number(i.pwf_test_psi), q = Number(i.q_test_bpd), pb = i.pb_psi != null ? Number(i.pb_psi) : undefined;
  const n = Math.max(4, Math.min(20, Number(i.points ?? 8)));
  if (!(pr > 0 && pwf >= 0 && q > 0 && pwf < pr)) return "Input tidak valid: butuh Pr > Pwf_uji ≥ 0 dan Q_uji > 0.";
  const rows: string[] = []; let qmax: number; let note: string;
  if (pb == null || pb >= pr) {
    // Vogel murni (reservoir jenuh)
    qmax = q / (1 - 0.2 * (pwf / pr) - 0.8 * (pwf / pr) ** 2);
    note = `Vogel (reservoir jenuh): qmax = ${qmax.toFixed(1)} bpd; PI awal ≈ ${(1.8 * qmax / pr).toFixed(3)} bpd/psi.`;
    for (let k = 0; k <= n; k++) { const p = pr * (1 - k / n); rows.push(`${p.toFixed(0)}\t${(qmax * (1 - 0.2 * (p / pr) - 0.8 * (p / pr) ** 2)).toFixed(1)}`); }
  } else {
    // Komposit: linear di atas Pb, Vogel di bawah Pb
    let J: number;
    if (pwf >= pb) J = q / (pr - pwf);
    else J = q / ((pr - pb) + (pb / 1.8) * (1 - 0.2 * (pwf / pb) - 0.8 * (pwf / pb) ** 2));
    const qb = J * (pr - pb); qmax = qb + J * pb / 1.8;
    note = `Komposit (Pb = ${pb} psi): PI = ${J.toFixed(3)} bpd/psi, q pada Pb = ${qb.toFixed(1)} bpd, qmax = ${qmax.toFixed(1)} bpd.`;
    for (let k = 0; k <= n; k++) {
      const p = pr * (1 - k / n);
      const qq = p >= pb ? J * (pr - p) : qb + (J * pb / 1.8) * (1 - 0.2 * (p / pb) - 0.8 * (p / pb) ** 2);
      rows.push(`${p.toFixed(0)}\t${qq.toFixed(1)}`);
    }
  }
  return `${note}\n\nPwf (psi)\tQ (bpd)\n${rows.join("\n")}\n\nCatatan: korelasi Vogel untuk aliran dua fasa; validasi dengan uji sumur multi-rate bila ada.`;
}

function espQuick(i: Record<string, unknown>): string {
  const q = Number(i.q_bpd), depth = Number(i.pump_depth_ft), fl = Number(i.fluid_level_ft), id = Number(i.tubing_id_in ?? 2.441);
  const whp = Number(i.whp_psi ?? 100), sg = Number(i.sg ?? 0.9), hps = Number(i.head_per_stage_ft), eff = Number(i.pump_eff ?? 0.6);
  const volt = Number(i.motor_volt ?? 1500), pfeff = Number(i.motor_pf_eff ?? 0.75);
  if (!(q > 0 && depth > 0 && fl >= 0 && hps > 0)) return "Input tidak valid.";
  if (fl > depth) return "Fluid level tidak boleh lebih dalam dari kedalaman pompa.";
  const gradPsiFt = 0.433 * sg;
  // friksi Hazen-Williams (C=120), ft per 1000 ft; Q dalam gpm
  const gpm = q * 42 / 1440;
  const hf1000 = 0.2083 * (100 / 120) ** 1.852 * gpm ** 1.852 / id ** 4.8655; // ft/1000ft
  const hf = hf1000 * depth / 1000;
  const hWhp = whp / gradPsiFt;
  const tdh = fl + hf + hWhp;
  const stages = Math.ceil(tdh / hps);
  const bhp = q * tdh * sg / (135771 * eff); // hp (bpd, ft)
  const motorHp = bhp * 1.15; // margin 15%
  const amps = motorHp * 745.7 / (Math.sqrt(3) * volt * pfeff);
  return [
    `TDH ≈ ${tdh.toFixed(0)} ft  (lift ${fl} ft + friksi ${hf.toFixed(0)} ft + WHP ${hWhp.toFixed(0)} ft)`,
    `Head/stage ${hps} ft → stage ≈ ${stages}`,
    `Daya pompa (BHP) ≈ ${bhp.toFixed(1)} hp pada efisiensi ${(eff * 100).toFixed(0)}% → motor disarankan ≥ ${motorHp.toFixed(0)} hp`,
    `Arus motor ≈ ${amps.toFixed(1)} A pada ${volt} V (pf×eff ${pfeff})`,
    `Gradien fluida ${gradPsiFt.toFixed(3)} psi/ft (SG ${sg}); tekanan intake ≈ ${((depth - fl) * gradPsiFt).toFixed(0)} psi`,
    `\nCatatan: friksi Hazen-Williams C=120, tubing ID ${id} in. Belum memasukkan gas bebas, viskositas tinggi, dan derating suhu motor — pakai kurva vendor untuk desain final.`,
  ].join("\n");
}

const ROD: Record<string, { wr: number; er: number; fc: number; area: number; desc: string }> = {
  // wr: berat rod di udara lb/ft (rata-rata taper), er: elastic constant in/(lb·ft), fc: faktor frekuensi, area: luas rod terkecil (in²)
  "65": { wr: 1.29, er: 1.3e-6, fc: 1.0, area: 0.307, desc: "3/4 + 5/8" },
  "75": { wr: 1.63, er: 1.0e-6, fc: 1.0, area: 0.442, desc: "7/8 + 3/4" },
  "76": { wr: 1.81, er: 0.88e-6, fc: 1.07, area: 0.442, desc: "7/8 + 3/4 (taper 76)" },
  "77": { wr: 2.22, er: 0.72e-6, fc: 1.0, area: 0.601, desc: "7/8 saja" },
  "86": { wr: 2.3, er: 0.68e-6, fc: 1.1, area: 0.442, desc: "1 + 7/8 + 3/4" },
  "88": { wr: 2.9, er: 0.55e-6, fc: 1.0, area: 0.785, desc: "1 saja" },
};
function srpQuick(i: Record<string, unknown>): string {
  const dp = Number(i.plunger_d_in), S = Number(i.stroke_in), N = Number(i.spm), L = Number(i.pump_depth_ft), fl = Number(i.fluid_level_ft);
  const sg = Number(i.sg ?? 1.0), rodKey = String(i.rod_string ?? "76"), anchored = i.tubing_anchored !== false;
  const rod = ROD[rodKey]; if (!rod) return `Rod string "${rodKey}" tidak dikenal. Pilihan: ${Object.keys(ROD).join(", ")}`;
  if (!(dp > 0 && S > 0 && N > 0 && L > 0 && fl >= 0)) return "Input tidak valid.";
  const Ap = Math.PI * dp * dp / 4;                 // in²
  const Wr = rod.wr * L;                            // lb (udara)
  const Wrf = Wr * (1 - 0.128 * sg);                // lb (terendam)
  const Fo = 0.433 * sg * fl * Ap;                  // beban fluida di plunger (fluid level dari permukaan)
  const a = S * N * N / 70500;                      // faktor percepatan (Mills)
  const PPRL = Wrf + Fo + Wr * a;
  const MPRL = Wrf - Wr * a;
  const CBE = 0.5 * Fo + Wrf;                       // counterbalance ideal
  const PT = 0.25 * S * (PPRL - MPRL) ;             // torsi puncak (in·lb) pendekatan
  const qTheo = 0.1166 * dp * dp * S * N;          // bpd teoretis (100% eff)
  const stress = PPRL / rod.area;                   // psi pada rod teratas
  const measured = i.measured_q_bpd != null ? Number(i.measured_q_bpd) : undefined;
  const eff = measured ? (measured / qTheo) * 100 : undefined;
  return [
    `Rod ${rod.desc}: berat udara ${Wr.toFixed(0)} lb, terendam ${Wrf.toFixed(0)} lb; beban fluida Fo = ${Fo.toFixed(0)} lb (Ap ${Ap.toFixed(3)} in²)`,
    `Faktor percepatan a = ${a.toFixed(3)}`,
    `PPRL ≈ ${PPRL.toFixed(0)} lb | MPRL ≈ ${MPRL.toFixed(0)} lb${MPRL < 0 ? " (NEGATIF → risiko rod float/pound, kurangi SPM)" : ""}`,
    `Counterbalance ideal ≈ ${CBE.toFixed(0)} lb | Torsi puncak ≈ ${(PT / 1000).toFixed(1)} k·in·lb`,
    `Tegangan rod teratas ≈ ${stress.toFixed(0)} psi (${stress > 30000 ? "TINGGI, cek Goodman diagram" : "umumnya aman untuk rod grade D"})`,
    `Laju teoretis ≈ ${qTheo.toFixed(0)} bpd pada 100% efisiensi${eff != null ? `; efisiensi volumetrik aktual ≈ ${eff.toFixed(0)}%` : ""}`,
    `Tubing ${anchored ? "dijangkar" : "TIDAK dijangkar → ada stroke loss tubing, laju aktual lebih rendah"}`,
    `\nCatatan: metode konvensional (Mills), belum memperhitungkan peregangan rod/tubing detail & dinamika gelombang; pakai API RP 11L/software untuk unit sizing final.`,
  ].join("\n");
}

/** PCP: estimasi awal. Rumus umum: displacement = q/(rpm·eff); T_hid = V_per_putaran·ΔP/(2π); daya = T·ω; Von Mises σe = √(σ² + 3τ²). */
function pcpQuick(i: Record<string, unknown>): string {
  const num = (v: unknown, d: number) => (v == null || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
  const q = Number(i.q_bpd), L = Number(i.pump_depth_ft), fl = Number(i.fluid_level_ft);
  const eff = num(i.vol_eff, 0.85), sg = num(i.sg, 0.95), whp = num(i.whp_psi, 100), chp = num(i.chp_psi, 0);
  const fric = num(i.friction_psi, 0), ffr = num(i.friction_torque_frac, 0.2), d = num(i.rod_d_in, 0.875), ys = num(i.rod_yield_psi, 85000);
  const pumpDisp = i.pump_disp_bpd_per_rpm != null ? Number(i.pump_disp_bpd_per_rpm) : undefined;
  let rpm = num(i.rpm, 250);
  if (!(q > 0 && L > 0 && fl >= 0 && fl <= L)) return "Input tidak valid: butuh q > 0, kedalaman pompa > 0, dan 0 ≤ fluid level ≤ kedalaman pompa.";
  if (!(eff > 0 && eff <= 1) || !(rpm > 0) || !(d > 0) || !(sg > 0)) return "Input tidak valid: vol_eff 0–1, rpm > 0, rod_d_in > 0, sg > 0.";
  if (pumpDisp != null && !(pumpDisp > 0)) return "pump_disp_bpd_per_rpm harus > 0.";
  const grad = 0.433 * sg;                              // psi/ft
  const pDis = whp + grad * L + fric;                   // tekanan discharge pompa
  const pInt = chp + grad * (L - fl);                   // tekanan intake (kolom cairan di atas pompa, tanpa koreksi gas)
  const lift = pDis - pInt;                             // net lift (psi)
  if (!(lift > 0)) return `Net lift ≤ 0 (discharge ${pDis.toFixed(0)} psi, intake ${pInt.toFixed(0)} psi) — sumur tidak membutuhkan pompa pada kondisi ini; periksa input.`;
  const calc = (dispBpdRpm: number, n: number) => {
    const vRev = dispBpdRpm * 0.158987 / 1440;          // m³ per putaran
    const tHyd = vRev * lift * 6894.757 / (2 * Math.PI); // N·m
    const tTot = tHyd * (1 + ffr);
    const hp = tTot * (2 * Math.PI * n / 60) / 745.7;
    return { tHyd, tTot, hp };
  };
  const dispMin = q / (rpm * eff);                      // bpd/rpm
  const disp = pumpDisp ?? dispMin;
  if (pumpDisp != null) rpm = q / (pumpDisp * eff);
  const { tHyd, tTot, hp } = calc(disp, rpm);
  const ftlb = (nm: number) => nm * 0.737562;
  // rod: berat API umum (lb/ft)
  const wrTable: [number, number][] = [[0.75, 1.63], [0.875, 2.22], [1, 2.9], [1.125, 3.67]];
  const wr = wrTable.reduce((a, b) => (Math.abs(b[0] - d) < Math.abs(a[0] - d) ? b : a))[1] * (d * d) / (wrTable.reduce((a, b) => (Math.abs(b[0] - d) < Math.abs(a[0] - d) ? b : a))[0] ** 2);
  const area = Math.PI * d * d / 4;                     // in²
  const axial = wr * L * (1 - 0.128 * sg);              // lb, berat rod terendam (beban aksial pompa belum termasuk)
  const sigma = axial / area;                           // psi
  const tau = 16 * (ftlb(tTot) * 12) / (Math.PI * d ** 3); // psi
  const vm = Math.sqrt(sigma * sigma + 3 * tau * tau);
  const pct = (vm / ys) * 100;
  const hydHp = q * lift / 58766;                       // hp hidraulik (bpd·psi/58766)
  const rows = [150, 200, 250, 300, 350, 400, 500].map((n) => {
    const dd = pumpDisp ?? q / (n * eff);
    const qq = pumpDisp != null ? pumpDisp * n * eff : q;
    const c = calc(dd, n);
    return `| ${n} | ${dd.toFixed(2)} | ${(dd * 0.158987).toFixed(3)} | ${qq.toFixed(0)} | ${ftlb(c.tTot).toFixed(0)} | ${c.hp.toFixed(1)} |`;
  });
  const out = [
    `Tekanan discharge ≈ ${pDis.toFixed(0)} psi | intake ≈ ${pInt.toFixed(0)} psi | NET LIFT ≈ ${lift.toFixed(0)} psi (${(lift * 6.894757).toFixed(0)} kPa, setara ${(lift / grad).toFixed(0)} ft kolom fluida)`,
    pumpDisp != null
      ? `Pompa ${pumpDisp} bpd/rpm → butuh ≈ ${rpm.toFixed(0)} rpm untuk ${q} bpd pada efisiensi volumetrik ${(eff * 100).toFixed(0)}%`
      : `Displacement minimum ≈ ${dispMin.toFixed(2)} bpd/rpm (${(dispMin * 0.158987).toFixed(3)} m³/d/rpm) pada ${rpm} rpm, efisiensi volumetrik ${(eff * 100).toFixed(0)}%`,
    `Torsi hidraulik ≈ ${ftlb(tHyd).toFixed(0)} ft·lb (${tHyd.toFixed(0)} N·m) | + friksi pompa ${(ffr * 100).toFixed(0)}% → torsi rod ≈ ${ftlb(tTot).toFixed(0)} ft·lb (${tTot.toFixed(0)} N·m); torsi viskos/gesek rod-tubing BELUM termasuk`,
    `Daya polished rod ≈ ${hp.toFixed(1)} hp (${(hp * 0.7457).toFixed(1)} kW) | daya hidraulik ${hydHp.toFixed(1)} hp → pilih motor dengan cadangan untuk rugi drivehead & start`,
    `Rod ${d} in: beban aksial (berat rod terendam) ≈ ${axial.toFixed(0)} lb, tegangan aksial ${sigma.toFixed(0)} psi, geser torsi ${tau.toFixed(0)} psi → tegangan efektif (Von Mises) ≈ ${vm.toFixed(0)} psi = ${pct.toFixed(0)}% yield ${ys} psi ${pct > 80 ? "→ DI ATAS 80% yield: perbesar rod / turunkan torsi" : "(di bawah batas desain umum 80% yield)"}; beban aksial akibat tekanan pompa belum termasuk`,
    rpm > 500 ? `PERINGATAN: ${rpm.toFixed(0)} rpm di atas 500 rpm — tidak disarankan; pilih pompa displacement lebih besar.` : rpm > 400 ? `Catatan: ${rpm.toFixed(0)} rpm cukup tinggi; keausan rod/tubing & stator naik, pertimbangkan displacement lebih besar.` : "",
    `\nSensitivitas kecepatan (${pumpDisp != null ? "pompa tetap" : "laju target tetap"}):`,
    `| rpm | bpd/rpm | m³/d/rpm | laju bpd | torsi rod ft·lb | daya hp |`, `|---|---|---|---|---|---|`, ...rows,
    `\nCatatan: estimasi awal. Belum memperhitungkan gas bebas di intake, slip aktual vs tekanan (kurva uji pompa), swelling elastomer, torsi viskos, dan beban aksial pompa. Rating lift pompa harus di atas net lift dengan cadangan sesuai rekomendasi vendor.`,
  ];
  return out.filter(Boolean).join("\n");
}
