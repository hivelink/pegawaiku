"use client";
import { useState } from "react";

export function BootstrapSql() {
  const [msg, setMsg] = useState("");
  async function copy() {
    setMsg("Mengambil…");
    try {
      const r = await fetch("/api/admin/bootstrap-sql");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await navigator.clipboard.writeText(await r.text());
      setMsg("✅ SQL tersalin. Tempel di SQL Editor lalu Run.");
    } catch (e) { setMsg(`Gagal menyalin: ${(e as Error).message}`); }
  }
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={copy} className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white">Salin SQL</button>
      <span className="text-xs">{msg}</span>
    </div>
  );
}
