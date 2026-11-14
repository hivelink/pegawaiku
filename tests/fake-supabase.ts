import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tiruan klien Supabase untuk uji: setiap `from(tabel)` mengembalikan baris dari `fixtures[tabel]`,
 * disaring oleh .eq()/.neq()/.in(); insert/update/upsert/delete dicatat di `writes`.
 * Cukup untuk memeriksa perakitan konteks tanpa database — BUKAN pengganti uji terhadap Supabase asli.
 */
export type Row = Record<string, unknown>;
export type Write = { table: string; op: string; payload: unknown; filters: [string, string, unknown][] };

export function fakeSupabase(fixtures: Record<string, Row[]>) {
  const writes: Write[] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  function builder(table: string) {
    let op = "select"; let payload: unknown = null; let single = false;
    const filters: [string, string, unknown][] = [];
    const match = (r: Row) => filters.every(([k, col, v]) => k === "eq" ? r[col] === v : k === "neq" ? r[col] !== v : k === "in" ? (v as unknown[]).includes(r[col]) : true);
    const b: Record<string, unknown> = {};
    const chain = (name: string) => (...a: unknown[]) => { if (["eq", "neq", "in"].includes(name)) filters.push([name, String(a[0]), a[1]]); return b; };
    for (const n of ["select", "eq", "neq", "in", "lt", "lte", "gt", "gte", "is", "not", "or", "ilike", "order", "limit"]) b[n] = chain(n);
    for (const n of ["insert", "update", "upsert", "delete"]) b[n] = (p: unknown) => { op = n; payload = p ?? null; return b; };
    b.single = () => { single = true; return b; };
    b.maybeSingle = () => { single = true; return b; };
    b.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => {
      let data: unknown;
      if (op === "select") { const rows = (fixtures[table] ?? []).filter(match); data = single ? rows[0] ?? null : rows; }
      else {
        writes.push({ table, op, payload, filters });
        const row = { id: `${table}-baru-${writes.length}`, ...(Array.isArray(payload) ? payload[0] : (payload as Row | null) ?? {}) };
        if (op === "insert") (fixtures[table] ??= []).push(row);
        data = single ? row : [row];
      }
      return Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : 0 }).then(ok, fail);
    };
    return b;
  }
  const client = { from: (t: string) => builder(t), rpc: async (fn: string, args: unknown) => { rpcs.push({ fn, args }); return { data: null, error: null }; } };
  return { sb: client as unknown as SupabaseClient, writes, rpcs, fixtures };
}
