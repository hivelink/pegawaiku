"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { logEvent, describeError, isNextSignal } from "@/lib/log";
import { COMMAND_KINDS, type CommandKind } from "@/lib/network/types";

function guarded(name: string, fn: (fd: FormData) => Promise<void>) {
  return async (fd: FormData): Promise<void> => {
    try { await fn(fd); }
    catch (e) {
      if (isNextSignal(e)) throw e;
      const { message, detail } = describeError(e);
      await logEvent("error", `action:jaringan.${name}`, message, detail);
      throw new Error(/net_(devices|ports|status|commands)/.test(message) && /does not exist|schema cache/.test(message) ? "Tab Jaringan belum terpasang — jalankan migrasi 0016_network.sql di Pengaturan → Pembaruan." : `${name} gagal: ${message}`);
    }
  };
}

async function ctxOrg() {
  const ctx = await getContext();
  if (!ctx.org) throw new Error("Organisasi tidak ditemukan");
  return ctx as typeof ctx & { org: NonNullable<typeof ctx.org> };
}
const done = () => revalidatePath("/app/jaringan");
const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const KINDS = ["router", "switch", "ap", "nas", "camera", "other"];

async function _addDevice(fd: FormData) {
  const { supabase, org, user } = await ctxOrg();
  const name = String(fd.get("name") ?? "").trim().slice(0, 80);
  if (name.length < 2) throw new Error("Nama perangkat wajib diisi.");
  const ip = String(fd.get("mgmt_ip") ?? "").trim();
  if (ip && !IP_RE.test(ip)) throw new Error("Alamat IP tidak valid (contoh: 192.168.10.2).");
  const kind = KINDS.includes(String(fd.get("kind"))) ? String(fd.get("kind")) : "other";
  const driver = fd.get("driver") === "mikrotik" ? "mikrotik" : "generic";
  const port = Math.round(Number(fd.get("mgmt_port") ?? 80));
  const { count } = await supabase.from("net_devices").select("id", { count: "exact", head: true }).eq("org_id", org.id);
  const { error } = await supabase.from("net_devices").insert({
    org_id: org.id, name, kind, driver, mgmt_ip: ip || null, mgmt_port: port >= 1 && port <= 65535 ? port : 80,
    vendor: String(fd.get("vendor") ?? "").trim().slice(0, 60) || null, model: String(fd.get("model") ?? "").trim().slice(0, 60) || null,
    notes: String(fd.get("notes") ?? "").trim().slice(0, 500) || null, sort: ((count ?? 0) + 1) * 10, created_by: user.id,
  });
  if (error) throw new Error(error.message);
  done();
}

async function _deleteDevice(fd: FormData) {
  const { supabase, org } = await ctxOrg();
  const { error } = await supabase.from("net_devices").delete().eq("id", String(fd.get("id"))).eq("org_id", org.id);
  if (error) throw new Error(error.message);
  done();
}

/** Tempel banyak port sekaligus: satu baris per port, kolom dipisah "|" → nama | kegunaan | konfigurasi */
async function _importPorts(fd: FormData) {
  const { supabase, org } = await ctxOrg();
  const deviceId = String(fd.get("device_id"));
  const { data: dev } = await supabase.from("net_devices").select("id").eq("id", deviceId).eq("org_id", org.id).maybeSingle();
  if (!dev) throw new Error("Perangkat tidak ditemukan");
  const rows = String(fd.get("lines") ?? "").split("\n").map((l) => l.split("|").map((c) => c.trim())).filter((c) => c[0]).slice(0, 80)
    .map((c, i) => ({ device_id: deviceId, name: c[0].slice(0, 40), purpose: c[1]?.slice(0, 200) || null, config: c[2]?.slice(0, 200) || null, sort: (i + 1) * 10 }));
  if (!rows.length) throw new Error("Tulis minimal satu baris: nama | kegunaan | konfigurasi");
  const { error } = await supabase.from("net_ports").upsert(rows, { onConflict: "device_id,name" });
  if (error) throw new Error(error.message);
  done();
}

async function _deletePort(fd: FormData) {
  const { supabase } = await ctxOrg(); // RLS membatasi ke perangkat milik organisasi
  const { error } = await supabase.from("net_ports").delete().eq("id", String(fd.get("id")));
  if (error) throw new Error(error.message);
  done();
}

const LABEL: Record<CommandKind, (t: string) => string> = {
  backup: () => "Simpan backup router",
  interface_disable: (t) => `Matikan interface ${t}`,
  interface_enable: (t) => `Hidupkan interface ${t}`,
  lease_make_static: (t) => `Jadikan alamat ${t} tetap`,
  hotspot_kick: (t) => `Putuskan pengguna hotspot ${t}`,
};

/** Kirim perintah ke pekerja di jaringan rumah. Hanya owner/admin (RLS menegakkan hal yang sama). */
async function _queueCommand(fd: FormData) {
  const { supabase, org, user } = await ctxOrg();
  const { data: me } = await supabase.from("org_members").select("role").eq("org_id", org.id).eq("user_id", user.id).maybeSingle();
  if (!me || !["owner", "admin"].includes(me.role)) throw new Error("Hanya owner/admin organisasi yang bisa mengatur router");
  const kind = String(fd.get("kind")) as CommandKind;
  if (!COMMAND_KINDS.includes(kind)) throw new Error("Perintah tidak dikenal");
  const deviceId = String(fd.get("device_id"));
  const { data: dev } = await supabase.from("net_devices").select("id,driver").eq("id", deviceId).eq("org_id", org.id).maybeSingle();
  if (!dev || dev.driver !== "mikrotik") throw new Error("Perintah hanya tersedia untuk router MikroTik");
  const id = String(fd.get("target_id") ?? "");
  if (kind !== "backup" && !/^\*[0-9A-Fa-f]+$/.test(id)) throw new Error("Target tidak valid");
  const { count } = await supabase.from("net_commands").select("id", { count: "exact", head: true }).eq("org_id", org.id).in("status", ["queued", "running"]);
  if ((count ?? 0) >= 5) throw new Error("Masih ada perintah yang menunggu pekerja. Tunggu sampai selesai.");
  const { error } = await supabase.from("net_commands").insert({
    org_id: org.id, device_id: deviceId, kind, payload: kind === "backup" ? {} : { id },
    label: LABEL[kind](String(fd.get("target_name") ?? id).slice(0, 80)), requested_by: user.id,
  });
  if (error) throw new Error(error.message);
  done();
}

export const addDevice = guarded("addDevice", _addDevice);
export const deleteDevice = guarded("deleteDevice", _deleteDevice);
export const importPorts = guarded("importPorts", _importPorts);
export const deletePort = guarded("deletePort", _deletePort);
export const queueCommand = guarded("queueCommand", _queueCommand);
