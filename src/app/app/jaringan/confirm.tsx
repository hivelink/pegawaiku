"use client";
import { FormPending } from "@/components/ui/form-pending";

/** Tombol kirim yang meminta konfirmasi dulu — untuk aksi yang bisa memutus jaringan atau menghapus data. */
export function ConfirmButton({ ask, className, children, title }: { ask: string; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <button title={title} className={className} onClick={(e) => { if (!window.confirm(ask)) e.preventDefault(); }}>
      <FormPending size={12} />{children}
    </button>
  );
}
