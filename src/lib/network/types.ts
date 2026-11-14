export type DeviceKind = "router" | "switch" | "ap" | "nas" | "camera" | "other";
export type NetDevice = { id: string; org_id: string; name: string; kind: DeviceKind; driver: "mikrotik" | "generic"; vendor: string | null; model: string | null; mgmt_ip: string | null; mgmt_port: number; notes: string | null; monitor: boolean; sort: number };
export type NetPort = { id: string; device_id: string; name: string; purpose: string | null; config: string | null; sort: number };

export type RouterIface = { id: string; name: string; type: string; running: boolean; disabled: boolean; comment: string; mac: string; rx_bps: number | null; tx_bps: number | null };
export type RouterLease = { id: string; address: string; mac: string; host: string; server: string; status: string; dynamic: boolean; comment: string };
export type RouterHotspot = { id: string; user: string; address: string; uptime: string; bytes_in: number; bytes_out: number };
export type RouterData = {
  identity: string; version: string; board: string; uptime: string; cpu: number | null; mem_free: number | null; mem_total: number | null;
  interfaces: RouterIface[]; leases: RouterLease[]; hotspot: RouterHotspot[]; hotspot_available: boolean;
};
export type NetStatus = { device_id: string; org_id: string; online: boolean; latency_ms: number | null; seen_by_router: boolean | null; error: string | null; data: RouterData | null; checked_at: string; changed_at: string };

/** Perintah yang boleh dikirim dari web. Daftar tertutup — pekerja menolak jenis lain. */
export const COMMAND_KINDS = ["backup", "interface_disable", "interface_enable", "lease_make_static", "hotspot_kick"] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];
export type NetCommand = { id: string; org_id: string; device_id: string; kind: string; payload: Record<string, unknown>; label: string; status: "queued" | "running" | "done" | "failed"; result: string | null; created_at: string; finished_at: string | null };

export const KIND_LABEL: Record<DeviceKind, string> = { router: "Router", switch: "Switch", ap: "Access point", nas: "NAS", camera: "CCTV / NVR", other: "Lainnya" };
/** status lebih tua dari ini dianggap tidak diketahui (pekerja mati / tidak memantau) */
export const STATUS_STALE_MS = 4 * 60_000;
